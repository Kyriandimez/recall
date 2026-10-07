import "server-only";
import type { NextRequest } from "next/server";
import { cookieAttributes, mintSession, SESSION_COOKIE, verifySession } from "./auth/session";
import { configIssues, getConfig, memoryConfigIssues, networkLabel, type AppConfig } from "./env";
import { GroqProvider } from "./llm/groq";
import type { LLMProvider } from "./llm/provider";
import { getWalrusClient } from "./memory/client";
import { ScopedMemory } from "./memory/scoped";
import { RateLimiter } from "./ratelimit";
import { hashForLog } from "./log";

export const limiter = new RateLimiter();

let provider: LLMProvider | undefined;
export function getProvider(cfg: AppConfig = getConfig()): LLMProvider {
  provider ??= new GroqProvider({ apiKey: cfg.groqApiKey, model: cfg.groqModel });
  return provider;
}

export interface ResolvedSession {
  userId: string;
  /** Present only when a NEW identity was minted (no valid cookie). */
  newCookie?: { name: string; value: string; attrs: ReturnType<typeof cookieAttributes> };
}

/** The ONLY source of userId for the whole server. Nothing from the request body/query/headers can influence it. */
export function resolveSession(req: NextRequest, cfg: AppConfig): ResolvedSession {
  const secret = cfg.authSecret as string;
  const existing = verifySession(req.cookies.get(SESSION_COOKIE)?.value, secret);
  if (existing) return { userId: existing };
  const minted = mintSession(secret);
  return { userId: minted.userId, newCookie: { name: SESSION_COOKIE, value: minted.cookieValue, attrs: cookieAttributes(cfg.isProduction) } };
}

export function memoryFor(userId: string, cfg: AppConfig = getConfig()): ScopedMemory {
  return new ScopedMemory(userId, {
    client: getWalrusClient(cfg),
    memoryEnv: cfg.memoryEnv,
    serverUrlNetwork: networkLabel(cfg.memwalServerUrl),
    tokenSecret: cfg.authSecret as string,
    settings: {
      maxResults: cfg.memory.maxResults,
      maxDistance: cfg.memory.maxDistance,
      recallTimeoutMs: cfg.memory.recallTimeoutMs,
      waitTimeoutMs: cfg.memory.waitTimeoutMs,
      countMaxPages: cfg.memory.countMaxPages,
    },
  });
}

export function clientIp(req: NextRequest): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
}

export function userHash(userId: string, cfg: AppConfig) {
  return hashForLog(userId, cfg.authSecret);
}

export { configIssues, memoryConfigIssues };
