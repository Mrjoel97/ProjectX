// PINNED WORKFLOWS (Phase 29, ROUT-02) — a manual, version-pinned RE-RUN of an approved pack.
//
// THE TABLE IS `savedPrompts`, NOT A NEW ONE, and that was decided one plan earlier: 29-01 added
// five lineage columns to that row with a comment saying in as many words that "a parallel
// `pinnedWorkflows` table would duplicate all of that AND put a second pin menu in the workspace".
// FOUR of the five are written here (`templateId`, `templateVersion`, `tenantSkillId`,
// `customizationHash`); `sourcePreferences` is deliberately left with no writer — see `pinWorkflow`.
// So a pinned workflow IS a pinned prompt that also names an exact approved template version and an
// exact tenant candidate ROW — and the code-derived title, the idempotent `textHash` and, above
// all, "Run is an ordinary fresh turn through the existing governed send path" are inherited
// verbatim (CLAUDE.md ladder rung 2). The bound is different and stronger: `savedPrompts.list`
// takes twenty, while a workflow pin list can only ever be as long as `WORKFLOW_PACK_IDS`.
//
// THE MODULE IS SEPARATE FROM `savedPrompts.ts` ON PURPOSE. That file is deliberately tiny and
// inert — its own header says "THERE IS DELIBERATELY NO AUTOMATION SUBSTRATE HERE", and
// `savedPrompts.test.ts` SCANS IT for every recurrence word. A readiness resolver that reads
// `skills`, `tenantSkills` and the source probe, plus an action that fires a governed run, does not
// belong behind that scan; putting it there would mean loosening the scan that protects it.
//
// THERE IS STILL NO SCHEDULER, CRON, TRIGGER, CADENCE, TIMEZONE, NEXT-RUN TIMESTAMP, ENABLED FLAG,
// RUN-HISTORY TABLE OR STANDING APPROVAL — here or on the row. Every run in this file starts
// because a human pressed a button in the same session. `pinnedWorkflows.test.ts` scans this file
// for all of them, as `savedPrompts.test.ts` and `schema.test.ts` do for their own surfaces.
//
// ── WHAT A RE-RUN ACTUALLY RUNS, WHICH IS THE UNCOMFORTABLE PART ───────────────────────────────
//
// A pin can name the tenant's own customization row (`tenantSkillId`), and the run WILL NOT USE IT:
//
//   - `planTenantActivation` (skills.ts) throws `PACK_GATE` for every name in
//     `WORKFLOW_PACK_SKILL_NAMES`, ahead of its mode switch — a pack-named tenant candidate has no
//     activation path in this release, with or without evidence.
//   - `cockpit.ts` is the only production caller of `runWorkflowPack` and it passes NO
//     `tenantSkillIds`, so even an activated row would be inert on this path.
//
// So a re-run runs the APPROVED GLOBAL TEMPLATE. That is surfaced as the named, visible
// `customization_applied` notice rather than described as "running your customization", and
// the claim about `cockpit.ts` is pinned by a test that reads `cockpit.ts` — an absolute about
// another module is only as true as the module.
//
// ── FRESHNESS IS THE SECURITY PROPERTY ─────────────────────────────────────────────────────────
//
// `runAgain` takes ONE argument: the pin id. There is no `threadId`, no `planId`, no
// `correlationId` and no approval ref in its validator, so a caller cannot NAME a prior run to
// resume — Convex's arg validator is the refusal boundary. It calls `cockpit.startWorkflowPack`
// with no `threadId`, and `ensureThreadAndPlan` therefore mints a NEW thread and a NEW `plans` row
// every time, exactly as a first typed message does. The pin row itself carries no thread, plan or
// approval column to replay from. Two presses are two runs; nothing is reused between them.
//
// ── THE BUDGET IS CHECKED, ONE HOP IN, AND DELIBERATELY NOT DUPLICATED HERE ─────────────────────
//
// `runPackTurn` (workflowPackBinding.ts) calls `internal.guardrails.preCall` BEFORE the model and
// returns the governed stop as DATA (`outcome: "blocked"`, `costUsd: 0`). That is the authoritative
// gate and it costs $0 to hit. A second budget read in this file could only be a weaker copy that
// disagrees with it — and a Convex QUERY cannot call `preCall` at all (it is a mutation), so the
// reactive readiness surface would be reading a different question and calling it the same one.
// What readiness DOES own is the all-stop: `killSwitch` is a plain row read, so it refuses here,
// before a thread, a plan row or a model call exists.
//
// ── WHAT A PRESS CAN HONESTLY REPORT, AND THE THING IT MAY NOT SAY ─────────────────────────────
//
// THIS SURFACE MUST NEVER TELL A USER THAT NOTHING WAS SPENT UNLESS THAT IS PROVABLE. Only two of
// the three end states prove it:
//
//   - REFUSED (`ok: false`) — readiness said no, or the id is not this tenant's pin. Nothing was
//     created: no thread, no plan row, no audit row, no spend. $0 by construction.
//   - `state: "blocked"` — `preCall` refused INSIDE the pack loop and `runPackTurn` returned
//     `outcome: "blocked"` with a literal `costUsd: 0`. $0 because the binding says so.
//   - `state: "unknown"` — the turn produced NO outcome, and this is the state the surface used to
//     lie about. `cockpit.startWorkflowPack` reports a pack-binding refusal and EVERY throw out of
//     `runWorkflowPack` the same way (`ok:false`, no `outcome`; it never rethrows), and
//     `runPackTurn` rethrows from AFTER `runSpecialistTurn` — i.e. after the model may have
//     answered and `recordModelSpend` may have run. So "unknown" genuinely means unknown, the audit
//     row records it as unknown, and the copy says so instead of promising $0.
//
// A booleanising `ran` is what made that lie unmutatable: `outcome === null` collapsed into the
// same `false` the governed stop produces, and no test could tell the two apart. The state is a
// closed three-value enum for that reason, and `PinRunState` is what the UI branches on.
//
// THE ENUM ALONE DID NOT CLOSE IT. Every $0 drive of `runAgain` ends in `"blocked"` or a pre-thread
// throw, so the `"ran"` arm was reached by nothing and collapsing it into `"blocked"` left the suite
// green over the same lie. The derivation is now the exported pure function `pinRunState`, asserted
// arm by arm, AND a completed turn is driven end to end against a scripted model — so `"ran"` and
// its `spendEvents` row are produced by a run, not by a fixture.
import {
  freshRunCorrelation,
  packPreflight,
  pinIdentity,
  type ReachablePackSource,
  resolveWorkflowPack,
  type SourceState,
  type TenantSkillRef,
  WORKFLOW_PACK_IDS,
  WORKFLOW_PACKS,
  type WorkflowPackId,
} from "@pikar/core";
import { v } from "convex/values";
import { api, internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { internalQuery, type QueryCtx } from "./_generated/server";
import { getGuardrailConfig } from "./guardrails";
import { tenantAction, tenantMutation, tenantQuery } from "./lib/functions";
import { contentHash } from "./lib/hash";
import { probeSourcesFor } from "./workflowPackDiscovery";

/** A reason the run must NOT start. Blockers are refusals; notices are things the user should know
 *  about a run that will still happen. Collapsing the two is how a UI turns "you should know" into
 *  "you cannot", or worse, the other way around. */
export type PinBlocker = "paused" | "template_not_active";

export type PinNotice =
  | "template_republished"
  | "customization_applied"
  | "customization_missing"
  | "sources_unavailable";

export type PinReadiness = {
  readonly runnable: boolean;
  readonly blockers: readonly PinBlocker[];
  readonly notices: readonly PinNotice[];
  /** The version the pin holds. */
  readonly templateVersion: number;
  /** The version that is LIVE now — `null` when no approved row exists any more. */
  readonly activeVersion: number | null;
  readonly sourceUnavailableCount: number;
  /** Whether the pin names a tenant customization at all. It is never APPLIED (see the header);
   *  this says whether there is one to be honest about. */
  readonly customizationPinned: boolean;
};

export type PinCheck =
  | { readonly ok: false; readonly reason: "unknown_pin" }
  | ({ readonly ok: true; readonly templateId: WorkflowPackId } & PinReadiness);

/**
 * What ONE press did, as far as this server can prove. See the header: only two of these three
 * states permit a "nothing was spent" sentence, and `"unknown"` is not one of them.
 *
 * - `"ran"`     the pack loop produced its own terminal outcome. "Ran and found nothing" is a run:
 *               `outcome: "no_findings"` is `"ran"`, not `"unknown"`.
 * - `"blocked"` the governed gate refused before the model. `outcome: "blocked"`, `costUsd: 0`.
 * - `"unknown"` no outcome came back. The turn may have reached the model and recorded spend.
 */
export type PinRunState = "ran" | "blocked" | "unknown";

/**
 * THE WHOLE MONEY DISCRIMINANT, as a pure function of one string — and it is a function, exported
 * and asserted arm by arm, because the version that lived inline was HALF-COVERED and that half was
 * the dangerous one.
 *
 * Every $0 drive of `runAgain` either exhausts the budget (`"blocked"`) or throws before a thread
 * (`null`), so the `"ran"` arm was reached by no test at all: collapsing it into `"blocked"`
 * (`outcome === null ? "unknown" : "blocked"`) left the whole backend suite green while a run that
 * reached the model, answered and recorded spend was rendered as "Nothing ran and nothing was
 * spent". That is the same $0 lie the enum replaced the boolean to kill, one layer down.
 *
 * Both halves of the close are in the tests, not here: all three arms are asserted directly against
 * this function, AND a completed turn is driven end to end against a scripted model so `"ran"` is
 * produced by a real run — with a real `spendEvents` row beside it — and not only by a fixture.
 */
export function pinRunState(outcome: string | null): PinRunState {
  if (outcome === null) return "unknown";
  return outcome === "blocked" ? "blocked" : "ran";
}

export type RunAgainResult =
  /** Refused BEFORE anything started. Nothing exists and nothing was spent — provably. */
  | { readonly ok: false; readonly reason: "unknown_pin" }
  | { readonly ok: false; readonly reason: "not_ready"; readonly blockers: readonly PinBlocker[] }
  /** A turn was attempted. `state` is the whole of what is known about it. */
  | {
      readonly ok: true;
      /** `null` when the attempt threw before `startWorkflowPack` returned a thread. */
      readonly threadId: string | null;
      readonly state: PinRunState;
      /** The pack's own terminal outcome, or `null` when the turn never produced one. */
      readonly outcome: string | null;
    };

/**
 * The narrowing every entry point goes through: is this id a WORKFLOW pin belonging to the caller?
 *
 * A missing id, another tenant's id and a plain prompt pin all come back `null` — the answer must
 * not be an oracle for "does this id exist somewhere else?", which is the same posture
 * `savedPrompts.remove` takes.
 */
function asPin(
  row: Doc<"savedPrompts"> | null,
  tenantId: string,
): {
  readonly row: Doc<"savedPrompts">;
  readonly packId: WorkflowPackId;
  readonly templateVersion: number;
} | null {
  if (row === null || row.tenantId !== tenantId) return null;
  if (row.templateId === undefined || row.templateVersion === undefined) return null;
  const resolved = resolveWorkflowPack(row.templateId);
  return resolved.ok
    ? { row, packId: resolved.packId, templateVersion: row.templateVersion }
    : null;
}

/** The tenant's newest customization row for one pack, or `undefined`. The same descending
 *  `by_tenant_name_version` `take(1)` `readTenantPublishState` and `listPacks` perform — the row
 *  the server itself treats as "the tenant's current draft of this pack". A `system` baseline
 *  carries no template lineage and is NOT a customization. */
async function newestCustomization(
  ctx: QueryCtx,
  tenantId: string,
  packId: WorkflowPackId,
): Promise<Doc<"tenantSkills"> | undefined> {
  const newest = (
    await ctx.db
      .query("tenantSkills")
      .withIndex("by_tenant_name_version", (q) =>
        q.eq("tenantId", tenantId).eq("name", WORKFLOW_PACKS[packId].skillName),
      )
      .order("desc")
      .take(1)
  )[0];
  if (newest === undefined) return undefined;
  return newest.templateId === packId && newest.customizationHash !== undefined
    ? newest
    : undefined;
}

/** The ACTIVE approved row for one pack, or `null`. `by_name_status` with an exact status, never
 *  "newest row" — which would surface a candidate the moment one is published. */
async function activeTemplate(
  ctx: QueryCtx,
  packId: WorkflowPackId,
): Promise<Doc<"skills"> | null> {
  return await ctx.db
    .query("skills")
    .withIndex("by_name_status", (q) =>
      q.eq("name", WORKFLOW_PACKS[packId].skillName).eq("status", "active"),
    )
    .unique();
}

/**
 * Resolve ONE pin against what is live RIGHT NOW. Never against what the pin remembers.
 *
 * `runtime` and `killSwitch` are passed in rather than read here so `listPins` probes once for the
 * whole list — the six specs read the same planes, and one probe per pin would be N times the reads
 * for one answer (the `listPacks` precedent).
 */
async function readinessFor(
  ctx: QueryCtx,
  tenantId: string,
  pin: NonNullable<ReturnType<typeof asPin>>,
  runtime: Partial<Record<ReachablePackSource, SourceState>>,
  killSwitch: boolean,
): Promise<PinReadiness> {
  const blockers: PinBlocker[] = [];
  const notices: PinNotice[] = [];
  if (killSwitch) blockers.push("paused");

  const active = await activeTemplate(ctx, pin.packId);
  if (active === null) blockers.push("template_not_active");
  else if (active.version !== pin.templateVersion) notices.push("template_republished");

  const pinnedRow = pin.row.tenantSkillId;
  if (pinnedRow !== undefined) {
    const mine = await ctx.db.get(pinnedRow);
    // A row that has been deleted, or that belongs to someone else, is not this tenant's
    // customization — and saying "not applied" about it would imply it still exists.
    notices.push(
      mine === null || mine.tenantId !== tenantId
        ? "customization_missing"
        : "customization_applied",
    );
  }

  const missingRuntime = packPreflight(pin.packId, runtime).missingRuntime.length;
  if (missingRuntime > 0) notices.push("sources_unavailable");

  return {
    runnable: blockers.length === 0,
    blockers,
    notices,
    templateVersion: pin.templateVersion,
    activeVersion: active?.version ?? null,
    sourceUnavailableCount: missingRuntime,
    customizationPinned: pinnedRow !== undefined,
  };
}

/**
 * Pin one approved workflow. `templateId` is the ONLY argument.
 *
 * EVERY LINEAGE FIELD IS SERVER-DERIVED — the live approved version, and the tenant's own newest
 * customization row id and hash. A caller cannot name a version or a candidate row, so there is no
 * field here through which a browser could pin someone else's row or a version that was never
 * approved. (Source preferences are NOT among them: nothing writes that field — see below.)
 *
 * The pinned TEXT is the pack's code-owned `opener`, the same string the workspace quick-start
 * sends. A pin is "run this approved workflow again", not a saved prompt with a workflow attached.
 *
 * ONE PIN PER PACK, PER TENANT — re-pinning REPLACES. The previous version kept every lineage a
 * tenant ever pinned, and each extra row was invisible (the surface renders one row per PACK and
 * takes the newest pin of it), unremovable (`savedPrompts.list` filters workflow pins out of the
 * only other menu) and functionally identical: `runAgain` sends the pack id and re-resolves to the
 * ACTIVE version, so a pin of version 4 and a pin of version 5 run the same thing. The pinned
 * version is a DISPLAY fact — "this is the version you pinned, and here is the one that will run" —
 * not a selector, so keeping a second one bought nothing and cost an unbounded row count on a table
 * whose other reader is a bounded menu.
 *
 * `textHash` still folds the whole lineage via `pinIdentity` (the collision `schema.ts` warned the
 * first lineage-bearing writer about: the opener is a code-owned constant, so a text-only hash
 * would collide across packs' customizations). Its remaining job is idempotence — pressing Pin
 * twice with nothing changed must not rewrite the row.
 */
export const pinWorkflow = tenantMutation({
  args: {
    /** `v.string()` because `resolveWorkflowPack` is the fail-closed door and its refusal must be
     *  reachable from a caller to be testable — the `packArgs` precedent. */
    templateId: v.string(),
  },
  handler: async (
    ctx,
    { templateId },
  ): Promise<
    | { ok: false; reason: "unknown_template" | "template_not_active" }
    | { ok: true; id: Id<"savedPrompts">; inserted: boolean }
  > => {
    const resolved = resolveWorkflowPack(templateId);
    if (!resolved.ok) return { ok: false, reason: "unknown_template" };
    const packId = resolved.packId;
    const spec = WORKFLOW_PACKS[packId];

    // A pin must name an APPROVED version. There is nothing honest to pin before one exists.
    const active = await activeTemplate(ctx, packId);
    if (active === null) return { ok: false, reason: "template_not_active" };

    const mine = await newestCustomization(ctx, ctx.tenantId, packId);
    const identity = pinIdentity({
      templateId: packId,
      templateVersion: active.version,
      // Two branded string types (`Id<"tenantSkills">` and the pure package's opaque
      // `TenantSkillRef`) name the SAME row id; neither brand is assignable to the other, and
      // `@pikar/core` cannot import Convex's. The double cast is the whole conversion.
      tenantSkillId: (mine?._id ?? null) as unknown as TenantSkillRef | null,
      customizationHash: mine?.customizationHash ?? "",
      // EMPTY ON PURPOSE, and the field is not stored on the row either. A source preference is
      // read out of `mine.customizationValues`, and `customizationHash` is the hash of exactly
      // those values on exactly that row — so a preference change ALREADY changes this identity
      // through the hash, and a second copy of the same fact could only ever agree with it. The
      // pinned list was also read by nothing: no runtime honours it (`runAgain` sends the pack id
      // and the code-owned opener), and the surface never rendered it, so storing it would have
      // been a promise the run does not keep.
      // ponytail: the parameter stays because `pinIdentity` lives in `@pikar/core`, which this plan
      // does not own. Upgrade path: drop the field from `WorkflowPin` when core is next touched.
      sourcePreferences: [],
    });
    const textHash = await contentHash(identity);

    const existing = await ctx.db
      .query("savedPrompts")
      .withIndex("by_tenant_textHash", (q) =>
        q.eq("tenantId", ctx.tenantId).eq("textHash", textHash),
      )
      .unique();
    if (existing) return { ok: true, id: existing._id, inserted: false };

    // The lineage changed, so this pack's OLD pin is replaced rather than joined. Tenant-first
    // index, so this can only ever reach the caller's own rows.
    for (const stale of await ctx.db
      .query("savedPrompts")
      .withIndex("by_tenant_template", (q) =>
        q.eq("tenantId", ctx.tenantId).eq("templateId", packId),
      )
      .collect()) {
      await ctx.db.delete(stale._id);
    }

    const id = await ctx.db.insert("savedPrompts", {
      tenantId: ctx.tenantId,
      text: spec.opener,
      title: spec.title,
      textHash,
      templateId: packId,
      templateVersion: active.version,
      ...(mine === undefined
        ? {}
        : { tenantSkillId: mine._id, customizationHash: mine.customizationHash }),
      createdAt: Date.now(),
    });
    return { ok: true, id, inserted: true };
  },
});

/**
 * Unpin. Reads the exact row, and refuses anything that is not one of THIS tenant's workflow pins —
 * a plain prompt pin is `savedPrompts.remove`'s business, and the workflows surface must not be
 * able to delete one. A missing id, a foreign id and a prompt pin all return the same
 * `{removed:false}`.
 */
export const unpinWorkflow = tenantMutation({
  args: { id: v.id("savedPrompts") },
  handler: async (ctx, { id }): Promise<{ removed: boolean }> => {
    const pin = asPin(await ctx.db.get(id), ctx.tenantId);
    if (pin === null) return { removed: false };
    await ctx.db.delete(id);
    return { removed: true };
  },
});

/** One pin as the surface renders it. Refs, a title, versions and closed-enum states — the pinned
 *  TEXT is not returned, because it is a code-owned opener the surface already knows from
 *  `WORKFLOW_PACKS` and shipping it would invite a second, drifting copy of the same string. */
export type PinnedWorkflowView = {
  readonly id: Id<"savedPrompts">;
  readonly templateId: WorkflowPackId;
  readonly title: string;
  readonly createdAt: number;
} & PinReadiness;

/**
 * This tenant's workflow pins, in the product's own pack order, each resolved against what is
 * live now.
 *
 * SIX INDEXED READS, ONE PER APPROVED TEMPLATE, off `by_tenant_template` — the index 29-01 added
 * for exactly this. The alternative (take the newest 20 `savedPrompts` rows and filter) would drop
 * a pin the moment twenty plain prompt pins were newer than it.
 *
 * THE LIST IS BOUNDED BY `WORKFLOW_PACK_IDS`, not by a `take`: `pinWorkflow` keeps at most one pin
 * per pack, so six reads return at most six rows. There is no "newest first" sort any more — with
 * one pin per pack there is no second row of a pack to be newer than, and an ordering rule nothing
 * can violate is an ordering rule no test can defend.
 */
export const listPins = tenantQuery({
  args: {},
  handler: async (ctx): Promise<PinnedWorkflowView[]> => {
    const rows: Doc<"savedPrompts">[] = [];
    for (const packId of WORKFLOW_PACK_IDS) {
      rows.push(
        ...(await ctx.db
          .query("savedPrompts")
          .withIndex("by_tenant_template", (q) =>
            q.eq("tenantId", ctx.tenantId).eq("templateId", packId),
          )
          .collect()),
      );
    }

    const runtime = await probeSourcesFor(ctx, ctx.tenantId);
    const { killSwitch } = await getGuardrailConfig(ctx);
    const out: PinnedWorkflowView[] = [];
    for (const row of rows) {
      const pin = asPin(row, ctx.tenantId);
      if (pin === null) continue;
      out.push({
        id: row._id,
        templateId: pin.packId,
        title: row.title,
        createdAt: row.createdAt,
        ...(await readinessFor(ctx, ctx.tenantId, pin, runtime, killSwitch)),
      });
    }
    return out;
  },
});

/** One pin's readiness, resolved on demand — the pre-run check the button reads, and the same
 *  resolution `runAgain` itself performs before it fires. */
export const checkReadiness = tenantQuery({
  args: { id: v.id("savedPrompts") },
  handler: async (ctx, { id }): Promise<PinCheck> => {
    const pin = asPin(await ctx.db.get(id), ctx.tenantId);
    if (pin === null) return { ok: false, reason: "unknown_pin" };
    const runtime = await probeSourcesFor(ctx, ctx.tenantId);
    const { killSwitch } = await getGuardrailConfig(ctx);
    return {
      ok: true,
      templateId: pin.packId,
      ...(await readinessFor(ctx, ctx.tenantId, pin, runtime, killSwitch)),
    };
  },
});

/** The audit event one manual re-run writes. Refs, ids, counts and flags only (CLAUDE.md §4) — the
 *  pin TITLE is user-visible product copy and the pinned TEXT is a request; neither goes on the log
 *  plane, and there is no field here for either to arrive in. */
export const PIN_RUN_EVENT = "workflow_pin.run";

/**
 * How many times this pin has been run, counted from the AUDIT plane.
 *
 * There is no run-history table and none may be added (the `savedPrompts` comment at schema.ts:442
 * says so in as many words). The audit log already records every run of every pin as one
 * insert-only row whose `correlationId` starts with this pin's own prefix, so the repeat ordinal is
 * a range read over `by_correlation`. The prefix is DERIVED from `freshRunCorrelation` rather than
 * re-typed, so the counter and the minter cannot drift apart.
 *
 * TWO NARROWINGS, AND BOTH ARE DRIVEN BY A TEST RATHER THAN ARGUED IN THIS COMMENT:
 *   - the prefix contains the pin's own row id, which is globally unique, so a second pin's runs
 *     and another tenant's runs both fall outside the range ("two pins, two tenants, one ordinal");
 *   - `eventType` is compared, so a future writer that reuses this correlation for a different
 *     event cannot silently inflate the ordinal.
 *
 * ponytail: `.collect()`, bounded by ONE pin's own run count. Ceiling: a pin run thousands of times
 * reads thousands of rows for a display number. Upgrade path if that ever happens: keep the count
 * in the aggregate `auditCounts` already registered for this table.
 */
export const runCount = internalQuery({
  args: { pinId: v.id("savedPrompts") },
  handler: async (ctx, { pinId }): Promise<number> => {
    const prefix = freshRunCorrelation(pinId, "");
    const rows = await ctx.db
      .query("audit")
      .withIndex("by_correlation", (q) =>
        // The upper bound is written as the ESCAPE `\uffff`, never the literal
        // character: the literal is invisible in a diff and editors re-encode it.
        q.gte("correlationId", prefix).lt("correlationId", `${prefix}\uffff`),
      )
      .collect();
    return rows.filter((r) => r.eventType === PIN_RUN_EVENT).length;
  },
});

/**
 * RUN AGAIN. One argument, and that is the whole replay story: there is no `threadId`, `planId`,
 * `correlationId` or approval ref in this validator, so a caller cannot name a prior run to resume.
 *
 * ORDER MATTERS AND IT IS THE POINT:
 *   1. readiness, against what is LIVE — a blocker refuses here, before a thread, a plan row, a
 *      registry load or a model call exists, so a refused press costs $0 and leaves nothing behind;
 *   2. a fresh `runId` and a fresh correlation, minted per press;
 *   3. `cockpit.startWorkflowPack` with NO `threadId` — `ensureThreadAndPlan` mints a new thread
 *      and a new `plans` row, exactly as a first typed message does. The governed pack loop then
 *      crosses `preCall`, the preflight, the tool allow-list and the one human Approve gate for
 *      itself; nothing here pre-approves anything;
 *   4. one insert-only audit row, carrying what happened.
 */
export const runAgain = tenantAction({
  args: { id: v.id("savedPrompts") },
  handler: async (ctx, { id }): Promise<RunAgainResult> => {
    const check = await ctx.runQuery(api.pinnedWorkflows.checkReadiness, { id });
    if (!check.ok) return { ok: false, reason: "unknown_pin" };
    if (!check.runnable) return { ok: false, reason: "not_ready", blockers: check.blockers };

    // Fresh per press. Same `runId` twice is retry idempotence WITHIN one run and is unreachable
    // from here — nothing accepts a `runId` from a caller.
    const correlationId = freshRunCorrelation(id, crypto.randomUUID());
    const ordinal = (await ctx.runQuery(internal.pinnedWorkflows.runCount, { pinId: id })) + 1;

    let threadId: string | null = null;
    let outcome: string | null = null;
    try {
      // The EXISTING twin of `sendCockpitMessage` — a pack turn is a different (allow-listed)
      // agent, so it has its own entry point. No `threadId`, ever. No `previewVersion`: that is
      // owner-only and this surface must never be able to reach a dark row.
      const res = await ctx.runAction(api.cockpit.startWorkflowPack, {
        packId: check.templateId,
        text: WORKFLOW_PACKS[check.templateId].opener,
      });
      threadId = res.threadId;
      outcome = res.outcome ?? null;
    } catch {
      // A throw here is NOT proof that nothing happened. `startWorkflowPack` swallows the pack
      // loop's own throws, so what reaches this catch comes from its thread/plan/message plumbing —
      // and `cockpitAgent.saveMessage` and `notifyIfAgentTimeout` both run AFTER the loop. So this
      // arm lands in exactly the same `unknown` state as `outcome === null`, and writes the same
      // row. Two arms with two different stories is how the last version told a $0 lie.
    }
    // `res.ok` is deliberately not read: `startWorkflowPack` sets `outcome` only when the loop
    // produced one, so the outcome IS the discriminant, and one discriminant cannot disagree with
    // itself. `"blocked"` is the only value that proves $0 (`runPackTurn` returns `costUsd: 0`
    // literally on that path); anything else with no outcome is unknown, not free.
    const state = pinRunState(outcome);

    await ctx.runMutation(internal.audit.log, {
      tenantId: ctx.tenantId,
      correlationId,
      eventType: PIN_RUN_EVENT,
      actor: "user",
      payload: {
        pinId: id,
        templateId: check.templateId,
        // The version the pin HOLDS and the version that was LIVE when it ran. Both, because a
        // republished template makes them differ and the log is where that is answered later.
        templateVersion: check.templateVersion,
        activeVersion: check.activeVersion,
        ordinal,
        // ONE field, the same closed enum the caller gets. The pair it replaced (`ran` + `started`
        // booleans) could not express "we do not know", so the log said `ran: false` about turns
        // that may have reached the model.
        state,
        outcome,
        threadId,
        noticeCount: check.notices.length,
        sourceUnavailableCount: check.sourceUnavailableCount,
        customizationPinned: check.customizationPinned,
        // A CONSTANT, and it is the honest one: see the header. `cockpit.ts` passes no
        // `tenantSkillIds`, so a pinned customization never reaches the model on this path.
        customizationApplied: false,
      },
    });

    return { ok: true, threadId, state, outcome };
  },
});
