// Cockpit plan/draft content-plane adapter (CLAUDE.md §1: thin adapter; §4: raw
// content — recipients/subject/body — lives HERE, never in an audit/DLQ payload).
//
// DECISION #1: the `plans` table is the plan/draft content plane; the REPORT is a
// LIVE PROJECTION over the fan-out `requests` rows (by_plan), NOT a patched report[]
// array and NOT a writer. Reactivity of requests.status + the gmail.sent audit insert
// makes the report fill live per recipient — this module writes no report field.
//
// Writers are internal (called by the agent action / executePlan / the fan-out
// workflow). Readers are tenantQuery so the browser subscribes and the PLAN/DRAFT/
// REPORT cards update live; every reader is guarded on ctx.tenantId (no cross-tenant leak).
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { internalMutation, internalQuery } from "./_generated/server";
import { tenantMutation, tenantQuery } from "./lib/functions";

// PINNED plan lifecycle (schema.ts): collecting → proposed → approved → (scheduled|delivering) → done,
// plus the 03.5 deferred-send states scheduled (armed, pre-fire) and canceled (terminal, halted).
// HAND-MAINTAINED mirror of the schema status union — it MUST carry the same literals in the same
// order or setPlanStatus/patchPlan reject the new states at runtime (RESEARCH Pitfall 5).
const PLAN_STATUS = v.union(
  v.literal("collecting"),
  v.literal("proposed"),
  v.literal("approved"),
  v.literal("scheduled"),
  v.literal("delivering"),
  v.literal("done"),
  v.literal("canceled"),
);

// Mirrors plans.candidates in schema.ts (mirrors @pikar/core ContactMatch/NameCandidates, Plan 01).
const CANDIDATES = v.array(
  v.object({
    name: v.string(),
    matches: v.array(
      v.object({
        address: v.string(),
        displayName: v.optional(v.string()),
        lastSubject: v.optional(v.string()),
        lastDateMs: v.optional(v.number()),
        count: v.number(),
      }),
    ),
  }),
);

// Mirrors plans.attachments in schema.ts — generated outbound attachment refs (CKPT-02).
const ATTACHMENTS = v.array(
  v.object({
    storageId: v.id("_storage"),
    filename: v.string(),
    mimeType: v.string(),
    size: v.number(),
  }),
);

/**
 * Create the single `plans` row for a thread (the agent creates it on first turn).
 * Starts at "collecting" with empty recipients; returns planId for the conversation to patch.
 */
export const insertPlan = internalMutation({
  args: { tenantId: v.string(), threadId: v.string() },
  handler: async (ctx, { tenantId, threadId }) =>
    await ctx.db.insert("plans", {
      tenantId,
      threadId,
      status: "collecting",
      recipients: [],
      createdAt: Date.now(),
    }),
});

/** Statuses a research stage may recycle from. Same three literals as `ACTABLE_PLAN_STATUS`
 *  (evaluations.ts) — anything past `proposed` is mid-flight or delivered. */
const RECYCLABLE_STATUS: ReadonlySet<Doc<"plans">["status"]> = new Set([
  "collecting",
  "proposed",
  "canceled",
] as const);

/** Does this row hold composition work the USER would lose to a reset? The five slots a person
 *  actually fills; `candidates`/`pendingValid` are transient lookup state, not authored content. */
const hasDraftContent = (p: Doc<"plans">): boolean =>
  (p.recipients?.length ?? 0) > 0 ||
  Boolean(p.subject) ||
  Boolean(p.body) ||
  Boolean(p.bodyIntent) ||
  (p.attachments?.length ?? 0) > 0;

/**
 * Stage the `collecting` memo row a scheduled research run will land on (16-06 / DISP-02).
 *
 * Mirrors `evaluations.ts` `applyActOnGap`'s staging block — same insertPlan/resetPlan/patchPlan
 * spine, same `collecting` handoff — with a NARROWER recycle rule, and the narrowing IS the point:
 *
 *  - a `collecting` MEMO row is REFUSED as `research_in_flight` (actOnGap recycles it). That row is
 *    one a DISPATCH staged and still owns; recycling it would race two runs onto one row and the
 *    loser's findings — already paid for — would be silently discarded. This persisted interlock is
 *    ALSO what makes a per-turn envelope closure unnecessary: one run per thread, one freshly
 *    derived root envelope. It is strictly stronger than an in-memory closure — it holds across
 *    turns, across requests, and across a fallback retry that rebuilds the tool record.
 *    **`kind === "memo"` is load-bearing, not decoration.** `cockpit.ts` inserts EVERY thread's plan
 *    row at `collecting` on the first turn and it stays there for the whole composition, so a bare
 *    `status === "collecting"` refusal would refuse research on essentially every live conversation
 *    — the primary use case. A collecting row is only "owned by a dispatch" when a dispatch staged
 *    it, and `kind: "memo"` is what records that.
 *  - a plan carrying the USER'S OWN draft content is REFUSED as `draft_in_progress`. `actOnGap` may
 *    reset one because the USER tapped a control; here the MODEL decides, and destroying a
 *    half-composed email because someone asked a research question is not a trade the user agreed
 *    to. An EMPTY composing row (the fresh-thread case) carries nothing to protect and recycles.
 *  - anything past `proposed` (approved → done) is mid-flight or delivered and never recycles.
 *
 * Deliberately NOT refactored into a shared helper with `applyActOnGap`: the rules disagree, so
 * sharing would need the rule as a parameter — a knob for two callers that disagree is the
 * abstraction §8 forbids. Cross-referenced in both directions instead, so the divergence reads as
 * chosen rather than accidental.
 *
 * ponytail: REFUSING rather than staging a second row. The real fix is more than one plan row per
 * thread, and `plans.by_thread` is `.unique()` with `schema.ts` frozen after 16-01 — upgrade path,
 * not this phase.
 *
 * 20-08 added `stageMediaPlan` below as a SECOND copy of this shape rather than a shared helper,
 * for the reason this comment already gives: it protects an in-flight REEL (paid-for `mediaJobs`
 * rows, a running sandbox) rather than a `collecting` memo row, and reel liveness is not readable
 * from `plan.status` at all. Read them together before changing either.
 */
