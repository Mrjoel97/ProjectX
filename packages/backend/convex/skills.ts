// Versioned skill/prompt registry adapter (SkillOpt readiness).
//
// Thin adapter over the `skills` table: pure contract lives in @pikar/contracts.
// This module is on plan 02's internal-builder allow-list (it intentionally uses
// internalMutation directly). Skill bodies are IMMUTABLE per version — a change
// is a new version row plus an activateSkill flip; body/name/version are never
// patched (only `status` and `evidence` may change).

import type { EvalEvidence, EvalEvidenceTenantTarget } from "@pikar/contracts/skill";
import {
  ATTACHMENT_EXTRACTOR_SKILL,
  BMC_SKILL,
  BUSINESS_BLUEPRINT_SKILL,
  BUSINESS_PROFILE_SKILL,
  COCKPIT_AGENT_SKILL,
  CONTENT_DRAFTER_SKILL,
  composeUserSkillBody,
  DOCUMENT_ANALYST_SKILL,
  DOCUMENT_CLASSIFIER_SKILL,
  DOCUMENT_DRAFTER_SKILL,
  EMAIL_DRAFTER_SKILL,
  EXECUTIVE_AGENT_AUTHOR_ID,
  EXECUTIVE_ROUTER_SKILL,
  FOLDER_DIGEST_SKILL,
  GATED_SKILLS,
  GRAPH_EXTRACTOR_SKILL,
  GROWTH_OS_DIAGNOSTIC_SKILL,
  hasPassingAgentTenantEvidence,
  hasPassingEvidence,
  hasPassingPackEvalEvidence,
  hasPassingTenantEvidence,
  INBOX_DIGEST_SKILL,
  isAgentAuthorableSkill,
  isGatedSkill,
  isUserAuthorableSkill,
  KNOWLEDGE_QUERY_PLANNER_SKILL,
  KNOWLEDGE_SYNTHESIZER_SKILL,
  LEAD_ENGINE_SKILL,
  LEAN_CANVAS_SKILL,
  type LoadedSkill,
  MEDIA_DIRECTOR_SKILL,
  MONEY_MODEL_DESIGNER_SKILL,
  NO_ACTIVE_SKILL_ERROR,
  NO_SUCH_SKILL_VERSION_ERROR,
  NO_SUCH_TENANT_CANDIDATE_ERROR,
  OFFER_ARCHITECT_SKILL,
  ONBOARDING_AGENT_SKILL,
  REPLY_DRAFTER_SKILL,
  RESEARCH_SPECIALIST_SKILL,
  STYLE_COACHING_SKILL,
  STYLE_CONCISE_SKILL,
  STYLE_DIRECT_SKILL,
  SWOT_SKILL,
  USER_AUTHORABLE_SKILL_METADATA,
  VOICE_BRIEF_SKILL,
  VOICE_SESSION_SKILL,
} from "@pikar/contracts/skill";
import { attachmentExtractorSkillBody } from "@pikar/contracts/skills/attachmentExtractor";
import { bmcSkillBody } from "@pikar/contracts/skills/bmc";
import { businessBlueprintSkillBody } from "@pikar/contracts/skills/businessBlueprint";
import { businessProfileSkillBody } from "@pikar/contracts/skills/businessProfile";
import { cockpitAgentSkillBody } from "@pikar/contracts/skills/cockpitAgent";
import { contentDrafterSkillBody } from "@pikar/contracts/skills/contentDrafter";
import { documentAnalystSkillBody } from "@pikar/contracts/skills/documentAnalyst";
import { documentClassifierSkillBody } from "@pikar/contracts/skills/documentClassifier";
import { documentDrafterSkillBody } from "@pikar/contracts/skills/documentDrafter";
import { emailDrafterSkillBody } from "@pikar/contracts/skills/emailDrafter";
import { executiveRouterSkillBody } from "@pikar/contracts/skills/executiveRouter";
import { folderDigestSkillBody } from "@pikar/contracts/skills/folderDigest";
import { graphExtractorSkillBody } from "@pikar/contracts/skills/graphExtractor";
import { growthOsDiagnosticSkillBody } from "@pikar/contracts/skills/growthOsDiagnostic";
import { inboxDigestSkillBody } from "@pikar/contracts/skills/inboxDigest";
import { knowledgeQueryPlannerSkillBody } from "@pikar/contracts/skills/knowledgeQueryPlanner";
import { knowledgeSynthesizerSkillBody } from "@pikar/contracts/skills/knowledgeSynthesizer";
import {
  KNOWLEDGE_WORK_PINNED_AT,
  KNOWLEDGE_WORK_PROVENANCE,
} from "@pikar/contracts/skills/knowledgeWorkProvenance";
import { leadEngineSkillBody } from "@pikar/contracts/skills/leadEngine";
import { leanCanvasSkillBody } from "@pikar/contracts/skills/leanCanvas";
import { mediaDirectorSkillBody } from "@pikar/contracts/skills/mediaDirector";
import { moneyModelDesignerSkillBody } from "@pikar/contracts/skills/moneyModelDesigner";
import { offerArchitectSkillBody } from "@pikar/contracts/skills/offerArchitect";
import { onboardingAgentSkillBody } from "@pikar/contracts/skills/onboardingAgent";
import { packBrandReviewSkillBody } from "@pikar/contracts/skills/packBrandReview";
import { packBusinessPulseSkillBody } from "@pikar/contracts/skills/packBusinessPulse";
import { packCampaignPlanSkillBody } from "@pikar/contracts/skills/packCampaignPlan";
import { packCustomerComplaintSkillBody } from "@pikar/contracts/skills/packCustomerComplaint";
import { packProcessSopSkillBody } from "@pikar/contracts/skills/packProcessSop";
import { packSalesCallPrepSkillBody } from "@pikar/contracts/skills/packSalesCallPrep";
import { replyDrafterSkillBody } from "@pikar/contracts/skills/replyDrafter";
import { researchSpecialistSkillBody } from "@pikar/contracts/skills/researchSpecialist";
import { styleCoachingSkillBody } from "@pikar/contracts/skills/styleCoaching";
import { styleConciseSkillBody } from "@pikar/contracts/skills/styleConcise";
import { styleDirectSkillBody } from "@pikar/contracts/skills/styleDirect";
import { swotSkillBody } from "@pikar/contracts/skills/swot";
import { voiceBriefSkillBody } from "@pikar/contracts/skills/voiceBrief";
import { voiceSessionSkillBody } from "@pikar/contracts/skills/voiceSession";
import {
  type CustomizationError,
  canonicalCustomization,
  checkBaseVersion,
  customizationSchemaFor,
  hasPassingPackBrowserEvidence,
  hasPassingTenantPackBrowserEvidence,
  hasValidPackProvenance,
  isWorkflowPackSkill,
  renderCustomization,
  validateCustomization,
  WORKFLOW_PACK_SKILL_NAMES,
} from "@pikar/core";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
  internalMutation,
  internalQuery,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import { ownerMutation, ownerQuery, tenantMutation, tenantQuery } from "./lib/functions";
import { contentHash } from "./lib/hash";

/**
 * Load the currently active skill by name. Reads the single status==="active"
 * row via by_name_status and FAILS CLOSED (throws) when none exists. Callers
 * must record { name, version } in telemetry/audit for every use (Phase 8).
 */
export async function loadSkill(ctx: QueryCtx, name: string): Promise<LoadedSkill> {
  const row = await ctx.db
    .query("skills")
    .withIndex("by_name_status", (q) => q.eq("name", name).eq("status", "active"))
    .unique();

  if (row === null) {
    throw new Error(`${NO_ACTIVE_SKILL_ERROR}: ${name}`);
  }

  return { body: row.body, version: row.version, skillId: row._id };
}

/**
 * internalQuery wrapper over loadSkill so "use node" actions (which cannot touch
 * ctx.db) reach the active skill body via ctx.runQuery. Fails closed like loadSkill.
 */
export const getActiveSkill = internalQuery({
  args: { name: v.string() },
  handler: (ctx, { name }) => loadSkill(ctx, name),
});

/**
 * THE activation target, scope-discriminated. There are exactly three shapes a caller can ask for,
 * and no fourth: a global `skills` (name, version); a tenant candidate going live; a tenant row
 * being restored. Anything else is not expressible.
 */
type ActivationTarget =
  | { scope: "global"; name: string; version: number }
  | { scope: "tenant"; candidateId: Id<"tenantSkills">; mode: "activate-user" | "rollback" }
  | {
      scope: "tenant";
      candidateId: Id<"tenantSkills">;
      mode: "activate-agent";
      ownerUserId: Id<"users">;
    };

type OwnerApproval = NonNullable<Doc<"tenantSkills">["ownerApproval"]>;

/**
 * The resolved, gate-cleared transition — everything the ONE patch block needs and nothing it can
 * decide for itself. Producing this is where a scope's target lookup, current-active lookup and
 * evidence/exemption decision live; applying it is shared.
 */
type ActivationPlan = {
  targetId: Id<"skills"> | Id<"tenantSkills">;
  name: string;
  version: number;
  /** null for the global registry, which is not tenant-scoped at all. */
  tenantId: string | null;
  /** Idempotence: the exact row is ALREADY live, so the transition is a no-op, not a violation. */
  alreadyActive: boolean;
  currentId: Id<"skills"> | Id<"tenantSkills"> | null;
  currentVersion: number | null;
  /** Refs-only: which eval run authorized this, for the audit payload. */
  evalRunId: string | null;
  /** The row's closed provenance discriminant, copied into refs-only audit. */
  author: Doc<"tenantSkills">["author"] | null;
  /** Agent activation only: approval patched with active status in THE one target write. */
  ownerApproval: OwnerApproval | null;
  /**
   * `rollbackEligible` is a `tenantSkills` COLUMN — the global registry has no such field, and its
   * rollback exemption is status-only (see below). Empty for the global scope by construction.
   */
  provenActive: { rollbackEligible: true } | Record<string, never>;
};

/** The result the public wrappers audit and return. Refs, ids, versions and one boolean. */
type ActivationResult = {
  scope: "global" | "tenant";
  targetId: string;
  name: string;
  version: number;
  tenantId: string | null;
  /** false = the row was already live. Nothing was patched and nothing must be audited. */
  changed: boolean;
  fromId: string | null;
  fromVersion: number | null;
  evalRunId: string | null;
  author: Doc<"tenantSkills">["author"] | null;
};

/**
 * The GLOBAL registry's plan — byte-for-byte the gate `activateSkillVersion` has always applied,
 * moved behind the shared transition rather than reimplemented beside it.
 */
async function planGlobalActivation(
  ctx: MutationCtx,
  name: string,
  version: number,
): Promise<ActivationPlan> {
  const target = await ctx.db
    .query("skills")
    .withIndex("by_name_version", (q) => q.eq("name", name).eq("version", version))
    .unique();

  if (target === null) {
    throw new Error(`${NO_SUCH_SKILL_VERSION_ERROR}: ${name} v${version}`);
  }

  // EVAL_GATE (EVAL-01): a never-before-active version of a gated skill may only
  // activate with recorded passing evidence pinning EXACTLY this version. The
  // candidate-vs-rollback distinction is PURELY the target row's status —
  // archived/rolled_back were active before and are exempt BY STATUS (rollback
  // must always work mid-incident, never blocked by a broken eval harness).
  if (
    isGatedSkill(name) &&
    target.status === "candidate" &&
    !hasPassingEvidence(target.evidence, name, version)
  ) {
    throw new Error(
      `EVAL_GATE: ${name} v${version} has no recorded passing eval run (run pnpm eval:golden --skill ${name}@${version})`,
    );
  }

  // PACK GATE (27-02, PACK-02). A SECOND, stricter choke point at the same place, keyed on the
  // closed pack id set rather than on `GATED_SKILLS` — see the pack lane below for why the two
  // lists must stay apart. Same `status === "candidate"` condition, so the same rollback exemption.
  if (isWorkflowPackSkill(name) && target.status === "candidate") {
    assertPackActivationEvidence(target, name, version);
  }

  const current = await ctx.db
    .query("skills")
    .withIndex("by_name_status", (q) => q.eq("name", name).eq("status", "active"))
    .unique();

  return {
    targetId: target._id,
    name,
    version,
    tenantId: null,
    alreadyActive: target.status === "active",
    currentId: current?._id ?? null,
    currentVersion: current?.version ?? null,
    evalRunId: evidenceRefs(target.evidence)?.runId ?? null,
    author: null,
    ownerApproval: null,
    provenActive: {},
  };
}

/**
 * The TENANT overlay's plan (21-04). Differences from the global scope:
 *
 *  1. **The exemption is a COLUMN, not a status.** Globally, `archived`/`rolled_back` prove prior
 *     activation because nothing else can produce those statuses in the `skills` table. In
 *     `tenantSkills` a never-active candidate can be archived (a superseded draft, or a fixture),
 *     so status alone would launder a pending candidate straight around the eval gate. The proof is
 *     `rollbackEligible === true`, which is written ONLY by the shared patch block below when a row
 *     actually goes live, plus the server baseline `publishUserCandidate` mints as a byte copy of
 *     the code-owned core.
 *  2. **Evidence names the ROW.** `hasPassingTenantEvidence` compares candidateId, registryTenantId,
 *     name AND version, because two tenants can each own `offer-architect@2` (21-02/21-03).
 *  3. **A workflow-pack name never reaches either of those** (29-05) — the branch below throws
 *     before any evidence is read. Its reasoning is on that branch.
 *
 * Owner authorization is deliberately NOT here. This helper is also the identity-free path for
 * internal callers, and `requireOwner` lives on the public wrapper — two independent gates
 * (docs/playbooks/authorization.md invariant 9).
 */
/**
 * THE TENANT PACK LANE: the same three planes a GLOBAL pack body must clear, keyed to a row id.
 *
 * WHAT THIS REPLACED. `planTenantActivation` used to throw `PACK_GATE` for every `pack-*` name at
 * every scope, and correctly so: `publishPackCustomization` could mint the row, `hasPassingTenantEvidence`
 * alone would have activated it, and that predicate is the suite-less one the pack gate exists to
 * refuse. Running a weaker subset and calling it the gate was rightly declined.
 *
 * WHAT THE PRICE ACTUALLY WAS, once measured. The old comment named "the two evidence columns plus a
 * tenant-scoped pack eval runner". Only ONE column was owed:
 *
 *  1. PROVENANCE — no column. A tenant row already stores `templateId`, `templateVersion`,
 *     `customizationValues` and `customizationHash`, so provenance is RECOMPUTED here and compared.
 *     That is strictly stronger than the global plane, which checks the SHAPE of a stored blob and
 *     says so in its own docstring: it "checks SHAPE and the VERSION PIN, not that `bodySha256` is
 *     the hash of the body it sits beside". Here the hash IS recomputed from the stored values, so a
 *     row whose values were edited underneath its hash cannot activate.
 *     It also requires the customization to be against the CURRENTLY APPROVED template version — a
 *     candidate composed against a template that has since been republished is stale, and activating
 *     it would put yesterday's adaptation on today's approved body.
 *  2. EVAL — `hasPassingTenantEvidence`, which already existed. It became trustworthy earlier today:
 *     until `shouldRecordEvidence` learned to verify the pinned body was actually LOADED, a green
 *     run certified pins it never ran, so this plane was a certificate anyone could mint.
 *  3. BROWSER — the one new column, `tenantSkills.browserEvidence`, checked by
 *     `hasPassingTenantPackBrowserEvidence` which pins the ROW ID rather than name@version. Two
 *     tenants can each own version 2; a browser run against one must never certify the other.
 *
 * FAIL-CLOSED AND UNORDERED. Every missing plane is collected and named, rather than throwing on the
 * first: an operator fixing one at a time would otherwise need three round trips to learn what is
 * wrong. The throw still carries `PACK_GATE_ERROR`, so every existing caller and test that matches
 * on that literal still sees a refusal — what changed is that it is now EARNABLE.
 */
