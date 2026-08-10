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

/**
 * Registry name of the short-form content drafter skill (Phase 18, ACTN-04 — LinkedIn posts,
 * ad headlines, email copy). Long-form keeps `document-drafter`, whose body Phase 18 does not
 * touch; this is a NEW row, so seedSkills' `rows.length === 0` branch lands it at v1 `active`
 * with no eval cycle and no paid run.
 *
 * DELIBERATELY UNGATED — do NOT add to GATED_SKILLS (Phase 18, ACTN-04, 2026-08-01).
 * `run-eval-golden.mjs`'s SKILL_NAMES is DERIVED from GATED_SKILLS, so gating this row makes it
 * pinnable — but there is NO golden fixture that reaches `createDocument`, so the first body edit
 * would mint a candidate no eval run can certify. That is the exact deadlock recorded for
 * `business-blueprint` below. Revisit when a fixture exists.
 */
export const CONTENT_DRAFTER_SKILL = "content-drafter" as const;

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

/**
 * Registry name of the voice-doc document-analyst persona (DOCV-01 — the realtime
 * "discuss this report" system prompt).
 *
 * DELIBERATELY UNGATED — do NOT add to GATED_SKILLS (locked user decision 2026-07-25, following
 * the voice-session / voice-brief precedent). `run-eval-golden.mjs` drives `runCockpitAgent` over
 * text fixtures and hard-validates `--skill` against a closed name list; it structurally cannot
 * exercise a Realtime voice persona, so gating this would deadlock the skill at v1 on its first
 * body edit with no runner able to clear the gate.
 */
export const DOCUMENT_ANALYST_SKILL = "document-analyst" as const;

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

/** Registry name of the research specialist (Phase 16, DISP-02/ACTN-03 — the web-research
 *  sub-agent). The spelling is load-bearing: `specialists.test.ts` reads THIS file off disk and
 *  asserts a matching exported constant for every `SPECIALISTS[route].skillName`. */
export const RESEARCH_SPECIALIST_SKILL = "research-specialist" as const;

/**
 * Registry name of the media-director specialist (Phase 20, MEDIA-01) — script, art direction,
 * block deck and block prompts, produced in ONE turn.
 *
 * DELIBERATELY UNGATED — do NOT add to `GATED_SKILLS`.
 *
 * MECHANICAL reason, the `document-analyst` mechanism exactly: `run-eval-golden.mjs`
 * hard-validates `--skill` against a closed name list and drives `runCockpitAgent` over TEXT
 * fixtures. It structurally cannot drive a script/art-direction/storyboard turn, so gating this
 * would DEADLOCK it at v1 — the first body edit mints a candidate no runner could ever certify.
 *
 * SUBSTANTIVE reason: the guarantee that matters here is CODE, not prose. The specialist is
 * granted `searchVault` and nothing else, so it structurally cannot spend a cent (D2); the
 * narration character band is enforced by `@pikar/core/storyboard`'s parser whatever the body
 * says; the model is chosen from a price table the body cannot name into; and the budget rail is
 * code. Unlike `inbox-digest` / `reply-drafter` / `research-specialist`, this skill ingests no
 * untrusted third-party content — only the tenant's own profile, blueprint and vault.
 */
export const MEDIA_DIRECTOR_SKILL = "media-director" as const;

/** Registry name of the conversational onboarding system prompt (ONBD-01 / 15.1, design §6). */
export const ONBOARDING_AGENT_SKILL = "onboarding-agent" as const;

/**
 * Registry name of the business-blueprint corpus-synthesis skill (Phase 17.1, BLPR-01 — the
 * one model call that proposes derived candidates for the blueprint's blank fields).
 *
 * DELIBERATELY UNGATED — do NOT add to GATED_SKILLS (owner decision 2026-07-27). This REPLACES
 * the "through the eval gate" line in the phase's original Definition of Done; do not "fix" it
 * back.
 *
 * MECHANICAL reason (the same one that keeps `document-analyst` ungated): `run-eval-golden.mjs`
 * hard-validates `--skill` against a closed name list (see the constants above), and it drives
 * `runCockpitAgent` over text fixtures — it structurally cannot exercise the synthesis path. Gating
 * a skill the golden runner cannot drive DEADLOCKS it at v1 on its first body edit, with no runner
 * able to clear the gate.
 *
 * PRINCIPLED reason: the `business-profile` rationale applies verbatim — the output is a vault doc
 * a human confirms, not autonomous tool-state — and D2's confirm gate IS that human check. What
 * would actually be worth asserting is already CODE, not prose: precedence is `mergeBlueprint`
 * (which has no branch that overwrites a non-empty typed field) and the citation check is a
 * source-index validation that DROPS an unsupported claim. There is nothing left for an eval corpus
 * to assert that the code does not already guarantee.
 */
