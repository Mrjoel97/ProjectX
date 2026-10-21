import { describe, expect, test } from "vitest";
import {
  ambiguousCampaignFailure,
  campaignMaximumCents,
  campaignStartIndexes,
  campaignStatus,
  validateCampaignInput,
} from "./mediaCampaign";

describe("media campaign admission and truthful progress", () => {
  test("sub-cent images cannot accumulate behind a zero maximum", () => {
    expect(
      Array.from({ length: 10 }, () => campaignMaximumCents(0.006)).reduce((a, b) => a + b),
    ).toBe(10);
    expect(() => campaignMaximumCents(Number.NaN)).toThrow();
  });
  test("limits concurrency and freezes ambiguous paid outcomes", () => {
    expect(
      campaignStartIndexes(
        [{ status: "running" }, { status: "reserved" }, { status: "reserved" }],
        false,
        999,
      ),
    ).toEqual([1]);
    expect(
      campaignStartIndexes([{ status: "needs_reconciliation" }, { status: "reserved" }], false),
    ).toEqual([]);
    expect(campaignStartIndexes([{ status: "reserved" }], true)).toEqual([]);
    expect(campaignStartIndexes([{ status: "reserved" }], false, Number.NaN)).toEqual([]);
  });
  test("cancellation never claims that submitted work has stopped", () => {
    expect(campaignStatus([{ status: "succeeded" }, { status: "cancelled" }], true)).toBe(
      "partial",
    );
    expect(campaignStatus([{ status: "running" }, { status: "cancelled" }], true)).toBe("running");
    expect(campaignStatus([{ status: "failed" }], false)).toBe("failed");
    expect(campaignStatus([{ status: "succeeded" }], false)).toBe("complete");
  });
  test("requires explicit bounded proposal content and maximum", () => {
    expect(
      validateCampaignInput(
        "Launch",
        [{ kind: "image", label: "Square", prompt: "Owned product" }],
        20,
      ),
    ).toBeNull();
    expect(validateCampaignInput("Launch", [], 20)).toBe("invalid_item_count");
    expect(validateCampaignInput("Launch", [{ kind: "video", label: "Reel" }], 20)).toBe(
      "invalid_brief",
    );
    expect(
      validateCampaignInput("Launch", [{ kind: "image", label: "Image", prompt: "Product" }], -1),
    ).toBe("invalid_maximum");
    expect(ambiguousCampaignFailure("provider_error")).toBe(true);
    expect(ambiguousCampaignFailure("submission_timeout")).toBe(true);
    expect(ambiguousCampaignFailure("transport_error")).toBe(true);
    expect(ambiguousCampaignFailure("no_request_id")).toBe(true);
    expect(ambiguousCampaignFailure("submit_threw")).toBe(true);
    expect(ambiguousCampaignFailure("provider_blocked")).toBe(false);
  });
});
