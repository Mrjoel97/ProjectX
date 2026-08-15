// One row per SOURCE EVENT (design §3.1), holding the N facts derived from it. Items are
// EMBEDDED, not a child table (see schema.ts comment on `proposals`) — these two tests guard the
// round-trip and the honest-empty-result case, nothing else. A LATER task appends more tests here.
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
// `audit.log` maintains the auditCounts aggregate (audit.ts), so the component must be registered
// or `acceptProposal`'s finance branch (which always reaches `applyFinanceClaims` ->
// `internal.audit.log`) throws `Component "auditCounts" is not registered`. Same idiom as
// cash.test.ts's `withAudit()`.
import aggregateSchema from "../node_modules/@convex-dev/aggregate/src/component/schema.js";
import { api } from "./_generated/api";
import { latestScorecardRow } from "./evaluations";
import schema from "./schema";

// convex-test discovers Convex function modules via import.meta.glob. Exclude
// *.test.ts so the harness does not try to load the test files themselves (audit.test.ts idiom).
const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);
const aggregateModules = import.meta.glob(
  "../node_modules/@convex-dev/aggregate/src/component/**/!(*.test).ts",
);

function withAudit() {
  const t = convexTest(schema, modules);
  t.registerComponent("auditCounts", aggregateSchema, aggregateModules);
  return t;
}

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
    const row = await t.run((ctx) => latestScorecardRow(ctx.db, "u1"));
    expect(row?.scorecard.financials.cac).toBe(340);
    expect(row?.fieldProvenance?.["financials.cac"]?.actor).toBe("agent");
    expect(row?.userProvided).not.toContain("financials.cac");
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
});
