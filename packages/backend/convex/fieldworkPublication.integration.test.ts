import { getApprovedPresenceReferenceIdentity } from "@pikar/contracts/approvedPresenceReference";
import {
  materializeWebRecipeWithProvenance,
  renderDesignedWebDocument,
  WEB_DESIGN_RENDERER_VERSION,
} from "@pikar/core";
import type { WebLayoutPlan } from "@pikar/core/webLayoutPlan";
import { canonicalWebLayoutPlan } from "@pikar/core/webLayoutPlan";
import { sha256Bytes } from "@pikar/core/webRuntime";
import { convexTest } from "convex-test";
import { afterEach, expect, test, vi } from "vitest";
import aggregateSchema from "../node_modules/@convex-dev/aggregate/src/component/schema.js";
import { api } from "./_generated/api";
import {
  artifactHashes,
  type PresenceProviderReceipt,
  providerReceiptHash,
} from "./lib/presencePublication";
import schema from "./schema";
import { createProjectWithVersion } from "./webProjects";

const modules = import.meta.glob("./**/*.*s");
const aggregateModules = import.meta.glob(
  "../node_modules/@convex-dev/aggregate/src/component/**/!(*.test).ts",
);
const encode = (s: string) => new TextEncoder().encode(s);
const digest = (s: string) => sha256Bytes(encode(s));
afterEach(() => vi.unstubAllEnvs());

test("selected Fieldwork page bytes survive storage, tenant preview, review, approval and public HTTP", async () => {
  vi.stubEnv("CONVEX_SITE_URL", "https://some.convex.site");
  const t = convexTest(schema, modules);
  t.registerComponent("auditCounts", aggregateSchema, aggregateModules);
  const [ownerId, otherId] = await t.run(
    async (ctx) => [await ctx.db.insert("users", {}), await ctx.db.insert("users", {})] as const,
  );
  const owner = t.withIdentity({ subject: `${ownerId}|session` });
  const stranger = t.withIdentity({ subject: `${otherId}|session` });
  const slug = "offline-print-studio";
  const { document, designProfile } = materializeWebRecipeWithProvenance("business-site", {
    brandName: "Atelier Élan",
    headline: "Print with purpose",
    about: "A source-backed print practice.",
    services: ["Book design"],
    pageMode: "multi-page",
    projectSlug: slug,
    contactConsent: "Please contact me about my project.",
  });
  const layoutPlan: WebLayoutPlan = {
    version: 3,
    hero: "overlay-left",
    sectionLayout: "editorial-columns",
    services: "columns",
    gallery: "grid",
    spacing: "compact",
    headingScale: "display",
    motion: "subtle",
    designTokens: {
      colors: {
        paper: "#f3f0e8",
        card: "#e6e1d5",
        ink: "#20241f",
        muted: "#62665d",
        accent: "#bd7250",
        rule: "#c8c4b9",
      },
      typography: { heading: "editorial-serif", body: "humanist-sans" },
      spacing: { contentWidth: 1240, sectionGap: 80, copyMeasure: 58, heroMinHeight: 640 },
      footer: "light",
    },
    sections: [
      { pageSlug: "home", nodeId: "about", composition: "editorial-lead" },
      { pageSlug: "home", nodeId: "services", composition: "service-panels" },
      { pageSlug: "services", nodeId: "services", composition: "service-panels" },
      { pageSlug: "contact", nodeId: "contact", composition: "contact-panel" },
    ],
  };
  const profile = { ...designProfile, approvedTemplate: "fieldwork-v1" as const, layoutPlan };
  const expected = document.pages.map((page) => ({
    pageSlug: page.slug,
    html: renderDesignedWebDocument(document, profile, { slug, page: page.slug }),
  }));
  expect(expected[0]?.html).toContain('class="wordmark"');
  expect(expected[0]?.html).toContain('class="section services"');
  // Offline fixtures stand in only for provider and browser results. Storage, access and publication use the production handlers.
  const receipt: PresenceProviderReceipt = {
    approvedDesignReference: getApprovedPresenceReferenceIdentity("fieldwork-v1")!,
    pipelineVersion: "stitch-kimi-required-v1",
    runRef: "offline-test-0001",
    stitchHash: digest("offline stitch"),
    kimiHash: digest("offline kimi"),
    sourceFingerprint: digest("offline sources"),
    briefHash: digest("offline brief"),
    layoutHash: digest(JSON.stringify(canonicalWebLayoutPlan(layoutPlan))),
    artifactHashes: artifactHashes(expected),
    pendingBrowser: true,
  };
  const draft = await t.run((ctx) =>
    createProjectWithVersion(
      { ...ctx, userId: ownerId, tenantId: ownerId },
      {
        kind: "site",
        title: document.title,
        slug,
        document,
        createdBy: ownerId,
        recipeRef: {
          name: "web-recipe-business-site",
          version: 1,
          skillId: "offline-test",
          bodyHash: digest("offline recipe"),
          definitionHash: digest("offline definition"),
          inputHash: digest("offline input"),
          rendererVersion: WEB_DESIGN_RENDERER_VERSION,
          designProfile: profile,
        },
        providerReceipt: receipt,
      },
    ),
  );
  const { projectId, version, contentHash } = draft;
  const id = { projectId, version };
  const identity = { ...id, contentHash };
  const preview = await owner.query(api.webProjects.getVersion, id);
  expect(preview?.browserQualityReady).toBe(false);
  expect(preview?.artifacts).toEqual(
    expected.map((a) => ({ ...a, byteLength: encode(a.html).byteLength })),
  );
  expect(await stranger.query(api.webProjects.getVersion, id)).toBeNull();
  expect((await t.fetch(`/p/${slug}/home`)).status).toBe(404);
  await expect(owner.mutation(api.webProjects.approveVersion, identity)).rejects.toThrow(
    "DESIGN_REVIEW_REQUIRED",
  );
  if (!preview) throw Error("Missing private version");
  await t.run((ctx) =>
    ctx.db.patch(preview._id, {
      browserReview: {
        status: "passed",
        contentHash,
        artifactHashes: receipt.artifactHashes,
        providerReceiptHash: providerReceiptHash(receipt),
        reportHash: digest("OFFLINE TEST ONLY browser result"),
        checkedAt: Date.now(),
      },
    }),
  );
  await expect(
    owner.mutation(api.webProjects.publishVersion, {
      ...identity,
      expectedRevision: draft.revision,
    }),
  ).resolves.toMatchObject({ ok: false, code: "NOT_APPROVED" });
  const approved = await owner.mutation(api.webProjects.approveVersion, identity);
  await expect(
    owner.mutation(api.webProjects.publishVersion, {
      ...identity,
      expectedRevision: approved.revision,
    }),
  ).resolves.toMatchObject({ ok: true });
  for (const artifact of expected) {
    const response = await t.fetch(`/p/${slug}/${artifact.pageSlug}`);
    expect(response.status).toBe(200);
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(encode(artifact.html));
  }
});
