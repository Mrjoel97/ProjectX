// The Business Evaluation Engine (BEVL-01) — a §1 thin adapter over the pure @pikar/core growth
// diagnosis + the existing tenant-scoped grounding. It carries the prior Scorecard FORWARD (the
// LOCKED "store" half: a previously-answered figure is never re-asked), grounds via the existing
// `vaultGroundHydrated` (no second retriever), fills the Scorecard from grounded text + carried
// answers, runs the pure `diagnose()`/`leverageRank()`, and persists ONE durable `evaluations`
// row with per-finding citations + H/M/L confidence + a source tag. It emits ONE refs-only
// `evaluation.ran` audit (counts/enums ONLY — §4) and one "evaluateBusiness" activity step.
//
// Two-shapes rule: this is the READ-only side (shape 1). It never proposes or sends — "act on
// this gap" (shape 2) crosses the Approve gate later. Fail-open (SC1): a grounding/skill hiccup
// yields an "insufficient" verdict, never a throw out of the loop.
//
// §2: uses the tenant-scoped wrappers (tenantMutation/tenantQuery) for identity-bearing paths and
// the internal* builders (allow-listed, like plans.ts/vaultGround.ts) for the identity-less engine.
import {
  BMC_SKILL,
  GROWTH_OS_DIAGNOSTIC_SKILL,
  LEAN_CANVAS_SKILL,
  SWOT_SKILL,
} from "@pikar/contracts/skill";
import { deserializeProfile } from "@pikar/core";
import {
  diagnose,
  emptyScorecard,
  leverageRank,
  type Prescription,
  type Scorecard,
} from "@pikar/core/growth/index";
import { categoryFor } from "@pikar/vault";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import type { DatabaseWriter, MutationCtx } from "./_generated/server";
import { internalAction, internalMutation, internalQuery } from "./_generated/server";
import { tenantMutation, tenantQuery } from "./lib/functions";
import { contentHash } from "./lib/hash";
import schema from "./schema";
import { startIngest } from "./vaultIngest";

// Derive the row validators from the schema (the agentSteps.ts rung-2 precedent) so insertEvaluation
// can never drift from the table shape.
const evalFields = schema.tables.evaluations.validator.fields;

type Framework = "swot" | "lean" | "bmc" | "growth-os";

// Framework → the gated rubric skill the engine loads (12-02). Auto-pick maps persona when there
// are no financials; an explicit `framework` arg overrides.
const FRAMEWORK_SKILL: Record<Framework, string> = {
  "growth-os": GROWTH_OS_DIAGNOSTIC_SKILL,
  swot: SWOT_SKILL,
  lean: LEAN_CANVAS_SKILL,
  bmc: BMC_SKILL,
};
const PERSONA_FRAMEWORK: Record<string, Framework> = {
  solopreneur: "lean",
  startup: "bmc",
  sme: "swot",
};

// The Scorecard dot-paths the deterministic engine can ground + cite. Each carries its UI label +
// framework section. A field NOT here stays null (not-enough-data) — never fabricated.
const TRACKED: Record<string, { label: string; section: string }> = {
  businessName: { label: "Business", section: "identity" },
  "identity.niche": { label: "What it does", section: "identity" },
  "identity.avatar": { label: "Target customer", section: "identity" },
  "identity.currentOffers": { label: "Offer", section: "identity" },
  "identity.headlinePrice": { label: "Headline price", section: "identity" },
  "financials.cac": { label: "CAC", section: "financials" },
  "financials.ltgp": { label: "LTGP", section: "financials" },
  "financials.thirtyDayCashPerCustomer": { label: "30-day cash / customer", section: "financials" },
};

// Labeled-number scan: only a DIRECT statement ("CAC: $150") fills a financial field — the honest,
// conservative extraction (SC #1). No match → the field stays null → not-enough-data, never a guess.
const FINANCIAL_PATTERNS: { field: string; re: RegExp }[] = [
  { field: "financials.cac", re: /\bCAC\b[^\d$]*\$?\s*([\d,]+(?:\.\d+)?)/i },
  { field: "financials.ltgp", re: /\bLTGP\b[^\d$]*\$?\s*([\d,]+(?:\.\d+)?)/i },
  {
    field: "financials.thirtyDayCashPerCustomer",
    re: /30[-\s]?day cash[^\d$]*\$?\s*([\d,]+(?:\.\d+)?)/i,
  },
  { field: "identity.headlinePrice", re: /\bprice\b[^\d$]*\$?\s*([\d,]+(?:\.\d+)?)/i },
];

