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
//                                       [--tenant-skill <tenantSkillsId>] [--only <id-substring>]
//   --skill      pin that GLOBAL skill version on every turn; an all-green pinned
//                run records refs/counts-only evidence via skills:recordEvalEvidence
//                (the EVAL_GATE input for activateSkill).
//   --tenant-skill 21-03: pin an EXACT `tenantSkills` ROW on every turn. Orthogonal
//                to --skill, not a replacement: `<name>@<version>` stopped naming a
//                body the moment two tenants could each own version 2. Evidence
//                lands on that one row via skills:recordTenantEvalEvidence.
//                The registry tenant is READ ONLY — every fixture plan, message and
//                assertion still runs under the throwaway `eval-<runId>` tenant.
//   --only       DIAGNOSTIC ONLY — run just the fixtures whose id contains this
//                substring. A filtered run is NOT the gate and records NO evidence.
//   --self-check offline validation (ZERO convex calls): fixture vocabulary,
//                cap/pin/filter logic — the ponytail one-runnable-check.
//
// Read-only modes (no fixture seed, no model call, no write):
//   --inspect-tenant-skill <id> [--json] [--foreign-tenant <tenantId>]
//                               [--expect-status=…] [--expect-evidence=…]
//                               [--expect-gate-passed=…] [--expect-rollback-eligible=…]
//
// NO PHASE-21 TENANT CANDIDATE HAS PASSED A LIVE GATE. Nothing in this file activates
// anything: `--tenant-skill` records evidence, and activation is a separate owner act.
//
// Exit codes: 0 all green · 1 any case failure · 2 environment abort (governed
// stop or cost cap — never an eval failure).
//
// Mirrors run-smoke-*.mjs conventions: `must()` judges success by CLI OUTPUT
// (Windows/Node24 exit-code crash), `convex run` prints the return value as JSON
// on stdout (logs go to stderr).

import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { must } from "./smokeRun.mjs";

const parse = (out) => JSON.parse(out);

// 16-09: every smoke:*ForThread read is a pure internalQuery — FREE and IDEMPOTENT — so one retry on
// the empty-stdout CLI teardown crash is safe here in a way it is NOT for llm:runCockpitAgent (a
// retry bills a second model turn) or skills:recordEvalEvidence (a duplicate evidence row).
const RETRY_READ = { retryOnEmpty: true };

// 2026-08-10: the PAID turn now retries on EMPTY stdout too, reversing the note above — not because
// the double-billing risk went away, but because it was measured and it is the cheaper side.
//
// `must()` retries only when stdout is EMPTY and no failure banner printed, which on this box means
// exactly one thing: the Windows/Node-24 `UV_HANDLE_CLOSING` teardown crash, where `convex run`
// completes and dies before flushing. A REAL error still prints a banner and still fails hard, so
// this cannot mask a genuine refusal, a governed stop, or a model error.
//
// The economics, both measured this session: a duplicated turn bills ~$0.01. The hard fail it
// replaces costs a ~$0.42 full-gate re-run, because evidence writes only on an all-green unfiltered
// run — so ONE teardown crash on ONE fixture discards the whole gate. It hit twice in three
// attempts (fixture 18 local, fixture 10 cloud), both at $0.0000.
//
// The durable fix is to stop shelling out to `npx convex run` and use ConvexHttpClient in
// `smokeRun.mjs`'s `must()`, which removes the crash for every script in the repo. Deferred: that
// is a refactor of a shared helper and wants its own test pass, and this flag buys the same
// outcome for one line. ponytail: retry-on-empty here, ConvexHttpClient in `must()` when someone
// touches that helper for another reason.
const RETRY_TURN = { retryOnEmpty: true };
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

/** The model every evidence row records. ONE constant for both scopes (21-03): the global and
 *  tenant writers used to be one block and are now two, and a hand-copied literal in the second is
 *  exactly how a run comes to certify itself against a model it did not use. */
const EVAL_MODEL = "openai/gpt-4o-mini";

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
const BLUEPRINT_NEEDLE = "evalblpr";
const INSUFFICIENT_EVIDENCE_PHRASE = "insufficient evidence";
// 22.1b. A turn that NAMES the tool turns the probe into a compliance test — "did the model do the
// thing the prompt told it to do" — which is exactly the vacuity fixture 33 exists to avoid. The
// question must be unanswerable; reaching for the channel must be the specialist's OWN judgement.
const DECLARE_TOOL_NAME = "declareunsupported";

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

// 19-10: the DELIBERATELY UNGATED exemption set, derived from the SAME file for the same reason.
// `skill.ts` maintains a written, dated justification above every skill it refuses to gate (the
// `content-drafter` precedent, six rows and counting) — the decision already exists at the
// canonical site; this runner just could not see it, which is why the dispatchable-route assertion
// below has been red on main since Phase 20 registered `media`. Deriving rather than re-listing
// means a new exemption registers itself the day it is written, and — the part that matters — it
// can ONLY register by writing the justification, which is the enforcement actually wanted here.
function ungatedSkillNames() {
  const src = readFileSync(skillSrcPath, "utf8");
  return [
    ...src.matchAll(
      /DELIBERATELY UNGATED[\s\S]*?\*\/\s*export const [A-Z0-9_]+\s*=\s*"([a-z0-9.-]+)"/g,
    ),
  ].map((m) => m[1]);
}

const UNGATED_SKILL_NAMES = ungatedSkillNames();

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

