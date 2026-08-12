import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import {
  BUSINESS_BLUEPRINT_SKILL,
  DOCUMENT_CLASSIFIER_SKILL,
  FOLDER_DIGEST_SKILL,
  isGatedSkill,
  MEDIA_DIRECTOR_SKILL,
} from "../skill";
import { bmcSkillBody } from "./bmc";
import { businessBlueprintSkillBody } from "./businessBlueprint";
import { cockpitAgentSkillBody } from "./cockpitAgent";
import { documentAnalystSkillBody } from "./documentAnalyst";
import { documentClassifierSkillBody } from "./documentClassifier";
import { folderDigestSkillBody } from "./folderDigest";
import { growthOsDiagnosticSkillBody } from "./growthOsDiagnostic";
import { leadEngineSkillBody } from "./leadEngine";
import { leanCanvasSkillBody } from "./leanCanvas";
import { mediaDirectorSkillBody } from "./mediaDirector";
import { moneyModelDesignerSkillBody } from "./moneyModelDesigner";
import { offerArchitectSkillBody } from "./offerArchitect";
import { onboardingAgentSkillBody } from "./onboardingAgent";
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
