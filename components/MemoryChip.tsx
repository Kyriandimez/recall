"use client";

import { useState } from "react";
import type { RecallView } from "./types";

export function shortBlob(id: string): string {
  return id.length > 14 ? `${id.slice(0, 8)}�${id.slice(-4)}` : id;
}

export function relevanceLabel(distance: number): string {
  return `� ${Math.max(0, 1 - distance).toFixed(2)}`;
}

export function MemoryList({
  memories,
}: {
  memories: RecallView["memories"];
}) {
  return (
    <ul className="space-y-2">
      {memories.map((m) => (
        <li
          key={m.blobId + m.text}
          className="rounded-xl border border-rule bg-card/70 px-3 py-2.5 text-sm"
        >
          <p className="text-ink whitespace-pre-wrap break-words">
            {m.text}
          </p>

          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-ink3">
            {m.createdAt && (
              <span>
                {new Date(m.createdAt).toLocaleDateString()}
              </span>
            )}

            {m.blobId && (
              <span
                className="font-mono"
                title={`Walrus blob ID: ${m.blobId}`}
              >
                Walrus � {shortBlob(m.blobId)}
              </span>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}

export function RecallChip({
  recall,
}: {
  recall: RecallView;
}) {
  const [open, setOpen] = useState(false);

  if (
    recall.summary ||
    recall.status === "unavailable" ||
    recall.count === 0
  ) {
    return null;
  }

  const label =
    recall.count === 1
      ? "1 memory recalled"
      : `${recall.count} memories recalled`;

  return (
    <div className="mt-2">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="inline-flex items-center gap-1.5 rounded-full border border-accent/30 bg-accentsoft/40 px-2.5 py-1 text-xs font-medium text-accent transition hover:border-accent/50 hover:bg-accentsoft"
      >
        <span
          aria-hidden
          className="inline-block h-1.5 w-1.5 rounded-full bg-current"
        />

        <span>{label}</span>

        <span
          aria-hidden
          className={`ml-0.5 text-[10px] transition-transform ${
            open ? "rotate-180" : ""
          }`}
        >
          ?
        </span>
      </button>

      {open && recall.count > 0 && (
        <div className="mt-2 max-w-xl">
          <MemoryList memories={recall.memories} />

          {recall.droppedCount > 0 && (
            <p className="mt-2 text-[11px] text-ink3">
              Some matching memories couldn't be retrieved.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
