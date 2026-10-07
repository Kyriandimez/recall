import type { LLMProvider } from "../llm/provider";
import { pregate } from "./pregate";
import { detectSecret } from "./secrets";
import { runExtraction, type ChatTurn } from "./extract";
import { filterCandidate, isCorrection } from "./filters";
import type { MemoryStore, SaveState } from "./types";
import type { AppErrorCode } from "../errors";

export interface MemoryEvent {
  type: "memory";
  state: SaveState | "skipped";
  fact?: string;
  clientMessageId?: string;
  jobToken?: string;
  blobId?: string | null;
  code?: AppErrorCode;
  reason?: string;
}

export interface AutoMemoryDeps {
  store: MemoryStore;
  provider: LLMProvider;
  settings: { minConfidence: number | null; dedupeDistance: number; maxExtractionInputChars: number };
  allowExtraction: () => boolean;
  allowWrite: () => boolean;
  onLog?: (e: { operation: string; status: string; candidateCount?: number; errorCode?: string }) => void;
}

/**
 * USER MESSAGE -> PRE-GATE -> GROQ EXTRACTION -> ZOD -> DETERMINISTIC FILTERS -> DEDUPE -> MEMWAL WRITE.
 * The extraction model proposes candidates; only this server code decides what is written.
 * Normal chat never reaches a destructive operation (none exists).
 */
export async function* runAutoMemory(
  input: { turns: readonly ChatTurn[]; userMessage: string; clientMessageId: string },
  deps: AutoMemoryDeps,
): AsyncGenerator<MemoryEvent> {
  const log = deps.onLog ?? (() => {});
  const gate = pregate(input.userMessage);
  if (!gate.extract) { log({ operation: "pregate", status: "skip" }); return; }

  // A secret anywhere in the original input blocks the whole candidate path (and is never sent to the extractor).
  if (detectSecret(input.userMessage).matched) {
    log({ operation: "pregate", status: "secret_rejected", errorCode: "SECRET_REJECTED" });
    yield { type: "memory", state: "rejected", code: "SECRET_REJECTED", reason: "input" };
    return;
  }
  if (!deps.allowExtraction()) { log({ operation: "extraction", status: "rate_limited" }); return; }

  const { candidates, ok } = await runExtraction(deps.provider, input.turns, deps.settings.maxExtractionInputChars);
  log({ operation: "extraction", status: ok ? "ok" : "failed", candidateCount: candidates.length, errorCode: ok ? undefined : "INVALID_MEMORY_CANDIDATE" });

  for (const c of candidates.slice(0, 3)) {
    const f = filterCandidate(c, { minConfidence: deps.settings.minConfidence });
    if (!f.ok) {
      log({ operation: "filter", status: f.reason, errorCode: f.code });
      if (f.code === "SECRET_REJECTED") yield { type: "memory", state: "rejected", code: "SECRET_REJECTED", reason: "candidate" };
      continue;
    }

    // Layer 2: semantic dedupe. Bypassed for corrections so "no longer likes Rust" is never swallowed. Fails open.
    if (!isCorrection(c, input.userMessage)) {
      const near = await deps.store.recall(f.fact, { limit: 3, maxDistance: deps.settings.dedupeDistance });
      if (near.status === "ok" && near.memories.length > 0) {
        log({ operation: "dedupe", status: "duplicate" });
        yield { type: "memory", state: "skipped", fact: f.fact, reason: "duplicate" };
        continue;
      }
    }

    if (!deps.allowWrite()) { log({ operation: "write", status: "rate_limited" }); continue; }
    const out = await deps.store.save(f.fact, { clientMessageId: input.clientMessageId, mode: "async" });
    log({ operation: "write", status: out.state, errorCode: out.errorCode });
    yield {
      type: "memory", state: out.state, fact: f.fact, clientMessageId: input.clientMessageId,
      jobToken: out.jobToken, blobId: out.blobId, code: out.errorCode,
    };
  }
}

