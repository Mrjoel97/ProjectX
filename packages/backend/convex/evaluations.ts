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
import {
  deserializeProfile,
  resolveSpecialist,
  specialistMemoBody,
  type Tier,
} from "@pikar/core";
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

// Framework → the gated rubric skill the engine loads (12-02). Auto-pick maps the tenant's TIER
// when there are no financials; an explicit `framework` arg overrides.
const FRAMEWORK_SKILL: Record<Framework, string> = {
  "growth-os": GROWTH_OS_DIAGNOSTIC_SKILL,
  swot: SWOT_SKILL,
  lean: LEAN_CANVAS_SKILL,
  bmc: BMC_SKILL,
};
// Tier → rubric. The `satisfies Record<Tier, Framework>` bind is the point: a new tier literal
// becomes a COMPILE error here instead of silently falling through a `??` into "lean". `enterprise`
// is operator-granted (D6) and never derived, so an SME-shaped rubric is the honest default for it.
const TIER_FRAMEWORK = {
  solopreneur: "lean",
  startup: "bmc",
  sme: "swot",
  enterprise: "swot",
} as const satisfies Record<Tier, Framework>;

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
  return path
    .split(".")
    .reduce<unknown>((o, k) => (o == null ? undefined : (o as Record<string, unknown>)[k]), obj);
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
    // DELIBERATELY PINNED, NOT DERIVED — do not "simplify" this back to `evalFields.framework`.
    // Phase 14 widened `evaluations.framework` with the voice-doc `"document-review"` literal, and
    // `evalFields` feeds TWO signatures: insertEvaluation's write surface (:139, which SHOULD widen
    // for free) and this engine entrypoint (which must NOT). A doc-review row is written straight
    // through insertEvaluation by `voiceDoc.ts`; it has no rubric skill and no diagnose() path, so
    // runEvaluation must refuse it at the VALIDATOR BOUNDARY — not merely at the FRAMEWORK_SKILL
    // lookup below (14-RESEARCH Pitfall 2). Deriving it here also breaks `const chosen: Framework`
    // at the type level. Approved deviation 2026-07-25 (14-01); recorded in PARALLELIZATION.md.
    framework: v.optional(
      v.union(v.literal("swot"), v.literal("lean"), v.literal("bmc"), v.literal("growth-os")),
    ),
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
      // ── The tier: read ONCE from its table, the ONLY authority for the rubric pick (design §4.2).
      // This is an `internalAction` with no live identity, so the tenant travels as an explicit
      // validated arg through the internal query — the `vaultGroundHydrated` convention.
      const tp = await ctx.runQuery(internal.tenantProfile.forTenant, { tenantId });
      const userProvided: string[] = [...(last?.userProvided ?? [])];
      let scorecard: Scorecard = JSON.parse(
        JSON.stringify((last?.scorecard as Scorecard | undefined) ?? emptyScorecard),
      );

      const provenance = new Map<string, Provenance>();
      // A carried user-provided figure is cited honestly + never re-asked.
      for (const field of userProvided) {
        if (getPath(scorecard, field) != null) {
          provenance.set(field, {
            title: "user-provided",
            confidence: "high",
            source: "user-provided",
          });
        }
      }

      // ── Ground (reuse vaultGroundHydrated — FAIL OPEN, SC1) ────────────────────────────────────
      let docIds: string[] = [];
      let titles: string[] = [];
      let chunks: string[] = [];
      let spine: string | null = null;
      try {
        ({ docIds, titles, chunks, spine } = await ctx.runAction(
          internal.vaultGround.vaultGroundHydrated,
          { tenantId, query: query ?? DEFAULT_QUERY },
        ));
      } catch {
        // fail open — no grounding this run; carried values still stand.
      }

      // BLPR-02 SEAM 2: the confirmed blueprint, consumed EXPLICITLY (it is a separate return
      // field, never an entry in the retrieval arrays). Placed here so the profileSeedDocs block
      // BELOW prepends over it: the final order is [profile seeds, blueprint, retrieval].
      let blueprintDocId: string | null = null;
      if (spine) {
        try {
          const bp = await ctx.runQuery(internal.blueprint.liveForTenant, { tenantId });
          if (bp) {
            blueprintDocId = bp.docId;
            docIds = [bp.docId, ...docIds];
            titles = ["Business blueprint", ...titles];
            chunks = [spine, ...chunks];
          }
        } catch {
          // fail open — profile-seed + retrieval grounding still stands.
        }
      }
      // ponytail: PROVENANCE CEILING. FINANCIAL_PATTERNS scans every chunk and fillVault records
      // first-write-wins provenance, so a figure restated only by the Blueprint is attributed to
      // "Business blueprint", not the source document mergeBlueprint derived it from. Upgrade
      // path: suppress numerics in the serialized spine.

      // ── Authoritative seed: the user's OWN profile docs, PREPENDED ────────────────────────────
      // Similarity alone cannot answer "evaluate MY business": rag.search takes its top-K by CHUNK,
      // so one large reference PDF can occupy every seed slot and the user's own profile never
      // enters the corpus (observed live — grounding returned a single 300-page book, and the
      // engine honestly reported "not enough data"). Prepending matters: `fillVault` keeps the
      // FIRST value it sees for a path, so the user's own figures beat any book prose.
      try {
        const seeds = await ctx.runQuery(internal.vault.profileSeedDocs, { tenantId });
        if (blueprintDocId) {
          // A profile seed can already be a retrieval hit. Merely prepending `fresh` seeds would
          // leave that hit behind the Blueprint, allowing a derived number to beat the user's own
          // typed value. Move every seed to the front only on the Blueprint path; with no
          // Blueprint the pre-17.1 `fresh` behavior below stays byte-identical.
          const seedIds = new Set(seeds.map((s) => s.docId));
          const retrieval = docIds
            .map((docId, i) => ({ docId, title: titles[i] ?? "", chunk: chunks[i] ?? "" }))
            .filter(({ docId }) => !seedIds.has(docId));
          docIds = [...seeds.map((s) => s.docId), ...retrieval.map((r) => r.docId)];
          titles = [...seeds.map((s) => s.title), ...retrieval.map((r) => r.title)];
          chunks = [...seeds.map((s) => s.text), ...retrieval.map((r) => r.chunk)];
        } else {
          const fresh = seeds.filter((s) => !docIds.includes(s.docId));
          docIds = [...fresh.map((s) => s.docId), ...docIds];
          titles = [...fresh.map((s) => s.title), ...titles];
          chunks = [...fresh.map((s) => s.text), ...chunks];
        }
      } catch {
        // fail open — retrieval-only grounding still stands.
      }

      // ── Fill remaining nulls from grounded text (profile parse + labeled-number scan) ──────────
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

        // A `business_profile` DETECTOR, and nothing more. The `- **Persona:**` line is a
        // PROJECTION of `tenantProfiles.tier` (design §4.2) and SELECTS NO BEHAVIOUR: this block
        // fills CONTENT fields only (name / niche / avatar / offers). `deserializeProfile` still
        // falls back to `"solopreneur"` on a garbled line, and that is harmless precisely because
        // nothing authoritative reads it — reading a tier back out of here re-creates defect 1d.
        // The tier is read ONCE, from its table, at the top of this handler.
        if (text.includes("- **Persona:**")) {
          const p = deserializeProfile(text);
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

      // ── Auto-pick framework: financials present → growth-os; else the TIER map; arg overrides ──
      //
      // Q3 (LOCKED): `financialsPresent` KEEPS overriding the tier. That override is correct —
      // financials mean a growth-os diagnosis is actually POSSIBLE — and the tier's perceivable
      // effect lands on voice / framing / the specialist prompt (ADR-009), which is unconditional.
      // SC#5 must NOT be read as "the rubric must change". Do not remove the override.
      const financialsPresent =
        scorecard.financials.cac != null ||
        scorecard.financials.ltgp != null ||
        scorecard.financials.thirtyDayCashPerCustomer != null ||
        scorecard.identity.headlinePrice != null;
      // No trailing `?? "lean"`: TIER_FRAMEWORK is bound `satisfies Record<Tier, Framework>` and the
      // index is narrowed to a `Tier` by `?? "solopreneur"`, so the lookup is TOTAL. A `??` here
      // would be a branch that can never be taken — an assertion that can never fail. Do not re-add
      // it "for safety"; widening `Tier` is meant to break the MAP, loudly, at compile time.
      const chosen: Framework =
        framework ?? (financialsPresent ? "growth-os" : TIER_FRAMEWORK[tp?.tier ?? "solopreneur"]);

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

// The cockpit tool's JSON schema types `value` as a STRING (llm.ts:1813), so a boolean leaf
// receives "false" — and "false" is TRUTHY, so diagnose()'s filter(Boolean) presence counts read a
// known-ABSENT offer type / channel as PRESENT. Measured: run c1fe054c fixture 30 stored
// offerTypesPresent={attraction:"true",continuity:"false",downsell:"false",upsell:"false"} and
// diagnose returned "scale"/healthy/0 gaps. Coerce at the one choke point every writer routes
// through (recordScorecardAnswer + recordScorecardAnswerInternal).
//
// `typeof getPath(emptyScorecard, field) === "boolean"` covers every presence map with no
// hand-maintained list (scorecard.ts:125,130 default them to real `false`); NULLABLE_BOOL adds only
// the three whose default is `null`. `identity.currentOffers` deliberately falls through untouched
// (`typeof [] === "object"`): `hasOffer` reads `.length > 0`, correct for a bare string too.
const NULLABLE_BOOL = new Set([
  "identity.marketViable",
  "identity.commodity",
  "modelCard.thirtyDayPayback",
]);
const NUMERIC =
  /^(financials\.|identity\.headlinePrice$|position\.roadmapLevel$|modelCard\.continuityTakePct$|offerCard\.valueEquation\.)/;

function coerceScorecardValue(
  field: string,
  value: number | string | boolean,
): number | string | boolean {
  if (typeof value !== "string") return value;
  const s = value.trim();
  if (typeof getPath(emptyScorecard, field) === "boolean" || NULLABLE_BOOL.has(field)) {
    if (/^(true|yes)$/i.test(s)) return true;
    if (/^(false|no|none)$/i.test(s)) return false;
    return value; // unparseable — leave it, never guess
  }
  if (NUMERIC.test(field)) {
    const n = Number(s.replace(/[$,]/g, "").replace(/\s*(dollars?|usd)$/i, ""));
    return Number.isFinite(n) ? n : value;
  }
  return value;
}

/**
 * The "store" persistence path: a user's in-conversation answer to a missing figure. Writes the
 * value into the latest row's Scorecard + adds the dot-path to userProvided[] so the NEXT
 * runEvaluation carries it forward (never re-asks) and cites any finding on it "user-provided".
 * Tenant-guarded (§2). No prior row (answer before the first evaluation) → seed a minimal carrier
 * row so the figure still survives forward.
 *
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
  // NOT named `v` — that is the convex/values validator import at module scope.
  const coerced = coerceScorecardValue(field, value);
  const last = await db
    .query("evaluations")
    .withIndex("by_tenant_thread", (q) => q.eq("tenantId", tenantId).eq("threadId", threadId))
    .order("desc")
    .first();

  if (last) {
    const scorecard = setPath(last.scorecard, field, coerced);
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
    scorecard: setPath(emptyScorecard, field, coerced),
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
 * Why a memo is being shown INSTEAD of a specialist's work, one calm sentence per governed stop.
 *
 * Code-owned map: the caller passes a reason CODE and never prose, and the code itself never
 * reaches the user (the PAUSED_REPLY / dispatch.ts refusal-reply precedent). An internal error
 * message must never land in a document the user reads, let alone one they can save to the vault.
 */
const FALLBACK_SENTENCE: Record<string, string> = {
  unknown_route: "I don't have a specialist I can run for this one, so what follows is the",
  depth_exceeded: "I keep this to a single hand-off, so rather than pass it on again here is the",
  cycle_refused: "We have already been round this one on this request, so here is the",
  budget_exhausted: "This request used up the budget I set aside for it, so here is the",
  error: "The specialist run did not finish, so here is the",
};
const FALLBACK_TAIL =
  "diagnosis it would have started from. Approving this memo SAVES it to your vault as the agreed" +
  " next action, and nothing is sent to anyone — ask me to try again whenever you like.";

/**
 * Compose the memo body from what was DIAGNOSED — a deterministic template over the persisted row
 * (§5: this is a document the user reads, not an agent prompt; nothing here is model-authored and
 * no metric is invented). Every claim is either a cited grounded finding or the prescription's own
 * prose, so an approved memo can never assert a number the evaluation did not ground.
 *
 * 15-04: this is now the FALLBACK, not the terminal. `fallbackReason` present ⇒ a specialist WAS
 * dispatched and stopped (refused, ceilinged out, or threw). Absent ⇒ the gap names no specialist
 * at all, which is the only branch where the 12-05 wording is still true.
 */
function buildMemo(
  row: Doc<"evaluations">,
  gap: Doc<"evaluations">["gaps"][number],
  fallbackReason?: string,
): string {
  const grounded = row.findings.map((f) => `- ${f.label} [${f.citationTitle}]`).join("\n");
  const nextStep =
    fallbackReason === undefined
      ? [
          // No specialist exists for this route — nothing was ever going to run, so this stays true.
          "That specialist does not execute yet — approving this memo SAVES it to your vault as the",
          "agreed next action. Nothing is sent to anyone.",
        ]
      : [`${FALLBACK_SENTENCE[fallbackReason] ?? FALLBACK_SENTENCE.error} ${FALLBACK_TAIL}`];
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
    ...nextStep,
    "",
    "## Done when",
    gap.proofMetric || "the constraint above no longer blocks the next gate.",
    "",
  ].join("\n");
}

