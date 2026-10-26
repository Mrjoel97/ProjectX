import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { evaluateDirectorComparison } from "./evaluate-director-comparison.mjs";
import { directorComparisonManifest } from "./prepare-director-comparison.mjs";

const manifest = directorComparisonManifest();
const hash = (text) => createHash("sha256").update(text).digest("hex");
const variation = (name) => `VARIATION ${name}
SCRIPT
Meet Forma. Make room for your day.
SCENE DECK
Target duration: 15
| # | Visual | Seconds | Description | Narration | Text overlay | Asset |
|---|---|---|---|---|---|---|
| 1 | generated_video | 15 | Wide black bottle reveal with camera rising from base to eye level | Meet Forma. Make room for your day. | FORMA | |
SCENE PROMPTS
Scene 1
Prompt: A black bottle stands on a stone plinth. Camera starts wide at the base and rises to eye level, then holds. Golden side light reveals the cap. Native voice and ambience.
Settings: 9:16, 720x1280, 15 seconds
`;
const body = `${variation("A")}\n${variation("B")}`;
const pair = () => ({
  runs: manifest.candidates.map((model) => ({
    caseId: "forma-15",
    repetition: 1,
    requestedModel: model,
    executedModel: model,
    fallbackUsed: false,
    elapsedMs: 30000,
    providerCostUsd: 0.01,
    pins: {
      skillSha256: manifest.skillSha256,
      briefSha256: hash(manifest.cases[0].brief),
      brandSha256: hash("approved kit"),
      brandRevision: 1,
      vaultFixtureSha256: hash("fixture"),
      productReferences: [hash("black bottle")],
    },
    output: body,
  })),
});
test("real production parser accepts paired native decks but does not invent creative review or promote", () => {
  const report = evaluateDirectorComparison(pair());
  assert.equal(report.structurallyEligible, true, JSON.stringify(report.runs));
  assert.equal(report.creativeReviewComplete, false);
  assert.equal(report.promotionAllowed, false);
  assert.equal(report.paidCalls, 0);
  assert.equal(JSON.stringify(report.reviewPacket).includes("moonshotai"), false);
});
test("duration, unsupported native assets, fallback, stale skill and mismatched references refuse", () => {
  const input = pair();
  input.runs[0].output = body.replaceAll("generated_video", "stock_video");
  input.runs[0].fallbackUsed = true;
  input.runs[0].pins.skillSha256 = hash("old skill");
  input.runs[1].pins.productReferences = [hash("different bottle")];
  const report = evaluateDirectorComparison(input);
  assert.equal(report.structurallyEligible, false);
  assert.ok(report.runs[0].failures.includes("model_or_fallback_mismatch"));
  assert.ok(report.runs[0].failures.includes("skill_changed"));
  assert.ok(report.runs[1].failures.includes("paired_inputs_differ"));
});
test("incomplete pairs and unresolved cost are visible failures", () => {
  const input = pair();
  input.runs.pop();
  input.runs[0].providerCostUsd = null;
  const report = evaluateDirectorComparison(input);
  assert.ok(report.runs[0].failures.includes("cost_unresolved"));
  assert.ok(report.runs[0].failures.includes("missing_paired_candidate"));
});
test("duplicate evidence and incomplete subjective scores are rejected", () => {
  const input = pair();
  input.runs.push(input.runs[0]);
  assert.throws(() => evaluateDirectorComparison(input), /DUPLICATE_RUN/);
  const scored = pair();
  scored.runs[0].review = { scores: [4] };
  assert.throws(() => evaluateDirectorComparison(scored), /INCOMPLETE_HUMAN_REVIEW/);
});
