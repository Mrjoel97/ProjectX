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
import type { BusinessProfile } from "@pikar/core";
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

// ── Task 2: commitProfile / updateProfile — embed + retrieve + isolation + re-embed ──────────────

const PROFILE: BusinessProfile = {
  name: "Northwind Coffee",
  oneLineDescription: "A neighborhood specialty coffee roaster.",
  persona: "sme",
  stage: "early-revenue",
  offering: "Single-origin roasted beans and a tasting bar.",
  targetCustomer: "Local cafes and home enthusiasts.",
  primaryGoals: ["Open a second location", "Launch a subscription"],
  knownConstraints: ["One roasting machine", "Two staff"],
};

/** Drive a committed profile → SMOKE retrieval, returning what vaultGroundHydrated hydrates. */
const hydrate = (t: ReturnType<typeof convexTest>, tenantId: string, docId: Id<"vaultDocuments">) =>
  t.action(internal.vaultGround.vaultGroundHydrated, {
    tenantId,
    query: `SMOKE::${docId}`,
  });

test("commitProfile embeds a business_profile doc that is retrievable via the SMOKE seam (SC#2)", async () => {
  const t = setup();
  const { vaultDocId } = await asTenant(t).mutation(api.onboarding.commitProfile, {
    profile: PROFILE,
  });

  // The row landed as a business_profile / agent vault doc with the serialized profile as its text.
  const doc = await t.run((ctx) => ctx.db.get(vaultDocId));
  expect(doc?.kind).toBe("business_profile");
  expect(doc?.source).toBe("agent");
  expect(doc?.mimeType).toBe("text/markdown");
  expect(doc?.status).toBe("processing"); // ingest workflow armed (durable steps run in vaultIngest's own tests)
  expect(doc?.text).toContain("Northwind Coffee");
  expect(doc?.text).toContain("sme");

  // The gate has flipped closed — a committed profile satisfies needsOnboarding.
  expect(await asTenant(t).query(api.onboarding.status, {})).toEqual({ needsOnboarding: false });

  // SC#2: the offline SMOKE grounding seam returns the doc with its serialized content.
  const { docIds, chunks } = await hydrate(t, TENANT, vaultDocId);
  expect(docIds).toContain(vaultDocId);
  const i = docIds.indexOf(vaultDocId);
  expect(chunks[i]).toContain("Single-origin roasted beans");
});

test("cross-tenant: tenant B never retrieves tenant A's committed profile (SC#3)", async () => {
  const t = setup();
  const { vaultDocId } = await asTenant(t, "tenant_a").mutation(api.onboarding.commitProfile, {
    profile: PROFILE,
  });

  // Tenant B grounding over tenant A's doc id — an explicit foreign tenantId yields nothing.
  const out = await hydrate(t, "tenant_b", vaultDocId);
  expect(out).toEqual({ docIds: [], titles: [], chunks: [] });

  // And tenant B's own gate is still open (A's profile is invisible to B).
  expect(await asTenant(t, "tenant_b").query(api.onboarding.status, {})).toEqual({
    needsOnboarding: true,
  });
});

test("updateProfile re-embeds IN PLACE: same doc id, new content retrievable, stale content gone", async () => {
  const t = setup();
  const asA = asTenant(t);
  const { vaultDocId } = await asA.mutation(api.onboarding.commitProfile, { profile: PROFILE });

  const edited: BusinessProfile = {
    ...PROFILE,
    offering: "Cold-brew concentrate and a mobile espresso cart.",
  };
  const res = await asA.mutation(api.onboarding.updateProfile, { profile: edited });

  // Re-embed on the SAME row (stable doc id — the profile is one doc per tenant).
  expect(res.vaultDocId).toBe(vaultDocId);
  const doc = await t.run((ctx) => ctx.db.get(vaultDocId));
  expect(doc?.status).toBe("processing"); // re-ingest armed
  expect(doc?.text).toContain("Cold-brew concentrate"); // new content
  expect(doc?.text).not.toContain("Single-origin roasted beans"); // stale content replaced

  // Grounding returns the updated content (still exactly one profile doc for the tenant).
  const { docIds, chunks } = await hydrate(t, TENANT, vaultDocId);
  const i = docIds.indexOf(vaultDocId);
  expect(chunks[i]).toContain("Cold-brew concentrate");
  const profileDocs = await t.run((ctx) =>
    ctx.db
      .query("vaultDocuments")
      .filter((q) => q.eq(q.field("kind"), "business_profile"))
      .collect(),
  );
  expect(profileDocs).toHaveLength(1);
});

test("updateProfile before any commit is a no-throw first commit", async () => {
  const t = setup();
  const { vaultDocId } = await asTenant(t).mutation(api.onboarding.updateProfile, {
    profile: PROFILE,
  });
  const doc = await t.run((ctx) => ctx.db.get(vaultDocId));
  expect(doc?.kind).toBe("business_profile");
  expect(await asTenant(t).query(api.onboarding.status, {})).toEqual({ needsOnboarding: false });
});

test("commitProfile writes ONE refs/counts-only audit row — no profile field values (§4, SC#4)", async () => {
  const t = setup();
  const { vaultDocId } = await asTenant(t).mutation(api.onboarding.commitProfile, {
    profile: PROFILE,
  });

  const rows = await t.run((ctx) =>
    ctx.db
      .query("audit")
      .filter((q) => q.eq(q.field("eventType"), "onboarding.profile_committed"))
      .collect(),
  );
  expect(rows).toHaveLength(1);
  const payload = JSON.stringify(rows[0]?.payload);
  // Refs/counts/booleans present…
  expect(payload).toContain(vaultDocId);
  expect(payload).toContain("fieldCount");
  expect(payload).toContain("personaConfirmed");
  // …but NO profile prose or field value (§4).
  for (const sentinel of [
    PROFILE.name,
    PROFILE.oneLineDescription,
    PROFILE.offering,
    PROFILE.targetCustomer,
    ...PROFILE.primaryGoals,
    ...PROFILE.knownConstraints,
  ]) {
    expect(payload).not.toContain(sentinel);
  }
});

test("commitProfile rejects an invalid profile (empty required field) — nothing persists", async () => {
  const t = setup();
  await expect(
    asTenant(t).mutation(api.onboarding.commitProfile, {
      // oneLineDescription is the one required text field (sparse-start); empty → rejected.
      profile: { ...PROFILE, oneLineDescription: "   " },
    }),
  ).rejects.toThrow();
  const docs = await t.run((ctx) => ctx.db.query("vaultDocuments").collect());
  expect(docs).toHaveLength(0);
});
