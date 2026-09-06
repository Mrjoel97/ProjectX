import { expect, test } from "vitest";
import { SPECIALISTS } from "./specialists";
import { grantsFor, isRevenueToolGrant, NO_GRANTS, type ToolGrants } from "./toolGrants";

// Phase 38: the one derivation behind every cockpit tool set. The table pins ADR-007 — a name in
// an allow-list is a request, never a grant — and the identity rule on the revenue tuple.

const base = {
  webResearch: false,
  dispatch: false,
  skillAuthoring: false,
  revenueReads: false,
  invoiceReminderStage: false,
  documentIsDeliverable: false,
  recipientEdits: true,
  gmail: true,
} satisfies ToolGrants;

const table: ReadonlyArray<[string, readonly string[] | undefined, Partial<ToolGrants>]> = [
  [
    "executive (no allow-list)",
    undefined,
    { dispatch: true, skillAuthoring: true, invoiceReminderStage: true },
  ],
  ["empty allow-list", [], {}],
  ["webResearch by name", ["webResearch"], { webResearch: true }],
  ["research tuple", SPECIALISTS.research.tools, { webResearch: true }],
  ["revenue tuple (identity)", SPECIALISTS.revenue.tools, { revenueReads: true }],
  ["revenue tuple COPY", [...SPECIALISTS.revenue.tools], {}],
  ["stageInvoiceReminder by name", ["stageInvoiceReminder"], {}],
  ["executive names in a list", ["authorSkillCandidate", "dispatchResearch"], {}],
];

for (const [label, toolNames, expected] of table) {
  test(`grantsFor: ${label}`, () => {
    expect(grantsFor({ toolNames })).toEqual({ ...base, ...expected });
  });
}

test("eval seam opens revenueReads + invoiceReminderStage even with a copied list", () => {
  const g = grantsFor({ toolNames: [...SPECIALISTS.revenue.tools], evalRevenueFixtureId: "fx-1" });
  expect(g).toEqual({ ...base, revenueReads: true, invoiceReminderStage: true });
  // and the seam alone never grants the other executive bits
  expect(g.dispatch).toBe(false);
  expect(g.skillAuthoring).toBe(false);
});

test("the caller-owned bits pass through", () => {
  expect(grantsFor({ toolNames: [], omitRecipientEdits: true }).recipientEdits).toBe(false);
  expect(grantsFor({ toolNames: [], gmailEnabled: false }).gmail).toBe(false);
  expect(grantsFor({ toolNames: [], gmailEnabled: undefined }).gmail).toBe(true);
  expect(grantsFor({ toolNames: [], documentIsDeliverable: undefined }).documentIsDeliverable).toBe(
    false,
  );
  expect(grantsFor({ toolNames: [], documentIsDeliverable: true }).documentIsDeliverable).toBe(
    true,
  );
});

test("isRevenueToolGrant is identity, not value equality", () => {
  expect(isRevenueToolGrant(SPECIALISTS.revenue.tools)).toBe(true);
  expect(isRevenueToolGrant([...SPECIALISTS.revenue.tools])).toBe(false);
  expect(isRevenueToolGrant(undefined)).toBe(false);
});

test("NO_GRANTS is the bare caller, NOT the executive", () => {
  expect(NO_GRANTS).toEqual(base);
  const executive = grantsFor({});
  // Exactly these three bits separate a bare caller from the executive.
  expect(executive).toEqual({
    ...NO_GRANTS,
    dispatch: true,
    skillAuthoring: true,
    invoiceReminderStage: true,
  });
  expect(NO_GRANTS.dispatch).toBe(false);
  expect(NO_GRANTS.skillAuthoring).toBe(false);
  expect(NO_GRANTS.invoiceReminderStage).toBe(false);
});

test("results are frozen", () => {
  expect(Object.isFrozen(NO_GRANTS)).toBe(true);
  expect(Object.isFrozen(grantsFor({}))).toBe(true);
  expect(Object.isFrozen(grantsFor({ toolNames: [] }))).toBe(true);
});
