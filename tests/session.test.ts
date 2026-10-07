import { describe, expect, it } from "vitest";
import { mintSession, verifySession } from "@/lib/auth/session";

const SECRET = "s".repeat(40);

describe("anonymous signed session", () => {
  it("round-trips a server-minted identity", () => {
    const { userId, cookieValue } = mintSession(SECRET);
    expect(userId).toMatch(/^[a-f0-9]{32}$/);
    expect(verifySession(cookieValue, SECRET)).toBe(userId);
  });
  it("rejects a tampered userId (impersonation attempt)", () => {
    const { cookieValue } = mintSession(SECRET);
    const [, exp, sig] = cookieValue.split(".");
    expect(verifySession(`${"c".repeat(32)}.${exp}.${sig}`, SECRET)).toBeNull();
  });
  it("rejects a forged signature, wrong secret, malformed and expired cookies", () => {
    const { cookieValue } = mintSession(SECRET);
    expect(verifySession(cookieValue.slice(0, -2) + "xx", SECRET)).toBeNull();
    expect(verifySession(cookieValue, "z".repeat(40))).toBeNull();
    expect(verifySession("garbage", SECRET)).toBeNull();
    expect(verifySession(undefined, SECRET)).toBeNull();
    const old = mintSession(SECRET, Date.now() - 400 * 24 * 3600 * 1000);
    expect(verifySession(old.cookieValue, SECRET)).toBeNull();
  });
  it("refuses a short secret", () => expect(() => mintSession("short")).toThrow());
});
