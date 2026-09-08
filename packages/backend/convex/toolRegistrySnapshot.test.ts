// @vitest-environment node
//
// Phase 38 byte-identical net for the `buildCockpitTools` refactor.
//
// Every caller class of `buildCockpitTools` — the bare shims, the executive via `runAgentLoop`, each
// specialist route, each workflow pack, the revenue eval seam and the two SMOKE paths — is recorded
// here as the tool KEY SET the model would see, as a HARD-CODED sorted literal (no vitest snapshot
// files: a `.snap` can be regenerated with `-u` without anyone reading the diff; a literal cannot).
// The arrays were printed from the CURRENT positional signature and pasted in verbatim.
//
// A change in ANY array below is a behaviour change — a tool the model gains or loses in some
// context — and must be refused unless the phase explicitly intends it. A refactor of the builder's
// signature reproduces every literal unchanged; the only edits it should need are inside `buildOld`.
//
// Two keys are recorded per allow-listed class: `built` is the record `buildCockpitTools` returns
// (what `invokeTool` can still reach — structural absence is the security property), `modelSees` is
// that record after `runAgentLoop`'s `toolNames` filter (what generateText is handed).

import {
  packOutputIsDocument,
  SPECIALIST_ROUTES,
  SPECIALISTS,
  type SpecialistRoute,
  toolsForWorkflowPack,
  WORKFLOW_PACK_IDS,
  WORKFLOW_PACKS,
  type WorkflowPackId,
} from "@pikar/core";
import { expect, test } from "vitest";
import type { Id } from "./_generated/dataModel";
import { buildCockpitTools, type ToolContext } from "./llm";

// The OLD 7th positional's shape, kept as the vocabulary every literal below was printed under.
type AgentContext = {
  grantWebResearch?: boolean;
  grantDispatch?: boolean;
  grantSkillAuthoring?: boolean;
  grantRevenueReads?: boolean;
  grantInvoiceReminderStage?: boolean;
  evalRevenueFixtureId?: string;
  documentIsDeliverable?: boolean;
  threadId?: string;
  rootRequestId?: string;
  gmailEnabled?: boolean;
};

// THE one call site: the old positional option object mapped FAITHFULLY onto the Phase 38
// `(toolCtx, grants)` signature — an absent grant flag was falsy, so it is `false`; an absent
// `gmailEnabled` was `?? true`; `omitRecipientEdits` inverts to `recipientEdits`. Building the
// record never touches ctx (tools only close over it), so a bare `{}` is a sufficient ctx — the
// cockpitTools.test.ts precedent.
function buildOld(o: {
  clientContext?: { tz: string; nowMs: number };
  skillVersions?: Record<string, number>;
  omitRecipientEdits?: boolean;
  agentContext?: AgentContext;
  tenantSkillIds?: ToolContext["tenantSkillIds"];
}): Record<string, unknown> {
  const a = o.agentContext ?? {};
  return buildCockpitTools(
    {
      ctx: {} as never,
      tenantId: "t1",
      planId: "plan-stub" as Id<"plans">,
      clientContext: o.clientContext,
      skillVersions: o.skillVersions,
      tenantSkillIds: o.tenantSkillIds,
      threadId: a.threadId,
      rootRequestId: a.rootRequestId,
      evalRevenueFixtureId: a.evalRevenueFixtureId,
    },
    {
      webResearch: a.grantWebResearch ?? false,
      dispatch: a.grantDispatch ?? false,
      skillAuthoring: a.grantSkillAuthoring ?? false,
      revenueReads: a.grantRevenueReads ?? false,
      invoiceReminderStage: a.grantInvoiceReminderStage ?? false,
      documentIsDeliverable: a.documentIsDeliverable ?? false,
      recipientEdits: !o.omitRecipientEdits,
      gmail: a.gmailEnabled ?? true,
    },
  );
}

const keysOf = (built: Record<string, unknown>): string[] => Object.keys(built).sort();

// runAgentLoop's filter, verbatim in effect: `=== undefined` (never truthiness) so `[]` yields `[]`.
function modelSees(built: Record<string, unknown>, toolNames?: readonly string[]): string[] {
  return toolNames === undefined
    ? keysOf(built)
    : keysOf(built).filter((n) => toolNames.includes(n));
}

