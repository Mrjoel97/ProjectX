import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import {
  DEPENDENCY_MANIFESTS,
  deferAbsenceChecks,
  parseArtifact,
} from "../scripts/check-routine-gate.mjs";
import schema from "./schema";

// 29-12 — THE DEFERRED BRANCH, PROVEN.
//
// `check-routine-gate.mjs --validate-decision` says `defer` (recorded in
// `.planning/phases/29-unified-knowledge-and-routines/29-RECURRENCE-DECISION.md`), so 29-12's job
// is the affirmative proof that recurrence is ABSENT from the tree, and to make no implementation
// edit at all. No table, no module, no UI route, no next-occurrence machinery, no dependency.
//
// AN ABSENCE TEST IS THE EASIEST KIND OF TEST TO WRITE VACUOUSLY, AND THIS REPO HAS SHIPPED ONE:
// `apps/web/e2e/workflow-pack-pilot.spec.ts` had a `toHaveCount(0)` that PASSED WITH ALL SIX PACKS
// ACTIVE, because it succeeded on its first poll before the query resolved. A grep that finds
// nothing because the path was misspelled is indistinguishable from a grep that finds nothing
// because the feature is absent. So EVERY absence claim below carries a POSITIVE CONTROL in the
// same test: an assertion that the same scan, over the same corpus, finds something that really is
// there. If a control ever fails, the absence beside it means nothing.
//
// WHAT THIS FILE DELIBERATELY DOES NOT RE-IMPLEMENT. `schema.test.ts` already owns the exhaustive
// storage guard: an 11-name banned-table list, a substring scan over EVERY table name, and a
// field-name scan over the schema source for next-run/cadence/timezone-rule/scheduler-id fields.
// Round 1 of the neighbouring `routineDecision.test.ts` rebuilt a weaker version of that (two
// hardcoded regexes) and was blind to a `standingRoutines` table that `schema.test.ts` caught. The
// table check below is one line against the PARSED schema object and points at that file; the rest
// of this file covers the four things `schema.test.ts` does not look at.

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..", "..");

/** Every table the deployment actually declares, read from the schema object, not from text. */
const tableNames = Object.keys(schema.tables);

/** `.ts`/`.tsx` under a root, recursively, excluding tests. Returns repo-relative paths. */
const sourcesUnder = (root: string) =>
  readdirSync(join(repoRoot, root), { recursive: true, encoding: "utf8" })
    .filter((f) => /\.(ts|tsx)$/.test(f) && !/\.test\.(ts|tsx)$/.test(f))
    .map((f) => `${root}/${f.split(sep).join("/")}`);

const RECURRENCE_SHAPED = /routine|cron|recurr|schedul/i;

describe("no recurrence STORAGE", () => {
  test("no table is recurrence-shaped, and the schema object really was read", () => {
    // POSITIVE CONTROL first: if this list is empty or missing known tables, the absence below is
    // meaningless. These four are load-bearing Phase-29 / baseline tables.
    expect(tableNames.length).toBeGreaterThan(30);
    for (const known of ["savedPrompts", "audit", "contacts", "tenantSkills"]) {
      expect(tableNames, `${known} should exist — the schema object was not read`).toContain(known);
    }
    // The claim. `schema.test.ts` "recurrence storage is structurally absent" owns the exhaustive
    // version of this (banned names + a per-field scan); this is the one-line branch guard.
    expect(tableNames.filter((n) => RECURRENCE_SHAPED.test(n))).toEqual([]);
  });

  test("schema.ts still carries the deferral sentence, verbatim", () => {
    // The sentence is wrapped across two comment lines at schema.ts:442-443, so it is compared
    // with the leading `// ` and the line break normalised away — the WORDS are the promise, the
    // wrapping is not. Anything else about the sentence changing must fail this.
    const source = readFileSync(join(here, "schema.ts"), "utf8");
    const prose = source
      .split("\n")
      .map((line) => line.trim().replace(/^\/\/ ?/, ""))
      .join(" ")
      .replace(/\s+/g, " ");
    expect(prose).toContain(
      "There is deliberately NO `routines` table, cron, trigger, recurrence, next-run timestamp, execution-history table, canvas or DSL.",
    );
  });
});

