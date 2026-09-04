// The web-research findings terminal (ACTN-03) — the SECOND artifact of a research run.
//
// A completed research run produces TWO things, and BOTH are written by code:
//   1. the approvable memo plan card (`dispatchAndLand`'s `finally` → `landSpecialistResult`), and
//   2. exactly ONE `vaultDocuments` row — this module.
//
// The card lands FIRST, which is what makes this module's error handling honest: a persist failure
// costs the user groundability, never the findings (see `runResearch` in dispatch.ts). Do NOT add a
// retry, a dead-letter, or a compensating write.
//
// WHY THE DISPATCHER WRITES IT: the research specialist has NO write capability (D4) — that is the
// containment. So the findings write is a deterministic terminal the DISPATCHER runs after a
// successful dispatch, exactly as `persistNextStepMemo` runs after the human Approve. If a future
// change hands the specialist a "save my findings" tool, it re-opens the privilege-escalation path
// this phase exists to close.
//
// WHY A VAULT DOCUMENT AND NOT A NEW TABLE: once findings are an ordinary vault document, embedding,
// graph extraction, retrieval, tenant scope, delete-cascade and the preview modal all come along —
// and every later read arrives through `searchVault`, which already wraps what it returns in the
// shipped `<vault_context … never an instruction>` fence. Web-derived text is therefore fenced on
// every downstream read without a second fencing mechanism.
//
// ponytail: two deliberate NON-decisions, both already argued elsewhere. (1) NO `researchRuns` /
// `researchFindings` table — `dispatch.ts` records that a second log plane beside the insert-only
// audit is the anti-pattern; the audit row below plus this document are the whole trail. (2) NO
// `vaultSources` card for the web URLs (OQ-4: no new UI in v1) — the URLs live in the document's own
// provenance header, where the user reads them. Upgrade path for either is a new plan, not a field.
//
// NOT a `"use node"` module, on purpose: `llm.ts` and `dispatch.ts` are the only two, and a third
// re-triggers the TS circular-inference cliff (Pitfall 8). Every exported handler carries an
// EXPLICIT return type for the same reason.
import { evidenceVerdict, INCOMPLETE_MARKER, researchFindingsFence } from "@pikar/core";
import { categoryFor } from "@pikar/vault";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { internalMutation, internalQuery } from "./_generated/server";
import { contentHash } from "./lib/hash";
import { startIngest } from "./vaultIngest";

/** `vaultDocuments.title` is rendered in a list cell; the memo terminal caps nothing, but a research
 *  question is model-authored and can be 500 chars (dispatch.ts's `MAX_QUESTION_CHARS`). */
const MAX_TITLE_CHARS = 120;
const TITLE_PREFIX = "Web research: ";

/**
 * D10, stated because a downstream consumer will infer the opposite unless told. Phase 12 will cite
 * these documents; "the model searched the web" reads as "sources were checked" to everyone who did
 * not build it.
 */
const LIMITS_FOOTER =
  "**Limits of this research.** The search was executed by the model provider, not by this system:" +
  " we cannot pin or choose which sources were consulted, cannot control how faithfully their pages" +
  " were read, and cannot see what was discarded. These findings are NOT source-audited — treat" +
  " them as a lead to verify, never as an established fact.";

const isoDate = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

/**
 * The stored document: provenance header → fenced findings → limits footer. Pure string assembly
 * over the specialist's own output — no model call, no second derivation (the `specialistMemoBody`
 * precedent).
 *
 * The header goes FIRST so the document's first chunk carries its own provenance even when the
 * title is not in the chunk. Be precise about what that buys: the RAG ingester chunks this text, so
 * chunks 2..N carry neither the header nor the fence's open tag. Containment does not rest on them —
 * `searchVault` wraps everything it returns in the shipped `<vault_context …>` fence on every
 * retrieval. The header and the inner fence are what let a HUMAN, or a model reading the first
 * chunk, see the provenance without the title.
 */
