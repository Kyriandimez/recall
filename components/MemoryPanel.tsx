"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { MemoryList } from "./MemoryChip";
import { shortBlob } from "./MemoryChip";
import type { DiagnosticsState, RecalledMemoryView, WriteView } from "./types";

function CopyId({ id }: { id: string }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  async function copy() {
    try {
      await navigator.clipboard.writeText(id);
    } catch {
      const ta = document.createElement("textarea"); // fallback for non-secure contexts
      ta.value = id; ta.style.position = "fixed"; ta.style.opacity = "0";
      document.body.appendChild(ta); ta.select();
      try { document.execCommand("copy"); } finally { document.body.removeChild(ta); }
    }
    setCopied(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 1600);
  }
  return (
    <span className="relative shrink-0 self-center">
      <button type="button" onClick={() => void copy()} aria-label="Copy blob ID" title="Copy blob ID"
        className="rounded-md p-1.5 text-ink3 hover:bg-accent hover:text-paper">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
        </svg>
      </button>
      {copied && <span role="status" className="absolute right-full top-1/2 mr-1.5 -translate-y-1/2 whitespace-nowrap rounded-md bg-ink px-2 py-1 text-[11px] text-paper">Id copied.</span>}
    </span>
  );
}

interface Health {
  ok: boolean;
  memory: { status: string; network: string; writeReady: boolean | null; relayerVersion: string | null };
  model: { provider: string; id: string; owner: string; runtime: string; status: string };
}

interface Results { title: string; note: string; status: "ok" | "unavailable"; items: RecalledMemoryView[]; incomplete: boolean }

