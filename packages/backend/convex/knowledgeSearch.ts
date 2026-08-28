/**
 * Phase 29 (KNOW-01) — THE COORDINATOR. One authenticated question in; one cited, bounded, honestly
 * scoped answer out, plus one content-plane row and one refs-only audit event.
 *
 * A THIN adapter (CLAUDE.md §1). It owns no honesty rule of its own: every one of them —
 * `clampSearchPlan`, `dedupeEvidence`, `clampEvidence`, `validateSynthesis`, `authorityFor`,
 * `freshnessFor`, `searchConfidence`, `aggregateCoverage`, `redactedSearchEvent` — lives in
 * `@pikar/core/knowledgeSearch` and is mutation-tested there. This module's whole job is ORDER:
 * authenticate, hash, plan, fan out, settle, dedupe, CLAMP, synthesize, validate, persist, measure.
 *
 * ── THE FIVE THINGS THIS FILE IS RESPONSIBLE FOR ──────────────────────────────────────────────
 *
 *  1. **THE TENANT COMES FROM THE WRAPPER.** `search` is a `tenantAction`, so `ctx.tenantId` is
 *     derived from the authenticated identity and is the ONLY tenant any adapter, model call,
 *     stored row or audit row ever sees. There is no `tenantId` argument. The adapters below are
 *     `internalAction`s taking an explicit `tenantId` precisely because they run without a live
 *     identity, which makes passing anything else here the whole isolation risk.
 *
 *  2. **ONLY CODE-REGISTERED ADAPTERS RUN.** `KNOWLEDGE_ADAPTER_ACTIONS` is a closed record keyed
 *     by `KnowledgeSource`. The planner cannot name a module, a URL or an MCP server — it names a
 *     source from a code-owned enum, and this table is the only thing that turns a source into a
 *     call. A `null` entry is a source with no landed adapter and mints `not_landed`.
 *
 *  3. **THE RUN-LEVEL CLAMP LANDS HERE, AND THE STATES ARE MINTED AFTER IT.** Wave 2's adapters
 *     clamp at SOURCE scope, because an adapter that cannot see the other four cannot spend a
 *     shared budget honestly. This is the first place the UNION exists, so `maxEvidenceTotal` and
 *     `totalEvidenceCharCap` are enforced here — BEFORE the synthesizer is called, so nothing is
 *     billed for evidence that will not be used — and every per-source `returned` is then re-minted
 *     from what actually survived. A state that reported eight rows while three reached synthesis
 *     was the ceiling those `ponytail:` comments named; it is closed.
 *
 *  4. **A REJECTED ADAPTER PROMISE IS A BUG, NOT THE NORMAL PATH.** Every adapter returns the
 *     governed `unavailable` state as DATA. So `Promise.allSettled`'s `rejected` arm means
 *     something threw that was not supposed to, and it is surfaced as `provider_error` (a named
 *     gap carrying zero rows) and COUNTED into the audit event so the bug is visible. It is never
 *     an empty successful read, and one rejection can never erase another source's evidence.
 *
 *  5. **THE TWO PLANES.** `question`, `summary`, claim text, labels and excerpts are CONTENT and
 *     live on the tenant's own `knowledgeSearches` row. The audit event is
 *     `redactedSearchEvent` — refs, hashes, ids, counts and closed enums — plus a handful of run
 *     REFS. The question is HASHED. No label, snippet, URL, sender, subject, excerpt, rejected
 *     source name or query text may ever appear there.
 *
 * ── WHAT IS DELIBERATELY ABSENT ───────────────────────────────────────────────────────────────
 *
 * **THERE IS NO COCKPIT TOOL, and that is a decision rather than an omission.** The plan text said
 * "*if* exposed as a cockpit read tool". It is not. The user surface is plan 29-09's
 * `KnowledgeSearchPanel`, which calls `search` / `listByThread` directly. Adding a tool to
 * `llm.ts` would mean a new grant in the tool-bearing loop AND a `cockpit-agent` skill-BODY edit
 * to make the model aware of it (CLAUDE.md §5 — prompts are registry rows), which is an eval-gated
 * change this plan cannot certify. Not exposing it is also strictly stronger than the counts-only
 * contract the plan asked for: the tool-bearing loop receives NOTHING. `llmRedaction.test.ts`
 * enforces that as an absence in `llm.ts` rather than leaving it as a claim in this comment.
 *
 * **NO TELEMETRY ROW.** `telemetry.writeTerminal` is hard-bound to `requestId: v.id("requests")`
 * and throws `telemetry: no request for <id>`; a search has no `requests` row and inventing one to
 * satisfy a foreign key would be a lie on the delivery plane. The measurement rides the audit
 * event instead, which is where a refs-only projection belongs. `telemetry.ts` is deliberately
 * unchanged and `llmRedaction.test.ts` pins that binding so this decision stays falsifiable.
 *
 * **NO RECURRENCE.** No scheduler, no cron, no next-run timestamp. A search happens because a user
 * asked (schema.ts's standing rule, plan 29-11's undecided gate).
 */
