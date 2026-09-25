#!/usr/bin/env node
// Deploys the three orderat-* Edge Functions with --use-api (no local Docker daemon needed — see
// README.md "Hosting"), always by explicit --project-ref, never a linked folder. Replaces the old
// scripts/supabase-deploy.mjs, which deployed the unprefixed whatsapp/instagram/owner functions.
//
// Usage: npm run hosting:deploy                          deploys all three
//        npm run hosting:deploy -- orderat-whatsapp        deploys just one
//        npm run hosting:deploy -- --project-ref <ref>     overrides ORDERAT_SUPABASE_PROJECT_REF

import { spawnSync } from "node:child_process";
import { resolveProjectRef } from "./lib/hosting-env.mjs";

const ALL = ["orderat-whatsapp", "orderat-instagram", "orderat-owner"];

function main() {
  const argv = process.argv.slice(2);
  const projectRef = resolveProjectRef(argv);
  // Whatever's left after resolveProjectRef strips --project-ref and its value is either function
  // names to deploy, or nothing (meaning "all three").
  const refFlagIdx = argv.indexOf("--project-ref");
  const rest = refFlagIdx === -1 ? argv : [...argv.slice(0, refFlagIdx), ...argv.slice(refFlagIdx + 2)];
  const requested = rest.filter((a) => !a.startsWith("--"));
  const targets = requested.length ? requested : ALL;

  const unknown = targets.filter((name) => !ALL.includes(name));
  if (unknown.length) {
    console.error(`Unknown function(s): ${unknown.join(", ")}. Known: ${ALL.join(", ")}`);
    process.exit(1);
  }

  for (const name of targets) {
    console.log(`\nDeploying ${name} to project ${projectRef}...`);
    const result = spawnSync("npx", ["supabase", "functions", "deploy", name, "--project-ref", projectRef, "--use-api", "--no-verify-jwt"], { stdio: "inherit" });
    if (result.status !== 0) {
      console.error(`Deploy of ${name} failed (exit ${result.status}).`);
      process.exit(result.status ?? 1);
    }
  }

  console.log(`\nDeployed: ${targets.join(", ")}.`);
}

main();
