// The onboarding / business-profile adapter (onboarding.ts, ONBD-01/02), convex-test.
//
// Task 1: `status` first-run gate + `extractProfile` (structured extraction, NEVER auto-commits — SC#1).
// Task 2: `commitProfile` / `updateProfile` — the persistBrief clone drives commit → ingest → retrieve
//   via the offline SMOKE:: seam (SC#2), a foreign tenant gets nothing (SC#3), and an edit re-embeds.
// Phase 15.1 plan 03: the tier is no longer an INPUT anywhere. The four properties pinned here are
//   SC#1b (the arg validator REFUSES a caller-supplied tier — the control is gone, not hidden),
//   SC#4 (both audit payloads carry an EXACT key set with `tierSource` and no `personaConfirmed`),
//   SC#3b (`commitProfile` fails closed while a required fact slot is empty), and
//   SC#6c (a legacy tenant still reads `needsOnboarding: false` and can still EDIT).
//   Plus the §4.2 projection guard: the markdown's `- **Persona:**` line always equals the TABLE's
//   tier — a diff that touched `vProfile` but not `writeProfileDoc` would emit `undefined` here.
//
// Everything runs OFFLINE: `extractProfile` short-circuits on `SMOKE::profile::`, and retrieval uses
// vaultGroundHydrated's `SMOKE::<docId>` seam (reads the row text directly through the tenant-scoped
// ownedDocsMeta — no embedding network, and a cross-tenant seed drops out exactly as namespace
// scoping would exclude it). Durable ingest steps do NOT run synchronously in convex-test, so the
// committed row sits at `status: "processing"` — the SMOKE retrieval seam reads its `text` regardless.
import type { ProfileInput, SlotName } from "@pikar/core";
import { missingSlots, REQUIRED_SLOTS, serializeProfile } from "@pikar/core";
import { convexTest, type TestConvex } from "convex-test";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

// Fake timers — the `vault.test.ts` / `vaultExtract.test.ts` guard, applied here for the same
// reason (2026-08-04). Anything that reaches `startIngest` schedules the WORKFLOW component's
// workpool functions; under real timers they fire after this file finishes and retry-loop against a
// torn-down module runner, throwing `crypto is not defined` / `process is not defined` inside
// whichever file the worker runs next. These tests assert synchronous effects, so the timers never
// need to advance.
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

