// BEVL-03 — the proactive weekly review. Behaviour tests over convex-test (zero network: the
// engine's `rag.search` is unregistered here and fails open, and the tenant's own profile doc
// still enters the corpus through `internal.vault.profileSeedDocs`, which is a plain DB read).
//
// The static SC#2 / SC#3 guards live in the SAME file (bottom) deliberately: the raw-source scan
// idiom needs no `node` environment, so a second file would buy nothing but a second harness.
import { NOTIFICATION_KINDS, REVIEW_THREAD_ID, serializeProfile } from "@pikar/core";
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
// The engine's refs-only evaluation.ran audit hits the auditCounts aggregate; register the
// component (relative import — the package blocks the deep specifier) or the REAL audit path
// throws "component not registered" (the evaluations.test.ts idiom, copied verbatim).
import aggregateSchema from "../node_modules/@convex-dev/aggregate/src/component/schema.js";
import { api, internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);
const aggregateModules = import.meta.glob(
  "../node_modules/@convex-dev/aggregate/src/component/**/!(*.test).ts",
);

/** convex-test instance with the auditCounts aggregate component registered. */
function newTest(): ReturnType<typeof convexTest> {
  const t = convexTest(schema, modules);
  t.registerComponent("auditCounts", aggregateSchema, aggregateModules);
  return t;
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
  await t.mutation(internal.proactiveReview.runWeekly, {});
  await new Promise((resolve) => setTimeout(resolve, 0));
  await t.finishInProgressScheduledFunctions();
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
    await t.mutation(internal.skills.seedSkills, {});
    // Tenant A is onboarded TWICE over (an enrichment re-commit leaves a second profile doc).
    await seedDoc(t, "tenant_a", "business_profile", profileText("Acme Dog Training"));
    await seedDoc(t, "tenant_a", "business_profile", profileText("Acme Dog Training"));
    // Tenant C has vault content but never onboarded — it must not be reviewed.
    await seedDoc(t, "tenant_c", "upload", "Some uploaded reference material.");

    await runCron(t);

    expect(await reviewRows(t, "tenant_a")).toHaveLength(1); // deduped: one review per tenant
    expect(await reviewRows(t, "tenant_c")).toHaveLength(0);
  });

  test("writes a review card and a notification", async () => {
    const t = newTest();
    await t.mutation(internal.skills.seedSkills, {});
    await seedDoc(t, "tenant_a", "business_profile", profileText("Acme Dog Training"));

    await runCron(t);

    const rows = await reviewRows(t, "tenant_a");
    expect(rows).toHaveLength(1);
    expect(rows[0]?.findings.length).toBeGreaterThanOrEqual(1); // the card has something to say

    const notes = await notifications(t, "tenant_a");
    expect(notes.map((n) => n.kind)).toEqual(["weekly_review"]);
    expect(notes[0]?.read).toBe(false);
  });

  test("notifies only on change (a second identical week stays silent)", async () => {
    const t = newTest();
    await t.mutation(internal.skills.seedSkills, {});
    await seedDoc(t, "tenant_a", "business_profile", profileText("Acme Dog Training"));

    await runCron(t);
    await runCron(t);

    // The card refreshes every week regardless — it is the notification that is conditional.
    expect(await reviewRows(t, "tenant_a")).toHaveLength(2);
    const notes = await notifications(t, "tenant_a");
    expect(notes.map((n) => n.kind)).toEqual(["weekly_review"]);

    // The second run must be a genuine no-op diff, not merely an unnotified one: same verdict,
    // same finding count, empty delta. (This is the regression guard for the repeat-run
    // provenance collapse — without stable re-citation, findings shrink week over week.)
    const rows = await reviewRows(t, "tenant_a");
    expect(rows[1]?.verdict).toBe(rows[0]?.verdict);
    expect(rows[1]?.findings.length).toBe(rows[0]?.findings.length);
    expect(rows[1]?.delta).toEqual({ newFindings: 0, gapsClosed: [], gapsOpened: [] });
  });

  test("cross-tenant isolation: each review carries only its own tenantId", async () => {
    const t = newTest();
    await t.mutation(internal.skills.seedSkills, {});
    await seedDoc(t, "tenant_a", "business_profile", profileText("Acme Dog Training"));
    await seedDoc(t, "tenant_b", "business_profile", profileText("Beta Bakery"));

    await runCron(t);

    for (const [tenantId, other] of [
      ["tenant_a", "tenant_b"],
      ["tenant_b", "tenant_a"],
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
    await t.mutation(internal.skills.seedSkills, {});
    await seedDoc(t, "tenant_a", "business_profile", profileText("Acme Dog Training"));

    await runCron(t);

    const events = await t.run(async (ctx) =>
      ctx.db
        .query("audit")
        .filter((q) => q.eq(q.field("tenantId"), "tenant_a"))
        .collect(),
    );
    expect(events.map((e) => e.eventType)).toEqual(["evaluation.ran"]);

    // §4: the payload is counts + closed enums ONLY — never a finding label or citation title.
    const payload = events[0]?.payload as Record<string, unknown>;
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
    expect(byKindCount).toBe(1);

    // Every insert carries a tenantId in its object literal.
    for (const m of code.matchAll(/ctx\.db\.insert\(\s*["'](\w+)["']\s*,\s*\{/g)) {
      const tail = code.slice(m.index, m.index + 400);
      expect(tail, `untenanted ctx.db.insert("${m[1]}")`).toMatch(/\btenantId\b/);
    }
  });
});
