import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { hasPassingPackEvalEvidence, PACK_EVAL_RUNNER, PACK_EVAL_SUITE } from "../skill";

// 27-08 Task 3 (PACK-03). `PACK_EVAL_SUITE` is what the pack activation gate compares a piece of
// eval evidence against, and it lives in this pure package for the reason `AGENT_EVAL_SUITE` does:
// the activation mutation runs inside Convex and has no filesystem, so the fact it checks has to be
// a compiled constant.
//
// A compiled constant describing files on disk is a CLAIM, though — and this file is what makes it
// a fact. Without it, editing a fixture would silently leave every already-recorded evidence row
// gating an activation against a corpus that no longer exists.

const FIXTURE_DIR = new URL("../../../backend/scripts/workflow-pack-fixtures/", import.meta.url);
/** LF-normalized, exactly like the adapted-body hashes: the root `.gitattributes` sets `* text=auto`. */
const lf = (s: string) => s.replace(/\r\n/g, "\n");

const PACK_NAMES = Object.keys(PACK_EVAL_SUITE.packs) as (keyof typeof PACK_EVAL_SUITE.packs)[];

describe("the pack eval suite identity matches the fixtures on disk", () => {
  test("every declared casesHash and caseCount is the file's own", () => {
    // Non-vacuity floor: an empty or shrunken suite must fail loudly rather than pass by having
    // nothing to compare.
    expect(PACK_NAMES).toHaveLength(6);

    for (const name of PACK_NAMES) {
      const declared = PACK_EVAL_SUITE.packs[name];
      const raw = lf(
        readFileSync(new URL(`${name.replace(/^pack-/, "")}.json`, FIXTURE_DIR), "utf8"),
      );
      expect(createHash("sha256").update(raw).digest("hex"), `${name} casesHash`).toBe(
        declared.casesHash,
      );
      expect((JSON.parse(raw) as unknown[]).length, `${name} caseCount`).toBe(declared.caseCount);
    }
  });
});

describe("pack eval evidence fails closed on everything the gate cares about", () => {
  const NAME = "pack-brand-review";
  const SUITE = PACK_EVAL_SUITE.packs[NAME];

  const evidence = (over: Record<string, unknown> = {}) =>
    JSON.stringify({
      runner: PACK_EVAL_RUNNER,
      runId: "r1",
      pass: true,
      casesPassed: SUITE.caseCount,
      casesTotal: SUITE.caseCount,
      retriedCases: [],
      costUsd: 0.09,
      model: "openai/gpt-4o-mini",
      skillVersions: { [NAME]: 1 },
      suite: { revision: PACK_EVAL_SUITE.revision, ...SUITE },
      ts: 1,
      ...over,
    });

  test("a complete, exactly-pinned pack evidence row passes", () => {
    expect(hasPassingPackEvalEvidence(evidence(), NAME, 1)).toBe(true);
  });

  // Each of these is a real row someone has to be stopped from activating on. The `eval:golden`
  // case is the one the plan named: a global-scope blob carries no suite identity, so before this
  // predicate existed a golden-suite row certified a pack it never executed.
  test.each([
    ["absent", undefined],
    ["unparseable", "{not json"],
    ["written by the golden runner", evidence({ runner: "eval:golden" })],
    [
      "from a retired suite revision",
      evidence({ suite: { revision: "2020-01-01.old", ...SUITE } }),
    ],
    [
      "from a rewritten fixture file",
      evidence({
        suite: { revision: PACK_EVAL_SUITE.revision, ...SUITE, casesHash: "0".repeat(64) },
      }),
    ],
    [
      "carrying no suite identity at all",
      JSON.stringify({
        runner: PACK_EVAL_RUNNER,
        runId: "r1",
        pass: true,
        casesPassed: SUITE.caseCount,
        casesTotal: SUITE.caseCount,
        retriedCases: [],
        costUsd: 0.09,
        model: "openai/gpt-4o-mini",
        skillVersions: { [NAME]: 1 },
        ts: 1,
      }),
    ],
    ["a FILTERED partial run", evidence({ casesPassed: 2, casesTotal: 2 })],
    ["a run that did not pass", evidence({ pass: false })],
    ["pinned to another version", evidence({ skillVersions: { [NAME]: 2 } })],
  ])("evidence %s is refused", (_label, blob) => {
    expect(hasPassingPackEvalEvidence(blob as string | undefined, NAME, 1)).toBe(false);
  });

  // A name with no suite entry has no corpus to be certified against, so it can never pass this
  // predicate — including a gated non-pack skill whose ordinary evidence is perfectly valid.
  test("a non-pack name is refused even with otherwise-valid evidence", () => {
    expect(
      hasPassingPackEvalEvidence(
        JSON.stringify({
          runner: PACK_EVAL_RUNNER,
          runId: "r1",
          pass: true,
          casesPassed: 5,
          casesTotal: 5,
          retriedCases: [],
          costUsd: 0.09,
          model: "openai/gpt-4o-mini",
          skillVersions: { "cockpit-agent": 1 },
          suite: { revision: PACK_EVAL_SUITE.revision, ...SUITE },
          ts: 1,
        }),
        "cockpit-agent",
        1,
      ),
    ).toBe(false);
  });
});
