import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import {
  assessOnlinePresenceBrief,
  ONLINE_PRESENCE_TOOLS,
  type OnlinePresenceSource,
  onlinePresenceServiceState,
} from "./onlinePresence";
import { validateWebRecipeInput } from "./webRecipes";

const source: OnlinePresenceSource = {
  ref: "foundation:business:3",
  kind: "foundation",
  revision: "3",
  text: "Acme designs gardens for homeowners.",
  intent: "current",
  status: "approved",
  visibility: "unspecified",
};
const brief = {
  kind: "website",
  businessName: "Acme",
  headline: "Gardens designed around you",
  summary: "Garden design for homeowners.",
  audience: "Homeowners",
  sourceRefs: [source.ref],
};
const assess = (overrides: Record<string, unknown> = {}, sources = [source]) =>
  assessOnlinePresenceBrief({ ...brief, ...overrides }, sources);

describe("attended online presence brief", () => {
  test("passes closed business-fitting art direction and a bounded color to both recipe families", () => {
    for (const kind of ["landing", "website"] as const) {
      const result = assess({ kind, design: { artDirection: "studio", primaryColor: "#246B58" } });
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error("Expected designed brief");
      expect(result.input).toMatchObject({ artDirection: "studio", primaryColor: "#246B58" });
      expect(result.brief.design).toEqual({ artDirection: "studio", primaryColor: "#246B58" });
      expect(result.input).not.toHaveProperty("design");
    }
    const automaticPalette = assess({ design: { artDirection: "editorial" } });
    expect(automaticPalette.ok).toBe(true);
    if (automaticPalette.ok) expect(automaticPalette.input).not.toHaveProperty("primaryColor");
  });

  test.each([
    null,
    [],
    "studio",
    { artDirection: "luxury" },
    { css: "body{color:red}" },
    { primaryColor: "#abc" },
    { primaryColor: "#12345678" },
    { primaryColor: "rgb(1,2,3)" },
    { primaryColor: "#123456;background:url(https://example.com)" },
    { primaryColor: 123456 },
  ])("rejects unknown direction, arbitrary presentation code and unsupported color shapes: %j", (design) => {
    const result = assess({ design });
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.missing).toContainEqual(expect.objectContaining({ reason: "invalid" }));
  });

  test("materializes approved context into an existing business recipe without inventing consent", () => {
    const result = assess();
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("Expected complete brief");
    expect(result.recipeId).toBe("business-site");
    expect(validateWebRecipeInput(result.recipeId, result.input).ok).toBe(true);
    expect(result.input).not.toHaveProperty("contactConsent");
    expect(result.sources).toEqual([source]);
    expect(result.publicationRequiresExactVersionApproval).toBe(true);
  });

  test("a private draft preserves private, planned, stale and unverified publication warnings", () => {
    const result = assess({}, [
      { ...source, visibility: "private", intent: "planned", stale: true },
    ]);
    expect(result.ok).toBe(true);
    expect(result.warnings.map((warning) => warning.code)).toEqual([
      "private_source",
      "planned_source",
      "stale_source",
      "claim_support_requires_review",
    ]);
    expect(assess().warnings).toContainEqual({
      code: "publication_permission_unset",
      sourceRef: source.ref,
    });
  });

  test("asks only for the missing field when the other business facts are present", () => {
    const result = assess({ audience: "" });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Expected incomplete brief");
    expect(result.missing).toEqual([
      { field: "audience", reason: "missing", question: "Who should this online presence serve?" },
    ]);
  });

  test.each([
    ["unknown", [], "unknown_source"],
    ["draft", [{ ...source, status: "draft" as const }], "unapproved_source"],
    ["conflict", [source, { ...source, revision: "4" }], "conflicting_source"],
  ])("refuses %s references using adapter-owned sources", (_name, sources, reason) => {
    const result = assess({}, sources as OnlinePresenceSource[]);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Expected refusal");
    expect(result.missing).toContainEqual(expect.objectContaining({ field: "sourceRefs", reason }));
  });

  test("does not permit duplicate sources, unknown fields, or a model-owned readiness flag", () => {
    const result = assess({ sourceRefs: [source.ref, source.ref], commerceReady: true });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Expected refusal");
    expect(result.missing).toContainEqual(
      expect.objectContaining({ field: "commerceReady", reason: "invalid" }),
    );
    expect(result.missing).toContainEqual(
      expect.objectContaining({ field: "sourceRefs", reason: "invalid" }),
    );
  });

  test("shop remains unavailable even with complete approved business evidence", () => {
    const result = assess({ kind: "shop" });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Expected shop refusal");
    expect(result.missing).toContainEqual(
      expect.objectContaining({ reason: "commerce_unavailable" }),
    );
    expect(onlinePresenceServiceState(result)).toBe("needs_information");
  });

  test("maps a supported landing CTA and preserves explicit consent text", () => {
    const result = assess({
      kind: "landing",
      ctaLabel: "Learn more",
      ctaHref: "/about",
      contactConsent: "I agree to be contacted about this inquiry.",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("Expected complete brief");
    expect(result.recipeId).toBe("campaign-landing");
    expect(result.input).toMatchObject({
      offer: brief.summary,
      ctaLabel: "Learn more",
      ctaPath: "/about",
      formConsent: "I agree to be contacted about this inquiry.",
    });
  });

  test("maps real HTTPS booking destinations for both supported outcomes", () => {
    for (const kind of ["landing", "website"] as const) {
      const result = assess({
        kind,
        ctaLabel: "Book a consultation",
        ctaHref: "https://example.com/consultation",
      });
      expect(result.ok).toBe(true);
      if (result.ok)
        expect(result.input).toHaveProperty("ctaHref", "https://example.com/consultation");
    }
  });

  test("blocks executable destinations, unsupported text and incomplete CTA pairs", () => {
    for (const overrides of [
      { kind: "landing", ctaLabel: "Continue", ctaHref: "javascript:alert(1)" },
      { headline: "<script>alert(1)</script>" },
      { ctaLabel: "Contact us" },
      { contactConsent: true },
    ])
      expect(assess(overrides).ok).toBe(false);
  });
});

test("progress requires exact immutable artifact receipts and never inherits another version's approval", () => {
  const assessment = assess();
  const artifact = { projectId: "project", versionId: "v2", contentHash: "a".repeat(64) };
  expect(onlinePresenceServiceState(assessment)).toBe("ready_to_build");
  expect(onlinePresenceServiceState(assessment, artifact)).toBe("awaiting_review");
  expect(
    onlinePresenceServiceState(assessment, {
      ...artifact,
      contentHash: `sha256:${artifact.contentHash}`,
    }),
  ).toBe("awaiting_review");
  expect(
    onlinePresenceServiceState(assessment, {
      ...artifact,
      approvedVersionId: "v1",
      publishedVersionId: "v1",
    }),
  ).toBe("awaiting_review");
  expect(onlinePresenceServiceState(assessment, { ...artifact, approvedVersionId: "v2" })).toBe(
    "approved",
  );
  expect(onlinePresenceServiceState(assessment, { ...artifact, publishedVersionId: "v2" })).toBe(
    "awaiting_review",
  );
  expect(
    onlinePresenceServiceState(assessment, {
      ...artifact,
      approvedVersionId: "v2",
      publishedVersionId: "v2",
    }),
  ).toBe("published");
  expect(onlinePresenceServiceState(assessment, { ...artifact, contentHash: "" })).toBe(
    "ready_to_build",
  );
});

test("the service grant contains only context, draft and build tools, with a complete registry mirror", async () => {
  expect(ONLINE_PRESENCE_TOOLS).toEqual([
    "readOnlinePresenceContext",
    "searchVault",
    "saveOnlinePresenceBrief",
    "buildOnlinePresenceProject",
  ]);
  expect(Object.isFrozen(ONLINE_PRESENCE_TOOLS)).toBe(true);
  const { onlinePresenceSpecialistSkillBody } = await import(
    "../../contracts/src/skills/onlinePresenceSpecialist"
  );
  const canonical = readFileSync(
    new URL("../../contracts/skills/online-presence-specialist.md", import.meta.url),
    "utf8",
  ).replace(/\r\n/g, "\n");
  expect(onlinePresenceSpecialistSkillBody).toBe(canonical);
  for (const tool of ONLINE_PRESENCE_TOOLS) expect(canonical).toContain(`\`${tool}\``);
});
