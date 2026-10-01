import { describe, expect, it } from "vitest";
import { resolveAudiences, sessionClientFor, withExtraAudience } from "./providers.ts";

// Security retest 1 Oct 2026, F05: which session a verified token earns comes from the token itself.
describe("sessionClientFor", () => {
  const IOS_BUNDLE = "com.ams.orderat";
  const SERVICES_ID = "com.ams.orderat.web";
  const GOOGLE_WEB = "web-client.apps.googleusercontent.com";
  const GOOGLE_IOS = "ios-client.apps.googleusercontent.com";
  const GOOGLE_ANDROID = "android-client.apps.googleusercontent.com";
  const appAudiences = [IOS_BUNDLE, GOOGLE_IOS];

  it.each([
    ["Apple, the iPhone app (bundle id)", "apple", { aud: IOS_BUNDLE }, "app"],
    ["Apple, the website (Services ID)", "apple", { aud: SERVICES_ID }, "web"],
    ["Google, the website (web client, azp the same)", "google", { aud: GOOGLE_WEB, azp: GOOGLE_WEB }, "web"],
    ["Google, the web client with no azp", "google", { aud: GOOGLE_WEB }, "web"],
    ["Google, the Android app (web client as aud, its own client as azp)", "google", { aud: GOOGLE_WEB, azp: GOOGLE_ANDROID }, "app"],
    ["Google, the iPhone app (iOS client)", "google", { aud: GOOGLE_IOS, azp: GOOGLE_IOS }, "app"],
    ["Apple with an azp of another client: only Google's cross-client tokens count", "apple", { aud: SERVICES_ID, azp: IOS_BUNDLE }, "web"],
    ["an audience not known to be an app's", "google", { aud: "staging-web.apps.googleusercontent.com" }, "web"],
  ] as const)("%s", (_label, provider, token, expected) => {
    expect(sessionClientFor(provider, token, appAudiences)).toBe(expected);
  });
});

describe("withExtraAudience (ORDERAT_GOOGLE_IOS_CLIENT_ID)", () => {
  const web = resolveAudiences(undefined, ["web-client.apps.googleusercontent.com"]);

  it("adds the iPhone app's Google client id to the existing audiences", () => {
    expect(withExtraAudience(web, " ios-client.apps.googleusercontent.com ")).toEqual(["web-client.apps.googleusercontent.com", "ios-client.apps.googleusercontent.com"]);
  });

  it("leaves the audiences as they are when unset, empty or already listed", () => {
    expect(withExtraAudience(web, undefined)).toEqual(web);
    expect(withExtraAudience(web, "  ")).toEqual(web);
    expect(withExtraAudience(web, "web-client.apps.googleusercontent.com")).toEqual(web);
  });
});
