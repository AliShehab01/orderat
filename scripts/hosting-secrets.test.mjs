import { describe, expect, it } from "vitest";
import { ALLOWLIST, TEST_FLAGS, buildSecretsEnvContent } from "./hosting-secrets.mjs";

// Fabricated stand-ins, not real secrets — this test only checks the renaming/allowlist logic.
function localVars(entries) {
  return new Map(Object.entries(entries));
}

describe("buildSecretsEnvContent", () => {
  it("renames each allowlisted, set variable to ORDERAT_<NAME> and reports it as pushed", () => {
    const { content, pushed } = buildSecretsEnvContent(localVars({ WHATSAPP_TOKEN: "tok-abc", OWNER_KEY: "owner-xyz" }));
    expect(content).toContain("ORDERAT_WHATSAPP_TOKEN=tok-abc");
    expect(content).toContain("ORDERAT_OWNER_KEY=owner-xyz");
    expect(pushed.sort()).toEqual(["ORDERAT_OWNER_KEY", "ORDERAT_WHATSAPP_TOKEN"]);
  });

  it("skips allowlisted names that are unset or empty in .env.local", () => {
    const { content, pushed } = buildSecretsEnvContent(localVars({ WHATSAPP_TOKEN: "tok-abc", GEMINI_API_KEY: "" }));
    expect(content).not.toContain("GEMINI_API_KEY");
    expect(pushed).not.toContain("ORDERAT_GEMINI_API_KEY");
  });

  it("ignores a name not on the allowlist even if it's in .env.local", () => {
    const { content, pushed } = buildSecretsEnvContent(localVars({ SOME_UNRELATED_SETTING: "x", WHATSAPP_TOKEN: "tok" }));
    expect(content).not.toContain("SOME_UNRELATED_SETTING");
    expect(pushed).not.toContain("ORDERAT_SOME_UNRELATED_SETTING");
  });

  it("never pushes the local testing flags by default", () => {
    const vars = localVars({ WHATSAPP_ALLOW_UNSIGNED: "1", INSTAGRAM_ALLOW_UNSIGNED: "1", WHATSAPP_DRY_RUN: "1" });
    const { pushed } = buildSecretsEnvContent(vars);
    expect(pushed).toEqual([]);
  });

  it("pushes the local testing flags only with includeTestFlags: true", () => {
    const vars = localVars({ WHATSAPP_ALLOW_UNSIGNED: "1", INSTAGRAM_ALLOW_UNSIGNED: "1", WHATSAPP_DRY_RUN: "1" });
    const { pushed } = buildSecretsEnvContent(vars, { includeTestFlags: true });
    expect(pushed.sort()).toEqual(["ORDERAT_INSTAGRAM_ALLOW_UNSIGNED", "ORDERAT_WHATSAPP_ALLOW_UNSIGNED", "ORDERAT_WHATSAPP_DRY_RUN"].sort());
  });

  it("passes ORDERAT_DATABASE_URL through under the same name, not double-prefixed", () => {
    const { content, pushed } = buildSecretsEnvContent(localVars({ ORDERAT_DATABASE_URL: "postgresql://fake" }));
    expect(content).toContain("ORDERAT_DATABASE_URL=postgresql://fake");
    expect(content).not.toContain("ORDERAT_ORDERAT_DATABASE_URL");
    expect(pushed).toEqual(["ORDERAT_DATABASE_URL"]);
  });

  it("reports nothing pushed when .env.local has none of the allowlisted settings", () => {
    expect(buildSecretsEnvContent(localVars({})).pushed).toEqual([]);
  });

  it("ALLOWLIST and TEST_FLAGS don't overlap", () => {
    const overlap = ALLOWLIST.filter((n) => TEST_FLAGS.includes(n));
    expect(overlap).toEqual([]);
  });
});