export const stageResearchPlan = internalMutation({
  args: { tenantId: v.string(), threadId: v.string(), subject: v.string() },
  handler: async (
    ctx,
    { tenantId, threadId, subject },
  ): Promise<
    | { ok: true; planId: Id<"plans"> }
    | { ok: false; reason: "research_in_flight" | "draft_in_progress" }
  > => {
    const plan = await ctx.db
      .query("plans")
      .withIndex("by_thread", (q) => q.eq("tenantId", tenantId).eq("threadId", threadId))
      .unique();

    let planId: Id<"plans">;
    if (plan) {
      if (plan.status === "collecting" && plan.kind === "memo") {
        return { ok: false, reason: "research_in_flight" };
      }
      if (!RECYCLABLE_STATUS.has(plan.status)) return { ok: false, reason: "draft_in_progress" };
      // A memo row holds a PREVIOUS run's findings (already landed and readable), and a canceled row
      // is one the user halted — neither is work in progress. Anything else with content in it is.
      const userWork = plan.kind !== "memo" && plan.status !== "canceled" && hasDraftContent(plan);
      if (userWork) return { ok: false, reason: "draft_in_progress" };
      planId = plan._id;
      // resetPlan, NOT patchPlan: patchPlan drops `undefined` and so can never clear a filled slot,
      // which would carry a previous memo's subject/attachments onto this one.
      await ctx.runMutation(internal.plans.resetPlan, { planId });
    } else {
      planId = await ctx.runMutation(internal.plans.insertPlan, { tenantId, threadId });
    }
    await ctx.runMutation(internal.plans.patchPlan, {
      planId,
      kind: "memo",
      recipients: [], // a memo has no recipients — it is not an email
      subject,
      // NO template body: the specialist's output is the only body this plan will ever carry, and a
      // staged template is exactly what must not become approvable under an attribution header.
      body: "",
      status: "collecting", // ← not approvable until landSpecialistResult flips it
    });
    return { ok: true, planId };
  },
});

/** A media job row that is still in flight. Mirrors `mediaComplete.TERMINAL` from the other side:
 *  a line that has not reached one of those four states is one the provider may still call back
 *  about, and the reservation for it has already been consumed. */
const LIVE_JOB_STATUS: ReadonlySet<Doc<"mediaJobs">["status"]> = new Set([
  "queued",
  "submitted",
] as const);

/** A render that has been started and not finished. `rendered`/`failed` are both finished. */
const LIVE_RENDER_STATUS: ReadonlySet<string> = new Set(["pending", "rendering"] as const);

/**
 * Stage the `collecting` row a scheduled media run will land on (20-08 / MEDIA-01).
 *
 * `stageResearchPlan`'s shape, COPIED rather than shared. That function's own `ponytail:` forbids
 * the extraction in as many words — *"a knob for two callers that disagree is the abstraction §8
 * forbids"* — and these two callers genuinely disagree: research protects a `collecting` MEMO row,
 * media protects an IN-FLIGHT REEL, and the reel's liveness is not readable from the plan row's
 * status at all. Cross-referenced in both directions so the divergence reads as chosen.
 *
 * The media-specific rule, and why it is not just "is the status collecting":
 *
 *  - a plan with **non-terminal `mediaJobs` rows** is refused as `reel_in_flight`. Those lines are
 *    already PAID FOR: the whole job was reserved in one transaction before a single request
 *    existed (20-04), and fal will call back to `/fal/callback/*` whichever plan row the thread
 *    happens to point at afterwards. Recycling the row would strand a landing on a plan that has
 *    since become something else, and the money is gone either way.
 *  - a plan with a **live `renderStatus`** is refused for the same reason one step later: a sandbox
 *    is running, and its terminal will write `renderStorageId` onto whatever this row has become.
 *  - the two are checked SEPARATELY because they fail at different times — every job can be
 *    terminal while the render is still going (that is precisely when the render starts).
 *  - `hasDraftContent` still applies: the MODEL is deciding here, and destroying a half-composed
 *    email because someone asked for a reel is not a trade the user agreed to.
 *
 * ponytail: REFUSING rather than staging a second row — `plans.by_thread` is `.unique()`, so a
 * thread has exactly one plan. The real fix is more than one plan row per thread, and it is the
 * same upgrade path `stageResearchPlan` names. A user who wants a second reel starts a new chat.
 */