export type ActOnGapResult =
  | { ok: true; planId: Id<"plans"> }
  | { ok: false; reason: "gap_not_found" | "plan_busy" };

/**
 * Turn a surfaced gap into an approvable next step (BEVL-02 → DISP-01).
 *
 * ONE implementation behind TWO surfaces, taking an EXPLICIT tenantId: the auth-scoped `actOnGap`
 * (the UI path, which carries live identity) and the identity-less `actOnGapInternal` (the golden-eval
 * harness — `npx convex run` has no identity). Same shape, and same reason, as
 * `applyScorecardAnswer` above: there must be no second copy of the terminal choice, the plan
 * recycle, or the scheduled dispatch to drift.
 *
 * It REUSES the thread's single `plans` row rather than inserting a second one: `plans.byThread`
 * is a `.unique()` read, so a second row for the same thread would throw for every reader of the
 * workspace. A row that is mid-flight or already delivered is refused outright (`plan_busy`) —
 * staging a memo must never clobber an in-flight send.
 *
 * 15-04 — TWO terminals, chosen by whether the gap names a REGISTERED specialist:
 *
 *   - **No specialist** (`diagnose()`'s deliberate `""` ask branch, its `"scale"` healthy branch,
 *     or any route written before the union closed): the 12-05 behaviour verbatim — the
 *     deterministic `buildMemo` template, `proposed`, nothing scheduled. There is nothing to run,
 *     so this IS the honest terminal. Resolving here also means the fail-closed guarantee holds at
 *     the ENTRY point as well as inside the dispatcher.
 *   - **A specialist**: stage `collecting` with NO body and schedule `internal.dispatch.runSpecialist`.
 *
 * This stays a `tenantMutation` — it does NOT become a `tenantAction`, and a later reader should
 * not "simplify" it back. A Convex mutation cannot call an action and the specialist takes 10-30s;
 * awaiting it in an action would make the recycle (`resetPlan` + `patchPlan`) interruptible and
 * still leave the card blank for the same 30s. Scheduling keeps the mutation atomic AND closes the
 * Approve race STRUCTURALLY: `executePlan` already returns `alreadyStarted` for anything that is
 * not `"proposed"` (cockpit.ts:530), so a `collecting` row is not approvable by construction — no
 * new guard, no new status literal, no `apps/web` change. `PlanCard` renders only at `proposed`
 * (cards.tsx:1624), so the CKPT-05 trace step is the progress indicator.
 *
 * 16-06 added a SECOND stager, `plans.stageResearchPlan`, for the async research dispatch. It is a
 * near-copy of the staging block below with a DELIBERATELY NARROWER recycle rule (it refuses a
 * `collecting` row and refuses a `proposed` EMAIL draft — read the comment there for why). The two
 * are not shared on purpose: the rules disagree, and a shared helper would need the rule as a
 * parameter. Change one and decide CONSCIOUSLY whether the other moves.
 */
