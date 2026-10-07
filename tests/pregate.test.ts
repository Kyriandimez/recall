import { describe, expect, it } from "vitest";
import { pregate } from "@/lib/memory/pregate";

describe("pre-gate (an optimization, not the definition of memory)", () => {
  it.each(["hello", "hi", "thanks", "lol", "what is Rust?", "explain recursion", "how does Bitcoin work?", "write me a poem", "what's the weather?"])(
    "skips %j", (m) => expect(pregate(m).extract).toBe(false));

  it.each([
    "My name is Kyrian.", "I'm building a game in Unity.", "My favorite language is Rust.",
    "I'm trying to become a software engineer.", "I moved to Abuja.", "I use an Android phone.",
  ])("proceeds on %j (extraction candidate only)", (m) => expect(pregate(m).extract).toBe(true));

  it("KNOWN FALSE NEGATIVE: a durable statement that matches no cue is skipped (limitation made visible)", () => {
    const r = pregate("Rust has been my daily driver for years.");
    expect(r.extract).toBe(false);
    expect(r.reason).toBe("no_cue");
  });

  it("a pre-gate YES is not a memory: it only authorizes an extraction call", () => {
    expect(Object.keys(pregate("I'm tired and I use coffee"))).toEqual(["extract", "reason"]);
  });
});
