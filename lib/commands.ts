/** Deterministic, anchored memory-command router. Normal sentences are never interpreted as commands. */
export type Command =
  | { type: "remember"; text: string }
  | { type: "recall_summary" }
  | { type: "forget"; target: string }
  | { type: "delete_all" };

const REMEMBER = /^\s*(?:please\s+)?remember\s+(?:that\s+)?(.{3,})$/is;
const REMEMBER_NOT = /^(?:when|how|why|what|where|who|to|me|the way|if)\b/i; // "remember when we…" is not a command
const RECALL = /^\s*(?:what\s+do\s+you\s+(?:remember|know)\s+about\s+me|show\s+me\s+what\s+you\s+(?:remember|know)(?:\s+about\s+me)?|what\s+have\s+you\s+(?:remembered|saved|stored)(?:\s+about\s+me)?|what\s+do\s+you\s+remember)\s*[?.!]*\s*$/i;
const FORGET = /^\s*(?:please\s+)?forget\s+(?:that|about)\s+(.{3,})$/is;
const DELETE_ALL = /^\s*(?:please\s+)?(?:(?:delete|erase|wipe|remove|clear)\s+(?:all|everything)\b.*\b(?:memor(?:y|ies)|remember(?:ed)?|know|stored|saved)\b|(?:delete|erase|wipe|clear)\s+(?:all\s+)?(?:of\s+)?my\s+memor(?:y|ies))/i;

export function parseCommand(message: string): Command | null {
  if (DELETE_ALL.test(message)) return { type: "delete_all" };
  if (RECALL.test(message)) return { type: "recall_summary" };
  const f = FORGET.exec(message);
  if (f) return { type: "forget", target: f[1].trim().replace(/[.!]+$/, "") };
  const r = REMEMBER.exec(message);
  if (r && !REMEMBER_NOT.test(r[1].trim())) return { type: "remember", text: r[1].trim().replace(/[.!]+$/, "") };
  return null;
}

/** Fixed, honest copy. None of these claim deletion. */
export const COPY = {
  deleteAll:
    "This app doesn't currently have permission or API support to permanently delete your stored Walrus memories.\n\nPermanent deletion is an owner-level action in Walrus Memory (the dashboard, or the Security Delete API described in the official Walrus Memory docs: guides/manage-your-memory and guides/delete-memories-programmatically at docs.wal.app/walrus-memory). The app itself does not perform it. What I can do is add an override note for a specific memory so I stop treating it as current.",
  forgetNoMatch:
    "I couldn't find a stored memory that matches that. I can't permanently delete stored memories from this app, but if you tell me what changed I can save that as a newer note.",
  forgetFound: (text: string) =>
    `I found this memory:\n\n“${text}”\n\nI can't permanently delete stored memories from this app yet. I can add a note telling myself not to treat that memory as current. Add the override?`,
  forgetDone: "I've added a note saying not to treat that as current. The original Walrus memory is still stored.",
  overrideText: (memory: string) => `Override: the user no longer wants the earlier memory “${memory}” treated as current.`,
  memoryUnavailable: "Long-term memory is temporarily unavailable, so I can't look that up right now.",
  recallSummaryNote: "These are the most relevant/recent matches, not everything that's stored.",
} as const;
