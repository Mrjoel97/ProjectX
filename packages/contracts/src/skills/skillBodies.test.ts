import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { bmcSkillBody } from "./bmc";
import { growthOsDiagnosticSkillBody } from "./growthOsDiagnostic";
import { leadEngineSkillBody } from "./leadEngine";
import { leanCanvasSkillBody } from "./leanCanvas";
import { moneyModelDesignerSkillBody } from "./moneyModelDesigner";
import { offerArchitectSkillBody } from "./offerArchitect";
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
];

describe("evaluation/specialist skill bodies (BEVL-01) — md ↔ ts no-drift", () => {
  test.each(bodies)("%s.md === its derived constant (byte-identical, LF-normalized)", (base, body) => {
    const mdPath = fileURLToPath(new URL(`../../skills/${base}.md`, import.meta.url));
    expect(lf(body)).toBe(lf(readFileSync(mdPath, "utf8")));
  });
});
