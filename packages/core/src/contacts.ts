// Contacts, follow-ups and outreach compliance — the PURE half (Phase 19, ACTN-05 / PIPE-01).
// Framework-agnostic: plain `string` ids, no Convex import, so the Convex adapter, the send-path
// guard and the Pipeline component all call the SAME functions rather than each re-deriving them.
//
// `normalizeAddress` is the phase's identity function. It is the ONE reason "the guard and the
// contact row agree by construction" is true rather than hoped for: contacts, suppressions and the
// per-address send guard all key on its output.

/**
 * The contact/suppression identity key: a lowercased, trimmed email address. One row per address.
 *
 * Does NOT validate — an empty or whitespace-only input normalizes to `""` and the CALLER rejects
 * it. Validation here would make the key function throw on a path whose job is only to canonicalise.
 */
// ponytail: trim+lowercase only. Plus-addressing and dot-folding are person-level merging
// (deferred, 19-CONTEXT Deferred Ideas); upgrade path is a second canonicalise() beside this,
// never a change to this one — the suppressions key must stay byte-stable.
export function normalizeAddress(s: string): string {
  return s.trim().toLowerCase();
}

/**
 * "Contacts needing attention" = contacts with NO open follow-up (19-CONTEXT: deliberately
 * COMPLEMENTARY to the "follow-ups due" tile, so two adjacent tiles cannot report the same fact).
 *
 * The caller passes ONLY contact ids carrying an `open` follow-up; `done`/`canceled` ones never
 * reach this set, which is why an empty set means every contact needs attention.
 */
export function needsAttention(
  contactId: string,
  openFollowUpContactIds: ReadonlySet<string>,
): boolean {
  return !openFollowUpContactIds.has(contactId);
}

/** Due AT the instant counts as due — the tile counts `dueAt <= now`, never `<`. */
export function followUpIsDue(dueAt: number, now: number): boolean {
  return dueAt <= now;
}

/**
 * The CAN-SPAM footer appended to EVERY send (19-CONTEXT: one code path, no "is this commercial?"
 * branch to get wrong — SC#6's "the drafter cannot omit it" becomes true by construction).
 *
 * Plain text: the body is `text/plain` in both `buildMime` branches. Fails CLOSED on a blank
 * postal address or unsubscribe URL — a footer rendering an empty address looks compliant and is
 * not, which is worse than no footer at all.
 */
export function renderFooter(input: { postalAddress: string; unsubscribeUrl: string }): string {
  const postalAddress = input.postalAddress.trim();
  if (postalAddress === "") {
    throw new Error("renderFooter: postalAddress is required (CAN-SPAM physical address)");
  }
  const unsubscribeUrl = input.unsubscribeUrl.trim();
  if (unsubscribeUrl === "") {
    throw new Error("renderFooter: unsubscribeUrl is required");
  }
  // Leading blank line: appended to any body, the footer must never run into the last sentence.
  return `\n\n${postalAddress}\nUnsubscribe: ${unsubscribeUrl}`;
}

// ── The crm_write operation list (19-06, ACTN-05) ─────────────────────────────
// What an approved `crm_write` plan applies. Pure: plain `string` refs, no Convex import — the
// Convex adapter resolves a `followUpRef` to a row id and an `email` to a contact. Validated at
// BOTH boundaries (the write that stages the plan, and the apply that executes it) by this one
// function, because the plan row is CONTENT PLANE and could have been revised in between.

/** A staged list this long is a bug or a runaway loop, not an intention. */
export const CRM_OPERATION_MAX = 25;
/** Ceiling on model-authored text landing in a DB row (the `postalAddress` precedent, 19-03). */
export const CRM_TEXT_MAX = 500;

export type CrmContactOrigin = "mailbox-resolved" | "user-entered" | "inbound";

/**
 * ONE governed CRM operation. `addFollowUp` carries an `email` and NOT an optional contact ref:
 * the AGENT must always name a contact. Contactless follow-ups exist (`createFollowUp` takes an
 * optional `contactId`) but are a USER-only capability, and that asymmetry is the structural brake
 * against this CRM quietly becoming a general task generator.
 *
 * The follow-up's text field is `note`, matching `followUps.note` in the schema — 19-01 shipped
 * `note` and the plan text that says `title` pre-dates it (19-02 recorded the same correction).
 */
