// CASH adapter — the READ side of the business-finance plane, tenant-scoped.
//
// THIS MODULE IS A READER AND ONE WRITER. Every derivation lives in `@pikar/core`'s `cash.ts`
// (CLAUDE.md §1); re-deriving anything here would create a second, silently-drifting definition of
// the business's money — the exact drift that produced two separate selector bugs on 2026-08-09.
//
// EVERY SECTION IS ITS OWN QUERY, on purpose. A failing scorecard read must take out unit economics
// and leave solvency, activity and the whole Pikar-spend tab standing.
//
// NO FIGURE IS EVER LOGGED. A tenant's cash on hand, CAC and MRR are precisely what CLAUDE.md §4
// keeps out of the audit table. The ONE audit event this module writes — `finance.claims_applied`,
// from the Approve-gated applier — carries field NAMES, a COUNT and enums, never a value. Any event
// added here must obey the same rule.
import {
  activityFromSends,
  CASH_INPUTS,
  type CashInputField,
  type CashInputState,
  cashInputSpec,
  solvency as coreSolvency,
  unitEconomics as coreUnitEconomics,
  createDashboardBound,
  type FigureClaim,
  financeSpineLine,
  isNewerThan,
  needsConfirmation,
  type Tier,
  toCashInputs,
  validateFigureClaim,
} from "@pikar/core";
import type { Scorecard } from "@pikar/core/growth/index";
import { emptyScorecard } from "@pikar/core/growth/index";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalQuery, type MutationCtx, type QueryCtx } from "./_generated/server";
import { applyScorecardAnswer, latestScorecardRow } from "./evaluations";
import { tenantMutation, tenantQuery } from "./lib/functions";

/** 31 days, matching the Cost console's reported window so the two tabs speak the same period. */
const MAX_WINDOW_MS = 31 * 24 * 60 * 60 * 1000;
/** A bounded read. A tenant past this in one window has their count reported as a FLOOR. */
const SEND_SCAN_LIMIT = 1000;

export const activity = tenantQuery({
  args: { sinceMs: v.number(), untilMs: v.number() },
  handler: async (ctx, args) => {
    if (!Number.isSafeInteger(args.sinceMs) || !Number.isSafeInteger(args.untilMs)) {
      throw new Error("INVALID_WINDOW");
    }
    if (args.sinceMs >= args.untilMs) throw new Error("INVALID_WINDOW");
    if (args.untilMs - args.sinceMs > MAX_WINDOW_MS) throw new Error("INVALID_WINDOW");

    const rows = await ctx.db
      .query("requests")
      .withIndex("by_tenant_status_createdAt", (q) =>
        q
          .eq("tenantId", ctx.tenantId)
          .eq("status", "sent")
          .gte("createdAt", args.sinceMs)
          .lt("createdAt", args.untilMs),
      )
      .take(SEND_SCAN_LIMIT + 1);

    // A window that fills the cap is UNDER-reported. `partial` says the count is a floor rather
    // than letting a quietly small number read as the truth (the finance.ts readWindow precedent).
    const partial = rows.length > SEND_SCAN_LIMIT;
    const counted = rows.slice(0, SEND_SCAN_LIMIT);

    return {
      activity: activityFromSends({
        sentAtMs: counted.map((row) => row.createdAt),
        sinceMs: args.sinceMs,
        nowMs: args.untilMs,
      }),
      bound: createDashboardBound({
        returned: counted.length,
        limit: SEND_SCAN_LIMIT,
        nextCursor: null,
        partial,
        ...(partial ? { partialReason: "row-cap" as const } : {}),
      }),
    };
  },
});

/** The closed field union, mirroring `CashInputField`. A widening is a deliberate edit here. */
const vCashField = v.union(
  v.literal("cashOnHand"),
  v.literal("monthlyOperatingCost"),
  v.literal("mrr"),
  v.literal("receivables"),
  v.literal("payables"),
  v.literal("cac"),
  v.literal("thirtyDayCashPerCustomer"),
  v.literal("grossProfitPerPurchase"),
  v.literal("purchasesPerLifetime"),
  v.literal("customerCount"),
  v.literal("referralPct"),
);
// Compile-time bind, both directions: a field added to `@pikar/core` but not to the validator (or
// the reverse) is a COMPILE error here rather than a silently unsaveable form row.
const _fieldToDoc: readonly (typeof vCashField.type)[] = CASH_INPUTS.map((s) => s.field);
const _docToField: readonly CashInputField[] = [] as (typeof vCashField.type)[];

