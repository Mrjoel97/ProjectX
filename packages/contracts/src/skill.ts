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

/**
 * Skills whose CANDIDATE versions may only activate through a recorded passing
 * eval run (EVAL-01). Locked v1 list — email-drafter/executive-router deferred.
 * Rollback (archived/rolled_back targets) is structurally exempt by status.
 */
export const GATED_SKILLS: readonly string[] = [COCKPIT_AGENT_SKILL, DOCUMENT_DRAFTER_SKILL];

/** Whether activation of a candidate version of this skill requires eval evidence. */
export function isGatedSkill(name: string): boolean {
  return GATED_SKILLS.includes(name);
}

/**
 * Evidence recorded on a skills row by a green eval run (refs/hashes/ids/counts
 * ONLY — never raw prompts, outputs, or PII; CLAUDE.md §4). Written by the eval
 * runner (plan 04) via recordEvalEvidence, read by the activateSkill gate.
 */
export type EvalEvidence = {
  /** The runner that produced this evidence (e.g. "eval:golden"). */
  runner: string;
  /** Opaque id of the eval run. */
  runId: string;
  /** Whether the run passed overall. */
  pass: boolean;
  casesPassed: number;
  casesTotal: number;
  /** Case ids that needed a retry to pass. */
  retriedCases: string[];
  costUsd: number;
  /** Model id the run executed against. */
  model: string;
  /** Exact skill versions the run executed with — the gate pins on these. */
  skillVersions: Record<string, number>;
  /** Epoch ms the evidence was recorded. */
  ts: number;
};

/**
 * Parse an evidence JSON string and decide whether it proves a PASSING eval run
 * for EXACTLY this (name, version). Fails closed: absent, unparseable, pass!==true,
 * or a skillVersions pin on any other version → false. No freshness window in v1
 * (presence + exact version pin is the whole check).
 */
export function hasPassingEvidence(
  evidence: string | undefined,
  name: string,
  version: number,
): boolean {
  if (evidence === undefined) return false;
  try {
    const parsed = JSON.parse(evidence) as Partial<EvalEvidence>;
    return parsed.pass === true && parsed.skillVersions?.[name] === version;
  } catch {
    return false; // unparseable → fail closed
  }
}
