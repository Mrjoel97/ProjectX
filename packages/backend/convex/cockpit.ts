// Cockpit orchestration seam (SC2/SC3/SC4). The conversation engine is the governed Executive
// Agent tool-loop (internal.llm.runCockpitAgent): sendCockpitMessage is a THIN driver — it saves
// the user's turn, invokes the loop, and saves the reply. The deterministic `emailIntent` FSM is
// GONE (no dual engine); only the pure validators survive in @pikar/core.
//
// The agent thread is a message store only — the LLM reasoning happens inside runCockpitAgent
// (llm.ts, the sole "use node" module). This is the codebase's FIRST `new Agent(...)`.
//
// executePlan is a HUMAN gate (a tenantMutation, NEVER an LLM tool): a compare-and-set on
// plan.status (proposed→approved) makes a double-approve send once and guarantees zero sends
// before Approve. It is the SOLE `workflow.start(deliverApprovedPlan)` call site (the
// grep-able zero-sends-before-Approve invariant, RESEARCH-delivery §5).
import { Agent, listMessages } from "@convex-dev/agent";
import { COCKPIT_AGENT_SKILL } from "@pikar/contracts/skill";
import {
  type ActionType,
  type Arm,
  actionTypeOf,
  applyRecipientEdit,
  armFor,
  assertNever,
  classifyReviewDecision,
  type FigureClaim,
  normalizeAddress,
  notificationMessage,
  SEND_TIME_HORIZON_MS,
} from "@pikar/core";
// 20-07: the SHOT_TYPES boundary check for the media pre-step. Deep specifier — `storyboard` is not
// re-exported from the package root (media.ts:23 carries the same pair of lines).
import type { ShotType } from "@pikar/core/storyboard";
import { SHOT_TYPES } from "@pikar/core/storyboard";
import { DEFAULT_MODEL } from "@pikar/cost";
import { paginationOptsValidator } from "convex/server";
import { ConvexError, v } from "convex/values";
import { api, components, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { type ActionCtx, internalMutation, type MutationCtx } from "./_generated/server";
// 2026-08-10: the FINANCE terminal, direct-called for exactly the reasons the CRM one below is.
import { applyFinanceClaims, type FinanceApplyRefusal } from "./cash";
// 19-06 ACTN-05: the CRM terminal. Called DIRECTLY (not via runMutation) so the whole operation
// list lands in the same serializable transaction as the proposed -> approved CAS, which is what
// makes approve-all-or-none and double-approve-applies-once true without a saga.
import { applyCrmOperations } from "./contacts";
// The memo terminal (12-05): a memo-plan's Approve saves a vault doc instead of fanning out email.
import { persistNextStepMemo } from "./evaluations";
import { retrier, workflow } from "./index";
import { tenantAction, tenantMutation, tenantQuery } from "./lib/functions";
// 20-07 MEDIA-01: the whole-reel reservation, called DIRECTLY (not via runMutation) so it lands in
// the same serializable transaction as the proposed -> approved CAS. See its doc comment.
import { type ReserveRefusal, reserveJobInner } from "./media";

// No hardcoded `instructions` prompt (CLAUDE.md §5): the reasoning prompt is the cockpit-agent
// skill body, loaded inside runCockpitAgent. The Agent here is a pure message store — it never
// runs generateText/streamText — so its `languageModel` is inert.
// ponytail: AI SDK v6/v7 type mismatch — @convex-dev/agent@0.6.4 demands a v6 LanguageModel; the
// repo pins ai@7 and drives models via the gateway string (llm.ts DEFAULT_MODEL). Since the model
// is never called here, cast the config past the version guard. Drop the cast when agent ships
// v7-compatible types (CLAUDE.md §6 — do not bump to "fix" this).
const cockpitAgent = new Agent(components.agent, {
  name: "email-cockpit",
  languageModel: DEFAULT_MODEL,
} as unknown as ConstructorParameters<typeof Agent>[1]);

/**
 * AGNT-04: fire ONE agent.timeout notification IFF the driver's caught error is the content-free
 * exhausted-timeout marker runAgentLoop throws (a ConvexError whose data.kind is "agent_timeout" —
 * the error `name` does not survive the ctx.runAction boundary, a ConvexError's `data` does). BOTH
 * cockpit agent entry points (sendCockpitMessage, resolveRecipients) route their catch through this,
 * so a timeout on EITHER surface notifies (CLAUDE.md §8 — one fix, every caller). A non-timeout
 * failure is a no-op (never over-notify). Callers keep their own safe reply + trace-only finally
 * (invariant 11 — the notify lives in the catch tail, NEVER the finally).
 */
async function notifyIfAgentTimeout(ctx: ActionCtx, tenantId: string, e: unknown): Promise<void> {
  if (e instanceof ConvexError && (e.data as { kind?: string } | null)?.kind === "agent_timeout") {
    await ctx.runMutation(internal.notifications.notify, {
      tenantId,
      kind: "agent.timeout",
      message: notificationMessage("agent.timeout"),
    });
  }
}

/**
 * The conversation turn (SC2/SC3). Thin driver over the governed Executive Agent tool-loop:
 * (1) ensure a thread + its single plans row on the first turn; (2) save the user's turn to the
 * agent thread; (3) call internal.llm.runCockpitAgent (the tool-loop reasons + patches the plan
 * row); (4) save the returned reply as the assistant turn — a caught failure saves a
 * non-dead-ending error turn (nothing sent, the partial plan row stays valid). A `blocked` result
 * already comes back AS the paused reply, so it is surfaced by saving it. Returns `threadId` so
 * the client binds the chat hooks + `plans.byThread`. Explicit return type (guidelines §96).
 */
export const sendCockpitMessage = tenantAction({
  args: {
    threadId: v.optional(v.string()),
    text: v.string(),
    // The trusted client's clock+zone (§2-D) so the agent's setSendTime tool parses a volunteered
    // natural-language time against the USER's now/zone — never the model's. Optional: a turn
    // without it just can't set a send time by chat (the plan-card picker remains the writer).
    clientContext: v.optional(v.object({ tz: v.string(), nowMs: v.number() })),
  },
  handler: async (ctx, { threadId, text, clientContext }): Promise<{ threadId: string }> => {
    // 1. Ensure a thread + its single plans row (first turn creates both; userId = tenantId).
    let tid = threadId;
    if (!tid) {
      // Title the thread from the first message so the header's past-chats menu (listThreads)
      // has a real label across reloads — the session tab strip is derived the same way.
      const title = text.trim().replace(/\s+/g, " ").slice(0, 60) || "New chat";
      const created = await cockpitAgent.createThread(ctx, { userId: ctx.tenantId, title });
      tid = created.threadId;
      await ctx.runMutation(internal.plans.insertPlan, { tenantId: ctx.tenantId, threadId: tid });
    }
    const plan = await ctx.runQuery(api.plans.byThread, { threadId: tid });
    if (!plan) throw new Error("cockpit: plan row missing for thread");

    // 2. Fetch the prior turns BEFORE saving the current one (UAT-E) — otherwise the current turn
    //    appears twice (as the last history row AND as "The user says:"). A fresh thread yields [].
    const history = await fetchRecentHistory(ctx, tid);

    //    Persist the user's turn (the agent thread is a message store — DECISION #2 retired; the
    //    reasoning lives in runCockpitAgent, this is display history for the chat pane).
    await cockpitAgent.saveMessage(ctx, { threadId: tid, prompt: text, skipEmbeddings: true });

    // 3. Drive the governed tool-loop. `blocked` returns AS the paused reply. A thrown failure
    //    (our-bug / config — an eligible model failure retries internally) becomes a conversational
    //    error turn: nothing was sent, the partial plan row stays valid, the user can retry.
    //
    //    The activity trace's turn lifecycle (CKPT-05) wraps it: the driver mints the turnId and
    //    owns the `thinking` row; the SDK owns the per-tool rows inside the loop (llm.ts).
    const turnId = crypto.randomUUID(); // server-minted, per turn — groups the trace
    // The `thinking` row is the trace's FLOOR, and it lands within ~ms of the send. preCall, the
    // skill-registry load and the first model round-trip ALL happen before any tool event could
    // fire — and many turns (the agent asking "who should I send this to?") call no tool at all,
    // so a tool-only surface would show NOTHING for exactly the turns that feel most frozen.
    await ctx.runMutation(internal.agentSteps.record, {
      tenantId: ctx.tenantId,
      threadId: tid,
      turnId,
      stepKey: "thinking",
      tool: "thinking",
      startedAt: Date.now(),
    });
    let reply: string;
    try {
      const res = await ctx.runAction(internal.llm.runCockpitAgent, {
        tenantId: ctx.tenantId,
        threadId: tid,
        planId: plan._id,
        text,
        clientContext,
        turnId,
        history, // UAT-E: the model sees the conversation so far, not just this turn
      });
      reply = res.reply;
    } catch (e) {
      reply = "Something went wrong on my side — nothing was sent. Please try that again.";
      // AGNT-04: an EXHAUSTED model timeout (primary + CHEAP_MODEL fallback both timed out) escalates
      // to one in-app agent.timeout notification. The turn stays non-dead-ending (the safe reply
      // above); nothing was sent. A non-timeout failure is a no-op (never over-notify).
      await notifyIfAgentTimeout(ctx, ctx.tenantId, e);
    } finally {
      // `finally` — NOT the tail of the try, and please do not "simplify" it away. It is the only
      // construct that terminalizes on EVERY exit: success, the caught throw, AND the governed stop
      // (kill switch / daily budget), which comes back from runCockpitAgent as DATA through a normal
      // `return` and so never touches the catch. A step that starts must always end (Pitfall 2).
      await ctx.runMutation(internal.agentSteps.finish, {
        tenantId: ctx.tenantId,
        turnId,
        stepKey: "thinking",
        phase: "done",
        endedAt: Date.now(),
      });
    }

    // 4. Save the assistant reply.
    await cockpitAgent.saveMessage(ctx, {
      threadId: tid,
      message: { role: "assistant", content: reply },
      skipEmbeddings: true,
    });
    return { threadId: tid };
  },
});

// A card pick is an agent TURN, not a dead-end: the synthetic user text that re-enters the
// tool-loop after the recipients are folded. States the FACT of the fold (UAT-F2, 03.10-07): the
// picks are ALREADY the plan's recipients (buildAgentContext shows them by #index WITH their
// names, address-free §2-D), recipients must not change on this turn, and an unset subject/body
// is ASKED for — never invented. Driver-plane synthetic string, not a skill (no §5 issue).
const RESOLUTION_CONTINUE =
  "I've picked the recipients from the contact list — they are already the plan's recipients, " +
  "shown by #index with their names. Do not change the recipients. Continue with whatever the " +
  "plan still needs; if the subject or body is not set, ask me for it — never invent one.";

// Last K saved turns for the model's history block (UAT-E, 03.10-06). Fetch 12, render ≤10
// (llm.ts buildHistoryBlock caps) — a small overfetch absorbs skipped rows. Reuses the SAME
// listMessages agent-store read the chat pane uses (:235). History is user+assistant CHAT text —
// model-plane content that already flows to the model; fetchRecentHistory writes nothing (§4).
const HISTORY_FETCH = 12;
async function fetchRecentHistory(
  ctx: Parameters<typeof listMessages>[0],
  threadId: string,
): Promise<Array<{ role: "user" | "assistant"; content: string }>> {
  // listMessages hardcodes order:"desc" internally (verified @convex-dev/agent@0.6.4
  // dist/client/messages.js) — the first page is the NEWEST rows, newest-first. Reverse below
  // for the model's oldest-first render.
  // FAIL-OPEN (UAT 2026-07-19 hotfix): history is an enhancement, never a precondition. A slow
  // store read (1s query timeout on a degraded dev deployment) must degrade to a historyless
  // turn — exactly the pre-03.10-06 prompt — not fail the user's send.
  let res: Awaited<ReturnType<typeof listMessages>>;
  try {
    res = await listMessages(ctx, components.agent, {
      threadId,
      paginationOpts: { cursor: null, numItems: HISTORY_FETCH },
      excludeToolMessages: true,
    });
  } catch {
    return [];
  }
  const turns: Array<{ role: "user" | "assistant"; content: string }> = [];
  for (const m of res.page) {
    const role = m.message?.role;
    if (role !== "user" && role !== "assistant") continue;
    // Prefer the convenience `text`, else string content, else join the text parts.
    const content = m.message?.content;
    const text =
      m.text ??
      (typeof content === "string"
        ? content
        : (content ?? [])
            .map((p) => (typeof p === "object" && p !== null && "text" in p ? String(p.text) : ""))
            .filter(Boolean)
            .join(" "));
    if (!text.trim()) continue;
    turns.push({ role, content: text });
  }
  return turns.reverse(); // newest-first page → oldest-first block
}

/**
 * Fold a contact PICK from the resolution card back into the conversation (SC2). The picked
 * addresses are already valid, so this thin action folds them (plus any held pendingValid) into
 * the recipient list via the shared `applyRecipientEdit`, records the first pick's display name as
 * the drafted greeting, then wipes the transient candidates (wipe-on-pick). It then RE-ENTERS the
 * governed tool-loop so the agent takes its next step (ask the subject / draft / propose) from the
 * updated plan row — without this the conversation dead-ends on a blank workspace after the card
 * unmounts. Mirrors sendCockpitMessage's drive+save tail (a thrown failure saves a non-dead-ending
 * error turn; nothing is sent). Explicit return type (guidelines §96).
 */
export const resolveRecipients = tenantAction({
  args: {
    threadId: v.string(),
    picks: v.array(
      v.object({
        name: v.string(),
        address: v.string(),
        displayName: v.optional(v.string()),
      }),
    ),
  },
  handler: async (ctx, { threadId, picks }): Promise<{ threadId: string }> => {
    const plan = await ctx.runQuery(api.plans.byThread, { threadId });
    if (!plan) throw new Error("cockpit: plan row missing for thread");
    // Picks + held pendingValid are already-valid addresses — fold them into recipients (deduped)
    // via the shared validator; nothing bounces, so we take the merged list.
    const addresses = [...(plan.pendingValid ?? []), ...picks.map((p) => p.address)];
    const edit = applyRecipientEdit(plan.recipients ?? [], { op: "add", addresses });
    // Persist the picks' display names (UAT-F1): keyed by lowercased address so buildAgentContext
    // renders `#1: Brett J. Fox` after the pick — never `#1 (no name)` for a contact the user
    // chose. pendingValid (typed literals) get no name — correct: nobody picked them. Stale keys
    // after a later recipient edit are harmless (lookup by address; a missing key falls back to
    // the placeholder); resetPlan is the cleaner. ponytail: no map-pruning on edit.
    const names: Record<string, string> = { ...(plan.recipientNames ?? {}) };
    for (const p of picks) if (p.displayName) names[p.address.toLowerCase()] = p.displayName;
    await ctx.runMutation(internal.plans.patchPlan, {
      planId: plan._id,
      recipients: edit.recipients,
      greetingName: picks[0]?.displayName, // FIRST pick names the greeting (undefined is dropped)
      recipientNames: names,
    });
    await ctx.runMutation(internal.plans.clearCandidates, { planId: plan._id }); // wipe-on-pick

    // Re-enter the tool-loop so the agent continues from the folded recipients (never a dead hang).
    // Same turn lifecycle as sendCockpitMessage (CKPT-05): this is the cockpit's OTHER agent entry
    // point and a real 10-30s wait the user watches after clicking a contact chip — leaving it
    // untraced would freeze half the surface the phase exists to unfreeze.
    const turnId = crypto.randomUUID();
    await ctx.runMutation(internal.agentSteps.record, {
      tenantId: ctx.tenantId,
      threadId,
      turnId,
      stepKey: "thinking",
      tool: "thinking",
      startedAt: Date.now(),
    });
    // UAT-E: the re-invoke sees the transcript too — this is what lets the post-pick turn honor
    // everything already discussed. RESOLUTION_CONTINUE is synthetic and never saved, so there is
    // no current-turn duplication hazard here.
    const history = await fetchRecentHistory(ctx, threadId);
    let reply: string;
    try {
      const res = await ctx.runAction(internal.llm.runCockpitAgent, {
        tenantId: ctx.tenantId,
        threadId,
        planId: plan._id,
        text: RESOLUTION_CONTINUE,
        turnId,
        history,
        // UAT-F2 (STRUCTURAL): on the post-pick continue turn the panel picks are the ONLY
        // legitimate recipient source, so the recipient-mutating tools are withheld from the tool
        // set entirely — a fabricated setRecipients overwrite is impossible, not just discouraged.
        // sendCockpitMessage never passes this: normal turns keep the full set byte-identically.
        omitRecipientEdits: true,
      });
      reply = res.reply;
    } catch (e) {
      reply = "Something went wrong on my side — nothing was sent. Please try that again.";
      // AGNT-04: the OTHER agent entry point escalates an exhausted timeout the same way (§8).
      await notifyIfAgentTimeout(ctx, ctx.tenantId, e);
    } finally {
      // See sendCockpitMessage: `finally` is what covers the governed stop's early RETURN.
      await ctx.runMutation(internal.agentSteps.finish, {
        tenantId: ctx.tenantId,
        turnId,
        stepKey: "thinking",
        phase: "done",
        endedAt: Date.now(),
      });
    }
    await cockpitAgent.saveMessage(ctx, {
      threadId,
      message: { role: "assistant", content: reply },
      skipEmbeddings: true,
    });
    return { threadId };
  },
});

/**
 * Paginated thread-message list for the cockpit chat pane (feeds @convex-dev/agent/react
 * `useThreadMessages`). The agent thread is a message store, so the user turns + the agent's
 * saved replies are surfaced here. Tenant-guarded: a thread is only listable when the tenant owns
 * its (tenant-scoped) plans row — no cross-tenant read of another owner's conversation.
 * ponytail: static list (no `streamArgs`/`syncStreams`). Assistant-TOKEN streaming is NOT an
 * available upgrade — it is version-BLOCKED: @convex-dev/agent@0.6.4 peer-requires ai@^6, this repo
 * pins ai@7, and 0.6.4 is the LATEST published version, so there is nothing to bump to and §6
 * forbids bumping anyway. Revisit only if an ai@7-compatible agent release ships. (Note the
 * `new Agent(...)` cast at :27-34 depends on the model never being called here — agent streaming
 * requires the agent to MAKE the model call, violating that precondition.) The activity trace this
 * phase ships (agentSteps) is the tool-step half of progress; assistant-token streaming is the
 * blocked half.
 */
/**
 * Is this the agent component rejecting a threadId that is not one of ITS `v.id("threads")`?
 *
 * TWO wordings, and BOTH must match or the fix is a no-op where it counts. `convex-test` raises
 * `Validator error: Expected ID for table "threads", got \`…\``; the LIVE deployment raises
 * `ArgumentValidationError: Value does not match validator. Path: .threadId … Validator:
 * v.id("threads")`. Matching only the harness's wording is how the first attempt at this fix
 * shipped GREEN and still crashed the real cockpit — the test proved the harness, not production.
 * Any change here must keep `cockpitThreadDegrade.test.ts`'s verbatim-message assertions passing.
 *
 * ponytail: matched on the message because the host cannot normalize a COMPONENT's table id
 * (`ctx.db.normalizeId` only sees app tables) and every agent-side lookup takes the same
 * `v.id("threads")` that is doing the rejecting. Upgrade path: if @convex-dev/agent ever exposes a
 * non-throwing thread lookup, call it instead of catching.
 */
export function isNonAgentThreadIdError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const message = error.message;
  if (/Expected ID for table "threads"/.test(message)) return true;
  return /ArgumentValidationError/.test(message) && /Validator:\s*v\.id\("threads"\)/.test(message);
}