// The default grounding query when the caller (the cockpit tool, plan 06) supplies none. In tests
// the SMOKE:: seam rides in via the `query` arg (zero network); in prod this hits rag.search.
const DEFAULT_QUERY = "business profile offer financials leads market position";

/** Read a Scorecard dot-path (null-safe). */
function getPath(obj: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((o, k) => (o == null ? undefined : (o as Record<string, unknown>)[k]), obj);
}

/** Return a CLONE with the dot-path set (JSON-clone — the Scorecard is JSON-safe). */
function setPath<T>(obj: T, path: string, value: unknown): T {
  const clone = JSON.parse(JSON.stringify(obj)) as Record<string, unknown>;
  const keys = path.split(".");
  let cur = clone;
  for (let i = 0; i < keys.length - 1; i++) cur = cur[keys[i] as string] as Record<string, unknown>;
  cur[keys[keys.length - 1] as string] = value;
  return clone as T;
}

/**
 * The BEVL-03 "what changed" line (13-01). Named + explicit because `runEvaluation` RETURNS it and
 * it is derived from `last` (an `internal.evaluations.lastForThread` result). Without an explicit
 * annotation on both this and the handler's return, the action's return type resolves through
 * `internal` → `api.d.ts` → back to `runEvaluation`: TypeScript detects the cycle, silently degrades
 * the WHOLE generated API to `any`/`{}`, and ~90 unrelated `apps/web` errors appear (Pitfall 9 —
 * measured: web typecheck went from exit 0 to 90 errors with the annotation missing).
 */
type EvaluationDelta = { newFindings: number; gapsClosed: string[]; gapsOpened: string[] };

type Provenance = {
  docId?: string;
  title: string;
  confidence: "high" | "medium" | "low";
  source: "vault" | "user-provided";
};

/** Latest row for a thread (carry-forward source + the card read). Append-only → order desc. */
export const lastForThread = internalQuery({
  args: { tenantId: v.string(), threadId: v.string() },
  handler: async (ctx, { tenantId, threadId }) =>
    await ctx.db
      .query("evaluations")
      .withIndex("by_tenant_thread", (q) => q.eq("tenantId", tenantId).eq("threadId", threadId))
      .order("desc")
      .first(),
});

/** The ONE content-plane write surface for an evaluation row (findings/gaps are NEVER audited). */
export const insertEvaluation = internalMutation({
  args: {
    tenantId: evalFields.tenantId,
    threadId: evalFields.threadId,
    framework: evalFields.framework,
    findings: evalFields.findings,
    gaps: evalFields.gaps,
    notEnoughData: evalFields.notEnoughData,
    scorecard: evalFields.scorecard,
    userProvided: evalFields.userProvided,
    verdict: evalFields.verdict,
    delta: evalFields.delta,
  },
  handler: async (ctx, args) =>
    await ctx.db.insert("evaluations", { ...args, createdAt: Date.now() }),
});

/**
 * The engine. Carry-forward → ground → load rubric → fill Scorecard → diagnose → persist → audit →
 * step. `query` is an EXPLICIT arg (the vaultGroundHydrated convention) so the tool loop + tests
 * carry no live identity; absent → the default query. Fails open into an "insufficient" verdict.
 */
