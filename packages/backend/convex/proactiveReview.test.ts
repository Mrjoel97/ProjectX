// BEVL-03 — the proactive weekly review. Behaviour tests over convex-test (zero network: the
// engine's `rag.search` is unregistered here and fails open, and the tenant's own profile doc
// still enters the corpus through `internal.vault.profileSeedDocs`, which is a plain DB read).
//
// The static SC#2 / SC#3 guards live in the SAME file (bottom) deliberately: the raw-source scan
// idiom needs no `node` environment, so a second file would buy nothing but a second harness.
import { NOTIFICATION_KINDS, REVIEW_THREAD_ID, serializeProfile } from "@pikar/core";
import { convexTest } from "convex-test";
import { beforeAll, describe, expect, test, vi } from "vitest";
// The engine's refs-only evaluation.ran audit hits the auditCounts aggregate; register the
// component (relative import — the package blocks the deep specifier) or the REAL audit path
// throws "component not registered" (the evaluations.test.ts idiom, copied verbatim).
import aggregateSchema from "../node_modules/@convex-dev/aggregate/src/component/schema.js";
import migrationsSchema from "../node_modules/@convex-dev/migrations/src/component/schema.js";
import rateLimiterSchema from "../node_modules/@convex-dev/rate-limiter/src/component/schema.js";
import { api, internal } from "./_generated/api";
import schema from "./schema";

// 34: the review now stages its top gap through applyActOnGap, and the fixture's money-model gap
// routes to a REGISTERED specialist. With no model key the dispatch lands its fallback memo
// without a network call (dispatch.test.ts's own stub) — never a live model from this suite.
vi.stubEnv("OPENAI_API_KEY", "");
vi.stubEnv("OPENROUTER_API_KEY", "");
const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);
// The staging hop schedules `dispatch.runSpecialist`, whose module graph (llm, models, skills) takes
// seconds to load the FIRST time. Inside the timer-pumped drain that first load reads as a
// scheduled function that "did not complete after 10000 timer pumps"; warm it once, up front.
beforeAll(async () => {
  await modules["./dispatch.ts"]?.();
});
const aggregateModules = import.meta.glob(
  "../node_modules/@convex-dev/aggregate/src/component/**/!(*.test).ts",
);
const migrationsModules = import.meta.glob(
  "../node_modules/@convex-dev/migrations/src/component/**/!(*.test).ts",
);
const rateLimiterModules = import.meta.glob(
  "../node_modules/@convex-dev/rate-limiter/src/component/**/!(*.test).ts",
);

/** convex-test instance with the auditCounts aggregate component registered. */
function newTest(): ReturnType<typeof convexTest> {
  const t = convexTest(schema, modules);
  t.registerComponent("auditCounts", aggregateSchema, aggregateModules);
  t.registerComponent("migrations", migrationsSchema, migrationsModules);
  t.registerComponent("rateLimiter", rateLimiterSchema, rateLimiterModules);
  return t;
}

/** 25.3: a tenant IS a users row (tenantId = String(userId)); the weekly walk enumerates users. */
async function newTenant(t: ReturnType<typeof convexTest>): Promise<string> {
  return String(await t.run((ctx) => ctx.db.insert("users", {})));
}

/** A committed business-profile markdown body (round-trips through deserializeProfile). */
function profileText(name: string): string {
  return `${serializeProfile({
    name,
    oneLineDescription: "In-home dog training for busy urban owners.",
    persona: "solopreneur",
    stage: "early-revenue",
    offering: "6-week private obedience program",
    targetCustomer: "urban dog owners with new puppies",
    primaryGoals: ["more clients"],
    knownConstraints: [],
  })}\n\nCAC: $150\nLTGP: $4500\n30-day cash: $200\n`;
}

