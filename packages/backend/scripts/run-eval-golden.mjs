// 03.6-04 (EVAL-01): the golden-set live-model eval harness. Drives the REAL
// runCockpitAgent tool-loop against a dev deployment, one scripted natural-language
// conversation per fixture in ./eval-cases/, asserting on plan/tool STATE (never
// reply text — locked) plus the standing invariants (zero requests rows for the
// throwaway eval tenant, fixture needles absent from every log plane).
//
// A real send is impossible by construction: no Approve ever happens (executePlan
// is the sole workflow.start site) and the eval tenant has no Gmail token — and
// assertEvalCaseClean asserts it anyway.
//
// Invocation (locked): pnpm eval:golden [--skill <name>@<version>] [--only <id-substring>]
//   --skill      pin that skill version on every turn; an all-green pinned run
//                records refs/counts-only evidence via skills:recordEvalEvidence
//                (the EVAL_GATE input for activateSkill).
//   --only       DIAGNOSTIC ONLY — run just the fixtures whose id contains this
//                substring. A filtered run is NOT the gate and records NO evidence.
//   --self-check offline validation (ZERO convex calls): fixture vocabulary,
//                cap/pin/filter logic — the ponytail one-runnable-check.
//
// Exit codes: 0 all green · 1 any case failure · 2 environment abort (governed
// stop or cost cap — never an eval failure).
//
// Mirrors run-smoke-*.mjs conventions: `must()` judges success by CLI OUTPUT
// (Windows/Node24 exit-code crash), `convex run` prints the return value as JSON
// on stdout (logs go to stderr).

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { must } from "./smokeRun.mjs";

const parse = (out) => JSON.parse(out);
const casesDir = resolve(dirname(fileURLToPath(import.meta.url)), "eval-cases");

// Hard per-run cost cap (discretion default; expected actuals $0.05–0.15 at
// gpt-4o-mini). Cumulative costUsd beyond this ABORTS the run (exit 2).
// 16-09: raised 1.0 → 2.0 BECAUSE the cap became honest, not because spending grew. Until the
// cost-merge below, `caseCost` summed only the SYNCHRONOUS executive turn; the research specialist
// bills asynchronously (~$0.21/case, measured) and was invisible to `overCap`. Now that the cap can
// finally see that money, a full 33-case gate lands at ~$0.83 clean and ~$1.06 with ONE research
// retry — so the old 1.0 would abort the very run ACTN-03 needs the evidence row from, after paying
// for most of it. 2.0 is a real ceiling for the honest total, not a licence to spend more.
const COST_CAP_USD = 2.0;

// 15-06: how long a tapped gap's SCHEDULED specialist dispatch gets to leave `collecting`.
// `landSpecialistResult` runs in a `finally` on every outcome (success, overrun, the four governed
// refusals, a throw), so a row still at `collecting` past this means the deployment never ran the
// job — an environment problem, not a case failure.
// 16-09: raised 150_000 → 210_000. MEASURED: the first-ever successful research dispatch
// (`eval-a096684d`, fixture 32) took 171,046 ms — 21s LONGER than the old timeout. At 150s every
// research fixture would time out on attempt 1, burn its ~$0.21 of specialist spend invisibly
// (the dispatch keeps billing after the runner stops waiting), retry on a fresh thread, and time
// out again — doubling the bill AND failing on `researchDocPresent` for a purely harness reason.
// 210s bounds the specialist's own hard wall (`RESEARCH_CALL_TIMEOUT_MS = 180_000`) with margin.
const DISPATCH_TIMEOUT_MS = 210_000;
const DISPATCH_POLL_MS = 3_000;

// The needle `vaultSmoke:seedCorpus` stamps into every seeded brief's TITLE and BODY. It is what
// makes `citesVaultDoc` NON-VACUOUS: this token exists nowhere in any fixture's turns (asserted in
// --self-check), so it can only reach a specialist's memo through a live `searchVault` result.
const VAULT_NEEDLE = "evalgrd";
const INSUFFICIENT_EVIDENCE_PHRASE = "insufficient evidence";

// The gated skills — the only valid --skill pin targets — DERIVED from GATED_SKILLS
// (packages/contracts/src/skill.ts), never re-listed here. The old hardcoded
// ["cockpit-agent","document-drafter","inbox-digest"] excluded `reply-drafter` AND all seven Phase-12
// rubric/specialist skills, so `--skill offer-architect@N` threw before it could ever be evaluated.
// A second list is a second thing to drift; deriving means a newly gated skill is pinnable the day
// it is gated. This runner is plain .mjs and cannot import the TS workspace package, so it READS the
// constant off disk — the specialists.test.ts "scan diagnose.ts for its own literals" precedent.
const skillSrcPath = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "contracts",
  "src",
  "skill.ts",
);

function gatedSkillNames() {
  const src = readFileSync(skillSrcPath, "utf8");
  const block = /export const GATED_SKILLS[^=]*=\s*\[([\s\S]*?)\]\s*;/.exec(src);
  if (!block) throw new Error(`GATED_SKILLS not found in ${skillSrcPath}`);
  const idents = block[1]
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return idents.map((id) => {
    if (!/^[A-Z][A-Z0-9_]*$/.test(id))
      throw new Error(`GATED_SKILLS entry "${id}" is not a const name`);
    const m = new RegExp(`export const ${id}\\s*=\\s*"([a-z0-9.-]+)"`).exec(src);
    if (!m) throw new Error(`GATED_SKILLS entry ${id} has no string literal in skill.ts`);
    return m[1];
  });
}

const SKILL_NAMES = gatedSkillNames();

// The DISPATCHABLE routes, read off @pikar/core's registry for the same reason as above: a fixture
// asserting `attributionRoute: "swot"` names a real GATED skill that no gap can ever dispatch to,
// and would fail live for a reason that has nothing to do with the model. Gated ⊃ dispatchable.
const specialistSrcPath = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "core",
  "src",
  "specialists.ts",
);

function specialistRoutes() {
  const src = readFileSync(specialistSrcPath, "utf8");
  const block = /export const SPECIALIST_ROUTES\s*=\s*\[([\s\S]*?)\]\s*as const/.exec(src);
  if (!block) throw new Error(`SPECIALIST_ROUTES not found in ${specialistSrcPath}`);
  return [...block[1].matchAll(/"([a-z0-9-]+)"/g)].map((m) => m[1]);
}

const SPECIALIST_ROUTES = specialistRoutes();