export const stageMediaPlan = internalMutation({
  args: { tenantId: v.string(), threadId: v.string(), subject: v.string() },
  handler: async (
    ctx,
    { tenantId, threadId, subject },
  ): Promise<
    | { ok: true; planId: Id<"plans"> }
    | {
        ok: false;
        reason:
          | "reel_in_flight"
          | "render_in_flight"
          | "draft_in_progress"
          | "dispatch_in_flight"
          | "image_proposal_pending";
      }
  > => {
    const plan = await ctx.db
      .query("plans")
      .withIndex("by_thread", (q) => q.eq("tenantId", tenantId).eq("threadId", threadId))
      .unique();

    let planId: Id<"plans">;
    if (plan) {
      // A completed memo is terminal, not a draft. This includes a prior media-director refusal:
      // the user may ask for the reel again in the SAME chat after correcting the brief or after
      // we improve the specialist. Treating `done` as universally non-recyclable trapped that
      // thread forever behind `draft_in_progress`, even though no provider job or render existed.
      // The memo remains in chat/vault history; only the live canvas slot is reused.
      const completedMemo = plan.kind === "memo" && plan.status === "done";
      // ── THE MISSING INTERLOCK (2026-08-14) ──────────────────────────────────────────────────
      // A `collecting` MEMO row is one a DISPATCH staged and still owns. `stageResearchPlan`
      // refuses exactly this shape as `research_in_flight`, and the header above says this
      // function is "a SECOND copy of that shape" — but the copy DROPPED this check, which is the
      // one that makes "one run per thread" true.
      //
      // It was reachable, not theoretical: a second `dispatchMedia` while the media director was
      // still writing did refuse — but as `draft_in_progress`, whose reply talks about an EMAIL
      // draft the user does not have. So the agent relayed a sentence about a draft that did not
      // exist, and the user could not act on it. Refusing here, first, gives the honest reason.
      //
      // `done` still recycles (see `completedMemo` below) — a landed run is not in flight, and
      // trapping a thread behind a finished one is the bug that comment was written for.
      if (plan.status === "collecting" && plan.kind === "memo") {
        return { ok: false, reason: "dispatch_in_flight" };
      }
      if (plan.kind === "media") {
        // The index PREFIX is the tenant boundary, so these are this tenant's rows by construction.
        const jobs = await ctx.db
          .query("mediaJobs")
          .withIndex("by_plan", (q) => q.eq("tenantId", tenantId).eq("planId", plan._id))
          .collect();
        if (jobs.some((j) => LIVE_JOB_STATUS.has(j.status))) {
          return { ok: false, reason: "reel_in_flight" };
        }
        if (plan.renderStatus !== undefined && LIVE_RENDER_STATUS.has(plan.renderStatus)) {
          return { ok: false, reason: "render_in_flight" };
        }
        // ── A STAGED IMAGE PROPOSAL IS NOT A SPENT REEL DECK ──────────────────────────────────
        // `userWork` below excludes `kind: "media"` on the reasoning that "a media row holds a
        // PREVIOUS reel's deck ... not work in progress". That is true of a deck the user already
        // generated or walked away from, and FALSE of a proposal staged moments earlier — and
        // `mediaMode: "image"` rows are `kind: "media"` too.
        //
        // Observed live, in a conversation about a SLIDE DECK: `proposeImage` staged an image
        // proposal, and the next turn's `dispatchMedia` recycled the row out from under it. The
        // user never saw the image they were told to review, the following `proposeImage` then
        // refused with `draft_in_progress` against the memo this function had just written, and
        // the turn deadlocked. Silently destroying an un-acted-on proposal is the defect; a reel
        // replacing a reel is the INTENDED flow and is deliberately still allowed.
        //
        // `jobs.length === 0` is what makes "un-acted-on" precise rather than a guess: the moment
        // the user clicks Generate a row exists, and a spent proposal may be recycled.
        if (plan.mediaMode === "image" && plan.imagePrompt && jobs.length === 0) {
          return { ok: false, reason: "image_proposal_pending" };
        }
      }
      if (!completedMemo && !RECYCLABLE_STATUS.has(plan.status))
        return { ok: false, reason: "draft_in_progress" };
      // A media row holds a PREVIOUS reel's deck, and a canceled row is one the user halted —
      // neither is work in progress. Anything else with content in it is.
      const userWork =
        !completedMemo &&
        plan.kind !== "media" &&
        plan.status !== "canceled" &&
        hasDraftContent(plan);
      if (userWork) return { ok: false, reason: "draft_in_progress" };
      planId = plan._id;
      // resetPlan, NOT patchPlan: patchPlan drops `undefined` and so can never clear a filled slot.
      // For media that is load-bearing twice over — resetPlan is what wipes the previous deck AND
      // the previous render plane, either of which surviving would show under a brand-new proposal.
      await ctx.runMutation(internal.plans.resetPlan, { planId });
    } else {
      planId = await ctx.runMutation(internal.plans.insertPlan, { tenantId, threadId });
    }
    await ctx.runMutation(internal.plans.patchPlan, {
      planId,
      // NOT `kind: "media"` yet — `persistStoryboard` sets that when a deck actually parses. A row
      // that says `media` with no `shots` is an empty canvas wearing a successful proposal's
      // clothes, which is the exact failure `dispatch.ts` refuses to write.
      kind: "memo",
      recipients: [], // a reel has no recipients — it is not an email
      subject,
      body: "",
      status: "collecting", // ← not approvable until the dispatch lands
    });
    return { ok: true, planId };
  },
});

/**
 * The deck onto the plan row (20-08). **Deliberately NOT `patchPlan` args** — `patchPlan` has no
 * deck args and no render args, and that absence IS the guarantee (20-02): nothing reachable from
 * the MODEL may write a block prompt or a narration line that later becomes a paid generation. This
 * mutation is called only by `dispatch.persistStoryboard`, which is reached only from the scheduled
 * `runMedia` action.
 *
 * `shots` is written as ONE array patch, which is the whole reason the deck is inline on the plan
 * row rather than in a `mediaShots` table (schema.ts).
 *
 * `status: "proposed"` is set HERE and only here on this path — the row is not approvable until a
 * deck actually parsed. `kind: "media"` moves at the same instant, so a `media` row without `shots`
 * is not a state this function can produce.
 */
/** ONE parsed deck element (33-03) — shared by `shots` and `altShots` so the two arrays cannot
 *  drift. **Deliberately NO `confirmedAt` member**: this validator is the second door after the
 *  parser type — parsed MODEL content structurally cannot carry a confirmation, which is written
 *  only by the authenticated `media.confirmClaim`. Do not add it here. */
const parsedShot = v.object({
  index: v.number(),
  // `type` on a block row, `visual` on a scene row — exactly one of the two, never both.
  type: v.optional(v.string()),
  visual: v.optional(v.string()),
  seconds: v.number(),
  windowStartMs: v.number(),
  description: v.string(),
  overlay: v.optional(v.string()),
  prompt: v.string(),
  narration: v.string(),
  asset: v.optional(v.object({ source: v.literal("vault"), docId: v.string() })),
  // 33-03 citation plane, straight off the parser: the specialist's `Source:` line, verbatim.
  source: v.optional(v.object({ docId: v.string(), title: v.string() })),
  needsConfirmation: v.optional(v.boolean()),
});

