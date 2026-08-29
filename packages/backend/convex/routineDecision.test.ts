import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, test } from "vitest";
import {
  DECIDERS,
  DECISIONS,
  DEPENDENCY_MANIFESTS,
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

// 29-11 — THE RECURRENCE GATE, PROVEN IN BOTH DIRECTIONS, INCLUDING ITS PLUMBING.
//
// The gate this file covers exists because of a failure this repo has already paid for twice:
// `scripts/check-playbooks.mjs` exits 0 on every terminal path and can only ever read green, and
// 27-READINESS found four verify commands naming files no task creates. So the standard for a new
// gate here is not "it passed" — it is "it was watched to FAIL for each specific reason it claims
// to catch, and watched to PASS when the evidence is genuinely there".
//
// ROUND 1 OF THIS FILE MET THAT STANDARD FOR THE TWELVE RULES AND NOT AT ALL FOR THE PLUMBING.
// Three independent verifiers found the same three holes, and every one of them is a section
// below:
//   1. The anti-fabrication citation check was defeated by the single character `#`, so a fully
//      fabricated `enable-safe` passed all three modes. No test drove an anchor-only, directory,
//      escaping or shared ref. -> "a `pass` row's citation".
//   2. Every exit code the script advertises was unasserted — `main()` was never invoked — and
//      29-12 chains this script with `&&`. -> "the exit codes, read from a spawned process".
//   3. `deferAbsenceChecks` could be replaced by `return { ok: true }` with a green suite, and the
//      test named "they would catch a minted ADR" drove a root with no ADR directory at all and
//      asserted `ok === true`. -> "the `defer` absence checks, observed FIRING".
//
// Nothing here spends money, needs a deployment, or calls convex.

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..", "..");
const SCRIPT = join(repoRoot, "packages/backend/scripts/check-routine-gate.mjs");
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

/** Scratch roots for the absence checks and the spawned-CLI cases. Removed in afterAll. */
const scratch: string[] = [];
const newRoot = () => {
  const dir = mkdtempSync(join(tmpdir(), "routine-gate-"));
  scratch.push(dir);
  return dir;
};
afterAll(() => {
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
});

describe("the closed schema is genuinely closed", () => {
  test("the row set, statuses, evidence types, decisions and DECIDERS are exactly these", () => {
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
    expect(DECIDERS).toEqual(["owner", "agent", "fixture"]);
    // The lockfile and apps/web are in the dependency scan, not just the three round-1 manifests.
    expect(DEPENDENCY_MANIFESTS).toEqual([
      "package.json",
      "packages/core/package.json",
      "packages/backend/package.json",
      "apps/web/package.json",
      "pnpm-lock.yaml",
    ]);
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
      `\n  - id: ${id}\n    status: pass\n    evidenceType: manual\n    evidenceRef: package.json#extra\n---\n`,
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

describe("a `pass` row's citation — the check round 1 claimed and did not have", () => {
  const green = greenFixture();

  // Round 1 resolved a pass ref as `existsSync(resolve(repoRoot, ref.split("#")[0]))`. Each row
  // below is a ref shape that check accepted. With every row set to one of them, a fully
  // fabricated twelve-green `enable-safe` matrix passed --matrix, --eligibility AND
  // --validate-decision. Every one is a named error now.
  const fabrications: Array<[string, string, string]> = [
    [
      "an anchor-only ref strips to the repo ROOT and used to pass",
      "#see-the-summary",
      "names no file",
    ],
    ["a bare `#`", "#", "names no file"],
    ["a directory", "docs", "resolves to a directory"],
    ["the repo root itself", ".", "resolves to a directory"],
    ["a path escaping the repository", "../../../etc/hosts", "escapes the repository root"],
    ["a file that is simply not there", "docs/does-not-exist.md", "does not resolve to a file"],
  ];

  for (const [name, ref, reason] of fabrications) {
    test(`${name} is refused, by reason`, () => {
      const r = validateMatrix(patchRow(green, "cost", "evidenceRef", ref), { repoRoot });
      expect(r.ok).toBe(false);
      expect(r.errors.join("\n")).toContain(reason);
    });
  }

  test("a pass ref resolving to an EMPTY file is refused", () => {
    const root = newRoot();
    writeFileSync(join(root, "empty.md"), "");
    writeFileSync(join(root, "real.md"), "content");
    // Positive control in the same test: the non-empty sibling in the same root IS accepted, so
    // the refusal below is about emptiness and not about the scratch root being unreadable.
    expect(
      validateMatrix(patchRow(green, "cost", "evidenceRef", "real.md"), {
        repoRoot: root,
      }).errors.join("\n"),
    ).not.toContain("cost");
    const r = validateMatrix(patchRow(green, "cost", "evidenceRef", "empty.md"), {
      repoRoot: root,
    });
    expect(r.ok).toBe(false);
    expect(r.errors.join("\n")).toContain("resolves to an EMPTY file");
  });

  test("two `pass` rows may not cite the SAME evidence", () => {
    const shared = patchRow(green, "cost", "evidenceRef", "package.json#overlap");
    const r = validateMatrix(shared, { repoRoot });
    expect(r.ok).toBe(false);
    expect(r.errors.join("\n")).toContain("cites the SAME evidence as row `overlap`");
  });

  test("twelve pass/live rows citing ONE real file — the whole fabricated matrix — is refused", () => {
    const fabricated = green
      .replace(/evidenceRef: package\.json#[a-z-]+/g, "evidenceRef: package.json")
      .replace(/evidenceType: manual/g, "evidenceType: live");
    expect(validateMatrix(fabricated, { repoRoot }).ok).toBe(false);
    expect(eligibility(fabricated, { repoRoot }).ok).toBe(false);
    const r = validateDecision(fabricated, { repoRoot });
    expect(r.ok).toBe(false);
    expect(r.errors.join("\n")).toContain("rewrite the artifact to `defer`");
  });

  test("a RED row may share a ref with anything — the rule is scoped to `pass`", () => {
    // The shipped artifact has several `missing` rows citing the same research note, and that is
    // legitimate: the rule is about green rows carrying independent evidence.
    let red = green.replace("decision: enable-safe", "decision: defer");
    for (const id of ROW_IDS) {
      red = patchRow(red, id, "status", "missing");
      red = patchRow(red, id, "evidenceRef", "package.json");
    }
    expect(validateMatrix(red, { repoRoot }).ok).toBe(true);
  });

  test("THE DOCUMENTED LIMIT: twelve DISTINCT real citations pass, whatever they say", () => {
    // This test asserts a WEAKNESS on purpose, so nobody reads the gate as more than it is. A
    // parser can check that a citation is a real, distinct, non-empty file inside the repo. It
    // cannot check that the file answers the row's question — `package.json#dst-boundary` is a
    // resolving, distinct, meaningless citation and the gate says yes.
    //
    // That is why `enable-safe` still requires the human checkpoint in §5/§7 of the decision
    // record, and why the script header states this limit instead of claiming "the parser proves
    // the evidence". The gate's job is to make fabrication COST twelve deliberate lines in a
    // reviewable diff, not to make it impossible.
    expect(validateDecision(green, { repoRoot }).ok).toBe(true);
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

describe("`decidedBy` is a closed actor set, not free text", () => {
  const green = greenFixture();

  test("`owner`, `agent` and `fixture` are accepted, with or without a qualifying clause", () => {
    for (const who of [
      "owner",
      "agent",
      "fixture",
      'agent (29-11 executor), under owner pre-ruling "let the gate decide"',
      "owner (attended the checkpoint on 2026-08-29)",
    ]) {
      const r = validateMatrix(green.replace("decidedBy: fixture", `decidedBy: ${who}`), {
        repoRoot,
      });
      expect(r.errors.join("\n"), who).not.toContain("decidedBy");
    }
  });

  test("anything else is refused by name", () => {
    for (const who of ["nobody at all", "the system", "automation", "CI"]) {
      const r = validateMatrix(green.replace("decidedBy: fixture", `decidedBy: ${who}`), {
        repoRoot,
      });
      expect(r.ok, who).toBe(false);
      expect(r.errors.join("\n")).toContain("does not begin with one of owner | agent | fixture");
    }
  });

  test("the closed set cannot stop a false claim — it makes one a deliberate, diffable line", () => {
    // Stated as a test so the limit is not read as a guarantee: `owner` on a decision no human
    // attended still parses. What the enum removes is the third option, where the field is free
    // text and nobody notices it drifted.
    expect(
      validateMatrix(green.replace("decidedBy: fixture", "decidedBy: owner"), { repoRoot }).ok,
    ).toBe(true);
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

describe("the `defer` absence checks, observed FIRING", () => {
  /** A root that has the two things the rules look at, and neither forbidden thing in them. */
  const cleanRoot = () => {
    const root = newRoot();
    mkdirSync(join(root, "docs/decisions"), { recursive: true });
    writeFileSync(join(root, "docs/decisions/026-something-else.md"), "# an unrelated ADR\n");
    writeFileSync(join(root, "package.json"), '{ "name": "x", "dependencies": {} }\n');
    return root;
  };

  test("a clean root is clean — and the rules really did look (positive control)", () => {
    const root = cleanRoot();
    expect(deferAbsenceChecks({ repoRoot: root })).toEqual({ ok: true, errors: [] });
    // The control: the SAME root with one forbidden file added goes red, so the green above is
    // a real read of a real directory, not a short-circuit on a missing path.
    writeFileSync(join(root, "docs/decisions/027-standing-routine-governance.md"), "# no\n");
    expect(deferAbsenceChecks({ repoRoot: root }).ok).toBe(false);
  });

  test("a minted routine ADR is caught, by filename, with the reason", () => {
    const root = cleanRoot();
    writeFileSync(join(root, "docs/decisions/027-standing-routine-governance.md"), "# minted\n");
    const r = deferAbsenceChecks({ repoRoot: root });
    expect(r.ok).toBe(false);
    expect(r.errors.join("\n")).toContain(
      "docs/decisions/027-standing-routine-governance.md exists — no ADR may be minted",
    );
  });

  test("`recurrence` and `schedul` in an ADR filename are caught too", () => {
    for (const name of ["030-recurrence-rules.md", "031-scheduled-preparation.md"]) {
      const root = cleanRoot();
      writeFileSync(join(root, "docs/decisions", name), "# minted\n");
      expect(deferAbsenceChecks({ repoRoot: root }).errors.join("\n")).toContain(name);
    }
  });

  test("a temporal dependency is caught in EVERY scanned manifest, including the lockfile", () => {
    // Round 1 scanned three manifests. `apps/web/package.json` and `pnpm-lock.yaml` were not
    // among them, so a dependency added under the web app, or pinned only in the lockfile, left
    // `--validate-decision` green. Each manifest is driven one at a time.
    for (const manifest of DEPENDENCY_MANIFESTS) {
      const root = cleanRoot();
      const target = join(root, manifest);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, '{ "dependencies": { "@js-temporal/polyfill": "0.5.1" } }\n');
      const r = deferAbsenceChecks({ repoRoot: root });
      expect(r.ok, manifest).toBe(false);
      expect(r.errors.join("\n")).toContain(`${manifest} names a temporal dependency`);
    }
  });

  test("`defer` over a root carrying a minted ADR is refused end to end", () => {
    // The rule is only worth having if `validateDecision` actually calls it. Round 1's
    // `deferAbsenceChecks` could be replaced with `return { ok: true }` and the suite stayed
    // green — including this path, which nothing exercised.
    const root = cleanRoot();
    writeFileSync(join(root, "docs/decisions/027-standing-routine-governance.md"), "# minted\n");
    let red = greenFixture().replace("decision: enable-safe", "decision: defer");
    for (const id of ROW_IDS) red = patchRow(red, id, "status", "missing");
    const r = validateDecision(red, { repoRoot: root });
    expect(r.ok).toBe(false);
    expect(r.errors.join("\n")).toContain("no ADR may be minted");
  });

  test("today the REAL repo root is clean", () => {
    const r = deferAbsenceChecks({ repoRoot });
    expect(r.errors).toEqual([]);
    // Positive control: the real ADR directory was read and is not empty, and 013 is taken by the
    // render worker — so a later enable-safe branch must mint 027, never overwrite 013.
    const adrs = readdirSync(join(repoRoot, "docs/decisions"));
    expect(adrs.length).toBeGreaterThan(20);
    expect(adrs).toContain("013-the-render-worker.md");
    expect(adrs.filter((f) => /routine|recurrence|schedul/i.test(f))).toEqual([]);
  });
});

describe("the exit codes, read from a SPAWNED process", () => {
  // 29-12's verify line is `node check-routine-gate.mjs ... --validate-decision && pnpm ...`, so
  // the exit code IS the contract. Round 1 never invoked `main()`: `return 1` -> `return 0` on the
  // absent-file path, `return 2` -> `return 0` on bad usage, and `if (result.ok)` -> `if (true)`
  // were all green mutations. `spawnSync().status` is the process's real code — no shell, no
  // pipe, nothing that can hand back a fake zero.
  const run = (...args: string[]) => {
    const r = spawnSync(process.execPath, [SCRIPT, ...args], { encoding: "utf8" });
    expect(r.error, `spawn failed: ${r.error?.message}`).toBeUndefined();
    return { code: r.status, out: `${r.stdout}${r.stderr}` };
  };

  /** Write an artifact into a scratch dir; refs still resolve against the REAL repo root. */
  const artifactFile = (name: string, text: string) => {
    const root = newRoot();
    const p = join(root, name);
    writeFileSync(p, text);
    return p;
  };

  const green = greenFixture();
  const deferText = (() => {
    let t = green.replace("decision: enable-safe", "decision: defer");
    for (const id of ROW_IDS) t = patchRow(t, id, "status", "missing");
    return t;
  })();

  test("--self-check exits 0 and says so", () => {
    const r = run("--self-check");
    expect(r.code).toBe(0);
    expect(r.out).toContain("cases behaved");
    // Positive control: it really ran the cases rather than printing a banner.
    expect(r.out).toContain("eligibility: a fully green fixture IS eligible");
  });

  test("bad usage exits 2: no args, a mode with no file, TWO modes, TWO files", () => {
    const artifact = artifactFile("defer.md", deferText);
    for (const args of [
      [],
      ["--matrix"],
      [artifact],
      [artifact, "--matrix", "--eligibility"],
      [artifact, artifact, "--matrix"],
    ]) {
      const r = run(...args);
      expect(r.code, args.join(" ")).toBe(2);
      expect(r.out).toContain("usage:");
    }
  });

  test("a prototype key is not a mode", () => {
    // `a in MODES` walked the prototype chain, so `constructor` read as a mode and the script
    // died with a stack trace instead of refusing.
    const artifact = artifactFile("defer.md", deferText);
    const r = run(artifact, "constructor");
    expect(r.code).toBe(2);
    expect(r.out).toContain("usage:");
  });

  test("an absent artifact exits 1, and a DIRECTORY given as the artifact exits 1", () => {
    const root = newRoot();
    expect(run(join(root, "nope.md"), "--matrix").code).toBe(1);
    expect(run(join(root, "nope.md"), "--matrix").out).toContain("does not exist");
    expect(run(root, "--matrix").code).toBe(1);
    expect(run(root, "--matrix").out).toContain("is not a file");
  });

  const badArtifacts: Array<[string, string]> = [
    ["malformed — no frontmatter", "# just prose\n"],
    ["malformed — frontmatter never closed", "---\ndecision: defer\n"],
    [
      "an unknown row id",
      green.replace(
        "\n---\n",
        "\n  - id: not-a-row\n    status: missing\n    evidenceType: manual\n    evidenceRef: package.json\n---\n",
      ),
    ],
    [
      "a duplicate row",
      green.replace(
        "\n---\n",
        "\n  - id: overlap\n    status: missing\n    evidenceType: manual\n    evidenceRef: package.json\n---\n",
      ),
    ],
    ["a missing enum member", green.replace("evidenceType: live", "evidenceType: vibes")],
    ["an empty evidenceRef", green.replace("evidenceRef: package.json#cost", "evidenceRef: ")],
    ["decidedBy outside the closed set", green.replace("decidedBy: fixture", "decidedBy: someone")],
  ];

  for (const [name, text] of badArtifacts) {
    test(`${name} exits 1 under --matrix`, () => {
      const r = run(artifactFile("bad.md", text), "--matrix");
      expect(r.code).toBe(1);
      expect(r.out).toContain("FAIL --matrix");
    });
  }

  test("a valid `defer` artifact exits 0 under --matrix and --validate-decision, 1 under --eligibility", () => {
    const p = artifactFile("defer.md", deferText);
    expect(run(p, "--matrix").code).toBe(0);
    expect(run(p, "--validate-decision").code).toBe(0);
    expect(run(p, "--validate-decision").out).toContain("OK --validate-decision (decision: defer)");
    expect(run(p, "--eligibility").code).toBe(1);
  });

  test("a FABRICATED enable-safe exits 1 in ALL THREE modes", () => {
    // The end-to-end version of the blocker: this is the artifact a verifier wrote by hand and
    // got a clean bill of health for in every mode. Anchor-only refs, twelve pass/live rows.
    const fabricated = green
      .replace(/evidenceRef: package\.json#[a-z-]+/g, "evidenceRef: #the-summary")
      .replace(/evidenceType: manual/g, "evidenceType: live");
    const p = artifactFile("fabricated.md", fabricated);
    for (const mode of ["--matrix", "--eligibility", "--validate-decision"]) {
      const r = run(p, mode);
      expect(r.code, mode).toBe(1);
      expect(r.out).toContain("names no file at all");
    }
  });

  test("a fabricated enable-safe citing ONE real file for all twelve rows exits 1 in all three", () => {
    const fabricated = green
      .replace(/evidenceRef: package\.json#[a-z-]+/g, "evidenceRef: package.json")
      .replace(/evidenceType: manual/g, "evidenceType: live");
    const p = artifactFile("fabricated2.md", fabricated);
    for (const mode of ["--matrix", "--eligibility", "--validate-decision"]) {
      const r = run(p, mode);
      expect(r.code, mode).toBe(1);
      expect(r.out).toContain("cites the SAME evidence");
    }
  });

  test("a genuinely green enable-safe exits 0 — the gate is not hard-coded to refuse", () => {
    const p = artifactFile("green.md", green);
    expect(run(p, "--eligibility").code).toBe(0);
    expect(run(p, "--validate-decision").code).toBe(0);
    expect(run(p, "--validate-decision").out).toContain("(decision: enable-safe)");
  });

  test("the SHIPPED artifact: --matrix 0, --eligibility 1, --validate-decision 0", () => {
    // §4 of the decision record publishes exactly these three results. This is the assertion
    // that they stay true, run the way a plan's verify line runs them.
    expect(run(ARTIFACT, "--matrix").code).toBe(0);
    expect(run(ARTIFACT, "--eligibility").code).toBe(1);
    expect(run(ARTIFACT, "--validate-decision").code).toBe(0);
    expect(run(ARTIFACT, "--validate-decision").out).toContain("(decision: defer)");
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

  test("it attributes the decision to the ACTOR that selected it, not to a standing ruling", () => {
    // Round 1 recorded `decidedBy: owner` for two checkpoints an agent presented and an agent
    // resolved, under a real owner pre-ruling. The pre-ruling is disclosed either way; what
    // changed is that the field now names who actually chose.
    const doc = docOf(artifactText());
    expect(doc?.decidedBy.startsWith("agent")).toBe(true);
    expect(doc?.decidedBy).toContain("owner pre-ruling");
    // And §5 says in prose that the checkpoints were auto-approved, so the attribution is not
    // only machine-readable.
    expect(artifactText()).toContain("auto-approved");
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
    expect(doc?.matrix.length).toBe(12);
    for (const row of doc?.matrix ?? []) {
      const path = row.evidenceRef.split("#")[0] ?? "";
      expect(
        () => readFileSync(join(repoRoot, path), "utf8"),
        `${row.id} -> ${path}`,
      ).not.toThrow();
    }
  });
});

describe("nothing imports the recurrence spike", () => {
  // Round 1 scanned `readdirSync(convexDir)` — the TOP LEVEL of convex/ only. `convex/lib/`
  // (functions.ts, env.ts, hash.ts, ...) and `convex/render/` were invisible, and `apps/web` and
  // the other packages were never looked at. An import added to any of them read green.
  const SPIKE = join(repoRoot, "packages/core/src/routineSchedule.ts");
  const ROOTS = [
    "packages/backend/convex",
    "packages/backend/scripts",
    "apps/web/app",
    "packages/core/src",
    "packages/contracts/src",
    "packages/cost/src",
    "packages/vault/src",
  ];

  const scanned = ROOTS.flatMap((root) => {
    const base = join(repoRoot, root);
    return readdirSync(base, { recursive: true, encoding: "utf8" })
      .filter((f) => /\.(ts|tsx|mjs)$/.test(f) && !/\.test\.(ts|tsx)$/.test(f))
      .map((f) => join(base, f))
      .filter((f) => f !== SPIKE);
  });

  test("POSITIVE CONTROL: the scan reaches the files round 1 could not see", () => {
    // If this list is ever empty, or stops containing a nested file, the scan below is vacuous
    // and would pass no matter what the tree contained.
    expect(scanned.length).toBeGreaterThan(100);
    for (const must of [
      "packages/backend/convex/lib/functions.ts", // nested — invisible to round 1
      "packages/backend/convex/render/renderReel.ts", // nested — invisible to round 1
      "packages/backend/convex/schema.ts",
      "packages/backend/scripts/check-routine-gate.mjs",
      "packages/core/src/index.ts",
    ]) {
      expect(scanned, must).toContain(join(repoRoot, must));
    }
    // And apps/web really was walked.
    expect(scanned.some((f) => f.includes(join("apps", "web", "app")))).toBe(true);
  });

  test("no non-test source file anywhere names the spike", () => {
    const importers = scanned.filter((f) => readFileSync(f, "utf8").includes("routineSchedule"));
    expect(importers.map((f) => f.slice(repoRoot.length + 1))).toEqual([]);
  });
});
