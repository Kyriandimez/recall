import "server-only";
import { MemWal } from "@mysten-incubation/memwal";
import type { AppConfig } from "../env";
import type { WalrusClient } from "./types";

let singleton: WalrusClient | undefined;

/** The ONLY place the delegate key is used. `serverUrl` is always passed explicitly (never the SDK default). */
export function getWalrusClient(cfg: AppConfig): WalrusClient {
  if (!cfg.memwalPrivateKey || !cfg.memwalAccountId) {
    throw new Error("MEMWAL_NOT_CONFIGURED");
  }

  singleton ??= MemWal.create({
    key: cfg.memwalPrivateKey,
    accountId: cfg.memwalAccountId,
    serverUrl: cfg.memwalServerUrl,
    requestTimeoutMs: 20_000,
  }) as unknown as WalrusClient;

  return singleton;
}