export const persistDeck = internalMutation({
  args: {
    tenantId: v.string(),
    planId: v.id("plans"),
    script: v.string(),
    artDirection: v.union(
      v.null(),
      v.object({
        palette: v.array(v.string()),
        mood: v.string(),
        lighting: v.string(),
        composition: v.string(),
        environment: v.string(),
        texture: v.string(),
        typography: v.optional(v.string()),
        references: v.array(v.string()),
        avoid: v.string(),
      }),
    ),
    clipSeconds: v.number(),
    /** 20.2: present for a SCENE deck, absent for a BLOCK deck. Its presence on the plan row is
     *  the discriminator downstream — see the schema comment. */
    targetDurationSeconds: v.optional(v.number()),
    shots: v.array(parsedShot),
    // ── 33-03 variation plane: deck B parked beside the picked deck A, or ABSENT — and absence
    // CLEARS (whole-deck-write semantics below): a single-deck revision discards the alternate.
    altShots: v.optional(v.array(parsedShot)),
    altTargetDurationSeconds: v.optional(v.number()),
    /** 33-11: which sibling variation was lost, and why — whole-deck-write semantics like the
     *  rest of the deck plane, so a later single-deck revision CLEARS a stale salvage note. */
    lostVariation: v.optional(v.object({ variation: v.string(), reason: v.string() })),
    /** The guided-intake brief, when the body carried one. Drop-undefined (unlike the deck
     *  fields): a chat revision that does not restate the BRIEF keeps the one on the row. */
    brief: v.optional(
      v.object({
        topic: v.string(),
        durationSeconds: v.number(),
        audience: v.optional(v.string()),
        tone: v.optional(v.string()),
        brandVoice: v.optional(v.string()),
        defaulted: v.array(v.string()),
      }),
    ),
  },
  handler: async (ctx, a): Promise<null> => {
    const plan = await ctx.db.get(a.planId);
    if (!plan || plan.tenantId !== a.tenantId) return null; // no cross-tenant write, ever
    // Refusing an empty deck HERE as well as at the caller. `dispatch.ts` already never calls with
    // one, and this is the second lock on the same door: an empty canvas that says `kind: "media"`
    // is the one shape that looks like a successful proposal and is not.
    if (a.shots.length === 0) return null;
    await ctx.db.patch(a.planId, {
      kind: "media",
      script: a.script,
      ...(a.artDirection === null ? {} : { artDirection: a.artDirection }),
      clipSeconds: a.clipSeconds,
      // Passed through UNCONDITIONALLY, undefined included. This is a direct `db.patch`, not
      // `patchPlan`, so undefined CLEARS — and clearing is what a block deck must do here. This
      // function writes a WHOLE deck; leaving a previous scene deck's target behind would leave
      // the plan claiming a declared length that none of its shots was written against.
      targetDurationSeconds: a.targetDurationSeconds,
      shots: a.shots,
      // 33-03: same whole-deck-write rule for the variation plane. A two-deck proposal writes
      // both; a single-deck REVISION clears the parked alternate — a post-pick chat revision
      // replaces the picked deck, so the alternate is stale by definition.
      altShots: a.altShots,
      altTargetDurationSeconds: a.altTargetDurationSeconds,
      // Same whole-deck-write rule (33-11): undefined CLEARS, so a later clean proposal drops a
      // previous salvage note rather than leaving the canvas apologising for a deck it replaced.
      lostVariation: a.lostVariation,
      ...(a.brief === undefined ? {} : { brief: a.brief }),
      /** When the deck(s) on this row were proposed — `briefChangedAt > deckProposedAt` is the
       *  stale badge. */
      deckProposedAt: Date.now(),
      // A NEW proposal is a new choice: the lock a previous Generate stamped belonged to the deck
      // this write replaces. `undefined` clears on a direct patch.
      deckLockedAt: undefined,
      // A WHOLE new deck is the largest change there is, so it dates itself for the same reason
      // the editor's own writes do (`media.patchShots`): assets bought against the deck this one
      // replaces must not be reused under scenes that are no longer theirs.
      shotsChangedAt: Date.now(),
      status: "proposed",
    });
    return null;
  },
});

/** Stage a standalone image proposal without spending. Unlike a reel, there is no specialist run:
 * the reviewed prompt is the complete creative input. The live-job checks are the same protection
 * as `stageMediaPlan` — recycling this unique thread row while a paid callback can still land would
 * attach the asset to a different proposal. */
export const stageImagePlan = internalMutation({
  args: { tenantId: v.string(), threadId: v.string(), prompt: v.string() },
  handler: async (
    ctx,
    { tenantId, threadId, prompt },
  ): Promise<
    | { ok: true; planId: Id<"plans"> }
    | {
        ok: false;
        reason:
          | "image_in_flight"
          | "image_already_started"
          | "draft_in_progress"
          | "invalid_prompt";
      }
  > => {
    const clean = prompt.trim();
    if (clean.length === 0 || clean.length > 4_000) return { ok: false, reason: "invalid_prompt" };
    const plan = await ctx.db
      .query("plans")
      .withIndex("by_thread", (q) => q.eq("tenantId", tenantId).eq("threadId", threadId))
      .unique();

    let planId: Id<"plans">;
    if (plan) {
      if (plan.kind === "media") {
        const jobs = await ctx.db
          .query("mediaJobs")
          .withIndex("by_plan", (q) => q.eq("tenantId", tenantId).eq("planId", plan._id))
          .collect();
        const imageJobs = jobs.filter((job) => job.kind === "image");
        if (imageJobs.some((job) => LIVE_JOB_STATUS.has(job.status))) {
          return { ok: false, reason: "image_in_flight" };
        }
        if (imageJobs.length > 0) return { ok: false, reason: "image_already_started" };
      }
      if (!RECYCLABLE_STATUS.has(plan.status)) return { ok: false, reason: "draft_in_progress" };
      const userWork = plan.kind !== "media" && plan.status !== "canceled" && hasDraftContent(plan);
      if (userWork) return { ok: false, reason: "draft_in_progress" };
      planId = plan._id;
      await ctx.runMutation(internal.plans.resetPlan, { planId });
    } else {
      planId = await ctx.runMutation(internal.plans.insertPlan, { tenantId, threadId });
    }

    await ctx.db.patch(planId, {
      kind: "media",
      mediaMode: "image",
      imagePrompt: clean,
      recipients: [],
      subject: `Image: ${clean}`.slice(0, 120),
      body: "",
      status: "proposed",
    });
    return { ok: true, planId };
  },
});

