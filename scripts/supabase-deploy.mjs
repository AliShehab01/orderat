#!/usr/bin/env node
// Deploys the three Edge Functions with --use-api, so no local Docker daemon is required (see
// README.md "Hosting on Supabase" for the tradeoffs of --use-api vs the Docker-based deploy path).
//
// Usage: npm run supabase:deploy               deploys whatsapp, instagram and owner
//        npm run supabase:deploy -- whatsapp   deploys just one function

import { spawnSync } from "node:child_process";

const ALL = ["whatsapp", "instagram", "owner"];
const requested = process.argv.slice(2);
const targets = requested.length ? requested.filter((name) => ALL.includes(name)) : ALL;

const unknown = requested.filter((name) => !ALL.includes(name));
if (unknown.length) {
  console.error(`Unknown function(s): ${unknown.join(", ")}. Known: ${ALL.join(", ")}`);
  process.exit(1);
}

for (const name of targets) {
  console.log(`\nDeploying ${name}...`);
  const result = spawnSync("npx", ["supabase", "functions", "deploy", name, "--use-api"], { stdio: "inherit" });
  if (result.status !== 0) {
    console.error(`Deploy of ${name} failed (exit ${result.status}).`);
    process.exit(result.status ?? 1);
  }
}

console.log(`\nDeployed: ${targets.join(", ")}.`);
console.log("Check each function's verify_jwt setting in the Supabase dashboard (Edge Functions > <name> > Details) --");
console.log("supabase/config.toml sets verify_jwt = false, but the CLI has been known to not always apply it on a redeploy.");
