// The provider gate plane (28-26) — the ONE server-owned answer to "may this provider be used".
//
// A THIN ADAPTER (CLAUDE.md §1). The composite rule lives in `@pikar/revenue`'s
// `resolveProviderEligibility`; this module reads the row, hands the rule its inputs, and writes
// under owner auth. Nothing here re-derives eligibility — a second copy of that rule is how one of
// the two axes quietly stops mattering.
//
// TWO AXES, HELD APART ON PURPOSE:
//
//   `admission` — the OWNER'S SUITABILITY DECISION, mirroring the `decision:` marker in
//                 `docs/connectors/<provider>-suitability.md`. It means "engineering and production
//                 exposure are PERMITTED".
//   `lane`      — whether a controlled LIVE read/revoke was actually observed. That is wave 7
//                 (28-22..25).
//
// On 2026-08-27 all four providers were admitted `approved_production` and NOT ONE lane has ever
// run; three of the four admissions rest on owner testimony rather than evidence. If the two ever
// collapsed into one flag, those wave-7 seals would be decorative and a provider would go
// discoverable on a say-so. `approved_production` + `parked` is the normal state for most of this
// phase, and it is unavailable.
//
// DEPLOYMENT-GLOBAL. `providerGates` has no `tenantId` (classified `global` in
// `@pikar/core/tenantData`), which is what stops a tenant from ever widening its own provider
// access. Every tenant reads the identical projection and none of them can write one.

import {
  REVENUE_CALL_LIST_SKILL,
  REVENUE_CASH_FLOW_SKILL,
  REVENUE_CUSTOMER_PULSE_SKILL,
  REVENUE_INVOICE_REMINDER_SKILL,
  REVENUE_LEAD_TRIAGE_SKILL,
  REVENUE_PAYROLL_CONFIDENCE_SKILL,
  REVENUE_PIPELINE_REVIEW_SKILL,
  REVENUE_SPECIALIST_SKILL,
} from "@pikar/contracts/skill";
import {
  type Admission,
  admissionPermits,
  type ConnectorEnvironment,
  type Eligibility,
  type Lane,
  PROVIDER_OPEN_CONDITIONS,
  type Provider,
  type ProviderGateRecord,
  resolveProviderEligibility,
} from "@pikar/revenue";
import { v } from "convex/values";
import {
  internalMutation,
  internalQuery,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import { PROVIDER_READ_PATHS } from "./connectorFetch";
import { ownerMutation, ownerQuery, tenantQuery } from "./lib/functions";

/**
 * The wire validators. Written out because a Convex validator needs its literals inline; the
 * schema's copies and these are both pinned to `@pikar/revenue`'s closed sets by the source scan
 * in `providerGates.test.ts`.
 */
const providerValidator = v.union(
  v.literal("hubspot"),
  v.literal("quickbooks"),
  v.literal("stripe"),
  v.literal("paypal"),
);
const environmentValidator = v.union(v.literal("sandbox"), v.literal("production"));
const admissionValidator = v.union(
  v.literal("approved_beta"),
  v.literal("approved_production"),
  v.literal("blocked"),
  v.literal("deferred"),
);
const laneValidator = v.union(v.literal("passed"), v.literal("parked"), v.literal("failed"));

/**
 * The open conditions the register says still hang over a provider, as the ids a lane must clear.
 *
 * Exported because 28-22..25 each owe an answer to exactly one of these and need to name it
 * mechanically rather than from a plan's prose. The register (`docs/connectors/README.md`) is the
 * source of truth; `PROVIDER_OPEN_CONDITIONS` is the machine copy and a parity test in
 * `packages/revenue/src/contracts.test.ts` compares the two rather than trusting either.
 */
export function openConditionIdsFor(provider: Provider): readonly string[] {
  return PROVIDER_OPEN_CONDITIONS[provider].map((c) => c.id);
}

type GateRow = {
  provider: Provider;
  environment: ConnectorEnvironment;
  admission: Admission;
  lane: Lane;
  evidenceRef: string;
  reviewBy: number;
  clearedConditions?: string[];
  revision: number;
};

const rowFor = (
  ctx: QueryCtx | MutationCtx,
  provider: Provider,
  environment: ConnectorEnvironment,
) =>
  ctx.db
    .query("providerGates")
    .withIndex("by_provider_environment", (q) =>
      q.eq("provider", provider).eq("environment", environment),
    )
    .unique();

/** The stored row as the pure rule sees it. An ABSENT `clearedConditions` clears nothing. */
const asRecord = (row: GateRow): ProviderGateRecord => ({
  provider: row.provider,
  environment: row.environment,
  admission: row.admission,
  lane: row.lane,
  reviewBy: row.reviewBy,
  clearedConditions: row.clearedConditions ?? [],
});

/**
 * THE single resolution point. `readPathCount` comes from `connectorFetch`'s allow-list rather than
 * from anything stored here, so this can never contradict it: `PROVIDER_READ_PATHS.stripe` is `[]`
 * BY DECISION until 28-07 settles the Stripe App route, and a provider that may read nothing is not
 * eligible for anything whatever the owner approved.
 */
function resolve(record: ProviderGateRecord | null, provider: Provider, now: number): Eligibility {
  return resolveProviderEligibility(record, {
    now,
    readPathCount: PROVIDER_READ_PATHS[provider].length,
    openConditions: openConditionIdsFor(provider),
  });
}

async function eligibilityFor(
  ctx: QueryCtx | MutationCtx,
  provider: Provider,
  environment: ConnectorEnvironment,
  now: number,
): Promise<Eligibility> {
  const row = await rowFor(ctx, provider, environment);
  return resolve(row === null ? null : asRecord(row), provider, now);
}

/**
 * Every PASSED (provider, environment), as a plain function so a server-side reader can join
 * against it without going through a tenant query.
 *
 * ONE resolver, one filter. `availableProviders` below is this same answer wrapped for a browser;
 * `connectorConnections.connections` uses this directly. Two filters over the same rows is how one
 * of them eventually forgets an axis.
 */
export async function passedProviderGates(
  ctx: QueryCtx | MutationCtx,
  now: number,
): Promise<{ provider: Provider; environment: ConnectorEnvironment }[]> {
  const rows = await ctx.db.query("providerGates").collect();
  return rows
    .filter((row) => resolve(asRecord(row), row.provider, now).state === "passed")
    .map((row) => ({ provider: row.provider, environment: row.environment }));
}

/**
 * The PASSED-ONLY projection every consumer reads: connections UI, discovery, the revenue tools and
 * the final-close gate. It returns the provider and the environment and NOTHING else — no evidence
 * ref, no revision, no review date. A surface that could see the review date could render "expiring
 * soon" and start treating an admission as a status.
 *
 * `tenantQuery` for authentication only; the answer is deployment-wide and identical for every
 * tenant, which is the property `providerGates` having no `tenantId` buys.
 */
export const availableProviders = tenantQuery({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const rows = await ctx.db.query("providerGates").collect();
    return rows
      .filter((row) => resolve(asRecord(row), row.provider, now).state === "passed")
      .map((row) => ({ provider: row.provider, environment: row.environment }));
  },
});

