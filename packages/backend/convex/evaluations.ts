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
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { DatabaseWriter } from "./_generated/server";
import { internalAction, internalMutation, internalQuery } from "./_generated/server";
import { tenantMutation, tenantQuery } from "./lib/functions";
import schema from "./schema";

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
  },
  handler: async (ctx, { tenantId, threadId, framework, query }) => {
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

      // ── Fill remaining nulls from grounded text (profile parse + labeled-number scan) ──────────
      let personaHint: string | undefined;
      for (let i = 0; i < chunks.length; i++) {
        const text = chunks[i] ?? "";
        const docId = docIds[i];
        const title = titles[i] ?? "";
        const fillVault = (path: string, value: unknown): void => {
          if (value == null || value === "" || getPath(scorecard, path) != null) return;
          scorecard = setPath(scorecard, path, value);
          provenance.set(path, { docId, title, confidence: "high", source: "vault" });
        };

        if (text.includes("- **Persona:**")) {
          const p = deserializeProfile(text);
          personaHint = p.persona;
          fillVault("businessName", p.name);
          fillVault("identity.niche", p.oneLineDescription);
          fillVault("identity.avatar", p.targetCustomer);
          if (p.offering && scorecard.identity.currentOffers.length === 0) {
            fillVault("identity.currentOffers", [p.offering]);
          }
        }

        for (const { field, re } of FINANCIAL_PATTERNS) {
          if (getPath(scorecard, field) != null) continue; // carried/user-provided wins
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

      return { verdict, findingCount: findings.length, gapCount: gaps.length };
    } catch {
      // Fail open (SC1): never throw out of the governed loop.
      await ctx.runMutation(internal.agentSteps.finish, {
        tenantId,
        turnId,
        stepKey,
        phase: "error",
        endedAt: Date.now(),
      });
      return { verdict: "insufficient" as const, findingCount: 0, gapCount: 0 };
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
