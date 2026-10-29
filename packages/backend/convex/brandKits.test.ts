import { convexTest } from "convex-test";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import aggregateSchema from "../node_modules/@convex-dev/aggregate/src/component/schema.js";
import workflowSchema from "../node_modules/@convex-dev/workflow/src/component/schema.js";
import workpoolSchema from "../node_modules/@convex-dev/workpool/src/component/schema.js";
import { api, internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);
const aggregateModules = import.meta.glob(
  "../node_modules/@convex-dev/aggregate/src/component/**/!(*.test).ts",
);
const workflowModules = import.meta.glob(
  "../node_modules/@convex-dev/workflow/src/component/**/!(*.test).ts",
);
const workpoolModules = import.meta.glob(
  "../node_modules/@convex-dev/workpool/src/component/**/!(*.test).ts",
);
const kit = {
  name: "Forma",
  tagline: "Everyday form",
  audience: "Design lovers",
  positioning: "Thoughtful daily objects",
  voice: ["Clear"],
  palette: [
    { name: "Ink", hex: "#111111" },
    { name: "Paper", hex: "#ffffff" },
  ],
  typography: { heading: "Arial", body: "Arial" },
  logoDirection: "Wordmark",
  imagery: "Product close-ups",
  motion: "Slow upward camera rise",
  examples: ["Meet Forma"],
  prohibitedClaims: ["Unverified sustainability"],
};
function setup() {
  const t = convexTest(schema, modules);
  t.registerComponent("auditCounts", aggregateSchema, aggregateModules);
  t.registerComponent("workflow", workflowSchema, workflowModules);
  t.registerComponent("workflow/workpool", workpoolSchema, workpoolModules);
  return t;
}
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());
test("drafts never enter Vault or grounding; stale edits and cross-tenant approval fail", async () => {
  const t = setup(),
    a = t.withIdentity({ subject: "brand_a" }),
    b = t.withIdentity({ subject: "brand_b" });
  const draft = await a.mutation(api.brandKits.saveDraft, { expectedRevision: 0, kit });
  expect(await t.run((ctx) => ctx.db.query("vaultDocuments").collect())).toHaveLength(0);
  expect(await t.query(internal.brandKits.activeForTenant, { tenantId: "brand_a" })).toBeNull();
  expect((await b.query(api.brandKits.state, {})).draft).toBeNull();
  await expect(
    b.mutation(api.brandKits.approve, { revision: draft.revision, reviewHash: draft.reviewHash }),
  ).rejects.toThrow("STALE_BRAND_KIT");
  await expect(a.mutation(api.brandKits.saveDraft, { expectedRevision: 0, kit })).rejects.toThrow(
    "STALE_BRAND_KIT",
  );
  await expect(
    a.mutation(api.brandKits.approve, { revision: 1, reviewHash: "wrong" }),
  ).rejects.toThrow("STALE_BRAND_KIT");
});
test("exact approval publishes once; revisions stay inactive until approved and deleted sources fail closed", async () => {
  const t = setup(),
    a = t.withIdentity({ subject: "brand_a" });
  const draft = await a.mutation(api.brandKits.saveDraft, { expectedRevision: 0, kit });
  const args = { revision: draft.revision, reviewHash: draft.reviewHash };
  const docId = await a.mutation(api.brandKits.approve, args);
  expect(await a.mutation(api.brandKits.approve, args)).toBe(docId);
  const first = await t.query(internal.brandKits.activeForTenant, { tenantId: "brand_a" });
  expect(first?.kit.name).toBe("Forma");
  expect(await t.query(internal.brandKits.spineForTenant, { tenantId: "brand_a" })).toContain(
    "CURRENT APPROVED BRAND IDENTITY",
  );
  await a.mutation(api.brandKits.saveDraft, {
    expectedRevision: 1,
    kit: { ...kit, name: "Different" },
  });
  expect((await t.query(internal.brandKits.activeForTenant, { tenantId: "brand_a" }))?.docId).toBe(
    docId,
  );
  await a.mutation(api.brandKits.discard, { revision: 2 });
  expect((await a.query(api.brandKits.state, {})).revision).toBe(3);
  expect((await a.query(api.brandKits.state, {})).active?.kit.name).toBe("Forma");
  await t.run((ctx) => ctx.db.delete(docId));
  expect(await t.query(internal.brandKits.spineForTenant, { tenantId: "brand_a" })).toBeNull();
});

test("replacement approval preserves history and late generation cannot replace a human edit", async () => {
  const t = setup(),
    a = t.withIdentity({ subject: "brand_a" });
  const first = await a.mutation(api.brandKits.saveDraft, { expectedRevision: 0, kit });
  const firstDoc = await a.mutation(api.brandKits.approve, {
    revision: first.revision,
    reviewHash: first.reviewHash,
  });
  const next = await a.mutation(api.brandKits.saveDraft, {
    expectedRevision: 1,
    kit: { ...kit, name: "Second" },
  });
  await expect(
    t.mutation(internal.brandKits.saveGeneratedDraft, {
      tenantId: "brand_a",
      expectedRevision: 1,
      kit,
    }),
  ).rejects.toThrow("STALE_BRAND_KIT");
  const nextDoc = await a.mutation(api.brandKits.approve, {
    revision: next.revision,
    reviewHash: next.reviewHash,
  });
  expect(nextDoc).not.toBe(firstDoc);
  expect((await t.run((ctx) => ctx.db.get(firstDoc)))?.text).toContain("Forma");
  const active = await t.query(internal.brandKits.activeForTenant, { tenantId: "brand_a" });
  expect(active?.docId).toBe(nextDoc);
  expect(active?.kit.name).toBe("Second");
  expect(await t.query(internal.brandKits.spineForTenant, { tenantId: "brand_a" })).not.toContain(
    '"name": "Forma"',
  );
});
