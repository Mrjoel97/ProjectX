"use node";

import { createHash } from "node:crypto";
// Executive Agent LLM surface (AGNT-01/02/03 + GRDL-01/02/04/05) — the `route` and
// `draft` steps the pipeline (02-06) reaches through the Vercel AI Gateway.
//
// After Phase 3 this module CANNOT read raw goal text: every text read goes through
// guardrails.getSafeTextByHash (the fail-closed reader — GRDL-01/02). Prompts are
// NEVER hardcoded: both bodies load from the skills registry at runtime (CLAUDE.md §5).
//
// "use node": this module holds ONLY internalActions; every DB read goes through
// ctx.runQuery (01-07 rule — actions have no ctx.db). It stays the ONLY node module
// touched — a new node module re-triggers the TS circular-inference cliff (02-06).
//
// Model ids ("openai/gpt-4o-mini") are pricing/audit keys; `resolveModel` maps each to a
// direct-OpenAI LanguageModel via @ai-sdk/openai (reads OPENAI_API_KEY from the deployment
// env). The Vercel AI Gateway is NOT used — BYOK there is gated behind paid Vercel credits,
// a double charge on top of the OpenAI key we already pay for (decision 2026-07-13). The
// uncached actions carry the model id in their args (guardrails.prepare chose it), fall back
// to CHEAP_MODEL on eligible failure, and are wrapped by the tenant-namespaced action cache
// (Task 2). `usage` (inputTokens/outputTokens) drives OPSG-01 telemetry.
import { openai } from "@ai-sdk/openai";
import { ActionCache } from "@convex-dev/action-cache";
import { draftSchema } from "@pikar/contracts/drafting";
import { parseRouting, type RoutingDecision, routingSchema } from "@pikar/contracts/routing";
import {
  COCKPIT_AGENT_SKILL,
  DOCUMENT_DRAFTER_SKILL,
  EMAIL_DRAFTER_SKILL,
  EXECUTIVE_ROUTER_SKILL,
} from "@pikar/contracts/skill";
import {
  applyRecipientEdit,
  buildDocFilename,
  buildRecipientView,
  exceedsByteCap,
  type InlineRun,
  inlineRuns,
  isFallbackEligible,
  parseSendTime,
  type RecipientEdit,
  rankCandidates,
  tokenizeMarkdown,
  toWinAnsi,
} from "@pikar/core";
import { CHEAP_MODEL, DEFAULT_MODEL, priceUsage } from "@pikar/cost";
import { scanText } from "@pikar/pii";
import {
  generateObject,
  generateText,
  jsonSchema,
  type LanguageModel,
  stepCountIs,
  tool,
} from "ai";
import { MockLanguageModelV4 } from "ai/test";
import type { GenericActionCtx } from "convex/server";
import { v } from "convex/values";
import { type Color, PDFDocument, type PDFFont, rgb, StandardFonts } from "pdf-lib";
import { components, internal } from "./_generated/api";
import type { DataModel, Id } from "./_generated/dataModel";
import { internalAction } from "./_generated/server";
import { contentHash } from "./lib/hash";

// Per-call wall-clock ceiling. Retry budget lives in ONE layer: SDK maxRetries:1 on the
// primary + one CHEAP_MODEL fallback (the pipeline runs these steps with retry:false).
const CALL_TIMEOUT_MS = 45_000;

