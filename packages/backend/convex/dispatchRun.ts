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
import { assertResearchControlContext } from "./lib/toolContextArgs";

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
    assertResearchControlContext(args);
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
 *  back out of rendered prose.
 *
 *  ADR-040: the SUB-QUESTION is now part of it, and that is not decoration. Two children may
 *  share a route, so a heading of just `Research` would give the assembled parent several
 *  identical section headings and the reader could not tell which answer belonged to which
 *  question. `subject` is capped at the same 120 the root's is. */
const routeLabel = (route: string): string =>
  route.replace(/-/g, " ").replace(/^./, (c) => c.toUpperCase());
const headingFor = (route: string, question: string): string =>
  `${routeLabel(route)} \u2014 ${question}`.slice(0, 120);

/** An ASSIGNMENT is a route AND the sub-question that worker is being asked. ADR-040. */
export type Assignment = { route: string; question: string };

/** The dedupe KEY, and the one place the pair semantics live. Normalised so that trivial
 *  re-spellings of the same ask do not buy a second paid turn: case-folded, whitespace
 *  collapsed. The ORIGINAL question is what the worker is briefed with — only the key is
 *  normalised, because the model's own wording is the brief.
 *  `\u0000` as the separator: it cannot occur in a route or a question, so `a|b` and `a` + `|b`
 *  cannot collide the way they would with any printable joiner. */
const assignmentKey = (a: Assignment): string =>
  `${a.route}\u0000${a.question.toLowerCase().replace(/\s+/g, " ")}`;

/** What the model asked for, narrowed to what is legal.
 *
 *  DEDUPE IS ON THE PAIR, NOT THE ROUTE (ADR-040). Under ADR-037 a child was a route and this
 *  deduped by route, which was correct then: five copies of `research` on ONE question buy five
 *  identical paid turns, and the cycle guard cannot catch it because `wouldCycle` is evaluated
 *  per child against an empty ancestry and never fires between siblings. That protection is
 *  PRESERVED exactly — five copies of the same route AND the same question still collapse to
 *  one — while five `research` workers on five DIFFERENT sub-questions are now five different
 *  pieces of work, which is what makes a 15-worker team mean anything.
 *
 *  A blank question is dropped rather than defaulted to the umbrella question: defaulting would
 *  quietly re-create the identical-turn case this guards, wearing a route the caller did ask for.
 *  Order is the MODEL'S order, preserved: it chose what to ask and in what sequence, and ADR-038
 *  truncates from the front rather than re-ranking. */
