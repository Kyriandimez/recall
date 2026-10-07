import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Anonymous, server-issued identity. Cookie value = `${userId}.${expiresAtSec}.${HMAC}`.
 * The client can neither choose nor edit its userId; any edit fails the HMAC check.
 * Clearing the cookie creates a NEW memory identity (documented limitation).
 */
export const SESSION_COOKIE = "recall_session";
export const SESSION_TTL_SECONDS = 180 * 24 * 3600;

const ID_RE = /^[a-f0-9]{32}$/;

function sign(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(`session:${payload}`).digest("base64url");
}

export function mintSession(secret: string, now = Date.now()): { userId: string; cookieValue: string } {
  if (!secret || secret.length < 32) throw new Error("AUTH_SECRET too short");
  const userId = randomBytes(16).toString("hex"); // 128-bit CSPRNG
  const exp = Math.floor(now / 1000) + SESSION_TTL_SECONDS;
  const payload = `${userId}.${exp}`;
  return { userId, cookieValue: `${payload}.${sign(payload, secret)}` };
}

/** Returns the verified userId, or null for anything missing/malformed/tampered/expired. */
export function verifySession(cookieValue: string | undefined, secret: string, now = Date.now()): string | null {
  if (!cookieValue || !secret) return null;
  const parts = cookieValue.split(".");
  if (parts.length !== 3) return null;
  const [userId, expStr, sig] = parts;
  if (!ID_RE.test(userId) || !/^\d{1,12}$/.test(expStr)) return null;
  const expected = sign(`${userId}.${expStr}`, secret);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  if (Number(expStr) * 1000 < now) return null;
  return userId;
}

export function cookieAttributes(isProduction: boolean) {
  return {
    httpOnly: true,
    secure: isProduction,
    sameSite: "lax" as const,
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  };
}
