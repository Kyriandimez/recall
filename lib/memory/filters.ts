import type { AppErrorCode } from "../errors";
import { detectSecret } from "./secrets";
import { sanitizeMemoryText } from "./sanitize";
import type { Candidate } from "./extract";

export type FilterResult =
  | { ok: true; fact: string }
  | { ok: false; code: AppErrorCode; reason: string };

const INJECTION: RegExp[] = [
  /ignore\s+(?:all\s+|any\s+|the\s+)?(?:previous|prior|above|earlier)\s+(?:instructions?|prompts?|rules?)/i,
  /disregard\s+(?:all\s+|any\s+|the\s+)?(?:previous|prior|above|earlier|your)\b/i,
  /system\s+prompt|developer\s+(?:message|prompt|instructions?)/i,
  /<\|?[a-z_]*\|?>|\[\/?INST\]|\bBEGIN\s+(?:SYSTEM|INSTRUCTIONS?)\b/i,
  /^\s*(?:assistant|system|developer)\s*:/i,
  /\b(?:jailbreak|reveal\s+(?:your|the)\s+(?:prompt|instructions))\b/i,
];

const GENERIC: RegExp[] = [
  /\b(?:asked|asking|asks)\b/i,
  /\bwants?\s+an?\s+(?:answer|response|reply|explanation)\b/i,
  /\bis\s+(?:currently\s+)?chatting\b/i,
  /\bthinks?\s+(?:this|that|the|it)\b.*\b(?:helpful|good|bad|great)\b/i,
  /\b(?:said|says)\s+(?:hello|hi|thanks)\b|\bgreeted\b/i,
  /\bis\s+(?:currently\s+)?(?:tired|hungry|bored|sleepy|happy|sad|angry|busy|here|online)\b/i,
];

const STOP = new Set(["user", "users", "the", "a", "an", "is", "are", "was", "to", "of", "and", "in", "on", "at", "for", "with", "that", "this", "it", "has", "have", "be"]);

/** Ordered: durable -> score -> third-person -> secret -> injection -> too generic. (Dedupe runs afterwards.) */
export function filterCandidate(c: Candidate, opts: { minConfidence: number | null }): FilterResult {
  const fact = sanitizeMemoryText(c.fact, 200);
  if (c.durability !== "durable") return { ok: false, code: "INVALID_MEMORY_CANDIDATE", reason: "not_durable" };
  if (opts.minConfidence !== null && c.confidence < opts.minConfidence) {
    return { ok: false, code: "INVALID_MEMORY_CANDIDATE", reason: "below_extraction_score_threshold" };
  }
  if (!/^(?:the\s+)?user(?:'s|’s)?\b/i.test(fact)) return { ok: false, code: "INVALID_MEMORY_CANDIDATE", reason: "not_third_person" };
  if (detectSecret(fact).matched) return { ok: false, code: "SECRET_REJECTED", reason: "secret_pattern" };
  if (INJECTION.some((re) => re.test(fact))) return { ok: false, code: "INVALID_MEMORY_CANDIDATE", reason: "injection_pattern" };
  if (GENERIC.some((re) => re.test(fact))) return { ok: false, code: "INVALID_MEMORY_CANDIDATE", reason: "too_generic" };
  const content = fact.toLowerCase().split(/[^a-z0-9']+/).filter((w) => w && !STOP.has(w));
  if (content.length < 2 || fact.length < 12) return { ok: false, code: "INVALID_MEMORY_CANDIDATE", reason: "too_generic" };
  return { ok: true, fact };
}

/** Deterministic change cues that must bypass SEMANTIC dedupe so corrections are never swallowed. */
export const CORRECTION_CUE = /\b(?:no longer|not anymore|anymore|stopped|switched|moved|actually|used to|quit|changed)\b/i;

export function isCorrection(c: Candidate, userMessage: string): boolean {
  return c.isExplicitCorrection || CORRECTION_CUE.test(c.fact) || CORRECTION_CUE.test(userMessage);
}
