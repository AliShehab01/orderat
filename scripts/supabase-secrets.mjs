#!/usr/bin/env node
// Pushes .env.local to the linked Supabase project's Edge Function secret store, without ever
// printing a secret value to the terminal or a log: `supabase secrets set --env-file` reads the
// file itself, so this script's own job is just to build a filtered, gitignored temp copy (no
// blank lines, no comments, no keys Supabase rejects) and delete it again afterwards.
//
// Usage: npm run supabase:secrets   (requires `npx supabase login` and `npx supabase link` first)

import { existsSync, readFileSync, writeFileSync, unlinkSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const ENV_FILE = ".env.local";

if (!existsSync(ENV_FILE)) {
  console.error(`${ENV_FILE} not found. Create it first (see README.md).`);
  process.exit(1);
}

// Supabase reserves the SUPABASE_ prefix for its own auto-provided variables and refuses to let a
// custom secret use it (`supabase secrets set` errors out on a name starting with SUPABASE_).
const RESERVED_PREFIX = /^SUPABASE_/i;

const lines = readFileSync(ENV_FILE, "utf8").split(/\r?\n/);
const kept = [];
let skippedReserved = 0;
for (const line of lines) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) continue;
  const eq = trimmed.indexOf("=");
  if (eq === -1) continue;
  const key = trimmed.slice(0, eq).trim();
  if (RESERVED_PREFIX.test(key)) { skippedReserved++; continue; }
  kept.push(trimmed);
}

if (kept.length === 0) {
  console.error(`No settable variables found in ${ENV_FILE}.`);
  process.exit(1);
}

const tmpDir = mkdtempSync(join(tmpdir(), "orderat-secrets-"));
const tmpFile = join(tmpDir, ".env");
writeFileSync(tmpFile, kept.join("\n") + "\n");

console.log(`Pushing ${kept.length} secret(s) to the linked Supabase project` + (skippedReserved ? ` (skipped ${skippedReserved} SUPABASE_*-prefixed name(s), which Supabase reserves)` : "") + "...");
try {
  const result = spawnSync("npx", ["supabase", "secrets", "set", "--env-file", tmpFile], { stdio: "inherit" });
  process.exit(result.status ?? 1);
} finally {
  try { unlinkSync(tmpFile); } catch { /* best effort */ }
}
