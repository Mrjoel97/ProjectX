// INTK-04 submit validation — pure domain logic (CLAUDE.md §1: no Convex imports).
//
// The trust boundary that makes the worst failure mode (a hallucinated recipient
// mailing a stranger) structurally impossible: the recipient is an explicit `To:`
// field validated here, never model-derived. Runs BEFORE the un-testable
// workflow.start so every rejection is deterministic and unit-tested.
//
// Identity/auth (INTK-04 check #1) is NOT here — tenantMutation fails closed on it.

/** Max goal length in characters. */
export const MAX_GOAL_LEN = 10_000;

/** Per-attachment byte cap (~10MB). */
export const MAX_ATTACHMENT_SIZE = 10 * 1024 * 1024;

/** Max attachments per submit. */
export const MAX_ATTACHMENTS = 5;

/** Accepted attachment MIME types (png/jpg/webp/pdf/mp3/m4a/wav/txt/md/docx). */
export const MIME_ALLOWLIST: ReadonlySet<string> = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "application/pdf",
  "audio/mpeg", // mp3
  "audio/mp4", // m4a
  "audio/x-m4a",
  "audio/wav",
  "audio/x-wav",
  "audio/wave",
  "text/plain", // txt
  "text/markdown", // md
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document", // docx
]);

/** Extension → MIME for the text types browsers routinely fail to type. */
const EXT_MIME: Readonly<Record<string, string>> = {
  txt: "text/plain",
  md: "text/markdown",
  markdown: "text/markdown",
  csv: "text/csv",
};

/**
 * Resolve a file's MIME type, falling back to its extension when the browser gives none.
 *
 * `File.type` is unreliable: Windows has no registered MIME type for `.md`/`.csv`, so Chrome
 * reports `""` and an allow-list check on the raw value rejects a file the list actually permits
 * (`text/markdown` IS allow-listed). Both upload surfaces — the cockpit AttachmentPicker and the
 * vault Dropzone — resolve through here, so the fallback cannot drift between them.
 */
export function resolveMimeType(filename: string, browserType: string): string {
  if (browserType) return browserType;
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  return EXT_MIME[ext] ?? "application/octet-stream";
}

/** Structural email check — shape only, NOT deliverability. Anchored, single address. */
export const isValidEmail = (s: string): boolean => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);

/** Attachment metadata the boundary validates (contents are never inspected). */
export interface Attachment {
  storageId: string;
  filename: string;
  mimeType: string;
  size: number;
}

export interface SubmitInput {
  goal: string;
  recipient: string;
  attachments: Attachment[];
}

export type RejectionReason =
  | "empty_goal"
  | "goal_too_long"
  | "bad_recipient"
  | "bad_mime"
  | "attachment_too_large"
  | "too_many_attachments";

export type ValidateResult = { ok: true } | { ok: false; reason: RejectionReason };

/** Validate a submit; returns the first failing check, or { ok: true }. */
export function validateSubmit({ goal, recipient, attachments }: SubmitInput): ValidateResult {
  if (goal.trim().length === 0) return { ok: false, reason: "empty_goal" };
  if (goal.length > MAX_GOAL_LEN) return { ok: false, reason: "goal_too_long" };
  if (!isValidEmail(recipient)) return { ok: false, reason: "bad_recipient" };
  if (attachments.length > MAX_ATTACHMENTS) return { ok: false, reason: "too_many_attachments" };
  for (const a of attachments) {
    if (!MIME_ALLOWLIST.has(a.mimeType)) return { ok: false, reason: "bad_mime" };
    if (a.size > MAX_ATTACHMENT_SIZE) return { ok: false, reason: "attachment_too_large" };
  }
  return { ok: true };
}
