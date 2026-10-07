import { describe, expect, it } from "vitest";
import { COPY, parseCommand } from "@/lib/commands";

describe("explicit memory commands are anchored — normal sentences are not commands", () => {
  it("remember", () => {
    expect(parseCommand("Remember that my favorite programming language is Rust.")).toEqual({ type: "remember", text: "my favorite programming language is Rust" });
    expect(parseCommand("remember I prefer dark mode")).toEqual({ type: "remember", text: "I prefer dark mode" });
  });
  it("recall summary vs a normal question about a topic", () => {
    expect(parseCommand("What do you remember about me?")?.type).toBe("recall_summary");
    expect(parseCommand("Show me what you remember")?.type).toBe("recall_summary");
    expect(parseCommand("What do you know about what I'm building?")).toBeNull();
    expect(parseCommand("What do you know about my projects?")).toBeNull();
  });
  it("forget", () => {
    expect(parseCommand("Forget that I like Rust.")).toEqual({ type: "forget", target: "I like Rust" });
  });
  it("delete everything", () => {
    for (const m of ["Delete everything you remember about me.", "Clear my memories", "erase all my memories", "Delete all memories"]) {
      expect(parseCommand(m)?.type).toBe("delete_all");
    }
  });
  it.each(["I forgot my keys", "remember when we talked about Rust?", "I can't remember the name", "Please don't forget the milk later", "how do I clear my browser history", "the word 'remember' is common"])(
    "look-alike %j is NOT a command", (m) => expect(parseCommand(m)).toBeNull());
});

describe("honest copy never claims deletion", () => {
  const all = [COPY.deleteAll, COPY.forgetNoMatch, COPY.forgetFound("User likes Rust."), COPY.forgetDone, COPY.overrideText("User likes Rust.")].join("\n");
  it("avoids forbidden claims", () => {
    for (const bad of [/permanently (erased|forgotten)/i, /\bhas been deleted\b/i, /\bI(?:'ve| have) (deleted|erased|removed)\b/i, /private from everyone/i, /perfectly secure/i]) {
      expect(all).not.toMatch(bad);
    }
  });
  it("says the original is still stored and that this app cannot delete", () => {
    expect(COPY.forgetDone).toContain("original Walrus memory is still stored");
    expect(COPY.deleteAll).toContain("doesn't currently have permission or API support to permanently delete");
    expect(COPY.forgetFound("x")).toContain("can't permanently delete");
  });
});
