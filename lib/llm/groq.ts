import { createGroq } from "@ai-sdk/groq";
import { Output, generateText, streamText, type LanguageModel } from "ai";
import type { z } from "zod";
import type { LLMProvider, ChatMsg, ModelHealth, ProviderInfo } from "./provider";
import { ThinkStripper } from "./think";

const CATALOG_URL = "https://api.groq.com/openai/v1/models";

export interface GroqOptions {
  apiKey: string | undefined;
  model: string | undefined;
  fetchImpl?: typeof fetch;
}

export class GroqProvider implements LLMProvider {
  readonly #apiKey: string | undefined;
  readonly #model: string | undefined;
  readonly #fetch: typeof fetch;

  constructor(o: GroqOptions) {
    this.#apiKey = o.apiKey;
    this.#model = o.model;
    this.#fetch = o.fetchImpl ?? fetch;
  }

  info(): ProviderInfo {
    return { provider: "Groq", model: this.#model ?? "(not configured)", owner: ownerOf(this.#model), runtime: "Groq LPU inference via Vercel AI SDK" };
  }

  #model_() {
    if (!this.#apiKey || !this.#model) throw Object.assign(new Error("config"), { status: 404 });
    return createGroq({ apiKey: this.#apiKey })(this.#model);
  }

  stream(req: { messages: ChatMsg[]; signal?: AbortSignal }): AsyncIterable<string> {
    return streamFromModel(this.#model_(), req.messages, req.signal);
  }

  async json<T>(req: { system: string; prompt: string; schema: z.ZodType<T>; name: string; signal?: AbortSignal }): Promise<T> {
    return jsonFromModel(this.#model_(), req);
  }

  /**
   * Catalog lookup only (no inference). Semantics:
   *  - missing key/model -> unconfigured (GROQ_MODEL_UNAVAILABLE / CONFIG_MISSING)
   *  - catalog says the model is absent -> unavailable (GROQ_MODEL_UNAVAILABLE)
   *  - transient failure (timeout/network/5xx/429) -> unknown (app keeps serving)
   */
  async health(): Promise<ModelHealth> {
    if (!this.#model) return { status: "unconfigured", code: "GROQ_MODEL_UNAVAILABLE" };
    if (!this.#apiKey) return { status: "unconfigured", code: "CONFIG_MISSING" };
    try {
      const res = await this.#fetch(CATALOG_URL, {
        headers: { Authorization: `Bearer ${this.#apiKey}` },
        signal: AbortSignal.timeout(3000),
      });
      if (res.status === 401 || res.status === 403) return { status: "unconfigured", code: "CONFIG_MISSING" };
      if (!res.ok) return { status: "unknown" }; // 429 / 5xx / other: not proof of a bad configuration
      const body = (await res.json()) as { data?: Array<{ id?: string }> };
      if (!Array.isArray(body.data)) return { status: "unknown" };
      return body.data.some((m) => m.id === this.#model) ? { status: "ok" } : { status: "unavailable", code: "GROQ_MODEL_UNAVAILABLE" };
    } catch {
      return { status: "unknown" };
    }
  }
}

function ownerOf(model: string | undefined): string {
  if (!model) return "unknown";
  if (model.startsWith("qwen/")) return "Alibaba Cloud (Qwen)";
  if (model.startsWith("meta-llama/") || model.startsWith("llama")) return "Meta";
  return model.includes("/") ? model.split("/")[0] : "unknown";
}

/**
 * AI SDK v7 REJECTS system messages inside `messages` ("Use the instructions option instead"),
 * so system content is split out and passed as `instructions`. (Found by running the real SDK, not by mocks.)
 */
export function splitSystem(messages: readonly ChatMsg[]): { instructions: string | undefined; rest: Array<{ role: "user" | "assistant"; content: string }> } {
  const sys = messages.filter((m) => m.role === "system").map((m) => m.content);
  const rest = messages.filter((m): m is ChatMsg & { role: "user" | "assistant" } => m.role !== "system").map((m) => ({ role: m.role, content: m.content }));
  return { instructions: sys.length ? sys.join("\n\n") : undefined, rest };
}

export async function* streamFromModel(model: LanguageModel, messages: readonly ChatMsg[], signal?: AbortSignal): AsyncIterable<string> {
  const { instructions, rest } = splitSystem(messages);
  const result = streamText({
    model,
    instructions,
    messages: rest,
    abortSignal: signal,
    temperature: 0.6,
    maxOutputTokens: 1500,
    maxRetries: 0, // retries are handled by our operation-aware policy
    // The SDK's default onError console-logs the raw error object (including provider response bodies).
    // Errors are surfaced to us via fullStream and normalized there; nothing raw may reach the logs.
    onError: () => {},
  });
  const strip = new ThinkStripper();
  for await (const part of result.fullStream) {
    if (part.type === "error") throw part.error;
    if (part.type === "text-delta") {
      const text = strip.feed(part.text);
      if (text) yield text;
    }
  }
  const tail = strip.flush();
  if (tail) yield tail;
}

export async function jsonFromModel<T>(
  model: LanguageModel,
  req: { system: string; prompt: string; schema: z.ZodType<T>; name: string; signal?: AbortSignal },
): Promise<T> {
  const res = await generateText({
    model,
    instructions: req.system, // AI SDK v7: `system` is deprecated in favor of `instructions`
    prompt: req.prompt,
    output: Output.object({ schema: req.schema, name: req.name }),
    temperature: 0,
    maxOutputTokens: 700,
    maxRetries: 0,
    abortSignal: req.signal,
    providerOptions: { groq: { structuredOutputs: true } },
  });
  return req.schema.parse(res.output);
}
