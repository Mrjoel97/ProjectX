// The Command Center's two read models (HOME-01), tested as BEHAVIOUR.
//
// The two properties this file exists to hold, both of which are silent-failure shaped:
//  1. A SOURCE THAT FAILS IS NEVER THE NUMBER 0. Every assertion below reads the DISCRIMINANT
//     (`unavailable` / `status`), not just a count, because `{ newCount: 0 }` and
//     `{ unavailable: true }` render as very different sentences and only one of them is honest.
//  2. ONE SECTION'S FAILURE MUST NOT ERASE THE OTHERS. Every failure case re-asserts the
//     neighbouring sections' REAL values, so a future "simplification" that collapses the five
//     reads into one try/catch fails here.
//
// Fault injection is done by swapping ONE exported reader in the module map `convexTest` resolves
// from (`brokenSource` below). Nothing in the production module is test-aware, and the swap is
// per-test, so the same file can assert the healthy path and the broken path side by side.
import {
  BLUEPRINT_FIELDS,
  type BusinessBlueprint,
  REVIEW_THREAD_ID,
  serializeBlueprint,
} from "@pikar/core";
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import { tenantQuery } from "./lib/functions";
import schema from "./schema";

const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);

type Modules = typeof modules;

const NOW = 1_800_000_000_000;
const DAY_MS = 24 * 60 * 60 * 1_000;
/** `contacts.pipelineTiles` compares `dueAt` against the REAL clock, so this one seed value must
 *  be a real past instant — a fixed 2027 constant is in the future and counts as not-yet-due. */
const OVERDUE = Date.now() - DAY_MS;
/** `home.health` compares against `Date.now()` too, so STALENESS and IMMINENCE fixtures are
 *  real-clock-relative for the same reason: the fixed 2027 `NOW` is in the future, where every
 *  age is negative and every threshold test silently passes. */
const REAL_NOW = Date.now();
const HOUR_MS = 60 * 60 * 1_000;
/** `home.ts`'s own two bounds, restated here so a fixture sits knowingly on either side. */
const SCHEDULED_PROBE = 50;
const DELIVERED_CAP = 1_000;

/** A reader that throws — a source that is DOWN, not a source that is empty. */
const throwingReader = tenantQuery({
  args: {},
  handler: () => {
    throw new Error("SOURCE_DOWN");
  },
});

/** A reader that answers, but not with the shape the section needs. */
const shapelessReader = tenantQuery({ args: {}, handler: async () => null });

/**
 * `contacts.pipelineTiles` AT its scan bound, in that module's own shape.
 *
 * A stub and not 1 001 seeded rows on purpose: whether `contacts.ts` flips `partial` at row 1 000
 * is CONTACTS' property and is already asserted in `contacts.test.ts`; the property THIS module
 * owns is that a capped answer survives composition as `partial` + reason instead of being
 * rendered as a total. (The 1 001-row version of this test also ran the shared vitest fork hot
 * enough to make an unrelated suite's scheduler assertion flake — a cost with no coverage behind
 * it.) The four counts are deliberately unlike the seeded tenant's, so a pass-through that
 * substituted its own numbers would be visible.
 */
const cappedPipelineReader = tenantQuery({
  args: {},
  handler: async () => ({
    needingAttention: 7,
    followUpsDue: 5,
    consentOnRecord: 3,
    suppressed: 1_000,
    partial: "row-cap" as const,
  }),
});

/** Replace ONE export of ONE convex module for a single `convexTest` instance. */
function brokenSource(path: string, name: string, replacement: unknown): Modules {
  const real = modules[path] as () => Promise<Record<string, unknown>>;
  return { ...modules, [path]: async () => ({ ...(await real()), [name]: replacement }) };
}

async function harness(mods: Modules = modules) {
  const t = convexTest(schema, mods);
  // Real `users` rows and session-suffixed subjects: `requireScope` takes the segment BEFORE the
  // `|`, so a hand-made subject that skips this shape silently tests nothing. `owner: true` on A
  // is what makes the owner/non-owner health comparison below real.
  const ownerId = await t.run((ctx) => ctx.db.insert("users", { owner: true }));
  const memberId = await t.run((ctx) => ctx.db.insert("users", {}));
  return {
    t,
    tenantA: String(ownerId),
    tenantB: String(memberId),
    asA: t.withIdentity({ subject: `${ownerId}|session_a` }),
    asB: t.withIdentity({ subject: `${memberId}|session_b` }),
  };
}