// Exactly how runAgentLoop derives the agentContext from an allow-list (llm.ts, the ONE place
// `toolNames` is in scope). `grantRevenueReads` is an IDENTITY check on the code-owned tuple
// (`isRevenueToolGrant`), reproduced as `===` here on purpose — a copied list is not the grant.
function specialistContext(
  toolNames: readonly string[],
  extra: Partial<AgentContext> = {},
): AgentContext {
  return {
    grantWebResearch: toolNames.includes("webResearch"),
    grantDispatch: false,
    grantSkillAuthoring: false,
    grantRevenueReads:
      toolNames === SPECIALISTS.revenue.tools || extra.evalRevenueFixtureId !== undefined,
    grantInvoiceReminderStage: extra.evalRevenueFixtureId !== undefined,
    threadId: "thread-1",
    rootRequestId: "turn-1",
    ...extra,
  };
}

const EXECUTIVE: AgentContext = {
  grantWebResearch: false,
  grantDispatch: true,
  grantSkillAuthoring: true,
  grantRevenueReads: false,
  grantInvoiceReminderStage: true,
  evalRevenueFixtureId: undefined,
  documentIsDeliverable: undefined,
  threadId: "thread-1",
  rootRequestId: "turn-1",
  gmailEnabled: true,
};

test("bare (shims, __invokeCockpitTool)", () => {
  const k = keysOf(buildOld({}));
  // Non-vacuity: the bare record is the full executive tool set, not an empty stub.
  expect(k.length).toBeGreaterThan(20);
  expect(k).toEqual([
    "addRecipients",
    "briefInbox",
    "checkAvailability",
    "createDocument",
    "draftBody",
    "evaluateBusiness",
    "findInDrive",
    "generateAttachment",
    "listDriveFolders",
    "listInbox",
    "listManagedCalendarEvents",
    "personalizeRecipient",
    "proposeCalendarChange",
    "proposeCalendarEvent",
    "proposePlan",
    "readFinance",
    "recordScorecardAnswer",
    "regenerateAttachment",
    "removeAttachment",
    "removeRecipient",
    "replyToMessage",
    "resetPlan",
    "resolveContacts",
    "searchVault",
    "setMode",
    "setRecipients",
    "setSendTime",
    "setSubject",
    "stageCrmWrite",
    "stageFinanceWrite",
  ]);
});

test("bare + omitRecipientEdits", () => {
  const k = keysOf(buildOld({ omitRecipientEdits: true }));
  expect(k).toEqual([
    "briefInbox",
    "checkAvailability",
    "createDocument",
    "draftBody",
    "evaluateBusiness",
    "findInDrive",
    "generateAttachment",
    "listDriveFolders",
    "listInbox",
    "listManagedCalendarEvents",
    "personalizeRecipient",
    "proposeCalendarChange",
    "proposeCalendarEvent",
    "proposePlan",
    "readFinance",
    "recordScorecardAnswer",
    "regenerateAttachment",
    "removeAttachment",
    "replyToMessage",
    "resetPlan",
    "resolveContacts",
    "searchVault",
    "setMode",
    "setSendTime",
    "setSubject",
    "stageCrmWrite",
    "stageFinanceWrite",
  ]);
});

test("bare + gmail disabled", () => {
  const k = keysOf(buildOld({ agentContext: { gmailEnabled: false } }));
  expect(k).toEqual([
    "checkAvailability",
    "createDocument",
    "evaluateBusiness",
    "findInDrive",
    "listDriveFolders",
    "listManagedCalendarEvents",
    "proposeCalendarChange",
    "proposeCalendarEvent",
    "readFinance",
    "recordScorecardAnswer",
    "searchVault",
    "stageCrmWrite",
    "stageFinanceWrite",
  ]);
});

test("executive via runAgentLoop, lineage present", () => {
  const k = keysOf(buildOld({ agentContext: EXECUTIVE }));
  expect(k).toEqual([
    "addRecipients",
    "authorSkillCandidate",
    "briefInbox",
    "checkAvailability",
    "createDocument",
    "createVariants",
    "dispatchMedia",
    "dispatchResearch",
    "dispatchTeam",
    "draftBody",
    "evaluateBusiness",
    "findInDrive",
    "generateAttachment",
    "listDriveFolders",
    "listInbox",
    "listManagedCalendarEvents",
    "personalizeRecipient",
    "proposeCalendarChange",
    "proposeCalendarEvent",
    "proposeImage",
    "proposePlan",
    "readFinance",
    "recordScorecardAnswer",
    "regenerateAttachment",
    "removeAttachment",
    "removeRecipient",
    "replyToMessage",
    "resetPlan",
    "resolveContacts",
    "searchVault",
    "setMode",
    "setRecipients",
    "setSendTime",
    "setSubject",
    "stageCrmWrite",
    "stageFinanceWrite",
    "stageInvoiceReminder",
  ]);
});

