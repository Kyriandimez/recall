import type { AppErrorCode } from "../errors";

export interface RecalledMemory {
  blobId: string;
  text: string;
  /** Cosine distance (lower = closer). A retrieval signal, not a truth value. */
  distance: number;
  /** RFC3339 write time, when the relayer reports it. */
  createdAt?: string;
}

export interface RecallOpts {
  limit?: number;
  sort?: "relevance" | "recent";
  /** Overrides MEMORY_MAX_DISTANCE (used by the dedupe check). */
  maxDistance?: number;
}

export interface RecallOutcome {
  status: "ok" | "unavailable";
  memories: RecalledMemory[];
  /** Results the relayer could not fetch/decrypt. >0 means "may be incomplete". */
  droppedCount: number;
  errorCode?: AppErrorCode;
}

export type SaveState = "saving" | "saved" | "failed" | "unconfirmed" | "rejected";

export interface SaveOpts {
  /** Retry token for the user's statement. Reused on user-initiated retries; never regenerated. */
  clientMessageId: string;
  /** "wait" = rememberAndWait (explicit/demo path). "async" = remember + status polling (automatic path). */
  mode: "wait" | "async";
}

export interface SaveOutcome {
  state: SaveState;
  memoryId?: string;
  /** null when the SDK did not report a blob ID (never fabricated). */
  blobId: string | null;
  /** Opaque, user-bound token for GET /api/memory/status. Never the raw relayer job ID. */
  jobToken?: string;
  completedAt?: string;
  errorCode?: AppErrorCode;
}

export interface StatusOutcome {
  state: "saving" | "saved" | "failed" | "unknown";
  blobId: string | null;
  errorCode?: AppErrorCode;
}

export type CountOutcome =
  | { status: "ok"; count: number; cached: boolean }
  | { status: "unavailable" };

export interface MemoryHealth {
  status: "ok" | "unavailable";
  writeReady: boolean | null;
  relayerVersion: string | null;
  network: "Mainnet" | "Staging" | "Custom";
}

/**
 * The production memory interface. It deliberately contains NO destructive method
 * (no delete / forget / clear): the installed SDK has none and this app does not fake one.
 */
export interface MemoryStore {
  recall(query: string, opts?: RecallOpts): Promise<RecallOutcome>;
  save(fact: string, opts: SaveOpts): Promise<SaveOutcome>;
  status(jobToken: string): Promise<StatusOutcome>;
  count(): Promise<CountOutcome>;
  health(): Promise<MemoryHealth>;
}

/** The narrow slice of the MemWal SDK we use (0.1.8). The real client and the SDK test double both satisfy it. */
export interface WalrusClient {
  recall(params: { query: string; limit?: number; namespace?: string; sort?: "relevance" | "recent" }): Promise<{
    results: Array<{ blob_id: string; text: string; distance: number; created_at?: string }>;
    total?: number;
    dropped_count?: number;
  }>;
  remember(text: string, namespace?: string, opts?: { idempotencyKey?: string }): Promise<{ job_id: string; status: string }>;
  rememberAndWait(
    text: string,
    namespace?: string,
    opts?: { timeoutMs?: number; pollIntervalMs?: number; idempotencyKey?: string },
  ): Promise<{ id: string; job_id?: string; blob_id: string; owner: string; namespace: string }>;
  getRememberStatus(jobId: string): Promise<{
    job_id: string;
    status: "pending" | "running" | "uploaded" | "done" | "failed" | "not_found" | string;
    namespace?: string;
    blob_id?: string;
    error?: string;
  }>;
  listNamespaces(opts?: { cursor?: string; limit?: number }): Promise<{
    namespaces: Array<{ name: string; memory_count: number }>;
    next_cursor?: string | null;
    has_more: boolean;
  }>;
  health(): Promise<{ status: string; write_ready?: boolean; version?: string; relayerVersion?: string }>;
}