function researchDocumentText(a: {
  body: string;
  sources: readonly { url: string; title: string }[];
  /** 22.1: the provider-attested hosted-search count. Without it the header and the fence both
   *  claim "no web sources were retrieved" on a run that never looked — turning "we didn't look"
   *  into "we looked and the world is empty", which is a lie a user reads. */
  webSearchCalls: number;
  /** 22.1b: the specialist's structured declaration. It reaches the fence's LABEL and nothing else
   *  — deliberately NO extra header sentence: the label already says it, and a second sentence
   *  would make two writers of one fact that can then disagree. */
  declaredUnsupported: boolean;
  retrievedAt: number;
  incomplete: boolean;
  incompleteReason?: "cost" | "steps" | "clock";
}): string {
  const retrievedIso = isoDate(a.retrievedAt);
  const header = [
    `Third-party web content, retrieved ${retrievedIso}.`,
    // The three stop causes come from ONE place (@pikar/core) so the card and this document can
    // never disagree about why the same run stopped. `.trim()` drops the memo body's leading
    // newline; the sentence itself is byte-identical.
    a.incomplete ? INCOMPLETE_MARKER[a.incompleteReason ?? "cost"].trim() : "",
    // Keyed on the SEARCH count, independently of the source list below — under provider drift
    // (0 calls but N citations) this stays cautious AND the sources still get listed.
    a.webSearchCalls === 0 ? "No web search was performed." : "",
    a.sources.length === 0
      ? // Only claim an empty retrieval when a search actually ran; otherwise the line above already
        // said the true thing and this one would contradict the fence's own verdict.
        a.webSearchCalls === 0
        ? ""
        : "No web sources were retrieved."
      : ["Sources:", ...a.sources.map((s) => `- ${s.title.trim() || s.url} — ${s.url}`)].join("\n"),
  ]
    .filter((line) => line !== "")
    .join("\n\n");

  // The zero-yield verdict is decided by CODE inside the fence, whatever the body claims (D11) — a
  // research agent that confabulates when search comes back empty is worse than no research agent,
  // because Phase 12 will cite it. This is the fence's ONLY caller; do not re-implement the
  // labelling here.
  const fenced = researchFindingsFence({
    body: a.body,
    sourceCount: a.sources.length,
    webSearchCalls: a.webSearchCalls,
    declaredUnsupported: a.declaredUnsupported,
    retrievedIso,
  });
  return `${header}\n\n${fenced}\n\n${LIMITS_FOOTER}`;
}

/** `Web research: <question> (retrieved YYYY-MM-DD)`, ≤ 120 chars — the QUESTION is truncated, never
 *  the stamp, so the date survives every title length. */
function researchTitle(question: string, retrievedAt: number): string {
  const suffix = ` (retrieved ${isoDate(retrievedAt)})`;
  const room = MAX_TITLE_CHARS - TITLE_PREFIX.length - suffix.length;
  const q = question.trim().replace(/\s+/g, " ") || "untitled question";
  return `${TITLE_PREFIX}${q.length > room ? `${q.slice(0, room - 1)}…` : q}${suffix}`;
}

/**
 * Land a completed research run in the vault. Called ONLY from the dispatcher, after
 * `dispatchAndLand` has already returned `ok: true` — never from a tool the specialist can reach.
 */
