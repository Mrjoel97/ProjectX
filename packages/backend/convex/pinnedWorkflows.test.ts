// PINNED WORKFLOWS (29-08, ROUT-02) — the pin, its readiness, and the freshness of a re-run.
//
// WHAT THIS FILE DRIVES FOR REAL, AND WHAT IT CANNOT. `runAgain` is driven END TO END through the
// production `cockpit.startWorkflowPack` twin, with the agent component registered, by exhausting
// the tenant's daily budget first: `runPackTurn` calls `guardrails.preCall` BEFORE the model and
// returns the governed stop as DATA, so the whole path — readiness, correlation, thread, plan row,
// pack event log, audit — executes for $0 and no model is ever contacted. That is what makes the
// central claim ("two presses are two runs") a behavioural assertion about the shipped path rather
// than a source scan.
//
// The one thing NO test here proves is a model actually answering: that needs a live deployment and
// money, and the browser gate for `/dashboard/workflows` remains unrun (see the summary).
//
// `node` environment: the drive registers the agent component, and the mock-free loop wants node.
// @vitest-environment node
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { packBrandReviewSkillBody } from "@pikar/contracts/skills/packBrandReview";
import { packBusinessPulseSkillBody } from "@pikar/contracts/skills/packBusinessPulse";
import { convexTest, type TestConvex } from "convex-test";
import { describe, expect, test } from "vitest";
import agentSchema from "../node_modules/@convex-dev/agent/src/component/schema.js";
import aggregateSchema from "../node_modules/@convex-dev/aggregate/src/component/schema.js";
import rateLimiterSchema from "../node_modules/@convex-dev/rate-limiter/src/component/schema.js";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);
const agentModules = import.meta.glob(
  "../node_modules/@convex-dev/agent/src/component/**/!(*.test).ts",
);
const aggregateModules = import.meta.glob(
  "../node_modules/@convex-dev/aggregate/src/component/**/!(*.test).ts",
);
const rateLimiterModules = import.meta.glob(
  "../node_modules/@convex-dev/rate-limiter/src/component/**/!(*.test).ts",
);

type T = TestConvex<typeof schema>;

const A = "tenant_pin_a";
const B = "tenant_pin_b";

/** The plain harness: the audit aggregate (every `audit.log` insert counts it) is the only
 *  component the pin/readiness surface touches. */
function setup(): T {
  const t = convexTest(schema, modules);
  t.registerComponent("auditCounts", aggregateSchema, aggregateModules);
  return t;
}

/** The RUN harness. The agent component backs `createThread`/`saveMessage`; the rate limiter backs
 *  `preCall` and `recordSpend`; the aggregate backs the audit insert. */
function setupRun(): T {
  const t = setup();
  t.registerComponent("agent", agentSchema, agentModules);
  t.registerComponent("rateLimiter", rateLimiterSchema, rateLimiterModules);
  return t;
}

const as = (t: T, tenantId: string) => t.withIdentity({ subject: tenantId });

/** An ACTIVE global pack row — what `pinWorkflow` pins and what a re-run resolves against. */
const seedPack = (t: T, name: string, body: string, version = 4) =>
  t.run((ctx) =>
    ctx.db.insert("skills", {
      name,
      version,
      body,
      status: "active",
      createdAt: Date.now(),
    }),
  );

/** A tenant's own customization of a pack: the `tenantSkills` candidate `publishPackCustomization`
 *  writes. `status: "candidate"` because `PACK_GATE` refuses to activate one, ever. */
const seedCustomization = (
  t: T,
  tenantId: string,
  opts: {
    name: string;
    templateId: string;
    templateVersion?: number;
    version?: number;
    hash?: string;
    values?: string;
  },
) =>
  t.run((ctx) =>
    ctx.db.insert("tenantSkills", {
      tenantId,
      name: opts.name,
      version: opts.version ?? 2,
      basedOnScope: "global",
      basedOnName: opts.name,
      basedOnVersion: opts.templateVersion ?? 4,
      body: "base\n\n### Words your business uses\n\njobs",
      authoredBody: "### Words your business uses\n\njobs",
      status: "candidate",
      author: "user",
      rollbackEligible: false,
      templateId: opts.templateId,
      templateVersion: opts.templateVersion ?? 4,
      customizationHash: opts.hash ?? "hash_one",
      customizationValues: opts.values ?? '{"business_terms":"jobs"}',
      createdAt: Date.now(),
    }),
  );