import {
  aggregateCoverage,
  clampEvidence,
  dedupeEvidence,
  type Evidence,
  freshnessFor,
  KNOWLEDGE_ADAPTERS,
  type KnowledgeAdapterResult,
  type KnowledgeSource,
  type KnowledgeSourceState,
  type PartialReason,
  redactedSearchEvent,
  type SearchConfidence,
  searchConfidence,
  unavailableRead,
  type ValidatedClaim,
} from "@pikar/core";
import type { FunctionReference } from "convex/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { internalMutation } from "./_generated/server";
import { tenantAction, tenantQuery } from "./lib/functions";
import { contentHash } from "./lib/hash";

// ── The closed adapter registry ─────────────────────────────────────────────────────────────

/**
 * THE ONLY WAY A SOURCE BECOMES A CALL. Keyed by `KnowledgeSource`, so a key that is not a source
 * does not compile and a source with no key does not either.
 *
 * The value type is a HAND-WRITTEN `FunctionReference`, which makes the four adapters' signatures a
 * compile-time contract: an adapter that stopped taking `{tenantId, query}` or stopped returning
 * `KnowledgeAdapterResult` breaks the build here rather than at runtime.
 *
 * ⚠ IT IS NOT `typeof internal.knowledgeVaultDrive.searchVaultKnowledge`, and that is not a style
 * choice. `internal` is derived from `fullApi`, which now includes THIS module, so deriving a type
 * here from `internal` closes a cycle and TypeScript abandons inference for the whole generated
 * graph — measured: 0 errors before, 379 after, almost all of them `implicitly has an 'any' type`
 * in unrelated files. That is the `internal`-graph circular-inference cliff `knowledgeLlm.ts`'s
 * header names (02-06), reached through a type rather than a runtime import.
 *
 * `support-desk` is `null` because nothing landed for it — and `knowledgeSearch.test.ts` asserts
 * the null keys are EXACTLY `@pikar/core`'s `NOT_LANDED_SOURCES`, in both directions, so this table
 * and the search plane's own landedness registry cannot drift.
 */
type AdapterRef = FunctionReference<
  "action",
  "internal",
  { tenantId: string; query: string },
  KnowledgeAdapterResult
>;

export const KNOWLEDGE_ADAPTER_ACTIONS: Readonly<Record<KnowledgeSource, AdapterRef | null>> = {
  vault: internal.knowledgeVaultDrive.searchVaultKnowledge,
  drive: internal.knowledgeVaultDrive.searchDriveKnowledge,
  inbox: internal.knowledgeExternalSources.readInboxKnowledge,
  "crm-facts": internal.knowledgeExternalSources.readCrmKnowledge,
  "support-desk": null,
};

/**
 * THE ONLY SETTLEMENT of a fan-out result, and the whole of the rejection rule.
 *
 * Since the wave-2 blocker fix every adapter returns its governed `unavailable` state as DATA, so
 * `rejected` no longer means "the mailbox is down" — it means something threw that was not
 * supposed to. It still comes back as a NAMED gap with zero rows (`unavailableRead` is the one
 * constructor of that arm, and the arm has no `returned` field), so an unexpected bug can never be
 * rendered as "we looked and there is nothing".
 *
 * Exported because the fulfilled branch is what every behavioural test in this feature runs
 * through — that is what binds this function to the handler — while the rejected branch has no
 * reachable driver and is exercised directly.
 */
