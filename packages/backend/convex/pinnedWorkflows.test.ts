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
import { describe, expect, test, vi } from "vitest";
import agentSchema from "../node_modules/@convex-dev/agent/src/component/schema.js";
import aggregateSchema from "../node_modules/@convex-dev/aggregate/src/component/schema.js";
import rateLimiterSchema from "../node_modules/@convex-dev/rate-limiter/src/component/schema.js";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { pinRunState } from "./pinnedWorkflows";
import schema from "./schema";

// ── THE OFFLINE SEAM THAT MAKES A COMPLETED RUN REACHABLE ──────────────────────────────────
//
// Two mocks, and between them they buy the ONE state the previous round could not produce.
//
// `resolveModel` → a scripted `MockLanguageModelV4`, the `knowledgeSearch.test.ts` idiom and the
// same swap `__runWorkflowPackWithScript` performs: EVERYTHING else on the path is the shipped
// code — `guardrails.preCall`, the preflight, `runAgentLoop`, `priceUsage`,
// `guardrails.recordSpend`, `outcomeFor`, the pack event log, `cockpit.startWorkflowPack`'s thread
// and plan row, and `runAgain`'s own derivation and audit write. The model is the only fake, which
// is why the `spendEvents` row a completed run leaves behind is a REAL priced row.
//
// `runSpecialistTurn` → the real function, plus an opt-in throw AFTER it returns. That is not an
// arbitrary failure point: it is the exact seam this module's header names as the reason `unknown`
// may not claim $0 ("`runPackTurn` rethrows from AFTER `runSpecialistTurn` — i.e. after the model
// may have answered and `recordModelSpend` may have run"). Injecting there is how that sentence
// becomes a test instead of a claim.
const seam = vi.hoisted(() => ({
  /** The scripted model's steps, consumed in order. Replaced per test. */
  script: [] as unknown[],
  /** When true, the pack loop throws from after the model answered and spend was recorded. */
  throwAfterModel: false,
}));

vi.mock("./lib/models", async (importOriginal) => {
  const { MockLanguageModelV4 } = await import("ai/test");
  return {
    ...(await importOriginal<typeof import("./lib/models")>()),
    resolveModel: () => new MockLanguageModelV4({ doGenerate: seam.script as never }),
  };
});

vi.mock("./llm", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./llm")>();
  return {
    ...actual,
    runSpecialistTurn: async (...args: Parameters<typeof actual.runSpecialistTurn>) => {
      const res = await actual.runSpecialistTurn(...args);
      if (seam.throwAfterModel) throw new Error("PACK_FAILED_AFTER_THE_MODEL_ANSWERED");
      return res;
    },
  };
});

/** One scripted model step that answers with text and stops. The token counts are what
 *  `priceUsage` charges, so they are what makes a completed run leave a real spend row. */
const textStep = (text: string) => ({
  content: text === "" ? [] : [{ type: "text", text }],
  finishReason: { unified: "stop", raw: "stop" },
  usage: {
    inputTokens: { total: 900, noCache: 900, cacheRead: 0, cacheWrite: 0 },
    outputTokens: { total: 300, text: 300, reasoning: 0 },
  },
  warnings: [],
});

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
/** The pin-run rows in the order they were INSERTED (`_creationTime`, not the payload's own
 *  ordinal — sorting by the number under test would make it sort itself into being correct). */
