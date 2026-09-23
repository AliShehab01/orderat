// Webhook security checks for the WhatsApp Cloud API.
// Uses Web Crypto so the same code runs in Node, Deno (Supabase Edge) and Vercel.

const encoder = new TextEncoder();

/** Meta's subscription handshake: echo hub.challenge only when the verify token matches. */
export function verifySubscription(url: URL, verifyToken: string): string | null {
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");
  if (mode === "subscribe" && token === verifyToken && challenge) return challenge;
  return null;
}

async function hmacHex(body: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(body)));
  return Array.from(sig, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Builds the X-Hub-Signature-256 header value Meta sends for a body. Used by tests and local tools. */
export async function signBody(body: string, secret: string): Promise<string> {
  return `sha256=${await hmacHex(body, secret)}`;
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** True when the header is a valid HMAC-SHA256 of the raw body with the app secret. */
export async function verifySignature(rawBody: string, header: string | null, appSecret: string): Promise<boolean> {
  if (!header || !header.startsWith("sha256=")) return false;
  const expected = await hmacHex(rawBody, appSecret);
  return constantTimeEqual(expected, header.slice("sha256=".length).toLowerCase());
}
