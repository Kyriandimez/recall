import { NextResponse, type NextRequest } from "next/server";
import { getConfig } from "@/lib/env";
import { publicError } from "@/lib/errors";
import { resolveSession } from "@/lib/server";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const cfg = getConfig();
  if (!cfg.authSecret || cfg.authSecret.length < 32) return NextResponse.json(publicError("CONFIG_MISSING"), { status: 503 });
  const s = resolveSession(req, cfg);
  // Display-only truncated label; the full namespace/userId is never sent to the browser.
  const namespaceLabel = `chatbot-${cfg.memoryEnv}:${s.userId.slice(0, 4)}…`;
  const res = NextResponse.json({ ok: true, newIdentity: Boolean(s.newCookie), namespaceLabel });
  if (s.newCookie) res.cookies.set(s.newCookie.name, s.newCookie.value, s.newCookie.attrs);
  res.headers.set("Cache-Control", "no-store");
  return res;
}
