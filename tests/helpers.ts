import { MemWalMock } from "@mysten-incubation/memwal";
import { ScopedMemory, type ScopedDeps } from "@/lib/memory/scoped";
import type { WalrusClient } from "@/lib/memory/types";
import type { ChatMsg, LLMProvider, ModelHealth } from "@/lib/llm/provider";

export const USER_A = "a".repeat(32);
export const USER_B = "b".repeat(32);
export const noSleep = async () => {};

export function mockClient(): WalrusClient {
  return MemWalMock.create() as unknown as WalrusClient;
}

export function makeStore(userId = USER_A, client: WalrusClient = mockClient(), over: Partial<ScopedDeps["settings"]> = {}, env = "test") {
  return new ScopedMemory(userId, {
    client,
    memoryEnv: env,
    serverUrlNetwork: "Custom",
    tokenSecret: "t".repeat(40),
    settings: { maxResults: 5, maxDistance: 0.9, recallTimeoutMs: 2000, waitTimeoutMs: 2000, countMaxPages: 5, ...over },
    sleep: noSleep,
  });
}

/** Wraps any client and lets a test inject failures per method. Keeps all other behavior. */
export function flaky(base: WalrusClient, faults: Partial<Record<keyof WalrusClient, (...args: never[]) => unknown>>): WalrusClient {
  return new Proxy(base, {
    get(target, prop: string) {
      const fault = faults[prop as keyof WalrusClient];
      if (fault) return fault;
      const v = (target as unknown as Record<string, unknown>)[prop];
      return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(target) : v;
    },
  });
}

export const httpError = (status: number, message = "x", extra: Record<string, unknown> = {}) =>
  Object.assign(new Error(message), { status, ...extra });

/** Scripted LLM: json() returns what the test dictates and records exactly what it was given. */
export class FakeProvider implements LLMProvider {
  jsonCalls: Array<{ system: string; prompt: string }> = [];
  streamCalls: ChatMsg[][] = [];
  constructor(public jsonResult: unknown = { shouldRemember: false, memories: [] }, public reply = "Hello there.") {}
  info() { return { provider: "Groq", model: "fake", owner: "test", runtime: "test" }; }
  async *stream(req: { messages: ChatMsg[] }) { this.streamCalls.push(req.messages); yield this.reply; }
  async json<T>(req: { system: string; prompt: string; schema: { parse(v: unknown): T } }): Promise<T> {
    this.jsonCalls.push({ system: req.system, prompt: req.prompt });
    return req.schema.parse(this.jsonResult);
  }
  async health(): Promise<ModelHealth> { return { status: "ok" }; }
}

export const candidate = (fact: string, over: Record<string, unknown> = {}) => ({
  fact, kind: "project", confidence: 0.9, durability: "durable", isExplicitCorrection: false, ...over,
});