export const listThreadMessages = tenantQuery({
  args: { threadId: v.string(), paginationOpts: paginationOptsValidator },
  handler: async (ctx, { threadId, paginationOpts }) => {
    const owns = await ctx.db
      .query("plans")
      .withIndex("by_thread", (q) => q.eq("tenantId", ctx.tenantId).eq("threadId", threadId))
      .unique();
    if (!owns) return { page: [], isDone: true, continueCursor: "" };
    // The guard above answers AUTHORIZATION; it does not answer EXISTENCE. `plans.threadId` is a
    // plain string and is NOT guaranteed to name an agent-component thread: `smoke:seedCockpitPlan`
    // writes `smoke-attach-<uuid>`, and legacy rows predate the thread they point at. The component
    // validates `v.id("threads")` and THROWS on anything else — uncaught in the browser, that takes
    // the ENTIRE cockpit page down, and it is reachable from the `?thread=` URL parameter (found in
    // the 26-05 UAT). Owning a plan whose thread was never minted means exactly what owning no
    // thread means: there are no messages to show. Both must degrade to the SAME empty page.
    try {
      return await listMessages(ctx, components.agent, { threadId, paginationOpts });
    } catch (error) {
      // Deliberately NARROW: only the id-shape rejection degrades. Every other failure still
      // throws, so a real component fault is never masked by this catch.
      if (isNonAgentThreadIdError(error)) return { page: [], isDone: true, continueCursor: "" };
      throw error;
    }
  },
});