// CLOSED expect vocabulary. The runner rejects any fixture using anything else
// BEFORE the first spawn — a bad fixture must never cost a cent.
const EXPECT_KEYS = new Set([
  "status",
  "statusAtMost",
  "recipients",
  "recipientCount",
  "mode",
  "subjectPresent",
  "bodyPresent",
  "attachmentCount",
  "attachmentError",
  "candidatesPending",
  // 03.7-05: the harness's first NON-plan assertion. Read from smoke:briefingCountForThread,
  // not from the plan row — a briefing case must FAIL when briefInbox never produced a
  // briefing, or it silently "passes" on the not_connected branch measuring nothing
  // (research Pitfall 3).
  "briefingPresent",
  // 03.7-09: the lede assertion. Read from smoke:briefingSynopsisPresent (the latest briefing's
  // trimmed synopsis is non-empty) — a briefing case must FAIL when the live synthesis returned
  // a blank lede, the same anti-silent-pass discipline as briefingPresent applied to the synopsis.
  "ledePresent",
  // 12-06 (BEVL-01): the evaluation observables, same briefingPresent shape — read from the
  // evaluations table, not the plan row.
  //   evaluationPresent — smoke:evaluationCountForThread > 0. An assessment case FAILS when the
  //     agent answered "evaluate my business" in prose and never called evaluateBusiness.
  //   findingsPresent   — smoke:findingCountForThread > 0. The ANTI-VACUOUS companion to gapCount:
  //     the engine force-clears gaps when there are zero grounded findings (SC #1), so gapCount:0
  //     alone passes on the honest thin-data verdict just as happily as on a healthy business.
  //   gapCount          — smoke:gapCountForThread, the latest row's leverage-ranked gaps. 0 with
  //     findingsPresent is the affirmative healthy outcome (SC #2).
  "evaluationPresent",
  "findingsPresent",
  "gapCount",
  // Phase 16 (ACTN-03): research is dispatched by the EXECUTIVE agent's own tool call and leaves
  // a memo plan, but it never goes through actOnGap. Do not copy the dispatch keys' actOnGap rule:
  // that near-match would reject every legitimate research fixture before the first spawn.
  //   researchDocPresent    — smoke:researchCountForThread > 0. The ANTI-VACUOUS companion for
  //     the other two keys: a reply or memo alone is not a persisted, groundable research run.
  //   insufficientEvidence — the CODE-owned label on the stored web_research document, never a
  //     regex over model reply prose. Meaningful only with researchDocPresent:true.
  //   webSearchCallsAtLeast — the subagent.completed webSearchCalls COUNT, as an integer FLOOR.
  //     Meaningful only with researchDocPresent:true; validateFixture rejects a vacuous zero.
  "researchDocPresent",
  "insufficientEvidence",
  "webSearchCallsAtLeast",
  // 15-06 (DISP-01): the dispatched-specialist observables. They are only meaningful on a fixture
  // that also carries `actOnGap` — validateFixture enforces the pairing, because all three read a
  // plan row that a non-dispatching case never stages.
  //   planKind         — plans.kind. "memo" alongside status "proposed" IS the collecting→proposed
  //     flip: landSpecialistResult is the only writer that performs it, so the pair proves the
  //     scheduled dispatch actually completed rather than the tap merely staging a row.
  //   attributionRoute — the specialist named by specialistMemoBody's leading attribution line. A
  //     body that came from the buildMemo FALLBACK (a refusal, a throw) carries no such line, so
  //     this is what separates "the specialist ran" from "the plan reached proposed".
  //   citesVaultDoc    — the seeded vault corpus needle appears in the body. Non-vacuous by
  //     construction: no fixture turn may contain that token (--self-check asserts it), so it can
  //     only have arrived through a live searchVault result.
  "planKind",
  "attributionRoute",
  "citesVaultDoc",
]);

// The pinned plans lifecycle order (schema.ts) — statusAtMost compares indices.
const STATUS_ORDER = [
  "collecting",
  "proposed",
  "approved",
  "scheduled",
  "delivering",
  "done",
  "canceled",
];

// ── fixture loading + validation (offline) ───────────────────────────────────

function validateFixture(fx, source) {
  const fail = (msg) => {
    throw new Error(`bad fixture ${source}: ${msg}`);
  };
  if (!fx || typeof fx !== "object") fail("not an object");
  if (typeof fx.id !== "string" || fx.id.length === 0) fail("missing id");
  if (!Array.isArray(fx.turns) || fx.turns.length === 0) fail("turns must be a non-empty array");
  for (const t of fx.turns) {
    if (typeof t !== "string" || t.trim().length === 0) fail("empty turn");
    // llm.ts short-circuits sentinels BEFORE generateText — a sentinel eval measures nothing.
    if (t.startsWith("SMOKE::")) fail("SMOKE:: sentinel turn is forbidden in eval fixtures");
  }
  if (!fx.expect || typeof fx.expect !== "object") fail("missing expect block");
  for (const key of Object.keys(fx.expect)) {
    if (!EXPECT_KEYS.has(key)) fail(`unknown expect key "${key}" (closed vocabulary)`);
  }
  if ((fx.expect.status ?? fx.expect.statusAtMost) !== undefined) {
    const s = fx.expect.status ?? fx.expect.statusAtMost;
    if (!STATUS_ORDER.includes(s)) fail(`unknown status "${s}"`);
  }
  if (!Array.isArray(fx.needles) || fx.needles.length === 0) fail("must list at least one needle");
  // 15-06: `actOnGap` is the gap INDEX to tap after the turns (the "Act on this" control), which
  // runs the real evaluations→dispatch→landSpecialistResult path.
  if (fx.actOnGap !== undefined) {
    if (!Number.isInteger(fx.actOnGap) || fx.actOnGap < 0)
      fail("actOnGap must be a gap index >= 0");
    // Pair it with a gap assertion. Tapping index N on an evaluation that surfaced no gap returns
    // `gap_not_found` and nothing dispatches, so a dispatch fixture that never asserts a gap exists
    // is measuring the tap's refusal path, not the specialist (12-06's vacuous-pass lesson).
    if (!(fx.expect.gapCount > fx.actOnGap)) {
      fail(`actOnGap ${fx.actOnGap} requires expect.gapCount > ${fx.actOnGap}`);
    }
  }
  for (const key of ["planKind", "attributionRoute", "citesVaultDoc"]) {
    if (fx.expect[key] !== undefined && fx.actOnGap === undefined) {
      fail(`expect.${key} requires actOnGap (nothing dispatches without the tap)`);
    }
  }
  for (const key of ["insufficientEvidence", "webSearchCallsAtLeast"]) {
    if (fx.expect[key] !== undefined && fx.expect.researchDocPresent !== true) {
      fail(`expect.${key} requires researchDocPresent:true (the anti-vacuity companion)`);
    }
  }
  if (
    fx.expect.webSearchCallsAtLeast !== undefined &&
    (!Number.isInteger(fx.expect.webSearchCallsAtLeast) || fx.expect.webSearchCallsAtLeast < 1)
  ) {
    fail("expect.webSearchCallsAtLeast must be an integer >= 1 (a zero floor is vacuous)");
  }
  if (
    fx.expect.attributionRoute !== undefined &&
    !SPECIALIST_ROUTES.includes(fx.expect.attributionRoute)
  ) {
    fail(`attributionRoute "${fx.expect.attributionRoute}" is not a registered specialist route`);
  }
  if (fx.turns.some((t) => t.includes(VAULT_NEEDLE))) {
    fail(
      `a turn contains the vault corpus needle "${VAULT_NEEDLE}" — that makes citesVaultDoc vacuous`,
    );
  }
  if (fx.turns.some((t) => t.toLowerCase().includes(INSUFFICIENT_EVIDENCE_PHRASE))) {
    fail(
      `a turn contains "${INSUFFICIENT_EVIDENCE_PHRASE}" — that makes the stored verdict probe vacuous`,
    );
  }
  return fx;
}

function loadFixtures() {
  const files = readdirSync(casesDir)
    .filter((f) => f.endsWith(".json"))
    .sort();
  return files.map((f) => validateFixture(JSON.parse(readFileSync(join(casesDir, f), "utf8")), f));
}

// ── --skill pin parsing ──────────────────────────────────────────────────────

function parseSkillPin(spec) {
  const m = /^([a-z0-9-]+)@(\d+)$/.exec(spec ?? "");
  if (!m)
    throw new Error(
      `malformed --skill "${spec}" (expected <name>@<version>, e.g. cockpit-agent@3)`,
    );
  const [, name, versionStr] = m;
  if (!SKILL_NAMES.includes(name)) {
    throw new Error(`unknown --skill name "${name}" (gated skills: ${SKILL_NAMES.join(", ")})`);
  }
  return { name, version: Number(versionStr) };
}

