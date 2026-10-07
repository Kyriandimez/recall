import { createHmac, timingSafeEqual } from "node:crypto";
import { classifyRecallError, classifySaveError } from "../errors";
import { retryRead, retryWrite, type Sleep } from "../retry";
import { makeIdempotencyKey } from "./idempotency";
import { detectSecret } from "./secrets";
import { sanitizeMemoryText } from "./sanitize";
import type {
  CountOutcome, MemoryHealth, MemoryStore, RecallOpts, RecallOutcome, SaveOpts, SaveOutcome, StatusOutcome, WalrusClient,
} from "./types";

export interface ScopedDeps {
  client: WalrusClient;
  memoryEnv: string;
  serverUrlNetwork: "Mainnet" | "Staging" | "Custom";
  /** Secret used only to bind job tokens to a user. */
  tokenSecret: string;
  settings: {
    maxResults: number;
    maxDistance: number;
    recallTimeoutMs: number;
    waitTimeoutMs: number;
    countMaxPages: number;
  };
  sleep?: Sleep;
  now?: () => number;
}

const USER_ID_RE = /^[a-f0-9]{32}$/;
const JOB_ID_RE = /^[A-Za-z0-9_-]{6,100}$/;
const COUNT_TTL_MS = 60_000;
const countCache = new Map<string, { value: number; exp: number }>();
const countInflight = new Map<string, Promise<CountOutcome>>();
const CACHE_MAX = 1000;

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let t: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, rej) => {
    t = setTimeout(() => rej(Object.assign(new Error("timed out"), { name: "MemWalRequestTimeout", status: 504 })), ms);
  });
  return Promise.race([p, timeout]).finally(() => clearTimeout(t));
}

/**
 * All Walrus access for one VERIFIED user. The namespace is private and derived here only;
 * there is no method that accepts a namespace, and the raw client is never exposed.
 */
export class ScopedMemory implements MemoryStore {
  readonly #ns: string;
  readonly #userId: string;
  readonly #d: ScopedDeps;

  constructor(verifiedUserId: string, deps: ScopedDeps) {
    if (!USER_ID_RE.test(verifiedUserId)) throw new Error("ScopedMemory requires a verified server-issued userId");
    this.#userId = verifiedUserId;
    this.#d = deps;
    this.#ns = `chatbot-${deps.memoryEnv}:${verifiedUserId}`;
  }

  /** Truncated, display-only form (diagnostics). */
  get namespaceLabel(): string {
    return `chatbot-${this.#d.memoryEnv}:${this.#userId.slice(0, 4)}…`;
  }

