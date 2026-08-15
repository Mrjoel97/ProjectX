// One row per SOURCE EVENT (design §3.1), holding the N facts derived from it. Items are
// EMBEDDED, not a child table (see schema.ts comment on `proposals`) — these two tests guard the
// round-trip and the honest-empty-result case, nothing else. A LATER task appends more tests here.
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
// `audit.log` maintains the auditCounts aggregate (audit.ts), so the component must be registered
// or `acceptProposal`'s finance branch (which always reaches `applyFinanceClaims` ->
// `internal.audit.log`) throws `Component "auditCounts" is not registered`. Same idiom as
// cash.test.ts's `withAudit()`.
import aggregateSchema from "../node_modules/@convex-dev/aggregate/src/component/schema.js";
// A successful profile write reaches `writeProfileDoc` -> `startIngest`, which schedules the
// WORKFLOW component's workpool functions (onboarding.test.ts's `setup()` idiom) — unregistered,
// that throws `Component "workflow" is not registered`, not a useful assertion failure.
import rateLimiterSchema from "../node_modules/@convex-dev/rate-limiter/src/component/schema.js";
import workflowSchema from "../node_modules/@convex-dev/workflow/src/component/schema.js";
import workpoolSchema from "../node_modules/@convex-dev/workpool/src/component/schema.js";
import { api } from "./_generated/api";
import { latestScorecardRow } from "./evaluations";
import schema from "./schema";

// convex-test discovers Convex function modules via import.meta.glob. Exclude
// *.test.ts so the harness does not try to load the test files themselves (audit.test.ts idiom).
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

function withAudit() {
  const t = convexTest(schema, modules);
  t.registerComponent("auditCounts", aggregateSchema, aggregateModules);
  return t;
}

/** Registers every component a real profile write touches (`writeProfileDoc` -> `startIngest`),
 *  mirroring onboarding.test.ts's `setup()`. Fake timers pair with it — see that file's comment:
 *  under real timers the scheduled workpool worker fires after the test finishes and throws
 *  against a torn-down module runner. */
function withIngest() {
  const t = convexTest(schema, modules);
  t.registerComponent("workflow", workflowSchema, workflowModules);
  t.registerComponent("workflow/workpool", workpoolSchema, workpoolModules);
  t.registerComponent("rateLimiter", rateLimiterSchema, rateLimiterModules);
  return t;
}

// Fake timers, file-wide — onboarding.test.ts's guard (2026-08-04), needed here too now that one
// test (the successful profile-proposal accept) reaches `startIngest`.
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

// Match cash.test.ts's identity helper exactly.
const asTenant = (t: ReturnType<typeof convexTest>, userId: string) =>
  t.withIdentity({ subject: `${userId}|session`, issuer: "test" });

const cacFact = {
  target: { store: "scorecard" as const, field: "cac" },
  value: 340,
  confidence: "high" as const,
  origin: "stated" as const,
  actor: "agent" as const,
  basis: "vaultDoc:doc123",
  observedAt: 1_650_000_000_000,
  sourceLocator: { kind: "vault_doc" as const, vaultDocId: "doc123" },
};

const profileFact = {
  target: { store: "profile" as const, field: "oneLineDescription" },
  value: "A bakery in Nairobi",
  confidence: "high" as const,
  origin: "stated" as const,
  actor: "agent" as const,
  basis: "vaultDoc:doc123",
  observedAt: 1_650_000_000_000,
  sourceLocator: { kind: "vault_doc" as const, vaultDocId: "doc123" },
};

/** A profile fact that targets a field OTHER than `oneLineDescription` — the mid-onboarding
 *  finding-1 scenario needs a batch that omits the one required string, so a blank skeleton merged
 *  with it is genuinely invalid. */
const stageFact = {
  ...profileFact,
  target: { store: "profile" as const, field: "stage" },
  value: "early-revenue",
};

/** Seed a `tenantProfiles` row directly — the tier facts a mid-onboarding tenant has already saved,
 *  independent of whether a `business_profile` vault doc exists yet. Mirrors onboarding.test.ts's
 *  `seedTierRow`. */
