import { describe, expect, it } from "vitest";
import { detectSecret } from "@/lib/memory/secrets";

describe("secret filter (best-effort, deterministic)", () => {
  const secrets: Record<string, string> = {
    "api key": "my api key is sk-abcdefghijklmnopqrstuv123456",
    "groq key": "use gsk_abcdefghijklmnopqrstuvwxyz1234",
    password: "my password is hunter2hunter2",
    jwt: "token eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdefghijklmnop",
    "private key": "-----BEGIN PRIVATE KEY-----\nMIIE",
    "sui key": "suiprivkey1qzabcdefghijklmnopqrstuvwxyz0123456789abcdefghijk",
    "seed phrase": "my seed phrase is abandon ability able about above absent absorb abstract absurd abuse access accident",
    bearer: "Authorization: Bearer abcdefghijklmnop1234567890",
    card: "my card is 4242 4242 4242 4242",
    cvv: "cvv is 123",
    recovery: "my recovery code is ABCD-1234-EFGH",
    github: "ghp_abcdefghijklmnopqrstuvwxyz0123456789",
    aws: "AKIAIOSFODNN7EXAMPLE",
  };
  it.each(Object.entries(secrets))("rejects %s", (_k, text) => expect(detectSecret(text).matched).toBe(true));

  const ordinary = [
    "I was born on 1994-03-12", "my order number is 123456789", "call me on 08012345678", "I have 3 cats and 2 dogs",
    "My favorite language is Rust.", "I live at number 4242", "the year 2026 is great", "1234 5678 9012 3456", // non-Luhn
    "I'm building a game in Unity",
  ];
  it.each(ordinary)("does NOT block ordinary value %j", (t) => expect(detectSecret(t).matched).toBe(false));
});