async function assertTenantPackActivationEvidence(
  ctx: MutationCtx,
  row: Doc<"tenantSkills">,
): Promise<void> {
  const missing = await tenantPackPlanesMissing(ctx, row);
  if (missing.length > 0) {
    throw new Error(
      `${PACK_GATE_ERROR}: tenant pack candidate ${String(row._id)} lacks ${missing.join(", ")} evidence`,
    );
  }
}

/**
 * WHICH OF THE THREE PLANES ARE MISSING — the gate's whole judgement, as data.
 *
 * IT IS SEPARATE FROM THE THROW SO THAT NOTHING ELSE HAS TO RE-IMPLEMENT IT. `inspectTenantSkill`
 * reports this verdict, and if it computed its own the two would drift and an operator would be
 * told a row was ready by the query that the mutation then refuses. This repo has already paid for
 * that shape more than once: "a repair reaching two of three copies".
 *
 * It takes a QUERY ctx (a mutation ctx is one), because answering "is this row activatable" must
 * never require the right to activate it.
 */
async function tenantPackPlanesMissing(ctx: QueryCtx, row: Doc<"tenantSkills">): Promise<string[]> {
  const missing: string[] = [];

  // ── PLANE 1: provenance, recomputed ─────────────────────────────────────────────────────────
  const provenanceOk = await (async (): Promise<boolean> => {
    const { templateId, templateVersion, customizationValues, customizationHash } = row;
    if (
      typeof templateId !== "string" ||
      typeof templateVersion !== "number" ||
      typeof customizationValues !== "string" ||
      typeof customizationHash !== "string"
    ) {
      return false;
    }
    // The template this row claims to customize must be the one that is APPROVED AND ACTIVE now.
    // `loadSkill` fails closed on an unseeded/absent name, which is the correct answer here too.
    let activeTemplateVersion: number;
    try {
      activeTemplateVersion = (await loadSkill(ctx, `pack-${templateId}`)).version;
    } catch {
      return false;
    }
    if (activeTemplateVersion !== templateVersion) return false;

    const schema = customizationSchemaFor(templateId, templateVersion);
    if (!schema.ok) return false;
    let values: unknown;
    try {
      values = JSON.parse(customizationValues);
    } catch {
      return false;
    }
    // THE RECOMPUTE. A row whose stored values were changed without its hash moving fails here.
    const recomputed = await contentHash(
      canonicalCustomization(schema.value, values as Record<string, never>),
    );
    return recomputed === customizationHash;
  })();
  if (!provenanceOk) missing.push("provenance");

  // ── PLANE 2: the pinned eval run ────────────────────────────────────────────────────────────
  if (!hasPassingTenantEvidence(row.evidence, tenantTargetOf(row))) missing.push("eval");

  // ── PLANE 3: the authenticated multi-viewport browser run of THIS row ───────────────────────
  if (
    !hasPassingTenantPackBrowserEvidence(row.browserEvidence, {
      candidateId: String(row._id),
      name: row.name,
      version: row.version,
    })
  ) {
    missing.push("browser");
  }

  return missing;
}

async function planTenantActivation(
  ctx: MutationCtx,
  candidateId: Id<"tenantSkills">,
  mode: "activate-user" | "activate-agent" | "rollback",
  ownerUserId?: Id<"users">,
): Promise<ActivationPlan> {
  const row = await loadTenantCandidate(ctx, candidateId);

  // THE PACK GATE HAS NO TENANT LANE, SO THE TENANT LANE FAILS CLOSED (29-05 remediation).
  //
  // `publishPackCustomization` is the first production writer that can mint a `pack-*` row in
  // `tenantSkills`. Before it, every pack name was refused by `publishUserCandidate`
  // (NOT_USER_AUTHORABLE) and by `publishAgentCandidate`, so this asymmetry was unreachable; after
  // it, a tenant pack body would otherwise have activated on `hasPassingTenantEvidence` — which is
  // exactly the suite-less `run-eval-golden.mjs` predicate `assertPackActivationEvidence`'s own
  // comment names as the thing the pack gate exists to refuse. Same body class, same deployment,
  // two different gates.
  //
  // This is NOT "the same three planes here": `tenantSkills` has no `provenance` and no
  // `browserEvidence` COLUMN (schema.ts), so two of the three planes have nowhere to be written and
  // `hasPassingPackEvalEvidence` has no tenant-scoped runner to satisfy it. Rather than run a
  // weaker subset and call it the gate, the throw sits ahead of the mode switch, so activate-user,
  // activate-agent and rollback all take it. Rollback is included for the same reason it is safe to
  // include: the single `status: "active"` patch in this module (`transitionSkillActivation`, whose
  // uniqueness `skills.test.ts` counts) routes every tenant target through here, so a name this
  // branch always throws on has no live version to restore. A pack body changes at GLOBAL scope,
  // through the three-plane gate.
  //
  // Publishing is untouched: a tenant may still mint the candidate, and it stays a candidate. It is
  // NOT unreachable — the `tenantSkillIds` pin rail runs a candidate body by row id (see
  // `publishPackCustomization`'s docstring for that door and what governs it). When a tenant pack
  // lane is genuinely wanted, the work is the two evidence columns plus a tenant-scoped pack eval
  // runner — not deleting this branch.
  if (isWorkflowPackSkill(row.name)) {
    // THE TENANT LANE EXISTS NOW (2026-08-30) — and it is the SAME three planes as global, not a
    // weaker subset. See `assertTenantPackActivationEvidence` for what each one costs and why
    // provenance needed no column.
    await assertTenantPackActivationEvidence(ctx, row);
  }

  let ownerApproval: OwnerApproval | null = null;

  if (mode === "activate-user") {
    // Author-path separation is checked even on an already-active row. An agent row never becomes
    // reachable through Phase 21's weaker suite-less predicate by calling the user export twice.
    if (row.author !== "user") {
      throw new Error(`NOT_USER_AUTHORED: ${candidateId} was written by ${row.author}`);
    }
    // User re-activation retains Phase 21's shipped idempotence semantics.
    if (row.status !== "active") {
      if (row.status !== "candidate") {
        throw new Error(`NOT_A_CANDIDATE: ${candidateId} is ${row.status}`);
      }
      if (!hasPassingTenantEvidence(row.evidence, tenantTargetOf(row))) {
        throw new Error(
          `EVAL_GATE: tenant candidate ${candidateId} has no recorded passing eval run pinning this EXACT row (run pnpm eval:golden --tenant-skill ${candidateId})`,
        );
      }
    }
  } else if (mode === "activate-agent") {
    if (row.author !== "agent") {
      throw new Error(`NOT_AGENT_AUTHORED: ${candidateId} was written by ${row.author}`);
    }
    // Unlike the user path, this is an approval act, not an idempotent "make active" request.
    if (row.status !== "candidate") {
      throw new Error(`NOT_A_CANDIDATE: ${candidateId} is ${row.status}`);
    }
    if (row.ownerApproval !== undefined) {
      throw new Error(`ALREADY_APPROVED: ${candidateId}`);
    }
    if (!hasPassingAgentTenantEvidence(row.evidence, tenantTargetOf(row))) {
      throw new Error(
        `EVAL_GATE: agent candidate ${candidateId} has no recorded passing current-suite eval run pinning this EXACT row`,
      );
    }
    const evalRunId = evidenceRefs(row.evidence)?.runId;
    if (typeof evalRunId !== "string" || evalRunId.trim() === "" || ownerUserId === undefined) {
      throw new Error(`EVAL_GATE: agent candidate ${candidateId} has incomplete evidence refs`);
    }
    ownerApproval = { ownerUserId, approvedAt: Date.now(), evalRunId };
  } else if (row.status !== "active") {
    // Rollback is evidence-EXEMPT and must survive a broken eval harness mid-incident — but
    // exemption is not a hole: only a row that was genuinely live (or the server baseline) is
    // eligible, and the flag is the proof. Status is checked too, never instead.
    if (row.rollbackEligible !== true) {
      throw new Error(`ROLLBACK_NOT_ELIGIBLE: ${candidateId} was never active`);
    }
    if (row.status !== "archived" && row.status !== "rolled_back") {
      throw new Error(`ROLLBACK_NOT_ELIGIBLE: ${candidateId} is ${row.status}, not a prior state`);
    }
  }

  // Scope-LOCAL: this tenant, this skill name. Another tenant's colliding row and the global
  // registry are outside the index range and cannot be reached from here.
  const current = await ctx.db
    .query("tenantSkills")
    .withIndex("by_tenant_name_status", (q) =>
      q.eq("tenantId", row.tenantId).eq("name", row.name).eq("status", "active"),
    )
    .unique();

  return {
    targetId: row._id,
    name: row.name,
    version: row.version,
    tenantId: row.tenantId,
    alreadyActive: row.status === "active",
    currentId: current?._id ?? null,
    currentVersion: current?.version ?? null,
    evalRunId: evidenceRefs(row.evidence)?.runId ?? null,
    author: row.author,
    ownerApproval,
    provenActive: { rollbackEligible: true },
  };
}

/**
 * The single gated candidate→active flip, defined ONCE (CLAUDE.md §8 root-cause) for BOTH registry
 * scopes: the internal `activateSkill`, the owner-facing `activateCandidate`, `activateTenantCandidate`
 * and `rollbackTenantSkill` all route through this, so no gate can be bypassed or duplicated.
 * Within one mutation it archives the current active row and activates the target — never patching
 * body/name/version/author/lineage/evidence. Re-activating a prior version is rollback.
 *
 * There is exactly ONE `ctx.db.patch(..., { status: "active" ... })` in this module and it is below;
 * `skills.test.ts` counts it. A second one is a second gate.
 */
async function transitionSkillActivation(
  ctx: MutationCtx,
  target: ActivationTarget,
): Promise<ActivationResult> {
  const plan =
    target.scope === "global"
      ? await planGlobalActivation(ctx, target.name, target.version)
      : await planTenantActivation(
          ctx,
          target.candidateId,
          target.mode,
          target.mode === "activate-agent" ? target.ownerUserId : undefined,
        );

  // ── THE archive/activate patch block. One transaction, two patches, no third. ────────────────
  if (plan.currentId !== null && plan.currentId !== plan.targetId) {
    // The displaced row was live, so it is provably rollback-eligible from here on (tenant scope).
    await ctx.db.patch(plan.currentId, { status: "archived", ...plan.provenActive });
  }
  if (!plan.alreadyActive) {
    await ctx.db.patch(plan.targetId, {
      status: "active",
      ...plan.provenActive,
      ...(plan.ownerApproval === null ? {} : { ownerApproval: plan.ownerApproval }),
    });
  }

  return {
    scope: target.scope,
    targetId: String(plan.targetId),
    name: plan.name,
    version: plan.version,
    tenantId: plan.tenantId,
    changed: !plan.alreadyActive,
    fromId: plan.currentId === null ? null : String(plan.currentId),
    fromVersion: plan.currentVersion,
    evalRunId: plan.evalRunId,
    author: plan.author,
  };
}

/**
 * Thin compatibility wrapper: the global (name, version) call shape every existing caller and test
 * uses, routed through the one shared transition. Kept so the global exports below are byte-unchanged
 * in behaviour and in signature.
 */
async function activateSkillVersion(
  ctx: MutationCtx,
  name: string,
  version: number,
): Promise<void> {
  await transitionSkillActivation(ctx, { scope: "global", name, version });
}

/**
 * The ONE permitted internal status mutation (the eval runner / seed path). Wraps the
 * shared activateSkillVersion gate.
 */
export const activateSkill = internalMutation({
  args: { name: v.string(), version: v.number() },
  handler: (ctx, { name, version }) => activateSkillVersion(ctx, name, version),
});

/**
 * The owner's one-click candidate activation from the ops panel (IMPR-02/03). OWNER-ONLY
 * (GOVN-01), routing through the SAME shared EVAL_GATE as activateSkill, so an unevaluated
 * gated candidate CANNOT go live from the UI any more than from the runner. Returns the flip
 * so the panel can confirm the before→after; an EVAL_GATE / NO_SUCH_SKILL_VERSION throw
 * surfaces inline.
 *
 * These are TWO INDEPENDENT gates and must stay that way. `requireOwner` asks *may this
 * caller act?*; EVAL_GATE asks *has this body earned activation?*. Never move requireOwner
 * down into `activateSkillVersion` to "cover both" — that helper is also the trusted path
 * for internal eval/seeding/operator callers that have no browser identity at all, and
 * gating it would break them while conflating two orthogonal questions.
 */
export const activateCandidate = ownerMutation({
  args: { name: v.string(), version: v.number() },
  handler: async (ctx, { name, version }) => {
    await activateSkillVersion(ctx, name, version);
    return { ok: true as const, name, version };
  },
});

/**
 * The ops panel's candidate-review read (IMPR-03): for each GATED skill that has a
 * pending candidate, the newest candidate with the live (active) version as `fromVersion`
 * + both bodies (the before/after diff source), its recorded `evidence`, and whether that
 * evidence passes the gate (so the panel can pre-warn an Activate that EVAL_GATE will
 * refuse).
 *
 * OWNER-ONLY (GOVN-01). This is the sharpest disclosure boundary in the file: skill rows are
 * GLOBAL registry records and `toBody`/`fromBody` are the raw prompt bodies. Under the old
 * tenant wrapper any signed-in user could read every candidate prompt in the deployment.
 * The refusal IS the no-body boundary — reject before a single registry row is read.
 */
export const candidatesForReview = ownerQuery({
  args: {},
  handler: async (ctx) => {
    const out = [];
    for (const name of GATED_SKILLS) {
      const rows = await ctx.db
        .query("skills")
        .withIndex("by_name_status", (q) => q.eq("name", name))
        .collect();
      const active = rows.find((r) => r.status === "active") ?? null;
      // ONLY candidates AHEAD of what is live. `reduce(max)` over every candidate answers "newest
      // candidate", which reads like "next version" and is not: optimizer dry-runs leave candidate
      // rows behind at lower versions, and once a real upgrade lands those stale rows keep being
      // offered forever. Observed 2026-08-09 — the page showed `v17 -> v16` for cockpit-agent and
      // `v4 -> v3` for two others, and every Activate click could only either hit EVAL_GATE (they
      // carry no evidence) or, if evidence ever existed, silently ROLL A LIVE AGENT BACK.
      // Rollback is a deliberate operator act through `activateSkill`, never a review-queue button.
      const candidates = rows.filter(
        (r) => r.status === "candidate" && (active === null || r.version > active.version),
      );
      if (candidates.length === 0) continue;
      const candidate = candidates.reduce((a, b) => (b.version > a.version ? b : a));
      out.push({
        name,
        fromVersion: active?.version ?? null,
        fromBody: active?.body ?? null,
        toVersion: candidate.version,
        toBody: candidate.body,
        evidence: candidate.evidence ?? null,
        gatePassed: hasPassingEvidence(candidate.evidence, name, candidate.version),
      });
    }
    return out;
  },
});

