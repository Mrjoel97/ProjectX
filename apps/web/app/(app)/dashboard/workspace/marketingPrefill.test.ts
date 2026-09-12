import { describe, expect, it } from "vitest";
import { applyMarketingPrefill, marketingPrefill } from "./marketingPrefill";

describe("closed marketing handoff", () => {
  it("accepts only one known channel and intent", () => {
    expect(marketingPrefill("?intent=marketing&channel=tiktok")).toContain("TikTok");
    for (const search of [
      "?intent=send&channel=gmail",
      "?intent=marketing&channel=unknown",
      "?intent=marketing&channel=gmail&channel=x",
      "?intent=marketing&intent=send&channel=x",
    ])
      expect(marketingPrefill(search)).toBeNull();
  });
  it("never overwrites a draft or starts work", () => {
    const draft = marketingPrefill("?intent=marketing&channel=gmail");
    expect(applyMarketingPrefill("existing", draft, false)).toBe("existing");
    expect(applyMarketingPrefill("", draft, true)).toBe("");
    expect(applyMarketingPrefill("", draft, false)).toBe(draft);
    expect(draft).toContain("Do not send or publish anything");
  });
});
