// Voice-doc discussion module (DOCV-01) — the flagship "talk to your report" flow.
//
// LANE OWNERSHIP: Lane C (`lane-c/voice-doc`). Created empty in the Wave-0 freeze commit (14-01)
// so every later plan fills in THIS file instead of editing a shared one. Plans 14-03 and 14-05
// own its contents; 14-04 mints against it from `voiceToken.ts`.
//
// DEFAULT-runtime (V8) module — NO `"use node"` directive. `llm.ts` is the ONE node module, and a
// second one re-triggers the TypeScript `internal`-graph circular-inference cliff documented at
// `vaultLlm.ts:2-7` (it collapses the whole generated API to `any`/`{}`). To stay clear of that
// cliff every handler added here carries an EXPLICIT `Promise<...>` return type — never an
// inferred one (Pitfall 9, the same mitigation `evaluations.ts` and `proactiveReview.ts` use).
//
// Conventions this module must hold as it fills in:
//   - CLAUDE.md §2: no raw `query`/`mutation`/`action` imports — use the tenant-scoped wrappers
//     from `./lib/functions.ts`.
//   - CLAUDE.md §1: the pure literals (framework, thread id, tool shape, char caps) live in
//     `@pikar/voice`'s `docSession.ts`. Do not re-declare one here.
//   - CLAUDE.md §4: retrieval/review audit payloads carry refs, hashes and counts ONLY. A
//     `citationExcerpt` is verbatim report content — legal in `evaluations.findings[]` and in the
//     memo body, ILLEGAL in every `audit` / `deadLetters` / `telemetry` payload and in
//     `agentSteps`. Plan 14-09 pins that with a mutation-verified static scan.
//
import { openai } from "@ai-sdk/openai";
import { DOCUMENT_ANALYST_SKILL } from "@pikar/contracts/skill";
import { DEFAULT_MODEL, priceUsage } from "@pikar/cost";
import {
  buildDocDigest,
  DOC_REVIEW_CONFIDENCE,
  DOC_REVIEW_FRAMEWORK,
  DOC_REVIEW_SECTIONS,
  isEnded,
  type RawDocReview,
  RETRIEVAL_CHAR_CAP,
  RETRIEVAL_MAX_PASSAGES,
  shapeDocReview,
  voiceDocThreadId,
} from "@pikar/voice";
import { generateObject, jsonSchema, type LanguageModel } from "ai";
import type { GenericActionCtx } from "convex/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { DataModel, Id } from "./_generated/dataModel";
import { internalAction } from "./_generated/server";
import { tenantAction } from "./lib/functions";
import { contentHash } from "./lib/hash";

/**
 * Collect the passages of THIS session's document that match `query`. Returns `[]` — never
 * throws — for every "there is nothing to search" case, so the caller audits exactly once either
 * way and the voice turn is never left hanging (Pitfall 5).
 *
 * The document id comes off the SESSION ROW. The model supplies only the free-text `query`; it can
 * neither name a document nor widen the scope, and neither can the browser — identity arrives with
 * the authenticated Convex client and `docRef` was already ownership-and-status-validated at
 * `voice.startSession`.
 */
