// The ONE closed table of what may be proposed (design §3.3). Three consumers read it — the
// derive pass's structured-output schema (plan 3), this plan's applier dispatch, and the gap
// finder (plan 4) — so a target that is legal for one is legal for all three, by construction
// rather than by three lists agreeing.
//
// It is ASSEMBLED from the existing field sets, never a restatement of them: `CASH_INPUTS` owns
// which finance figures exist and which store each lives in, and `FIELD_SPEC.derivable` owns which
// narrative fields a model may propose. Adding a field there adds it here; the totality test in
// proposal.test.ts fails if the two ever drift.
import { BLUEPRINT_FIELDS, FIELD_SPEC } from "./blueprint";
import type { BusinessProfile } from "./businessProfile";
import { CASH_INPUTS } from "./cash";
import type { FigureActor, FigureConfidence, FigureOrigin } from "./financeClaim";

/**
 * The `BusinessProfile` keys a profile proposal may actually persist into — a `keyof BusinessProfile`
 * array, so a typo here is a compile error rather than a silently-dead registry entry.
 *
 * NOT the same set as "derivable blueprint fields" (`FIELD_SPEC[f].derivable`): `revenueModel` and
 * `bindingConstraint` are legal, model-derivable BLUEPRINT fields — they reach the blueprint spine
 * as document-derived candidates — but `BusinessProfile` has no field for either, so there is
 * nowhere for `writeProfileDoc` to persist a proposal for them. Before this list existed, both
 * passed `proposalTarget`'s existence check, got merged onto the write object by the applier, and
 * were silently dropped by `serializeProfile` — a proposal that reported success and changed
 * nothing. `PROPOSAL_TARGETS` below intersects `derivable` with membership here so that failure
 * mode cannot recur: excluded fields never become a `ProposalTarget` at all, so the applier's
 * `unknown_target` refusal catches them instead of an approval doing nothing.
 */
const PROFILE_WRITABLE_FIELDS: readonly (keyof BusinessProfile)[] = [
  "name",
  "oneLineDescription",
  "stage",
  "offering",
  "targetCustomer",
  "primaryGoals",
  "knownConstraints",
] as const;

export type ProposalStore =
  | "financeInputs"
  | "scorecard"
  | "profile"
  | "contacts"
  | "followUps";

export type ProposalTarget = {
  readonly store: ProposalStore;
  readonly field: string;
  readonly label: string;
  readonly valueType: "number" | "string" | "boolean";
  /** What filling this unlocks, for gap ranking in plan 4. `null` when it unlocks nothing named. */
  readonly unlocks: string | null;
};

/** Where a proposed fact came from. Refs and ids ONLY (§4) — never a passage. */
export type ProposalSourceLocator =
  | { readonly kind: "vault_doc"; readonly vaultDocId: string }
  | { readonly kind: "chat"; readonly threadId: string }
  | { readonly kind: "voice"; readonly voiceSessionId: string };

export type ProposedFact = {
  readonly target: { readonly store: ProposalStore; readonly field: string };
  readonly value: number | string | boolean;
  readonly confidence: FigureConfidence;
  readonly origin: FigureOrigin;
  /** Always stamped at apply time, never read from the model. See the applier. */
  readonly actor: FigureActor;
  /** Refs/ids/labels ONLY (§4). Code-constructed, never model-supplied. */
  readonly basis: string;
  /** When the fact was TRUE, not when the row was written. */
  readonly observedAt: number;
  readonly sourceLocator: ProposalSourceLocator;
};

const CONTACT_TARGETS: readonly ProposalTarget[] = [
  {
    store: "contacts",
    field: "addContact",
    label: "Add a contact",
    valueType: "string",
    unlocks: null,
  },
  {
    store: "followUps",
    field: "addFollowUp",
    label: "Add a follow-up",
    valueType: "string",
    unlocks: null,
  },
];

export const PROPOSAL_TARGETS: readonly ProposalTarget[] = [
  ...CASH_INPUTS.map((spec) => ({
    store: spec.store as ProposalStore,
    field: spec.field as string,
    label: spec.label,
    valueType: "number" as const,
    unlocks: spec.unlocks,
  })),
  ...BLUEPRINT_FIELDS.filter(
    (f) => FIELD_SPEC[f].derivable && (PROFILE_WRITABLE_FIELDS as readonly string[]).includes(f),
  ).map((f) => ({
    store: "profile" as ProposalStore,
    field: f as string,
    label: FIELD_SPEC[f].label,
    valueType: "string" as const,
    unlocks: null,
  })),
  ...CONTACT_TARGETS,
];

const BY_KEY = new Map(PROPOSAL_TARGETS.map((t) => [`${t.store}:${t.field}`, t]));

/** `null` for an unknown pair — a model naming a field that does not exist is expected input,
 *  not an exceptional condition, so this never throws. */
export const proposalTarget = (store: string, field: string): ProposalTarget | null =>
  BY_KEY.get(`${store}:${field}`) ?? null;

/** What a store already holds for a target, in the ONE shape both predicates need. The applier
 *  reads it per store; the predicates never touch a database. */
export type CurrentValue = {
  readonly value: number | string | boolean;
  /** True only when the OWNER supplied it. An agent-written value is false — see `classifyProposal`. */
  readonly statedByUser: boolean;
  /** When the stored figure was TRUE. `null` for a legacy row with no recorded time. */
  readonly statedAt: number | null;
};

/**
 * `blank`     — nothing there, or what is there carries no owner authority. Sweepable.
 * `overwrite` — would replace something the OWNER stated. Needs its own deliberate click.
 * `stale`     — the fact is older than what is stored. Needs its own deliberate click.
 */
export type ProposalGuard = "blank" | "overwrite" | "stale";

export function classifyProposal(fact: ProposedFact, current: CurrentValue | null): ProposalGuard {
  if (current === null) return "blank";
  // Staleness FIRST. An old fact over an owner-stated value is both stale and an overwrite, and
  // "stale" is the more informative thing to tell the user — it names why the newer number wins.
  // An unknown stored time (`null`) is NOT treated as stale: a legacy row with no recorded time
  // would otherwise block every new fact forever, which is the unsafe direction.
  if (current.statedAt !== null && fact.observedAt < current.statedAt) return "stale";
  // Only the OWNER's word is protected from a one-click sweep. Replacing a previous agent figure
  // with a newer one is ordinary progress, not a contradiction.
  if (current.statedByUser) return "overwrite";
  return "blank";
}

/** Accept-all covers blanks ONLY (design §6.1). Both other guards need their own click. */
export const sweepable = (guard: ProposalGuard): boolean => guard === "blank";
