#!/usr/bin/env node
// Sets (or rotates) orderat_app's login password on a hosted project, and writes the resulting
// ORDERAT_DATABASE_URL into .env.local — without the plaintext password ever reaching the server,
// a log, or this repo. `db/migrations/0001_orderat_isolation.sql` creates orderat_app as NOLOGIN;
// this script is the "out of band" step that gives it a way to log in.
//
// How: scripts/lib/scram.mjs computes a SCRAM-SHA-256 verifier locally from a fresh random
// password, and `ALTER ROLE orderat_app WITH LOGIN PASSWORD '<verifier>'` is sent — Postgres
// recognizes the "SCRAM-SHA-256$..." shape and stores it as-is instead of hashing it again, so the
// only thing that ever crosses the wire (or lands in this script's own temp SQL file, deleted in a
// `finally`) is the verifier, never the password.
//
// Usage: npm run hosting:db-user
//        npm run hosting:db-user -- --project-ref <ref> --pooler-host <host>
//
// Requires ORDERAT_DB_POOLER_HOST in .env.local (or --pooler-host) — Hayati's Supavisor transaction
// pooler host, e.g. aws-0-ap-south-1.pooler.supabase.com (see README.md "Hosting").

import { generatePassword, generateScramSha256Verifier } from "./lib/scram.mjs";
import { readEnvLocal, resolveProjectRef, runDbQueryFile, withTempFile, writeEnvLocalVar } from "./lib/hosting-env.mjs";

const POOLER_PORT = 6543; // Supavisor's transaction pooler; see server/agent/postgres-client.ts / supabase/functions/_shared/db.ts for why (prepare:false).

function resolvePoolerHost(argv) {
  const flagIdx = argv.indexOf("--pooler-host");
  if (flagIdx !== -1 && argv[flagIdx + 1]) return argv[flagIdx + 1];
  const fromEnv = readEnvLocal().get("ORDERAT_DB_POOLER_HOST");
  if (fromEnv) return fromEnv;
  console.error(
    "No pooler host. Pass --pooler-host <host>, or set ORDERAT_DB_POOLER_HOST in .env.local " +
      "(Settings > Database > Connection pooling in the Supabase dashboard, e.g. aws-0-ap-south-1.pooler.supabase.com).",
  );
  process.exit(1);
}

function main() {
  const argv = process.argv.slice(2);
  const projectRef = resolveProjectRef(argv);
  const poolerHost = resolvePoolerHost(argv);

  const password = generatePassword();
  const verifier = generateScramSha256Verifier(password);
  // The verifier itself isn't secret in the way the password is (it can't be used to log in
  // directly, only compared against during a real SCRAM handshake), but it's still only ever
  // written to a temp file this process deletes, never to stdout/a log.
  const escapedVerifier = verifier.replace(/'/g, "''");
  const sql = `alter role orderat_app with login password '${escapedVerifier}';`;
  const file = withTempFile("orderat-db-user-", sql);

  console.log(`Setting orderat_app's password on project ${projectRef}...`);
  // failed (not process.exit() inside the catch) so the finally below — which deletes the temp file
  // holding the freshly generated SCRAM verifier — always runs, success or failure. process.exit()
  // terminates immediately without unwinding the stack, so a finally that hasn't run yet never
  // would, leaking the temp file on any CLI failure (wrong ref, expired login, network error).
  let failed = false;
  try {
    runDbQueryFile(projectRef, file.path);
  } catch (err) {
    console.error(`Failed: ${err instanceof Error ? err.message : String(err)}`);
    failed = true;
  } finally {
    file.cleanup();
  }
  if (failed) process.exit(1);

  const url = `postgresql://orderat_app.${projectRef}:${encodeURIComponent(password)}@${poolerHost}:${POOLER_PORT}/postgres`;
  writeEnvLocalVar("ORDERAT_DATABASE_URL", url);
  console.log("Done. Wrote ORDERAT_DATABASE_URL to .env.local (not printed here).");
  console.log("Next: npm run hosting:secrets, then npm run hosting:deploy.");
}

main();