/**
 * Past chats for the header history menu — the tenant's cockpit threads, newest first.
 * `userId === tenantId` (set at createThread), so listing by it is inherently tenant-scoped —
 * no cross-tenant read of another owner's threads. Labels come from the thread `title` set on the
 * first send; a titleless legacy thread falls back to a stamp so the menu never shows a blank row.
 * ponytail: fixed most-recent slice (no pagination) — the dropdown shows recent history; wire a
 * cursor here if the menu ever needs infinite scroll.
 */
export const listThreads = tenantQuery({
  args: {},
  handler: async (ctx): Promise<Array<{ threadId: string; title: string; createdAt: number }>> => {
    const res = await ctx.runQuery(components.agent.threads.listThreadsByUserId, {
      userId: ctx.tenantId,
      order: "desc",
      // 10, not 30: this cross-component call is the expensive part and can breach Convex's 1s
      // query limit under memory pressure. The dropdown shows recent history — a shorter slice is
      // cheaper and the menu never needed 30 (FIX 1; the client boundary handles a throw either way).
      paginationOpts: { cursor: null, numItems: 10 },
    });
    return res.page.map((t) => ({
      threadId: t._id,
      title: (t.title ?? "").trim() || "Untitled chat",
      createdAt: t._creationTime,
    }));
  },
});