const seedTierRow = (t: ReturnType<typeof convexTest>, tenantId: string) =>
  t.run((ctx) =>
    ctx.db.insert("tenantProfiles", {
      tenantId,
      tier: "sme" as const,
      tierSource: "derived" as const,
      headcount: 4,
      paidStaff: 2,
      revenueStage: "steady-revenue" as const,
      funding: "bootstrapped" as const,
      yearsOperating: 3,
      derivedAt: 1_700_000_000_000,
    }),
  );

async function seedProposal(t: ReturnType<typeof convexTest>, tenantId: string, items: unknown[]) {
  return t.run((ctx) =>
    ctx.db.insert("proposals", {
      tenantId,
      createdAt: 1_700_000_000_000,
      sourceKind: "vault_doc" as const,
      sourceRef: "doc123",
      status: "pending" as const,
      items: items as never,
    }),
  );
}

test("a proposals row round-trips with its items", async () => {
  const t = convexTest(schema, modules);
  const id = await t.run((ctx) =>
    ctx.db.insert("proposals", {
      tenantId: "u1",
      createdAt: 1_700_000_000_000,
      sourceKind: "vault_doc" as const,
      sourceRef: "doc123",
      status: "pending" as const,
      items: [
        {
          target: { store: "scorecard" as const, field: "cac" },
          value: 340,
          confidence: "high" as const,
          origin: "stated" as const,
          actor: "agent" as const,
          basis: "vaultDoc:doc123",
          observedAt: 1_650_000_000_000,
          sourceLocator: { kind: "vault_doc" as const, vaultDocId: "doc123" },
        },
      ],
    }),
  );
  const row = await t.run((ctx) => ctx.db.get(id));
  expect(row?.items).toHaveLength(1);
  expect(row?.items[0]?.target.field).toBe("cac");
  expect(row?.status).toBe("pending");
});

// Round trip 1 tests exactly ONE literal per union (confidence:"high", origin:"stated",
// actor:"agent", sourceLocator.kind:"vault_doc"). A validator that silently dropped any OTHER
// member would still pass that test and typecheck clean — typecheck only guards table
// EXISTENCE, not union completeness. This test exercises every remaining member at least once,
// table-driven so a new union member is one array entry, not a new test block.
test("every union member round-trips through the validator", async () => {
  const t = convexTest(schema, modules);

  // Mirrors the `items[]` element shape as the FULL union space (not `typeof baseItem`, which
  // would narrow every field to its one seed literal and make every other variant a type error).
  type Item = {
    target: {
      store: "financeInputs" | "scorecard" | "profile" | "contacts" | "followUps";
      field: string;
    };
    value: number | string | boolean;
    confidence: "high" | "medium" | "low";
    origin: "stated" | "observed";
    actor: "user" | "agent";
    basis: string;
    observedAt: number;
    sourceLocator:
      | { kind: "vault_doc"; vaultDocId: string }
      | { kind: "chat"; threadId: string }
      | { kind: "voice"; voiceSessionId: string };
  };
  const baseItem: Item = {
    target: { store: "scorecard", field: "cac" },
    value: 340,
    confidence: "high",
    origin: "stated",
    actor: "agent",
    basis: "vaultDoc:doc123",
    observedAt: 1_650_000_000_000,
    sourceLocator: { kind: "vault_doc", vaultDocId: "doc123" },
  };
  const baseRow = {
    tenantId: "u1",
    createdAt: 1_700_000_000_000,
    sourceKind: "vault_doc" as const,
    sourceRef: "doc123",
    status: "pending" as const,
    items: [baseItem],
  };

  const itemVariants: Array<[string, Partial<Item>]> = [
    ["confidence:high", { confidence: "high" }],
    ["confidence:medium", { confidence: "medium" }],
    ["confidence:low", { confidence: "low" }],
    ["origin:stated", { origin: "stated" }],
    ["origin:observed", { origin: "observed" }],
    ["actor:user", { actor: "user" }],
    ["actor:agent", { actor: "agent" }],
    ["store:financeInputs", { target: { store: "financeInputs", field: "x" } }],
    ["store:scorecard", { target: { store: "scorecard", field: "x" } }],
    ["store:profile", { target: { store: "profile", field: "x" } }],
    ["store:contacts", { target: { store: "contacts", field: "x" } }],
    ["store:followUps", { target: { store: "followUps", field: "x" } }],
    ["locator:vault_doc", { sourceLocator: { kind: "vault_doc", vaultDocId: "d1" } }],
    ["locator:chat", { sourceLocator: { kind: "chat", threadId: "t1" } }],
    ["locator:voice", { sourceLocator: { kind: "voice", voiceSessionId: "v1" } }],
  ];
  for (const [label, override] of itemVariants) {
    const item = { ...baseItem, ...override };
    const id = await t.run((ctx) => ctx.db.insert("proposals", { ...baseRow, items: [item] }));
    const row = await t.run((ctx) => ctx.db.get(id));
    expect(row?.items[0], label).toEqual(item);
  }

  const statuses = ["pending", "accepted", "discarded", "superseded"] as const;
  for (const status of statuses) {
    const id = await t.run((ctx) => ctx.db.insert("proposals", { ...baseRow, status }));
    const row = await t.run((ctx) => ctx.db.get(id));
    expect(row?.status, `status:${status}`).toBe(status);
  }

  const sourceKinds = ["vault_doc", "chat", "voice"] as const;
  for (const sourceKind of sourceKinds) {
    const id = await t.run((ctx) => ctx.db.insert("proposals", { ...baseRow, sourceKind }));
    const row = await t.run((ctx) => ctx.db.get(id));
    expect(row?.sourceKind, `sourceKind:${sourceKind}`).toBe(sourceKind);
  }
});

