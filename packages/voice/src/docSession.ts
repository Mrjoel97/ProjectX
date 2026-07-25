// Voice-doc discussion domain (DOCV-01) — pure TS, no Convex import (CLAUDE.md §1;
// `importGuard.test.ts` enforces it). Every literal the voice-doc flow needs lives HERE
// exactly once, so no downstream plan re-derives one and drifts.

/** The evaluations.framework literal for a voice-doc review. Printed verbatim by
 *  evaluations.ts buildMemo as user-visible memo prose — keep it human-readable. */
export const DOC_REVIEW_FRAMEWORK = "document-review" as const;

/** A voice session has no cockpit thread; the evaluations row needs one. Deterministic from the
 *  session id, so PostCall, actOnGap and byThread all derive the same id with no extra column. */
export const VOICE_DOC_THREAD_PREFIX = "voice-doc:" as const;
export const voiceDocThreadId = (sessionId: string): string =>
  `${VOICE_DOC_THREAD_PREFIX}${sessionId}`;

/** Chars of report text baked into the mint-time instructions. Budgeted small on purpose:
 *  gpt-realtime-2.1 is a 32k window / 4,096 max output and instructions are re-billed as input
 *  every turn — depth comes from SEARCH_DOCUMENT_TOOL, which is the point of the hybrid design. */
export const DIGEST_CHAR_CAP = 6_000;
/** Chars returned to the model per retrieval call (~one vaultGround PER_DOC_CHAR_CAP slice). */
export const RETRIEVAL_CHAR_CAP = 1_200;
/** Max passages returned per retrieval call. */
export const RETRIEVAL_MAX_PASSAGES = 3;

/** Max chars of a QUOTED PASSAGE persisted on a finding (evaluations.findings[].citationExcerpt).
 *  14-CONTEXT.md locks citations as "document-level always, PLUS a quoted passage where
 *  available"; this is the cap on that second half. Same discipline as DIGEST_CHAR_CAP /
 *  RETRIEVAL_CHAR_CAP: a hard cap, not a target — an excerpt is a quote, not a second digest. */
export const EXCERPT_CHAR_CAP = 300;

/** Realtime tool shape is FLAT — {type,name,description,parameters} — NOT the Chat-Completions
 *  {type,function:{...}} nesting. This is the ONE place the literal lives (CLAUDE.md §1). */
export const SEARCH_DOCUMENT_TOOL = {
  type: "function",
  name: "search_document",
  description:
    "Search the report under discussion for passages relevant to a question. Use it whenever the " +
    "user asks about something specific you were not given up front. Returns verbatim passages " +
    "from THIS document only.",
  parameters: {
    type: "object",
    properties: { query: { type: "string", description: "What to look for, in the user's words." } },
    required: ["query"],
    additionalProperties: false,
  },
} as const;

/** Welded-in-code gap routing. evaluations.ts buildMemo prints
 *  "Run the **${gap.route}** specialist against its `${gap.playbook}` playbook" as user-visible
 *  prose in an approvable memo, so the MODEL never chooses these (same discipline as citations).
 *  ponytail: one route until Phase 15 dispatch exists; upgrade path is a route map keyed on the
 *  finding section once real specialists are dispatchable. */
export const DOC_GAP_ROUTE = "document-analyst" as const;
export const DOC_GAP_PLAYBOOK = "document-review" as const;