/**
 * Record eval-run evidence on the exact (name, version) row (EVAL-01). Written
 * by the eval runner after a run; the activateSkill gate reads it. Evidence is
 * one of the two sanctioned patchable fields (with status) — patches NOTHING
 * else. Payload is refs/counts-only JSON (CLAUDE.md §4), never raw content.
 */
export const recordEvalEvidence = internalMutation({
  args: { name: v.string(), version: v.number(), evidence: v.string() },
  handler: async (ctx, { name, version, evidence }) => {
    const row = await ctx.db
      .query("skills")
      .withIndex("by_name_version", (q) => q.eq("name", name).eq("version", version))
      .unique();

    if (row === null) {
      throw new Error(`${NO_SUCH_SKILL_VERSION_ERROR}: ${name} v${version}`);
    }

    await ctx.db.patch(row._id, { evidence });
  },
});

/**
 * Load a skill body pinned to an EXACT version, regardless of status — the
 * version-pin read the eval runner threads into the agent loop so a candidate
 * evaluates as itself. Same LoadedSkill shape as getActiveSkill.
 */
export const getSkillVersion = internalQuery({
  args: { name: v.string(), version: v.number() },
  handler: async (ctx, { name, version }): Promise<LoadedSkill> => {
    const row = await ctx.db
      .query("skills")
      .withIndex("by_name_version", (q) => q.eq("name", name).eq("version", version))
      .unique();

    if (row === null) {
      throw new Error(`${NO_SUCH_SKILL_VERSION_ERROR}: ${name} v${version}`);
    }

    return { body: row.body, version: row.version, skillId: row._id };
  },
});

/**
 * THE REGISTRY, at module scope so its NAMES can be read without its bodies.
 *
 * Lifted out of `seedSkills`'s handler by 26-15: `reportsGovernance.activeSkills` needs the
 * enumeration to drive one `by_name_status` read per skill, and a second hand-typed copy of
 * these names is precisely the drift that shipped 26-14's permanent `edit: 0`. Same array,
 * same APPEND-ONLY rule as before — a new row goes at the END; do not reorder.
 */
const SEEDS = [
  { name: EXECUTIVE_ROUTER_SKILL, body: executiveRouterSkillBody },
  { name: EMAIL_DRAFTER_SKILL, body: emailDrafterSkillBody },
  { name: COCKPIT_AGENT_SKILL, body: cockpitAgentSkillBody },
  { name: DOCUMENT_DRAFTER_SKILL, body: documentDrafterSkillBody },
  { name: ATTACHMENT_EXTRACTOR_SKILL, body: attachmentExtractorSkillBody },
  { name: GRAPH_EXTRACTOR_SKILL, body: graphExtractorSkillBody },
  { name: INBOX_DIGEST_SKILL, body: inboxDigestSkillBody },
  { name: REPLY_DRAFTER_SKILL, body: replyDrafterSkillBody },
  // UNGATED (RESEARCH OQ3): a free-form voice persona the eval gate cannot meaningfully assert.
  { name: VOICE_SESSION_SKILL, body: voiceSessionSkillBody },
  // UNGATED (RESEARCH OQ3): its output is a vault document, not tool-state.
  { name: VOICE_BRIEF_SKILL, body: voiceBriefSkillBody },
  // UNGATED (14-01, DOCV-01): the voice-doc "discuss this report" persona. Same reason as
  // voice-session above — run-eval-golden.mjs drives runCockpitAgent over text fixtures and
  // hard-validates --skill against a closed name list, so it structurally cannot exercise a
  // Realtime voice persona; gating would deadlock this skill at v1 on its first body edit.
  { name: DOCUMENT_ANALYST_SKILL, body: documentAnalystSkillBody },
  // UNGATED (11-01): output is a vault-doc profile a human confirms (SC#1), not tool-state.
  { name: BUSINESS_PROFILE_SKILL, body: businessProfileSkillBody },
  // UNGATED (15.1-06, Q6): the conversational onboarding system prompt (design §6). Same
  // rationale as `business-profile` above — an onboarding turn a human answers, not tool-state
  // — and the guarantee that actually matters is CODE: `onboarding.converse` picks the next
  // question from `missingSlots` and computes `done` from `canComplete`, so no body edit can
  // make the conversation finish with a required slot empty. `converse` loads it FAIL-CLOSED.
  { name: ONBOARDING_AGENT_SKILL, body: onboardingAgentSkillBody },
  // GATED (12-02, BEVL-01): the 4 evaluation-framework rubrics the engine loads to assess a
  // business, + the 3 specialist skills an approved gap-action names (execution deferred to
  // Phase 15+). Bootstrap seeds each v1 ACTIVE; a body edit publishes a candidate the eval
  // gate must clear before it goes live (SC #4).
  { name: GROWTH_OS_DIAGNOSTIC_SKILL, body: growthOsDiagnosticSkillBody },
  { name: SWOT_SKILL, body: swotSkillBody },
  { name: LEAN_CANVAS_SKILL, body: leanCanvasSkillBody },
  { name: BMC_SKILL, body: bmcSkillBody },
  { name: OFFER_ARCHITECT_SKILL, body: offerArchitectSkillBody },
  { name: MONEY_MODEL_DESIGNER_SKILL, body: moneyModelDesignerSkillBody },
  { name: LEAD_ENGINE_SKILL, body: leadEngineSkillBody },
  // Phase 16 (DISP-02/ACTN-03). APPEND-ONLY — do not reorder or touch the rows above.
  { name: RESEARCH_SPECIALIST_SKILL, body: researchSpecialistSkillBody },
  // UNGATED (15.1-05, Q6): the three behaviour-preset style overlays (design §7). They change
  // HOW a specialist speaks, never what it may do or claim — the capability grant stays
  // code-owned (ADR-007) — so they match `business-profile`, not the gated rubrics above.
  // `dispatch.ts` reads the one the tenant's `behaviorPreset` names and prepends it to the
  // specialist's prompt, FAIL-OPEN: an unseeded overlay costs voice, never a dispatch.
  { name: STYLE_DIRECT_SKILL, body: styleDirectSkillBody },
  { name: STYLE_COACHING_SKILL, body: styleCoachingSkillBody },
  { name: STYLE_CONCISE_SKILL, body: styleConciseSkillBody },
  // UNGATED (17.1-02, BLPR-01): output is candidate fields for a vault-doc blueprint a human
  // confirms (D2), not tool-state — the `business-profile` rationale verbatim. And the golden
  // runner hard-validates --skill against a closed name list it cannot extend to the synthesis
  // path, so gating would deadlock this skill at v1 on its first body edit.
  { name: BUSINESS_BLUEPRINT_SKILL, body: businessBlueprintSkillBody },
  // UNGATED (18-03, ACTN-04): the short-form drafter (hook / length / platform voice).
  // This row is WHY Phase 18 added a new skill instead of editing `document-drafter`: a name
  // with no prior rows takes the `rows.length === 0` branch below and is inserted at v1
  // `status: "active"` — no eval cycle, no paid run. `document-drafter` IS in GATED_SKILLS, so
  // editing its body would have minted a candidate needing a passing eval first, and no golden
  // fixture reaches the drafting path to clear it. Its body stays byte-unchanged.
  { name: CONTENT_DRAFTER_SKILL, body: contentDrafterSkillBody },
  // UNGATED (20-03, MEDIA-01): the media specialist. Same deadlock as document-analyst — the
  // golden runner drives runCockpitAgent over TEXT fixtures and cannot exercise a
  // script/art-direction/storyboard turn, so gating would strand this at v1 on its first body
  // edit. The guarantees that matter are CODE: searchVault is its only grant, so it cannot
  // spend a cent; the narration band is enforced by the parser; the model comes from a price
  // table the body cannot name into.
  // There is deliberately NO assembler-script entry here, and there must never be one — the
  // ffmpeg assembler is a repo file, and a runtime-mutable shell script executed in a VM is
  // remote code execution (llmRedaction.test.ts scans for exactly that).
  { name: MEDIA_DIRECTOR_SKILL, body: mediaDirectorSkillBody },
  // UNGATED (15.3-06, VALT-08): the folder-digest synthesis body. APPEND-ONLY — this row goes
  // LAST; do not reorder or touch the rows above. Same deadlock as content-drafter: the golden
  // runner's --skill list is derived from GATED_SKILLS and it drives runCockpitAgent over TEXT
  // fixtures, and no fixture can assemble a folder manifest plus per-member excerpts, so gating
  // this would strand it at v1 on its first body edit. As a new name it takes the
  // `rows.length === 0` branch below and lands at v1 `active` — no eval cycle, no paid run.
  { name: FOLDER_DIGEST_SKILL, body: folderDigestSkillBody },
  // UNGATED (15.3-08, VALT-12): the per-document classifier body. APPEND-ONLY — a new row goes
  // at the END of this array; do not reorder or touch the rows above. Same deadlock as
  // folder-digest: the golden runner's --skill list is derived from GATED_SKILLS and it drives
  // runCockpitAgent over TEXT fixtures, and no fixture reaches vault ingest, so gating this
  // would strand it at v1 on its first body edit. As a new name it takes the
  // `rows.length === 0` branch below and lands at v1 `active` — no eval cycle, no paid run.
  // SEED BEFORE THIS SHIPS: `classifyDoc` loads it fail-closed, and on an unseeded deployment
  // every document classifies as `unclassified` (degraded label, never a failed document).
  { name: DOCUMENT_CLASSIFIER_SKILL, body: documentClassifierSkillBody },
  // GATED (29-04, KNOW-01): the two TOOLLESS knowledge calls — a query planner and a cited
  // synthesizer. APPEND-ONLY — these rows go LAST; do not reorder or touch the rows above.
  // As NEW names they take the `rows.length === 0` branch below and land at v1 `active`, so
  // bootstrap needs no eval cycle and no paid run. THE FIRST BODY EDIT IS DIFFERENT: it mints a
  // candidate the EVAL_GATE holds until a green `--skill <name>@N` run records evidence, and the
  // golden runner can only reach these calls once plan 29-06 lands the cockpit knowledge tool and
  // threads `skillVersions` into `knowledgeLlm`. Read the reachability warning on
  // KNOWLEDGE_QUERY_PLANNER_SKILL in contracts/src/skill.ts before editing either body.
  // SEED BEFORE 29-06 SHIPS: both `knowledgeLlm` actions load fail-closed (getActiveSkill throws
  // NO_ACTIVE_SKILL), so on an unseeded deployment a knowledge search errors rather than
  // synthesizing from a hardcoded fallback — which is the correct direction and is deliberate.
  { name: KNOWLEDGE_QUERY_PLANNER_SKILL, body: knowledgeQueryPlannerSkillBody },
  { name: KNOWLEDGE_SYNTHESIZER_SKILL, body: knowledgeSynthesizerSkillBody },
];

/** Every seeded skill name. Derived from `SEEDS`, never typed a second time. */
export const REGISTRY_SKILL_NAMES: readonly string[] = SEEDS.map((s) => s.name);

/**
 * Seed + PUBLISH the agent skills from the registry-bound markdown sources (via
 * the derived constants) — no agent prompt is hardcoded here. First run inserts
 * each as v1/active (bootstrap — a fresh clone must never fail closed). Re-running
 * is idempotent when a body is UNCHANGED vs the NEWEST row. An edited body
 * publishes a NEW version (maxVersion+1), never mutating a prior row
 * (immutable-per-version, CLAUDE.md §5): GATED skills publish as CANDIDATE (the
 * active row stays active; activation flows through activateSkill's EVAL_GATE
 * after a green eval run — EVAL-01), non-gated skills publish-and-activate as
 * before. Rollback stays activateSkill on a prior version.
 */
export const seedSkills = internalMutation({
  args: {},
  handler: async (ctx) => {
    for (const { name, body } of SEEDS) {
      const rows = await ctx.db
        .query("skills")
        .withIndex("by_name_status", (q) => q.eq("name", name))
        .collect();

      if (rows.length === 0) {
        await ctx.db.insert("skills", {
          name,
          version: 1,
          body,
          status: "active",
          createdAt: Date.now(),
        });
        continue;
      }

      // Idempotence vs the NEWEST row (not just the active one): covers
      // active-unchanged AND an already-published gated candidate, so repeated
      // dev boots after one edit never mint candidate N+1, N+2 (Pitfall 1).
      const newest = rows.reduce((a, b) => (b.version > a.version ? b : a));
      if (newest.body === body) continue;

      const maxVersion = Math.max(...rows.map((r) => r.version));
      if (isGatedSkill(name)) {
        // Gated: publish as CANDIDATE; the active row stays active. Activation
        // flows through activateSkill (the EVAL_GATE choke point) after a green
        // eval run — a gated edit can never auto-activate through a dev boot.
        await ctx.db.insert("skills", {
          name,
          version: maxVersion + 1,
          body,
          status: "candidate",
          createdAt: Date.now(),
        });
        continue;
      }

      // Non-gated: publish-and-activate, unchanged behavior.
      const active = rows.find((r) => r.status === "active");
      if (active) await ctx.db.patch(active._id, { status: "archived" });
      await ctx.db.insert("skills", {
        name,
        version: maxVersion + 1,
        body,
        status: "active",
        createdAt: Date.now(),
      });
    }
  },
});

/**
 * SkillOpt write-back seam (IMPR-02/03): accept an EXTERNALLY-authored (optimized)
 * skill body as a NEW CANDIDATE version through the registry gate. Mirrors seedSkills'
 * gated-candidate branch but takes the body as an arg. It NEVER sets status:"active"
 * and NEVER patches a prior row (immutable-per-version, CLAUDE.md §5) — activation
 * stays the owner's SEPARATE activateSkill click (the EVAL_GATE choke point, Plan 06
 * ops control). A non-gated name is rejected: only eval-gated skills route through the
 * gate. Idempotent vs the NEWEST row body (Pitfall 1) — a byte-identical repost mints
 * nothing. Returns { name, fromVersion (the live/active version), toVersion, inserted }
 * — the before/after the optimization audit records; `inserted` lets the caller skip a
 * duplicate audit/notify on an idempotent repost (no churn).
 */
/**
 * THE immutable-version allocation rule, defined ONCE for both registry scopes — the
 * deployment-global `skills` table and the per-tenant `tenantSkills` overlay (CLAUDE.md §8
 * root-cause): a body that byte-matches the NEWEST row in scope mints nothing, anything else
 * becomes `newest.version + 1`, and a prior row is NEVER patched.
 *
 * It takes the newest row rather than reading it, because the two scopes are indexed differently
 * and the tenant scope must NOT `.collect()` an open-ended history (research pitfall 12). The
 * shared thing is the RULE; the query stays with its scope.
 */