const pinRunEvents = async (t: T) =>
  (await auditRows(t))
    .filter((r) => r.eventType === "workflow_pin.run")
    .sort((a, b) => a._creationTime - b._creationTime);
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
    // 29-08 round 2: the field has NO writer again. It was stored, folded into the pin identity
    // and read by nothing — `runAgain` sends the pack id and the code-owned opener, and no runtime
    // honours a preference. `schema.ts`'s "no writer of this field yet" comment is true again.
    expect(row?.sourcePreferences).toBeUndefined();
  });

  test("a tenant's customization is captured BY ROW ID and by hash, and nothing else", async () => {
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
    // NOTHING ELSE OFF THAT JSON REACHES THE ROW. The stored values include a `PackSource` this
    // pack cannot read and a URL, and neither is copied anywhere: the pin names the ROW, and the
    // row is where its own values live.
    expect(row?.sourcePreferences).toBeUndefined();
    expect(JSON.stringify(row)).not.toContain("evil.example");
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
  test("a pin taken after the customization changed REPLACES the old one", async () => {
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
    // ONE PIN PER PACK. MUTATION: delete the stale-row loop in `pinWorkflow` → red (two rows).
    // The old row was invisible (the surface takes one pin per pack) and unremovable (the prompt
    // menu filters workflow pins out), and it ran identically: `runAgain` re-resolves to ACTIVE.
    expect(await pinRows(t)).toHaveLength(1);
    expect((await pinRows(t))[0]?._id).toBe(after.ok ? after.id : null);
    expect((await pinRows(t))[0]?.customizationHash).toBe("hash_br_1");
  });

  test("re-pinning after a republish moves the pin to the new version — it does not add a row", async () => {
    const t = setup();
    const skillId = await seedPack(t, "pack-brand-review", packBrandReviewSkillBody, 4);
    await as(t, A).mutation(api.pinnedWorkflows.pinWorkflow, { templateId: "brand-review" });
    await t.run((ctx) => ctx.db.patch(skillId, { version: 5 }));
    await as(t, A).mutation(api.pinnedWorkflows.pinWorkflow, { templateId: "brand-review" });

    expect((await pinRows(t)).map((r) => r.templateVersion)).toEqual([5]);
  });

  // The replacement is TENANT-SCOPED and PACK-SCOPED. MUTATION: drop the `.eq("templateId", packId)`
  // from the stale-row read → red (B's pin, or A's other pack, is deleted by A pinning this one).
  test("replacing a pin touches neither another tenant's pin nor this tenant's other packs", async () => {
    const t = setup();
    const skillId = await seedPack(t, "pack-brand-review", packBrandReviewSkillBody, 4);
    await seedPack(t, "pack-business-pulse", packBusinessPulseSkillBody, 4);
    await as(t, A).mutation(api.pinnedWorkflows.pinWorkflow, { templateId: "brand-review" });
    await as(t, A).mutation(api.pinnedWorkflows.pinWorkflow, { templateId: "business-pulse" });
    await as(t, B).mutation(api.pinnedWorkflows.pinWorkflow, { templateId: "brand-review" });

    await t.run((ctx) => ctx.db.patch(skillId, { version: 5 }));
    await as(t, A).mutation(api.pinnedWorkflows.pinWorkflow, { templateId: "brand-review" });

    const rows = await pinRows(t);
    expect(rows).toHaveLength(3);
    expect(rows.filter((r) => r.tenantId === B).map((r) => r.templateVersion)).toEqual([4]);
    expect(
      rows
        .filter((r) => r.tenantId === A)
        .map((r) => `${r.templateId}@${r.templateVersion}`)
        .sort(),
    ).toEqual(["brand-review@5", "business-pulse@4"]);
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
  // MUTATION: delete the `customization_applied` push → red.
  test("a pinned customization is reported as NOT applied, every time", async () => {
    const t = setup();
    await seedPack(t, "pack-brand-review", packBrandReviewSkillBody);
    await seedCustomization(t, A, { name: "pack-brand-review", templateId: "brand-review" });
    const id = await pinBrandReview(t);
    const check = await as(t, A).query(api.pinnedWorkflows.checkReadiness, { id });
    expect(check.ok && check.notices).toEqual(["customization_applied"]);
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

  // MUTATION: drop `newest.templateId === packId &&` from `newestCustomization` → red. The row
  // carries a hash and an author, so `customizationHash !== undefined` alone does not discriminate:
  // a candidate written against ANOTHER template would be pinned as this pack's customization.
  test("a candidate row naming a different template is not this pack's customization", async () => {
    const t = setup();
    await seedPack(t, "pack-brand-review", packBrandReviewSkillBody);
    await seedCustomization(t, A, {
      name: "pack-brand-review",
      templateId: "business-pulse",
      hash: "hash_other_template",
    });
    const id = await pinBrandReview(t);
    const check = await as(t, A).query(api.pinnedWorkflows.checkReadiness, { id });
    expect(check.ok && check.customizationPinned).toBe(false);
    expect(check.ok && check.notices).toEqual([]);
    expect((await pinRows(t))[0]?.customizationHash).toBeUndefined();
  });

  // MUTATION: drop `|| mine.tenantId !== tenantId` from the `customization_missing` branch → red.
  // A row that still EXISTS but is no longer this tenant's must not be described as "your saved
  // settings" — the deleted-row half of that condition cannot see this case at all.
  test("a customization row that is no longer this tenant's reads as MISSING, not 'not applied'", async () => {
    const t = setup();
    await seedPack(t, "pack-brand-review", packBrandReviewSkillBody);
    const candidateId = await seedCustomization(t, A, {
      name: "pack-brand-review",
      templateId: "brand-review",
    });
    const id = await pinBrandReview(t);
    await t.run((ctx) => ctx.db.patch(candidateId, { tenantId: B }));
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

  // The list is built by walking `WORKFLOW_PACK_IDS`, in which `business-pulse` comes FIRST and
  // `brand-review` LAST — so pinning them in the other order is what tells the two rules apart.
  // MUTATION: add back `rows.sort((a, b) => b.createdAt - a.createdAt)` → red (brand-review first).
  test("the list comes back in the product's own pack order, not in pin order", async () => {
    const t = setup();
    await seedPack(t, "pack-business-pulse", packBusinessPulseSkillBody, 2);
    await seedPack(t, "pack-brand-review", packBrandReviewSkillBody, 4);
    await as(t, A).mutation(api.pinnedWorkflows.pinWorkflow, { templateId: "business-pulse" });
    await as(t, A).mutation(api.pinnedWorkflows.pinWorkflow, { templateId: "brand-review" });

    const pins = await as(t, A).query(api.pinnedWorkflows.listPins);
    expect(pins.map((p) => p.templateId)).toEqual(["business-pulse", "brand-review"]);
  });

  // THE PROMPT MENU MUST NOT SHRINK BECAUSE A WORKFLOW WAS PINNED. `savedPrompts.list` filters
  // workflow pins out; doing that AFTER its `take(SAVED_PROMPT_LIST_LIMIT)` meant every pin ate one
  // of the twenty slots and a prompt silently vanished from the workspace menu.
  // MUTATION: move the `q.eq(q.field("templateId"), undefined)` filter back after the take → red
  // (19 prompts).
  test("pinning a workflow evicts nothing from the twenty-entry prompt menu", async () => {
    const t = setup();
    await seedPack(t, "pack-brand-review", packBrandReviewSkillBody);
    for (let i = 0; i < 20; i++) {
      await t.run((ctx) =>
        ctx.db.insert("savedPrompts", {
          tenantId: A,
          text: `prompt ${i}`,
          title: `prompt ${i}`,
          textHash: `hash_${i}`,
          createdAt: 1000 + i,
        }),
      );
    }
    expect(await as(t, A).query(api.savedPrompts.list)).toHaveLength(20);
    await as(t, A).mutation(api.pinnedWorkflows.pinWorkflow, { templateId: "brand-review" });
    const prompts = await as(t, A).query(api.savedPrompts.list);
    expect(prompts).toHaveLength(20);
    expect(prompts.every((r) => r.title.startsWith("prompt "))).toBe(true);
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
    const plans = await planRows(t);
    expect(plans).toHaveLength(2);
    expect(new Set(plans.map((p) => p.threadId)).size).toBe(2);
    // Nothing was approved, cloned or reopened: a fresh pack plan row starts at `collecting`.
    expect(plans.every((p) => p.status === "collecting")).toBe(true);

    // Read off the AUDIT ROWS, not off the return value: the correlation the log actually carries
    // is the one a later reader joins on, and it is no longer returned to the browser at all.
    const correlations = (await pinRunEvents(t)).map((e) => e.correlationId);
    expect(new Set(correlations).size).toBe(2);
    for (const c of correlations) expect(c.startsWith(`pin:${pinId}:`)).toBe(true);
  });

  test("the repeat ordinal counts up, and it is read from the audit plane", async () => {
    const t = setupRun();
    await runTwice(t);
    // MUTATION: return a constant `1` from `runCount` → red (`[1, 1]`). Ordered by insert time,
    // never by the ordinal itself — sorting by the number under test sorts it into being right.
    const events = await pinRunEvents(t);
    expect(events).toHaveLength(2);
    expect(events.map((e) => e.payload.ordinal)).toEqual([1, 2]);
  });

  test("the governed stop is reported honestly, and NOTHING was spent by the run", async () => {
    const t = setupRun();
    const { first } = await runTwice(t);
    // `preCall` refused inside the pack loop: the turn started, the model never did. This is the
    // ONE run state that may be described as free, and it is free because the binding returns
    // `costUsd: 0` on it. MUTATION: make `state` unconditionally `"ran"` → red.
    expect(first.state).toBe("blocked");
    expect(first.outcome).toBe("blocked");
    // The only spend row is the one the test itself wrote to exhaust the budget.
    const spends = await spendRows(t);
    expect(spends).toHaveLength(1);
    expect(spends[0]?.amountCents).toBe(2000);
  });

  // EVERY VALUE, not just every key. The previous version asserted `Object.keys().sort()` plus two
  // fields, so `noticeCount: 0`, `sourceUnavailableCount: 0` and `activeVersion: 999` were all
  // surviving mutations — a log that always recorded zero notices shipped green.
  test("the audit payload carries refs, counts and flags — every value, and no request text", async () => {
    const t = setupRun();
    const { pinId, first } = await runTwice(t);
    const [event] = await pinRunEvents(t);
    expect(event?.eventType).toBe("workflow_pin.run");
    expect(event?.tenantId).toBe(A);
    expect(event?.actor).toBe("user");
    expect(event?.payload).toEqual({
      pinId,
      templateId: "brand-review",
      templateVersion: 4,
      activeVersion: 4,
      ordinal: 1,
      state: "blocked",
      outcome: "blocked",
      threadId: first.threadId,
      noticeCount: 0,
      sourceUnavailableCount: 0,
      customizationPinned: false,
      // THE HONEST CONSTANT: the run took the approved global template, never a tenant body.
      customizationApplied: false,
      // `latencyMs` USED TO BE HERE and it is deleted from the payload, not asserted harder. Its
      // only assertion anywhere was `expect.any(Number)`, so `Date.now() - startedAt` → `0`
      // survived; nothing read the field, on any surface. Deleted rather than narrowed.
    });
    // §4: no user-supplied or product prose on the log plane.
    const serialized = JSON.stringify(event?.payload);
    expect(serialized).not.toContain("Review a piece of my copy.");
    expect(serialized).not.toContain("Brand review");
  });

  // The counts are only real if a run that HAS notices records them. MUTATION: hardcode
  // `noticeCount: 0` / `sourceUnavailableCount: 0` / `activeVersion: 999` → red here, and the
  // all-zero test above stays green, which is exactly why that one is not enough on its own.
  test("a pin with notices logs how many, and both versions when they differ", async () => {
    const t = setupRun();
    const skillId = await seedPack(t, "pack-business-pulse", packBusinessPulseSkillBody, 4);
    await seedCustomization(t, A, {
      name: "pack-business-pulse",
      templateId: "business-pulse",
      hash: "hash_bp_notices",
    });
    const pin = await as(t, A).mutation(api.pinnedWorkflows.pinWorkflow, {
      templateId: "business-pulse",
    });
    if (!pin.ok) throw new Error("pin failed");
    await t.run((ctx) => ctx.db.patch(skillId, { version: 9 }));
    await exhaustBudget(t, A);

    await as(t, A).action(api.pinnedWorkflows.runAgain, { id: pin.id });
    const [event] = await pinRunEvents(t);
    // template_republished + customization_applied + sources_unavailable (finance-inputs).
    expect(event?.payload.noticeCount).toBe(3);
    expect(event?.payload.sourceUnavailableCount).toBe(1);
    expect(event?.payload.templateVersion).toBe(4);
    expect(event?.payload.activeVersion).toBe(9);
    expect(event?.payload.customizationPinned).toBe(true);
    expect(event?.payload.customizationApplied).toBe(false);
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

// ── The state derivation, arm by arm ───────────────────────────────────────────────────────

// THE BLOCKER THIS ROUND FIXES, HALF ONE. `runAgain`'s state is a pure function of one string, and
// the previous round asserted it only through drives that can reach two of its three values. So
// `outcome === null ? "unknown" : "blocked"` — which renders "Nothing ran and nothing was spent"
// over a run that answered and was billed — left 43/43 green. Three verifiers applied that exact
// mutation. Here it is red on the second case.
describe("pinRunState maps a pack outcome to what may be said about money", () => {
  test("no outcome is UNKNOWN — the turn may have reached the model", () => {
    expect(pinRunState(null)).toBe("unknown");
  });

  // The ONLY value that proves $0, and it proves it because `runPackTurn` returns `costUsd: 0`
  // literally on that path (asserted against that module's own source further down).
  test("the governed stop is BLOCKED", () => {
    expect(pinRunState("blocked")).toBe("blocked");
  });

  // Every terminal the pack loop can actually produce. `no_findings` is the trap the module header
  // names: a run that found nothing RAN, and calling it "unknown" would be honest-sounding and
  // wrong. MUTATION: `outcome === null ? "unknown" : "blocked"` → red on all three.
  test.each(["useful", "partial", "no_findings", "failed"])("%s is RAN, not unknown", (outcome) => {
    expect(pinRunState(outcome)).toBe("ran");
  });
});

// ── A run that actually completed, offline, with a real priced spend row ───────────────────

// THE BLOCKER THIS ROUND FIXES, HALF TWO — and the half a pure function cannot buy. Until now no
// test in this repo had ever observed `runAgain` return `state: "ran"` from the server: every drive
// exhausted the budget first or threw before a thread. The scripted model closes that (see the seam
// at the top of this file); the rest of the path is the shipped code, so the spend row below is a
// real `priceUsage` result recorded by the real `guardrails.recordSpend`.
describe("a completed turn is reported as RAN, and it was not free", { timeout: 120_000 }, () => {
  const pinBrandReview = async (t: T) => {
    await seedPack(t, "pack-brand-review", packBrandReviewSkillBody, 4);
    const pin = await as(t, A).mutation(api.pinnedWorkflows.pinWorkflow, {
      templateId: "brand-review",
    });
    if (!pin.ok) throw new Error("pin failed");
    return pin.id;
  };

  test("the model answers, the run is RAN, and a priced spend row exists for it", async () => {
    seam.script = [textStep("Three things about that copy, and one of them is the headline.")];
    seam.throwAfterModel = false;
    const t = setupRun();
    const pinId = await pinBrandReview(t);

    const res = await as(t, A).action(api.pinnedWorkflows.runAgain, { id: pinId });
    // MUTATION: `outcome === null ? "unknown" : "blocked"` in `pinRunState` → red HERE, on a run
    // that reached the model. This is the assertion the previous round did not have.
    expect(res).toEqual({
      ok: true,
      threadId: expect.any(String),
      state: "ran",
      outcome: "useful",
    });

    // THE MONEY, MEASURED. The budget was never exhausted in this test, so every row on the
    // plane belongs to the run — and it is non-zero, which is precisely what makes the
    // "nothing was spent" sentence a lie about this state.
    const spends = await spendRows(t);
    expect(spends).toHaveLength(1);
    expect(spends[0]?.amountCents).toBeGreaterThan(0);

    // The log plane says the same thing the caller was told.
    const [event] = await pinRunEvents(t);
    expect(event?.payload.state).toBe("ran");
    expect(event?.payload.outcome).toBe("useful");
    expect(event?.payload.threadId).toBe(res.ok ? res.threadId : null);
  });

  // Trap (4) in the module header — "`outcome: 'no_findings'` is `'ran'`, not `'unknown'`" — was an
  // invariant a comment asserted and nothing enforced. A run whose reply is empty is exactly that
  // case, and it is driven here rather than argued.
  test("a run that found nothing still RAN — it is not reported as unknown", async () => {
    seam.script = [textStep("")];
    seam.throwAfterModel = false;
    const t = setupRun();
    const pinId = await pinBrandReview(t);

    const res = await as(t, A).action(api.pinnedWorkflows.runAgain, { id: pinId });
    expect(res.ok && res.outcome).toBe("no_findings");
    expect(res.ok && res.state).toBe("ran");
    expect((await pinRunEvents(t))[0]?.payload.state).toBe("ran");
  });

  // THE SECOND BLOCKER. Both `unknown` drives below kill the agent component, so the one state
  // whose whole purpose is "we cannot tell whether money was spent" had only ever been observed
  // where money provably was NOT. Here the model ANSWERS, `recordModelSpend` runs, and the pack
  // loop then throws from after `runSpecialistTurn` — the exact seam the module header names. The
  // state must still be `unknown`, and it must still be `unknown` in the log.
  test("a throw AFTER the model answered and spend was recorded is still UNKNOWN, never free", async () => {
    seam.script = [textStep("An answer that was paid for before everything fell over.")];
    seam.throwAfterModel = true;
    const t = setupRun();
    const pinId = await pinBrandReview(t);

    const res = await as(t, A).action(api.pinnedWorkflows.runAgain, { id: pinId });
    // MUTATION: `outcome === null ? "blocked"` → red. The user would be told $0 about this.
    expect(res.ok && res.state).toBe("unknown");
    expect(res.ok && res.outcome).toBe(null);

    // THE POINT: money WAS spent on the very run being reported as unknown.
    const spends = await spendRows(t);
    expect(spends).toHaveLength(1);
    expect(spends[0]?.amountCents).toBeGreaterThan(0);

    const [event] = await pinRunEvents(t);
    expect(event?.payload.state).toBe("unknown");
    expect(event?.payload.outcome).toBe(null);
  });
});

// ── A run that did not finish, and the sentence it is not allowed to earn ──────────────────

// THE DEFECT THIS REPLACES. `ran` was a boolean, so a turn that produced NO outcome collapsed into
// the same `false` the governed budget stop produces, and the surface told the user "nothing ran
// and nothing was spent" about it. `cockpit.startWorkflowPack` never rethrows: a pack-binding
// refusal AND every throw out of `runWorkflowPack` both come back as `ok:false` with no `outcome`,
// and `runPackTurn` rethrows from after `runSpecialistTurn` — i.e. after `recordModelSpend` may
// already have run. So `outcome === null` is genuinely UNKNOWN cost, and it now says so.
describe("a run that produced no outcome is UNKNOWN, never free", () => {
  // The agent component is deliberately NOT registered, so `ensureThreadAndPlan` throws inside
  // `startWorkflowPack` — a real infrastructure failure on the thread/plan plumbing, which is one
  // of the throws that reaches `runAgain`'s catch in production.
  test("a turn that throws returns state 'unknown' with no thread, and logs it as unknown", async () => {
    const t = setup();
    await seedPack(t, "pack-brand-review", packBrandReviewSkillBody, 4);
    const pin = await as(t, A).mutation(api.pinnedWorkflows.pinWorkflow, {
      templateId: "brand-review",
    });
    if (!pin.ok) throw new Error("pin failed");

    const res = await as(t, A).action(api.pinnedWorkflows.runAgain, { id: pin.id });
    // MUTATION: `outcome === null ? "blocked"` (or `"ran"`) in the state derivation → red.
    // MUTATION: drop the catch arm's fall-through so the throw escapes → red (the action rejects).
    expect(res).toEqual({ ok: true, threadId: null, state: "unknown", outcome: null });

    // The LOG is the half that used to be wrong in the same way: it recorded `ran:false` and
    // `started:false` about a turn whose cost nobody knows.
    const [event] = await pinRunEvents(t);
    expect(event?.payload.state).toBe("unknown");
    expect(event?.payload.outcome).toBe(null);
    expect(event?.payload.threadId).toBe(null);
    expect(event?.payload.ordinal).toBe(1);
  });

  // An unknown run still HAPPENED, so it counts. MUTATION: skip the audit write on the catch path
  // → red (the second press reports ordinal 1 and the run vanishes from the log).
  test("an unknown run is still counted as a run of this pin", async () => {
    const t = setup();
    await seedPack(t, "pack-brand-review", packBrandReviewSkillBody, 4);
    const pin = await as(t, A).mutation(api.pinnedWorkflows.pinWorkflow, {
      templateId: "brand-review",
    });
    if (!pin.ok) throw new Error("pin failed");
    await as(t, A).action(api.pinnedWorkflows.runAgain, { id: pin.id });
    await as(t, A).action(api.pinnedWorkflows.runAgain, { id: pin.id });
    expect((await pinRunEvents(t)).map((e) => e.payload.ordinal)).toEqual([1, 2]);
  });
});

// ── The repeat ordinal is scoped to ONE pin, in ONE tenant ─────────────────────────────────

// The module header claims the range read returns "the pin's own rows and nothing else" and that
// "the row id is what makes the range tenant-safe". Both were claims a comment made and nothing
// enforced: every drive used exactly one pin, so replacing the derived prefix with a constant
// `"pin:"` left the whole suite green while the ordinal counted every pin in the deployment,
// across tenants. This is that claim as a test.
describe("runCount counts this pin's runs and no others", () => {
  const seedAuditRuns = (
    t: T,
    tenantId: string,
    pinId: Id<"savedPrompts">,
    count: number,
    eventType = "workflow_pin.run",
  ) =>
    t.run(async (ctx) => {
      for (let i = 0; i < count; i++) {
        await ctx.db.insert("audit", {
          tenantId,
          correlationId: `pin:${pinId}:${eventType}_${i}`,
          eventType,
          actor: "user",
          payload: { pinId },
          ts: 1_000 + i,
        });
      }
    });

  const pinFor = async (t: T, tenantId: string, templateId: string) => {
    const res = await as(t, tenantId).mutation(api.pinnedWorkflows.pinWorkflow, { templateId });
    if (!res.ok) throw new Error("pin failed");
    return res.id;
  };

  test("another pin's runs, another tenant's runs and another event type are all excluded", async () => {
    const t = setup();
    await seedPack(t, "pack-brand-review", packBrandReviewSkillBody);
    await seedPack(t, "pack-business-pulse", packBusinessPulseSkillBody);
    const mine = await pinFor(t, A, "brand-review");
    const myOtherPack = await pinFor(t, A, "business-pulse");
    const theirs = await pinFor(t, B, "brand-review");

    await seedAuditRuns(t, A, mine, 3);
    await seedAuditRuns(t, A, myOtherPack, 2);
    await seedAuditRuns(t, B, theirs, 4);
    // A different writer reusing this pin's correlation prefix. MUTATION: drop the
    // `r.eventType === PIN_RUN_EVENT` filter → red (8).
    await seedAuditRuns(t, A, mine, 5, "workflow_pin.something_else");

    // MUTATION: `const prefix = "pin:"` → red (14). That mutation was previously invisible.
    expect(await t.query(internal.pinnedWorkflows.runCount, { pinId: mine })).toBe(3);
    expect(await t.query(internal.pinnedWorkflows.runCount, { pinId: myOtherPack })).toBe(2);
    expect(await t.query(internal.pinnedWorkflows.runCount, { pinId: theirs })).toBe(4);
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
  const binding = strip(readFileSync(join(here, "workflowPackBinding.ts"), "utf8"));
  const mine = strip(readFileSync(join(here, "pinnedWorkflows.ts"), "utf8"));

  // THE ABSOLUTE THAT CARRIES THE MONEY SENTENCE, and until now the only one of the three with no
  // guard: `state: "blocked"` is rendered as "Nothing ran and nothing was spent", and that is true
  // ONLY because `outcome: "blocked"` is produced from one place in `workflowPackBinding.ts`,
  // BEFORE `runSpecialistTurn`, returning a literal `costUsd: 0`. A second producer added after the
  // model would make the copy false with the whole suite green — no drive reaches a post-model
  // blocked path, and none can be written, because there is no such path to reach.
  // MUTATION (applied, red): return `outcome: "blocked"` from the completed-run return below
  // `runSpecialistTurn(` → red here AND red on the two completed-run drives above, which is the
  // stronger half. WHAT THIS SCAN CANNOT SEE: a producer that builds the value instead of writing
  // the literal — `outcome: someVar` where `someVar` can be `"blocked"`. That mutation was applied
  // too and this test stayed green (the drives are what would catch it, and only on a path they
  // take). The scan is a tripwire on the cheap shape, not a proof about the module.
  test("workflowPackBinding.ts still emits outcome 'blocked' only BEFORE the model, at $0", () => {
    const sites = [...binding.matchAll(/outcome: "blocked"/g)].map((m) => m.index ?? -1);
    // Two: the `run_failed` event row and the returned governed stop. Both in the `preCall` arm.
    expect(sites).toHaveLength(2);
    const model = binding.indexOf("runSpecialistTurn(");
    expect(model).toBeGreaterThan(-1);
    for (const at of sites) expect(at).toBeLessThan(model);
    // The literal $0 is in the same returned object as the last of them.
    expect(binding.slice(sites[1] ?? 0, model)).toContain("costUsd: 0");
  });

  // If this goes red, `customization_applied` has become a lie and the copy must change with
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
