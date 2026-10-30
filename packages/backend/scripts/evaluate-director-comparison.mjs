// Offline evaluation only. Never executes supplied text, loads credentials or makes provider calls.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { directorComparisonManifest } from "./prepare-director-comparison.mjs";

const core = new URL("../../core/src/", import.meta.url).href;
// Node 24 strips these trusted local TS modules. Resolve only their extensionless relative
// imports, so the check uses the production parser rather than a second markdown implementation.
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (context.parentURL?.startsWith(core) && /^\.\/[\w]+$/.test(specifier))
      return nextResolve(`${specifier}.ts`, context);
    return nextResolve(specifier, context);
  },
});
const { parseVariations } = await import(new URL("storyboard.ts", core));
const { validateNativeSceneDeck } = await import(new URL("nativeMedia.ts", core));
const hash = (text) => createHash("sha256").update(text).digest("hex");
const sha = (value) => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const finite = (value) => typeof value === "number" && Number.isFinite(value) && value >= 0;

export function evaluateDirectorComparison(input, manifest = directorComparisonManifest()) {
  if (!input || !Array.isArray(input.runs) || input.runs.length === 0 || input.runs.length > 24)
    throw new Error("EXPECTED_ONE_TO_24_SUPPLIED_RUNS");
  const seen = new Set();
  const rows = input.runs.map((run) => {
    const scenario = manifest.cases.find((item) => item.id === run.caseId);
    if (!scenario || !manifest.candidates.includes(run.requestedModel))
      throw new Error("UNKNOWN_CASE_OR_CANDIDATE");
    if (!Number.isInteger(run.repetition) || run.repetition < 1 || run.repetition > 3)
      throw new Error("REPETITION_MUST_BE_ONE_TO_THREE");
    const key = `${run.caseId}:${run.repetition}:${run.requestedModel}`;
    if (seen.has(key)) throw new Error("DUPLICATE_RUN");
    seen.add(key);
    if (typeof run.output !== "string" || Buffer.byteLength(run.output) > 100_000)
      throw new Error("OUTPUT_MUST_BE_BOUNDED_TEXT");
    if (
      !run.pins ||
      !sha(run.pins.briefSha256) ||
      !sha(run.pins.brandSha256) ||
      !sha(run.pins.vaultFixtureSha256) ||
      !sha(run.pins.skillSha256) ||
      !Number.isInteger(run.pins.brandRevision) ||
      run.pins.brandRevision < 1 ||
      !Array.isArray(run.pins.productReferences) ||
      run.pins.productReferences.length < 1 ||
      run.pins.productReferences.length > 3 ||
      !run.pins.productReferences.every(sha)
    )
      throw new Error("MISSING_APPROVED_INPUT_PINS");
    const failures = [];
    if (run.pins.skillSha256 !== manifest.skillSha256) failures.push("skill_changed");
    if (run.pins.briefSha256 !== hash(scenario.brief)) failures.push("brief_changed");
    if (run.executedModel !== run.requestedModel || run.fallbackUsed !== false)
      failures.push("model_or_fallback_mismatch");
    if (!finite(run.elapsedMs) || run.elapsedMs > 90_000) failures.push("production_timeout");
    if (!finite(run.providerCostUsd)) failures.push("cost_unresolved");
    const parsed = parseVariations(run.output);
    const scenes = [];
    if (parsed.kind !== "two") failures.push(`two_variations_required:${parsed.kind}`);
    else
      for (const variation of ["a", "b"]) {
        const deck = parsed[variation].deck;
        const native = validateNativeSceneDeck(deck);
        if (deck.targetDurationSeconds !== scenario.seconds)
          failures.push(`${variation}:wrong_duration`);
        if (!native.ok) failures.push(`${variation}:${native.reason}`);
        if (!deck.scenes.some((scene) => scene.narration?.trim()))
          failures.push(`${variation}:missing_narration`);
        scenes.push({ variation, scenes: deck.scenes });
      }
    // Scores must be supplied by a human reviewer; keyword matching cannot judge a coherent film.
    let review = null;
    if (run.review !== undefined) {
      if (
        !run.review ||
        typeof run.review.reviewer !== "string" ||
        !run.review.reviewer.trim() ||
        typeof run.review.notes !== "string" ||
        !run.review.notes.trim() ||
        !Array.isArray(run.review.scores) ||
        run.review.scores.length !== manifest.rubric.length ||
        !run.review.scores.every((score) => Number.isInteger(score) && score >= 0 && score <= 4) ||
        typeof run.review.groundedClaims !== "boolean" ||
        typeof run.review.productIsolation !== "boolean"
      )
        throw new Error("INCOMPLETE_HUMAN_REVIEW");
      review = run.review;
      if (!review.groundedClaims) failures.push("ungrounded_claims");
      if (!review.productIsolation) failures.push("product_isolation_failed");
    }
    return {
      key,
      caseId: run.caseId,
      repetition: run.repetition,
      model: run.requestedModel,
      outputSha256: hash(run.output),
      pins: run.pins,
      failures,
      review,
      elapsedMs: run.elapsedMs ?? null,
      providerCostUsd: run.providerCostUsd ?? null,
      output: run.output,
      scenes,
    };
  });
  for (const row of rows) {
    const peer = rows.find(
      (other) =>
        other.caseId === row.caseId &&
        other.repetition === row.repetition &&
        other.model !== row.model,
    );
    if (!peer) row.failures.push("missing_paired_candidate");
    else if (JSON.stringify(row.pins) !== JSON.stringify(peer.pins))
      row.failures.push("paired_inputs_differ");
  }
  // Review labels intentionally omit model and receipt fields. Export only this packet for the
  // reviewer; do not claim blind review merely because a caller supplied scores.
  const reviewPacket = rows.map((row, index) => ({
    label: `Output ${index + 1}`,
    caseId: row.caseId,
    repetition: row.repetition,
    outputSha256: row.outputSha256,
    output: row.output,
    rubric: manifest.rubric,
    questions: [
      "Are all claims supported by approved sources?",
      "Are brand and product references isolated correctly?",
    ],
  }));
  return {
    status: "offline_supplied_outputs_checked",
    paidCalls: 0,
    productionDefaultChanged: false,
    receiptTrust:
      "Input pins, model execution, timing and cost are supplied claims; verify against the production run receipts before promotion.",
    creativeReviewComplete: rows.every((row) => row.review !== null),
    structurallyEligible: rows.every((row) => row.failures.length === 0),
    promotionAllowed: false,
    runs: rows.map(({ output, scenes, ...row }) => ({
      ...row,
      scenes: scenes.map(({ variation, scenes: deck }) => ({ variation, sceneCount: deck.length })),
      creativeTotal: row.review ? row.review.scores.reduce((sum, score) => sum + score, 0) : null,
    })),
    reviewPacket,
  };
}

export function main(argv = process.argv.slice(2)) {
  if (argv.length !== 2 || argv[0] !== "--input")
    throw new Error(
      "Usage: node scripts/evaluate-director-comparison.mjs --input supplied-runs.json",
    );
  const bytes = readFileSync(resolve(argv[1]));
  if (bytes.length > 2_000_000) throw new Error("INPUT_TOO_LARGE");
  const report = evaluateDirectorComparison(JSON.parse(bytes.toString("utf8")));
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  return report.structurallyEligible ? 0 : 1;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = main();
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 2;
  }
}