async function docScopedPassages(
  ctx: GenericActionCtx<DataModel>,
  tenantId: string,
  sessionId: Id<"voiceSessions">,
  query: string,
): Promise<string[]> {
  const session = await ctx.runQuery(internal.voice.getSession, { sessionId });
  // A missing session, ANOTHER TENANT's session, an already-ended session, or a session with no
  // document scope: no passages, no throw.
  if (!session || session.tenantId !== tenantId || isEnded(session.status) || !session.docRef) {
    return [];
  }
  const docRef = String(session.docRef);

  // Reuse the Phase-10 retrieval engine rather than reading `vaultDocuments.text` here: that blob
  // is book-sized (the 16 MiB read cap) and re-selecting chunks by hand would fork the one place
  // chunk selection lives. `namespace = tenantId` inside it is the isolation linchpin (BETA-05).
  const { docIds, chunks } = await ctx.runAction(internal.vaultGround.vaultGroundHydrated, {
    tenantId,
    query,
  });

  // ponytail: DOC SCOPING IS POST-HOC. `vaultGroundHydrated` searches the tenant's WHOLE vault
  // (`rag.search` top-K, limit 8) and everything that is not `docRef` is dropped right here.
  // ACCEPTED FAILURE MODE: when another document dominates the top-K, this report's best passage
  // can fall out of the window and a legitimate drill-in returns nothing — the same shape as the
  // Phase-12 grounding defect fixed in `f5c279e`. Two upgrade paths, in cost order:
  //   1. raise `rag.search`'s `limit` for a doc-scoped call and keep filtering here — one number,
  //      but it lives in `vaultGround.ts`, which is Phase-10-owned and frozen to this lane, so it
  //      is a contract change rather than an edit.
  //   2. a REAL doc-scoped rag filter. VERIFIED PRESENT in `@convex-dev/rag` 0.7.5 (checked
  //      2026-07-26 against the installed types): `new RAG(…, {filterNames})` + `rag.add({filterValues})`
  //      + `rag.search({filters})`. NOT usable today — `vaultRag.ts` declares no `filterNames` and
  //      `embedDoc` passes `vaultDocId` as `metadata`, which the package documents as "not indexed
  //      or filtered or searched", and filters only match entries INSERTED with those values. So
  //      taking it means changing the single shared RAG instance AND re-embedding every existing
  //      entry: a migration, not a swap.
  // Explicitly NOT a cache — cost control for voice is time-cap-only by decision (ADR-005).
  const passages: string[] = [];
  let used = 0;
  for (let i = 0; i < docIds.length && passages.length < RETRIEVAL_MAX_PASSAGES; i++) {
    if (docIds[i] !== docRef) continue;
    // One entry per doc, whose several matched passages `vaultGroundHydrated` joined with a blank
    // line — split on that same separator so RETRIEVAL_MAX_PASSAGES counts passages, not documents.
    for (const raw of (chunks[i] ?? "").split("\n\n")) {
      const passage = raw.trim();
      if (passage.length === 0) continue;
      // Realtime input tokens are re-billed on EVERY turn, so the char cap is a hard total.
      const remaining = RETRIEVAL_CHAR_CAP - used;
      if (remaining <= 0) break;
      const capped = passage.slice(0, remaining);
      passages.push(capped);
      used += capped.length;
      if (passages.length >= RETRIEVAL_MAX_PASSAGES) break;
    }
  }
  return passages;
}

/**
 * The mid-call drill-in (DOCV-01 / SC1): answer "what does it say about X?" from the session's ONE
 * document. The browser relays the model's `search_document` tool call here over the authenticated
 * Convex client and hands the result back on the data channel.
 *
 * NEVER THROWS. A tool call the browser cannot answer leaves the model waiting with no
 * `function_call_output`, and the user hears silence for the rest of a turn inside a capped
 * 15 minutes (Pitfall 5) — so every failure is the honest `{passages: [], found: false}` instead.
 */
export const searchDocument = tenantAction({
  args: { sessionId: v.id("voiceSessions"), query: v.string() },
  handler: async (ctx, { sessionId, query }): Promise<{ passages: string[]; found: boolean }> => {
    try {
      const passages = await docScopedPassages(ctx, ctx.tenantId, sessionId, query);

      // The §4 split, stated once, here, because this is the one new place report content moves:
      //   CONTENT PLANE — `passages` go to the MODEL over the WebRTC data channel and nowhere else.
      //   LOG PLANE     — refs, a hash and a count. The query is the user's own words and the
      //                   passages ARE report content; neither may enter the audit table.
      // This is the module's ONLY log-plane write: no `agentSteps` row (that table has no text
      // field by construction and `llmRedaction.test.ts` scans a closed allow-list), no `telemetry`,
      // no `deadLetters`.
      await ctx.runMutation(internal.audit.log, {
        tenantId: ctx.tenantId,
        correlationId: String(sessionId),
        eventType: "voicedoc.searched",
        actor: "user",
        payload: { sessionId, queryHash: await contentHash(query), resultCount: passages.length },
      });

      return { passages, found: passages.length > 0 };
    } catch {
      return { passages: [], found: false };
    }
  },
});

// ── 14-05: the review producer (SC2) ─────────────────────────────────────────
//
// `vaultLlm.ts` IS the template for a model call that lives outside the frozen `llm.ts`: V8
// runtime, an explicit `Promise<>` return type, the registry body as the `system` prompt, a
// `SMOKE::` content sentinel for the offline path, and `priceUsage` on the returned usage.