/** A media run that produced prose but no usable deck. It lands as a MEMO — `kind` is left at what
 *  `stageMediaPlan` set, so nothing downstream reads this row as a reel — with the lever named in
 *  the body. The user sees WHY and what to ask for; they never see an empty canvas. */
export const landStoryboardRefusal = internalMutation({
  args: { tenantId: v.string(), planId: v.id("plans"), body: v.string() },
  handler: async (ctx, { tenantId, planId, body }): Promise<null> => {
    const plan = await ctx.db.get(planId);
    if (!plan || plan.tenantId !== tenantId) return null;
    await ctx.db.patch(planId, { body, status: "proposed" });
    return null;
  },
});

/**
 * Patch slot fields as the guided conversation fills them and when the draft lands
 * (status → "proposed"). Only supplied fields are written (undefined = untouched).
 */
export const patchPlan = internalMutation({
  args: {
    planId: v.id("plans"),
    recipients: v.optional(v.array(v.string())),
    mode: v.optional(v.union(v.literal("individual"), v.literal("group"))),
    subject: v.optional(v.string()),
    bodyIntent: v.optional(v.string()),
    body: v.optional(v.string()),
    status: v.optional(PLAN_STATUS),
    greetingName: v.optional(v.string()), // resolve path persists the drafter greeting through patchPlan
    recipientBodies: v.optional(v.record(v.string(), v.string())), // address(lowercased) → tailored body override (CKPT-03); the tool passes the full merged map
    recipientNames: v.optional(v.record(v.string(), v.string())), // address(lowercased) → picked displayName (UAT-F1); the fold passes the full merged map
    sendAt: v.optional(v.number()), // 03.5: absolute epoch ms deferred send time (drop-undefined preserves a stored value on a partial patch)
    // 03.11 RPLY-01 reply threading — the replyToMessage tool (Plan 04) sets these server-side so a
    // reply threads (executePlan copies replyThreadId→request.threadId + inReplyTo/references). All
    // optional; drop-undefined means a non-reply patch never touches them. replyThreadId is the GMAIL
    // thread id (NOT the agent thread `threadId`); inReplyTo/references are RFC Message-ID headers.
    replyToMessageId: v.optional(v.string()),
    replyThreadId: v.optional(v.string()),
    inReplyTo: v.optional(v.string()),
    references: v.optional(v.string()),
    // 12-05 BEVL-02: the plan-SHAPE discriminator. "memo" marks a next-step memo (no recipients)
    // so executePlan takes the persist terminal instead of the gmail fan-out. Drop-undefined means
    // an email patch never touches it; resetPlan clears it explicitly.
    // 17-01 ACTN-02: widened to the same closed union as schema.ts.
    // 20-07 MEDIA-01: widened to the same closed union as schema.ts. Widening ONE of the two and
    // not the other is Pitfall 9 — every typecheck passes and the runtime validator rejects the new
    // kind (the PLAN_STATUS Pitfall-5 lesson at the top of this file).
    // 19-06 ACTN-05: widened a FOURTH time, in the SAME edit as schema.ts for the reason the line
    // above gives — this mirror and the schema union must move together.
    // Task 8 (live-finance-inputs): widened a FIFTH time, and DELIBERATELY — Task 4 left this
    // decision here because widening `kind` widens what the MODEL may set through a patch.
    // `finance_write` is safe for the same reason `crm_write` is: the row it produces is INERT
    // until Approve, and `applyFinanceClaims` re-validates every claim at the gate. This mirror
    // and the schema union must move together (Pitfall 9, the line above).
    // 17-05 ACTN-02 gap closure: widened a SIXTH time, in the SAME edit as schema.ts for the
    // reason the 20-07 line above gives — this mirror and the schema union must move together,
    // or every typecheck passes while the RUNTIME validator rejects the new kind (Pitfall 9).
    kind: v.optional(
      v.union(
        v.literal("memo"),
        v.literal("calendar_event"),
        v.literal("media"),
        v.literal("crm_write"),
        v.literal("finance_write"),
        v.literal("calendar_manage"),
      ),
    ),
    // 19-06 ACTN-05: the staged CRM operation list. UNLIKE the deck and the staged event, this IS
    // a patchPlan arg — the whole point of `crm_write` is that the model proposes the operations
    // and the human approves them, so the staging tool (19-08) must be able to write it. That is
    // safe only because it is INERT until Approve: `executePlan` re-validates it through
    // `parseCrmOperations` and applies it in one transaction. Nothing here spends money, mints a
    // ref or claims something happened. Drop-undefined means a non-CRM patch never touches it.
    crmOperations: v.optional(v.array(v.any())),
    // Task 8: the staged figure-claim list, on the SAME reasoning as `crmOperations` above — the
    // whole point of `finance_write` is that the model proposes figures and the human approves
    // them, so the staging tool must be able to write it. `v.any()` elements because the SHAPE is
    // owned by `schema.ts`'s own `financeClaims` validator (which Convex enforces on this very
    // `db.patch`) and by `validateFigureClaim` (@pikar/core), which runs at BOTH the staging
    // boundary and the apply boundary; a third hand-mirrored copy here would be one more thing to
    // keep in step. Drop-undefined means a non-finance patch never touches it; `resetPlan` clears
    // it explicitly.
    financeClaims: v.optional(v.array(v.any())),
    // 17-01 ACTN-02: the four STAGED event slots a cockpit tool may write. Drop-undefined means a
    // non-calendar patch never touches them; resetPlan clears them explicitly.
    // `calendarEventId` and `calendarRunId` are deliberately NOT args here: they are written only
    // by cockpit.ts (the run id, in the Approve transaction) and calendarComplete.ts (the event
    // id, in the retrier terminal) via direct ctx.db.patch. Nothing reachable from the MODEL may
    // write an event ref or a run id. Do not add them here speculatively.
    eventTitle: v.optional(v.string()),
    eventStartMs: v.optional(v.number()),
    eventDurationMs: v.optional(v.number()),
    eventTz: v.optional(v.string()),
    // 17-05 ACTN-02 gap closure — the calendar_manage PROPOSAL fields, split down the SAME line
    // the four slots above are split along, and for the same reason.
    //
    // STAGEABLE (here): which calendar, which operation, and which of the tenant's OWN registry
    // rows. All three are things a human is about to read on a card and approve, and all three
    // are re-validated at the gate — `calendarManagedEventId` is an `Id<"calendarEvents">`, so a
    // forged value is a validator error, and a foreign-tenant row is refused by the terminal.
    //
    // NOT STAGEABLE (deliberately absent, and the ABSENCE is the guarantee — the
    // `calendarEventId`/`calendarRunId` rule above, verbatim):
    //   - `calendarExpectedEtag` is the If-Match value. Letting anything reachable from the model
    //     supply it would let a STALE plan overwrite a newer calendar edit — the precise
    //     data-loss path 17-VERIFICATION.md's G2 says a management surface must not have. Plan
    //     17-09 copies a FRESH etag server-side from a provider inspection, through its own
    //     internal mutation (the `persistStoryboard` precedent), never through this door.
    //   - `calendarFailureCode` is written by the retrier terminal (17-08). Nothing reachable
    //     from the model may claim an operation failed — or, worse, that it did not.
    calendarProvider: v.optional(v.union(v.literal("google"), v.literal("microsoft"))),
    calendarOperation: v.optional(v.union(v.literal("update"), v.literal("delete"))),
    calendarManagedEventId: v.optional(v.id("calendarEvents")),
    // 20-02 MEDIA-01: `shots`, `artDirection`, `script`, `clipSeconds` and the six render-plane
    // fields are deliberately NOT args here, and that ABSENCE is the guarantee — the
    // `calendarEventId`/`calendarRunId` rule above, verbatim. The deck is written only by 20-08's
    // `persistStoryboard` (server-side, from the PARSED specialist output) and by 20-09's canvas
    // editor mutations; the render plane only by 20-16's render terminal. All direct ctx.db.patch.
    // Nothing reachable from the MODEL may write a block prompt or a narration line that later
    // becomes a paid generation, and nothing reachable from the model may claim a render happened.
    // Do not add them here speculatively.
  },
  handler: async (ctx, { planId, ...patch }) => {
    // Drop undefined keys so a partial patch never clobbers a filled slot with undefined.
    const fields = Object.fromEntries(Object.entries(patch).filter(([, val]) => val !== undefined));
    await ctx.db.patch(planId, fields);
  },
});