test("an empty items array is storable — a source that yielded nothing is a real outcome", async () => {
  const t = convexTest(schema, modules);
  const id = await t.run((ctx) =>
    ctx.db.insert("proposals", {
      tenantId: "u1",
      createdAt: 1_700_000_000_000,
      sourceKind: "chat" as const,
      sourceRef: "thread1",
      status: "discarded" as const,
      items: [],
    }),
  );
  expect((await t.run((ctx) => ctx.db.get(id)))?.items).toEqual([]);
});

describe("acceptProposal", () => {
  test("accepting a blank scorecard fact applies it with honest provenance", async () => {
    const t = withAudit();
    const proposalId = await seedProposal(t, "u1", [cacFact]);
    const result = await asTenant(t, "u1").mutation(api.proposals.acceptProposal, {
      proposalId,
      acceptedIndices: [0],
    });
    expect(result).toMatchObject({ ok: true, applied: 1 });
    // Finding 2: nothing previously asserted on `result.guards` — the ONLY place the tally is
    // observable, since it never gates a write. Nothing was stored for "u1" before this accept, so
    // this must classify as `blank`.
    if (result.ok) expect(result.guards).toEqual({ blank: 1, overwrite: 0, stale: 0 });
    const row = await t.run((ctx) => latestScorecardRow(ctx.db, "u1"));
    expect(row?.scorecard.financials.cac).toBe(340);
    expect(row?.fieldProvenance?.["financials.cac"]?.actor).toBe("agent");
    expect(row?.userProvided).not.toContain("financials.cac");
  });

  // Finding 2: the `blank` case above cannot catch a broken `current` derivation on its own — a
  // guard that always reported `blank` would still pass it. This seeds a USER-STATED figure first
  // (via `cash.saveInput`, the ungated human write path) and proposes a value over it, so the only
  // correct classification is `overwrite`. `observedAt` is captured AFTER `saveInput` returns (so it
  // is never older than `saveInput`'s own stamp — not `stale`) and never in the future relative to
  // `applyFinanceClaims`'s own `Date.now()` check a moment later (`validateFigureClaim` refuses a
  // future `observedAt` outright) — `Date.now()` is monotonic, so a value taken strictly between the
  // two calls satisfies both bounds without guessing an offset.
  test("guards tally: a proposal over a user-stated figure classifies as overwrite, not blank", async () => {
    const t = withAudit();
    await asTenant(t, "u5").mutation(api.cash.saveInput, { field: "cac", value: 100 });
    const observedAt = Date.now();
    const proposalId = await seedProposal(t, "u5", [{ ...cacFact, observedAt }]);
    const result = await asTenant(t, "u5").mutation(api.proposals.acceptProposal, {
      proposalId,
      acceptedIndices: [0],
    });
    expect(result).toMatchObject({ ok: true });
    if (result.ok) expect(result.guards).toEqual({ blank: 0, overwrite: 1, stale: 0 });
  });

  test("actor is STAMPED, never read from the row", async () => {
    const t = withAudit();
    // A stored item claiming the OWNER said it. The applier must overwrite that.
    const proposalId = await seedProposal(t, "u1", [{ ...cacFact, actor: "user" as const }]);
    await asTenant(t, "u1").mutation(api.proposals.acceptProposal, {
      proposalId,
      acceptedIndices: [0],
    });
    const row = await t.run((ctx) => latestScorecardRow(ctx.db, "u1"));
    expect(row?.fieldProvenance?.["financials.cac"]?.actor).toBe("agent");
    expect(row?.userProvided).not.toContain("financials.cac");
  });

  test("an index outside the items array refuses rather than applying a partial batch", async () => {
    const t = convexTest(schema, modules);
    const proposalId = await seedProposal(t, "u1", [cacFact]);
    const result = await asTenant(t, "u1").mutation(api.proposals.acceptProposal, {
      proposalId,
      acceptedIndices: [0, 7],
    });
    expect(result).toMatchObject({ ok: false, reason: "unknown_item" });
    const row = await t.run((ctx) => latestScorecardRow(ctx.db, "u1"));
    expect(row).toBeNull();
  });

  test("a target absent from the registry refuses", async () => {
    const t = convexTest(schema, modules);
    const bad = { ...cacFact, target: { store: "scorecard" as const, field: "notAField" } };
    const proposalId = await seedProposal(t, "u1", [bad]);
    const result = await asTenant(t, "u1").mutation(api.proposals.acceptProposal, {
      proposalId,
      acceptedIndices: [0],
    });
    expect(result).toMatchObject({ ok: false, reason: "unknown_target" });
  });

  test("accepting marks the proposal accepted; a second accept is a no-op", async () => {
    const t = withAudit();
    const proposalId = await seedProposal(t, "u1", [cacFact]);
    await asTenant(t, "u1").mutation(api.proposals.acceptProposal, {
      proposalId,
      acceptedIndices: [0],
    });
    const second = await asTenant(t, "u1").mutation(api.proposals.acceptProposal, {
      proposalId,
      acceptedIndices: [0],
    });
    expect(second).toMatchObject({ ok: false, reason: "not_pending" });
  });

  test("another tenant cannot accept this tenant's proposal", async () => {
    const t = convexTest(schema, modules);
    const proposalId = await seedProposal(t, "u1", [cacFact]);
    const result = await asTenant(t, "u2").mutation(api.proposals.acceptProposal, {
      proposalId,
      acceptedIndices: [0],
    });
    expect(result).toMatchObject({ ok: false, reason: "not_found" });
  });

  // Ruling 3 (fix round 1): a profile proposal for a tenant with no `tenantProfiles` row must
  // refuse rather than fabricate a `persona`. No `tenantProfiles` seed here — that IS the case
  // under test.
  test("a profile proposal for a tenant with no tier row refuses incomplete_facts, writing nothing", async () => {
    const t = convexTest(schema, modules);
    const proposalId = await seedProposal(t, "u3", [profileFact]);
    const result = await asTenant(t, "u3").mutation(api.proposals.acceptProposal, {
      proposalId,
      acceptedIndices: [0],
    });
    expect(result).toMatchObject({ ok: false, reason: "incomplete_facts" });
    const docs = await t.run((ctx) =>
      ctx.db
        .query("vaultDocuments")
        .withIndex("by_tenant_kind", (q) => q.eq("tenantId", "u3").eq("kind", "business_profile"))
        .collect(),
    );
    expect(docs).toHaveLength(0);
    const row = await t.run((ctx) => ctx.db.get(proposalId));
    expect(row?.status).toBe("pending");
  });

  // Fix round 2, finding A: the profile-only test above cannot catch a gate sitting in the WRONG
  // pass — it never reaches the finance branch at all. A MIXED batch is the only way to prove the
  // tier gate runs before any writer, not just before the profile writer: `withAudit()` because the
  // pre-fix code (gate inside PASS 2, after the finance block) would actually reach
  // `applyFinanceClaims` -> `internal.audit.log` here.
  test("a mixed finance+profile batch for a tenant with no tier row refuses incomplete_facts, writing NEITHER half", async () => {
    const t = withAudit();
    const proposalId = await seedProposal(t, "u4", [cacFact, profileFact]);
    const result = await asTenant(t, "u4").mutation(api.proposals.acceptProposal, {
      proposalId,
      acceptedIndices: [0, 1],
    });
    expect(result).toMatchObject({ ok: false, reason: "incomplete_facts" });
    // Zero finance rows: the scorecard field never landed.
    const scorecardRow = await t.run((ctx) => latestScorecardRow(ctx.db, "u4"));
    expect(scorecardRow).toBeNull();
    // Zero financeInputs rows either, for completeness (this fact targets scorecard, but the
    // invariant under test is "the finance writer never ran at all").
    const financeInputRows = await t.run((ctx) =>
      ctx.db
        .query("financeInputs")
        .withIndex("by_tenant", (q) => q.eq("tenantId", "u4"))
        .collect(),
    );
    expect(financeInputRows).toHaveLength(0);
    // Zero audit rows: `applyFinanceClaims`'s `finance.claims_applied` insert never ran either.
    const auditRows = await t.run((ctx) => ctx.db.query("audit").collect());
    expect(auditRows).toHaveLength(0);
    // Zero profile docs, same as the profile-only test.
    const docs = await t.run((ctx) =>
      ctx.db
        .query("vaultDocuments")
        .withIndex("by_tenant_kind", (q) => q.eq("tenantId", "u4").eq("kind", "business_profile"))
        .collect(),
    );
    expect(docs).toHaveLength(0);
    const row = await t.run((ctx) => ctx.db.get(proposalId));
    expect(row?.status).toBe("pending");
  });

  // Finding 1 (CRITICAL): a tenant mid-onboarding has a `tenantProfiles` row (tier facts saved) but
  // NO profile doc yet. A batch containing only `{store:"profile", field:"stage"}` used to clear
  // PASS 1 (the tier row exists, so `incomplete_facts` never fires), then PASS 2 merged `stage` onto
  // a BLANK skeleton and wrote a `business_profile` vault doc with `oneLineDescription: ""` — a
  // document `commitProfile`/`updateProfile` both refuse to create, because `writeProfileDoc` never
  // called `validateProfile` at all. This test pins the fix: the merged profile is invalid (its one
  // required field, `oneLineDescription`, is empty), so the accept must refuse `invalid_profile` and
  // write ZERO vault docs, leaving the row `pending`.
  test("a profile-only batch that would create a BLANK profile refuses invalid_profile, writing nothing", async () => {
    const t = convexTest(schema, modules);
    await seedTierRow(t, "u6");
    const proposalId = await seedProposal(t, "u6", [stageFact]);
    const result = await asTenant(t, "u6").mutation(api.proposals.acceptProposal, {
      proposalId,
      acceptedIndices: [0],
    });
    expect(result).toMatchObject({ ok: false, reason: "invalid_profile" });
    const docs = await t.run((ctx) =>
      ctx.db
        .query("vaultDocuments")
        .withIndex("by_tenant_kind", (q) => q.eq("tenantId", "u6").eq("kind", "business_profile"))
        .collect(),
    );
    expect(docs).toHaveLength(0);
    const row = await t.run((ctx) => ctx.db.get(proposalId));
    expect(row?.status).toBe("pending");
  });

  // Finding 1, NON-VACUITY: the SAME tier-row setup, but the batch includes `oneLineDescription` too
  // (so the merged profile IS valid) — proves the refusal above is about the missing required field,
  // not about the tier row or the store, and that a genuinely valid mid-onboarding profile proposal
  // still succeeds.
  test("a profile batch that supplies oneLineDescription too creates a valid profile", async () => {
    // withIngest(): a successful profile accept reaches `writeProfileDoc` -> `startIngest`, which
    // needs the workflow/workpool/rateLimiter components registered (see `withIngest`'s comment).
    const t = withIngest();
    await seedTierRow(t, "u7");
    const proposalId = await seedProposal(t, "u7", [stageFact, profileFact]);
    const result = await asTenant(t, "u7").mutation(api.proposals.acceptProposal, {
      proposalId,
      acceptedIndices: [0, 1],
    });
    expect(result).toMatchObject({ ok: true, applied: 2 });
    const docs = await t.run((ctx) =>
      ctx.db
        .query("vaultDocuments")
        .withIndex("by_tenant_kind", (q) => q.eq("tenantId", "u7").eq("kind", "business_profile"))
        .collect(),
    );
    expect(docs).toHaveLength(1);
    expect(docs[0]?.text).toContain("A bakery in Nairobi");
  });

  // Finding 3 (minor): an empty `acceptedIndices` cleared PASS 1 trivially, wrote nothing, and STILL
  // patched `status: "accepted"` — recording as "accepted" a batch where nothing was, and making the
  // row's remaining items permanently unreachable (a later call would return `not_pending`). The fix
  // leaves the row `pending` when nothing was chosen.
  test("an empty acceptedIndices applies nothing and leaves the row pending, not accepted", async () => {
    // withAudit(): the second, real accept below reaches `applyFinanceClaims` -> `internal.audit.log`.
    const t = withAudit();
    const proposalId = await seedProposal(t, "u8", [cacFact]);
    const result = await asTenant(t, "u8").mutation(api.proposals.acceptProposal, {
      proposalId,
      acceptedIndices: [],
    });
    expect(result).toMatchObject({ ok: true, applied: 0, skipped: 0 });
    const row = await t.run((ctx) => ctx.db.get(proposalId));
    expect(row?.status).toBe("pending");
    // Still reachable: a later, real accept on the same row succeeds — proof the row was genuinely
    // left `pending`, not just reported as such.
    const second = await asTenant(t, "u8").mutation(api.proposals.acceptProposal, {
      proposalId,
      acceptedIndices: [0],
    });
    expect(second).toMatchObject({ ok: true, applied: 1 });
    const finalRow = await t.run((ctx) => ctx.db.get(proposalId));
    expect(finalRow?.status).toBe("accepted");
  });

  // Finding 4 (minor): neither a fact's stored `value` nor an `edits[]` override was ever checked
  // against its target's registered `valueType`. A boolean proposed for `cac` (a `"number"` finance
  // target) must refuse `invalid_value_type` rather than reach `applyFinanceClaims` with a
  // type-mismatched claim.
  test("a value that does not match its target's valueType refuses invalid_value_type", async () => {
    const t = convexTest(schema, modules);
    const badFact = { ...cacFact, value: true };
    const proposalId = await seedProposal(t, "u9", [badFact]);
    const result = await asTenant(t, "u9").mutation(api.proposals.acceptProposal, {
      proposalId,
      acceptedIndices: [0],
    });
    expect(result).toMatchObject({ ok: false, reason: "invalid_value_type" });
    const row = await t.run((ctx) => latestScorecardRow(ctx.db, "u9"));
    expect(row).toBeNull();
  });

  // Finding 4, the `edits[]` override path: the STORED item is a legal number, but an accepted edit
  // changes it to a string — the mismatch must be caught on the EDITED value, not the original one.
  test("an edits[] override that breaks valueType refuses invalid_value_type", async () => {
    const t = convexTest(schema, modules);
    const proposalId = await seedProposal(t, "u10", [cacFact]);
    const result = await asTenant(t, "u10").mutation(api.proposals.acceptProposal, {
      proposalId,
      acceptedIndices: [0],
      edits: [{ index: 0, value: "not-a-number" }],
    });
    expect(result).toMatchObject({ ok: false, reason: "invalid_value_type" });
    const row = await t.run((ctx) => latestScorecardRow(ctx.db, "u10"));
    expect(row).toBeNull();
  });
});
