// @pikar/voice — pure-TS voice-session domain (CLAUDE.md §1). No Convex imports.
// Realtime API shapes, brief composer, session FSM, and metering land here as the
// Wave 0 foundation every later voice plan imports.
export {
  CALLS_URL,
  CLIENT_SECRETS_URL,
  DEFAULT_REALTIME_MODEL,
  MINI_REALTIME_MODEL,
  REALTIME_CLIENT_EVENTS,
  REALTIME_EVENTS,
  RESPONSE_DONE_USAGE_FIELDS,
  SESSION_CONFIG_KEYS,
  TRANSCRIPTION_MODEL,
  TURN_DETECTION_TYPE,
  hangupUrl,
  readUsage,
} from "./realtime";
export type { RealtimeUsage } from "./realtime";
export { buildBriefMarkdown } from "./brief";
export type { BriefSections, TranscriptTurn } from "./brief";
export { CAP_MS, canTransition, capEndsAt, graceExpired, isEnded } from "./session";
export type { SessionStatus } from "./session";
export { ZERO_USAGE, accumulateUsage } from "./metering";
export type { UsageDelta } from "./metering";
