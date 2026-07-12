// @vitest-environment node
//
// Static-scan enforcement of the redact-then-model contract (GRDL-01/02). The model
// surface (llm.ts) must be structurally incapable of reading raw goal text or leaking
// raw PII, and its only system prompt must come from the skills registry (CLAUDE.md §5).
// Mirrors auditImmutability.test.ts's on-disk readSource pattern; runs in `node`.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";

const convexDir = dirname(fileURLToPath(import.meta.url));
const readSource = (file: string): string => readFileSync(join(convexDir, file), "utf8");

test("llm.ts cannot reach raw goal text (no getForDelivery, no .goal)", () => {
  const src = readSource("llm.ts");
  // The fail-closed reader (getSafeTextByHash) is the ONLY text source — the raw-goal
  // reader and the .goal field must be structurally absent (GRDL-01/02).
  expect(src).not.toMatch(/getForDelivery/);
  expect(src).not.toMatch(/\.goal\b/);
  expect(src).toMatch(/getSafeTextByHash/);
});

test("raw PII entities never appear in the model/guard/pipeline surface", () => {
  // scanText returns { safeText, counts, entities }; `entities` is the raw-PII field and
  // must never be destructured here — only safeText/counts may cross (CLAUDE.md §4).
  for (const file of ["llm.ts", "guardrails.ts", "pipeline.ts"]) {
    expect(readSource(file), `${file} references raw PII entities`).not.toMatch(/entities/);
  }
});

test("llm.ts uses ONLY skill.body as the system prompt (no hardcoded prompts)", () => {
  const src = readSource("llm.ts");
  const allSystem = src.match(/system:/g) ?? [];
  const skillSystem = src.match(/system:\s*skill\.body/g) ?? [];
  // Every `system:` occurrence must be `system: skill.body` — prompts load from the
  // registry, never hardcoded in source (CLAUDE.md §5).
  expect(allSystem.length).toBeGreaterThan(0);
  expect(skillSystem.length).toBe(allSystem.length);
});