const legalAssignments = (raw: readonly Assignment[]): Assignment[] => {
  const seen = new Set<string>();
  const out: Assignment[] = [];
  for (const item of raw) {
    const route = (item?.route ?? "").trim();
    const question = (item?.question ?? "").trim();
    if (route.length === 0 || question.length === 0) continue;
    if (route === "media" || !resolveSpecialist(route).ok) continue;
    const a = { route, question };
    const key = assignmentKey(a);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(a);
  }
  return out;
};

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
    /** The model's ASSIGNMENTS, in the model's order. Validated and narrowed here, never
     *  trusted — the route must resolve to a registered specialist and the question must be
     *  non-empty. ADR-040. */
    assignments: v.array(v.object({ route: v.string(), question: v.string() })),
    /** The UMBRELLA question. It brief no worker: it is the approval card's subject and the
     *  thing the assembled parent memo answers. Each worker is briefed with its OWN question. */
    question: v.string(),
    rootRequestId: v.string(),
    skillVersions: v.optional(v.record(v.string(), v.number())),
    tenantSkillIds: v.optional(v.record(v.string(), v.id("tenantSkills"))),
    evalBudgetId: v.optional(v.id("spendEvents")),
    researchControlId: v.optional(v.id("researchControls")),
    researchRequestId: v.optional(v.string()),
  },
  handler: async (ctx, a): Promise<TeamRunResult> => {
    assertResearchControlContext(a);
    const assignments = legalAssignments(a.assignments);
    if (assignments.length === 0) return { ok: false, reply: NO_ROUTES_REPLY };

    // The SAME derivation `governedDispatch` uses for a root, from the SAME constant — that is why
    // `ENVELOPE_FRACTION` moved to `lib/dispatchShared.ts`. `remainingDailyCents` is already clamped
    // at 0, so this is never negative.
    const rootEnvelope = Math.floor(
      (await ctx.runQuery(internal.guardrails.remainingDailyCents, { tenantId: a.tenantId })) *
        ENVELOPE_FRACTION,
    );
    const { workerCount, shareCents: share } = narrowFanOut(assignments.length, rootEnvelope);
    // Nothing to narrow to. Fail closed, before a single row is inserted — the one case where the
    // refusal ADR-038 rejected as a general rule is still the only correct answer.
    if (workerCount === 0) return { ok: false, reply: NO_BUDGET_REPLY };

    const children: { planId: Id<"plans">; route: string; question: string }[] = [];
    for (const item of assignments.slice(0, workerCount)) {
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
        subject: headingFor(item.route, item.question),
      });
      children.push({ planId: childId, route: item.route, question: item.question });
    }

    for (const child of children) {
      await ctx.scheduler.runAfter(0, internal.dispatchRun.startDispatchRun, {
        kind: kindForRoute(child.route),
        tenantId: a.tenantId,
        threadId: a.threadId,
        planId: child.planId,
        gapIndex: 0, // no gap on this path — the assignment's own question briefs the worker
        route: child.route,
        // ADR-040: the CHILD'S question, never the umbrella one. Briefing every worker with
        // the umbrella question is exactly the identical-paid-turn case the pair dedupe
        // exists to prevent, re-introduced one layer down where no dedupe can see it.
        question: child.question,
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
        ...(a.evalBudgetId === undefined ? {} : { evalBudgetId: a.evalBudgetId }),
        ...(a.researchControlId === undefined
          ? {}
          : {
              researchControlId: a.researchControlId,
              researchRequestId: a.researchRequestId,
            }),
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

    return { ok: true, workerCount, requested: a.assignments.length };
  },
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
// 43-04 — THE CONTENT BATCH: N VARIANTS OF ONE PIECE, ONE APPROVAL CARD
//
// A SIBLING of `startTeamRun`, not a parameter on it. `startTeamRun` drops any route
// `resolveSpecialist` rejects (`legalAssignments` above), so every content assignment would vanish
// and `NO_ROUTES_REPLY` would fire on a batch that had nothing wrong with it. The two share the
// root/child/envelope SHAPE and differ in what a child is: a fan-out child is a QUESTION for a
// specialist, a batch child is an ANGLE on one piece with no specialist at all.
// ══════════════════════════════════════════════════════════════════════════════════════════════

/** One variant: the angle the user asked for, the brief the worker is given, and the heading the
 *  assembled parent renders it under. */
export type Variant = { angle: string; brief: string; subject: string };

/**
 * THE PIECE IS WELDED ON IN CODE, which is the whole reason this returns a `brief` instead of
 * letting the caller pass the angle through. An angle alone — "lead with the numbers" — is a
 * fragment with no subject: fifteen workers briefed that way produce fifteen drafts about nothing,
 * and the variant count the tool reports is still correct, so it reads like a working feature.
 * `headingFor` above welds the same way and for the same reason.
 *
 * A BLANK ANGLE IS DROPPED, never defaulted to the piece. Defaulting would re-create the
 * identical-paid-turn case ADR-040's dedupe exists to prevent, one layer down where no dedupe can
 * see it. The `typeof` check is a trust boundary and not paranoia: `jsonSchema()` carries no
 * validator, so `variants: [null]` or `[{angle:"x"}]` really does arrive here.
 */
export const legalVariants = (piece: string, raw: readonly unknown[]): Variant[] => {
  const topic = piece.trim();
  if (topic.length === 0) return [];
  const seen = new Set<string>();
  const out: Variant[] = [];
  for (const item of raw ?? []) {
    const angle = (typeof item === "string" ? item : "").trim();
    if (angle.length === 0) continue;
    // `legalAssignments`' normaliser with the route half dropped — a batch has one piece, so the
    // angle alone is the identity. Deliberately NOT extracted into a shared helper: the shipped key
    // joins on a NUL separator for an anti-collision reason that does not apply to a single field,
    // and a knob for two callers that disagree is the abstraction §8 forbids.
    const key = angle.toLowerCase().replace(/\s+/g, " ");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      angle,
      brief: `${topic}\n\n${angle}`,
      subject: `${topic} \u2014 ${angle}`.slice(0, 120), // headingFor's cap, same reason
    });
  }
  return out;
};