/** A dot-path read over the Scorecard. Mirrors `evaluations.ts`'s `getPath` on the write side. */
function scorecardValue(scorecard: Scorecard, path: string): number | null {
  const value = path
    .split(".")
    .reduce<unknown>((node, key) => (node as Record<string, unknown> | null)?.[key], scorecard);
  return typeof value === "number" ? value : null;
}

/**
 * The ONE read path over a tenant's cash inputs — `financeInputs` rows plus the scorecard's
 * Hormozi fields, merged into `CashInputState[]`. Both the `inputs` query (the panel) and the
 * `unitEconomics` query (the metrics) call this, so the two can never disagree about what the
 * tenant has entered — and, since the review fix, the always-on spine line reads it too, so all
 * four surfaces answer the provenance question identically rather than from three copies of the
 * merge rule.
 */
async function inputStatesFor(
  ctx: { db: QueryCtx["db"] },
  tenantId: string,
  nowMs: number,
): Promise<{ inputs: CashInputState[] }> {
  const rows = await ctx.db
    .query("financeInputs")
    .withIndex("by_tenant", (q) => q.eq("tenantId", tenantId))
    .collect();
  const byField = new Map(rows.map((row) => [row.field, row]));
  const evaluation = await latestScorecardRow(ctx.db, tenantId);
  const scorecard = (evaluation?.scorecard as Scorecard | undefined) ?? emptyScorecard;

  return {
    inputs: CASH_INPUTS.map((spec): CashInputState => {
      if (spec.store === "financeInputs") {
        const row = byField.get(spec.field as (typeof rows)[number]["field"]);
        const value = row?.valueUsd ?? null;
        const statedAt = row?.statedAt ?? null;
        return {
          field: spec.field,
          value,
          statedAt,
          stale: needsConfirmation(value, statedAt, nowMs),
          origin: row?.origin ?? "stated",
          actor: row?.actor ?? "user",
          basis: row?.basis ?? null,
        };
      }
      const value = spec.path === undefined ? null : scorecardValue(scorecard, spec.path);
      // `userProvidedAt` is a dot-path → epoch-ms map, stamped by `applyScorecardAnswer` and
      // carried forward UNCHANGED across every re-evaluation (`runEvaluation`) — unlike the
      // evaluation ROW's own `createdAt`, which is fresh on every carry-forward and is never a
      // field's stated time. A legacy row can hold a real value with no recorded stated time
      // (this field predates `userProvidedAt`, or a carried row's writer never stamped it);
      // `needsConfirmation` (the SAME predicate the `financeInputs` branch above and `cash.ts`'s
      // `statedFigure` both call — one definition, not three) treats that as needing confirmation,
      // never as fresh, and never fabricates a date.
      // `fieldProvenance` is the authority when present. `userProvided` / `userProvidedAt` remain
      // the fallback for rows written before the map existed: membership there means "somebody
      // answered, probably the owner" and absence means "we do not know" — both resolved in the
      // safe direction, exactly as before. New rows never take the fallback.
      const prov =
        spec.path === undefined ? undefined : evaluation?.fieldProvenance?.[spec.path as string];
      const statedAt =
        value === null
          ? null
          : (prov?.at ?? evaluation?.userProvidedAt?.[spec.path as string] ?? null);
      const userStated = prov
        ? prov.actor === "user"
        : (evaluation?.userProvided ?? []).includes(spec.path as string);
      return {
        field: spec.field,
        value,
        statedAt,
        stale: needsConfirmation(value, statedAt, nowMs),
        // The leak fix: a grounded fill is NOT a user statement, so it never borrows the owner's
        // authority. But it is NOT `observed` either — spec §1 reserves that for "Pikar measured
        // it", and nothing measures yet: a figure read out of the owner's own P&L is still an
        // assertion by a human, made in a document. `stated` + `agent` says exactly that, and is
        // what stops the page printing "Measured by Pikar on <date>." over a grounded fill.
        // `prov.origin` is the recorded truth when present — a figure PIKAR measured must not be
        // reported as `stated` just because this branch's default used to be unconditional.
        origin: prov?.origin ?? "stated",
        actor: userStated ? "user" : "agent",
        basis: userStated ? null : "business evaluation grounding",
      };
    }),
  };
}

