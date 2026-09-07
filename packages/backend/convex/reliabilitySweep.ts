// 25.1-02 (D3 + D4) — THE STUCK-WORK WATCHDOG. The second silent-stall class, after 25.1-01's
// unhandled render terminals: a scheduler chain that was SEVERED. Nothing crashed, nothing was
// refused, nothing wrote a terminal — the next link simply never ran, and the row sits in a
// non-terminal state for ever while the canvas keeps promising a result.
//
// Four such states, all closed here:
//   1. `mediaJobs.status === "submitted"` whose provider poll chain died (the poll cap is
//      180 x 10s = 30 min, so anything past SUBMITTED_STALL_MS has no poller left alive).
//   2. `plans.renderStatus === "rendering"` whose render neither landed nor terminalized.
//   3. `plans.renderStatus === "pending"` that is ARMED (a batch exists) but whose render trigger
//      was never re-evaluated — the reel waits on a landing that already happened.
//   4. `plans.captionStatus === "transcribing"` stranded after the reel itself finished.
//   5. `plans.status === "collecting" && kind === "memo"` — a dispatch-owned row whose specialist
//      action died so hard that `dispatchAndLand`'s `finally` never ran. `PlanCard` renders only at
//      `proposed` (cards.tsx), so today that row is INVISIBLE FOR EVER: no card, no error, no way
//      back. That is D4.
//
// SHAPE: `vaultSweep.ts` verbatim — two @convex-dev/migrations migrations (OPSG-06: resumable +
// batched, never an ad-hoc backfill) driven by one cron entry point. Not a new sweep architecture.
//
// SELF-CONTAINED BY DESIGN: this module edits no other feature module. Where an honest terminal
// already exists it is CALLED rather than re-implemented — the job sweep routes through
// `mediaComplete.landResult`, which is the pinned single writer of a terminal `mediaJobs` status
// (llmRedaction.test.ts) and which cascades the render/caption triggers for free. A second terminal
// writer here would fork the money reconciliation and the audit line.
//
// §4: nothing this module writes carries user content. The reason codes are code-owned literals,
// the notification copy is a static label, and the collecting fallback body is a fixed sentence
// that claims NOTHING about what the specialist would have said.
import { hasAssetSource } from "@pikar/core/storyboard";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { internalMutation } from "./_generated/server";
import { dispatchWorkflowLive } from "./dispatchRun";
import { migrations } from "./migrations";

// ── Thresholds ────────────────────────────────────────────────────────────────
// Exported so the tests PIN them rather than describe them. Each one is a stated multiple of the
// mechanism it backstops, never a round number chosen for looking sensible:

/** The OpenAI/Wan poll chain caps at 180 attempts x 10s = 30 min. 45 leaves the last poll a wide
 *  margin, so a job this sweep fails is one whose poller is provably gone. */
export const SUBMITTED_STALL_MS = 45 * 60_000;
/** The render sandbox's own ceiling is RENDER_MAX_DURATION_S (minutes, not an hour). An hour of no
 *  activity means the run is not slow — it is gone. */
export const RENDER_STALL_MS = 60 * 60_000;
/** Whisper on a reel's worth of voice takes is seconds of work; 30 min is two orders out. */
export const CAPTION_STALL_MS = 30 * 60_000;
/** A specialist dispatch is bounded by its own step/cost/clock governors well inside 30 min. */
export const COLLECTING_STALL_MS = 30 * 60_000;

// ── Reason codes ──────────────────────────────────────────────────────────────
// ONE PER STATE CLASS, deliberately. A single shared "watchdog_timeout" would make the four
// terminals indistinguishable in the log plane and would make transposing two of them invisible —
// the phase-19.1 rule: a swap must redden a test.

/** Written onto the JOB (via `landResult`, so it reconciles + audits like any other landing). */
export const WATCHDOG_JOB_REASON = "watchdog_submit_timeout";
/** Written onto `plans.renderReason`. */
export const WATCHDOG_RENDER_REASON = "watchdog_render_timeout";
/** Written onto `plans.captionReason`. A failed burn leaves `renderStatus` standing (20-17). */
export const WATCHDOG_CAPTION_REASON = "watchdog_caption_timeout";