export function adapterOutcome(
  source: KnowledgeSource,
  settled: PromiseSettledResult<KnowledgeAdapterResult>,
): KnowledgeAdapterResult {
  return settled.status === "fulfilled" ? settled.value : unavailableRead(source, "provider_error");
}

// ── State re-minting, after the run-level clamp ──────────────────────────────────────────────

const countBySource = (rows: readonly Evidence[]): ReadonlyMap<KnowledgeSource, number> => {
  const counts = new Map<KnowledgeSource, number>();
  for (const row of rows) counts.set(row.source, (counts.get(row.source) ?? 0) + 1);
  return counts;
};

/**
 * Re-state one source AFTER the union was cut, so `returned` is what actually reached synthesis.
 *
 * The comparison baseline is the DEDUPED corpus, not the adapter's original count, and that
 * distinction is load-bearing: a row absorbed as an exact duplicate is the same record read twice,
 * not something a cap took away, so collapsing it must NOT turn a complete read into a partial one.
 * Only a row lost to `maxEvidenceTotal` / `totalEvidenceCharCap` does that.
 *
 * `provider_error` outranks `cap`, the same ordering `settleRead` uses: an unusable row is a
 * different problem from a full budget and collapsing the two would hide it.
 */
function remintState(
  state: KnowledgeSourceState,
  deduped: ReadonlyMap<KnowledgeSource, number>,
  kept: ReadonlyMap<KnowledgeSource, number>,
): KnowledgeSourceState {
  if (state.status === "unavailable") return state;
  const survived = kept.get(state.source) ?? 0;
  const offered = deduped.get(state.source) ?? 0;
  if (survived < offered) {
    const reason: PartialReason =
      state.status === "partial" && state.reason === "provider_error" ? "provider_error" : "cap";
    return { status: "partial", source: state.source, returned: survived, reason };
  }
  if (state.returned === survived) return state;
  return state.status === "available"
    ? { status: "available", source: state.source, returned: survived }
    : { status: "partial", source: state.source, returned: survived, reason: state.reason };
}

// ── Persistence (content plane) ──────────────────────────────────────────────────────────────

/** One stored citation. Refs + labels + CODE-OWNED authority/freshness — never a model value. */
const vCitation = v.object({
  source: v.string(),
  sourceRef: v.string(),
  label: v.string(),
  authority: v.string(),
  freshness: v.string(),
  sourceUpdatedAt: v.optional(v.number()),
  retrievedAt: v.number(),
});

/**
 * The single content-plane insert. `internalMutation` (the `telemetry.ts` precedent): the caller is
 * an action that already resolved its tenant from the authenticated wrapper, and an action has no
 * `ctx.db`.
 *
 * The arg validators are deliberately LOOSER than the schema's (plain `v.string()` where the table
 * stores a closed literal union): the schema is the enforcement, so a source name, authority class
 * or confidence label that the frozen contracts do not know is refused at INSERT rather than being
 * re-listed here where the two copies could drift. `schema.test.ts` proves that refusal.
 */
export const record = internalMutation({
  args: {
    tenantId: v.string(),
    threadId: v.string(),
    runId: v.string(),
    question: v.string(),
    summary: v.string(),
    confidence: v.string(),
    sources: v.array(
      v.object({
        source: v.string(),
        status: v.string(),
        returned: v.optional(v.number()),
        reason: v.optional(v.string()),
      }),
    ),
    claims: v.array(
      v.object({
        text: v.string(),
        evidence: v.array(vCitation),
        conflictEvidence: v.array(
          v.object({ source: v.string(), sourceRef: v.string(), label: v.string() }),
        ),
        excerpt: v.optional(v.string()),
      }),
    ),
    unanswered: v.array(v.string()),
    unsupportedCount: v.number(),
    invalidCitationCount: v.number(),
  },
  handler: async (ctx, args): Promise<Id<"knowledgeSearches">> =>
    // The cast is the schema's own literal unions meeting the loose validators above; the insert
    // is still validated against the TABLE, which is where the closed vocabularies are enforced.
    await ctx.db.insert("knowledgeSearches", {
      ...(args as unknown as Omit<Doc<"knowledgeSearches">, "_id" | "_creationTime" | "createdAt">),
      createdAt: Date.now(),
    }),
});

