// 33.2 — THE STORYBOARD BAKE-OFF. Which model should write the media-director's storyboard?
//
// Drives the PRODUCTION media dispatch (`dispatch:runMedia`) over a fixed corpus of briefs
// (`storyboard-briefs.json`) for ONE candidate model per invocation, and reads the parser's
// verdict off the plan row (`smoke:storyboardFactsForPlan` — counts and codes only, §4). No judge
// model, no prose scoring: a pass is `two`, `salvaged`, `refused:<code>` or `none`, exactly what
// the canvas would have shown. The decision rule is written in the PRD (L4) BEFORE any run.
//
// WHY THROUGH THE DEPLOYMENT and not a direct OpenRouter call with the skill body: the candidate
// must survive the real prompt assembly (`buildSpecialistPrompt` + `MEDIA_TASK_LINE`), the real
// `searchVault` grant, the real step budget and the real `CALL_TIMEOUT_MS` clock. The pack lane
// recorded models that pass a short probe and then time out at 113-164 s in production. A pass
// truncated by the clock is reported as such and DISQUALIFIES the candidate (PRD L4).
//
// HOW THE CANDIDATE IS VARIED: it is not an argument. `runSpecialistTurn` refuses a `model` arg
// ("a second mechanism for a decision with exactly one owner"), so the candidate is whatever
// `MEDIA_MODEL` in packages/cost/src/cost.ts resolves to on the DEPLOYED code. `--candidate` is an
// ASSERTION: the runner reads the constant off disk (alias chain resolved, the `codeOwnedPackModel`
// idiom), refuses to start if it differs, and fails the invocation (exit 2) the moment a pass's
// returned `modelId` differs — so a stale `convex dev` push cannot label one model's decks with
// another model's name. Each candidate: one edit, one push, one invocation.
//
// RESEARCH IS PAID ONCE PER BRIEF, not per pass. `groundMediaBrief` reuses findings for the same
// brief on the same tenant within 24 h (33.2-01), and the runner keeps ONE seeded tenant per brief
// in `.tmp/storyboard-bakeoff/tenants.json` across invocations. So the first pass of the first
// candidate pays ~$0.21 x 12 of research; every later pass — every other candidate — reuses it.
// Report latency from pass 2 onward for that reason.
//
// Invocation, from packages/backend (the convex CLI resolves the deployment from here):
//   node scripts/run-storyboard-bakeoff.mjs --self-check
//   node scripts/run-storyboard-bakeoff.mjs --candidate or/openai/gpt-4o-mini --repeat 2   COSTS MONEY
//   --candidate   REQUIRED for a live run. Must equal the code-owned MEDIA_MODEL (see above).
//   --repeat N    passes per brief (default 1). Each pass is a FRESH plan row + thread on the
//                 brief's tenant, so no pass sees another pass's refusal through the retry line.
//   --only <sub>  DIAGNOSTIC: only briefs whose id contains <sub>. A filter matching nothing is an
//                 ERROR, never an empty green run (the run-eval-golden `applyOnly` rule).
//   --self-check  OFFLINE: validates the corpus and the constant reader with zero convex calls.
//
// Exit codes: 0 every pass produced a VERDICT (a refusal IS a verdict — this measures refusals) ·
// 1 a pass could not be measured (dispatch refused for a non-model reason, facts unreadable) ·
// 2 environment abort (candidate mismatch, cost cap, no deployment) — never a verdict.
//
// Output: `.tmp/storyboard-bakeoff/<candidate>.json` (one write per pass, so an abort leaves what
// ran) and a markdown table on stdout. `.tmp/` is gitignored; the ADR carries the summary.
// ponytail: no `--dump` of the specialist body — `refusedBody` is on the plan row and readable in
// the dashboard by planId, which every report line carries. Add a §4-exempt local dump only if a
// decision ever turns on WHAT a refused deck said rather than THAT it was refused.

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { must } from "./smokeRun.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const briefsPath = join(here, "storyboard-briefs.json");
const costSrcPath = resolve(here, "../../cost/src/cost.ts");
const dispatchSrcPath = resolve(here, "../convex/dispatch.ts");
const storyboardSrcPath = resolve(here, "../../core/src/storyboard.ts");
const outDir = resolve(here, "../.tmp/storyboard-bakeoff");
const tenantsPath = join(outDir, "tenants.json");