test("executive, no lineage (turnId undefined)", () => {
  const k = keysOf(
    buildOld({ agentContext: { ...EXECUTIVE, threadId: undefined, rootRequestId: undefined } }),
  );
  expect(k).toEqual([
    "addRecipients",
    "briefInbox",
    "checkAvailability",
    "createDocument",
    "draftBody",
    "evaluateBusiness",
    "findInDrive",
    "generateAttachment",
    "listDriveFolders",
    "listInbox",
    "listManagedCalendarEvents",
    "personalizeRecipient",
    "proposeCalendarChange",
    "proposeCalendarEvent",
    "proposePlan",
    "readFinance",
    "recordScorecardAnswer",
    "regenerateAttachment",
    "removeAttachment",
    "removeRecipient",
    "replyToMessage",
    "resetPlan",
    "resolveContacts",
    "searchVault",
    "setMode",
    "setRecipients",
    "setSendTime",
    "setSubject",
    "stageCrmWrite",
    "stageFinanceWrite",
    "stageInvoiceReminder",
  ]);
});

test("executive continue turn (omitRecipientEdits)", () => {
  const k = keysOf(buildOld({ agentContext: EXECUTIVE, omitRecipientEdits: true }));
  expect(k).toEqual([
    "authorSkillCandidate",
    "briefInbox",
    "checkAvailability",
    "createDocument",
    "createVariants",
    "dispatchMedia",
    "dispatchResearch",
    "dispatchTeam",
    "draftBody",
    "evaluateBusiness",
    "findInDrive",
    "generateAttachment",
    "listDriveFolders",
    "listInbox",
    "listManagedCalendarEvents",
    "personalizeRecipient",
    "proposeCalendarChange",
    "proposeCalendarEvent",
    "proposeImage",
    "proposePlan",
    "readFinance",
    "recordScorecardAnswer",
    "regenerateAttachment",
    "removeAttachment",
    "replyToMessage",
    "resetPlan",
    "resolveContacts",
    "searchVault",
    "setMode",
    "setSendTime",
    "setSubject",
    "stageCrmWrite",
    "stageFinanceWrite",
    "stageInvoiceReminder",
  ]);
});

test("executive, gmail disabled", () => {
  const k = keysOf(buildOld({ agentContext: { ...EXECUTIVE, gmailEnabled: false } }));
  expect(k).toEqual([
    "authorSkillCandidate",
    "checkAvailability",
    "createDocument",
    "createVariants",
    "dispatchMedia",
    "dispatchResearch",
    "dispatchTeam",
    "evaluateBusiness",
    "findInDrive",
    "listDriveFolders",
    "listManagedCalendarEvents",
    "proposeCalendarChange",
    "proposeCalendarEvent",
    "proposeImage",
    "readFinance",
    "recordScorecardAnswer",
    "searchVault",
    "stageCrmWrite",
    "stageFinanceWrite",
    "stageInvoiceReminder",
  ]);
});