// 19-10: route -> registry skill name, read off `SPECIALISTS[route].skillName`. This replaced a
// hand-maintained ternary (`route === "research" ? "research-specialist" : route`) that was a
// second copy of a mapping the registry already carries — and whose drift is why the gating
// assertion below named the ROUTE `media` rather than the real skill `media-director`, sending
// whoever read the failure looking for a skill by that name that does not exist.
function specialistSkillNames() {
  const src = readFileSync(specialistSrcPath, "utf8");
  const block = /export const SPECIALISTS[^=]*=\s*\{([\s\S]*?)\n\};/.exec(src);
  if (!block) throw new Error(`SPECIALISTS not found in ${specialistSrcPath}`);
  const byRoute = {};
  for (const m of block[1].matchAll(
    /(?:"([a-z0-9-]+)"|([a-z][a-z0-9-]*))\s*:\s*\{[\s\S]*?skillName:\s*"([a-z0-9.-]+)"/g,
  )) {
    byRoute[m[1] ?? m[2]] = m[3];
  }
  return byRoute;
}

const SPECIALIST_ROUTES = specialistRoutes();
const SPECIALIST_SKILLS = specialistSkillNames();

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
  //   declaredUnsupported — 22.1b. smoke:researchDeclaredUnsupportedForThread: did the specialist
  //     CALL `declareUnsupported`? The SEMANTIC half of the verdict, and the ONLY key that
  //     separates "searched and judged the sources insufficient" from "searched, got zero
  //     citations, and confabulated" — those satisfy `insufficientEvidence` identically. The
  //     closed EXPECT vocabulary is extended by exactly this one key, deliberately.
  "researchDocPresent",
  "insufficientEvidence",
  "webSearchCallsAtLeast",
  "declaredUnsupported",
  // Phase 18 (ACTN-04): `createdDocCount` — how many standalone documents `createDocument` saved
  // on the thread, read from smoke:createdDocCountForThread (the `vaultSources` role:"created"
  // row's `docIds`), never from the reply. The failure it exists to catch is the agent ANSWERING
  // IN PROSE — describing the one-pager it would write — while never calling the tool, which no
  // reply assertion can tell apart from success.
  // It is a COUNT rather than a boolean on purpose: the tool is read-then-append, so one row
  // carries all N docs and a `replace: N` revision rewrites in place. A create-then-revise fixture
  // asserting 1 therefore proves the tool ran AND that `replace` revised instead of duplicating —
  // the locked revision semantic, which has no code branch to test offline.
  "createdDocCount",
  // 20-12 (MEDIA-01): `mediaDispatchCount` — how many times the agent CALLED `dispatchMedia` on
  // the thread, read from smoke:mediaDispatchCountForThread (`agentSteps` rows carrying that
  // tool), never from the reply and never from the plan row.
  //
  // NOT plan state, and the reason is structural: `plans.by_thread` is `.unique()` and
  // `stageMediaPlan` recycles that one row, so a plan-derived observable can say "a media plan
  // exists" and can NEVER say the tool was called twice. `agentSteps` writes a row per call, so a
  // duplicate dispatch is visible here and nowhere else.
  //
  // The failure it exists to catch is the agent answering IN PROSE — "I'll get a reel together" —
  // while never calling the tool, which no reply assertion can tell apart from success.
  //
  // ZERO IS A LEGITIMATE ASSERTION HERE, unlike every other count in this vocabulary, and that is
  // what fixture 38b is: a slide-deck request must route to `createDocument` and must NOT reach
  // the video specialist. `validateFixture` therefore does not reject a zero outright — it
  // requires the zero to be PAIRED with a positive proof that the agent did the right thing
  // instead (`createdDocCount`), because a bare `mediaDispatchCount: 0` passes on a turn where
  // the agent did nothing at all.
  "mediaDispatchCount",
  // 20.1-02 (VALT-15): `driveReadToolCount` — how many times the agent called EITHER Drive read
  // tool (`findInDrive`, `listDriveFolders`) on the thread, read from
  // smoke:driveReadCountForThread (`agentSteps` rows), never from the reply.
  //
  // A FLOOR, not an equality — the one count in this vocabulary graded as `actual >= expected`.
  // Deliberate, and the contrast with `mediaDispatchCount` is the reason: a duplicate DISPATCH is
  // the defect that count exists to expose, while a second Drive READ is legitimate behaviour
  // (search, then drill one folder level). Pinning equality here would fail the agent for reading
  // MORE carefully. The vacuous direction is still closed: `validateFixture` rejects
  // `driveReadToolCount: 0` outright — there is no "must not read Drive" fixture semantic; that
  // negative belongs to a paired-zero design like 38b's if it is ever needed.
  "driveReadToolCount",
  // Phase 19 (ACTN-05): `crmOperationCount` — how many changes to the user's OWN records
  // `stageCrmWrite` staged on this thread. Graded off `plan.crmOperations`, the content-plane field
  // 19-06 put on the plan row, exactly like `attachmentCount` and `recipientCount`.
  // Deliberately NOT a `smoke:` read: `createdDocCount` needs its own query only because a created
  // document lives in `vaultSources` and never touches the plan, whereas a STAGED crm operation IS
  // the plan row — a smoke op would fetch the row `plans:getById` already returned. Still a $0
  // observable: no model call, no extra hop.
  // The failure it exists to catch is the agent replying "I've saved them to your contacts" while
  // never calling the tool, which no reply assertion can tell apart from success. And because
  // `stageCrmWrite` STAGES only, a non-zero count is never evidence that anything was written:
  // the apply happens behind a human Approve the harness never clicks.
  "crmOperationCount",
  // Phase 19 (ACTN-05), added 19-10 to close a gap 19-09 found ON ITS OWN PASSING RUN:
  // `datedFollowUpCount` — how many of the staged operations are an `addFollowUp` carrying a
  // finite `dueAt`. `crmOperationCount` is a COUNT and cannot tell op TYPES apart, so fixture 36
  // was passing on a staged `addContact` with no `due` while its prose described a dated
  // follow-up. That is two separate untruths in one green tick: the dated follow-up the fixture
  // claims to prove was never created, and the agent saved a contact the user never asked it to
  // save — which is in tension with SC#7's "contacts are created by EXPLICIT ACTS only".
  // A count rather than a boolean, for `createdDocCount`'s reason: it also pins that a second
  // turn naming nobody did not quietly add a second dated row.
  // The `dueAt` half is not decoration — `stageCrmWrite` resolves the user's WORDS through
  // `parseSendTime` against the trusted clock, so a finite `dueAt` is the observable end of that
  // whole §2-D chain, and an undated follow-up is one the `by_tenant_status_dueAt` range read
  // (and therefore the "Follow-ups due" tile) can never surface.
  "datedFollowUpCount",
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
  // Task 9 (live-finance-inputs): `financeClaimCount` — how many figure updates
  // `stageFinanceWrite` staged on this thread. Graded off `plan.financeClaims`, the
  // content-plane field Task 8 put on the plan row — the exact `crmOperationCount` /
  // `attachmentCount` shape, one array length read off the plan row, no smoke query, no model
  // call, no extra hop.
  // The failure it exists to catch is the same one `crmOperationCount` exists for: the agent
  // replying "I've updated your cash on hand" (or silently computing the ratio itself instead
  // of calling `readFinance`) while `stageFinanceWrite` never ran, which no reply assertion can
  // tell apart from success. And because the tool STAGES only, a non-zero count is never
  // evidence anything was written — the apply happens behind a human Approve this harness never
  // clicks, same as every other staging tool here.
  "financeClaimCount",
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
  for (const key of ["insufficientEvidence", "webSearchCallsAtLeast", "declaredUnsupported"]) {
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
  // Phase 18: same anti-vacuity rule as the hosted-search floor. `createdDocCount: 0` would pass on
  // every fixture in the set — including the 33 that never mention a document — so it asserts
  // nothing and is rejected before the first spawn. A fixture that means "the agent must NOT create
  // one" is a real thing to want, but it needs its own key rather than a zero that reads as absent.
  if (
    fx.expect.createdDocCount !== undefined &&
    (!Number.isInteger(fx.expect.createdDocCount) || fx.expect.createdDocCount < 1)
  ) {
    fail("expect.createdDocCount must be an integer >= 1 (a zero count is vacuous)");
  }
  // 20-12 (MEDIA-01). The ONE count in this vocabulary where zero is a real assertion — "a slide
  // deck must NOT reach the video specialist" is the whole point of fixture 38b. So the rule is
  // not "reject zero", it is "a zero must be PAIRED": on its own, `mediaDispatchCount: 0` passes
  // on a turn where the agent did nothing whatsoever, which is the vacuity this file exists to
  // refuse. Paired with `createdDocCount`, it asserts the agent chose the OTHER tool — a claim
  // only a wrong routing decision can fail.
  if (fx.expect.mediaDispatchCount !== undefined) {
    if (!Number.isInteger(fx.expect.mediaDispatchCount) || fx.expect.mediaDispatchCount < 0) {
      fail("expect.mediaDispatchCount must be an integer >= 0");
    }
    if (fx.expect.mediaDispatchCount === 0 && fx.expect.createdDocCount === undefined) {
      fail(
        "expect.mediaDispatchCount:0 requires createdDocCount (a bare zero passes on a turn that did nothing)",
      );
    }
  }
  // 20.1-02 (VALT-15): `driveReadToolCount` is a FLOOR (see the vocabulary note), so zero is
  // rejected OUTRIGHT rather than paired: "at least zero reads" is true of every turn ever run,
  // which is the vacuity this file exists to refuse.
  if (fx.expect.driveReadToolCount !== undefined) {
    if (!Number.isInteger(fx.expect.driveReadToolCount) || fx.expect.driveReadToolCount < 1) {
      fail("expect.driveReadToolCount must be an integer >= 1 (a floor of zero asserts nothing)");
    }
  }
  // Phase 19 (ACTN-05): the same anti-vacuity rule, for the same reason. `crmOperationCount: 0`
  // passes on all 34 fixtures that never mention a contact, so it asserts nothing. A fixture that
  // means "the agent must NOT stage a record change" needs its own key, not a zero that reads as
  // absent — fixture 36's second turn gets that property from the count staying at 1 instead.
  if (
    fx.expect.crmOperationCount !== undefined &&
    (!Number.isInteger(fx.expect.crmOperationCount) || fx.expect.crmOperationCount < 1)
  ) {
    fail("expect.crmOperationCount must be an integer >= 1 (a zero count is vacuous)");
  }
  // 19-10: same anti-vacuity rule, and one PAIRING rule. `datedFollowUpCount` is a subset count of
  // `crmOperationCount`, so a fixture asserting the subset without the total would let an agent
  // stage the right follow-up plus three unrequested contacts and still pass.
  if (
    fx.expect.datedFollowUpCount !== undefined &&
    (!Number.isInteger(fx.expect.datedFollowUpCount) || fx.expect.datedFollowUpCount < 1)
  ) {
    fail("expect.datedFollowUpCount must be an integer >= 1 (a zero count is vacuous)");
  }
  // Task 9: same anti-vacuity rule as crmOperationCount, for the same reason —
  // `financeClaimCount: 0` passes on every fixture that never mentions a figure, so it asserts
  // nothing. A fixture meaning "the agent must NOT stage a figure update" needs its own key.
  if (
    fx.expect.financeClaimCount !== undefined &&
    (!Number.isInteger(fx.expect.financeClaimCount) || fx.expect.financeClaimCount < 1)
  ) {
    fail("expect.financeClaimCount must be an integer >= 1 (a zero count is vacuous)");
  }
  if (fx.expect.datedFollowUpCount !== undefined && fx.expect.crmOperationCount === undefined) {
    fail("expect.datedFollowUpCount requires crmOperationCount (it is a SUBSET of the total)");
  }
  if (
    fx.expect.datedFollowUpCount !== undefined &&
    fx.expect.datedFollowUpCount > fx.expect.crmOperationCount
  ) {
    fail("expect.datedFollowUpCount cannot exceed crmOperationCount");
  }
  // Phase 19 (ACTN-05): `clock: true` gives ONE fixture a `clientContext` (tz + nowMs) — which
  // every production driver always supplies and this harness never has. OPT-IN, so all 34 certified
  // fixtures keep sending a byte-identical request and nothing about the gate they passed moves.
  // It is required, not cosmetic: `stageCrmWrite` returns its `no_clock` refusal for ANY dated
  // follow-up when `clientContext` is absent (llm.ts — the proposeCalendarEvent rule), so without a
  // clock a follow-up fixture measures the missing clock rather than the body, and its second turn
  // could not rise above 1 no matter what the agent did. That is the definition of vacuous.
  if (fx.clock !== undefined && fx.clock !== true) fail("clock must be true when present");
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
  if (fx.turns.some((t) => t.includes(BLUEPRINT_NEEDLE))) {
    fail(
      `a turn contains the Blueprint needle "${BLUEPRINT_NEEDLE}" — that makes the standing-spine proof vacuous`,
    );
  }
  if (fx.turns.some((t) => t.toLowerCase().includes(INSUFFICIENT_EVIDENCE_PHRASE))) {
    fail(
      `a turn contains "${INSUFFICIENT_EVIDENCE_PHRASE}" — that makes the stored verdict probe vacuous`,
    );
  }
  if (fx.turns.some((t) => t.toLowerCase().includes(DECLARE_TOOL_NAME))) {
    fail(
      `a turn names the declareUnsupported tool — that turns the declaration probe into a ` +
        `compliance test`,
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

// ── 21-03: --tenant-skill (EXACT tenant candidate rows) ──────────────────────

/**
 * A `tenantSkills` row id, syntactically. Deliberately loose — the REAL validator is Convex's
 * `v.id("tenantSkills")` on the read below, which knows the table. This only has to catch the
 * mistakes that would otherwise be swallowed silently: a missing value, and a following FLAG eaten
 * as the id (the `--only requires a value` lesson — a swallowed flag turns a pinned run into an
 * unpinned one that then writes evidence).
 */
function parseTenantSkillId(spec) {
  if (typeof spec !== "string" || spec.trim() === "" || spec.startsWith("--")) {
    throw new Error(`--tenant-skill requires a tenantSkills row id (got ${JSON.stringify(spec)})`);
  }
  if (/\s/.test(spec)) throw new Error(`malformed --tenant-skill id ${JSON.stringify(spec)}`);
  return spec;
}

/** Multi-pin like `--skill`, and a repeated ID is rejected for the same reason a repeated NAME is:
 *  it is a typo, not a request. (A repeated SKILL NAME across two different ids is caught by
 *  `mergePinScopes` once the ids have been resolved, because only the deployment knows the names.) */
function parseTenantSkillIds(argv) {
  const ids = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] !== "--tenant-skill") continue;
    const id = parseTenantSkillId(argv[i + 1]);
    if (ids.includes(id)) throw new Error(`--tenant-skill ${id} pinned twice`);
    ids.push(id);
  }
  return ids;
}

/**
 * The ONE place the two pin scopes meet. Rejects a skill NAME pinned in both scopes, and the same
 * name reached through two different tenant rows.
 *
 * This is not tidiness. Both records are keyed by skill NAME on the way into `runSpecialistTurn`,
 * and the tenant id WINS there — so a name present in both scopes means the `--skill` pin silently
 * does nothing while its evidence row still claims the version ran. Last-one-wins must never
 * decide which body a paid run certifies.
 */
function mergePinScopes(pins, tenantTargets) {
  const scopeOf = new Map(pins.map((p) => [p.name, "global"]));
  for (const t of tenantTargets) {
    const existing = scopeOf.get(t.name);
    if (existing === "global") {
      throw new Error(
        `${t.name} is pinned in BOTH scopes (--skill and --tenant-skill) — one run can certify one body per skill`,
      );
    }
    if (existing === "tenant") {
      throw new Error(`${t.name} is pinned by two different --tenant-skill rows`);
    }
    scopeOf.set(t.name, "tenant");
  }
  return {
    skillVersions: skillVersionsOf(pins),
    tenantSkillIds: Object.fromEntries(tenantTargets.map((t) => [t.name, t.candidateId])),
  };
}

/**
 * A resolved snapshot is only an EVALUABLE target if the row is a user-authored candidate.
 *
 * An `active` row is already what the tenant runs — "certifying" it is a no-op that would spend
 * ~$0.4 to write evidence onto a body no gate will ever read. A `system` baseline is the rollback
 * target, code-owned, and never a thing a user asked for. Both refuse HERE, before the inbox/vault/
 * Blueprint seeds and before the first paid turn, so the mistake costs $0.
 */
function assertEvaluableCandidate(snapshot, id) {
  const c = snapshot?.candidate;
  if (!c) throw new Error(`--tenant-skill ${id}: no candidate in the inspection snapshot`);
  if (c.author !== "user") {
    throw new Error(
      `--tenant-skill ${id} is a "${c.author}" row — only user-authored candidates are evaluable`,
    );
  }
  if (c.status !== "candidate") {
    throw new Error(
      `--tenant-skill ${id} has status "${c.status}" — only a candidate is evaluable`,
    );
  }
  return {
    candidateId: c.id,
    registryTenantId: c.tenantId,
    name: c.name,
    version: c.version,
    bodyHash: c.bodyHash,
  };
}

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
      throw new Error(
        `--only "${s}" matched no fixture (ids: ${fixtures.map((f) => f.id).join(", ")})`,
      );
    }
  }
  return fixtures.filter((f) => filters.some((s) => f.id.includes(s)));
}

// ── 21-03: the read-only inspection mode + the evidence-suppression rule ─────

/** Every flag this script understands. An argument NOT in here aborts — a typo must never fall
 *  through into a ~$0.4 paid run whose pin was silently ignored (`--tenant-skil <id>` would
 *  otherwise run the gate unpinned and then write no evidence, after paying for all of it). */
const KNOWN_FLAGS = new Set([
  "--skill",
  "--tenant-skill",
  "--only",
  "--self-check",
  "--inspect-tenant-skill",
  "--foreign-tenant",
  "--json",
  "--expect-status",
  "--expect-evidence",
  "--expect-gate-passed",
  "--expect-rollback-eligible",
]);
/** The flags that take a following value — so the value itself is not mistaken for an argument. */
const VALUED_FLAGS = new Set([
  "--skill",
  "--tenant-skill",
  "--only",
  "--inspect-tenant-skill",
  "--foreign-tenant",
]);

