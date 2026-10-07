import { MemWalCompatibilityError } from "@mysten-incubation/memwal";

export type AppErrorCode =
  | "MEMORY_RECALL_FAILED"
  | "MEMORY_SAVE_FAILED"
  | "MEMORY_SAVE_UNCONFIRMED"
  | "MEMORY_COMPATIBILITY_FAILED"
  | "MEMORY_COUNT_FAILED"
  | "GROQ_MODEL_UNAVAILABLE"
  | "GROQ_RATE_LIMITED"
  | "GROQ_REQUEST_FAILED"
  | "INVALID_MEMORY_CANDIDATE"
  | "SECRET_REJECTED"
  | "CONFIG_MISSING"
  | "RATE_LIMITED"
  | "INVALID_REQUEST"
  | "PAYLOAD_TOO_LARGE";

/** User-facing text. Contains no infrastructure detail. */
export const USER_MESSAGES: Record<AppErrorCode, string> = {
  MEMORY_RECALL_FAILED: "Long-term memory is temporarily unavailable. I can still chat, but I may not recall earlier conversations right now.",
  MEMORY_SAVE_FAILED: "Couldn't save this memory.",
  MEMORY_SAVE_UNCONFIRMED: "I couldn't confirm whether the memory finished saving.",
  MEMORY_COMPATIBILITY_FAILED: "Memory service version check failed. Long-term memory is paused.",
  MEMORY_COUNT_FAILED: "Memory count is unavailable.",
  GROQ_MODEL_UNAVAILABLE: "The configured chat model isn't available. Check the GROQ_MODEL setting.",
  GROQ_RATE_LIMITED: "The model is rate limited right now. Please try again in a moment.",
  GROQ_REQUEST_FAILED: "The model request failed. Please try again.",
  INVALID_MEMORY_CANDIDATE: "That wasn't saved as a memory.",
  SECRET_REJECTED: "I didn't save that because it looked like a secret.",
  CONFIG_MISSING: "The server isn't fully configured yet.",
  RATE_LIMITED: "You're sending requests too quickly. Please slow down.",
  INVALID_REQUEST: "That request wasn't valid.",
  PAYLOAD_TOO_LARGE: "That message is too large.",
};

export class AppError extends Error {
  constructor(
    public readonly code: AppErrorCode,
    public readonly retryAfterSeconds?: number,
  ) {
    super(code); // message is the code only — never raw upstream text
    this.name = "AppError";
  }
}

interface ErrLike {
  name?: unknown;
  message?: unknown;
  status?: unknown;
  statusCode?: unknown;
  retryAfterSeconds?: unknown;
  responseHeaders?: unknown;
}

export function statusOf(err: unknown): number | undefined {
  const e = err as ErrLike | null;
  const s = e && typeof e === "object" ? (e.status ?? e.statusCode) : undefined;
  return typeof s === "number" ? s : undefined;
}

function messageOf(err: unknown): string {
  const m = (err as ErrLike | null)?.message;
  return typeof m === "string" ? m : "";
}

/** Timeouts and network failures: the outcome is unknown, NOT a confirmed failure. */
export function isUnconfirmedSave(err: unknown): boolean {
  const e = err as ErrLike | null;
  const status = statusOf(err);
  const msg = messageOf(err);
  if (e && e.name === "MemWalRequestTimeout") return true;
  if (status === 504 || status === 408) return true;
  if (/timed out|timeout/i.test(msg) && !/job failed/i.test(msg)) return true;
  if (status === undefined || status === 0) return !/job failed/i.test(msg); // no HTTP response at all (network)
  return false;
}

export function classifySaveError(err: unknown): AppErrorCode {
  if (err instanceof MemWalCompatibilityError) return "MEMORY_COMPATIBILITY_FAILED";
  if (err instanceof AppError && (err.code === "SECRET_REJECTED" || err.code === "INVALID_MEMORY_CANDIDATE")) return err.code;
  return isUnconfirmedSave(err) ? "MEMORY_SAVE_UNCONFIRMED" : "MEMORY_SAVE_FAILED";
}

export function classifyRecallError(err: unknown): AppErrorCode {
  if (err instanceof MemWalCompatibilityError) return "MEMORY_COMPATIBILITY_FAILED";
  return "MEMORY_RECALL_FAILED";
}

export function classifyGroqError(err: unknown): { code: AppErrorCode; retryAfterSeconds?: number } {
  const status = statusOf(err);
  const msg = messageOf(err);
  if (status === 429) {
    const headers = (err as ErrLike).responseHeaders as Record<string, string> | undefined;
    const ra = headers?.["retry-after"] ? Number(headers["retry-after"]) : undefined;
    return { code: "GROQ_RATE_LIMITED", retryAfterSeconds: Number.isFinite(ra) ? ra : undefined };
  }
  if (status === 404 || /model.*(not found|does not exist|decommission|not supported)|does not exist/i.test(msg)) {
    return { code: "GROQ_MODEL_UNAVAILABLE" };
  }
  return { code: "GROQ_REQUEST_FAILED" };
}

/** Everything that may leave the server about an error. Never includes `cause`, bodies, or raw messages. */
export function publicError(code: AppErrorCode, retryAfterSeconds?: number) {
  return { code, message: USER_MESSAGES[code], ...(retryAfterSeconds ? { retryAfterSeconds } : {}) };
}