/** Seed a vault doc. `kind` decides whether the tenant counts as onboarded for the fan-out. */
async function seedDoc(
  t: ReturnType<typeof convexTest>,
  tenantId: string,
  kind: string,
  text: string,
): Promise<void> {
  await t.run(async (ctx) => {
    await ctx.db.insert("vaultDocuments", {
      tenantId,
      title: "Business profile",
      kind,
      category: "business",
      source: "seam",
      mimeType: "text/markdown",
      size: text.length,
      contentHash: `hash_${Math.random().toString(36).slice(2)}`,
      text,
      status: "ready",
      createdAt: Date.now(),
    });
  });
}

/**
 * Run the cron and drain the per-tenant fan-out.
 *
 * `finishInProgressScheduledFunctions` (the cockpit.test.ts:331 idiom) only awaits jobs that have
 * already STARTED; a `runAfter(0, …)` posted from a mutation is still `pending` when the mutation
 * resolves, so it needs one macrotask tick first. (`finishAllScheduledFunctions(vi.runAllTimers)`
 * is the documented alternative but deadlocks here: the review's module graph loads through
 * dynamic imports that fake timers never let settle.)
 */
async function runCron(t: ReturnType<typeof convexTest>): Promise<void> {
  // 25.3: the enumeration is a batch job; one synchronous batch (vaultSweep.test.ts idiom) and
  // then drain the randomly-spread reviewOne jobs under fake timers.
  // 34: fake ONLY setTimeout (the spread). The staging hop loads dispatch.ts's module graph on
  // first use, and that settles through setImmediate/nextTick — the default fake set starves it
  // into "did not complete after 10000 timer pumps".
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  try {
    await t.mutation(internal.proactiveReview.enumerateWeeklyReview, {
      cursor: null,
      batchSize: 100,
      dryRun: false,
      oneBatchOnly: true,
    });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
  } finally {
    vi.useRealTimers();
  }
}

// `t.run`'s ctx is a GENERIC data model (convex-test does not thread the schema through it), so
// `.withIndex` does not typecheck here — these read with `.filter`, the evaluations.test.ts idiom.
// Production scoping is asserted on the module source by the SC#3 guard below, not here.
async function reviewRows(t: ReturnType<typeof convexTest>, tenantId: string) {
  return t.run(async (ctx) =>
    ctx.db
      .query("evaluations")
      .filter((q) =>
        q.and(q.eq(q.field("tenantId"), tenantId), q.eq(q.field("threadId"), REVIEW_THREAD_ID)),
      )
      .collect(),
  );
}

async function notifications(t: ReturnType<typeof convexTest>, tenantId: string) {
  return t.run(async (ctx) =>
    ctx.db
      .query("notifications")
      .filter((q) => q.eq(q.field("tenantId"), tenantId))
      .collect(),
  );
}

