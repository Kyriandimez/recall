"use client";
import type { WriteView } from "./types";

/** Plain one-line status. Blob IDs, facts and technical detail live in the Memory panel. */
export function WriteStatus({ w, onRetry }: { w: WriteView; onRetry?: (w: WriteView) => void }) {
  if (w.state === "skipped") return null; // duplicates are not user-facing noise

  const tone =
    w.state === "saved" ? "text-ok"
    : w.state === "saving" ? "text-ink2"
    : w.state === "unconfirmed" ? "text-warn"
    : "text-bad";

  const label =
    w.state === "saving" ? "Saving to Walrus…"
    : w.state === "saved" ? "Saved to Walrus"
    : w.state === "unconfirmed" ? "Could not confirm the save"
    : w.state === "rejected" ? (w.message ?? "Not saved")
    : "Couldn’t save this memory";

  return (
    <div className={`mt-2 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs ${tone}`} role="status">
      <span
        aria-hidden
        className={`inline-block h-1.5 w-1.5 rounded-full bg-current ${w.state === "saving" ? "dot-pulse" : ""}`}
      />
      <span className="font-medium">{label}</span>
      {w.state === "unconfirmed" && (
        <span className="text-ink2">
          It may still complete. Retrying won’t create a duplicate.
          {onRetry && (
            <button onClick={() => onRetry(w)} className="ml-2 underline underline-offset-2 text-accent">
              Retry
            </button>
          )}
        </span>
      )}
    </div>
  );
}
