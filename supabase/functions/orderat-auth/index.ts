// Supabase Edge Function entry point for accounts (docs/sme-phase-2-cloud.md's "Accounts").
// Deployed as: npm run hosting:deploy -- orderat-auth (supabase functions deploy orderat-auth --use-api)
// URL: https://ckjmbdbvlbxfofjgqiuj.supabase.co/functions/v1/orderat-auth
//
// Called directly by the iPhone/Android apps, like orderat-ask/orderat-studio (not a Meta webhook),
// and by the browser web app at https://orderatweb.com/app/ — so the handler is wrapped with
// withAppCors (server/shared/cors.ts), which allows the site's origins (and localhost for development)
// and leaves the phones, which send no Origin header, exactly as they were. All the actual logic
// (token verification, session issuing, signout, delete account, and the phone-to-web login's
// pair_start / pair_approve / pair_poll) is the same server/auth/handler.ts a test can exercise
// directly; this file only wires it to real dependencies — the two provider JWKS endpoints, fetched
// with the real global `fetch`, and the allowed audiences from env. See
// supabase/functions/orderat-whatsapp/index.ts for notes on the import layout, --use-api and the
// orderat- / ORDERAT_ prefixing this shares with the other functions.

import { appleKeyConfigFromEnv, createAppleTokenClient } from "../../../server/auth/apple-tokens.ts";
import { createAuthHandler } from "../../../server/auth/handler.ts";
import { createJwksCache } from "../../../server/auth/jwks.ts";
import { APPLE_JWKS_URL, GOOGLE_JWKS_URL, resolveAudiences, withExtraAudience } from "../../../server/auth/providers.ts";
import { withAppCors } from "../../../server/shared/cors.ts";
import { orderatEnv as env } from "../_shared/env.ts";
import { getSqlClient } from "../_shared/db.ts";
import { clientIpSalt } from "../_shared/ip-salt.ts";

const databaseUrl = env("DATABASE_URL") ?? "";
const sql = getSqlClient(databaseUrl);

// One cache per provider, held at module scope so it's reused across every request this isolate
// handles (server/auth/jwks.ts's own reasoning) instead of refetching the JWKS on every signin.
const appleJwks = createJwksCache(APPLE_JWKS_URL);
const googleJwks = createJwksCache(GOOGLE_JWKS_URL);

// docs/sme-phase-2-cloud.md: ORDERAT_APPLE_AUDIENCES and ORDERAT_GOOGLE_AUDIENCES are comma lists.
// Apple's default: the iPhone app's bundle id (com.ams.orderat, the audience of the app's own Sign in
// with Apple tokens) and the website's Services ID (com.ams.orderat.web, created for Sign in with Apple
// on orderatweb.com, the audience of the web app's tokens).
const appleAudiences = resolveAudiences(env("APPLE_AUDIENCES"), ["com.ams.orderat", "com.ams.orderat.web"]);
// Default: the Orderat project's Web OAuth client (Google Cloud project gen-lang-client-0326595565). The
// Android app requests ID tokens with it as serverClientId, so it is the token audience. Client IDs
// are public identifiers, not secrets.
// Always plus the iPhone app's own iOS OAuth client (Google Sign-In on iOS issues ID tokens for it; a
// public id, so built in, whether or not ORDERAT_GOOGLE_AUDIENCES is set), and ORDERAT_GOOGLE_IOS_CLIENT_ID
// if a different iOS client is ever used. Nonce: Google copies the `nonce` it was given into the token
// verbatim, and the server compares the signin body's `nonce` with it unchanged for Google
// (verify-token.ts expectedNonceFor hashes only for Apple). So the body's `nonce` must be exactly the
// value handed to Google: if the app gives Google SHA-256(rawNonce), it sends that hash, not rawNonce.
const GOOGLE_IOS_CLIENT_ID = "799835600648-3anir15lsgs5dqig5vom9pthh85nvjvp.apps.googleusercontent.com";
const googleAudiences = withExtraAudience(
  withExtraAudience(resolveAudiences(env("GOOGLE_AUDIENCES"), ["799835600648-rj4qq9ia615jfob5eg6k4lgop3aq3i6l.apps.googleusercontent.com"]), GOOGLE_IOS_CLIENT_ID),
  env("GOOGLE_IOS_CLIENT_ID"),
);

// The salt pair_start's per-IP rate limit hashes a client IP with, so no row ever holds the IP (the
// same approach as orderat-shop's ORDERAT_SHOP_IP_SALT): ORDERAT_AUTH_IP_SALT, or one derived from the
// database URL (supabase/functions/_shared/ip-salt.ts, shared with the AI functions' per-IP caps).
const ipSalt = await clientIpSalt(databaseUrl);

// Sign in with Apple token revocation on account deletion (App Store Review Guideline 5.1.1(v)):
// ORDERAT_APPLE_TEAM_ID, ORDERAT_APPLE_KEY_ID and ORDERAT_APPLE_PRIVATE_KEY (the Sign in with Apple
// key's .p8 contents). Until all three are set the handler skips it and logs that once per isolate.
const appleKeyConfig = appleKeyConfigFromEnv(env);
// The web app's Sign in with Apple return address (public/orderat/config.js appleRedirectUri on
// orderatweb.com), which Apple wants back when the website's codes are exchanged.
const appleTokens = appleKeyConfig ? createAppleTokenClient(appleKeyConfig, { redirectUris: { "com.ams.orderat.web": "https://orderatweb.com/app/" } }) : undefined;

const handler = withAppCors(createAuthHandler({ sql, appleJwks, googleJwks, appleAudiences, googleAudiences, ipSalt, appleTokens }));

Deno.serve((req) => handler(req));