/** Per-call wall-clock ceiling (mirrors `llm.ts` / `vaultLlm.ts`). One retry budget. */
const CALL_TIMEOUT_MS = 45_000;

/** Map a pricing/audit model id ("openai/gpt-4o-mini") to a direct-OpenAI LanguageModel. */
const resolveModel = (id: string): LanguageModel => openai(id.replace(/^openai\//, ""));

/** Counts and a closed-enum verdict — the ONLY thing the producer hands back. No label, no
 *  excerpt, no passage, no transcript turn ever crosses this boundary (§4). */
type ReviewResult = {
  findingCount: number;
  gapCount: number;
  verdict: "gaps" | "healthy" | "insufficient";
};

/** There is nothing to review — no document scope, or a session this tenant does not own. Honest
 *  thin data, and NO row is written: an unreviewable session must not leave a fabricated verdict. */
const NO_REVIEW: ReviewResult = { findingCount: 0, gapCount: 0, verdict: "insufficient" };

/**
 * The structured-output contract handed to `generateObject`.
 *
 * There is deliberately NO `citationDocId`, `citationTitle`, `verdict`, `route`, `playbook` or
 * `leverageRank` key anywhere in it — `shapeDocReview` welds every one of those in code, so the
 * model has nothing to omit or invent and "every finding is cited" is STRUCTURAL (Success
 * Criterion 2). The type parameter is `RawDocReview` (14-02), which is the compile-time half of
 * that weld: a citation field could not be added here without changing the pure domain type.
 *
 * `excerpt` is the ONE declared exception and a LOCKED requirement (14-CONTEXT.md: "document-level
 * always, PLUS a quoted passage where available"). Only whoever read the passage can quote it, so
 * the quote TEXT — and only the quote text — comes from the model. Declared STRICT-mode legally as
 * nullable-and-required (`["string","null"]` listed in `required`), the house rule
 * `llmRedaction.test.ts` enforces: OpenAI structured outputs reject a schema whose `properties`
 * carry a key absent from `required`, so a merely-optional field throws on EVERY live call.
 * `required` follows `properties` in every object here so that scan pairs them non-vacuously.
 */
const docReviewSchema = jsonSchema<RawDocReview>({
  type: "object",
  additionalProperties: false,
  properties: {
    findings: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          label: {
            type: "string",
            description: "One observation about the report, in plain words.",
          },
          section: { type: "string", enum: [...DOC_REVIEW_SECTIONS] },
          confidence: { type: "string", enum: [...DOC_REVIEW_CONFIDENCE] },
          excerpt: {
            type: ["string", "null"],
            description:
              "The exact sentence or two from the document that supports this finding, copied " +
              "verbatim. Use null if you cannot quote one.",
          },
        },
        required: ["label", "section", "confidence", "excerpt"],
      },
    },
    gaps: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          label: { type: "string", description: "Something the report does not answer." },
          reason: { type: "string", description: "Why this one is worth closing first." },
          proofMetric: { type: "string", description: "What would show it has been closed." },
        },
        required: ["label", "reason", "proofMetric"],
      },
    },
    notEnoughData: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          section: { type: "string", enum: [...DOC_REVIEW_SECTIONS] },
          needs: {
            type: "string",
            description: "What the report would have to say to be gradeable.",
          },
        },
        required: ["section", "needs"],
      },
    },
  },
  required: ["findings", "gaps", "notEnoughData"],
});

// ── Offline SMOKE seam (the vaultLlm.ts idiom) ───────────────────────────────
// A `SMOKE::docreview::<kind>` first transcript turn returns a deterministic fixture with NO model
// call and no OPENAI_API_KEY, which is what lets `voiceDoc.test.ts` drive retrieval → findings →
// row → `actOnGap` end to end offline. A content sentinel, not an env flag: the seam stays
// per-request and out of shared deployment config.
const SMOKE_REVIEW_PREFIX = "SMOKE::docreview::";

/** A quote the model "produced" that is NOT in the document — the rejected-excerpt path. */
const SMOKE_ABSENT_EXCERPT = "This sentence appears nowhere in the report under discussion.";

