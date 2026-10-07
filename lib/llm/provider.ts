import type { z } from "zod";

export interface ChatMsg { role: "system" | "user" | "assistant"; content: string }

export interface ModelHealth {
  /** unconfigured/unavailable = configuration is unhealthy; unknown = transient provider uncertainty; ok = confirmed. */
  status: "ok" | "unavailable" | "unknown" | "unconfigured";
  code?: "GROQ_MODEL_UNAVAILABLE" | "CONFIG_MISSING";
}

export interface ProviderInfo { provider: string; model: string; owner: string; runtime: string }

/** The rest of the app imports only this interface. GroqProvider is the single implementation. */
export interface LLMProvider {
  info(): ProviderInfo;
  stream(req: { messages: ChatMsg[]; signal?: AbortSignal }): AsyncIterable<string>;
  json<T>(req: { system: string; prompt: string; schema: z.ZodType<T>; name: string; signal?: AbortSignal }): Promise<T>;
  /** Catalog check only. Never performs inference. */
  health(): Promise<ModelHealth>;
}