function allocateImmutableVersion(
  newest: { version: number } | null,
  duplicate: boolean,
): { version: number; inserted: boolean } {
  if (newest === null) return { version: 1, inserted: true };
  if (duplicate) return { version: newest.version, inserted: false };
  return { version: newest.version + 1, inserted: true };
}

export const insertCandidate = internalMutation({
  args: { name: v.string(), body: v.string() },
  handler: async (ctx, { name, body }) => {
    if (!isGatedSkill(name)) {
      throw new Error(
        `NOT_GATED: ${name} is not eval-gated — only gated skills accept an optimized candidate`,
      );
    }

    const rows = await ctx.db
      .query("skills")
      .withIndex("by_name_status", (q) => q.eq("name", name))
      .collect();

    if (rows.length === 0) {
      throw new Error(
        `${NO_ACTIVE_SKILL_ERROR}: ${name} — cannot write back a candidate for an unseeded skill`,
      );
    }

    const newest = rows.reduce((a, b) => (b.version > a.version ? b : a));
    // fromVersion pins the LIVE version (the before); degenerate no-active registries fall back to
    // the newest (== max) version.
    const fromVersion = rows.find((r) => r.status === "active")?.version ?? newest.version;

    // Idempotent vs the NEWEST row (Pitfall 1): an identical body inserts nothing. The allocation
    // itself is the SHARED rule — `rows` is never empty here (guarded above), so this is
    // byte-compatible with the hand-rolled `maxVersion + 1` it replaced.
    const { version: toVersion, inserted } = allocateImmutableVersion(newest, newest.body === body);
    if (!inserted) return { name, fromVersion, toVersion, inserted: false };

    await ctx.db.insert("skills", {
      name,
      version: toVersion,
      body,
      status: "candidate",
      createdAt: Date.now(),
    });
    return { name, fromVersion, toVersion, inserted: true };
  },
});

/**
 * One-off retirement flip: archive the single active row of a skill (no-op when
 * none is active). Used to retire the dead executive-agent.classifier live via
 * `npx convex run skills:archiveSkill '{"name":"executive-agent.classifier"}'` —
 * with its seeds entry removed above, a re-seed cannot resurrect it (Pitfall 5).
 * Status is one of the two sanctioned patchable fields; nothing else is touched.
 */
export const archiveSkill = internalMutation({
  args: { name: v.string() },
  handler: async (ctx, { name }) => {
    const active = await ctx.db
      .query("skills")
      .withIndex("by_name_status", (q) => q.eq("name", name).eq("status", "active"))
      .unique();

    if (active === null) return { archived: false };

    await ctx.db.patch(active._id, { status: "archived" });
    return { archived: true };
  },
});

// ── THE WORKFLOW-PACK LANE (Phase 27, PACK-02) ───────────────────────────────────────────────
//
// The pilot ships six curated knowledge-work packs DARK. Both existing publication branches are
// hostile to that, which is the whole reason this lane exists:
//
//   `seedSkills` (above) inserts `version: 1, status: "active"` when `rows.length === 0`,
//   REGARDLESS of gating, and `package.json`'s `dev` script runs it on every dev boot. Six pack
//   names in `SEEDS` would go live, at v1, un-evaluated, on the next boot.
//
//   `insertCandidate` (above) throws `NOT_GATED` for an ungated name and then `NO_ACTIVE_SKILL`
//   when there are zero rows. It cannot publish a first-ever candidate at all.
//
// So the pack bodies stay OUT of `SEEDS` entirely and get their own first-publication mutation
// that can only ever mint a candidate. The general `rows.length === 0` branch is UNCHANGED —
// `packages/contracts/src/skill.ts` and three `SEEDS` comments lean on it by name, and CLAUDE.md §7
// requires a fresh clone to boot.
//
// The pack names are also deliberately ABSENT from `GATED_SKILLS`: `run-eval-golden.mjs` derives
// its `--skill` allow-list from that array and drives `runCockpitAgent` over TEXT fixtures, so
// gating a name that runner cannot drive mints candidates no eval run could ever certify (the
// `document-analyst` / `media-director` deadlock). Packs carry their own, STRICTER gate below,
// satisfied by their own runner.

/** Refused when a non-pack name is pushed through the pack door. Kept short (§ literal-length scan). */
export const NOT_A_PACK_ERROR = "NOT_A_PACK";
/** Refused when a pack candidate is missing any one of its three evidence planes. */
export const PACK_GATE_ERROR = "PACK_GATE";
/** Refused when supplied provenance does not pin the version this publication is about to mint. */
export const PROVENANCE_PIN_ERROR = "PROVENANCE_PIN";

/**
 * Publish a pack body as a CANDIDATE. The only door the six pack names may enter the registry by.
 *
 * ALWAYS `status: "candidate"` — there is no branch here that can produce an active row, including
 * the first-ever publication. That is the single property this mutation exists for.
 *
 * IDEMPOTENT against the newest row's (body, provenance) pair, so re-running publication never
 * mints candidate N+1. Provenance participates in the identity deliberately: it is written at
 * INSERT and never patched, so a corrected manifest is a new immutable candidate rather than a
 * silent rewrite of what a published version claims about itself.
 *
 * `body` is an ARGUMENT, exactly as `insertCandidate` takes one: the CALLER reads the derived
 * `@pikar/contracts/skills/<name>` constant the way `SEEDS` does (CLAUDE.md §5 — never a hardcoded
 * prompt), and the provenance manifest hashes the canonical `.md`, not the derived `.ts`.
 *
 * 27-08 split the handler into `publishPack` so `seedPackCandidates` below can share it VERBATIM
 * rather than reproducing the allocation, the duplicate rule and the pin refusal in a second place.
 * The exported mutation is unchanged in behaviour and in signature.
 */
/** The newest row for a pack name, or null. Shared by the publisher and the six-pack seeder. */
async function newestPackRow(ctx: MutationCtx, name: string): Promise<Doc<"skills"> | null> {
  const rows = await ctx.db
    .query("skills")
    .withIndex("by_name_status", (q) => q.eq("name", name))
    .collect();
  return rows.length === 0 ? null : rows.reduce((a, b) => (b.version > a.version ? b : a));
}

async function publishPack(
  ctx: MutationCtx,
  name: string,
  body: string,
  provenance: string,
): Promise<{ name: string; version: number; inserted: boolean }> {
  if (!isWorkflowPackSkill(name)) {
    throw new Error(`${NOT_A_PACK_ERROR}: ${name} is not a workflow pack`);
  }

  const newest = await newestPackRow(ctx, name);

  // The SHARED allocation rule (`allocateImmutableVersion` above), not a second copy of it:
  // `newest === null` already yields v1, which is precisely the case `insertCandidate` refuses.
  const duplicate = newest !== null && newest.body === body && newest.provenance === provenance;
  const { version, inserted } = allocateImmutableVersion(newest, duplicate);
  if (!inserted) return { name, version, inserted: false };

  // REFUSE A MISPINNED MANIFEST HERE, where it is one retry, rather than at activation, where it
  // is unfixable. Provenance is written at insert and never patched, and the pack gate requires it
  // to pin EXACTLY this (name, version) — so a manifest pinning v1 stored on a v2 row produces an
  // immutable candidate that can never be activated by anyone, discovered weeks later at the gate,
  // with "publish a third version" as the only remedy. The error names the version to pin.
  if (!hasValidPackProvenance(provenance, name, version)) {
    throw new Error(
      `${PROVENANCE_PIN_ERROR}: provenance must be valid and pin ${name} v${version}`,
    );
  }

  await ctx.db.insert("skills", {
    name,
    version,
    body,
    provenance,
    status: "candidate",
    createdAt: Date.now(),
  });
  return { name, version, inserted: true };
}

export const publishPackCandidate = internalMutation({
  args: { name: v.string(), body: v.string(), provenance: v.string() },
  handler: async (ctx, { name, body, provenance }) => publishPack(ctx, name, body, provenance),
});

/**
 * The six adapted bodies, by REGISTRY NAME. Read from the derived `@pikar/contracts` constants the
 * way `SEEDS` reads every other body (CLAUDE.md §5 — never a hardcoded prompt); the canonical `.md`
 * they mirror is what `KNOWLEDGE_WORK_PROVENANCE.bodySha256` pins, and `skillBodies.test.ts` keeps
 * the pair byte-identical.
 */
const PACK_BODIES: Readonly<Record<string, string>> = {
  "pack-business-pulse": packBusinessPulseSkillBody,
  "pack-campaign-plan": packCampaignPlanSkillBody,
  "pack-customer-complaint": packCustomerComplaintSkillBody,
  "pack-sales-call-prep": packSalesCallPrepSkillBody,
  "pack-process-sop": packProcessSopSkillBody,
  "pack-brand-review": packBrandReviewSkillBody,
};

/**
 * The provenance string for EXACTLY one (name, version). A pure function of the pinned material and
 * the version — no wall clock, deliberately: `publishPack` treats `(body, provenance)` as the
 * identity of a version, so a `Date.now()` anywhere in here would make every re-run of the seeder
 * mint candidate N+1 forever. `ts` is the pinned UPSTREAM COMMIT's timestamp; when the row was
 * published is `skills.createdAt`, which the row already carries.
 */
function packProvenanceFor(name: string, version: number): string {
  const record = KNOWLEDGE_WORK_PROVENANCE[name];
  if (record === undefined) throw new Error(`${NOT_A_PACK_ERROR}: no provenance for ${name}`);
  return JSON.stringify({
    ...record,
    skillVersions: { [name]: version },
    ts: KNOWLEDGE_WORK_PINNED_AT,
  });
}

/**
 * Publish all six adapted pack bodies as CANDIDATES on this deployment (27-08 Task 2).
 *
 * IDEMPOTENT: a second run against an unchanged repo inserts nothing and returns the same six
 * versions. That works only because the version the provenance pins is resolved BEFORE publication —
 * if the newest row already carries exactly this body AND exactly the provenance this code would
 * write for its version, the re-publication is a duplicate at that same version. Predicting
 * `newest.version + 1` unconditionally would rebuild provenance pinning a version the duplicate
 * check then declines to mint, and `publishPack` would reject it as mispinned on every retry.
 *
 * There is NO branch here that can produce an active row, and none that can bypass the pack gate:
 * this is `publishPackCandidate` six times with the code-owned bodies and the code-owned provenance.
 */
export const seedPackCandidates = internalMutation({
  args: {},
  handler: async (ctx) => {
    const out: { name: string; version: number; inserted: boolean }[] = [];
    for (const name of WORKFLOW_PACK_SKILL_NAMES) {
      const body = PACK_BODIES[name];
      if (body === undefined) throw new Error(`${NOT_A_PACK_ERROR}: no body for ${name}`);
      const newest = await newestPackRow(ctx, name);
      const version =
        newest === null
          ? 1
          : newest.body === body && newest.provenance === packProvenanceFor(name, newest.version)
            ? newest.version
            : newest.version + 1;
      out.push(await publishPack(ctx, name, body, packProvenanceFor(name, version)));
    }
    return out;
  },
});

/**
 * Refs-only read-back of the six pack rows (27-08 Task 2). Two callers need it and neither may see
 * a body: the plan's own read-back evidence, and `run-workflow-pack-evals.mjs`, which must resolve
 * the EXACT candidate version to pin before it spends a cent — pinning the active row, or guessing
 * the version, is how a run certifies a body it did not execute.
 *
 * Content-free by construction (`inspectAgentCandidate`'s posture): ids, status, a body HASH, a byte
 * count and which evidence planes are present. It never returns `body`, and it returns the
 * provenance only as its already-refs-only fields, never as free text.
 */
export const inspectPackCandidates = internalQuery({
  args: {},
  handler: async (ctx) => {
    const out = [];
    for (const name of WORKFLOW_PACK_SKILL_NAMES) {
      const rows = await ctx.db
        .query("skills")
        .withIndex("by_name_status", (q) => q.eq("name", name))
        .collect();
      if (rows.length === 0) {
        out.push({ name, present: false as const });
        continue;
      }
      const newest = rows.reduce((a, b) => (b.version > a.version ? b : a));
      out.push({
        name,
        present: true as const,
        skillId: String(newest._id),
        version: newest.version,
        status: newest.status,
        versionCount: rows.length,
        bodyHash: await contentHash(newest.body),
        bodyBytes: new TextEncoder().encode(newest.body).length,
        // The three gate planes, as booleans against THIS exact version — the same questions
        // `assertPackActivationEvidence` asks, answered without exposing any payload.
        provenanceValid: hasValidPackProvenance(newest.provenance, name, newest.version),
        evidenceValid: hasPassingPackEvalEvidence(newest.evidence, name, newest.version),
        browserValid: hasPassingPackBrowserEvidence(newest.browserEvidence, name, newest.version),
      });
    }
    return out;
  },
});

/**
 * TURN A PACK OFF, from the product, as the owner (27-09).
 *
 * WHY THIS EXISTS RATHER THAN `npx convex run skills:archiveSkill`. That is the only dark path the
 * registry had, and it is an operator command — which on this stack has a measured side effect that
 * makes it unusable mid-incident and unusable mid-drill: **one `convex run` against the local
 * deployment kills the browser's saved `storageState` and the next navigation lands on `/signin`**
 * (`apps/web/e2e/README.md`, 2026-08-14). An owner watching a pack misbehave should not have to
 * choose between turning it off and staying signed in.
 *
 * SCOPE IS DELIBERATELY NARROW — packs only, `isWorkflowPackSkill`. This is not a general
 * "deactivate any skill" surface: every other gated skill has a rollback story that goes THROUGH a
 * prior version (`activateSkill`), and turning the cockpit agent dark from a browser button is a
 * different, much larger decision than turning off a pilot workflow.
 *
 * `ownerMutation`, so the check is the same trust boundary `requireOwner` enforces everywhere else
 * — not a hidden control. It patches `status` and NOTHING else: `status` is one of the two
 * sanctioned patchable fields, the body stays immutable, and the archived row keeps its provenance
 * and evidence so the decision remains auditable.
 *
 * Idempotent: no active row is `{ deactivated: false }`, not an error. An owner clicking twice
 * during an incident must not see a failure.
 */
export const deactivatePack = ownerMutation({
  args: { name: v.string() },
  handler: async (ctx, { name }) => {
    if (!isWorkflowPackSkill(name)) {
      throw new Error(`${NOT_A_PACK_ERROR}: ${name} is not a workflow pack`);
    }
    const active = await ctx.db
      .query("skills")
      .withIndex("by_name_status", (q) => q.eq("name", name).eq("status", "active"))
      .unique();
    if (active === null) return { name, deactivated: false, version: null };

    await ctx.db.patch(active._id, { status: "archived" });
    return { name, deactivated: true, version: active.version };
  },
});

/**
 * Record a passing browser gate on the exact (name, version) row (27-09). The second evidence
 * plane, written the way `recordEvalEvidence` writes the first — `browserEvidence` is a patchable
 * field because it is recorded ABOUT a row after the fact, unlike `provenance`, which is part of
 * what the version IS. Payload is refs/counts-only JSON (CLAUDE.md §4).
 */