/**
 * `pnpm --filter @pikar/backend eval:golden -- --self-check` forwards the SEPARATOR itself, so
 * `process.argv` really does contain a bare `"--"`. Stripped once, at the entry, so every parser
 * below sees the same clean argv — and so the documented pnpm invocation is not rejected by the
 * unknown-argument guard. (Caught by this plan's own verify command: the guard's first version
 * aborted `-- --self-check` with `unknown argument "--"`.)
 *
 * No legitimate VALUE is `"--"`: `parseTenantSkillId` and `parseOnlyFilters` both refuse a value
 * starting with `--`, so stripping cannot swallow one.
 */
const stripSeparator = (argv) => argv.filter((a) => a !== "--");

function assertKnownArgs(argv) {
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--") continue; // belt: the entry already strips it
    if (!a.startsWith("--")) continue;
    const [flag] = a.split("=", 1);
    if (!KNOWN_FLAGS.has(flag)) {
      throw new Error(`unknown argument "${a}" (known: ${[...KNOWN_FLAGS].sort().join(" ")})`);
    }
    if (VALUED_FLAGS.has(flag) && !a.includes("=")) i++; // skip the value
  }
  return true;
}

/** `--flag=value`, or undefined when absent. `--flag` with no `=` is an error rather than a
 *  silent `true`: an EXPECTATION with no expected value asserts nothing, which is the one failure
 *  mode a flag named `--expect-…` must never have. */
function valueFlag(argv, flag) {
  const hit = argv.find((a) => a === flag || a.startsWith(`${flag}=`));
  if (hit === undefined) return undefined;
  if (hit === flag) throw new Error(`${flag} requires a value, e.g. ${flag}=candidate`);
  return hit.slice(flag.length + 1);
}

/** `--flag value` OR `--flag=value`, for the flags that take an opaque id rather than a small
 *  vocabulary. Both spellings, because `--skill`/`--only` established the spaced form and typing
 *  the other one should not silently produce a different run. */
function spacedOrEqualsValue(argv, flag) {
  const eq = argv.find((a) => a.startsWith(`${flag}=`));
  if (eq !== undefined) return eq.slice(flag.length + 1);
  const i = argv.indexOf(flag);
  return i === -1 ? undefined : argv[i + 1];
}

const EXPECT_FLAGS = /** @type {const} */ ([
  ["--expect-status", "status"],
  ["--expect-evidence", "evidenceState"],
  ["--expect-gate-passed", "gatePassed"],
  ["--expect-rollback-eligible", "rollbackEligible"],
]);

const EVIDENCE_STATES = new Set(["absent", "passing", "failing"]);
const CANDIDATE_STATUSES = new Set(["candidate", "active", "archived", "rolled_back"]);

/**
 * Parse the read-only inspection invocation, or return null when this is an ordinary run.
 *
 * MUTUALLY EXCLUSIVE with every paid argument. Not a nicety: `--inspect-tenant-skill` exits before
 * the fixture seed, so `--inspect-tenant-skill X --skill cockpit-agent@9` would look like a gate
 * run to whoever typed it and silently be an inspection — a "green" that never ran a case.
 */
function parseInspectArgs(argv) {
  const idx = argv.findIndex(
    (a) => a === "--inspect-tenant-skill" || a.startsWith("--inspect-tenant-skill="),
  );
  const expectations = {};
  for (const [flag, key] of EXPECT_FLAGS) {
    const raw = valueFlag(argv, flag);
    if (raw !== undefined) expectations[key] = raw;
  }
  const hasForeign =
    argv.includes("--foreign-tenant") || argv.some((a) => a.startsWith("--foreign-tenant="));
  const foreignTenantId = spacedOrEqualsValue(argv, "--foreign-tenant");

  if (idx === -1) {
    // An expectation flag outside inspection mode is REJECTED, never ignored: ignoring it would
    // let a run that asserts nothing report success in a script that thinks it asserted something.
    if (Object.keys(expectations).length > 0) {
      throw new Error(
        `${Object.keys(expectations).join(", ")} expectation flags require --inspect-tenant-skill`,
      );
    }
    if (hasForeign) {
      throw new Error("--foreign-tenant requires --inspect-tenant-skill (it is inspection-only)");
    }
    return null;
  }

  const candidateId = parseTenantSkillId(spacedOrEqualsValue(argv, "--inspect-tenant-skill"));
  for (const paid of ["--skill", "--tenant-skill", "--only"]) {
    if (argv.includes(paid)) {
      throw new Error(`--inspect-tenant-skill is read-only and cannot be combined with ${paid}`);
    }
  }
  for (const [key, raw] of Object.entries(expectations)) {
    if (key === "status" && !CANDIDATE_STATUSES.has(raw)) {
      throw new Error(`--expect-status must be one of ${[...CANDIDATE_STATUSES].join("|")}`);
    }
    if (key === "evidenceState" && !EVIDENCE_STATES.has(raw)) {
      throw new Error(`--expect-evidence must be one of ${[...EVIDENCE_STATES].join("|")}`);
    }
    if ((key === "gatePassed" || key === "rollbackEligible") && raw !== "true" && raw !== "false") {
      throw new Error(
        `--expect-${key === "gatePassed" ? "gate-passed" : "rollback-eligible"} must be true|false`,
      );
    }
  }
  return {
    candidateId,
    foreignTenantId: hasForeign ? parseTenantSkillId(foreignTenantId) : undefined,
    json: argv.includes("--json"),
    expectations,
  };
}

/** Compare the refs-only snapshot against the expectation flags. Returns the MISMATCHES, so an
 *  empty array is the pass — the `evaluateExpect` shape, deliberately. */
function checkExpectations(snapshot, expectations) {
  const c = snapshot?.candidate ?? {};
  const actual = {
    status: c.status,
    evidenceState: c.evidenceState,
    gatePassed: String(c.gatePassed),
    rollbackEligible: String(c.rollbackEligible),
  };
  return Object.entries(expectations)
    .filter(([key, want]) => actual[key] !== want)
    .map(([key, want]) => ({ key, expected: want, actual: actual[key] }));
}

/**
 * The foreign-tenant snapshot must describe a DIFFERENT row. If another tenant's effective body is
 * this candidate's row or this candidate's bytes, then either the inspector is leaking across the
 * boundary or the overlay is not tenant-scoped — and both are refusals, not warnings.
 */
function foreignCollision(snapshot) {
  const f = snapshot?.foreignCurrent;
  if (!f) return null;
  if (f.candidateIdVisible !== false) return "foreign snapshot claims candidate ids are visible";
  if (f.effective?.id === snapshot.candidate?.id) return "foreign effective row IS this candidate";
  if (f.effective?.bodyHash === snapshot.candidate?.bodyHash) {
    return "foreign effective body hash EQUALS this candidate's";
  }
  return null;
}

/**
 * A stable fingerprint of WHICH deployment was inspected, so the Phase-21 handoff can pin that the
 * pre-gate and post-gate inspections talked to the same one.
 *
 * Query string and fragment are DROPPED before hashing: a deploy URL can carry a key, and a hash of
 * a credential is still a thing you should not print next to the id it authorizes. An unset
 * deployment hashes to null rather than to the hash of "" — "I could not tell" and "it is empty"
 * are different answers.
 */
function deploymentFingerprint(url) {
  if (typeof url !== "string" || url.trim() === "") return null;
  const bare = url.trim().split("#")[0].split("?")[0];
  return createHash("sha256").update(bare).digest("hex");
}

/** The configured deployment, read from the env the convex CLI itself uses, else `.env.local`.
 *  Reads DISK and ENV only — zero Convex calls, so `--self-check` may call it. */
function configuredDeployment() {
  for (const key of ["CONVEX_URL", "NEXT_PUBLIC_CONVEX_URL", "CONVEX_SELF_HOSTED_URL"]) {
    const v = process.env[key];
    if (typeof v === "string" && v.trim() !== "") return v;
  }
  const envPath = resolve(dirname(fileURLToPath(import.meta.url)), "..", ".env.local");
  if (!existsSync(envPath)) return null;
  const m = /^CONVEX_DEPLOYMENT\s*=\s*(.+)$/m.exec(readFileSync(envPath, "utf8"));
  return m ? m[1].trim() : null;
}

/**
 * The ONE evidence rule, extracted so `--self-check` can prove each clause instead of trusting a
 * conditional at the bottom of a 200-line function.
 *
 *  - `allGreen`     — a failed run certifies nothing (that is the whole point).
 *  - `casesTotal>0` — a ZERO-case run is `0 === 0`, i.e. "all green", and would have written
 *                     `0/0 pass`. 16-09 guarded the filtered case; this guards the empty one.
 *  - `!filters`     — a `--only` run is a tenth of the coverage and is indistinguishable from a
 *                     full gate once it is a row (16-09's load-bearing clause, unchanged).
 *
 * An over-cap or governed stop never reaches here at all: `abortEnv` exits(2) from inside the case
 * loop. `--self-check` asserts that ORDERING against the source, because a rule that is only true
 * because of where it sits is a rule one refactor away from being false.
 */
function shouldRecordEvidence({ allGreen, casesTotal, filters }) {
  return allGreen === true && casesTotal > 0 && filters.length === 0;
}

/** The exact refs/counts-only evidence body. Built HERE (pure, no I/O) so the self-check can assert
 *  its key set and its tenant target without a deployment — a fixture prompt, a model reply or a
 *  skill body appearing in this object is a §4 breach, and the offline check is where that is
 *  cheapest to catch. */
