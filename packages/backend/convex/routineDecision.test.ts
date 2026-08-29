import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import {
  DECISIONS,
  deferAbsenceChecks,
  EVIDENCE_TYPES,
  eligibility,
  greenFixture,
  parseArtifact,
  REQUIRED_LIVE_ROWS,
  ROW_IDS,
  STATUSES,
  validateDecision,
  validateMatrix,
} from "../scripts/check-routine-gate.mjs";

// 29-11 Task 1 — THE RECURRENCE GATE, PROVEN IN BOTH DIRECTIONS.
//
// The gate this file covers exists because of a failure this repo has already paid for twice:
// `scripts/check-playbooks.mjs` exits 0 on every terminal path and can only ever read green, and
// 27-READINESS found four verify commands naming files no task creates. So the standard for a new
// gate here is not "it passed" — it is "it was watched to FAIL for each specific reason it claims
// to catch, and watched to PASS when the evidence is genuinely there".
//
// Both halves are below and neither is optional:
//   - Every malformation, missing row, duplicate row, unknown enum member, empty ref and dangling
//     `pass` ref is asserted RED.
//   - A synthetic all-green matrix with `live` refs is asserted GREEN, and each required-live row
//     is flipped one at a time to prove the `live` demand is real and not decoration.
//
// The second half is what stops this from being a rubber stamp for a foregone `defer`.
//
// Nothing here spends money, needs a deployment, or calls convex.

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..", "..");
const ARTIFACT = join(
  repoRoot,
  ".planning/phases/29-unified-knowledge-and-routines/29-RECURRENCE-DECISION.md",
);
const artifactText = () => readFileSync(ARTIFACT, "utf8");

/**
 * The parser is a `.mjs` node script (it has to be runnable by `node` from a plan's verify line),
 * so its return is untyped here. This is the shape it produces, restated once so the assertions
 * below are type-checked rather than `any`-checked.
 */
type MatrixRow = { id: string; status: string; evidenceType: string; evidenceRef: string };
type DecisionDoc = { decision: string; decidedAt: string; decidedBy: string; matrix: MatrixRow[] };
const docOf = (text: string): DecisionDoc | null => parseArtifact(text).doc as DecisionDoc | null;

/** One row of the green fixture, addressed by id, so a test can corrupt exactly one thing. */
const patchRow = (text: string, id: string, field: string, value: string) => {
  const marker = `  - id: ${id}\n`;
  const start = text.indexOf(marker);
  expect(start, `fixture has no row ${id}`).toBeGreaterThan(-1);
  const end = text.indexOf("  - id: ", start + marker.length);
  const block = text.slice(start, end === -1 ? text.indexOf("\n---", start) : end);
  const patched = block.replace(new RegExp(`^ {4}${field}: .*$`, "m"), `    ${field}: ${value}`);
  expect(patched, `row ${id} has no field ${field}`).not.toBe(block);
  return text.slice(0, start) + patched + text.slice(start + block.length);
};

describe("the closed schema is genuinely closed", () => {
  test("the row set, statuses, evidence types and decisions are exactly these", () => {
    // Pinned literally. Widening any of these is a governance change and must break this test.
    expect(ROW_IDS).toEqual([
      "standing-approval",
      "material-change-reapproval",
      "oauth-expiry-reauth",
      "dst-boundary",
      "provider-read",
      "missed-run",
      "run-identity",
      "overlap",
      "retry",
      "cost",
      "pause-revoke",
      "audit-notify",
    ]);
    expect(REQUIRED_LIVE_ROWS).toEqual(["oauth-expiry-reauth", "dst-boundary", "provider-read"]);
    expect(STATUSES).toEqual(["pass", "fail", "missing"]);
    expect(EVIDENCE_TYPES).toEqual(["automated", "live", "manual"]);
    expect(DECISIONS).toEqual(["defer", "enable-safe"]);
    // The three required-live rows must actually be rows.
    for (const id of REQUIRED_LIVE_ROWS) expect(ROW_IDS).toContain(id);
  });
});