const killSwitchOn = (t: T) =>
  t.run((ctx) =>
    ctx.db.insert("guardrailConfig", {
      killSwitch: true,
      budgetUsdPerRequest: 0.05,
      updatedAt: Date.now(),
    }),
  );

const pinRows = (t: T) => t.run((ctx) => ctx.db.query("savedPrompts").collect());
const auditRows = (t: T) => t.run((ctx) => ctx.db.query("audit").collect());
const planRows = (t: T) => t.run((ctx) => ctx.db.query("plans").collect());
const spendRows = (t: T) => t.run((ctx) => ctx.db.query("spendEvents").collect());

// ── Pinning ────────────────────────────────────────────────────────────────────────────────

describe("pinWorkflow captures lineage the caller cannot choose", () => {
  test("an unknown template is refused, and nothing is written", async () => {
    const t = setup();
    const res = await as(t, A).mutation(api.pinnedWorkflows.pinWorkflow, {
      templateId: "not-a-pack",
    });
    expect(res).toEqual({ ok: false, reason: "unknown_template" });
    expect(await pinRows(t)).toEqual([]);
  });

  test("a template with no ACTIVE approved row is refused — there is nothing honest to pin", async () => {
    const t = setup();
    // The row exists but is a candidate. Discovery is active-only for the same reason.
    await t.run((ctx) =>
      ctx.db.insert("skills", {
        name: "pack-brand-review",
        version: 3,
        body: packBrandReviewSkillBody,
        status: "candidate",
        createdAt: Date.now(),
      }),
    );
    const res = await as(t, A).mutation(api.pinnedWorkflows.pinWorkflow, {
      templateId: "brand-review",
    });
    expect(res).toEqual({ ok: false, reason: "template_not_active" });
    expect(await pinRows(t)).toEqual([]);
  });

  test("the pin stores the LIVE approved version and the pack's own opener, never a caller's", async () => {
    const t = setup();
    await seedPack(t, "pack-brand-review", packBrandReviewSkillBody, 7);
    const res = await as(t, A).mutation(api.pinnedWorkflows.pinWorkflow, {
      templateId: "brand-review",
    });
    expect(res.ok).toBe(true);

    const [row] = await pinRows(t);
    expect(row?.tenantId).toBe(A);
    expect(row?.templateId).toBe("brand-review");
    // The version is read from the `skills` row, so a caller has no field to name a different one.
    expect(row?.templateVersion).toBe(7);
    expect(row?.title).toBe("Brand review");
    expect(row?.text).toBe("Review a piece of my copy.");
    expect(row?.tenantSkillId).toBeUndefined();
    expect(row?.sourcePreferences).toEqual([]);
  });

  test("a tenant's customization is captured BY ROW ID, with its hash and its readable sources", async () => {
    const t = setup();
    await seedPack(t, "pack-business-pulse", packBusinessPulseSkillBody, 4);
    const candidateId = await seedCustomization(t, A, {
      name: "pack-business-pulse",
      templateId: "business-pulse",
      hash: "hash_bp_1",
      // The stored form values, INCLUDING two entries no tool of this pack can read. `crm` is a
      // real `PackSource` the pack does not read; the URL is the exact shape the 29-01 probe
      // stored verbatim through a `v.array(v.string())` field.
      values:
        '{"business_terms":"jobs","preferred_sources":["finance-inputs","crm","http://evil.example","vault"]}',
    });

    await as(t, A).mutation(api.pinnedWorkflows.pinWorkflow, { templateId: "business-pulse" });
    const [row] = await pinRows(t);
    expect(row?.tenantSkillId).toBe(candidateId);
    expect(row?.customizationHash).toBe("hash_bp_1");
    // Filtered to what business-pulse actually reads, in the pack's own manifest order — NOT the
    // order the user submitted. MUTATION: drop the `packReadableSources` filter in
    // `preferredSources` → red, `crm` and the URL land on the row.
    expect(row?.sourcePreferences).toEqual(["vault", "finance-inputs"]);
  });

  test("a `system` baseline is not a customization — it carries no template lineage", async () => {
    const t = setup();
    await seedPack(t, "pack-brand-review", packBrandReviewSkillBody);
    await t.run((ctx) =>
      ctx.db.insert("tenantSkills", {
        tenantId: A,
        name: "pack-brand-review",
        version: 1,
        basedOnScope: "global",
        basedOnName: "pack-brand-review",
        basedOnVersion: 4,
        body: packBrandReviewSkillBody,
        authoredBody: "",
        status: "candidate",
        author: "system",
        rollbackEligible: true,
        createdAt: Date.now(),
      }),
    );
    await as(t, A).mutation(api.pinnedWorkflows.pinWorkflow, { templateId: "brand-review" });
    const [row] = await pinRows(t);
    expect(row?.tenantSkillId).toBeUndefined();
    expect(row?.customizationHash).toBeUndefined();
  });

  test("pinning the same workflow twice returns the SAME row", async () => {
    const t = setup();
    await seedPack(t, "pack-brand-review", packBrandReviewSkillBody);
    const first = await as(t, A).mutation(api.pinnedWorkflows.pinWorkflow, {
      templateId: "brand-review",
    });
    const second = await as(t, A).mutation(api.pinnedWorkflows.pinWorkflow, {
      templateId: "brand-review",
    });
    expect(first).toEqual({ ok: true, id: expect.anything(), inserted: true });
    expect(second.ok && second.inserted).toBe(false);
    expect(first.ok && second.ok && first.id === second.id).toBe(true);
    expect(await pinRows(t)).toHaveLength(1);
  });

  // THE COLLISION `schema.ts` WARNED THE FIRST LINEAGE-BEARING WRITER ABOUT. `textHash` is folded
  // from `pinIdentity` (all five fields), not from the text: the opener is a code-owned constant,
  // so two pins of one pack ALWAYS have byte-identical text and a text-only hash would make every
  // customization of a pack collapse onto the first pin ever taken of it.
  test("a pin taken after the customization changed is a DIFFERENT pin", async () => {
    const t = setup();
    await seedPack(t, "pack-brand-review", packBrandReviewSkillBody);
    const before = await as(t, A).mutation(api.pinnedWorkflows.pinWorkflow, {
      templateId: "brand-review",
    });
    await seedCustomization(t, A, {
      name: "pack-brand-review",
      templateId: "brand-review",
      hash: "hash_br_1",
    });
    const after = await as(t, A).mutation(api.pinnedWorkflows.pinWorkflow, {
      templateId: "brand-review",
    });
    // MUTATION: hash `spec.opener` instead of `pinIdentity(...)` → red, `after` returns `before`.
    expect(before.ok && after.ok && before.id === after.id).toBe(false);
    expect(await pinRows(t)).toHaveLength(2);
  });

  test("a republished template makes a new pin, and the old one keeps the version it pinned", async () => {
    const t = setup();
    const skillId = await seedPack(t, "pack-brand-review", packBrandReviewSkillBody, 4);
    await as(t, A).mutation(api.pinnedWorkflows.pinWorkflow, { templateId: "brand-review" });
    await t.run((ctx) => ctx.db.patch(skillId, { version: 5 }));
    await as(t, A).mutation(api.pinnedWorkflows.pinWorkflow, { templateId: "brand-review" });

    const versions = (await pinRows(t)).map((r) => r.templateVersion).sort();
    expect(versions).toEqual([4, 5]);
  });

  test("two tenants pinning the same pack get two rows, and neither sees the other's", async () => {
    const t = setup();
    await seedPack(t, "pack-brand-review", packBrandReviewSkillBody);
    await as(t, A).mutation(api.pinnedWorkflows.pinWorkflow, { templateId: "brand-review" });
    await as(t, B).mutation(api.pinnedWorkflows.pinWorkflow, { templateId: "brand-review" });
    expect(await pinRows(t)).toHaveLength(2);
    expect(await as(t, A).query(api.pinnedWorkflows.listPins)).toHaveLength(1);
    expect(await as(t, B).query(api.pinnedWorkflows.listPins)).toHaveLength(1);
  });

  test("an anonymous caller cannot pin at all", async () => {
    const t = setup();
    await seedPack(t, "pack-brand-review", packBrandReviewSkillBody);
    await expect(
      t.mutation(api.pinnedWorkflows.pinWorkflow, { templateId: "brand-review" }),
    ).rejects.toThrow();
  });
});