type RevenueDiscoverySpec = {
  id: string;
  provider: Provider;
  providerLabel: string;
  title: string;
  summary: string;
  opener: string;
  skillName:
    | typeof REVENUE_LEAD_TRIAGE_SKILL
    | typeof REVENUE_CALL_LIST_SKILL
    | typeof REVENUE_PIPELINE_REVIEW_SKILL
    | typeof REVENUE_CUSTOMER_PULSE_SKILL
    | typeof REVENUE_CASH_FLOW_SKILL
    | typeof REVENUE_PAYROLL_CONFIDENCE_SKILL
    | typeof REVENUE_INVOICE_REMINDER_SKILL;
};

/**
 * Code-owned workflow suitability. Provider rows decide whether a lane may be used; active skill
 * rows decide whether this exact workflow and its runtime specialist may be offered. The browser
 * receives only their intersection and cannot reconstruct a parked lane from module or docs presence.
 */
const REVENUE_DISCOVERY: readonly RevenueDiscoverySpec[] = [
  {
    id: "lead-triage",
    provider: "hubspot",
    providerLabel: "HubSpot",
    title: "Lead triage",
    summary: "Rank the people who need attention from current CRM facts.",
    opener: "Review my HubSpot leads and rank who needs attention.",
    skillName: REVENUE_LEAD_TRIAGE_SKILL,
  },
  {
    id: "call-list",
    provider: "hubspot",
    providerLabel: "HubSpot",
    title: "Call list",
    summary: "Build a review list from current follow-ups and CRM coverage.",
    opener: "Build my HubSpot call list from current follow-ups.",
    skillName: REVENUE_CALL_LIST_SKILL,
  },
  {
    id: "pipeline-review",
    provider: "hubspot",
    providerLabel: "HubSpot",
    title: "Pipeline review",
    summary: "Review source-owned deals beside local follow-up state.",
    opener: "Review my HubSpot pipeline and name any missing coverage.",
    skillName: REVENUE_PIPELINE_REVIEW_SKILL,
  },
  {
    id: "customer-pulse-hubspot",
    provider: "hubspot",
    providerLabel: "HubSpot",
    title: "Customer pulse",
    summary: "Review bounded CRM signals without inventing missing history.",
    opener: "Give me a customer pulse from HubSpot and name any missing coverage.",
    skillName: REVENUE_CUSTOMER_PULSE_SKILL,
  },
  {
    id: "cash-flow-quickbooks",
    provider: "quickbooks",
    providerLabel: "QuickBooks",
    title: "Cash flow",
    summary: "Explain the deterministic cash view with coverage and confidence.",
    opener: "Review my QuickBooks cash flow and explain its coverage and confidence.",
    skillName: REVENUE_CASH_FLOW_SKILL,
  },
  {
    id: "payroll-confidence",
    provider: "quickbooks",
    providerLabel: "QuickBooks",
    title: "Payroll confidence",
    summary: "Explain the computed payroll view without treating unknowns as zero.",
    opener: "Review my QuickBooks payroll confidence and name every unknown.",
    skillName: REVENUE_PAYROLL_CONFIDENCE_SKILL,
  },
  ...(["quickbooks", "stripe", "paypal"] as const).map((provider) => ({
    id: `invoice-reminder-${provider}`,
    provider,
    providerLabel:
      provider === "quickbooks" ? "QuickBooks" : provider === "stripe" ? "Stripe" : "PayPal",
    title: "Invoice reminder",
    summary: "Prepare a reminder draft for human approval. Nothing is sent.",
    opener: `Prepare an invoice reminder from ${provider === "quickbooks" ? "QuickBooks" : provider === "stripe" ? "Stripe" : "PayPal"}. Keep it as a draft for my approval.`,
    skillName: REVENUE_INVOICE_REMINDER_SKILL,
  })),
  ...(["stripe", "paypal"] as const).flatMap((provider) => {
    const providerLabel = provider === "stripe" ? "Stripe" : "PayPal";
    return [
      {
        id: `cash-flow-${provider}`,
        provider,
        providerLabel,
        title: "Cash flow",
        summary: "Explain the deterministic payment-rail view with honest coverage.",
        opener: `Review my ${providerLabel} cash flow and name any missing coverage.`,
        skillName: REVENUE_CASH_FLOW_SKILL,
      },
      {
        id: `customer-pulse-${provider}`,
        provider,
        providerLabel,
        title: "Customer pulse",
        summary: "Review bounded payment signals without inventing missing history.",
        opener: `Give me a customer pulse from ${providerLabel} and name any missing coverage.`,
        skillName: REVENUE_CUSTOMER_PULSE_SKILL,
      },
    ];
  }),
];

