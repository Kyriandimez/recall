export interface RecalledMemoryView { blobId: string; text: string; distance: number; createdAt?: string }

export interface RecallView {
  status: "ok" | "unavailable";
  count: number;
  droppedCount: number;
  memories: RecalledMemoryView[];
  summary?: boolean;
}

export type WriteState = "saving" | "saved" | "failed" | "unconfirmed" | "rejected" | "skipped";

export interface WriteView {
  key: string; // clientMessageId + fact
  source: "explicit" | "auto";
  state: WriteState;
  fact: string;
  clientMessageId?: string;
  jobToken?: string;
  blobId?: string | null;
  memoryId?: string;
  completedAt?: string;
  message?: string;
  code?: string;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  recall?: RecallView;
  writes?: WriteView[];
  pendingOverride?: { memoryText: string; clientMessageId: string; resolved?: boolean };
  error?: { code: string; message: string };
  streaming?: boolean;
}

export interface Conversation { id: string; title: string; messages: ChatMessage[]; updatedAt: number }

export interface DiagnosticsState {
  lastRecall?: { happened: boolean; count: number; status: string };
  lastWrite?: { state: string; fact: string; at: number };
  lastBlobId?: string | null;
}