export const runEvaluation = internalAction({
  args: {
    tenantId: v.string(),
    threadId: v.string(),
    framework: v.optional(evalFields.framework),
    query: v.optional(v.string()),
    withDelta: v.optional(v.boolean()),
  },
  handler: async (
    ctx,
    { tenantId, threadId, framework, query, withDelta },
  ): Promise<{
    verdict: "gaps" | "healthy" | "insufficient";
    findingCount: number;
    gapCount: number;
    delta: EvaluationDelta | undefined;
  }> => {
    const turnId = crypto.randomUUID();
    const stepKey = "evaluateBusiness";
    const startedAt = Date.now();
    await ctx.runMutation(internal.agentSteps.record, {
      tenantId,
      threadId,
      turnId,
      stepKey,
      tool: "evaluateBusiness",
      startedAt,
    });

    try {
      // ── Carry forward (LOCKED store half): the prior Scorecard + the user-provided keys ────────
      const last = await ctx.runQuery(internal.evaluations.lastForThread, { tenantId, threadId });
      const userProvided: string[] = [...(last?.userProvided ?? [])];
      let scorecard: Scorecard = JSON.parse(
        JSON.stringify((last?.scorecard as Scorecard | undefined) ?? emptyScorecard),
      );

      const provenance = new Map<string, Provenance>();
      // A carried user-provided figure is cited honestly + never re-asked.
      for (const field of userProvided) {
        if (getPath(scorecard, field) != null) {
          provenance.set(field, { title: "user-provided", confidence: "high", source: "user-provided" });
        }
      }

      // ── Ground (reuse vaultGroundHydrated — FAIL OPEN, SC1) ────────────────────────────────────
      let docIds: string[] = [];
      let titles: string[] = [];
      let chunks: string[] = [];
      try {
        ({ docIds, titles, chunks } = await ctx.runAction(
          internal.vaultGround.vaultGroundHydrated,
          { tenantId, query: query ?? DEFAULT_QUERY },
        ));
      } catch {
        // fail open — no grounding this run; carried values still stand.
      }

      // ── Authoritative seed: the user's OWN profile docs, PREPENDED ────────────────────────────
      // Similarity alone cannot answer "evaluate MY business": rag.search takes its top-K by CHUNK,
      // so one large reference PDF can occupy every seed slot and the user's own profile never
      // enters the corpus (observed live — grounding returned a single 300-page book, and the
      // engine honestly reported "not enough data"). Prepending matters: `fillVault` keeps the
      // FIRST value it sees for a path, so the user's own figures beat any book prose.
      try {
        const seeds = await ctx.runQuery(internal.vault.profileSeedDocs, { tenantId });
        const fresh = seeds.filter((s) => !docIds.includes(s.docId));
        docIds = [...fresh.map((s) => s.docId), ...docIds];
        titles = [...fresh.map((s) => s.title), ...titles];
        chunks = [...fresh.map((s) => s.text), ...chunks];
      } catch {
        // fail open — retrieval-only grounding still stands.
      }

      // ── Fill remaining nulls from grounded text (profile parse + labeled-number scan) ──────────
      let personaHint: string | undefined;
      for (let i = 0; i < chunks.length; i++) {
        const text = chunks[i] ?? "";
        const docId = docIds[i];
        const title = titles[i] ?? "";
        const fillVault = (path: string, value: unknown): void => {
          if (value == null || value === "") return;
          // An EMPTY ARRAY counts as unset. `emptyScorecard.identity.currentOffers` is `[]`, not
          // null, so a bare `!= null` guard skipped it forever — `hasOffer` stayed false and
          // diagnose() returned Gate 1 ("No offer worth buying yet") for EVERY vault-grounded run,
          // masking the real constraint. The caller's own `.length === 0` check shows the intent.
          const current = getPath(scorecard, path);
          const isUnset = current == null || (Array.isArray(current) && current.length === 0);
          // The VALUE is first-write-wins (carried/user-provided/earlier-doc beats a later doc)…
          if (isUnset) scorecard = setPath(scorecard, path, value);
          // …but the CITATION is recorded whenever a doc actually states the field, even when the
          // slot was already filled by carry-forward. Provenance is NOT persisted on the row, so a
          // re-run over the same documents used to re-cite nothing: every carried value hit the
          // `!isUnset` early return, `findings` collapsed toward zero, the engine then suppressed
          // gaps (SC #1) and the delta reported a false "gaps closed". That is fatal for BEVL-03,
          // which by design re-runs weekly on ONE pinned thread. First writer of the citation wins
          // so a pre-seeded user-provided entry is never downgraded to a vault cite.
          if (!provenance.has(path)) {
            provenance.set(path, { docId, title, confidence: "high", source: "vault" });
          }
        };

        if (text.includes("- **Persona:**")) {
          const p = deserializeProfile(text);
          personaHint = p.persona;
          fillVault("businessName", p.name);
          fillVault("identity.niche", p.oneLineDescription);
          fillVault("identity.avatar", p.targetCustomer);
          // No `.length === 0` pre-check: fillVault owns both the empty-array unset rule AND the
          // re-citation rule, and short-circuiting here would skip the citation on a re-run.
          if (p.offering) fillVault("identity.currentOffers", [p.offering]);
        }

        for (const { field, re } of FINANCIAL_PATTERNS) {
          // No "already set → skip" guard: fillVault keeps the carried/user-provided VALUE and the
          // pre-seeded user-provided CITATION, while still re-citing a vault-sourced figure the
          // document restates. Skipping here is what made week 2's finding count collapse.
          const m = re.exec(text);
          if (!m) continue;
          const n = Number((m[1] ?? "").replace(/,/g, ""));
          if (!Number.isNaN(n)) fillVault(field, n);
        }
      }

      // ── Auto-pick framework: financials present → growth-os; else persona map; arg overrides ───
      const financialsPresent =
        scorecard.financials.cac != null ||
        scorecard.financials.ltgp != null ||
        scorecard.financials.thirtyDayCashPerCustomer != null ||
        scorecard.identity.headlinePrice != null;
      const chosen: Framework =
        framework ??
        (financialsPresent ? "growth-os" : (PERSONA_FRAMEWORK[personaHint ?? "solopreneur"] ?? "lean"));

      // ── Load the rubric method (fail-closed-if-missing → fail-open verdict) ─────────────────────
      let skillOk = true;
      try {
        await ctx.runQuery(internal.skills.getActiveSkill, { name: FRAMEWORK_SKILL[chosen] });
      } catch {
        skillOk = false;
      }

      // ── Build cited findings from provenance (fresh-grounded OR carried user-provided) ─────────
      const findings = [];
      for (const [field, prov] of provenance) {
        const value = getPath(scorecard, field);
        if (value == null) continue;
        const meta = TRACKED[field];
        if (!meta) continue;
        const shown = Array.isArray(value) ? value.join(", ") : String(value);
        findings.push({
          label: `${meta.label}: ${shown}`,
          section: meta.section,
          citationDocId: prov.docId,
          citationTitle: prov.title,
          confidence: prov.confidence,
          source: prov.source,
        });
      }

      // ── Pure diagnosis → leverage-ranked gaps + honest not-enough-data ─────────────────────────
      const prescription = diagnose(scorecard);
      const ranked = leverageRank([prescription]);
      const gaps = [];
      const notEnoughData = [];
      for (const rx of ranked) {
        if (rx.ask) {
          notEnoughData.push({ section: "financials", needs: rx.ask });
          continue;
        }
        if (rx.gate === "scale") continue; // healthy — no gap
        gaps.push({
          label: rx.constraint,
          leverageRank: gateOrder(rx.gate),
          route: rx.route,
          playbook: rx.playbook,
          // Carry the prescription's own prose onto the row (12-05) so the memo body is a pure READ
          // of what was diagnosed — never a second, drift-prone re-derivation at act time.
          reason: rx.reason,
          proofMetric: rx.proofMetric,
        });
      }
      // Nothing grounded or carried → no honest basis for a prescription: suppress gaps (a gap
      // without a grounded finding would be a fabricated diagnosis, SC #1) and nudge instead.
      if (findings.length === 0) {
        gaps.length = 0;
        if (notEnoughData.length === 0) {
          notEnoughData.push({
            section: "identity",
            needs: "Add a business profile or documents to your vault so I can assess this.",
          });
        }
      }

      const verdict: "gaps" | "healthy" | "insufficient" = !skillOk
        ? "insufficient"
        : findings.length === 0
          ? "insufficient" // thin-data honesty: no grounded findings → not enough to assess
          : prescription.gate === "scale"
            ? "healthy"
            : gaps.length > 0
              ? "gaps"
              : "insufficient";

      // ── "What changed" (BEVL-03) — pure arithmetic over values already in memory ───────────────
      // Keyed on `${route}/${playbook}`, NOT route alone: diagnose() only ever emits three routes
      // and several distinct prescriptions share each, so a route-only key would report a real move
      // (e.g. "no offer yet" → "offer is a commodity", both offer-architect) as "no change".
      // `playbook` is a code-owned string literal, never LLM prose — the objection to keying on
      // `label` does not apply to it. Arrays (not a scalar) so a future multi-prescription
      // diagnose() needs no shape change.
      const gapKey = (g: { route: string; playbook: string }) => `${g.route}/${g.playbook}`;
      const prevKeys = new Set((last?.gaps ?? []).map(gapKey));
      const nextKeys = new Set(gaps.map(gapKey));
      const delta: EvaluationDelta | undefined =
        withDelta && last
          ? {
              // Clamped: a DROP in findings is not "new findings", and the card only renders > 0.
              newFindings: Math.max(0, findings.length - (last.findings?.length ?? 0)),
              gapsClosed: [...prevKeys].filter((k) => !nextKeys.has(k)),
              gapsOpened: [...nextKeys].filter((k) => !prevKeys.has(k)),
            }
          : undefined;

      // ── Persist ONE content-plane row ──────────────────────────────────────────────────────────
      await ctx.runMutation(internal.evaluations.insertEvaluation, {
        tenantId,
        threadId,
        framework: chosen,
        findings,
        gaps,
        notEnoughData,
        scorecard,
        userProvided,
        verdict,
        delta,
      });

      // ── ONE refs-only audit: counts + enums ONLY, never a finding/citation string (§4) ─────────
      await ctx.runMutation(internal.audit.log, {
        tenantId,
        correlationId: turnId,
        eventType: "evaluation.ran",
        actor: "system",
        payload: {
          framework: chosen,
          verdict,
          findingCount: findings.length,
          gapCount: gaps.length,
          groundedDocCount: docIds.length,
          userProvidedCount: userProvided.length,
        },
      });

      await ctx.runMutation(internal.agentSteps.finish, {
        tenantId,
        turnId,
        stepKey,
        phase: "done",
        durationMs: Date.now() - startedAt,
        endedAt: Date.now(),
      });

      return { verdict, findingCount: findings.length, gapCount: gaps.length, delta };
    } catch {
      // Fail open (SC1): never throw out of the governed loop.
      await ctx.runMutation(internal.agentSteps.finish, {
        tenantId,
        turnId,
        stepKey,
        phase: "error",
        endedAt: Date.now(),
      });
      // Both branches share ONE return shape — a union return is what collapses Convex's internal
      // API type inference (Pitfall 9).
      return { verdict: "insufficient" as const, findingCount: 0, gapCount: 0, delta: undefined };
    }
  },
});