/** PASSED provider state plus exact active workflow/runtime pins, composed on the server. */
export const revenueDiscovery = tenantQuery({
  args: {},
  handler: async (ctx) => {
    const passed = new Set(
      (await passedProviderGates(ctx, Date.now()))
        .filter(({ environment }) => environment === "production")
        .map(({ provider }) => provider),
    );
    if (passed.size === 0) return [];

    const runtime = await ctx.db
      .query("skills")
      .withIndex("by_name_status", (q) =>
        q.eq("name", REVENUE_SPECIALIST_SKILL).eq("status", "active"),
      )
      .unique();
    if (runtime === null) return [];

    const out = [];
    for (const spec of REVENUE_DISCOVERY) {
      if (!passed.has(spec.provider)) continue;
      const skill = await ctx.db
        .query("skills")
        .withIndex("by_name_status", (q) => q.eq("name", spec.skillName).eq("status", "active"))
        .unique();
      if (skill === null) continue;
      const { skillName, ...view } = spec;
      out.push({
        ...view,
        skill: { name: skillName, version: skill.version },
        runtimeSkill: { name: REVENUE_SPECIALIST_SKILL, version: runtime.version },
      });
    }
    return out;
  },
});

/** The operator's view: both axes, the resolved verdict and the reasons it refused. Owner-only. */
export const inspectGate = ownerQuery({
  args: { provider: providerValidator, environment: environmentValidator },
  handler: async (ctx, { provider, environment }) => {
    const row = await rowFor(ctx, provider, environment);
    return {
      provider,
      environment,
      admission: row?.admission ?? null,
      lane: row?.lane ?? null,
      evidenceRef: row?.evidenceRef ?? null,
      reviewBy: row?.reviewBy ?? null,
      revision: row?.revision ?? 0,
      clearedConditions: row?.clearedConditions ?? [],
      openConditions: openConditionIdsFor(provider),
      eligibility: resolve(row === null ? null : asRecord(row), provider, Date.now()),
    };
  },
});