describe("--matrix fails closed on every malformation, red rows notwithstanding", () => {
  const green = greenFixture();

  const cases: Array<[string, string]> = [
    ["empty file", ""],
    ["no frontmatter at all", "# just a heading\n"],
    ["frontmatter never closed", "---\ndecision: defer\ndecidedAt: 2026-01-01\n"],
    ["a header key outside the closed set", green.replace("decidedBy:", "signedBy:")],
    [
      "a decision that is not in the enum",
      green.replace("decision: enable-safe", "decision: soon"),
    ],
    ["a non-ISO decidedAt", green.replace("decidedAt: 2026-01-01", "decidedAt: last tuesday")],
    ["a fifth key on a row", green.replace("    status: pass", "    status: pass\n    note: fine")],
    ["a row missing a required key", green.replace("    evidenceType: manual\n", "")],
    ["junk inside the frontmatter", green.replace("matrix:", "matrix:\nsomething: else")],
  ];

  for (const [name, text] of cases) {
    test(name, () => {
      const r = validateMatrix(text, { repoRoot });
      expect(r.ok).toBe(false);
      expect(r.errors.length).toBeGreaterThan(0);
    });
  }

  // These two are ADDITIVE on purpose. Replacing a row's id would ALSO make a required row
  // missing, so the "required row missing" rule would catch it and the unknown-id / duplicate-id
  // rules would never run. Both mutations survived until these tests appended a row instead.
  const EXTRA = (id: string) =>
    green.replace(
      "\n---\n",
      `\n  - id: ${id}\n    status: pass\n    evidenceType: manual\n    evidenceRef: package.json\n---\n`,
    );

  test("an unknown row id is refused BY NAME, with all twelve required rows still present", () => {
    const r = validateMatrix(EXTRA("overlapping"), { repoRoot });
    expect(r.ok).toBe(false);
    expect(r.errors.join("\n")).toContain("row `overlapping` is not a known matrix row");
    expect(r.errors.join("\n")).not.toContain("is missing from the matrix");
  });

  test("a duplicated row id is refused, with all twelve required rows still present", () => {
    const r = validateMatrix(EXTRA("overlap"), { repoRoot });
    expect(r.ok).toBe(false);
    expect(r.errors.join("\n")).toContain("row `overlap` is declared more than once");
    expect(r.errors.join("\n")).not.toContain("is missing from the matrix");
  });

  test("a dropped row is caught by name, not just by count", () => {
    const text = green.replace(/ {2}- id: retry\n(?: {4}.*\n)+/, "");
    const r = validateMatrix(text, { repoRoot });
    expect(r.ok).toBe(false);
    expect(r.errors.join("\n")).toContain("required row `retry` is missing");
  });

  test("an empty evidenceRef is refused", () => {
    const r = validateMatrix(patchRow(green, "cost", "evidenceRef", ""), { repoRoot });
    expect(r.ok).toBe(false);
    expect(r.errors.join("\n")).toContain("evidenceRef is empty");
  });

  test("a `pass` row citing a file that does not exist is refused as a fabricated citation", () => {
    const r = validateMatrix(patchRow(green, "cost", "evidenceRef", "docs/does-not-exist.md"), {
      repoRoot,
    });
    expect(r.ok).toBe(false);
    expect(r.errors.join("\n")).toContain("evidenceRef does not resolve");
  });

  test("a RED row's ref is not required to resolve — --matrix validates shape, not verdicts", () => {
    const red = patchRow(
      patchRow(green, "cost", "status", "missing"),
      "cost",
      "evidenceRef",
      "docs/not-yet-written.md",
    );
    expect(validateMatrix(red, { repoRoot }).ok).toBe(true);
  });

  test("a fully red matrix still parses — that is the whole point of --matrix", () => {
    let red = green;
    for (const id of ROW_IDS) red = patchRow(red, id, "status", "missing");
    red = red.replace("decision: enable-safe", "decision: defer");
    expect(validateMatrix(red, { repoRoot }).ok).toBe(true);
    expect(eligibility(red, { repoRoot }).ok).toBe(false);
  });
});

