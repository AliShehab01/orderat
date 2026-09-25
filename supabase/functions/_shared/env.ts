// Every hosted secret Orderat reads carries an ORDERAT_ prefix (scripts/hosting-secrets.mjs pushes
// them that way) — this is the one place that prefix is applied, so no entry point can accidentally
// read a same-named secret meant for Hayati (or any other project sharing this instance) by reading
// an unprefixed name instead. Local dev (server/dev.ts) is unaffected: it reads unprefixed names
// straight from .env.local, since that file only ever holds Orderat's own settings.

export function orderatEnv(name: string): string | undefined {
  return Deno.env.get(`ORDERAT_${name}`)?.trim() || undefined;
}