// ── The user-visible half ─────────────────────────────────────────────────────
/** DELIBERATELY NOT a member of `NOTIFICATION_KINDS` (@pikar/core). That list is what arms
 *  `notifyExternal.dispatch`, i.e. the MAILBOX; a stall notice is an in-app fact and does not need
 *  to reach for a Gmail token. Same reasoning the two review kinds and the reconnect kinds are kept
 *  out. `NotificationsBanner` renders any unknown kind as plain text, so nothing else is needed. */
export const WATCHDOG_NOTIFY_KIND = "watchdog.stalled";
/** Static label, refs-free (§4) — it names no plan, no thread and no content. */
export const WATCHDOG_NOTIFY_MESSAGE =
  "A background job stalled and was marked failed — open the workspace thread to retry.";

/**
 * What a swept `collecting` memo row says. It is a SYSTEM notice wearing no one else's voice: it
 * claims no findings, attributes nothing to the specialist, and tells the user the one true thing
 * (the run stopped, nothing was produced, ask again). The `LOST_CONTEXT_MEMO` precedent
 * (evaluations.ts) — an honest sentence beats a row that can never be seen.
 */
export const COLLECTING_FALLBACK_BODY =
  "# Next step\n\nI started working on this and the run stopped before it produced anything." +
  " Nothing was saved and nothing was sent. Ask me to run it again and I'll pick it up from there.";

/** `media.retryRender`'s audit event. A MANUAL retry stamps no field on the plan, so this row's
 *  `ts` is the only clock it leaves behind — see `lastRenderActivity`. */
const MANUAL_RETRY_EVENT = "media.render_retry_manual";

/** 100 small rows per batch. `mediaJobs` carries no text field (prompts are hashed), so the 16 MiB
 *  per-transaction read cap that forced `vaultSweep` down to 20 does not bite here. */
const JOB_BATCH = 100;
/** 50, because a `plans` row carries `body`, `shots` and `altShots` — kilobytes, not megabytes, but
 *  enough that the full component default is not worth the headroom. */
const PLAN_BATCH = 50;

/** The one notify site. In-app row only (see `WATCHDOG_NOTIFY_KIND`). */
const notifyStall = (ctx: MutationCtx, tenantId: string): Promise<null> =>
  ctx.runMutation(internal.notifications.notify, {
    tenantId,
    kind: WATCHDOG_NOTIFY_KIND,
    message: WATCHDOG_NOTIFY_MESSAGE,
  });

const jobsForPlan = (ctx: MutationCtx, plan: Doc<"plans">): Promise<Doc<"mediaJobs">[]> =>
  ctx.db
    .query("mediaJobs")
    .withIndex("by_plan", (q) => q.eq("tenantId", plan.tenantId).eq("planId", plan._id))
    .collect();

/** A line the provider may still call back about. Mirrors `mediaComplete.TERMINAL` from the other
 *  side — while one of these exists, a stalled PLAN is the job sweep's problem, not the plan
 *  sweep's, and terminalizing the plan here would race a landing that is still coming. */
const inFlight = (rows: readonly Doc<"mediaJobs">[]): boolean =>
  rows.some((r) => r.status === "queued" || r.status === "submitted");

/**
 * SWEEP 1 (D3) — a `submitted` job whose poll chain was severed.
 *
 * It does NOT write the terminal itself: `landResult` is the pinned single writer, and routing
 * through it is what makes a swept line reconcile its spend, emit its one `media.landed` audit row,
 * and re-fire the render + caption triggers. The plan therefore terminalizes as `incomplete_batch`
 * through the ordinary path — the canvas can say that in words — rather than through a second,
 * watchdog-shaped terminal that no downstream reader knows about.
 */