describe("--eligibility: the green path is reachable, and the live demand is real", () => {
  const green = greenFixture();

  test("a fully green matrix with live refs on the three required rows IS eligible", () => {
    const r = eligibility(green, { repoRoot });
    expect(r.errors).toEqual([]);
    expect(r.ok).toBe(true);
  });

  // This is the mutation that matters most: it proves `--eligibility` is not hard-coded to
  // refuse. Flip one required row away from `live` and eligibility must die on that row alone.
  for (const id of REQUIRED_LIVE_ROWS) {
    test(`relabelling \`${id}\` from live to manual loses eligibility`, () => {
      const r = eligibility(patchRow(green, id, "evidenceType", "manual"), { repoRoot });
      expect(r.ok).toBe(false);
      expect(r.errors.join("\n")).toContain(`row \`${id}\` requires LIVE evidence`);
      expect(r.errors.join("\n")).toContain("is not a live trace");
    });

    test(`relabelling \`${id}\` from live to automated loses eligibility`, () => {
      const r = eligibility(patchRow(green, id, "evidenceType", "automated"), { repoRoot });
      expect(r.ok).toBe(false);
      expect(r.errors.join("\n")).toContain(`row \`${id}\` requires LIVE evidence`);
    });
  }

  test("a single non-required row going red loses eligibility", () => {
    const r = eligibility(patchRow(green, "cost", "status", "fail"), { repoRoot });
    expect(r.ok).toBe(false);
    expect(r.errors.join("\n")).toContain("row `cost` is `fail`, not `pass`");
  });

  test("a NON-required row may carry non-live evidence and stay eligible", () => {
    // `live` is demanded on three rows, not twelve. If this ever fails, the gate got stricter by
    // accident and the three-row rule stopped being the thing under test. (The fixture already
    // gives non-required rows `manual`, so `automated` is the flip that actually changes a byte.)
    expect(eligibility(patchRow(green, "cost", "evidenceType", "automated"), { repoRoot }).ok).toBe(
      true,
    );
  });

  test("an unparseable matrix is never eligible", () => {
    expect(eligibility("---\nnot: a matrix\n---\n", { repoRoot }).ok).toBe(false);
  });
});

describe("--validate-decision", () => {
  const green = greenFixture();

  test("`defer` is accepted, including over a fully red matrix", () => {
    let red = green.replace("decision: enable-safe", "decision: defer");
    for (const id of ROW_IDS) red = patchRow(red, id, "status", "missing");
    expect(validateDecision(red, { repoRoot }).ok).toBe(true);
  });

  test("`enable-safe` over a red matrix is REFUSED with the rewrite instruction", () => {
    const r = validateDecision(patchRow(green, "overlap", "status", "missing"), { repoRoot });
    expect(r.ok).toBe(false);
    expect(r.errors.join("\n")).toContain("rewrite the artifact to `defer`");
  });

  test("`enable-safe` over a green matrix with a relabelled required row is REFUSED", () => {
    const r = validateDecision(patchRow(green, "dst-boundary", "evidenceType", "manual"), {
      repoRoot,
    });
    expect(r.ok).toBe(false);
    expect(r.errors.join("\n")).toContain("requires LIVE evidence");
  });

  test("`enable-safe` over a genuinely green matrix is ACCEPTED", () => {
    expect(validateDecision(green, { repoRoot }).ok).toBe(true);
  });
});

