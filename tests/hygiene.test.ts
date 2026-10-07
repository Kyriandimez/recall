import { describe, expect, it } from "vitest";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const walk = (dir: string, out: string[] = []): string[] => {
  for (const e of readdirSync(dir)) {
    if (["node_modules", ".next", ".git"].includes(e)) continue;
    const p = path.join(dir, e);
    statSync(p).isDirectory() ? walk(p, out) : out.push(p);
  }
  return out;
};
const src = ["app", "lib", "components", "scripts"].flatMap((d) => walk(d)).filter((f) => /\.(ts|tsx)$/.test(f));
const text = (f: string) => readFileSync(f, "utf8");
const pkg = JSON.parse(readFileSync("package.json", "utf8"));

describe("dependency and architecture hygiene", () => {
  it("MemWal is pinned to an exact version (no ^ ~ latest)", () => {
    expect(pkg.dependencies["@mysten-incubation/memwal"]).toBe("0.1.8");
    for (const [n, v] of Object.entries<string>({ ...pkg.dependencies, ...pkg.devDependencies })) expect(v, n).toMatch(/^\d+\.\d+\.\d+$/);
  });
  it("the deployed app has no Anthropic/OpenAI SDK or provider", () => {
    const all = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies }).join(" ");
    expect(all).not.toMatch(/anthropic|openai/i);
    for (const f of src) expect(text(f), f).not.toMatch(/from ["'](?:@anthropic-ai|openai|@ai-sdk\/(?:openai|anthropic))/);
  });
  it("withMemWal is never used (explicit SDK only)", () => {
    for (const f of src) expect(text(f), f).not.toMatch(/withMemWal|memwal\/ai/);
  });
  it("analyze() is never called in production code (extraction is custom, output-vetted)", () => {
    for (const f of src.filter((x) => !x.startsWith("scripts"))) expect(text(f), f).not.toMatch(/\.analyze(?:AndWait)?\(/);
  });
  it("MemoryStore / ScopedMemory expose no destructive API and the app never calls one", () => {
    const types = text("lib/memory/types.ts");
    const iface = types.slice(types.indexOf("export interface MemoryStore"), types.indexOf("/** The narrow slice"));
    expect(iface).not.toMatch(/\b(?:delete|forget|clear|remove|wipe)\s*\(/);
    for (const f of src) expect(text(f), f).not.toMatch(/client\.(?:forget|clear|delete\w*|remove\w*)\s*\(|deleteMemor\w*\(|api\/forget|MemWalMock/);
  });
  it("no NEXT_PUBLIC_ env vars anywhere", () => {
    for (const f of src) expect(text(f), f).not.toMatch(/NEXT_PUBLIC_/);
  });
  it("client components never import server-only modules", () => {
    for (const f of src.filter((x) => x.startsWith("components"))) {
      expect(text(f), f).not.toMatch(/from ["']@\/lib\/(?:server|env|memory\/client|llm\/groq|auth)/);
    }
  });
  it("secret-bearing modules are marked server-only", () => {
    for (const f of ["lib/env.ts", "lib/server.ts", "lib/memory/client.ts"]) expect(text(f)).toMatch(/import "server-only"/);
  });
  it("the extractor module cannot write: no store/SDK import", () => {
    const t = text("lib/memory/extract.ts");
    expect(t).not.toMatch(/from ["'][^"']*(?:memory\/(?:scoped|client|types)|@mysten-incubation)/);
    expect(t).not.toMatch(/MemoryStore|\.(?:save|remember\w*)\s*\(/);
  });
  it("the chat route never touches counting/enumeration", () => {
    expect(text("app/api/chat/route.ts")).not.toMatch(/listNamespaces|\.count\(|memory\/count/);
  });
});

describe("built client bundle contains no secrets (runs when .next exists)", () => {
  it("static assets have no key material or server env var names", () => {
    if (!existsSync(".next/static")) return;
    for (const f of walk(".next/static").filter((x) => /\.(js|css|html|json)$/.test(x))) {
      expect(text(f), f).not.toMatch(/gsk_[A-Za-z0-9]{10,}|suiprivkey1|MEMWAL_PRIVATE_KEY|GROQ_API_KEY|AUTH_SECRET/);
    }
  });
});