/** Hard per-invocation cap on the MEDIA turns' own cost (research is billed to the research lane
 *  and is not on `runMedia`'s return). Twelve briefs x 2 passes on the dearest candidate lands
 *  around $1.50; 3.0 is a ceiling, not a licence. */
const COST_CAP_USD = 3.0;
const RETRY_READ = { retryOnEmpty: true };

class EnvironmentAbort extends Error {}

const parse = (out) => JSON.parse(out);

// ── code-owned constants, read off disk so they cannot drift from the deployment ────────────────

/** `MEDIA_MODEL` resolved through its alias chain to the string literal. THROWS rather than
 *  guessing: a runner that refuses to start is better than a report naming a model that never
 *  ran. Bounded at 6 hops — cost.ts aliases two deep today (MEDIA_MODEL -> OR_MEDIA_MODEL ->
 *  OR_DEFAULT_MODEL -> literal). */
export function codeOwnedMediaModel(src = readFileSync(costSrcPath, "utf8")) {
  let name = "MEDIA_MODEL";
  for (let hop = 0; hop < 6; hop += 1) {
    const lit = new RegExp(`^export const ${name} = "([^"]+)";`, "m").exec(src);
    if (lit) return lit[1];
    const alias = new RegExp(`^export const ${name} = ([A-Za-z_][A-Za-z0-9_]*);`, "m").exec(src);
    if (!alias)
      throw new EnvironmentAbort(`${name} not found (or not an alias/literal) in cost.ts`);
    name = alias[1];
  }
  throw new EnvironmentAbort("MEDIA_MODEL alias chain deeper than 6 — resolve it by hand");
}

const readConst = (path, re, what) => {
  const m = re.exec(readFileSync(path, "utf8"));
  if (!m) throw new EnvironmentAbort(`${what} not found in ${path}`);
  return m[1];
};
const MAX_QUESTION_CHARS = Number(
  readConst(dispatchSrcPath, /^const MAX_QUESTION_CHARS = (\d+);/m, "MAX_QUESTION_CHARS"),
);
const TARGET_DURATIONS = readConst(
  storyboardSrcPath,
  /^export const TARGET_DURATIONS = \[([\d, ]+)\] as const;/m,
  "TARGET_DURATIONS",
)
  .split(",")
  .map((x) => Number(x.trim()));

// ── the corpus ──────────────────────────────────────────────────────────────────────────────────

/** Validate one brief. Assert-based so `--self-check` can prove each rejection fires. */
export function validateBrief(b, { maxChars = MAX_QUESTION_CHARS, legal = TARGET_DURATIONS } = {}) {
  assert.equal(typeof b, "object", "brief must be an object");
  assert.match(String(b.id ?? ""), /^[a-z0-9-]{3,40}$/, `brief id "${b.id}" is not a slug`);
  assert.equal(typeof b.text, "string", `brief ${b.id}: text must be a string`);
  assert.ok(b.text.trim().length > 0, `brief ${b.id}: text is empty`);
  assert.ok(
    b.text.length <= maxChars,
    `brief ${b.id}: ${b.text.length} chars exceeds MAX_QUESTION_CHARS=${maxChars} (it would be capped, and the cap would be the thing measured)`,
  );
  if (b.durationSeconds !== null && b.durationSeconds !== undefined) {
    assert.ok(
      Number.isInteger(b.durationSeconds),
      `brief ${b.id}: durationSeconds must be an integer or null`,
    );
    const isLegal = legal.includes(b.durationSeconds);
    assert.equal(
      isLegal,
      b.illegalDuration !== true,
      `brief ${b.id}: durationSeconds ${b.durationSeconds} ${isLegal ? "is legal but marked illegalDuration" : "is off TARGET_DURATIONS and not marked illegalDuration: true"}`,
    );
  } else {
    assert.notEqual(b.illegalDuration, true, `brief ${b.id}: illegalDuration needs a duration`);
  }
}

