// The salt a client IP is hashed with (server/shared/crypto.ts's hashClientIp) before it keys a per-IP
// limit, so no row ever holds an IP: orderat-auth's pair_start limit, and the AI functions' daily caps
// for calls without a signed-in session (orderat-ask, orderat-parse, orderat-studio — server/usage/
// trusted-limits.ts, security review 1 Oct 2026, F02). ORDERAT_AUTH_IP_SALT when set; otherwise a one-way
// hash of the database URL, a secret every one of these functions already holds, so the salt is still
// unknown to anyone reading only the database. If that URL ever changes, the counters simply start over.

import { sha256HexOfString } from "../../../server/shared/crypto.ts";
import { orderatEnv as env } from "./env.ts";

export async function clientIpSalt(databaseUrl: string): Promise<string> {
  return env("AUTH_IP_SALT") || (await sha256HexOfString(`orderat-auth-ip-salt:${databaseUrl}`));
}
