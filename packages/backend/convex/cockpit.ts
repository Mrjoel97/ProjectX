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
import { applyRecipientEdit } from "@pikar/core";
import { DEFAULT_MODEL } from "@pikar/cost";
import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import { api, components, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { internalMutation } from "./_generated/server";
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
  args: { threadId: v.optional(v.string()), text: v.string() },
  handler: async (ctx, { threadId, text }): Promise<{ threadId: string }> => {
    // 1. Ensure a thread + its single plans row (first turn creates both; userId = tenantId).
    let tid = threadId;
    if (!tid) {
      const created = await cockpitAgent.createThread(ctx, { userId: ctx.tenantId });
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
    let reply: string;
    try {
      const res = await ctx.runAction(internal.llm.runCockpitAgent, {
        tenantId: ctx.tenantId,
        threadId: tid,
        planId: plan._id,
        text,
      });
      reply = res.reply;
    } catch {
      reply = "Something went wrong on my side — nothing was sent. Please try that again.";
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
    let reply: string;
    try {
      const res = await ctx.runAction(internal.llm.runCockpitAgent, {
        tenantId: ctx.tenantId,
        threadId,
        planId: plan._id,
        text: RESOLUTION_CONTINUE,
      });
      reply = res.reply;
    } catch {
      reply = "Something went wrong on my side — nothing was sent. Please try that again.";
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
 * ponytail: static list (no `streamArgs`/`syncStreams`) — token streaming is a later upgrade
 * via `useUIMessages`/`vStreamArgs` (research §4).
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

/**
 * The human approve gate (SC4). Idempotent CAS on plan.status: only the FIRST proposed→approved
 * transition seeds rows + starts the fan-out; a double-approve re-reads a non-proposed status
 * and no-ops (send once). Seeds ONE requests row per recipient (individual) or one comma-joined
 * row (group), each with its OWN server-minted correlationId (never client-supplied — mirrors
 * requests.submit) so per-recipient audit/telemetry/DLQ stay isolated. The SOLE starter of
 * deliverApprovedPlan (zero sends before Approve). Explicit return type dodges TS7022.
 */
export const executePlan = tenantMutation({
  args: { planId: v.id("plans") },
  handler: async (
    ctx,
    { planId },
  ): Promise<{ ok: true; workflowId?: string; alreadyStarted?: true } | { ok: false; reason: "gmail_not_connected" }> => {
    const plan = await ctx.db.get(planId);
    if (!plan || plan.tenantId !== ctx.tenantId) throw new Error("plan not found"); // no cross-tenant approve
    // Idempotent no-op (double-approve): only "proposed" proceeds. Convex mutations are
    // serializable, so of two concurrent approves exactly one flips the status and seeds/starts.
    if (plan.status !== "proposed") return { ok: true, alreadyStarted: true };

    // No mailbox → no send (design: stop before any delivery). Reuse the existing token reader;
    // the row is checked for existence ONLY and never logged (crown jewels — CLAUDE.md §4).
    const tokens = await ctx.runQuery(internal.gmailAuth.getTokens, { tenantId: ctx.tenantId });
    if (!tokens) return { ok: false, reason: "gmail_not_connected" };

    // CAS: flip first. A second concurrent tx re-reads "approved" above and no-ops.
    await ctx.db.patch(planId, { status: "approved" });

    const recipients = plan.recipients ?? [];
    const mode = plan.mode ?? "individual";
    const subject = plan.subject ?? "";
    const body = plan.body ?? "";
    const targets = mode === "group" ? [recipients.join(", ")] : recipients;

    const requestIds: Id<"requests">[] = [];
    const correlationIds: string[] = [];
    for (const recipient of targets) {
      const correlationId = crypto.randomUUID(); // server-minted, per row
      const requestId = await ctx.db.insert("requests", {
        tenantId: ctx.tenantId,
        correlationId,
        goal: subject, // gmail.getForDelivery reads subject := goal ...
        recipient,
        draft: body, // ... and body := editedBody ?? draft
        status: "approved",
        attachmentRefs: [],
        planId,
        createdAt: Date.now(),
      });
      requestIds.push(requestId);
      correlationIds.push(correlationId);
    }

    const planCid = crypto.randomUUID();
    const workflowId = await workflow.start(
      ctx,
      internal.deliverApprovedPlan.deliverApprovedPlan,
      { planId, tenantId: ctx.tenantId, requestIds, correlationIds },
      {
        onComplete: internal.deadLetter.onPipelineComplete,
        context: { tenantId: ctx.tenantId, correlationId: planCid, payload: { planId } }, // refs only (§4)
      },
    );
    await ctx.db.patch(planId, { status: "delivering", correlationId: planCid, workflowId });
    return { ok: true, workflowId };
  },
});
