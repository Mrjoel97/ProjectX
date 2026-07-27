import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { bmcSkillBody } from "./bmc";
import { documentAnalystSkillBody } from "./documentAnalyst";
import { growthOsDiagnosticSkillBody } from "./growthOsDiagnostic";
import { leadEngineSkillBody } from "./leadEngine";
import { researchSpecialistSkillBody } from "./researchSpecialist";
import { leanCanvasSkillBody } from "./leanCanvas";
import { moneyModelDesignerSkillBody } from "./moneyModelDesigner";
import { offerArchitectSkillBody } from "./offerArchitect";
import { onboardingAgentSkillBody } from "./onboardingAgent";
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
];

describe("evaluation/specialist skill bodies (BEVL-01) — md ↔ ts no-drift", () => {
  test.each(bodies)("%s.md === its derived constant (byte-identical, LF-normalized)", (base, body) => {
    const mdPath = fileURLToPath(new URL(`../../skills/${base}.md`, import.meta.url));
    expect(lf(body)).toBe(lf(readFileSync(mdPath, "utf8")));
  });
});