type T = ReturnType<typeof convexTest>;

/**
 * One tenant with a distinct, checkable number in EVERY section:
 * 2 awaiting approvals · 3 delivered sends · 1 blocked item · 1 content artifact ·
 * pipeline 1 needing attention / 1 follow-up due / 1 consent / 1 suppressed.
 * Every number differs from its neighbours so a wire-up that reads the wrong source is visible.
 */
async function seedBusyTenant(t: T, tenantId: string) {
  await t.run(async (ctx) => {
    for (let i = 0; i < 2; i++)
      await ctx.db.insert("plans", {
        tenantId,
        threadId: `${tenantId}-thread-${i}`,
        status: "proposed",
        recipients: ["private@example.com"],
        subject: "Private subject",
        body: "Private body",
        createdAt: NOW - 60_000 * (i + 1),
      });
    for (let i = 0; i < 3; i++)
      await ctx.db.insert("requests", {
        tenantId,
        correlationId: `${tenantId}-corr-${i}`,
        goal: "Private goal",
        recipient: "private@example.com",
        status: "sent",
        attachmentRefs: [],
        createdAt: NOW - 1_000 * i,
      });
    await ctx.db.insert("deadLetters", {
      tenantId,
      correlationId: `${tenantId}-dl`,
      workflowId: "wf_1",
      payload: { ref: "x" },
      error: "boom",
      status: "new",
      createdAt: NOW - 5_000,
    });
    await ctx.db.insert("vaultDocuments", {
      tenantId,
      title: "Private artifact",
      kind: "created_document",
      category: "documents",
      source: "seam",
      mimeType: "text/markdown",
      size: 10,
      contentHash: `${tenantId}-hash`,
      status: "ready",
      createdAt: NOW - 2_000,
    });
    const consented = await ctx.db.insert("contacts", {
      tenantId,
      email: "one@example.com",
      origin: "user-entered",
      consentAt: NOW - 10_000,
      createdAt: NOW - 10_000,
      updatedAt: NOW - 10_000,
    });
    await ctx.db.insert("contacts", {
      tenantId,
      email: "two@example.com",
      origin: "user-entered",
      createdAt: NOW - 9_000,
      updatedAt: NOW - 9_000,
    });
    // Attached to `consented`, and overdue → the other contact is the one "needing attention".
    await ctx.db.insert("followUps", {
      tenantId,
      contactId: consented,
      note: "Private note",
      dueAt: OVERDUE,
      status: "open",
      createdAt: NOW - 9_500,
    });
    await ctx.db.insert("suppressions", {
      tenantId,
      address: "gone@example.com",
      suppressedAt: NOW - 8_000,
      source: "user-marked",
    });
  });
}

/** Every one of the six required health signals satisfied — the only route to `"healthy"`. */
async function seedHealthyTenant(t: T, tenantId: string, withBindingConstraint = true) {
  await t.run(async (ctx) => {
    await ctx.db.insert("gmailTokens", {
      tenantId,
      refreshToken: "refresh",
      scope: "https://www.googleapis.com/auth/gmail.send",
      updatedAt: NOW,
    });
    await ctx.db.insert("evaluations", {
      tenantId,
      threadId: REVIEW_THREAD_ID,
      framework: "growth-os",
      findings: [],
      gaps: [],
      notEnoughData: [],
      scorecard: {},
      userProvided: [],
      verdict: "healthy",
      createdAt: NOW - 1_000,
    });
    const blank = Object.fromEntries(
      BLUEPRINT_FIELDS.map((field) => [field, null]),
    ) as unknown as BusinessBlueprint;
    const docId = await ctx.db.insert("vaultDocuments", {
      tenantId,
      title: "Business blueprint",
      kind: "business_blueprint",
      category: "documents",
      source: "seam",
      mimeType: "text/markdown",
      size: 100,
      contentHash: `${tenantId}-blueprint`,
      status: "ready",
      text: serializeBlueprint(
        withBindingConstraint
          ? {
              ...blank,
              bindingConstraint: { values: ["Not enough qualified leads"], origin: "stated" },
            }
          : blank,
      ),
      createdAt: NOW - 3_000,
    });
    await ctx.db.insert("tenantProfiles", {
      tenantId,
      tier: "solopreneur",
      tierSource: "derived",
      derivedAt: NOW,
      blueprintDocId: docId,
    });
  });
}