// ── Unpinning, and the boundary with the PROMPT menu ───────────────────────────────────────

describe("unpinWorkflow deletes a workflow pin and only a workflow pin", () => {
  const seedPrompt = (t: T, tenantId: string) =>
    t.run((ctx) =>
      ctx.db.insert("savedPrompts", {
        tenantId,
        text: "draft the weekly note",
        title: "draft the weekly note",
        textHash: "prompt_hash",
        createdAt: Date.now(),
      }),
    );

  test("it removes the tenant's own pin", async () => {
    const t = setup();
    await seedPack(t, "pack-brand-review", packBrandReviewSkillBody);
    const pin = await as(t, A).mutation(api.pinnedWorkflows.pinWorkflow, {
      templateId: "brand-review",
    });
    if (!pin.ok) throw new Error("pin failed");
    expect(await as(t, A).mutation(api.pinnedWorkflows.unpinWorkflow, { id: pin.id })).toEqual({
      removed: true,
    });
    expect(await pinRows(t)).toEqual([]);
  });

  test("a PROMPT pin is refused — the workflows surface cannot delete the workspace's pins", async () => {
    const t = setup();
    const promptId = await seedPrompt(t, A);
    expect(await as(t, A).mutation(api.pinnedWorkflows.unpinWorkflow, { id: promptId })).toEqual({
      removed: false,
    });
    expect(await pinRows(t)).toHaveLength(1);
  });

  test("another tenant's pin is refused, and answers exactly as a missing id does", async () => {
    const t = setup();
    await seedPack(t, "pack-brand-review", packBrandReviewSkillBody);
    const pin = await as(t, B).mutation(api.pinnedWorkflows.pinWorkflow, {
      templateId: "brand-review",
    });
    if (!pin.ok) throw new Error("pin failed");
    expect(await as(t, A).mutation(api.pinnedWorkflows.unpinWorkflow, { id: pin.id })).toEqual({
      removed: false,
    });
    expect(await pinRows(t)).toHaveLength(1);
  });

  // A workflow pin in the workspace's PROMPT menu would offer "Brand review" and then run an
  // ordinary Executive-Agent turn on the opener text — the pack's allow-listed agent never runs.
  // MUTATION: delete the `templateId === undefined` filter in `savedPrompts.list` → red.
  test("a workflow pin never appears in the prompt menu, and a prompt pin still does", async () => {
    const t = setup();
    await seedPack(t, "pack-brand-review", packBrandReviewSkillBody);
    await seedPrompt(t, A);
    await as(t, A).mutation(api.pinnedWorkflows.pinWorkflow, { templateId: "brand-review" });

    const prompts = await as(t, A).query(api.savedPrompts.list);
    expect(prompts.map((p) => p.title)).toEqual(["draft the weekly note"]);
    expect(await as(t, A).query(api.pinnedWorkflows.listPins)).toHaveLength(1);
  });
});