export const sweepStuckMediaJobs = migrations.define({
  table: "mediaJobs",
  batchSize: JOB_BATCH,
  migrateOne: async (ctx, row): Promise<void> => {
    if (row.status !== "submitted") return;
    // STRICTLY past the threshold. A row exactly AT it is not yet stale — the boundary belongs to
    // the mechanism being backstopped, not to the backstop.
    if (Date.now() - row.updatedAt <= SUBMITTED_STALL_MS) return;

    // ONE notification per BATCH, not per row: a thirteen-block reel whose provider went dark
    // stalls thirteen lines, and thirteen identical banners is noise the user learns to dismiss.
    // The batch is the unit because it is the unit the user approved. Read BEFORE the terminal
    // below so the row being swept cannot count as its own precedent; a later row in the same pass
    // sees this one's reason and stays quiet.
    const alreadyRaised = (
      await ctx.db
        .query("mediaJobs")
        .withIndex("by_batch", (q) => q.eq("tenantId", row.tenantId).eq("batchId", row.batchId))
        .collect()
    ).some((s) => s.failureReason === WATCHDOG_JOB_REASON);

    await ctx.runMutation(internal.mediaComplete.landResult, {
      jobId: row._id,
      outcome: { ok: false, code: WATCHDOG_JOB_REASON },
    });
    if (!alreadyRaised) await notifyStall(ctx, row.tenantId);
  },
});

/**
 * When the render plane last showed a sign of life. THREE clocks, because three different things
 * can legitimately keep a `rendering` plan alive past its last landing:
 *   - the landings themselves (`updatedAt`),
 *   - `renderRetriedAt`, stamped by 33-02's automatic retry,
 *   - and a MANUAL retry, which stamps NOTHING on the plan — `media.retryRender` patches status,
 *     reason and run id only, so its `media.render_retry_manual` audit row (correlationId = the
 *     batch id) is the sole record that a human just re-armed this reel. Missing it would kill a
 *     retry a user started 30 seconds ago.
 *
 * ponytail: an O(batches x audit rows per batch) read, run ONLY for a plan already sitting in a
 * non-terminal render state — a handful of rows, bounded by D10's job cap. Upgrade path if a
 * manual retry ever needs to be cheap to date: stamp `renderRetriedAt` in `retryRender` too, and
 * this whole audit read collapses to one field.
 */
async function lastRenderActivity(
  ctx: MutationCtx,
  plan: Doc<"plans">,
  jobs: readonly Doc<"mediaJobs">[],
): Promise<number> {
  let last = plan.renderRetriedAt ?? 0;
  const batches = new Set<string>();
  for (const j of jobs) {
    last = Math.max(last, j.updatedAt);
    batches.add(j.batchId);
  }
  for (const batchId of batches) {
    const rows = await ctx.db
      .query("audit")
      .withIndex("by_correlation", (q) => q.eq("correlationId", batchId))
      .collect();
    for (const r of rows) if (r.eventType === MANUAL_RETRY_EVENT) last = Math.max(last, r.ts);
  }
  return last;
}

/** Is this plan's render plane genuinely stalled, or merely waiting for something legitimate? */
async function renderStalled(
  ctx: MutationCtx,
  plan: Doc<"plans">,
  jobs: readonly Doc<"mediaJobs">[],
  now: number,
): Promise<boolean> {
  // NOT ARMED. A `pending` plan with no batch has not been approved for a render at all — nothing
  // was ever going to happen, so nothing is stuck. This is what keeps a staged, un-approved deck
  // out of the sweep however old it gets.
  if (jobs.length === 0) return false;
  // A line the provider may still answer. Sweep 1 owns that row; its landing re-fires the trigger.
  if (inFlight(jobs)) return false;
  // THE FIX-MENU HOLD IS NOT A STALL. A `pending` deck with a scene that names no asset source is
  // exactly what `evaluateRenderTrigger` deliberately refuses to schedule (33-04) — it is waiting
  // on the USER, and the fix-menu mutations re-arm it. Failing it here would delete an interactive
  // state and call it a timeout.
  if (plan.renderStatus === "pending" && !(plan.shots ?? []).every((s) => hasAssetSource(s))) {
    return false;
  }
  return now - (await lastRenderActivity(ctx, plan, jobs)) > RENDER_STALL_MS;
}

