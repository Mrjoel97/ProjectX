// THE DURABLE SPECIALIST RUN (42-02, G6). A dispatch stops being a bare `scheduler.runAfter` and
// becomes a journaled `@convex-dev/workflow` run with a terminal that fires whatever happens to it.
//
// DEFAULT RUNTIME, deliberately: `workflow.define` returns a RegisteredMutation, and `dispatch.ts`
// — which holds the three actions this steps into — is `"use node"` and may hold only actions. The
// argument validator and the fallback bodies therefore live in `lib/dispatchShared.ts`, which both
// sides import. `pipeline.ts` is the shipped precedent for a non-node workflow module stepping into
// a `"use node"` action (`pipeline.ts:243` → `internal.llm.route`, which is in the node `llm.ts`).
//
// ── THE MONEY RULE, AND WHY IT IS ONE LINE AND NOT THREE ──────────────────────────────────────
//
// The shared `WorkflowManager` sets `retryActionsByDefault: true` with `maxAttempts: 3`
// (`index.ts:10-11`). A specialist turn is NOT idempotent with respect to spend — `runSpecialistTurn`
// bills the model and `recordSpend` draws the rail down before any throw can be caught — so
// inheriting that default would turn one failed $0.02 turn into three. The repo already refused
// this exact bug one level down: `vaultIngestPool` leaves the flag at `false` because "`extractDoc`
// charges OCR pages via `recordSpend` before it reaches the ingest seam ... a silent retry would
// double-charge a reservation" (`index.ts:35-39`). The same sentence is true here, word for word.
//
// `{ retry: false }` on the step is what defeats it: the option flows verbatim into
// `workpool.enqueueAction`, and workpool's `getRetryBehavior` returns `undefined` on an explicit
// `false`, which means no retry behaviour at all. `pipeline.ts:243-247`, `:265-269`, `:347-351` and
// `smoke.ts:54` already do exactly this, on exactly the paid model call.
//
// ONE `workflow.define` with a `kind` switch, not three — and the reason is the failure mode. The
// dangerous edit here is an OMITTED option: a `step.runAction` written without `{ retry: false }`
// re-bills three times, with the compiler, biome and the whole behavioural suite blind to it. One
// call site cannot be half-omitted; three can. `dispatchRunGuard.test.ts` reads this file and pins
// that there is exactly ONE `step.runAction(` and that it carries the option.
//
// Durability is the ONLY thing bought here. The run's guards, its landing and its budget are
// unchanged: `governedDispatch`'s guard order, `dispatchAndLand`'s `finally`, and the envelope
// arithmetic at `dispatch.ts:474-481` are byte-identical.
import { vResultValidator, vWorkflowId, type WorkflowId } from "@convex-dev/workflow";
import { resolveSpecialist } from "@pikar/core";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { internalMutation } from "./_generated/server";
import { workflow } from "./index";
import {
  DISPATCH_ARGS,
  DISPATCH_KIND,
  ENVELOPE_FRACTION,
  failedMemoFor,
  narrowFanOut,
} from "./lib/dispatchShared";

/** Which action a run of each kind steps into. A record rather than a chain of `if`s so a fourth
 *  kind is a one-line addition that cannot forget the retry option — the option lives at the single
 *  call site below, not beside each target. */
const TARGET = {
  specialist: internal.dispatch.runSpecialist,
  research: internal.dispatch.runResearch,
  media: internal.dispatch.runMedia,
} as const;

/** The refs-only context the terminal receives back (CLAUDE.md §4). Ids, a code-owned `route`
 *  string and a code-owned `kind` literal — never the question, the brief, or a body. */
const RUN_CONTEXT = v.object({
  tenantId: v.string(),
  threadId: v.string(),
  planId: v.id("plans"),
  gapIndex: v.number(),
  route: v.string(),
  rootRequestId: v.string(),
  kind: DISPATCH_KIND,
});

/**
 * THE durable run. One step, because one paid action is all a dispatch is.
 *
 * The handler forwards its own workflow args VERBATIM as the step args, which is what makes replay
 * safe across a deploy: the journal compares the re-issued step's `{name, kind, args}` against the
 * recorded one, so a derivation that never changes can never mismatch. `unstableArgs` is
 * deliberately NOT set — it would permanently disable that check for no measured benefit.
 *
 * Nothing non-deterministic may run here. The workflow environment deletes `crypto` and `process`
 * before the handler executes, so `rootRequestId` is minted by the CALLER and travels in the args.
 */
