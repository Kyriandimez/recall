import { describe, expect, it } from "vitest";
import { makeIdempotencyKey } from "@/lib/memory/idempotency";

describe("idempotency key = sha256(userId \\0 normalizedFact \\0 clientMessageId)", () => {
  const u = "a".repeat(32);
  it("is stable across retries of the same intended write", () => {
    expect(makeIdempotencyKey(u, "User likes Rust.", "m1")).toBe(makeIdempotencyKey(u, "  user likes rust ", "m1"));
  });
  it("differs for a separate user statement (re-statement after an override gets a NEW key)", () => {
    expect(makeIdempotencyKey(u, "User likes Rust.", "m1")).not.toBe(makeIdempotencyKey(u, "User likes Rust.", "m3"));
  });
  it("differs per user and per fact", () => {
    expect(makeIdempotencyKey(u, "x y", "m1")).not.toBe(makeIdempotencyKey("b".repeat(32), "x y", "m1"));
    expect(makeIdempotencyKey(u, "x y", "m1")).not.toBe(makeIdempotencyKey(u, "x z", "m1"));
  });
});