/**
 * Code-invoked PLAN write (NOT an LLM tool; the recipient/subject are structural, read from the
 * plan ROW by the proposePlan tool, never model-invented). Patches the drafted body + slots and
 * flips status → `proposed` so the PLAN card renders and awaits Approve.
 */
export const proposeEmailPlan = internalMutation({
  args: {
    planId: v.id("plans"),
    recipients: v.array(v.string()),
    mode: v.union(v.literal("individual"), v.literal("group")),
    subject: v.string(),
    body: v.string(),
  },
  handler: async (
    ctx,
    { planId, recipients, mode, subject, body },
  ): Promise<{ escalated: true } | undefined> => {
    const plan = await ctx.db.get(planId);
    // Skill-version attribution (08 IMPR-01): stamp the plan with the cockpit-agent version that
    // is drafting it, so a later feedback rating (copied plan→requests at executePlan) resolves to
    // the EXACT skill version that produced the response. Read the active row directly (this is a
    // mutation, same db access loadSkill uses) — but NEVER throw: a missing active row (shouldn't
    // happen post-seed) degrades to unattributable (undefined), it does not break a propose.
    const activeCockpit = await ctx.db
      .query("skills")
      .withIndex("by_name_status", (q) => q.eq("name", COCKPIT_AGENT_SKILL).eq("status", "active"))
      .unique();
    const skillVersion = activeCockpit?.version;
    // REVW-02 (cockpit): a RE-propose of an ALREADY-proposed plan is the live gate's "regenerate"
    // (the agent redrafting a proposed plan on a further user edit). Route it through the SAME
    // @pikar/core classifier the pipeline gate uses (07-03) so the "regenerate past the cap = an
    // unapproved send" fix lives in ONE place (CLAUDE.md §8). A FIRST propose (status not yet
    // "proposed") is never a redraft — it proposes unconditionally, leaving reviseCount at 0.
    if (plan?.status === "proposed") {
      const regenerateCount = plan.reviseCount ?? 0;
      const decision = classifyReviewDecision({ decision: "regenerate", regenerateCount });
      if (decision.action === "escalate") {
        // Past MAX_REGENERATE: FAIL CLOSED. Mark the plan escalated + notify retry.limit and do NOT
        // re-propose (bounded, never an unbounded redraft loop). executePlan then refuses it entirely.
        await ctx.db.patch(planId, { escalated: true });
        await ctx.runMutation(internal.notifications.notify, {
          tenantId: plan.tenantId,
          kind: "retry.limit",
          message: notificationMessage("retry.limit"),
        });
        return { escalated: true };
      }
      // Re-attribute to the THEN-active version (a redraft may run under a newer cockpit-agent).
      await ctx.db.patch(planId, {
        recipients,
        mode,
        subject,
        body,
        status: "proposed",
        reviseCount: regenerateCount + 1,
        skillVersion,
      });
      return undefined;
    }
    await ctx.db.patch(planId, {
      recipients,
      mode,
      subject,
      body,
      status: "proposed",
      skillVersion,
    });
    return undefined;
  },
});

/** The args frozen at Approve and carried to the fan-out (immediately OR via the scheduler). */
type FanoutArgs = {
  planId: Id<"plans">;
  tenantId: string;
  requestIds: Id<"requests">[];
  correlationIds: string[];
  planCid: string;
  /** Stale-callback token: a moved schedule changes sendAt, so the old callback must no-op. */
  scheduledFor?: number;
};

/**
 * The SOLE `workflow.start(deliverApprovedPlan)` call site (the grep-able zero-sends-before-Approve
 * invariant). A plain helper (not a Convex fn) so BOTH the immediate approve path and the scheduled
 * callback fire the SAME governed fan-out — a mutation ctx works identically for each. Starts the
 * workflow, then patches the plan → delivering with the pipeline correlationId + workflowId.
 */
async function startFanout(
  ctx: MutationCtx,
  { planId, tenantId, requestIds, correlationIds, planCid }: FanoutArgs,
): Promise<string> {
  const workflowId = await workflow.start(
    ctx,
    internal.deliverApprovedPlan.deliverApprovedPlan,
    { planId, tenantId, requestIds, correlationIds },
    {
      onComplete: internal.deadLetter.onPipelineComplete,
      context: { tenantId, correlationId: planCid, payload: { planId } }, // refs only (§4)
    },
  );
  await ctx.db.patch(planId, { status: "delivering", correlationId: planCid, workflowId });
  return workflowId;
}

/**
 * The scheduled callback (03.5 deferred send). At the requested moment, ctx.scheduler fires this
 * and it ONLY starts the frozen fan-out — the identical spine as an immediate approve (so a dead
 * token at fire → awaiting_reauth/DLQ/telemetry come for free). Internal-only; the args were
 * validated + frozen at Approve time inside executePlan.
 */