/**
 * 15-06: `--skill` is MULTI-pin. Every occurrence is collected, so ONE run (one cost, one sitting)
 * can certify several candidates at once — the runner records one evidence row PER pin off that
 * same run. A repeated NAME is rejected: two versions of one skill is a bug, not a request.
 */
function parseSkillPins(argv) {
  const pins = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] !== "--skill") continue;
    const pin = parseSkillPin(argv[i + 1]);
    if (pins.some((p) => p.name === pin.name)) {
      throw new Error(`--skill ${pin.name} pinned twice (two versions of one skill is a bug)`);
    }
    pins.push(pin);
  }
  return pins;
}

/** The merged record threaded into every turn AND recorded on every evidence row: the run really
 *  did carry all of these versions, so each pin's evidence must say so. */
const skillVersionsOf = (pins) => Object.fromEntries(pins.map((p) => [p.name, p.version]));

// ── --only fixture filter (DIAGNOSTIC; never the gate) ───────────────────────

/**
 * 16-09: `--only <id-substring>` restricts the run to matching fixtures. Motivation is measured, not
 * theoretical: fixtures 32-34 sit LAST in sorted order, so both attempts to get a verdict on them
 * died to an environment failure (a broken dep tree, then the deployment exiting mid-run) AFTER the
 * 30 earlier cases had already been paid for. Re-testing the tail cost a full ~$0.22 each time.
 * Multi-occurrence like `--skill`. A filter matching NOTHING is an error, not an empty run — a typo
 * must not silently shrink the gate to zero cases and then report "all green".
 */
function parseOnlyFilters(argv) {
  const filters = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] !== "--only") continue;
    const value = argv[i + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`--only requires a value (e.g. --only research)`);
    }
    filters.push(value);
  }
  return filters;
}

/** Applies the filters, rejecting any that match no fixture. Returns the FULL set when none given,
 *  so the unfiltered path is byte-for-byte the behaviour that existed before this flag. */
function applyOnly(fixtures, filters) {
  if (!filters.length) return fixtures;
  for (const s of filters) {
    if (!fixtures.some((f) => f.id.includes(s))) {
      throw new Error(`--only "${s}" matched no fixture (ids: ${fixtures.map((f) => f.id).join(", ")})`);
    }
  }
  return fixtures.filter((f) => filters.some((s) => f.id.includes(s)));
}

// ── expect evaluation (plan/briefing STATE, never reply text) ────────────────

/** @param briefingCount rows smoke:briefingCountForThread returned for the case's thread
 *  (0 when the fixture does not ask for `briefingPresent` — the read is skipped).
 *  @param synopsisPresent smoke:briefingSynopsisPresent for the case's thread (false when the
 *  fixture does not ask for `ledePresent` — the read is skipped).
 *  @param evaluationCount smoke:evaluationCountForThread (0 when unasked — read skipped).
 *  @param findingCount smoke:findingCountForThread, the LATEST row's findings (0 when unasked).
 *  @param gapCount smoke:gapCountForThread, the LATEST row's gaps (0 when unasked).
 *  @param vaultNeedle the token vaultSmoke:seedCorpus stamped into every seeded brief — the
 *  `citesVaultDoc` probe. "" when unasked (offline self-check), which makes the key fail closed.
 *  @param researchCount smoke:researchCountForThread (0 when unasked — read skipped).
 *  @param insufficientEvidence smoke:researchInsufficientEvidenceForThread (false when unasked).
 *  @param webSearchCalls smoke:webSearchCallsForThread (0 when unasked — read skipped). */
function evaluateExpect(
  expect,
  plan,
  briefingCount = 0,
  synopsisPresent = false,
  evaluationCount = 0,
  findingCount = 0,
  gapCount = 0,
  vaultNeedle = "",
  researchCount = 0,
  insufficientEvidence = false,
  webSearchCalls = 0,
) {
  const failures = [];
  const miss = (key, expected, actual) => failures.push({ key, expected, actual });
  const present = (s) => typeof s === "string" && s.length > 0;

  for (const [key, expected] of Object.entries(expect)) {
    switch (key) {
      case "status":
        if (plan.status !== expected) miss(key, expected, plan.status);
        break;
      case "statusAtMost":
        if (STATUS_ORDER.indexOf(plan.status) > STATUS_ORDER.indexOf(expected)) {
          miss(key, `<= ${expected}`, plan.status);
        }
        break;
      case "recipients": {
        const actual = plan.recipients ?? [];
        if (actual.length !== expected.length || expected.some((r, i) => actual[i] !== r)) {
          miss(key, expected, actual);
        }
        break;
      }
      case "recipientCount":
        if ((plan.recipients ?? []).length !== expected)
          miss(key, expected, (plan.recipients ?? []).length);
        break;
      case "mode":
        if (plan.mode !== expected) miss(key, expected, plan.mode);
        break;
      case "subjectPresent":
        if (present(plan.subject) !== expected) miss(key, expected, present(plan.subject));
        break;
      case "bodyPresent":
        if (present(plan.body) !== expected) miss(key, expected, present(plan.body));
        break;
      case "attachmentCount":
        if ((plan.attachments ?? []).length !== expected)
          miss(key, expected, (plan.attachments ?? []).length);
        break;
      case "attachmentError":
        if ((plan.attachmentError !== undefined && plan.attachmentError !== null) !== expected) {
          miss(key, expected ? "present" : "absent", plan.attachmentError ?? "absent");
        }
        break;
      case "candidatesPending":
        if ((plan.candidates ?? []).length > 0 !== expected) {
          miss(key, expected, (plan.candidates ?? []).length > 0);
        }
        break;
      case "briefingPresent":
        if (briefingCount > 0 !== expected) miss(key, expected, briefingCount > 0);
        break;
      case "ledePresent":
        // FAIL when the live synthesis returned a blank lede but the fixture expects one.
        if (synopsisPresent !== expected) miss(key, expected, synopsisPresent);
        break;
      case "evaluationPresent":
        if (evaluationCount > 0 !== expected) miss(key, expected, evaluationCount > 0);
        break;
      case "findingsPresent":
        if (findingCount > 0 !== expected) miss(key, expected, findingCount > 0);
        break;
      case "gapCount":
        if (gapCount !== expected) miss(key, expected, gapCount);
        break;
      case "researchDocPresent":
        if (researchCount > 0 !== expected) miss(key, expected, researchCount > 0);
        break;
      case "insufficientEvidence":
        if (insufficientEvidence !== expected) miss(key, expected, insufficientEvidence);
        break;
      case "webSearchCallsAtLeast":
        if (webSearchCalls < expected) miss(key, `>= ${expected}`, webSearchCalls);
        break;
      case "planKind":
        if (plan.kind !== expected) miss(key, expected, plan.kind ?? "absent");
        break;
      case "attributionRoute": {
        // specialistMemoBody puts this FIRST, so match the prefix — a fallback memo (refusal,
        // throw, empty reply) starts with "# Next step" and fails here.
        const line = `> Produced by the **${expected}** specialist.`;
        if (!present(plan.body) || !plan.body.startsWith(line)) {
          miss(key, line, present(plan.body) ? plan.body.slice(0, line.length) : "empty body");
        }
        break;
      }
      case "citesVaultDoc": {
        const cited =
          vaultNeedle.length > 0 && present(plan.body) && plan.body.includes(vaultNeedle);
        if (cited !== expected) miss(key, expected, cited);
        break;
      }
    }
  }
  return failures;
}

// ── cost cap ─────────────────────────────────────────────────────────────────

function overCap(totalCost, cap = COST_CAP_USD) {
  return totalCost > cap;
}