function smokeDocReview(kind: string, docText: string): RawDocReview {
  // Real BY CONSTRUCTION: lifted verbatim out of the document in hand, so the carry-through path
  // is exercised against whatever text the caller seeded rather than a hardcoded twin of it.
  const quoted = (docText.split("\n").find((l) => l.trim().length > 0) ?? "").trim().slice(0, 120);
  const gaps = [
    {
      label: "No owner is named for the workstream this report implies",
      reason: "The report states the problem but never says who acts on it",
      proofMetric: "A named owner and a review date against the workstream",
    },
  ];
  // Zero findings, and gaps OFFERED anyway — `shapeDocReview` must force-clear them and return
  // "insufficient". A fabricated gap out of an unread report is the failure this fixture pins.
  if (kind === "empty") {
    return {
      findings: [],
      gaps,
      notEnoughData: [{ section: "insight", needs: "a readable extraction of the report" }],
    };
  }
  const cited = {
    label: "The report's headline movement is stated with a figure",
    section: "insight",
    confidence: "high",
    excerpt: quoted,
  };
  // Findings AND no gaps — an affirmative healthy verdict, not an empty result.
  if (kind === "healthy") return { findings: [cited], gaps: [], notEnoughData: [] };
  return {
    findings: [
      cited,
      // Quoted nothing — an absent excerpt is a VALID, non-degraded state.
      {
        label: "A second theme runs through the report without a number attached",
        section: "pattern",
        confidence: "medium",
        excerpt: null,
      },
      // Quoted something that is not there — the excerpt is dropped, the finding survives.
      {
        label: "A stated risk is not sized anywhere in the report",
        section: "risk",
        confidence: "low",
        excerpt: SMOKE_ABSENT_EXCERPT,
      },
    ],
    gaps,
    notEnoughData: [],
  };
}

const forMatch = (s: string): string => s.replace(/\s+/g, " ").trim().toLowerCase();

/**
 * Verify each quote is REALLY in the report, cheaply — one whitespace-normalized substring test
 * against the document text already in hand (`indexOf` over a string bounded by the 16 MiB read).
 *
 * Drops the EXCERPT, never the finding: the doc-level citation floor still holds and an absent
 * excerpt is a valid, non-degraded state. `shapeDocReview` then omits the key entirely.
 *
 * ponytail: ACCEPTED CEILING. A substring test cannot tell that a genuine quote was lifted from a
 * different part of the same document than the finding is about, and it rejects a legitimate quote
 * whose whitespace or hyphenation the extractor mangled. Upgrade path: a locator (chunk id +
 * offset) returned by `searchDocument`, which needs the chunk-level rag filter Open Question 2
 * tracks (see the ceiling comment on `docScopedPassages` above).
 */
function withVerifiedExcerpts(raw: RawDocReview, docText: string): RawDocReview {
  const haystack = forMatch(docText);
  return {
    ...raw,
    findings: (raw.findings ?? []).map((f) => {
      const needle = forMatch(f?.excerpt ?? "");
      return needle.length > 0 && haystack.includes(needle) ? f : { ...f, excerpt: null };
    }),
  };
}

/** The live model half: registry persona as the `system` prompt (§5, fail-closed), the transcript
 *  plus the SAME bounded+fenced digest the agent was given at the mint, priced usage recorded. */
async function modelDocReview(
  ctx: GenericActionCtx<DataModel>,
  transcript: { speaker: string; text: string }[],
  doc: { title: string; text: string | undefined; extractionTruncated: boolean },
): Promise<RawDocReview> {
  // No hardcoded prompt (§5) — throws NO_ACTIVE_SKILL when the persona is unseeded, so a
  // hardcoded fallback can never sneak in.
  const skill: { body: string; version: number } = await ctx.runQuery(
    internal.skills.getActiveSkill,
    { name: DOCUMENT_ANALYST_SKILL },
  );

  // Reuse `buildDocDigest` rather than re-slicing the text: the review then reads EXACTLY what the
  // agent was given during the call, and inherits its cap, its fence and its truncation disclosure.
  const prompt = [
    "Discussion transcript:",
    transcript.map((turn) => `${turn.speaker}: ${turn.text}`).join("\n"),
    "",
    buildDocDigest({ title: doc.title, text: doc.text, truncated: doc.extractionTruncated }),
  ].join("\n");

  const { object, usage } = await generateObject({
    model: resolveModel(DEFAULT_MODEL),
    schema: docReviewSchema,
    system: skill.body,
    prompt,
    abortSignal: AbortSignal.timeout(CALL_TIMEOUT_MS),
    maxRetries: 1,
  });

  // The intake.ts idiom for a model call outside the governed llm.ts loop — the priced usage is
  // charged against the same daily spend limiter, so a doc review cannot spend off-budget.
  const priced = priceUsage(DEFAULT_MODEL, usage);
  if (priced.ok) await ctx.runMutation(internal.guardrails.recordSpend, { costUsd: priced.value });
  return object;
}