export function loadBriefs(path = briefsPath) {
  const doc = parse(readFileSync(path, "utf8"));
  assert.ok(Array.isArray(doc.briefs), "storyboard-briefs.json: `briefs` must be an array");
  for (const b of doc.briefs) validateBrief(b);
  const ids = new Set(doc.briefs.map((b) => b.id));
  assert.equal(ids.size, doc.briefs.length, "brief ids must be unique");
  const texts = new Set(doc.briefs.map((b) => b.text.trim().toLowerCase()));
  assert.equal(texts.size, doc.briefs.length, "no two briefs may carry the same text");
  return doc.briefs;
}

// ── args ────────────────────────────────────────────────────────────────────────────────────────

export function parseArgs(argv) {
  const out = { candidate: null, repeat: 1, only: null, selfCheck: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--self-check") out.selfCheck = true;
    else if (a === "--candidate") out.candidate = argv[++i] ?? null;
    else if (a === "--repeat") out.repeat = Number(argv[++i]);
    else if (a === "--only") out.only = argv[++i] ?? null;
    else throw new Error(`unknown argument ${a}`);
  }
  assert.ok(Number.isInteger(out.repeat) && out.repeat >= 1, "--repeat must be a positive integer");
  return out;
}

// ── the live run ────────────────────────────────────────────────────────────────────────────────

const loadTenants = () => (existsSync(tenantsPath) ? parse(readFileSync(tenantsPath, "utf8")) : {});
const saveTenants = (t) => writeFileSync(tenantsPath, JSON.stringify(t, null, 2));

/** One seeded tenant per brief, reused across invocations (research reuse, see the header). The
 *  golden-eval shape exactly: `vaultSmoke:seedCorpus` (five Northwind briefs, real embed) then
 *  `smoke:seedGoldenEvalBlueprint` (profile + blueprint). Tenant ids match the eval pattern the
 *  blueprint seed refuses everything else for. */
function ensureTenant(brief, tenants) {
  const have = tenants[brief.id];
  if (have) return have;
  const tenantId = `eval-${randomUUID().replaceAll("-", "").slice(0, 8)}`;
  const needle = `bake${brief.id.replaceAll("-", "").slice(0, 10)}`;
  const { docIds } = parse(must("vaultSmoke:seedCorpus", { tenantId, needle }));
  parse(must("smoke:seedGoldenEvalBlueprint", { tenantId, sourceDocIds: docIds }));
  const row = { tenantId, docIds, seededAt: new Date().toISOString() };
  tenants[brief.id] = row;
  saveTenants(tenants);
  console.log(`[bakeoff] seeded tenant ${tenantId} for ${brief.id} (${docIds.length} docs)`);
  return row;
}

function runPass(brief, tenant, candidate, passNo) {
  const { planId, threadId } = parse(must("smoke:seedCockpitPlan", { tenant: tenant.tenantId }));
  const t0 = Date.now();
  // PAID. No retry-on-empty: a retry would bill a second storyboard turn.
  const run = parse(
    must("dispatch:runMedia", {
      tenantId: tenant.tenantId,
      threadId,
      planId,
      gapIndex: 0,
      route: "media",
      rootRequestId: randomUUID(),
      parentAgentId: "storyboard-bakeoff",
      depth: 1,
      ancestry: [],
      envelopeCents: 500,
      spentCents: 0,
      question: brief.text,
    }),
  );
  const elapsedMs = Date.now() - t0;
  if (run.ok !== true) {
    return {
      brief: brief.id,
      pass: passNo,
      planId,
      measured: false,
      dispatchRefusal: run.reason,
      elapsedMs,
    };
  }
  if (run.modelId !== candidate) {
    throw new EnvironmentAbort(
      `pass ran on ${run.modelId}, not the asserted candidate ${candidate} — the deployment is not running the code on disk (push and re-run)`,
    );
  }
  // `modelId` above is the PIN the lookup chose. What ANSWERED is in the spend rows: an eligible
  // primary failure rolls over to the fallback and the run still succeeds, so without this a
  // candidate the provider refuses on every call scores the fallback's decks under its own name.
  // Round 3 (claude-sonnet-5) did exactly that for 24 passes before the per-pass cost gave it
  // away. Zero spend rows is a failure of proof, never agreement.
  const ran = parse(must("smoke:modelsForPlan", { planId }, RETRY_READ));
  if (ran.rowCount === 0) {
    throw new EnvironmentAbort(`no spend rows for plan ${planId} — cannot prove which model ran`);
  }
  if (ran.models.length !== 1 || ran.models[0] !== candidate) {
    throw new EnvironmentAbort(
      `plan ${planId} was answered by ${ran.models.join("+")}, not ${candidate} — the candidate is failing and the fallback is scoring in its name`,
    );
  }
  const facts = parse(must("smoke:storyboardFactsForPlan", { planId }, RETRY_READ));
  return {
    brief: brief.id,
    pass: passNo,
    planId,
    measured: true,
    modelId: run.modelId,
    costUsd: Number(run.costUsd ?? 0),
    incompleteReason: run.incompleteReason ?? null,
    elapsedMs,
    ...facts,
  };
}

