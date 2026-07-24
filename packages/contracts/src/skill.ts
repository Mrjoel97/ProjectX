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

/** Registry name of the inbox digest skill (CKPT-04 — the toolless briefing summarizer). */
export const INBOX_DIGEST_SKILL = "inbox-digest" as const;

/** Registry name of the reply drafter skill (RPLY-01 — the toolless reply-body writer). */
export const REPLY_DRAFTER_SKILL = "reply-drafter" as const;

/** Registry name of the live voice-session persona skill (VOIC-01 — the realtime call system prompt). */
export const VOICE_SESSION_SKILL = "voice-session" as const;

/** Registry name of the voice-brief structuring skill (VOIC-03 — the toolless call-to-brief writer). */
export const VOICE_BRIEF_SKILL = "voice-brief" as const;

/** Registry name of the business-profile extraction skill (ONBD-02 — onboarding intake→Lean-core profile). */
export const BUSINESS_PROFILE_SKILL = "business-profile" as const;

/** Registry name of the Growth OS diagnostic rubric (BEVL-01 — constraint routing + financial-spine method). */
export const GROWTH_OS_DIAGNOSTIC_SKILL = "growth-os-diagnostic" as const;

/** Registry name of the SWOT framework rubric (BEVL-01 — SME persona-fallback quadrant method). */
export const SWOT_SKILL = "swot" as const;

/** Registry name of the Lean Canvas framework rubric (BEVL-01 — solopreneur persona-fallback canvas method). */
export const LEAN_CANVAS_SKILL = "lean-canvas" as const;

/** Registry name of the Business Model Canvas framework rubric (BEVL-01 — startup persona-fallback canvas method). */
export const BMC_SKILL = "bmc" as const;

/** Registry name of the offer-architect specialist rubric (BEVL-01 — the gap-action target; execution deferred to Phase 15+). */
export const OFFER_ARCHITECT_SKILL = "offer-architect" as const;

/** Registry name of the money-model-designer specialist rubric (BEVL-01 — the gap-action target; execution deferred to Phase 15+). */
export const MONEY_MODEL_DESIGNER_SKILL = "money-model-designer" as const;

/** Registry name of the lead-engine specialist rubric (BEVL-01 — the gap-action target; execution deferred to Phase 15+). */
export const LEAD_ENGINE_SKILL = "lead-engine" as const;

/**
 * Skills whose CANDIDATE versions may only activate through a recorded passing
 * eval run (EVAL-01). Rollback (archived/rolled_back targets) is structurally
 * exempt by status.
 *
 * `inbox-digest` (03.7-03) is gated because it is the ONE skill whose input is
 * untrusted third-party content (inbound mail) — exactly the risk the gate
 * exists for, and the golden set covers the briefing path (SC-5). `reply-drafter`
 * (03.11-02) is gated for the SAME reason: it ingests the untrusted original body
 * to write a reply. Bootstrap v1 still activates ungated via seedSkills'
 * rows.length===0 path, so gating costs nothing until the first edit.
 */
export const GATED_SKILLS: readonly string[] = [
  COCKPIT_AGENT_SKILL,
  DOCUMENT_DRAFTER_SKILL,
  INBOX_DIGEST_SKILL,
  REPLY_DRAFTER_SKILL,
  // Phase 12 (BEVL-01): the evaluation-framework rubrics + specialist skills. Their
  // METHOD bodies leave the building as findings/next-step memos, so activation is
  // eval-gated — a candidate only goes live through a recorded passing eval run.
  GROWTH_OS_DIAGNOSTIC_SKILL,
  SWOT_SKILL,
  LEAN_CANVAS_SKILL,
  BMC_SKILL,
  OFFER_ARCHITECT_SKILL,
  MONEY_MODEL_DESIGNER_SKILL,
  LEAD_ENGINE_SKILL,
];

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
