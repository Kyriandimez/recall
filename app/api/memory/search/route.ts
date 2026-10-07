import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getConfig, memoryConfigIssues } from "@/lib/env";
import { publicError } from "@/lib/errors";
import { LIMITS } from "@/lib/ratelimit";
import { clientIp, limiter, memoryFor, resolveSession } from "@/lib/server";

export const runtime = "nodejs";

const Body = z.object({ query: z.string().trim().max(200).optional(), mode: z.enum(["search", "recent"]).default("search") }).strict();

export async function POST(req: NextRequest) {
  const cfg = getConfig();
  if (memoryConfigIssues(cfg).length) return NextResponse.json(publicError("CONFIG_MISSING"), { status: 503 });
  const text = await req.text();
  if (text.length > 2048) return NextResponse.json(publicError("PAYLOAD_TOO_LARGE"), { status: 413 });
  let parsed;
  try { parsed = Body.parse(JSON.parse(text || "{}")); } catch { return NextResponse.json(publicError("INVALID_REQUEST"), { status: 400 }); }

  const session = resolveSession(req, cfg);
  const wait = Math.max(
    limiter.check(`search:${session.userId}`, LIMITS.read.limit, LIMITS.read.windowMs),
    limiter.check(`searchip:${clientIp(req)}`, LIMITS.read.limit * 2, LIMITS.read.windowMs),
  );
  if (wait) return NextResponse.json(publicError("RATE_LIMITED", wait), { status: 429 });

  const store = memoryFor(session.userId, cfg);
  const recent = parsed.mode === "recent" || !parsed.query;
  // Semantic recall is a search tool, not an enumeration mechanism: results are labelled "matches, not a complete list".
  const out = await store.recall(recent ? "facts about the user" : (parsed.query as string), {
    limit: 8,
    sort: recent ? "recent" : "relevance",
    maxDistance: recent ? Math.max(cfg.memory.maxDistance, 0.8) : cfg.memory.maxDistance,
  });
  const res = NextResponse.json({
    status: out.status,
    mode: recent ? "recent" : "search",
    droppedCount: out.droppedCount,
    memories: out.memories,
    ...(out.errorCode ? { error: publicError(out.errorCode) } : {}),
  }, { headers: { "Cache-Control": "no-store" } });
  if (session.newCookie) res.cookies.set(session.newCookie.name, session.newCookie.value, session.newCookie.attrs);
  return res;
}