/**
 * A PER-DRAFT COST ESTIMATE, AND IT IS A MONEY BOUND — stated out loud because getting it wrong
 * costs real money in the direction that cannot be undone.
 *
 * `guardrails.preCall` is `rateLimiter.check(..., { count: 1 })` — "is there ANY budget left", NOT
 * "can I afford this call" — and `recordModelSpend` consumes AFTER the fact. So fifteen CONCURRENT
 * drafts all see the same pre-spend rail and all pass. The per-draft gate 43-02 added bounds a
 * SEQUENCE (two tool calls in one turn), never a fan-out.
 *
 * `narrowFanOut`'s own cap does not save it either: it caps `workerCount` at `rootEnvelopeCents`,
 * i.e. ONE CENT per worker, which is exactly what makes `share >= 1` a theorem and nowhere near
 * what a document draft costs. Dividing the envelope by an estimate is what makes the COUNT a real
 * bound. It errs toward starting FEWER variants, which is the recoverable direction.
 *
 * ponytail: a constant, not a measurement. Upgrade path: read the `document_draft` rows out of the
 * spend ledger and replace the number — or serialize the batch so each draft's `preCall` sees what
 * the last one spent. Do not delete the divisor.
 */
export const EST_DRAFT_CENTS = 2;

/** Nothing to tell apart. Names what the user must supply and ENDS THE TURN — it must not imply a
 *  piece was written, because none was: `startContentBatch` returns before minting anything. */
const NO_VARIANTS_REPLY =
  "Those all read as the same version, so I haven't started anything. Ask the user what should" +
  " DIFFER between the versions before calling this again.";

/**
 * NOT `NO_BUDGET_REPLY`. That sentence ends "ask me one question at a time", which against an
 * exhausted rail is a live instruction to call `createDocument` N more times THIS turn — every one
 * of them refused by `draftDocument`'s own gate. That is the fixture-35 loop `DRAFT_BLOCKED_MESSAGE`
 * was written to close: a refusal has to sound final or it is not a refusal. One specialist retry
 * is cheap; fifteen document drafts are not.
 */
const BATCH_NO_BUDGET_REPLY =
  "The AI spending limit has been reached, so no version was drafted and nothing was charged." +
  " Tell the user their budget is used up and do NOT try again this turn.";

/**
 * MINT A CONTENT BATCH: one root, up to `MAX_FAN_OUT` variant children, one approval card.
 *
 * The root is staged by the CALLER (`plans.stageResearchPlan` with `channel: "vault"`), so the
 * `research_in_flight` / `draft_in_progress` interlocks are the same ones a fan-out gets. This
 * mutation owns only the children and the money.
 */
