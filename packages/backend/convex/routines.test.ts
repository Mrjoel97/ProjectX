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
// STORAGE guard: an 11-name banned-table list, a substring scan over EVERY table name, a
// whitespace-insensitive field-name scan for next-run/cadence/timezone-rule/scheduler-id fields,
// and the verbatim deferral sentence from schema.ts. Round 2 of this file said that and then
// re-asserted two of them anyway ("no table is recurrence-shaped" and "schema.ts still carries the
// deferral sentence"), over the same corpus and the same object. Both are DELETED — `schema.test.ts`
// is the owner. This file covers only the four things that file does not look at: the module
// namespace, the cron registry, the UI route namespace, and next-occurrence identifiers in code.

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..", "..");

/** `.ts`/`.tsx` under a root, recursively, excluding tests. Returns repo-relative paths. */
const sourcesUnder = (root: string) =>
  readdirSync(join(repoRoot, root), { recursive: true, encoding: "utf8" })
    .filter((f) => /\.(ts|tsx)$/.test(f) && !/\.test\.(ts|tsx)$/.test(f))
    .map((f) => `${root}/${f.split(sep).join("/")}`);

const RECURRENCE_SHAPED = /routine|cron|recurr|schedul/i;

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
    // The claim, tested against the FULL REPO-RELATIVE PATH. Round 2 tested the BASENAME
    // (`f.split("/").pop()`), so a module inside a directory literally named `routines/` was not
    // "named for routines": `convex/routines/arm.ts`, a self-arming per-tenant loop, passed. The
    // sibling UI scan below always tested the full path; the two disagreed and this was the loose
    // one. `crons.ts` is the one legitimate scheduling file and is named as an exception here, not
    // silently permitted by a loose pattern.
    const named = convexSources.filter((f) => RECURRENCE_SHAPED.test(f));
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
    // The `registered` assertion above IS this claim's positive control: it proves `crons.ts` was
    // read and parsed, so `not.toMatch` below is a real read of a real file. Mutation observed
    // RED: adding a `tenantId` argument to any registration turns this line red.
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
  // NO COMMENT STRIPPING. Round 2 stripped comments before scanning, and the stripper was
  // fail-open in two directions, both demonstrated:
  //   - `/^[^\n"'`]*\/\/.*$/gm -> " "` deleted the WHOLE LINE, code included, for any line
  //     carrying a `//`. `export const nextRunAt = 1;` was RED; the identical line with a trailing
  //     `// comment` was GREEN. 290 real code lines across 44 files were erased before the scan.
  //   - `/\/\*[\s\S]*?\*\//g` ran unanchored over the whole file, so a `/*` inside a string
  //     literal ate everything up to the next `*/`.
  //
  // The reason it existed is that comments in this repo legitimately name the forbidden
  // identifiers — `schema.ts` says "THERE IS STILL DELIBERATELY NO cadence, timezone, nextRunAt,
  // ...". There is exactly ONE such line in the entire corpus (measured), so it is EXEMPTED BY
  // NAME instead. That inverts the failure direction: a banned identifier appearing anywhere else,
  // in code OR in a comment, goes red and a human looks. Fail-closed, and a diffable exemption
  // list rather than a parser that can be walked around with one `//`.
  const ALLOWED = new Map([
    [
      "packages/backend/convex/schema.ts",
      "// THERE IS STILL DELIBERATELY NO cadence, timezone, nextRunAt, enabled flag, scheduler id,",
    ],
  ]);

  const code = sourcesUnder("packages/backend/convex").map((f) => ({
    file: f,
    lines: readFileSync(join(repoRoot, f), "utf8").split("\n"),
  }));

  test("the ONE exempted line is still exactly where the exemption says it is", () => {
    // If schema.ts's promise sentence is reworded, this test fails BEFORE the scan below silently
    // starts carrying a stale exemption. An allow-list nobody re-checks is a hole with a comment.
    for (const [file, line] of ALLOWED) {
      const found = code.find((f) => f.file === file);
      expect(found, `${file} is not in the scanned corpus`).toBeDefined();
      expect(found?.lines.map((l) => l.trim())).toContain(line);
    }
    expect(ALLOWED.size).toBe(1);
  });

  test("no identifier anywhere computes or stores a NEXT occurrence", () => {
    // POSITIVE CONTROL: the corpus really does contain the scheduling vocabulary that IS here, so
    // a token absent below is absent from the TREE, not absent because the scan read nothing.
    expect(
      code.filter((f) => f.lines.some((l) => l.includes("ctx.scheduler"))).length,
    ).toBeGreaterThan(5);
    expect(code.find((f) => f.file.endsWith("crons.ts"))?.lines.join("\n")).toContain("cronJobs");

    // The claim. Each token is an identifier a self-arming routine needs. Matched
    // CASE-INSENSITIVELY, so `RoutineRun` cannot slip past a scan written for `routineRun`.
    // `nextOccurrence` and `occurrenceKey` are the spike's exports in packages/core — nothing in
    // the backend may name them.
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
      const needle = token.toLowerCase();
      const hits = code.flatMap(({ file, lines }) =>
        lines
          .map((text, n) => ({ file, at: `${file}:${n + 1}`, text: text.trim() }))
          .filter(({ text }) => text.toLowerCase().includes(needle))
          .filter(({ file: f, text }) => ALLOWED.get(f) !== text)
          .map(({ at }) => at),
      );
      expect(hits, `${token} appears in backend source`).toEqual([]);
    }
  });
});

describe("no scheduling DEPENDENCY", () => {
  test("no manifest names one of the NAMED schedulers — and the scan covers the lockfile", () => {
    // Reuses the gate's own rule rather than re-implementing it (ponytail rung 2). The rule is
    // observed FIRING, package by package, in routineDecision.test.ts.
    //
    // THE SET IS CLOSED AND NAMED, and this describe used to overclaim: round 2's rule was
    // `/temporal/i` alone, so `rrule`, `cron-parser`, `node-cron`, `croner`, `bullmq` and
    // `@js-joda` all read green under a heading that said "no scheduling DEPENDENCY". It is
    // `SCHEDULING_DEPENDENCY_RE` now; `agenda` is deliberately outside it (see the gate).
    expect(SCHEDULING_DEPENDENCY_RE.source).toContain("rrule");
    expect(SCHEDULING_DEPENDENCY_RE.source).toContain("cron-parser");
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