export const dispatchRun = workflow.define({
  args: { kind: DISPATCH_KIND, ...DISPATCH_ARGS },
  handler: async (step, { kind, ...args }): Promise<null> => {
    // { retry: false } — READ THE MONEY RULE IN THIS FILE'S HEADER BEFORE TOUCHING THIS LINE.
    // Without it the shared manager retries a BILLED model turn up to three times.
    await step.runAction(TARGET[kind], args, { retry: false });
    return null;
  },
});

/**
 * THE way a dispatch is started, replacing three bare `scheduler.runAfter(0, internal.dispatch.*)`
 * calls (`evaluations.ts` applyActOnGap, and the two cockpit tools in `llm.ts`).
 *
 * A starter MUTATION rather than each caller invoking `workflow.start` itself, for one reason that
 * matters: `llm.ts` is `"use node"` and cannot import `workflow` from `./index`. This keeps the
 * node side calling `ctx.runMutation(internal.dispatchRun.startDispatchRun, …)` — a one-symbol swap
 * from what it did before — and keeps every workflow symbol on the V8 side.
 *
 * The `workflowId` lands on the plan row so the reliability sweep can ask the component whether the
 * run is still alive instead of guessing from `_scheduled_functions`. That column already exists
 * (`schema.ts`, `workflowId`) and `resetPlan` deliberately does not clear it, which is safe because
 * a start always overwrites it.
 */
export const startDispatchRun = internalMutation({
  args: { kind: DISPATCH_KIND, ...DISPATCH_ARGS },
  handler: async (ctx, args): Promise<string> => {
    const { kind, tenantId, threadId, planId, gapIndex, route, rootRequestId } = args;
    const workflowId = await workflow.start(ctx, internal.dispatchRun.dispatchRun, args, {
      onComplete: internal.dispatchRun.onDispatchComplete,
      context: { tenantId, threadId, planId, gapIndex, route, rootRequestId, kind }, // refs only (§4)
    });
    await ctx.db.patch(planId, { workflowId });
    return workflowId;
  },
});

/**
 * THE TERMINAL. `onComplete` fires once per workflow, on success, on failure and on cancellation —
 * including the case `dispatchAndLand`'s `finally` cannot reach, where the action never returns at
 * all. That is the whole durability claim, stated honestly: the run gets a SECOND, FREE, idempotent
 * landing attempt. It is not a rescue from eviction, and it is not a re-run.
 *
 * WHY THIS CANNOT DOUBLE-CHARGE, which is the property owner decision 2 protects.
 * `landSpecialistResult` is a MUTATION and calls no model. Its CAS returns early unless the row is
 * still `collecting` AND `kind === "memo"` AND the tenant matches, so on the normal path — where
 * the action's own `finally` already landed the row — this is a no-op that writes nothing. On the
 * path where the action died before landing, it is the only landing there will be. Free either way.
 */
export const onDispatchComplete = internalMutation({
  args: { workflowId: vWorkflowId, result: vResultValidator, context: RUN_CONTEXT },
  handler: async (ctx, { result, context }): Promise<void> => {
    if (result.kind === "success") return; // the action landed its own row; nothing to do

    // Refs and a CODE only — never `result.error`, which can carry prompt or grounded prose (§4).
    // `subagent.refused` with `reason` is already the shape this path writes at `dispatch.ts`, and
    // it is already on the read-time allowlist, so no projection change is needed.
    await ctx.runMutation(internal.audit.log, {
      tenantId: context.tenantId,
      correlationId: context.rootRequestId,
      eventType: "subagent.refused",
      actor: "system",
      payload: {
        rootRequestId: context.rootRequestId,
        planId: String(context.planId),
        specialist: context.route,
        reason: "error",
      },
    });

    await ctx.runMutation(internal.evaluations.landSpecialistResult, {
      tenantId: context.tenantId,
      threadId: context.threadId,
      planId: context.planId,
      gapIndex: context.gapIndex,
      route: context.route,
      incomplete: false,
      fallbackReason: "error",
      // The kind's own honest sentence. A research or media run has no evaluation row and no gap,
      // so the gap path's LOST_CONTEXT_MEMO ("the evaluation it was based on is no longer on file")
      // is FALSE for it — the exact dead-end those two constants exist to remove.
      ...(failedMemoFor(context.kind) === undefined
        ? {}
        : { fallbackBody: failedMemoFor(context.kind) }),
    });
  },
});

