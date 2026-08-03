import { describe, expect, test } from "vitest";
import { DOC_TYPE_LABEL, DOC_TYPES, type DocType, isDocType } from "./docType";

describe("DOC_TYPES (VALT-12 closed document-type union)", () => {
  // Pinned against `vaultDocuments.docType` in schema.ts. These are the SAME twelve literals; the
  // two-direction compile bridge beside the classifier is what catches drift, and this is the
  // human-readable statement of what that bridge is binding.
  test("is exactly the twelve literals the schema's v.union carries", () => {
    expect(DOC_TYPES).toEqual([
      "pnl",
      "balance_sheet",
      "cash_flow",
      "invoice",
      "contract",
      "policy",
      "deck",
      "report",
      "plan",
      "correspondence",
      "spreadsheet_other",
      "unclassified",
    ]);
  });

  // The locked decision AND the classifier's fallback. Losing it means a failed model call has
  // nowhere to land except a wrong nearest match.
  test("carries `unclassified` — the explicit no-match member", () => {
    expect(DOC_TYPES).toContain("unclassified");
  });

  // Totality at RUNTIME as well as at compile time. DOC_TYPE_LABEL is a table lookup, so a member
  // added to the union without a label reads `undefined` — this is the assertion that catches it.
  test("DOC_TYPE_LABEL is total over DOC_TYPES", () => {
    for (const t of DOC_TYPES) {
      expect(DOC_TYPE_LABEL[t], `no label registered for doc type "${t}"`).toBeDefined();
      expect(DOC_TYPE_LABEL[t]).not.toBe("");
    }
  });

  test("the table holds no label for a type the union does not carry", () => {
    expect(Object.keys(DOC_TYPE_LABEL).sort()).toEqual([...DOC_TYPES].sort());
  });
});

describe("isDocType (the model-string trust boundary)", () => {
  test("accepts every member of the union", () => {
    for (const t of DOC_TYPES) expect(isDocType(t)).toBe(true);
  });

  // These are what a model actually returns when it ignores the enum: a plausible synonym, the
  // human label instead of the key, and empty output. Each one must be COERCED to `unclassified`
  // by the caller, never written through into the schema's closed v.union.
  test.each([
    ["financial_statement", "a plausible synonym that is not a member"],
    ["P&L", "the human LABEL instead of the key"],
    ["PNL", "the right key, wrong case"],
    ["", "empty output"],
    [" pnl", "a member with stray whitespace"],
  ])("rejects %j (%s)", (value) => {
    expect(isDocType(value)).toBe(false);
  });

  test.each([
    [null],
    [undefined],
    [{ docType: "pnl" }],
    [["pnl"]],
    [42],
    [true],
  ])("rejects the non-string %j", (value) => {
    expect(isDocType(value)).toBe(false);
  });
});

// ── Compile-time proof (checked by `tsc --noEmit`, NOT by vitest) ─────────────────────────────
//
// This is what turns "adding a doc type without a label is a compile error" from a comment into a
// checked claim: `@ts-expect-error` FAILS THE BUILD when the error it expects does not occur, so if
// a future edit ever makes an incomplete label table legal, this file stops compiling.

/** A complete label table compiles. */
const _COMPLETE_LABELS = {
  pnl: "P&L",
  balance_sheet: "Balance sheet",
  cash_flow: "Cash flow",
  invoice: "Invoice",
  contract: "Contract",
  policy: "Policy",
  deck: "Deck",
  report: "Report",
  plan: "Plan",
  correspondence: "Correspondence",
  spreadsheet_other: "Spreadsheet (other)",
  unclassified: "Unclassified",
} as const satisfies Record<DocType, string>;

// @ts-expect-error — omitting a DocType's label MUST NOT compile (everything after `pnl` is
// missing).
const _MISSING_LABEL = { pnl: "P&L" } as const satisfies Record<DocType, string>;
