// The cockpit CRM plan card's one piece of logic: turning a staged operation list into the exact
// sentences the human reads before Approve (19-06, ACTN-05).
//
// It is a pure function on purpose. The card must show EXACTLY what will be written, and the
// formatter reads the list through `parseCrmOperations` — the SAME validator `executePlan` runs at
// the apply boundary — so the card cannot promise something the server would refuse.
import { describe, expect, test } from "vitest";
import { describeCrmOperations } from "./cards";

const DUE = Date.parse("2026-08-14T09:00:00.000Z");

describe("describeCrmOperations (the CRM plan card's line list)", () => {
  test("one plain-language line per operation, in the staged order", () => {
    const lines = describeCrmOperations([
      { op: "addContact", email: "  Bob@X.com ", name: "Bob", origin: "user-entered" },
      { op: "addContact", email: "ann@y.com", origin: "mailbox-resolved" },
      { op: "addFollowUp", email: "bob@x.com", note: "chase the quote", dueAt: DUE },
      { op: "completeFollowUp", followUpRef: "k1" },
      { op: "cancelFollowUp", followUpRef: "k2" },
    ]);

    expect(lines).toHaveLength(5);
    // The address the card shows is the NORMALIZED one — the same key the row is written under, so
    // the card cannot name one person and the database another.
    expect(lines[0]).toBe("Add contact: bob@x.com (Bob)");
    expect(lines[1]).toBe("Add contact: ann@y.com");
    expect(lines[2]).toContain("Follow up with bob@x.com by ");
    expect(lines[2]).toContain(" — chase the quote");
    expect(lines[3]).toBe("Mark a follow-up done");
    expect(lines[4]).toBe("Cancel a follow-up");
  });

  // The card renders this as "nothing to approve" and hides the Approve button. A card offering to
  // approve a list the applier will refuse is worse than one that says it is broken.
  test("THROWS on a list the applier would refuse, rather than rendering a partial promise", () => {
    expect(() => describeCrmOperations([])).toThrow(/CRM_OPERATIONS_EMPTY/);
    expect(() => describeCrmOperations(undefined)).toThrow(/CRM_OPERATIONS_NOT_A_LIST/);
    expect(() =>
      describeCrmOperations([{ op: "addFollowUp", email: "bob@x.com", note: "no date" }]),
    ).toThrow(/CRM_FOLLOWUP_DUEAT_REQUIRED/);
  });
});
