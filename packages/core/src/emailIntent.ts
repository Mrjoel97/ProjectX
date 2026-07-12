// SC2/SC3 guided-conversation brain — pure domain logic (CLAUDE.md §1: no Convex imports).
//
// The deterministic half of the cockpit (DECISION #2): this module computes the NEXT
// question to ask; the LLM is used only later, for the body draft. It has NO send path
// and NO Convex import, so "nothing is ever sent on an assumption" is structurally true,
// not conventional — an invalid recipient literally cannot enter `state.recipients`.
//
// Pure: no Date.now, no randomness, no I/O. The ordered `if` branches in nextQuestion ARE
// the spec. isValidEmail is the ONE email regex (shared with validateSubmit — one truth).

import { isValidEmail } from "./validateSubmit";

/** Whether a multi-recipient send goes out individually or as one group thread. */
export type RecipientMode = "individual" | "group";

/**
 * Accumulated answers so far. Immutable — every applyAnswer returns a fresh object.
 * `rejected` holds recipients that bounced validation and are pending re-ask; they are
 * NEVER stored in `recipients` (the trust boundary). Absent `attachmentIntent` never gates ready.
 */
export interface EmailIntentState {
  readonly recipients: readonly string[];
  readonly subject?: string;
  readonly bodyIntent?: string;
  readonly mode?: RecipientMode;
  readonly attachmentIntent?: string;
  readonly rejected?: readonly string[];
}

/** The empty starting point of a conversation. */
export const emptyIntent: EmailIntentState = { recipients: [] };

/** The single next thing to ask the user, or `ready` when every required slot is filled. */
export type NextQuestion =
  | { kind: "ask_recipients" }
  | { kind: "reask_recipient"; invalid: string }
  | { kind: "ask_subject" }
  | { kind: "ask_body_intent" }
  | { kind: "ask_mode" }
  | { kind: "ready" };

/** One user answer, discriminated by the slot it fills. */
export type Answer =
  | { slot: "recipients"; value: readonly string[] }
  | { slot: "subject"; value: string }
  | { slot: "bodyIntent"; value: string }
  | { slot: "mode"; value: RecipientMode }
  | { slot: "attachmentIntent"; value: string };

/** Result of applying an answer: the new state, plus rejected recipients when any bounced. */
export type ApplyResult =
  | { ok: true; state: EmailIntentState }
  | { ok: false; state: EmailIntentState; rejected: { slot: "recipients"; invalid: string[] } };

/**
 * The ordered branches ARE the spec. Never returns `ready` while a required slot is missing
 * or a recipient is pending re-ask. `ask_mode` fires only when there is a real choice (>1).
 */
export function nextQuestion(state: EmailIntentState): NextQuestion {
  const pending = state.rejected?.[0];
  if (pending !== undefined) {
    return { kind: "reask_recipient", invalid: pending };
  }
  if (state.recipients.length === 0) return { kind: "ask_recipients" };
  if (state.subject === undefined) return { kind: "ask_subject" };
  if (state.bodyIntent === undefined) return { kind: "ask_body_intent" };
  if (state.recipients.length > 1 && state.mode === undefined) return { kind: "ask_mode" };
  return { kind: "ready" };
}

/** Merge `incoming` into `existing`, skipping case-insensitive duplicates. */
function dedupeAppend(existing: readonly string[], incoming: readonly string[]): string[] {
  const seen = new Set(existing.map((r) => r.toLowerCase()));
  const out = [...existing];
  for (const r of incoming) {
    const key = r.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(r);
  }
  return out;
}

/**
 * Validate + merge one answer immutably. Invalid recipients are NOT stored — they bounce back
 * in `rejected` so the caller re-asks only those. A clean answer clears any prior rejection.
 */
export function applyAnswer(state: EmailIntentState, answer: Answer): ApplyResult {
  if (answer.slot === "recipients") {
    const valid: string[] = [];
    const invalid: string[] = [];
    for (const r of answer.value) (isValidEmail(r) ? valid : invalid).push(r);

    const recipients = dedupeAppend(state.recipients, valid);
    if (invalid.length > 0) {
      return {
        ok: false,
        state: { ...state, recipients, rejected: invalid },
        rejected: { slot: "recipients", invalid },
      };
    }
    // clean answer: drop the pending rejection
    const { rejected: _drop, ...rest } = state;
    return { ok: true, state: { ...rest, recipients } };
  }

  return { ok: true, state: { ...state, [answer.slot]: answer.value } };
}