// Map a pricing/audit model id ("openai/gpt-4o-mini") to a direct-OpenAI LanguageModel.
// The `openai/` prefix is the gateway namespace; the @ai-sdk/openai provider wants the bare
// name and reads OPENAI_API_KEY from the deployment env. Pricing/audit keep the full id.
const resolveModel = (id: string): LanguageModel => openai(id.replace(/^openai\//, ""));

// ── Smoke seam ──────────────────────────────────────────────────────────────
// A dev-deployment smoke must drive the REAL spine deterministically and offline
// (no AI_GATEWAY_API_KEY on the local backend). The sentinel contains no PII, so it
// survives prepare's redaction verbatim and is parsed from safeText. Grammar:
//   SMOKE::route=<route>::[cache=1::][fail=primary::]
//   cache=1     — flow through preCall + the action cache (exercise the cache path)
//   fail=primary — force the primary model to throw so the real fallback path runs
// It degrades only the caller's OWN request; no cross-tenant effect.
// ponytail: content sentinel, not an env flag — keeps the seam per-request and out of
// shared deployment config. Remove once a mock-gateway smoke exists.
type Route = RoutingDecision["route"];
const SMOKE_ROUTES: readonly Route[] = ["direct_llm", "direct_tool", "sub_agent"];
type Smoke = { route: Route | "unknown"; cache: boolean; failPrimary: boolean };
function parseSmoke(text: string): Smoke | null {
  const m = text.match(/^SMOKE::route=([a-z_]+)::/);
  if (!m) return null;
  return {
    route: SMOKE_ROUTES.includes(m[1] as Route) ? (m[1] as Route) : "unknown",
    cache: text.includes("cache=1::"),
    failPrimary: text.includes("fail=primary::"),
  };
}

// Cast: the telemetry consumer reads only inputTokens/outputTokens; the SDK's
// LanguageModelUsage detail fields are irrelevant to a zero-cost smoke/cache-miss.
const ZERO_USAGE = { inputTokens: 0, outputTokens: 0, totalTokens: 0 } as unknown as GenUsage;

// `usage` shape lifted straight from the AI SDK's own return — version-independent, and
// (paired with the handler return annotations below) keeps these actions out of the
// `internal`-graph circular inference that sibling "use node" modules push past TS's limit.
type GenUsage = Awaited<ReturnType<typeof generateObject>>["usage"];

// The redacted-text reader's shape (the ONLY text source — GRDL-01). Explicit so the
// runQuery result never resolves through the `internal` graph (guidelines §96).
type SafeRead = { safeText: string; lastInstruction: string | null };

// ── Tenant-namespaced read-through caches (GRDL-04) ──────────────────────────
// Keyed on the uncached action's args ({tenantId, safeTextHash, model, skillVersion
// [, instructionHash]}) — hash only, never text, never requestId. `name` is part of the
// key: bump the suffix to invalidate wholesale. A registry rollback changes skillVersion,
// so a cached draft can never outlive the skill body that produced it (CLAUDE.md §5).
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const routeCache = new ActionCache(components.actionCache, {
  action: internal.llm.routeUncached,
  name: "route-v1",
  ttl: SEVEN_DAYS_MS,
});
const draftCache = new ActionCache(components.actionCache, {
  action: internal.llm.draftUncached,
  name: "draft-v1",
  ttl: SEVEN_DAYS_MS,
});

// The wrapper return unions: a governed preCall stop propagates as DATA (never a throw),
// landing the pipeline in the SAME blocked terminal a prepare stop gets.
type RouteResult =
  | { blocked: "kill_switch" | "daily_budget_exhausted" }
  | { blocked: null; routing: RoutingDecision; usage: GenUsage; cacheHit: boolean };
type DraftResult =
  | { blocked: "kill_switch" | "daily_budget_exhausted" }
  | { blocked: null; subject: string; body: string; usage: GenUsage; cacheHit: boolean };

/**
 * Classify the request goal into a routing decision + step plan (AGNT-01/02). The args
 * ARE the action-cache key — hash only, NO text, NO requestId (requestId would fragment
 * the key; text would violate GRDL-02). Reads redacted text via the fail-closed reader.
 * On an eligible primary failure it retries once on CHEAP_MODEL (llm.fallback audited by
 * error NAME only); a parse fail throws a plain Error → DLQ (AGNT-03, not fallback).
 */
export const routeUncached = internalAction({
  args: {
    tenantId: v.string(),
    safeTextHash: v.string(),
    model: v.string(),
    skillVersion: v.number(),
  },
  handler: async (
    ctx,
    { tenantId, safeTextHash, model, skillVersion },
  ): Promise<{ routing: RoutingDecision; usage: GenUsage; generatedAt: number }> => {
    const { safeText }: SafeRead = await ctx.runQuery(internal.guardrails.getSafeTextByHash, {
      tenantId,
      safeTextHash,
    });

    // Uncached actions have no request correlationId — key audits on safeTextHash. The
    // llm.called row is the cache-miss oracle: a hit produces NO new row (03-RESEARCH Q1).
    const auditCalled = (m: string) =>
      ctx.runMutation(internal.audit.log, {
        tenantId,
        correlationId: safeTextHash,
        eventType: "llm.called",
        actor: "system",
        payload: { model: m, skillVersion, stage: "route" },
      });

    const smoke = parseSmoke(safeText);
    if (smoke) {
      await auditCalled(model);
      if (smoke.route === "unknown") throw new Error("unknown_route");
      return {
        routing: {
          route: smoke.route,
          steps: [{ n: 1, description: "smoke" }],
          rationale: "smoke",
        },
        usage: ZERO_USAGE,
        generatedAt: Date.now(),
      };
    }

    const skill: { body: string } = await ctx.runQuery(internal.skills.getActiveSkill, {
      name: EXECUTIVE_ROUTER_SKILL,
    });

    try {
      const { object, usage } = await generateObject({
        model: resolveModel(model),
        schema: routingSchema,
        system: skill.body,
        prompt: safeText,
        abortSignal: AbortSignal.timeout(CALL_TIMEOUT_MS),
        maxRetries: 1,
      });
      const parsed = parseRouting(object);
      if (!parsed.ok) throw new Error(parsed.reason); // "unknown_route" — plain Error → DLQ
      await auditCalled(model);
      return { routing: parsed.value, usage, generatedAt: Date.now() };
    } catch (e) {
      if (!isFallbackEligible(e)) throw e; // our bug / parse fail / config → DLQ
      await ctx.runMutation(internal.audit.log, {
        tenantId,
        correlationId: safeTextHash,
        eventType: "llm.fallback",
        actor: "system",
        payload: {
          fromModel: model,
          toModel: CHEAP_MODEL,
          errorName: (e as Error)?.name ?? "unknown",
          stage: "route",
        },
      });
      const { object, usage } = await generateObject({
        model: resolveModel(CHEAP_MODEL),
        schema: routingSchema,
        system: skill.body,
        prompt: safeText,
        abortSignal: AbortSignal.timeout(CALL_TIMEOUT_MS),
        maxRetries: 0,
      });
      const parsed = parseRouting(object);
      if (!parsed.ok) throw new Error(parsed.reason);
      await auditCalled(CHEAP_MODEL);
      return { routing: parsed.value, usage, generatedAt: Date.now() };
    }
  },
});

/**
 * Draft a subject + plain-text body for the redacted goal (AGNT-02 + GRDL-02/04/05).
 * Same hash-only cache-key shape as routeUncached, plus an optional instructionHash so a
 * regenerate-with-instruction gets its own cache entry. lastInstruction comes back from
 * the fail-closed reader ALREADY scanned (plan 03-03 stores only redacted instructions).
 */
export const draftUncached = internalAction({
  args: {
    tenantId: v.string(),
    safeTextHash: v.string(),
    model: v.string(),
    skillVersion: v.number(),
    instructionHash: v.optional(v.string()),
  },
  handler: async (
    ctx,
    { tenantId, safeTextHash, model, skillVersion, instructionHash },
  ): Promise<{ subject: string; body: string; usage: GenUsage; generatedAt: number }> => {
    const { safeText, lastInstruction }: SafeRead = await ctx.runQuery(
      internal.guardrails.getSafeTextByHash,
      { tenantId, safeTextHash },
    );

    const auditCalled = (m: string) =>
      ctx.runMutation(internal.audit.log, {
        tenantId,
        correlationId: safeTextHash,
        eventType: "llm.called",
        actor: "system",
        payload: { model: m, skillVersion, stage: "draft" },
      });

    const skill: { body: string } = await ctx.runQuery(internal.skills.getActiveSkill, {
      name: EMAIL_DRAFTER_SKILL,
    });
    const smoke = parseSmoke(safeText);
    const prompt =
      lastInstruction && instructionHash
        ? `${safeText}\n\nRevision instruction: ${lastInstruction}`
        : safeText;

    try {
      if (smoke) {
        // failPrimary throws INTO the real catch so isFallbackEligible classifies it.
        if (smoke.failPrimary)
          throw new DOMException("smoke: forced primary failure", "TimeoutError");
        await auditCalled(model);
        return {
          subject: "Smoke Subject",
          body: `Smoke draft for ${safeTextHash}`,
          usage: ZERO_USAGE,
          generatedAt: Date.now(),
        };
      }
      const { object, usage } = await generateObject({
        model: resolveModel(model),
        schema: draftSchema,
        system: skill.body,
        prompt,
        abortSignal: AbortSignal.timeout(CALL_TIMEOUT_MS),
        maxRetries: 1,
      });
      await auditCalled(model);
      return { subject: object.subject, body: object.body, usage, generatedAt: Date.now() };
    } catch (e) {
      if (!isFallbackEligible(e)) throw e;
      await ctx.runMutation(internal.audit.log, {
        tenantId,
        correlationId: safeTextHash,
        eventType: "llm.fallback",
        actor: "system",
        payload: {
          fromModel: model,
          toModel: CHEAP_MODEL,
          errorName: (e as Error)?.name ?? "unknown",
          stage: "draft",
        },
      });
      // Sentinel short-circuits the fallback to a fixed draft (no model call).
      if (smoke)
        return {
          subject: "Smoke Fallback Subject",
          body: "smoke fallback",
          usage: ZERO_USAGE,
          generatedAt: Date.now(),
        };
      const { object, usage } = await generateObject({
        model: resolveModel(CHEAP_MODEL),
        schema: draftSchema,
        system: skill.body,
        prompt,
        abortSignal: AbortSignal.timeout(CALL_TIMEOUT_MS),
        maxRetries: 0,
      });
      await auditCalled(CHEAP_MODEL);
      return { subject: object.subject, body: object.body, usage, generatedAt: Date.now() };
    }
  },
});

/**
 * Cockpit body draft (DECISION #2 — the LLM is used ONLY for the body wording).
 * Lives INSIDE llm.ts because it is the ONLY "use node" module (RESEARCH §6 — a second
 * node module re-triggers the TS circular-inference cliff). Unlike draftUncached it takes
 * ALREADY-REDACTED text directly ({ tenantId, safeText, safeTextHash }) instead of a
 * requests-row hash: the guided chat has no per-turn requests row (RESEARCH-agent §6).
 *
 * REDACTION CONTRACT: the CALLER (plan 07) scans the body-intent via guardrails.prepare/
 * scanText and passes `safeText` — no raw PII reaches the model or any log (GRDL-01/02,
 * CLAUDE.md §4). The drafter body loads from the registry (no hardcoded prompt — §5).
 * SMOKE:: short-circuits to a deterministic offline draft (no model call — the E2E path);
 * else DEFAULT_MODEL → CHEAP_MODEL fallback. Returns { subject, body } only — the
 * recipient is never model-derived (drafting.ts).
 */
export const draftCockpit = internalAction({
  args: {
    tenantId: v.string(),
    safeText: v.string(),
    safeTextHash: v.string(),
    // The RESOLVED display name ONLY (SC3) — for a personalized greeting. NEVER a header hint
    // (lastSubject/lastDateMs/count): those must not reach the LLM (llmRedaction static scan).
    greetingName: v.optional(v.string()),
  },
  handler: async (
    ctx,
    { safeText, safeTextHash, greetingName },
  ): Promise<{ subject: string; body: string }> => {
    // Load the drafter FIRST (no hardcoded prompt — CLAUDE.md §5); fails closed
    // (throws NO_ACTIVE_SKILL) when unseeded, so a hardcoded fallback can never sneak in.
    const skill: { body: string; version: number } = await ctx.runQuery(
      internal.skills.getActiveSkill,
      { name: EMAIL_DRAFTER_SKILL },
    );
    const smoke = parseSmoke(safeText);
    // Prepend the greeting instruction (name only) so the body opens "Hi <name>,".
    const prompt = greetingName
      ? `Open the email body with the greeting "Hi ${greetingName},".\n\n${safeText}`
      : safeText;

    // ponytail: no audit/telemetry here. draftCockpit has no thread/correlationId (only the
    // safeTextHash) — the CALLER (plan 07) owns the conversation's correlation and records
    // llm.called/cost with it. Writing nothing keeps the draft path redaction-safe by
    // construction (nothing raw can leak to a log because it emits no log). Add a usage
    // return + caller-side telemetry when plan 07 needs OPSG-01 counts for chat drafts.
    try {
      if (smoke) {
        // failPrimary throws INTO the catch so the real fallback path runs; else offline draft.
        if (smoke.failPrimary)
          throw new DOMException("smoke: forced primary failure", "TimeoutError");
        // Honor the greeting offline too (SC3) so the resolution E2E can prove "Hi <name>," without a model.
        const greeting = greetingName ? `Hi ${greetingName},\n\n` : "";
        return { subject: "Smoke Subject", body: `${greeting}Smoke draft for ${safeTextHash}` };
      }
      const { object } = await generateObject({
        model: resolveModel(DEFAULT_MODEL),
        schema: draftSchema,
        system: skill.body,
        prompt,
        abortSignal: AbortSignal.timeout(CALL_TIMEOUT_MS),
        maxRetries: 1,
      });
      return { subject: object.subject, body: object.body };
    } catch (e) {
      if (!isFallbackEligible(e)) throw e;
      if (smoke) return { subject: "Smoke Fallback Subject", body: "smoke fallback" };
      const { object } = await generateObject({
        model: resolveModel(CHEAP_MODEL),
        schema: draftSchema,
        system: skill.body,
        prompt,
        abortSignal: AbortSignal.timeout(CALL_TIMEOUT_MS),
        maxRetries: 0,
      });
      return { subject: object.subject, body: object.body };
    }
  },
});

// ── Cockpit Executive-Agent tool set (AGNT-01/02) ────────────────────────────
// The governed tools the loop (Plan 04) hands to generateText. Each tool is a THIN wrapper
// over the primitive it governs — the tool IS the enforcement boundary. Structural facts
// (which addresses are valid, which recipient sits at #index) are resolved/validated HERE
// from the row + the pure @pikar/core reducers, NEVER trusted from the model. Redaction runs
// before the drafting sub-call; the recipient view the model reasons over is index+label only
// (raw addresses are substituted server-side inside removeRecipient). No generateText loop yet.
// ponytail: no abstraction layer — each tool is a thin `execute` closure over an existing
// primitive; the shared plan-row read is one helper.

// The plan-row fields the tools read. Explicit so the runQuery result never resolves through
// the `internal` graph (guidelines §96 circular-inference cliff, as the sibling actions do).
// One generated-attachment ref (mirrors plans.attachments in schema.ts). storageId + counts only —
// the signed URL is a bearer capability minted ONLY by plans.attachmentUrls (never here — §4).
type Att = { storageId: Id<"_storage">; filename: string; mimeType: string; size: number };

type PlanRow = {
  tenantId: string;
  recipients?: string[];
  subject?: string;
  body?: string;
  mode?: "individual" | "group";
  greetingName?: string;
  attachments?: Att[];
  attachmentError?: string;
  recipientBodies?: Record<string, string>; // address → tailored body override (CKPT-03); missing = shared body
  // NOTE: parked name-resolution `candidates` are NOT declared here on purpose — the model-facing
  // contract for them lives in buildAgentContext's own param (NAME + count only, §2-D/§4), and
  // getById returns the full row at runtime so buildAgentContext(plan) reads them. Declaring the
  // candidate `matches` shape in THIS span would trip the draftCockpit header-hint redaction scan.
};

// One formatter for the resolved send instant — shared by buildAgentContext's Send-time line
// and setSendTime's confirmation string (same zone rules, one place to change them).
const fmtSendInstant = (ms: number, tz?: string) =>
  new Intl.DateTimeFormat("en-US", { timeZone: tz, dateStyle: "full", timeStyle: "short" }).format(ms);

/**
 * Format the current plan state for the model (Plan 04 feeds this into the loop each turn).
 * Recipients render as the index+label view from buildRecipientView — an address NEVER appears
 * (§2-D: the raw email does not reach the model). Pure — takes the row, returns a string.
 */
export function buildAgentContext(
  plan: {
    recipients?: string[];
    subject?: string;
    body?: string;
    mode?: "individual" | "group";
    attachments?: { filename: string }[];
    attachmentError?: string;
    recipientBodies?: Record<string, string>;
    // Absolute send instant (epoch ms) once a time is resolved; absent = immediate on approve.
    sendAt?: number;
    // matches carry address + USER-only hints (displayName/lastSubject/…); buildAgentContext emits
    // ONLY the name + matches.length — never a field inside a match (§2-D/§4).
    candidates?: { name: string; matches: { address: string; displayName?: string }[] }[];
  },
  // The user's IANA zone (from the trusted client, §2-D) used ONLY to format sendAt for the model to
  // confirm; the model never supplies it. Defaults to UTC when a turn carries no client clock.
  tz = "UTC",
): string {
  const bodies = plan.recipientBodies ?? {};
  const addrs = plan.recipients ?? [];
  const view = buildRecipientView(addrs.map((address) => ({ address })));
  // Align each view row to its address ONLY to look up the personalization flag — the address is
  // never emitted; the model sees the #index/label and " — personalized" / " — shared body" (§2-D).
  const recipients = view.length
    ? view
        .map((r, i) => {
          const tailored = addrs[i] && bodies[addrs[i]!] ? " — personalized" : " — shared body";
          return `  #${r.index}: ${r.label}${tailored}`;
        })
        .join("\n")
    : "  (none yet)";
  // Resolution-in-progress: names searched whose contact the user has NOT yet picked from the
  // ResolutionCard. Surfacing this (NAME + count ONLY — never a candidate address or hint, §2-D/§4)
  // keeps the model's view of the shared plan state COMPLETE, so it neither falsely claims a name
  // is "already added" nor blindly re-resolves — it tells the user to pick from the card. This is
  // the fix for the agent↔workspace disconnect (a multi-name turn surfaced it in the 3.4 human-verify).
  const pending = plan.candidates ?? [];
  // Attachments render by #index + filename (content-plane names; no storageId/URL reaches the model).
  const atts = plan.attachments ?? [];
  const attachments = atts.length
    ? atts.map((a, i) => `  #${i + 1}: ${a.filename}`).join("\n")
    : "  (none yet)";
  return [
    "Current email plan:",
    "Recipients (reason about these by #index only):",
    recipients,
    // Only shown when a search is unresolved — the user must pick before these become recipients.
    ...(pending.length
      ? [
          "Awaiting the user's contact pick (NOT yet recipients — tell the user to pick from the card, do NOT claim you added them):",
          ...pending.map((c) => `  ${c.name}: ${c.matches.length} contact(s) found`),
        ]
      : []),
    `Subject: ${plan.subject ?? "(not set)"}`,
    `Body drafted: ${plan.body ? "yes" : "no"}`,
    `Send mode: ${plan.mode ?? "(not set)"}`,
    // Send time: the ABSOLUTE resolved instant in the user's zone (so the model confirms it, never
    // invents a clock); nothing set = immediate on approve (the default, SC1).
    `Send time: ${plan.sendAt === undefined ? "(immediate on approve)" : fmtSendInstant(plan.sendAt, tz)}`,
    "Attachments (reason about these by #index/filename):",
    attachments,
    ...(plan.attachmentError
      ? [`Attachment problem (fix before proposing): ${plan.attachmentError}`]
      : []),
  ].join("\n");
}

/**
 * Build the governed tool set for one plan (AGNT-01/02). Each tool wraps its primitive and
 * preserves that primitive's governance; nothing trusts a structural fact from the model. Plan
 * 04 hands this set to generateText — Plan 03 ships them as independently testable wrappers.
 */
export function buildCockpitTools(
  ctx: GenericActionCtx<DataModel>,
  tenantId: string,
  planId: Id<"plans">,
  // The TRUSTED client's clock + IANA zone (§2-D): setSendTime reads nowMs/ianaTz from HERE, never
  // from the model. Append-only 4th arg — every existing caller keeps working. Absent (and not the
  // SMOKE path) → setSendTime defers to the plan-card date picker (Wave 3's confirm source-of-truth).
  clientContext?: { tz: string; nowMs: number },
) {
  const readPlan = async (): Promise<PlanRow> => {
    const plan: PlanRow | null = await ctx.runQuery(internal.plans.getById, { planId });
    if (!plan || plan.tenantId !== tenantId) throw new Error("cockpit: plan row missing"); // no cross-tenant
    return plan;
  };

  // Shared generate path for generateAttachment/regenerateAttachment (CKPT-02): scan (fail-closed)
  // → draft → render → filename → cap check → store. Returns the stored ref, or writes attachmentError
  // (preserving `existing`) and returns a failure the agent relays. `replaceIndex` (0-based) is the
  // slot being superseded — excluded from the filename-collision set and the cap total. NEVER surfaces
  // a URL/bytes (§2-D/§4). ponytail: no new spend code — the loop's preCall/recordSpend already governs
  // the turn, exactly like draftBody.
  const renderAndStore = async (
    topic: string,
    existing: Att[],
    replaceIndex: number | null,
  ): Promise<{ ok: true; att: Att } | { ok: false; message: string }> => {
    const scan = scanText(topic);
    if (!scan.ok) throw new Error("cockpit: attachment-topic scan failed"); // redact-then-write §4
    const safeText = scan.value.safeText;
    const draft: { title: string; markdown: string } = await ctx.runAction(
      internal.llm.draftDocument,
      { tenantId, safeText, safeTextHash: await contentHash(safeText) },
    );
    const setError = async (message: string): Promise<{ ok: false; message: string }> => {
      // Render-fail / over-cap → mark the plan not-proposable, add NO ref (block-on-render-fail).
      await ctx.runMutation(internal.plans.recordAttachments, {
        planId,
        attachments: existing,
        attachmentError: message,
      });
      return { ok: false, message };
    };
    let bytes: Uint8Array;
    try {
      // ponytail: render=fail:: is a per-request offline hook (mirrors fail=primary::) to exercise
      // block-on-render-fail without provoking a real pdf-lib throw. Remove with the SMOKE seam.
      if (safeText.includes("render=fail::")) throw new Error("smoke: forced render failure");
      bytes = await markdownToPdf(draft.title, draft.markdown);
    } catch {
      return setError(
        "I couldn't generate the attachment — the document failed to render. Tell the user and offer to try again.",
      );
    }
    const others = existing.filter((_, j) => j !== replaceIndex);
    // Pin the date offline so SMOKE fixtures stay byte-deterministic; real time otherwise.
    const today = parseSmoke(safeText) ? "1970-01-01" : new Date().toISOString().slice(0, 10);
    const filename = buildDocFilename(
      topic,
      today,
      others.map((a) => a.filename),
    );
    const total = others.reduce((s, a) => s + a.size, 0) + bytes.byteLength;
    if (exceedsByteCap(total)) {
      return setError(
        "The attachments would exceed the size limit. Ask the user to remove one or use a smaller document.",
      );
    }
    // ponytail: cast — a Uint8Array IS a valid BlobPart at runtime; the DOM lib types
    // Uint8Array<ArrayBufferLike> too strictly (it may be SharedArrayBuffer-backed).
    const storageId = await ctx.storage.store(
      new Blob([bytes as BlobPart], { type: "application/pdf" }),
    );
    return {
      ok: true,
      att: { storageId, filename, mimeType: "application/pdf", size: bytes.byteLength },
    };
  };

  // add | set share the bounce/patch shape; remove differs (index → server-side address).
  const editRecipients = async (edit: RecipientEdit): Promise<string> => {
    const plan = await readPlan();
    const result = applyRecipientEdit(plan.recipients ?? [], edit);
    if (!result.ok) {
      // Bounce at the boundary — do NOT patch; hand the rejected tokens back so the agent re-asks.
      return `Rejected (not applied): ${result.rejected.join(", ")}. The recipient list is unchanged.`;
    }
    await ctx.runMutation(internal.plans.patchPlan, { planId, recipients: result.recipients });
    return `Recipients updated — ${result.recipients.length} on the list.`;
  };

  return {
    resolveContacts: tool({
      description:
        "Look up a named person in the user's mailbox to find their email address. Use for a NAME (not a typed address). Returns matching contacts by label for the user to pick — you never see the address.",
      inputSchema: jsonSchema<{ name: string }>({
        type: "object",
        properties: { name: { type: "string", description: "The person's name to look up." } },
        required: ["name"],
        additionalProperties: false,
      }),
      execute: async ({ name }): Promise<string> => {
        // correlationId = planId: a stable ref for the refs-only mailbox.searched audit (§4).
        const res = await ctx.runAction(internal.gmail.search, {
          tenantId,
          name,
          correlationId: planId,
        });
        if (!res.ok) {
          // Read-time auth failure: light the reconnect banner AND fall back to asking (never dead-end).
          await ctx.runMutation(internal.notifications.notify, {
            tenantId,
            kind: "gmail_reconnect",
            message: "I couldn't read your mailbox — reconnect Gmail so I can look up contacts.",
          });
          return `I couldn't read the mailbox to look up "${name}". Ask the user for the email address directly.`;
        }
        // The SMOKE:: search sentinel (offline fixture trigger) must not pollute name-matching —
        // strip it so ranking scores against the real name. Production names never carry it (no-op).
        const rankName = name.replace(/^SMOKE::(?:[^:]*::)*/, "").trim() || name;
        const matches = rankCandidates(rankName, res.records);
        if (matches.length === 0)
          // Accuracy: no confident match → say so plainly and ask. NEVER substitute a different
          // contact for the name the user gave (a wrong recipient is a liability, not a convenience).
          // Split literal keeps each chunk under the §5 no-hardcoded-prompt scan ceiling.
          return (
            `I found no contact matching "${name}" in the mailbox. Tell the user plainly you could not find "${name}". ` +
            "Ask them for that person's email address, and never substitute a different contact."
          );
        // Hold the candidates on the content plane so the ResolutionCard renders; the human picks a
        // chip → resolveRecipients folds the real address in (the model never sees it).
        await ctx.runMutation(internal.plans.writeCandidates, {
          planId,
          candidates: [{ name, matches }],
          pendingValid: [],
        });
        // refs-only summary: counts + display-name LABELS, never an address (§2-D / §4).
        const labels = matches
          .map((m, i) => `#${i + 1} ${m.displayName ?? "(no name)"}`)
          .join(", ");
        return `Found ${matches.length} contact(s) for "${name}": ${labels}. The user will pick one — do not guess the address.`;
      },
    }),
    addRecipients: tool({
      description:
        "Add one or more explicit, user-provided email addresses. Invalid addresses are rejected, not added.",
      inputSchema: jsonSchema<{ addresses: string[] }>({
        type: "object",
        properties: {
          addresses: {
            type: "array",
            items: { type: "string" },
            description: "Explicit email addresses the user typed.",
          },
        },
        required: ["addresses"],
        additionalProperties: false,
      }),
      execute: ({ addresses }): Promise<string> => editRecipients({ op: "add", addresses }),
    }),
    setRecipients: tool({
      description:
        "Replace the entire recipient list with these explicit email addresses. Invalid addresses are rejected.",
      inputSchema: jsonSchema<{ addresses: string[] }>({
        type: "object",
        properties: { addresses: { type: "array", items: { type: "string" } } },
        required: ["addresses"],
        additionalProperties: false,
      }),
      execute: ({ addresses }): Promise<string> => editRecipients({ op: "set", addresses }),
    }),
    removeRecipient: tool({
      description:
        "Remove the recipient at the given 1-based #index (as shown in the plan). You never handle the address — the server resolves the index to it.",
      inputSchema: jsonSchema<{ index: number }>({
        type: "object",
        properties: {
          index: { type: "number", description: "1-based index of the recipient to remove." },
        },
        required: ["index"],
        additionalProperties: false,
      }),
      execute: ({ index }): Promise<string> => editRecipients({ op: "remove", index }),
    }),
    setSubject: tool({
      description: "Set the email subject line.",
      inputSchema: jsonSchema<{ subject: string }>({
        type: "object",
        properties: { subject: { type: "string" } },
        required: ["subject"],
        additionalProperties: false,
      }),
      execute: async ({ subject }): Promise<string> => {
        await ctx.runMutation(internal.plans.patchPlan, { planId, subject });
        return "Subject set.";
      },
    }),
    setSendTime: tool({
      description:
        'Set when to send the email from a natural-language phrase like "in 2 hours" or ' +
        '"tomorrow at 4pm". The app supplies the current time and timezone — you never provide ' +
        "them. An ambiguous or past time is not set; you re-ask instead.",
      inputSchema: jsonSchema<{ text: string }>({
        type: "object",
        properties: {
          text: { type: "string", description: "The user's natural-language send time." },
        },
        required: ["text"],
        additionalProperties: false,
      }),
      execute: async ({ text }): Promise<string> => {
        // §2-D trust boundary: nowMs + ianaTz come from the TRUSTED client, NEVER the model. With no
        // client clock (and off the SMOKE path) defer to the plan-card date picker — Wave 3's
        // confirm source-of-truth — rather than invent a clock/zone.
        if (!clientContext)
          return "I couldn't read your timezone — use the date picker on the plan card to set a send time.";
        // Parse with the client's clock+zone. Resolved → write plan.sendAt; ambiguous/past/none →
        // write NOTHING and hand back a re-ask/note (SC2 — never guess a time, never silently send).
        const parsed = parseSendTime(text, clientContext.nowMs, clientContext.tz);
        switch (parsed.kind) {
          case "resolved": {
            await ctx.runMutation(internal.plans.patchPlan, { planId, sendAt: parsed.epochMs });
            const when = fmtSendInstant(parsed.epochMs, clientContext.tz);
            return `Send time set to ${when}. Confirm this exact time back to the user.`;
          }
          case "ambiguous":
            return "That time is ambiguous — ask which day and time they meant (never guess). Nothing was scheduled.";
          case "past":
            return "That time has already passed — ask the user for a future time. Nothing was scheduled.";
          default: // "none" — no time expressed
            return "I didn't detect a specific time — the email sends immediately on approve unless the user gives one.";
        }
      },
    }),
    setMode: tool({
      description:
        "Set how multiple recipients are addressed: individually (a separate email each) or as one group thread.",
      inputSchema: jsonSchema<{ mode: "individual" | "group" }>({
        type: "object",
        properties: { mode: { type: "string", enum: ["individual", "group"] } },
        required: ["mode"],
        additionalProperties: false,
      }),
      execute: async ({ mode }): Promise<string> => {
        await ctx.runMutation(internal.plans.patchPlan, { planId, mode });
        return `Send mode set to ${mode}.`;
      },
    }),
    draftBody: tool({
      description:
        "Draft the email body from a plain-language description of what to say. The draft is stored on the plan.",
      inputSchema: jsonSchema<{ intent: string }>({
        type: "object",
        properties: {
          intent: { type: "string", description: "What the email should say, in plain language." },
        },
        required: ["intent"],
        additionalProperties: false,
      }),
      execute: async ({ intent }): Promise<string> => {
        // Redact BEFORE the drafting model sees anything (GRDL-01/02, CLAUDE.md §4). Fail closed.
        const scan = scanText(intent);
        if (!scan.ok) throw new Error("cockpit: body-intent scan failed");
        const safeText = scan.value.safeText;
        const plan = await readPlan();
        const draft: { subject: string; body: string } = await ctx.runAction(
          internal.llm.draftCockpit,
          {
            tenantId,
            safeText,
            safeTextHash: await contentHash(safeText),
            greetingName: plan.greetingName, // resolved display name ONLY (SC3 — never a header hint)
          },
        );
        // bodyIntent is content-plane (never a log — §4); body is the drafted wording.
        await ctx.runMutation(internal.plans.patchPlan, {
          planId,
          bodyIntent: intent,
          body: draft.body,
        });
        return "Body drafted and saved to the plan.";
      },
    }),
    personalizeRecipient: tool({
      description:
        "Tailor the email wording for ONE recipient at the given 1-based #index, from a plain-language instruction. The shared body is unchanged; only that recipient gets the tailored version.",
      inputSchema: jsonSchema<{ index: number; instructions: string }>({
        type: "object",
        properties: {
          index: { type: "number", description: "1-based #index of the recipient to tailor." },
          instructions: {
            type: "string",
            description: "How this recipient's wording should differ, in plain language.",
          },
        },
        required: ["index", "instructions"],
        additionalProperties: false,
      }),
      execute: async ({ index, instructions }): Promise<string> => {
        const plan = await readPlan();
        const recipients = plan.recipients ?? [];
        const i = index - 1;
        if (i < 0 || i >= recipients.length)
          // Out-of-range → refuse; NEVER patch a body onto a non-existent recipient (§2-D).
          return `Rejected: there is no recipient #${index}. The plan has ${recipients.length}.`;
        const address = recipients[i]!; // resolved server-side — the model never handles it (§2-D)
        // Redact BEFORE the drafting model sees anything (GRDL-01/02, CLAUDE.md §4). Fail closed —
        // the identical guardrail draftBody uses, so PII/cost parity is free by construction (SC2).
        const scan = scanText(instructions);
        if (!scan.ok) throw new Error("cockpit: personalize-intent scan failed");
        const safeText = scan.value.safeText;
        const draft: { subject: string; body: string } = await ctx.runAction(
          internal.llm.draftCockpit,
          { tenantId, safeText, safeTextHash: await contentHash(safeText) },
          // ponytail: OMIT greetingName — the shared greetingName is pick-#1's name and would open a
          // DIFFERENT recipient's tailored body with the wrong "Hi <name>,". Let the instructions
          // carry any greeting intent. Ceiling: a per-recipient greeting map (Pitfall 4).
        );
        // Merge, don't replace: spread the existing overrides so tailoring #2 keeps #1's override.
        // The full merged map is passed — patchPlan replaces recipientBodies wholesale.
        const next = { ...(plan.recipientBodies ?? {}), [address]: draft.body };
        await ctx.runMutation(internal.plans.patchPlan, { planId, recipientBodies: next });
        // Return a LABEL only — never the address or the tailored body (§2-D/§4).
        return `Tailored the wording for recipient #${index}.`;
      },
    }),
    generateAttachment: tool({
      description:
        "Generate a PDF document on the given topic and attach it to the plan. Only after the user asks for (or confirms) an attachment. A render or size failure blocks approval until fixed.",
      inputSchema: jsonSchema<{ topic: string }>({
        type: "object",
        properties: {
          topic: { type: "string", description: "What the document should be about, in plain language." },
        },
        required: ["topic"],
        additionalProperties: false,
      }),
      execute: async ({ topic }): Promise<string> => {
        const plan = await readPlan();
        const existing = plan.attachments ?? [];
        const res = await renderAndStore(topic, existing, null);
        if (!res.ok) return res.message;
        // Append the new ref + CLEAR any prior error (a clean generate makes the plan proposable again).
        await ctx.runMutation(internal.plans.recordAttachments, {
          planId,
          attachments: [...existing, res.att],
          attachmentError: undefined,
        });
        return `Generated ${res.att.filename} — ${existing.length + 1} attachment(s) on the plan.`;
      },
    }),
    regenerateAttachment: tool({
      description:
        "Regenerate the attachment at the given 1-based #index from a new topic, replacing it in place. The old document is discarded once the new one is stored.",
      inputSchema: jsonSchema<{ index: number; topic: string }>({
        type: "object",
        properties: {
          index: { type: "number", description: "1-based #index of the attachment to replace." },
          topic: { type: "string", description: "What the new document should be about." },
        },
        required: ["index", "topic"],
        additionalProperties: false,
      }),
      execute: async ({ index, topic }): Promise<string> => {
        const plan = await readPlan();
        const existing = plan.attachments ?? [];
        const i = index - 1;
        if (i < 0 || i >= existing.length)
          return `Rejected: there is no attachment #${index}. The plan has ${existing.length}.`;
        const old = existing[i]!;
        const res = await renderAndStore(topic, existing, i);
        if (!res.ok) return res.message;
        const next = existing.map((a, j) => (j === i ? res.att : a));
        await ctx.runMutation(internal.plans.recordAttachments, {
          planId,
          attachments: next,
          attachmentError: undefined,
        });
        await ctx.storage.delete(old.storageId); // delete AFTER the new ref persists (O3 — no orphan/dangling ref)
        return `Regenerated attachment #${index} as ${res.att.filename}.`;
      },
    }),
    removeAttachment: tool({
      description:
        "Remove the attachment at the given 1-based #index from the plan and delete its stored bytes.",
      inputSchema: jsonSchema<{ index: number }>({
        type: "object",
        properties: {
          index: { type: "number", description: "1-based #index of the attachment to remove." },
        },
        required: ["index"],
        additionalProperties: false,
      }),
      execute: async ({ index }): Promise<string> => {
        const plan = await readPlan();
        const existing = plan.attachments ?? [];
        const i = index - 1;
        if (i < 0 || i >= existing.length)
          return `Rejected: there is no attachment #${index} to remove.`;
        const old = existing[i]!;
        const next = existing.filter((_, j) => j !== i);
        // Persist the shortened array FIRST, then delete the bytes (O3 — never a dangling ref).
        await ctx.runMutation(internal.plans.recordAttachments, {
          planId,
          attachments: next,
          attachmentError: undefined,
        });
        await ctx.storage.delete(old.storageId);
        return `Removed attachment #${index} — ${next.length} attachment(s) remain.`;
      },
    }),
    proposePlan: tool({
      description:
        "Propose the finished plan for the user to review and Approve. Call only once recipients, subject, and a drafted body are all set.",
      inputSchema: jsonSchema<Record<string, never>>({
        type: "object",
        properties: {},
        additionalProperties: false,
      }),
      execute: async (): Promise<string> => {
        const plan = await readPlan();
        const recipients = plan.recipients ?? [];
        // Guard: never propose an incomplete plan (a zero-recipient plan drafted+proposed was the
        // 03.2.1 bug). Refuse and tell the agent what's missing so it re-resolves / re-asks.
        if (recipients.length === 0) {
          return "Cannot propose yet — no recipients are set. Have the user resolve or add at least one recipient first.";
        }
        if (!plan.subject)
          return "Cannot propose yet — no subject is set. Ask the user for the subject.";
        if (!plan.body)
          return "Cannot propose yet — the body has not been drafted. Call draftBody first.";
        // Attachment health gate (V7): a render-failed / over-cap document is structurally
        // not-approvable. Facts come from the ROW; refuse so the agent regenerates/removes first.
        if (plan.attachmentError)
          return `Cannot propose yet — ${plan.attachmentError} Regenerate or remove the document, then propose.`;
        // ponytail: the cap is re-checked here as defense-in-depth; generateAttachment already refuses over-cap.
        const attachTotal = (plan.attachments ?? []).reduce((s, a) => s + a.size, 0);
        if (exceedsByteCap(attachTotal))
          return "Cannot propose yet — the attachments exceed the size limit. Ask the user to remove one.";
        // Personalization ⊗ group mode (CKPT-03, locked decision): a group send is ONE combined
        // email, so a per-recipient tailored body cannot apply. REFUSE (not silently force-individual)
        // so switching to individual is the user's explicit consent. Facts from the ROW.
        const hasPersonalization = Object.keys(plan.recipientBodies ?? {}).length > 0;
        if (hasPersonalization && plan.mode === "group")
          return "Cannot propose yet — this plan tailors wording per recipient, which requires individual sends (a group send is one combined email). Switch the mode to individual, then propose.";
        // Structural facts come from the ROW, never from model args (DECISION #2).
        await ctx.runMutation(internal.cockpit.proposeEmailPlan, {
          planId,
          recipients,
          mode: recipients.length > 1 ? (plan.mode ?? "individual") : "individual",
          subject: plan.subject,
          body: plan.body,
        });
        return "Plan proposed — the user can now review and Approve it.";
      },
    }),
  };
}

// ── The governed Executive-Agent tool-loop (AGNT-01/02) ──────────────────────
// runCockpitAgent is the reasoning engine: preCall gates BEFORE the loop (a governed stop is a
// conversational "paused" reply, NEVER a DLQ), generateText drives the tools with the cockpit-agent
// skill as `system`, stepCountIs(8) bounds the loop (the ceiling without a proposal makes the agent
// ask rather than loop), and recordSpend consumes the priced usage after — verbatim the route/draft
// rails. An eligible failure retries once on CHEAP_MODEL (isFallbackEligible).
// ponytail: `stopWhen: stepCountIs(8)` IS ai@7's maxSteps (the SDK renamed it; do NOT bump the
// pinned component to chase the old name — §6).

const PAUSED_REPLY =
  "I've paused for a moment — I'm briefly unavailable. Please send that again shortly.";

// A model paired with the pricing id used for recordSpend. An injected mock model is not a gateway
// string, so pricing needs the id explicitly (priceUsage keys on the model string).
type PricedModel = { model: LanguageModel; id: string };

// Invoke one built tool by name with a live action ctx (convex-test cannot fabricate one, so both
// the SMOKE offline path and the test shims route through this). Mirrors the tool-loop's own call.
function invokeTool(
  tools: ReturnType<typeof buildCockpitTools>,
  name: string,
  input: unknown,
): Promise<string> {
  const t = (
    tools as unknown as Record<string, { execute: (i: unknown, o: unknown) => Promise<string> }>
  )[name];
  if (!t) throw new Error(`unknown cockpit tool: ${name}`);
  return t.execute(input, { toolCallId: "cockpit", messages: [] });
}

// Price the reasoning call's usage → consume the daily-spend window (guarded: unknown model / zero
// cost skip; recordSpend itself also no-ops at cents<=0, so a ZERO_USAGE turn never drains budget).
// Returns the priced USD (0 on the guarded paths) so the loop can surface per-turn cost (EVAL-01
// Pattern 4 — the rate-limiter window is global and unreadable from the eval runner).
async function recordModelSpend(
  ctx: GenericActionCtx<DataModel>,
  id: string,
  usage: { inputTokens?: number; outputTokens?: number },
): Promise<number> {
  const priced = priceUsage(id, usage);
  if (!priced.ok) return 0;
  await ctx.runMutation(internal.guardrails.recordSpend, { costUsd: priced.value });
  return priced.value;
}

// The governed generateText loop shared by runCockpitAgent (a gateway model string) and the
// mock-model test shim (a scripted mock — Convex args cannot carry a LanguageModel). Runs the
// loop, records spend, and on an eligible primary failure retries once on the fallback model.
// Explicit return type keeps this out of the `internal`-graph circular inference (§96).
async function runAgentLoop(
  ctx: GenericActionCtx<DataModel>,
  args: {
    tenantId: string;
    planId: Id<"plans">;
    system: string;
    prompt: string;
    primary: PricedModel;
    fallback: PricedModel;
  },
): Promise<{ reply: string; costUsd: number }> {
  const { tenantId, planId, system, prompt, primary, fallback } = args;
  const tools = buildCockpitTools(ctx, tenantId, planId);
  // ONE accumulator across both attempts: a primary that recorded spend before an eligible throw
  // still counts toward the turn's total the eval runner caps on (Pattern 4).
  let costUsd = 0;
  const run = async (
    m: PricedModel,
    maxRetries: number,
  ): Promise<{ reply: string; costUsd: number }> => {
    const res = await generateText({
      model: m.model,
      system,
      prompt,
      tools,
      stopWhen: stepCountIs(8),
      abortSignal: AbortSignal.timeout(CALL_TIMEOUT_MS),
      maxRetries,
    });
    costUsd += await recordModelSpend(ctx, m.id, res.usage);
    return { reply: res.text, costUsd };
  };
  try {
    return await run(primary, 1);
  } catch (e) {
    if (!isFallbackEligible(e)) throw e; // our bug / config → propagate (the driver saves an error turn)
    return await run(fallback, 0);
  }
}

// ── SMOKE:: agent sentinel (the Plan 05 offline E2E path) ────────────────────
// The E2E has no gateway, so it drives the loop turn-by-turn: ONE sentinel op per user message
// maps to exactly ONE governed tool call (the SAME tools the model would call — no logic
// duplication, no generateText). Per-request + content-free framing, mirroring the route/draft
// sentinel. Grammar (one per message):
//   SMOKE::agent::add=a@x.com,b@x.com | resolve=Name | subject=... | mode=individual|group
//                | body=<intent> | remove=<1-based index> | propose
//                | attach=<topic> | regenerate=<1-based index>:<topic> | removeAttachment=<1-based index>
//                | personalize=<1-based index>:<intent> | sendTime=<natural-language time>
// SMOKE_NOW_MS pins the clock so a `sendTime=in N hours` op resolves deterministically offline (the
// model never supplies "now"/tz, §2-D) — the send-time analogue of the 1970-01-01 attachment pinning.
const SMOKE_NOW_MS = Date.UTC(2020, 0, 1, 12, 0, 0); // 2020-01-01 12:00:00 UTC
type AgentSmokeOp =
  | { kind: "add"; addresses: string[] }
  | { kind: "resolve"; name: string }
  | { kind: "subject"; subject: string }
  | { kind: "mode"; mode: "individual" | "group" }
  | { kind: "body"; intent: string }
  | { kind: "remove"; index: number }
  | { kind: "propose" }
  | { kind: "attach"; topic: string }
  | { kind: "regenerate"; index: number; topic: string }
  | { kind: "removeAttachment"; index: number }
  | { kind: "personalize"; index: number; instructions: string }
  | { kind: "sendTime"; text: string };

function parseAgentSmoke(text: string): AgentSmokeOp | null {
  const m = text.match(/^SMOKE::agent::([\s\S]+)$/);
  if (!m?.[1]) return null;
  const spec = m[1].trim();
  if (spec === "propose") return { kind: "propose" };
  const eq = spec.indexOf("=");
  if (eq < 0) return null;
  const key = spec.slice(0, eq).trim();
  const val = spec.slice(eq + 1).trim();
  switch (key) {
    case "add":
      return {
        kind: "add",
        addresses: val
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
      };
    case "resolve":
      return { kind: "resolve", name: val };
    case "subject":
      return { kind: "subject", subject: val };
    case "mode":
      return { kind: "mode", mode: val === "group" ? "group" : "individual" };
    case "body":
      return { kind: "body", intent: val };
    case "remove":
      return { kind: "remove", index: Number(val) };
    case "attach":
      return { kind: "attach", topic: val };
    case "regenerate": {
      // <1-based index>:<topic> — split on the FIRST colon (the topic may itself carry a SMOKE:: prefix).
      const c = val.indexOf(":");
      if (c < 0) return null;
      return { kind: "regenerate", index: Number(val.slice(0, c)), topic: val.slice(c + 1) };
    }
    case "removeAttachment":
      return { kind: "removeAttachment", index: Number(val) };
    case "sendTime":
      return { kind: "sendTime", text: val };
    case "personalize": {
      // <1-based index>:<intent> — split on the FIRST colon (the intent may carry a SMOKE:: prefix).
      const c = val.indexOf(":");
      if (c < 0) return null;
      return { kind: "personalize", index: Number(val.slice(0, c)), instructions: val.slice(c + 1) };
    }
    default:
      return null;
  }
}

function runAgentSmokeOp(
  tools: ReturnType<typeof buildCockpitTools>,
  op: AgentSmokeOp,
): Promise<string> {
  switch (op.kind) {
    case "add":
      return invokeTool(tools, "addRecipients", { addresses: op.addresses });
    case "resolve":
      return invokeTool(tools, "resolveContacts", { name: op.name });
    case "subject":
      return invokeTool(tools, "setSubject", { subject: op.subject });
    case "mode":
      return invokeTool(tools, "setMode", { mode: op.mode });
    case "body":
      return invokeTool(tools, "draftBody", { intent: op.intent });
    case "remove":
      return invokeTool(tools, "removeRecipient", { index: op.index });
    case "propose":
      return invokeTool(tools, "proposePlan", {});
    case "attach":
      return invokeTool(tools, "generateAttachment", { topic: op.topic });
    case "regenerate":
      return invokeTool(tools, "regenerateAttachment", { index: op.index, topic: op.topic });
    case "removeAttachment":
      return invokeTool(tools, "removeAttachment", { index: op.index });
    case "sendTime":
      return invokeTool(tools, "setSendTime", { text: op.text });
    case "personalize":
      return invokeTool(tools, "personalizeRecipient", {
        index: op.index,
        instructions: op.instructions,
      });
  }
}

/**
 * The Executive Agent tool-loop (AGNT-01/02). One turn: gate on preCall (blocked → a conversational
 * "paused" reply as DATA, never a throw/DLQ) → load the cockpit-agent skill as `system` (fails
 * closed unseeded, §5) → feed the index+label plan context (address-free, §2-D) + the user text to
 * generateText with the governed tools → recordSpend the priced usage → return the assistant reply
 * (Plan 05's driver saves it to the thread). A SMOKE:: sentinel drives one governed tool call
 * offline (no gateway — the Plan 05 E2E path). Explicit return type dodges TS7022 (§96).
 * ponytail: `model?` overrides the gateway model string; the mock-model seam is the test shim below
 * (a LanguageModel is not Convex-serializable, so it cannot ride in the args).
 */
export const runCockpitAgent = internalAction({
  args: {
    tenantId: v.string(),
    threadId: v.string(),
    planId: v.id("plans"),
    text: v.string(),
    model: v.optional(v.string()),
    // The trusted client's clock+zone for setSendTime (§2-D). Optional — a turn without it simply
    // cannot call setSendTime (it defers to the picker). The SMOKE path pins its own below.
    clientContext: v.optional(v.object({ tz: v.string(), nowMs: v.number() })),
  },
  handler: async (
    ctx,
    { tenantId, planId, text, model, clientContext },
  ): Promise<{
    reply: string;
    blocked?: "kill_switch" | "daily_budget_exhausted";
    // Per-turn priced USD (a count — §4-safe in a return value): 0 on the no-model paths, absent
    // on a governed stop (nothing spent). The eval runner sums this against its hard cost cap.
    costUsd?: number;
  }> => {
    // 1. Governed gate BEFORE any reasoning call — a governed stop is a paused reply, never a DLQ.
    const pre: { ok: true } | { ok: false; reason: "kill_switch" | "daily_budget_exhausted" } =
      await ctx.runMutation(internal.guardrails.preCall, {});
    if (!pre.ok) return { reply: PAUSED_REPLY, blocked: pre.reason };

    // 2. System = the cockpit-agent skill body (no hardcoded prompt — §5; fails closed unseeded).
    const skill: { body: string } = await ctx.runQuery(internal.skills.getActiveSkill, {
      name: COCKPIT_AGENT_SKILL,
    });

    // 3. Current plan state → the model-facing context (index+label recipients, address-free §2-D).
    const plan: PlanRow | null = await ctx.runQuery(internal.plans.getById, { planId });

    // 4. Offline sentinel path (Plan 05 E2E): one op → one governed tool call, no generateText. The
    //    SMOKE path pins a deterministic clock so sendTime= resolves offline (§2-D — never the model).
    const smokeOp = parseAgentSmoke(text);
    const effectiveClientContext = smokeOp ? { tz: "UTC", nowMs: SMOKE_NOW_MS } : clientContext;
    const tools = buildCockpitTools(ctx, tenantId, planId, effectiveClientContext);
    if (smokeOp) return { reply: await runAgentSmokeOp(tools, smokeOp), costUsd: 0 }; // no model call

    // 5. The governed generateText tool-loop; eligible failure → CHEAP_MODEL.
    const primaryId = model ?? DEFAULT_MODEL;
    const { reply, costUsd } = await runAgentLoop(ctx, {
      tenantId,
      planId,
      system: skill.body,
      prompt: `${buildAgentContext(plan ?? {}, clientContext?.tz)}\n\nThe user says: ${text}`,
      primary: { model: resolveModel(primaryId), id: primaryId },
      fallback: { model: resolveModel(CHEAP_MODEL), id: CHEAP_MODEL },
    });
    return { reply, costUsd };
  },
});

/**
 * Test-support shim (convex-test cannot fabricate an action ctx): build the tool set with a live
 * ctx and invoke one tool by name. Exercises the REAL primitives offline via SMOKE::. Not used in
 * production — the generateText loop above is the real caller.
 * ponytail: test-only, but it must live in this "use node" module — the tools close over an action
 * ctx a query/mutation test ctx cannot provide.
 */
export const __invokeCockpitTool = internalAction({
  args: {
    tenantId: v.string(),
    planId: v.id("plans"),
    toolName: v.string(),
    input: v.any(),
    // Optional pinned clock+zone so setSendTime tests drive parseSendTime deterministically (§2-D).
    clientContext: v.optional(v.object({ tz: v.string(), nowMs: v.number() })),
  },
  handler: async (ctx, { tenantId, planId, toolName, input, clientContext }): Promise<string> =>
    invokeTool(buildCockpitTools(ctx, tenantId, planId, clientContext), toolName, input),
});

/**
 * Test-support shim for the mock-model loop: a LanguageModel cannot ride through Convex action args,
 * so the mock is BUILT here from a serializable script of doGenerate results and handed to the SAME
 * governed loop (runAgentLoop) runCockpitAgent uses. Proves generateText runs the tools + records
 * spend + falls back to CHEAP_MODEL — all offline. Mirrors __invokeCockpitTool.
 * ponytail: script-driven mock, not a model arg (models are not Convex-serializable).
 */
export const __runCockpitAgentWithScript = internalAction({
  args: {
    tenantId: v.string(),
    planId: v.id("plans"),
    primary: v.array(v.any()),
    fallback: v.optional(v.array(v.any())),
    failPrimary: v.optional(v.boolean()),
  },
  handler: async (
    ctx,
    { tenantId, planId, primary, fallback, failPrimary },
  ): Promise<{ reply: string; costUsd: number }> => {
    const skill: { body: string } = await ctx.runQuery(internal.skills.getActiveSkill, {
      name: COCKPIT_AGENT_SKILL,
    });
    const plan: PlanRow | null = await ctx.runQuery(internal.plans.getById, { planId });
    const primaryModel = failPrimary
      ? new MockLanguageModelV4({
          doGenerate: async () => {
            throw new DOMException("mock: forced primary failure", "TimeoutError");
          },
        })
      : new MockLanguageModelV4({ doGenerate: primary as never });
    const fallbackModel = new MockLanguageModelV4({ doGenerate: (fallback ?? primary) as never });
    return await runAgentLoop(ctx, {
      tenantId,
      planId,
      system: skill.body,
      prompt: `${buildAgentContext(plan ?? {})}\n\nThe user says: drive the plan to a proposal.`,
      primary: { model: primaryModel as unknown as LanguageModel, id: DEFAULT_MODEL },
      fallback: { model: fallbackModel as unknown as LanguageModel, id: CHEAP_MODEL },
    });
  },
});

// ── Pipeline-facing wrappers (the only route/draft the pipeline calls) ────────
// Each: read redacted text → sentinel-first short-circuit → preCall governed gate →
// cache fetch → timestamp-inferred hit flag.

/**
 * Route wrapper (AGNT-01/02 + GRDL-03/04). Sentinel-first (Pitfall 5): a default
 * SMOKE sentinel short-circuits BEFORE preCall + cache, so a drained dev budget or a
 * stale cache entry can never break smoke:pipeline. Otherwise preCall gates, then the
 * cache fetch keys on {tenantId, safeTextHash, model, skillVersion}.
 */
export const route = internalAction({
  args: {
    tenantId: v.string(),
    requestId: v.id("requests"),
    safeTextHash: v.string(),
    model: v.string(),
  },
  handler: async (ctx, { tenantId, safeTextHash, model }): Promise<RouteResult> => {
    const { safeText }: SafeRead = await ctx.runQuery(internal.guardrails.getSafeTextByHash, {
      tenantId,
      safeTextHash,
    });
    const smoke = parseSmoke(safeText);
    if (smoke && !smoke.cache) {
      if (smoke.route === "unknown") throw new Error("unknown_route");
      return {
        blocked: null,
        routing: {
          route: smoke.route,
          steps: [{ n: 1, description: "smoke" }],
          rationale: "smoke",
        },
        usage: ZERO_USAGE,
        cacheHit: false,
      };
    }

    const skill: { version: number } = await ctx.runQuery(internal.skills.getActiveSkill, {
      name: EXECUTIVE_ROUTER_SKILL,
    });
    const pre: { ok: true } | { ok: false; reason: "kill_switch" | "daily_budget_exhausted" } =
      await ctx.runMutation(internal.guardrails.preCall, {});
    if (!pre.ok) return { blocked: pre.reason };

    const tStart = Date.now();
    const value: { routing: RoutingDecision; usage: GenUsage; generatedAt: number } =
      await routeCache.fetch(ctx, { tenantId, safeTextHash, model, skillVersion: skill.version });
    // An entry created before this fetch began was served from cache; a miss generates
    // DURING the fetch so generatedAt > tStart.
    // ponytail: timestamp inference — swap to the component's native hit signal if the
    // installed .d.ts ever exposes one (0.3.1 does not).
    const cacheHit = value.generatedAt < tStart;
    return { blocked: null, routing: value.routing, usage: value.usage, cacheHit };
  },
});

/**
 * Draft wrapper (AGNT-02 + GRDL-02/04). Same shape plus an optional regenerate
 * instruction (scanned fail-closed, persisted, hashed into the cache key) and `force`
 * to bypass the cache on regenerate (an identical-args fetch would hand back the exact
 * draft the user just asked to change — Pitfall 2).
 */
export const draft = internalAction({
  args: {
    tenantId: v.string(),
    requestId: v.id("requests"),
    safeTextHash: v.string(),
    model: v.string(),
    instruction: v.optional(v.string()),
    force: v.optional(v.boolean()),
  },
  handler: async (
    ctx,
    { tenantId, requestId, safeTextHash, model, instruction, force },
  ): Promise<DraftResult> => {
    const { safeText }: SafeRead = await ctx.runQuery(internal.guardrails.getSafeTextByHash, {
      tenantId,
      safeTextHash,
    });
    const smoke = parseSmoke(safeText);
    if (smoke && !smoke.cache) {
      return {
        blocked: null,
        subject: "Smoke Subject",
        body: `Smoke draft for ${safeTextHash}`,
        usage: ZERO_USAGE,
        cacheHit: false,
      };
    }

    const skill: { version: number } = await ctx.runQuery(internal.skills.getActiveSkill, {
      name: EMAIL_DRAFTER_SKILL,
    });
    const pre: { ok: true } | { ok: false; reason: "kill_switch" | "daily_budget_exhausted" } =
      await ctx.runMutation(internal.guardrails.preCall, {});
    if (!pre.ok) return { blocked: pre.reason };

    const args: {
      tenantId: string;
      safeTextHash: string;
      model: string;
      skillVersion: number;
      instructionHash?: string;
    } = { tenantId, safeTextHash, model, skillVersion: skill.version };
    if (instruction) {
      const scan = scanText(instruction);
      if (!scan.ok) throw new Error("guardrails: instruction_scan_failed"); // fail closed, content-free
      const safeInstruction = scan.value.safeText;
      args.instructionHash = createHash("sha256").update(safeInstruction).digest("hex");
      await ctx.runMutation(internal.guardrails.saveInstruction, { requestId, safeInstruction });
    }

    const tStart = Date.now();
    const value: { subject: string; body: string; usage: GenUsage; generatedAt: number } =
      await draftCache.fetch(ctx, args, force ? { force: true } : undefined);
    const cacheHit = value.generatedAt < tStart;
    return {
      blocked: null,
      subject: value.subject,
      body: value.body,
      usage: value.usage,
      cacheHit,
    };
  },
});

// ── Attachment generation (CKPT-02) ──────────────────────────────────────────
// The document-drafting sub-call. Mirrors draftCockpit EXACTLY (RESEARCH Seam 6): takes
// ALREADY-REDACTED text ({ tenantId, safeText, safeTextHash }) — the CALLER (Plan 04) scans the
// topic via scanText BEFORE calling, so no raw PII reaches the model or any log (GRDL-01/02,
// CLAUDE.md §4). The drafter body loads from the registry (no hardcoded prompt — §5). Returns
// { title, markdown }: title feeds buildDocFilename, markdown feeds markdownToPdf. Writes NO
// audit (caller owns correlation, same as draftCockpit). SMOKE:: short-circuits to a fixed
// offline document (no model call — the fan-out/E2E path); else DEFAULT_MODEL → CHEAP_MODEL.

// Structured output shape for the drafter (jsonSchema, not zod — keeps this node adapter
// zod-free like the tool set). generateObject validates the model against it.
const documentSchema = jsonSchema<{ title: string; markdown: string }>({
  type: "object",
  properties: {
    title: { type: "string" },
    markdown: { type: "string" },
  },
  required: ["title", "markdown"],
  additionalProperties: false,
});

export const draftDocument = internalAction({
  args: {
    tenantId: v.string(),
    safeText: v.string(),
    safeTextHash: v.string(),
  },
  handler: async (
    ctx,
    { safeText, safeTextHash },
  ): Promise<{ title: string; markdown: string }> => {
    // Load the drafter FIRST (no hardcoded prompt — §5); fails closed (throws NO_ACTIVE_SKILL)
    // when unseeded, so a hardcoded fallback can never sneak in.
    const skill: { body: string; version: number } = await ctx.runQuery(
      internal.skills.getActiveSkill,
      {
        name: DOCUMENT_DRAFTER_SKILL,
      },
    );
    const smoke = parseSmoke(safeText);

    try {
      if (smoke) {
        // failPrimary throws INTO the catch so the real fallback path runs; else offline document.
        if (smoke.failPrimary)
          throw new DOMException("smoke: forced primary failure", "TimeoutError");
        return {
          title: "Smoke Document",
          markdown: `# Smoke Document\n\nSmoke draft for ${safeTextHash}.`,
        };
      }
      const { object } = await generateObject({
        model: resolveModel(DEFAULT_MODEL),
        schema: documentSchema,
        system: skill.body,
        prompt: safeText,
        abortSignal: AbortSignal.timeout(CALL_TIMEOUT_MS),
        maxRetries: 1,
      });
      return { title: object.title, markdown: object.markdown };
    } catch (e) {
      if (!isFallbackEligible(e)) throw e;
      if (smoke)
        return { title: "Smoke Fallback Document", markdown: "# Smoke Fallback\n\nfallback body" };
      const { object } = await generateObject({
        model: resolveModel(CHEAP_MODEL),
        schema: documentSchema,
        system: skill.body,
        prompt: safeText,
        abortSignal: AbortSignal.timeout(CALL_TIMEOUT_MS),
        maxRetries: 0,
      });
      return { title: object.title, markdown: object.markdown };
    }
  },
});

// ── Pure-JS PDF renderer (CKPT-02, V1 + V2) ──────────────────────────────────
// markdownToPdf turns the drafter's simple markdown into a deterministic PDF using ONLY pdf-lib
// Standard-14 fonts (Helvetica family) — NEVER embedFont(ttf), which pulls fontkit and inlines
// TTF bytes, breaking the Convex esbuild bundle (no runtime font-file reads). Lives HERE in the
// sole "use node" module (a second node module re-trips the TS circular-inference cliff). Every
// drawn string passes through toWinAnsi so drawText can never throw on smart punctuation / astral
// glyphs (V2). CreationDate/ModDate are pinned to the epoch → byte-identical output (V1). The
// whole render is wrapped so ANY throw becomes a rejection — never a partial/empty PDF.
// ponytail: line-based renderer over Standard-14; add marked/fontkit only if rich markdown or
// embedded fonts land.

const PAGE_W = 612; // US-Letter, points
const PAGE_H = 792;
const MARGIN = 64;
const CONTENT_W = PAGE_W - 2 * MARGIN;
const LEADING = 1.42;

// A restrained, professional palette (deterministic — no theme input, so bytes stay reproducible).
const INK = rgb(0.13, 0.15, 0.18); // body text, near-black
const ACCENT = rgb(0.09, 0.33, 0.45); // headings, rules, list markers — deep teal
const RULE = rgb(0.82, 0.85, 0.87); // hairline section + table borders
const TH_BG = rgb(0.93, 0.96, 0.97); // table header fill

// Point size per block kind (headings bold + accent; body/list regular ink).
const SIZE: Record<string, number> = {
  h1: 16,
  h2: 13.5,
  h3: 11.5,
  para: 10.5,
  bullet: 10.5,
  ordered: 10.5,
};
const TABLE_SIZE = 9.5;

// One laid-out word carrying the font it renders in (regular vs bold), for run-aware wrapping.
type Word = { text: string; font: PDFFont };

// Greedy word-wrap for a single already-sanitized string at one font/size (used for table cells).
function wrapText(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const words = text.split(/\s+/).filter((w) => w.length > 0);
  if (words.length === 0) return [""];
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const trial = cur ? `${cur} ${w}` : w;
    if (cur === "" || font.widthOfTextAtSize(trial, size) <= maxWidth) cur = trial;
    else {
      lines.push(cur);
      cur = w;
    }
  }
  lines.push(cur);
  return lines;
}

// Wrap styled inline runs into lines of (word,font) segments so bold survives word-wrap. Each run's
// text is sanitized (toWinAnsi) and split into words; words carry their run's font.
function layoutRuns(
  runs: InlineRun[],
  regular: PDFFont,
  bold: PDFFont,
  size: number,
  maxWidth: number,
): Word[][] {
  const words: Word[] = [];
  for (const run of runs) {
    const font = run.bold ? bold : regular;
    for (const w of toWinAnsi(run.text)
      .split(/\s+/)
      .filter((x) => x.length > 0))
      words.push({ text: w, font });
  }
  if (words.length === 0) return [[]];
  const space = regular.widthOfTextAtSize(" ", size);
  const lines: Word[][] = [];
  let cur: Word[] = [];
  let width = 0;
  for (const word of words) {
    const ww = word.font.widthOfTextAtSize(word.text, size);
    const add = cur.length === 0 ? ww : space + ww;
    if (cur.length > 0 && width + add > maxWidth) {
      lines.push(cur);
      cur = [word];
      width = ww;
    } else {
      cur.push(word);
      width += add;
    }
  }
  if (cur.length > 0) lines.push(cur);
  return lines;
}

export async function markdownToPdf(title: string, markdown: string): Promise<Uint8Array> {
  try {
    const doc = await PDFDocument.create();
    // Metadata: title feeds the human-facing document name; pin the dates for deterministic bytes.
    doc.setTitle(toWinAnsi(title));
    doc.setCreationDate(new Date(0));
    doc.setModificationDate(new Date(0));

    const body = await doc.embedFont(StandardFonts.Helvetica);
    const bold = await doc.embedFont(StandardFonts.HelveticaBold);

    let page = doc.addPage([PAGE_W, PAGE_H]);
    let y = PAGE_H - MARGIN;
    const space = (h: number) => {
      if (y - h < MARGIN) {
        page = doc.addPage([PAGE_W, PAGE_H]);
        y = PAGE_H - MARGIN;
      }
    };

    // Draw a block of inline runs with optional list marker (a filled square bullet drawn as a
    // shape — no glyph-encoding dependency — or a bold accent number). Wrapped lines hang-indent
    // under the text, not the marker.
    const drawBlock = (
      runs: InlineRun[],
      size: number,
      opts: {
        indent?: number;
        textIndent?: number;
        color?: Color;
        baseFont?: PDFFont;
        numberMarker?: string;
        dotMarker?: boolean;
      } = {},
    ) => {
      const indent = opts.indent ?? 0;
      const textIndent = opts.textIndent ?? indent;
      const color = opts.color ?? INK;
      const sp = body.widthOfTextAtSize(" ", size);
      const lines = layoutRuns(runs, opts.baseFont ?? body, bold, size, CONTENT_W - textIndent);
      const lh = size * LEADING;
      lines.forEach((line, li) => {
        space(lh);
        const baseline = y - size;
        if (li === 0 && opts.dotMarker)
          page.drawRectangle({
            x: MARGIN + indent,
            y: baseline + size * 0.28,
            width: 3,
            height: 3,
            color: ACCENT,
          });
        if (li === 0 && opts.numberMarker)
          page.drawText(opts.numberMarker, {
            x: MARGIN + indent,
            y: baseline,
            size,
            font: bold,
            color: ACCENT,
          });
        let x = MARGIN + textIndent;
        for (const word of line) {
          page.drawText(word.text, { x, y: baseline, size, font: word.font, color });
          x += word.font.widthOfTextAtSize(word.text, size) + sp;
        }
        y -= lh;
      });
    };

    // A GitHub-style table: header row filled + bold, body rows with hairline column/row borders.
    const drawTable = (header: string[], rows: string[][]) => {
      const cols = Math.max(header.length, ...rows.map((r) => r.length), 1);
      const colW = CONTENT_W / cols;
      const pad = 5;
      const rowOf = (cells: string[], isHeader: boolean) => {
        const wrapped = Array.from({ length: cols }, (_, c) =>
          wrapText(toWinAnsi(cells[c] ?? ""), isHeader ? bold : body, TABLE_SIZE, colW - 2 * pad),
        );
        const h = Math.max(1, ...wrapped.map((l) => l.length)) * (TABLE_SIZE * 1.3) + 2 * pad;
        space(h);
        const top = y;
        if (isHeader)
          page.drawRectangle({ x: MARGIN, y: top - h, width: CONTENT_W, height: h, color: TH_BG });
        wrapped.forEach((cellLines, c) => {
          let cy = top - pad - TABLE_SIZE;
          for (const ln of cellLines) {
            page.drawText(ln, {
              x: MARGIN + c * colW + pad,
              y: cy,
              size: TABLE_SIZE,
              font: isHeader ? bold : body,
              color: INK,
            });
            cy -= TABLE_SIZE * 1.3;
          }
        });
        page.drawRectangle({
          x: MARGIN,
          y: top - h,
          width: CONTENT_W,
          height: h,
          borderColor: RULE,
          borderWidth: 0.6,
        });
        for (let c = 1; c < cols; c++)
          page.drawLine({
            start: { x: MARGIN + c * colW, y: top },
            end: { x: MARGIN + c * colW, y: top - h },
            thickness: 0.6,
            color: RULE,
          });
        y = top - h;
      };
      y -= 6;
      rowOf(header, true);
      for (const r of rows) rowOf(r, false);
      y -= 8;
    };

    // Title block: the document title in bold accent + a hairline rule beneath.
    {
      const tsize = 21;
      for (const line of wrapText(toWinAnsi(title), bold, tsize, CONTENT_W)) {
        space(tsize * 1.2);
        page.drawText(line, { x: MARGIN, y: y - tsize, size: tsize, font: bold, color: ACCENT });
        y -= tsize * 1.2;
      }
      y -= 5;
      space(2);
      page.drawRectangle({ x: MARGIN, y, width: CONTENT_W, height: 1.5, color: ACCENT });
      y -= 16;
    }

    for (const tok of tokenizeMarkdown(markdown)) {
      if (tok.kind === "table") {
        drawTable(tok.header, tok.rows);
        continue;
      }
      if (tok.kind === "h1" || tok.kind === "h2" || tok.kind === "h3") {
        const size = SIZE[tok.kind]!;
        y -= size * 0.5; // breathing room before a heading
        drawBlock(inlineRuns(tok.text), size, { color: ACCENT, baseFont: bold });
        if (tok.kind !== "h3") {
          y -= 2;
          space(2);
          page.drawRectangle({ x: MARGIN, y, width: CONTENT_W, height: 0.6, color: RULE });
          y -= 6;
        } else {
          y -= 2;
        }
        continue;
      }
      const size = SIZE[tok.kind] ?? 10.5;
      y -= size * (LEADING - 1) * 0.6; // small gap before the block
      if (tok.kind === "bullet") {
        drawBlock(inlineRuns(tok.text), size, { indent: 6, textIndent: 20, dotMarker: true });
      } else if (tok.kind === "ordered") {
        drawBlock(inlineRuns(tok.text), size, {
          indent: 4,
          textIndent: 22,
          numberMarker: `${tok.num}.`,
        });
      } else {
        drawBlock(inlineRuns(tok.text), size, {});
      }
    }

    return await doc.save();
  } catch (e) {
    // Render failure blocks approval — surface it, never return a partial/empty PDF (CONTEXT).
    throw new Error(`markdownToPdf: render failed (${(e as Error)?.name ?? "unknown"})`);
  }
}
