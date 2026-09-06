// The ONE derivation of a cockpit tool set's capability grants. Pure TS, Convex-free (CLAUDE.md
// §1) — `llm.ts`'s `buildCockpitTools` is the thin consumer.
//
// The rules are ADR-007. An allow-list (`toolNames`) is a REQUEST from the caller, never a grant:
// executive-only capabilities — dispatch, skillAuthoring, invoiceReminderStage — derive from the
// ABSENCE of an allow-list, never from a name in it, so a specialist row that lists
// "dispatchResearch" still cannot dispatch. `dispatch` and `skillAuthoring` stay separate bits on
// purpose: one context may legitimately need one without the other (the directVideo SMOKE path
// grants dispatch alone). `revenueReads` is an IDENTITY check on the frozen core tuple — a copied
// array with the same strings is not the grant.
//
// Phase 38 (2026-09-06) moved this out of llm.ts, where `runAgentLoop` carried three copies of the
// expression, so every door — the loop, the SMOKE path, the test shim — builds its tool set from
// one derivation.

import { SPECIALISTS } from "./specialists";

export type ToolGrants = Readonly<{
  webResearch: boolean;
  dispatch: boolean;
  skillAuthoring: boolean;
  revenueReads: boolean;
  invoiceReminderStage: boolean;
  documentIsDeliverable: boolean;
  recipientEdits: boolean;
  gmail: boolean;
}>;

/** What a bare caller with no agent context gets: recipient tools present, Gmail tools present,
 *  nothing granted. NOT the executive — the executive is `grantsFor({})`, i.e. no allow-list. */
export const NO_GRANTS: ToolGrants = Object.freeze({
  webResearch: false,
  dispatch: false,
  skillAuthoring: false,
  revenueReads: false,
  invoiceReminderStage: false,
  documentIsDeliverable: false,
  recipientEdits: true,
  gmail: true,
});

/** Identity, not value equality: only the code-owned tuple may open this structural grant. */
export function isRevenueToolGrant(toolNames: readonly string[] | undefined): boolean {
  return toolNames === SPECIALISTS.revenue.tools;
}

export function grantsFor(input: {
  /** `undefined` = the executive (no allow-list); `[]` = an empty request. */
  toolNames?: readonly string[];
  /** The eval seam: opens the revenue reads and the reminder stage against a fixture. */
  evalRevenueFixtureId?: string;
  omitRecipientEdits?: boolean;
  gmailEnabled?: boolean;
  documentIsDeliverable?: boolean;
}): ToolGrants {
  const { toolNames } = input;
  const executive = toolNames === undefined;
  const evalSeam = input.evalRevenueFixtureId !== undefined;
  return Object.freeze({
    webResearch: toolNames?.includes("webResearch") ?? false,
    dispatch: executive,
    skillAuthoring: executive,
    revenueReads: isRevenueToolGrant(toolNames) || evalSeam,
    invoiceReminderStage: executive || evalSeam,
    documentIsDeliverable: input.documentIsDeliverable === true,
    recipientEdits: !input.omitRecipientEdits,
    gmail: input.gmailEnabled ?? true,
  });
}