/** Gate → leverage order (Market<Offer<Money<Leads<Scale) — lower = fix first. */
function gateOrder(g: Prescription["gate"]): number {
  return g === "scale" ? 4 : g;
}

/**
 * The "store" persistence path: a user's in-conversation answer to a missing figure. Writes the
 * value into the latest row's Scorecard + adds the dot-path to userProvided[] so the NEXT
 * runEvaluation carries it forward (never re-asks) and cites any finding on it "user-provided".
 * Tenant-guarded (§2). No prior row (answer before the first evaluation) → seed a minimal carrier
 * row so the figure still survives forward.
 */
/**
 * The shared store logic — patch the latest row's Scorecard (adding the dot-path to userProvided[]),
 * or seed a minimal carrier row when the user answers before the first evaluation. Takes an explicit
 * `tenantId` so BOTH the auth-scoped tenantMutation (client path) and the internal mutation (the
 * identity-free cockpit tool loop, plan 04) route through ONE implementation — no drift.
 */
async function applyScorecardAnswer(
  db: DatabaseWriter,
  tenantId: string,
  threadId: string,
  field: string,
  value: number | string | boolean,
): Promise<{ recorded: true }> {
  const last = await db
    .query("evaluations")
    .withIndex("by_tenant_thread", (q) => q.eq("tenantId", tenantId).eq("threadId", threadId))
    .order("desc")
    .first();

  if (last) {
    const scorecard = setPath(last.scorecard, field, value);
    const userProvided = last.userProvided.includes(field)
      ? last.userProvided
      : [...last.userProvided, field];
    await db.patch(last._id, { scorecard, userProvided });
    return { recorded: true };
  }

  // No evaluation yet — seed a minimal carrier so the answer survives into the first run.
  await db.insert("evaluations", {
    tenantId,
    threadId,
    framework: "growth-os",
    findings: [],
    gaps: [],
    notEnoughData: [],
    scorecard: setPath(emptyScorecard, field, value),
    userProvided: [field],
    verdict: "insufficient",
    createdAt: Date.now(),
  });
  return { recorded: true };
}

