import { beforeAll, describe, expect, it } from "vitest";
import { APPLE_REVOKE_URL, APPLE_TOKEN_URL, appleKeyConfigFromEnv, createAppleClientSecret, createAppleTokenClient, type AppleKeyConfig } from "./apple-tokens.ts";

const NOW = new Date("2026-09-30T12:00:00Z");

let config: AppleKeyConfig;
let publicKey: CryptoKey;

function pemFromPkcs8(bytes: ArrayBuffer): string {
  const b64 = Buffer.from(bytes).toString("base64");
  return `-----BEGIN PRIVATE KEY-----\n${b64.match(/.{1,64}/g)!.join("\n")}\n-----END PRIVATE KEY-----`;
}

function decodePart(part: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(part, "base64url").toString("utf8"));
}

beforeAll(async () => {
  const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  publicKey = pair.publicKey;
  config = { teamId: "TEAM123456", keyId: "KEY1234567", privateKeyPem: pemFromPkcs8(await crypto.subtle.exportKey("pkcs8", pair.privateKey)) };
});

interface Call { url: string; fields: URLSearchParams }

function fakeFetch(responses: Response[] | (() => Response), calls: Call[]): typeof fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), fields: new URLSearchParams(String(init?.body ?? "")) });
    if (typeof responses === "function") return responses();
    const next = responses.shift();
    if (!next) throw new Error("no more responses");
    return next;
  }) as unknown as typeof fetch;
}

describe("appleKeyConfigFromEnv", () => {
  it("returns the config only when all three secrets are set", () => {
    const env: Record<string, string> = { APPLE_TEAM_ID: "T", APPLE_KEY_ID: "K", APPLE_PRIVATE_KEY: "P" };
    expect(appleKeyConfigFromEnv((n) => env[n])).toEqual({ teamId: "T", keyId: "K", privateKeyPem: "P" });
    for (const missing of Object.keys(env)) {
      const partial = { ...env, [missing]: "" };
      expect(appleKeyConfigFromEnv((n) => partial[n])).toBeUndefined();
    }
  });
});

describe("createAppleClientSecret", () => {
  it("is an ES256 JWT for the client id, signed with the key", async () => {
    const jwt = await createAppleClientSecret(config, "com.ams.orderat.web", NOW);
    const [h, p, s] = jwt.split(".");
    expect(decodePart(h)).toEqual({ alg: "ES256", kid: "KEY1234567" });
    const iat = Math.floor(NOW.getTime() / 1000);
    expect(decodePart(p)).toEqual({ iss: "TEAM123456", iat, exp: iat + 300, aud: "https://appleid.apple.com", sub: "com.ams.orderat.web" });
    const valid = await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, publicKey, Buffer.from(s, "base64url"), new TextEncoder().encode(`${h}.${p}`));
    expect(valid).toBe(true);
  });

  it("accepts a PEM pasted with literal \n sequences", async () => {
    const oneLine = { ...config, privateKeyPem: config.privateKeyPem.replace(/\n/g, "\n") };
    await expect(createAppleClientSecret(oneLine, "com.ams.orderat", NOW)).resolves.toMatch(/^[\w-]+\.[\w-]+\.[\w-]+$/);
  });
});

describe("createAppleTokenClient", () => {
  it("exchanges an authorization code for the refresh token", async () => {
    const calls: Call[] = [];
    const client = createAppleTokenClient(config, { now: () => NOW, fetchImpl: fakeFetch([Response.json({ access_token: "a", refresh_token: "r-1", id_token: "x" })], calls) });
    await expect(client.exchangeCode("code-1", "com.ams.orderat")).resolves.toBe("r-1");
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(APPLE_TOKEN_URL);
    expect(calls[0].fields.get("client_id")).toBe("com.ams.orderat");
    expect(calls[0].fields.get("code")).toBe("code-1");
    expect(calls[0].fields.get("grant_type")).toBe("authorization_code");
    expect(decodePart(calls[0].fields.get("client_secret")!.split(".")[1]).sub).toBe("com.ams.orderat");
    expect(calls[0].fields.has("redirect_uri")).toBe(false);
  });

  it("sends the web client's redirect URI with its code", async () => {
    const calls: Call[] = [];
    const client = createAppleTokenClient(config, { redirectUris: { "com.ams.orderat.web": "https://orderatweb.com/app/" }, fetchImpl: fakeFetch([Response.json({ refresh_token: "r-web" })], calls) });
    await expect(client.exchangeCode("code-2", "com.ams.orderat.web")).resolves.toBe("r-web");
    expect(calls[0].fields.get("redirect_uri")).toBe("https://orderatweb.com/app/");
  });

  it("returns undefined when Apple refuses the code, answers without a refresh token, or cannot be reached", async () => {
    const calls: Call[] = [];
    const refused = createAppleTokenClient(config, { fetchImpl: fakeFetch([Response.json({ error: "invalid_grant" }, { status: 400 })], calls) });
    await expect(refused.exchangeCode("c", "com.ams.orderat")).resolves.toBeUndefined();
    const noToken = createAppleTokenClient(config, { fetchImpl: fakeFetch([Response.json({ access_token: "a" })], calls) });
    await expect(noToken.exchangeCode("c", "com.ams.orderat")).resolves.toBeUndefined();
    const down = createAppleTokenClient(config, { fetchImpl: (async () => { throw new Error("offline"); }) as unknown as typeof fetch });
    await expect(down.exchangeCode("c", "com.ams.orderat")).resolves.toBeUndefined();
  });

  it("returns undefined (without calling Apple) when the private key is malformed", async () => {
    const calls: Call[] = [];
    const client = createAppleTokenClient({ ...config, privateKeyPem: "not a key" }, { fetchImpl: fakeFetch([], calls) });
    await expect(client.exchangeCode("c", "com.ams.orderat")).resolves.toBeUndefined();
    await expect(client.revoke("r", "com.ams.orderat")).resolves.toBe(false);
    expect(calls).toHaveLength(0);
  });

  it("revokes a refresh token for its client id", async () => {
    const calls: Call[] = [];
    const client = createAppleTokenClient(config, { fetchImpl: fakeFetch([new Response("", { status: 200 }), new Response("", { status: 400 })], calls) });
    await expect(client.revoke("r-1", "com.ams.orderat.web")).resolves.toBe(true);
    await expect(client.revoke("r-2", "com.ams.orderat.web")).resolves.toBe(false);
    expect(calls[0].url).toBe(APPLE_REVOKE_URL);
    expect(calls[0].fields.get("client_id")).toBe("com.ams.orderat.web");
    expect(calls[0].fields.get("token")).toBe("r-1");
    expect(calls[0].fields.get("token_type_hint")).toBe("refresh_token");
  });
});
