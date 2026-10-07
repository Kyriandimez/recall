"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MemoryPanel } from "./MemoryPanel";
import { RecallChip } from "./MemoryChip";
import { WriteStatus } from "./WriteStatus";
import type { ChatMessage, Conversation, DiagnosticsState, RecallView, WriteView } from "./types";

const STORE_KEY = "recall.conversations.v1";
const uid = () => crypto.randomUUID();
const newConversation = (): Conversation => ({ id: uid(), title: "New conversation", messages: [], updatedAt: Date.now() });

function loadConversations(): Conversation[] {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    const parsed = raw ? (JSON.parse(raw) as Conversation[]) : [];
    return Array.isArray(parsed) && parsed.length ? parsed.map((c) => ({ ...c, messages: c.messages.map((m) => ({ ...m, streaming: false })) })) : [newConversation()];
  } catch { return [newConversation()]; }
}

type Ev = Record<string, unknown> & { type: string };

export function ChatApp() {
  const [convos, setConvos] = useState<Conversation[]>([]);
  const [activeId, setActiveId] = useState<string>("");
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const [memOpen, setMemOpen] = useState(false);
  const [nsLabel, setNsLabel] = useState<string>();
  const [diag, setDiag] = useState<DiagnosticsState>({});
  const [refreshKey, setRefreshKey] = useState(0);
  const endRef = useRef<HTMLDivElement>(null);
  const pollers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  useEffect(() => {
    const c = loadConversations();
    setConvos(c); setActiveId(c[0].id);
    fetch("/api/session", { cache: "no-store" }).then((r) => r.json()).then((j) => setNsLabel(j.namespaceLabel)).catch(() => {});
    const timers = pollers.current;
    return () => timers.forEach((t) => clearTimeout(t));
  }, []);
  useEffect(() => { if (convos.length) { try { localStorage.setItem(STORE_KEY, JSON.stringify(convos.slice(0, 30))); } catch { /* storage full/blocked: history is best-effort */ } } }, [convos]);

  const active = useMemo(() => convos.find((c) => c.id === activeId), [convos, activeId]);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" }); }, [active?.messages]);

  const patchMessage = useCallback((cid: string, mid: string, fn: (m: ChatMessage) => ChatMessage) => {
    setConvos((cs) => cs.map((c) => (c.id === cid ? { ...c, updatedAt: Date.now(), messages: c.messages.map((m) => (m.id === mid ? fn(m) : m)) } : c)));
  }, []);

  const upsertWrite = useCallback((cid: string, mid: string, w: WriteView) => {
    patchMessage(cid, mid, (m) => {
      const writes = [...(m.writes ?? [])];
      const i = writes.findIndex((x) => x.key === w.key);
      if (i >= 0) writes[i] = { ...writes[i], ...w }; else writes.push(w);
      return { ...m, writes };
    });
    setDiag((d) => ({ ...d, lastWrite: { state: w.state, fact: w.fact, at: Date.now() }, lastBlobId: w.state === "saved" && w.blobId ? w.blobId : d.lastBlobId }));
    if (w.state === "saved") setRefreshKey((k) => k + 1);
  }, [patchMessage]);

  /** Auto-write path: poll the server (which verifies the job belongs to this user) until a final state. */
  const pollStatus = useCallback((cid: string, mid: string, w: WriteView) => {
    if (!w.jobToken) return;
    let tries = 0;
    const tick = async () => {
      tries++;
      try {
        const r = await fetch(`/api/memory/status/${encodeURIComponent(w.jobToken as string)}`, { cache: "no-store" });
        const j = (await r.json()) as { state: string; blobId: string | null };
        if (j.state === "saved") return upsertWrite(cid, mid, { ...w, state: "saved", blobId: j.blobId, completedAt: new Date().toISOString() });
        if (j.state === "failed") return upsertWrite(cid, mid, { ...w, state: "failed", message: "Couldn’t save this memory." });
        if (tries >= 30) return upsertWrite(cid, mid, { ...w, state: "unconfirmed" }); // never claim success or failure we can't confirm
      } catch { if (tries >= 30) return upsertWrite(cid, mid, { ...w, state: "unconfirmed" }); }
      pollers.current.set(w.key, setTimeout(tick, Math.min(4000, 1000 + tries * 300)));
    };
    pollers.current.set(w.key, setTimeout(tick, 1000));
  }, [upsertWrite]);

  const run = useCallback(async (cid: string, body: Record<string, unknown>, userContent: string | null, history: ChatMessage[]) => {
    setSending(true);
    const aId = uid();
    const clientMessageId = (body.clientMessageId as string) ?? uid();
    setConvos((cs) => cs.map((c) => (c.id === cid ? {
      ...c, updatedAt: Date.now(),
      title: c.messages.length === 0 && userContent ? userContent.slice(0, 40) : c.title,
      messages: [...c.messages, ...(userContent ? [{ id: uid(), role: "user" as const, content: userContent }] : []), { id: aId, role: "assistant" as const, content: "", streaming: true }],
    } : c)));

    try {
      const res = await fetch("/api/chat", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...body, clientMessageId,
          history: history.filter((m) => m.content).map((m) => ({ role: m.role, content: m.content })).slice(-24),
        }),
      });
      if (!res.ok || !res.body) {
        const j = await res.json().catch(() => ({ message: "Something went wrong." }));
        patchMessage(cid, aId, (m) => ({ ...m, streaming: false, error: { code: j.code ?? "ERROR", message: j.message ?? "Something went wrong." } }));
        return;
      }
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let nl: number;
        while ((nl = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if (!line) continue;
          let ev: Ev;
          try { ev = JSON.parse(line) as Ev; } catch { continue; }
          handleEvent(cid, aId, ev, clientMessageId);
        }
      }
    } catch {
      patchMessage(cid, aId, (m) => ({ ...m, streaming: false, error: { code: "NETWORK", message: "Connection interrupted. Please try again." } }));
    } finally {
      patchMessage(cid, aId, (m) => ({ ...m, streaming: false }));
      setSending(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [patchMessage]);

  function handleEvent(cid: string, aId: string, ev: Ev, clientMessageId: string) {
    switch (ev.type) {
      case "text": patchMessage(cid, aId, (m) => ({ ...m, content: m.content + String(ev.delta) })); break;
      case "recall": {
        const r: RecallView = { status: ev.status as RecallView["status"], count: Number(ev.count), droppedCount: Number(ev.droppedCount ?? 0), memories: (ev.memories as RecallView["memories"]) ?? [], summary: Boolean(ev.summary) };
        patchMessage(cid, aId, (m) => ({ ...m, recall: r }));
        setDiag((d) => ({ ...d, lastRecall: { happened: true, count: r.count, status: r.status } }));
        break;
      }
      case "memory": {
        const fact = String(ev.fact ?? "");
        const cmid = String(ev.clientMessageId ?? clientMessageId);
        const w: WriteView = {
          key: `${cmid}:${fact}`, source: (ev.source as WriteView["source"]) ?? "auto", state: ev.state as WriteView["state"], fact,
          clientMessageId: cmid, jobToken: ev.jobToken as string | undefined, blobId: (ev.blobId as string | null | undefined) ?? null,
          memoryId: ev.memoryId as string | undefined, completedAt: ev.completedAt as string | undefined, message: ev.message as string | undefined, code: ev.code as string | undefined,
        };
        if (!fact && w.state === "rejected") { patchMessage(cid, aId, (m) => ({ ...m, writes: [...(m.writes ?? []), { ...w, key: `${cmid}:rejected`, fact: "(message contained something that looked like a secret)" }] })); break; }
        upsertWrite(cid, aId, w);
        if (w.state === "saving" && w.source === "auto") pollStatus(cid, aId, w);
        break;
      }
      case "pending_override": patchMessage(cid, aId, (m) => ({ ...m, pendingOverride: { memoryText: String(ev.memoryText), clientMessageId: uid() } })); break;
      case "error": patchMessage(cid, aId, (m) => ({ ...m, error: { code: String(ev.code), message: String(ev.message) } })); break;
    }
  }

  function send() {
    const text = input.trim();
    if (!text || sending || !active) return;
    setInput("");
    void run(active.id, { message: text, clientMessageId: uid() }, text, active.messages);
  }

  function confirmOverride(m: ChatMessage, yes: boolean) {
    if (!active || !m.pendingOverride || m.pendingOverride.resolved) return;
    const po = m.pendingOverride;
    patchMessage(active.id, m.id, (x) => ({ ...x, pendingOverride: { ...po, resolved: true } }));
    if (!yes) return;
    // clientMessageId was fixed when the prompt was created, so a re-click can never mint a new key.
    void run(active.id, { message: "", clientMessageId: po.clientMessageId, action: { type: "confirm_override", memoryText: po.memoryText } }, null, active.messages);
  }

  function retrySave(w: WriteView) {
    if (!active || sending || !w.clientMessageId) return;
    // Preserves the ORIGINAL clientMessageId => same deterministic idempotency key.
    void run(active.id, { message: "", clientMessageId: w.clientMessageId, action: { type: "retry_save", fact: w.fact } }, null, active.messages);
  }

  function startNew() {
    const c = newConversation();
    setConvos((cs) => [c, ...cs]); setActiveId(c.id); setDrawer(false); setDiag((d) => ({ ...d, lastRecall: undefined }));
  }

  const activity = useMemo(() => convos.flatMap((c) => c.messages.flatMap((m) => m.writes ?? [])).filter((w) => w.state !== "skipped").reverse(), [convos]);
  const empty = (active?.messages.length ?? 0) === 0;

  return (
    <div className="flex h-dvh overflow-hidden">
      {/* Sidebar / drawer */}
      <aside className={`${drawer ? "translate-x-0" : "-translate-x-full"} md:translate-x-0 fixed md:static z-30 inset-y-0 left-0 w-72 border-r border-rule bg-paper2 transition-transform flex flex-col`}
        style={{ paddingTop: "env(safe-area-inset-top, 0px)" }}>
        <div className="p-4">
          <h1 className="display text-2xl leading-none">Recall</h1>
          <p className="text-xs text-ink3 mt-1">An assistant that remembers you.</p>
        </div>
        <button onClick={startNew} className="m-3 rounded-lg bg-ink px-3 py-2.5 text-sm text-paper">+ New conversation</button>
        <nav className="flex-1 overflow-y-auto px-2 pb-3 space-y-1" aria-label="Conversations">
          {convos.map((c) => (
            <button key={c.id} onClick={() => { setActiveId(c.id); setDrawer(false); }}
              className={`w-full truncate rounded-lg px-3 py-2 text-left text-sm ${c.id === activeId ? "bg-card text-ink border border-rule" : "text-ink2 hover:bg-card"}`}>{c.title}</button>
          ))}
        </nav>
        <p className="p-3 text-[11px] leading-snug text-ink3 border-t border-rule">Conversations are saved in this browser only. Long-term memory lives in Walrus Memory.</p>
      </aside>
      {drawer && <button aria-label="Close menu" className="fixed inset-0 z-20 bg-black/30 md:hidden" onClick={() => setDrawer(false)} />}

      {/* Chat */}
      <main className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-2 px-3 py-2.5">
          <button className="md:hidden rounded-lg border border-rule px-2.5 py-1.5 text-sm" onClick={() => setDrawer(true)} aria-label="Open conversations">☰</button>
          <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{active?.title ?? "Recall"}</p></div>
          <button onClick={startNew} className="hidden sm:block rounded-lg border border-rule px-3 py-1.5 text-sm hover:bg-card">New chat</button>
          <button onClick={() => setMemOpen((o) => !o)} aria-pressed={memOpen}
            className={`rounded-lg border border-accent px-3 py-1.5 text-sm transition-colors hover:bg-accent hover:text-paper ${memOpen ? "bg-accent text-paper" : "text-accent"}`}>Memory</button>
        </header>

        <div className="flex-1 overflow-y-auto px-3 sm:px-6 py-4">
          <div className="mx-auto max-w-2xl space-y-5">
            {empty && (
              <div className="thread rounded-2xl border border-rule p-6 text-center">
                <p className="display text-xl">Tell me something worth remembering.</p>
                <p className="mt-2 text-sm text-ink2">I keep a small set of durable facts in Walrus Memory. Start a new conversation any time — what I recall comes from long-term memory, not from this chat.</p>
                <p className="mt-3 text-xs text-ink3">No chat history carried over — only long-term memory.</p>
              </div>
            )}
            {active?.messages.map((m) => (
              <div key={m.id} className={m.role === "user" ? "flex justify-end" : ""}>
                <div className={m.role === "user" ? "max-w-[85%] rounded-2xl rounded-br-md bg-ink px-4 py-2.5 text-paper" : "max-w-full"}>
                  {m.content && <p className="whitespace-pre-wrap break-words text-[15px] leading-relaxed">{m.content}</p>}
                  {m.role === "assistant" && m.streaming && !m.content && <span className="dot-pulse text-ink3">…</span>}
                  {m.error && <p className="mt-1 text-sm text-bad" role="alert">{m.error.message}</p>}
                  {m.role === "assistant" && m.recall && <RecallChip recall={m.recall} />}
                  {m.role === "assistant" && m.writes?.map((w) => <WriteStatus key={w.key} w={w} onRetry={retrySave} />)}
                  {m.pendingOverride && !m.pendingOverride.resolved && (
                    <div className="mt-2 flex gap-2">
                      <button onClick={() => confirmOverride(m, true)} className="rounded-lg bg-ink px-3 py-1.5 text-sm text-paper">Add the override</button>
                      <button onClick={() => confirmOverride(m, false)} className="rounded-lg border border-rule px-3 py-1.5 text-sm">No</button>
                    </div>
                  )}
                </div>
              </div>
            ))}
            <div ref={endRef} />
          </div>
        </div>

        <form onSubmit={(e) => { e.preventDefault(); send(); }} className="border-t border-rule bg-paper px-3 sm:px-6 py-3" style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom, 0px))" }}>
          <div className="mx-auto flex max-w-2xl items-end gap-2">
            <textarea value={input} onChange={(e) => setInput(e.target.value)} rows={1} maxLength={4000} placeholder="Message Recall…"
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
              className="max-h-40 min-h-[44px] flex-1 resize-none rounded-xl border border-rule bg-card px-3 py-2.5 text-[15px] outline-none focus:border-accent" />
            <button disabled={sending || !input.trim()} className="h-11 rounded-xl bg-accent px-4 text-sm font-medium text-paper disabled:opacity-40">{sending ? "…" : "Send"}</button>
          </div>
          <p className="mx-auto mt-1.5 max-w-2xl text-[11px] text-ink3">Don’t enter passwords, keys or payment details.</p>
        </form>
      </main>

      {/* Memory panel: only when the Memory button is clicked. Right sidebar on desktop, bottom sheet on mobile. */}
      {memOpen && (
        <>
          <button aria-label="Close memory panel" className="fixed inset-0 z-40 bg-black/40 lg:hidden" onClick={() => setMemOpen(false)} />
          <aside
            className="fixed inset-x-0 bottom-0 z-50 flex max-h-[85dvh] flex-col overflow-hidden rounded-t-2xl bg-paper2 shadow-xl lg:static lg:z-auto lg:max-h-none lg:w-96 lg:shrink-0 lg:rounded-none lg:border-l lg:border-rule lg:shadow-none"
            style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
          >
            <div className="flex items-center justify-between px-4 pt-3">
              <span className="text-sm font-medium">Memory</span>
              <button onClick={() => setMemOpen(false)} className="text-sm text-accent hover:underline">Close</button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto">
              <MemoryPanel diag={diag} activity={activity} namespaceLabel={nsLabel} refreshKey={refreshKey} />
            </div>
          </aside>
        </>
      )}
    </div>
  );
}