/** Is a `transcribing` plan stranded, or still waiting on work that is genuinely running? */
function captionStalled(
  plan: Doc<"plans">,
  jobs: readonly Doc<"mediaJobs">[],
  now: number,
): boolean {
  const stt = jobs.filter((j) => j.kind === "stt");
  // The transcript job is still out. Its landing fails the caption plane honestly
  // (`afterCaptionLanding`), and if it never lands, sweep 1 makes it land.
  if (inFlight(stt)) return false;
  const last = Math.max(
    plan.createdAt,
    plan.renderedAt ?? 0,
    ...stt.map((j) => j.updatedAt),
    // Spread of a possibly-empty array needs a floor, and 0 is it — `plan.createdAt` above always
    // dominates, so this can never invent freshness.
    0,
  );
  return now - last > CAPTION_STALL_MS;
}

/**
 * Is a dispatch still alive for this plan?
 *
 * The `collecting` row's owner is a SCHEDULED FUNCTION (`dispatch.runSpecialist` /
 * `runResearchSpecialist` / `runMedia`, all staged the same way), and the scheduler's own system
 * table is the only honest liveness signal — a run that is `pending` or `inProgress` is going to
 * land through `dispatchAndLand`'s `finally`, and sweeping it would clobber a live turn. `success`,
 * `failed` and `canceled` rows are deliberately NOT liveness: a completed run that left the plan at
 * `collecting` is precisely the defect being swept.
 *
 * Matched by `args.planId` rather than by function NAME, so a fourth dispatch entry point is
 * covered the day it is written instead of the day someone remembers this list.
 *
 * ponytail: a scan of `_scheduled_functions`, run ONLY for a collecting row already past
 * COLLECTING_STALL_MS — i.e. approximately never. Upgrade path if it ever runs hot: store the
 * scheduled id on the plan row at stage time (the `plans.scheduledFunctionId` precedent) and this
 * becomes a single `ctx.db.system.get`.
 */
async function dispatchLive(ctx: MutationCtx, plan: Doc<"plans">): Promise<boolean> {
  // 42-02 — ASK THE COMPONENT FIRST, AND THIS IS NOT AN OPTIMISATION. A durable dispatch is
  // enqueued by the workflow COMPONENT into the component's own tables; the app-side
  // `_scheduled_functions` scan below sees the starter mutation, not the run, so on its own it
  // returns FALSE for a genuinely running specialist. Armed, that is a data-loss path: the sweep
  // would patch a live run's plan to `{ status: "proposed", body: COLLECTING_FALLBACK_BODY }`, and
  // when the real turn lands, `landSpecialistResult`'s CAS discards the memo the tenant PAID FOR.
  //
  // This is also the upgrade path the ponytail comment above names — "store the scheduled id on the
  // plan row at stage time" — taken with a column that already exists rather than a new one:
  // `startDispatchRun` writes `plans.workflowId`, and `workflow.status` answers from it directly.
  // `null` means the component could not resolve the id at all, which is not evidence of liveness,
  // so it falls through rather than being read as `false`.
  if (plan.workflowId !== undefined) {
    const live = await dispatchWorkflowLive(ctx, plan.workflowId);
    if (live !== null) return live;
  }
  // The legacy arm, for rows staged before 42-02 and for any future entry point that has not moved
  // to a workflow. Matched by `args.planId` rather than by function NAME, so a fourth dispatch
  // entry point is covered the day it is written instead of the day someone remembers this list.
  const scheduled = await ctx.db.system.query("_scheduled_functions").collect();
  return scheduled.some(
    (s) =>
      (s.state.kind === "pending" || s.state.kind === "inProgress") &&
      (s.args[0] as { planId?: unknown } | undefined)?.planId === plan._id,
  );
}

/**
 * SWEEP 2 (D3 + D4) — the three stuck states that live on the plan row.
 *
 * The three planes are evaluated INDEPENDENTLY off the row as it was read, never chained: a render
 * this pass just failed must not make a legitimately-waiting caption look stranded in the same
 * pass. The next pass will see the new state and decide again.
 */