export const inputs = tenantQuery({
  args: {},
  handler: async (ctx): Promise<{ inputs: CashInputState[] }> =>
    inputStatesFor(ctx, ctx.tenantId, Date.now()),
});

/**
 * The Hormozi spine (CLAUDE.md §1: `@pikar/core`'s `unitEconomics` does every derivation; this
 * only reads the same inputs `inputs` reads, plus the tenant's own scorecard, and hands them over).
 * A foreign tenant's scorecard is never read — `latestScorecardRow` is tenant-scoped, same as
 * `inputStatesFor`'s call to it above.
 *
 * Takes an EXPLICIT tenantId (not `ctx.tenantId`) so both the tenant-scoped `unitEconomics` query
 * below and the tool-loop's `unitEconomicsFor` internal reader call the SAME derivation — one
 * definition, not two silently-drifting copies of the business's money (see the module banner).
 */
async function unitEconomicsForTenant(
  ctx: { db: QueryCtx["db"] },
  tenantId: string,
  nowMs: number,
) {
  const states = (await inputStatesFor(ctx, tenantId, nowMs)).inputs;
  const evaluation = await latestScorecardRow(ctx.db, tenantId);
  return coreUnitEconomics({
    inputs: toCashInputs(states),
    scorecard: (evaluation?.scorecard as Scorecard | undefined) ?? emptyScorecard,
    nowMs,
  });
}

export const unitEconomics = tenantQuery({
  args: {},
  handler: async (ctx) => unitEconomicsForTenant(ctx, ctx.tenantId, Date.now()),
});

/**
 * The tenant's business SHAPE, read-only. The tier is derived from facts by
 * `tenantProfile.saveFacts` and is never settable here — this page consumes it and nothing more.
 * A tenant with no row gets nulls rather than a guessed "solopreneur": guessing is what the
 * markdown-fallback defect did, and a wrong guess here selects the wrong metric set.
 */
export const shape = tenantQuery({
  args: {},
  handler: async (ctx) => {
    const row = await ctx.db
      .query("tenantProfiles")
      .withIndex("by_tenant", (q) => q.eq("tenantId", ctx.tenantId))
      .unique();
    // `revenueStage` is deliberately NOT returned. The spec says not-applicable is decided by
    // "the tier and the revenue-stage answer", but no branch anywhere can correctly consult it:
    // making a pre-revenue business's MRR `not-applicable` would infer a permanent structural
    // answer from a stage field, which is the "never inferred from absent data" rule this type
    // exists to enforce. A pre-revenue startup that has not answered is `unknown` — never asked.
    // Owner ruling 2026-08-09 after Task 7's review. Do not re-add it "to match the spec".
    return {
      tier: row?.tier ?? null,
      funding: row?.funding ?? null,
    };
  },
});

/**
 * Explicit-tenantId twin of `unitEconomicsForTenant` above, for the same reason: `solvency` below
 * and the tool-loop's `solvencyFor` internal reader must share ONE derivation.
 *
 * `unknownTierFallback` (Task 7 review, Important 1) is the ONLY thing that may differ between
 * those two callers, and each states its own choice explicitly rather than this function picking
 * for both: the dashboard's `solvency` below defaults an unconfirmed tier to `"solopreneur"`
 * because the page ALSO shows a "complete your shape" invitation next to it — the guess is never
 * the whole story a user sees there. `solvencyFor` (the cockpit tool) has no such invitation, so it
 * passes `null` — a genuinely unconfirmed tier — straight through to `@pikar/core`'s `solvency()`,
 * which treats `null` as permissive rather than guessing "solopreneur" and asserting `mrr`/`arr`/
 * `workingCapital` structurally do not apply to a business that simply hasn't finished onboarding.
 */
async function solvencyForTenant(
  ctx: { db: QueryCtx["db"] },
  tenantId: string,
  nowMs: number,
  unknownTierFallback: Tier | null,
) {
  const row = await ctx.db
    .query("tenantProfiles")
    .withIndex("by_tenant", (q) => q.eq("tenantId", tenantId))
    .unique();
  const states = (await inputStatesFor(ctx, tenantId, nowMs)).inputs;
  return coreSolvency({
    inputs: toCashInputs(states),
    tier: row?.tier ?? unknownTierFallback,
    nowMs,
  });
}