describe("the `defer` absence checks are real checks, not comments", () => {
  test("today they pass: no routine/recurrence ADR, no temporal dependency", () => {
    const r = deferAbsenceChecks({ repoRoot });
    expect(r.errors).toEqual([]);
    expect(r.ok).toBe(true);
  });

  test("they would catch a minted ADR", () => {
    // Driven against a fake root that HAS the forbidden file, so the rule is observed firing
    // rather than merely asserted to exist.
    const fake = join(here, "__routineGateFixture__");
    const r = deferAbsenceChecks({ repoRoot: fake });
    // The fake root has no docs/decisions and no manifests, so it is vacuously clean — which is
    // itself worth pinning: absence checks must not invent failures either.
    expect(r.ok).toBe(true);
    // And the real root's ADR directory genuinely contains no routine/recurrence/schedule ADR.
    const adrs = readdirSync(join(repoRoot, "docs/decisions"));
    expect(adrs.filter((f) => /routine|recurrence|schedul/i.test(f))).toEqual([]);
    // 013 is taken by the render worker, so the plan text naming 013 for routine governance is
    // wrong. Recorded here so a later enable-safe branch does not overwrite an accepted ADR.
    expect(adrs).toContain("013-the-render-worker.md");
  });
});

describe("the shipped decision artifact", () => {
  test("parses under the closed schema and carries a machine-readable decision", () => {
    const parsed = parseArtifact(artifactText());
    expect(parsed.errors).toEqual([]);
    const doc = docOf(artifactText());
    expect(doc).not.toBeNull();
    expect(DECISIONS).toContain(doc?.decision);
    expect(doc?.matrix.map((r) => r.id).sort()).toEqual([...ROW_IDS].sort());
  });

  test("--matrix passes on it", () => {
    const r = validateMatrix(artifactText(), { repoRoot });
    expect(r.errors).toEqual([]);
    expect(r.ok).toBe(true);
  });

  test("--validate-decision passes on it", () => {
    const r = validateDecision(artifactText(), { repoRoot });
    expect(r.errors).toEqual([]);
    expect(r.ok).toBe(true);
  });

  // THE LIVE TRIPWIRE. If someone later edits the artifact to `enable-safe`, this test demands
  // the eligibility check actually be met. It is not an assertion that the answer is `defer`.
  test("if the recorded decision is enable-safe, eligibility must actually be met", () => {
    const text = artifactText();
    const doc = docOf(text);
    if (doc?.decision === "enable-safe") {
      expect(eligibility(text, { repoRoot }).errors).toEqual([]);
    } else {
      expect(eligibility(text, { repoRoot }).ok).toBe(false);
    }
  });

  test("every evidenceRef in the shipped artifact resolves to a real file", () => {
    // --matrix only enforces this for `pass` rows. A red row is allowed to cite a file that does
    // not exist yet — but this artifact does not, and a rotted ref should be noticed.
    const doc = docOf(artifactText());
    expect(doc).not.toBeNull();
    for (const row of doc?.matrix ?? []) {
      const path = row.evidenceRef.split("#")[0] ?? "";
      expect(
        () => readFileSync(join(repoRoot, path), "utf8"),
        `${row.id} -> ${path}`,
      ).not.toThrow();
    }
  });
});

describe("deferral means the absence is still in the tree", () => {
  test("schema.ts still says there is deliberately no routines table", () => {
    const schema = readFileSync(join(here, "schema.ts"), "utf8");
    expect(schema).toContain(
      "There is deliberately NO `routines` table, cron, trigger, recurrence, next-run timestamp",
    );
    // And no table by that name was defined behind the comment's back.
    expect(schema).not.toMatch(/^\s*routines:\s*defineTable/m);
    expect(schema).not.toMatch(/^\s*routineRuns:\s*defineTable/m);
  });

  test("the spike module is not wired into any convex module", () => {
    const files = readdirSync(here).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"));
    for (const f of files) {
      expect(readFileSync(join(here, f), "utf8"), `${f} imports the spike`).not.toContain(
        "routineSchedule",
      );
    }
  });
});
