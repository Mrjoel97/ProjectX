import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import {
  DEPENDENCY_MANIFESTS,
  deferAbsenceChecks,
  parseArtifact,
  SCHEDULING_DEPENDENCY_RE,
} from "../scripts/check-routine-gate.mjs";

// 29-12 — THE DEFERRED BRANCH, PROVEN BY ALLOWLIST.
//
// `check-routine-gate.mjs --validate-decision` says `defer` (recorded in
// `.planning/phases/29-unified-knowledge-and-routines/29-RECURRENCE-DECISION.md`), so 29-12's job
// is the affirmative proof that recurrence is ABSENT from the tree, and to make no implementation
// edit at all.
//
// ═══ WHY THIS FILE IS AN ALLOWLIST AND NOT A BLOCKLIST ═══════════════════════════════════════
//
// Rounds 1-3 of this file asked "does any file contain one of these ten tokens, or a filename
// matching one of these four words?" THREE INDEPENDENT VERIFIERS DEFEATED THAT, INDEPENDENTLY,
// BY NOT USING THE WORDS:
//
//   - `packages/core/src/recurrenceEngine.ts` + `packages/backend/convex/tick.ts`, an
//     `internalMutation` re-arming itself via `ctx.scheduler.runAt(...)`   -> 135/135 green
//   - `packages/core/src/cadence.ts` (`nextRunAt`, `computeDue`, `runKeyFor`, `DEFAULT_RULE`) +
//     `packages/backend/convex/lib/dueTimer.ts` (`armNext`, self-arming)   ->  89/89 green
//   - `packages/backend/convex/sweeps/digestLoop.ts` — a per-tenant unbounded self-arming loop
//     with `CADENCE_MS`, `dueInstantFor()` and `ctx.scheduler.runAt`        ->   8/8 green
//
// Round 2 was defeated by a trailing `//`; round 3 closed that and was defeated by renaming, and
// separately by changing one letter's case. The rounds were not converging, because A BLOCKLIST
// OVER AN OPEN VOCABULARY CANNOT PROVE ABSENCE. Renaming defeats it, always.
//
// So the question is REPLACED. Not "is anything here on my list of forbidden names?" but
// "IS EVERYTHING HERE IN THE SET I APPROVED?" Two closed sets, both pinned to in-file literals:
//
//   1. CONVEX_MODULES — the entire convex module namespace, enumerated from the FILESYSTEM. A
//      new module, under ANY name, in ANY subdirectory, is a visible governance diff. All three
//      constructions above needed one, because `ctx.scheduler` and `internalMutation` exist
//      nowhere else. This is the property renaming cannot dodge.
//   2. SCHEDULER_CALL_SITES / CRON_REGISTRARS — every file that calls a scheduling primitive,
//      found by scanning source. This is what actually separates "a workflow step schedules a
//      follow-up" from "a routine arms its next occurrence"; a token list never could.
//
// The ten-token scan is KEPT, but it is a convenience and NOT the proof. It is the cheap, legible
// signal that names the shape in review; the two closed sets are what refuse it.
//
// AN ABSENCE TEST IS THE EASIEST KIND TO WRITE VACUOUSLY, AND THIS REPO HAS SHIPPED ONE:
// `apps/web/e2e/workflow-pack-pilot.spec.ts` had a `toHaveCount(0)` that PASSED WITH ALL SIX PACKS
// ACTIVE. So every claim below carries a POSITIVE CONTROL in the same test: an assertion that the
// same scan, over the same corpus, finds something that really is there.
//
// WHAT THIS FILE DELIBERATELY DOES NOT RE-IMPLEMENT. `schema.test.ts` owns the exhaustive STORAGE
// guard: an 11-name banned-table list, a substring scan over EVERY table name, a
// whitespace-insensitive field-name scan, and the verbatim deferral sentence from schema.ts.

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..", "..");
const CONVEX = "packages/backend/convex";

/** `.ts`/`.tsx` under a root, recursively, excluding tests. Returns paths relative to `root`. */
const sourcesUnder = (root: string) =>
  readdirSync(join(repoRoot, root), { recursive: true, encoding: "utf8" })
    .filter((f) => /\.(ts|tsx)$/.test(f) && !/\.test\.(ts|tsx)$/.test(f))
    .map((f) => f.split(sep).join("/"))
    .sort();