async function applyActOnGap(
  ctx: MutationCtx,
  tenantId: string,
  threadId: string,
  gapIndex: number,
  // 16-09: the eval harness's --skill pins, forwarded to the scheduled specialist. Append-only and
  // ABSENT on the production `actOnGap` path, which must keep running the ACTIVE row.
  skillVersions?: Record<string, number>,
): Promise<ActOnGapResult> {
  const row = await ctx.db
    .query("evaluations")
    .withIndex("by_tenant_thread", (q) => q.eq("tenantId", tenantId).eq("threadId", threadId))
    .order("desc")
    .first();
  const gap = row?.gaps[gapIndex];
  // A healthy (or thin-data) evaluation carries no gaps — there is simply nothing to act on, and
  // nothing crosses the Approve gate. Same answer for a stale index.
  if (!row || !gap) return { ok: false, reason: "gap_not_found" };

  const plan = await ctx.db
    .query("plans")
    .withIndex("by_thread", (q) => q.eq("tenantId", tenantId).eq("threadId", threadId))
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
      tenantId: tenantId,
      threadId,
    });
  }
  const shared = {
    planId,
    kind: "memo" as const,
    recipients: [], // a memo has no recipients — it is not an email
    subject: `Next step: ${gap.label}`.slice(0, 120),
  };

  // The RUNTIME resolve is the terminal chooser. `gaps[].route` persists as `v.string()`
  // (schema.ts:350), so a stored route reaches here un-narrowed.
  if (!resolveSpecialist(gap.route).ok) {
    await ctx.runMutation(internal.plans.patchPlan, {
      ...shared,
      body: buildMemo(row, gap),
      status: "proposed", // the pinned collecting→proposed spine, unchanged (12-05)
    });
    return { ok: true, planId };
  }

  await ctx.runMutation(internal.plans.patchPlan, {
    ...shared,
    // NO template body: the specialist's output is the only body this plan will ever carry, and
    // a staged template is exactly what must not become approvable under an attribution header.
    body: "",
    status: "collecting", // ← not approvable until landSpecialistResult flips it
  });
  // Minted HERE, at the dispatch entry point, and deliberately NOT derived from `planId`:
  // `plans.byThread` is `.unique()` and this very function RECYCLES the thread's one row, so two
  // dispatches on a thread would merge into one unreconstructable lineage tree. It is not
  // `plans.correlationId` either — that is only written at `executePlan`, i.e. after Approve.
  // ADR-008.
  const rootRequestId = crypto.randomUUID();
  await ctx.scheduler.runAfter(0, internal.dispatch.runSpecialist, {
    tenantId: tenantId,
    threadId,
    planId,
    gapIndex,
    route: gap.route,
    rootRequestId,
    parentAgentId: "executive", // a code-owned constant, never user or model text
    depth: 1,
    ancestry: [],
    envelopeCents: 0, // the ROOT signal — 15-03 derives the real envelope from the live rail
    spentCents: 0,
    // Without this the specialist ran the ACTIVE row while the eval evidence claimed the pin.
    skillVersions,
  });
  // The public contract does not move, so cards.tsx's existing handler + its `plan_busy` note
  // keep working untouched.
  return { ok: true, planId };
}

