import { convexTest } from "convex-test";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import aggregateSchema from "../node_modules/@convex-dev/aggregate/src/component/schema.js";
import { api, internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);
const aggregates = import.meta.glob(
  "../node_modules/@convex-dev/aggregate/src/component/**/!(*.test).ts",
);
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

async function harness() {
  const t = convexTest(schema, modules);
  t.registerComponent("auditCounts", aggregateSchema, aggregates);
  const user = await t.run((ctx) => ctx.db.insert("users", {}));
  const requestId = await t.run((ctx) =>
    ctx.db.insert("requests", {
      tenantId: String(user),
      correlationId: "delivery-test",
      goal: "Test",
      recipient: "test@example.com",
      draft: "Test",
      status: "delivering",
      attachmentRefs: [],
      createdAt: Date.now(),
    }),
  );
  return { t, as: t.withIdentity({ subject: `${user}|session` }), requestId };
}

test("only the first claim may send; an uncertain replay never opens a second attempt", async () => {
  const { t, requestId } = await harness();
  expect(await t.mutation(internal.delivery.claim, { requestId, provider: "google" })).toEqual({
    proceed: true,
  });
  expect(await t.mutation(internal.delivery.claim, { requestId, provider: "google" })).toEqual({
    proceed: false,
    result: { delivered: false, reason: "outcome_unknown" },
  });
  await t.mutation(internal.delivery.markUnknown, { requestId });
  await t.mutation(internal.delivery.markUnknown, { requestId });
  expect(await t.run((ctx) => ctx.db.query("notifications").collect())).toHaveLength(1);
  expect(await t.mutation(internal.delivery.claim, { requestId, provider: "google" })).toEqual({
    proceed: false,
    result: { delivered: false, reason: "outcome_unknown" },
  });
});

test("confirmation and audit are idempotent; watchdog cannot downgrade a receipt", async () => {
  const { t, requestId } = await harness();
  await t.mutation(internal.delivery.claim, { requestId, provider: "google" });
  await t.mutation(internal.delivery.confirm, { requestId, messageId: "receipt-1" });
  await t.mutation(internal.delivery.confirm, { requestId, messageId: "receipt-1" });
  await t.mutation(internal.delivery.markUnknown, { requestId });
  expect(await t.mutation(internal.delivery.claim, { requestId, provider: "google" })).toEqual({
    proceed: false,
    result: { delivered: true, messageId: "receipt-1" },
  });
  expect(await t.run((ctx) => ctx.db.query("audit").collect())).toHaveLength(1);
});

test("competing send workers share one durable claim", async () => {
  const { t, requestId } = await harness();
  const results = await Promise.all([
    t.mutation(internal.delivery.claim, { requestId, provider: "google" }),
    t.mutation(internal.delivery.claim, { requestId, provider: "google" }),
  ]);
  expect(results.filter((result) => result.proceed)).toHaveLength(1);
  expect((await t.query(internal.delivery.receipt, { requestId }))?.state).toBe("in_flight");
});

test("manual reconciliation is tenant-scoped, delayed, revision-bound and never reopens delivery", async () => {
  const { t, as, requestId } = await harness();
  await t.mutation(internal.delivery.claim, { requestId, provider: "microsoft" });
  await t.mutation(internal.delivery.markUnknown, { requestId });
  const attempt = await t.query(internal.delivery.receipt, { requestId });
  if (!attempt) throw Error("missing attempt");
  const args = { requestId, startedAt: attempt.startedAt, outcome: "not_sent" as const };
  await expect(as.mutation(api.delivery.reconcile, args)).rejects.toThrow(
    "DELIVERY_REVIEW_TOO_EARLY",
  );
  vi.setSystemTime(Date.now() + 601_000);
  await expect(
    t.withIdentity({ subject: "other|session" }).mutation(api.delivery.reconcile, args),
  ).rejects.toThrow("NOT_FOUND");
  await expect(as.mutation(api.delivery.reconcile, { ...args, startedAt: 0 })).rejects.toThrow(
    "STALE_DELIVERY_REVIEW",
  );
  await as.mutation(api.delivery.reconcile, args);
  await as.mutation(api.delivery.reconcile, args);
  expect((await t.run((ctx) => ctx.db.get(requestId)))?.status).toBe("failed");
  expect(
    (await t.mutation(internal.delivery.claim, { requestId, provider: "microsoft" })).proceed,
  ).toBe(false);
  expect(await t.run((ctx) => ctx.db.query("audit").collect())).toHaveLength(1);
});