/**
 * Is this plan's dispatch still running? Asks the workflow component directly.
 *
 * `workflow.status` THROWS on an id the component cannot resolve (its handler asserts), so the call
 * is wrapped: an unresolvable id means "not live as far as we can tell", and the caller falls
 * through to its legacy scan. A throw here would kill the sweep batch this runs inside — the
 * watchdog the caller exists to keep honest.
 */
export async function dispatchWorkflowLive(
  ctx: Parameters<typeof workflow.status>[0],
  workflowId: string,
): Promise<boolean | null> {
  try {
    const status = await workflow.status(ctx, workflowId as WorkflowId);
    return status.type === "inProgress";
  } catch {
    return null; // unresolvable id — the caller decides what to do with "unknown"
  }
}

// ── 42-03: THE GOVERNED FAN-OUT (G6, ADR-037 + ADR-038) ───────────────────────────────────────

/** Which entry point a route's worker runs on. `research` has its OWN terminal
 *  (`persistResearchFindings` + `RESEARCH_FAILED_MEMO`), and putting a research child on the
 *  generic `specialist` path would lose the vault document AND land LOST_CONTEXT_MEMO's "the
 *  evaluation it was based on is no longer on file" — false for a run that was never based on one,
 *  and the exact dead end that constant exists to remove. `media` is refused at the door, not
 *  mapped: a media dispatch runs `groundMediaBrief`, a PAID turn with no envelope check, so N media
 *  children would be N full-price grounding passes outside every ceiling (ADR-037 open item (b)). */
const kindForRoute = (route: string): "specialist" | "research" =>
  route === "research" ? "research" : "specialist";

/** A worker's heading in the assembled parent memo, written at MINT time. The `plans` table has no
 *  `route` column, so this is how the route survives to `fanOutMemoBody` without anyone parsing it
 *  back out of rendered prose. */
const headingForRoute = (route: string): string =>
  route.replace(/-/g, " ").replace(/^./, (c) => c.toUpperCase());

/** What the model asked for, narrowed to what is legal. Dedupe FIRST: `SPECIALIST_ROUTES` is a
 *  closed six-member set, so five copies of `research` would otherwise survive validation and buy
 *  five identical paid turns on one question — and the cycle guard cannot catch it, because
 *  `wouldCycle` is evaluated per child against an empty ancestry and never fires between siblings.
 *  Order is the MODEL'S order, preserved: it chose what to ask and in what sequence, and ADR-038
 *  truncates from the front rather than re-ranking. */
const legalRoutes = (routes: readonly string[]): string[] =>
  [...new Set(routes.map((r) => r.trim()).filter((r) => r.length > 0))].filter(
    (r) => r !== "media" && resolveSpecialist(r).ok,
  );

/** No route the code recognises. Driver-plane sentence, never a reason code (§4). */
const NO_ROUTES_REPLY =
  "I don't have specialists for any of those, so I've left the next step as a written plan instead.";
/** The rail cannot fund even one worker. The single-dispatch twin of `BUDGET_EXHAUSTED_REPLY`. */
const NO_BUDGET_REPLY =
  "This has used up the budget I set aside for today, so I haven't started the team. Ask me again" +
  " tomorrow, or ask me one question at a time.";

export type TeamRunResult =
  | { ok: true; workerCount: number; requested: number }
  | { ok: false; reply: string };

/**
 * MINT A FAN-OUT: one root, up to `MAX_FAN_OUT` children, one divided envelope, one approval.
 *
 * ── ADR-038: THE FAN-OUT NARROWS TO WHAT THE RAIL CAN FUND ────────────────────────────────────
 * `n = min(routes, MAX_FAN_OUT, rootEnvelope)` and `share = floor(rootEnvelope / n)`. Capping `n`
 * by the envelope is what makes `share >= 1` a theorem rather than a hope: for integers with
 * `1 <= n <= rootEnvelope`, `floor(rootEnvelope / n) >= 1`. That matters because a child handed
 * `envelopeCents: 0` does NOT get refused — `governedDispatch` reads `args.envelopeCents > 0 ? … :
 * derive`, so a zero child takes the DERIVE branch and is granted the FULL rail share. ADR-037
 * Decision 6 asserted the opposite; ADR-038 supersedes it on that point. `Math.max(1, …)` is still
 * forbidden — it would fund n workers at a penny each and the division would stop being one.
 *
 * The children are minted in ONE mutation, after the root, which is what keeps `ROOT_SCAN`'s
 * bounded descending scan correct: nothing newer than a root exists except its own children.
 *
 * ADR-008: the model supplies the routes and their order, and NOTHING else. Not the cap, not the
 * envelope, not the worker count that actually runs, not the lineage, not the depth.
 */