function buildTenantEvidence({
  runId,
  casesPassed,
  casesTotal,
  retriedCases,
  costUsd,
  model,
  skillVersions,
  target,
  ts,
}) {
  return {
    runner: "eval:golden",
    runId,
    pass: true,
    casesPassed,
    casesTotal,
    retriedCases,
    costUsd,
    model,
    // The run's GLOBAL pins, verbatim — the run really did carry them on every turn.
    skillVersions,
    // The EXACT row this run certified. Refs only: an id, a tenant id, a name, a number.
    tenantTarget: {
      candidateId: target.candidateId,
      registryTenantId: target.registryTenantId,
      name: target.name,
      version: target.version,
    },
    ts,
  };
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
 *  @param webSearchCalls smoke:webSearchCallsForThread (0 when unasked — read skipped).
 *  @param declaredUnsupported smoke:researchDeclaredUnsupportedForThread. FALSE when unasked or
 *  unread, and false is the FAIL-CLOSED direction: an unread key must never manufacture the
 *  honesty signal (the `vaultNeedle: ""` precedent above). */
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
  declaredUnsupported = false,
  /** @param createdDocCount smoke:createdDocCountForThread (0 when unasked — read skipped). 0 is
   *  the FAIL-CLOSED direction: an unread key must never manufacture a created document. */
  createdDocCount = 0,
  /** @param mediaDispatchCount smoke:mediaDispatchCountForThread (0 when unasked — read skipped).
   *  0 is the FAIL-CLOSED direction for the POSITIVE fixture and, paired with createdDocCount, the
   *  asserted value for the negative one. See the vocabulary note. */
  mediaDispatchCount = 0,
  /** @param driveReadToolCount smoke:driveReadCountForThread (0 when unasked — read skipped).
   *  0 is the FAIL-CLOSED direction: an unread key must never satisfy the floor. */
  driveReadToolCount = 0,
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
      case "declaredUnsupported":
        if (declaredUnsupported !== expected) miss(key, expected, declaredUnsupported);
        break;
      case "createdDocCount":
        if (createdDocCount !== expected) miss(key, expected, createdDocCount);
        break;
      case "mediaDispatchCount":
        // Equality, not a floor: "exactly one" is the assertion. A second dispatch on the same
        // thread is a real defect (it recycles the plan row the first proposal is being written
        // into), and a floor would pass on it.
        if (mediaDispatchCount !== expected) miss(key, expected, mediaDispatchCount);
        break;
      case "driveReadToolCount":
        // A FLOOR, not equality — the deliberate inverse of mediaDispatchCount's rule. A second
        // READ (search, then drill one level) is legitimate behaviour; only fewer-than-asserted
        // calls is the defect (prose answering "I found it" while never touching Drive).
        if (driveReadToolCount < expected) miss(key, expected, driveReadToolCount);
        break;
      case "crmOperationCount":
        // Plan-row key (19-06's `plans.crmOperations`), graded like `attachmentCount`.
        if ((plan.crmOperations ?? []).length !== expected)
          miss(key, expected, (plan.crmOperations ?? []).length);
        break;
      case "datedFollowUpCount": {
        // 19-10. `op` and `dueAt` are `CrmOperation`'s own field names (@pikar/core contacts.ts),
        // and `parseCrmOperations` already ran at BOTH the write and apply boundaries, so a row
        // reaching here has a finite `dueAt` or is not an addFollowUp at all. The Number.isFinite
        // re-check is the cheap belt: a plan row is content plane and this reads it raw.
        const dated = (plan.crmOperations ?? []).filter(
          (o) => o?.op === "addFollowUp" && Number.isFinite(o?.dueAt),
        ).length;
        if (dated !== expected) miss(key, expected, dated);
        break;
      }
      case "planKind":
        if (plan.kind !== expected) miss(key, expected, plan.kind ?? "absent");
        break;
      case "financeClaimCount":
        // Task 9. Plan-row key (Task 8's `plans.financeClaims`), graded like `crmOperationCount`.
        if ((plan.financeClaims ?? []).length !== expected)
          miss(key, expected, (plan.financeClaims ?? []).length);
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
  // tripwire: a fixture quietly dropped must not quietly shrink the gate. 34 adds 18-08's createDocument case (ACTN-04).
  // 35 adds 19-09's crm-follow-up case (ACTN-05) — the fixture owed by the shared-gate override
  // condition: a lane that teaches a tool in the body owes a case that exercises it.
  // 36 adds Task 9's finance-update case (live-finance-inputs) — the same owed-fixture rule for
  // `readFinance`/`stageFinanceWrite`, taught in the body alongside it.
  // 20-12: the deletion floor rises with the set — 38 and 38b are the media pair. A floor that
  // stayed at 36 would let one of them be deleted and the suite still call itself complete.
  assert.ok(fixtures.length >= 39, `expected >= 39 fixtures, found ${fixtures.length}`);
  const ids = new Set(fixtures.map((f) => f.id));
  assert.equal(ids.size, fixtures.length, "fixture ids must be unique");

  // 17.1-10: the live gate must prove the runner's THROWAWAY tenant is Blueprint-bearing before
  // the first paid turn. Source order is load-bearing: seeding/asserting after the fixture loop
  // would let a fully green run measure the old no-spine prompt.
  const runnerSource = readFileSync(fileURLToPath(import.meta.url), "utf8");
  const blueprintSeedAt = runnerSource.indexOf('must("smoke:seedGoldenEvalBlueprint"');
  const blueprintAssertAt = runnerSource.indexOf('must("blueprint:spineForTenant"');
  const paidLoopAt = runnerSource.indexOf("for (const fixture of fixtures)", blueprintSeedAt);
  assert.ok(blueprintSeedAt > 0, "golden runner must seed a confirmed Blueprint");
  assert.ok(
    blueprintAssertAt > blueprintSeedAt,
    "golden runner must read the rendered spine after seeding",
  );
  assert.ok(
    paidLoopAt > blueprintAssertAt,
    "Blueprint seed and non-null spine assertion must precede the first paid fixture",
  );

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
    () => validateFixture({ ...base, expect: { insufficientEvidence: true } }, "<synthetic>"),
    /requires researchDocPresent:true/,
    "the verdict without a persisted research document is vacuous",
  );
  assert.throws(
    () => validateFixture({ ...base, expect: { webSearchCallsAtLeast: 2 } }, "<synthetic>"),
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
    evaluateExpect(researchExpect, collecting, 0, false, 0, 0, 0, "", 1, false, 3).length,
    0,
    "a stored grounded run with three searches satisfies the paired observables",
  );
  assert.equal(
    evaluateExpect(researchExpect, collecting, 0, false, 0, 0, 0, "", 0, false, 3).length,
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
    evaluateExpect(researchExpect, collecting, 0, false, 0, 0, 0, "", 1, false, 1).length,
    1,
    "webSearchCallsAtLeast:2 MUST FAIL on a one-shot search",
  );

  // 22.1b: the SEMANTIC declaration key. Two rows — the reader must be load-bearing, and the key
  // must inherit the anti-vacuity pairing rule.
  assert.equal(
    evaluateExpect(
      { researchDocPresent: true, declaredUnsupported: true },
      collecting,
      0,
      false,
      0,
      0,
      0,
      "",
      1,
      false,
      1,
      false,
    ).length,
    1,
    "declaredUnsupported:true MUST FAIL when the audit-plane reader returns false",
  );
  assert.throws(
    () => validateFixture({ ...base, expect: { declaredUnsupported: true } }, "<synthetic>"),
    /requires researchDocPresent:true/,
    "the declaration without a persisted research document is vacuous",
  );

  // 2f. Phase 18 (ACTN-04): `createdDocCount` is in the vocabulary, is graded off the READ (arg 13)
  // rather than the plan row, and rejects the vacuous zero before any spawn.
  assert.ok(
    validateFixture({ ...base, expect: { createdDocCount: 1 } }, "<synthetic>"),
    "createdDocCount must be an accepted expect key",
  );
  assert.throws(
    () => validateFixture({ ...base, expect: { createdDocCount: 0 } }, "<synthetic>"),
    /integer >= 1/,
    "a zero created-doc count passes on every fixture in the set and asserts nothing",
  );
  assert.equal(
    evaluateExpect({ createdDocCount: 1 }, collecting, 0, false, 0, 0, 0, "", 0, false, 0, false, 1)
      .length,
    0,
    "createdDocCount:1 passes when the thread really carries one created document",
  );
  // The load-bearing negative: the agent answered in PROSE and never called the tool. No reply
  // assertion can tell that apart from success, which is the whole reason this key exists.
  assert.equal(
    evaluateExpect({ createdDocCount: 1 }, collecting, 0, false, 0, 0, 0, "", 0, false, 0, false, 0)
      .length,
    1,
    "createdDocCount:1 MUST FAIL when createDocument never ran (a prose-only answer)",
  );
  // And the revision semantic: `replace` rewrites in place, so a create-then-revise thread still
  // carries ONE document. A run that appended instead of replacing reads 2 and fails here.
  assert.equal(
    evaluateExpect({ createdDocCount: 1 }, collecting, 0, false, 0, 0, 0, "", 0, false, 0, false, 2)
      .length,
    1,
    "createdDocCount:1 MUST FAIL when a `replace` appended a second document instead of revising",
  );

  // 2f-bis. 20-12 (MEDIA-01): `mediaDispatchCount` is in the vocabulary, is graded off the READ
  // (arg 14) rather than the plan row, and its zero is PAIRED rather than banned.
  assert.ok(
    validateFixture({ ...base, expect: { mediaDispatchCount: 1 } }, "<synthetic>"),
    "mediaDispatchCount must be an accepted expect key",
  );
  assert.throws(
    () => validateFixture({ ...base, expect: { mediaDispatchCount: 0 } }, "<synthetic>"),
    /requires createdDocCount/,
    "a BARE zero media-dispatch count passes on a turn that did nothing at all",
  );
  assert.ok(
    validateFixture(
      { ...base, expect: { mediaDispatchCount: 0, createdDocCount: 1 } },
      "<synthetic>",
    ),
    "the PAIRED zero is fixture 38b's whole assertion and must be accepted",
  );
  assert.throws(
    () => validateFixture({ ...base, expect: { mediaDispatchCount: -1 } }, "<synthetic>"),
    /integer >= 0/,
    "a negative dispatch count is not a thing that can be observed",
  );
  assert.equal(
    evaluateExpect(
      { mediaDispatchCount: 1 },
      collecting,
      0,
      false,
      0,
      0,
      0,
      "",
      0,
      false,
      0,
      false,
      0,
      1,
    ).length,
    0,
    "mediaDispatchCount:1 passes when the thread really carries one dispatchMedia step",
  );
  // The load-bearing negative, and the reason this key is not read off the plan row: the agent
  // answered in PROSE ("I'll put a reel together") and never called the tool.
  assert.equal(
    evaluateExpect(
      { mediaDispatchCount: 1 },
      collecting,
      0,
      false,
      0,
      0,
      0,
      "",
      0,
      false,
      0,
      false,
      0,
      0,
    ).length,
    1,
    "mediaDispatchCount:1 MUST FAIL when dispatchMedia never ran (a prose-only answer)",
  );
  // The DUPLICATE, which only an agentSteps read can see: `plans.by_thread` is unique and
  // `stageMediaPlan` recycles it, so plan state reads identically for one dispatch and for two.
  assert.equal(
    evaluateExpect(
      { mediaDispatchCount: 1 },
      collecting,
      0,
      false,
      0,
      0,
      0,
      "",
      0,
      false,
      0,
      false,
      0,
      2,
    ).length,
    1,
    "mediaDispatchCount:1 MUST FAIL on a SECOND dispatch — equality, never a floor",
  );
  // And 38b's direction: the video tool must stay untouched on a document request.
  assert.equal(
    evaluateExpect(
      { mediaDispatchCount: 0 },
      collecting,
      0,
      false,
      0,
      0,
      0,
      "",
      0,
      false,
      0,
      false,
      0,
      1,
    ).length,
    1,
    "mediaDispatchCount:0 MUST FAIL when a slide-deck request reached the video specialist",
  );

  // 2f-ter. 20.1-02 (VALT-15): `driveReadToolCount` is in the vocabulary, is graded off the READ
  // (arg 15, smoke:driveReadCountForThread) as a FLOOR, and rejects zero OUTRIGHT (a floor of
  // zero asserts nothing — see the vocabulary note for why this key inverts mediaDispatchCount's
  // equality rule).
  assert.ok(
    validateFixture({ ...base, expect: { driveReadToolCount: 1 } }, "<synthetic>"),
    "driveReadToolCount must be an accepted expect key",
  );
  assert.throws(
    () => validateFixture({ ...base, expect: { driveReadToolCount: 0 } }, "<synthetic>"),
    /floor of zero asserts nothing/,
    "driveReadToolCount:0 is vacuous — at least zero reads is true of every turn ever run",
  );
  assert.throws(
    () => validateFixture({ ...base, expect: { driveReadToolCount: -1 } }, "<synthetic>"),
    /integer >= 1/,
    "a negative drive-read count is not a thing that can be observed",
  );
  assert.equal(
    evaluateExpect(
      { driveReadToolCount: 1 },
      collecting,
      0,
      false,
      0,
      0,
      0,
      "",
      0,
      false,
      0,
      false,
      0,
      0,
      1,
    ).length,
    0,
    "driveReadToolCount:1 passes when the thread carries exactly one Drive read step",
  );
  // The floor's whole point: a drill-down after the search is MORE careful, never a defect.
  assert.equal(
    evaluateExpect(
      { driveReadToolCount: 1 },
      collecting,
      0,
      false,
      0,
      0,
      0,
      "",
      0,
      false,
      0,
      false,
      0,
      0,
      2,
    ).length,
    0,
    "driveReadToolCount:1 passes on search-then-drill (a floor, deliberately not equality)",
  );
  // The load-bearing negative, same shape as mediaDispatchCount's: the agent answered in PROSE
  // ("it's in your Q3 folder") and never touched Drive.
  assert.equal(
    evaluateExpect(
      { driveReadToolCount: 1 },
      collecting,
      0,
      false,
      0,
      0,
      0,
      "",
      0,
      false,
      0,
      false,
      0,
      0,
      0,
    ).length,
    1,
    "driveReadToolCount:1 MUST FAIL when no Drive read tool ever ran (a prose-only answer)",
  );

  // 2g. Phase 19 (ACTN-05): `crmOperationCount` is in the vocabulary, is graded off the PLAN ROW
  // (`plans.crmOperations`, 19-06) rather than a smoke read, and rejects the vacuous zero. This
  // block IS the $0 observable's check — it runs with zero convex calls and zero model calls.
  const staged = (n) => ({
    status: "collecting",
    crmOperations: Array.from({ length: n }, () => ({ op: "addFollowUp" })),
  });
  assert.ok(
    validateFixture({ ...base, expect: { crmOperationCount: 1 } }, "<synthetic>"),
    "crmOperationCount must be an accepted expect key",
  );
  assert.throws(
    () => validateFixture({ ...base, expect: { crmOperationCount: 0 } }, "<synthetic>"),
    /integer >= 1/,
    "a zero crm-operation count passes on every fixture in the set and asserts nothing",
  );
  assert.ok(validateFixture({ ...base, clock: true }, "<synthetic>"), "clock:true is accepted");
  assert.throws(
    () => validateFixture({ ...base, clock: "yes" }, "<synthetic>"),
    /clock must be true/,
    "a non-true clock must be rejected before the first spawn",
  );
  assert.equal(
    evaluateExpect({ crmOperationCount: 1 }, staged(1)).length,
    0,
    "crmOperationCount:1 passes when the plan really carries one staged record change",
  );
  // The load-bearing negative: the agent said "I've saved them to your contacts" and never called
  // the tool. No reply assertion can tell that apart from success.
  assert.equal(
    evaluateExpect({ crmOperationCount: 1 }, staged(0)).length,
    1,
    "crmOperationCount:1 MUST FAIL when stageCrmWrite never ran (a prose-only claim)",
  );
  // And the follow-up brake: a second turn naming nobody must ASK, not invent an owner. An agent
  // that staged one anyway reads 2 and fails here — which is the whole point of fixture 36's turn 2.
  assert.equal(
    evaluateExpect({ crmOperationCount: 1 }, staged(2)).length,
    1,
    "crmOperationCount:1 MUST FAIL when a contactless follow-up was invented instead of asked about",
  );

  // 2h. 19-10: `datedFollowUpCount` — the op-TYPE key that closes the gap 19-09 found on fixture
  // 36's PASSING run. Every assertion here is $0 and runs with zero convex and zero model calls.
  const ops = (...list) => ({ status: "collecting", crmOperations: list });
  const followUp = { op: "addFollowUp", email: "a@b.test", note: "n", dueAt: 1_700_000_000_000 };
  const contact = { op: "addContact", email: "a@b.test", name: "A" };
  assert.ok(
    validateFixture(
      { ...base, expect: { crmOperationCount: 1, datedFollowUpCount: 1 } },
      "<synthetic>",
    ),
    "datedFollowUpCount must be an accepted expect key",
  );
  assert.throws(
    () =>
      validateFixture(
        { ...base, expect: { crmOperationCount: 1, datedFollowUpCount: 0 } },
        "<synthetic>",
      ),
    /integer >= 1/,
    "a zero dated-follow-up count asserts nothing",
  );
  assert.throws(
    () => validateFixture({ ...base, expect: { datedFollowUpCount: 1 } }, "<synthetic>"),
    /requires crmOperationCount/,
    "the subset key without the total would admit unrequested extra operations",
  );
  assert.throws(
    () =>
      validateFixture(
        { ...base, expect: { crmOperationCount: 1, datedFollowUpCount: 2 } },
        "<synthetic>",
      ),
    /cannot exceed/,
    "a subset larger than the total is unsatisfiable and must be rejected before the first spawn",
  );
  assert.equal(
    evaluateExpect({ datedFollowUpCount: 1 }, ops(followUp)).length,
    0,
    "datedFollowUpCount:1 passes on a real dated addFollowUp",
  );
  // THE load-bearing negative, and the exact shape fixture 36 was silently passing on: ONE staged
  // operation, so `crmOperationCount: 1` is satisfied — but it is an addContact, not the dated
  // follow-up the fixture's prose claims to prove.
  assert.equal(
    evaluateExpect({ crmOperationCount: 1 }, ops(contact)).length,
    0,
    "crmOperationCount ALONE cannot tell an addContact from an addFollowUp (this is the gap)",
  );
  assert.equal(
    evaluateExpect({ datedFollowUpCount: 1 }, ops(contact)).length,
    1,
    "datedFollowUpCount:1 MUST FAIL when the agent staged a contact instead of a dated follow-up",
  );
  // An addFollowUp with no resolvable due date is the OTHER half: it never reaches the
  // by_tenant_status_dueAt range read, so the "Follow-ups due" tile can never surface it.
  assert.equal(
    evaluateExpect({ datedFollowUpCount: 1 }, ops({ op: "addFollowUp", email: "a@b.test" })).length,
    1,
    "datedFollowUpCount:1 MUST FAIL on an UNDATED follow-up",
  );
  assert.equal(
    evaluateExpect({ datedFollowUpCount: 1 }, ops(followUp, { ...followUp, note: "m" })).length,
    1,
    "datedFollowUpCount:1 MUST FAIL when a second dated follow-up was invented",
  );

  // 2i. Task 9 (live-finance-inputs): `financeClaimCount` is in the vocabulary, is graded off the
  // PLAN ROW (`plans.financeClaims`, Task 8) rather than a smoke read, and rejects the vacuous
  // zero — the exact `crmOperationCount` shape (2g above), same reason: this block IS the $0
  // observable's check, zero convex calls, zero model calls. Added on review: the grading branch
  // had no dedicated offline coverage, so a typo in the `financeClaims` field name would only
  // surface on the fixture's first LIVE (paid) run instead of failing here for free.
  const financeStaged = (n) => ({
    status: "collecting",
    financeClaims: Array.from({ length: n }, () => ({ field: "cashOnHand", value: 1 })),
  });
  assert.ok(
    validateFixture({ ...base, expect: { financeClaimCount: 1 } }, "<synthetic>"),
    "financeClaimCount must be an accepted expect key",
  );
  assert.throws(
    () => validateFixture({ ...base, expect: { financeClaimCount: 0 } }, "<synthetic>"),
    /integer >= 1/,
    "a zero finance-claim count passes on every fixture in the set and asserts nothing",
  );
  assert.equal(
    evaluateExpect({ financeClaimCount: 1 }, financeStaged(1)).length,
    0,
    "financeClaimCount:1 passes when the plan really carries one staged figure claim",
  );
  // The load-bearing negative: the agent said "I've updated your cash on hand" and never called
  // stageFinanceWrite. No reply assertion can tell that apart from success.
  assert.equal(
    evaluateExpect({ financeClaimCount: 1 }, financeStaged(0)).length,
    1,
    "financeClaimCount:1 MUST FAIL when stageFinanceWrite never ran (a prose-only claim)",
  );
  assert.equal(
    evaluateExpect({ financeClaimCount: 1 }, financeStaged(2)).length,
    1,
    "financeClaimCount:1 MUST FAIL when a second, unrequested figure claim was staged",
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
    // 19-09: `media` added. This snapshot went STALE when Phase 20 registered the media route, and
    // the whole `--self-check` gate has been red on main ever since — invisibly, because `runLive`
    // never calls `selfCheck()`, so the one check that stops a bad fixture BEFORE it costs a cent
    // was itself unrunnable. Re-snapshot here when a route is added; that is the drift signal.
    ["offer-architect", "money-model-designer", "lead-engine", "research", "media"],
    "all dispatchable routes, including research, are read off the core registry",
  );
  for (const route of SPECIALIST_ROUTES) {
    // 19-10: the skill name comes from the registry (`SPECIALISTS[route].skillName`), not from a
    // ternary. The three Phase-12 route names equal their skill names; `research` maps to
    // `research-specialist` and `media` to `media-director`, and only the registry knows that.
    const skillName = SPECIALIST_SKILLS[route];
    assert.ok(
      skillName,
      `${route} is dispatchable but has no skillName in the SPECIALISTS registry`,
    );
    // A dispatchable specialist's body must ride the gate — UNLESS `skill.ts` carries a written
    // DELIBERATELY UNGATED justification for it, which is a decision recorded at the canonical
    // site and derived here rather than re-litigated. `media-director` is exactly that case
    // (Phase 20: the runner drives TEXT fixtures and structurally cannot drive a script /
    // art-direction / storyboard turn, so gating it would deadlock the row at v1 on its first
    // body edit). The residual risk is real and named there: a `media-director` body edit
    // activates with no eval evidence. What is NOT tolerated is silence — a dispatchable route
    // whose skill is neither gated nor justified fails right here.
    assert.ok(
      SKILL_NAMES.includes(skillName) || UNGATED_SKILL_NAMES.includes(skillName),
      `${skillName} (route "${route}") must either be in GATED_SKILLS — a body edit rides the gate —` +
        ` or carry a written DELIBERATELY UNGATED justification in packages/contracts/src/skill.ts`,
    );
  }
  // Non-vacuity: the exemption must be DERIVED and non-empty, or the assertion above degrades into
  // "anything goes" the moment the regex stops matching.
  assert.ok(
    UNGATED_SKILL_NAMES.includes("media-director") &&
      UNGATED_SKILL_NAMES.includes("content-drafter"),
    "the DELIBERATELY UNGATED derivation must actually resolve skill.ts's written exemptions",
  );
  assert.equal(
    SPECIALIST_SKILLS.research,
    "research-specialist",
    "the route->skillName mapping must come from the registry, not from a ternary",
  );
  assert.throws(
    () => validateFixture({ ...base, turns: [`tell me about ${VAULT_NEEDLE}`] }, "<synthetic>"),
    /vacuous/,
    "a turn carrying the vault needle would make citesVaultDoc pass without searchVault",
  );
  assert.throws(
    () => validateFixture({ ...base, turns: [`tell me about ${BLUEPRINT_NEEDLE}`] }, "<synthetic>"),
    /standing-spine proof vacuous/,
    "a turn carrying the Blueprint needle would make the pre-model assertion vacuous",
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

  // ── 8. 21-03: the EXACT tenant candidate pin. Every assertion here is $0 and makes ZERO convex
  //    and ZERO model calls — which is the whole point: the branches below are the ones that decide
  //    whether a ~$0.4 run happens at all and which row it certifies.

  // 8a. `--tenant-skill` parsing. The failures worth pinning are the SILENT ones: a swallowed flag
  //     turns a pinned run into an unpinned one that pays in full and certifies the wrong body.
  assert.deepEqual(parseTenantSkillIds([]), [], "no --tenant-skill ⇒ no tenant pins");
  assert.deepEqual(
    parseTenantSkillIds(["--tenant-skill", "k57row1", "--tenant-skill", "k57row2"]),
    ["k57row1", "k57row2"],
    "every --tenant-skill occurrence is collected (multi-pin, like --skill)",
  );
  assert.throws(
    () => parseTenantSkillIds(["--tenant-skill", "--skill"]),
    /requires a tenantSkills row id/,
    "a flag swallowed as an id would run the gate UNPINNED and still look pinned",
  );
  assert.throws(
    () => parseTenantSkillIds(["--tenant-skill"]),
    /requires a tenantSkills row id/,
    "a trailing --tenant-skill with no value must abort",
  );
  assert.throws(
    () => parseTenantSkillIds(["--tenant-skill", "k57row1", "--tenant-skill", "k57row1"]),
    /pinned twice/,
    "the same row twice is a typo, not a request",
  );

  // 8b. The two pin SCOPES cannot both claim one skill name. Load-bearing: both records are keyed
  //     by name into runSpecialistTurn and the TENANT id wins there, so a name in both scopes means
  //     the --skill pin silently does nothing while its evidence row still claims the version ran.
  const tTarget = (name, version, id, tenantId = "tenant_registry") => ({
    candidateId: id,
    registryTenantId: tenantId,
    name,
    version,
    bodyHash: `hash-${id}`,
  });
  assert.deepEqual(
    mergePinScopes(parseSkillPins(["--skill", "cockpit-agent@9"]), [
      tTarget("offer-architect", 4, "k57rowA"),
    ]),
    {
      skillVersions: { "cockpit-agent": 9 },
      tenantSkillIds: { "offer-architect": "k57rowA" },
    },
    "two DIFFERENT skills, one per scope, merge cleanly and stay separate records",
  );
  assert.throws(
    () =>
      mergePinScopes(parseSkillPins(["--skill", "offer-architect@4"]), [
        tTarget("offer-architect", 4, "k57rowA"),
      ]),
    /pinned in BOTH scopes/,
    "one skill cannot be pinned globally AND by row in the same run",
  );
  assert.throws(
    () =>
      mergePinScopes(
        [],
        [tTarget("lead-engine", 2, "k57rowA"), tTarget("lead-engine", 3, "k57rowB")],
      ),
    /two different --tenant-skill rows/,
    "two rows of ONE skill is last-one-wins deciding which body gets certified",
  );
  assert.deepEqual(
    mergePinScopes([], []),
    { skillVersions: {}, tenantSkillIds: {} },
    "no pins at all ⇒ empty records, and the caller spreads them away entirely",
  );

  // 8c. Only a USER-authored CANDIDATE is an evaluable target, and the refusal happens at $0.
  const snapOf = (over = {}) => ({
    candidate: {
      id: "k57rowA",
      tenantId: "tenant_registry",
      name: "offer-architect",
      version: 3,
      bodyHash: "abc123",
      author: "user",
      status: "candidate",
      evidenceState: "absent",
      gatePassed: false,
      rollbackEligible: false,
      lineage: { basedOnScope: "global", basedOnVersion: 7 },
      ...over,
    },
    currentEffective: { scope: "global", id: "gid", version: 7, bodyHash: "globalhash" },
    globalCurrent: { scope: "global", id: "gid", version: 7, bodyHash: "globalhash" },
    foreignCurrent: null,
  });
  assert.deepEqual(
    assertEvaluableCandidate(snapOf(), "k57rowA"),
    {
      candidateId: "k57rowA",
      registryTenantId: "tenant_registry",
      name: "offer-architect",
      version: 3,
      bodyHash: "abc123",
    },
    "a user-authored candidate resolves to its exact identity, read off the SNAPSHOT",
  );
  assert.throws(
    () => assertEvaluableCandidate(snapOf({ author: "system" }), "k57rowA"),
    /only user-authored candidates/,
    "the system ROLLBACK BASELINE is not a thing a user asked to certify",
  );
  assert.throws(
    () => assertEvaluableCandidate(snapOf({ status: "active" }), "k57rowA"),
    /only a candidate is evaluable/,
    "an ACTIVE row is already what the tenant runs — certifying it spends ~$0.4 for nothing",
  );
  assert.throws(
    () => assertEvaluableCandidate(snapOf({ status: "archived" }), "k57rowA"),
    /only a candidate is evaluable/,
    "an archived row is not evaluable either",
  );
  assert.throws(
    () => assertEvaluableCandidate({}, "k57rowA"),
    /no candidate in the inspection snapshot/,
    "a snapshot with no candidate must abort, never resolve to undefined fields",
  );

  // 8d. THE evidence rule, clause by clause. MUTATION `filters.length === 0` REMOVED turns the
  //     third assertion red — and the positive witness on the line above it proves the filtered run
  //     really did execute cases, so "no evidence" is suppression rather than an empty run.
  assert.equal(
    shouldRecordEvidence({ allGreen: true, casesTotal: 36, filters: [] }),
    true,
    "a full, nonempty, unfiltered all-green run IS the gate",
  );
  assert.equal(
    applyOnly(fixtures, ["research"]).length,
    3,
    "the filtered run below really does execute cases (the anti-vacuity witness)",
  );
  assert.equal(
    shouldRecordEvidence({ allGreen: true, casesTotal: 3, filters: ["research"] }),
    false,
    "a --only run executes cases and records NO evidence (a tenth of the coverage is not the gate)",
  );
  assert.equal(
    shouldRecordEvidence({ allGreen: true, casesTotal: 0, filters: [] }),
    false,
    "ZERO cases is `0 === 0`, i.e. all green — it must not write `0/0 pass` as an EVAL_GATE input",
  );
  assert.equal(
    shouldRecordEvidence({ allGreen: false, casesTotal: 36, filters: [] }),
    false,
    "a failed run certifies nothing",
  );
  // …and the ORDERING that makes "an over-cap or interrupted run records none" true: `abortEnv`
  // exits from INSIDE the case loop, so the evidence block is unreachable. A rule that holds only
  // because of where it sits is one refactor from being false, so it is asserted against the source.
  //     The scan is taken from `attemptCase` ONWARD, not over the whole file: every anchor below
  //     also appears as a string literal in THIS block, and a self-matching source scan is an
  //     assertion about its own text (the `</HeaderMenu>` vacuity 21-02 hit, in another shape).
  //     `lastIndexOf` for the same reason: an `indexOf` finds the copy of this anchor sitting in
  //     THIS line, and everything after it is self-check text, not the live path.
  const liveSource = runnerSource.slice(runnerSource.lastIndexOf("function attemptCase("));
  const abortAt = runnerSource.lastIndexOf("function abortEnv");
  const evidenceAt = liveSource.indexOf("shouldRecordEvidence({ allGreen, casesTotal, filters })");
  const capCheckAt = liveSource.indexOf("COST CAP EXCEEDED");
  assert.ok(abortAt > 0 && evidenceAt > 0 && capCheckAt > 0, "the cost-cap/evidence seams exist");
  assert.ok(
    capCheckAt < evidenceAt,
    "the cost cap must abort BEFORE the evidence block is ever reached",
  );
  assert.ok(
    runnerSource.slice(abortAt, abortAt + 400).includes("process.exit(2)"),
    "abortEnv must EXIT — a governed stop that returned would fall through to the evidence write",
  );

  // 8e. The evidence BODY: refs and counts only, with the exact tenant target. A fixture prompt, a
  //     model reply or a skill body reaching this object is a §4 breach, and offline is where that
  //     is cheapest to catch.
  const tenantEvidence = buildTenantEvidence({
    runId: "abc12345",
    casesPassed: 36,
    casesTotal: 36,
    retriedCases: ["32-research-grounded"],
    costUsd: 0.4213,
    model: EVAL_MODEL,
    skillVersions: { "cockpit-agent": 9 },
    target: tTarget("offer-architect", 3, "k57rowA"),
    ts: 1_700_000_000_000,
  });
  assert.deepEqual(
    Object.keys(tenantEvidence).sort(),
    [
      "casesPassed",
      "casesTotal",
      "costUsd",
      "model",
      "pass",
      "retriedCases",
      "runId",
      "runner",
      "skillVersions",
      "tenantTarget",
      "ts",
    ],
    "the evidence key set is CLOSED — adding a body/prompt/reply key fails right here",
  );
  assert.deepEqual(
    tenantEvidence.tenantTarget,
    {
      candidateId: "k57rowA",
      registryTenantId: "tenant_registry",
      name: "offer-architect",
      version: 3,
    },
    "the tenant target is the EXACT row, and carries no body hash and no adaptation",
  );
  // The whole serialized row, scanned. `bodyHash` is deliberately NOT carried into evidence — the
  // gate compares identity, and a hash there would invite someone to compare bytes instead of rows.
  const serializedEvidence = JSON.stringify(tenantEvidence);
  for (const forbidden of ["body", "authoredBody", "prompt", "reply", "adaptation", "hash"]) {
    assert.ok(
      !serializedEvidence.toLowerCase().includes(`"${forbidden}`),
      `evidence must not carry a "${forbidden}…" key`,
    );
  }
  assert.ok(serializedEvidence.includes("k57rowA"), "…and the scan really did read the payload");

  // 8f. The read-only inspection mode. It exits before any seed/model/evidence code, so the thing
  //     that must not happen is an inspection that LOOKS like a gate run.
  assert.equal(parseInspectArgs([]), null, "an ordinary run is not inspection mode");
  assert.equal(parseInspectArgs(["--skill", "cockpit-agent@9"]), null, "…nor is a pinned run");
  assert.deepEqual(
    parseInspectArgs(["--inspect-tenant-skill", "k57rowA"]),
    { candidateId: "k57rowA", foreignTenantId: undefined, json: false, expectations: {} },
    "the bare inspection invocation parses",
  );
  assert.deepEqual(
    parseInspectArgs([
      "--inspect-tenant-skill",
      "k57rowA",
      "--json",
      "--foreign-tenant",
      "tenant_other",
      "--expect-status=candidate",
      "--expect-evidence=passing",
      "--expect-gate-passed=true",
      "--expect-rollback-eligible=false",
    ]),
    {
      candidateId: "k57rowA",
      foreignTenantId: "tenant_other",
      json: true,
      expectations: {
        status: "candidate",
        evidenceState: "passing",
        gatePassed: "true",
        rollbackEligible: "false",
      },
    },
    "every inspection flag parses together",
  );
  for (const paid of ["--skill", "--tenant-skill", "--only"]) {
    assert.throws(
      () => parseInspectArgs(["--inspect-tenant-skill", "k57rowA", paid, "x"]),
      /read-only and cannot be combined/,
      `${paid} alongside an inspection would look like a gate run and silently run no case`,
    );
  }
  assert.throws(
    () => parseInspectArgs(["--expect-status=candidate"]),
    /require --inspect-tenant-skill/,
    "an expectation flag outside inspection mode asserts nothing and must not be ignored",
  );
  assert.throws(
    () => parseInspectArgs(["--foreign-tenant", "tenant_other"]),
    /inspection-only/,
    "--foreign-tenant outside inspection mode is rejected",
  );
  assert.throws(
    () => parseInspectArgs(["--inspect-tenant-skill", "k57rowA", "--expect-status=live"]),
    /--expect-status must be one of/,
    "a status that is not a real row status can never match and would always exit 1",
  );
  assert.throws(
    () => parseInspectArgs(["--inspect-tenant-skill", "k57rowA", "--expect-evidence=green"]),
    /--expect-evidence must be one of/,
    "the evidence vocabulary is absent|passing|failing",
  );
  assert.throws(
    () => parseInspectArgs(["--inspect-tenant-skill", "k57rowA", "--expect-gate-passed=yes"]),
    /must be true\|false/,
    "a boolean expectation takes a boolean",
  );
  assert.throws(
    () => parseInspectArgs(["--inspect-tenant-skill", "k57rowA", "--expect-gate-passed"]),
    /requires a value/,
    "a bare --expect-gate-passed asserts nothing",
  );

  // 8g. Expectation MATCHING, both directions, against a refs-only snapshot.
  assert.deepEqual(
    checkExpectations(snapOf(), { status: "candidate", evidenceState: "absent" }),
    [],
    "an empty mismatch list IS the pass",
  );
  assert.deepEqual(
    checkExpectations(snapOf(), { status: "active" }),
    [{ key: "status", expected: "active", actual: "candidate" }],
    "a status mismatch is reported with BOTH sides, and exits nonzero at the call site",
  );
  assert.deepEqual(
    checkExpectations(snapOf({ gatePassed: true }), { gatePassed: "false" }),
    [{ key: "gatePassed", expected: "false", actual: "true" }],
    "booleans compare as strings, so `false` is a real expectation and not a falsy skip",
  );
  assert.equal(
    checkExpectations(snapOf({ evidenceState: "failing" }), { evidenceState: "failing" }).length,
    0,
    "a STALE pin (failing) is an expectable state, distinct from absent",
  );

  // 8h. The foreign-tenant boundary. A foreign effective row that IS this candidate — by id or by
  //     bytes — means either the inspector leaks across tenants or the overlay is not scoped.
  assert.equal(foreignCollision(snapOf()), null, "no --foreign-tenant ⇒ nothing to collide");
  const withForeign = (effective) => ({
    ...snapOf(),
    foreignCurrent: { tenantId: "tenant_other", candidateIdVisible: false, effective },
  });
  assert.equal(
    foreignCollision(
      withForeign({ scope: "global", id: "gid", version: 7, bodyHash: "globalhash" }),
    ),
    null,
    "another tenant falling back to the GLOBAL row is the healthy answer",
  );
  assert.match(
    String(foreignCollision(withForeign({ id: "k57rowA", bodyHash: "other" }))),
    /IS this candidate/,
    "a foreign effective row equal to the candidate ROW is a refusal",
  );
  assert.match(
    String(foreignCollision(withForeign({ id: "other", bodyHash: "abc123" }))),
    /body hash EQUALS/,
    "a foreign effective body equal to the candidate BYTES is a refusal",
  );
  assert.match(
    String(
      foreignCollision({
        ...snapOf(),
        foreignCurrent: { tenantId: "t", candidateIdVisible: true, effective: { id: "x" } },
      }),
    ),
    /candidate ids are visible/,
    "the inspector must never claim a foreign tenant's candidate ids are reachable",
  );

  // 8i. The deployment fingerprint. It exists so the Phase-21 handoff can pin that the pre-gate and
  //     post-gate inspections talked to the SAME deployment — and it must not print a credential.
  const KEYED = "https://tidy-otter-123.convex.cloud?token=SUPER_SECRET";
  assert.equal(
    deploymentFingerprint(KEYED),
    deploymentFingerprint("https://tidy-otter-123.convex.cloud"),
    "the query string is dropped BEFORE hashing — a deploy URL can carry a key",
  );
  assert.ok(!deploymentFingerprint(KEYED).includes("SUPER_SECRET"), "and the hash is a hash");
  assert.match(deploymentFingerprint(KEYED), /^[0-9a-f]{64}$/, "SHA-256 hex");
  assert.notEqual(
    deploymentFingerprint("https://tidy-otter-123.convex.cloud"),
    deploymentFingerprint("https://other-deployment-999.convex.cloud"),
    "two deployments must not fingerprint the same — that is the whole guarantee",
  );
  assert.equal(deploymentFingerprint(""), null, "unset is null, not the hash of the empty string");
  assert.equal(deploymentFingerprint(undefined), null, "…and so is absent");

  // 8j. Unknown arguments ABORT rather than falling through to a paid run. `--tenant-skil <id>`
  //     would otherwise run the full gate unpinned, pay for all of it, and record nothing.
  assert.ok(assertKnownArgs(["--self-check"]), "every shipped flag is known");
  assert.ok(assertKnownArgs(["--skill", "cockpit-agent@9", "--only", "research"]));
  assert.ok(
    assertKnownArgs(["--inspect-tenant-skill", "k57rowA", "--json", "--expect-status=candidate"]),
  );
  assert.throws(
    () => assertKnownArgs(["--tenant-skil", "k57rowA"]),
    /unknown argument/,
    "a one-character typo must not buy a full unpinned gate run",
  );
  assert.throws(() => assertKnownArgs(["--dry-run"]), /unknown argument/);
  // THE regression this guard shipped with, caught by this plan's own verify command: pnpm forwards
  // the `--` SEPARATOR into argv, so `pnpm … eval:golden -- --self-check` arrives as
  // `["--", "--self-check"]` and the first version of the guard rejected the documented invocation.
  assert.deepEqual(
    stripSeparator(["--", "--skill", "cockpit-agent@9"]),
    ["--skill", "cockpit-agent@9"],
    "the pnpm `--` separator is stripped before anything parses it",
  );
  assert.ok(
    assertKnownArgs(stripSeparator(["--", "--self-check"])),
    "the DOCUMENTED pnpm invocation must survive the unknown-argument guard",
  );
  assert.ok(assertKnownArgs(["--", "--self-check"]), "…and the guard tolerates it directly too");
  // Stripping must not swallow a real VALUE: no valid value is `--`, and both value parsers refuse
  // one that starts with `--`, so the two rules agree rather than papering over each other.
  assert.throws(
    () => parseOnlyFilters(stripSeparator(["--only", "--"])),
    /--only requires a value/,
    "a swallowed separator must not become an --only filter",
  );
  // A VALUE that happens to look like a flag-ish word is not treated as an argument.
  assert.ok(
    assertKnownArgs(["--only", "--skill"]) === true ||
      (() => {
        throw new Error("unreachable");
      })(),
    "a valued flag consumes its value, so the value is never linted as an argument",
  );

  // 8k. This check must itself be FREE. `--self-check` is the only eval invocation a plan may make
  //     under a do-not-rerun order, so "zero convex calls, zero model calls" is a property that has
  //     to be checkable rather than asserted in a comment. `selfCheck`'s own body is scanned for the
  //     one function that shells out to `npx convex run`.
  //     Every anchor here is a SECTION MARKER assembled at runtime, never a literal: a literal
  //     appears in this very block, and `lastIndexOf` would then find the copy sitting in the
  //     self-check's own text and slice a region that is self-check prose rather than live code.
  //     (Observed: the first version of these probes reported an EMPTY `runInspect` body.)
  const marker = (name) => `// ${"─".repeat(2)} ${name}`;
  const selfCheckBody = runnerSource.slice(
    runnerSource.lastIndexOf("function selfCheck()"),
    runnerSource.lastIndexOf(marker("live run")),
  );
  assert.ok(selfCheckBody.length > 1000, "the self-check body scan found something to scan");
  assert.ok(
    !/[^a-zA-Z]must\(/.test(selfCheckBody),
    "selfCheck() must make ZERO convex calls — it is the free command",
  );
  //     …and the read-only inspection mode must EXIT before the paid path is even entered.
  const entry = runnerSource.slice(runnerSource.lastIndexOf(marker("entry")));
  const inspectCallAt = entry.indexOf("runInspect(inspect)");
  const liveCallAt = entry.indexOf("await runLive(");
  assert.ok(inspectCallAt > 0 && liveCallAt > 0, "both entry branches exist");
  assert.ok(
    inspectCallAt < liveCallAt,
    "--inspect-tenant-skill must be dispatched BEFORE runLive — a read-only mode that seeds fixtures is not read-only",
  );
  const inspectBody = runnerSource.slice(
    runnerSource.lastIndexOf(marker("21-03: the read-only inspection command")),
    runnerSource.lastIndexOf(marker("entry")),
  );
  assert.ok(
    inspectBody.includes("process.exit(") && !inspectBody.includes("seedInboxFixture"),
    "runInspect exits and never touches a fixture seed",
  );
  assert.ok(
    !/recordEvalEvidence|recordTenantEvalEvidence|runCockpitAgent/.test(inspectBody),
    "runInspect must never write evidence or call a model",
  );

  console.log(
    `[eval:golden] self-check PASSED (${fixtures.length} fixtures valid, ${SKILL_NAMES.length} gated skills` +
      ` derived from GATED_SKILLS, vocabulary/cap/multi-pin/only-filter/dispatch/cost-merge logic proven offline;` +
      ` 21-03: tenant-pin parsing/scope-merge/candidate-eligibility/evidence-suppression/inspection/` +
      `expectations/foreign-collision/deployment-fingerprint/unknown-arg proven offline)`,
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
    const plan = parse(must("plans:getById", { planId }, RETRY_READ));
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
    // 16-09: RETRY_READ matters MOST here. This loop has no try/catch and spins every
    // DISPATCH_POLL_MS for up to DISPATCH_TIMEOUT_MS — ~70 iterations x 2 CLI calls — so it is by
    // far the largest exposure to the empty-stdout teardown crash, and a single occurrence
    // propagates out of attemptCase as `Unexpected end of JSON input`, scoring a behaviourally
    // CORRECT case as FAIL. That is what happened to run 89e5ee98's fixture 33.
    const plan = parse(must("plans:getById", { planId }, RETRY_READ));
    const researchCount = parse(
      must("smoke:researchCountForThread", { tenantId, threadId }, RETRY_READ),
    );
    if (plan && plan.status !== "collecting" && researchCount > 0) {
      return { plan, researchCount };
    }
    if (Date.now() >= deadline) return null;
    sleepSync(DISPATCH_POLL_MS);
  }
}

function attemptCase(fixture, tenant, pins, tenantSkillIds = {}) {
  // 21-03: spread away entirely when empty, so every pre-21 run sends a BYTE-IDENTICAL request and
  // nothing about the gate the 36 fixtures already passed moves (the `clock` precedent).
  const tenantPinArg = Object.keys(tenantSkillIds).length ? { tenantSkillIds } : {};
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
      must(
        "llm:runCockpitAgent",
        {
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
          // Phase 19 (ACTN-05): the OPT-IN clock. Spread away entirely unless the fixture sets
          // `clock: true`, so every pre-19 case's request is byte-identical to the one that passed
          // the last gate. `nowMs` is the real clock, not a pinned instant: "tomorrow" and a weekday
          // name must resolve FORWARD (parseSendTime returns `past` otherwise), and the assertion is
          // a COUNT, so nothing here depends on which instant it lands on.
          ...(fixture.clock ? { clientContext: { tz: "UTC", nowMs: Date.now() } } : {}),
          ...(history.length ? { history } : {}),
          ...(pins.length ? { skillVersions: skillVersionsOf(pins) } : {}),
          ...tenantPinArg,
        },
        RETRY_TURN,
      ),
    );
    if (res.blocked) {
      // 22.1-02 made `dailySpendCents` KEYED per tenant, so `smoke:resetDailySpend` gained a
      // required `tenantId` and the old argument-less hint printed a command that now dies with
      // an ArgumentValidationError — a recovery instruction that fails is worse than none.
      // `deployment_budget_exhausted` is a SEPARATE, KEYLESS rail (`deploymentSpendCents`,
      // guardrails.ts:127) with no reset helper, and it is the one that actually binds here: the
      // eval tenant is throwaway (`eval-<runId>`), so its own per-tenant window starts empty every
      // run while the deployment ceiling carries every run of the day.
      const hint =
        res.blocked === "daily_budget_exhausted"
          ? ` — try: npx convex run smoke:resetDailySpend '{"tenantId":"${tenant}"}'`
          : res.blocked === "deployment_budget_exhausted"
            ? " — the DEPLOYMENT-wide daily ceiling (keyless `deploymentSpendCents`), not this" +
              " tenant's: it carries every run today and has no reset helper. Wait for the window" +
              " or raise DAILY_BUDGET_CENTS."
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
        // 16-09: the pins have to ride the TAP too, exactly as they ride the turn at :1074. The
        // dispatched specialist is a SEPARATE scheduled action, so without this every `--skill
        // offer-architect@2` run ran the ACTIVE row (v1) and then wrote an evidence row for v2.
        ...(pins.length ? { skillVersions: skillVersionsOf(pins) } : {}),
        // 21-03: the tenant pin rides the TAP for the SAME reason, one registry scope down. The
        // dispatched specialist is a separate scheduled action — omit this and every
        // `--tenant-skill` run evaluates the tenant's EFFECTIVE body and then certifies the
        // candidate. That is 16-09's defect verbatim, and it is invisible in a green run.
        ...tenantPinArg,
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
    plan = parse(must("plans:getById", { planId }, RETRY_READ));
  }
  // The specialist bill, charged off the audit trail now that the dispatch poll has settled (one
  // read, hung off the EXISTING poll — no second loop). Same skip-unless-asked discipline as every
  // other read below: a non-dispatch case pays no extra hop and its numbers are unchanged.
  if (dispatched) {
    specialistCost = parse(
      must("smoke:specialistCostForThread", { tenantId: tenant, threadId }, RETRY_READ),
    );
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
      : parse(must("smoke:briefingCountForThread", { tenantId: tenant, threadId }, RETRY_READ));
  const synopsisPresent =
    fixture.expect.ledePresent === undefined
      ? false
      : parse(must("smoke:briefingSynopsisPresent", { tenantId: tenant, threadId }, RETRY_READ));
  // 12-06: same skip-unless-asked discipline — a non-assessment case pays no extra hop.
  const evaluationCount =
    fixture.expect.evaluationPresent === undefined
      ? 0
      : parse(must("smoke:evaluationCountForThread", { tenantId: tenant, threadId }, RETRY_READ));
  const findingCount =
    fixture.expect.findingsPresent === undefined
      ? 0
      : parse(must("smoke:findingCountForThread", { tenantId: tenant, threadId }, RETRY_READ));
  const gapCount =
    fixture.expect.gapCount === undefined
      ? 0
      : parse(must("smoke:gapCountForThread", { tenantId: tenant, threadId }, RETRY_READ));
  // Phase 16: skip every research read unless a fixture asks. The pairing rules above guarantee
  // the verdict and call floor cannot ask without the persisted-document companion.
  const researchCount =
    fixture.expect.researchDocPresent === undefined
      ? 0
      : landedResearchCount ||
        parse(must("smoke:researchCountForThread", { tenantId: tenant, threadId }, RETRY_READ));
  const insufficientEvidence =
    fixture.expect.insufficientEvidence === undefined
      ? false
      : parse(
          must(
            "smoke:researchInsufficientEvidenceForThread",
            { tenantId: tenant, threadId },
            RETRY_READ,
          ),
        );
  const webSearchCalls =
    fixture.expect.webSearchCallsAtLeast === undefined
      ? 0
      : parse(must("smoke:webSearchCallsForThread", { tenantId: tenant, threadId }, RETRY_READ));
  // 22.1b: the SEMANTIC act, off the same audit plane. Skipped unless asked, like every research
  // read above — the 31 non-research fixtures pay nothing and see `false`.
  const declaredUnsupported =
    fixture.expect.declaredUnsupported === undefined
      ? false
      : parse(
          must(
            "smoke:researchDeclaredUnsupportedForThread",
            { tenantId: tenant, threadId },
            RETRY_READ,
          ),
        );
  // Phase 18 (ACTN-04). Same skipped-unless-asked rule as every read above, so the 33 fixtures
  // that do not create a document pay no extra hop and see the fail-closed 0.
  const createdDocCount =
    fixture.expect.createdDocCount === undefined
      ? 0
      : parse(must("smoke:createdDocCountForThread", { tenantId: tenant, threadId }, RETRY_READ));
  // 20-12 (MEDIA-01). Same skipped-unless-asked rule: the 34 fixtures that never mention a video
  // pay no extra hop and see the fail-closed 0. The read is asked for on BOTH media fixtures — the
  // positive one expects 1, the negative one expects 0 — so `undefined` here means "not asked",
  // never "asked and empty".
  const mediaDispatchCount =
    fixture.expect.mediaDispatchCount === undefined
      ? 0
      : parse(
          must("smoke:mediaDispatchCountForThread", { tenantId: tenant, threadId }, RETRY_READ),
        );
  const driveReadToolCount =
    fixture.expect.driveReadToolCount === undefined
      ? 0
      : parse(must("smoke:driveReadCountForThread", { tenantId: tenant, threadId }, RETRY_READ));
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
    declaredUnsupported,
    createdDocCount,
    mediaDispatchCount,
    driveReadToolCount,
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

async function runLive(pins, filters = [], tenantSkillIdArgs = []) {
  const allFixtures = loadFixtures(); // fail fast BEFORE the first spawn
  const fixtures = applyOnly(allFixtures, filters); // ditto — a bad --only must not cost a seed
  const runId = randomUUID().slice(0, 8);
  const tenant = `eval-${runId}`; // throwaway — isolates every tenant-scoped table
  const retriedCases = [];
  const results = [];

  // 21-03: resolve every `--tenant-skill` id to its exact identity BEFORE the inbox/vault/Blueprint
  // seeds and before the first paid turn — the same source-ordered discipline 17.1-10 imposed on
  // the Blueprint assertion, for the same reason: an unknown, deleted, non-user or already-active
  // row must abort at $0, not after 36 cases have been paid for.
  //
  // The read is `inspectTenantSkill`, NOT `getTenantSkillVersion`: the inspector returns refs only,
  // so the candidate BODY never enters this process at all. The registry tenant is used for exactly
  // this read and for the evidence write — every plan, message, vault doc and assertion below still
  // belongs to the throwaway `eval-<runId>` tenant.
  const tenantTargets = tenantSkillIdArgs.map((id) =>
    assertEvaluableCandidate(
      parse(must("skills:inspectTenantSkill", { candidateId: id }, RETRY_READ)),
      id,
    ),
  );
  const { tenantSkillIds } = mergePinScopes(pins, tenantTargets);

  console.log(
    `[eval:golden] run ${runId} — ${fixtures.length} cases, tenant ${tenant}, cap $${COST_CAP_USD.toFixed(2)}` +
      (pins.length ? `, pins ${pins.map((p) => `${p.name}@${p.version}`).join(" ")}` : "") +
      (tenantTargets.length
        ? `, tenant pins ${tenantTargets.map((t) => `${t.name}@${t.version}#${t.candidateId}`).join(" ")}`
        : "") +
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

  // 17.1-10: the original L6 premise was false — the runner minted an eval tenant but never gave
  // it a confirmed Blueprint. Seed the narrow eval-only row from the just-created source ids, then
  // prove the REAL rendered spine carries a token no fixture turn contains. Both calls happen
  // before the first runCockpitAgent model turn; failure aborts at $0 rather than producing a
  // misleading green no-spine gate.
  const seededBlueprint = parse(
    must("smoke:seedGoldenEvalBlueprint", {
      tenantId: tenant,
      sourceDocIds: vaultDocIds,
    }),
  );
  const blueprintSpine = parse(must("blueprint:spineForTenant", { tenantId: tenant }, RETRY_READ));
  assert.equal(typeof blueprintSpine, "string", "confirmed eval Blueprint must render a spine");
  assert.ok(
    blueprintSpine.includes(BLUEPRINT_NEEDLE),
    `eval spine must carry the non-vacuity needle ${BLUEPRINT_NEEDLE}`,
  );
  console.log(
    `[eval:golden] seeded confirmed Blueprint: doc ${seededBlueprint.docId}, ` +
      `${seededBlueprint.sourceDocCount} source(s), spine ${blueprintSpine.length} chars, ` +
      `needle ${BLUEPRINT_NEEDLE}`,
  );

  for (const fixture of fixtures) {
    let outcome;
    let retried = false;
    try {
      outcome = attemptCase(fixture, tenant, pins, tenantSkillIds);
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
        second = attemptCase(fixture, tenant, pins, tenantSkillIds);
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
  // 21-03: ONE rule, named, for BOTH scopes — see `shouldRecordEvidence`. It also closes the
  // zero-case hole the old inline condition had (`0 === 0` is "all green").
  const record = shouldRecordEvidence({ allGreen, casesTotal, filters });
  if (allGreen && (pins.length || tenantTargets.length) && !record) {
    console.log(
      `[eval:golden] evidence SUPPRESSED — ${filters.length ? "partial run (--only)" : "zero cases"}. Re-run unfiltered to gate.`,
    );
  }
  if (record && pins.length) {
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
        model: EVAL_MODEL,
        skillVersions,
        ts: Date.now(),
      });
      must("skills:recordEvalEvidence", { name: pin.name, version: pin.version, evidence });
      console.log(`[eval:golden] evidence recorded on ${pin.name} v${pin.version}`);
    }
  }
  // 21-03: one row per EXACT tenant candidate, off the same run. The write is BY ID
  // (`recordTenantEvalEvidence`), never by name/version — two tenants can hold the same pair, and a
  // name/version write would be a coin flip between certifying the body that ran and certifying a
  // stranger's draft. No `retryOnEmpty` here, exactly as for the global write: a retry writes a
  // duplicate evidence row.
  if (record && tenantTargets.length) {
    const skillVersions = skillVersionsOf(pins);
    for (const target of tenantTargets) {
      const evidence = JSON.stringify(
        buildTenantEvidence({
          runId,
          casesPassed,
          casesTotal,
          retriedCases,
          costUsd: totalCost,
          model: EVAL_MODEL,
          skillVersions,
          target,
          ts: Date.now(),
        }),
      );
      const wrote = parse(
        must("skills:recordTenantEvalEvidence", { candidateId: target.candidateId, evidence }),
      );
      console.log(
        `[eval:golden] tenant evidence recorded on ${wrote.name} v${wrote.version} (row ${wrote.candidateId}, tenant ${wrote.registryTenantId})`,
      );
      console.log(
        `[eval:golden] NOTHING IS ACTIVE. Evidence is not activation — the candidate still needs the owner's separate act.`,
      );
    }
  }

  process.exit(allGreen ? 0 : 1);
}

// ── 21-03: the read-only inspection command (no seed, no model, no write) ─────

function runInspect(inspect) {
  const snapshot = parse(
    must(
      "skills:inspectTenantSkill",
      {
        candidateId: inspect.candidateId,
        ...(inspect.foreignTenantId ? { foreignTenantId: inspect.foreignTenantId } : {}),
      },
      RETRY_READ,
    ),
  );
  const collision = foreignCollision(snapshot);
  const mismatches = checkExpectations(snapshot, inspect.expectations);
  const out = {
    // WHICH deployment answered — hashed, so pre/post-gate inspections can be pinned to the same
    // one without printing a URL that may carry a key.
    deploymentHash: deploymentFingerprint(configuredDeployment()),
    ...snapshot,
    expectations: inspect.expectations,
    mismatches,
    foreignCollision: collision,
  };
  if (inspect.json) console.log(JSON.stringify(out, null, 2));
  else {
    const c = snapshot.candidate;
    console.log(
      `[eval:golden] ${c.name} v${c.version} (row ${c.id}, tenant ${c.tenantId})\n` +
        `  status=${c.status} evidence=${c.evidenceState} gatePassed=${c.gatePassed} rollbackEligible=${c.rollbackEligible}\n` +
        `  bodyHash=${c.bodyHash}\n` +
        `  lineage=${c.lineage.basedOnScope}@${c.lineage.basedOnVersion}  effective=${snapshot.currentEffective.scope}@${snapshot.currentEffective.version}` +
        `  global=v${snapshot.globalCurrent.version}\n` +
        `  deploymentHash=${out.deploymentHash}`,
    );
  }
  if (collision) {
    console.error(`[eval:golden] FOREIGN COLLISION — ${collision}`);
    process.exit(1);
  }
  for (const m of mismatches) {
    console.error(`[eval:golden] ${m.key}: expected ${m.expected}, got ${m.actual}`);
  }
  process.exit(mismatches.length === 0 ? 0 : 1);
}

// ── entry ────────────────────────────────────────────────────────────────────

const argv = stripSeparator(process.argv.slice(2));
try {
  // 21-03: a typo aborts HERE, before anything is parsed, seeded, read or billed.
  assertKnownArgs(argv);
  if (argv.includes("--self-check")) {
    selfCheck();
    process.exit(0);
  }
  const inspect = parseInspectArgs(argv);
  if (inspect) runInspect(inspect); // read-only: exits before any seed/model/evidence code
  await runLive(parseSkillPins(argv), parseOnlyFilters(argv), parseTenantSkillIds(argv));
} catch (e) {
  console.error(`[eval:golden] ${e.message}`);
  process.exit(1);
}
