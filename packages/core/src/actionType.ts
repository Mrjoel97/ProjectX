// The generalized executor's action-type union (ACTN-01). Pure TS, Convex-free (CLAUDE.md §1) —
// the ARMS themselves stay in convex/ because they do DB writes, mirroring the existing
// routing.ts / diagnose() split. Wave 0 (15-01) shipped the union + the reader; 15-05 adds the
// `Arm` type, the arm table behind `armFor`, and the exhaustiveness backstop.

/** The closed set of action types an approved plan can execute (ACTN-01). Adding a member
 *  without an arm is a COMPILE error at the arm table in cockpit.ts (15-05). */
export const ACTION_TYPES = ["email", "memo", "calendar_event", "media", "crm_write"] as const;
export type ActionType = (typeof ACTION_TYPES)[number];

/** plans.kind is `v.optional(v.literal("memo"))` — ABSENT means the email plan every prior
 *  phase built, so this needs no migration and no backfill. */
export const actionTypeOf = (
  kind: "memo" | "calendar_event" | "media" | "crm_write" | undefined,
): ActionType => kind ?? "email";

/** How an arm executes. `workflow` = durable multi-step orchestration (email). `inline` = a single
 *  transactional write (memo). `externalAction` = ONE governed external side effect, executed by
 *  the action-retrier behind the Approve gate.
 *
 *  CORRECTED AGAIN in Phase 20 (20-07). This used to say "(calendar)". `externalAction` now has
 *  TWO occupants — `calendar_event` and `media` — and it is no longer calendar's arm. Phase 20
 *  answered research Open Question 1 with GENERALIZE: routing a canvas Generate button around
 *  `executePlan` would still break `actionTypeOf`'s parameter type the moment `plans.kind` widened,
 *  forcing an explicit `kind === "media"` refusal inside the dispatcher — a hole wearing a guard's
 *  clothes, and two Approve stories instead of one. The per-type TARGET table lives in `cockpit.ts`
 *  (`EXTERNAL_TARGETS`), so a third occupant cannot silently inherit calendar's retrier target.
 *
 *  Two-level dispatch: executePlan is the DISPATCHER and picks the arm; deliverApprovedPlan is the
 *  workflow-backed EMAIL arm's entry point, NOT the universal dispatcher — routing an inline arm
 *  through it would add orchestration, workflow rows and latency for one DB write, and would
 *  re-expose the gmail fan-out as reachable-in-principle from every action type.
 *
 *  CORRECTED in Phase 17. This comment used to promise "calendar in Phase 17" under `workflow`;
 *  research REFUTED that, and a third arm is STRUCTURALLY FORCED:
 *    - NOT `inline` — `executePlan` is a `tenantMutation` (pinned by `dispatchGuard.test.ts:95`)
 *      and a Convex mutation cannot `fetch`.
 *    - NOT `workflow` — that case IS the gmail fan-out (`cockpit.ts:496-505`), so classifying an
 *      external write as `workflow` would silently inherit the EMAIL terminal.
 *  Phases 18 (document creation) and 19 (CRM writes) are the same mechanism — one governed
 *  external side effect driven by the retrier, not a DB write and not a fan-out — so they reuse
 *  this arm rather than adding a fourth.
 *
 *  CORRECTED A THIRD TIME in Phase 19 (19-06), by the commit that falsified the sentence above.
 *  That prediction was wrong about BOTH phases it named, and the second half of the sentence is
 *  what made it wrong: it assumed the side effect was EXTERNAL.
 *    - **Phase 18 never took this arm at all.** It shipped with `ACTION_TYPES` still four members
 *      and `plans.kind` still `memo | calendar_event | media`; document creation landed as a
 *      cockpit TOOL (`createDocument`) writing a vault row inside the turn, not as an action type
 *      behind Approve. The prediction described a registration that never happened.
 *    - **Phase 19 is `inline`, not `externalAction`.** A CRM write targets OUR OWN `contacts` /
 *      `followUps` tables, so applying an approved operation list is "a single transactional
 *      write" — this file's own definition of the `inline` arm, three lines up. There is no
 *      `fetch`, no third-party API and nothing for the retrier to retry; a Convex mutation is
 *      serializable, so approve-all-or-none falls out for free. Routing it through the retrier
 *      would buy at-least-once delivery of a write that is already exactly-once.
 *  The standing lesson, since this comment has now been wrong twice: a future phase's arm is a
 *  PREDICTION until its member is in `ARMS` below. Read the table, not the prose. */
export type Arm = "workflow" | "inline" | "externalAction";

/** THE arm table. A `satisfies Record<ActionType, Arm>` bind, not a ternary: a ternary is total by
 *  construction, so widening ACTION_TYPES would silently route the new member to whichever arm the
 *  else-branch names. This way adding a member without deciding its arm is a COMPILE error here —
 *  which is the whole "a later phase adds an arm with zero spine edits" guarantee. */
const ARMS = {
  email: "workflow",
  memo: "inline",
  calendar_event: "externalAction",
  media: "externalAction",
  // 19-06 ACTN-05: the `inline` arm's SECOND occupant. A CRM write is one transactional write on
  // our own tables — see the third correction in the `Arm` comment for why it is not `externalAction`.
  crm_write: "inline",
} as const satisfies Record<ActionType, Arm>;

export const armFor = (t: ActionType): Arm => ARMS[t];

/** Unreachable backstop for an exhaustive switch. The closed union is the guarantee; this only
 *  fires if a member was added without an arm, which is already a COMPILE error. */
export function assertNever(x: never): never {
  throw new Error(`unreachable action type: ${String(x)}`);
}