const stateOf = (signals: { code: string; state: string }[], code: string) =>
  signals.find((signal) => signal.code === code)?.state;

const signalOf = (signals: { code: string }[], code: string) =>
  signals.find((signal) => signal.code === code);

/**
 * ONE `plans` row, in the only three shapes the two approvals readers look at: a `proposed` row
 * (waiting on a decision, aged by `createdAt`), a `scheduled` row with a `sendAt`, and a
 * `scheduled` row WITHOUT one — which is the `legacy-unknown` send, not a missing field.
 */
function seedPlan(
  t: T,
  tenantId: string,
  plan: {
    status: "proposed" | "scheduled";
    createdAt: number;
    sendAt?: number;
    key?: string;
  },
) {
  return t.run(async (ctx) => {
    await ctx.db.insert("plans", {
      tenantId,
      threadId: `${tenantId}-plan-${plan.key ?? plan.createdAt}`,
      status: plan.status,
      recipients: ["private@example.com"],
      subject: "Private subject",
      body: "Private body",
      createdAt: plan.createdAt,
      ...(plan.sendAt === undefined ? {} : { sendAt: plan.sendAt }),
    });
  });
}

/** A LATER `evaluations` row for the review thread — `byThread` reads the newest, so this one
 *  wins over whatever `seedHealthyTenant` wrote. `gapCount` gates are prose; only their NUMBER
 *  may cross into a signal. */
function seedEvaluation(
  t: T,
  tenantId: string,
  verdict: "gaps" | "healthy" | "insufficient",
  gapCount: number,
  createdAt: number,
) {
  return t.run(async (ctx) => {
    await ctx.db.insert("evaluations", {
      tenantId,
      threadId: REVIEW_THREAD_ID,
      framework: "growth-os",
      findings: [],
      gaps: Array.from({ length: gapCount }, (_, i) => ({
        label: `Private gap label ${i}`,
        leverageRank: i,
        route: "offer",
        playbook: "Private playbook",
      })),
      notEnoughData: [],
      scorecard: {},
      userProvided: [],
      verdict,
      createdAt,
    });
  });
}

