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
// Invocation (locked): pnpm eval:golden [--skill <name>@<version>]
//   --skill      pin that skill version on every turn; an all-green pinned run
//                records refs/counts-only evidence via skills:recordEvalEvidence
//                (the EVAL_GATE input for activateSkill).
//   --self-check offline validation (ZERO convex calls): fixture vocabulary,
//                cap/pin logic — the ponytail one-runnable-check.
//
// Exit codes: 0 all green · 1 any case failure · 2 environment abort (governed
// stop or cost cap — never an eval failure).
//
// Mirrors run-smoke-*.mjs conventions: `must()` judges success by CLI OUTPUT
// (Windows/Node24 exit-code crash), `convex run` prints the return value as JSON
// on stdout (logs go to stderr).
import { readdirSync, readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import assert from "node:assert/strict";
import { must } from "./smokeRun.mjs";

const parse = (out) => JSON.parse(out);
const casesDir = resolve(dirname(fileURLToPath(import.meta.url)), "eval-cases");

// Hard per-run cost cap (discretion default; expected actuals $0.05–0.15 at
// gpt-4o-mini). Cumulative costUsd beyond this ABORTS the run (exit 2).
const COST_CAP_USD = 1.0;

// The v1 gated skills — the only valid --skill pin targets (matches GATED_SKILLS).
const SKILL_NAMES = ["cockpit-agent", "document-drafter", "inbox-digest"];

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
]);

// The pinned plans lifecycle order (schema.ts) — statusAtMost compares indices.
const STATUS_ORDER = ["collecting", "proposed", "approved", "scheduled", "delivering", "done", "canceled"];

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
  if (!m) throw new Error(`malformed --skill "${spec}" (expected <name>@<version>, e.g. cockpit-agent@3)`);
  const [, name, versionStr] = m;
  if (!SKILL_NAMES.includes(name)) {
    throw new Error(`unknown --skill name "${name}" (gated skills: ${SKILL_NAMES.join(", ")})`);
  }
  return { name, version: Number(versionStr) };
}

// ── expect evaluation (plan/briefing STATE, never reply text) ────────────────

/** @param briefingCount rows smoke:briefingCountForThread returned for the case's thread
 *  (0 when the fixture does not ask for `briefingPresent` — the read is skipped).
 *  @param synopsisPresent smoke:briefingSynopsisPresent for the case's thread (false when the
 *  fixture does not ask for `ledePresent` — the read is skipped). */
function evaluateExpect(expect, plan, briefingCount = 0, synopsisPresent = false) {
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
        if ((plan.recipients ?? []).length !== expected) miss(key, expected, (plan.recipients ?? []).length);
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
        if ((plan.attachments ?? []).length !== expected) miss(key, expected, (plan.attachments ?? []).length);
        break;
      case "attachmentError":
        if ((plan.attachmentError !== undefined && plan.attachmentError !== null) !== expected) {
          miss(key, expected ? "present" : "absent", plan.attachmentError ?? "absent");
        }
        break;
      case "candidatesPending":
        if (((plan.candidates ?? []).length > 0) !== expected) {
          miss(key, expected, (plan.candidates ?? []).length > 0);
        }
        break;
      case "briefingPresent":
        if ((briefingCount > 0) !== expected) miss(key, expected, briefingCount > 0);
        break;
      case "ledePresent":
        // FAIL when the live synthesis returned a blank lede but the fixture expects one.
        if (synopsisPresent !== expected) miss(key, expected, synopsisPresent);
        break;
    }
  }
  return failures;
}

// ── cost cap ─────────────────────────────────────────────────────────────────

function overCap(totalCost, cap = COST_CAP_USD) {
  return totalCost > cap;
}

// ── offline self-check (ZERO convex calls; plain assert, no framework) ───────