export const actOnGap = tenantMutation({
  args: { threadId: v.string(), gapIndex: v.number() },
  handler: (ctx, { threadId, gapIndex }): Promise<ActOnGapResult> =>
    applyActOnGap(ctx, ctx.tenantId, threadId, gapIndex),
});

/**
 * The identity-less twin of `actOnGap` (15-06). `npx convex run` carries no auth identity, so the
 * golden-eval harness cannot call the tenant-scoped mutation above — this takes the tenantId
 * directly, exactly like `recordScorecardAnswerInternal`. It exists so an eval fixture can drive the
 * REAL user path (gap → tap → scheduled dispatch → staged specialist body) rather than a re-implemented
 * imitation of it; both surfaces share `applyActOnGap`, so a guard cannot be true in one and absent
 * in the other. Explicit return type per Convex guidelines §96 (an inferred one collapses the
 * generated API for `apps/web`).
 */
export const actOnGapInternal = internalMutation({
  args: {
    tenantId: v.string(),
    threadId: v.string(),
    gapIndex: v.number(),
    // The harness's --skill pins. Only THIS twin takes them: `actOnGap` above is the production UI
    // path and has none, so it keeps running the active row.
    skillVersions: v.optional(v.record(v.string(), v.number())),
  },
  handler: (ctx, { tenantId, threadId, gapIndex, skillVersions }): Promise<ActOnGapResult> =>
    applyActOnGap(ctx, tenantId, threadId, gapIndex, skillVersions),
});