describe("proactive weekly review (BEVL-03 — cron → per-tenant review → in-app card)", () => {
  test("enumerates only tenants with a business_profile doc (deduped, one review each)", async () => {
    const t = newTest();
    const A = await newTenant(t);
    const C = await newTenant(t);
    await t.mutation(internal.skills.seedSkills, {});
    // Tenant A is onboarded TWICE over (an enrichment re-commit leaves a second profile doc).
    await seedDoc(t, A, "business_profile", profileText("Acme Dog Training"));
    await seedDoc(t, A, "business_profile", profileText("Acme Dog Training"));
    // Tenant C has vault content but never onboarded — it must not be reviewed.
    await seedDoc(t, C, "upload", "Some uploaded reference material.");

    await runCron(t);

    expect(await reviewRows(t, A)).toHaveLength(1); // deduped: one review per tenant
    expect(await reviewRows(t, C)).toHaveLength(0);
  });

  test("writes a review card and a notification", async () => {
    const t = newTest();
    const A = await newTenant(t);
    await t.mutation(internal.skills.seedSkills, {});
    await seedDoc(t, A, "business_profile", profileText("Acme Dog Training"));

    await runCron(t);

    const rows = await reviewRows(t, A);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.findings.length).toBeGreaterThanOrEqual(1); // the card has something to say

    // 34: the fixture's money-model gap is STAGED (the louder fact), so the one notification is
    // the proposal, linking to approvals — not the plain "review ready".
    const notes = await notifications(t, A);
    expect(notes.map((n) => n.kind)).toEqual(["agenda_proposal"]);
    expect(notes[0]?.read).toBe(false);
    const plan = await t
      .withIdentity({ subject: A })
      .query(api.plans.byThread, { threadId: REVIEW_THREAD_ID });
    expect(plan?.kind).toBe("memo"); // staged on the review thread's one row
    expect(["approved", "scheduled", "delivering", "done"]).not.toContain(plan?.status); // gate intact
  });

  test("notifies only on change (a second identical week stays silent)", async () => {
    const t = newTest();
    const A = await newTenant(t);
    await t.mutation(internal.skills.seedSkills, {});
    await seedDoc(t, A, "business_profile", profileText("Acme Dog Training"));

    await runCron(t);
    await runCron(t);

    // The card refreshes every week regardless — it is the notification that is conditional.
    expect(await reviewRows(t, A)).toHaveLength(2);
    const notes = await notifications(t, A);
    // 34: week 1 staged the gap; week 2 finds it still `proposed` and stages nothing — silent.
    expect(notes.map((n) => n.kind)).toEqual(["agenda_proposal"]);

    // The second run must be a genuine no-op diff, not merely an unnotified one: same verdict,
    // same finding count, empty delta. (This is the regression guard for the repeat-run
    // provenance collapse — without stable re-citation, findings shrink week over week.)
    const rows = await reviewRows(t, A);
    expect(rows[1]?.verdict).toBe(rows[0]?.verdict);
    expect(rows[1]?.findings.length).toBe(rows[0]?.findings.length);
    expect(rows[1]?.delta).toEqual({ newFindings: 0, gapsClosed: [], gapsOpened: [] });
  });

  test("cross-tenant isolation: each review carries only its own tenantId", async () => {
    const t = newTest();
    const A = await newTenant(t);
    const B = await newTenant(t);
    await t.mutation(internal.skills.seedSkills, {});
    await seedDoc(t, A, "business_profile", profileText("Acme Dog Training"));
    await seedDoc(t, B, "business_profile", profileText("Beta Bakery"));

    await runCron(t);

    for (const [tenantId, other] of [
      [A, B],
      [B, A],
    ] as const) {
      const rows = await reviewRows(t, tenantId);
      expect(rows).toHaveLength(1);
      expect(rows.every((r) => r.tenantId === tenantId)).toBe(true);
      const notes = await notifications(t, tenantId);
      expect(notes).toHaveLength(1);
      expect(notes.every((n) => n.tenantId === tenantId)).toBe(true);
      // And the client-facing read is scoped: the other tenant's identity sees its OWN row only.
      const seen = await t
        .withIdentity({ subject: other })
        .query(api.evaluations.byThread, { threadId: REVIEW_THREAD_ID });
      expect(seen?.tenantId).not.toBe(tenantId);
    }
  });

  test("audit stays the existing evaluation.ran row (no new review.* eventType)", async () => {
    const t = newTest();
    const A = await newTenant(t);
    await t.mutation(internal.skills.seedSkills, {});
    await seedDoc(t, A, "business_profile", profileText("Acme Dog Training"));

    await runCron(t);

    const events = await t.run(async (ctx) =>
      ctx.db
        .query("audit")
        .filter((q) => q.eq(q.field("tenantId"), A))
        .collect(),
    );
    // 34: the staged proposal's dispatch writes its own refs-only rows beside this one; the claim
    // here is unchanged — the REVIEW adds no `review.*` eventType of its own.
    const kinds = events.map((e) => e.eventType);
    expect(kinds).toContain("evaluation.ran");
    expect(kinds.filter((k) => k.startsWith("review."))).toEqual([]);

    // §4: the payload is counts + closed enums ONLY — never a finding label or citation title.
    const payload = events.find((e) => e.eventType === "evaluation.ran")?.payload as Record<
      string,
      unknown
    >;
    const ENUMS = ["swot", "lean", "bmc", "growth-os", "gaps", "healthy", "insufficient"];
    for (const value of Object.values(payload)) {
      if (typeof value === "number") continue;
      expect(ENUMS).toContain(value);
    }
  });
});