export const recordPackBrowserEvidence = internalMutation({
  args: { name: v.string(), version: v.number(), browserEvidence: v.string() },
  handler: async (ctx, { name, version, browserEvidence }) => {
    if (!isWorkflowPackSkill(name)) {
      throw new Error(`${NOT_A_PACK_ERROR}: ${name} is not a workflow pack`);
    }
    const row = await ctx.db
      .query("skills")
      .withIndex("by_name_version", (q) => q.eq("name", name).eq("version", version))
      .unique();
    if (row === null) throw new Error(`${NO_SUCH_SKILL_VERSION_ERROR}: ${name} v${version}`);
    await ctx.db.patch(row._id, { browserEvidence });
  },
});

/**
 * The TENANT twin of the above, and the third of the three producers the tenant pack lane needed.
 *
 * WHY IT TAKES A ROW ID AND NOT `(name, version)`. At global scope a name and a version identify a
 * body. At tenant scope they do not: two tenants can each own version 2 of `pack-business-pulse`,
 * so writing by name would let a browser run against one tenant's candidate land on another's row.
 * The row id is the only identity here, which is the same reason `WorkflowPin` carries it and the
 * same reason `hasPassingTenantPackBrowserEvidence` pins it.
 *
 * IT REFUSES TO WRITE EVIDENCE THAT COULD NOT CERTIFY THE ROW IT IS BEING WRITTEN TO. The predicate
 * that the gate will later apply is applied HERE too, against this row's own id/name/version — so a
 * spec that records an artifact naming a different candidate fails at the write instead of leaving
 * a row that looks evidenced and refuses at activation for reasons nobody can see from the outside.
 * Fail at the door, not three steps later.
 */
export const recordTenantPackBrowserEvidence = internalMutation({
  args: { candidateId: v.id("tenantSkills"), browserEvidence: v.string() },
  handler: async (ctx, { candidateId, browserEvidence }) => {
    const row = await ctx.db.get(candidateId);
    if (row === null)
      throw new Error(`${NO_SUCH_SKILL_VERSION_ERROR}: tenantSkills ${candidateId}`);
    if (!isWorkflowPackSkill(row.name)) {
      throw new Error(`${NOT_A_PACK_ERROR}: ${row.name} is not a workflow pack`);
    }
    if (
      !hasPassingTenantPackBrowserEvidence(browserEvidence, {
        candidateId: String(candidateId),
        name: row.name,
        version: row.version,
      })
    ) {
      throw new Error(
        `browser evidence does not name this row: expected a passing, authenticated, multi-viewport artifact pinned to ${String(candidateId)} (${row.name} v${row.version})`,
      );
    }
    await ctx.db.patch(candidateId, { browserEvidence });
  },
});

/**
 * THE PACK GATE. Three independent planes must all name EXACTLY this (name, version):
 *
 *   provenance      the body is the reviewed adaptation of a pinned upstream source (27-01/27-08)
 *   evidence        the PACK eval runner scored it against this pack's exact current fixture file
 *                   (27-08) — `hasPassingPackEvalEvidence`, which is `hasPassingEvidence` plus the
 *                   runner identity, the suite pin and a full-coverage requirement
 *   browserEvidence an authenticated person reached it at more than one viewport (27-09)
 *
 * Called from `planGlobalActivation` ONLY for a `candidate` row, so the rollback exemption is
 * inherited unchanged: `archived` / `rolled_back` were active before and stay exempt BY STATUS.
 * Rollback must work mid-incident and must never be blocked by a broken eval or browser harness.
 */
function assertPackActivationEvidence(target: Doc<"skills">, name: string, version: number): void {
  const missing = [
    hasValidPackProvenance(target.provenance, name, version) ? null : "provenance",
    // The PACK predicate, not the global one: a global-scope evidence blob carries no suite
    // identity, so `hasPassingEvidence` alone would honour a row written by `run-eval-golden.mjs`
    // or by a pack run against a corpus that has since been rewritten.
    hasPassingPackEvalEvidence(target.evidence, name, version) ? null : "eval",
    hasPassingPackBrowserEvidence(target.browserEvidence, name, version) ? null : "browser",
  ].filter((plane): plane is string => plane !== null);

  if (missing.length > 0) {
    throw new Error(`${PACK_GATE_ERROR}: ${name} v${version} lacks ${missing.join(", ")} evidence`);
  }
}

// ── THE TENANT OVERLAY (Phase 21, SKILL-01) ──────────────────────────────────────────────────
//
// `tenantSkills` is an OVERLAY over the deployment-global registry above, never a second prompt
// system: runtime resolves the tenant's active row first and falls back to the global active row.
// The global `skills` reads, indexes and semantics above are byte-unchanged.
//
// What a USER may do here is exactly one thing: mint an immutable `candidate` carrying their own
// bounded adaptation. Evaluation (21-03) and activation (21-04) are separate, owner-gated, and NOT
// implemented — publishing costs $0 and cannot change what any model runs.

/**
 * The body that is effective for one tenant, plus WHICH registry it came from. The scope is a
 * discriminant, not a label: it decides which lineage id field a derived row may populate, and it
 * is what lets 21-03 attribute an exact runtime use.
 */
export type EffectiveSkill =
  | { scope: "global"; body: string; version: number; skillId: Id<"skills"> }
  | { scope: "tenant"; body: string; version: number; skillId: Id<"tenantSkills"> };

/**
 * Resolve the body one tenant actually runs: the tenant's single active overlay row, else the
 * existing global active row, else FAIL CLOSED. A `candidate` row is invisible here by
 * construction (the index pins `status: "active"`), which is what makes publishing a no-op at
 * runtime.
 *
 * The global branch delegates to `loadSkill` rather than re-querying `by_name_status`: a second
 * copy of that read is a second place for the fail-closed contract to drift.
 */
export async function loadEffectiveSkill(
  ctx: QueryCtx,
  tenantId: string,
  name: string,
): Promise<EffectiveSkill> {
  const overlay = await ctx.db
    .query("tenantSkills")
    .withIndex("by_tenant_name_status", (q) =>
      q.eq("tenantId", tenantId).eq("name", name).eq("status", "active"),
    )
    .unique();

  if (overlay !== null)
    return { scope: "tenant", body: overlay.body, version: overlay.version, skillId: overlay._id };

  const global = await loadSkill(ctx, name);
  // `LoadedSkill.skillId` is a plain string: the pure contract in @pikar/contracts cannot name a
  // Convex table. It is `skills._id` at every call site of `loadSkill`.
  return {
    scope: "global",
    body: global.body,
    version: global.version,
    skillId: global.skillId as Id<"skills">,
  };
}

/**
 * internalQuery wrapper over loadEffectiveSkill, for `"use node"` actions (which have no ctx.db).
 * `tenantId` is supplied by TRUSTED server code — `runSpecialistTurn` already receives it from the
 * dispatcher's authenticated envelope. No model-supplied tenant reaches this.
 */
export const getEffectiveSkill = internalQuery({
  args: { tenantId: v.string(), name: v.string() },
  handler: (ctx, { tenantId, name }) => loadEffectiveSkill(ctx, tenantId, name),
});

/**
 * The cross-field lineage invariant, made STRUCTURAL: exactly one of `basedOnGlobalSkillId` /
 * `basedOnTenantSkillId` is populated, keyed off the base's own scope discriminant. Built in one
 * place so no call site can write a row whose scope and lineage id disagree.
 */
function lineageOf(base: EffectiveSkill) {
  return base.scope === "tenant"
    ? { basedOnScope: "tenant" as const, basedOnTenantSkillId: base.skillId }
    : { basedOnScope: "global" as const, basedOnGlobalSkillId: base.skillId };
}

/**
 * The READ half of a tenant publish, shared by the user writer (21-02) and the agent writer
 * (23-02). Extracted so the two cannot drift on the three rules that actually matter: compose
 * against the GLOBAL core (never the tenant's own active body — that would append the previous
 * draft to the new one on every re-edit, forever), record lineage against the tenant's EFFECTIVE
 * row, and read the version history with ONE descending indexed `take(1)` rather than a
 * `.collect()` of an open-ended history (research pitfall 12).
 *
 * Throws before returning on a blank / over-cap adaptation, so no caller can reach an insert with
 * an unvalidated body.
 */
async function readTenantPublishState(
  ctx: MutationCtx,
  tenantId: string,
  name: string,
  authoredBody: string,
) {
  const core = await loadSkill(ctx, name); // fails closed on an unseeded skill
  const base = await loadEffectiveSkill(ctx, tenantId, name);
  // Blank / over-cap THROWS here, before any write: the composer never returns a partial body.
  const body = composeUserSkillBody(core.body, authoredBody);
  // ONE descending indexed read serving BOTH next-version allocation and idempotence.
  const newestRows = await ctx.db
    .query("tenantSkills")
    .withIndex("by_tenant_name_version", (q) => q.eq("tenantId", tenantId).eq("name", name))
    .order("desc")
    .take(1);
  return { core, base, body, authored: authoredBody.trim(), newest: newestRows[0] ?? null };
}

/**
 * The first-customization rollback baseline (research pitfall 8): a server-owned byte copy of what
 * was effective, archived and rollback-eligible, so a later activation has something
 * evidence-exempt to fall back to. Returns whichever row the version allocator should treat as
 * prior — the existing newest row, or the baseline just written.
 *
 * Author is `system`, NOT the publisher: the baseline is the code's copy of the code's own core,
 * and attributing it to a user or to the agent would put an authorship claim on bytes neither of
 * them wrote.
 */
async function ensureRollbackBaseline(
  ctx: MutationCtx,
  tenantId: string,
  name: string,
  core: LoadedSkill,
  base: EffectiveSkill,
  newest: Doc<"tenantSkills"> | null,
): Promise<{ version: number }> {
  if (newest !== null) return newest;
  const baseline = allocateImmutableVersion(null, false);
  await ctx.db.insert("tenantSkills", {
    tenantId,
    name,
    version: baseline.version,
    // The tenant's frozen copy of the code-owned core — the evidence-exempt rollback target.
    body: core.body,
    authoredBody: "",
    status: "archived",
    author: "system",
    basedOnName: name,
    basedOnVersion: base.version,
    ...lineageOf(base),
    rollbackEligible: true,
    createdAt: Date.now(),
  });
  return baseline;
}

/**
 * Publish a user's business adaptation as an immutable tenant CANDIDATE (SKILL-01).
 *
 * The args are the whole authorization story: `name` and `authoredBody`, nothing else. Tenant,
 * author, authorUserId, status, version, evidence, rollback eligibility, the base body and the
 * composed body are ALL derived server-side, so there is no field a caller could set to promote
 * their own row, claim another tenant's, or forge provenance. Convex's arg validator rejects an
 * extra key outright, which is why the refusal is at the boundary rather than in a check.
 *
 * On a tenant's FIRST customization this writes TWO rows in one transaction: a server-owned
 * `system`/`archived`/`rollbackEligible` baseline that is a byte copy of what was effective, then
 * the user candidate. Without that baseline the first activation would have nothing
 * evidence-exempt to roll back to (research pitfall 8).
 *
 * Idempotent against the newest candidate's authored bytes AND its base lineage: re-publishing the
 * same adaptation against the same base mints no version and writes no second audit event.
 *
 * TWO DIFFERENT BASES, deliberately — collapsing them re-opens research pitfall 5:
 *  - the COMPOSITION core is the global active body. It is code-owned, and it is the only body in
 *    the system that provably carries no tenant adaptation, because nothing in this module can
 *    write an adaptation into the `skills` table. Composing against the tenant's ACTIVE body
 *    instead would append the previous draft to the new one on every re-edit, forever (a defect
 *    this plan's own test caught before the code shipped).
 *  - the LINEAGE base is the tenant's effective row — the row this candidate supersedes. It is
 *    what 21-03 pins evidence to and what 21-04 archives on activation.
 *  A candidate based on a tenant row therefore records the SUPERSEDED tenant version, not the core
 *  version. 21-03 must read the core from the global active row at eval time rather than inferring
 *  it from `basedOnVersion`.
 */
export const publishUserCandidate = tenantMutation({
  args: { name: v.string(), authoredBody: v.string() },
  handler: async (ctx, { name, authoredBody }) => {
    // The closed v0 product set — deliberately NARROWER than GATED_SKILLS. Refused before any read.
    // A WORKFLOW PACK NAME IS REFUSED HERE, and 29-05 did not change that: packs are customized
    // through `publishPackCustomization`'s closed FORM, which renders the body server-side. Widening
    // this list to admit them would have handed pack customization the wider capability (arbitrary
    // prose in a pack body) that the form exists to withhold.
    if (!isUserAuthorableSkill(name)) throw new Error(`NOT_USER_AUTHORABLE: ${name}`);

    const state = await readTenantPublishState(ctx, ctx.tenantId, name, authoredBody);
    return insertTenantUserCandidate(ctx, {
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      name,
      state,
    });
  },
});

/** WHICH approved pack template produced a candidate, and the fingerprint of the exact form values.
 *  Every field is SERVER-DERIVED (29-05) — the closed template id off `resolveWorkflowPack`, the
 *  live registry version, the validated values, and the hash of the canonical lineage string. */
type PackTemplateLineage = {
  templateId: string;
  templateVersion: number;
  customizationValues: string;
  customizationHash: string;
  fieldCount: number;
};

/**
 * THE ONE TENANT CANDIDATE WRITER (21-02, extended by 29-05). Both authoring channels — Phase 21's
 * free-text adaptation and Phase 29's closed pack form — land here, so candidate-only status,
 * authenticated provenance, the rollback baseline, immutable version allocation, idempotence and
 * the refs-only audit row cannot be true on one path and absent on the other.
 *
 * `authoredBody` reaches this function ALREADY COMPOSED by `readTenantPublishState`. It is bytes the
 * caller chose, and the pack channel's whole safety story is that its caller rendered them from a
 * closed schema rather than accepting them from a client.
 */