/**
 * The tenant's search results for one thread, newest first — the panel's re-render read (29-09).
 *
 * `tenantQuery`, so the tenant filter comes from the authenticated identity and the `by_thread`
 * index is `[tenantId, threadId]`. A caller cannot name another tenant's thread.
 */
export const listByThread = tenantQuery({
  args: { threadId: v.string() },
  handler: async (ctx, { threadId }): Promise<Doc<"knowledgeSearches">[]> =>
    await ctx.db
      .query("knowledgeSearches")
      .withIndex("by_thread", (q) => q.eq("tenantId", ctx.tenantId).eq("threadId", threadId))
      .order("desc")
      .take(LIST_LIMIT),
});

/** ponytail: a fixed page, no cursor. One thread holds a handful of searches; add a cursor when a
 *  real thread stops fitting, which is a UI decision (29-09) rather than a backend one. */
const LIST_LIMIT = 20;

// ── The coordinator ─────────────────────────────────────────────────────────────────────────

/** A stored claim, as it crosses back to the caller. Content plane. */
export type StoredClaim = {
  readonly text: string;
  readonly evidence: readonly {
    readonly source: KnowledgeSource;
    readonly sourceRef: string;
    readonly label: string;
    readonly authority: string;
    readonly freshness: string;
    readonly sourceUpdatedAt?: number;
    readonly retrievedAt: number;
  }[];
  readonly conflictEvidence: readonly {
    readonly source: KnowledgeSource;
    readonly sourceRef: string;
    readonly label: string;
  }[];
  readonly excerpt?: string;
};

export type KnowledgeSearchResult =
  /** The governed stop, as DATA. Mirrors `guardrails.preCall`'s own reason union. */
  | { ok: false; reason: "kill_switch" | "daily_budget_exhausted" | "deployment_budget_exhausted" }
  | {
      ok: true;
      searchId: Id<"knowledgeSearches">;
      summary: string;
      claims: readonly StoredClaim[];
      /** EVERY knowledge source, exactly once. A missing one would be a silent gap. */
      sources: readonly KnowledgeSourceState[];
      confidence: SearchConfidence;
      unanswered: readonly string[];
      /** Rows that reached synthesis, after dedupe and the run-level clamp. */
      evidenceCount: number;
      /** Gaps among the sources that were ACTUALLY SEARCHED — the all-empty / all-unavailable
       *  discriminator. Zero with sources present means "we looked and there is nothing". */
      searchedGapCount: number;
      unsupportedCount: number;
      invalidCitationCount: number;
      conflictCount: number;
    };

