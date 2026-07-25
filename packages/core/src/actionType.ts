// The generalized executor's action-type union (ACTN-01). Pure TS, Convex-free (CLAUDE.md §1).
// Wave 0 (15-01) ships the union and the reader only; `armFor`, the `Arm` type and the
// exhaustiveness helper are 15-05's.

/** The closed set of action types an approved plan can execute (ACTN-01). Adding a member
 *  without an arm is a COMPILE error at the arm table in cockpit.ts (15-05). */
export const ACTION_TYPES = ["email", "memo"] as const;
export type ActionType = (typeof ACTION_TYPES)[number];

/** plans.kind is `v.optional(v.literal("memo"))` — ABSENT means the email plan every prior
 *  phase built, so this needs no migration and no backfill. */
export const actionTypeOf = (kind: "memo" | undefined): ActionType => kind ?? "email";