async function insertTenantUserCandidate(
  ctx: MutationCtx,
  args: {
    tenantId: string;
    userId: Id<"users">;
    name: string;
    state: Awaited<ReturnType<typeof readTenantPublishState>>;
    template?: PackTemplateLineage;
  },
): Promise<{
  name: string;
  version: number;
  status: "candidate";
  inserted: boolean;
  tenantSkillId: Id<"tenantSkills">;
}> {
  const { tenantId, userId, name, template } = args;
  const { core, base, body, authored, newest } = args.state;
  // Idempotence compares the TRIMMED stored text and the exact base lineage — the same
  // adaptation against a NEW base is a real new candidate, not a repost. It also compares the
  // TEMPLATE lineage: identical form values rendered against a REPUBLISHED pack template produce
  // identical bytes but are a different candidate, because the base body they adapt has moved.
  // Both comparands are `undefined` on the free-text path, so that path's rule is unchanged.
  const duplicate =
    newest !== null &&
    newest.status === "candidate" &&
    newest.author === "user" &&
    newest.authoredBody === authored &&
    newest.basedOnScope === base.scope &&
    newest.basedOnVersion === base.version &&
    newest.templateId === template?.templateId &&
    newest.templateVersion === template?.templateVersion;

  const prior = await ensureRollbackBaseline(ctx, tenantId, name, core, base, newest);

  const { version, inserted } = allocateImmutableVersion(prior, duplicate);
  // `duplicate` already implies `newest !== null`; the re-test is what narrows it for the
  // compiler without a non-null assertion.
  if (!inserted && newest !== null)
    return {
      name,
      version,
      status: "candidate" as const,
      inserted: false,
      tenantSkillId: newest._id,
    };

  const tenantSkillId = await ctx.db.insert("tenantSkills", {
    tenantId,
    name,
    version,
    body,
    authoredBody: authored,
    // A LITERAL, not a variable and not an argument — neither channel can choose the status it
    // publishes at. The module-wide guarantee is one level up: `skills.test.ts` counts exactly one
    // `status: "active"` patch in this file and pins it inside `transitionSkillActivation`.
    status: "candidate",
    author: "user",
    // Provenance from the AUTHENTICATED context, never from an argument.
    authorUserId: userId,
    basedOnName: name,
    basedOnVersion: base.version,
    ...lineageOf(base),
    // 29-05: the template half of the lineage. Absent on the free-text path.
    ...(template === undefined
      ? {}
      : {
          templateId: template.templateId,
          templateVersion: template.templateVersion,
          customizationValues: template.customizationValues,
          customizationHash: template.customizationHash,
        }),
    // Code-owned: a candidate that was never active has nothing to roll back to.
    rollbackEligible: false,
    createdAt: Date.now(),
  });

  // CLAUDE.md §4: refs, hashes, ids and counts ONLY. The adaptation, the composed body and the
  // submitted form VALUES are content-plane data and never reach this payload — `skills.test.ts`
  // pins the key set by EQUALITY on both channels and needle-scans audit + deadLetters, so adding
  // a body, a label or a field value fails on purpose. `templateId` is a closed code-owned id, and
  // `customizedFieldCount` is a count of declared keys, never their names.
  await ctx.runMutation(internal.audit.log, {
    tenantId,
    correlationId: String(tenantSkillId),
    eventType: "skill.user_candidate_published",
    actor: "user",
    payload: {
      skillName: name,
      tenantSkillId: String(tenantSkillId),
      version,
      baseScope: base.scope,
      baseSkillId: String(base.skillId),
      baseVersion: base.version,
      author: "user",
      bodyHash: await contentHash(body),
      authoredBytes: new TextEncoder().encode(authored).length,
      ...(template === undefined
        ? {}
        : {
            templateId: template.templateId,
            templateVersion: template.templateVersion,
            customizationHash: template.customizationHash,
            customizedFieldCount: template.fieldCount,
          }),
    },
  });

  return { name, version, status: "candidate" as const, inserted: true, tenantSkillId };
}

/** The refusals of the pack-customization channel. Every one of them is a USER MISTAKE, not a bug,
 *  so it comes back as DATA (the `PackRunResult` posture, one lane over) and carries no user text:
 *  the caller already knows what it sent, and an error string is the one place stray content
 *  reaches a log. `errors` echoes the caller's own submitted keys back to the caller alone. */
export type PackCustomizationResult =
  | {
      ok: true;
      name: string;
      version: number;
      status: "candidate";
      inserted: boolean;
      tenantSkillId: Id<"tenantSkills">;
      customizationHash: string;
    }
  | { ok: false; reason: "unknown_template" }
  | { ok: false; reason: "template_not_active" }
  | { ok: false; reason: "stale_template_version"; approvedVersion: number }
  | { ok: false; reason: "stale_base_version"; currentBaseVersion: number | null }
  | { ok: false; reason: "empty_customization" }
  | { ok: false; reason: "invalid_values"; errors: readonly CustomizationError[] };

/**
 * Publish a tenant's WORKFLOW PACK customization as an immutable candidate (29-05, ROUT-01).
 *
 * THE ARGUMENT LIST IS THE WHOLE AUTHORIZATION STORY, and it is deliberately narrower than
 * `publishUserCandidate`'s: four fields, and no field named `authoredBody`, `body`, `tools` or
 * `name`. Convex's arg validator rejects an extra key outright, so those are refused at the boundary
 * rather than by a check.
 *
 * PROSE DOES REACH THE BODY, and pretending otherwise is the failure mode this sentence exists to
 * prevent. `business_terms` (400 bytes) and `extra_guidance` (1200 bytes) are declared free-text
 * fields, and their trimmed content is rendered verbatim into `tenantSkills.body` under the
 * adaptation marker. The defensible property is narrower and different: the prose is BOUNDED (1600
 * bytes across the two, against the free-text door's 4000) and CONTENT-SCANNED
 * (`FORBIDDEN_VALUE_PATTERNS`), and it arrives under a key the schema declared rather than in a
 * caller-chosen shape. A pack candidate still needs prompt-content review; what a tenant cannot do
 * is choose the field, the size or the position.
 *
 * THE REGISTRY NAME IS DERIVED, NOT SUPPLIED. `customizationSchemaFor` resolves `templateId` through
 * `resolveWorkflowPack`'s closed six-id registry (which uses `Object.hasOwn`, so `__proto__` and
 * `constructor` are refused rather than resolved), and the name is `pack-<resolved id>`. That is a
 * stronger property than an allow-list check: there is no string a caller can send that produces a
 * registry name outside `WORKFLOW_PACK_SKILL_NAMES`. `skills.test.ts` pins that set as literals and
 * proves the pack names are in NEITHER `USER_AUTHORABLE_SKILLS` nor `AGENT_AUTHORABLE_SKILLS`.
 *
 * SIX REFUSALS, in this order, and the order is what makes the first two meaningful. ALL SIX come
 * back as DATA (`{ok:false, reason}`), never as a throw — a governed refusal is a form the UI can
 * render, and a 500 is not:
 *  1. UNKNOWN TEMPLATE — before any read.
 *  2. INVALID VALUES — layer 1 refuses an undeclared KEY before its value is looked at, then layer 2
 *     content-scans the declared free-text fields (`validateCustomization`, @pikar/core).
 *  3. EMPTY FORM — an empty adaptation is not a customization; `composeUserSkillBody` would throw.
 *  4. TEMPLATE NOT ACTIVE — and this one is ORDINARY, not exotic: `seedPackCandidates` writes all
 *     six pack rows as `candidate`, and each becomes active only once the owner clears the
 *     three-plane pack gate for it. Checked HERE, before `readTenantPublishState`, because that
 *     helper reaches `loadSkill`, which throws `NO_ACTIVE_SKILL` — so on any deployment where a
 *     pack is seeded but not yet activated, the tenant's customization form would 500 rather than
 *     say "not available yet". One extra indexed read on a path that is about to do several.
 *  5. STALE TEMPLATE VERSION — the form must have been rendered against the pack body that is LIVE.
 *     A form built against an older template may no longer mean what the live body says it means.
 *  6. STALE BASE VERSION — optimistic concurrency against the tenant's newest row. No merge: two
 *     people editing one workflow's thresholds cannot both be satisfied, and silent last-write-wins
 *     is the version of that failure nobody notices.
 *
 * NOTHING HERE ACTIVATES, AND ACTIVATION IS REFUSED DOWNSTREAM. `planTenantActivation` throws
 * `PACK_GATE` for any name `isWorkflowPackSkill` accepts — membership in `WORKFLOW_PACK_SKILL_NAMES`,
 * not a `pack-` prefix — ahead of its mode switch, because the tenant overlay has no `provenance`
 * and no `browserEvidence` column to satisfy the three-plane pack gate with. `skills.test.ts` ("a
 * pack-named TENANT candidate with Phase-21 evidence is still REFUSED") drives that with evidence
 * that would otherwise have passed, and asserts `loadEffectiveSkill` still serves the global body.
 *
 * A ROW MINTED HERE IS STILL RUNNABLE, AND AN EARLIER VERSION OF THIS COMMENT DENIED IT. The
 * `tenantSkillIds` rail pins a `tenantSkills` row BY ID into `runSpecialistTurn`, and a `pack-*` row
 * resolves through it like any other — `workflowPackBinding.test.ts` ("the pinned CANDIDATE body
 * runs, not the tenant's effective one") runs one and reads the candidate's version back. What
 * governs that door: the pin is declared only on `internalAction`s; `runPackTurn` compares
 * `row.tenantId` to the run's tenant before `preCall`; `runSpecialistTurn` refuses a row whose
 * `name` is not the skill being run; the tool grant comes from `toolsForWorkflowPack`, so the pinned
 * body has no vote on it; and the run patches no status. `cockpit.ts`, the only production caller of
 * `runWorkflowPack`, passes `skillVersions` (a global preview pin) and no `tenantSkillIds` — so what
 * a tenant publishes here is inert until some caller pins it. Recorded in the playbook, not closed.
 *
 * This mutation never touches the ADR-003 global `skills` table.
 */
export const publishPackCustomization = tenantMutation({
  args: {
    /** A closed Phase 27 pack id (`business-pulse`, …), NOT a registry name. `v.string()` because
     *  `resolveWorkflowPack` is the fail-closed door and its refusal must be reachable to be
     *  testable — the `packArgs` precedent in `workflowPackBinding.ts`. */
    templateId: v.string(),
    /** The approved template version the form was rendered against. */
    templateVersion: v.number(),
    /** The tenant's newest candidate version this edit is based on; `null` means "I believe this
     *  pack has never been customized here". */
    baseCandidateVersion: v.union(v.number(), v.null()),
    /** The submitted form. Every value is a string, a number or a string list; there is no nested
     *  object and no boolean, so a tool grant or an MCP block has no shape to arrive in even before
     *  the closed key set refuses its name. */
    values: v.record(v.string(), v.union(v.string(), v.number(), v.array(v.string()))),
  },
  handler: async (
    ctx,
    { templateId, templateVersion, baseCandidateVersion, values },
  ): Promise<PackCustomizationResult> => {
    const resolved = customizationSchemaFor(templateId, templateVersion);
    if (!resolved.ok) return { ok: false, reason: "unknown_template" };
    const customizationSchema = resolved.value;
    const name = `pack-${customizationSchema.templateId}`;

    const checked = validateCustomization(customizationSchema, values);
    if (!checked.ok) return { ok: false, reason: "invalid_values", errors: checked.error };
    const accepted = checked.value;

    // Rendered from the SCHEMA's field order, never the submitted object's key order, so two UIs
    // produce byte-identical bodies and the lineage hash means something.
    const authoredBody = renderCustomization(customizationSchema, accepted);
    if (authoredBody.trim() === "") return { ok: false, reason: "empty_customization" };

    // Refusal 4. The same read `loadSkill` is about to do, asked as a QUESTION rather than as an
    // assertion — a seeded-but-not-yet-activated pack is a normal deployment state, not a bug, and
    // the tenant-facing form must get a reason back instead of a 500.
    const active = await ctx.db
      .query("skills")
      .withIndex("by_name_status", (q) => q.eq("name", name).eq("status", "active"))
      .unique();
    if (active === null) return { ok: false, reason: "template_not_active" };

    const state = await readTenantPublishState(ctx, ctx.tenantId, name, authoredBody);

    // The approved template IS the global active pack row. A form rendered against any other
    // version is refused rather than composed onto a body it was not designed for.
    if (state.core.version !== templateVersion) {
      return { ok: false, reason: "stale_template_version", approvedVersion: state.core.version };
    }

    const currentBaseVersion = state.newest?.version ?? null;
    if (!checkBaseVersion(baseCandidateVersion, currentBaseVersion).ok) {
      return { ok: false, reason: "stale_base_version", currentBaseVersion };
    }

    // ONE hash implementation: the pure package returns the canonical STRING, `lib/hash.ts` hashes
    // it. @pikar/core has no crypto dependency and must not grow a weaker digest of its own.
    const customizationHash = await contentHash(
      canonicalCustomization(customizationSchema, accepted),
    );
    const res = await insertTenantUserCandidate(ctx, {
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      name,
      state,
      template: {
        templateId: customizationSchema.templateId,
        templateVersion,
        // CONTENT PLANE, like `savedPrompts.text`: the tenant's own words, stored on their own row
        // so the form can be reopened. It never reaches an audit payload (CLAUDE.md §4).
        customizationValues: JSON.stringify(accepted),
        customizationHash,
        fieldCount: Object.keys(accepted).length,
      },
    });
    return { ok: true, ...res, customizationHash };
  },
});

/**
 * Mint an Executive-Agent-authored tenant CANDIDATE (SKILL-02). INTERNAL, and that is the whole
 * safety story: there is no public API, no tenant wrapper and no HTTP route reaching this. The
 * later cockpit tool (23-03) calls it from a trusted action context.
 *
 * WHAT THE MODEL SUPPLIES: `name` and `authoredBody`. Nothing else, ever. `tenantId`,
 * `sourceThreadId` and `sourceTurnId` come from the trusted turn envelope the runtime already
 * holds — they are server args here because an internal mutation has no `ctx.tenantId`, NOT because
 * a caller may choose them. `author`, `authorAgentId`, `status`, `version`, `body`,
 * `rollbackEligible`, evidence and approval are all derived or hardcoded, so this validator has no
 * field a model could set to promote its own row or forge provenance.
 *
 * THERE IS NO CODE PATH FROM THIS MUTATION TO AN ACTIVATION FUNCTION. It inserts `candidate` and
 * returns; `skills.test.ts` scans this region to keep it that way.
 *
 * TWO REFUSALS, in this order, and the order is the contract:
 *  1. EXACT RETRY is resolved FIRST, off `by_tenant_source_turn`. One source turn may own at most
 *     one row, so a re-fired turn recovers its row instead of minting a second immutable version.
 *     Same turn + different draft is a CONFLICT, not an update: patching would mutate an immutable
 *     row, and inserting would give one turn two.
 *  2. THE v1 PENDING RULE. A changed draft while ANY candidate is pending for this tenant/name is
 *     refused outright — including a candidate the USER authored. It is never archived, never
 *     superseded, and zero rows change. Superseding a never-active candidate would silently discard
 *     something a human may be about to review, and archiving it would hand a rollback-ineligible
 *     row a state it never earned.
 *
 * Idempotence is the SOURCE TURN, never the bytes. Two different turns that produce identical text
 * are two different authoring acts, and collapsing them would return a row whose `sourceTurnId`
 * names a turn that did not ask for it — exactly the provenance the live handoff artifacts pin. So
 * the version allocator is called with `duplicate: false` deliberately.
 */