/**
 * The PLAN-card date picker's tenant-guarded writer (03.5 deferred send). `sendAt` is the ONE
 * source of truth (absolute epoch ms); passing undefined CLEARS the field → send immediately on
 * Approve. Tenant-guarded (no cross-tenant write). Content-plane only — NEVER audited (§4). The
 * agent's setSendTime tool (Plan 02) writes the same field via patchPlan; this is the UI path.
 */
export const setPlanSendTime = tenantMutation({
  args: { planId: v.id("plans"), sendAt: v.optional(v.number()) },
  handler: async (ctx, { planId, sendAt }) => {
    const plan = await ctx.db.get(planId);
    if (!plan || plan.tenantId !== ctx.tenantId) throw new Error("plan not found"); // no cross-tenant write
    await ctx.db.patch(planId, { sendAt }); // undefined removes the field → immediate
  },
});

/** Terminal/CAS-friendly status setter (executePlan → approved; fan-out → done). */
export const setPlanStatus = internalMutation({
  args: { planId: v.id("plans"), status: PLAN_STATUS },
  handler: async (ctx, { planId, status }) => {
    await ctx.db.patch(planId, { status });
  },
});

/**
 * Own one per-recipient delivery terminal and its plan counters in the same transaction. Request
 * status is the idempotency key: once a row is `sent` or `failed`, workflow/action retries cannot
 * increment it again or flip it to the opposite terminal. Legacy plans still receive the request
 * terminal but keep their missing counters, which is the explicit partial-progress signal.
 */
export const recordDeliveryTerminal = internalMutation({
  args: {
    planId: v.id("plans"),
    requestId: v.id("requests"),
    // 19-05: `suppressed` is a THIRD terminal, not a flavour of `failed`. Nothing went wrong — the
    // recipient asked to stop being emailed after this plan was approved, so the row terminates as
    // `blocked` and leaves the plan's sent/failed tallies honest.
    outcome: v.union(v.literal("sent"), v.literal("failed"), v.literal("suppressed")),
  },
  handler: async (ctx, { planId, requestId, outcome }): Promise<{ applied: boolean }> => {
    const [plan, request] = await Promise.all([ctx.db.get(planId), ctx.db.get(requestId)]);
    if (!plan || !request || request.planId !== planId || request.tenantId !== plan.tenantId) {
      throw new Error("delivery request not found");
    }
    if (
      request.status === "sent" ||
      request.status === "failed" ||
      request.status === "blocked" // the suppressed terminal, replayed
    ) {
      return { applied: false };
    }

    // `blocked` is an EXISTING requests.status member — the suppressed terminal invents no state.
    await ctx.db.patch(requestId, { status: outcome === "suppressed" ? "blocked" : outcome });
    if (
      plan.counterComplete !== true ||
      plan.recipientTotal === undefined ||
      plan.sentCount === undefined ||
      plan.failedCount === undefined ||
      plan.queuedCount === undefined
    ) {
      return { applied: true };
    }

    // 19-05: a suppression REMOVES a recipient rather than resolving one — the plan now has one
    // fewer person to reach, which is exactly what `executePlan`'s approve-time filter produces
    // (there the address never entered `recipientTotal` at all). Booking it as `failed` would
    // report a delivery problem that did not happen; leaving the total alone would strand
    // `queuedCount` above zero forever. The idempotency guard above is what keeps this decrement
    // once-only under workflow/action retries.
    const total = Math.max(0, Math.floor(plan.recipientTotal) - (outcome === "suppressed" ? 1 : 0));
    const sentCount = Math.min(total, plan.sentCount + (outcome === "sent" ? 1 : 0));
    const failedCount = Math.min(
      total - sentCount,
      plan.failedCount + (outcome === "failed" ? 1 : 0),
    );
    await ctx.db.patch(planId, {
      recipientTotal: total,
      sentCount,
      failedCount,
      queuedCount: Math.max(0, total - sentCount - failedCount),
    });
    return { applied: true };
  },
});