export const search = tenantAction({
  args: { threadId: v.string(), question: v.string() },
  handler: async (ctx, { threadId, question }): Promise<KnowledgeSearchResult> => {
    const tenantId = ctx.tenantId; // FROM THE AUTHENTICATED WRAPPER. Never an argument.
    const startedAt = Date.now();
    const runId = crypto.randomUUID();
    // §4: the log plane gets a fingerprint of the question, never the question.
    const questionHash = await contentHash(question);

    // The budget gate lives inside the planner (`guardrails.preCall`), which is the first thing
    // that could spend. Its stop comes back as DATA and is passed straight through — a governed
    // stop is a paused feature, never a throw and never a fabricated empty answer.
    const planned = await ctx.runAction(internal.knowledgeLlm.planKnowledgeSearch, {
      tenantId,
      question,
    });
    if (!planned.ok) return { ok: false, reason: planned.reason };

    // FAN OUT. Concurrent, independent, and every entry already re-checked by `clampSearchPlan`
    // against the code-owned registry and caps.
    const settled = await Promise.allSettled(
      planned.plan.map(({ source, query }) => {
        const ref = KNOWLEDGE_ADAPTER_ACTIONS[source];
        // Fail closed. `settlePlan` never plans a not-landed source, but this table is the one
        // that decides what runs, so it answers the question itself rather than trusting another
        // module's guarantee.
        return ref === null
          ? Promise.resolve(unavailableRead(source, "not_landed"))
          : ctx.runAction(ref, { tenantId, query });
      }),
    );

    let adapterCrashCount = 0;
    const reads = planned.plan.map((entry, index) => {
      const outcome = settled[index] as PromiseSettledResult<KnowledgeAdapterResult>;
      if (outcome.status === "rejected") adapterCrashCount += 1;
      return adapterOutcome(entry.source, outcome);
    });

    // DEDUPE FIRST, THEN THE RUN-LEVEL CLAMP. Exact duplicates are removed before the budget is
    // spent on them; `conflicting` rows are KEPT, because a ref that disagrees with itself is the
    // disagreement the answer has to show and collapsing it is how a $40 rate and a $60 rate
    // become one confident number. `related` rows are separate groups and survive untouched.
    const union = reads.flatMap((read) => read.evidence);
    const { groups, collapsed, conflicts: dedupeConflicts } = dedupeEvidence(union);
    const corpus = groups.flatMap((group) => [group.primary, ...group.conflicting]);
    const { evidence } = clampEvidence(corpus, "run");

    // MINTED AFTER THE CUT. This is the line the wave-2 `ponytail:` comments were waiting for.
    const dedupedCounts = countBySource(corpus);
    const keptCounts = countBySource(evidence);
    const states = [...reads.map((read) => read.state), ...planned.skipped].map((state) =>
      remintState(state, dedupedCounts, keptCounts),
    );
    // The sources a read was actually ATTEMPTED against — the all-empty / all-unavailable
    // discriminator is a statement about those, not about the ones nobody asked for. Read off the
    // RE-MINTED states, because a source that was complete at its own adapter and lost rows to the
    // run budget acquires its gap HERE; taking this count from `reads` reported zero gaps over a
    // partial answer, which is the same before/after-the-clamp mistake `remintState` exists to fix.
    const attempted = new Set(reads.map((read) => read.state.source));
    const searchedGapCount = states.filter(
      (state) => attempted.has(state.source) && state.status !== "available",
    ).length;

    let summary = "";
    let claims: readonly ValidatedClaim[] = [];
    let unsupported: readonly { text: string; reason: string }[] = [];
    let unanswered: readonly string[] = [];
    let invented: readonly string[] = [];
    let conflictCount = 0;
    let synthRunRef: string | null = null;

    // NO EVIDENCE, NO PAID CALL. There is nothing to cite, so there is nothing a model could
    // honestly write — and an answer written without evidence is exactly the fabrication this
    // feature exists to prevent. The stored row's source states carry the honest reason instead,
    // and `@pikar/core`'s `renderSourceGap` turns each into the user's sentence.
    if (evidence.length > 0) {
      const synthesized = await ctx.runAction(internal.knowledgeLlm.synthesizeKnowledge, {
        tenantId,
        question,
        rawEvidence: [...evidence],
      });
      if (!synthesized.ok) return { ok: false, reason: synthesized.reason };
      summary = synthesized.summary;
      claims = synthesized.claims;
      unsupported = synthesized.unsupported;
      unanswered = synthesized.unanswered;
      invented = synthesized.inventedEvidenceIds;
      conflictCount = synthesized.conflicts;
      synthRunRef = synthesized.runId;
    }

    const coverage = aggregateCoverage(states);
    const confidence = searchConfidence({ claims, coverage, conflicts: conflictCount });

    // The citation rows the card renders. Authority comes off the evidence table (the adapter's
    // `authorityFor` value, carried through UNMODIFIED); freshness is computed from the provider
    // timestamp. Neither is ever a model value — neither JSON schema has a field for one.
    const now = Date.now();
    const table = new Map(evidence.map((row) => [row.evidenceId, row]));
    const cite = (id: string) => table.get(id) as Evidence;
    const storedClaims: StoredClaim[] = claims.map((claim) => ({
      text: claim.text,
      evidence: claim.evidenceIds.map((id) => {
        const row = cite(id);
        return {
          source: row.source,
          sourceRef: row.sourceRef,
          label: row.label,
          authority: row.authority,
          freshness: freshnessFor(row, now),
          ...(row.sourceUpdatedAt === undefined ? {} : { sourceUpdatedAt: row.sourceUpdatedAt }),
          retrievedAt: row.retrievedAt,
        };
      }),
      conflictEvidence: claim.conflictEvidenceIds.map((id) => {
        const row = cite(id);
        return { source: row.source, sourceRef: row.sourceRef, label: row.label };
      }),
      ...(claim.excerpt === null ? {} : { excerpt: claim.excerpt }),
    }));

    const searchId = await ctx.runMutation(internal.knowledgeSearch.record, {
      tenantId,
      threadId,
      runId,
      question,
      summary,
      confidence,
      sources: states.map((state) => ({ ...state })),
      claims: storedClaims.map((claim) => ({
        ...claim,
        evidence: claim.evidence.map((row) => ({ ...row })),
        conflictEvidence: claim.conflictEvidence.map((row) => ({ ...row })),
      })),
      unanswered: [...unanswered],
      unsupportedCount: unsupported.length,
      invalidCitationCount: invented.length,
    });

    // ── THE ONE GOVERNANCE-PLANE WRITE (§4) ──────────────────────────────────────────────────
    //
    // `redactedSearchEvent` is a PURE projection in `@pikar/core` precisely so the ban is testable
    // without a database: refs, hashes, ids, counts and closed enums. The fields added beside it
    // are all ids, counts or booleans.
    //
    // WHAT IS DELIBERATELY *NOT* HERE: the question (only its hash), the summary, any claim text,
    // any label, excerpt, sourceRef, subject, sender or file name, and — less obviously — the
    // planner's REJECTED SOURCE NAMES, which are MODEL-AUTHORED STRINGS ("notion",
    // "http://evil.example"). Those would put model prose on a log plane whose contract is refs
    // only, so a COUNT is all that crosses.
    //
    // ponytail: cost is a REF, not a number. The two model calls each recorded their own spend
    // through `guardrails.recordSpend` with `knowledge:plan:<id>` / `knowledge:synth:<id>`, and
    // `planRunRef` / `synthRunRef` are those ids — so the ledger joins without this row restating a
    // figure it did not compute. Ceiling: reading a total costs a second query per search. Upgrade
    // path if a per-search cost is ever wanted on the log plane, read the ledger rows by
    // correlation and store the SUM, never the model's own report of it.
    await ctx.runMutation(internal.audit.log, {
      tenantId,
      correlationId: runId,
      eventType: "knowledge.searched",
      actor: "system",
      payload: {
        ...redactedSearchEvent({
          searchRunRef: searchId,
          questionHash,
          coverage,
          claims: claims.length,
          unsupported: unsupported.length,
          conflicts: conflictCount,
          inventedEvidenceIds: invented.length,
          confidence,
          durationMs: Date.now() - startedAt,
        }),
        collapsedCount: collapsed,
        dedupeConflictCount: dedupeConflicts,
        rejectedPlanCount: planned.rejected.length,
        adapterCrashCount,
        plannerFallback: planned.fallback,
        planRunRef: planned.runId,
        synthRunRef,
        plannerSkillVersion: planned.skillVersion,
      },
    });

    return {
      ok: true,
      searchId,
      summary,
      claims: storedClaims,
      sources: states,
      confidence,
      unanswered,
      evidenceCount: evidence.length,
      // Gaps among the sources that were ACTUALLY SEARCHED. `coverage.gaps` also counts the
      // unplanned and not-landed ones, which are true but are not a statement about the read.
      searchedGapCount,
      unsupportedCount: unsupported.length,
      invalidCitationCount: invented.length,
      conflictCount,
    };
  },
});

// A compile-time reminder that the landedness registry is consumed, not merely documented: the
// test asserts `KNOWLEDGE_ADAPTER_ACTIONS` and `KNOWLEDGE_ADAPTERS` agree source by source.
void KNOWLEDGE_ADAPTERS;
