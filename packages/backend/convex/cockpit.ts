// Cockpit orchestration seam (SC2/SC3/SC4 + DECISION #2). Wires the pure `emailIntent`
// brain (plan 03) to the `plans` content plane + registry draft (plan 06) and the fan-out
// workflow (plan 04). This is the FIRST `new Agent(...)` in the codebase.
//
// DETERMINISTIC CONTROL (DECISION #2): the agent thread is a message store only; the LLM is
// invoked ONLY for the body draft (internal.llm.draftCockpit). Question selection is the pure
// `emailIntent` module — nothing is ever proposed on an assumption (an invalid recipient
// literally cannot enter `state.recipients`; it bounces in `rejected` and is re-asked).
//
// executePlan is a HUMAN gate (a tenantMutation, NEVER an LLM tool): a compare-and-set on
// plan.status (proposed→approved) makes a double-approve send once and guarantees zero sends
// before Approve. It is the SOLE `workflow.start(deliverApprovedPlan)` call site (the
// grep-able zero-sends-before-Approve invariant, RESEARCH-delivery §5).
import { Agent, listMessages } from "@convex-dev/agent";
import {
  type Answer,
  type EmailIntentState,
  type NextQuestion,
  applyAnswer,
  nextQuestion,
} from "@pikar/core";
import { DEFAULT_MODEL } from "@pikar/cost";
import { scanText } from "@pikar/pii";
import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import { api, components, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { internalMutation } from "./_generated/server";
import { workflow } from "./index";
import { contentHash } from "./lib/hash";
import { tenantAction, tenantMutation, tenantQuery } from "./lib/functions";

// No hardcoded `instructions` prompt (CLAUDE.md §5): the ONLY LLM call is the body draft, which
// loads the email-drafter body from the skills registry (internal.llm.draftCockpit). Deterministic
// control (DECISION #2) means the agent NEVER runs generateText/streamText — it is a pure message
// store — so its `languageModel` is inert.
// ponytail: AI SDK v6/v7 type mismatch — @convex-dev/agent@0.6.4 demands a v6 LanguageModel; the
// repo pins ai@7 and drives models via the gateway string (llm.ts DEFAULT_MODEL). Since the model
// is never called here, cast the config past the version guard. Drop the cast when agent ships
// v7-compatible types (CLAUDE.md §6 — do not bump to "fix" this).
const cockpitAgent = new Agent(components.agent, {
  name: "email-cockpit",
  languageModel: DEFAULT_MODEL,
} as unknown as ConstructorParameters<typeof Agent>[1]);

// ── Pure free-text → Answer mapping (the ONLY new domain logic; slot rules stay in core) ──
/**
 * Map one free-text reply to the `emailIntent` Answer for the slot the user is answering
 * (determined by the PRIOR nextQuestion). Pure + exported so the parser is unit-tested
 * without Convex. Validation is NOT done here — recipients are validated downstream by
 * applyAnswer/isValidEmail (a bad address bounces in `rejected`, never stored).
 */
export function parseAnswer(prior: NextQuestion, text: string): Answer | null {
  const t = text.trim();
  switch (prior.kind) {
    case "ask_recipients":
    case "reask_recipient":
      // Segment on comma / the word "and" ONLY — intra-segment spaces stay so a multi-word
      // NAME ("Sarah Chen") survives as one token for Gmail resolution.
      // ponytail: accepted behavior break (Pitfall 3) — space-separated emails
      // ("a@x.com b@x.com") now collapse to ONE malformed segment that bounces to the re-ask
      // (was whitespace-split before). Upgrade to a per-token email scan only if users hit it.
      return {
        slot: "recipients",
        value: t
          .split(/\s*,\s*|\s+and\s+/i)
          .map((s) => s.trim())
          .filter((s) => s.length > 0),
      };
    case "ask_subject":
      return { slot: "subject", value: t };
    case "ask_body_intent":
      return { slot: "bodyIntent", value: t };
    case "ask_mode": {
      const lower = t.toLowerCase();
      const group = /\b(group|together|one thread|single thread)\b/.test(lower);
      const individual = /\b(individual|individually|separate|separately|each|one by one)\b/.test(lower);
      // Default to individual unless "group/together" is explicit — the safe, non-surprising
      // choice (recipients are never silently blended into one visible thread on an assumption).
      return { slot: "mode", value: group && !individual ? "group" : "individual" };
    }
    case "ready":
      return null; // already complete — nothing to fold in
  }
}

/**
 * Project the stored plan row into the pure EmailIntentState (`rejected` is transient).
 * The transient resolution fields survive across turns via the plans row: `candidates` →
 * `pendingResolution` names (so `nextQuestion` keeps returning `resolve_recipients` until the
 * pick), `pendingValid` held addresses, and `greetingName` to the drafter. Exported for the
 * unit test (the projection is the glue the resolve fold rides on).
 */
export function toIntentState(plan: {
  recipients?: string[];
  subject?: string;
  bodyIntent?: string;
  mode?: "individual" | "group";
  candidates?: { name: string }[];
  pendingValid?: string[];
  greetingName?: string;
}): EmailIntentState {
  return {
    recipients: plan.recipients ?? [],
    subject: plan.subject,
    bodyIntent: plan.bodyIntent,
    mode: plan.mode,
    pendingResolution: plan.candidates?.map((c) => ({ name: c.name })),
    pendingValid: plan.pendingValid,
    greetingName: plan.greetingName,
  };
}

/** Deterministic assistant copy per question kind (no LLM — DECISION #2). */
function questionText(q: NextQuestion): string {
  switch (q.kind) {
    case "ask_recipients":
      return "Who should this email go to? Share one or more email addresses.";
    case "reask_recipient":
      return `"${q.invalid}" doesn't look like a valid email address — what should it be?`;
    case "resolve_recipients":
      return "Found some matches — pick a contact to continue.";
    case "defer_group":
      return "Group lists like 'team' aren't supported yet — please give the explicit addresses.";
    case "ask_subject":
      return "What's the subject line?";
    case "ask_body_intent":
      return "What do you want the email to say?";
    case "ask_mode":
      return "Send to each recipient individually, or as one group thread? (individual / group)";
    case "ready":
      return "Here's your plan — review and Approve.";
  }
}

/**
 * The guided turn (SC2/SC3). Deterministic: saves the user turn, folds the answer into the
 * plans row via emailIntent, then either asks the next question or (when `ready`) drafts the
 * body (the ONLY LLM call) and proposes the PLAN. Returns `threadId` so the client binds the
 * chat hooks + `plans.byThread`. Explicit return type keeps the node-graph reference to
 * internal.llm.draftCockpit out of TS's circular-inference cliff (guidelines §96).
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
    const say = (content: string) =>
      cockpitAgent.saveMessage(ctx, {
        threadId: tid as string,
        message: { role: "assistant", content },
        skipEmbeddings: true,
      });

    // 2. Persist the user's turn.
    await cockpitAgent.saveMessage(ctx, { threadId: tid, prompt: text, skipEmbeddings: true });

    // 3. Load the plan row and project it into the pure intent state.
    const plan = await ctx.runQuery(api.plans.byThread, { threadId: tid });
    if (!plan) throw new Error("cockpit: plan row missing for thread");
    const state = toIntentState(plan);

    // 4. The slot being answered = the PRIOR next question over the loaded state.
    const answer = parseAnswer(nextQuestion(state), text);

    // 5. Fold the answer in (pure).
    let newState = state;
    if (answer) {
      const result = applyAnswer(state, answer);
      newState = result.state;
      if (!result.ok) {
        // Invalid recipients bounce — persist ONLY the valids, re-ask the first bad one.
        // ponytail: `rejected` is not a `plans` column, so a mixed valid+invalid reply stores
        // the valids and the next turn resumes at the next slot. Persist a `rejected` column if
        // per-address re-ask across turns is ever needed (schema change → plan 06's domain).
        await ctx.runMutation(internal.plans.patchPlan, {
          planId: plan._id,
          recipients: newState.recipients as string[],
        });
        await say(questionText({ kind: "reask_recipient", invalid: result.rejected.invalid[0] as string }));
        return { threadId: tid };
      }
      await ctx.runMutation(internal.plans.patchPlan, {
        planId: plan._id,
        recipients: newState.recipients as string[],
        subject: newState.subject,
        bodyIntent: newState.bodyIntent,
        mode: newState.mode,
      });
    }

    // 6. Ask the next question, or (7) draft + propose when every required slot is filled.
    const next = nextQuestion(newState);
    if (next.kind !== "ready") {
      await say(questionText(next));
      return { threadId: tid };
    }

    // ready → redact the body-intent BEFORE the model sees it (GRDL-01/02, CLAUDE.md §4),
    // draft the body (the SOLE LLM call), then propose the PLAN (status → proposed).
    const scan = scanText(newState.bodyIntent ?? "");
    if (!scan.ok) throw new Error("cockpit: body-intent scan failed"); // fail closed, content-free
    const safeText = scan.value.safeText;
    const draft = await ctx.runAction(internal.llm.draftCockpit, {
      tenantId: ctx.tenantId,
      safeText,
      safeTextHash: await contentHash(safeText),
    });
    await ctx.runMutation(internal.cockpit.proposeEmailPlan, {
      planId: plan._id,
      recipients: newState.recipients as string[],
      // mode is only asked/meaningful for >1 recipient; a single recipient is always individual.
      mode: newState.recipients.length > 1 ? (newState.mode ?? "individual") : "individual",
      subject: newState.subject ?? "", // user-provided (ask_subject) — never model-derived
      body: draft.body, // drafted wording
    });
    await say(questionText(next));
    return { threadId: tid };
  },
});

/**
 * Paginated thread-message list for the cockpit chat pane (feeds @convex-dev/agent/react
 * `useThreadMessages`). The agent thread is a message store only (DECISION #2), so the guided
 * questions + the "review and Approve" copy are the saved assistant turns surfaced here.
 * Tenant-guarded: a thread is only listable when the tenant owns its (tenant-scoped) plans row —
 * no cross-tenant read of another owner's conversation.
 * ponytail: static list (no `streamArgs`/`syncStreams`) — token streaming is a later upgrade
 * via `useUIMessages`/`vStreamArgs` (research §4), matching the deterministic no-LLM control here.
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
 * Code-invoked PLAN write (DECISION #2 — NOT an LLM tool; the recipient/subject are
 * structural, never model-invented). Assembles the proposed plan: patch the drafted body +
 * slots and flip status → `proposed` so the PLAN card renders and awaits Approve.
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