  #token(jobId: string): string {
    return createHmac("sha256", this.#d.tokenSecret).update(`job:${this.#userId}:${jobId}`).digest("base64url").slice(0, 22);
  }
  #issue(jobId: string): string | undefined {
    return JOB_ID_RE.test(jobId) ? `${jobId}.${this.#token(jobId)}` : undefined;
  }
  #parse(token: string): string | null {
    const i = token.lastIndexOf(".");
    if (i < 1) return null;
    const jobId = token.slice(0, i);
    const given = Buffer.from(token.slice(i + 1));
    const want = Buffer.from(this.#token(jobId));
    if (!JOB_ID_RE.test(jobId) || given.length !== want.length || !timingSafeEqual(given, want)) return null;
    return jobId;
  }

  async recall(query: string, opts: RecallOpts = {}): Promise<RecallOutcome> {
    const s = this.#d.settings;
    const limit = Math.max(1, Math.min(opts.limit ?? s.maxResults, 20));
    const maxDistance = opts.maxDistance ?? s.maxDistance;
    const q = query.trim().slice(0, 500);
    if (!q) return { status: "ok", memories: [], droppedCount: 0 };
    try {
      // NOTE: `maxDistance` is intentionally NOT passed to the SDK (it overwrites `total`); we filter ourselves.
      const raw = await withTimeout(
        retryRead(() => this.#d.client.recall({ query: q, limit, namespace: this.#ns, sort: opts.sort }), { sleep: this.#d.sleep }),
        s.recallTimeoutMs,
      );
      const memories = (raw.results ?? [])
        .filter((r) => typeof r.text === "string" && typeof r.distance === "number" && r.distance < maxDistance)
        .slice(0, limit)
        .map((r) => ({ blobId: r.blob_id, text: r.text, distance: r.distance, createdAt: r.created_at }));
      return { status: "ok", memories, droppedCount: raw.dropped_count ?? 0 };
    } catch (err) {
      return { status: "unavailable", memories: [], droppedCount: 0, errorCode: classifyRecallError(err) };
    }
  }

  async save(fact: string, opts: SaveOpts): Promise<SaveOutcome> {
    // Defense in depth: EVERY write path (auto, explicit, override, retry) passes through here.
    const text = sanitizeMemoryText(fact, 300);
    if (!text) return { state: "rejected", blobId: null, errorCode: "INVALID_MEMORY_CANDIDATE" };
    if (detectSecret(text).matched) return { state: "rejected", blobId: null, errorCode: "SECRET_REJECTED" };

    const key = makeIdempotencyKey(this.#userId, text, opts.clientMessageId);
    const nowIso = () => new Date((this.#d.now ?? Date.now)()).toISOString();
    try {
      if (opts.mode === "wait") {
        const res = await retryWrite(
          () => this.#d.client.rememberAndWait(text, this.#ns, { timeoutMs: this.#d.settings.waitTimeoutMs, idempotencyKey: key }),
          { idempotencyKey: key, sleep: this.#d.sleep },
        );
        return {
          state: "saved",
          memoryId: res.id,
          blobId: res.blob_id ? res.blob_id : null, // "" -> null: never display a blob ID that wasn't reported
          completedAt: nowIso(),
        };
      }
      const res = await retryWrite(() => this.#d.client.remember(text, this.#ns, { idempotencyKey: key }), {
        idempotencyKey: key,
        sleep: this.#d.sleep,
      });
      return { state: "saving", blobId: null, jobToken: this.#issue(res.job_id) };
    } catch (err) {
      const code = classifySaveError(err);
      const state = code === "MEMORY_SAVE_UNCONFIRMED" ? "unconfirmed" : "failed";
      const jobId = (err as { jobId?: unknown })?.jobId;
      return {
        state,
        blobId: null,
        errorCode: code,
        jobToken: state === "unconfirmed" && typeof jobId === "string" ? this.#issue(jobId) : undefined,
      };
    }
  }

  async status(jobToken: string): Promise<StatusOutcome> {
    const jobId = this.#parse(jobToken);
    if (!jobId) return { state: "unknown", blobId: null };
    try {
      const s = await retryRead(() => this.#d.client.getRememberStatus(jobId), { sleep: this.#d.sleep });
      if (s.namespace !== undefined && s.namespace !== this.#ns) return { state: "unknown", blobId: null };
      if (s.status === "done") return { state: "saved", blobId: s.blob_id ? s.blob_id : null };
      if (s.status === "failed") return { state: "failed", blobId: null, errorCode: "MEMORY_SAVE_FAILED" };
      if (s.status === "not_found") return { state: "unknown", blobId: null };
      return { state: "saving", blobId: null };
    } catch {
      return { state: "unknown", blobId: null };
    }
  }

  /** Secondary metadata only. Never throws; never exposes other users' namespaces. */
  async count(): Promise<CountOutcome> {
    const now = (this.#d.now ?? Date.now)();
    const hit = countCache.get(this.#ns);
    if (hit && hit.exp > now) return { status: "ok", count: hit.value, cached: true };
    const running = countInflight.get(this.#ns);
    if (running) return running;

    const job = (async (): Promise<CountOutcome> => {
      try {
        let cursor: string | undefined;
        for (let page = 0; page < this.#d.settings.countMaxPages; page++) {
          const res = await withTimeout(this.#d.client.listNamespaces({ cursor, limit: 500 }), 5000);
          const mine = res.namespaces.find((n) => n.name === this.#ns); // exact match on OUR namespace only
          if (mine) {
            if (countCache.size >= CACHE_MAX) countCache.delete(countCache.keys().next().value as string);
            countCache.set(this.#ns, { value: mine.memory_count, exp: now + COUNT_TTL_MS });
            return { status: "ok", count: mine.memory_count, cached: false };
          }
          if (!res.has_more || !res.next_cursor) return { status: "ok", count: 0, cached: false };
          cursor = res.next_cursor;
        }
        return { status: "unavailable" }; // page bound reached without finding our namespace
      } catch {
        return { status: "unavailable" };
      } finally {
        countInflight.delete(this.#ns);
      }
    })();
    countInflight.set(this.#ns, job);
    return job;
  }

  health(): Promise<MemoryHealth> {
    return probeMemoryHealth(this.#d.client, this.#d.serverUrlNetwork);
  }
}

/** Relayer health (public, unsigned). Never throws. */
export async function probeMemoryHealth(client: WalrusClient, network: MemoryHealth["network"]): Promise<MemoryHealth> {
  try {
    const h = await withTimeout(client.health(), 5000);
    return {
      status: h.status === "ok" || h.status === "healthy" ? "ok" : "unavailable",
      writeReady: typeof h.write_ready === "boolean" ? h.write_ready : null,
      relayerVersion: h.relayerVersion ?? h.version ?? null,
      network,
    };
  } catch {
    return { status: "unavailable", writeReady: null, relayerVersion: null, network };
  }
}

export function resetCountCacheForTests() {
  countCache.clear();
  countInflight.clear();
}
