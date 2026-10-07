import { describe, expect, it } from "vitest";
import { GroqProvider } from "@/lib/llm/groq";
import { ThinkStripper } from "@/lib/llm/think";

const catalog = (ids: string[], status = 200) => (async () =>
  new Response(JSON.stringify({ data: ids.map((id) => ({ id })) }), { status })) as unknown as typeof fetch;
const fail = (e: unknown) => (async () => { throw e; }) as unknown as typeof fetch;
const mk = (fetchImpl: typeof fetch, model: string | null = "qwen/qwen3.8-27b", apiKey: string | null = "k") =>
  new GroqProvider({ apiKey: apiKey ?? undefined, model: model ?? undefined, fetchImpl });

describe("Groq health semantics (catalog only, never inference)", () => {
  it("A. missing GROQ_MODEL => unconfigured / GROQ_MODEL_UNAVAILABLE", async () => {
    expect(await mk(catalog([]), null).health()).toEqual({ status: "unconfigured", code: "GROQ_MODEL_UNAVAILABLE" });
  });
  it("A'. missing key => CONFIG_MISSING", async () => {
    expect((await mk(catalog([]), "qwen/qwen3.8-27b", null).health()).code).toBe("CONFIG_MISSING");
  });
  it("B. catalog confirms the model is absent => unavailable, no fallback model", async () => {
    expect(await mk(catalog(["llama-3.3-70b-versatile"])).health()).toEqual({ status: "unavailable", code: "GROQ_MODEL_UNAVAILABLE" });
  });
  it("ok when present", async () => expect((await mk(catalog(["qwen/qwen3.8-27b"])).health()).status).toBe("ok"));
  it("C. transient catalog failures => unknown (app keeps serving)", async () => {
    expect((await mk(fail(new Error("network"))).health()).status).toBe("unknown");
    expect((await mk(catalog([], 500)).health()).status).toBe("unknown");
    expect((await mk(catalog([], 429)).health()).status).toBe("unknown");
    expect((await mk(fail(new DOMException("t", "TimeoutError"))).health()).status).toBe("unknown");
  });
  it("info reports provider, exact model id and owner", () => {
    expect(mk(catalog([])).info()).toMatchObject({ provider: "Groq", model: "qwen/qwen3.8-27b", owner: "Alibaba Cloud (Qwen)" });
  });
});

describe("ThinkStripper", () => {
  const run = (chunks: string[]) => { const s = new ThinkStripper(); return chunks.map((c) => s.feed(c)).join("") + s.flush(); };
  it("passes plain text", () => expect(run(["Hello ", "world"])).toBe("Hello world"));
  it("removes a reasoning block, even split across chunks", () => {
    expect(run(["<thi", "nk>secret reasoning</th", "ink>\n\nAnswer here"])).toBe("Answer here");
    expect(run(["A<think>x</think>B"])).toBe("AB");
  });
  it("does not swallow a stray '<'", () => expect(run(["1 < 2 and <b>", " ok"])).toBe("1 < 2 and <b> ok"));
});

describe("real AI SDK integration (regression: v7 rejects system messages inside `messages`)", () => {
  it("splitSystem moves system content to `instructions`", async () => {
    const { splitSystem } = await import("@/lib/llm/groq");
    const r = splitSystem([{ role: "system", content: "SYS" }, { role: "user", content: "a" }, { role: "assistant", content: "b" }, { role: "user", content: "c" }]);
    expect(r.instructions).toBe("SYS");
    expect(r.rest.map((m) => m.role)).toEqual(["user", "assistant", "user"]);
  });

  it("streams through the REAL streamText with a mock model, strips <think>, and sends instructions separately", async () => {
    const { MockLanguageModelV4 } = await import("ai/test");
    const { streamFromModel } = await import("@/lib/llm/groq");
    let seenPrompt: unknown;
    const model = new MockLanguageModelV4({
      doStream: async (opts: { prompt: unknown }) => {
        seenPrompt = opts.prompt;
        return {
          stream: new ReadableStream({
            start(c) {
              c.enqueue({ type: "stream-start", warnings: [] });
              c.enqueue({ type: "text-start", id: "1" });
              c.enqueue({ type: "text-delta", id: "1", delta: "<think>hidden</think>Hello " });
              c.enqueue({ type: "text-delta", id: "1", delta: "world" });
              c.enqueue({ type: "text-end", id: "1" });
              c.enqueue({ type: "finish", finishReason: { unified: "stop", raw: "stop" }, usage: { inputTokens: { total: 1 }, outputTokens: { total: 1 } } });
              c.close();
            },
          }),
        };
      },
    } as never);
    let out = "";
    for await (const t of streamFromModel(model as never, [{ role: "system", content: "SYS RULES" }, { role: "user", content: "hi" }])) out += t;
    expect(out).toBe("Hello world");
    expect(JSON.stringify(seenPrompt)).toContain("SYS RULES");
  });

  it("provider errors surface as thrown errors and are NOT console-logged raw by the SDK", async () => {
    const { MockLanguageModelV4 } = await import("ai/test");
    const { streamFromModel } = await import("@/lib/llm/groq");
    const logged: unknown[] = [];
    const orig = console.error;
    console.error = (...a: unknown[]) => { logged.push(a); };
    try {
      const model = new MockLanguageModelV4({ doStream: async () => { throw Object.assign(new Error("boom"), { status: 429, responseBody: "RAW PROVIDER BODY sk-leak" }); } } as never);
      await expect((async () => { for await (const _ of streamFromModel(model as never, [{ role: "user", content: "x" }])) void _; })()).rejects.toBeTruthy();
    } finally { console.error = orig; }
    expect(JSON.stringify(logged)).not.toMatch(/RAW PROVIDER BODY|sk-leak/);
  });
});

describe("structured extraction through the REAL generateText + Output.object", () => {
  it("parses model JSON against the Zod schema (and rejects non-conforming output)", async () => {
    const { MockLanguageModelV4 } = await import("ai/test");
    const { jsonFromModel } = await import("@/lib/llm/groq");
    const { ExtractionSchema } = await import("@/lib/memory/extract");
    const mk = (text: string) => new MockLanguageModelV4({
      doGenerate: async () => ({
        content: [{ type: "text", text }], finishReason: { unified: "stop", raw: "stop" },
        usage: { inputTokens: { total: 1 }, outputTokens: { total: 1 } }, warnings: [],
      }),
    } as never);
    const good = JSON.stringify({ shouldRemember: true, memories: [{ fact: "User is building a Unity game.", kind: "project", confidence: 0.9, durability: "durable", isExplicitCorrection: false }] });
    const out = await jsonFromModel(mk(good) as never, { system: "extract", prompt: "I'm building a Unity game", schema: ExtractionSchema, name: "memory_candidates" });
    expect(out.memories[0].fact).toBe("User is building a Unity game.");
    await expect(jsonFromModel(mk('{"shouldRemember":true,"memories":[],"extra":1}') as never, { system: "x", prompt: "y", schema: ExtractionSchema, name: "n" })).rejects.toBeTruthy();
    await expect(jsonFromModel(mk("not json") as never, { system: "x", prompt: "y", schema: ExtractionSchema, name: "n" })).rejects.toBeTruthy();
  });
});
