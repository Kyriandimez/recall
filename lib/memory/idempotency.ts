import { createHash } from "node:crypto";
import { normalizeFact } from "./sanitize";

/**
 * idempotencyKey = sha256(userId + "\0" + normalizedFact + "\0" + clientMessageId)
 * - same clientMessageId + same intended write -> same key (safe retries)
 * - a separate user statement has a different clientMessageId -> different key
 * - clientMessageId is a retry token, NOT an authority. No timestamp is ever used.
 */
export function makeIdempotencyKey(userId: string, fact: string, clientMessageId: string): string {
  return createHash("sha256")
    .update(userId)
    .update("\0")
    .update(normalizeFact(fact))
    .update("\0")
    .update(clientMessageId)
    .digest("hex");
}
