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
import { CASH_INPUTS } from "./cash";
import type { FigureActor, FigureConfidence, FigureOrigin } from "./financeClaim";

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
  ...BLUEPRINT_FIELDS.filter((f) => FIELD_SPEC[f].derivable).map((f) => ({
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
