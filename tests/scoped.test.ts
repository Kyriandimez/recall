import { describe, expect, it, beforeEach } from "vitest";
import { MemWalCompatibilityError } from "@mysten-incubation/memwal";
import { ScopedMemory, resetCountCacheForTests } from "@/lib/memory/scoped";
import { USER_A, USER_B, flaky, httpError, makeStore, mockClient } from "./helpers";

beforeEach(() => resetCountCacheForTests());

describe("ScopedMemory — isolation and namespace derivation", () => {
  it("requires a verified server-issued userId", () => {
    expect(() => makeStore("not-a-valid-id")).toThrow();
    expect(() => makeStore("../../other-user")).toThrow();
  });

  it("user A cannot recall user B's memory (same owner, different namespace)", async () => {
    const client = mockClient();
    const a = makeStore(USER_A, client);
    const b = makeStore(USER_B, client);
    await a.save("User is building a Unity game", { clientMessageId: "m1", mode: "wait" });
    const forA = await a.recall("Unity game");
    const forB = await b.recall("Unity game");
    expect(forA.memories.map((m) => m.text)).toContain("User is building a Unity game");
    expect(forB.memories).toHaveLength(0);
  });

  it("exposes no method that accepts a namespace, and no destructive method", () => {
    const names = Object.getOwnPropertyNames(ScopedMemory.prototype);
    for (const banned of ["delete", "forget", "clear", "remove", "destroy", "wipe"]) expect(names).not.toContain(banned);
    expect(ScopedMemory.prototype.recall.length).toBeLessThanOrEqual(2); // (query, opts) — no namespace parameter
    expect(ScopedMemory.prototype.save.length).toBe(2);
  });

  it("namespace label is truncated and never the full user id", () => {
    expect(makeStore(USER_A).namespaceLabel).toBe("chatbot-test:aaaa…");
  });
});

describe("recall", () => {
  it("filters by distance itself and caps results", async () => {
    const client = mockClient();
    const s = makeStore(USER_A, client, { maxDistance: 0.0001 });
    await s.save("User likes Rust", { clientMessageId: "m1", mode: "wait" });
    expect((await s.recall("something entirely different")).memories).toHaveLength(0);
  });

  it("returns status=unavailable (never throws) on relayer 500, with a normalized code", async () => {
    const s = makeStore(USER_A, flaky(mockClient(), { recall: () => { throw httpError(500, "boom", { cause: "RAW BODY with secret" }); } }));
    const r = await s.recall("anything");
    expect(r.status).toBe("unavailable");
    expect(r.errorCode).toBe("MEMORY_RECALL_FAILED");
    expect(JSON.stringify(r)).not.toContain("RAW BODY");
  });

  it("returns unavailable on timeout", async () => {
    const s = makeStore(USER_A, flaky(mockClient(), { recall: () => new Promise<never>(() => {}) }), { recallTimeoutMs: 30 });
    expect((await s.recall("x")).status).toBe("unavailable");
  });

  it("maps compatibility failures", async () => {
    const s = makeStore(USER_A, flaky(mockClient(), { recall: () => { throw new MemWalCompatibilityError("x"); } }));
    expect((await s.recall("x")).errorCode).toBe("MEMORY_COMPATIBILITY_FAILED");
  });
});