export const startTeamRun = internalMutation({
  args: {
    tenantId: v.string(),
    threadId: v.string(),
    /** The staged ROOT — `collecting` + `kind: "memo"`, created by the caller's stager. */
    planId: v.id("plans"),
    /** The model's routes, in the model's order. Validated and narrowed here, never trusted. */
    routes: v.array(v.string()),
    question: v.string(),
    rootRequestId: v.string(),
    skillVersions: v.optional(v.record(v.string(), v.number())),
    tenantSkillIds: v.optional(v.record(v.string(), v.id("tenantSkills"))),
  },
  handler: async (ctx, a): Promise<TeamRunResult> => {
    const routes = legalRoutes(a.routes);
    if (routes.length === 0) return { ok: false, reply: NO_ROUTES_REPLY };

    // The SAME derivation `governedDispatch` uses for a root, from the SAME constant — that is why
    // `ENVELOPE_FRACTION` moved to `lib/dispatchShared.ts`. `remainingDailyCents` is already clamped
    // at 0, so this is never negative.
    const rootEnvelope = Math.floor(
      (await ctx.runQuery(internal.guardrails.remainingDailyCents, { tenantId: a.tenantId })) *
        ENVELOPE_FRACTION,
    );
    const { workerCount, shareCents: share } = narrowFanOut(routes.length, rootEnvelope);
    // Nothing to narrow to. Fail closed, before a single row is inserted — the one case where the
    // refusal ADR-038 rejected as a general rule is still the only correct answer.
    if (workerCount === 0) return { ok: false, reply: NO_BUDGET_REPLY };

    const children: { planId: Id<"plans">; route: string }[] = [];
    for (const route of routes.slice(0, workerCount)) {
      const childId = await ctx.runMutation(internal.plans.insertPlan, {
        tenantId: a.tenantId,
        threadId: a.threadId,
        parentPlanId: a.planId,
        // BOTH of these are load-bearing at BIRTH, not decoration. Without `kind: "memo"` the
        // child's landing is discarded by `landSpecialistResult`'s CAS, the sibling flip never
        // fires, the parent hangs at `collecting` for ever, and `reliabilitySweep` cannot rescue it
        // because its own predicate wants the same field. Without `subject` the assembled parent
        // memo has no heading for this section.
        kind: "memo",
        subject: headingForRoute(route),
      });
      children.push({ planId: childId, route });
    }

    for (const child of children) {
      await ctx.scheduler.runAfter(0, internal.dispatchRun.startDispatchRun, {
        kind: kindForRoute(child.route),
        tenantId: a.tenantId,
        threadId: a.threadId,
        planId: child.planId,
        gapIndex: 0, // no gap on this path — the QUESTION briefs every worker
        route: child.route,
        question: a.question,
        // ONE lineage key for the whole tree (`audit.by_correlation` reconstructs it), and distinct
        // plan ids per worker. That pairing is exactly why the key is minted rather than derived.
        rootRequestId: a.rootRequestId,
        parentAgentId: "executive", // code-owned, never user or model text
        depth: 1,
        ancestry: [],
        // NEVER 0 — see the header. `share >= 1` is guaranteed by the cap above.
        envelopeCents: share,
        spentCents: 0,
        ...(a.skillVersions === undefined ? {} : { skillVersions: a.skillVersions }),
        ...(a.tenantSkillIds === undefined ? {} : { tenantSkillIds: a.tenantSkillIds }),
      });
    }

    // Refs and counts only (§4). `workerCount` is new on this event and is allow-listed in
    // `auditProjection.ts` in the same commit — a payload key that is written and not listed is
    // invisible at read time, which is how `webSearchCalls` came to be logged and unreadable.
    await ctx.runMutation(internal.audit.log, {
      tenantId: a.tenantId,
      correlationId: a.rootRequestId,
      eventType: "subagent.dispatched",
      actor: "system",
      payload: {
        rootRequestId: a.rootRequestId,
        planId: String(a.planId),
        depth: 1,
        envelopeCents: share,
        spentCents: 0,
        workerCount,
      },
    });

    return { ok: true, workerCount, requested: a.routes.length };
  },
});