export const solvency = tenantQuery({
  args: {},
  // No profile row: treat as solopreneur for not-applicable resolution, which is the most
  // conservative set — it hides MRR/ARR rather than inventing them. The page separately shows
  // the complete-your-shape invitation, so this is never the whole story a user sees.
  handler: async (ctx) => solvencyForTenant(ctx, ctx.tenantId, Date.now(), "solopreneur"),
});

// Explicit-tenantId internal readers for the tool loop (§2 allow-list, the `vaultGroundHydrated`
// convention `plans.ts` and `vaultGround.ts` already use). The tenant comes from the RUN, never
// from the model: `readFinance` in `llm.ts` has an empty input schema precisely so there is no
// argument to forge.
export const unitEconomicsFor = internalQuery({
  args: { tenantId: v.string() },
  handler: async (ctx, { tenantId }) => unitEconomicsForTenant(ctx, tenantId, Date.now()),
});

export const solvencyFor = internalQuery({
  args: { tenantId: v.string() },
  // `null`, not `"solopreneur"` — see solvencyForTenant's doc comment. The tool has no
  // complete-your-shape invitation to lean on, so an unconfirmed tier stays genuinely unconfirmed.
  handler: async (ctx, { tenantId }) => solvencyForTenant(ctx, tenantId, Date.now(), null),
});

/**
 * Per-input freshness for the tool loop (Task 7 review, Important 2). `readFinance`'s own
 * description promises figures that are "missing or out of date" — every SUPPRESSED derived figure
 * already names what it needs, but a `known` DERIVED figure (runway, CFA, LTGP:CAC, …) carries no
 * staleness marker of its own (only `statedFigure`'s two direct call sites, `mrr` and `referralPct`,
 * ever set `stale`). This is the same `CashInputState[]` `inputs` above already computes — the tool
 * includes it so the agent can say "this rests on a cash figure you last confirmed in February"
 * without needing to cross-reference a different part of the turn to find that out.
 */
export const inputsFor = internalQuery({
  args: { tenantId: v.string() },
  handler: async (ctx, { tenantId }): Promise<{ inputs: CashInputState[] }> =>
    inputStatesFor(ctx, tenantId, Date.now()),
});

/**
 * The ALWAYS-ON finance line for the cockpit turn prompt (spec §2), assembled on every turn. STATE,
 * never analysis — values, ages, `?` for a missing input, `STALE` past `needsConfirmation`, and a
 * `PIKAR` marker on any figure the agent recorded rather than heard from the owner. Derived metrics
 * stay behind the on-demand `readFinance` tool, which is what keeps this line affordable per turn.
 *
 * `null` when the tenant has collected nothing: a line saying the agent knows nothing spends budget
 * on every turn to say what its absence already says.
 *
 * ITS OWN QUERY, deliberately NOT appended to `blueprint.spineForTenant` — that is a grounding
 * chunk as well as prompt context, and `evaluations.ts`'s `FINANCIAL_PATTERNS` would capture these
 * figures as the value of a label mentioned in the blueprint (see the long comment on
 * `spineForTenant`). The two channels are joined in `buildTurnPrompt` and nowhere else, so the
 * separation is structural rather than a rule someone has to remember.
 */
export const financeSpineFor = internalQuery({
  args: { tenantId: v.string() },
  handler: async (ctx, { tenantId }): Promise<string | null> => {
    const nowMs = Date.now();
    return financeSpineLine((await inputStatesFor(ctx, tenantId, nowMs)).inputs, nowMs);
  },
});

/**
 * THE writer, routing by field to the store that owns the value. Both actors route through this one
 * function (contacts-crm invariant 13): the ungated human edit below, and the Approve-gated applier.
 * Two copies of the store-routing rule would be two chances to disagree about where a figure lives.
 *
 * A plain async function over an EXPLICIT tenantId — never `ctx.tenantId` — so the applier can
 * pass the tenant read off the approved plan row.
 *
 * The Hormozi inputs go to the SCORECARD through `applyScorecardAnswer` — the same function
 * `recordScorecardAnswer` and the cockpit tool use, so a number entered in the panel and a number
 * given in conversation land in the same place and carry forward the same way. The finance-ops
 * inputs go to `financeInputs`. Nothing is written twice.
 *
 * The claim is validated HERE and not only in the form: a form is a convenience, and this is the
 * trust boundary. Nothing about it is logged (CLAUDE.md §4) — the value IS the sensitive part.
 */
