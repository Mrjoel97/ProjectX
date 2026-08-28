import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import {
  BUSINESS_BLUEPRINT_SKILL,
  DOCUMENT_CLASSIFIER_SKILL,
  FOLDER_DIGEST_SKILL,
  isGatedSkill,
  KNOWLEDGE_QUERY_PLANNER_SKILL,
  KNOWLEDGE_SYNTHESIZER_SKILL,
  MEDIA_DIRECTOR_SKILL,
} from "../skill";
import { bmcSkillBody } from "./bmc";
import { businessBlueprintSkillBody } from "./businessBlueprint";
import { cockpitAgentSkillBody } from "./cockpitAgent";
import { documentAnalystSkillBody } from "./documentAnalyst";
import { documentClassifierSkillBody } from "./documentClassifier";
import { folderDigestSkillBody } from "./folderDigest";
import { growthOsDiagnosticSkillBody } from "./growthOsDiagnostic";
import { knowledgeQueryPlannerSkillBody } from "./knowledgeQueryPlanner";
import { knowledgeSynthesizerSkillBody } from "./knowledgeSynthesizer";
import { leadEngineSkillBody } from "./leadEngine";
import { leanCanvasSkillBody } from "./leanCanvas";
import { mediaDirectorSkillBody } from "./mediaDirector";
import { moneyModelDesignerSkillBody } from "./moneyModelDesigner";
import { offerArchitectSkillBody } from "./offerArchitect";
import { onboardingAgentSkillBody } from "./onboardingAgent";
import { packBrandReviewSkillBody } from "./packBrandReview";
import { packBusinessPulseSkillBody } from "./packBusinessPulse";
import { packCampaignPlanSkillBody } from "./packCampaignPlan";
import { packCustomerComplaintSkillBody } from "./packCustomerComplaint";
import { packProcessSopSkillBody } from "./packProcessSop";
import { packSalesCallPrepSkillBody } from "./packSalesCallPrep";
import { researchSpecialistSkillBody } from "./researchSpecialist";
import { styleCoachingSkillBody } from "./styleCoaching";
import { styleConciseSkillBody } from "./styleConcise";
import { styleDirectSkillBody } from "./styleDirect";
import { swotSkillBody } from "./swot";

// Every derived .ts body MUST stay byte-identical (LF-normalized) to its canonical
// .md source — the derived constant is the bundler-safe artifact the Convex runtime
// ships, generated FROM the .md; drift means a stale prompt. Mirrors the
// skills.test.ts "no drift" precedent, scoped to the Phase 12 (BEVL-01) skill bodies.
const lf = (s: string) => s.replace(/\r\n/g, "\n");

