// Pure conversation-turn framer (CLAUDE.md §1 — no Convex import). Turns already-redacted
// safeText into the synthetic user turn an attachment/dictation merges into the cockpit as.
// Never takes raw bytes or a storageId — safeText only (CLAUDE.md §4).
import type { IntakeKind } from "./classify";

/**
 * frameForConversation — builds the synthetic user turn that merges an intake result into
 * the cockpit conversation.
 *
 * - Attachment kinds (image/pdf/document): wrap safeText with a short frame naming the file,
 *   so runCockpitAgent treats it as attached context.
 * - Audio (dictation): the transcript IS the user's request — return it VERBATIM, no wrapper
 *   (per 04-RESEARCH § Voice Dictation).
 */
export function frameForConversation(kind: IntakeKind, filename: string, safeText: string): string {
  if (kind === "audio") return safeText;
  return `Here is the content of the attached file ${filename}:\n\n${safeText}`;
}