function selfCheck() {
  // 1. Every real fixture parses, has non-empty turns, needles, closed vocabulary.
  const fixtures = loadFixtures();
  assert.ok(fixtures.length >= 18, `expected >= 18 fixtures, found ${fixtures.length}`);
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

  // 3. Cost summation + cap logic on synthetic per-turn costs.
  const trip = [0.4, 0.4, 0.3].reduce((sum, c) => sum + c, 0);
  assert.ok(overCap(trip), "$1.10 must trip the $1.00 cap");
  const under = [0.05, 0.1].reduce((sum, c) => sum + c, 0);
  assert.ok(!overCap(under), "$0.15 must not trip the cap");
  assert.ok(!overCap(1.0), "exactly $1.00 does not trip (cap is strictly greater-than)");

  // 4. --skill pin parsing.
  assert.deepEqual(parseSkillPin("cockpit-agent@3"), { name: "cockpit-agent", version: 3 });
  assert.deepEqual(parseSkillPin("document-drafter@12"), { name: "document-drafter", version: 12 });
  // inbox-digest joined GATED_SKILLS in 03.7-03 — it is the one skill whose INPUT is untrusted
  // third-party mail, so a pinned candidate must be evaluable.
  assert.deepEqual(parseSkillPin("inbox-digest@1"), { name: "inbox-digest", version: 1 });
  assert.throws(() => parseSkillPin("cockpit-agent"), /malformed/, "pin without @version rejected");
  assert.throws(() => parseSkillPin("cockpit-agent@x"), /malformed/, "non-numeric version rejected");
  assert.throws(() => parseSkillPin("unknown-skill@3"), /unknown --skill name/, "unknown skill rejected");

  console.log(`[eval:golden] self-check PASSED (${fixtures.length} fixtures valid, vocabulary/cap/pin logic proven offline)`);
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

function attemptCase(fixture, tenant, pin) {
  const { planId, threadId } = parse(must("smoke:seedCockpitPlan", { tenant }));
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
        ...(history.length ? { history } : {}),
        ...(pin && { skillVersions: { [pin.name]: pin.version } }),
      }),
    );
    if (res.blocked) {
      const hint =
        res.blocked === "daily_budget_exhausted" ? " — try: npx convex run smoke:resetDailySpend" : "";
      abortEnv(`environment drained (${res.blocked}) — not an eval failure${hint}`);
    }
    caseCost += res.costUsd ?? 0;
    totalCost += res.costUsd ?? 0;
    if (overCap(totalCost)) {
      abortEnv(`COST CAP EXCEEDED ($${totalCost.toFixed(4)} > $${COST_CAP_USD.toFixed(2)})`);
    }
    history.push({ role: "user", content: text }, { role: "assistant", content: res.reply ?? "" });
  }
  // Assert on plan STATE (never on res.reply — locked). A briefing fixture adds ONE read of
  // the thread's briefings rows — skipped otherwise, so non-briefing cases cost no extra hop.
  const plan = parse(must("plans:getById", { planId }));
  const briefingCount =
    fixture.expect.briefingPresent === undefined
      ? 0
      : parse(must("smoke:briefingCountForThread", { tenantId: tenant, threadId }));
  const synopsisPresent =
    fixture.expect.ledePresent === undefined
      ? false
      : parse(must("smoke:briefingSynopsisPresent", { tenantId: tenant, threadId }));
  const failures = evaluateExpect(fixture.expect, plan, briefingCount, synopsisPresent);
  // Standing invariants: zero requests rows + refs-only needle scan (throws on violation).
  try {
    must("smokeAssert:assertEvalCaseClean", { tenant, needles: fixture.needles });
  } catch (e) {
    failures.push({ key: "standing-invariants", expected: "clean", actual: e.message.split("\n")[0] });
  }
  return { pass: failures.length === 0, failures, caseCost };
}