export const publishAgentCandidate = internalMutation({
  args: {
    tenantId: v.string(),
    sourceThreadId: v.string(),
    sourceTurnId: v.string(),
    name: v.string(),
    authoredBody: v.string(),
  },
  handler: async (ctx, { tenantId, sourceThreadId, sourceTurnId, name, authoredBody }) => {
    // The closed agent set — allowed to be narrower than the user set, and eval-reachable by
    // construction. Refused before any read.
    if (!isAgentAuthorableSkill(name)) throw new Error(`NOT_AGENT_AUTHORABLE: ${name}`);

    const authored = authoredBody.trim();

    // (1) Exact retry.
    const forTurn = await ctx.db
      .query("tenantSkills")
      .withIndex("by_tenant_source_turn", (q) =>
        q
          .eq("tenantId", tenantId)
          .eq("sourceThreadId", sourceThreadId)
          .eq("sourceTurnId", sourceTurnId),
      )
      .take(1);
    const ownedByTurn = forTurn[0] ?? null;
    if (ownedByTurn !== null) {
      if (ownedByTurn.name !== name || ownedByTurn.authoredBody !== authored)
        throw new Error(`AGENT_SOURCE_TURN_CONFLICT: ${sourceTurnId}`);
      return {
        name: ownedByTurn.name,
        version: ownedByTurn.version,
        // The row's REAL status, not the literal "candidate": a retry fired after an owner already
        // activated the row must not report it as still pending.
        status: ownedByTurn.status,
        inserted: false,
        tenantSkillId: ownedByTurn._id,
      };
    }

    // (2) The pending rule. Indexed, bounded, and read before any write.
    const pending = await ctx.db
      .query("tenantSkills")
      .withIndex("by_tenant_name_status", (q) =>
        q.eq("tenantId", tenantId).eq("name", name).eq("status", "candidate"),
      )
      .take(1);
    if (pending.length > 0) throw new Error(`AGENT_CANDIDATE_PENDING: ${name}`);

    const { core, base, body, newest } = await readTenantPublishState(
      ctx,
      tenantId,
      name,
      authoredBody,
    );
    const prior = await ensureRollbackBaseline(ctx, tenantId, name, core, base, newest);
    const { version } = allocateImmutableVersion(prior, false);

    const tenantSkillId = await ctx.db.insert("tenantSkills", {
      tenantId,
      name,
      version,
      body,
      authoredBody: authored,
      // CANDIDATE, always.
      status: "candidate",
      author: "agent",
      // Hardcoded server-side. Not an argument, not a model id.
      authorAgentId: EXECUTIVE_AGENT_AUTHOR_ID,
      sourceThreadId,
      sourceTurnId,
      basedOnName: name,
      basedOnVersion: base.version,
      ...lineageOf(base),
      // A candidate that was never active has nothing to roll back to.
      rollbackEligible: false,
      createdAt: Date.now(),
    });

    // CLAUDE.md §4: refs, hashes, ids and counts ONLY. The adaptation and the composed body never
    // reach this payload; `skills.test.ts` pins the key set by EQUALITY and needle-scans audit +
    // deadLetters, so adding a body field fails on purpose.
    await ctx.runMutation(internal.audit.log, {
      tenantId,
      correlationId: String(tenantSkillId),
      eventType: "skill.agent_candidate_published",
      actor: "agent",
      payload: {
        skillName: name,
        tenantSkillId: String(tenantSkillId),
        version,
        baseScope: base.scope,
        baseSkillId: String(base.skillId),
        baseVersion: base.version,
        author: "agent",
        authorAgentId: EXECUTIVE_AGENT_AUTHOR_ID,
        sourceThreadId,
        sourceTurnId,
        bodyHash: await contentHash(body),
        authoredBytes: new TextEncoder().encode(authored).length,
      },
    });

    return { name, version, status: "candidate" as const, inserted: true, tenantSkillId };
  },
});

/**
 * Refs-only inspection of ONE tenant skill row, for the live handoff/UAT artifacts (23-06 … 23-08)
 * which must pin exact state without ever transcribing a prompt into a planning file.
 *
 * INTERNAL and content-free by construction: it returns ids, status, provenance, a body HASH and a
 * byte COUNT. It never returns `body` or `authoredBody` — the base and composed registry prompts
 * are an owner-only disclosure boundary (research pitfall 4), and an artifact that quoted one would
 * put a live prompt in git.
 */
export const inspectAgentCandidate = internalQuery({
  args: { tenantSkillId: v.id("tenantSkills") },
  handler: async (ctx, { tenantSkillId }) => {
    const row = await ctx.db.get(tenantSkillId);
    if (row === null) return null;
    return {
      tenantSkillId: String(row._id),
      tenantId: row.tenantId,
      name: row.name,
      version: row.version,
      status: row.status,
      author: row.author,
      authorAgentId: row.authorAgentId ?? null,
      sourceThreadId: row.sourceThreadId ?? null,
      sourceTurnId: row.sourceTurnId ?? null,
      basedOnScope: row.basedOnScope,
      basedOnVersion: row.basedOnVersion,
      rollbackEligible: row.rollbackEligible,
      bodyHash: await contentHash(row.body),
      authoredBytes: new TextEncoder().encode(row.authoredBody).length,
      // Presence, never content: raw evidence carries fixture ids the authoring agent must not see.
      hasEvidence: row.evidence !== undefined,
      ownerApproval:
        row.ownerApproval === undefined
          ? null
          : {
              ownerUserId: String(row.ownerApproval.ownerUserId),
              approvedAt: row.ownerApproval.approvedAt,
              evalRunId: row.ownerApproval.evalRunId,
            },
      createdAt: row.createdAt,
    };
  },
});

/** A tenant's authoring history is open-ended; the panel only ever shows the recent end of it. */
const MY_USER_SKILLS_LIMIT = 50;

/**
 * The tenant's own user- and agent-authored adaptations and their honest states. Takes NO
 * arguments — there is no id a caller
 * could pass to reach another tenant's row.
 *
 * THE DISCLOSURE BOUNDARY: this returns the label, the user's OWN adaptation, and status/lineage
 * numbers. It never returns the base or composed body (raw registry prompts are an owner-only
 * boundary, research pitfall 4), raw evidence, an eval fixture, another tenant's id, or a row id —
 * there is no activation control for one to feed.
 */
export const myUserSkills = tenantQuery({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db
      .query("tenantSkills")
      .withIndex("by_tenant_createdAt", (q) => q.eq("tenantId", ctx.tenantId))
      .order("desc")
      .take(MY_USER_SKILLS_LIMIT);

    return rows
      .filter((r) => r.author === "user" || r.author === "agent")
      .map((r) => ({
        name: r.name,
        // Labels come from the ONE shared metadata record, so a UI never re-lists registry names.
        label: isUserAuthorableSkill(r.name)
          ? USER_AUTHORABLE_SKILL_METADATA[r.name].label
          : r.name,
        authoredBody: r.authoredBody,
        // Closed, inert provenance label. No author ids or source refs cross this tenant surface.
        author: r.author as "user" | "agent",
        version: r.version,
        status: r.status,
        baseScope: r.basedOnScope,
        baseVersion: r.basedOnVersion,
        // A BOOLEAN, not the evidence. Fails closed on an absent or mismatched pin.
        // 21-03 FIX: this asked the GLOBAL question (`skillVersions[name] === version`) of a TENANT
        // row. Tenant evidence pins the exact row id in `tenantTarget` and carries `skillVersions`
        // for the run's GLOBAL pins only — which for a tenant-only run is `{}` — so a genuinely
        // certified candidate read `false` here forever and the panel's "Evaluation passed" state
        // was unreachable for the same reason "Live" is. Now it asks the tenant question.
        gatePassed:
          r.author === "agent"
            ? hasPassingAgentTenantEvidence(r.evidence, tenantTargetOf(r))
            : hasPassingTenantEvidence(r.evidence, tenantTargetOf(r)),
        createdAt: r.createdAt,
      }));
  },
});

// ── EXACT TENANT CANDIDATE IDENTITY (Phase 21-03, SKILL-01) ──────────────────────────────────
//
// `<name>@<version>` is NOT an identity in the tenant scope: 21-02's two-tenant test deliberately
// leaves both tenants owning `offer-architect@2`. Everything below therefore names the ROW.
//
// Nothing here activates anything, and nothing here returns a body. `recordTenantEvalEvidence`
// patches ONE field.

/** The exact identity of a tenant candidate row, derived from the row itself — never from an
 *  argument, so a caller cannot describe a row as something it is not. */
const tenantTargetOf = (row: Doc<"tenantSkills">): EvalEvidenceTenantTarget => ({
  candidateId: String(row._id),
  registryTenantId: row.tenantId,
  name: row.name,
  version: row.version,
});

/**
 * The ONE exact-row read. `ctx.db.get` by id — never a name/version lookup, which is precisely the
 * ambiguity this whole seam exists to remove. Absence throws the NON-ORACLE error (no id, no tenant,
 * no name in the message).
 */
async function loadTenantCandidate(
  ctx: QueryCtx,
  candidateId: Id<"tenantSkills">,
): Promise<Doc<"tenantSkills">> {
  const row = await ctx.db.get(candidateId);
  if (row === null) throw new Error(NO_SUCH_TENANT_CANDIDATE_ERROR);
  return row;
}

/**
 * Load a tenant candidate body pinned to an EXACT ROW — the tenant twin of `getSkillVersion`, and
 * the read `runSpecialistTurn` uses when the eval runner pinned a candidate.
 *
 * Returns `status` and `author` alongside the body because the RUNNER must refuse a non-candidate /
 * non-user-authored id at $0, before the first paid turn, and it has no other read to ask with. The
 * read itself deliberately serves ANY status (an `active` row is a legitimate diagnostic target);
 * the refusal is the caller's, at the boundary where money starts.
 */
export const getTenantSkillVersion = internalQuery({
  args: { candidateId: v.id("tenantSkills") },
  handler: async (
    ctx,
    { candidateId },
  ): Promise<{
    body: string;
    version: number;
    skillId: Id<"tenantSkills">;
    name: string;
    tenantId: string;
    status: string;
    author: string;
  }> => {
    const row = await loadTenantCandidate(ctx, candidateId);
    return {
      body: row.body,
      version: row.version,
      skillId: row._id,
      name: row.name,
      tenantId: row.tenantId,
      status: row.status,
      author: row.author,
    };
  },
});

/**
 * Record eval evidence on ONE EXACT candidate row. The tenant twin of `recordEvalEvidence`, and the
 * reason it takes an id rather than `(name, version)`: two tenants can hold the same name AND the
 * same version, so a name/version write is a coin flip between certifying the row that ran and
 * certifying a stranger's draft.
 *
 * Patches `evidence` and NOTHING else — not status, not body, not name/version, not provenance.
 * Immutability is the point: this is the one field (with `status`, which 21-04 owns) that may move.
 */
export const recordTenantEvalEvidence = internalMutation({
  args: { candidateId: v.id("tenantSkills"), evidence: v.string() },
  handler: async (ctx, { candidateId, evidence }) => {
    const row = await loadTenantCandidate(ctx, candidateId);
    await ctx.db.patch(row._id, { evidence });
    // Refs only — the caller (the runner) prints this to confirm WHICH row it wrote.
    return tenantTargetOf(row);
  },
});

/** Evidence, parsed for its REFS. Returns null on absent/unparseable — the same fail-closed
 *  direction the two `hasPassing*` predicates take. */
function evidenceRefs(evidence: string | undefined): Partial<EvalEvidence> | null {
  if (evidence === undefined) return null;
  try {
    return JSON.parse(evidence) as Partial<EvalEvidence>;
  } catch {
    return null;
  }
}

/** A lineage chain is short by construction; the cap is a runaway guard, not a policy. */
const LINEAGE_MAX_HOPS = 8;

/**
 * The rollback target, resolved through the STORED LINEAGE — never "the newest archived row", which
 * is the guess that made `candidatesForReview` offer `v17 -> v16` in production (see that function).
 *
 * A candidate based on a TENANT row names the row it supersedes, so the chain is walked to the first
 * `rollbackEligible` row. A candidate based on a GLOBAL row is a tenant's FIRST customization, whose
 * baseline was written in the SAME transaction at version 1 — read by that EXACT version, so this is
 * still an identity, not a recency heuristic. Returns null when no eligible baseline exists.
 */
async function rollbackBaselineOf(
  ctx: QueryCtx,
  row: Doc<"tenantSkills">,
): Promise<Doc<"tenantSkills"> | null> {
  let cur = row;
  for (let hop = 0; hop < LINEAGE_MAX_HOPS; hop++) {
    if (cur.basedOnScope !== "tenant" || cur.basedOnTenantSkillId === undefined) break;
    const base = await ctx.db.get(cur.basedOnTenantSkillId);
    if (base === null) return null;
    if (base.rollbackEligible) return base;
    cur = base;
  }
  const first = await ctx.db
    .query("tenantSkills")
    .withIndex("by_tenant_name_version", (q) =>
      q.eq("tenantId", row.tenantId).eq("name", row.name).eq("version", 1),
    )
    .unique();
  return first?.rollbackEligible ? first : null;
}

/** One registry row, described in REFS ONLY. There is no `body` field on this type, which is how
 *  "the inspector never returns a body" survives a later edit. */
type SkillRefs = {
  scope: "global" | "tenant";
  id: string;
  name: string;
  version: number;
  bodyHash: string;
  status: string;
};

/** The rollback target carries three fields the effective/global snapshots do not: it is the row an
 *  operator would restore, so WHO wrote it and WHETHER it is eligible are the whole question. */
const baselineRefs = async (
  row: Doc<"tenantSkills">,
): Promise<SkillRefs & { tenantId: string; author: string; rollbackEligible: boolean }> => ({
  scope: "tenant",
  id: String(row._id),
  tenantId: row.tenantId,
  name: row.name,
  version: row.version,
  bodyHash: await contentHash(row.body),
  author: row.author,
  status: row.status,
  rollbackEligible: row.rollbackEligible,
});

/**
 * The refs-only state snapshot Plan 06 reads before and after the live gate, and the ONLY read that
 * answers "what is this candidate's situation" without disclosing a prompt.
 *
 * READ-ONLY: an `internalQuery` cannot write, so "it performs no write" is a property of the
 * function KIND, not of a reviewer's care. BODY-FREE: every registry row leaves here as `SkillRefs`,
 * which has no body field — the candidate's composed body, the user's authored adaptation, and the
 * global prompt (an owner-only boundary, research pitfall 4) are all absent by construction.
 *
 * `foreignTenantId` exists for ONE assertion: that another tenant's effective row is a different row
 * with a different hash. It returns that tenant's EFFECTIVE refs and `candidateIdVisible: false` —
 * there is no argument by which a foreign tenant's candidate list can be reached from here.
 */
