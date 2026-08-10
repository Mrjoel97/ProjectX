import { describe, expect, test } from "vitest";
import {
  ACTION_TYPES,
  type ActionType,
  type Arm,
  actionTypeOf,
  armFor,
  assertNever,
} from "./actionType";

describe("actionTypeOf (ACTN-01 closed action-type union)", () => {
  // The whole no-migration argument: `plans.kind` is v.optional(v.literal("memo")),
  // so every row written before Phase 12 has NO kind and must mean "email".
  test("an absent kind is the email plan every prior phase built", () => {
    expect(actionTypeOf(undefined)).toBe("email");
  });

  test("memo maps to memo", () => {
    expect(actionTypeOf("memo")).toBe("memo");
  });

  // Adding a member here without an arm is a COMPILE error at the arm table (15-05).
  // This assertion makes widening the union a deliberate, visible act.
  test("media maps to media", () => {
    expect(actionTypeOf("media")).toBe("media");
  });

  test("crm_write maps to crm_write", () => {
    expect(actionTypeOf("crm_write")).toBe("crm_write");
  });

  test("actionTypeOf maps the finance_write kind", () => {
    expect(actionTypeOf("finance_write")).toBe("finance_write");
  });

  // EXACT equality, never `.includes` — a member added without visiting every registration site
  // must fail HERE, at the one assertion that reads the whole union.
  test("the union is exactly email + memo + calendar_event + media + crm_write + finance_write", () => {
    expect(ACTION_TYPES).toEqual([
      "email",
      "memo",
      "calendar_event",
      "media",
      "crm_write",
      "finance_write",
    ]);
  });
});

describe("armFor (ACTN-01 — the arm table executePlan dispatches over)", () => {
  // The email arm is durable multi-step orchestration (seed requests → fan out → send → retry);
  // the memo arm is ONE transactional write, and a workflow would add rows and latency for nothing.
  test("email executes as a workflow", () => {
    expect(armFor("email")).toBe("workflow");
  });

  test("memo executes inline", () => {
    expect(armFor("memo")).toBe("inline");
  });

  // 17-01 ACTN-02. NOT `inline` (executePlan is a tenantMutation and a Convex mutation cannot
  // `fetch`) and NOT `workflow` (that case IS the gmail fan-out, so an external write classified
  // as `workflow` would silently inherit the EMAIL terminal). A third arm is structurally forced.
  test("calendar_event executes as an externalAction", () => {
    expect(armFor("calendar_event")).toBe("externalAction");
  });

  // 20-07 MEDIA-01: the arm's SECOND occupant, and the reason `externalAction` stopped being
  // calendar's. The per-type retrier TARGET lives in cockpit.ts's `EXTERNAL_TARGETS`, derived from
  // the arm table itself — so marking a third type `externalAction` without a target is a COMPILE
  // error there, the same way an armless ActionType is one here.
  test("media also executes as an externalAction — the arm has TWO occupants", () => {
    expect(armFor("media")).toBe("externalAction");
    expect(armFor("media")).toBe(armFor("calendar_event"));
  });

  // 19-06 ACTN-05: the `inline` arm's SECOND occupant, and the correction of a prediction this
  // file's own doc comment carried for two phases (it said Phase 19 would reuse `externalAction`).
  // A CRM write is one transactional write on OUR tables, which is `inline`'s definition — there is
  // no fetch and nothing for the retrier to retry. The four arms above are UNCHANGED by it.
  test("crm_write executes inline — the arm memo already occupies", () => {
    expect(armFor("crm_write")).toBe("inline");
    expect(armFor("crm_write")).toBe(armFor("memo"));
    expect(armFor("crm_write")).not.toBe("externalAction");
  });

  // 2026-08-10: the `inline` arm's THIRD occupant. A figure update is one transactional write on
  // our own `financeInputs` table — no fetch, nothing for the retrier to retry — so it takes the
  // arm `memo` and `crm_write` already share rather than a fourth.
  test("finance_write is an inline arm — one transactional write on our own tables", () => {
    expect(armFor("finance_write")).toBe("inline");
  });

  // Totality at RUNTIME as well as at compile time: a member added to the union without an arm
  // cannot slip through here either. armFor is a table lookup, so an unmapped member reads
  // `undefined` — this is the assertion that catches it.
  test("armFor is total over ACTION_TYPES", () => {
    for (const t of ACTION_TYPES) {
      expect(armFor(t), `no arm registered for action type "${t}"`).toBeDefined();
    }
  });

  // The unreachable backstop. It only fires if the closed union was widened without an arm, which
  // is already a COMPILE error — so its job is to name the offending value when the impossible
  // happens, never to be a routing default.
  test("assertNever throws and names the offending value", () => {
    expect(() => assertNever("calendar" as never)).toThrow(/calendar/);
  });
});

// ── Compile-time proof (checked by `tsc --noEmit`, NOT by vitest) ─────────────────────────────
//
// This is what turns "adding an action type without an arm is a compile error" from a comment into
// a checked claim: `@ts-expect-error` FAILS THE BUILD when the error it expects does not occur, so
// if a future edit ever makes an incomplete arm table legal, this file stops compiling.

/** A complete arm table compiles. */
const _COMPLETE_ARMS = {
  email: "workflow",
  memo: "inline",
  calendar_event: "externalAction",
  media: "externalAction",
  crm_write: "inline",
  finance_write: "inline",
} as const satisfies Record<ActionType, Arm>;

// @ts-expect-error — omitting an ActionType's arm MUST NOT compile (`memo` and
// `calendar_event` are missing).
const _MISSING_ARM = { email: "workflow" } as const satisfies Record<ActionType, Arm>;
