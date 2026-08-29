import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

// 29-13 (ROUT-02) — THE BRANCH PROOF FOR THE ROUTINE UX.
//
// This file exists in BOTH branches on purpose. It does not know which branch is right; it READS
// `29-RECURRENCE-DECISION.md` and asserts whatever that artifact selects. A test hard-coded to
// `defer` would silently stop meaning anything the day the decision flips — it would go on passing
// while the tree it describes no longer matched the record.
//
// THE DECISION TODAY IS `defer` (parsed, not assumed — `check-routine-gate.mjs --validate-decision`
// exits 0 on it), so the deferred describe runs and the enable-safe one is skipped.
//
// AN ABSENCE TEST IS THE EASIEST KIND TO SHIP VACUOUS, AND THIS REPO HAS SHIPPED ONE:
// `e2e/workflow-pack-pilot.spec.ts` had a `toHaveCount(0)` that PASSED WITH ALL SIX PACKS ACTIVE,
// because it succeeded on its first poll. A grep that finds nothing because the path was misspelled
// is indistinguishable from a grep that finds nothing because the feature is absent. So every
// absence claim below sits beside a POSITIVE CONTROL: the same scan, over the same corpus, finding
// something that really is there.
//
// WHAT THIS FILE DELIBERATELY DOES NOT RE-IMPLEMENT (ponytail rung 2 — it is already here):
//   - `convex/routines.test.ts` owns the BACKEND absence: module namespace, cron registry,
//     next-occurrence identifiers in convex source, scheduling dependencies, and the UI-route
//     FILENAME scan over `apps/web/app`.
//   - `convex/schema.test.ts` owns the storage absence (banned tables, banned fields).
//   - `PinnedWorkflowButton.test.ts` owns the RENDERED COPY ban ("every", "daily", "schedule",
//     "recurring", "next run"...) across every state that surface can be in.
// What is left, and what this file owns, is the half none of them look at: the WEB SOURCE TEXT —
// a routine component file, a mount in `page.tsx`, and a recurrence API binding.

const here = dirname(fileURLToPath(import.meta.url));
// workflows -> dashboard -> (app) -> app -> web -> apps -> repo root.
const repoRoot = join(here, "..", "..", "..", "..", "..", "..");
const decisionPath = join(
  repoRoot,
  ".planning",
  "phases",
  "29-unified-knowledge-and-routines",
  "29-RECURRENCE-DECISION.md",
);

/** The closed set, spelled out here rather than imported from the gate script. A constant the test
 *  IMPORTS moves the oracle with the subject: if someone added a third decision to
 *  `check-routine-gate.mjs`, an imported list would accept it silently. This one goes red. */
const DECISIONS = ["defer", "enable-safe"] as const;
type Decision = (typeof DECISIONS)[number];

/** Read the recorded decision out of the artifact's YAML frontmatter.
 *
 *  `readFileSync` is the right primitive: a wrong path THROWS `ENOENT` instead of returning
 *  "nothing found", so this cannot degrade into a silently-empty read the way a glob can. The
 *  artifact is CRLF (every `.planning/*.md` in this repo is), hence the `\r?`. */
function readDecision(): { decision: Decision; frontmatter: string } {
  const text = readFileSync(decisionPath, "utf8");
  const block = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (block === null) throw new Error(`${decisionPath} has no YAML frontmatter block`);
  const frontmatter = block[1] as string;
  const line = /^decision:\s*(\S+)\s*$/m.exec(frontmatter);
  if (line === null) throw new Error(`${decisionPath} frontmatter has no \`decision:\` line`);
  const value = line[1] as string;
  if (!(DECISIONS as readonly string[]).includes(value)) {
    throw new Error(`${decisionPath} records decision "${value}", not one of ${DECISIONS.join("/")}`);
  }
  return { decision: value as Decision, frontmatter };
}

const { decision, frontmatter } = readDecision();
const deferred = decision === "defer";