describe("no recurrence MODULE", () => {
  const convexSources = sourcesUnder("packages/backend/convex");

  test("no convex module is named for routines or scheduling", () => {
    // POSITIVE CONTROL: the listing reached the top level AND the nested directories. Round 1's
    // equivalent scan in routineDecision.test.ts read one directory level and could not see
    // convex/lib at all.
    expect(convexSources.length).toBeGreaterThan(50);
    for (const known of [
      "packages/backend/convex/schema.ts",
      "packages/backend/convex/crons.ts",
      "packages/backend/convex/savedPrompts.ts",
      "packages/backend/convex/lib/functions.ts",
      "packages/backend/convex/render/renderReel.ts",
    ]) {
      expect(convexSources, `${known} should be in the scan`).toContain(known);
    }
    // The claim. `crons.ts` is the one legitimate scheduling file and is named as an exception
    // below, not silently permitted by a loose pattern.
    const named = convexSources.filter((f) => RECURRENCE_SHAPED.test(f.split("/").pop() ?? ""));
    expect(named).toEqual(["packages/backend/convex/crons.ts"]);
  });

  test("crons.ts holds only global system jobs — nothing per-tenant, nothing recurrence-shaped", () => {
    const crons = readFileSync(join(here, "crons.ts"), "utf8");
    // POSITIVE CONTROL: this really is the cron registry and it really does register jobs.
    const registered = [...crons.matchAll(/crons\.\w+\(\s*\n?\s*"([^"]+)"/g)].map((m) => m[1]);
    expect(registered).toEqual([
      "worm-export",
      "gmail-token-expiry-scan",
      "proactive-review",
      "vault-pending-extraction-sweep",
      "reliability-sweep",
    ]);
    // The claim: every one is a fixed global job with a literal name. None is named for a routine,
    // none is registered from data, and none takes a tenant. A per-tenant routine cannot be
    // expressed here — Convex crons are static module-level registrations — which is exactly why
    // an enable-safe branch would have needed `ctx.scheduler` self-arming instead.
    for (const name of registered) expect(name).not.toMatch(/routine|recurr/i);
    expect(crons).not.toMatch(/tenantId/);
  });
});

describe("no recurrence UI ROUTE", () => {
  const webSources = sourcesUnder("apps/web/app");

  test("no route segment or component is named for routines or scheduling", () => {
    // POSITIVE CONTROL: the walk really reached the dashboard routes.
    expect(webSources.length).toBeGreaterThan(20);
    for (const known of [
      "apps/web/app/(app)/dashboard/workflows/page.tsx",
      "apps/web/app/(app)/dashboard/workspace/page.tsx",
    ]) {
      expect(webSources, `${known} should be in the scan`).toContain(known);
    }
    // The claim.
    expect(webSources.filter((f) => RECURRENCE_SHAPED.test(f))).toEqual([]);
  });
});

describe("no next-occurrence MACHINERY", () => {
  // Comments in this repo legitimately contain every banned word — `schema.ts:499` says
  // "THERE IS STILL DELIBERATELY NO cadence, timezone, nextRunAt, ..." — so a raw text scan
  // false-positives on the very sentence that promises the absence. Strip comments first.
  const stripComments = (src: string) =>
    src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^[^\n"'`]*\/\/.*$/gm, " ");

  const code = sourcesUnder("packages/backend/convex").map((f) => ({
    file: f,
    src: stripComments(readFileSync(join(repoRoot, f), "utf8")),
  }));

  test("no identifier anywhere computes or stores a NEXT occurrence", () => {
    // POSITIVE CONTROL: after stripping comments the corpus still contains the real scheduling
    // vocabulary that IS here, so a token that is absent below is absent from CODE, not absent
    // because the strip ate everything.
    expect(code.filter((f) => f.src.includes("ctx.scheduler")).length).toBeGreaterThan(5);
    expect(code.find((f) => f.file.endsWith("crons.ts"))?.src).toContain("cronJobs");

    // The claim. Each of these is an identifier a self-arming routine needs; none is English
    // prose, so none can be satisfied by a comment. `nextOccurrence` and `occurrenceKey` are the
    // spike's exports in packages/core — nothing in the backend may reference them.
    for (const token of [
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
    ]) {
      const hits = code.filter((f) => f.src.includes(token)).map((f) => f.file);
      expect(hits, `${token} appears in backend code`).toEqual([]);
    }
  });
});

describe("no scheduling DEPENDENCY", () => {
  test("no manifest names temporal — and the scan covers the lockfile", () => {
    // Reuses the gate's own rule rather than re-implementing it (ponytail rung 2). The rule is
    // observed FIRING against fixture roots in routineDecision.test.ts.
    expect(deferAbsenceChecks({ repoRoot })).toEqual({ ok: true, errors: [] });
    // POSITIVE CONTROL on the scan's reach: 29-12's plan gates on "package manifests or the
    // lockfile", and round 1 of the gate scanned three manifests and no lockfile.
    expect(DEPENDENCY_MANIFESTS).toContain("pnpm-lock.yaml");
    expect(DEPENDENCY_MANIFESTS).toContain("apps/web/package.json");
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
