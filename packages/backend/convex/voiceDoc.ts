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
import { isEnded, RETRIEVAL_CHAR_CAP, RETRIEVAL_MAX_PASSAGES } from "@pikar/voice";
import type { GenericActionCtx } from "convex/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { DataModel, Id } from "./_generated/dataModel";
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
