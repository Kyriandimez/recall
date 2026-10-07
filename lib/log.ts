import { createHmac } from "node:crypto";

/**
 * Metadata-only logging. Only whitelisted fields can be emitted, so message text, memory text,
 * keys, cookies and `err.cause` have no path into the log line.
 */
export interface LogFields {
  requestId?: string;
  userIdHash?: string;
  namespaceHash?: string;
  operation: string;
  durationMs?: number;
  status?: string | number;
  errorCode?: string;
  model?: string;
  candidateCount?: number;
  recalledCount?: number;
}

const ALLOWED = new Set([
  "requestId", "userIdHash", "namespaceHash", "operation", "durationMs", "status",
  "errorCode", "model", "candidateCount", "recalledCount",
]);

export function hashForLog(value: string, secret: string | undefined): string {
  const key = createHmac("sha256", secret ?? "unconfigured").update("log-key").digest();
  return createHmac("sha256", key).update(value).digest("hex").slice(0, 12);
}

export type Sink = (line: string) => void;
let sink: Sink = (line) => console.log(line);
export function setLogSink(s: Sink) { sink = s; }

export function log(fields: LogFields): void {
  const out: Record<string, unknown> = { t: new Date().toISOString() };
  for (const [k, v] of Object.entries(fields)) {
    if (!ALLOWED.has(k)) continue; // anything else is dropped
    if (typeof v === "string" || typeof v === "number") out[k] = typeof v === "string" ? v.slice(0, 120) : v;
  }
  sink(JSON.stringify(out));
}

/** Development-only content logging. Hard-disabled in production regardless of the flag. */
export function debugContent(enabled: boolean, label: string, content: string): void {
  if (!enabled || process.env.NODE_ENV === "production") return;
  console.debug(`[debug-content] ${label}: ${content.slice(0, 500)}`);
}

export function newRequestId(): string {
  return crypto.randomUUID().slice(0, 8);
}