/**
 * TRANSIENT candidate writer (cockpit calls after a name search). Holds fetched
 * candidates + same-turn pendingValid addresses on the content plane so the resolution
 * card renders across turns. Content-plane only — never audited (CLAUDE.md §4).
 *
 * ADDITIVE (upsert-by-name): resolveContacts searches ONE name per call, but the agent
 * resolves EACH named person in a multi-name turn ("Sarah and Zach") with its own call.
 * A wholesale replace let the second search obliterate the first — one name silently
 * dropped from the ResolutionCard while the agent's reply claimed both (the disconnect).
 * So we MERGE: incoming names upsert by name (a re-search of the same name replaces just
 * that name's matches — never a duplicate section), other parked names are preserved, and
 * pendingValid unions in (case-insensitive). clearCandidates still wipes both on pick.
 */
export const writeCandidates = internalMutation({
  args: {
    planId: v.id("plans"),
    candidates: CANDIDATES,
    pendingValid: v.array(v.string()),
  },
  handler: async (ctx, { planId, candidates, pendingValid }) => {
    const plan = await ctx.db.get(planId);
    // Upsert each incoming name into the parked set: drop any existing entry with the same
    // name (re-search replaces its matches), keep every other name, then append the incoming.
    const incomingNames = new Set(candidates.map((c) => c.name));
    const kept = (plan?.candidates ?? []).filter((c) => !incomingNames.has(c.name));
    const mergedCandidates = [...kept, ...candidates];
    // Union pendingValid case-insensitively (a second search must not wipe held valid addresses).
    const seen = new Set((plan?.pendingValid ?? []).map((a) => a.toLowerCase()));
    const mergedValid = [...(plan?.pendingValid ?? [])];
    for (const a of pendingValid) {
      if (seen.has(a.toLowerCase())) continue;
      seen.add(a.toLowerCase());
      mergedValid.push(a);
    }
    await ctx.db.patch(planId, { candidates: mergedCandidates, pendingValid: mergedValid });
  },
});

/**
 * Wipe-on-pick: unset BOTH transient fields (patch to undefined removes the field in
 * Convex → "no contacts cache at rest"). Does NOT touch greetingName — it must survive
 * to the draft turn.
 */
export const clearCandidates = internalMutation({
  args: { planId: v.id("plans") },
  handler: async (ctx, { planId }) => {
    await ctx.db.patch(planId, { candidates: undefined, pendingValid: undefined });
  },
});

/**
 * Discard the whole draft and start fresh (UAT-D, 03.10-05). Explicit slot-clear: `patchPlan`
 * DROPS undefined keys so it can NEVER clear a filled slot — this writer sets every composition
 * field explicitly (mirrors clearCandidates/recordAttachments). Content-plane only — NEVER audited
 * (§4). This is a COMPOSITION reset (collecting/proposed stage), NOT a scheduled-send cancel — it
 * deliberately does NOT touch scheduledFunctionId/correlationId/workflowId (that is
 * cockpit.cancelScheduledPlan). The tool guards status before calling this (no reset past proposed).
 */
export const resetPlan = internalMutation({
  args: { planId: v.id("plans") },
  handler: async (ctx, { planId }) => {
    await ctx.db.patch(planId, {
      status: "collecting",
      recipients: [],
      mode: undefined,
      subject: undefined,
      bodyIntent: undefined,
      body: undefined,
      attachments: undefined,
      attachmentError: undefined,
      candidates: undefined,
      pendingValid: undefined,
      greetingName: undefined,
      recipientBodies: undefined,
      recipientNames: undefined, // explicit clear (UAT-F1) — stale picked names must not re-label the NEXT draft's recipients
      sendAt: undefined,
      // 03.11 RPLY-01 (Pitfall 6): a reply then "start over" must NOT leave a stale threadId that
      // silently threads the next FRESH compose into the old conversation. patchPlan drops undefined,
      // so — like every field above — each threading field must be named explicitly to clear.
      replyToMessageId: undefined,
      replyThreadId: undefined,
      inReplyTo: undefined,
      references: undefined,
      // 12-05: a reset must also drop the memo SHAPE, or the next fresh compose in this thread
      // would silently take the memo terminal instead of sending (the Pitfall-6 class, one rung up).
      kind: undefined,
      // 17-01 ACTN-02: all SIX staged-event fields, explicitly. A staged event surviving a reset
      // would re-stage onto the NEXT plan — the recipientNames/threading precedent above, and the
      // same Pitfall-6 class. patchPlan drops undefined, so each must be named to clear.
      eventTitle: undefined,
      eventStartMs: undefined,
      eventDurationMs: undefined,
      eventTz: undefined,
      calendarEventId: undefined,
      calendarRunId: undefined,
      // 17-05 ACTN-02 gap closure: all FIVE calendar_manage proposal fields, explicitly. Same
      // Pitfall-6 class as the staged event above and one rung worse — a surviving
      // `calendarManagedEventId` + `calendarOperation` would point the NEXT approve in this
      // thread at a REAL event on a REAL calendar that nobody just agreed to touch, and a
      // surviving `calendarExpectedEtag` would carry a stale If-Match into it. patchPlan drops
      // undefined, so each must be named to clear.
      //
      // THE REGISTRY IS NOT TOUCHED. `resetPlan` is a COMPOSITION reset of the proposal plane;
      // `calendarEvents` rows are facts about real calendars and survive it. That asymmetry is
      // the whole reason the registry is a table rather than more `plans` columns.
      calendarProvider: undefined,
      calendarOperation: undefined,
      calendarManagedEventId: undefined,
      calendarExpectedEtag: undefined,
      calendarFailureCode: undefined,
      // 19-06 ACTN-05: same Pitfall-6 class — a staged operation list surviving a reset would be
      // applied by the NEXT approve in this thread, writing contacts nobody just agreed to.
      crmOperations: undefined,
      // 2026-08-10: same Pitfall-6 class again — a staged figure claim surviving a reset would be
      // applied by the NEXT approve in this thread, writing a number nobody just agreed to over a
      // figure the owner may have typed in the meantime.
      financeClaims: undefined,
      mediaRunId: undefined, // 20-07: same Pitfall-6 class — a stale run id would let a media
      // retrier terminal fail rows on a plan that has since been reset to a fresh compose.
      // 20-02 MEDIA-01: the block deck AND the render plane, explicitly. Same Pitfall-6 class as
      // the staged event above, one rung worse for the render: a surviving `renderStorageId` would
      // show the PREVIOUS thread's reel under a brand-new proposal — a lie the user can watch.
      mediaMode: undefined,
      imagePrompt: undefined,
      artDirection: undefined,
      script: undefined,
      clipSeconds: undefined,
      // 20.2: the SAME Pitfall-6 class. A surviving `targetDurationSeconds` would tell the next
      // proposal in this thread that it is a 30-second scene deck when its shots say otherwise —
      // and the exact-sum gate would then refuse a deck the user never wrote wrong.
      targetDurationSeconds: undefined,
      shots: undefined,
      renderStatus: undefined,
      renderStorageId: undefined,
      sidecarStorageId: undefined,
      sidecarHash: undefined,
      renderReason: undefined,
      renderedAt: undefined,
    });
  },
});

