// @pikar/voice — pure-TS voice-session domain (CLAUDE.md §1). No Convex imports.
// Realtime API shapes, brief composer, session FSM, and metering land here as the
// Wave 0 foundation every later voice plan imports.

export type { BriefSections, TranscriptTurn } from "./brief";
export { BRIEF_HEADERS, buildBriefMarkdown, composeBrief, planSeedFromBrief } from "./brief";
export type {
  DocReviewConfidence,
  DocReviewSection,
  RawDocReview,
  ShapedDocFinding,
  ShapedDocGap,
  ShapedDocReview,
} from "./docSession";
// Voice-doc discussion (Phase 14, DOCV-01) — the contract surface every downstream plan imports.
export {
  buildDocDigest,
  composeDocMemo,
  DIGEST_CHAR_CAP,
  DIGEST_FENCE_CLOSE,
  DIGEST_FENCE_OPEN,
  DOC_GAP_PLAYBOOK,
  DOC_GAP_ROUTE,
  DOC_REVIEW_CONFIDENCE,
  DOC_REVIEW_FRAMEWORK,
  DOC_REVIEW_SECTIONS,
  EXCERPT_CHAR_CAP,
  PICKER_DOC_SCAN_CAP,
  RETRIEVAL_CHAR_CAP,
  RETRIEVAL_MAX_PASSAGES,
  SEARCH_DOCUMENT_TOOL,
  shapeDocReview,
  VOICE_DOC_THREAD_PREFIX,
  voiceDocThreadId,
} from "./docSession";
export type { UsageDelta } from "./metering";
export { accumulateUsage, ZERO_USAGE } from "./metering";
export type { RealtimeUsage } from "./realtime";
export {
  CALLS_URL,
  CLIENT_SECRETS_URL,
  DEFAULT_REALTIME_MODEL,
  hangupUrl,
  MINI_REALTIME_MODEL,
  REALTIME_CLIENT_EVENTS,
  REALTIME_EVENTS,
  REALTIME_FUNCTION_CALL,
  RESPONSE_DONE_USAGE_FIELDS,
  readUsage,
  SESSION_CONFIG_KEYS,
  SESSION_TOOL_KEYS,
  TOOL_CHOICE_AUTO,
  TRANSCRIPTION_MODEL,
  TURN_DETECTION_TYPE,
} from "./realtime";
export type { SessionStatus } from "./session";
export { CAP_MS, canTransition, capEndsAt, graceExpired, isEnded } from "./session";