async function runLive(pin) {
  const fixtures = loadFixtures(); // fail fast BEFORE the first spawn
  const runId = randomUUID().slice(0, 8);
  const tenant = `eval-${runId}`; // throwaway — isolates every tenant-scoped table
  const retriedCases = [];
  const results = [];

  console.log(
    `[eval:golden] run ${runId} — ${fixtures.length} cases, tenant ${tenant}, cap $${COST_CAP_USD.toFixed(2)}` +
      (pin ? `, pin ${pin.name}@${pin.version}` : ""),
  );

  // 03.7-05: seed the eval tenant's inbox ONCE, before the first turn. The eval tenant has no
  // Gmail token, so without this every briefing case degrades to not_connected and measures
  // nothing (research Pitfall 3). `offlineDigest: false` is the whole point of the probe: the
  // poisoned body reaches the LIVE toolless digest, so 17's zero-actuation is a real result and
  // not a fixture short-circuit. Every case shares the one inbox — the injected mail sits in it
  // for ALL of them, because the defense must hold whichever case reads it.
  const { messageCount } = parse(must("smoke:seedInboxFixture", { tenantId: tenant, offlineDigest: false }));
  console.log(`[eval:golden] seeded inbox fixture: ${messageCount} message(s), live digest`);

  // 10-04 (VGND-01): seed a REAL embedded vault corpus ONCE, same one-shot shape as the inbox seed.
  // 25-vault-grounded's live `searchVault` must resolve against a real `rag.add` doc (namespace =
  // tenant), so without this the grounded fixture would retrieve nothing. `vaultSmoke:seedCorpus` is
  // an internalAction callable via `convex run` (identity-less, explicit tenantId) that embeds two
  // "Northwind-evalgrd" logistics briefs. The eval tenant is throwaway (`eval-${runId}`) — no purge
  // (the inbox seed isn't purged either). Needs the deployment OPENAI_API_KEY the eval already requires.
  const { docIds: vaultDocIds } = parse(must("vaultSmoke:seedCorpus", { tenantId: tenant, needle: "evalgrd" }));
  console.log(`[eval:golden] seeded vault corpus: ${vaultDocIds.length} doc(s), live embed`);

  for (const fixture of fixtures) {
    let outcome;
    let retried = false;
    try {
      outcome = attemptCase(fixture, tenant, pin);
    } catch (e) {
      outcome = { pass: false, failures: [{ key: "error", expected: "run", actual: e.message.split("\n")[0] }], caseCost: 0 };
    }
    if (!outcome.pass) {
      // Flake policy (locked): exactly ONE automatic re-run on a FRESH seeded plan.
      retried = true;
      let second;
      try {
        second = attemptCase(fixture, tenant, pin);
      } catch (e) {
        second = { pass: false, failures: [{ key: "error", expected: "run", actual: e.message.split("\n")[0] }], caseCost: 0 };
      }
      if (second.pass) {
        retriedCases.push(fixture.id);
        outcome = { ...second, caseCost: outcome.caseCost + second.caseCost };
      } else {
        outcome = { ...second, caseCost: outcome.caseCost + second.caseCost };
      }
    }
    results.push({ id: fixture.id, ...outcome, retried });

    const tag = outcome.pass ? (retried ? "PASS (retried)" : "PASS") : "FAIL";
    console.log(`  ${tag.padEnd(15)} ${fixture.id}  ($${outcome.caseCost.toFixed(4)})`);
    if (!outcome.pass) {
      for (const f of outcome.failures) {
        console.log(`      ${f.key}: expected ${JSON.stringify(f.expected)}, got ${JSON.stringify(f.actual)}`);
      }
    }
  }

  const casesPassed = results.filter((r) => r.pass).length;
  const casesTotal = results.length;
  const allGreen = casesPassed === casesTotal;
  console.log(
    `\n[eval:golden] ${casesPassed}/${casesTotal} passed` +
      (retriedCases.length ? ` (retried: ${retriedCases.join(", ")})` : "") +
      ` — total cost $${totalCost.toFixed(4)}`,
  );

  // Evidence: only on an ALL-GREEN run with a --skill pin (refs/counts only, §4) —
  // the exact EvalEvidence shape hasPassingEvidence parses (03.6-01).
  if (allGreen && pin) {
    const evidence = JSON.stringify({
      runner: "eval:golden",
      runId,
      pass: true,
      casesPassed,
      casesTotal,
      retriedCases,
      costUsd: totalCost,
      model: "openai/gpt-4o-mini",
      skillVersions: { [pin.name]: pin.version },
      ts: Date.now(),
    });
    must("skills:recordEvalEvidence", { name: pin.name, version: pin.version, evidence });
    console.log(`[eval:golden] evidence recorded on ${pin.name} v${pin.version}`);
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
  const skillIdx = argv.indexOf("--skill");
  const pin = skillIdx >= 0 ? parseSkillPin(argv[skillIdx + 1]) : null;
  await runLive(pin);
} catch (e) {
  console.error(`[eval:golden] ${e.message}`);
  process.exit(1);
}
