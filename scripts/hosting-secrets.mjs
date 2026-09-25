#!/usr/bin/env node
// Pushes an explicit allowlist of .env.local settings to the hosted project's Edge Function
// secrets, each renamed with an ORDERAT_ prefix (read back by supabase/functions/_shared/env.ts) —
// this project (Hayati) hosts more than just Orderat, so nothing here can push, read or collide
// with a same-named secret meant for it. Never prints a value, only the names it pushed. Replaces
// the old scripts/supabase-secrets.mjs, which pushed every unprefixed name in .env.local verbatim —
// fine when Orderat had a project to itself, not once it's a tenant in someone else's.
//
// Usage: npm run hosting:secrets
//        npm run hosting:secrets -- --project-ref <ref>
//        npm run hosting:secrets -- --include-test-flags   also pushes the local-only testing flags

import { readEnvLocal, resolveProjectRef, withTempFile } from "./lib/hosting-env.mjs";
import { spawnSync } from "node:child_process";
import { basename } from "node:path";
import { fileURLToPath } from "node:url";

// Everything Orderat's Edge Functions actually read (supabase/functions/*/index.ts via
// supabase/functions/_shared/env.ts). Deliberately explicit rather than "everything in .env.local":
// .env.local can and does hold things that don't belong on a shared project's secret store.
export const ALLOWLIST = [
  "WHATSAPP_TOKEN",
  "WHATSAPP_PHONE_NUMBER_ID",
  "WHATSAPP_VERIFY_TOKEN",
  "WHATSAPP_APP_SECRET",
  "WHATSAPP_API_VERSION",
  "GEMINI_API_KEY",
  "GEMINI_MODEL",
  "GEMINI_FALLBACK_MODELS",
  "INSTAGRAM_ACCESS_TOKEN",
  "INSTAGRAM_VERIFY_TOKEN",
  "INSTAGRAM_APP_SECRET",
  "INSTAGRAM_API_VERSION",
  "INSTAGRAM_REPLY_TO",
  "OWNER_KEY",
];

// Local-only convenience flags (server/dev.ts, server/whatsapp/webhook.ts, server/instagram/config.ts)
// that must never end up live on a hosted function by default — WHATSAPP_ALLOW_UNSIGNED and
// INSTAGRAM_ALLOW_UNSIGNED turn off signature verification, WHATSAPP_DRY_RUN silently swallows
// outgoing messages.
export const TEST_FLAGS = ["WHATSAPP_ALLOW_UNSIGNED", "INSTAGRAM_ALLOW_UNSIGNED", "WHATSAPP_DRY_RUN"];

/**
 * Pure builder: given the parsed .env.local map, returns the `.env`-format file content to hand
 * `supabase secrets set --env-file` and the list of secret names (never values) it decided to push
 * — unit-tested in hosting-secrets.test.mjs without touching a real .env.local.
 */
export function buildSecretsEnvContent(localVars, { includeTestFlags = false } = {}) {
  const names = [...ALLOWLIST, ...(includeTestFlags ? TEST_FLAGS : [])];
  const lines = [];
  const pushed = [];
  for (const name of names) {
    const value = localVars.get(name);
    if (!value) continue; // not set locally, or set to an empty string: nothing to push
    lines.push(`ORDERAT_${name}=${value}`);
    pushed.push(`ORDERAT_${name}`);
  }
  // Already ORDERAT_-prefixed locally (see README.md "Hosting" / .env.example) — pushed under the
  // same name, not double-prefixed.
  const databaseUrl = localVars.get("ORDERAT_DATABASE_URL");
  if (databaseUrl) {
    lines.push(`ORDERAT_DATABASE_URL=${databaseUrl}`);
    pushed.push("ORDERAT_DATABASE_URL");
  }
  return { content: lines.length ? `${lines.join("\n")}\n` : "", pushed };
}

function main() {
  const argv = process.argv.slice(2);
  const projectRef = resolveProjectRef(argv);
  const includeTestFlags = argv.includes("--include-test-flags");

  const { content, pushed } = buildSecretsEnvContent(readEnvLocal(), { includeTestFlags });
  if (pushed.length === 0) {
    console.error("Nothing to push: none of the allowlisted settings are set in .env.local.");
    process.exit(1);
  }

  const file = withTempFile("orderat-secrets-", content);
  console.log(`Pushing ${pushed.length} secret(s) to project ${projectRef}: ${pushed.join(", ")}`);
  try {
    const result = spawnSync("npx", ["supabase", "secrets", "set", "--env-file", file.path, "--project-ref", projectRef], { stdio: "inherit" });
    if (result.status !== 0) process.exit(result.status ?? 1);
  } finally {
    file.cleanup();
  }
  console.log("Done.");
}

if (basename(process.argv[1] ?? "") === basename(fileURLToPath(import.meta.url))) {
  main();
}
