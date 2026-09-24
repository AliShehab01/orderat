// One command for local live testing: npm run whatsapp:live
// Starts the agent (server/dev.ts), opens a Cloudflare quick tunnel to it, waits until the webhook
// answers through the tunnel, then points the WhatsApp account's webhook at the new address.
// Quick-tunnel addresses change on every start, so this keeps Meta in sync automatically.
// Stop with Ctrl+C: both child processes are stopped too.

import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { findTunnelUrl, setWebhookOverride } from "./whatsapp/webhook-override.ts";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");
const env = (name: string) => process.env[name]?.trim() || undefined;

const token = env("WHATSAPP_TOKEN");
const wabaId = env("WHATSAPP_BUSINESS_ACCOUNT_ID");
const verifyToken = env("WHATSAPP_VERIFY_TOKEN");
const port = env("PORT") ?? "8787";
const cloudflared = env("CLOUDFLARED_PATH") ?? join(homedir(), "Downloads", "cloudflared-windows-amd64.exe");

if (!token || !wabaId || !verifyToken) {
  console.error("Missing WHATSAPP_TOKEN, WHATSAPP_BUSINESS_ACCOUNT_ID or WHATSAPP_VERIFY_TOKEN in .env.local.");
  process.exit(1);
}
if (!existsSync(cloudflared)) {
  console.error(`cloudflared not found at ${cloudflared}. Set CLOUDFLARED_PATH in .env.local.`);
  process.exit(1);
}

const children: ChildProcess[] = [];
function stopAll(code = 0): never {
  for (const c of children) if (!c.killed) c.kill();
  process.exit(code);
}
process.on("SIGINT", () => stopAll(0));
process.on("SIGTERM", () => stopAll(0));

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function waitForHandshake(base: string): Promise<boolean> {
  const url = `${base}/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=${encodeURIComponent(verifyToken!)}&hub.challenge=live-check`;
  for (let i = 0; i < 10; i++) {
    try {
      const res = await fetch(url);
      if (res.ok && (await res.text()) === "live-check") return true;
    } catch {
      // The tunnel's DNS name can take a few seconds to exist; keep trying.
    }
    await sleep(2000);
  }
  return false;
}

/** Sets the webhook override, retrying while the new tunnel becomes reachable for Meta. */
async function pointMetaAtTunnel(callbackUrl: string): Promise<void> {
  const tries = 12;
  for (let i = 1; i <= tries; i++) {
    try {
      await setWebhookOverride({ token: token!, wabaId: wabaId!, verifyToken: verifyToken! }, callbackUrl);
      return;
    } catch (err) {
      if (i === tries) throw err;
      console.log(`Meta could not verify the tunnel yet (try ${i}/${tries}): ${err instanceof Error ? err.message : String(err)}. Retrying in 10 s.`);
      await sleep(10_000);
    }
  }
}

async function main() {
  const agent = spawn(process.execPath, [join("node_modules", "tsx", "dist", "cli.mjs"), "server/dev.ts"], { stdio: "inherit" });
  children.push(agent);
  agent.on("exit", (code) => { console.error(`Agent stopped (${code}).`); stopAll(code ?? 1); });

  const tunnel = spawn(cloudflared, ["tunnel", "--no-autoupdate", "--protocol", "http2", "--url", `http://localhost:${port}`]);
  children.push(tunnel);
  let log = "";
  const onData = (chunk: Buffer) => { log += chunk.toString(); };
  tunnel.stdout?.on("data", onData);
  tunnel.stderr?.on("data", onData);
  tunnel.on("exit", (code) => { console.error(`Tunnel stopped (${code}).`); stopAll(code ?? 1); });

  let base: string | undefined;
  for (let i = 0; i < 60 && !base; i++) {
    base = findTunnelUrl(log);
    if (!base) await sleep(1000);
  }
  if (!base) {
    console.error("The tunnel did not report an address. Last log lines:\n" + log.split("\n").slice(-5).join("\n"));
    stopAll(1);
  }
  console.log(`Tunnel: ${base}`);

  // This computer's DNS can take minutes to see a brand-new tunnel name, so a failed local check is
  // only a warning. Meta verifies the address from its own servers when the override is set.
  if (!(await waitForHandshake(base))) {
    console.warn("This computer cannot reach the tunnel yet (often local DNS delay). Letting Meta check it directly.");
  }
  await pointMetaAtTunnel(`${base}/whatsapp/webhook`);
  console.log(`Meta now sends WhatsApp webhooks to ${base}/whatsapp/webhook`);
  console.log("Instagram webhook (set it in Meta when Instagram is connected): " + `${base}/instagram/webhook`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  stopAll(1);
});