/** Both the evaluation row and the gap are gone (a fresh thread, a cleared history). Say so in one
 *  honest sentence rather than throwing — a throw would leave the plan stuck at `collecting`, which
 *  is the ONE outcome this whole function exists to prevent. */
const LOST_CONTEXT_MEMO =
  "# Next step\n\nI could not run the specialist for this one, and the evaluation it was based on" +
  " is no longer on file. Ask me to run the assessment again and I'll pick it up from there.";

/**
 * Where a dispatched specialist's run LANDS on the plan row (DISP-01). Called ONLY by
 * `internal.dispatch.runSpecialist`, on every outcome — success, overrun, each of the four governed
 * refusals, and a thrown turn. Flipping `collecting → proposed` is what makes the row APPROVABLE;
 * until this runs it structurally is not (`executePlan` refuses anything else, cockpit.ts:530).
 *
 * An `internalMutation` with an EXPLICIT `tenantId` arg, because the scheduled action carries no
 * live identity — the 12-04 `recordScorecardAnswerInternal` precedent. That makes the tenant check
 * MANUAL, so it is written out below rather than inherited from a wrapper.
 */
export const landSpecialistResult = internalMutation({
  args: {
    tenantId: v.string(),
    threadId: v.string(),
    planId: v.id("plans"),
    gapIndex: v.number(),
    route: v.string(),
    /** the specialist's own output; ABSENT ⇒ fall back to the deterministic buildMemo template */
    body: v.optional(v.string()),
    incomplete: v.boolean(),
    /** D11: the governed stop that made a returned body incomplete. The shared memo formatter
     *  owns the three user-visible sentences; absent preserves the pre-Phase-16 cost default. */
    incompleteReason: v.optional(v.union(v.literal("cost"), v.literal("steps"), v.literal("clock"))),
    /** a reason CODE (unknown_route|depth_exceeded|cycle_refused|budget_exhausted|error) — never
     *  prose, and never surfaced to the user (§4 + the refusal-reply precedent). */
    fallbackReason: v.optional(v.string()),
    /** 16-06: the memo body to use when there is no evaluation row and no gap to build one from.
     *  A RESEARCH run always lands there — it was never based on an evaluation — and
     *  LOST_CONTEXT_MEMO's "the evaluation it was based on is no longer on file" is FALSE for it.
     *  The gap path (`runSpecialist`) passes nothing, so it stays byte-identical. */
    fallbackBody: v.optional(v.string()),
  },
  handler: async (ctx, a): Promise<void> => {
    const plan = await ctx.db.get(a.planId);
    // The CAS, mirroring executePlan:530. A dispatch that finishes after the user cancelled,
    // re-composed, approved, or switched threads must NOT clobber the row they moved on to.
    if (!plan || plan.tenantId !== a.tenantId) return;
    if (plan.status !== "collecting" || plan.kind !== "memo") return;

    // A specialist that returned nothing has not answered; treat it as a failed run rather than
    // publishing a bare attribution header over an empty document.
    const produced = a.body?.trim() ? a.body : undefined;
    let body: string;
    if (produced !== undefined) {
      // The attribution line AND the cost-ceiling marker ride the BODY (15-02), not a new
      // plans.status literal: the status enum is PINNED with apps/web blast radius, and the body
      // is rendered verbatim at the Approve gate — exactly where the human decides.
      body = specialistMemoBody({
        route: a.route,
        body: produced,
        incomplete: a.incomplete,
        reason: a.incompleteReason,
      });
    } else {
      const row = await ctx.db
        .query("evaluations")
        .withIndex("by_tenant_thread", (q) =>
          q.eq("tenantId", a.tenantId).eq("threadId", a.threadId),
        )
        .order("desc")
        .first();
      const gap = row?.gaps[a.gapIndex];
      body =
        row && gap
          ? buildMemo(row, gap, a.fallbackReason ?? "error")
          : (a.fallbackBody ?? LOST_CONTEXT_MEMO);
    }
    // patchPlan, not resetPlan: we are FILLING a staged row, and resetPlan would clear `kind: memo`.
    await ctx.runMutation(internal.plans.patchPlan, { planId: a.planId, body, status: "proposed" });
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
      .withIndex("by_tenant_thread", (q) => q.eq("tenantId", ctx.tenantId).eq("threadId", threadId))
      .order("desc")
      .first(),
});
