/** Strip control, zero-width and bidi characters; collapse whitespace; cap length. */
export function sanitizeMemoryText(text: string, maxChars = 300): string {
  const cleaned = text
    .normalize("NFKC")
    .replace(/[\u0000-\u0008\u000B-\u001F\u007F-\u009F\u200B-\u200F\u202A-\u202E\u2060-\u2064\uFEFF]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned.length > maxChars ? cleaned.slice(0, maxChars - 1) + "…" : cleaned;
}

/** Escape so memory text can never close or imitate our delimiter tags. */
export function escapeForContext(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function normalizeFact(fact: string): string {
  return fact
    .normalize("NFKC")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[.!?\s]+$/g, "")
    .trim();
}
