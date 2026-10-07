import "server-only";

/** Mainnet relayer (verified in docs + SDK default). */
export const MAINNET_RELAYER = "https://relayer.memory.walrus.xyz";

export interface AppConfig {
  groqApiKey: string | undefined;
  groqModel: string | undefined;
  memwalPrivateKey: string | undefined;
  memwalAccountId: string | undefined;
  memwalServerUrl: string;
  memoryEnv: string;
  authSecret: string | undefined;
  adminToken: string | undefined;
  privacyContact: string | undefined;
  isProduction: boolean;
  debugContent: boolean;
  memory: {
    maxResults: number;
    maxDistance: number;
    dedupeDistance: number;
    minConfidence: number;
    maxTokens: number;
    contextMaxChars: number;
    recallTimeoutMs: number;
    waitTimeoutMs: number;
    countMaxPages: number;
  };
  limits: {
    maxUserMessageChars: number;
    maxExtractionInputChars: number;
    maxHistoryTurns: number;
    maxHistoryChars: number;
    maxBodyBytes: number;
  };
}

function num(env: Record<string, string | undefined>, key: string, fallback: number): number {
  const raw = env[key];
  if (raw === undefined || raw.trim() === "") return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function str(env: Record<string, string | undefined>, key: string): string | undefined {
  const v = env[key]?.trim();
  return v ? v : undefined;
}

export function loadConfig(env: Record<string, string | undefined> = process.env): AppConfig {
  const isProduction = env.NODE_ENV === "production";
  return {
    groqApiKey: str(env, "GROQ_API_KEY"),
    // Deliberately NO default here: a missing GROQ_MODEL is a configuration failure (GROQ_MODEL_UNAVAILABLE).
    groqModel: str(env, "GROQ_MODEL"),
    memwalPrivateKey: str(env, "MEMWAL_PRIVATE_KEY"),
    memwalAccountId: str(env, "MEMWAL_ACCOUNT_ID"),
    memwalServerUrl: str(env, "MEMWAL_SERVER_URL") ?? MAINNET_RELAYER,
    memoryEnv: str(env, "MEMORY_ENV") ?? "dev",
    authSecret: str(env, "AUTH_SECRET"),
    adminToken: str(env, "ADMIN_TOKEN"),
    privacyContact: str(env, "PRIVACY_CONTACT"),
    isProduction,
    debugContent: !isProduction && str(env, "DEBUG_LOG_CONTENT") === "1",
    memory: {
      maxResults: Math.floor(num(env, "MEMORY_MAX_RESULTS", 5)),
      maxDistance: num(env, "MEMORY_MAX_DISTANCE", 0.55), // UNTUNED starting point
      dedupeDistance: num(env, "MEMORY_DEDUPE_DISTANCE", 0.2), // UNTUNED starting point
      minConfidence: num(env, "MEMORY_MIN_CONFIDENCE", 0.7),
      maxTokens: Math.floor(num(env, "MEMORY_MAX_TOKENS", 600)),
      contextMaxChars: Math.floor(num(env, "MEMORY_CONTEXT_MAX_CHARS", 2400)),
      recallTimeoutMs: Math.floor(num(env, "MEMORY_RECALL_TIMEOUT_MS", 8000)),
      waitTimeoutMs: Math.floor(num(env, "MEMORY_WAIT_TIMEOUT_MS", 30000)),
      countMaxPages: Math.floor(num(env, "MEMORY_COUNT_MAX_PAGES", 5)),
    },
    limits: {
      maxUserMessageChars: Math.floor(num(env, "MAX_USER_MESSAGE_CHARS", 4000)),
      maxExtractionInputChars: Math.floor(num(env, "MAX_EXTRACTION_INPUT_CHARS", 2000)),
      maxHistoryTurns: Math.floor(num(env, "MAX_HISTORY_TURNS", 12)),
      maxHistoryChars: Math.floor(num(env, "MAX_HISTORY_CHARS", 12000)),
      maxBodyBytes: Math.floor(num(env, "MAX_BODY_BYTES", 65536)),
    },
  };
}

export type ConfigIssue = { key: string; problem: string };

/** Names of missing/invalid settings only. Never values. */
export function configIssues(cfg: AppConfig): ConfigIssue[] {
  const issues: ConfigIssue[] = [];
  if (!cfg.authSecret || cfg.authSecret.length < 32) issues.push({ key: "AUTH_SECRET", problem: "missing or shorter than 32 characters" });
  if (!cfg.groqApiKey) issues.push({ key: "GROQ_API_KEY", problem: "missing" });
  if (!cfg.groqModel) issues.push({ key: "GROQ_MODEL", problem: "missing" });
  if (!cfg.memwalPrivateKey) issues.push({ key: "MEMWAL_PRIVATE_KEY", problem: "missing" });
  if (!cfg.memwalAccountId) issues.push({ key: "MEMWAL_ACCOUNT_ID", problem: "missing" });
  if (cfg.isProduction && /staging/i.test(cfg.memwalServerUrl)) {
    issues.push({ key: "MEMWAL_SERVER_URL", problem: "points at the staging relayer in production" });
  }
  return issues;
}

export function memoryConfigIssues(cfg: AppConfig): ConfigIssue[] {
  return configIssues(cfg).filter((i) =>
    ["AUTH_SECRET", "MEMWAL_PRIVATE_KEY", "MEMWAL_ACCOUNT_ID", "MEMWAL_SERVER_URL"].includes(i.key),
  );
}

export function networkLabel(url: string): "Mainnet" | "Staging" | "Custom" {
  try {
    const host = new URL(url).host;
    if (host === "relayer.memory.walrus.xyz") return "Mainnet";
    if (/staging/i.test(host)) return "Staging";
  } catch {
    /* fallthrough */
  }
  return "Custom";
}

let cached: AppConfig | undefined;
export function getConfig(): AppConfig {
  cached ??= loadConfig();
  return cached;
}
