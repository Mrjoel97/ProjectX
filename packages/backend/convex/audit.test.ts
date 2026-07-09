import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { internal } from "./_generated/api";
import schema from "./schema";

// convex-test discovers Convex function modules via import.meta.glob. Exclude
// *.test.ts so the harness does not try to load the test files themselves.
const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);

// OPSG-02 insert path: internal.audit.log inserts exactly one redaction-safe
// row whose fields round-trip and whose ts is a number.
test("audit.log inserts exactly one row that round-trips", async () => {
  const t = convexTest(schema, modules);

  const args = {
    tenantId: "tenant_a",
    correlationId: "corr_1",
    eventType: "request.received",
    actor: "user_1",
    // Redaction-safe payload — refs/hashes/counts only, never raw content.
    payload: { ref: "doc_123", hash: "sha256:abc", count: 2 },
  };

  await t.mutation(internal.audit.log, args);

  const rows = await t.run(async (ctx) => await ctx.db.query("audit").collect());

  expect(rows).toHaveLength(1);
  const row = rows[0];
  expect(row.tenantId).toBe(args.tenantId);
  expect(row.correlationId).toBe(args.correlationId);
  expect(row.eventType).toBe(args.eventType);
  expect(row.actor).toBe(args.actor);
  expect(row.payload).toEqual(args.payload);
  expect(typeof row.ts).toBe("number");
});