// ── Static guards ─────────────────────────────────────────────────────────────────────────────
// The behaviour tests above prove the review WORKS; these prove it cannot QUIETLY grow a mailbox
// dependency or an unscoped read. Raw-source scan (the importGuard.test.ts idiom) — edge-runtime
// has no node:fs, so file contents ride in through Vite's raw loader.
const sources = import.meta.glob("./**/*.ts", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;
const src = sources["./proactiveReview.ts"] ?? "";
// Comments are stripped before scanning. The module deliberately DOCUMENTS the choke point it must
// never call, so a guard that a comment can trip is a guard that teaches people to delete comments.
const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/.*$/gm, "$1");

describe("proactive review guards (SC#2 no mailbox token, SC#3 tenant-scoped)", () => {
  test("the scanned source actually loaded", () => {
    // A rename must fail LOUDLY here rather than let every assertion below pass vacuously.
    expect(src.length).toBeGreaterThan(500);
    expect(code.length).toBeGreaterThan(500); // …and the comment strip left real code behind.
  });

  test("no mailbox token can be reached from the weekly review", () => {
    // 1. It imports no mailbox module.
    expect(code).not.toMatch(/from\s+["']\.\/(gmail|gmailAuth|notifyExternal)["']/);
    // 2. It never routes through the choke point: `notifications.notify` UNCONDITIONALLY schedules
    //    internal.notifyExternal.dispatch, which calls freshAccessToken → the Gmail refresh path.
    expect(code).not.toMatch(/notifications\.notify/);
    // 3. Second, INDEPENDENT barrier: both review kinds are absent from NOTIFICATION_KINDS, so even
    //    a future refactor through `notify` returns at `if (!KINDS.has(kind)) return;` BEFORE any
    //    token work. Neither assertion alone is the guarantee — 2 is the current path, 3 is the
    //    backstop if the path ever changes.
    expect(NOTIFICATION_KINDS).not.toContain("weekly_review");
    expect(NOTIFICATION_KINDS).not.toContain("weekly_review_failed");
    expect(NOTIFICATION_KINDS).not.toContain("agenda_proposal"); // 34: same rule, third kind
    // The positive half: it really does deliver in-app. Without this, a module that stopped
    // notifying at all would sail through every assertion above.
    expect(code).toMatch(/ctx\.db\.insert\(\s*["']notifications["']/);
  });

  test("every read and write in the review is tenant-scoped", () => {
    // The cron has no ctx.auth, so tenantQuery/tenantMutation (which call requireTenant) are
    // structurally uncallable here. This test is what replaces them.
    const queries = [...code.matchAll(/ctx\.db\s*\.?\s*\n?\s*\.query\(\s*["'](\w+)["']/g)];
    expect(queries.length).toBeGreaterThan(0);
    let byKindCount = 0;
    for (const m of queries) {
      const tail = code.slice(m.index, m.index + 300);
      const idx = /\.withIndex\(\s*["'](\w+)["']\s*,\s*\(q\)\s*=>\s*q\.eq\(\s*["'](\w+)["']/.exec(
        tail,
      );
      expect(idx, `unindexed ctx.db.query("${m[1]}")`).not.toBeNull();
      const [, indexName, firstField] = idx ?? [];
      if (firstField === "kind") {
        // The ONE deliberate cross-tenant read: it yields tenant ids only, never content.
        expect(indexName).toBe("by_kind");
        byKindCount++;
      } else {
        expect(firstField).toBe("tenantId");
      }
    }
    // Pinned so a SECOND unscoped scan cannot be added silently.
    // 25.3: the enumeration walks `users` as a batch job; every remaining read is tenant-first.
    expect(byKindCount).toBe(0);

    // Every insert carries a tenantId in its object literal.
    for (const m of code.matchAll(/ctx\.db\.insert\(\s*["'](\w+)["']\s*,\s*\{/g)) {
      const tail = code.slice(m.index, m.index + 400);
      expect(tail, `untenanted ctx.db.insert("${m[1]}")`).toMatch(/\btenantId\b/);
    }
  });
});