const controlsPath = join(here, "RoutineControls.tsx");
const pagePath = join(here, "page.tsx");
const page = readFileSync(pagePath, "utf8");

/** Every non-test `.ts`/`.tsx` under a repo-relative root, as `{ file, lines }`. */
const sourcesUnder = (root: string) =>
  readdirSync(join(repoRoot, root), { recursive: true, encoding: "utf8" })
    .filter((f) => /\.(ts|tsx)$/.test(f) && !/\.test\.(ts|tsx)$/.test(f))
    .map((f) => `${root}/${f.split(sep).join("/")}`)
    .map((file) => ({ file, lines: readFileSync(join(repoRoot, file), "utf8").split("\n") }));

// `apps/web/app` is the WHOLE of this app's source: there is no `apps/web/lib` (the vitest config
// lists one speculatively; `readdirSync` throws `ENOENT` on it, which is how that was established
// rather than assumed) and `e2e/` holds specs, not app code. Every route, component and hook a
// routine UI could be built from is under this one root.
const webSources = sourcesUnder("apps/web/app");

/** Identifiers a routine UI cannot be built without. Deliberately IDENTIFIER-SHAPED rather than
 *  prose words: three files in this tree legitimately say "routine" in a comment (`ChatPane.tsx`,
 *  `workspace/page.tsx`, `SkillAuthoringPanel.tsx`, all describing SKILL-01's inert "routine v0"
 *  pinned prompts), and an exemption list nobody re-reads is a hole with a comment on it. None of
 *  these tokens can appear in English prose, so no comment-stripping and no exemptions are needed
 *  and the scan stays fail-closed: a hit anywhere — code OR comment — is red and a human looks.
 *
 *  The first seven are exactly the lifecycle APIs 29-13's enable-safe branch would have wired. */
const RECURRENCE_TOKENS = [
  "listRoutines",
  "createRoutine",
  "pauseRoutine",
  "resumeRoutine",
  "revokeRoutine",
  "checkReadiness",
  "listRunHistory",
  "api.routines",
  "RoutineControls",
  "routineId",
  "routineRun",
  "nextRunAt",
  "nextRun",
  "nextOccurrence",
  "occurrenceKey",
  "cronExpression",
  "rrule",
  "recurrenceRule",
  "standingApproval",
];

describe("the recorded decision is what selects the branch", () => {
  test("the artifact parses, and the decision is a member of the closed set", () => {
    // POSITIVE CONTROL: the frontmatter really was read, not defaulted. These two keys sit either
    // side of `decision:` in the record, so a truncated or mis-sliced block cannot pass.
    expect(frontmatter).toContain("decidedAt:");
    expect(frontmatter).toContain("matrix:");
    expect(DECISIONS).toContain(decision);
  });

  // THE BRANCH ITSELF, IN ONE LINE, AND IT ALWAYS RUNS. Red if the record says `defer` while a
  // RoutineControls file exists, AND red if the record says `enable-safe` while it does not. Every
  // other test in this file is detail hanging off this equivalence.
  test("the presence of RoutineControls.tsx matches the recorded decision exactly", () => {
    expect(existsSync(pagePath), "the scan is looking at the real workflows directory").toBe(true);
    expect(existsSync(controlsPath)).toBe(!deferred);
  });
});

