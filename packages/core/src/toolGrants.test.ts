import { expect, test } from "vitest";
import { ONLINE_PRESENCE_TOOLS } from "./onlinePresence";
import { SPECIALISTS } from "./specialists";
import { grantsFor, isRevenueToolGrant, NO_GRANTS, type ToolGrants } from "./toolGrants";

// Phase 38: the one derivation behind every cockpit tool set. The table pins ADR-007 — a name in
// an allow-list is a request, never a grant — and the identity rule on the revenue tuple.

const base = {
  webResearch: false,
  onlinePresence: false,
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
    { dispatch: true, skillAuthoring: true, invoiceReminderStage: true, onlinePresence: true },
  ],
  ["empty allow-list", [], {}],
  ["webResearch by name", ["webResearch"], { webResearch: true }],
  ["research tuple", SPECIALISTS.research.tools, { webResearch: true }],
  ["revenue tuple (identity)", SPECIALISTS.revenue.tools, { revenueReads: true }],
  ["revenue tuple COPY", [...SPECIALISTS.revenue.tools], {}],
  ["stageInvoiceReminder by name", ["stageInvoiceReminder"], {}],
  ["executive names in a list", ["authorSkillCandidate", "dispatchResearch"], {}],
  ["online presence tuple identity", ONLINE_PRESENCE_TOOLS, { onlinePresence: true }],
  ["online presence tuple copy", [...ONLINE_PRESENCE_TOOLS], {}],
  ["online presence writes by name", ["saveOnlinePresenceBrief", "buildOnlinePresenceProject"], {}],
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
  // Only the executive and the exact code-owned service tuple receive presence authority.
  expect(executive).toEqual({
    ...NO_GRANTS,
    dispatch: true,
    skillAuthoring: true,
    invoiceReminderStage: true,
    onlinePresence: true,
  });
  expect(NO_GRANTS.dispatch).toBe(false);
  expect(NO_GRANTS.skillAuthoring).toBe(false);
  expect(NO_GRANTS.invoiceReminderStage).toBe(false);
  expect(NO_GRANTS.onlinePresence).toBe(false);
});

test("the presence tuple grants only the bounded service and copies cannot grant writes", () => {
  expect(Object.isFrozen(ONLINE_PRESENCE_TOOLS)).toBe(true);
  expect(ONLINE_PRESENCE_TOOLS).toContain("prepareOnlinePresenceAssets");
  expect(grantsFor({ toolNames: ["prepareOnlinePresenceAssets"] }).onlinePresence).toBe(false);
  const service = grantsFor({ toolNames: ONLINE_PRESENCE_TOOLS });
  expect(service).toEqual({ ...base, onlinePresence: true });
  expect(service.dispatch).toBe(false);
  expect(service.skillAuthoring).toBe(false);
  expect(service.invoiceReminderStage).toBe(false);
  expect(grantsFor({ toolNames: Object.freeze([...ONLINE_PRESENCE_TOOLS]) }).onlinePresence).toBe(
    false,
  );
  expect(
    grantsFor({ toolNames: [...ONLINE_PRESENCE_TOOLS], evalRevenueFixtureId: "fixture" })
      .onlinePresence,
  ).toBe(false);
});

test("results are frozen", () => {
  expect(Object.isFrozen(NO_GRANTS)).toBe(true);
  expect(Object.isFrozen(grantsFor({}))).toBe(true);
  expect(Object.isFrozen(grantsFor({ toolNames: [] }))).toBe(true);
});