// [canonical .md basename, derived constant]
const bodies: [string, string][] = [
  ["growth-os-diagnostic", growthOsDiagnosticSkillBody],
  ["swot", swotSkillBody],
  ["lean-canvas", leanCanvasSkillBody],
  ["bmc", bmcSkillBody],
  ["offer-architect", offerArchitectSkillBody],
  ["money-model-designer", moneyModelDesignerSkillBody],
  ["lead-engine", leadEngineSkillBody],
  // Phase 16 (DISP-02/ACTN-03): the research specialist body.
  ["research-specialist", researchSpecialistSkillBody],
  // Phase 20 (MEDIA-01): the media specialist body. The drift row matters here because the .md
  // carries a WORKED EXAMPLE that storyboard.test.ts parses — a stale .ts would ship a body whose
  // example no longer matches the parser the round-trip test certified.
  ["media-director", mediaDirectorSkillBody],
  // 15.1-05 (design §7): the three UNGATED behaviour-preset style overlays. Same mirror, same
  // reason — the `.md` is what a human edits, the `.ts` is what the Convex runtime ships, and a
  // half-applied mirror would silently seed a stale overlay.
  ["style-direct", styleDirectSkillBody],
  ["style-coaching", styleCoachingSkillBody],
  ["style-concise", styleConciseSkillBody],
  // 15.1-06 (design §6): the UNGATED conversational onboarding system prompt. Same mirror — and
  // the drift row matters most here, because `converse` fails CLOSED on an unseeded row: a stale
  // derived constant seeds a stale prompt rather than a loud error.
  ["onboarding-agent", onboardingAgentSkillBody],
  // Phase 14 (DOCV-01) — the voice-doc persona rides the same drift guard.
  ["document-analyst", documentAnalystSkillBody],
  // Phase 17.1 (BLPR-01): the UNGATED corpus-synthesis prompt. Same mirror — and the drift row
  // matters here because the synthesis action loads it FAIL-CLOSED: a stale derived constant seeds
  // a stale prompt rather than a loud error.
  ["business-blueprint", businessBlueprintSkillBody],
  // 15.3-06 (VALT-08): the UNGATED folder-digest synthesis prompt. There is NO generator script —
  // the .ts is hand-derived — so this row is the only thing that turns an edit to one side into a
  // failure instead of a silently stale seeded prompt. It also guards the three-part OUTPUT
  // CONTRACT (what the folder IS / SAYS / could NOT be read), which the digest test asserts against.
  ["folder-digest", folderDigestSkillBody],
  // 15.3-08 (VALT-12): the UNGATED document-classifier prompt. Same hand-derived mirror, and the
  // drift row carries more than freshness here — the .md's OUTPUT CONTRACT lists the twelve
  // `DOC_TYPES` literals VERBATIM, so this row is what turns "the seeded prompt still names the
  // union the schema accepts" into a failure rather than a silent mismatch the coercion layer
  // absorbs as `unclassified`.
  // cockpit-agent was NOT in this list, so its .md and .ts silently drifted (2026-08-10:
  // a body edit landed in the .md, seedSkills published nothing, and the gate would have
  // measured the OLD body). It is the most-edited body in the repo; it belongs here most.
  ["cockpit-agent", cockpitAgentSkillBody],
  ["document-classifier", documentClassifierSkillBody],
  // Phase 27 (PACK-02): the curated knowledge-work pack bodies. This row is not optional
  // bookkeeping — there is NO generator for the derived `.ts`, so it is the ONLY thing that turns
  // an edit to one side into a failure rather than a silently stale constant. It matters more here
  // than for most: 27-01's manifest hashes pin the `.md`, and `publishPackCandidate` ships the
  // `.ts`, so a drifted pair means the body we certified and the body we published are different
  // files. 27-05 and 27-06 append their four here.
  ["pack-business-pulse", packBusinessPulseSkillBody],
  ["pack-campaign-plan", packCampaignPlanSkillBody],
  // 27-05: the two best-supported packs — their primary inputs are real agent tools.
  ["pack-customer-complaint", packCustomerComplaintSkillBody],
  ["pack-sales-call-prep", packSalesCallPrepSkillBody],
  // 27-06: the last two. Brand Review is the most capability-starved pack in the pilot and ships
  // anyway, with its blind spot stated in its own first output section.
  ["pack-process-sop", packProcessSopSkillBody],
  ["pack-brand-review", packBrandReviewSkillBody],
  // Phase 29 (KNOW-01): the two toolless knowledge bodies. There is NO generator for the derived
  // `.ts`, so this row is the only thing that turns an edit to one side into a failure instead of
  // a silently stale seeded prompt — and it matters more here than usual because both bodies are
  // GATED: the body an eval run certifies and the body `seedSkills` publishes must be one file.
  ["knowledge-query-planner", knowledgeQueryPlannerSkillBody],
  ["knowledge-synthesizer", knowledgeSynthesizerSkillBody],
];

describe("evaluation/specialist skill bodies (BEVL-01) — md ↔ ts no-drift", () => {
  test.each(
    bodies,
  )("%s.md === its derived constant (byte-identical, LF-normalized)", (base, body) => {
    const mdPath = fileURLToPath(new URL(`../../skills/${base}.md`, import.meta.url));
    expect(lf(body)).toBe(lf(readFileSync(mdPath, "utf8")));
  });
});

// Phase 17.1 (BLPR-01). This is not a style preference — gating `business-blueprint` DEADLOCKS it
// at v1, because run-eval-golden.mjs hard-validates `--skill` against a closed name list and cannot
// drive the synthesis path, so no runner could ever clear the gate on a body edit. A future "tidy
// up the gate list" edit must fail HERE rather than in production.
describe("business-blueprint gating (17.1-02)", () => {
  test("is DELIBERATELY UNGATED — do not add it to GATED_SKILLS", () => {
    expect(isGatedSkill(BUSINESS_BLUEPRINT_SKILL)).toBe(false);
  });
});

// Phase 20 (MEDIA-01). Same mechanism, same deadlock: the golden runner drives runCockpitAgent over
// TEXT fixtures and structurally cannot exercise a script/art-direction/storyboard turn, so gating
// media-director would strand it at v1 on its first body edit. And the guarantees that matter are
// CODE, not prose — searchVault is its only grant, the narration band is enforced by the parser,
// and the model comes from a price table the body cannot name into. A future "tidy up the gate
// list" edit must fail HERE, not in production.
describe("media-director gating (20-03)", () => {
  test("is DELIBERATELY UNGATED — do not add it to GATED_SKILLS", () => {
    expect(isGatedSkill(MEDIA_DIRECTOR_SKILL)).toBe(false);
  });
});

