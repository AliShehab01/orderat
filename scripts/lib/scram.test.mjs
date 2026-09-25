import { describe, expect, it } from "vitest";
import { buildScramSha256Verifier, generatePassword, generateScramSha256Verifier } from "./scram.mjs";

// Known-good vector: this is the *actual* verifier a real Postgres produced for password "pencil",
// captured by running `create role probe login password 'pencil';` against PGlite (a real Postgres,
// compiled to WASM — the same engine this repo already depends on for
// server/agent/postgres-store.test.ts) with its default password_encryption=scram-sha-256, then
// reading it straight back out of pg_authid.rolpassword:
//
//   SCRAM-SHA-256$4096:wmaNXvkv9iF0Z2gPs1w2Sw==$12yHiF7X5Bljn1HbXE7X7FfuM5bv77VvlL8jTZ2wtNs=:SYvMrkF88ILM6AKUV9kG32J9muSzFdyHUoDqWXyb8+U=
//
// Feeding buildScramSha256Verifier the exact same password, salt and iteration count Postgres used,
// and asserting the StoredKey/ServerKey it computes match byte-for-byte, is proof this
// reimplementation of RFC 7677's algorithm matches Postgres's own — not just that it produces
// something shaped like a verifier.
const PGLITE_SALT = Buffer.from("wmaNXvkv9iF0Z2gPs1w2Sw==", "base64");
const PGLITE_ITERATIONS = 4096;
const PGLITE_VERIFIER =
  "SCRAM-SHA-256$4096:wmaNXvkv9iF0Z2gPs1w2Sw==$12yHiF7X5Bljn1HbXE7X7FfuM5bv77VvlL8jTZ2wtNs=:SYvMrkF88ILM6AKUV9kG32J9muSzFdyHUoDqWXyb8+U=";

describe("buildScramSha256Verifier", () => {
  it("matches a verifier a real Postgres (PGlite) computed for the same password/salt/iterations", () => {
    expect(buildScramSha256Verifier("pencil", PGLITE_SALT, PGLITE_ITERATIONS)).toBe(PGLITE_VERIFIER);
  });

  it("is deterministic: same inputs, same output, every time", () => {
    const a = buildScramSha256Verifier("correct horse battery staple", PGLITE_SALT, 4096);
    const b = buildScramSha256Verifier("correct horse battery staple", PGLITE_SALT, 4096);
    expect(a).toBe(b);
  });

  it("a different password changes the verifier", () => {
    expect(buildScramSha256Verifier("pencil", PGLITE_SALT, PGLITE_ITERATIONS)).not.toBe(
      buildScramSha256Verifier("not-pencil", PGLITE_SALT, PGLITE_ITERATIONS),
    );
  });

  it("a different salt changes the verifier even for the same password", () => {
    const otherSalt = Buffer.from("0".repeat(32), "hex");
    expect(buildScramSha256Verifier("pencil", otherSalt, PGLITE_ITERATIONS)).not.toBe(PGLITE_VERIFIER);
  });
});

describe("generateScramSha256Verifier", () => {
  it("produces the SCRAM-SHA-256$<iterations>:<salt>$<StoredKey>:<ServerKey> shape", () => {
    const verifier = generateScramSha256Verifier("some-strong-password");
    expect(verifier).toMatch(/^SCRAM-SHA-256\$4096:[A-Za-z0-9+/]+=*\$[A-Za-z0-9+/]+=*:[A-Za-z0-9+/]+=*$/);
  });

  it("uses a fresh random salt each call, so two verifiers for the same password differ", () => {
    const a = generateScramSha256Verifier("same-password");
    const b = generateScramSha256Verifier("same-password");
    expect(a).not.toBe(b);
  });
});

describe("generatePassword", () => {
  it("is URL-safe (no characters that need percent-encoding beyond what the caller already does)", () => {
    expect(generatePassword()).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("is different every call", () => {
    expect(generatePassword()).not.toBe(generatePassword());
  });
});
