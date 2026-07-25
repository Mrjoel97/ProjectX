import { describe, expect, test } from "vitest";
import { ACTION_TYPES, actionTypeOf } from "./actionType";

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
  test("the union is exactly email + memo at Wave 0", () => {
    expect(ACTION_TYPES).toEqual(["email", "memo"]);
  });
});
