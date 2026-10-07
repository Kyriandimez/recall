import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { configIssues, getConfig, memoryConfigIssues } from "@/lib/env";
import { classifyGroqError, publicError, USER_MESSAGES, type AppErrorCode } from "@/lib/errors";
import { COPY, parseCommand } from "@/lib/commands";
import { log, newRequestId } from "@/lib/log";
import { buildChatMessages } from "@/lib/memory/context";
import { runAutoMemory } from "@/lib/memory/pipeline";
import { detectSecret } from "@/lib/memory/secrets";
import { LIMITS } from "@/lib/ratelimit";
import { retryLlmStart } from "@/lib/retry";
import { clientIp, getProvider, limiter, memoryFor, resolveSession, userHash } from "@/lib/server";
import type { MemoryStore, RecalledMemory, SaveOutcome } from "@/lib/memory/types";
import type { ChatMsg } from "@/lib/llm/provider";

export const runtime = "nodejs";
export const maxDuration = 120;

// .strict(): a client-supplied `namespace` (or any unknown field) is REJECTED with 400. The namespace is server-derived only.
const Body = z
  .object({
    message: z.string().default(""),
    clientMessageId: z.uuid(),
    history: z.array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().max(8000) }).strict()).max(60).default([]),
    action: z
      .discriminatedUnion("type", [
        z.object({ type: z.literal("confirm_override"), memoryText: z.string().min(1).max(300) }).strict(),
        z.object({ type: z.literal("retry_save"), fact: z.string().min(1).max(300) }).strict(),
      ])
      .optional(),
  })
  .strict();

type Event = Record<string, unknown>;

function memoryEvent(fact: string, clientMessageId: string, out: SaveOutcome, source: "explicit" | "auto"): Event {
  return {
    type: "memory", source, state: out.state, fact, clientMessageId, blobId: out.blobId, memoryId: out.memoryId,
    jobToken: out.jobToken, completedAt: out.completedAt, code: out.errorCode,
    ...(out.errorCode ? { message: USER_MESSAGES[out.errorCode] } : {}),
  };
}

function saveText(out: SaveOutcome): string {
  if (out.state === "saved") return "Saved to Walrus.";
  if (out.state === "unconfirmed") return `${USER_MESSAGES.MEMORY_SAVE_UNCONFIRMED} You can retry — it will reuse the same save request, so it won't create a duplicate.`;
  if (out.state === "rejected") return out.errorCode ? USER_MESSAGES[out.errorCode] : USER_MESSAGES.INVALID_MEMORY_CANDIDATE;
  return USER_MESSAGES.MEMORY_SAVE_FAILED;
}