/** 22.1: the printable cost. A dispatch case's money is dominated by the ASYNC specialist turn
 *  ($0.0169 exec + $0.2085 specialist on 32-research-grounded), so hiding it inside one number
 *  makes the run look ten times cheaper than it is. Non-dispatch cases (specialistCost 0) print
 *  BYTE-IDENTICALLY to before — no split where there is nothing to split. */
function formatCost(caseCost, specialistCost = 0) {
  return specialistCost > 0
    ? `$${(caseCost - specialistCost).toFixed(4)} exec + $${specialistCost.toFixed(4)} specialist` +
        ` = $${caseCost.toFixed(4)}`
    : `$${caseCost.toFixed(4)}`;
}

// ── offline self-check (ZERO convex calls; plain assert, no framework) ───────

function selfCheck() {
  // 1. Every real fixture parses, has non-empty turns, needles, closed vocabulary.
  const fixtures = loadFixtures();
  // Floor bumped 18 → 27 (the two BEVL-01 assessment fixtures) → 30 (the three DISP-01
  // gap→tap→dispatch fixtures) → 33 (the three Phase-16 research fixtures). The floor is a deletion
  // tripwire: a fixture quietly dropped must not quietly shrink the gate.
  assert.ok(fixtures.length >= 33, `expected >= 33 fixtures, found ${fixtures.length}`);
  const ids = new Set(fixtures.map((f) => f.id));
  assert.equal(ids.size, fixtures.length, "fixture ids must be unique");

  // 2. Synthetic bad fixtures (in-memory, never on disk) are rejected.
  const base = { id: "x", turns: ["hello there"], expect: { status: "proposed" }, needles: ["n"] };
  assert.throws(
    () => validateFixture({ ...base, expect: { replyContains: "ok" } }, "<synthetic>"),
    /unknown expect key/,
    "unknown expect key must be rejected",
  );
  assert.throws(
    () => validateFixture({ ...base, turns: ["SMOKE::agent:: do things"] }, "<synthetic>"),
    /SMOKE:: sentinel/,
    "SMOKE::-prefixed turn must be rejected",
  );
  assert.throws(
    () => validateFixture({ ...base, turns: [] }, "<synthetic>"),
    /non-empty array/,
    "empty turns must be rejected",
  );
  assert.throws(
    () => validateFixture({ ...base, needles: [] }, "<synthetic>"),
    /at least one needle/,
    "missing needles must be rejected",
  );
  // briefingPresent is IN the closed vocabulary (and only via the vocabulary — the rejection
  // above still bites for anything else).
  assert.ok(
    validateFixture({ ...base, expect: { briefingPresent: true } }, "<synthetic>"),
    "briefingPresent must be an accepted expect key",
  );
  assert.ok(
    validateFixture({ ...base, expect: { ledePresent: true } }, "<synthetic>"),
    "ledePresent must be an accepted expect key",
  );

  // 2b. briefingPresent evaluates against the BRIEFING COUNT, not the plan — the assertion that
  // makes Pitfall 3 impossible. A briefing case with zero briefings rows MUST fail; anything
  // less and the not_connected branch passes vacuously.
  const collecting = { status: "collecting" };
  assert.equal(
    evaluateExpect({ briefingPresent: true }, collecting, 1).length,
    0,
    "briefingPresent:true must pass when the thread has a briefing",
  );
  assert.equal(
    evaluateExpect({ briefingPresent: true }, collecting, 0).length,
    1,
    "briefingPresent:true MUST FAIL when no briefing was produced (Pitfall 3)",
  );
  assert.equal(
    evaluateExpect({ briefingPresent: false }, collecting, 1).length,
    1,
    "briefingPresent:false must fail when a briefing WAS produced",
  );

  // 2c. ledePresent evaluates against the SYNOPSIS READ, not the plan — a briefing whose live
  // synthesis returned a blank lede MUST fail (Pitfall 3 applied to the synopsis). The 4th
  // positional arg is smoke:briefingSynopsisPresent; the read defaults to false when unasked.
  assert.equal(
    evaluateExpect({ ledePresent: true }, collecting, 1, true).length,
    0,
    "ledePresent:true must pass when the latest briefing has a non-empty synopsis",
  );
  assert.equal(
    evaluateExpect({ ledePresent: true }, collecting, 1, false).length,
    1,
    "ledePresent:true MUST FAIL when the synopsis read is false (empty lede — Pitfall 3)",
  );

  // 2d. 12-06 (BEVL-01): the evaluation keys are IN the closed vocabulary and evaluate against the
  // evaluations reads (args 5/6/7), never the plan row.
  for (const expect of [{ evaluationPresent: true }, { findingsPresent: true }, { gapCount: 0 }]) {
    assert.ok(
      validateFixture({ ...base, expect }, "<synthetic>"),
      `${Object.keys(expect)[0]} accepted`,
    );
  }
  assert.equal(
    evaluateExpect({ evaluationPresent: true }, collecting, 0, false, 1).length,
    0,
    "evaluationPresent:true must pass when the thread has an evaluation row",
  );
  assert.equal(
    evaluateExpect({ evaluationPresent: true }, collecting, 0, false, 0).length,
    1,
    "evaluationPresent:true MUST FAIL when evaluateBusiness never ran (prose-only turn)",
  );
  // The anti-vacuous pair: gapCount:0 is the HEALTHY outcome only alongside findingsPresent:true.
  // With zero findings the engine force-clears gaps (SC #1), so gapCount:0 alone passes on the
  // honest thin-data verdict too — findingsPresent is what makes SC #2 a real assertion.
  assert.equal(
    evaluateExpect({ findingsPresent: true, gapCount: 0 }, collecting, 0, false, 1, 2, 0).length,
    0,
    "healthy = findings present AND zero gaps",
  );
  assert.equal(
    evaluateExpect({ findingsPresent: true, gapCount: 0 }, collecting, 0, false, 1, 0, 0).length,
    1,
    "MUST FAIL on the thin-data verdict (no findings) even though gapCount is also 0",
  );
  assert.equal(
    evaluateExpect({ gapCount: 1 }, collecting, 0, false, 1, 1, 0).length,
    1,
    "gapCount:1 MUST FAIL when the diagnosis surfaced no gap",
  );

  // 2e. Phase 16: the research keys are table/audit observables, paired so neither a prose answer
  // nor an absent run can pass. They deliberately require NO actOnGap — the executive dispatches
  // research directly.
  const researchExpect = {
    researchDocPresent: true,
    insufficientEvidence: false,
    webSearchCallsAtLeast: 2,
  };
  assert.ok(
    validateFixture({ ...base, expect: researchExpect }, "<synthetic>"),
    "a paired executive-dispatched research fixture is accepted without actOnGap",
  );
  assert.throws(
    () =>
      validateFixture(
        { ...base, expect: { insufficientEvidence: true } },
        "<synthetic>",
      ),
    /requires researchDocPresent:true/,
    "the verdict without a persisted research document is vacuous",
  );
  assert.throws(
    () =>
      validateFixture(
        { ...base, expect: { webSearchCallsAtLeast: 2 } },
        "<synthetic>",
      ),
    /requires researchDocPresent:true/,
    "the hosted-search floor without a persisted research document is vacuous",
  );
  assert.throws(
    () =>
      validateFixture(
        {
          ...base,
          expect: { researchDocPresent: true, webSearchCallsAtLeast: 0 },
        },
        "<synthetic>",
      ),
    /integer >= 1/,
    "a zero hosted-search floor proves nothing",
  );
  assert.throws(
    () =>
      validateFixture(
        {
          ...base,
          expect: { researchDocPresent: true, webSearchCallsAtLeast: 1.5 },
        },
        "<synthetic>",
      ),
    /integer >= 1/,
    "the hosted-search floor is an integer count",
  );
  assert.throws(
    () =>
      validateFixture(
        { ...base, turns: ["Return insufficient evidence if you cannot find it."] },
        "<synthetic>",
      ),
    /verdict probe vacuous/,
    "a turn cannot supply the phrase the durable verdict probe reads",
  );
  assert.equal(
    evaluateExpect(researchExpect, collecting, 0, false, 0, 0, 0, "", 1, false, 3)
      .length,
    0,
    "a stored grounded run with three searches satisfies the paired observables",
  );
  assert.equal(
    evaluateExpect(researchExpect, collecting, 0, false, 0, 0, 0, "", 0, false, 3)
      .length,
    1,
    "researchDocPresent:true MUST FAIL when no research document was stored",
  );
  assert.equal(
    evaluateExpect(
      { researchDocPresent: true, insufficientEvidence: true },
      collecting,
      0,
      false,
      0,
      0,
      0,
      "",
      1,
      true,
      0,
    ).length,
    0,
    "the durable insufficient-evidence label is observable",
  );
  assert.equal(
    evaluateExpect(researchExpect, collecting, 0, false, 0, 0, 0, "", 1, false, 1)
      .length,
    1,
    "webSearchCallsAtLeast:2 MUST FAIL on a one-shot search",
  );

  // 3. Cost summation + cap logic on synthetic per-turn costs.
  // 16-09: stated as FRACTIONS OF THE CAP, never literal dollars. These previously hardcoded
  // $1.10/$1.00, which asserted the cap's VALUE rather than its LOGIC — so raising COST_CAP_USD
  // for a legitimate reason turned a correct change red. The behaviour under test is "a sum of
  // per-turn costs exceeding the cap trips it", and that is true at any cap.
  const trip = [0.4, 0.4, 0.3].reduce((sum, c) => sum + c * COST_CAP_USD, 0); // 110% of cap
  assert.ok(overCap(trip), "110% of the cap must trip it");
  const under = [0.05, 0.1].reduce((sum, c) => sum + c * COST_CAP_USD, 0); // 15% of cap
  assert.ok(!overCap(under), "15% of the cap must not trip it");
  assert.ok(!overCap(COST_CAP_USD), "exactly the cap does not trip (strictly greater-than)");

  // 4. --skill pin parsing.
  assert.deepEqual(parseSkillPin("cockpit-agent@3"), { name: "cockpit-agent", version: 3 });
  assert.deepEqual(parseSkillPin("document-drafter@12"), { name: "document-drafter", version: 12 });
  // inbox-digest joined GATED_SKILLS in 03.7-03 — it is the one skill whose INPUT is untrusted
  // third-party mail, so a pinned candidate must be evaluable.
  assert.deepEqual(parseSkillPin("inbox-digest@1"), { name: "inbox-digest", version: 1 });
  assert.throws(() => parseSkillPin("cockpit-agent"), /malformed/, "pin without @version rejected");
  assert.throws(
    () => parseSkillPin("cockpit-agent@x"),
    /malformed/,
    "non-numeric version rejected",
  );
  assert.throws(
    () => parseSkillPin("unknown-skill@3"),
    /unknown --skill name/,
    "unknown skill rejected",
  );

  // 4b. 15-06: SKILL_NAMES is DERIVED from GATED_SKILLS, so every gated skill is pinnable and there
  // is no second list to drift. The three Phase-12 specialists are the reason this plan exists —
  // before the derivation `--skill offer-architect@N` threw, and eight of the eleven gated skills
  // were unpinnable. The derivation must also RESOLVE every entry (an unresolved identifier throws
  // in gatedSkillNames, so reaching here means all eleven resolved to string literals).
  assert.ok(SKILL_NAMES.length >= 11, `expected >= 11 gated skills, derived ${SKILL_NAMES.length}`);
  assert.equal(
    new Set(SKILL_NAMES).size,
    SKILL_NAMES.length,
    "derived gated skills must be unique",
  );
  assert.deepEqual(
    SKILL_NAMES,
    gatedSkillNames(),
    "SKILL_NAMES must equal the GATED_SKILLS derivation (no hand-maintained copy)",
  );
  for (const name of [
    "cockpit-agent",
    "document-drafter",
    "inbox-digest",
    "reply-drafter",
    "growth-os-diagnostic",
    "offer-architect",
    "money-model-designer",
    "lead-engine",
  ]) {
    assert.ok(SKILL_NAMES.includes(name), `${name} must be derivable from GATED_SKILLS`);
    assert.deepEqual(parseSkillPin(`${name}@2`), { name, version: 2 }, `${name} must be pinnable`);
  }

  // 5. 15-06: --skill is MULTI-pin — one run, one cost, one sitting certifies all three specialists.
  assert.deepEqual(parseSkillPins([]), [], "no --skill ⇒ no pins");
  const trio = parseSkillPins([
    "--skill",
    "offer-architect@4",
    "--skill",
    "money-model-designer@5",
    "--skill",
    "lead-engine@6",
  ]);
  assert.equal(trio.length, 3, "every --skill occurrence is collected");
  assert.deepEqual(skillVersionsOf(trio), {
    "offer-architect": 4,
    "money-model-designer": 5,
    "lead-engine": 6,
  });
  assert.throws(
    () => parseSkillPins(["--skill", "cockpit-agent@3", "--skill", "cockpit-agent@4"]),
    /pinned twice/,
    "two versions of ONE skill is a bug, not a request",
  );
  assert.throws(
    () => parseSkillPins(["--skill", "offer-architect@3", "--skill", "nope@1"]),
    /unknown --skill name/,
    "a bad name anywhere in the pin list still aborts before the first spawn",
  );

  // 5b. 16-09: the --only diagnostic filter. The properties worth pinning are the SAFETY ones —
  // an unfiltered run is unchanged, a typo aborts instead of running zero cases, and (asserted at
  // the call site's own condition below) a filtered run records no evidence.
  assert.deepEqual(parseOnlyFilters([]), [], "no --only ⇒ no filters");
  assert.deepEqual(parseOnlyFilters(["--only", "research", "--only", "29-"]), ["research", "29-"]);
  assert.throws(
    () => parseOnlyFilters(["--only", "--skill"]),
    /--only requires a value/,
    "a flag swallowed as a value would filter to nothing and report all-green",
  );
  assert.equal(
    applyOnly(fixtures, []).length,
    fixtures.length,
    "no filter ⇒ the FULL set, so the gate path is untouched by this flag",
  );
  const onlyResearch = applyOnly(fixtures, ["research"]);
  assert.equal(onlyResearch.length, 3, "the three Phase-16 research fixtures match `research`");
  assert.ok(
    onlyResearch.every((f) => f.id.includes("research")),
    "a filtered set contains only matching ids",
  );
  assert.throws(
    () => applyOnly(fixtures, ["no-such-fixture"]),
    /matched no fixture/,
    "a typo must abort, never shrink the run to zero cases and then claim green",
  );
  assert.throws(
    () => applyOnly(fixtures, ["research", "typo-here"]),
    /matched no fixture/,
    "every filter must match — one good one does not excuse a bad one",
  );

  // 6. 15-06: the dispatch fixture contract (actOnGap + its three observables).
  const disp = { ...base, actOnGap: 0, expect: { gapCount: 1, planKind: "memo" } };
  assert.ok(validateFixture(disp, "<synthetic>"), "a paired dispatch fixture is accepted");
  assert.throws(
    () => validateFixture({ ...disp, expect: { gapCount: 0, planKind: "memo" } }, "<synthetic>"),
    /requires expect.gapCount/,
    "tapping a gap the evaluation never surfaced measures the refusal path, not the specialist",
  );
  assert.throws(
    () => validateFixture({ ...base, expect: { attributionRoute: "lead-engine" } }, "<synthetic>"),
    /requires actOnGap/,
    "a dispatch observable without the tap can never be satisfied",
  );
  // `swot` is a real GATED skill but not a DISPATCHABLE route — gated ⊃ dispatchable, and the
  // fixture contract is about what a gap can actually dispatch to.
  assert.throws(
    () =>
      validateFixture(
        { ...disp, expect: { gapCount: 1, attributionRoute: "swot" } },
        "<synthetic>",
      ),
    /not a registered specialist route/,
    "attributionRoute must name a route @pikar/core's SPECIALISTS registry resolves",
  );
  assert.deepEqual(
    SPECIALIST_ROUTES,
    ["offer-architect", "money-model-designer", "lead-engine", "research"],
    "all dispatchable routes, including research, are read off the core registry",
  );
  for (const route of SPECIALIST_ROUTES) {
    // The three Phase-12 route names equal their skill names; Phase 16 deliberately names the
    // route `research` and the registry body `research-specialist`.
    const skillName = route === "research" ? "research-specialist" : route;
    assert.ok(
      SKILL_NAMES.includes(skillName),
      `${skillName} must also be GATED — a body edit rides the gate`,
    );
  }
  assert.throws(
    () => validateFixture({ ...base, turns: [`tell me about ${VAULT_NEEDLE}`] }, "<synthetic>"),
    /vacuous/,
    "a turn carrying the vault needle would make citesVaultDoc pass without searchVault",
  );

  // 6b. The three observables evaluate against the LANDED plan row.
  const landedBody = [
    "> Produced by the **offer-architect** specialist.",
    "",
    `Per "Northwind launch ${VAULT_NEEDLE}", there is nothing on file that a buyer picks over price.`,
  ].join("\n");
  const landed = { status: "proposed", kind: "memo", body: landedBody };
  const fallback = {
    status: "proposed",
    kind: "memo",
    body: ["# Next step", "", "I could not run the specialist for this one."].join("\n"),
  };
  const dispatched = { planKind: "memo", attributionRoute: "offer-architect", citesVaultDoc: true };
  assert.equal(
    evaluateExpect(dispatched, landed, 0, false, 0, 0, 0, VAULT_NEEDLE).length,
    0,
    "a landed specialist body satisfies all three dispatch observables",
  );
  // The FALLBACK memo is the whole reason attributionRoute exists: it reaches `proposed` with
  // `kind: "memo"` too, so status+kind alone cannot tell a specialist run from a refusal or a throw.
  assert.equal(
    evaluateExpect({ status: "proposed", planKind: "memo" }, fallback).length,
    0,
    "status+kind alone CANNOT discriminate the fallback (which is why the next assertion matters)",
  );
  assert.equal(
    evaluateExpect(dispatched, fallback, 0, false, 0, 0, 0, VAULT_NEEDLE).length,
    2,
    "the fallback memo MUST fail attributionRoute AND citesVaultDoc",
  );
  // citesVaultDoc fails closed when the probe is absent — an un-seeded corpus must never pass it.
  assert.equal(
    evaluateExpect({ citesVaultDoc: true }, landed, 0, false, 0, 0, 0, "").length,
    1,
    "citesVaultDoc:true MUST FAIL with no vault needle to look for",
  );
  assert.equal(
    evaluateExpect({ attributionRoute: "lead-engine" }, landed, 0, false, 0, 0, 0, VAULT_NEEDLE)
      .length,
    1,
    "attributionRoute must name the specialist that actually produced the body",
  );
  assert.equal(
    evaluateExpect({ planKind: "memo" }, { status: "proposed" }).length,
    1,
    "planKind MUST FAIL on a plan row with no kind (an email plan, never dispatched)",
  );

  // 7. 22.1: the async-specialist cost merge. Real numbers, measured off one `subagent.completed`
  //    row (tenant eval-a096684d): $0.0169 exec + $0.20847665 specialist on ONE research fixture.
  const EXEC = 0.0169;
  const SPEC = 0.20847665;
  assert.equal(
    formatCost(EXEC),
    "$0.0169",
    "a non-dispatch case must print EXACTLY as it did before the split existed",
  );
  assert.equal(
    formatCost(EXEC + SPEC, SPEC),
    "$0.0169 exec + $0.2085 specialist = $0.2254",
    "a dispatch case must show the split the owner is meant to see",
  );
  // The cap must SEE the specialist money. Exec-only, thirty-three fixtures never trips $1.00 —
  // which is exactly why the blind runner reported "$0.22" on a run that spent multiples of it.
  // 16-09: pinned to an EXPLICIT cap rather than COST_CAP_USD. EXEC/SPEC are real MEASURED dollars,
  // so scaling them by the production cap would be meaningless — and reading the production cap
  // would make a legitimate cap change fail an assertion about merge logic, which is what happened.
  const TEST_CAP = 1.0;
  assert.equal(
    overCap(33 * EXEC, TEST_CAP),
    false,
    "exec-only spend never trips the cap — the old blindness",
  );
  assert.equal(
    overCap(5 * (EXEC + SPEC), TEST_CAP),
    true,
    "five dispatch cases DO trip the cap once the specialist bill is merged in",
  );

  console.log(
    `[eval:golden] self-check PASSED (${fixtures.length} fixtures valid, ${SKILL_NAMES.length} gated skills` +
      ` derived from GATED_SKILLS, vocabulary/cap/multi-pin/only-filter/dispatch/cost-merge logic proven offline)`,
  );
}