// ── Readiness, resolved against what is LIVE ───────────────────────────────────────────────

describe("checkReadiness answers about now, not about what the pin remembers", () => {
  const pinBrandReview = async (t: T, tenantId = A) => {
    const res = await as(t, tenantId).mutation(api.pinnedWorkflows.pinWorkflow, {
      templateId: "brand-review",
    });
    if (!res.ok) throw new Error("pin failed");
    return res.id;
  };

  test("a fresh pin of a vault-only pack is runnable with nothing to report", async () => {
    const t = setup();
    await seedPack(t, "pack-brand-review", packBrandReviewSkillBody, 4);
    const id = await pinBrandReview(t);
    const check = await as(t, A).query(api.pinnedWorkflows.checkReadiness, { id });
    expect(check).toEqual({
      ok: true,
      templateId: "brand-review",
      runnable: true,
      blockers: [],
      notices: [],
      templateVersion: 4,
      activeVersion: 4,
      sourceUnavailableCount: 0,
      customizationPinned: false,
    });
  });

  test("a pack whose other source is not connected reports it — and is still runnable", async () => {
    const t = setup();
    await seedPack(t, "pack-business-pulse", packBusinessPulseSkillBody, 4);
    const res = await as(t, A).mutation(api.pinnedWorkflows.pinWorkflow, {
      templateId: "business-pulse",
    });
    if (!res.ok) throw new Error("pin failed");
    const check = await as(t, A).query(api.pinnedWorkflows.checkReadiness, { id: res.id });
    expect(check.ok && check.notices).toEqual(["sources_unavailable"]);
    // business-pulse reads `vault` (always available) and `finance-inputs` (no spine seeded).
    expect(check.ok && check.sourceUnavailableCount).toBe(1);
    expect(check.ok && check.runnable).toBe(true);
  });

  // MUTATION: delete the `if (killSwitch) blockers.push("paused")` line → red.
  test("the all-stop kill switch is a BLOCKER, not a note", async () => {
    const t = setup();
    await seedPack(t, "pack-brand-review", packBrandReviewSkillBody);
    const id = await pinBrandReview(t);
    await killSwitchOn(t);
    const check = await as(t, A).query(api.pinnedWorkflows.checkReadiness, { id });
    expect(check.ok && check.blockers).toEqual(["paused"]);
    expect(check.ok && check.runnable).toBe(false);
  });

  test("a template that is no longer active blocks the run and reports no live version", async () => {
    const t = setup();
    const skillId = await seedPack(t, "pack-brand-review", packBrandReviewSkillBody);
    const id = await pinBrandReview(t);
    await t.run((ctx) => ctx.db.patch(skillId, { status: "archived" }));
    const check = await as(t, A).query(api.pinnedWorkflows.checkReadiness, { id });
    expect(check.ok && check.blockers).toEqual(["template_not_active"]);
    expect(check.ok && check.activeVersion).toBe(null);
    expect(check.ok && check.runnable).toBe(false);
  });

  // A republished template is a NOTE, not a refusal: the run re-resolves against the approved row
  // that is live, which is the safe direction. It must still be visible — the pin is now stale.
  test("a republished template is reported as a difference between two named versions", async () => {
    const t = setup();
    const skillId = await seedPack(t, "pack-brand-review", packBrandReviewSkillBody, 4);
    const id = await pinBrandReview(t);
    await t.run((ctx) => ctx.db.patch(skillId, { version: 9 }));
    const check = await as(t, A).query(api.pinnedWorkflows.checkReadiness, { id });
    expect(check.ok && check.notices).toEqual(["template_republished"]);
    expect(check.ok && check.templateVersion).toBe(4);
    expect(check.ok && check.activeVersion).toBe(9);
    expect(check.ok && check.runnable).toBe(true);
  });

  // THE HONESTY CONSTRAINT. A pin that names a customization must say the run will not use it.
  // MUTATION: delete the `customization_not_applied` push → red.
  test("a pinned customization is reported as NOT applied, every time", async () => {
    const t = setup();
    await seedPack(t, "pack-brand-review", packBrandReviewSkillBody);
    await seedCustomization(t, A, { name: "pack-brand-review", templateId: "brand-review" });
    const id = await pinBrandReview(t);
    const check = await as(t, A).query(api.pinnedWorkflows.checkReadiness, { id });
    expect(check.ok && check.notices).toEqual(["customization_not_applied"]);
    expect(check.ok && check.customizationPinned).toBe(true);
  });

  test("a customization row that has been deleted reads as MISSING, not as 'not applied'", async () => {
    const t = setup();
    await seedPack(t, "pack-brand-review", packBrandReviewSkillBody);
    const candidateId = await seedCustomization(t, A, {
      name: "pack-brand-review",
      templateId: "brand-review",
    });
    const id = await pinBrandReview(t);
    await t.run((ctx) => ctx.db.delete(candidateId));
    const check = await as(t, A).query(api.pinnedWorkflows.checkReadiness, { id });
    expect(check.ok && check.notices).toEqual(["customization_missing"]);
  });

  test("another tenant's pin id is unknown here — the answer is not an existence oracle", async () => {
    const t = setup();
    await seedPack(t, "pack-brand-review", packBrandReviewSkillBody);
    const id = await pinBrandReview(t, B);
    expect(await as(t, A).query(api.pinnedWorkflows.checkReadiness, { id })).toEqual({
      ok: false,
      reason: "unknown_pin",
    });
  });

  test("listPins carries the same readiness the single check does", async () => {
    const t = setup();
    await seedPack(t, "pack-brand-review", packBrandReviewSkillBody, 4);
    await seedPack(t, "pack-business-pulse", packBusinessPulseSkillBody, 2);
    await pinBrandReview(t);
    await as(t, A).mutation(api.pinnedWorkflows.pinWorkflow, { templateId: "business-pulse" });

    const pins = await as(t, A).query(api.pinnedWorkflows.listPins);
    expect(pins.map((p) => p.templateId).sort()).toEqual(["brand-review", "business-pulse"]);
    const pulse = pins.find((p) => p.templateId === "business-pulse");
    expect(pulse?.title).toBe("Business pulse");
    expect(pulse?.templateVersion).toBe(2);
    expect(pulse?.notices).toEqual(["sources_unavailable"]);
    expect(pulse?.runnable).toBe(true);
  });
});