/**
 * The single content-plane write surface for generated attachments (CKPT-02, Plan 04 tools).
 * ALWAYS replaces `attachments` wholesale (supersede/remove = pass the full new array) and
 * sets/clears `attachmentError` directly — passing `attachmentError: undefined` CLEARS it (a
 * successful generate wipes a prior render/cap error), mirroring clearCandidates. Because this
 * writes the error explicitly (not via the drop-undefined patchPlan), the clear path is
 * unambiguous. Content-plane only — NEVER audited (CLAUDE.md §4).
 */
export const recordAttachments = internalMutation({
  args: {
    planId: v.id("plans"),
    attachments: ATTACHMENTS,
    attachmentError: v.optional(v.string()),
  },
  handler: async (ctx, { planId, attachments, attachmentError }) => {
    await ctx.db.patch(planId, { attachments, attachmentError });
  },
});

/**
 * Read one plan row by id (internal). The cockpit Executive-Agent tools (llm.ts) run in the
 * "use node" action with a planId and no ctx.db — they read the row through this. Internal-only;
 * the tool re-checks tenantId against the row before use (no cross-tenant read).
 */
export const getById = internalQuery({
  args: { planId: v.id("plans") },
  handler: async (ctx, { planId }) => await ctx.db.get(planId),
});

/**
 * Signed download URLs for a plan's generated attachments (CKPT-02, PLAN/REPORT cards).
 * This is the FIRST `storage.getUrl` in the codebase: the URL is a bearer capability, so it is
 * ONLY ever returned from this tenant-guarded query and NEVER logged (CLAUDE.md §4). Guards on the
 * plan row (mirrors byThread) — a caller whose identity ≠ plan.tenantId gets an empty array, never
 * another tenant's signed URL.
 */
export const attachmentUrls = tenantQuery({
  args: { planId: v.id("plans") },
  handler: async (ctx, { planId }) => {
    const plan = await ctx.db.get(planId);
    if (!plan || plan.tenantId !== ctx.tenantId) return [];
    return Promise.all(
      (plan.attachments ?? []).map(async (a) => ({
        filename: a.filename,
        mimeType: a.mimeType,
        size: a.size,
        url: await ctx.storage.getUrl(a.storageId),
      })),
    );
  },
});

/** The tenant's plans row for a thread → feeds the PLAN + DRAFT cards (by_thread). */
export const byThread = tenantQuery({
  args: { threadId: v.string() },
  handler: async (ctx, { threadId }) =>
    await ctx.db
      .query("plans")
      .withIndex("by_thread", (q) => q.eq("tenantId", ctx.tenantId).eq("threadId", threadId))
      .unique(),
});

/**
 * The LIVE REPORT projection (DECISION #1 / RESEARCH-delivery §3). Reads every
 * `requests` row for planId (by_plan, tenant-guarded) and, for each, joins its
 * `gmail.sent` audit (by_correlation) to surface the delivered messageId. No report[]
 * array is stored; requests.status + the audit insert make this fill live per recipient.
 */
export const reportForPlan = tenantQuery({
  args: { planId: v.id("plans") },
  handler: async (ctx, { planId }) => {
    const rows = await ctx.db
      .query("requests")
      .withIndex("by_plan", (q) => q.eq("planId", planId))
      .collect();

    const report = [];
    for (const r of rows) {
      if (r.tenantId !== ctx.tenantId) continue; // never leak another tenant's row
      const sent = await ctx.db
        .query("audit")
        .withIndex("by_correlation", (q) => q.eq("correlationId", r.correlationId))
        .filter((q) => q.eq(q.field("eventType"), "gmail.sent"))
        .first();
      // Per-recipient delivered attachment(s): re-download the EXACT sent bytes. Storage is
      // immutable per id, so we resolve the persisted send-time refs — never regenerate (§4: url never logged).
      const attachments = [];
      for (const ref of r.attachmentRefs) {
        const att = await ctx.db.get(ref);
        if (!att) continue;
        attachments.push({ filename: att.filename, url: await ctx.storage.getUrl(att.storageId) });
      }
      report.push({
        // The requests row id — the requestId the delivered-response feedback control keys
        // off (api.feedback.myFeedback/submitFeedback), so a rating attributes to the exact
        // skillVersion copied onto this row at executePlan (Plan 02/06).
        requestId: r._id,
        recipient: r.recipient,
        status: r.status,
        correlationId: r.correlationId,
        messageId: (sent?.payload as { messageId?: string } | undefined)?.messageId ?? null,
        attachments,
      });
    }
    return report;
  },
});