export async function writeFigureRow(
  db: MutationCtx["db"],
  tenantId: string,
  claim: FigureClaim,
): Promise<void> {
  const check = validateFigureClaim(claim);
  if (!check.ok) throw new Error(`INVALID_INPUT: ${check.reason}`);
  const spec = cashInputSpec(claim.field);

  if (spec.store === "scorecard") {
    if (spec.path === undefined) throw new Error("INVALID_INPUT: no scorecard path");
    // The scorecard store now carries per-dot-path provenance (`evaluations.fieldProvenance`), so
    // an agent claim is recorded honestly rather than refused: the value lands and is usable, the
    // write is stamped `actor: "agent"`, and `applyScorecardAnswer` keeps it OUT of `userProvided`
    // — which is what `runEvaluation` rebuilds its citation map from. B1 fix (Task 5, round 1):
    // `applyScorecardAnswer` also DROPS the path from `userProvided` when an agent write overwrites
    // a figure the user previously saved themselves, so a stale membership marker cannot outlive the
    // value it once described. That closes the two laundering routes THIS guard's removal could have
    // reopened; it is not a claim that every future caller of `applyScorecardAnswer` is safe by
    // construction — a new caller still owes it honest provenance.
    //
    // No evaluation yet: seed under a stable, non-conversational thread id so the panel's answers
    // survive into the tenant's first real evaluation (the applyScorecardAnswer carrier path).
    const existing = await latestScorecardRow(db, tenantId);
    await applyScorecardAnswer(
      db,
      tenantId,
      existing?.threadId ?? "finance-panel",
      spec.path,
      claim.value,
      {
        actor: claim.actor,
        origin: claim.origin,
        source: claim.basis,
        at: claim.observedAt,
      },
    );
    return;
  }

  const row = await db
    .query("financeInputs")
    .withIndex("by_tenant_field", (q) =>
      q.eq("tenantId", tenantId).eq("field", claim.field as "cashOnHand"),
    )
    .unique();
  const write = {
    valueUsd: claim.value,
    statedAt: claim.observedAt,
    origin: claim.origin,
    actor: claim.actor,
    basis: claim.basis,
  };
  if (row) await db.patch(row._id, write);
  else
    await db.insert("financeInputs", {
      tenantId,
      field: claim.field as "cashOnHand",
      ...write,
    });
}

export const saveInput = tenantMutation({
  args: { field: vCashField, value: v.number() },
  handler: async (ctx, { field, value }): Promise<{ saved: true }> => {
    // The human editing their own number is UNGATED — invariant 11: the ACTOR decides gating, not
    // the operation. Same writer, no plan, no approval.
    await writeFigureRow(ctx.db, ctx.tenantId, {
      field,
      value,
      origin: "stated",
      actor: "user",
      basis: "finance panel",
      observedAt: Date.now(),
      confidence: "high",
    });
    return { saved: true };
  },
});

/** Every way a staged finance claim can be refused at Approve time. Distinct from a throw
 *  (2026-08-10): `executePlan`'s finance_write arm returns these to the approval card via
 *  `refusalMessage` — the SAME delivery path `no_deck` and the CAN-SPAM refusals use — rather
 *  than a raw `Error` that Convex redacts in production and the card cannot render.
 *
 *  ponytail: `agent_cannot_update_figure` is no longer PRODUCED by `applyFinanceClaims` — the
 *  scorecard store now carries per-dot-path provenance, so a scorecard claim is refused (or not)
 *  by the same `malformed_figure_claim` rule as every other field. The member is deliberately
 *  RETAINED for the rendered refusal vocabulary: it has consumers across the approvals UI, the
 *  workspace cards, and several tests. Do not delete it as unreachable-code cleanup. */
export type FinanceApplyRefusal = "malformed_figure_claim" | "agent_cannot_update_figure";