export function summarize(passes) {
  const measured = passes.filter((p) => p.measured);
  const count = (pred) => measured.filter(pred).length;
  const codes = {};
  for (const p of measured) {
    if (p.kind === "refused") codes[p.reason ?? "?"] = (codes[p.reason ?? "?"] ?? 0) + 1;
  }
  const kinds = {};
  for (const p of measured) {
    for (const [k, n] of Object.entries(p.kinds ?? {})) kinds[k] = (kinds[k] ?? 0) + n;
  }
  const decks = measured.filter((p) => p.sceneCount > 0);
  const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
  const later = measured.filter((p) => p.pass >= 2).map((p) => p.elapsedMs);
  return {
    passes: passes.length,
    measured: measured.length,
    two: count((p) => p.kind === "two"),
    salvaged: count((p) => p.kind === "salvaged"),
    one: count((p) => p.kind === "one"),
    refused: count((p) => p.kind === "refused"),
    none: count((p) => p.kind === "none"),
    refusalCodes: codes,
    clockTruncated: count((p) => p.incompleteReason === "clock"),
    stepsTruncated: count((p) => p.incompleteReason === "steps"),
    meanCostUsd: mean(measured.map((p) => p.costUsd)),
    totalCostUsd: measured.reduce((a, p) => a + p.costUsd, 0),
    meanElapsedMsFromPass2: mean(later),
    meanGeneratedSeconds: mean(decks.map((p) => p.generatedSeconds)),
    meanUnverified: mean(decks.map((p) => p.unverifiedCount)),
    adjustments: decks.reduce((a, p) => a + p.adjustmentCount, 0),
    kinds,
  };
}

const fmt = (x, d = 2) => (x === null || x === undefined ? "-" : Number(x).toFixed(d));

function printTable(candidate, passes, summary) {
  console.log(`\n### ${candidate}\n`);
  console.log(
    "| brief | pass | verdict | target | scenes | gen s | unverified | cost $ | ms | planId |",
  );
  console.log("|---|---|---|---|---|---|---|---|---|---|");
  for (const p of passes) {
    const verdict = !p.measured
      ? `NOT MEASURED (${p.dispatchRefusal})`
      : p.kind === "refused"
        ? `refused:${p.reason}${p.variation ? ` (${p.variation})` : ""}`
        : p.kind === "salvaged"
          ? `salvaged (lost: ${p.lostReason})`
          : p.kind;
    const trunc = p.incompleteReason ? ` !${p.incompleteReason}` : "";
    console.log(
      `| ${p.brief} | ${p.pass} | ${verdict}${trunc} | ${p.targetDurationSeconds ?? "-"} | ${p.sceneCount ?? "-"}${p.altSceneCount ? `+${p.altSceneCount}` : ""} | ${p.generatedSeconds ?? "-"} | ${p.unverifiedCount ?? "-"} | ${fmt(p.costUsd, 4)} | ${p.elapsedMs} | ${p.planId} |`,
    );
  }
  console.log(
    `\nsummary: two ${summary.two} · salvaged ${summary.salvaged} · one ${summary.one} · refused ${summary.refused} · none ${summary.none} of ${summary.measured} measured (${summary.passes} passes) · clock ${summary.clockTruncated} · steps ${summary.stepsTruncated} · mean $${fmt(summary.meanCostUsd, 4)} · total $${fmt(summary.totalCostUsd, 4)} · mean ms (pass>=2) ${fmt(summary.meanElapsedMsFromPass2, 0)} · gen s/deck ${fmt(summary.meanGeneratedSeconds, 1)} · unverified/deck ${fmt(summary.meanUnverified, 1)} · adjustments ${summary.adjustments}`,
  );
  console.log(
    `refusal codes: ${JSON.stringify(summary.refusalCodes)} · kinds: ${JSON.stringify(summary.kinds)}`,
  );
}