export const sweepStuckPlans = migrations.define({
  table: "plans",
  batchSize: PLAN_BATCH,
  migrateOne: async (ctx, plan): Promise<void> => {
    const now = Date.now();
    const renderPlane = plan.renderStatus === "rendering" || plan.renderStatus === "pending";
    // A caption legitimately WAITS for the render terminal (`maybeBurnCaptions` needs
    // `renderStatus === "rendered"`), so a reel still in or before the sandbox is not a caption
    // stall — whatever happens to the render plane will call the caption plane back in.
    const captionPlane = plan.captionStatus === "transcribing" && !renderPlane;
    const collectingPlane =
      // `collecting` + `kind: "memo"` is the DISPATCH-OWNED discriminator, not an invention here:
      // it is the same pair `plans.stageResearchPlan` already uses to refuse `research_in_flight`.
      // An ordinary conversation's `collecting` row carries no kind and is never touched — it is a
      // live chat, and a week-old live chat is still a live chat.
      plan.status === "collecting" &&
      plan.kind === "memo" &&
      now - plan.createdAt > COLLECTING_STALL_MS;

    if (!renderPlane && !captionPlane && !collectingPlane) return;

    // ONE read of the batch for both media planes.
    const jobs = renderPlane || captionPlane ? await jobsForPlan(ctx, plan) : [];
    let stalled = false;

    if (renderPlane && (await renderStalled(ctx, plan, jobs, now))) {
      await ctx.db.patch(plan._id, {
        renderStatus: "failed",
        renderReason: WATCHDOG_RENDER_REASON,
        renderedAt: now,
      });
      stalled = true;
    }

    if (captionPlane && captionStalled(plan, jobs, now)) {
      // `renderStatus` is NOT touched here or anywhere in this file's caption path (20-17): a
      // failed burn must leave a rendered reel standing, because a reel without captions is a
      // degraded deliverable and an unpublished reel is none.
      await ctx.db.patch(plan._id, {
        captionStatus: "failed",
        captionReason: WATCHDOG_CAPTION_REASON,
      });
      stalled = true;
    }

    if (collectingPlane && !(await dispatchLive(ctx, plan))) {
      // `proposed` is the honest terminal, and it is an EXISTING one: it is where every other
      // dispatch outcome lands (`landSpecialistResult`), and it is the only status `PlanCard`
      // renders. The row stops being invisible and the user can read what happened and re-ask.
      // No new status member was needed, so none was added.
      await ctx.db.patch(plan._id, { status: "proposed", body: COLLECTING_FALLBACK_BODY });
      stalled = true;
    }

    // One notification per plan per pass, however many of its planes were swept — the user has one
    // stalled thing to go and look at, not three.
    if (stalled) await notifyStall(ctx, plan.tenantId);
  },
});

/**
 * The cron entry point (crons.ts, every 30 min).
 *
 * `{ reset: true }` on BOTH, and it is required rather than decorative: a @convex-dev/migrations
 * migration that has COMPLETED no-ops on a bare invocation, so a repeating watchdog that did not
 * reset would run exactly once in the deployment's lifetime. That is the 2026-07-18 stranded-.xlsm
 * lesson, recorded in `docs/playbooks/vault.md` and paid for once already.
 *
 * `runOne` twice rather than `runSerially`: a series SKIPS a migration that already completed,
 * which is the same trap with an extra step.
 */
export const runSweep = internalMutation({
  args: {},
  handler: async (ctx): Promise<null> => {
    // ARMING GATE — owner decision, 2026-08-21, first production promotion of this watchdog.
    //
    // This sweep WRITES FAILURE TERMINALS to live rows, and it has never run against a real
    // deployment: every threshold in this file was calibrated against fixtures. A false positive
    // here does not fail safe — it marks a healthy, slow-but-progressing video render as failed,
    // which manufactures exactly the silent-inconsistency this phase existed to remove.
    //
    // So it ships dormant and is armed deliberately, after a real render has been watched end to
    // end in production:
    //     cd packages/backend && npx convex env set --prod RELIABILITY_SWEEP_ARMED 1
    // Unset (or any other value) = the cron still fires on its 30-minute interval, walks in here,
    // and does nothing. Remove this gate once the first armed passes are observed to be clean.
    if (process.env.RELIABILITY_SWEEP_ARMED !== "1") return null;

    await migrations.runOne(ctx, internal.reliabilitySweep.sweepStuckMediaJobs, { reset: true });
    await migrations.runOne(ctx, internal.reliabilitySweep.sweepStuckPlans, { reset: true });
    return null;
  },
});
