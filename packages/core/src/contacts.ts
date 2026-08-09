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
