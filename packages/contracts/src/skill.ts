// Loader contract for the versioned skill/prompt registry.
//
// Discipline (see CLAUDE.md rule 5): agent/LLM prompts are NEVER hardcoded in
// source. They are versioned rows in the `skills` table and loaded at runtime
// via loadSkill. A change = a new version row (status "candidate") plus an
// activateSkill flip; body/name/version are immutable per version.

/** Shape returned by the registry loader for the currently active skill. */
export type LoadedSkill = {
  /** The active skill document body (prompt/instruction markdown). */
  body: string;
  /** Monotonic version number of the active row. */
  version: number;
  /** Opaque id of the active skills-table row (record in telemetry/audit). */
  skillId: string;
};

/**
 * loadSkill signature contract. The Convex adapter implements this over the
 * `by_name_status` index, reading the single status==="active" row and
 * THROWING (failing closed) when none exists.
 */
export type SkillLoader<Ctx = unknown> = (ctx: Ctx, name: string) => Promise<LoadedSkill>;

/** Error prefix thrown by loadSkill when no active skill row exists (fails closed). */
export const NO_ACTIVE_SKILL_ERROR = "NO_ACTIVE_SKILL" as const;

/** Error prefix thrown by activateSkill when the target version row is absent. */
export const NO_SUCH_SKILL_VERSION_ERROR = "NO_SUCH_SKILL_VERSION" as const;

/** Registry name of the seed Executive Agent classifier skill (seeds AGNT-01). */
export const EXECUTIVE_AGENT_CLASSIFIER_SKILL = "executive-agent.classifier" as const;

/** Registry name of the Executive Agent router skill (AGNT-01/02/03). */
export const EXECUTIVE_ROUTER_SKILL = "executive-router" as const;

/** Registry name of the email drafter skill (AGNT-02). */
export const EMAIL_DRAFTER_SKILL = "email-drafter" as const;

/** Registry name of the cockpit Executive Agent tool-loop skill (AGNT-01). */
export const COCKPIT_AGENT_SKILL = "cockpit-agent" as const;

/** Registry name of the document drafter skill (CKPT-02 — attachment generation). */
export const DOCUMENT_DRAFTER_SKILL = "document-drafter" as const;

/** Registry name of the attachment extractor OCR/extraction skill (INTK-02). */
export const ATTACHMENT_EXTRACTOR_SKILL = "attachment-extractor" as const;

/** Registry name of the graph extractor skill (VALT-02 — GraphRAG entity/relationship extraction). */
export const GRAPH_EXTRACTOR_SKILL = "graph-extractor" as const;
