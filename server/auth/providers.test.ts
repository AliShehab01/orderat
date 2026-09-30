import { describe, expect, it } from "vitest";
import { resolveAudiences, withExtraAudience } from "./providers.ts";

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
