/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as agentSteps from "../agentSteps.js";
import type * as aggregates from "../aggregates.js";
import type * as approvals from "../approvals.js";
import type * as audit from "../audit.js";
import type * as auth from "../auth.js";
import type * as blueprint from "../blueprint.js";
import type * as briefings from "../briefings.js";
import type * as calendar from "../calendar.js";
import type * as calendarComplete from "../calendarComplete.js";
import type * as calendarViews from "../calendarViews.js";
import type * as cash from "../cash.js";
import type * as cockpit from "../cockpit.js";
import type * as cockpitCapabilities from "../cockpitCapabilities.js";
import type * as contacts from "../contacts.js";
import type * as crons from "../crons.js";
import type * as deadLetter from "../deadLetter.js";
import type * as deadLetters from "../deadLetters.js";
import type * as deliverApprovedPlan from "../deliverApprovedPlan.js";
import type * as delivery from "../delivery.js";
import type * as demo from "../demo.js";
import type * as dispatch from "../dispatch.js";
import type * as evaluations from "../evaluations.js";
import type * as feedback from "../feedback.js";
import type * as finance from "../finance.js";
import type * as gmail from "../gmail.js";
import type * as gmailAuth from "../gmailAuth.js";
import type * as goals from "../goals.js";
import type * as graph from "../graph.js";
import type * as guardrails from "../guardrails.js";
import type * as http from "../http.js";
import type * as index from "../index.js";
import type * as intake from "../intake.js";
import type * as intakeDb from "../intakeDb.js";
import type * as invites from "../invites.js";
import type * as lib_allowlist from "../lib/allowlist.js";
import type * as lib_functions from "../lib/functions.js";
import type * as lib_hash from "../lib/hash.js";
import type * as llm from "../llm.js";
import type * as media from "../media.js";
import type * as mediaComplete from "../mediaComplete.js";
import type * as mediaIntent from "../mediaIntent.js";
import type * as microsoftAuth from "../microsoftAuth.js";
import type * as microsoftCalendar from "../microsoftCalendar.js";
import type * as migrations from "../migrations.js";
import type * as notifications from "../notifications.js";
import type * as notifyExternal from "../notifyExternal.js";
import type * as onboarding from "../onboarding.js";
import type * as opsSignals from "../opsSignals.js";
import type * as ops from "../ops.js";
import type * as optimizerConfig from "../optimizerConfig.js";
import type * as optimizerEligibility from "../optimizerEligibility.js";
import type * as owner from "../owner.js";
import type * as pipeline from "../pipeline.js";
import type * as plans from "../plans.js";
import type * as proactiveReview from "../proactiveReview.js";
import type * as proposals from "../proposals.js";
import type * as render_assembleScript from "../render/assembleScript.js";
import type * as render_burnCapsScript from "../render/burnCapsScript.js";
import type * as render_renderReel from "../render/renderReel.js";
import type * as requests from "../requests.js";
import type * as research from "../research.js";
import type * as review from "../review.js";
import type * as savedPrompts from "../savedPrompts.js";
import type * as skilloptExport from "../skilloptExport.js";
import type * as skills from "../skills.js";
import type * as smoke from "../smoke.js";
import type * as smokeAssert from "../smokeAssert.js";
import type * as spendLedger from "../spendLedger.js";
import type * as telemetry from "../telemetry.js";
import type * as tenantDelete from "../tenantDelete.js";
import type * as tenantExport from "../tenantExport.js";
import type * as tenantProfile from "../tenantProfile.js";
import type * as vault from "../vault.js";
import type * as vaultDigest from "../vaultDigest.js";
import type * as vaultDrive from "../vaultDrive.js";
import type * as vaultExtract from "../vaultExtract.js";
import type * as vaultFolders from "../vaultFolders.js";
import type * as vaultGraph from "../vaultGraph.js";
import type * as vaultGround from "../vaultGround.js";
import type * as vaultIngest from "../vaultIngest.js";
import type * as vaultLlm from "../vaultLlm.js";
import type * as vaultRag from "../vaultRag.js";
import type * as vaultSmoke from "../vaultSmoke.js";
import type * as vaultSources from "../vaultSources.js";
import type * as vaultSweep from "../vaultSweep.js";
import type * as vaultTranscribe from "../vaultTranscribe.js";
import type * as voice from "../voice.js";
import type * as voiceDoc from "../voiceDoc.js";
import type * as voiceToken from "../voiceToken.js";
import type * as worm from "../worm.js";
import type * as wormCursor from "../wormCursor.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  agentSteps: typeof agentSteps;
  aggregates: typeof aggregates;
  approvals: typeof approvals;
  audit: typeof audit;
  auth: typeof auth;
  blueprint: typeof blueprint;
  briefings: typeof briefings;
  calendar: typeof calendar;
  calendarComplete: typeof calendarComplete;
  calendarViews: typeof calendarViews;
  cash: typeof cash;
  cockpit: typeof cockpit;
  cockpitCapabilities: typeof cockpitCapabilities;
  contacts: typeof contacts;
  crons: typeof crons;
  deadLetter: typeof deadLetter;
  deadLetters: typeof deadLetters;
  deliverApprovedPlan: typeof deliverApprovedPlan;
  delivery: typeof delivery;
  demo: typeof demo;
  dispatch: typeof dispatch;
  evaluations: typeof evaluations;
  feedback: typeof feedback;
  finance: typeof finance;
  gmail: typeof gmail;
  gmailAuth: typeof gmailAuth;
  goals: typeof goals;
  graph: typeof graph;
  guardrails: typeof guardrails;
  http: typeof http;
  index: typeof index;
  intake: typeof intake;
  intakeDb: typeof intakeDb;
  invites: typeof invites;
  "lib/allowlist": typeof lib_allowlist;
  "lib/functions": typeof lib_functions;
  "lib/hash": typeof lib_hash;
  llm: typeof llm;
  media: typeof media;
  mediaComplete: typeof mediaComplete;
  mediaIntent: typeof mediaIntent;
  microsoftAuth: typeof microsoftAuth;
  microsoftCalendar: typeof microsoftCalendar;
  migrations: typeof migrations;
  notifications: typeof notifications;
  notifyExternal: typeof notifyExternal;
  onboarding: typeof onboarding;
  opsSignals: typeof opsSignals;
  ops: typeof ops;
  optimizerConfig: typeof optimizerConfig;
  optimizerEligibility: typeof optimizerEligibility;
  owner: typeof owner;
  pipeline: typeof pipeline;
  plans: typeof plans;
  proactiveReview: typeof proactiveReview;
  proposals: typeof proposals;
  "render/assembleScript": typeof render_assembleScript;
  "render/burnCapsScript": typeof render_burnCapsScript;
  "render/renderReel": typeof render_renderReel;
  requests: typeof requests;
  research: typeof research;
  review: typeof review;
  savedPrompts: typeof savedPrompts;
  skilloptExport: typeof skilloptExport;
  skills: typeof skills;
  smoke: typeof smoke;
  smokeAssert: typeof smokeAssert;
  spendLedger: typeof spendLedger;
  telemetry: typeof telemetry;
  tenantDelete: typeof tenantDelete;
  tenantExport: typeof tenantExport;
  tenantProfile: typeof tenantProfile;
  vault: typeof vault;
  vaultDigest: typeof vaultDigest;
  vaultDrive: typeof vaultDrive;
  vaultExtract: typeof vaultExtract;
  vaultFolders: typeof vaultFolders;
  vaultGraph: typeof vaultGraph;
  vaultGround: typeof vaultGround;
  vaultIngest: typeof vaultIngest;
  vaultLlm: typeof vaultLlm;
  vaultRag: typeof vaultRag;
  vaultSmoke: typeof vaultSmoke;
  vaultSources: typeof vaultSources;
  vaultSweep: typeof vaultSweep;
  vaultTranscribe: typeof vaultTranscribe;
  voice: typeof voice;
  voiceDoc: typeof voiceDoc;
  voiceToken: typeof voiceToken;
  worm: typeof worm;
  wormCursor: typeof wormCursor;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {
  workflow: import("@convex-dev/workflow/_generated/component.js").ComponentApi<"workflow">;
  agent: import("@convex-dev/agent/_generated/component.js").ComponentApi<"agent">;
  rag: import("@convex-dev/rag/_generated/component.js").ComponentApi<"rag">;
  rateLimiter: import("@convex-dev/rate-limiter/_generated/component.js").ComponentApi<"rateLimiter">;
  actionRetrier: import("@convex-dev/action-retrier/_generated/component.js").ComponentApi<"actionRetrier">;
  migrations: import("@convex-dev/migrations/_generated/component.js").ComponentApi<"migrations">;
  auditCounts: import("@convex-dev/aggregate/_generated/component.js").ComponentApi<"auditCounts">;
  actionCache: import("@convex-dev/action-cache/_generated/component.js").ComponentApi<"actionCache">;
  vaultIngestPool: import("@convex-dev/workpool/_generated/component.js").ComponentApi<"vaultIngestPool">;
};
