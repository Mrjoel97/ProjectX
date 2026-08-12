// The ONE shape every finance source produces — conversation now, vault documents and connectors
// later. Pure and Convex-free (CLAUDE.md §1): the write boundary in `convex/cash.ts` and the
// staging tool in `convex/llm.ts` both validate through this module, so a claim can never reach a
// store by a route that skipped a rule.
import { type CashInputField, validateCashInput } from "./cash";

/** The display vocabulary from the cash spec. `observed` means PIKAR measured it — reserved for
 *  the measured-figures slice; every claim this phase stores is `stated`. */
export type FigureOrigin = "stated" | "observed";

/** What invariant 11 gates on. A figure the agent heard the owner say is `stated` by a human and
 *  written by an agent — origin and actor are independent. */
export type FigureActor = "user" | "agent";

/** Reuses `evaluations.ts`'s Provenance vocabulary rather than inventing a second scale. */
export type FigureConfidence = "high" | "medium" | "low";

export type FigureClaim = {
  field: CashInputField;
  value: number;
  origin: FigureOrigin;
  actor: FigureActor;
  /** Refs / ids / labels ONLY — never quoted content. This string reaches the audit log and the
   *  approval card, and CLAUDE.md §4 forbids raw user content in either. */
  basis: string;
  /** When the figure was TRUE, not when the row was written. A P&L dated six weeks ago describes a
   *  figure already six weeks into its 90-day staleness clock; stamping `Date.now()` would reset a
   *  clock that must not reset. */
  observedAt: number;
  confidence: FigureConfidence;
};

export function validateFigureClaim(
  claim: FigureClaim,
  nowMs: number = Date.now(),
): { ok: true } | { ok: false; reason: string } {
  // The value rule has ONE definition, in `cash.ts`. Re-deriving bounds here would be a second
  // chance to disagree about what a legal figure is (CLAUDE.md §8 rung 2).
  const value = validateCashInput(claim.field, claim.value);
  if (!value.ok) return value;
  if (claim.basis.trim() === "") return { ok: false, reason: "A claim must carry a basis." };
  if (claim.actor === "user" && claim.confidence !== "high") {
    return { ok: false, reason: "A user-entered figure is always high confidence." };
  }
  // A date phrase parsed with `Date.parse`/`new Date(x).getTime()` (later tasks) yields NaN on
  // failure, and Convex's float64 columns accept it silently. Left unchecked, a NaN observedAt
  // freezes the field forever: `isNewerThan` and `needsConfirmation` (cash.ts) both compare
  // against it with `>`, which is always false against NaN — never newer, never stale. A
  // before-the-epoch value is refused for the same reason: it is not a real "when this was
  // true" and must not reach a store either.
  if (!Number.isFinite(claim.observedAt) || claim.observedAt < 0) {
    return { ok: false, reason: "A figure must have a valid observed date." };
  }
  if (claim.observedAt > nowMs) {
    return { ok: false, reason: "A figure cannot be observed in the future." };
  }
  return { ok: true };
}

/** Propose only if the claim is strictly newer than what is stored. One comparison replaces a
 *  merge policy: a figure typed three days ago is not challenged by a document from July.
 *  `null` means nothing is stored, so anything is newer. */
export const isNewerThan = (claim: FigureClaim, storedObservedAt: number | null): boolean =>
  storedObservedAt === null || claim.observedAt > storedObservedAt;