// ═══ CLOSED SET 1: THE CONVEX MODULE NAMESPACE ═══════════════════════════════════════════════
//
// PINNED TO AN IN-FILE LITERAL, deliberately. Round 3's ten banned tokens were an inline array
// nobody held, so deleting one was invisible; `routineDecision.test.ts` pins `ROW_IDS`,
// `STATUSES`, `EVIDENCE_TYPES`, `DECISIONS` and `DECIDERS` to literals precisely so widening is
// a governance change someone has to type. This is the same discipline applied to the set that
// actually matters in 29-12.
//
// Adding a module to this list is not forbidden — it is REQUIRED, in the same diff, by whoever
// adds the module. That is the whole point: the reviewer sees the name.
// EIGHT NAMES ADDED 2026-08-30 when the Phase 29 lane merged `origin/main` (Phase 28 + 28.1):
// `billing.ts`, `billingApi.ts`, `billingWebhook.ts`, `paypalAuth.ts`, `paypalConnector.ts`,
// `quickbooks.ts`, `stripeAuth.ts`, `stripeConnector.ts`. This list going red on a merge is the
// pin DOING ITS JOB — a new convex module cannot arrive silently under any name.
//
// EACH WAS CHECKED, not pasted: `grep -cE "ctx\.scheduler|cronJobs|runAfter|runAt|interval\(|
// daily\(|hourly\(|crons\."` returns **0 for all eight**, and `cronJobs` still appears in exactly
// one non-test module (`crons.ts`). The scheduler/cron allowlist tests below stayed GREEN across
// the merge, which is the same fact reached independently. So Phase 28's connector and billing
// rails add no recurrence mechanism, and `decision: defer` survives the merge on evidence rather
// than on the pin having been quietly refreshed.
const CONVEX_MODULES = [
  "_generated/api.d.ts",
  "_generated/dataModel.d.ts",
  "_generated/server.d.ts",
  "agenda.ts",
  "agentSteps.ts",
  "aggregates.ts",
  "approvals.ts",
  "audit.ts",
  "auth.config.ts",
  "auth.ts",
  "billing.ts",
  "billingApi.ts",
  "billingLedger.ts",
  "billingRollup.ts",
  "billingWebhook.ts",
  "blueprint.ts",
  "briefings.ts",
  "calendar.ts",
  "calendarComplete.ts",
  "calendarEvents.ts",
  "calendarViews.ts",
  "cash.ts",
  "cockpit.ts",
  "cockpitCapabilities.ts",
  "connectorConnections.ts",
  "connectorCredentials.ts",
  "connectorFetch.ts",
  "connectorOAuth.ts",
  "contacts.ts",
  "content.ts",
  "contentAudit.ts",
  "convex.config.ts",
  "crons.ts",
  "deadLetter.ts",
  "deadLetters.ts",
  "deliverApprovedPlan.ts",
  "delivery.ts",
  "demo.ts",
  "dispatch.ts",
  "dispatchRun.ts",
  "evaluations.ts",
  "feedback.ts",
  "finance.ts",
  "gmail.ts",
  "gmailAuth.ts",
  "goals.ts",
  "graph.ts",
  "guardrails.ts",
  "home.ts",
  "http.ts",
  "hubspot.ts",
  "hubspotAuth.ts",
  "index.ts",
  "intake.ts",
  "intakeDb.ts",
  "invites.ts",
  "invoiceReminders.ts",
  "knowledgeExternalSources.ts",
  "knowledgeLlm.ts",
  "knowledgeSearch.ts",
  "knowledgeVaultDrive.ts",
  "lib/agenda.ts",
  "lib/allowlist.ts",
  "lib/dispatchShared.ts",
  "lib/env.ts",
  "lib/foglamp.ts",
  "lib/functions.ts",
  "lib/hash.ts",
  "lib/models.ts",
  "lib/planRow.ts",
  "lib/toolContextArgs.ts",
  "llm.ts",
  "media.ts",
  "mediaComplete.ts",
  "mediaIntent.ts",
  "microsoftAuth.ts",
  "microsoftCalendar.ts",
  "migrations.ts",
  "notifications.ts",
  "notifyExternal.ts",
  "onboarding.ts",
  "ops.ts",
  "opsSignals.ts",
  "optimizerConfig.ts",
  "optimizerEligibility.ts",
  "owner.ts",
  "paypalAuth.ts",
  "paypalConnector.ts",
  "pinnedWorkflows.ts",
  "pipeline.ts",
  "plans.ts",
  "proactiveReview.ts",
  "proposals.ts",
  "providerGates.ts",
  "quickbooks.ts",
  "quickbooksAuth.ts",
  "reliabilitySweep.ts",
  "render/assembleScript.ts",
  "render/burnCapsScript.ts",
  "render/renderReel.ts",
  "reportPack.ts",
  "reportPackData.ts",
  "reportsBusiness.ts",
  "reportsGovernance.ts",
  "requests.ts",
  "research.ts",
  "revenueCrm.ts",
  "revenueFinance.ts",
  "revenueTelemetry.ts",
  "revenueTools.ts",
  "review.ts",
  "savedPrompts.ts",
  "schema.ts",
  "skilloptExport.ts",
  "skills.ts",
  "smoke.ts",
  "smokeAssert.ts",
  "spendLedger.ts",
  "stripeAuth.ts",
  "stripeConnector.ts",
  "telemetry.ts",
  "tenantDelete.ts",
  "tenantExport.ts",
  "tenantProfile.ts",
  "vault.ts",
  "vaultDigest.ts",
  "vaultDrive.ts",
  "vaultExtract.ts",
  "vaultFolders.ts",
  "vaultGraph.ts",
  "vaultGround.ts",
  "vaultIngest.ts",
  "vaultLlm.ts",
  "vaultRag.ts",
  "vaultSmoke.ts",
  "vaultSources.ts",
  "vaultSweep.ts",
  "vaultTranscribe.ts",
  "voice.ts",
  "voiceDoc.ts",
  "voiceToken.ts",
  "workflowPackBinding.ts",
  "workflowPackDiscovery.ts",
  "workflowPackEventLog.ts",
  "workflowPackOutcomes.ts",
  "worm.ts",
  "wormCursor.ts",
];

