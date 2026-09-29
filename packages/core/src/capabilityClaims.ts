import { MARKETING_CHANNEL_CATALOG, marketingChannelState } from "./marketing";

/**
 * The product-copy checker consumes this closed list. A capability is a repository contract,
 * never a historical result, deployment assertion, or provider-approval assertion.
 */
export const CAPABILITY_IDS = [
  "inviteOnlyAdmission",
  "humanApproval",
  "appendOnlyAudit",
  "gmailDelivery",
  "outlookDelivery",
  "onboardingCompletion",
  "legalReadiness",
  "marketingGmail",
  "marketingMetaInstagram",
  "marketingLinkedin",
  "marketingTiktok",
  "marketingX",
  "marketingYoutube",
] as const;

export type CapabilityId = (typeof CAPABILITY_IDS)[number];
export type CapabilityAvailability = Record<CapabilityId, boolean>;
export type ClaimState = "available" | "blocked";

export type CapabilityClaim = {
  id: string;
  capability: CapabilityId;
  source: string;
  anchor: string;
  state: ClaimState;
  /** Copy which is honest only while this capability is available or blocked, respectively. */
  wording: string;
};

const marketingCapability = {
  gmail: "marketingGmail",
  "meta-instagram": "marketingMetaInstagram",
  linkedin: "marketingLinkedin",
  tiktok: "marketingTiktok",
  x: "marketingX",
  youtube: "marketingYoutube",
} as const satisfies Record<(typeof MARKETING_CHANNEL_CATALOG)[number]["id"], CapabilityId>;

/**
 * The exact source inventory is deliberately hand-written. Deleting an entry is checked by the
 * repository gate; deriving it from a scan would make the gate agree with an accidental deletion.
 */
export const CAPABILITY_CLAIMS: readonly CapabilityClaim[] = [
  {
    id: "invite-only-admission-positive",
    capability: "inviteOnlyAdmission",
    source: "apps/web/app/page.tsx",
    anchor: "Private beta · by invitation · human approval required",
    state: "available",
    wording: "by invitation",
  },
  {
    id: "human-approval-positive",
    capability: "humanApproval",
    source: "apps/web/app/page.tsx",
    anchor: "Nothing is sent, booked or filed until you say so.",
    state: "available",
    wording: "Nothing is sent",
  },
  {
    id: "append-only-audit-positive",
    capability: "appendOnlyAudit",
    source: "apps/web/app/page.tsx",
    anchor: "The audit log is append-only. Records can be added, never edited or deleted.",
    state: "available",
    wording: "append-only",
  },
  {
    id: "gmail-delivery-positive",
    capability: "gmailDelivery",
    source: "apps/web/app/privacy/page.tsx",
    anchor: "draft and send messages as you",
    state: "available",
    wording: "send messages as you",
  },
  {
    id: "outlook-delivery-blocked",
    capability: "outlookDelivery",
    source: "apps/web/app/privacy/page.tsx",
    anchor: "Outlook mail is not implemented yet",
    state: "blocked",
    wording: "not implemented yet",
  },
  {
    id: "onboarding-completion-positive",
    capability: "onboardingCompletion",
    source: "apps/web/app/(app)/dashboard/onboarding/page.tsx",
    anchor: "canComplete",
    state: "available",
    wording: "completion is server-owned",
  },
  {
    id: "onboarding-server-contract-positive",
    capability: "onboardingCompletion",
    source: "packages/backend/convex/onboarding.ts",
    anchor: "firstSendOffer",
    state: "available",
    wording: "canComplete",
  },
  {
    id: "legal-readiness-blocked",
    capability: "legalReadiness",
    source: "apps/web/app/terms/page.tsx",
    anchor: "Draft — not yet in force.",
    state: "blocked",
    wording: "not yet in force",
  },
  {
    id: "marketing-gmail-positive",
    capability: "marketingGmail",
    source: "apps/web/app/(app)/dashboard/marketing/MarketingView.tsx",
    anchor: 'state.status === "connected"',
    state: "available",
    wording: "Connected",
  },
  {
    id: "marketing-meta-instagram-blocked",
    capability: "marketingMetaInstagram",
    source: "packages/core/src/marketing.ts",
    anchor: "provider suitability and permissions review has not started.",
    state: "blocked",
    wording: "blocked-with-reason",
  },
  {
    id: "marketing-linkedin-blocked",
    capability: "marketingLinkedin",
    source: "packages/core/src/marketing.ts",
    anchor: "provider suitability and permissions review has not started.",
    state: "blocked",
    wording: "blocked-with-reason",
  },
  {
    id: "marketing-tiktok-blocked",
    capability: "marketingTiktok",
    source: "packages/core/src/marketing.ts",
    anchor: "provider suitability and permissions review has not started.",
    state: "blocked",
    wording: "blocked-with-reason",
  },
  {
    id: "marketing-x-blocked",
    capability: "marketingX",
    source: "packages/core/src/marketing.ts",
    anchor: "provider suitability and permissions review has not started.",
    state: "blocked",
    wording: "blocked-with-reason",
  },
  {
    id: "marketing-youtube-blocked",
    capability: "marketingYoutube",
    source: "packages/core/src/marketing.ts",
    anchor: "provider suitability and permissions review has not started.",
    state: "blocked",
    wording: "blocked-with-reason",
  },
  {
    id: "marketing-playbook-blocked",
    capability: "marketingMetaInstagram",
    source: "docs/playbooks/marketing.md",
    anchor: "publishing is unavailable",
    state: "blocked",
    wording: "no social publisher",
  },
] as const;

export function capabilityState(
  claim: Pick<CapabilityClaim, "capability">,
  availability: CapabilityAvailability,
): ClaimState {
  return availability[claim.capability] ? "available" : "blocked";
}

export function claimIsAllowed(
  claim: Pick<CapabilityClaim, "capability" | "state">,
  availability: CapabilityAvailability,
): boolean {
  return claim.state === capabilityState(claim, availability);
}

/** Pure adapter over the existing legal, onboarding, and marketing contracts. */
export function capabilityAvailability(input: {
  inviteOnlyAdmission: boolean;
  humanApproval: boolean;
  appendOnlyAudit: boolean;
  gmailDelivery: boolean;
  outlookDelivery: boolean;
  onboardingCanComplete: boolean;
  legalHasPlaceholders: boolean;
  gmail: { connected?: boolean; configured?: boolean };
}): CapabilityAvailability {
  const availability = {
    inviteOnlyAdmission: input.inviteOnlyAdmission,
    humanApproval: input.humanApproval,
    appendOnlyAudit: input.appendOnlyAudit,
    gmailDelivery: input.gmailDelivery,
    outlookDelivery: input.outlookDelivery,
    onboardingCompletion: input.onboardingCanComplete,
    legalReadiness: !input.legalHasPlaceholders,
  } as CapabilityAvailability;
  for (const channel of MARKETING_CHANNEL_CATALOG) {
    const state = marketingChannelState(channel.id, input.gmail);
    availability[marketingCapability[channel.id]] = state?.status === "connected";
  }
  return availability;
}
