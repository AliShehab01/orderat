#!/usr/bin/env node
// Applies pending files from db/migrations/ (NOT supabase/migrations — see that folder's absence
// and db/migrations/0001_orderat_isolation.sql's header) to a hosted project, one at a time, each in
// its own transaction together with its bookkeeping insert into orderat.schema_migrations. Uses
// `supabase db query --linked --project-ref <ref> -f <file>`, which runs SQL against a project by
// ref through the Management API — no `supabase link`/`db push` involved, so this can never collide
// with that project's own (e.g. Hayati's game) migration history.
//
// Usage: npm run hosting:migrate                        applies every pending file
//        npm run hosting:migrate -- --dry-run            lists pending files, applies nothing
//        npm run hosting:migrate -- --project-ref <ref>   overrides ORDERAT_SUPABASE_PROJECT_REF

import { readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveProjectRef, runDbQueryFile, withTempFile } from "./lib/hosting-env.mjs";

const MIGRATIONS_DIR = join(fileURLToPath(new URL(".", import.meta.url)), "..", "db", "migrations");

/** Every db/migrations/*.sql file, sorted by filename — the "NNNN_description.sql" naming is what
 * gives that order meaning; there's no separate manifest to keep in sync. */
export function listLocalMigrations(dir = MIGRATIONS_DIR) {
  return readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort();
}

/** Pure diff, unit-testable without touching the network: local files not yet in the applied set,
 * in the same (filename) order listLocalMigrations already sorts them in. */
export function computePendingMigrations(localFilenames, appliedFilenames) {
  const applied = new Set(appliedFilenames);
  return localFilenames.filter((f) => !applied.has(f));
}

function getAppliedMigrations(projectRef) {
  // orderat.schema_migrations doesn't exist until migration 0001 has run once; to_regclass returns
  // null rather than erroring for a relation that isn't there yet, which is what lets a completely
  // fresh project be treated as "nothing applied" instead of this script crashing on it.
  const checkFile = withTempFile("orderat-migrate-check-", "select to_regclass('orderat.schema_migrations') is not null as exists;");
  let exists = false;
  try {
    const rows = runDbQueryFile(projectRef, checkFile.path, { json: true });
    exists = Boolean(rows?.[0]?.exists);
  } finally {
    checkFile.cleanup();
  }
  if (!exists) return [];

  const listFile = withTempFile("orderat-migrate-list-", "select filename from orderat.schema_migrations order by filename;");
  try {
    const rows = runDbQueryFile(projectRef, listFile.path, { json: true });
    return rows.map((r) => r.filename);
  } finally {
    listFile.cleanup();
  }
}

function applyMigration(projectRef, filename) {
  const sql = readFileSync(join(MIGRATIONS_DIR, filename), "utf8");
  const escaped = filename.replace(/'/g, "''");
  const wrapped = `begin;\n${sql}\ninsert into orderat.schema_migrations (filename) values ('${escaped}') on conflict (filename) do nothing;\ncommit;\n`;
  const file = withTempFile("orderat-migrate-apply-", wrapped);
  try {
    runDbQueryFile(projectRef, file.path);
  } finally {
    file.cleanup();
  }
}

function main() {
  const argv = process.argv.slice(2);
  const dryRun = argv.includes("--dry-run");
  const projectRef = resolveProjectRef(argv);

  const local = listLocalMigrations();
  if (local.length === 0) {
    console.log(`No migration files in ${MIGRATIONS_DIR}.`);
    return;
  }

  console.log(`Checking applied migrations on project ${projectRef}...`);
  const applied = getAppliedMigrations(projectRef);
  const pending = computePendingMigrations(local, applied);

  if (pending.length === 0) {
    console.log(`Up to date: all ${local.length} migration(s) already applied.`);
    return;
  }

  console.log(`Pending (${pending.length}/${local.length}): ${pending.join(", ")}`);
  if (dryRun) {
    console.log("--dry-run: not applying anything.");
    return;
  }

  for (const filename of pending) {
    console.log(`Applying ${filename}...`);
    try {
      applyMigration(projectRef, filename);
    } catch (err) {
      console.error(`Failed applying ${filename}: ${err instanceof Error ? err.message : String(err)}`);
      console.error("Stopped — earlier migrations in this run (if any) already committed; this one did not.");
      process.exit(1);
    }
    console.log(`Applied ${filename}.`);
  }
  console.log(`Done: applied ${pending.length} migration(s).`);
}

if (basename(process.argv[1] ?? "") === basename(fileURLToPath(import.meta.url))) {
  main();
}
