/**
 * Deterministic, best-effort secret detection. Obvious secrets are rejected; ambiguous ordinary values
 * (dates, order numbers, short digit runs, non-Luhn numbers) are NOT blocked. It is not a guarantee that
 * sensitive information can never be stored. No LLM is involved in this decision.
 */
export interface SecretMatch { matched: boolean; kind?: string }

function luhn(digits: string): boolean {
  let sum = 0;
  let alt = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let n = digits.charCodeAt(i) - 48;
    if (alt) { n *= 2; if (n > 9) n -= 9; }
    sum += n;
    alt = !alt;
  }
  return sum % 10 === 0;
}

const PATTERNS: Array<[string, RegExp]> = [
  ["private_key_block", /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ["sui_private_key", /\bsuiprivkey1[a-z0-9]{20,}/i],
  ["api_key_prefix", /\b(?:sk|rk)-[A-Za-z0-9_-]{16,}/],
  ["api_key_prefix", /\bsk_(?:live|test)_[A-Za-z0-9]{12,}/],
  ["groq_key", /\bgsk_[A-Za-z0-9]{20,}/],
  ["github_token", /\b(?:ghp|gho|ghs|ghu|ghr)_[A-Za-z0-9]{20,}|\bgithub_pat_[A-Za-z0-9_]{20,}/],
  ["aws_key", /\bAKIA[0-9A-Z]{16}\b/],
  ["slack_token", /\bxox[abprs]-[A-Za-z0-9-]{10,}/],
  ["google_key", /\bAIza[0-9A-Za-z_-]{30,}/],
  ["jwt", /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/],
  ["bearer_token", /\bBearer\s+[A-Za-z0-9._~+\/-]{16,}=*/i],
  ["auth_header", /\bAuthorization\s*:\s*\S{8,}/i],
  ["password", /\b(?:password|passphrase|passwd|pwd)\s*(?:is|:|=)\s*\S+/i],
  ["credential_assignment", /\b(?:api[_ -]?key|secret(?:[_ -]?key)?|access[_ -]?token|auth[_ -]?token|private[_ -]?key|client[_ -]?secret)\s*(?:is|:|=)\s*["']?[A-Za-z0-9_\-\/+=.]{12,}/i],
  ["recovery_code", /\b(?:recovery|backup|2fa|two[- ]factor|verification|authenticator)\s+codes?\s*(?:is|are|:|=)\s*[A-Za-z0-9 -]{6,}/i],
  ["pin_or_cvv", /\b(?:pin|cvv2?|cvc2?)\s*(?:number|code)?\s*(?:is|:|=)\s*\d{3,8}\b/i],
  ["ssn_like", /\b\d{3}-\d{2}-\d{4}\b/],
];

const SEED_KEYWORD = /\b(?:seed|recovery|secret recovery|mnemonic)\s*(?:phrase|words)?\s*(?:is|are|:|=)\s*((?:[a-z]{3,8}\s+){11,}[a-z]{3,8})/i;

export function detectSecret(text: string): SecretMatch {
  if (!text) return { matched: false };
  for (const [kind, re] of PATTERNS) if (re.test(text)) return { matched: true, kind };

  const seed = SEED_KEYWORD.exec(text);
  if (seed) {
    const n = seed[1].trim().split(/\s+/).length;
    if (n === 12 || n === 15 || n === 18 || n === 21 || n === 24) return { matched: true, kind: "seed_phrase" };
  }
  // A message that is nothing but 12 or 24 short lowercase words is treated as a pasted seed phrase.
  const bare = text.trim();
  if (/^(?:[a-z]{3,8}\s+){11}[a-z]{3,8}$/.test(bare) || /^(?:[a-z]{3,8}\s+){23}[a-z]{3,8}$/.test(bare)) {
    return { matched: true, kind: "seed_phrase" };
  }

  // Payment cards: 13-19 digits (spaces/dashes allowed), Luhn-checked to avoid blocking ordinary numbers.
  const cardRe = /(?<![\d])(?:\d[ -]?){13,19}(?![\d])/g;
  for (const m of text.matchAll(cardRe)) {
    const digits = m[0].replace(/[ -]/g, "");
    if (digits.length >= 13 && digits.length <= 19 && luhn(digits)) return { matched: true, kind: "payment_card" };
  }
  return { matched: false };
}