// ── Run again: refused BEFORE any spend ────────────────────────────────────────────────────

describe("a refused re-run costs nothing and leaves nothing behind", () => {
  test("a blocked pin never reaches the cockpit: no thread, no plan, no audit, no spend", async () => {
    const t = setupRun();
    await seedPack(t, "pack-brand-review", packBrandReviewSkillBody);
    const pin = await as(t, A).mutation(api.pinnedWorkflows.pinWorkflow, {
      templateId: "brand-review",
    });
    if (!pin.ok) throw new Error("pin failed");
    await killSwitchOn(t);

    const res = await as(t, A).action(api.pinnedWorkflows.runAgain, { id: pin.id });
    expect(res).toEqual({ ok: false, reason: "not_ready", blockers: ["paused"] });

    // The refusal is BEFORE the run, so none of the run's own traces exist. A refusal that got as
    // far as `runPackTurn` would leave a plans row and a `run_started` event here.
    expect(await planRows(t)).toEqual([]);
    expect(await auditRows(t)).toEqual([]);
    expect(await spendRows(t)).toEqual([]);
    expect(await t.run((ctx) => ctx.db.query("workflowPackEvents").collect())).toEqual([]);
  });

  test("another tenant's pin id is refused as unknown, and writes nothing", async () => {
    const t = setupRun();
    await seedPack(t, "pack-brand-review", packBrandReviewSkillBody);
    const pin = await as(t, B).mutation(api.pinnedWorkflows.pinWorkflow, {
      templateId: "brand-review",
    });
    if (!pin.ok) throw new Error("pin failed");
    expect(await as(t, A).action(api.pinnedWorkflows.runAgain, { id: pin.id })).toEqual({
      ok: false,
      reason: "unknown_pin",
    });
    expect(await planRows(t)).toEqual([]);
    expect(await auditRows(t)).toEqual([]);
  });

  // THE REPLAY BOUNDARY IS THE ARG VALIDATOR. `runAgain` declares exactly one argument, so a caller
  // cannot NAME a thread, a plan or an approval to resume — the refusal happens before the handler.
  test("runAgain refuses to even accept a threadId", async () => {
    const t = setupRun();
    await seedPack(t, "pack-brand-review", packBrandReviewSkillBody);
    const pin = await as(t, A).mutation(api.pinnedWorkflows.pinWorkflow, {
      templateId: "brand-review",
    });
    if (!pin.ok) throw new Error("pin failed");
    await expect(
      as(t, A).action(api.pinnedWorkflows.runAgain, {
        id: pin.id,
        threadId: "thread_to_replay",
      } as unknown as { id: Id<"savedPrompts"> }),
    ).rejects.toThrow();
    expect(await planRows(t)).toEqual([]);
  });
});