// Keyed by the closed unions: a route or pack added in core without a literal here fails typecheck.
const SPECIALIST_EXPECTED: Record<SpecialistRoute, { built: string[]; modelSees: string[] }> = {
  "offer-architect": {
    built: [
      "addRecipients",
      "briefInbox",
      "checkAvailability",
      "createDocument",
      "draftBody",
      "evaluateBusiness",
      "findInDrive",
      "generateAttachment",
      "listDriveFolders",
      "listInbox",
      "listManagedCalendarEvents",
      "personalizeRecipient",
      "proposeCalendarChange",
      "proposeCalendarEvent",
      "proposePlan",
      "readFinance",
      "recordScorecardAnswer",
      "regenerateAttachment",
      "removeAttachment",
      "removeRecipient",
      "replyToMessage",
      "resetPlan",
      "resolveContacts",
      "searchVault",
      "setMode",
      "setRecipients",
      "setSendTime",
      "setSubject",
      "stageCrmWrite",
      "stageFinanceWrite",
    ],
    modelSees: ["searchVault"],
  },
  "money-model-designer": {
    built: [
      "addRecipients",
      "briefInbox",
      "checkAvailability",
      "createDocument",
      "draftBody",
      "evaluateBusiness",
      "findInDrive",
      "generateAttachment",
      "listDriveFolders",
      "listInbox",
      "listManagedCalendarEvents",
      "personalizeRecipient",
      "proposeCalendarChange",
      "proposeCalendarEvent",
      "proposePlan",
      "readFinance",
      "recordScorecardAnswer",
      "regenerateAttachment",
      "removeAttachment",
      "removeRecipient",
      "replyToMessage",
      "resetPlan",
      "resolveContacts",
      "searchVault",
      "setMode",
      "setRecipients",
      "setSendTime",
      "setSubject",
      "stageCrmWrite",
      "stageFinanceWrite",
    ],
    modelSees: ["searchVault"],
  },
  "lead-engine": {
    built: [
      "addRecipients",
      "briefInbox",
      "checkAvailability",
      "createDocument",
      "draftBody",
      "evaluateBusiness",
      "findInDrive",
      "generateAttachment",
      "listDriveFolders",
      "listInbox",
      "listManagedCalendarEvents",
      "personalizeRecipient",
      "proposeCalendarChange",
      "proposeCalendarEvent",
      "proposePlan",
      "readFinance",
      "recordScorecardAnswer",
      "regenerateAttachment",
      "removeAttachment",
      "removeRecipient",
      "replyToMessage",
      "resetPlan",
      "resolveContacts",
      "searchVault",
      "setMode",
      "setRecipients",
      "setSendTime",
      "setSubject",
      "stageCrmWrite",
      "stageFinanceWrite",
    ],
    modelSees: ["searchVault"],
  },
  research: {
    built: [
      "addRecipients",
      "briefInbox",
      "checkAvailability",
      "createDocument",
      "declareUnsupported",
      "draftBody",
      "evaluateBusiness",
      "findInDrive",
      "generateAttachment",
      "listDriveFolders",
      "listInbox",
      "listManagedCalendarEvents",
      "personalizeRecipient",
      "proposeCalendarChange",
      "proposeCalendarEvent",
      "proposePlan",
      "readFinance",
      "readPage",
      "recordScorecardAnswer",
      "regenerateAttachment",
      "removeAttachment",
      "removeRecipient",
      "replyToMessage",
      "resetPlan",
      "resolveContacts",
      "searchVault",
      "setMode",
      "setRecipients",
      "setSendTime",
      "setSubject",
      "stageCrmWrite",
      "stageFinanceWrite",
      "webResearch",
    ],
    modelSees: ["declareUnsupported", "readPage", "webResearch"],
  },
  media: {
    built: [
      "addRecipients",
      "briefInbox",
      "checkAvailability",
      "createDocument",
      "draftBody",
      "evaluateBusiness",
      "findInDrive",
      "generateAttachment",
      "listDriveFolders",
      "listInbox",
      "listManagedCalendarEvents",
      "personalizeRecipient",
      "proposeCalendarChange",
      "proposeCalendarEvent",
      "proposePlan",
      "readFinance",
      "recordScorecardAnswer",
      "regenerateAttachment",
      "removeAttachment",
      "removeRecipient",
      "replyToMessage",
      "resetPlan",
      "resolveContacts",
      "searchVault",
      "setMode",
      "setRecipients",
      "setSendTime",
      "setSubject",
      "stageCrmWrite",
      "stageFinanceWrite",
    ],
    modelSees: ["searchVault"],
  },
  revenue: {
    built: [
      "addRecipients",
      "briefInbox",
      "checkAvailability",
      "createDocument",
      "declareUnsupported",
      "draftBody",
      "evaluateBusiness",
      "findInDrive",
      "generateAttachment",
      "listDriveFolders",
      "listInbox",
      "listManagedCalendarEvents",
      "personalizeRecipient",
      "proposeCalendarChange",
      "proposeCalendarEvent",
      "proposePlan",
      "readBusinessFinance",
      "readFinance",
      "readRevenueCrm",
      "recordScorecardAnswer",
      "regenerateAttachment",
      "removeAttachment",
      "removeRecipient",
      "replyToMessage",
      "resetPlan",
      "resolveContacts",
      "searchVault",
      "setMode",
      "setRecipients",
      "setSendTime",
      "setSubject",
      "stageCrmWrite",
      "stageFinanceWrite",
    ],
    modelSees: ["declareUnsupported", "readBusinessFinance", "readRevenueCrm"],
  },
};