describe.runIf(deferred)("DEFERRED — recurrence is structurally absent from the web app", () => {
  test("the workflows surface holds no routine component and no test for one", () => {
    const entries = readdirSync(here);
    // POSITIVE CONTROL: this is the real surface, with the three files that really are here.
    for (const known of ["page.tsx", "PinnedWorkflowButton.tsx", "WorkflowPackCustomizer.tsx"]) {
      expect(entries, `${known} should be in the directory listing`).toContain(known);
    }
    // The claim, as a LITERAL list rather than a `not.toContain`: this file is the only entry whose
    // name says "routine". `RoutineControls.tsx` or `RoutineControls.test.tsx` appearing beside it
    // fails on the diff, and so does a `routineSchedule.ts` nobody thought to ban by name.
    expect(entries.filter((f) => /routine/i.test(f))).toEqual(["routineBranch.test.ts"]);
  });

  test("workflows/page.tsx mounts the manual surfaces and nothing recurrence-shaped", () => {
    // POSITIVE CONTROL: the page really does import AND render both surfaces. An import with no
    // JSX tag would leave the route blank while a `not.toMatch` below still read green.
    expect(page).toContain('import { PinnedWorkflowButton } from "./PinnedWorkflowButton";');
    expect(page).toContain("<PinnedWorkflowButton />");
    expect(page).toContain('import { WorkflowPackCustomizer } from "./WorkflowPackCustomizer";');
    expect(page).toContain("<WorkflowPackCustomizer />");
    // The claim: the page says nothing about routines at all — no import, no tag, no comment
    // promising one later. Scoped to this ONE file, where the mount would have to live, so the
    // bare word can be banned here even though it is legitimate prose three files away.
    expect(page).not.toMatch(/routine/i);
  });

  test("no web source binds a recurrence lifecycle API", () => {
    // POSITIVE CONTROL, THREE WAYS: the corpus is large, it contains the files that matter, and it
    // contains the Convex bindings that really are wired — so a token missing below is missing
    // from the TREE, not missing because the scan read an empty list.
    expect(webSources.length).toBeGreaterThan(50);
    const files = webSources.map((s) => s.file);
    for (const known of [
      "apps/web/app/(app)/dashboard/workflows/page.tsx",
      "apps/web/app/(app)/dashboard/workflows/PinnedWorkflowButton.tsx",
      "apps/web/app/(app)/dashboard/workspace/page.tsx",
    ]) {
      expect(files, `${known} should be in the scan`).toContain(known);
    }
    const corpus = webSources.flatMap((s) => s.lines).join("\n");
    expect(corpus).toContain("api.pinnedWorkflows.listPins");
    expect(corpus).toContain("api.workflowPackDiscovery.listPacks");

    // The claim. Case-insensitive, so `RoutineId` cannot slip past a scan written for `routineId`.
    for (const token of RECURRENCE_TOKENS) {
      const needle = token.toLowerCase();
      const hits = webSources.flatMap(({ file, lines }) =>
        lines
          .map((text, n) => ({ at: `${file}:${n + 1}`, text }))
          .filter(({ text }) => text.toLowerCase().includes(needle))
          .map(({ at }) => at),
      );
      expect(hits, `${token} appears in apps/web source`).toEqual([]);
    }
  });
});

describe.runIf(!deferred)("ENABLE-SAFE — the routine surface is mounted and fully wired", () => {
  // NEVER EXECUTED AS OF 29-13. The recorded decision is `defer`, so this describe is skipped
  // today; it is here so the file is honest in both directions rather than being a `defer`
  // assertion wearing a conditional. If the decision ever flips, these must hold.
  test("RoutineControls exists and workflows/page.tsx mounts it beside the manual rerun", () => {
    expect(existsSync(controlsPath)).toBe(true);
    // POSITIVE CONTROL: the manual rerun surface stays. Recurrence is added BESIDE "Run again",
    // never in place of it — a user must always keep the way to start a run by hand.
    expect(page).toContain("<PinnedWorkflowButton />");
    expect(page).toContain('from "./RoutineControls"');
    expect(page).toMatch(/<RoutineControls\b/);
  });

  test("every lifecycle API the enabled branch promised is actually bound", () => {
    const controls = readFileSync(controlsPath, "utf8");
    for (const fn of [
      "listRoutines",
      "createRoutine",
      "pauseRoutine",
      "resumeRoutine",
      "revokeRoutine",
      "checkReadiness",
      "listRunHistory",
    ]) {
      expect(controls, `RoutineControls.tsx does not bind ${fn}`).toContain(`api.routines.${fn}`);
    }
  });
});
