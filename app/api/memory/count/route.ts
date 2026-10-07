import { NextResponse, type NextRequest } from "next/server";
import { getConfig, memoryConfigIssues } from "@/lib/env";
import { memoryFor, resolveSession } from "@/lib/server";

export const runtime = "nodejs";

/** Secondary metadata. The chat route never imports or calls this. Failure => { status: "unavailable" }. */
export async function GET(req: NextRequest) {
  const cfg = getConfig();
  if (memoryConfigIssues(cfg).length) return NextResponse.json({ status: "unavailable" }, { status: 200 });
  const session = resolveSession(req, cfg);
  const out = await memoryFor(session.userId, cfg).count();
  const res = NextResponse.json(out, { headers: { "Cache-Control": "no-store" } });
  if (session.newCookie) res.cookies.set(session.newCookie.name, session.newCookie.value, session.newCookie.attrs);
  return res;
}