export type CrmOperation =
  | { op: "addContact"; email: string; name?: string; origin: CrmContactOrigin }
  | { op: "addFollowUp"; email: string; note: string; dueAt: number }
  | { op: "completeFollowUp"; followUpRef: string }
  | { op: "cancelFollowUp"; followUpRef: string };

const ORIGINS: readonly string[] = ["mailbox-resolved", "user-entered", "inbound"];

function text(value: unknown, error: string, max = CRM_TEXT_MAX): string {
  if (typeof value !== "string") throw new Error(error);
  const trimmed = value.trim();
  if (trimmed === "" || trimmed.length > max) throw new Error(error);
  return trimmed;
}

/**
 * Validate and normalize a staged operation list, or throw a NAMED error.
 *
 * Every email goes through `normalizeAddress` here, so the applier never re-derives the identity
 * key (invariant 4 — one copy of the identity rule). Refusals, each deliberate:
 *   - an EMPTY list — a CRM plan with nothing to apply is a bug, not a no-op. It would otherwise
 *     reach `done` having written nothing, which reads to the user as "applied".
 *   - a list over `CRM_OPERATION_MAX`.
 *   - `addFollowUp` with no due date — "Follow-ups due" is a headline tile and an undated
 *     follow-up could never appear in it (`createFollowUp`'s rule, enforced one layer earlier).
 *   - `addFollowUp` naming no contact — see the `CrmOperation` doc comment.
 */
export function parseCrmOperations(raw: unknown): CrmOperation[] {
  if (!Array.isArray(raw)) throw new Error("CRM_OPERATIONS_NOT_A_LIST");
  if (raw.length === 0) throw new Error("CRM_OPERATIONS_EMPTY");
  if (raw.length > CRM_OPERATION_MAX) throw new Error("CRM_OPERATIONS_TOO_MANY");

  return raw.map((entry): CrmOperation => {
    if (typeof entry !== "object" || entry === null) throw new Error("CRM_OPERATION_MALFORMED");
    const o = entry as Record<string, unknown>;
    switch (o.op) {
      case "addContact": {
        const email = normalizeAddress(text(o.email, "CRM_CONTACT_EMAIL_REQUIRED"));
        if (email === "") throw new Error("CRM_CONTACT_EMAIL_REQUIRED");
        if (typeof o.origin !== "string" || !ORIGINS.includes(o.origin)) {
          throw new Error("CRM_CONTACT_ORIGIN_INVALID");
        }
        const name = o.name === undefined ? undefined : text(o.name, "CRM_CONTACT_NAME_INVALID");
        return {
          op: "addContact",
          email,
          ...(name ? { name } : {}),
          origin: o.origin as CrmContactOrigin,
        };
      }
      case "addFollowUp": {
        // Absent, blank or unnormalizable all mean the same thing: the agent named nobody.
        if (typeof o.email !== "string") throw new Error("CRM_FOLLOWUP_CONTACT_REQUIRED");
        const email = normalizeAddress(o.email);
        if (email === "") throw new Error("CRM_FOLLOWUP_CONTACT_REQUIRED");
        // `typeof NaN === "number"` and `Infinity` is finite-typed too — either produces a
        // follow-up the `by_tenant_status_dueAt` range read can never find.
        if (typeof o.dueAt !== "number" || !Number.isFinite(o.dueAt)) {
          throw new Error("CRM_FOLLOWUP_DUEAT_REQUIRED");
        }
        return {
          op: "addFollowUp",
          email,
          note: text(o.note, "CRM_FOLLOWUP_NOTE_REQUIRED"),
          dueAt: o.dueAt,
        };
      }
      case "completeFollowUp":
      case "cancelFollowUp":
        return {
          op: o.op,
          followUpRef: text(o.followUpRef, "CRM_FOLLOWUP_REF_REQUIRED"),
        };
      default:
        throw new Error("CRM_OPERATION_UNKNOWN");
    }
  });
}