/**
 * May a consent be STARTED for this provider, by THIS caller?
 *
 * Three answers, and the middle one is the whole reason this is not just `connectPermitted`:
 *
 *   - `lane === "passed"` — ANY tenant may start. The provider proved itself; it is a product
 *     feature.
 *   - admission permits but the lane has not passed — **OWNER ONLY**. This is the evidence-
 *     gathering window: somebody has to complete a real grant before wave 7 can judge the lane, and
 *     that somebody is the operator, not a customer. Without this branch the phase deadlocks again
 *     (see `connectPermitted`); without the owner restriction, sealing a `parked` row would quietly
 *     make an unproven provider connectable by every tenant who called the action directly.
 *   - anything else — nobody.
 *
 * Called from ONE place: `connectorOAuth.mintConnectState`, which every provider's connect flow
 * passes through. Gating there rather than in four provider modules means a fifth lane cannot
 * forget it.
 */
export async function connectStartAllowed(
  ctx: QueryCtx | MutationCtx,
  provider: Provider,
  environment: ConnectorEnvironment,
  isOwner: boolean,
): Promise<boolean> {
  return startAllowedFor(await rowFor(ctx, provider, environment), Date.now(), isOwner) !== null;
}

/**
 * The connect-start rule for ONE already-read row, and the ONLY copy of it.
 *
 * `connectStartAllowed` answers it for a single provider at the choke point;
 * `connectableProviderGates` answers it for every row so a surface can offer exactly what the gate
 * would accept. Those two had drifted: the gate grew the owner branch above to break the phase
 * deadlock, while the surface kept filtering on `passed` alone — so the owner branch was reachable
 * by no caller and the evidence it exists to collect could never be gathered. One predicate, two
 * callers, no second copy to drift.
 *
 * Returns `null` for "not connectable" and otherwise the one fact a surface needs beyond yes:
 * whether this lane is still UNPROVEN, so a row can say so instead of presenting an untested
 * provider as a finished integration.
 */
function startAllowedFor(
  row: GateRow | null,
  now: number,
  isOwner: boolean,
): { unproven: boolean } | null {
  if (row === null || row.lane === "failed") return null;
  if (row.reviewBy <= now) return null;
  if (!admissionPermits(row.admission, row.environment)) return null;
  // The full rule, not just the admission: a passed lane is open to everyone.
  if (resolve(asRecord(row), row.provider, now).state === "passed") return { unproven: false };
  return isOwner ? { unproven: true } : null;
}

/**
 * Every (provider, environment) THIS caller may start a consent for, with the unproven ones marked.
 *
 * For a tenant this is exactly `passedProviderGates`. For the owner it additionally includes the
 * admitted-but-unproven lanes — the evidence-gathering window — which is what gives
 * `connectorConnections.connections` a row to render a Connect button on.
 */
export async function connectableProviderGates(
  ctx: QueryCtx | MutationCtx,
  now: number,
  isOwner: boolean,
): Promise<{ provider: Provider; environment: ConnectorEnvironment; unproven: boolean }[]> {
  const rows = await ctx.db.query("providerGates").collect();
  return rows.flatMap((row) => {
    const allowed = startAllowedFor(row, now, isOwner);
    return allowed === null
      ? []
      : [{ provider: row.provider, environment: row.environment, unproven: allowed.unproven }];
  });
}

/**
 * May an OAuth consent for this provider be COMPLETED in this environment?
 *
 * This is the callback route's only gate, and it is deliberately NOT `availableProviders`. Those two
 * questions are different, and collapsing them deadlocks the phase:
 *
 *   - `availableProviders` asks "may a TENANT see and use this?" — it needs `lane === "passed"`,
 *     which needs live evidence, which needs a completed grant, which needs this route.
 *   - This asks "may a grant be completed at all?" — the ADMISSION axis alone, which is precisely
 *     what `approved_production` means: permission to START. Wave 7 (28-22..25) judges the lane
 *     with the evidence a completed grant produces; it cannot be the prerequisite for producing it.
 *
 * So a lane that is `parked` still permits a callback while remaining invisible to every tenant —
 * the exact separation `providerGates` was built with two fields to express.
 *
 * What it still refuses: no row at all (nobody has judged this provider, so nothing permits it), a
 * `failed` lane (a lane discovered broken must not accept new grants), an admission that does not
 * reach this environment, and an expired review date (an approval that outlived its evidence is not
 * an approval). The answer is one boolean — a route has no use for a reason it must not echo.
 */