export function MemoryPanel({ diag, activity, namespaceLabel, refreshKey }: {
  diag: DiagnosticsState; activity: WriteView[]; namespaceLabel?: string; refreshKey: number;
}) {
  const [count, setCount] = useState<{ count: number; cached: boolean } | null>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Results | null>(null);
  const [busy, setBusy] = useState(false);
  const [health, setHealth] = useState<Health | null>(null);

  const loadCount = useCallback(async () => {
    try {
      const r = await fetch("/api/memory/count", { cache: "no-store" });
      const j = await r.json();
      setCount(j.status === "ok" ? { count: j.count, cached: j.cached } : null); // failure just hides the count
    } catch { setCount(null); }
  }, []);

  useEffect(() => { void loadCount(); }, [loadCount, refreshKey]);
  useEffect(() => { fetch("/api/health", { cache: "no-store" }).then((r) => r.json()).then(setHealth).catch(() => setHealth(null)); }, []);

  async function search(mode: "search" | "recent") {
    setBusy(true);
    try {
      const r = await fetch("/api/memory/search", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(mode === "search" ? { query, mode } : { mode }) });
      const j = await r.json();
      setResults({
        title: mode === "search" ? "Memory search results" : "Most relevant/recent memories",
        note: mode === "search" ? "These are matching memories, not a complete list." : "These are matches, not everything that’s stored.",
        status: j.status === "ok" ? "ok" : "unavailable",
        items: j.memories ?? [],
        incomplete: (j.droppedCount ?? 0) > 0,
      });
    } catch {
      setResults({ title: "Memory search results", note: "", status: "unavailable", items: [], incomplete: false });
    } finally { setBusy(false); }
  }

  return (
    <div className="flex flex-col gap-5 p-4 text-sm">
      <header>
        <h2 className="display text-lg">Long-term memory</h2>
        <p className="text-ink3 text-xs">What this chatbot remembers about you — matching memories and metadata, not a full list.</p>
        {count !== null && (
          <p className="mt-2 text-ink2" title="From Walrus namespace metadata">
            {count.cached ? "~" : ""}{count.count} {count.count === 1 ? "memory" : "memories"} stored
          </p>
        )}
      </header>

      <section aria-label="Search memories">
        <form onSubmit={(e) => { e.preventDefault(); if (query.trim()) void search("search"); }} className="flex gap-2">
          <input value={query} onChange={(e) => setQuery(e.target.value)} maxLength={200} placeholder="Search memories (e.g. programming)"
            className="min-w-0 flex-1 rounded-lg border border-rule bg-card px-3 py-2 text-ink placeholder:text-ink3 outline-none focus:border-accent" />
          <button disabled={busy || !query.trim()} className="rounded-lg bg-ink px-3 py-2 text-paper disabled:opacity-40">Search</button>
        </form>
        <button onClick={() => void search("recent")} disabled={busy} className="mt-2 text-xs text-accent underline underline-offset-2 disabled:opacity-40">Show most relevant/recent memories</button>
        {results && (
          <div className="mt-3">
            <h3 className="font-medium">{results.title}</h3>
            {results.note && <p className="text-xs text-ink3 mb-2">{results.note}</p>}
            {results.status === "unavailable" ? <p className="text-warn">Memory is temporarily unavailable.</p>
              : results.items.length === 0 ? <p className="text-ink3">No relevant memories recalled.</p>
              : <MemoryList memories={results.items} />}
            {results.incomplete && <p className="mt-1 text-xs text-warn">Some results couldn’t be retrieved; this may be incomplete.</p>}
          </div>
        )}
      </section>

      <section aria-label="Activity on this device">
        <h3 className="font-medium">Saved from this device</h3>
        <p className="text-xs text-ink3 mb-2">A local log of writes this browser was told about — not a source of truth.</p>
        {activity.length === 0 ? <p className="text-ink3">Nothing saved yet in this session.</p> : (
          <ul className="space-y-1.5">
            {activity.slice(0, 8).map((w) => (
              <li key={w.key} className="flex items-start justify-between gap-2 rounded-lg border border-rule px-3 py-1.5 text-xs">
                <div className="min-w-0">
                <span className={w.state === "saved" ? "text-ok" : w.state === "saving" ? "text-ink2" : w.state === "unconfirmed" ? "text-warn" : "text-bad"}>
                  {w.state === "saved" ? "Saved to Walrus" : w.state === "saving" ? "Saving to Walrus…" : w.state === "unconfirmed" ? "Could not confirm the save" : w.state === "rejected" ? "Not saved" : "Couldn’t save"}
                </span>
                {w.blobId && <span className="ml-2 font-mono text-ink3">{shortBlob(w.blobId)}</span>}
                <p className="text-ink3 break-words">“{w.fact}”</p>
                </div>
                {w.blobId && <CopyId id={w.blobId} />}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-label="Diagnostics">
        <h3 className="font-medium">Diagnostics</h3>
        <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
          <dt className="text-ink3">Last recall</dt>
          <dd>{diag.lastRecall ? `${diag.lastRecall.happened ? "ran" : "skipped"} · ${diag.lastRecall.count} recalled${diag.lastRecall.status === "unavailable" ? " · unavailable" : ""}` : "—"}</dd>
          <dt className="text-ink3">Namespace</dt><dd className="font-mono">{namespaceLabel ?? "—"}</dd>
          <dt className="text-ink3">Last memory op</dt><dd>{diag.lastWrite ? `${diag.lastWrite.state}` : "—"}</dd>
          <dt className="text-ink3">Last blob ID</dt><dd className="font-mono break-all">{diag.lastBlobId ?? "—"}</dd>
          <dt className="text-ink3">Walrus network</dt><dd>{health?.memory.network ?? "—"}{health?.memory.writeReady === false ? " · writes not ready" : ""}</dd>
          <dt className="text-ink3">Memory service</dt><dd>{health ? health.memory.status : "—"}</dd>
          <dt className="text-ink3">Chat model</dt><dd className="break-all">{health ? `${health.model.id} (${health.model.owner}) via ${health.model.provider}` : "—"}</dd>
          <dt className="text-ink3">Model status</dt><dd>{health ? (health.model.status === "unknown" ? "unknown (catalog check inconclusive)" : health.model.status) : "—"}</dd>
        </dl>
      </section>

      <section aria-label="Privacy" className="rounded-lg border border-rule bg-paper2 p-3 text-xs text-ink2 space-y-2">
        <h3 className="font-medium text-ink text-sm">Privacy &amp; memory</h3>
        <p><b>What’s stored</b> — The assistant stores selected short facts it believes may be useful later, such as preferences, projects, goals, or other durable information. It does not intentionally store the full chat history as long-term memory.</p>
        <p><b>Where</b> — Memories are stored through Walrus Memory and indexed for semantic recall.</p>
        <p><b>Important</b> — This application does not currently provide permanent deletion of stored memories from inside the app. “Forget” adds a note so the assistant stops treating a memory as current; the original stays stored.</p>
        <p><b>Retention</b> — Walrus storage has a defined storage lifetime. Exact retention depends on the underlying storage configuration.</p>
        <p><b>Privacy</b> — Do not enter passwords, private keys, API keys, payment information, or other secrets into memory. The application attempts to reject obvious secrets, but no automated filter is perfect.</p>
        <p className="text-ink3">Clearing your browser cookies starts a new memory identity.</p>
      </section>
    </div>
  );
}