// ── live run ─────────────────────────────────────────────────────────────────

let totalCost = 0;

/** One attempt of one case on a FRESH seeded plan. Returns { pass, failures?, error? }.
 *  Throws EnvironmentAbort (via abortEnv) on governed stops / cost cap — never a case failure. */
function abortEnv(message) {
  console.error(`\n[eval:golden] ${message}`);
  console.error(`[eval:golden] total cost so far: $${totalCost.toFixed(4)}`);
  process.exit(2);
}

/** Block the (synchronous) case driver without spinning the CPU. */
const sleepSync = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

/** 15-06: poll the plan row until the scheduled specialist dispatch has landed. `collecting` is the
 *  staged, NOT-YET-APPROVABLE state; `landSpecialistResult` runs in a `finally` on every outcome, so
 *  leaving it is unconditional. Returns the landed plan, or null on timeout. */
function waitForDispatch(planId) {
  const deadline = Date.now() + DISPATCH_TIMEOUT_MS;
  for (;;) {
    const plan = parse(must("plans:getById", { planId }));
    if (plan && plan.status !== "collecting") return plan;
    if (Date.now() >= deadline) return null;
    sleepSync(DISPATCH_POLL_MS);
  }
}

/** Phase 16: the research card leaves collecting BEFORE persistResearchFindings writes the vault
 * document, so plan status alone is an early wake-up race. Poll the durable research row too; it is
 * the completion signal every new research observable depends on. */