function live({ candidate, repeat, only }) {
  if (!candidate) throw new EnvironmentAbort("--candidate is required for a live run");
  const pinned = codeOwnedMediaModel();
  if (pinned !== candidate) {
    throw new EnvironmentAbort(
      `--candidate ${candidate} but MEDIA_MODEL on disk resolves to ${pinned}. Point OR_MEDIA_MODEL at the candidate, let convex dev push, then run.`,
    );
  }
  let briefs = loadBriefs();
  if (only !== null) {
    briefs = briefs.filter((b) => b.id.includes(only));
    if (briefs.length === 0) throw new Error(`--only ${only} matches no brief`);
  }
  mkdirSync(outDir, { recursive: true });
  const reportPath = join(outDir, `${candidate.replaceAll("/", "__")}.json`);
  const tenants = loadTenants();
  const report = {
    candidate,
    startedAt: new Date().toISOString(),
    repeat,
    only,
    briefs: briefs.length,
    passes: [],
    summary: null,
  };
  const save = () => {
    report.summary = summarize(report.passes);
    writeFileSync(reportPath, JSON.stringify(report, null, 2));
  };
  let spent = 0;
  let unmeasured = 0;
  for (let passNo = 1; passNo <= repeat; passNo += 1) {
    for (const brief of briefs) {
      const tenant = ensureTenant(brief, tenants);
      const row = runPass(brief, tenant, candidate, passNo);
      report.passes.push(row);
      save();
      if (row.measured) {
        spent += row.costUsd;
        console.log(
          `[bakeoff] ${brief.id} pass ${passNo}: ${row.kind}${row.reason ? `:${row.reason}` : ""}${row.incompleteReason ? ` !${row.incompleteReason}` : ""} $${fmt(row.costUsd, 4)} ${row.elapsedMs}ms`,
        );
      } else {
        unmeasured += 1;
        console.log(`[bakeoff] ${brief.id} pass ${passNo}: NOT MEASURED (${row.dispatchRefusal})`);
      }
      if (spent > COST_CAP_USD) {
        throw new EnvironmentAbort(
          `cost cap ${COST_CAP_USD} exceeded ($${spent.toFixed(4)}) — report kept at ${reportPath}`,
        );
      }
    }
  }
  printTable(candidate, report.passes, report.summary);
  console.log(`\nreport: ${reportPath}`);
  return unmeasured === 0 ? 0 : 1;
}

// ── self-check: the ponytail one-runnable-check ─────────────────────────────────────────────────