describe("home.summary composes each source without inventing numbers", () => {
  test("fails closed without identity — both subscriptions, no partial answer", async () => {
    const { t } = await harness();
    await expect(t.query(api.home.summary, {})).rejects.toThrow(/UNAUTHENTICATED/);
    await expect(t.query(api.home.health, {})).rejects.toThrow(/UNAUTHENTICATED/);
  });

  test("the owning tenant reads every section's real value, pipeline ready", async () => {
    const { asA, t, tenantA } = await harness();
    await seedBusyTenant(t, tenantA);
    const res = await asA.query(api.home.summary, {});

    expect(res.approvals).toEqual({
      awaitingCount: 2,
      capped: false,
      oldestWaitingAt: NOW - 120_000,
    });
    expect(res.delivered).toEqual({ count: 3, capped: false });
    expect(res.deadLetters).toEqual({ newCount: 1 });
    expect(res.content).toEqual({ total: 1, capped: false });
    expect(res.pipeline).toEqual({
      status: "ready",
      needingAttention: 1,
      followUpsDue: 1,
      consentOnRecord: 1,
      suppressed: 1,
    });
    // The narrow Pipeline summary and nothing else — no opportunities/stages/value ever appear.
    expect(Object.keys(res.pipeline).sort()).toEqual([
      "consentOnRecord",
      "followUpsDue",
      "needingAttention",
      "status",
      "suppressed",
    ]);
    // Counts and timestamps only: no plan subject, body, recipient or contact address crosses.
    const wire = JSON.stringify(res);
    for (const secret of ["Private subject", "Private body", "Private goal", "one@example.com"])
      expect(wire, `home.summary leaked ${secret}`).not.toContain(secret);
  });

  test("a second tenant reads its own zeros and none of the first tenant's numbers", async () => {
    const { asB, t, tenantA } = await harness();
    await seedBusyTenant(t, tenantA);
    const res = await asB.query(api.home.summary, {});

    expect(res.approvals).toEqual({ awaitingCount: 0, capped: false, oldestWaitingAt: null });
    expect(res.delivered).toEqual({ count: 0, capped: false });
    expect(res.deadLetters).toEqual({ newCount: 0 });
    expect(res.content).toEqual({ total: 0, capped: false });
    expect(res.pipeline).toEqual({
      status: "ready",
      needingAttention: 0,
      followUpsDue: 0,
      consentOnRecord: 0,
      suppressed: 0,
    });
    expect(JSON.stringify(res)).not.toContain(tenantA);
  });

  test("a capped source stays capped through composition — a floor, never a claimed total", async () => {
    const { asA, t, tenantA } = await harness();
    await seedBusyTenant(t, tenantA);
    await t.run(async (ctx) => {
      // 50 more documents → 51 of one kind, one past `content.summary`'s COUNT_CAP.
      for (let i = 0; i < 50; i++)
        await ctx.db.insert("vaultDocuments", {
          tenantId: tenantA,
          title: `doc ${i}`,
          kind: "created_document",
          category: "documents",
          source: "seam",
          mimeType: "text/markdown",
          size: 10,
          contentHash: `hash-${i}`,
          status: "ready",
          createdAt: NOW - 2_000 - i,
        });
    });
    const res = await asA.query(api.home.summary, {});
    expect(res.content).toEqual({ total: 50, capped: true });
    // The cap bit belongs to the source; the neighbours are untouched by it.
    expect(res.delivered).toEqual({ count: 3, capped: false });
  });

  test("pipeline row-cap survives as partial + reason, and the other sections keep their values", async () => {
    const { asA, t, tenantA } = await harness(
      brokenSource("./contacts.ts", "pipelineTiles", cappedPipelineReader),
    );
    await seedBusyTenant(t, tenantA);
    const res = await asA.query(api.home.summary, {});
    expect(res.pipeline).toEqual({
      status: "partial",
      reason: "row-cap",
      needingAttention: 7,
      followUpsDue: 5,
      consentOnRecord: 3,
      suppressed: 1_000,
    });
    expect(res.approvals).toEqual({
      awaitingCount: 2,
      capped: false,
      oldestWaitingAt: NOW - 120_000,
    });
    expect(res.delivered).toEqual({ count: 3, capped: false });
    expect(res.content).toEqual({ total: 1, capped: false });
  });

  test("a pipeline source that answers with the wrong shape is unavailable, not four zeros", async () => {
    const { asA, t, tenantA } = await harness(
      brokenSource("./contacts.ts", "pipelineTiles", shapelessReader),
    );
    await seedBusyTenant(t, tenantA);
    const res = await asA.query(api.home.summary, {});
    expect(res.pipeline).toEqual({ status: "unavailable" });
    expect(res.pipeline).not.toHaveProperty("needingAttention");
    // A Pipeline failure must not erase the rest of the page.
    expect(res.approvals).toEqual({
      awaitingCount: 2,
      capped: false,
      oldestWaitingAt: NOW - 120_000,
    });
    expect(res.delivered).toEqual({ count: 3, capped: false });
    expect(res.deadLetters).toEqual({ newCount: 1 });
    expect(res.content).toEqual({ total: 1, capped: false });
  });

  test("a pipeline source that throws is error, and the other sections still carry real values", async () => {
    const { asA, t, tenantA } = await harness(
      brokenSource("./contacts.ts", "pipelineTiles", throwingReader),
    );
    await seedBusyTenant(t, tenantA);
    const res = await asA.query(api.home.summary, {});
    expect(res.pipeline).toEqual({ status: "error" });
    expect(res.pipeline).not.toHaveProperty("needingAttention");
    expect(res.approvals).toEqual({
      awaitingCount: 2,
      capped: false,
      oldestWaitingAt: NOW - 120_000,
    });
    expect(res.delivered).toEqual({ count: 3, capped: false });
    expect(res.deadLetters).toEqual({ newCount: 1 });
    expect(res.content).toEqual({ total: 1, capped: false });
  });

  test("a failed source is UNAVAILABLE, never the number 0", async () => {
    const { asA, t, tenantA } = await harness(
      brokenSource("./deadLetters.ts", "newCount", throwingReader),
    );
    await seedBusyTenant(t, tenantA);
    const res = await asA.query(api.home.summary, {});
    // The discriminant, not the absence of a number: `{ newCount: 0 }` would read "nothing is
    // blocked" about a tenant whose blocked queue could not be read at all.
    expect(res.deadLetters).toEqual({ unavailable: true });
    expect(res.deadLetters).not.toHaveProperty("newCount");
    expect(res.approvals).toEqual({
      awaitingCount: 2,
      capped: false,
      oldestWaitingAt: NOW - 120_000,
    });
    expect(res.pipeline).toEqual({
      status: "ready",
      needingAttention: 1,
      followUpsDue: 1,
      consentOnRecord: 1,
      suppressed: 1,
    });
  });

  test("an approvals source that throws leaves delivered and content standing", async () => {
    const { asA, t, tenantA } = await harness(
      brokenSource("./approvals.ts", "summary", throwingReader),
    );
    await seedBusyTenant(t, tenantA);
    const res = await asA.query(api.home.summary, {});
    expect(res.approvals).toEqual({ unavailable: true });
    expect(res.approvals).not.toHaveProperty("awaitingCount");
    expect(res.delivered).toEqual({ count: 3, capped: false });
    expect(res.content).toEqual({ total: 1, capped: false });
  });

  test("a content source that throws is unavailable, never a count of 0 artifacts", async () => {
    const { asA, t, tenantA } = await harness(
      brokenSource("./content.ts", "summary", throwingReader),
    );
    await seedBusyTenant(t, tenantA);
    const res = await asA.query(api.home.summary, {});
    // The last section without this test. "0 artifacts" about a shelf that could not be read is
    // the fake zero the module header exists to prevent.
    expect(res.content).toEqual({ unavailable: true });
    expect(res.content).not.toHaveProperty("total");
    expect(res.delivered).toEqual({ count: 3, capped: false });
    expect(res.deadLetters).toEqual({ newCount: 1 });
  });

  test("more waiting approvals than the summary window is a FLOOR on both subscriptions", async () => {
    const { asA, t, tenantA } = await harness();
    // 101 → one past `approvals.summary`'s SUMMARY_LIMIT of 100.
    await t.run(async (ctx) => {
      for (let i = 0; i < 101; i++)
        await ctx.db.insert("plans", {
          tenantId: tenantA,
          threadId: `${tenantA}-waiting-${i}`,
          status: "proposed",
          recipients: ["private@example.com"],
          subject: "Private subject",
          body: "Private body",
          createdAt: NOW - 1_000 * (i + 1),
        });
    });
    const res = await asA.query(api.home.summary, {});
    expect(res.approvals).toEqual({
      awaitingCount: 100,
      capped: true,
      oldestWaitingAt: NOW - 101_000,
    });
    // The SAME fact on the health subscription must not lose the marker the summary keeps: a
    // signal has nowhere to put a cap bit, so a capped count is dropped rather than claimed.
    const health = await asA.query(api.home.health, {});
    const stale = signalOf(health.signals, "stale-approval");
    expect(stale).not.toHaveProperty("count");
    expect(stale).toEqual({ code: "stale-approval", state: "ok", at: NOW - 101_000 });
  });

  test("delivered past its cap is a floor, never a claimed total", async () => {
    const { asA, t, tenantA } = await harness();
    await t.run(async (ctx) => {
      for (let i = 0; i < DELIVERED_CAP + 1; i++)
        await ctx.db.insert("requests", {
          tenantId: tenantA,
          correlationId: `${tenantA}-sent-${i}`,
          goal: "Private goal",
          recipient: "private@example.com",
          status: "sent",
          attachmentRefs: [],
          createdAt: NOW - i,
        });
    });
    const res = await asA.query(api.home.summary, {});
    // The one number this module counts itself: 1 000 WITH the bit, never 1 001 and never a
    // silent 1 000 that reads as exact.
    expect(res.delivered).toEqual({ count: DELIVERED_CAP, capped: true });
  });
});