for (const route of SPECIALIST_ROUTES) {
  test(`specialist ${route}`, () => {
    const tools = SPECIALISTS[route].tools;
    const built = buildOld({ agentContext: specialistContext(tools) });
    expect(keysOf(built)).toEqual(SPECIALIST_EXPECTED[route].built);
    expect(modelSees(built, tools)).toEqual(SPECIALIST_EXPECTED[route].modelSees);
  });
}

const PACK_EXPECTED: Record<WorkflowPackId, { built: string[]; modelSees: string[] }> = {
  "business-pulse": {
    built: [
      "addRecipients",
      "briefInbox",
      "checkAvailability",
      "createDocument",
      "draftBody",
      "evaluateBusiness",
      "findInDrive",
      "generateAttachment",
      "listDriveFolders",
      "listInbox",
      "listManagedCalendarEvents",
      "personalizeRecipient",
      "proposeCalendarChange",
      "proposeCalendarEvent",
      "proposePlan",
      "readFinance",
      "recordScorecardAnswer",
      "regenerateAttachment",
      "removeAttachment",
      "removeRecipient",
      "replyToMessage",
      "resetPlan",
      "resolveContacts",
      "searchVault",
      "setMode",
      "setRecipients",
      "setSendTime",
      "setSubject",
      "stageCrmWrite",
      "stageFinanceWrite",
    ],
    modelSees: ["readFinance", "searchVault"],
  },
  "campaign-plan": {
    built: [
      "addRecipients",
      "briefInbox",
      "checkAvailability",
      "createDocument",
      "declareUnsupported",
      "draftBody",
      "evaluateBusiness",
      "findInDrive",
      "generateAttachment",
      "listDriveFolders",
      "listInbox",
      "listManagedCalendarEvents",
      "personalizeRecipient",
      "proposeCalendarChange",
      "proposeCalendarEvent",
      "proposePlan",
      "readFinance",
      "readPage",
      "recordScorecardAnswer",
      "regenerateAttachment",
      "removeAttachment",
      "removeRecipient",
      "replyToMessage",
      "resetPlan",
      "resolveContacts",
      "saveAsDocument",
      "searchVault",
      "setMode",
      "setRecipients",
      "setSendTime",
      "setSubject",
      "stageCrmWrite",
      "stageFinanceWrite",
      "webResearch",
    ],
    modelSees: ["declareUnsupported", "saveAsDocument", "searchVault", "webResearch"],
  },
  "customer-complaint": {
    built: [
      "addRecipients",
      "briefInbox",
      "checkAvailability",
      "createDocument",
      "draftBody",
      "evaluateBusiness",
      "findInDrive",
      "generateAttachment",
      "listDriveFolders",
      "listInbox",
      "listManagedCalendarEvents",
      "personalizeRecipient",
      "proposeCalendarChange",
      "proposeCalendarEvent",
      "proposePlan",
      "readFinance",
      "recordScorecardAnswer",
      "regenerateAttachment",
      "removeAttachment",
      "removeRecipient",
      "replyToMessage",
      "resetPlan",
      "resolveContacts",
      "searchVault",
      "setMode",
      "setRecipients",
      "setSendTime",
      "setSubject",
      "stageCrmWrite",
      "stageFinanceWrite",
    ],
    modelSees: ["briefInbox", "listInbox", "proposePlan", "replyToMessage", "searchVault"],
  },
  "sales-call-prep": {
    built: [
      "addRecipients",
      "briefInbox",
      "checkAvailability",
      "createDocument",
      "declareUnsupported",
      "draftBody",
      "evaluateBusiness",
      "findInDrive",
      "generateAttachment",
      "listDriveFolders",
      "listInbox",
      "listManagedCalendarEvents",
      "personalizeRecipient",
      "proposeCalendarChange",
      "proposeCalendarEvent",
      "proposePlan",
      "readFinance",
      "readPage",
      "recordScorecardAnswer",
      "regenerateAttachment",
      "removeAttachment",
      "removeRecipient",
      "replyToMessage",
      "resetPlan",
      "resolveContacts",
      "saveAsDocument",
      "searchVault",
      "setMode",
      "setRecipients",
      "setSendTime",
      "setSubject",
      "stageCrmWrite",
      "stageFinanceWrite",
      "webResearch",
    ],
    modelSees: [
      "declareUnsupported",
      "listManagedCalendarEvents",
      "saveAsDocument",
      "searchVault",
      "webResearch",
    ],
  },
  "process-sop": {
    built: [
      "addRecipients",
      "briefInbox",
      "checkAvailability",
      "createDocument",
      "draftBody",
      "evaluateBusiness",
      "findInDrive",
      "generateAttachment",
      "listDriveFolders",
      "listInbox",
      "listManagedCalendarEvents",
      "personalizeRecipient",
      "proposeCalendarChange",
      "proposeCalendarEvent",
      "proposePlan",
      "readFinance",
      "recordScorecardAnswer",
      "regenerateAttachment",
      "removeAttachment",
      "removeRecipient",
      "replyToMessage",
      "resetPlan",
      "resolveContacts",
      "saveAsDocument",
      "searchVault",
      "setMode",
      "setRecipients",
      "setSendTime",
      "setSubject",
      "stageCrmWrite",
      "stageFinanceWrite",
    ],
    modelSees: ["findInDrive", "listDriveFolders", "saveAsDocument", "searchVault"],
  },
  "brand-review": {
    built: [
      "addRecipients",
      "briefInbox",
      "checkAvailability",
      "createDocument",
      "draftBody",
      "evaluateBusiness",
      "findInDrive",
      "generateAttachment",
      "listDriveFolders",
      "listInbox",
      "listManagedCalendarEvents",
      "personalizeRecipient",
      "proposeCalendarChange",
      "proposeCalendarEvent",
      "proposePlan",
      "readFinance",
      "recordScorecardAnswer",
      "regenerateAttachment",
      "removeAttachment",
      "removeRecipient",
      "replyToMessage",
      "resetPlan",
      "resolveContacts",
      "saveAsDocument",
      "searchVault",
      "setMode",
      "setRecipients",
      "setSendTime",
      "setSubject",
      "stageCrmWrite",
      "stageFinanceWrite",
    ],
    modelSees: ["saveAsDocument", "searchVault"],
  },
  "offer-and-lead-plan": {
    built: [
      "addRecipients",
      "briefInbox",
      "checkAvailability",
      "createDocument",
      "declareUnsupported",
      "draftBody",
      "evaluateBusiness",
      "findInDrive",
      "generateAttachment",
      "listDriveFolders",
      "listInbox",
      "listManagedCalendarEvents",
      "personalizeRecipient",
      "proposeCalendarChange",
      "proposeCalendarEvent",
      "proposePlan",
      "readFinance",
      "readPage",
      "recordScorecardAnswer",
      "regenerateAttachment",
      "removeAttachment",
      "removeRecipient",
      "replyToMessage",
      "resetPlan",
      "resolveContacts",
      "saveAsDocument",
      "searchVault",
      "setMode",
      "setRecipients",
      "setSendTime",
      "setSubject",
      "stageCrmWrite",
      "stageFinanceWrite",
      "webResearch",
    ],
    modelSees: ["declareUnsupported", "saveAsDocument", "searchVault", "webResearch"],
  },
};

