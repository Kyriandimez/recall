/**
 * INVARIANT: the pre-gate is an optimization that decides whether to spend an extraction call.
 * It is NOT the semantic definition of what can be a memory.
 *   pre-gate = NO  -> no extraction -> no memory
 *   pre-gate = YES -> extraction CANDIDATE only (never automatic memory)
 * Small, deterministic, conservative. False negatives are accepted (e.g. "Rust has been my daily driver
 * for years." matches no cue and is skipped on purpose — see tests/pregate.test.ts).
 */
export interface PregateResult { extract: boolean; reason: string }

const GREETING = /^(?:hello|hi|hey|yo|thanks|thank you|thx|ty|lol|lmao|ok|okay|cool|nice|great|bye|good (?:morning|night|evening))[\s!.,]*$/i;
const FIRST_PERSON = /\b(?:i|i'm|im|i've|ive|i'd|i'll|my|mine|we|our)\b/i;

const CUES: RegExp[] = [
  /\bmy name is\b/i,
  /\b(?:i'm|i am|im)\s+(?:a|an|the|building|learning|working|trying|studying|from|based|going|planning|developing|creating|making|using|into|currently|now|new|still)\b/i,
  /\bi\s+(?:use|prefer|like|love|hate|enjoy|moved|live|work|switched|started|stopped|quit|study|speak|own|drive|play|code|write|build|am|have|want)\b/i,
  /\bi\s+(?:don't|do not|no longer|never)\b/i,
  /\bmy\s+(?:favou?rite|job|project|goal|dream|company|startup|team|wife|husband|partner|girlfriend|boyfriend|brother|sister|mom|dad|mother|father|son|daughter|friend|dog|cat|birthday|hobby|stack|editor|phone|laptop|age|city|country)\b/i,
  /\b(?:actually|no longer|not anymore|anymore)\b/i,
  /\bremember\b/i,
];

export function pregate(message: string): PregateResult {
  const text = message.trim();
  if (!text) return { extract: false, reason: "empty" };
  if (GREETING.test(text)) return { extract: false, reason: "greeting_or_filler" };
  if (text.split(/\s+/).length <= 2) return { extract: false, reason: "too_short" };
  if (!FIRST_PERSON.test(text)) return { extract: false, reason: "no_first_person" };
  if (CUES.some((re) => re.test(text))) return { extract: true, reason: "durable_fact_cue" };
  return { extract: false, reason: "no_cue" };
}