export const recordScorecardAnswer = tenantMutation({
  args: {
    threadId: v.string(),
    field: v.string(),
    value: v.union(v.number(), v.string(), v.boolean()),
  },
  handler: (ctx, { threadId, field, value }) =>
    applyScorecardAnswer(ctx.db, ctx.tenantId, threadId, field, value),
});

/**
 * The internal store surface for the cockpit `recordScorecardAnswer` tool (plan 04). The tool loop
 * carries an EXPLICIT tenantId and NO live identity (the searchVault/runEvaluation convention), so
 * it cannot call the auth-scoped tenantMutation above — this internal twin takes the tenantId
 * directly. Same one implementation, so the two can never diverge.
 */
export const recordScorecardAnswerInternal = internalMutation({
  args: {
    tenantId: v.string(),
    threadId: v.string(),
    field: v.string(),
    value: v.union(v.number(), v.string(), v.boolean()),
  },
  handler: (ctx, { tenantId, threadId, field, value }) =>
    applyScorecardAnswer(ctx.db, tenantId, threadId, field, value),
});

// ── The ACTING side (BEVL-02, 12-05): a gap → an approvable next-step memo ────────────────────
//
// Shape 2 of the two-shapes rule. The review above stays READ-ONLY; "Act on this" is the only
// control that crosses into the plan → Approve → terminal spine, and it reuses that spine verbatim
// (insertPlan/resetPlan/patchPlan) — NO new proposal store. Building the actual fix (the offer, the
// campaign) is Phase 15+; the memo is the honest Phase-12 stand-in: it NAMES the target specialist
// skill and cites its playbook, it does not run it.