export async function POST(req: NextRequest) {
  const requestId = newRequestId();
  const started = Date.now();
  const cfg = getConfig();

  const issues = configIssues(cfg);
  if (!cfg.authSecret || cfg.authSecret.length < 32 || !cfg.groqApiKey || !cfg.groqModel) {
    return NextResponse.json(publicError("CONFIG_MISSING"), { status: 503 });
  }
  const memoryConfigured = memoryConfigIssues(cfg).length === 0 && !issues.some((i) => i.key === "MEMWAL_SERVER_URL");

  const declared = Number(req.headers.get("content-length") ?? 0);
  if (declared > cfg.limits.maxBodyBytes) return NextResponse.json(publicError("PAYLOAD_TOO_LARGE"), { status: 413 });
  const raw = await req.text();
  if (raw.length > cfg.limits.maxBodyBytes) return NextResponse.json(publicError("PAYLOAD_TOO_LARGE"), { status: 413 });

  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(JSON.parse(raw));
  } catch {
    return NextResponse.json(publicError("INVALID_REQUEST"), { status: 400 });
  }
  const userMessage = body.message.trim();
  if (!body.action && !userMessage) return NextResponse.json(publicError("INVALID_REQUEST"), { status: 400 });
  if (userMessage.length > cfg.limits.maxUserMessageChars) return NextResponse.json(publicError("PAYLOAD_TOO_LARGE"), { status: 413 });

  const session = resolveSession(req, cfg);
  const uh = userHash(session.userId, cfg);
  const wait = Math.max(
    limiter.check(`chat:${session.userId}`, LIMITS.chat.limit, LIMITS.chat.windowMs),
    limiter.check(`chatip:${clientIp(req)}`, LIMITS.chat.limit * 3, LIMITS.chat.windowMs),
  );
  if (wait) {
    const res = NextResponse.json(publicError("RATE_LIMITED", wait), { status: 429, headers: { "Retry-After": String(wait) } });
    return res;
  }

  const provider = getProvider(cfg);
  const store: MemoryStore | null = memoryConfigured ? memoryFor(session.userId, cfg) : null;
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (e: Event) => controller.enqueue(encoder.encode(JSON.stringify(e) + "\n"));
      const say = (text: string) => send({ type: "text", delta: text });
      const finish = (status: string, errorCode?: string, recalledCount?: number) => {
        log({ requestId, userIdHash: uh, operation: "chat", durationMs: Date.now() - started, status, errorCode, model: provider.info().model, recalledCount });
        send({ type: "done" });
        controller.close();
      };

      try {
        send({ type: "start", requestId, memoryConfigured, newIdentity: Boolean(session.newCookie) });

        // ---------- actions (user-confirmed or user-initiated retry) ----------
        if (body.action) {
          if (!store) { say(COPY.memoryUnavailable); return finish("memory_unconfigured"); }
          if (limiter.check(`writes:${session.userId}`, LIMITS.writes.limit, LIMITS.writes.windowMs)) {
            send({ type: "error", ...publicError("RATE_LIMITED") });
            return finish("rate_limited", "RATE_LIMITED");
          }
          const isOverride = body.action.type === "confirm_override";
          const fact = body.action.type === "confirm_override" ? COPY.overrideText(body.action.memoryText) : body.action.fact;
          send({ type: "memory", source: "explicit", state: "saving", fact, clientMessageId: body.clientMessageId });
          // SAME clientMessageId on retries -> same deterministic idempotency key. Never regenerated here.
          const out = await store.save(fact, { clientMessageId: body.clientMessageId, mode: "wait" });
          send(memoryEvent(fact, body.clientMessageId, out, "explicit"));
          say(out.state === "saved" && isOverride ? COPY.forgetDone : saveText(out));
          return finish(out.state, out.errorCode);
        }

        // ---------- explicit memory commands (deterministic, before any LLM call) ----------
        const command = parseCommand(userMessage);
        if (command) {
          if (limiter.check(`cmd:${session.userId}`, LIMITS.commands.limit, LIMITS.commands.windowMs)) {
            send({ type: "error", ...publicError("RATE_LIMITED") });
            return finish("rate_limited", "RATE_LIMITED");
          }
          if (command.type === "delete_all") { say(COPY.deleteAll); return finish("delete_all_explained"); }
          if (!store) { say(COPY.memoryUnavailable); return finish("memory_unconfigured"); }

          if (command.type === "remember") {
            if (detectSecret(command.text).matched) {
              send({ type: "memory", source: "explicit", state: "rejected", fact: command.text, code: "SECRET_REJECTED", message: USER_MESSAGES.SECRET_REJECTED });
              say(USER_MESSAGES.SECRET_REJECTED);
              return finish("rejected", "SECRET_REJECTED");
            }
            if (limiter.check(`writes:${session.userId}`, LIMITS.writes.limit, LIMITS.writes.windowMs)) {
              send({ type: "error", ...publicError("RATE_LIMITED") });
              return finish("rate_limited", "RATE_LIMITED");
            }
            send({ type: "memory", source: "explicit", state: "saving", fact: command.text, clientMessageId: body.clientMessageId });
            const out = await store.save(command.text, { clientMessageId: body.clientMessageId, mode: "wait" });
            send(memoryEvent(command.text, body.clientMessageId, out, "explicit"));
            say(saveText(out));
            return finish(out.state, out.errorCode);
          }

          if (command.type === "recall_summary") {
            const r = await store.recall("facts about the user", { limit: 8, sort: "recent", maxDistance: Math.max(cfg.memory.maxDistance, 0.8) });
            send({ type: "recall", status: r.status, count: r.memories.length, droppedCount: r.droppedCount, memories: r.memories, summary: true });
            if (r.status === "unavailable") say(COPY.memoryUnavailable);
            else if (!r.memories.length) say("No relevant memories recalled.\n\n" + COPY.recallSummaryNote);
            else say("Most relevant/recent memories:\n\n" + r.memories.map((m) => `• ${m.text}`).join("\n") + "\n\n" + COPY.recallSummaryNote);
            return finish("recall_summary", undefined, r.memories.length);
          }

          // forget -> find, show, ask for confirmation. NOT deletion.
          const r = await store.recall(command.target, { limit: 1 });
          if (r.status === "unavailable") { say(COPY.memoryUnavailable); return finish("recall_unavailable", r.errorCode); }
          if (!r.memories.length) { say(COPY.forgetNoMatch); return finish("forget_no_match"); }
          send({ type: "pending_override", memoryText: r.memories[0].text });
          say(COPY.forgetFound(r.memories[0].text));
          return finish("forget_pending", undefined, 1);
        }

        // ---------- normal chat ----------
        let memories: RecalledMemory[] = [];
        let memoryStatus: "ok" | "none" | "unavailable" = "unavailable";
        if (store) {
          const r = await store.recall(userMessage); // recall is read-only; chat never waits on counts/metadata
          memories = r.memories;
          memoryStatus = r.status === "unavailable" ? "unavailable" : r.memories.length ? "ok" : "none";
          send({
            type: "recall", status: r.status, count: r.memories.length, droppedCount: r.droppedCount,
            memories: r.memories, ...(r.errorCode ? { error: publicError(r.errorCode) } : {}),
          });
          log({ requestId, userIdHash: uh, operation: "recall", status: r.status, recalledCount: r.memories.length, errorCode: r.errorCode });
        } else {
          send({ type: "recall", status: "unavailable", count: 0, droppedCount: 0, memories: [], error: publicError("CONFIG_MISSING") });
        }

        const messages: ChatMsg[] = buildChatMessages({
          history: body.history, userMessage, memories, memoryStatus,
          limits: { maxHistoryTurns: cfg.limits.maxHistoryTurns, maxHistoryChars: cfg.limits.maxHistoryChars, contextMaxChars: cfg.memory.contextMaxChars },
        });

        let answered = false;
        try {
          // Retry applies ONLY until the first token exists; after that, mid-stream errors keep the partial text.
          const { it, first } = await retryLlmStart(async () => {
            const iter = provider.stream({ messages, signal: req.signal })[Symbol.asyncIterator]();
            return { it: iter, first: await iter.next() };
          });
          let r = first;
          while (!r.done) {
            answered = true;
            say(r.value);
            r = await it.next();
          }
        } catch (err) {
          const g = classifyGroqError(err);
          send({ type: "error", ...publicError(g.code, g.retryAfterSeconds), partial: answered });
          return finish("groq_error", g.code, memories.length);
        }

        // ---------- automatic memory (after the answer; failures never break the chat) ----------
        if (store) {
          const turns = [...body.history, { role: "user" as const, content: userMessage }];
          try {
            for await (const ev of runAutoMemory(
              { turns, userMessage, clientMessageId: body.clientMessageId },
              {
                store, provider,
                settings: { minConfidence: cfg.memory.minConfidence, dedupeDistance: cfg.memory.dedupeDistance, maxExtractionInputChars: cfg.limits.maxExtractionInputChars },
                allowExtraction: () => limiter.check(`extract:${session.userId}`, LIMITS.extraction.limit, LIMITS.extraction.windowMs) === 0,
                allowWrite: () => limiter.check(`writes:${session.userId}`, LIMITS.writes.limit, LIMITS.writes.windowMs) === 0,
                onLog: (e) => log({ requestId, userIdHash: uh, ...e }),
              },
            )) {
              send({ ...ev, source: "auto", ...(ev.code ? { message: USER_MESSAGES[ev.code as AppErrorCode] } : {}) });
            }
          } catch {
            log({ requestId, userIdHash: uh, operation: "auto_memory", status: "error", errorCode: "MEMORY_SAVE_FAILED" });
          }
        }
        finish("ok", undefined, memories.length);
      } catch {
        // Last resort: never leak details.
        send({ type: "error", ...publicError("GROQ_REQUEST_FAILED") });
        finish("error", "GROQ_REQUEST_FAILED");
      }
    },
    cancel() {
      /* client went away; nothing to clean up */
    },
  });

  const res = new NextResponse(stream, {
    headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store, no-transform", "X-Accel-Buffering": "no" },
  });
  if (session.newCookie) res.cookies.set(session.newCookie.name, session.newCookie.value, session.newCookie.attrs);
  return res;
}
