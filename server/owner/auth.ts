// Protects the owner routes when they are reachable from the public internet (the Supabase Edge
// Function), where there is no "this computer only" IP check like server/dev.ts has for local
// development (see isLocalRequest there, which is unaffected by this file).
//
// A single shared secret, OWNER_KEY: visiting /owner?key=<OWNER_KEY> once sets an HttpOnly,
// Secure, SameSite=Strict cookie so the key never sits in the address bar or browser history
// after that, and every later request (page load or API call) is authorized by that cookie, or by
// an `Authorization: Bearer <OWNER_KEY>` header for programmatic calls. Comparisons are constant
// time so response timing cannot be used to guess the key character by character.

const COOKIE_NAME = "orderat_owner";
const THIRTY_DAYS = 60 * 60 * 24 * 30;

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function cookieValue(header: string | null, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === name) {
      try {
        return decodeURIComponent(part.slice(eq + 1).trim());
      } catch {
        return undefined;
      }
    }
  }
  return undefined;
}

/** True when the request carries `ownerKey`, as the sign-in cookie or as a bearer token. */
export function isAuthorized(req: Request, ownerKey: string): boolean {
  const auth = req.headers.get("authorization");
  if (auth?.startsWith("Bearer ") && timingSafeEqual(auth.slice("Bearer ".length), ownerKey)) return true;
  const cookie = cookieValue(req.headers.get("cookie"), COOKIE_NAME);
  return cookie !== undefined && timingSafeEqual(cookie, ownerKey);
}

/** True when `candidate` (e.g. a ?key= query parameter) matches the owner key. */
export function isOwnerKey(candidate: string, ownerKey: string): boolean {
  return timingSafeEqual(candidate, ownerKey);
}

/**
 * True only when the request carries `ownerKey` as an `Authorization: Bearer` header — no cookie
 * fallback. Used for the hosted Edge Function (withOwnerBearerAuth below), which is reachable
 * cross-origin: a cookie set from one origin (the static owner page) is never sent to another
 * (*.supabase.co) without `Access-Control-Allow-Credentials`, which server/owner/cors.ts deliberately
 * never sends, so cookie sign-in has no way to work there anyway.
 */
export function isBearerAuthorized(req: Request, ownerKey: string): boolean {
  const auth = req.headers.get("authorization");
  return auth?.startsWith("Bearer ") === true && timingSafeEqual(auth.slice("Bearer ".length), ownerKey);
}

/** Sets the sign-in cookie and redirects to `redirectTo` (the same path, without the key in it). */
export function signInResponse(key: string, redirectTo: string): Response {
  const cookie = [
    `${COOKIE_NAME}=${encodeURIComponent(key)}`,
    "Path=/",
    "HttpOnly",
    "Secure",
    "SameSite=Strict",
    `Max-Age=${THIRTY_DAYS}`,
  ].join("; ");
  return new Response(null, { status: 302, headers: { Location: redirectTo, "set-cookie": cookie } });
}

// Functions, not shared constants: a Response body can be read only once, so every request needs its own.
const ownerKeyNotConfigured = () => new Response("Owner access is not configured (OWNER_KEY is not set).", { status: 500 });
const unauthorized = () => new Response("Unauthorized", { status: 401 });

// JSON counterparts for withOwnerBearerAuth: the hosted function is JSON-only (see README "Hosting"),
// so its error responses stay JSON too, instead of the plain text withOwnerAuth above returns.
const jsonError = (message: string, status: number) =>
  new Response(JSON.stringify({ error: message }), { status, headers: { "content-type": "application/json; charset=utf-8" } });
const ownerKeyNotConfiguredJson = () => jsonError("Owner access is not configured (OWNER_KEY is not set).", 500);
const unauthorizedJson = () => jsonError("Unauthorized", 401);

/**
 * Wraps an owner request handler with OWNER_KEY protection: `?key=...` signs in (sets the cookie
 * and redirects), everything else needs the cookie or a Bearer header, and requests are refused
 * outright when OWNER_KEY itself is not set, rather than silently letting everyone in.
 */
export function withOwnerAuth(ownerKey: string | undefined, handler: (req: Request) => Promise<Response>): (req: Request) => Promise<Response> {
  return async (req) => {
    if (!ownerKey) return ownerKeyNotConfigured();
    const url = new URL(req.url);
    const keyParam = url.searchParams.get("key");
    if (req.method === "GET" && keyParam !== null) {
      if (!isOwnerKey(keyParam, ownerKey)) return unauthorized();
      url.searchParams.delete("key");
      return signInResponse(keyParam, url.pathname + (url.search ? url.search : ""));
    }
    if (!isAuthorized(req, ownerKey)) return unauthorized();
    return handler(req);
  };
}

/**
 * Bearer-only counterpart to withOwnerAuth, for the hosted Edge Function: no `?key=` sign-in
 * redirect, no cookie, every request needs `Authorization: Bearer <OWNER_KEY>`. withOwnerAuth above
 * is untouched and still exactly what server/dev.ts uses for the local, cookie-based sign-in flow.
 */
export function withOwnerBearerAuth(ownerKey: string | undefined, handler: (req: Request) => Promise<Response>): (req: Request) => Promise<Response> {
  return async (req) => {
    if (!ownerKey) return ownerKeyNotConfiguredJson();
    if (!isBearerAuthorized(req, ownerKey)) return unauthorizedJson();
    return handler(req);
  };
}