export const BUSINESS_BLUEPRINT_SKILL = "business-blueprint" as const;

/**
 * Registry name of the folder-digest synthesis skill (15.3-06, VALT-08/09/10 — the one model call
 * that turns a completed folder into a three-part digest: what the folder IS, what it SAYS, and
 * what could NOT be read).
 *
 * DELIBERATELY UNGATED — do NOT add to GATED_SKILLS (15.3-06).
 *
 * MECHANICAL reason, the `content-drafter` / `business-blueprint` mechanism verbatim:
 * `run-eval-golden.mjs`'s SKILL_NAMES is DERIVED from GATED_SKILLS and it drives `runCockpitAgent`
 * over TEXT fixtures. No fixture reaches a folder digest — the input is a folder manifest plus
 * bounded per-member excerpts, which the runner structurally cannot assemble. Gating this row would
 * therefore DEADLOCK it at v1 on its first body edit: a candidate no eval run could ever certify.
 * Revisit when a fixture exists.
 */
export const FOLDER_DIGEST_SKILL = "folder-digest" as const;

/**
 * Registry name of the document-classifier skill (15.3-08, VALT-12 — the one model call per
 * ingested document that returns its closed-union `docType` plus a short human-readable identity
 * line, "2025 P&L" rather than "a spreadsheet").
 *
 * DELIBERATELY UNGATED — do NOT add to GATED_SKILLS (15.3-08).
 *
 * MECHANICAL reason, the `content-drafter` / `folder-digest` mechanism verbatim:
 * `run-eval-golden.mjs`'s SKILL_NAMES is DERIVED from GATED_SKILLS and it drives `runCockpitAgent`
 * over TEXT fixtures. No fixture reaches vault ingest — this skill runs inside the `ingestDoc`
 * workflow, on a stored document's redacted head slice, which the runner structurally cannot
 * assemble. Gating this row would therefore DEADLOCK it at v1 on its first body edit: a candidate
 * no eval run could ever certify. Revisit when a fixture exists.
 *
 * SUBSTANTIVE reason: the guarantee that matters is CODE, not prose. The returned `docType` is
 * validated against the closed `DOC_TYPES` union and coerced to `unclassified` on any other
 * string, so no body edit can widen what reaches the table; a classifier failure degrades the
 * LABEL and never the document; and a user-set identity is never overwritten, because there is no
 * branch that writes over one.
 */
export const DOCUMENT_CLASSIFIER_SKILL = "document-classifier" as const;

/** Registry name of the `direct` behaviour-preset style overlay (15.1 / design §7). */
export const STYLE_DIRECT_SKILL = "style-direct" as const;

/** Registry name of the `coaching` behaviour-preset style overlay (15.1 / design §7). */
export const STYLE_COACHING_SKILL = "style-coaching" as const;

/** Registry name of the `concise` behaviour-preset style overlay (15.1 / design §7). */
export const STYLE_CONCISE_SKILL = "style-concise" as const;

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
 *
 * DELIBERATELY ABSENT (15.1, Q6 — do not "fix" this): the three behaviour-preset
 * style overlays `style-direct` / `style-coaching` / `style-concise`. They match
 * `business-profile`, the nearest precedent: an overlay changes HOW a specialist
 * speaks, never what it may do or claim (the capability grant is code-owned —
 * ADR-007), so there is nothing for an eval corpus to assert that the specialist's
 * OWN gated body does not already assert. Gating them would add an eval-corpus
 * obligation this phase has no budget for, on top of a Phase-15 gate that is
 * already unpaid.
 *
 * ALSO DELIBERATELY ABSENT (15.1, Q6 — same decision): `onboarding-agent`. It
 * matches `business-profile` even more closely — also an onboarding skill, also
 * producing something a human confirms rather than autonomous tool-state. And the
 * property that actually matters about the onboarding turn is CODE, not prose:
 * `converse` picks the next question from `missingSlots` and computes `done` from
 * `canComplete`, so no body edit can make the conversation finish early. There is
 * nothing left for an eval corpus to assert that the code does not already
 * guarantee.
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
  // Phase 16 (DISP-02/ACTN-03): the strongest gating case in this list. This body's whole value is
  // BEHAVIOURAL — does it refuse to confabulate when search comes back empty — which is exactly
  // what an eval corpus can assert and code cannot. Bootstrap v1 still activates ungated via
  // seedSkills' `rows.length === 0` path, so the gate costs nothing until the first edit.
  RESEARCH_SPECIALIST_SKILL,
];

/** Whether activation of a candidate version of this skill requires eval evidence. */
export function isGatedSkill(name: string): boolean {
  return GATED_SKILLS.includes(name);
}