/** Statuses a thread's plan row may be recycled from. Anything else is mid-flight or delivered. */
const ACTABLE_PLAN_STATUS: ReadonlySet<Doc<"plans">["status"]> = new Set([
  "collecting",
  "proposed",
  "canceled",
] as const);

/**
 * Compose the memo body from what was DIAGNOSED — a deterministic template over the persisted row
 * (§5: this is a document the user reads, not an agent prompt; nothing here is model-authored and
 * no metric is invented). Every claim is either a cited grounded finding or the prescription's own
 * prose, so an approved memo can never assert a number the evaluation did not ground.
 */
function buildMemo(row: Doc<"evaluations">, gap: Doc<"evaluations">["gaps"][number]): string {
  const grounded = row.findings.map((f) => `- ${f.label} [${f.citationTitle}]`).join("\n");
  return [
    `# Next step: ${gap.label}`,
    "",
    `Diagnosed on the **${row.framework}** framework. This is the highest-leverage constraint —`,
    "the gates run Market → Offer → Money model → Leads and the first failing one is the only one",
    "worth working on.",
    "",
    "## Why this first",
    gap.reason ?? "It is the first failing gate — everything downstream compounds off it.",
    "",
    "## What this is grounded in",
    grounded || "- (no grounded findings on file)",
    "",
    "## The next step",
    `Run the **${gap.route}** specialist against its \`${gap.playbook}\` playbook.`,
    "That specialist does not execute yet — approving this memo SAVES it to your vault as the",
    "agreed next action. Nothing is sent to anyone.",
    "",
    "## Done when",
    gap.proofMetric || "the constraint above no longer blocks the next gate.",
    "",
  ].join("\n");
}

/**
 * Turn a surfaced gap into a PROPOSED memo-plan (BEVL-02). Tenant-scoped (§2) and UI-driven, so it
 * carries live identity — no internal twin is needed (unlike the tool-loop writes above).
 *
 * It REUSES the thread's single `plans` row rather than inserting a second one: `plans.byThread`
 * is a `.unique()` read, so a second row for the same thread would throw for every reader of the
 * workspace. A row that is mid-flight or already delivered is refused outright (`plan_busy`) —
 * staging a memo must never clobber an in-flight send.
 */
