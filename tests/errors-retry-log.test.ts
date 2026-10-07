import { describe, expect, it, vi } from "vitest";
import { MemWalCompatibilityError } from "@mysten-incubation/memwal";
import { classifyGroqError, classifySaveError, publicError, USER_MESSAGES } from "@/lib/errors";
import { retryLlmStart, retryRead, retryWrite } from "@/lib/retry";
import { hashForLog, log, setLogSink } from "@/lib/log";
import { httpError, noSleep } from "./helpers";

describe("error normalization", () => {
  it("save: job failed => FAILED; timeout/network => UNCONFIRMED; compat => COMPATIBILITY", () => {
    expect(classifySaveError(httpError(500, "remember job failed: boom"))).toBe("MEMORY_SAVE_FAILED");
    expect(classifySaveError(httpError(504, "remember job timed out after 30000ms"))).toBe("MEMORY_SAVE_UNCONFIRMED");
    expect(classifySaveError(Object.assign(new Error("x"), { name: "MemWalRequestTimeout", status: 504 }))).toBe("MEMORY_SAVE_UNCONFIRMED");
    expect(classifySaveError(new TypeError("fetch failed"))).toBe("MEMORY_SAVE_UNCONFIRMED");
    expect(classifySaveError(httpError(401, "unauthorized"))).toBe("MEMORY_SAVE_FAILED");
    expect(classifySaveError(new MemWalCompatibilityError("x"))).toBe("MEMORY_COMPATIBILITY_FAILED");
  });
  it("groq: 429 / model missing / other", () => {
    expect(classifyGroqError(httpError(429, "x", { responseHeaders: { "retry-after": "7" } }))).toEqual({ code: "GROQ_RATE_LIMITED", retryAfterSeconds: 7 });
    expect(classifyGroqError(httpError(404, "The model `x` does not exist")).code).toBe("GROQ_MODEL_UNAVAILABLE");
    expect(classifyGroqError(httpError(503, "upstream")).code).toBe("GROQ_REQUEST_FAILED");
  });
  it("public errors never carry cause, bodies or raw messages", () => {
    const e = httpError(500, "RAW upstream text with sk-secret", { cause: "RAW BODY" });
    const pub = JSON.stringify(publicError(classifySaveError(e)));
    expect(pub).not.toMatch(/RAW|sk-secret/);
    for (const m of Object.values(USER_MESSAGES)) expect(m).not.toMatch(/relayer|walrus\.xyz|\bstack\b|\bcause\b/i);
  });
});

describe("operation-aware retries (≤3, no retry-everything)", () => {
  it("reads retry transient errors then give up after 3", async () => {
    const fn = vi.fn(async () => { throw httpError(503); });
    await expect(retryRead(fn, { sleep: noSleep })).rejects.toBeTruthy();
    expect(fn).toHaveBeenCalledTimes(3);
  });
  it("does not retry arbitrary 4xx", async () => {
    const fn = vi.fn(async () => { throw httpError(400); });
    await expect(retryRead(fn, { sleep: noSleep })).rejects.toBeTruthy();
    expect(fn).toHaveBeenCalledTimes(1);
  });
  it("writes refuse to run without an idempotency key", () => {
    expect(() => retryWrite(async () => 1, { idempotencyKey: "" })).toThrow();
  });
  it("writes never retry 504/timeouts, failed jobs, auth or validation errors", async () => {
    for (const e of [httpError(504, "timed out"), httpError(500, "remember job failed"), httpError(401), httpError(422)]) {
      const fn = vi.fn(async () => { throw e; });
      await expect(retryWrite(fn, { idempotencyKey: "k", sleep: noSleep })).rejects.toBeTruthy();
      expect(fn).toHaveBeenCalledTimes(1);
    }
  });
  it("LLM start retries 429/5xx, not 404/400", async () => {
    const a = vi.fn(async () => { throw httpError(429); });
    await expect(retryLlmStart(a, { sleep: noSleep })).rejects.toBeTruthy();
    expect(a).toHaveBeenCalledTimes(3);
    const b = vi.fn(async () => { throw httpError(404); });
    await expect(retryLlmStart(b, { sleep: noSleep })).rejects.toBeTruthy();
    expect(b).toHaveBeenCalledTimes(1);
  });
  it("succeeds on a later attempt", async () => {
    let n = 0;
    expect(await retryRead(async () => { if (n++ < 2) throw httpError(500); return "ok"; }, { sleep: noSleep })).toBe("ok");
  });
});

describe("logging is metadata-only", () => {
  it("drops non-whitelisted fields (message text, memory text, cause, cookies, keys) and hashes ids", () => {
    const lines: string[] = [];
    setLogSink((l) => lines.push(l));
    log({
      requestId: "r1", operation: "chat", status: "ok", durationMs: 5,
      // @ts-expect-error — deliberately smuggle forbidden fields to prove they are dropped
      message: "MY SECRET MESSAGE", memoryText: "User password is x", cause: "RAW BODY", cookie: "recall_session=abc", apiKey: "gsk_leak",
    });
    setLogSink((l) => console.log(l));
    expect(lines[0]).not.toMatch(/SECRET MESSAGE|password|RAW BODY|recall_session|gsk_leak/);
    expect(JSON.parse(lines[0])).toMatchObject({ requestId: "r1", operation: "chat" });
    const h = hashForLog("a".repeat(32), "s".repeat(40));
    expect(h).toHaveLength(12);
    expect(h).not.toContain("aaaa");
  });
});