for (const id of WORKFLOW_PACK_IDS) {
  test(`workflow pack ${id}`, () => {
    const tools = toolsForWorkflowPack(id);
    // runSpecialistTurn derives this from the trusted skill NAME (workflowPackBinding passes
    // `spec.skillName`), never from the allow-list.
    const built = buildOld({
      agentContext: specialistContext(tools, {
        documentIsDeliverable: packOutputIsDocument(WORKFLOW_PACKS[id].skillName),
      }),
    });
    expect(keysOf(built)).toEqual(PACK_EXPECTED[id].built);
    expect(modelSees(built, tools)).toEqual(PACK_EXPECTED[id].modelSees);
  });
}

test("revenue eval seam", () => {
  // runRevenueEvalTurn -> runSpecialistTurn: fixture set, lineage present, revenue tuple identity.
  const tools = SPECIALISTS.revenue.tools;
  const built = buildOld({
    agentContext: specialistContext(tools, {
      evalRevenueFixtureId: "fixture-x",
      documentIsDeliverable: false,
    }),
  });
  expect(keysOf(built)).toEqual([
    "addRecipients",
    "briefInbox",
    "checkAvailability",
    "createDocument",
    "declareUnsupported",
    "draftBody",
    "evaluateBusiness",
    "findInDrive",
    "generateAttachment",
    "listDriveFolders",
    "listInbox",
    "listManagedCalendarEvents",
    "personalizeRecipient",
    "proposeCalendarChange",
    "proposeCalendarEvent",
    "proposePlan",
    "readBusinessFinance",
    "readFinance",
    "readRevenueCrm",
    "recordScorecardAnswer",
    "regenerateAttachment",
    "removeAttachment",
    "removeRecipient",
    "replyToMessage",
    "resetPlan",
    "resolveContacts",
    "searchVault",
    "setMode",
    "setRecipients",
    "setSendTime",
    "setSubject",
    "stageCrmWrite",
    "stageFinanceWrite",
    "stageInvoiceReminder",
  ]);
  expect(modelSees(built, tools)).toEqual([
    "declareUnsupported",
    "readBusinessFinance",
    "readRevenueCrm",
  ]);

  // The revenue-invoice-reminder skill: a ONE-name list, not the tuple — grantRevenueReads still
  // true through the fixture, not the identity check.
  const reminderTools = ["stageInvoiceReminder"] as const;
  const built2 = buildOld({
    agentContext: specialistContext(reminderTools, {
      evalRevenueFixtureId: "fixture-x",
      documentIsDeliverable: false,
    }),
  });
  expect(keysOf(built2)).toEqual([
    "addRecipients",
    "briefInbox",
    "checkAvailability",
    "createDocument",
    "declareUnsupported",
    "draftBody",
    "evaluateBusiness",
    "findInDrive",
    "generateAttachment",
    "listDriveFolders",
    "listInbox",
    "listManagedCalendarEvents",
    "personalizeRecipient",
    "proposeCalendarChange",
    "proposeCalendarEvent",
    "proposePlan",
    "readBusinessFinance",
    "readFinance",
    "readRevenueCrm",
    "recordScorecardAnswer",
    "regenerateAttachment",
    "removeAttachment",
    "removeRecipient",
    "replyToMessage",
    "resetPlan",
    "resolveContacts",
    "searchVault",
    "setMode",
    "setRecipients",
    "setSendTime",
    "setSubject",
    "stageCrmWrite",
    "stageFinanceWrite",
    "stageInvoiceReminder",
  ]);
  expect(modelSees(built2, reminderTools)).toEqual(["stageInvoiceReminder"]);
});

