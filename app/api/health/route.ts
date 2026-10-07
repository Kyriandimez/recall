import { NextResponse, type NextRequest } from "next/server";
import { configIssues, getConfig, networkLabel } from "@/lib/env";
import { getWalrusClient } from "@/lib/memory/client";
import { probeMemoryHealth } from "@/lib/memory/scoped";
import { clientIp, getProvider, limiter } from "@/lib/server";
import { LIMITS } from "@/lib/ratelimit";

export const runtime = "nodejs";

/** Configuration + catalog-level status only. NO inference call is made here (see scripts/verify-groq.ts). */
export async function GET(req: NextRequest) {
  const cfg = getConfig();
  if (limiter.check(`health:${clientIp(req)}`, LIMITS.read.limit, LIMITS.read.windowMs)) {
    return NextResponse.json({ ok: false, code: "RATE_LIMITED" }, { status: 429 });
  }
  const issues = configIssues(cfg);
  const network = networkLabel(cfg.memwalServerUrl);
  const provider = getProvider(cfg);
  const info = provider.info();

  const memIssues = issues.filter((i) => ["MEMWAL_PRIVATE_KEY", "MEMWAL_ACCOUNT_ID", "MEMWAL_SERVER_URL"].includes(i.key));
  const memory = memIssues.length
    ? { status: "unconfigured" as const, network, writeReady: null, relayerVersion: null }
    : await probeMemoryHealth(getWalrusClient(cfg), network);
  const model = await provider.health();

  return NextResponse.json(
    {
      ok: issues.length === 0 && memory.status === "ok" && model.status !== "unavailable" && model.status !== "unconfigured",
      memory,
      model: { provider: info.provider, id: info.model, owner: info.owner, runtime: info.runtime, status: model.status, code: model.code },
      configIssues: issues, // setting NAMES and problems only, never values
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