/**
 * The v0 set an ordinary signed-in user may write a business adaptation for (Phase 21, SKILL-01).
 *
 * DELIBERATELY NARROWER THAN `GATED_SKILLS`, and the two lists must not be merged: gating is an
 * ACTIVATION policy ("this body needs eval evidence to go live"), authorability is a PRODUCT
 * decision ("we can honestly explain this skill to a user, and a run can certify their edit").
 *
 * These three are the dispatched business specialists. Their real runtime is
 * `dispatch.runSpecialist` -> `llm.runSpecialistTurn`, and held-out golden fixtures 29/30/31 drive
 * exactly one of them each — so a tenant candidate has a runner that can clear its gate. Adding a
 * name whose runner cannot drive it (the `document-analyst` / `media-director` deadlock recorded
 * above) would mint tenant candidates no eval run could ever certify. `skillAuthoring.test.ts`
 * pins the exact set AND its subset relationship to `GATED_SKILLS`.
 */
export const USER_AUTHORABLE_SKILLS = [
  OFFER_ARCHITECT_SKILL,
  MONEY_MODEL_DESIGNER_SKILL,
  LEAD_ENGINE_SKILL,
] as const;

/** A registry name an ordinary tenant user may author an adaptation for. */
export type UserAuthorableSkill = (typeof USER_AUTHORABLE_SKILLS)[number];

/**
 * User-facing copy for the authorable set, exhaustive by type over `UserAuthorableSkill` so a UI
 * never re-lists registry names (a duplicated literal is how the two lists drift apart).
 */
export const USER_AUTHORABLE_SKILL_METADATA: Record<
  UserAuthorableSkill,
  { label: string; description: string }
> = {
  [OFFER_ARCHITECT_SKILL]: {
    label: "Offer architect",
    description: "How your offers are shaped, packaged, and priced.",
  },
  [MONEY_MODEL_DESIGNER_SKILL]: {
    label: "Money model designer",
    description: "How your pricing, margins, and payment terms are proposed.",
  },
  [LEAD_ENGINE_SKILL]: {
    label: "Lead engine",
    description: "How leads are sourced, qualified, and followed up.",
  },
};

/** Whether an ordinary tenant user may author an adaptation for this registry name. */
export function isUserAuthorableSkill(name: string): name is UserAuthorableSkill {
  return (USER_AUTHORABLE_SKILLS as readonly string[]).includes(name);
}

/**
 * UTF-8 byte cap on ONE authored adaptation. Bounds both the stored row and the per-turn prompt
 * cost the adaptation adds. BYTES, not characters: a character cap lets one multibyte paste carry
 * ~4x the tokens the number implies.
 */
export const USER_SKILL_ADAPTATION_MAX_BYTES = 4000;

/** The single fixed marker separating the code-owned base body from the tenant's adaptation. */
export const USER_SKILL_ADAPTATION_SECTION = "## Tenant-authored business adaptation" as const;

/** `composeUserSkillBody` refuses an adaptation that is empty after trimming. */
export const USER_SKILL_ADAPTATION_REQUIRED_ERROR = "USER_SKILL_ADAPTATION_REQUIRED" as const;

/** `composeUserSkillBody` refuses an adaptation over `USER_SKILL_ADAPTATION_MAX_BYTES`. */
export const USER_SKILL_ADAPTATION_TOO_LARGE_ERROR = "USER_SKILL_ADAPTATION_TOO_LARGE" as const;

/**
 * Compose the complete runtime body for a tenant skill candidate: the effective base body
 * verbatim, one fixed section marker, and the user's trimmed adaptation.
 *
 * The user authors an ADDITION, never a replacement — they neither receive nor can delete the base
 * prompt (which is an owner-only disclosure boundary), and they cannot grant a capability, because
 * tools/action kinds/budgets are code-owned (ADR-007). The base is emitted byte-for-byte and never
 * parsed, so composing a NEW adaptation against the same base cannot carry an older one forward:
 * callers pass the base, not the previously composed body.
 *
 * Throws (never returns a partial body) so no caller can persist an unvalidated adaptation. Error
 * messages carry the cap and the measured byte count only — never the authored text (CLAUDE.md §4).
 */
export function composeUserSkillBody(baseBody: string, authoredBody: string): string {
  const authored = authoredBody.trim();
  if (authored === "") throw new Error(USER_SKILL_ADAPTATION_REQUIRED_ERROR);
  const bytes = new TextEncoder().encode(authored).length;
  if (bytes > USER_SKILL_ADAPTATION_MAX_BYTES) {
    throw new Error(
      `${USER_SKILL_ADAPTATION_TOO_LARGE_ERROR}: ${bytes} bytes exceeds ${USER_SKILL_ADAPTATION_MAX_BYTES}`,
    );
  }
  return `${baseBody}\n\n${USER_SKILL_ADAPTATION_SECTION}\n\n${authored}`;
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
