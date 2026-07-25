// The generalized executor's action-type union (ACTN-01). Pure TS, Convex-free (CLAUDE.md §1) —
// the ARMS themselves stay in convex/ because they do DB writes, mirroring the existing
// routing.ts / diagnose() split. Wave 0 (15-01) shipped the union + the reader; 15-05 adds the
// `Arm` type, the arm table behind `armFor`, and the exhaustiveness backstop.

/** The closed set of action types an approved plan can execute (ACTN-01). Adding a member
 *  without an arm is a COMPILE error at the arm table in cockpit.ts (15-05). */
export const ACTION_TYPES = ["email", "memo"] as const;
export type ActionType = (typeof ACTION_TYPES)[number];

/** plans.kind is `v.optional(v.literal("memo"))` — ABSENT means the email plan every prior
 *  phase built, so this needs no migration and no backfill. */
export const actionTypeOf = (kind: "memo" | undefined): ActionType => kind ?? "email";

/** How an arm executes. `workflow` = durable multi-step orchestration (email today, calendar in
 *  Phase 17). `inline` = a single transactional write (memo). Two-level dispatch: executePlan is
 *  the DISPATCHER and picks the arm; deliverApprovedPlan is the workflow-backed EMAIL arm's entry
 *  point, NOT the universal dispatcher — routing an inline arm through it would add orchestration,
 *  workflow rows and latency for one DB write, and would re-expose the gmail fan-out as
 *  reachable-in-principle from every action type. */
export type Arm = "workflow" | "inline";

/** THE arm table. A `satisfies Record<ActionType, Arm>` bind, not a ternary: a ternary is total by
 *  construction, so widening ACTION_TYPES would silently route the new member to whichever arm the
 *  else-branch names. This way adding a member without deciding its arm is a COMPILE error here —
 *  which is the whole "a later phase adds an arm with zero spine edits" guarantee. */
const ARMS = { email: "workflow", memo: "inline" } as const satisfies Record<ActionType, Arm>;

export const armFor = (t: ActionType): Arm => ARMS[t];

/** Unreachable backstop for an exhaustive switch. The closed union is the guarantee; this only
 *  fires if a member was added without an arm, which is already a COMPILE error. */
export function assertNever(x: never): never {
  throw new Error(`unreachable action type: ${String(x)}`);
}
