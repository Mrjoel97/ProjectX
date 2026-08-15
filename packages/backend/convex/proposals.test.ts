// One row per SOURCE EVENT (design §3.1), holding the N facts derived from it. Items are
// EMBEDDED, not a child table (see schema.ts comment on `proposals`) — these two tests guard the
// round-trip and the honest-empty-result case, nothing else. A LATER task appends more tests here.
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import schema from "./schema";

// convex-test discovers Convex function modules via import.meta.glob. Exclude
// *.test.ts so the harness does not try to load the test files themselves (audit.test.ts idiom).
const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);

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
    const id = await t.run((ctx) =>
      ctx.db.insert("proposals", { ...baseRow, items: [item] }),
    );
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