test("SMOKE direct video path", () => {
  const k = keysOf(
    buildOld({
      agentContext: {
        gmailEnabled: true,
        grantDispatch: true,
        threadId: "thread-1",
        rootRequestId: "turn-1",
      },
    }),
  );
  expect(k).toEqual([
    "addRecipients",
    "briefInbox",
    "checkAvailability",
    "createDocument",
    "createVariants",
    "dispatchMedia",
    "dispatchResearch",
    "dispatchTeam",
    "draftBody",
    "evaluateBusiness",
    "findInDrive",
    "generateAttachment",
    "listDriveFolders",
    "listInbox",
    "listManagedCalendarEvents",
    "personalizeRecipient",
    "proposeCalendarChange",
    "proposeCalendarEvent",
    "proposeImage",
    "proposePlan",
    "readFinance",
    "recordScorecardAnswer",
    "regenerateAttachment",
    "removeAttachment",
    "removeRecipient",
    "replyToMessage",
    "resetPlan",
    "resolveContacts",
    "searchVault",
    "setMode",
    "setRecipients",
    "setSendTime",
    "setSubject",
    "stageCrmWrite",
    "stageFinanceWrite",
  ]);
});

test("SMOKE ordinary op", () => {
  const k = keysOf(buildOld({ agentContext: { gmailEnabled: true } }));
  expect(k).toEqual([
    "addRecipients",
    "briefInbox",
    "checkAvailability",
    "createDocument",
    "draftBody",
    "evaluateBusiness",
    "findInDrive",
    "generateAttachment",
    "listDriveFolders",
    "listInbox",
    "listManagedCalendarEvents",
    "personalizeRecipient",
    "proposeCalendarChange",
    "proposeCalendarEvent",
    "proposePlan",
    "readFinance",
    "recordScorecardAnswer",
    "regenerateAttachment",
    "removeAttachment",
    "removeRecipient",
    "replyToMessage",
    "resetPlan",
    "resolveContacts",
    "searchVault",
    "setMode",
    "setRecipients",
    "setSendTime",
    "setSubject",
    "stageCrmWrite",
    "stageFinanceWrite",
  ]);
});