/**
 * Turn a finished discussion into ONE persisted, cited `evaluations` row (Success Criterion 2).
 *
 * `tenantId` is an EXPLICIT arg (the `vaultGroundHydrated` / `runEvaluation` convention) so this is
 * callable from a context carrying no live identity. Deliberately does NOT refuse an ended session:
 * the review runs AFTER the call, so `ended_clean` is the normal state here.
 *
 * The row lands through the UNMODIFIED `internal.evaluations.insertEvaluation`, whose arg validator
 * is derived from the schema and was already widened by 14-01. Never `runEvaluation`: its framework
 * arg is pinned to the four business frameworks and `FRAMEWORK_SKILL` has no document-review entry,
 * so `getActiveSkill(undefined)` would throw mid-run.
 */
export const reviewDocument = internalAction({
  args: {
    tenantId: v.string(),
    sessionId: v.id("voiceSessions"),
    transcript: v.array(v.object({ speaker: v.string(), text: v.string() })),
  },
  handler: async (ctx, { tenantId, sessionId, transcript }): Promise<ReviewResult> => {
    const session = await ctx.runQuery(internal.voice.getSession, { sessionId });
    // Fail-closed: a missing session, another tenant's session, or a Phase-6 session with no
    // document scope has nothing to review — and writes no row.
    if (!session || session.tenantId !== tenantId || !session.docRef) return NO_REVIEW;

    // `internal.vault.getDoc` cannot serve this read: it returns {text, contentHash, title} with no
    // `extractionTruncated`, which `buildDocDigest` needs, and it THROWS on cross-tenant instead of
    // reading as missing. `voiceToken.docForMint` is exactly this read and already exists (14-04) —
    // reuse it rather than adding a third copy or widening the shared Phase-10 query.
    const doc = await ctx.runQuery(internal.voiceToken.docForMint, {
      vaultDocId: session.docRef,
      tenantId,
    });
    if (!doc) return NO_REVIEW;
    const docText = doc.text ?? "";

    const first = transcript[0]?.text ?? "";
    const raw: RawDocReview = first.startsWith(SMOKE_REVIEW_PREFIX)
      ? smokeDocReview(first.slice(SMOKE_REVIEW_PREFIX.length).trim(), docText)
      : await modelDocReview(ctx, transcript, doc);

    // Citations, gap route/playbook, the leverage rank, the excerpt cap and the honesty verdict all
    // land in pure tested code (14-02). Do NOT re-derive any of them here, and never pass a verdict.
    const review = shapeDocReview(withVerifiedExcerpts(raw, docText), {
      id: String(session.docRef),
      title: doc.title,
    });

    await ctx.runMutation(internal.evaluations.insertEvaluation, {
      tenantId,
      threadId: voiceDocThreadId(String(sessionId)),
      framework: DOC_REVIEW_FRAMEWORK,
      findings: review.findings,
      gaps: review.gaps,
      notEnoughData: review.notEnoughData,
      // A document review has no Growth-OS Scorecard and no user-provided figures; `delta` is the
      // Phase-13 weekly-review concept and stays absent.
      scorecard: {},
      userProvided: [],
      verdict: review.verdict,
      delta: undefined,
    });

    // Counts and a verdict ONLY (§4). The excerpt enters the system in this function, and it is
    // report content: it belongs in `evaluations.findings[].citationExcerpt` and on the post-call
    // screen, and must never reach an audit / deadLetters / telemetry `payload:` or an
    // `agentSteps` row. 14-09 pins that with a mutation-verified scan over this file.
    return {
      findingCount: review.findings.length,
      gapCount: review.gaps.length,
      verdict: review.verdict,
    };
  },
});