// ═══ CLOSED SET 2: THE SCHEDULING PRIMITIVES' CALL SITES ═════════════════════════════════════
//
// Convex offers exactly two ways to make code run later: `ctx.scheduler.*` from inside a
// function, and `crons.*` registered statically at module level. A per-tenant routine cannot be
// expressed as a cron — Convex crons are fixed module-level registrations — so a self-arming
// loop MUST reach for `ctx.scheduler`. Every construction that defeated round 3 did.
//
// These lists are the answer to "who may schedule work at all". Each file below schedules a
// FOLLOW-UP STEP of a run the user started: a poll for a media job, a watchdog timeout, the next
// page of a folder walk. None re-arms itself on a cadence.
const SCHEDULER_CALL_SITES = [
  "billingRollup.ts",
  "cockpit.ts",
  "evaluations.ts",
  "llm.ts",
  "media.ts",
  "mediaComplete.ts",
  "notifications.ts",
  "proactiveReview.ts",
  "review.ts",
  "smoke.ts",
  "vault.ts",
  "vaultDigest.ts",
  "vaultDrive.ts",
  "vaultFolders.ts",
  "voice.ts",
];
const CRON_REGISTRARS = ["crons.ts"];

const SCHEDULER_CALL = /ctx\.scheduler\.(runAt|runAfter|cancel)\s*\(/;
const CRON_REGISTRATION = /\bcrons\.[a-zA-Z]+\s*\(/;

/** Every non-test convex module, as `{ file, text, lines }`, read once. */
const code = sourcesUnder(CONVEX).map((file) => {
  const text = readFileSync(join(repoRoot, CONVEX, file), "utf8");
  return { file, text, lines: text.split("\n") };
});

describe("the convex module namespace is a CLOSED, PINNED set", () => {
  test("every module on disk is one this file names — and every name is on disk", () => {
    // POSITIVE CONTROL: the walk really happened, really recursed, and really found the modules
    // a round-1-style single-level `readdirSync` could not see.
    const onDisk = code.map((f) => f.file);
    expect(onDisk.length).toBeGreaterThan(100);
    for (const known of [
      "schema.ts",
      "crons.ts",
      "savedPrompts.ts",
      "lib/functions.ts", // nested — invisible to a single-level listing
      "render/renderReel.ts", // nested
    ]) {
      expect(onDisk, `${known} should be in the scan`).toContain(known);
    }

    // THE CLAIM. Not "nothing is named for recurrence" — that is a blocklist and renaming beats
    // it. This is "the namespace is exactly the modules reviewed on 2026-08-29". A recurrence
    // module called `tick.ts`, `lib/dueTimer.ts` or `sweeps/digestLoop.ts` fails here on its
    // NAME BEING NEW, which is a property no naming choice can dodge.
    expect(onDisk).toEqual(CONVEX_MODULES);
  });
});

describe("the scheduling primitives have a CLOSED, PINNED call-site set", () => {
  test("only these modules call `ctx.scheduler`, and only crons.ts registers a cron", () => {
    const schedulers = code.filter((f) => SCHEDULER_CALL.test(f.text)).map((f) => f.file);
    const crons = code.filter((f) => CRON_REGISTRATION.test(f.text)).map((f) => f.file);

    // POSITIVE CONTROL: both patterns really match real code in this tree. If either regex were
    // misspelled, both claims below would be vacuously green — which is exactly the shape of the
    // `toHaveCount(0)` bug quoted at the top of this file.
    expect(schedulers.length).toBeGreaterThan(5);
    expect(schedulers).toContain("vaultFolders.ts");
    expect(SCHEDULER_CALL.test("await ctx.scheduler.runAt(at, internal.x.y, {})")).toBe(true);
    expect(SCHEDULER_CALL.test("await ctx.scheduler.runAfter(0, internal.x.y, {})")).toBe(true);
    expect(CRON_REGISTRATION.test('crons.interval("x", { minutes: 30 }, internal.a.b, {})')).toBe(
      true,
    );

    // THE CLAIM.
    expect(schedulers).toEqual(SCHEDULER_CALL_SITES);
    expect(crons).toEqual(CRON_REGISTRARS);
  });

  test("THE RESIDUAL, STATED AS A TEST: every pinned call site is a pinned module", () => {
    // Said plainly, because an absence proof that overclaims is worse than none. This pair of
    // closed sets refuses a recurrence subsystem that needs a NEW module or a NEW scheduling
    // file. It does NOT see a self-arming loop grafted into one of the fourteen files that
    // already schedule — adding a re-arm inside `vaultFolders.ts` is a review question, not a
    // test failure. No source scan can separate "schedules the next page of this walk" from
    // "schedules the next occurrence" inside a file that legitimately does the former.
    // `schema.test.ts`'s storage guard is the backstop there: a routine that has to survive a
    // restart needs a row somewhere, and no table may be recurrence-shaped.
    for (const f of [...SCHEDULER_CALL_SITES, ...CRON_REGISTRARS]) {
      expect(CONVEX_MODULES, f).toContain(f);
    }
  });

  test("crons.ts holds only global system jobs, by pinned name", () => {
    const crons = code.find((f) => f.file === "crons.ts");
    expect(crons, "crons.ts is not in the corpus").toBeDefined();
    // POSITIVE CONTROL: this really is the cron registry and it really does register jobs.
    const registered = [...(crons?.text ?? "").matchAll(/crons\.\w+\(\s*\n?\s*"([^"]+)"/g)].map(
      (m) => m[1],
    );
    // THE CLAIM: a CLOSED set of five fixed global jobs. Round 3 asserted only
    // `expect(crons).not.toMatch(/tenantId/)`, which is a literal-string grep — a per-tenant
    // fan-out passing `orgId`, `workspaceId` or an id array read green. Pinning the registered
    // NAMES instead means a sixth job of any name, per-tenant or not, is a visible diff.
    expect(registered).toEqual([
      "worm-export",
      "gmail-token-expiry-scan",
      "proactive-review",
      "vault-pending-extraction-sweep",
      "reliability-sweep",
      "billing-invoice-rollup",
    ]);
  });
});

// ═══ THE TOKEN SCAN: A CONVENIENCE, NOT THE PROOF ════════════════════════════════════════════
//
// Kept because it is cheap and names the shape legibly in a review. It is NOT what refuses a
// recurrence subsystem — the two closed sets above are — and it demonstrably cannot be: three
// verifiers walked past it by choosing other words. Read a green result here as "nobody used the
// obvious names", nothing more.
//
// NO COMMENT STRIPPING. Round 2 stripped comments and the stripper was fail-open in two
// directions: a `//`-suffixed line was deleted whole, code included (290 real code lines across
// 44 files erased before the scan), and an unanchored `/*...*/` match ate everything from a `/*`
// inside a string literal. The one line in this corpus that legitimately names the forbidden
// identifiers is EXEMPTED BY NAME instead. That inverts the failure direction.
const ALLOWED = new Map([
  [
    "schema.ts",
    "// THERE IS STILL DELIBERATELY NO cadence, timezone, nextRunAt, enabled flag, scheduler id,",
  ],
]);

const BANNED_TOKENS = [
  "nextRunAt",
  "nextRun",
  "nextOccurrence",
  "occurrenceKey",
  "cronExpression",
  "rrule",
  "recurrenceRule",
  "routineId",
  "routineRun",
  "standingApproval",
];

/**
 * `file:line` for every banned token in a corpus, minus the exempted lines. Factored out of the
 * test so the EXEMPTION ITSELF can be driven with a synthetic corpus — round 3's exemption test
 * asserted only that the exempted line still existed, so widening the filter from
 * `ALLOWED.get(f) !== text` (this exact line) to `!ALLOWED.has(f)` (all of schema.ts) survived
 * 7/7 green with a live banned identifier planted in the largest file in the namespace.
 */
// DEDUPED BY LINE. The banned tokens OVERLAP — `nextRunAt` contains `runAt` — so one offending
// line matched two tokens and was reported twice, and an assertion naming the line once failed on
// a duplicate rather than on anything real. The unit of this scan is the LINE: one banned line is
// one hit, whatever it happened to match.
const tokenHits = (corpus: Array<{ file: string; lines: string[] }>) => [
  ...new Set(
    BANNED_TOKENS.flatMap((token) => {
      const needle = token.toLowerCase();
      return corpus.flatMap(({ file, lines }) =>
        lines
          .map((text, n) => ({ at: `${file}:${n + 1}`, text: text.trim() }))
          .filter(({ text }) => text.toLowerCase().includes(needle))
          .filter(({ text }) => ALLOWED.get(file) !== text)
          .map(({ at }) => at),
      );
    }),
  ),
];

describe("the ten-token convenience scan", () => {
  test("the exemption is ONE FILE AND ONE EXACT LINE — not a file-level pass", () => {
    expect(ALLOWED.size).toBe(1);
    expect([...ALLOWED.keys()]).toEqual(["schema.ts"]);
    // The exempted line is still exactly where the exemption says it is. If schema.ts's promise
    // sentence is reworded, this fails BEFORE the scan starts carrying a stale exemption.
    const schema = code.find((f) => f.file === "schema.ts");
    expect(schema, "schema.ts is not in the scanned corpus").toBeDefined();
    expect(schema?.lines.map((l) => l.trim())).toContain(ALLOWED.get("schema.ts"));

    // AND THE SCOPE IS NARROW: a SECOND banned line in the very same exempted file is reported.
    // This is the half round 3 left uncovered. Driving it with a synthetic corpus keeps the real
    // tree untouched while asserting the filter matches on the LINE, not just on the file.
    const synthetic = [
      {
        file: "schema.ts",
        lines: [
          `  ${ALLOWED.get("schema.ts")}`,
          "  export const nextRunAt = Date.now() + 86_400_000;",
        ],
      },
    ];
    expect(tokenHits(synthetic)).toEqual(["schema.ts:2"]);
    // And with only the exempted line, nothing is reported — so the line above is reported
    // because it is BANNED, not because the exemption never applies.
    expect(tokenHits([{ file: "schema.ts", lines: [`  ${ALLOWED.get("schema.ts")}`] }])).toEqual(
      [],
    );
  });

  test("the ten banned tokens are these, and none appears in the convex namespace", () => {
    // PINNED, like every other closed set in 29-11/29-12. Round 3's list was an inline array, so
    // dropping a token from it was invisible in review.
    expect(BANNED_TOKENS).toEqual([
      "nextRunAt",
      "nextRun",
      "nextOccurrence",
      "occurrenceKey",
      "cronExpression",
      "rrule",
      "recurrenceRule",
      "routineId",
      "routineRun",
      "standingApproval",
    ]);
    // POSITIVE CONTROL: the corpus really was read, and the matcher really is case-insensitive
    // (so `RoutineRun` cannot slip past a scan written for `routineRun`).
    expect(code.length).toBe(CONVEX_MODULES.length);
    expect(tokenHits([{ file: "probe.ts", lines: ["const RoutineRun = 1;"] }])).toEqual([
      "probe.ts:1",
    ]);
    // The claim.
    expect(tokenHits(code)).toEqual([]);
  });
});

describe("no recurrence UI ROUTE", () => {
  // A name filter, and honestly labelled as one: apps/web is owned by sibling plans in this
  // phase and churns, so pinning its file list here would fight them. The arming plane is
  // convex — a React route cannot schedule anything — so the closed sets above are where the
  // proof lives; this is the cheap signal that nobody shipped a "Routines" tab.
  test("no route segment or component is named for routines or scheduling", () => {
    const webSources = sourcesUnder("apps/web/app");
    // POSITIVE CONTROL: the walk really reached the dashboard routes.
    expect(webSources.length).toBeGreaterThan(20);
    for (const known of [
      "(app)/dashboard/workflows/page.tsx",
      "(app)/dashboard/workspace/page.tsx",
    ]) {
      expect(webSources, `${known} should be in the scan`).toContain(known);
    }
    expect(webSources.filter((f) => /routine|cron|recurr|schedul/i.test(f))).toEqual([]);
  });
});

describe("no scheduling DEPENDENCY", () => {
  test("no manifest names one of the NAMED schedulers — and the manifest list is DERIVED", () => {
    // Reuses the gate's own rule rather than re-implementing it (ponytail rung 2). The rule is
    // observed FIRING, package by package, in routineDecision.test.ts.
    //
    // THE SET IS CLOSED AND NAMED: round 2's rule was `/temporal/i` alone, so `rrule`,
    // `cron-parser`, `node-cron`, `croner`, `bullmq` and `@js-joda` all read green under a
    // heading that said "no scheduling DEPENDENCY". `agenda` is deliberately outside it.
    expect(SCHEDULING_DEPENDENCY_RE.source).toContain("rrule");
    expect(SCHEDULING_DEPENDENCY_RE.source).toContain("cron-parser");
    expect(deferAbsenceChecks({ repoRoot }).errors).toEqual([]);
    // POSITIVE CONTROL on the scan's REACH. Round 3 hardcoded five manifests — the root, the
    // lockfile, apps/web and two of ten workspace packages — so `rrule` in
    // `packages/vault/package.json` was invisible until `pnpm install` wrote it into the lock.
    // The list is derived from the filesystem now: EVERY package with a manifest is covered.
    expect(DEPENDENCY_MANIFESTS).toContain("pnpm-lock.yaml");
    expect(DEPENDENCY_MANIFESTS).toContain("apps/web/package.json");
    const packagesOnDisk = readdirSync(join(repoRoot, "packages")).sort();
    for (const pkg of packagesOnDisk) {
      expect(DEPENDENCY_MANIFESTS, pkg).toContain(`packages/${pkg}/package.json`);
    }
    expect(packagesOnDisk.length).toBeGreaterThanOrEqual(10);
    // And the manifests really exist and really were readable.
    for (const m of DEPENDENCY_MANIFESTS) {
      expect(readFileSync(join(repoRoot, m), "utf8").length).toBeGreaterThan(0);
    }
  });
});

describe("this whole file is conditional on the recorded decision", () => {
  test("the decision record still says `defer`", () => {
    // THE BRANCH GUARD. Every assertion above is the `defer` branch of 29-12. If a later plan
    // earns `enable-safe`, this test fails first and forces the absence proof to be revisited
    // deliberately rather than quietly deleted or, worse, left green over a shipped scheduler.
    const text = readFileSync(
      join(
        repoRoot,
        ".planning/phases/29-unified-knowledge-and-routines/29-RECURRENCE-DECISION.md",
      ),
      "utf8",
    );
    const doc = parseArtifact(text).doc as { decision: string } | null;
    expect(doc, "the decision record no longer parses").not.toBeNull();
    expect(doc?.decision).toBe("defer");
  });
});