export const startScheduledDelivery = internalMutation({
  args: {
    planId: v.id("plans"),
    tenantId: v.string(),
    requestIds: v.array(v.id("requests")),
    correlationIds: v.array(v.string()),
    planCid: v.string(),
    scheduledFor: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<string | null> => {
    const plan = await ctx.db.get(args.planId);
    if (!plan || plan.tenantId !== args.tenantId || plan.status !== "scheduled") return null;
    // Current callbacks carry their exact scheduled instant. Legacy callbacks do not, so their
    // safe fallback is "the row is still due now". After a move the row's sendAt is in the future,
    // which also makes an already-running legacy callback lose the transaction race honestly.
    if (
      args.scheduledFor !== undefined
        ? plan.sendAt !== args.scheduledFor
        : plan.sendAt === undefined || plan.sendAt > Date.now()
    ) {
      return null;
    }
    return startFanout(ctx, args);
  },
});

/**
 * ACTN-01 — the dispatcher's own arm bind, and the reason it is separate from `armFor`'s table in
 * @pikar/core. The `workflow` case in executePlan below IS the gmail fan-out (seed requests →
 * startFanout → deliverApprovedPlan). A new ActionType that merely classified as `workflow` would
 * therefore inherit the EMAIL terminal silently — the exact structural property 12-05 bought by
 * leaving deliverApprovedPlan.ts untouched. This line fails to compile the day ACTION_TYPES grows,
 * forcing that author to visit the dispatcher and decide: an inline arm executes inline, a durable
 * arm starts its OWN workflow. The switch's `assertNever` covers a new ARM; this covers a new TYPE.
 */
const _ARM_TABLE = {
  email: "workflow",
  memo: "inline",
  calendar_event: "externalAction",
  // 20-07 MEDIA-01: the arm's SECOND occupant. Research Open Question 1, answered GENERALIZE — see
  // the `Arm` doc comment in @pikar/core/actionType.
  media: "externalAction",
  // 19-06 ACTN-05: an `inline` member needs NO `EXTERNAL_TARGETS` entry, and must not be given
  // one. `ExternalActionType` below is DERIVED from this table, so `crm_write` is excluded by
  // construction — adding a target for it would not compile.
  crm_write: "inline",
  // 2026-08-10: the arm's THIRD occupant, and an `inline` member for the same reason `crm_write` is
  // one — a figure update writes OUR OWN `financeInputs` rows, so there is no fetch and no
  // `EXTERNAL_TARGETS` entry to give it.
  finance_write: "inline",
} as const satisfies Record<ActionType, Arm>;

/** The action types whose arm is `externalAction`, DERIVED from the table above rather than
 *  hand-listed. That derivation is the whole point: mark a new type `"externalAction"` in
 *  `_ARM_TABLE` and `EXTERNAL_TARGETS` below is instantly incomplete — a COMPILE error, not an
 *  `undefined` target at runtime. A hand-written union would have accepted the new member silently. */
type ExternalActionType = {
  [K in ActionType]: (typeof _ARM_TABLE)[K] extends "externalAction" ? K : never;
}[ActionType];

/**
 * The `externalAction` arm's TARGETS — one THUNK per type, bound over the whole `retrier.run` call.
 *
 * Thunks rather than a `{ action, args, onComplete }` record because each action has its OWN
 * argument validator: `createEvent` takes `{planId, tenantId, correlationId}` and `submitBatch`
 * takes `{tenantId, batchId}`. A shared record would force TS to union the function reference and
 * the args independently, losing the correlation between them — and a shared ARG OBJECT would mean
 * passing `createEvent`'s `correlationId` to `submitBatch`, which its validator rejects. Each thunk
 * type-checks against its own target.
 *
 * ponytail: a table, not a framework. No strategy objects, no registry class.
 *
 * The terminals live in NON-node siblings (`calendarComplete` / `mediaComplete`) because a
 * "use node" file may hold only actions, so a completion MUTATION cannot sit beside its action.
 *
 * **ONE-LINE HAND-OFF TO PLAN 20-16:** today `media` starts the submit fan-out ONLY. When the reel
 * chain lands, 20-16 re-points this ONE thunk at the chain entry (which itself calls `submitBatch`
 * first). That is deliberately one line in one place — the arm shape does not move again, and
 * **20-16 is the only plan permitted to change it.**
 *
 * **20-16 EVALUATED THAT AND DECLINED IT. This target stays `submitBatch`, permanently.** The
 * landing plane already knows when a batch is complete — `mediaComplete.landResult` runs on every
 * arrival, holds the batch id, and runs inside a serializable mutation — so the render trigger is
 * four lines there (`maybeStartRender`) and the `pending → rendering` transition is its own
 * once-only guard. A chain entry action would be a SECOND mechanism doing what the landing plane
 * does for free, with its own failure modes and its own retry semantics. There is no chain.
 */
const EXTERNAL_TARGETS = {
  calendar_event: (ctx: MutationCtx, a: ExternalArgs) =>
    retrier.run(
      ctx,
      internal.calendar.createEvent,
      { planId: a.planId, tenantId: a.tenantId, correlationId: a.correlationId },
      { onComplete: internal.calendarComplete.onCreateComplete },
    ),
  media: (ctx: MutationCtx, a: ExternalArgs) =>
    retrier.run(
      ctx,
      internal.media.submitBatch,
      { tenantId: a.tenantId, batchId: a.batchId ?? "" },
      { onComplete: internal.mediaComplete.onSubmitComplete },
    ),
} satisfies Record<ExternalActionType, (ctx: MutationCtx, a: ExternalArgs) => Promise<unknown>>;

type ExternalArgs = {
  planId: Id<"plans">;
  tenantId: string;
  correlationId: string;
  /** Set by the media pre-step only — the reservation's batch id. */
  batchId?: string;
};

/**
 * The human approve gate (SC4). Idempotent CAS on plan.status: only the FIRST proposed→approved
 * transition seeds rows + starts the fan-out; a double-approve re-reads a non-proposed status
 * and no-ops (send once). Seeds ONE requests row per recipient (individual) or one comma-joined
 * row (group), each with its OWN server-minted correlationId (never client-supplied — mirrors
 * requests.submit) so per-recipient audit/telemetry/DLQ stay isolated. The SOLE starter of
 * deliverApprovedPlan (zero sends before Approve). With a future plan.sendAt it ARMS the scheduler
 * instead of starting (status → scheduled; nothing sends before fire, SC3). Explicit return type
 * dodges TS7022.
 */
export const executePlan = tenantMutation({
  args: { planId: v.id("plans") },
  handler: async (
    ctx,
    { planId },
  ): Promise<
    // 19-05: `withheld` names the suppressed addresses this approve DROPPED. A partial send is
    // still `ok: true` — the user must be told who was left out, not stopped from mailing the rest.
    | {
        ok: true;
        workflowId?: string;
        alreadyStarted?: true;
        scheduled?: true;
        withheld?: string[];
        // finance_write only: how many figures actually moved. `0` means every claim was already
        // superseded by a newer stored figure — the approval succeeded and changed NOTHING, and
        // both cards say "already up to date" rather than implying a write (review I5).
        applied?: number;
      }
    | {
        ok: false;
        reason:
          | "gmail_not_connected"
          | "send_time_too_far"
          | "review_escalated"
          // 20-07 MEDIA-01. Every one of these is a GOVERNED STOP that names a lever the user can
          // pull — rewrite a line, cut blocks, drop a tier, wait for tomorrow, or call the operator.
          // Plan 20-10's canvas renders them. Only BUGS throw; a refusal returns.
          | "no_deck"
          // 19-05 PIPE-01, the two CAN-SPAM stops. Both name a lever too: fill in the postal
          // address on /dashboard/profile, or pick recipients who have not unsubscribed.
          | "no_postal_address"
          | "all_recipients_suppressed"
          | ReserveRefusal
          // 2026-08-10: the finance_write arm's two refusals — `applyFinanceClaims` RETURNS them
          // rather than throwing (its own doc comment explains why), so this dispatcher's ONLY job
          // is to pass the reason through unmodified to the card. Only bugs throw.
          | FinanceApplyRefusal;
      }
  > => {
    const plan = await ctx.db.get(planId);
    if (!plan || plan.tenantId !== ctx.tenantId) throw new Error("plan not found"); // no cross-tenant approve
    // Idempotent no-op (double-approve): only "proposed" proceeds. Convex mutations are
    // serializable, so of two concurrent approves exactly one flips the status and seeds/starts.
    if (plan.status !== "proposed") return { ok: true, alreadyStarted: true };

    // REVW-02 fail-closed: a plan escalated past MAX_REGENERATE (proposeEmailPlan) can NEVER be
    // approved/sent — the cockpit mirror of the pipeline unapproved-send guard (07-03). Sibling early
    // guard BEFORE the CAS flip / seed / start, so an escalated plan seeds no rows, starts no workflow.
    if (plan.escalated) return { ok: false, reason: "review_escalated" };

    // ACTN-01: executePlan is the DISPATCHER. Each action type is one arm; adding a type without an
    // arm is a COMPILE error (`armFor`'s `satisfies Record<ActionType, Arm>` table in @pikar/core,
    // re-bound below), which is a stronger guarantee than any test. The arms are the EXISTING code
    // paths — this is a refactor, not new behaviour — and the selection sits exactly where 12-05's
    // `plan.kind === "memo"` if sat: after the CAS read and the escalated guard, BEFORE the mailbox
    // pre-check, because a memo must not require a connected Gmail.
    const armType = armFor(actionTypeOf(plan.kind));
    switch (armType) {
      case "inline": {
        // Approve means APPLY or SAVE, never send — one transactional write, so a workflow would
        // add rows and latency for nothing. Nothing below (seed requests → startFanout →
        // gmail.send) is reachable from here; the double-approve CAS above already makes it
        // exactly-once. The arm sits ABOVE the Gmail pre-check on purpose, so neither occupant
        // requires a connected mailbox.
        //
        // 19-06 ACTN-05: the arm's SECOND occupant. `applyCrmOperations` re-validates
        // `plan.crmOperations` through `parseCrmOperations` (the plan row is content plane and
        // could have been revised after staging) and performs every write through the SAME
        // helpers `contacts.ts`'s public mutations use — one copy of the identity/upsert rule.
        // A Convex mutation is serializable, so a throw part-way through discards the whole list:
        // approve-all-or-none with no saga and no compensation.
        if (actionTypeOf(plan.kind) === "crm_write") {
          await applyCrmOperations(ctx, plan.tenantId, plan.crmOperations);
          await ctx.db.patch(planId, { status: "done" });
          return { ok: true };
        }
        // 2026-08-10: the arm's THIRD occupant, and the same shape as `crm_write` above —
        // `applyFinanceClaims` re-validates every staged claim (the plan row is content plane) and
        // writes through the SAME `writeFigureRow` the ungated human edit uses, so there is one
        // copy of the store-routing rule. A throw part-way through discards the whole list.
        if (actionTypeOf(plan.kind) === "finance_write") {
          // tenantId off the APPROVED PLAN ROW, never model-supplied.
          const applied = await applyFinanceClaims(
            ctx,
            plan.tenantId,
            plan.financeClaims as FigureClaim[],
          );
          // A GOVERNED STOP, not a bug: the plan stays `proposed` (no patch below), so the human
          // sees the refusal on the card and can re-approve once the lever is pulled. Nothing was
          // written — `applyFinanceClaims` validates the whole claim list before writing any of it.
          if (!applied.ok) return { ok: false, reason: applied.reason };
          await ctx.db.patch(planId, { status: "done" });
          // The COUNT, not a boolean: `applied: 0` is a real outcome (every claim older than what
          // is stored), and a card that says "approved" over zero writes is the same dishonesty
          // the figure tiles exist to avoid.
          return { ok: true, applied: applied.applied };
        }
        // memo (12-05 BEVL-02): Approve means SAVE. See evaluations.ts.
        await ctx.db.patch(planId, { status: "done" });
        await persistNextStepMemo(ctx, plan);
        return { ok: true };
      }
      case "externalAction": {
        // ACTN-02. ONE governed external side effect behind the human Approve gate. NOT `inline`
        // (a Convex mutation cannot fetch, and this declaration is PINNED as a tenantMutation by
        // dispatchGuard.test.ts:95); NOT `workflow` (that case IS the gmail fan-out below — see the
        // _ARM_TABLE comment). The CAS above already made this exactly-once; the client-supplied
        // event id makes the RETRY exactly-once too (a 409 duplicate MEANS success).
        //
        // deliverApprovedPlan.ts stays byte-unchanged: it is the workflow-backed EMAIL entry point,
        // not a universal dispatcher. Routing Calendar through it would make the gmail fan-out
        // reachable from a calendar action.
        //
        // 20-07: the body is now a TABLE over the arm's occupants plus a per-type PRE-STEP. The
        // calendar path below is the same lines, MOVED not rewritten — `cockpit.test.ts` asserts it
        // byte-for-byte in behaviour, including that no media window moves.
        //
        // **D2 IS NOT WEAKENED BY THE MEDIA OCCUPANT.** The trigger here is a HUMAN clicking Approve
        // on a plan row. No dispatched specialist can reach it: `SPECIALIST_TOOLS` is
        // `["searchVault"]` and there is no code path from a dispatched specialist to a fal POST, a
        // TTS submit or a sandbox render. Plan-gated by construction is STRUCTURAL, and plan 20-08's
        // static scan proves it.
        const externalType = actionTypeOf(plan.kind) as ExternalActionType;
        let batchId: string | undefined;

        if (externalType === "media") {
          // THE MEDIA PRE-STEP. It runs BEFORE the CAS patch, so a refused reel leaves the plan at
          // `proposed` with zero mediaJobs rows, no renderStatus and nothing scheduled.
          //
          // **The reservation is in THIS mutation, which is ONE serializable transaction with the
          // `proposed → approved` CAS.** That is what makes "approve once, reserve once" true
          // without a second idempotency mechanism — and it is why plan 20-04 exposed
          // `reserveJobInner` as a plain async function: a Convex mutation cannot `runMutation`.
          const shots = plan.shots ?? [];
          // Absent, empty, or carrying a shot type the price table does not know — all three mean
          // there is nothing safe to reserve. `persistStoryboard` (20-08) parses through
          // `parseBlockDeck`, which already enforces SHOT_TYPES, so this is a boundary check rather
          // than an expected path; a money gate does not assume its writer was correct.
          if (
            shots.length === 0 ||
            plan.clipSeconds === undefined ||
            !shots.every((s) => (SHOT_TYPES as readonly string[]).includes(s.type))
          ) {
            return { ok: false, reason: "no_deck" };
          }
          const reserved = await reserveJobInner(ctx, {
            tenantId: ctx.tenantId,
            planId,
            blocks: shots.map((s) => ({ ...s, type: s.type as ShotType })),
            clipSeconds: plan.clipSeconds,
            // ponytail: PINNED true until the canvas (20-09) offers a toggle. Captions are part of
            // the D8 deliverable, and the fail-closed direction is over-reserving: an unused STT
            // line costs $0.008, while an unreserved one that IS used is spend outside the rail.
            withCaptions: true,
          });
          if (!reserved.ok) return { ok: false, reason: reserved.reason }; // governed stop, never a throw
          batchId = reserved.batchId;
        }

        await ctx.db.patch(planId, {
          status: "approved",
          // A reel that has been PAID FOR but not yet rendered is a state the canvas must be able to
          // name. Set in the same patch as `approved` so there is no window where it is neither.
          ...(externalType === "media" ? { renderStatus: "pending" as const } : {}),
        });
        const correlationId = crypto.randomUUID(); // server-minted, never client-supplied
        const runId = await EXTERNAL_TARGETS[externalType](ctx, {
          planId,
          tenantId: ctx.tenantId,
          correlationId,
          batchId,
        });
        await ctx.db.patch(planId, {
          status: "delivering",
          correlationId,
          // `calendarRunId` stays CALENDAR's column — `calendarComplete` resolves through
          // `by_calendar_run` and would happily match a media run written into it.
          ...(externalType === "media"
            ? { mediaRunId: String(runId) }
            : { calendarRunId: String(runId) }),
        });
        return { ok: true };
      }
      case "workflow":
        break; // → the existing pre-check → CAS flip → seed requests → startFanout block below
      default:
        return assertNever(armType);
    }

    // No mailbox → no send (design: stop before any delivery). Reuse the existing token reader;
    // the row is checked for existence ONLY and never logged (crown jewels — CLAUDE.md §4).
    const tokens = await ctx.runQuery(internal.gmailAuth.getTokens, { tenantId: ctx.tenantId });
    if (!tokens) return { ok: false, reason: "gmail_not_connected" };

    // 19-05 SC#6 (CAN-SPAM): every product email must carry the tenant's physical postal address,
    // and `gmail.send` refuses to build a footer without one. Refuse HERE — at the human gate,
    // where the missing field is nameable and fixable — instead of letting every recipient's send
    // throw at delivery time. The sibling of the `gmail_not_connected` fail-before-mutate guard.
    const profile = await ctx.db
      .query("tenantProfiles")
      .withIndex("by_tenant", (q) => q.eq("tenantId", ctx.tenantId))
      .unique();
    if ((profile?.postalAddress ?? "").trim() === "")
      return { ok: false, reason: "no_postal_address" };

    // Far-future cap (SCHD-01): the AUTHORITATIVE gate. A beyond-horizon sendAt would fire past the
    // Gmail token's life (design/scheduled-send.md) → dead token. Refuse HERE — the one place the
    // schedule-vs-immediate decision is made — so every write path (NL setSendTime, picker
    // setPlanSendTime, Plan 05 reschedule) is covered before any row seeds or the scheduler arms
    // (mirrors the gmail_not_connected fail-before-mutate guard; the < now guard at :422 only ever
    // sees an in-window sendAt because of this).
    if (plan.sendAt !== undefined && plan.sendAt > Date.now() + SEND_TIME_HORIZON_MS)
      return { ok: false, reason: "send_time_too_far" };

    // 19-05 SC#5, THE PER-ADDRESS DROP — and it has to be HERE, before the join below:
    // `mode === "group"` collapses every recipient into ONE comma-joined string, after which a
    // suppressed member is baked into that string and cannot be removed by anything downstream
    // (`isSuppressed` can only refuse the WHOLE row — see the ponytail note in contacts.ts).
    //
    // It reads `suppressions` ONLY (never `contacts`), which is what makes a contacts bug unable
    // to un-suppress anyone. One indexed read per address, no scan.
    //
    // EVERY refusal above and below runs BEFORE the CAS patch. A refusal after it would leave the
    // plan `approved` with zero `requests` rows and no workflow — a half-approved state nothing
    // can resume (the 20-07 lesson).
    const allRecipients = plan.recipients ?? [];
    const withheld = await ctx.runQuery(internal.contacts.suppressedAmong, {
      tenantId: ctx.tenantId,
      addresses: allRecipients,
    });
    const suppressed = new Set(withheld);
    const recipients = allRecipients.filter((r) => !suppressed.has(normalizeAddress(r)));
    if (recipients.length === 0) return { ok: false, reason: "all_recipients_suppressed" };

    // CAS: flip first. A second concurrent tx re-reads "approved" above and no-ops.
    await ctx.db.patch(planId, { status: "approved" });

    const mode = plan.mode ?? "individual";
    const subject = plan.subject ?? "";
    const body = plan.body ?? "";
    const targets = mode === "group" ? [recipients.join(", ")] : recipients;

    // Phase 26 exact-progress baseline. These counters describe frozen delivery work units (one
    // request row per target), not raw addresses. Their presence plus counterComplete=true is what
    // lets Approvals distinguish new exact rows from bounded legacy fallback.
    await ctx.db.patch(planId, {
      recipientTotal: targets.length,
      queuedCount: targets.length,
      sentCount: 0,
      failedCount: 0,
      counterComplete: true,
      // SC#5's user-facing half, DURABLY (phase-19 UAT step 9b). The `withheld` array is also
      // returned below, but that return value is consumed by a component this very transition
      // unmounts — the row is the only copy a human can still read afterwards. Written in the
      // SAME patch as the counters it explains, and omitted entirely when nobody was dropped.
      ...(withheld.length > 0 ? { withheldRecipients: withheld } : {}),
    });

    // Materialize the plan's generated attachments (inline refs on the plan row → the pre-approval
    // source of truth) into `attachments` table rows ONCE, then share their ids across EVERY
    // recipient's request (this slice sends one document set to all — no per-recipient duplication,
    // no extra storage writes; storage is immutable per id so one byte set is safe to fan out).
    // requestId is left unset: a shared row belongs to no single request. gmail.send reads each
    // request's attachmentRefs → these rows → the bytes (Plan 03, unchanged).
    const attachmentRefs: Id<"attachments">[] = [];
    for (const a of plan.attachments ?? []) {
      attachmentRefs.push(
        await ctx.db.insert("attachments", {
          tenantId: ctx.tenantId,
          storageId: a.storageId,
          filename: a.filename,
          mimeType: a.mimeType,
          size: a.size,
        }),
      );
    }

    const requestIds: Id<"requests">[] = [];
    const correlationIds: string[] = [];
    for (const recipient of targets) {
      const correlationId = crypto.randomUUID(); // server-minted, per row
      const requestId = await ctx.db.insert("requests", {
        tenantId: ctx.tenantId,
        correlationId,
        goal: subject, // gmail.getForDelivery reads subject := goal ... (SHARED subject)
        recipient,
        // ... and body := editedBody ?? draft. Per-recipient personalization (CKPT-03): the
        // tailored body if this recipient has one, else the shared body. Keyed by the RAW
        // `recipient` value the loop iterates from plan.recipients — the SAME string
        // personalizeRecipient wrote (Wave 2), so the lookup can't miss. An orphaned key
        // (address no longer in recipients) is simply never read (harmless). Group mode's
        // comma-joined `recipient` misses the address key and falls back to the shared body.
        draft: (plan.recipientBodies ?? {})[recipient] ?? body,
        status: "approved",
        attachmentRefs, // SAME shared ids for every recipient (one generated document set)
        // 03.11 RPLY-01: carry the plan's reply-threading anchor onto every seeded row (Pitfall 4 —
        // a field not copied here never reaches getForDelivery → send, so the reply silently posts
        // un-threaded). plan.replyThreadId is the GMAIL thread (plan.threadId is the agent thread that
        // renders cards — a different id space), so it maps to the request's plain `threadId`. All
        // optional → a non-reply plan copies undefined and the row carries none (unchanged path).
        threadId: plan.replyThreadId,
        inReplyTo: plan.inReplyTo,
        references: plan.references,
        // Skill-version attribution (08 IMPR-01): carry the plan's cockpit-agent version onto every
        // seeded row (set at propose) so a feedback rating on this delivered response resolves to the
        // exact version that produced it. Optional → a plan with no skillVersion copies none.
        skillVersion: plan.skillVersion,
        planId,
        createdAt: Date.now(),
      });
      requestIds.push(requestId);
      correlationIds.push(correlationId);
    }

    const planCid = crypto.randomUUID();
    const args: FanoutArgs = {
      planId,
      tenantId: ctx.tenantId,
      requestIds,
      correlationIds,
      planCid,
    };

    // Deferred send (SC3): a future sendAt ARMS the scheduler and returns — the rows are frozen
    // (seeded above) but nothing starts. sendAt unset OR already past ⇒ start immediately (today's
    // behavior, RESEARCH Open Question 2). At fire, startScheduledDelivery runs the SAME startFanout.
    if (plan.sendAt !== undefined && plan.sendAt > Date.now()) {
      args.scheduledFor = plan.sendAt;
      const scheduledFunctionId = await ctx.scheduler.runAt(
        plan.sendAt,
        internal.cockpit.startScheduledDelivery,
        args,
      );
      await ctx.db.patch(planId, { status: "scheduled", scheduledFunctionId });
      return { ok: true, scheduled: true, ...(withheld.length > 0 ? { withheld } : {}) };
    }

    const workflowId = await startFanout(ctx, args);
    return { ok: true, workflowId, ...(withheld.length > 0 ? { withheld } : {}) };
  },
});

/**
 * Halt a scheduled send before it fires (SC4). CAS-guarded on status==="scheduled": a non-scheduled
 * plan (already fired, canceled, or never scheduled) no-ops with alreadyResolved — this is the guard
 * that keeps ctx.scheduler.cancel from throwing on an already-committed id (RESEARCH Pitfall 1). On a
 * live scheduled plan: cancel the armed function, flip → canceled, and write ONE refs-only
 * plan.canceled audit (payload = {planId} ONLY — never subject/body/recipients; audit is insert-only
 * per CLAUDE.md §3/§4). Tenant-guarded (no cross-tenant cancel). Idempotent.
 */
export const cancelScheduledPlan = tenantMutation({
  args: { planId: v.id("plans") },
  handler: async (
    ctx,
    { planId },
  ): Promise<{ ok: true; canceled?: true; alreadyResolved?: true }> => {
    const plan = await ctx.db.get(planId);
    if (!plan || plan.tenantId !== ctx.tenantId) throw new Error("plan not found"); // no cross-tenant cancel
    if (plan.status !== "scheduled") return { ok: true, alreadyResolved: true }; // CAS: cancel() would throw on a fired id
    if (plan.scheduledFunctionId) await ctx.scheduler.cancel(plan.scheduledFunctionId);
    await ctx.db.patch(planId, {
      status: "canceled",
      cancelKind: "scheduled_cancel",
      canceledAt: Date.now(),
      scheduledFunctionId: undefined,
    });
    await ctx.runMutation(internal.audit.log, {
      tenantId: ctx.tenantId,
      correlationId: plan.correlationId ?? String(planId),
      eventType: "plan.canceled",
      actor: ctx.tenantId,
      payload: { planId }, // refs only (§4) — never subject/body/recipients/sendAt
    });
    return { ok: true, canceled: true };
  },
});

/**
 * Discard an awaiting approval. This is the only proposed→canceled transition and its provenance
 * is permanent: reschedulePlan explicitly excludes `cancelKind:"discarded"`. A stale scheduler
 * handle is canceled defensively before it is cleared, although a valid proposed row has none.
 */
export const discardPlan = tenantMutation({
  args: { planId: v.id("plans") },
  handler: async (
    ctx,
    { planId },
  ): Promise<{ ok: true; discarded?: true; alreadyResolved?: true }> => {
    const plan = await ctx.db.get(planId);
    if (!plan || plan.tenantId !== ctx.tenantId) throw new Error("plan not found");
    if (plan.status !== "proposed") return { ok: true, alreadyResolved: true };

    if (plan.scheduledFunctionId) await ctx.scheduler.cancel(plan.scheduledFunctionId);
    await ctx.db.patch(planId, {
      status: "canceled",
      cancelKind: "discarded",
      canceledAt: Date.now(),
      scheduledFunctionId: undefined,
    });
    await ctx.runMutation(internal.audit.log, {
      tenantId: ctx.tenantId,
      correlationId: plan.correlationId ?? String(planId),
      eventType: "plan.discarded",
      actor: ctx.tenantId,
      payload: { planId, kind: "discarded" },
    });
    return { ok: true, discarded: true };
  },
});

/**
 * Atomically replace the callback for the current live schedule. Both this mutation and the
 * callback read/write the plan row, so Convex serializability chooses one winner: if the callback
 * wins the caller sees `already_fired`; if this mutation wins the old callback is canceled and its
 * `scheduledFor` token can no longer match. Replaying the same instant is a no-write success.
 */
export const moveScheduledPlan = tenantMutation({
  args: { planId: v.id("plans"), sendAt: v.number() },
  handler: async (
    ctx,
    { planId, sendAt },
  ): Promise<{ result: "moved" | "already_fired" | "not_scheduled" }> => {
    const plan = await ctx.db.get(planId);
    if (!plan || plan.tenantId !== ctx.tenantId) throw new Error("plan not found");
    if (plan.status === "delivering" || plan.status === "done") {
      return { result: "already_fired" };
    }
    if (plan.status !== "scheduled" || !plan.scheduledFunctionId) {
      return { result: "not_scheduled" };
    }
    const now = Date.now();
    if (sendAt <= now || sendAt > now + SEND_TIME_HORIZON_MS) {
      throw new Error("move requires a future time within the send horizon");
    }
    if (plan.sendAt === sendAt) return { result: "moved" };

    const requests = await ctx.db
      .query("requests")
      .withIndex("by_plan", (q) => q.eq("planId", planId))
      .collect();
    if (requests.length === 0) return { result: "not_scheduled" };

    await ctx.scheduler.cancel(plan.scheduledFunctionId);
    const planCid = crypto.randomUUID();
    const scheduledFunctionId = await ctx.scheduler.runAt(
      sendAt,
      internal.cockpit.startScheduledDelivery,
      {
        planId,
        tenantId: ctx.tenantId,
        requestIds: requests.map((request) => request._id),
        correlationIds: requests.map((request) => request.correlationId),
        planCid,
        scheduledFor: sendAt,
      },
    );
    await ctx.db.patch(planId, { sendAt, scheduledFunctionId });
    await ctx.runMutation(internal.audit.log, {
      tenantId: ctx.tenantId,
      correlationId: plan.correlationId ?? String(planId),
      eventType: "plan.rescheduled",
      actor: ctx.tenantId,
      payload: { planId },
    });
    return { result: "moved" };
  },
});

/**
 * Re-open a canceled plan for a fresh scheduled send (SCHD-01 refinement). `canceled` is terminal
 * UNLESS the user explicitly re-schedules: this is the ONLY canceled→proposed transition. It requires
 * a FUTURE plan.sendAt (else it re-asks — a past/absent time never silently un-cancels into an
 * immediate send, the halt-control guarantee at the trust boundary), deletes the plan's orphaned
 * requests rows (all "approved", never fanned out — the cancel happened BEFORE startScheduledDelivery,
 * so reportForPlan would double-count without this cleanup), flips → "proposed", and writes ONE
 * refs-only plan.rescheduled audit ({planId} ONLY — §3 insert-only, §4 refs-only). It does NOT arm the
 * scheduler: the re-approve routes back through the EXISTING executePlan scheduled branch (its seed
 * loop re-freezes content + its runAt is the single arm site — no new call site). Tenant-guarded;
 * idempotent (a non-canceled plan no-ops). Explicit return type dodges TS7022.
 */
export const reschedulePlan = tenantMutation({
  args: { planId: v.id("plans") },
  handler: async (
    ctx,
    { planId },
  ): Promise<
    | { ok: true; rescheduled?: true; alreadyResolved?: true }
    | { ok: false; reason: "needs_future_time" }
  > => {
    const plan = await ctx.db.get(planId);
    if (!plan || plan.tenantId !== ctx.tenantId) throw new Error("plan not found"); // no cross-tenant reschedule
    if (plan.status !== "canceled" || plan.cancelKind === "discarded") {
      return { ok: true, alreadyResolved: true };
    }
    // The re-ask: a reschedule OUT of canceled requires a future time — write NOTHING on a past/absent
    // sendAt (no orphan delete, no status flip, no audit) so a stale time can never drive a silent send.
    if (plan.sendAt === undefined || plan.sendAt <= Date.now()) {
      return { ok: false, reason: "needs_future_time" };
    }
    // Delete the orphaned requests rows (all never-fanned-out — canceled fired before delivery) so the
    // re-approve's fresh fan-out is the only set reportForPlan counts.
    const orphans = await ctx.db
      .query("requests")
      .withIndex("by_plan", (q) => q.eq("planId", planId))
      .collect();
    for (const r of orphans) await ctx.db.delete(r._id);
    // Flip to "proposed" — the EXISTING executePlan re-approve path re-seeds + re-arms (no new arm site).
    await ctx.db.patch(planId, {
      status: "proposed",
      cancelKind: undefined,
      canceledAt: undefined,
      scheduledFunctionId: undefined,
    });
    await ctx.runMutation(internal.audit.log, {
      tenantId: ctx.tenantId,
      correlationId: plan.correlationId ?? String(planId),
      eventType: "plan.rescheduled",
      actor: ctx.tenantId,
      payload: { planId }, // refs only (§4) — never subject/body/recipients/sendAt
    });
    return { ok: true, rescheduled: true };
  },
});
