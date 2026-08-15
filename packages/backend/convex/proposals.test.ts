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