function waitForResearchLanding(planId, tenantId, threadId) {
  const deadline = Date.now() + DISPATCH_TIMEOUT_MS;
  for (;;) {
    const plan = parse(must("plans:getById", { planId }));
    const researchCount = parse(
      must("smoke:researchCountForThread", { tenantId, threadId }),
    );
    if (plan && plan.status !== "collecting" && researchCount > 0) {
      return { plan, researchCount };
    }
    if (Date.now() >= deadline) return null;
    sleepSync(DISPATCH_POLL_MS);
  }
}

function attemptCase(fixture, tenant, pins) {
  const { planId, threadId } = parse(must("smoke:seedCockpitPlan", { tenant }));
  // `seedCockpitPlan` mints `smoke-attach-<randomUUID>` SERVER-side, so a failure's rows cannot be
  // traced back to the fixture that wrote them unless the pairing is printed here. Without this, a
  // `gap_not_found` is unfalsifiable after the run: run 9dde13e8 left NINE evaluation threads and no
  // way to say which belonged to 30 vs 31 except by reconstructing creation order. One line, printed
  // for EVERY attempt (retries mint a fresh plan, so the same fixture legitimately appears twice).
  console.log(`  · ${fixture.id} thread=${threadId} plan=${planId}`);
  let caseCost = 0;
  // UAT-E (03.10-06): accumulate {role, content} history across turns and pass it, exactly as the
  // production drivers do. The runner calls llm:runCockpitAgent DIRECTLY (never sendCockpitMessage,
  // and seedCockpitPlan's threadId is synthetic with no agent thread store behind it), so it must
  // supply history itself — production parity by construction (the loop renders + caps in ONE place).
  const history = [];
  for (const text of fixture.turns) {
    const res = parse(
      must("llm:runCockpitAgent", {
        tenantId: tenant,
        threadId,
        planId,
        text,
        // 16-09: MINT A TURN ID, exactly as the production driver does (`cockpit.ts` — "the driver
        // mints the turnId"). This is not just trace plumbing. `dispatchResearch` is built only
        // under `grantDispatch && threadId && rootRequestId`, and `rootRequestId` IS this value
        // (llm.ts:2069) — so omitting it silently REMOVED the research tool from the record for
        // every fixture. Cases 32-34 could not pass no matter what the skill body said, and the
        // failure was invisible because the arg is optional and its documented effect ("undefined
        // ⇒ the loop emits nothing") sounds harmless. Per TURN, like production — not per case.
        turnId: randomUUID(),
        ...(history.length ? { history } : {}),
        ...(pins.length ? { skillVersions: skillVersionsOf(pins) } : {}),
      }),
    );
    if (res.blocked) {
      const hint =
        res.blocked === "daily_budget_exhausted"
          ? " — try: npx convex run smoke:resetDailySpend"
          : "";
      abortEnv(`environment drained (${res.blocked}) — not an eval failure${hint}`);
    }
    caseCost += res.costUsd ?? 0;
    totalCost += res.costUsd ?? 0;
    if (overCap(totalCost)) {
      abortEnv(`COST CAP EXCEEDED ($${totalCost.toFixed(4)} > $${COST_CAP_USD.toFixed(2)})`);
    }
    history.push({ role: "user", content: text }, { role: "assistant", content: res.reply ?? "" });
  }
  // 15-06 (DISP-01): the "Act on this" tap, between the turns and the assertions. This drives the
  // REAL user path — evaluations.actOnGap's shared implementation stages `collecting` and schedules
  // internal.dispatch.runSpecialist — through the identity-less twin, because `npx convex run`
  // carries no auth identity. The specialist turn is a SECOND model call that bills ASYNCHRONOUSLY,
  // after runCockpitAgent already returned — so it used to be invisible to COST_CAP_USD entirely
  // ($0.21 of specialist money per research fixture against a $0.02 exec turn). It is now charged
  // below, off the audit trail, the moment the dispatch poll settles.
  let plan;
  let landedResearchCount = 0;
  let specialistCost = 0;
  // Set the MOMENT a dispatch is actually scheduled — the money exists from then on, including on
  // a timeout, so the failure returns below must be charged too (they used to return cost-free).
  let dispatched = false;
  let dispatchFailures = null;
  if (fixture.actOnGap !== undefined) {
    const tap = parse(
      must("evaluations:actOnGapInternal", {
        tenantId: tenant,
        threadId,
        gapIndex: fixture.actOnGap,
      }),
    );
    if (!tap.ok) {
      // Nothing dispatched (`gap_not_found`) → no specialist money, and no read to pay for.
      return {
        pass: false,
        failures: [{ key: "actOnGap", expected: "ok", actual: tap.reason }],
        caseCost,
        specialistCost,
      };
    }
    dispatched = true;
    plan = waitForDispatch(tap.planId);
    if (!plan) {
      dispatchFailures = [
        { key: "actOnGap", expected: "left collecting", actual: "still collecting" },
      ];
    }
  } else if (fixture.expect.researchDocPresent === true) {
    // D9-REVISED: the executive returns immediately and the research run lands on the scheduler.
    // Poll the same durable document the assertion reads; a fixed sleep would be either flaky or
    // needlessly slow, and polling plan status alone wakes before persistResearchFindings.
    dispatched = true;
    const landed = waitForResearchLanding(planId, tenant, threadId);
    if (!landed) {
      dispatchFailures = [
        {
          key: "researchDocPresent",
          expected: "scheduled research landed",
          actual: "no research document before timeout",
        },
      ];
    } else {
      plan = landed.plan;
      landedResearchCount = landed.researchCount;
    }
  } else {
    // Assert on plan STATE (never on res.reply — locked). A briefing fixture adds ONE read of
    // the thread's briefings rows — skipped otherwise, so non-briefing cases cost no extra hop.
    plan = parse(must("plans:getById", { planId }));
  }
  // The specialist bill, charged off the audit trail now that the dispatch poll has settled (one
  // read, hung off the EXISTING poll — no second loop). Same skip-unless-asked discipline as every
  // other read below: a non-dispatch case pays no extra hop and its numbers are unchanged.
  if (dispatched) {
    specialistCost = parse(must("smoke:specialistCostForThread", { tenantId: tenant, threadId }));
    caseCost += specialistCost;
    totalCost += specialistCost;
    // The cap is a governed stop and outranks a case failure — check BEFORE returning one.
    if (overCap(totalCost)) {
      abortEnv(`COST CAP EXCEEDED ($${totalCost.toFixed(4)} > $${COST_CAP_USD.toFixed(2)})`);
    }
  }
  if (dispatchFailures) {
    return { pass: false, failures: dispatchFailures, caseCost, specialistCost };
  }
  const briefingCount =
    fixture.expect.briefingPresent === undefined
      ? 0
      : parse(must("smoke:briefingCountForThread", { tenantId: tenant, threadId }));
  const synopsisPresent =
    fixture.expect.ledePresent === undefined
      ? false
      : parse(must("smoke:briefingSynopsisPresent", { tenantId: tenant, threadId }));
  // 12-06: same skip-unless-asked discipline — a non-assessment case pays no extra hop.
  const evaluationCount =
    fixture.expect.evaluationPresent === undefined
      ? 0
      : parse(must("smoke:evaluationCountForThread", { tenantId: tenant, threadId }));
  const findingCount =
    fixture.expect.findingsPresent === undefined
      ? 0
      : parse(must("smoke:findingCountForThread", { tenantId: tenant, threadId }));
  const gapCount =
    fixture.expect.gapCount === undefined
      ? 0
      : parse(must("smoke:gapCountForThread", { tenantId: tenant, threadId }));
  // Phase 16: skip every research read unless a fixture asks. The pairing rules above guarantee
  // the verdict and call floor cannot ask without the persisted-document companion.
  const researchCount =
    fixture.expect.researchDocPresent === undefined
      ? 0
      : landedResearchCount ||
        parse(must("smoke:researchCountForThread", { tenantId: tenant, threadId }));
  const insufficientEvidence =
    fixture.expect.insufficientEvidence === undefined
      ? false
      : parse(
          must("smoke:researchInsufficientEvidenceForThread", {
            tenantId: tenant,
            threadId,
          }),
        );
  const webSearchCalls =
    fixture.expect.webSearchCallsAtLeast === undefined
      ? 0
      : parse(must("smoke:webSearchCallsForThread", { tenantId: tenant, threadId }));
  const failures = evaluateExpect(
    fixture.expect,
    plan,
    briefingCount,
    synopsisPresent,
    evaluationCount,
    findingCount,
    gapCount,
    VAULT_NEEDLE,
    researchCount,
    insufficientEvidence,
    webSearchCalls,
  );
  // Standing invariants: zero requests rows + refs-only needle scan (throws on violation).
  try {
    must("smokeAssert:assertEvalCaseClean", { tenant, needles: fixture.needles });
  } catch (e) {
    failures.push({
      key: "standing-invariants",
      expected: "clean",
      actual: e.message.split("\n")[0],
    });
  }
  return { pass: failures.length === 0, failures, caseCost, specialistCost };
}

