// Extra, local-only defenses for the owner routes in server/dev.ts, on top of the OWNER_KEY auth
// that server/owner/auth.ts already enforces everywhere (including here).

import type { IncomingMessage } from "node:http";

/** Minimal shape of a Node request `isLocalRequest` needs, so it can be unit tested without a real socket. */
export interface LocalRequestLike {
  socket: { remoteAddress?: string };
  headers: Record<string, string | string[] | undefined>;
}

/**
 * True for requests arriving on the loopback interface with no Cloudflare tunnel headers. This is
 * an extra layer, not the access control itself: a tunnel that isn't Cloudflare (or a misconfigured
 * one) can still look "local" here, which is exactly why OWNER_KEY auth is required as well.
 */
export function isLocalRequest(req: LocalRequestLike | IncomingMessage): boolean {
  const addr = req.socket.remoteAddress ?? "";
  const loopback = addr === "127.0.0.1" || addr === "::1" || addr === "::ffff:127.0.0.1";
  return loopback && !req.headers["cf-connecting-ip"] && !req.headers["cf-ray"];
}

/**
 * Resolves the OWNER_KEY to use for this run. If one is already configured, it's used as-is
 * (`generated: false`). Otherwise a random one is generated for this process only (`generated:
 * true`), so local dev is never left without owner auth just because .env.local has no OWNER_KEY.
 */
export function resolveOwnerKey(configured: string | undefined, generate: () => string = () => crypto.randomUUID()): { key: string; generated: boolean } {
  return configured ? { key: configured, generated: false } : { key: generate(), generated: true };
}