function selfCheck() {
  const briefs = loadBriefs();
  assert.equal(briefs.length, 12, "the gate corpus is twelve briefs");
  const legal = briefs.filter((b) => b.illegalDuration !== true && b.durationSeconds !== null);
  assert.ok(
    legal.some((b) => b.durationSeconds === 15) &&
      legal.some((b) => b.durationSeconds === 30) &&
      legal.some((b) => b.durationSeconds === 60),
    "every legal duration is covered",
  );
  assert.ok(
    briefs.some((b) => b.illegalDuration === true),
    "one brief asks for an illegal duration",
  );

  // The validator REJECTS each malformed shape — prove it before trusting it to accept the corpus.
  const good = { id: "ok-brief", durationSeconds: 30, text: "a reel" };
  validateBrief(good);
  assert.throws(() => validateBrief({ ...good, id: "Bad Id" }), /not a slug/);
  assert.throws(() => validateBrief({ ...good, text: "   " }), /empty/);
  assert.throws(
    () => validateBrief({ ...good, text: "x".repeat(MAX_QUESTION_CHARS + 1) }),
    /exceeds/,
  );
  assert.throws(
    () => validateBrief({ ...good, durationSeconds: 45 }),
    /not marked illegalDuration/,
  );
  assert.throws(
    () => validateBrief({ ...good, durationSeconds: 30, illegalDuration: true }),
    /marked illegalDuration/,
  );
  assert.throws(
    () => validateBrief({ ...good, durationSeconds: null, illegalDuration: true }),
    /needs a duration/,
  );
  assert.throws(() => validateBrief({ ...good, durationSeconds: 7.5 }), /integer/);

  // The constant reader resolves the alias chain and refuses a dangling one.
  const resolved = codeOwnedMediaModel();
  assert.match(resolved, /^or\//, `MEDIA_MODEL resolves to ${resolved}`);
  assert.equal(
    codeOwnedMediaModel(
      'export const MEDIA_MODEL = A;\nexport const A = B;\nexport const B = "or/x/y";\n',
    ),
    "or/x/y",
  );
  assert.throws(() => codeOwnedMediaModel("export const MEDIA_MODEL = NOWHERE;\n"), /not found/);
  assert.throws(() => codeOwnedMediaModel(""), /not found/);

  // Args.
  assert.deepEqual(parseArgs(["--candidate", "or/a/b", "--repeat", "2"]), {
    candidate: "or/a/b",
    repeat: 2,
    only: null,
    selfCheck: false,
  });
  assert.throws(() => parseArgs(["--repeat", "0"]), /positive integer/);
  assert.throws(() => parseArgs(["--bogus"]), /unknown argument/);

  // The summary counts what the verdicts say, and clock truncation is visible.
  const s = summarize([
    {
      measured: true,
      pass: 1,
      kind: "two",
      costUsd: 0.01,
      elapsedMs: 100,
      sceneCount: 5,
      altSceneCount: 5,
      generatedSeconds: 8,
      unverifiedCount: 1,
      adjustmentCount: 0,
      kinds: { text_card: 1 },
    },
    {
      measured: true,
      pass: 2,
      kind: "refused",
      reason: "narration_too_long",
      costUsd: 0.02,
      elapsedMs: 200,
      sceneCount: 0,
      altSceneCount: 0,
      generatedSeconds: 0,
      unverifiedCount: 0,
      adjustmentCount: 0,
      kinds: {},
      incompleteReason: "clock",
    },
    { measured: false, pass: 1, dispatchRefusal: "budget_exhausted", elapsedMs: 5 },
  ]);
  assert.equal(s.two, 1);
  assert.equal(s.refused, 1);
  assert.equal(s.measured, 2);
  assert.equal(s.clockTruncated, 1);
  assert.deepEqual(s.refusalCodes, { narration_too_long: 1 });
  assert.equal(s.meanElapsedMsFromPass2, 200);
  assert.equal(s.meanGeneratedSeconds, 8);
  console.log(
    `[bakeoff] self-check OK — ${briefs.length} briefs, MEDIA_MODEL -> ${resolved}, MAX_QUESTION_CHARS=${MAX_QUESTION_CHARS}, TARGET_DURATIONS=${TARGET_DURATIONS.join("/")}`,
  );
  return 0;
}

// ── main ────────────────────────────────────────────────────────────────────────────────────────

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = parseArgs(process.argv.slice(2));
    process.exitCode = args.selfCheck ? selfCheck() : live(args);
  } catch (e) {
    if (e instanceof EnvironmentAbort) {
      console.error(`[bakeoff] ENVIRONMENT ABORT: ${e.message}`);
      process.exitCode = 2;
    } else {
      console.error(`[bakeoff] FAILED: ${e.message}`);
      process.exitCode = 1;
    }
  }
}
