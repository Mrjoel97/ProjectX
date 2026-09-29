import { describe, expect, test } from "vitest";
import {
  CAPABILITY_CLAIMS,
  type CapabilityAvailability,
  capabilityState,
  claimIsAllowed,
} from "./capabilityClaims";

const available: CapabilityAvailability = {
  inviteOnlyAdmission: true,
  humanApproval: true,
  appendOnlyAudit: true,
  gmailDelivery: true,
  outlookDelivery: false,
  onboardingCompletion: true,
  legalReadiness: false,
  marketingGmail: true,
  marketingMetaInstagram: false,
  marketingLinkedin: false,
  marketingTiktok: false,
  marketingX: false,
  marketingYoutube: false,
};

describe("Phase 25 capability claims", () => {
  test("keeps the enumerated source inventory closed and non-vacuous", () => {
    expect(CAPABILITY_CLAIMS).toHaveLength(15);
    expect(new Set(CAPABILITY_CLAIMS.map((claim) => claim.source))).toEqual(
      new Set([
        "apps/web/app/page.tsx",
        "apps/web/app/privacy/page.tsx",
        "apps/web/app/terms/page.tsx",
        "apps/web/app/(app)/dashboard/onboarding/page.tsx",
        "apps/web/app/(app)/dashboard/marketing/MarketingView.tsx",
        "packages/backend/convex/onboarding.ts",
        "packages/core/src/marketing.ts",
        "docs/playbooks/marketing.md",
      ]),
    );
  });

  test.each(CAPABILITY_CLAIMS)("accepts only the honest state for $id", (claim) => {
    const matching = { ...available, [claim.capability]: claim.state === "available" };
    expect(claimIsAllowed(claim, matching)).toBe(true);
    expect(
      claimIsAllowed(claim, { ...matching, [claim.capability]: !matching[claim.capability] }),
    ).toBe(false);
  });

  test("rejects a positive delivery claim when the capability is unavailable", () => {
    const gmail = CAPABILITY_CLAIMS.find((claim) => claim.id === "gmail-delivery-positive");
    expect(gmail).toBeDefined();
    expect(claimIsAllowed(gmail!, { ...available, gmailDelivery: false })).toBe(false);
  });

  test("accepts blocked/refusal copy when the same capability is unavailable", () => {
    const outlook = CAPABILITY_CLAIMS.find((claim) => claim.id === "outlook-delivery-blocked");
    expect(outlook).toBeDefined();
    expect(capabilityState(outlook!, available)).toBe("blocked");
    expect(claimIsAllowed(outlook!, available)).toBe(true);
  });
});
