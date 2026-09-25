// Small shared helpers for the hosting:* scripts: reading/writing .env.local, resolving which
// Supabase project ref to talk to, and running the Supabase CLI's `db query` against a project
// explicitly by --project-ref (never a linked folder — see db/migrations/0001_orderat_isolation.sql's
// header for why nothing here ever runs `supabase link` / `supabase db push`).

import { existsSync, mkdtempSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

export const ENV_FILE = ".env.local";

/** Parses NAME=value lines from .env.local into a Map, skipping blank lines and comments. Values
 * are used as-is (no quote stripping): every setting this repo's scripts read or write is a plain
 * token — a URL, a ref, a token — never a quoted shell-style value. */
export function readEnvLocal(path = ENV_FILE) {
  const map = new Map();
  if (!existsSync(path)) return map;
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    map.set(trimmed.slice(0, eq).trim(), trimmed.slice(eq + 1));
  }
  return map;
}

/** Sets `name` to `value` in .env.local, replacing an existing NAME=... line in place (keeping
 * everything else untouched) or appending a new one. Creates the file if it doesn't exist yet. */
export function writeEnvLocalVar(name, value, path = ENV_FILE) {
  const lines = existsSync(path) ? readFileSync(path, "utf8").split(/\r?\n/) : [];
  const prefix = `${name}=`;
  let replaced = false;
  const next = lines.map((line) => {
    if (line.trim().startsWith(prefix) && !line.trim().startsWith("#")) {
      replaced = true;
      return `${prefix}${value}`;
    }
    return line;
  });
  if (!replaced) {
    // Drop a single trailing blank line before appending, so repeated runs don't grow one forever.
    if (next.length && next[next.length - 1] === "") next.pop();
    next.push(`${prefix}${value}`, "");
  }
  writeFileSync(path, next.join("\n"));
}

/** --project-ref flag, falling back to ORDERAT_SUPABASE_PROJECT_REF in .env.local. Exits with a
 * clear message if neither is set — every hosting:* script needs this before doing anything else. */
export function resolveProjectRef(argv) {
  const flagIdx = argv.indexOf("--project-ref");
  if (flagIdx !== -1 && argv[flagIdx + 1]) return argv[flagIdx + 1];
  const fromEnv = readEnvLocal().get("ORDERAT_SUPABASE_PROJECT_REF");
  if (fromEnv) return fromEnv;
  console.error(
    "No project ref. Pass --project-ref <ref>, or set ORDERAT_SUPABASE_PROJECT_REF in .env.local " +
      "(the project ref is in the Supabase dashboard URL, e.g. ckjmbdbvlbxfofjgqiuj for Hayati).",
  );
  process.exit(1);
}

/**
 * Runs a SQL file against a project via `supabase db query --linked --project-ref <ref> -f <file>`
 * — "--linked" here means "query the project this ref points at through the Management API", not
 * "use this folder's linked project" (no `supabase link` is ever run against Hayati; --project-ref
 * makes the target explicit every time regardless of any local link state). Returns parsed JSON rows
 * when `json` is set (via the CLI's --output-format json), else the raw stdout text.
 */
export function runDbQueryFile(projectRef, sqlFilePath, { json = false } = {}) {
  const args = ["supabase", "db", "query", "--linked", "--project-ref", projectRef, "--file", sqlFilePath];
  if (json) args.push("--output-format", "json");
  // shell: true — on Windows, `npx` on PATH is npx.cmd, and spawnSync can't launch a .cmd directly
  // without a shell (it throws ENOENT even though `npx --version` works fine from an actual shell).
  // Every arg here is either a fixed literal or one this script generated itself (project ref, our
  // own temp file path), never anything from outside input, so shell interpretation of them is safe.
  const result = spawnSync("npx", args, { encoding: "utf8", stdio: json ? ["inherit", "pipe", "inherit"] : "inherit", shell: true });
  if (result.status !== 0) {
    throw new Error(`supabase db query failed (exit ${result.status ?? "?"})`);
  }
  if (!json) return undefined;
  try {
    return JSON.parse(result.stdout);
  } catch (err) {
    throw new Error(`Could not parse JSON from supabase db query: ${(err instanceof Error ? err.message : String(err))}\nOutput: ${result.stdout.slice(0, 500)}`);
  }
}

/** Writes `contents` to a fresh temp file and returns its path plus a `cleanup()` to delete it —
 * every script that shells a SQL/env file out to the Supabase CLI uses this so the temp file is
 * always removed, success or failure (call cleanup() in a `finally`). */
export function withTempFile(prefix, contents, extension = ".sql") {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  const path = join(dir, `file${extension}`);
  writeFileSync(path, contents);
  return { path, cleanup: () => { try { unlinkSync(path); } catch { /* best effort */ } } };
}
