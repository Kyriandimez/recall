import { NextResponse, type NextRequest } from "next/server";
import { getConfig, memoryConfigIssues } from "@/lib/env";
import { LIMITS } from "@/lib/ratelimit";
import { limiter, memoryFor, resolveSession } from "@/lib/server";

export const runtime = "nodejs";

/** `jobId` here is an opaque user-bound token (not a raw relayer job ID). Another user's token fails verification. */
export async function GET(req: NextRequest, ctx: { params: Promise<{ jobId: string }> }) {
  const cfg = getConfig();
  if (memoryConfigIssues(cfg).length) return NextResponse.json({ state: "unknown", blobId: null }, { status: 200 });
  const session = resolveSession(req, cfg);
  if (limiter.check(`status:${session.userId}`, LIMITS.read.limit * 3, LIMITS.read.windowMs)) {
    return NextResponse.json({ state: "unknown", blobId: null }, { status: 429 });
  }
  const { jobId } = await ctx.params;
  const out = await memoryFor(session.userId, cfg).status(decodeURIComponent(jobId).slice(0, 200));
  const res = NextResponse.json(out, { headers: { "Cache-Control": "no-store" } });
  if (session.newCookie) res.cookies.set(session.newCookie.name, session.newCookie.value, session.newCookie.attrs);
  return res;
}