async function runLive(pins, filters = []) {
  const allFixtures = loadFixtures(); // fail fast BEFORE the first spawn
  const fixtures = applyOnly(allFixtures, filters); // ditto — a bad --only must not cost a seed
  const runId = randomUUID().slice(0, 8);
  const tenant = `eval-${runId}`; // throwaway — isolates every tenant-scoped table
  const retriedCases = [];
  const results = [];

  console.log(
    `[eval:golden] run ${runId} — ${fixtures.length} cases, tenant ${tenant}, cap $${COST_CAP_USD.toFixed(2)}` +
      (pins.length ? `, pins ${pins.map((p) => `${p.name}@${p.version}`).join(" ")}` : "") +
      (filters.length
        ? `\n[eval:golden] PARTIAL RUN — --only ${filters.join(" ")} (${fixtures.length}/${allFixtures.length} fixtures). Diagnostic only: NO evidence will be recorded.`
        : ""),
  );

  // 03.7-05: seed the eval tenant's inbox ONCE, before the first turn. The eval tenant has no
  // Gmail token, so without this every briefing case degrades to not_connected and measures
  // nothing (research Pitfall 3). `offlineDigest: false` is the whole point of the probe: the
  // poisoned body reaches the LIVE toolless digest, so 17's zero-actuation is a real result and
  // not a fixture short-circuit. Every case shares the one inbox — the injected mail sits in it
  // for ALL of them, because the defense must hold whichever case reads it.
  const { messageCount } = parse(
    must("smoke:seedInboxFixture", { tenantId: tenant, offlineDigest: false }),
  );
  console.log(`[eval:golden] seeded inbox fixture: ${messageCount} message(s), live digest`);

  // 10-04 (VGND-01): seed a REAL embedded vault corpus ONCE, same one-shot shape as the inbox seed.
  // 25-vault-grounded's live `searchVault` must resolve against a real `rag.add` doc (namespace =
  // tenant), so without this the grounded fixture would retrieve nothing. `vaultSmoke:seedCorpus` is
  // an internalAction callable via `convex run` (identity-less, explicit tenantId) that embeds two
  // "Northwind-evalgrd" logistics briefs. The eval tenant is throwaway (`eval-${runId}`) — no purge
  // (the inbox seed isn't purged either). Needs the deployment OPENAI_API_KEY the eval already requires.
  const { docIds: vaultDocIds } = parse(
    must("vaultSmoke:seedCorpus", { tenantId: tenant, needle: VAULT_NEEDLE }),
  );
  console.log(`[eval:golden] seeded vault corpus: ${vaultDocIds.length} doc(s), live embed`);

  for (const fixture of fixtures) {
    let outcome;
    let retried = false;
    try {
      outcome = attemptCase(fixture, tenant, pins);
    } catch (e) {
      outcome = {
        pass: false,
        failures: [{ key: "error", expected: "run", actual: e.message.split("\n")[0] }],
        caseCost: 0,
        specialistCost: 0,
      };
    }
    if (!outcome.pass) {
      // Flake policy (locked): exactly ONE automatic re-run on a FRESH seeded plan.
      retried = true;
      let second;
      try {
        second = attemptCase(fixture, tenant, pins);
      } catch (e) {
        second = {
          pass: false,
          failures: [{ key: "error", expected: "run", actual: e.message.split("\n")[0] }],
          caseCost: 0,
          specialistCost: 0,
        };
      }
      // Both attempts' money is real — the specialist half of it too.
      const merged = {
        caseCost: outcome.caseCost + second.caseCost,
        specialistCost: (outcome.specialistCost ?? 0) + (second.specialistCost ?? 0),
      };
      if (second.pass) retriedCases.push(fixture.id);
      outcome = { ...second, ...merged };
    }
    results.push({ id: fixture.id, ...outcome, retried });

    const tag = outcome.pass ? (retried ? "PASS (retried)" : "PASS") : "FAIL";
    console.log(
      `  ${tag.padEnd(15)} ${fixture.id}  (${formatCost(outcome.caseCost, outcome.specialistCost)})`,
    );
    if (!outcome.pass) {
      for (const f of outcome.failures) {
        console.log(
          `      ${f.key}: expected ${JSON.stringify(f.expected)}, got ${JSON.stringify(f.actual)}`,
        );
      }
    }
  }

  const casesPassed = results.filter((r) => r.pass).length;
  const casesTotal = results.length;
  const allGreen = casesPassed === casesTotal;
  const totalSpecialist = results.reduce((sum, r) => sum + (r.specialistCost ?? 0), 0);
  console.log(
    `\n[eval:golden] ${casesPassed}/${casesTotal} passed` +
      (retriedCases.length ? ` (retried: ${retriedCases.join(", ")})` : "") +
      ` — total cost ${formatCost(totalCost, totalSpecialist)}`,
  );

  // Evidence: only on an ALL-GREEN run with at least one --skill pin (refs/counts only, §4) —
  // the exact EvalEvidence shape hasPassingEvidence parses (03.6-01). 15-06: ONE row per pin off
  // the SAME run, each carrying the FULL merged skillVersions record, because that is what the run
  // actually carried on every turn.
  // 16-09: `!filters.length` is LOAD-BEARING, not tidiness. `hasPassingEvidence` reads casesPassed/
  // casesTotal off the row; a green 3-case `--only research` run would write `3/3 pass` and be
  // indistinguishable from a full gate, silently certifying a skill on a tenth of the coverage.
  // A partial run may never produce an EVAL_GATE input.
  if (allGreen && pins.length && filters.length) {
    console.log(`[eval:golden] evidence SUPPRESSED — partial run (--only). Re-run unfiltered to gate.`);
  }
  if (allGreen && pins.length && !filters.length) {
    const skillVersions = skillVersionsOf(pins);
    for (const pin of pins) {
      const evidence = JSON.stringify({
        runner: "eval:golden",
        runId,
        pass: true,
        casesPassed,
        casesTotal,
        retriedCases,
        costUsd: totalCost,
        model: "openai/gpt-4o-mini",
        skillVersions,
        ts: Date.now(),
      });
      must("skills:recordEvalEvidence", { name: pin.name, version: pin.version, evidence });
      console.log(`[eval:golden] evidence recorded on ${pin.name} v${pin.version}`);
    }
  }

  process.exit(allGreen ? 0 : 1);
}

// ── entry ────────────────────────────────────────────────────────────────────

const argv = process.argv.slice(2);
try {
  if (argv.includes("--self-check")) {
    selfCheck();
    process.exit(0);
  }
  await runLive(parseSkillPins(argv), parseOnlyFilters(argv));
} catch (e) {
  console.error(`[eval:golden] ${e.message}`);
  process.exit(1);
}