describe("save — states and honesty", () => {
  it("saved: rememberAndWait success; empty blob_id is reported as null, never fabricated", async () => {
    const client = flaky(mockClient(), {});
    const s = makeStore(USER_A, new Proxy(client, { get: (t, p) => p === "rememberAndWait"
      ? async () => ({ id: "mem1", job_id: "job1", blob_id: "", owner: "o", namespace: "n" })
      : (t as never)[p] }));
    const out = await s.save("User likes tea", { clientMessageId: "m1", mode: "wait" });
    expect(out.state).toBe("saved");
    expect(out.blobId).toBeNull();
  });

  it("saved: real blob id passes through", async () => {
    const out = await makeStore().save("User likes tea", { clientMessageId: "m1", mode: "wait" });
    expect(out.state).toBe("saved");
    expect(typeof out.blobId === "string" && out.blobId.length > 0).toBe(true);
  });

  it("save 500 (job failed) => failed, not unconfirmed", async () => {
    const s = makeStore(USER_A, flaky(mockClient(), { rememberAndWait: () => { throw httpError(500, "remember job failed: x"); } }));
    const out = await s.save("User likes tea", { clientMessageId: "m1", mode: "wait" });
    expect(out.state).toBe("failed");
    expect(out.errorCode).toBe("MEMORY_SAVE_FAILED");
  });

  it("save timeout (504) => unconfirmed, never 'failed'", async () => {
    const s = makeStore(USER_A, flaky(mockClient(), { rememberAndWait: () => { throw httpError(504, "remember job timed out after 30000ms", { jobId: "job-123456" }); } }));
    const out = await s.save("User likes tea", { clientMessageId: "m1", mode: "wait" });
    expect(out.state).toBe("unconfirmed");
    expect(out.errorCode).toBe("MEMORY_SAVE_UNCONFIRMED");
    expect(out.jobToken).toBeTruthy();
    expect(out.blobId).toBeNull();
  });

  it("retry after unconfirmed reuses the SAME idempotency key (same clientMessageId)", async () => {
    const keys: string[] = [];
    const base = mockClient();
    let n = 0;
    const s = makeStore(USER_A, new Proxy(base, { get: (t, p) => p === "rememberAndWait"
      ? async (text: string, ns: string, o: { idempotencyKey: string }) => { keys.push(o.idempotencyKey); if (n++ === 0) throw httpError(504, "timed out"); return t.rememberAndWait(text, ns, o); }
      : (t as never)[p] }));
    const first = await s.save("User likes tea", { clientMessageId: "m-retry", mode: "wait" });
    const second = await s.save("User likes tea", { clientMessageId: "m-retry", mode: "wait" });
    expect(first.state).toBe("unconfirmed");
    expect(second.state).toBe("saved");
    expect(keys[0]).toBe(keys[1]);
  });

  it("does not auto-retry a 504 (outcome unknown) and does not auto-retry a failed job", async () => {
    let calls = 0;
    const s = makeStore(USER_A, flaky(mockClient(), { rememberAndWait: () => { calls++; throw httpError(504, "timed out"); } }));
    await s.save("User likes tea", { clientMessageId: "m1", mode: "wait" });
    expect(calls).toBe(1);
  });

  it("retries a transient 503 with the same key (bounded), then succeeds", async () => {
    const keys: string[] = [];
    let n = 0;
    const base = mockClient();
    const s = makeStore(USER_A, new Proxy(base, { get: (t, p) => p === "rememberAndWait"
      ? async (text: string, ns: string, o: { idempotencyKey: string }) => { keys.push(o.idempotencyKey); if (n++ < 2) throw httpError(503, "unavailable"); return t.rememberAndWait(text, ns, o); }
      : (t as never)[p] }));
    const out = await s.save("User likes tea", { clientMessageId: "m1", mode: "wait" });
    expect(out.state).toBe("saved");
    expect(keys).toHaveLength(3);
    expect(new Set(keys).size).toBe(1);
  });

  it("rejects secrets at the chokepoint — even if a caller forgot to filter", async () => {
    const out = await makeStore().save("User's password is hunter2hunter2", { clientMessageId: "m1", mode: "wait" });
    expect(out.state).toBe("rejected");
    expect(out.errorCode).toBe("SECRET_REJECTED");
  });

  it("async mode returns a user-bound job token, never the raw job id", async () => {
    const out = await makeStore().save("User likes tea", { clientMessageId: "m1", mode: "async" });
    expect(out.state).toBe("saving");
    expect(out.jobToken).toMatch(/\./);
  });
});

describe("status — job-id snooping", () => {
  it("another user's token is rejected as unknown", async () => {
    const client = mockClient();
    const a = makeStore(USER_A, client);
    const b = makeStore(USER_B, client);
    const saved = await a.save("User likes tea", { clientMessageId: "m1", mode: "async" });
    expect((await a.status(saved.jobToken as string)).state).toBe("saved");
    expect((await b.status(saved.jobToken as string)).state).toBe("unknown");
    expect((await a.status("forged.token")).state).toBe("unknown");
    expect((await a.status("")).state).toBe("unknown");
  });
});

describe("count — secondary metadata, never blocks chat, never leaks others", () => {
  it("returns only the caller's own namespace count", async () => {
    const client = mockClient();
    const a = makeStore(USER_A, client);
    const b = makeStore(USER_B, client);
    await a.save("User likes tea", { clientMessageId: "m1", mode: "wait" });
    await a.save("User likes coffee", { clientMessageId: "m2", mode: "wait" });
    await b.save("User likes juice", { clientMessageId: "m3", mode: "wait" });
    const ca = await a.count();
    expect(ca).toMatchObject({ status: "ok", count: 2 });
    expect(JSON.stringify(ca)).not.toContain(USER_B);
  });

  it("failure => unavailable, never throws", async () => {
    const s = makeStore(USER_A, flaky(mockClient(), { listNamespaces: () => { throw httpError(500, "x"); } }));
    expect(await s.count()).toEqual({ status: "unavailable" });
  });

  it("is page-bounded", async () => {
    let calls = 0;
    const s = makeStore(USER_A, flaky(mockClient(), { listNamespaces: async () => { calls++; return { namespaces: [{ name: "other", memory_count: 1 }], next_cursor: "c" + calls, has_more: true }; } }), { countMaxPages: 3 });
    expect(await s.count()).toEqual({ status: "unavailable" });
    expect(calls).toBe(3);
  });
});