export const connectPermitted = internalQuery({
  args: { provider: providerValidator, environment: environmentValidator },
  handler: async (ctx, { provider, environment }): Promise<boolean> => {
    const row = await rowFor(ctx, provider, environment);
    if (row === null || row.lane === "failed") return false;
    if (row.reviewBy <= Date.now()) return false;
    return admissionPermits(row.admission, environment);
  },
});

/** The same answer, for server-side callers (a revenue tool, the completion gate). */
export const gateEligibility = internalQuery({
  args: { provider: providerValidator, environment: environmentValidator },
  handler: (ctx, { provider, environment }) =>
    eligibilityFor(ctx, provider, environment, Date.now()),
});

/**
 * Record an owner judgment. OWNER-ONLY and OPTIMISTIC.
 *
 * A seal to `passed` is validated by running the SAME resolver the readers run against the row it
 * is about to write, so a pass can never be recorded that a reader would then refuse — and, more to
 * the point, it cannot be recorded on an expired review date, on a beta-only admission, while the
 * register's open condition is unresolved, or for a provider whose read allow-list is empty. The
 * refusal names the failing axis so the operator gets the reason, not "no".
 *
 * `expectedRevision` is a compare-and-set: omit it for the first seal, pass the current revision
 * afterwards. Two owner edits, or a seal that was in flight while the lane failed, cannot silently
 * clobber one another.
 *
 * Parking is NEVER blocked. A refusal must always be recordable, or a lane discovered to be broken
 * could not be shut off.
 */
export const sealGate = ownerMutation({
  args: {
    provider: providerValidator,
    environment: environmentValidator,
    admission: admissionValidator,
    lane: laneValidator,
    /** A doc/commit REF, never evidence prose (CLAUDE.md §4). */
    evidenceRef: v.string(),
    reviewBy: v.number(),
    clearedConditions: v.optional(v.array(v.string())),
    expectedRevision: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const existing = await rowFor(ctx, args.provider, args.environment);
    const currentRevision = existing?.revision ?? 0;
    if ((args.expectedRevision ?? 0) !== currentRevision) {
      throw new Error(
        `STALE_REVISION: the ${args.provider}/${args.environment} gate is at revision ${currentRevision}.`,
      );
    }

    const cleared = args.clearedConditions ?? [];
    const proposed: ProviderGateRecord = {
      provider: args.provider,
      environment: args.environment,
      admission: args.admission,
      lane: args.lane,
      reviewBy: args.reviewBy,
      clearedConditions: cleared,
    };
    if (args.lane === "passed") {
      const verdict = resolve(proposed, args.provider, Date.now());
      if (verdict.state !== "passed") {
        throw new Error(
          `CANNOT_SEAL_PASSED: ${args.provider}/${args.environment} resolves ${verdict.state} — ${verdict.reasons.join(", ")}.`,
        );
      }
    }

    const revision = currentRevision + 1;
    const fields = {
      admission: args.admission,
      lane: args.lane,
      evidenceRef: args.evidenceRef,
      reviewBy: args.reviewBy,
      clearedConditions: cleared,
      revision,
      updatedAt: Date.now(),
    };
    if (existing === null) {
      await ctx.db.insert("providerGates", {
        provider: args.provider,
        environment: args.environment,
        ...fields,
      });
    } else {
      await ctx.db.patch(existing._id, fields);
    }
    return { revision };
  },
});

/**
 * The other write, and the only one that is not an owner judgment: a live refresh or revoke that
 * failed against the provider.
 *
 * NO compare-and-set here, deliberately. Refusing to record a failure because the revision moved
 * would leave a lane readable that we already know is broken — a fail-closed transition must not be
 * blocked by a concurrency check. It DOES bump the revision, which is what makes an owner seal that
 * was already in flight fail rather than resurrect the lane on stale evidence.
 *
 * A failure against a gate that was never sealed is refused rather than invented: recording a
 * failure for a lane nobody ever ran would put a `failed` row where honest silence belongs.
 */
export const recordLaneFailure = internalMutation({
  args: {
    provider: providerValidator,
    environment: environmentValidator,
    evidenceRef: v.string(),
  },
  handler: async (ctx, { provider, environment, evidenceRef }) => {
    const existing = await rowFor(ctx, provider, environment);
    if (existing === null) {
      throw new Error(`NO_GATE_RECORD: ${provider}/${environment} has never been sealed.`);
    }
    await ctx.db.patch(existing._id, {
      lane: "failed",
      evidenceRef,
      revision: existing.revision + 1,
      updatedAt: Date.now(),
    });
    return { revision: existing.revision + 1 };
  },
});