export const actOnGap = tenantMutation({
  args: { threadId: v.string(), gapIndex: v.number() },
  handler: async (
    ctx,
    { threadId, gapIndex },
  ): Promise<{ ok: true; planId: Id<"plans"> } | { ok: false; reason: "gap_not_found" | "plan_busy" }> => {
    const row = await ctx.db
      .query("evaluations")
      .withIndex("by_tenant_thread", (q) => q.eq("tenantId", ctx.tenantId).eq("threadId", threadId))
      .order("desc")
      .first();
    const gap = row?.gaps[gapIndex];
    // A healthy (or thin-data) evaluation carries no gaps — there is simply nothing to act on, and
    // nothing crosses the Approve gate. Same answer for a stale index.
    if (!row || !gap) return { ok: false, reason: "gap_not_found" };

    const plan = await ctx.db
      .query("plans")
      .withIndex("by_thread", (q) => q.eq("tenantId", ctx.tenantId).eq("threadId", threadId))
      .unique();
    if (plan && !ACTABLE_PLAN_STATUS.has(plan.status)) return { ok: false, reason: "plan_busy" };

    let planId: Id<"plans">;
    if (plan) {
      planId = plan._id;
      // resetPlan, not patchPlan: patchPlan DROPS undefined so it can never clear a filled slot —
      // a half-composed email's recipients/attachments would survive onto the memo.
      await ctx.runMutation(internal.plans.resetPlan, { planId });
    } else {
      planId = await ctx.runMutation(internal.plans.insertPlan, {
        tenantId: ctx.tenantId,
        threadId,
      });
    }
    await ctx.runMutation(internal.plans.patchPlan, {
      planId,
      kind: "memo",
      recipients: [], // a memo has no recipients — it is not an email
      subject: `Next step: ${gap.label}`.slice(0, 120),
      body: buildMemo(row, gap),
      status: "proposed", // the pinned collecting→proposed spine, unchanged
    });
    return { ok: true, planId };
  },
});

/**
 * The MEMO TERMINAL — what Approve means for a memo-plan. Called from `executePlan` (cockpit.ts)
 * BEFORE the mailbox pre-check, so a memo never touches `deliverApprovedPlan`/`gmail.send`: it
 * seeds no `requests` rows and starts no fan-out workflow. The body persists as an ordinary
 * `next_step_memo` vault doc (the persistBrief precedent — tenant scope + embedding + retrieval
 * come free from `startIngest`), so the agreed next action is groundable from then on.
 * `text` carries the memo verbatim — vault CONTENT, not a log (§4).
 * ponytail: no new workflow or fan-out; the laziest correct terminal is a persist + a status flip.
 */
export async function persistNextStepMemo(
  ctx: MutationCtx,
  plan: Doc<"plans">,
): Promise<Id<"vaultDocuments">> {
  const markdown = plan.body ?? "";
  const vaultDocId = await ctx.db.insert("vaultDocuments", {
    tenantId: plan.tenantId,
    title: plan.subject?.trim() || "Next step memo",
    kind: "next_step_memo",
    category: categoryFor({ source: "agent" }), // workspace-docs — a generated doc, not an upload
    source: "evaluation",
    mimeType: "text/markdown",
    size: new TextEncoder().encode(markdown).length,
    contentHash: await contentHash(markdown),
    text: markdown,
    status: "processing",
    createdAt: Date.now(),
  });
  await startIngest(ctx, {
    vaultDocId,
    tenantId: plan.tenantId,
    correlationId: crypto.randomUUID(),
  });
  return vaultDocId;
}

/** The tenant's latest evaluation row for a thread → feeds the EVALUATION card (plan 04). */
export const byThread = tenantQuery({
  args: { threadId: v.string() },
  handler: async (ctx, { threadId }) =>
    await ctx.db
      .query("evaluations")
      .withIndex("by_tenant_thread", (q) =>
        q.eq("tenantId", ctx.tenantId).eq("threadId", threadId),
      )
      .order("desc")
      .first(),
});