describe("home.health delegates the verdict and fails closed", () => {
  test("a bare tenant: EVERY signal reports its own real state, and the verdict is unknown", async () => {
    const { asA } = await harness();
    const health = await asA.query(api.home.health, {});
    expect(health.signals.map((s) => s.code).sort()).toEqual([
      "binding-constraint",
      "connection-failure",
      "diagnostic-blocker",
      "scheduled-risk",
      "stale-approval",
      "unresolved-dead-letters",
    ]);
    // Each of these is a REAL state of this tenant, asserted per code and not through the
    // aggregate: the verdict is "unknown" for the diagnostic's sake alone, so a check that
    // stopped checking (a mailbox never probed, a bottleneck never asked for) hides behind it.
    expect(stateOf(health.signals, "connection-failure")).toBe("triggered"); // no gmailTokens row
    expect(stateOf(health.signals, "binding-constraint")).toBe("triggered"); // no blueprint
    expect(stateOf(health.signals, "diagnostic-blocker")).toBe("unknown"); // never diagnosed
    expect(stateOf(health.signals, "unresolved-dead-letters")).toBe("ok");
    expect(stateOf(health.signals, "stale-approval")).toBe("ok");
    expect(stateOf(health.signals, "scheduled-risk")).toBe("ok");
    // Unknown outranks triggered: a verdict over an incomplete set is not a verdict.
    expect(health.state).toBe("unknown");
  });

  test("health is not owner-gated — each tenant reads its OWN sources, not a degraded shell", async () => {
    const { asA, asB, t, tenantA, tenantB } = await harness();
    await seedHealthyTenant(t, tenantA);
    await seedHealthyTenant(t, tenantB);
    // B differs from A by ONE real row. Without it both tenants are empty for the same reason and
    // every assertion here holds for a surface where B's six reads throw OWNER_REQUIRED and
    // degrade to unknown — which is exactly the implementation this test has to be able to fail.
    await t.run(async (ctx) => {
      await ctx.db.insert("deadLetters", {
        tenantId: tenantB,
        correlationId: "corr-b",
        workflowId: "wf_b",
        payload: { ref: "b" },
        error: "boom",
        status: "new",
        createdAt: NOW,
      });
    });
    const [ownerHealth, memberHealth] = await Promise.all([
      asA.query(api.home.health, {}),
      asB.query(api.home.health, {}),
    ]);
    expect(memberHealth.signals.map((s) => s.code)).toEqual(ownerHealth.signals.map((s) => s.code));
    // The non-owner gets a REAL verdict computed over its own rows...
    expect(memberHealth.state).toBe("degraded");
    expect(memberHealth.signals).toContainEqual({
      code: "unresolved-dead-letters",
      state: "triggered",
      count: 1,
    });
    // ...and the owner's verdict is its own, not B's.
    expect(ownerHealth.state).toBe("healthy");
    expect(ownerHealth.signals).toContainEqual({
      code: "unresolved-dead-letters",
      state: "ok",
      count: 0,
    });
  });

  test("every required signal satisfied is the ONLY route to healthy", async () => {
    const { asA, t, tenantA } = await harness();
    await seedHealthyTenant(t, tenantA);
    const res = await asA.query(api.home.health, {});
    expect(res.state).toBe("healthy");
    expect(res.signals.map((s) => s.state).sort()).toEqual(["ok", "ok", "ok", "ok", "ok", "ok"]);
  });

  test("a triggered signal degrades the verdict and carries its count, not its content", async () => {
    const { asA, t, tenantA } = await harness();
    await seedHealthyTenant(t, tenantA);
    await t.run(async (ctx) => {
      await ctx.db.insert("deadLetters", {
        tenantId: tenantA,
        correlationId: "corr-x",
        workflowId: "wf_x",
        payload: { ref: "x" },
        error: "Private failure text",
        status: "new",
        createdAt: NOW,
      });
    });
    const res = await asA.query(api.home.health, {});
    expect(res.state).toBe("degraded");
    expect(res.signals).toContainEqual({
      code: "unresolved-dead-letters",
      state: "triggered",
      count: 1,
    });
    expect(JSON.stringify(res)).not.toContain("Private failure text");
  });

  test("MUTATION CHECK: one health source throwing makes the verdict unknown, never healthy", async () => {
    const { asA, t, tenantA } = await harness(
      brokenSource("./gmailAuth.ts", "gmailStatus", throwingReader),
    );
    // The SAME fixture that reads "healthy" in the test above — the only difference is the source.
    await seedHealthyTenant(t, tenantA);
    const res = await asA.query(api.home.health, {});
    expect(res.state).toBe("unknown");
    expect(res.state).not.toBe("healthy");
    expect(res.state).not.toBe("degraded");
    expect(res.signals).toContainEqual({ code: "connection-failure", state: "unknown" });
    // The surviving signals still report themselves: a broken source is not a broken page.
    expect(stateOf(res.signals, "diagnostic-blocker")).toBe("ok");
    expect(stateOf(res.signals, "binding-constraint")).toBe("ok");
  });

  test("a blueprint source that throws is unknown, not a claim that nothing is blocked", async () => {
    const { asA, t, tenantA } = await harness(
      brokenSource("./blueprint.ts", "blueprintState", throwingReader),
    );
    await seedHealthyTenant(t, tenantA);
    const res = await asA.query(api.home.health, {});
    expect(res.state).toBe("unknown");
    expect(res.signals).toContainEqual({ code: "binding-constraint", state: "unknown" });
  });

  test("a LIVE blueprint with a blank binding constraint is triggered, same as no blueprint", async () => {
    const { asA, t, tenantA } = await harness();
    await seedHealthyTenant(t, tenantA, false);
    const res = await asA.query(api.home.health, {});
    // The second half of the condition: a blueprint on record is not the fact this signal asks
    // about — a NAMED bottleneck is.
    expect(res.signals).toContainEqual({ code: "binding-constraint", state: "triggered" });
    expect(res.state).toBe("degraded");
  });

  test("stale-approval is the THRESHOLD, not merely waiting: 25h triggers, 23h does not", async () => {
    const stale = await harness();
    await seedHealthyTenant(stale.t, stale.tenantA);
    await seedPlan(stale.t, stale.tenantA, {
      status: "proposed",
      createdAt: REAL_NOW - 25 * HOUR_MS,
    });
    const staleRes = await stale.asA.query(api.home.health, {});
    expect(staleRes.signals).toContainEqual({
      code: "stale-approval",
      state: "triggered",
      count: 1,
      at: REAL_NOW - 25 * HOUR_MS,
    });
    expect(staleRes.state).toBe("degraded");

    // The SAME fixture one side of the line over. Without this half, a constant `true`, a zeroed
    // threshold and a flipped comparison all read as coverage.
    const fresh = await harness();
    await seedHealthyTenant(fresh.t, fresh.tenantA);
    await seedPlan(fresh.t, fresh.tenantA, {
      status: "proposed",
      createdAt: REAL_NOW - 23 * HOUR_MS,
    });
    const freshRes = await fresh.asA.query(api.home.health, {});
    expect(freshRes.signals).toContainEqual({
      code: "stale-approval",
      state: "ok",
      count: 1,
      at: REAL_NOW - 23 * HOUR_MS,
    });
    expect(freshRes.state).toBe("healthy");
  });

  test("scheduled-risk fires on BOTH shapes and reports the earliest of them", async () => {
    const { asA, t, tenantA } = await harness();
    await seedHealthyTenant(t, tenantA);
    const imminent = REAL_NOW + 30 * 60_000;
    // Risk 1: inside the imminence window. Risk 2: no confirmed send time at all. Risk 3: a
    // LATER imminent send, so "earliest" cannot be satisfied by picking any risky row.
    await seedPlan(t, tenantA, { status: "scheduled", createdAt: NOW - 4_000, sendAt: imminent });
    await seedPlan(t, tenantA, { status: "scheduled", createdAt: NOW - 3_000, key: "legacy" });
    await seedPlan(t, tenantA, {
      status: "scheduled",
      createdAt: NOW - 2_000,
      sendAt: REAL_NOW + 45 * 60_000,
    });
    // Not a risk: a week out, with a confirmed time.
    await seedPlan(t, tenantA, {
      status: "scheduled",
      createdAt: NOW - 1_000,
      sendAt: REAL_NOW + 7 * DAY_MS,
    });
    const res = await asA.query(api.home.health, {});
    expect(res.signals).toContainEqual({
      code: "scheduled-risk",
      state: "triggered",
      count: 3,
      at: imminent,
    });
    expect(res.state).toBe("degraded");
    expect(JSON.stringify(res)).not.toContain("Private subject");
  });

  test("a scheduled send with a confirmed time far out is not a risk", async () => {
    const { asA, t, tenantA } = await harness();
    await seedHealthyTenant(t, tenantA);
    await seedPlan(t, tenantA, {
      status: "scheduled",
      createdAt: NOW - 1_000,
      sendAt: REAL_NOW + 7 * DAY_MS,
    });
    // The guard is not always-on: a queue that IS fully read and holds nothing risky says ok.
    expect((await asA.query(api.home.health, {})).signals).toContainEqual({
      code: "scheduled-risk",
      state: "ok",
      count: 0,
      at: null,
    });
    expect((await asA.query(api.home.health, {})).state).toBe("healthy");
  });

  test("a CAPPED scheduled probe is unknown, never ok — the risk past the page is unseen", async () => {
    const { asA, t, tenantA } = await harness();
    await seedHealthyTenant(t, tenantA);
    await t.run(async (ctx) => {
      // The probe pages by newest-CREATED, not by send time. Fill the page with far-future sends
      // and put the ONE imminent send at the OLDEST createdAt, where the probe cannot see it.
      for (let i = 0; i <= SCHEDULED_PROBE; i++)
        await ctx.db.insert("plans", {
          tenantId: tenantA,
          threadId: `${tenantA}-sched-${i}`,
          status: "scheduled",
          recipients: ["private@example.com"],
          subject: "Private subject",
          body: "Private body",
          sendAt: i === SCHEDULED_PROBE ? REAL_NOW + 60_000 : REAL_NOW + 30 * DAY_MS,
          createdAt: NOW - 1_000 * i,
        });
    });
    const res = await asA.query(api.home.health, {});
    // "We found none in fifty rows" is not "there are none". A positive health claim over a
    // truncated read is the fail-open this signal exists to avoid.
    expect(res.signals).toContainEqual({ code: "scheduled-risk", state: "unknown" });
    expect(stateOf(res.signals, "scheduled-risk")).not.toBe("ok");
    expect(res.state).toBe("unknown");
    expect(res.state).not.toBe("healthy");
  });

  test("a diagnostic with failing gates triggers and carries the gate COUNT, not the prose", async () => {
    const { asA, t, tenantA } = await harness();
    await seedHealthyTenant(t, tenantA);
    await seedEvaluation(t, tenantA, "gaps", 2, NOW - 500);
    const res = await asA.query(api.home.health, {});
    expect(res.signals).toContainEqual({
      code: "diagnostic-blocker",
      state: "triggered",
      count: 2,
      at: NOW - 500,
    });
    expect(res.state).toBe("degraded");
    expect(JSON.stringify(res)).not.toContain("Private gap label");
  });

  test("an `insufficient` verdict is unknown — not enough data is not a clean bill", async () => {
    const { asA, t, tenantA } = await harness();
    await seedHealthyTenant(t, tenantA);
    await seedEvaluation(t, tenantA, "insufficient", 0, NOW - 500);
    const res = await asA.query(api.home.health, {});
    expect(stateOf(res.signals, "diagnostic-blocker")).toBe("unknown");
    expect(res.state).toBe("unknown");
    expect(res.state).not.toBe("healthy");
  });
});