export const startContentBatch = internalMutation({
  args: {
    tenantId: v.string(),
    threadId: v.string(),
    planId: v.id("plans"),
    /** The piece every variant is a version OF. */
    piece: v.string(),
    /** `long` | `short` | `sheet` — chooses the drafter skill, mirroring `createDocument`. */
    form: v.string(),
    /** The angles, as the model wrote them. `v.any()` elements because the trust boundary is
     *  `legalVariants`, not this validator: the tool schema carries no validator either. */
    variants: v.array(v.any()),
    rootRequestId: v.string(),
    skillVersions: v.optional(v.record(v.string(), v.number())),
    tenantSkillIds: v.optional(v.record(v.string(), v.id("tenantSkills"))),
    evalBudgetId: v.optional(v.id("spendEvents")),
  },
  handler: async (ctx, a): Promise<TeamRunResult> => {
    const wanted = legalVariants(a.piece, a.variants);
    if (wanted.length === 0) return { ok: false, reply: NO_VARIANTS_REPLY };

    // The SAME derivation `governedDispatch` and `startTeamRun` use, from the SAME constant.
    const rootEnvelope = Math.floor(
      (await ctx.runQuery(internal.guardrails.remainingDailyCents, { tenantId: a.tenantId })) *
        ENVELOPE_FRACTION,
    );
    // `shareCents` is DISCARDED, and that is decided rather than overlooked: a variant worker does
    // NOT go through `governedDispatch`, so there is no envelope for a share to fill. See the
    // scheduling comment below for why.
    const { workerCount } = narrowFanOut(wanted.length, Math.floor(rootEnvelope / EST_DRAFT_CENTS));
    if (workerCount === 0) return { ok: false, reply: BATCH_NO_BUDGET_REPLY };

    const kids: { planId: Id<"plans">; brief: string }[] = [];
    for (const variant of wanted.slice(0, workerCount)) {
      const childId = await ctx.runMutation(internal.plans.insertPlan, {
        tenantId: a.tenantId,
        threadId: a.threadId,
        parentPlanId: a.planId,
        // All three load-bearing at BIRTH, exactly as in `startTeamRun`. `kind: "memo"` because
        // three fail-closed gates test it by equality; `subject` because the assembled parent has
        // no heading for this section without it; `channel` because ADR-042 D1 REQUIRES it on a row
        // a batch mints — absent would read as `"email"`, a terminal a memo row cannot reach.
        kind: "memo",
        subject: variant.subject,
        channel: "vault",
      });
      kids.push({ planId: childId, brief: variant.brief });
    }

    for (const kid of kids) {
      // NOT `startDispatchRun`. `DISPATCH_ARGS` makes `envelopeCents` REQUIRED, and
      // `governedDispatch` reads `envelopeCents > 0 ? it : derive` — so a child passing 0 would be
      // granted the FULL rail share, which is verbatim the defect ADR-038 was written to fix. A
      // variant is ONE `draftDocument` call: no tools, no recursion, nothing to govern.
      //
      // `planId` stays TOP-LEVEL so `reliabilitySweep`'s `dispatchLive` scan of
      // `_scheduled_functions` still matches this run and the watchdog can still see it.
      await ctx.scheduler.runAfter(0, internal.llm.runVariant, {
        tenantId: a.tenantId,
        threadId: a.threadId,
        planId: kid.planId,
        brief: kid.brief,
        form: a.form,
        rootRequestId: a.rootRequestId,
        ...(a.skillVersions === undefined ? {} : { skillVersions: a.skillVersions }),
        ...(a.tenantSkillIds === undefined ? {} : { tenantSkillIds: a.tenantSkillIds }),
        ...(a.evalBudgetId === undefined ? {} : { evalBudgetId: a.evalBudgetId }),
      });
    }

    // The SHIPPED `subagent.dispatched` payload shape, so no `auditProjection` allowlist edit is
    // needed. Refs and counts only (\u00a74) \u2014 no piece, no angle, no brief.
    await ctx.runMutation(internal.audit.log, {
      tenantId: a.tenantId,
      correlationId: a.rootRequestId,
      eventType: "subagent.dispatched",
      actor: "system",
      payload: {
        rootRequestId: a.rootRequestId,
        planId: String(a.planId),
        depth: 1,
        envelopeCents: rootEnvelope,
        spentCents: 0,
        workerCount,
      },
    });
    return { ok: true, workerCount, requested: a.variants.length };
  },
});
