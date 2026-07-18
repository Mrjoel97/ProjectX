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
import { applyRecipientEdit, SEND_TIME_HORIZON_MS } from "@pikar/core";
import { DEFAULT_MODEL } from "@pikar/cost";
import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import { api, components, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { internalMutation, type MutationCtx } from "./_generated/server";
import { workflow } from "./index";
import { tenantAction, tenantMutation, tenantQuery } from "./lib/functions";

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

    // 2. Persist the user's turn (the agent thread is a message store — DECISION #2 retired; the
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
      });
      reply = res.reply;
    } catch {
      reply = "Something went wrong on my side — nothing was sent. Please try that again.";
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
// tool-loop after the recipients are folded. buildAgentContext already shows the model the updated
// index/label recipients (address-free, §2-D), so this only signals "the pick happened, continue".
const RESOLUTION_CONTINUE =
  "I've picked the recipients from the contact list. Please continue composing the email.";

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
    await ctx.runMutation(internal.plans.patchPlan, {
      planId: plan._id,
      recipients: edit.recipients,
      greetingName: picks[0]?.displayName, // FIRST pick names the greeting (undefined is dropped)
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
    let reply: string;
    try {
      const res = await ctx.runAction(internal.llm.runCockpitAgent, {
        tenantId: ctx.tenantId,
        threadId,
        planId: plan._id,
        text: RESOLUTION_CONTINUE,
        turnId,
      });
      reply = res.reply;
    } catch {
      reply = "Something went wrong on my side — nothing was sent. Please try that again.";
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
export const listThreadMessages = tenantQuery({
  args: { threadId: v.string(), paginationOpts: paginationOptsValidator },
  handler: async (ctx, { threadId, paginationOpts }) => {
    const owns = await ctx.db
      .query("plans")
      .withIndex("by_thread", (q) => q.eq("tenantId", ctx.tenantId).eq("threadId", threadId))
      .unique();
    if (!owns) return { page: [], isDone: true, continueCursor: "" };
    return await listMessages(ctx, components.agent, { threadId, paginationOpts });
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
  handler: async (ctx, { planId, recipients, mode, subject, body }) => {
    await ctx.db.patch(planId, { recipients, mode, subject, body, status: "proposed" });
  },
});

/** The args frozen at Approve and carried to the fan-out (immediately OR via the scheduler). */
type FanoutArgs = {
  planId: Id<"plans">;
  tenantId: string;
  requestIds: Id<"requests">[];
  correlationIds: string[];
  planCid: string;
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
  },
  handler: (ctx, args) => startFanout(ctx, args),
});

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
    | { ok: true; workflowId?: string; alreadyStarted?: true; scheduled?: true }
    | { ok: false; reason: "gmail_not_connected" | "send_time_too_far" }
  > => {
    const plan = await ctx.db.get(planId);
    if (!plan || plan.tenantId !== ctx.tenantId) throw new Error("plan not found"); // no cross-tenant approve
    // Idempotent no-op (double-approve): only "proposed" proceeds. Convex mutations are
    // serializable, so of two concurrent approves exactly one flips the status and seeds/starts.
    if (plan.status !== "proposed") return { ok: true, alreadyStarted: true };

    // No mailbox → no send (design: stop before any delivery). Reuse the existing token reader;
    // the row is checked for existence ONLY and never logged (crown jewels — CLAUDE.md §4).
    const tokens = await ctx.runQuery(internal.gmailAuth.getTokens, { tenantId: ctx.tenantId });
    if (!tokens) return { ok: false, reason: "gmail_not_connected" };

    // Far-future cap (SCHD-01): the AUTHORITATIVE gate. A beyond-horizon sendAt would fire past the
    // Gmail token's life (design/scheduled-send.md) → dead token. Refuse HERE — the one place the
    // schedule-vs-immediate decision is made — so every write path (NL setSendTime, picker
    // setPlanSendTime, Plan 05 reschedule) is covered before any row seeds or the scheduler arms
    // (mirrors the gmail_not_connected fail-before-mutate guard; the < now guard at :422 only ever
    // sees an in-window sendAt because of this).
    if (plan.sendAt !== undefined && plan.sendAt > Date.now() + SEND_TIME_HORIZON_MS)
      return { ok: false, reason: "send_time_too_far" };

    // CAS: flip first. A second concurrent tx re-reads "approved" above and no-ops.
    await ctx.db.patch(planId, { status: "approved" });

    const recipients = plan.recipients ?? [];
    const mode = plan.mode ?? "individual";
    const subject = plan.subject ?? "";
    const body = plan.body ?? "";
    const targets = mode === "group" ? [recipients.join(", ")] : recipients;

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
        planId,
        createdAt: Date.now(),
      });
      requestIds.push(requestId);
      correlationIds.push(correlationId);
    }

    const planCid = crypto.randomUUID();
    const args: FanoutArgs = { planId, tenantId: ctx.tenantId, requestIds, correlationIds, planCid };

    // Deferred send (SC3): a future sendAt ARMS the scheduler and returns — the rows are frozen
    // (seeded above) but nothing starts. sendAt unset OR already past ⇒ start immediately (today's
    // behavior, RESEARCH Open Question 2). At fire, startScheduledDelivery runs the SAME startFanout.
    if (plan.sendAt !== undefined && plan.sendAt > Date.now()) {
      const scheduledFunctionId = await ctx.scheduler.runAt(
        plan.sendAt,
        internal.cockpit.startScheduledDelivery,
        args,
      );
      await ctx.db.patch(planId, { status: "scheduled", scheduledFunctionId });
      return { ok: true, scheduled: true };
    }

    const workflowId = await startFanout(ctx, args);
    return { ok: true, workflowId };
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
    await ctx.db.patch(planId, { status: "canceled" });
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
    if (plan.status !== "canceled") return { ok: true, alreadyResolved: true }; // canceled stays terminal unless re-scheduled; double-click no-ops
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
    await ctx.db.patch(planId, { status: "proposed" });
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