// ── Run again: the real path, twice, for $0 ────────────────────────────────────────────────

// The drive registers three components and runs the whole cockpit pack path twice per test;
// 20s is not enough on a cold worker. No model is contacted — the budget gate stops every run.
describe("two presses are two runs", { timeout: 120_000 }, () => {
  /** Burn the tenant's whole daily allowance. `runPackTurn` then takes `preCall`'s governed stop
   *  BEFORE the model — so the entire production path executes and no model is contacted. */
  const exhaustBudget = (t: T, tenantId: string) =>
    t.mutation(internal.guardrails.recordSpend, { tenantId, costUsd: 20 });

  const runTwice = async (t: T) => {
    await seedPack(t, "pack-brand-review", packBrandReviewSkillBody, 4);
    const pin = await as(t, A).mutation(api.pinnedWorkflows.pinWorkflow, {
      templateId: "brand-review",
    });
    if (!pin.ok) throw new Error("pin failed");
    await exhaustBudget(t, A);
    const first = await as(t, A).action(api.pinnedWorkflows.runAgain, { id: pin.id });
    const second = await as(t, A).action(api.pinnedWorkflows.runAgain, { id: pin.id });
    if (!first.ok || !second.ok) throw new Error(`a run was refused: ${JSON.stringify(first)}`);
    return { pinId: pin.id, first, second };
  };

  test("each press mints its own thread, its own plan row and its own correlation", async () => {
    const t = setupRun();
    const { pinId, first, second } = await runTwice(t);

    // MUTATION: pass `threadId: <the pin's last thread>` to `startWorkflowPack` → red on all three.
    expect(first.threadId).not.toBe(second.threadId);
    expect(first.correlationId).not.toBe(second.correlationId);
    const plans = await planRows(t);
    expect(plans).toHaveLength(2);
    expect(new Set(plans.map((p) => p.threadId)).size).toBe(2);
    // Nothing was approved, cloned or reopened: a fresh pack plan row starts at `collecting`.
    expect(plans.every((p) => p.status === "collecting")).toBe(true);

    // Both correlations belong to THIS pin and to no other row.
    expect(first.correlationId.startsWith(`pin:${pinId}:`)).toBe(true);
    expect(second.correlationId.startsWith(`pin:${pinId}:`)).toBe(true);
  });

  test("the repeat ordinal counts up, and it is read from the audit plane", async () => {
    const t = setupRun();
    const { first, second } = await runTwice(t);
    // MUTATION: return a constant `1` from `runCount` → red on the second.
    expect(first.ordinal).toBe(1);
    expect(second.ordinal).toBe(2);

    const events = (await auditRows(t)).filter((r) => r.eventType === "workflow_pin.run");
    expect(events).toHaveLength(2);
    expect(events.map((e) => e.payload.ordinal).sort()).toEqual([1, 2]);
  });

  test("the governed stop is reported honestly, and NOTHING was spent by the run", async () => {
    const t = setupRun();
    const { first } = await runTwice(t);
    // `preCall` refused inside the pack loop: the turn started, the model never did.
    expect(first.ran).toBe(false);
    expect(first.outcome).toBe("blocked");
    // The only spend row is the one the test itself wrote to exhaust the budget.
    const spends = await spendRows(t);
    expect(spends).toHaveLength(1);
    expect(spends[0]?.amountCents).toBe(2000);
  });

  test("the audit payload carries refs, counts and flags — and no request text at all", async () => {
    const t = setupRun();
    const { pinId, first } = await runTwice(t);
    const event = (await auditRows(t)).find((r) => r.correlationId === first.correlationId);
    expect(event?.eventType).toBe("workflow_pin.run");
    expect(event?.tenantId).toBe(A);
    expect(Object.keys(event?.payload ?? {}).sort()).toEqual([
      "activeVersion",
      "customizationApplied",
      "customizationPinned",
      "latencyMs",
      "noticeCount",
      "ordinal",
      "outcome",
      "pinId",
      "ran",
      "sourceUnavailableCount",
      "started",
      "templateId",
      "templateVersion",
      "threadId",
    ]);
    expect(event?.payload.pinId).toBe(pinId);
    // THE HONEST CONSTANT: the run took the approved global template, never a tenant body.
    expect(event?.payload.customizationApplied).toBe(false);
    // §4: no user-supplied or product prose on the log plane.
    const serialized = JSON.stringify(event?.payload);
    expect(serialized).not.toContain("Review a piece of my copy.");
    expect(serialized).not.toContain("Brand review");
  });

  test("a pinned customization does not change what runs", async () => {
    const t = setupRun();
    await seedPack(t, "pack-brand-review", packBrandReviewSkillBody, 4);
    await seedCustomization(t, A, { name: "pack-brand-review", templateId: "brand-review" });
    const pin = await as(t, A).mutation(api.pinnedWorkflows.pinWorkflow, {
      templateId: "brand-review",
    });
    if (!pin.ok) throw new Error("pin failed");
    await exhaustBudget(t, A);

    const res = await as(t, A).action(api.pinnedWorkflows.runAgain, { id: pin.id });
    expect(res.ok).toBe(true);
    const event = (await auditRows(t)).find((r) => r.eventType === "workflow_pin.run");
    expect(event?.payload.customizationPinned).toBe(true);
    expect(event?.payload.customizationApplied).toBe(false);
  });
});