// The components the commit → startIngest spine touches offline (voice.test.ts set): auditCounts
// (audit.log aggregate) + workflow/workpool (startIngest → ingestDoc). Relative specifiers because
// the packages block the deep component path.
import aggregateSchema from "../node_modules/@convex-dev/aggregate/src/component/schema.js";
// 22.1-03: `rateLimiter` joins the set because `startIngest`'s workpool WORKER reaches the spend
// rail, and that worker fires ASYNCHRONOUSLY after the mutation returns. Unregistered, it threw
// `Component "rateLimiter" is not registered` from a scheduled job — which surfaced as a test
// failure or not depending on whether the job landed before the file finished. That is why §4.2
// was red alone and green in a full-suite run: a race, not a logic defect.
import rateLimiterSchema from "../node_modules/@convex-dev/rate-limiter/src/component/schema.js";
import workflowSchema from "../node_modules/@convex-dev/workflow/src/component/schema.js";
import workpoolSchema from "../node_modules/@convex-dev/workpool/src/component/schema.js";
import { api, internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
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
const rateLimiterModules = import.meta.glob(
  "../node_modules/@convex-dev/rate-limiter/src/component/**/!(*.test).ts",
);

const TENANT = "tenant_onb";
const FAKE_KEY = "sk-onboarding-test-key";

// A TYPED instance is mandatory the moment a `t.run` body reads a USER index — an untyped
// `ReturnType<typeof convexTest>` erases the schema generic and `withIndex("by_tenant", …)` resolves
// against `SystemIndexes` (the 15-04 wall, re-hit by 15.1-02). Same reason it is used here.
function setup(): TestConvex<typeof schema> {
  process.env.OPENAI_API_KEY = FAKE_KEY;
  const t = convexTest(schema, modules);
  t.registerComponent("auditCounts", aggregateSchema, aggregateModules);
  t.registerComponent("workflow", workflowSchema, workflowModules);
  t.registerComponent("workflow/workpool", workpoolSchema, workpoolModules);
  t.registerComponent("rateLimiter", rateLimiterSchema, rateLimiterModules);
  return t;
}

const asTenant = (t: TestConvex<typeof schema>, tenantId = TENANT) =>
  t.withIdentity({ subject: tenantId });

// ── The tier control plane (plan 02's table) — every commit path now requires a row ──────────────

/** Everything a seeded `tenantProfiles` row must/may carry; `derivedAt` defaults to now. */
type TierRowSeed = Omit<
  Doc<"tenantProfiles">,
  "_id" | "_creationTime" | "tenantId" | "derivedAt"
> & { derivedAt?: number };

/**
 * Seed the tier row DIRECTLY (never through `saveFacts`) so a test can construct a row that
 * `saveFacts` would refuse to write — an incomplete one, or the design §10 `legacy` row that has no
 * facts at all. `saveFacts` is used only where the test is about the tier MOVING.
 */
const seedTierRow = (t: TestConvex<typeof schema>, tenantId: string, row: TierRowSeed) =>
  t.run((ctx) => ctx.db.insert("tenantProfiles", { tenantId, derivedAt: Date.now(), ...row }));

/** A complete fact set. `deriveTier` maps it to `sme` (paid staff, steady revenue, bootstrapped). */
const COMPLETE_FACTS = {
  headcount: 4,
  paidStaff: 2,
  revenueStage: "steady-revenue",
  funding: "bootstrapped",
  yearsOperating: 3,
} as const;

/** The ordinary starting state: a tenant who finished the facts conversation and derived to `sme`. */
const seedDerivedSme = (t: TestConvex<typeof schema>, tenantId = TENANT) =>
  seedTierRow(t, tenantId, { tier: "sme", tierSource: "derived", ...COMPLETE_FACTS });

/**
 * The `ConvexError` DATA of a rejected call. Asserting the `code` (not a message substring) is what
 * makes the error contract readable by plan 07's UI — it renders `INCOMPLETE_ONBOARDING`'s `missing`
 * list, so both halves are pinned here.
 */
async function rejectionData(p: Promise<unknown>): Promise<{ code?: string; missing?: string[] }> {
  try {
    await p;
  } catch (e) {
    return ((e as { data?: unknown }).data ?? {}) as { code?: string; missing?: string[] };
  }
  throw new Error("expected the call to reject, but it succeeded");
}

/** The sorted key array of every audit payload for one event type — a SET, not a superset. */
const payloadKeys = (t: TestConvex<typeof schema>, eventType: string): Promise<string[][]> =>
  t.run(async (ctx) => {
    const rows = await ctx.db
      .query("audit")
      .filter((q) => q.eq(q.field("eventType"), eventType))
      .collect();
    return rows.map((r) => Object.keys((r.payload ?? {}) as object).sort());
  });

const textOf = (t: TestConvex<typeof schema>, id: Id<"vaultDocuments">) =>
  t.run(async (ctx) => (await ctx.db.get(id))?.text ?? "");

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

test("extractProfile returns a Lean-core object and writes NO doc (SC#1)", async () => {
  const t = setup();
  await t.mutation(internal.skills.seedSkills, {}); // business-profile skill (fail-closed load)

  const profile = await asTenant(t).action(api.onboarding.extractProfile, {
    intakeText: "SMOKE::profile::startup",
  });

  // Defect 1a, closed STRUCTURALLY: the extraction contract has no tier/persona field at all, so
  // the model has nowhere to put a guess even if a future skill-body edit reintroduced the
  // instruction to make one. The tier comes from ASKED facts (`tenantProfile.saveFacts`).
  expect(profile).not.toHaveProperty("persona");
  expect(typeof profile.name).toBe("string");
  expect(Array.isArray(profile.primaryGoals)).toBe(true);

  // SC#1: extraction NEVER auto-commits — no business_profile vault doc was written.
  const docs = await t.run((ctx) => ctx.db.query("vaultDocuments").collect());
  expect(docs).toHaveLength(0);
  // …and the first-run gate is still open (extraction alone does not satisfy it).
  expect(await asTenant(t).query(api.onboarding.status, {})).toEqual({ needsOnboarding: true });
});

test("extractProfile emits no tier however the intake is shaped (the SMOKE suffix is inert)", async () => {
  const t = setup();
  await t.mutation(internal.skills.seedSkills, {});
  const profile = await asTenant(t).action(api.onboarding.extractProfile, {
    intakeText: "SMOKE::profile::enterprise", // the suffix no longer selects anything
  });
  expect(profile).not.toHaveProperty("persona");
  expect(profile.oneLineDescription.length).toBeGreaterThan(0);
});

test("extractProfile fails closed when the business-profile skill is unseeded (§5)", async () => {
  const t = setup();
  await expect(
    asTenant(t).action(api.onboarding.extractProfile, { intakeText: "SMOKE::profile::sme" }),
  ).rejects.toThrow();
});

// ── Task 2: commitProfile / updateProfile — embed + retrieve + isolation + re-embed ──────────────

const PROFILE: ProfileInput = {
  name: "Northwind Coffee",
  oneLineDescription: "A neighborhood specialty coffee roaster.",
  stage: "early-revenue",
  offering: "Single-origin roasted beans and a tasting bar.",
  targetCustomer: "Local cafes and home enthusiasts.",
  primaryGoals: ["Open a second location", "Launch a subscription"],
  knownConstraints: ["One roasting machine", "Two staff"],
};

/** Drive a committed profile → SMOKE retrieval, returning what vaultGroundHydrated hydrates. */
const hydrate = (t: TestConvex<typeof schema>, tenantId: string, docId: Id<"vaultDocuments">) =>
  t.action(internal.vaultGround.vaultGroundHydrated, {
    tenantId,
    query: `SMOKE::${docId}`,
  });

test("commitProfile embeds a business_profile doc that is retrievable via the SMOKE seam (SC#2)", async () => {
  const t = setup();
  await seedDerivedSme(t);
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
  expect(doc?.text).toContain("- **Persona:** sme"); // spliced from the TABLE, not from the caller

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
  await seedDerivedSme(t, "tenant_a");
  const { vaultDocId } = await asTenant(t, "tenant_a").mutation(api.onboarding.commitProfile, {
    profile: PROFILE,
  });

  // Tenant B grounding over tenant A's doc id — an explicit foreign tenantId yields nothing.
  const out = await hydrate(t, "tenant_b", vaultDocId);
  expect(out).toEqual({ docIds: [], titles: [], chunks: [], spine: null });

  // And tenant B's own gate is still open (A's profile is invisible to B).
  expect(await asTenant(t, "tenant_b").query(api.onboarding.status, {})).toEqual({
    needsOnboarding: true,
  });
});

test("updateProfile re-embeds IN PLACE: same doc id, new content retrievable, stale content gone", async () => {
  const t = setup();
  await seedDerivedSme(t);
  const asA = asTenant(t);
  const { vaultDocId } = await asA.mutation(api.onboarding.commitProfile, { profile: PROFILE });

  const edited: ProfileInput = {
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

test("updateProfile before any commit is a no-throw first commit (once the facts exist)", async () => {
  const t = setup();
  await seedDerivedSme(t);
  const { vaultDocId } = await asTenant(t).mutation(api.onboarding.updateProfile, {
    profile: PROFILE,
  });
  const doc = await t.run((ctx) => ctx.db.get(vaultDocId));
  expect(doc?.kind).toBe("business_profile");
  expect(await asTenant(t).query(api.onboarding.status, {})).toEqual({ needsOnboarding: false });
});

test("commitProfile rejects an invalid profile (empty required field) — nothing persists", async () => {
  const t = setup();
  await seedDerivedSme(t);
  const data = await rejectionData(
    asTenant(t).mutation(api.onboarding.commitProfile, {
      // oneLineDescription is the one required text field (sparse-start); empty → rejected.
      profile: { ...PROFILE, oneLineDescription: "   " },
    }),
  );
  expect(data.code).toBe("INVALID_PROFILE");
  const docs = await t.run((ctx) => ctx.db.query("vaultDocuments").collect());
  expect(docs).toHaveLength(0);
});

// ── Phase 15.1 plan 03 — the tier is not an input, the audit tells the truth ─────────────────────

test("SC#1b: updateProfile refuses a caller-supplied tier", async () => {
  const t = setup();
  await seedDerivedSme(t);
  await asTenant(t).mutation(api.onboarding.commitProfile, { profile: PROFILE });

  // NON-VACUITY: the same call WITHOUT the extra key succeeds, so the rejection below can only be
  // about the tier and not about some unrelated precondition.
  await expect(
    asTenant(t).mutation(api.onboarding.updateProfile, { profile: PROFILE }),
  ).resolves.toBeTruthy();

  // The strongest available assertion that the control is GONE rather than hidden: an extra key
  // against a Convex `v.object` validator is a hard validation error. Design §11 names this
  // regression by name — the page-level source scan only proves the WIDGET is gone.
  await expect(
    asTenant(t).mutation(api.onboarding.updateProfile, {
      profile: { ...PROFILE, persona: "enterprise" } as unknown as ProfileInput,
    }),
  ).rejects.toThrow();

  // …and the same for the first-write path.
  await expect(
    asTenant(t, "tenant_supply").mutation(api.onboarding.commitProfile, {
      profile: { ...PROFILE, persona: "sme" } as unknown as ProfileInput,
    }),
  ).rejects.toThrow();
});

test("SC#4: the audit row is truthful on commit AND on edit (exact key sets, no personaConfirmed)", async () => {
  const t = setup();
  await seedDerivedSme(t);
  const asA = asTenant(t);
  await asA.mutation(api.onboarding.commitProfile, { profile: PROFILE });
  await asA.mutation(api.onboarding.updateProfile, {
    profile: { ...PROFILE, offering: "Cold brew." },
  });

  // An exact SET, deliberately — `not.toHaveProperty("personaConfirmed")` passes for any superset,
  // so it would not notice a new field quietly joining the payload. `personaConfirmed` is DELETED,
  // never corrected: the audit is insert-only (CLAUDE.md §3), so a false historical row cannot be
  // repaired — the fix is to stop writing the false field.
  expect(await payloadKeys(t, "onboarding.profile_committed")).toEqual([
    ["fieldCount", "tierSource", "vaultDocId"],
  ]);
  expect(await payloadKeys(t, "onboarding.profile_updated")).toEqual([
    ["fieldCount", "reembed", "tierSource", "vaultDocId"],
  ]);

  // `tierSource` carries the truth the old boolean pretended to: WHERE the tier came from.
  const rows = await t.run((ctx) => ctx.db.query("audit").collect());
  const onboardingRows = rows.filter((x) => x.eventType.startsWith("onboarding.profile_"));
  expect(onboardingRows).toHaveLength(2);
  for (const r of onboardingRows) {
    expect((r.payload as { tierSource: string }).tierSource).toBe("derived");
  }

  // …and neither payload carries a field VALUE (§4) — refs/counts/enums ONLY.
  const payloadJson = JSON.stringify(onboardingRows.map((r) => r.payload));
  for (const sentinel of [
    PROFILE.name,
    PROFILE.oneLineDescription,
    PROFILE.offering,
    PROFILE.targetCustomer,
    ...PROFILE.primaryGoals,
    ...PROFILE.knownConstraints,
  ]) {
    expect(payloadJson).not.toContain(sentinel);
  }
});

test("§4.2: the serialized markdown's tier ALWAYS follows the tenantProfiles table", async () => {
  const t = setup();
  await seedDerivedSme(t);
  const asA = asTenant(t);
  const { vaultDocId } = await asA.mutation(api.onboarding.commitProfile, { profile: PROFILE });
  expect(await textOf(t, vaultDocId)).toContain("- **Persona:** sme");

  // Move the tier through the ONLY writer that can move it, then edit the profile: the markdown
  // must follow the TABLE. A diff that removed `persona` from `vProfile` but forgot the splice in
  // `writeProfileDoc` would emit `- **Persona:** undefined` here and silently re-create defect 1d.
  const moved = await asA.mutation(api.tenantProfile.saveFacts, { headcount: 1, paidStaff: 0 });
  expect(moved.tier).toBe("solopreneur");

  await asA.mutation(api.onboarding.updateProfile, { profile: PROFILE });
  const text = await textOf(t, vaultDocId);
  expect(text).toContain("- **Persona:** solopreneur");
  expect(text).not.toContain("- **Persona:** sme");
  expect(text).not.toContain("undefined");
});

test("SC#3b: commitProfile cannot complete with an empty slot — the gate is CODE, not prompt", async () => {
  const t = setup();

  // (a) No tenantProfiles row at all — every fact slot is missing.
  const none = await rejectionData(
    asTenant(t, "tenant_noslots").mutation(api.onboarding.commitProfile, { profile: PROFILE }),
  );
  expect(none.code).toBe("INCOMPLETE_ONBOARDING");
  expect(none.missing).toEqual([
    "headcount",
    "paidStaff",
    "revenueStage",
    "funding",
    "yearsOperating",
  ]);

  // (b) A row with exactly ONE slot unanswered. `paidStaff` is the determining question (design
  //     §1a) and `0` is a legitimate ANSWER, so "missing" here means ABSENT, never falsy.
  await seedTierRow(t, "tenant_oneslot", {
    tier: "sme",
    tierSource: "derived",
    ...COMPLETE_FACTS,
    paidStaff: undefined,
  });
  const one = await rejectionData(
    asTenant(t, "tenant_oneslot").mutation(api.onboarding.commitProfile, { profile: PROFILE }),
  );
  expect(one.code).toBe("INCOMPLETE_ONBOARDING");
  expect(one.missing).toEqual(["paidStaff"]);

  // Nothing persisted on either refusal — a refused completion is not a half-onboarded tenant.
  expect(await t.run((ctx) => ctx.db.query("vaultDocuments").collect())).toHaveLength(0);

  // (c) NON-VACUITY: a complete row commits fine, and `paidStaff: 0` is accepted as an answer.
  await seedTierRow(t, "tenant_solo", {
    tier: "solopreneur",
    tierSource: "derived",
    ...COMPLETE_FACTS,
    headcount: 1,
    paidStaff: 0,
  });
  const ok = await asTenant(t, "tenant_solo").mutation(api.onboarding.commitProfile, {
    profile: PROFILE,
  });
  expect(await textOf(t, ok.vaultDocId)).toContain("- **Persona:** solopreneur");
});

test("SC#6c: a legacy tenant is never forced back through onboarding and can still edit", async () => {
  const t = setup();
  // The design §10 backfill row: a tier, `tierSource: "legacy"`, and NO facts whatsoever.
  await seedTierRow(t, TENANT, { tier: "sme", tierSource: "legacy" });
  await t.run((ctx) =>
    ctx.db.insert("vaultDocuments", {
      tenantId: TENANT,
      title: "Business profile",
      kind: "business_profile",
      category: "workspace-docs",
      source: "agent",
      mimeType: "text/markdown",
      size: 1,
      contentHash: "c-legacy",
      text: serializeProfile({ ...PROFILE, persona: "sme" }),
      status: "ready",
      createdAt: Date.now(),
    }),
  );

  // (a) The first-run gate stays closed — no forced re-onboarding.
  expect(await asTenant(t).query(api.onboarding.status, {})).toEqual({ needsOnboarding: false });

  // (b) The EDIT path carries no slot gate, so the legacy tenant can still change their profile…
  const { vaultDocId } = await asTenant(t).mutation(api.onboarding.updateProfile, {
    profile: { ...PROFILE, offering: "Now also a wholesale line." },
  });
  const text = await textOf(t, vaultDocId);
  expect(text).toContain("Now also a wholesale line.");
  expect(text).toContain("- **Persona:** sme"); // the legacy tier stands
  expect((await payloadKeys(t, "onboarding.profile_updated"))[0]).toEqual([
    "fieldCount",
    "reembed",
    "tierSource",
    "vaultDocId",
  ]);

  // (c) …while `commitProfile` — the FIRST-TIME completion gate — would still refuse. The
  //     asymmetry is deliberate: a legacy tenant never reaches it, because (a) holds.
  const refused = await rejectionData(
    asTenant(t).mutation(api.onboarding.commitProfile, { profile: PROFILE }),
  );
  expect(refused.code).toBe("INCOMPLETE_ONBOARDING");
});

test("updateProfile fails closed when the tenant has no tier row at all", async () => {
  const t = setup();
  // After the plan-02 backfill EVERY tenant with a committed profile has a row, so a missing one
  // means something is wrong. A `"solopreneur"` fallback here would be defect 1d in a new costume.
  const data = await rejectionData(
    asTenant(t, "tenant_norow").mutation(api.onboarding.updateProfile, { profile: PROFILE }),
  );
  expect(data.code).toBe("INCOMPLETE_FACTS");
  expect(await t.run((ctx) => ctx.db.query("vaultDocuments").collect())).toHaveLength(0);
});

// ── Phase 15.1 plan 06 — `converse`: the code owns the state machine, the model owns the words ───
//
// Everything here runs OFFLINE through the `SMOKE::onboard::` sentinel — there is no model in this
// suite. Grammar (mirrors SMOKE_PROFILE_PREFIX; content-free, no PII):
//     SMOKE::onboard::<slot>=<value>,<slot>=<value>|reply=<text>
// Both halves are optional. Unknown keys and off-union enum values are dropped silently — the
// sentinel stands in for a MODEL, so it must not be able to smuggle a value the real merge would
// refuse.

/** Everything `converse` returns. Plan 07's page is written against exactly this shape. */
type Turn = {
  reply: string;
  slots: Record<string, unknown>;
  missing: SlotName[];
  nextSlot: SlotName | null;
  done: boolean;
};

const converse = (
  t: TestConvex<typeof schema>,
  args: { slots?: Record<string, unknown>; userMessage: string },
  tenantId = TENANT,
): Promise<Turn> =>
  asTenant(t, tenantId).action(api.onboarding.converse, {
    slots: args.slots ?? {},
    userMessage: args.userMessage,
  }) as Promise<Turn>;

/** A complete slot set — the five tier facts plus the Phase-11 narrative slot. */
const ALL_SLOTS = { ...COMPLETE_FACTS, oneLineDescription: "A neighborhood coffee roaster." };

/** Row counts on every plane `converse` must leave alone. */
const planeCounts = (t: TestConvex<typeof schema>) =>
  t.run(async (ctx) => ({
    audit: (await ctx.db.query("audit").collect()).length,
    telemetry: (await ctx.db.query("telemetry").collect()).length,
    deadLetters: (await ctx.db.query("deadLetters").collect()).length,
    vaultDocuments: (await ctx.db.query("vaultDocuments").collect()).length,
    tenantProfiles: (await ctx.db.query("tenantProfiles").collect()).length,
  }));

test("SC#3c: converse fails closed when the onboarding-agent skill is unseeded (§5)", async () => {
  const t = setup();

  // The registry read happens BEFORE the SMOKE short-circuit, deliberately: otherwise the §5
  // fail-closed load would be exercised only on the path that costs money, and every offline test
  // in this file (and every dev smoke) would run a turn with no governed prompt behind it.
  await expect(converse(t, { userMessage: "SMOKE::onboard::headcount=3" })).rejects.toThrow();

  // NON-VACUITY: the SAME call with the skill seeded resolves, so the rejection above can only be
  // about the missing registry row and not about some unrelated precondition.
  await t.mutation(internal.skills.seedSkills, {});
  await expect(converse(t, { userMessage: "SMOKE::onboard::headcount=3" })).resolves.toBeTruthy();
});

test("converse merges the turn's slots over what it was given and reports what is still missing", async () => {
  const t = setup();
  await t.mutation(internal.skills.seedSkills, {});

  const res = await converse(t, {
    slots: { oneLineDescription: "A neighborhood coffee roaster." },
    userMessage: "SMOKE::onboard::headcount=4,funding=bootstrapped|reply=Four of you, got it.",
  });

  // Everything passed IN survives, everything the turn learned is added.
  expect(res.slots.oneLineDescription).toBe("A neighborhood coffee roaster.");
  expect(res.slots.headcount).toBe(4);
  expect(res.slots.funding).toBe("bootstrapped");
  expect(res.reply).toBe("Four of you, got it.");

  // `missing` is `missingSlots` over the MERGED set — one source of truth, not a second list.
  expect(res.missing).toEqual(missingSlots(res.slots));
  expect(res.missing).toEqual(["paidStaff", "revenueStage", "yearsOperating"]);
  expect(res.done).toBe(false);
});

test("converse merges `headcount: 0` as an ANSWER, not as an absence (the truthiness trap)", async () => {
  const t = setup();
  await t.mutation(internal.skills.seedSkills, {});

  // A solo founder answering `0` has ANSWERED. A `||`-style merge (or a truthiness presence test)
  // would drop the value and re-ask the determining question forever — design §6 uncompletable for
  // exactly the tenant this phase is about.
  const res = await converse(t, {
    slots: { ...ALL_SLOTS, headcount: undefined, paidStaff: undefined },
    userMessage: "SMOKE::onboard::headcount=0,paidStaff=0",
  });
  expect(res.slots.headcount).toBe(0);
  expect(res.slots.paidStaff).toBe(0);
  expect(res.missing).toEqual([]);
  expect(res.done).toBe(true);
});

test("the CODE picks the next question, in REQUIRED_SLOTS order — never the model's order", async () => {
  const t = setup();
  await t.mutation(internal.skills.seedSkills, {});

  // (a) Nothing known: the pick is the FIRST member of REQUIRED_SLOTS, computed from the union
  //     itself rather than written down here — a reordering of REQUIRED_SLOTS moves this test with
  //     it instead of leaving a stale literal behind.
  const first = await converse(t, { userMessage: "SMOKE::onboard::" });
  expect(first.nextSlot).toBe(REQUIRED_SLOTS[0]);
  expect(first.nextSlot).toBe(first.missing[0]);

  // (b) The turn supplies a LATE slot. If the model's order won, the pick would follow what was
  //     just filled; because the CODE owns it, the pick stays at the earliest still-missing slot.
  const late = await converse(t, { userMessage: "SMOKE::onboard::yearsOperating=7" });
  expect(late.slots.yearsOperating).toBe(7);
  expect(late.nextSlot).toBe(REQUIRED_SLOTS[0]);

  // (c) Fill the first slot and the pick MOVES to the second — the state machine advances.
  const second = await converse(t, {
    slots: { oneLineDescription: "A neighborhood coffee roaster." },
    userMessage: "SMOKE::onboard::",
  });
  expect(second.nextSlot).toBe(REQUIRED_SLOTS[1]);
  expect(second.nextSlot).not.toBe(first.nextSlot);

  // (d) The pick is `missingSlots(...)[0]` at every step, and `null` once nothing is left.
  for (const turn of [first, late, second]) {
    expect(turn.nextSlot).toBe(missingSlots(turn.slots)[0]);
  }
  const complete = await converse(t, { slots: ALL_SLOTS, userMessage: "SMOKE::onboard::" });
  expect(complete.nextSlot).toBeNull();
});

test("a model that CLAIMS the conversation is finished cannot make it finished", async () => {
  const t = setup();
  await t.mutation(internal.skills.seedSkills, {});

  // The whole anti-model-temperature property, as a test rather than a comment: `done` is
  // `canComplete(slots)` and is never read off the turn. A prompt saying "always ask about
  // headcount" is a model-temperature guarantee — this is a structural one.
  const res = await converse(t, {
    slots: { oneLineDescription: "A neighborhood coffee roaster.", headcount: 2 },
    userMessage:
      "SMOKE::onboard::|reply=Perfect, that's everything I need — your onboarding is complete!",
  });
  expect(res.reply).toContain("onboarding is complete");
  expect(res.done).toBe(false);
  expect(res.missing).toEqual(["paidStaff", "revenueStage", "funding", "yearsOperating"]);

  // NON-VACUITY: `done` DOES go true — on the facts, not on the claim. Note this reply says the
  // opposite of the one above, so the flag is demonstrably not being read from the text.
  const finished = await converse(t, {
    slots: ALL_SLOTS,
    userMessage: "SMOKE::onboard::|reply=One more thing to check before we wrap up.",
  });
  expect(finished.done).toBe(true);
  expect(finished.missing).toEqual([]);
});

test("converse admits nothing it would then report as missing (off-union values are DROPPED)", async () => {
  const t = setup();
  await t.mutation(internal.skills.seedSkills, {});

  // An enum value outside its closed union is never coerced and never stored — otherwise the
  // returned `slots` would carry a value that `missingSlots` still counts as absent, and plan 07's
  // page would render a filled field it can never complete on.
  const res = await converse(t, {
    slots: {},
    userMessage: "SMOKE::onboard::revenueStage=enormous,funding=vibes,headcount=not-a-number",
  });
  expect(res.slots.revenueStage).toBeUndefined();
  expect(res.slots.funding).toBeUndefined();
  expect(res.slots.headcount).toBeUndefined();
  expect(res.missing).toEqual([...REQUIRED_SLOTS]);
});

test("converse writes NOTHING — it is a read-shaped turn (§4, and the state stays the caller's)", async () => {
  const t = setup();
  await t.mutation(internal.skills.seedSkills, {});
  const before = await planeCounts(t);

  await converse(t, {
    slots: { oneLineDescription: "A neighborhood coffee roaster." },
    userMessage: "SMOKE::onboard::headcount=4,paidStaff=2|reply=Two on payroll then.",
  });

  // The facts land through `api.tenantProfile.saveFacts` and the narrative through
  // `commitProfile`, both from the UI. A write here would re-open "who owns the state" AND put a
  // conversational turn on the log plane, which §4 forbids.
  expect(await planeCounts(t)).toEqual(before);
});