/**
 * The ONLY path an agent-proposed figure reaches a store, and `executePlan` is its only caller
 * (invariant 11 — the ACTOR decides gating: the human's identical edit above stages no plan).
 * Re-validates every claim: the plan row is content plane and could have been revised between
 * staging and Approve. `actor` is the one field it does not re-validate but OVERWRITES — see the
 * stamp in the write loop below.
 *
 * TWO PASSES, not one interleaved loop. A `return` (unlike the throw this replaced) does NOT roll
 * back Convex's transaction — only a throw does that — so a refusal discovered mid-write would
 * leave the mutation half-applied instead of all-or-nothing. Every claim is therefore validated
 * FIRST, with zero writes, and only once the whole list clears does the write pass run.
 *
 * Takes the whole `MutationCtx` rather than just `db` — mirroring `contacts.applyCrmOperations` —
 * because the audit insert goes through `internal.audit.log`, the module's SOLE write surface for
 * that table (CLAUDE.md §3). A direct `db.insert("audit", …)` here would be a second one.
 */
export async function applyFinanceClaims(
  ctx: MutationCtx,
  tenantId: string,
  claims: readonly FigureClaim[] | undefined,
): Promise<
  { ok: true; applied: number; skipped: number } | { ok: false; reason: FinanceApplyRefusal }