export const inspectTenantSkill = internalQuery({
  args: { candidateId: v.id("tenantSkills"), foreignTenantId: v.optional(v.string()) },
  handler: async (ctx, { candidateId, foreignTenantId }) => {
    const row = await loadTenantCandidate(ctx, candidateId);
    const target = tenantTargetOf(row);
    const gatePassed =
      row.author === "agent"
        ? hasPassingAgentTenantEvidence(row.evidence, target)
        : hasPassingTenantEvidence(row.evidence, target);
    // `gatePassed` ABOVE IS THE EVAL PLANE AND NOTHING ELSE, which for a WORKFLOW PACK row is one
    // third of what activation asks for. Reporting only that would tell an operator a pack
    // candidate is ready while `activateTenantCandidate` still refuses it for provenance or
    // browser — the gap that made the tenant pack lane feel arbitrary from the outside.
    //
    // `null` for a non-pack row, so "not applicable" is distinguishable from "nothing missing".
    const packGateMissing = isWorkflowPackSkill(row.name)
      ? await tenantPackPlanesMissing(ctx, row)
      : null;
    const refs = evidenceRefs(row.evidence);
    const baseline = await rollbackBaselineOf(ctx, row);

    // The tenant's effective body and the global core, as refs. `loadEffectiveSkill` returns the
    // row that is ACTIVE for this tenant (else the global active row), so `status` is "active" by
    // definition of "effective" — it is stated rather than read so the shape matches SkillRefs.
    const effective = await loadEffectiveSkill(ctx, row.tenantId, row.name);
    const global = await loadSkill(ctx, row.name);

    const foreign =
      foreignTenantId === undefined
        ? null
        : await loadEffectiveSkill(ctx, foreignTenantId, row.name);

    return {
      candidate: {
        id: target.candidateId,
        tenantId: row.tenantId,
        name: row.name,
        version: row.version,
        bodyHash: await contentHash(row.body),
        author: row.author,
        authorUserId: row.authorUserId === undefined ? null : String(row.authorUserId),
        status: row.status,
        rollbackEligible: row.rollbackEligible,
        lineage: {
          basedOnScope: row.basedOnScope,
          basedOnName: row.basedOnName,
          basedOnVersion: row.basedOnVersion,
          basedOnGlobalSkillId:
            row.basedOnGlobalSkillId === undefined ? null : String(row.basedOnGlobalSkillId),
          basedOnTenantSkillId:
            row.basedOnTenantSkillId === undefined ? null : String(row.basedOnTenantSkillId),
        },
        // absent | passing | failing — an unparseable or stale row reads `failing`, never `absent`:
        // "there is evidence and it does not hold" is a different operator situation from "there is
        // none", and collapsing them hides a stale pin.
        evidenceState: row.evidence === undefined ? "absent" : gatePassed ? "passing" : "failing",
        gatePassed,
        /** Workflow packs only. `null` elsewhere; `[]` means all three planes stand. */
        packGateMissing,
        packGatePassed: packGateMissing === null ? null : packGateMissing.length === 0,
        // The identity the evidence CLAIMS, echoed verbatim so a mismatch is visible rather than
        // merely booleaned away by `gatePassed`.
        evidenceTarget: refs?.tenantTarget ?? null,
        evidenceSummary:
          refs === null
            ? null
            : {
                runId: refs.runId ?? null,
                caseCount: refs.casesTotal ?? null,
                retryCount: refs.retriedCases?.length ?? null,
                costUsd: refs.costUsd ?? null,
                model: refs.model ?? null,
              },
      },
      rollbackBaseline: baseline === null ? null : await baselineRefs(baseline),
      currentEffective: {
        scope: effective.scope,
        id: String(effective.skillId),
        name: row.name,
        version: effective.version,
        bodyHash: await contentHash(effective.body),
        status: "active",
      } satisfies SkillRefs,
      globalCurrent: {
        scope: "global",
        id: String(global.skillId),
        name: row.name,
        version: global.version,
        bodyHash: await contentHash(global.body),
        status: "active",
      } satisfies SkillRefs,
      foreignCurrent:
        foreign === null || foreignTenantId === undefined
          ? null
          : {
              tenantId: foreignTenantId,
              // There is no code path from this argument to a foreign candidate id. Stated in the
              // payload so the runner can assert the boundary rather than assume it.
              candidateIdVisible: false,
              effective: {
                scope: foreign.scope,
                id: String(foreign.skillId),
                name: row.name,
                version: foreign.version,
                bodyHash: await contentHash(foreign.body),
                status: "active",
              } satisfies SkillRefs,
            },
    };
  },
});

// ── THE OWNER BOUNDARY: tenant review, activation, rollback (Phase 21-04, SKILL-01) ───────────
//
// Evaluation answers *has this body earned activation?*. Owner authorization answers *may this
// caller change live runtime?*. They are INDEPENDENT and both are required — the four-cell truth
// table in `skills.test.ts` is the proof, and the non-owner-WITH-passing-evidence cell is the one
// that makes it about authorization rather than about evidence.
//
// Every write below goes through `transitionSkillActivation`. Nothing here patches a body, an
// authored adaptation, a name, a version, an author, a lineage field or evidence.

/** The owner's review queue is a recency window, never a deployment-wide history scan. */
const TENANT_REVIEW_LIMIT = 25;
/** How far back the per-candidate rollback choices reach. A tenant's chain is short by design. */
const ROLLBACK_CHOICE_LIMIT = 10;

/** The refs the panel shows about an eval run. Counts, ids and a model name — never a case, a
 *  fixture, a prompt or a reply. */
const evidenceSummaryOf = (evidence: string | undefined) => {
  const refs = evidenceRefs(evidence);
  return refs === null
    ? null
    : {
        runId: refs.runId ?? null,
        casesPassed: refs.casesPassed ?? null,
        casesTotal: refs.casesTotal ?? null,
        costUsd: refs.costUsd ?? null,
        model: refs.model ?? null,
      };
};

/**
 * The bounded owner review queue for USER- and AGENT-authored tenant candidates (23-05).
 *
 * OWNER-ONLY, and the refusal is the disclosure boundary: `candidateBody` and `baseBody` are raw
 * prompts and `authoredBody` is another tenant's business writing, so a non-owner must be rejected
 * BEFORE the handler reads a single row. `ownerQuery` does exactly that — the check runs in the
 * wrapper's ctx factory, ahead of the handler.
 *
 * BOUNDED: `by_status_createdAt` with a fixed `.take()`, newest first. This index is deliberately
 * cross-tenant (that is what makes one owner queue possible), so it is never `.collect()`ed — the
 * deployment's candidate history is open-ended and a full scan is a page that gets slower forever.
 *
 * Ordinary tenant APIs are unchanged: `myUserSkills` still returns no row id, no base body and no
 * raw evidence, so nothing here widens what a user can see about their own skill.
 */
export const tenantCandidatesForReview = ownerQuery({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db
      .query("tenantSkills")
      .withIndex("by_status_createdAt", (q) => q.eq("status", "candidate"))
      .order("desc")
      .take(TENANT_REVIEW_LIMIT);

    const out = [];
    for (const row of rows) {
      // Closed discriminant. A `system` baseline is never reviewable, even if a malformed fixture
      // gave it candidate status.
      if (row.author !== "user" && row.author !== "agent") continue;

      // The diff context: what this tenant runs TODAY (their active overlay, else the global core).
      const effective = await loadEffectiveSkill(ctx, row.tenantId, row.name);
      // Bounded rollback choices for this exact tenant+name. `rollbackEligible` is the only proof
      // of prior activation (see planTenantActivation) — status is not offered as a substitute.
      //
      // ELIGIBILITY IS INDEXED, NEVER FILTERED AFTER THE TAKE. This read used to walk
      // `by_tenant_name_version` desc, take ten, and *then* keep the eligible ones. Observed live
      // on 2026-08-18: the tenant held twelve versions, so the take returned v12…v3 — ten
      // CANDIDATES, none of them eligible — and the one real baseline (v1, archived, eligible) was
      // already discarded. The owner saw "No earlier version has ever been live for this tenant"
      // on a tenant that has one, and rollback is UI-only by design, so there was no other door.
      // Every candidate a user authors pushed their own recovery further out of reach.
      //
      // `+ 1` because at most one row in the eligible set can be the ACTIVE one, which is excluded
      // below — restoring the row that is already live is not a rollback.
      const priors = await ctx.db
        .query("tenantSkills")
        .withIndex("by_tenant_name_rollbackEligible", (q) =>
          q.eq("tenantId", row.tenantId).eq("name", row.name).eq("rollbackEligible", true),
        )
        .order("desc")
        .take(ROLLBACK_CHOICE_LIMIT + 1);
      const gatePassed =
        row.author === "agent"
          ? hasPassingAgentTenantEvidence(row.evidence, tenantTargetOf(row))
          : hasPassingTenantEvidence(row.evidence, tenantTargetOf(row));

      out.push({
        // The EXACT row. Every mutation below takes this and nothing derived from it.
        candidateId: row._id,
        tenantId: row.tenantId,
        author: row.author,
        authorUserId: row.authorUserId === undefined ? null : String(row.authorUserId),
        authorAgentId: row.authorAgentId ?? null,
        sourceThreadId: row.sourceThreadId ?? null,
        sourceTurnId: row.sourceTurnId ?? null,
        name: row.name,
        label: isUserAuthorableSkill(row.name)
          ? USER_AUTHORABLE_SKILL_METADATA[row.name].label
          : row.name,
        version: row.version,
        status: row.status,
        authoredBody: row.authoredBody,
        candidateBody: row.body,
        baseScope: effective.scope,
        baseVersion: effective.version,
        baseBody: effective.body,
        gatePassed,
        // absent | passing | failing — a stale or unparseable pin reads `failing`, never `absent`.
        evidenceState: row.evidence === undefined ? "absent" : gatePassed ? "passing" : "failing",
        evidenceSummary: evidenceSummaryOf(row.evidence),
        ownerApproval:
          row.ownerApproval === undefined
            ? null
            : {
                ownerUserId: String(row.ownerApproval.ownerUserId),
                approvedAt: row.ownerApproval.approvedAt,
                evalRunId: row.ownerApproval.evalRunId,
              },
        rollbackTargets: priors
          // Eligibility came from the index; liveness is the only thing left to exclude.
          .filter((p) => p.status !== "active")
          .slice(0, ROLLBACK_CHOICE_LIMIT)
          .map((p) => ({
            id: p._id,
            version: p.version,
            author: p.author,
            status: p.status,
          })),
        createdAt: row.createdAt,
      });
    }
    return out;
  },
});

/**
 * The owner's activation of ONE exact tenant candidate (21-04). BOTH gates apply and neither is
 * sufficient alone: `ownerMutation` supplies the authority, and the shared transition demands exact
 * passing evidence pinning this row.
 *
 * It takes a row id, never `(name, version)` — two tenants can hold the same pair, so a name/version
 * activation is a coin flip between going live for the right tenant and going live for a stranger.
 */
export const activateTenantCandidate = ownerMutation({
  args: { candidateId: v.id("tenantSkills") },
  handler: async (ctx, { candidateId }) => {
    const res = await transitionSkillActivation(ctx, {
      scope: "tenant",
      candidateId,
      mode: "activate-user",
    });

    // Only a REAL transition is an event. An idempotent re-activation changed nothing, and a
    // refusal threw before reaching here — neither may leave a governance row saying otherwise.
    if (res.changed) await logTenantActivation(ctx, "skill.user_candidate_activated", res);
    return { ok: true as const, ...res };
  },
});

/**
 * The separate human-owner approval door for an AGENT-authored row (23-05). It accepts one exact
 * id and no approval fields: owner identity and time come from the wrapper context, while eval run
 * id comes from the same strict current-suite evidence that clears the transition. Approval and
 * active status are therefore one Convex transaction and one target-row patch.
 */
export const activateAgentCandidate = ownerMutation({
  args: { candidateId: v.id("tenantSkills") },
  handler: async (ctx, { candidateId }) => {
    const res = await transitionSkillActivation(ctx, {
      scope: "tenant",
      candidateId,
      mode: "activate-agent",
      ownerUserId: ctx.userId,
    });
    if (res.changed) await logTenantActivation(ctx, "skill.agent_candidate_activated", res);
    return { ok: true as const, ...res };
  },
});

/**
 * The owner's incident rollback (21-04): restore a tenant row that was genuinely live before, or the
 * server baseline. Evidence-EXEMPT by design — a broken eval harness must never block this path —
 * and owner-only, because evidence-exempt is not auth-exempt.
 *
 * The exemption is `rollbackEligible === true` plus an archived/rolled_back status, never status
 * alone: a superseded draft is also archived and has never been live.
 */
export const rollbackTenantSkill = ownerMutation({
  args: { targetId: v.id("tenantSkills") },
  handler: async (ctx, { targetId }) => {
    const res = await transitionSkillActivation(ctx, {
      scope: "tenant",
      candidateId: targetId,
      mode: "rollback",
    });

    if (res.changed) await logTenantActivation(ctx, "skill.user_skill_rolled_back", res);
    return { ok: true as const, ...res };
  },
});

/**
 * The one refs-only audit write for both owner transitions (CLAUDE.md §4): ids, tenant/name/version,
 * the author enum, the eval run id and the owner's user id. No body, no adaptation, no prose, no
 * hash of user text. `skills.test.ts` pins this key set by EQUALITY and needle-scans audit +
 * deadLetters, so adding a body field fails on purpose.
 *
 * The row belongs to the TENANT whose runtime changed — not to the owner — so it lands on the same
 * `correlationId` lineage as that candidate's `skill.user_candidate_published` row.
 */
async function logTenantActivation(
  ctx: MutationCtx & { userId: Id<"users"> },
  eventType:
    | "skill.user_candidate_activated"
    | "skill.agent_candidate_activated"
    | "skill.user_skill_rolled_back",
  res: ActivationResult,
): Promise<void> {
  await ctx.runMutation(internal.audit.log, {
    tenantId: res.tenantId ?? "",
    correlationId: res.targetId,
    eventType,
    actor: "owner",
    payload: {
      skillName: res.name,
      tenantSkillId: res.targetId,
      version: res.version,
      author: res.author,
      fromTenantSkillId: res.fromId,
      fromVersion: res.fromVersion,
      evalRunId: res.evalRunId,
      ownerUserId: String(ctx.userId),
    },
  });
}

/**
 * The tenant's newest saved customization for one pack skill, or `null`.
 *
 * ROUT-01 (2026-08-30): this is what makes a saved customization TAKE EFFECT. `runWorkflowPack`
 * reads it, renders it through the approved schema and passes the result into the run as settings —
 * the approved template stays the governing body, so nothing tenant-authored goes live and
 * `planTenantActivation`'s `PACK_GATE` is untouched.
 *
 * NEWEST BY VERSION, not "the active one": there is no active tenant pack row and cannot be. It is
 * the same `by_tenant_name_version` `take(1)` read `workflowPackDiscovery` uses to fill the form
 * and `readTenantPublishState` uses to compute the base version, so the settings a run applies are
 * exactly the ones the customizer last showed the user.
 *
 * Returns the raw stored JSON. Parsing and rendering belong to the caller, which holds the schema.
 */
export const newestTenantCustomization = internalQuery({
  args: { tenantId: v.string(), name: v.string() },
  handler: async (
    ctx,
    { tenantId, name },
  ): Promise<{
    // The ROW ID. Added 2026-08-31 for the browser-evidence producer, which has to name the exact
    // candidate it exercised — at tenant scope `name@version` is not an identity, because two
    // tenants can each own version 2 of one pack. Refs-only, like everything else returned here.
    id: string;
    customizationValues: string;
    templateVersion: number;
    version: number;
  } | null> => {
    const newest = (
      await ctx.db
        .query("tenantSkills")
        .withIndex("by_tenant_name_version", (q) => q.eq("tenantId", tenantId).eq("name", name))
        .order("desc")
        .take(1)
    )[0];
    // A `system` rollback baseline carries no template lineage and no values — indistinguishable
    // from "never customized" for this purpose, and treated as such rather than half-applied.
    if (
      newest === undefined ||
      newest.customizationValues === undefined ||
      newest.templateVersion === undefined
    ) {
      return null;
    }
    return {
      id: String(newest._id),
      customizationValues: newest.customizationValues,
      templateVersion: newest.templateVersion,
      version: newest.version,
    };
  },
});
