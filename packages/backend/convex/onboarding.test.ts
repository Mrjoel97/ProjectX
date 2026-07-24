// The onboarding / business-profile adapter (onboarding.ts, ONBD-01/02), convex-test.
//
// Task 1: `status` first-run gate + `extractProfile` (persona inference, NEVER auto-commits — SC#1).
// Task 2: `commitProfile` / `updateProfile` — the persistBrief clone drives commit → ingest → retrieve
//   via the offline SMOKE:: seam (SC#2), a foreign tenant gets nothing (SC#3), and an edit re-embeds.
//
// Everything runs OFFLINE: `extractProfile` short-circuits on `SMOKE::profile::`, and retrieval uses
// vaultGroundHydrated's `SMOKE::<docId>` seam (reads the row text directly through the tenant-scoped
// ownedDocsMeta — no embedding network, and a cross-tenant seed drops out exactly as namespace
// scoping would exclude it). Durable ingest steps do NOT run synchronously in convex-test, so the
// committed row sits at `status: "processing"` — the SMOKE retrieval seam reads its `text` regardless.
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";
// The components the commit → startIngest spine touches offline (voice.test.ts set): auditCounts
// (audit.log aggregate) + workflow/workpool (startIngest → ingestDoc). Relative specifiers because
// the packages block the deep component path.
import aggregateSchema from "../node_modules/@convex-dev/aggregate/src/component/schema.js";
import workflowSchema from "../node_modules/@convex-dev/workflow/src/component/schema.js";
import workpoolSchema from "../node_modules/@convex-dev/workpool/src/component/schema.js";

// @ts-expect-error import.meta.glob is provided by Vite/vitest at runtime.
const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);
// @ts-expect-error import.meta.glob is provided by Vite/vitest at runtime.
const aggregateModules = import.meta.glob("../node_modules/@convex-dev/aggregate/src/component/**/!(*.test).ts");
// @ts-expect-error import.meta.glob is provided by Vite/vitest at runtime.
const workflowModules = import.meta.glob("../node_modules/@convex-dev/workflow/src/component/**/!(*.test).ts");
// @ts-expect-error import.meta.glob is provided by Vite/vitest at runtime.
const workpoolModules = import.meta.glob("../node_modules/@convex-dev/workpool/src/component/**/!(*.test).ts");

const TENANT = "tenant_onb";
const FAKE_KEY = "sk-onboarding-test-key";

function setup(): ReturnType<typeof convexTest> {
  process.env.OPENAI_API_KEY = FAKE_KEY;
  const t = convexTest(schema, modules);
  t.registerComponent("auditCounts", aggregateSchema, aggregateModules);
  t.registerComponent("workflow", workflowSchema, workflowModules);
  t.registerComponent("workflow/workpool", workpoolSchema, workpoolModules);
  return t;
}

const asTenant = (t: ReturnType<typeof convexTest>, tenantId = TENANT) =>
  t.withIdentity({ subject: tenantId });

const PERSONAS = ["solopreneur", "startup", "sme"];

// ── Task 1: status gate + extractProfile (SC#1 no-auto-commit) ───────────────

test("status.needsOnboarding is true for a fresh tenant, false once a business_profile doc exists", async () => {
  const t = setup();
  const fresh = await asTenant(t).query(api.onboarding.status, {});
  expect(fresh).toEqual({ needsOnboarding: true });

  // Seed a committed profile doc directly (kind business_profile, non-failed) → gate flips closed.
  await t.run((ctx) =>
    ctx.db.insert("vaultDocuments", {
      tenantId: TENANT,
      title: "Business profile",
      kind: "business_profile",
      category: "workspace-docs",
      source: "agent",
      mimeType: "text/markdown",
      size: 1,
      contentHash: "c1",
      text: "profile",
      status: "ready",
      createdAt: Date.now(),
    }),
  );
  const after = await asTenant(t).query(api.onboarding.status, {});
  expect(after).toEqual({ needsOnboarding: false });
});

test("status ignores a failed profile ingest (the user must re-commit)", async () => {
  const t = setup();
  await t.run((ctx) =>
    ctx.db.insert("vaultDocuments", {
      tenantId: TENANT,
      title: "Business profile",
      kind: "business_profile",
      category: "workspace-docs",
      source: "agent",
      mimeType: "text/markdown",
      size: 1,
      contentHash: "c1",
      text: "profile",
      status: "failed",
      createdAt: Date.now(),
    }),
  );
  expect(await asTenant(t).query(api.onboarding.status, {})).toEqual({ needsOnboarding: true });
});

test("status is tenant-scoped: another tenant's profile never satisfies this tenant's gate", async () => {
  const t = setup();
  await t.run((ctx) =>
    ctx.db.insert("vaultDocuments", {
      tenantId: "tenant_other",
      title: "Business profile",
      kind: "business_profile",
      category: "workspace-docs",
      source: "agent",
      mimeType: "text/markdown",
      size: 1,
      contentHash: "c1",
      text: "profile",
      status: "ready",
      createdAt: Date.now(),
    }),
  );
  expect(await asTenant(t).query(api.onboarding.status, {})).toEqual({ needsOnboarding: true });
});

test("extractProfile returns a Lean-core object with an allowed persona and writes NO doc (SC#1)", async () => {
  const t = setup();
  await t.mutation(internal.skills.seedSkills, {}); // business-profile skill (fail-closed load)

  const profile = await asTenant(t).action(api.onboarding.extractProfile, {
    intakeText: "SMOKE::profile::startup",
  });

  expect(PERSONAS).toContain(profile.persona);
  expect(profile.persona).toBe("startup"); // the sentinel's persona is honored
  expect(typeof profile.name).toBe("string");
  expect(Array.isArray(profile.primaryGoals)).toBe(true);

  // SC#1: extraction NEVER auto-commits — no business_profile vault doc was written.
  const docs = await t.run((ctx) => ctx.db.query("vaultDocuments").collect());
  expect(docs).toHaveLength(0);
  // …and the first-run gate is still open (extraction alone does not satisfy it).
  expect(await asTenant(t).query(api.onboarding.status, {})).toEqual({ needsOnboarding: true });
});

test("extractProfile persona defaults to a best-fit allowed value (never enterprise)", async () => {
  const t = setup();
  await t.mutation(internal.skills.seedSkills, {});
  const profile = await asTenant(t).action(api.onboarding.extractProfile, {
    intakeText: "SMOKE::profile::enterprise", // not an allowed persona → best-fit fallback
  });
  expect(PERSONAS).toContain(profile.persona);
});

test("extractProfile fails closed when the business-profile skill is unseeded (§5)", async () => {
  const t = setup();
  await expect(
    asTenant(t).action(api.onboarding.extractProfile, { intakeText: "SMOKE::profile::sme" }),
  ).rejects.toThrow();
});

// Reference kept so an unused-symbol lint never masks a missing SC#2/#3 export in Task 2.
export type _ProfileDocId = Id<"vaultDocuments">;