> {
  const list = claims ?? [];
  // Nothing was proposed, so there is no governed action to report. Not reachable from the product
  // — `stageFinanceWrite` refuses an empty `updates` list before it patches the plan — so this is
  // the degenerate case of a hand-seeded or legacy row, not the skip path review I5 is about.
  if (list.length === 0) return { ok: true, applied: 0, skipped: 0 };

  // PASS 1 — validate everything, write nothing.
  for (const claim of list) {
    // A claim off a plan row is DB-sourced JSON cast to FigureClaim — it is NOT type-checked
    // input. `validateFigureClaim` throws past its own ok/reason contract on two shapes a stored
    // row can hold: an unknown `field` reaches `cashInputSpec`, which throws, and a null `basis`
    // TypeErrors on `.trim()`. Narrow BEFORE validating, or an approved plan crashes the mutation
    // instead of refusing cleanly.
    if (!CASH_INPUTS.some((s) => s.field === claim.field) || typeof claim.basis !== "string") {
      return { ok: false, reason: "malformed_figure_claim" };
    }
    // The scorecard store now carries per-dot-path provenance (`evaluations.fieldProvenance`,
    // Task 4), so an agent claim on a scorecard field is no longer refused here — it is validated
    // by the SAME rule as every other claim below and, once it clears, recorded with
    // `actor: "agent"` and kept OUT of `userProvided`, so it never launders into the evaluation
    // engine's citations. `writeFigureRow`'s matching throw was lifted for the same reason.
    //
    // THE FULL RULE, not just the two shape-guards above: a blank basis (whitespace-only, not
    // just non-string), an out-of-range or NaN value, a NaN/negative/future observedAt. This is
    // the SAME check `writeFigureRow` runs and used to throw past this function's own return
    // contract — the plan row is content plane and may have been revised after staging, so a
    // future `observedAt` (the likeliest model error once Task 8 parses date phrases) or a
    // whitespace `basis` must refuse HERE, before pass 2 ever calls `writeFigureRow`, not inside
    // it. `writeFigureRow` keeps its own call to this as the last-resort guard for its OTHER
    // caller, `saveInput` — this one is now redundant for every claim reached from here, and
    // stays unreachable from this path by construction, not by convention.
    //
    // Validated on the STAMPED actor, not the raw one: `validateFigureClaim` refuses
    // `{actor: "user", confidence !== "high"}`, and the row's own `actor` is untrusted input this
    // function overwrites below regardless of what it says (see the stamp comment in pass 2).
    // Checking the raw value would resurrect exactly the failure mode that stamp exists to
    // prevent — "a staging bug must not become an error on a plan the human already approved" —
    // for the one field this function deliberately never trusts.
    if (!validateFigureClaim({ ...claim, actor: "agent" }).ok) {
      return { ok: false, reason: "malformed_figure_claim" };
    }
  }

  // PASS 2 — every claim cleared validation; now stamp, merge-check and write.
  const written: FigureClaim[] = [];
  for (const claim of list) {
    // `actor` is NOT data to be read off the row — it is a fact about which DOOR the write came
    // through, and this function IS the agent door (`saveInput` hardcodes `actor: "user"` and never
    // routes here). So it is STAMPED, not trusted. `validateFigureClaim` cannot catch a lie here:
    // its actor rule only bites when `confidence !== "high"`, and confidence is model-controlled,
    // so `{actor: "user", confidence: "high"}` is a legal claim by that function's contract and
    // would store the agent's figure under the OWNER's authority — rendering through
    // `inputStatesFor`/`statedFigure` as the owner's own statement (the exact leak Tasks 2 and 3
    // closed) and recording `actors: ["user"]` in the APPEND-ONLY audit log, which cannot be
    // corrected later. Stamped rather than refused because it cannot fail: a staging bug must not
    // become an error on a plan the human already approved.
    const stamped = { ...claim, actor: "agent" as const };
    // The merge policy lives in the CALLER — `writeFigureRow` has no isNewerThan guard, so without
    // this an approved claim observed in June patches over a figure the human saved today, moving
    // statedAt backward and flipping actor. A stale claim is SKIPPED, not an error: the store
    // already holds the better number, which is not a failure the approver needs to see.
    //
    // B4 fix (Task 5, round 1): `financeInputs` never carries a row for a scorecard-store field —
    // `cac` and its five siblings live in `evaluations.scorecard` — so the `financeInputs` lookup
    // below was always undefined for them and this check was a silent no-op: an agent claim always
    // "won" a scorecard field, even over a figure the owner typed TODAY, moving
    // `fieldProvenance.at` backwards. The staleness authority for a scorecard field is its own
    // `fieldProvenance[path].at`, the same column `writeFigureRow` stamps it into.
    //
    // Residual 2 fix (Task 5, round 2): `fieldProvenance` alone is not enough — a row written
    // BEFORE this plan existed has `userProvidedAt` but no `fieldProvenance` entry, so the lookup
    // above read `null` for every legacy row and an old agent claim could still clobber a figure
    // the owner typed months ago. Provenance-first, legacy-second: fall back to the pre-existing
    // `userProvidedAt[path]` when `fieldProvenance` has no entry yet, and only read `null` (anything
    // is newer — a genuine first claim must still write) when NEITHER has one.
    const spec = cashInputSpec(claim.field);
    let storedAt: number | null;
    if (spec.store === "scorecard") {
      const row = await latestScorecardRow(ctx.db, tenantId);
      storedAt =
        row?.fieldProvenance?.[spec.path as string]?.at ??
        row?.userProvidedAt?.[spec.path as string] ??
        null;
    } else {
      storedAt =
        (
          await ctx.db
            .query("financeInputs")
            .withIndex("by_tenant_field", (q) =>
              q.eq("tenantId", tenantId).eq("field", claim.field as "cashOnHand"),
            )
            .unique()
        )?.statedAt ?? null;
    }
    if (!isNewerThan(stamped, storedAt)) continue;
    await writeFigureRow(ctx.db, tenantId, stamped);
    // The STAMPED claim, so `payload.actors` reports the door, not the row's own claim about it.
    written.push(stamped);
  }
  // ALWAYS written, including when every claim was skipped (whole-branch review I5). The previous
  // `if (written.length === 0) return` left an APPROVED governed action with zero audit trace —
  // the card reported success, the log said nothing happened at all. `count` still reports only
  // what was WRITTEN (an event called `claims_applied` must not count an apply that did not
  // happen); `skipped` carries the rest, so the two are distinguishable in the log rather than
  // collapsed into silence. The vault source turns this from the rare case into the common one:
  // every re-proposal of a figure the owner has since typed lands here.
  //
  // §4: field NAMES, a COUNT and enums — never a figure. Tenant revenue in the append-only audit
  // log is precisely the PII honeypot §4 exists to prevent. `cash.test.ts` pins the sorted KEY SET
  // and asserts the figure is absent from the whole serialized row, so an added key fails there.
  await ctx.runMutation(internal.audit.log, {
    tenantId,
    // No request lineage to join to — an approved figure update is its own event (the
    // `blueprint.confirmed` idiom), so a fresh id beats a fabricated correlation.
    correlationId: crypto.randomUUID(),
    eventType: "finance.claims_applied",
    // The TENANT, matching `plan.canceled`'s idiom: this row exists because a human approved the
    // plan. Who AUTHORED each claim is `payload.actors`, and those are two different questions.
    actor: tenantId,
    payload: {
      count: written.length,
      skipped: list.length - written.length,
      fields: written.map((c) => c.field),
      actors: [...new Set(written.map((c) => c.actor))],
      confidences: [...new Set(written.map((c) => c.confidence))],
    },
  });
  return { ok: true, applied: written.length, skipped: list.length - written.length };
}
