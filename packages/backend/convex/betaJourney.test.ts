import { makeFunctionReference } from "convex/server";
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.*s");
const record = makeFunctionReference<
  "mutation",
  {
    tenantId: string;
    eventType: "session_started";
    idempotencyKey: string;
    occurredAt: number;
  },
  string
>("betaJourney:record");
const history = makeFunctionReference<"query", { limit?: number }, Array<Record<string, unknown>>>(
  "betaJourney:history",
);

describe("beta journey persistence", () => {
  test("records refs-only events once per tenant key and scopes bounded history", async () => {
    const t = convexTest(schema, modules);
    const args = {
      tenantId: "journey-a",
      eventType: "session_started" as const,
      idempotencyKey: "session:one",
      occurredAt: 10,
    };
    const first = await t.mutation(record, args);
    const second = await t.mutation(record, args);
    expect(second).toBe(first);
    await t.mutation(record, { ...args, idempotencyKey: "session:two", occurredAt: 20 });
    await t.mutation(record, {
      ...args,
      tenantId: "journey-b",
      idempotencyKey: "session:one",
      occurredAt: 30,
    });
    const rows = await t
      .withIdentity({ subject: "journey-a|session" })
      .query(history, { limit: 500 });
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.eventType)).toEqual(["session_started", "session_started"]);
    expect(Object.keys(rows[0] ?? {}).sort()).toEqual([
      "approvalId",
      "auditId",
      "eventType",
      "occurredAt",
      "planId",
      "requestId",
      "terminalOutcome",
    ]);
  });

  test("records only an eligible offer mount and makes it idempotent", async () => {
    const t = convexTest(schema, modules);
    const userId = await t.run((ctx) => ctx.db.insert("users", { email: "owner@example.test" }));
    const asUser = t.withIdentity({ subject: `${userId}|session` });
    await expect(asUser.mutation(api.betaJourney.recordFirstOfferShown, {})).rejects.toThrow(
      "FIRST_SEND_OFFER_INELIGIBLE",
    );
    await t.run((ctx) =>
      ctx.db.insert("vaultDocuments", {
        tenantId: userId,
        title: "Profile",
        kind: "business_profile",
        category: "general",
        source: "onboarding",
        mimeType: "text/markdown",
        size: 1,
        contentHash: "profile-hash",
        status: "ready",
        createdAt: 1,
      }),
    );
    const first = await asUser.mutation(api.betaJourney.recordFirstOfferShown, {});
    const retry = await asUser.mutation(api.betaJourney.recordFirstOfferShown, {});
    expect(retry).toBe(first);
  });

  test("records postal recovery only for an owned plan after the fact exists", async () => {
    const t = convexTest(schema, modules);
    const userId = await t.run((ctx) => ctx.db.insert("users", { email: "owner@example.test" }));
    const otherId = await t.run((ctx) => ctx.db.insert("users", { email: "other@example.test" }));
    const planId = await t.run((ctx) =>
      ctx.db.insert("plans", {
        tenantId: userId,
        threadId: "recovery-thread",
        status: "proposed",
        createdAt: 1,
      }),
    );
    const asUser = t.withIdentity({ subject: `${userId}|session` });
    const asOther = t.withIdentity({ subject: `${otherId}|session` });
    const args = { planId, prerequisite: "postal_address" as const };
    await expect(
      asUser.mutation(api.betaJourney.recordPrerequisiteRecovered, args),
    ).rejects.toThrow("PREREQUISITE_NOT_RECOVERED");
    await expect(
      asOther.mutation(api.betaJourney.recordPrerequisiteRecovered, args),
    ).rejects.toThrow("PLAN_NOT_FOUND");
    await t.run((ctx) =>
      ctx.db.insert("tenantProfiles", {
        tenantId: userId,
        tier: "solopreneur",
        tierSource: "derived",
        derivedAt: 1,
        postalAddress: "1 Example Street, Test City",
      }),
    );
    const first = await asUser.mutation(api.betaJourney.recordPrerequisiteRecovered, args);
    expect(await asUser.mutation(api.betaJourney.recordPrerequisiteRecovered, args)).toBe(first);
  });

  test("joins bounded journey events to settled spend without fabricating zero cost", async () => {
    const t = convexTest(schema, modules);
    const userId = await t.run((ctx) => ctx.db.insert("users", {}));
    const asUser = t.withIdentity({ subject: `${userId}|session` });
    await t.mutation(record, {
      tenantId: userId,
      eventType: "session_started",
      idempotencyKey: "session:metrics",
      occurredAt: 10,
    });
    const unknown = await asUser.query(api.betaJourney.metrics, { sinceMs: 0, untilMs: 100 });
    expect(unknown.costPerActiveUser).toMatchObject({ state: "unavailable" });

    await t.run(async (ctx) => {
      await ctx.db.insert("betaJourneyEvents", {
        tenantId: userId,
        eventType: "admission_succeeded",
        idempotencyKey: "admit:metrics",
        occurredAt: 20,
      });
      await ctx.db.insert("betaJourneyEvents", {
        tenantId: userId,
        eventType: "delivery_sent",
        idempotencyKey: "sent:metrics",
        occurredAt: 30,
        terminalOutcome: "sent",
      });
      await ctx.db.insert("spendCoverage", { tenantId: userId, coverageStartedAt: 0 });
      await ctx.db.insert("spendEvents", {
        tenantId: userId,
        rail: "reasoning",
        phase: "actual",
        amountCents: 250,
        correlationId: "metrics:actual",
        createdAt: 25,
      });
    });
    const measured = await asUser.query(api.betaJourney.metrics, { sinceMs: 0, untilMs: 100 });
    expect(measured.firstResultLatency).toEqual({ state: "available", value: 10 });
    expect(measured.costPerActiveUser).toEqual({ state: "available", value: 2.5 });
  });
});