// 15.3-06 (VALT-08). Same mechanism, same deadlock: run-eval-golden.mjs derives its --skill list
// from GATED_SKILLS and drives runCockpitAgent over TEXT fixtures. A folder digest is fed a folder
// manifest plus bounded per-member excerpts, which no text fixture can assemble — so gating this
// would strand it at v1 on its first body edit, with no runner able to clear the gate. A future
// "tidy up the gate list" edit must fail HERE, not in production.
describe("folder-digest gating (15.3-06)", () => {
  test("is DELIBERATELY UNGATED — do not add it to GATED_SKILLS", () => {
    expect(isGatedSkill(FOLDER_DIGEST_SKILL)).toBe(false);
  });
});

// 15.3-08 (VALT-12). Same mechanism, same deadlock: run-eval-golden.mjs derives its --skill list
// from GATED_SKILLS and drives runCockpitAgent over TEXT fixtures. This skill runs INSIDE the
// ingestDoc workflow on a stored document's redacted head slice, which no text fixture can reach —
// so gating it would strand it at v1 on its first body edit, with no runner able to clear the gate.
// And what matters here is CODE: the returned docType is coerced to `unclassified` unless it is a
// member of the closed union, so no body edit can widen what reaches the table. A future "tidy up
// the gate list" edit must fail HERE, not in production.
describe("document-classifier gating (15.3-08)", () => {
  test("is DELIBERATELY UNGATED — do not add it to GATED_SKILLS", () => {
    expect(isGatedSkill(DOCUMENT_CLASSIFIER_SKILL)).toBe(false);
  });
});

// Phase 29 (KNOW-01). The OPPOSITE direction from the four blocks above, and deliberately so: the
// planner's containment is behavioural in exactly the half `clampSearchPlan` cannot see, and the
// synthesizer ingests untrusted third-party content from several planes at once — the
// `inbox-digest` criterion. See the reachability warning on each constant in `../skill.ts`: this
// gate is clearable only once plan 29-06 lands a golden fixture that drives a knowledge search.
describe("knowledge planner/synthesizer gating (29-04)", () => {
  test.each([
    KNOWLEDGE_QUERY_PLANNER_SKILL,
    KNOWLEDGE_SYNTHESIZER_SKILL,
  ])("%s is GATED — a candidate body may only activate on recorded eval evidence", (name) => {
    expect(isGatedSkill(name)).toBe(true);
  });
});

// A BODY IS NOT A CAPABILITY GRANT (ADR-007, CLAUDE.md §5). Neither knowledge call is given a
// tool, and neither is told which sources exist: the planner's source list is supplied per run
// from `KNOWLEDGE_SOURCES` and re-checked by `clampSearchPlan`, and the synthesizer only ever sees
// fenced blocks. A body that hardcodes a source id or a provider name is drift the moment the
// registry changes — and it is also how a "grant" gets written in prose and then believed.
describe("the knowledge bodies encode NO tool grant and NO provider (29-04)", () => {
  // LITERALS, not an import of the constant the implementation uses: an oracle that moves with its
  // subject can never fail. The five source ids are pinned as strings in `knowledgeSearch.test.ts`
  // (@pikar/core), which is a different package and cannot be imported from here anyway.
  const FORBIDDEN = [
    // the five knowledge source ids — code-supplied per run, never named in a body
    "vault",
    "drive",
    "inbox",
    "crm-facts",
    "support-desk",
    // provider/vendor names
    "gmail",
    "google",
    "hubspot",
    "quickbooks",
    "stripe",
    "outlook",
    "notion",
    "slack",
    "salesforce",
    // tool-grant vocabulary from the cockpit loop
    "searchvault",
    "senddraft",
    "draftbody",
    "createdocument",
    "resolvecontacts",
    "websearch",
    "function call",
  ];

  test.each([
    ["knowledge-query-planner", knowledgeQueryPlannerSkillBody],
    ["knowledge-synthesizer", knowledgeSynthesizerSkillBody],
  ])("%s names no source, no provider and no tool", (_name, body) => {
    // Whitespace-collapsed, because a markdown body wraps: the 29-01 repair found a line-anchored
    // scan that read green with the banned thing sitting in the file, one newline in.
    const lower = lf(body).toLowerCase().replace(/\s+/g, " ");
    expect(FORBIDDEN.filter((word) => lower.includes(word))).toEqual([]);
    // POSITIVE CONTROL: the scan can see words that ARE in the body, so an empty result above is
    // evidence of absence rather than evidence of a broken scan.
    expect(lower).toContain("you have no tools");
  });
});