// ── The claims this module makes about OTHER modules ───────────────────────────────────────
//
// Two absolutes here are about files this plan does not own, and an absolute about another module
// is only as true as that module. Both are read out of the shipped source of the module itself.

describe("the sentences this surface renders about other modules are still true of them", () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  const cockpit = strip(readFileSync(join(here, "cockpit.ts"), "utf8"));
  const mine = strip(readFileSync(join(here, "pinnedWorkflows.ts"), "utf8"));

  // If this goes red, `customization_not_applied` has become a lie and the copy must change with
  // it — a pinned customization would now reach the model.
  test("cockpit.ts still passes NO tenantSkillIds to the pack binding", () => {
    expect(cockpit).toContain("runWorkflowPack");
    expect(cockpit).not.toContain("tenantSkillIds");
  });

  // `ensureThreadAndPlan` mints a new thread when none is given. That is the whole freshness
  // mechanism, and it lives in cockpit.ts.
  test("startWorkflowPack still takes an OPTIONAL threadId and creates one when it is absent", () => {
    expect(cockpit).toContain("threadId: v.optional(v.string())");
    expect(cockpit).toContain("if (!tid) {");
  });

  // Routine v0's absolute, one surface further on. `savedPrompts.test.ts` and `schema.test.ts` scan
  // their own files for these; this module is the newest place one could arrive.
  test("no scheduling vocabulary exists in this module", () => {
    for (const banned of [
      "cron",
      "scheduler",
      "nextRunAt",
      "recurrence",
      "cadence",
      "timezone",
      "runAt",
      "interval",
      "everyDay",
      "enabled",
    ]) {
      expect(mine, `"${banned}" appeared in pinnedWorkflows.ts`).not.toContain(banned);
    }
  });
});
