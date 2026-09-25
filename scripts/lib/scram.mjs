// Computes a Postgres SCRAM-SHA-256 password verifier locally (RFC 7677 / RFC 5802's algorithm),
// so scripts/hosting-db-user.mjs can set orderat_app's login password without the plaintext ever
// leaving this process — not sent to Supabase, not written to the temp SQL file `supabase db query
// -f` runs, and not left in any log. Postgres accepts this exact string as a pre-hashed password:
// `ALTER ROLE name PASSWORD '<verifier>'` stores it as-is when it already has the
// "SCRAM-SHA-256$<iterations>:<salt>$<StoredKey>:<ServerKey>" shape, instead of hashing whatever it
// was given.
//
// Correctness: buildScramSha256Verifier is a pure function of (password, salt, iterations) — no
// randomness — which is what makes it unit-testable against a known-good vector. scram.test.mjs
// checks it against a verifier Postgres itself produced (via PGlite, a real Postgres, from
// `CREATE ROLE ... PASSWORD 'pencil'`), using that same real verifier's own salt and iteration
// count as input, and asserting a byte-for-byte match on the StoredKey/ServerKey Postgres computed
// — proof this reimplementation matches Postgres's own algorithm, not just RFC 7677's example
// exchange (which doesn't publish StoredKey/ServerKey directly, only a transcript they're derived
// from).

import { createHash, createHmac, pbkdf2Sync, randomBytes } from "node:crypto";

// Postgres's own default (password_encryption=scram-sha-256) iteration count as of PG 14+.
export const DEFAULT_ITERATIONS = 4096;

function hmacSha256(key, data) {
  return createHmac("sha256", key).update(data).digest();
}

function sha256(data) {
  return createHash("sha256").update(data).digest();
}

/**
 * Builds the verifier string for a given (password, salt, iterations) triple. Deterministic — the
 * same three inputs always produce the same output — which is what scram.test.mjs relies on.
 *
 * @param {string} password
 * @param {Buffer} salt
 * @param {number} [iterations]
 * @returns {string} "SCRAM-SHA-256$<iterations>:<salt base64>$<StoredKey base64>:<ServerKey base64>"
 */
export function buildScramSha256Verifier(password, salt, iterations = DEFAULT_ITERATIONS) {
  const saltedPassword = pbkdf2Sync(password, salt, iterations, 32, "sha256");
  const clientKey = hmacSha256(saltedPassword, "Client Key");
  const storedKey = sha256(clientKey);
  const serverKey = hmacSha256(saltedPassword, "Server Key");
  return `SCRAM-SHA-256$${iterations}:${salt.toString("base64")}$${storedKey.toString("base64")}:${serverKey.toString("base64")}`;
}

/** What scripts/hosting-db-user.mjs actually calls: picks a fresh random salt and builds the
 * verifier for it. Split from buildScramSha256Verifier so the random part never has to be mocked
 * out to test the (deterministic, security-sensitive) math. */
export function generateScramSha256Verifier(password, iterations = DEFAULT_ITERATIONS) {
  return buildScramSha256Verifier(password, randomBytes(16), iterations);
}

/** A strong random password for a new orderat_app login. base64url keeps it free of characters
 * that would need extra escaping in a connection string beyond the encodeURIComponent
 * scripts/hosting-db-user.mjs already applies when building ORDERAT_DATABASE_URL. */
export function generatePassword(bytes = 24) {
  return randomBytes(bytes).toString("base64url");
}