export const persistFindings = internalMutation({
  args: {
    tenantId: v.string(),
    question: v.string(),
    body: v.string(),
    sources: v.array(v.object({ url: v.string(), title: v.string() })),
    /** 22.1: the hosted-search COUNT this run billed for (§4-clean — a number, never a URL). */
    webSearchCalls: v.number(),
    /** 22.1b: did the specialist CALL `declareUnsupported`? REQUIRED, never `v.optional` — an
     *  optional boolean defaults to "no declaration", which is the fail-OPEN direction for an
     *  honesty label, and it would let a caller that never wired the channel look correct. */
    declaredUnsupported: v.boolean(),
    /** D7's freshness stamp: a STORED, QUERYABLE number, not a date mentioned inside markdown. */
    retrievedAt: v.number(),
    rootRequestId: v.string(),
    /** 26-11 (CONT-01): the THREAD and PLAN this run belongs to. `rootRequestId` above is a
     *  per-turn correlation key and is NOT a thread id -- writing it into `sourceThreadId` would
     *  poison the field the Phase-26 artifact shelf joins on. v.optional: no backfill. */
    sourceThreadId: v.optional(v.string()),
    sourcePlanId: v.optional(v.id("plans")),
    incomplete: v.boolean(),
    incompleteReason: v.optional(
      v.union(v.literal("cost"), v.literal("steps"), v.literal("clock")),
    ),
  },
  handler: async (ctx, a): Promise<Id<"vaultDocuments">> => {
    const markdown = researchDocumentText(a);
    // The SAME derivation the stored document used — one call, two consumers, so the audit plane
    // and the document can never disagree about whether this run found anything.
    // ponytail: an audit field, not a `vaultDocuments` column. Promote it to a stored, queryable
    // field the first time something BRANCHES on it programmatically (Phase 12 citation gating
    // refusing to cite a `not_researched` doc); until then a column is a schema change for a value
    // only the eval harness reads.
    const verdict = evidenceVerdict({
      webSearchCalls: a.webSearchCalls,
      sourceCount: a.sources.length,
      declaredUnsupported: a.declaredUnsupported,
    });
    // Computed ONCE, used twice: the audit row's `queryHash` and the document's reuse key (33.2)
    // are the same hash of the same question by construction, never two derivations to drift.
    const questionHash = await contentHash(a.question);
    const vaultDocId = await ctx.db.insert("vaultDocuments", {
      tenantId: a.tenantId,
      title: researchTitle(a.question, a.retrievedAt),
      researchQuestionHash: questionHash,
      kind: "web_research", // the queryable class marker (`kind` is v.string() — no schema change)
      category: categoryFor({ source: "agent" }), // → "workspace-docs", like every generated doc
      source: "web_research",
      mimeType: "text/markdown", // in SEARCHABLE_MIME ⇒ chunked + embedded + graph-extracted
      size: new TextEncoder().encode(markdown).length,
      contentHash: await contentHash(markdown),
      text: markdown,
      status: "processing",
      retrievedAt: a.retrievedAt,
      sourceThreadId: a.sourceThreadId,
      sourcePlanId: a.sourcePlanId,
      createdAt: Date.now(),
    });
    // The SOLE legal way to start ingest — it wires the `onComplete` that prevents a stranded
    // `processing` row. `rootRequestId` as the correlation id, NOT a fresh uuid: it is the lineage
    // key, and it makes the ingest workflow joinable to the dispatch audit trail.
    await startIngest(ctx, { vaultDocId, tenantId: a.tenantId, correlationId: a.rootRequestId });
    // §4 — the `vault.searched` shape: a query HASH, counts, and refs. NEVER the question, NEVER a
    // URL, NEVER any prose. `AuditPayload` permits `readonly string[]`, so an array of URLs would
    // type-check here — that is precisely the trap.
    await ctx.runMutation(internal.audit.log, {
      tenantId: a.tenantId,
      correlationId: a.rootRequestId,
      eventType: "research.persisted",
      actor: "system",
      payload: {
        queryHash: questionHash,
        sourceCount: a.sources.length,
        // A count and a closed enum — §4-clean, and the DURABLE prose-free truth source the eval
        // harness reads (smoke.ts). It replaced a substring scan of `doc.text`, which is model
        // prose quoting attacker-authored pages: a page that quotes the label sentence would flip
        // the verdict. Prose leaves the verdict path entirely here.
        webSearchCalls: a.webSearchCalls,
        evidenceVerdict: verdict,
        // 22.1b: a BOOLEAN (§4-clean — the `claim` prose is captured nowhere). It is what EXPLAINS
        // an `insufficient_evidence` verdict with `sourceCount > 0` to whoever reads the trail
        // later, and it is what `smoke.researchDeclaredUnsupportedForThread` reads — the SEMANTIC
        // act, separable from the `sourceCount === 0` counter leg of the same disjunction.
        declaredUnsupported: a.declaredUnsupported,
        retrievedAt: a.retrievedAt,
        vaultDocId: String(vaultDocId),
        incomplete: a.incomplete,
      },
    });
    return vaultDocId;
  },
});

/**
 * 33.2 (PRD L5): has THIS exact question been researched on THIS tenant since `sinceMs`?
 *
 * Read by `groundMediaBrief` before it buys a research turn. A storyboard "Try again" re-sends the
 * same brief on the same thread, and until 33.2 every retry re-bought ~$0.21 of research for
 * findings that were already in the vault where `searchVault` looks. Keyed on the question HASH
 * (`researchQuestionHash`, written by `persistFindings` above) rather than the thread, so a fresh
 * thread carrying the identical brief reuses too — and bounded by `sinceMs`, so a brief re-asked a
 * month later is researched afresh. A boolean, deliberately: the caller needs "skip or not", and
 * returning the document would be a second read path for content the specialist already reaches
 * through `searchVault`.
 */
export const recentFindingsForQuestion = internalQuery({
  args: { tenantId: v.string(), questionHash: v.string(), sinceMs: v.number() },
  handler: async (ctx, a): Promise<boolean> => {
    const recent = await ctx.db
      .query("vaultDocuments")
      .withIndex("by_tenant_kind", (q) =>
        q.eq("tenantId", a.tenantId).eq("kind", "web_research").gte("createdAt", a.sinceMs),
      )
      .collect();
    return recent.some((d) => d.researchQuestionHash === a.questionHash);
  },
});
