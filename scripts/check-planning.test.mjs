import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(new URL("./check-planning.mjs", import.meta.url));
const scratches = new Set();

const scratchRepo = () => {
  const scratch = mkdtempSync(join(tmpdir(), "pikar-planning-test-"));
  scratches.add(scratch);
  mkdirSync(join(scratch, ".planning", "phases"), { recursive: true });
  writeFileSync(join(scratch, ".planning", "STATE.md"), "---\nstatus: in_progress\n---\n");
  writeFileSync(
    join(scratch, ".planning", "REQUIREMENTS.md"),
    "# Requirements\n\n## Traceability\n",
  );
  const seed = join(scratch, ".planning", "phases", "01-fixture");
  mkdirSync(seed, { recursive: true });
  writePlan(seed, "01-01");
  return scratch;
};

const phaseDir = (scratch, phase = "30", slug = "vertical") => {
  const dir = join(scratch, ".planning", "phases", `${phase}-${slug}`);
  mkdirSync(dir, { recursive: true });
  return dir;
};

const writeRoadmap = (scratch, { phase = "30", progress = "0/1", status = "In progress" } = {}) =>
  writeFileSync(
    join(scratch, ".planning", "ROADMAP.md"),
    `### Phase ${phase}: Vertical\n**Current execution pointer:** Phase ${phase} — Vertical\n| Phase | Plans Complete | Status | Completed |\n|---|---|---|---|\n| ${phase}. Vertical | ${progress} | ${status} | - |\n`,
  );

const writePlan = (dir, id = "30-01") => writeFileSync(join(dir, `${id}-PLAN.md`), "# Plan\n");
const writeSummary = (dir, id = "30-01", frontmatter = "status: complete") =>
  writeFileSync(join(dir, `${id}-SUMMARY.md`), `---\n${frontmatter}\n---\n# Summary\n`);
const runCheck = (scratch, input = {}) =>
  spawnSync(process.execPath, [script, scratch, "--exit-code"], {
    input: JSON.stringify(input),
    encoding: "utf8",
  });
const expectPass = (scratch) => {
  const result = runCheck(scratch);
  assert.equal(result.status, 0, result.stdout || result.stderr);
  assert.equal(JSON.parse(result.stdout).status, "passed", result.stdout);
};
const expectFail = (scratch, diagnostic) => {
  const result = runCheck(scratch);
  assert.equal(result.status, 1, `checker unexpectedly passed; expected: ${diagnostic}`);
  const output = JSON.parse(result.stdout);
  assert.equal(output.status, "failed", result.stdout);
  assert.ok(
    output.reason.includes(diagnostic),
    `missing diagnostic ${JSON.stringify(diagnostic)} in:\n${output.reason}`,
  );
};

test("strict qualification distinguishes unavailable roots, Git, and planning inputs", () => {
  const scratch = scratchRepo();
  const missingRoot = spawnSync(
    process.execPath,
    [script, join(scratch, "missing"), "--exit-code"],
    {
      input: "{}",
      encoding: "utf8",
    },
  );
  assert.equal(missingRoot.status, 1);
  assert.match(JSON.parse(missingRoot.stdout).reason, /Planning root is unavailable/);

  const noGit = spawnSync(process.execPath, [script, "--exit-code"], {
    cwd: scratch,
    input: "{}",
    encoding: "utf8",
  });
  assert.equal(noGit.status, 1);
  assert.match(JSON.parse(noGit.stdout).reason, /Git root discovery is unavailable/);

  const skipped = spawnSync(process.execPath, [script], {
    cwd: scratch,
    input: "{}",
    encoding: "utf8",
  });
  assert.equal(skipped.status, 0);
  assert.equal(JSON.parse(skipped.stdout).status, "skipped");

  writeRoadmap(scratch);
  const requirementsPath = join(scratch, ".planning", "REQUIREMENTS.md");
  const original = readFileSync(requirementsPath, "utf8");
  rmSync(requirementsPath);
  const missingInput = runCheck(scratch);
  assert.equal(missingInput.status, 1);
  assert.match(JSON.parse(missingInput.stdout).reason, /REQUIREMENTS\.md/);
  writeFileSync(requirementsPath, original);
});

test.after(() => {
  for (const scratch of scratches) rmSync(scratch, { recursive: true, force: true });
});

test("STATE keeps exactly one frontmatter block", () => {
  const scratch = scratchRepo();
  writeRoadmap(scratch, { progress: "0/0", status: "Not started" });
  expectPass(scratch);
  writeFileSync(
    join(scratch, ".planning", "STATE.md"),
    "---\nstatus: stale\n---\n---\nstatus: in_progress\n---\n",
  );
  expectFail(scratch, "STATE.md has 2 frontmatter blocks; exactly one is allowed.");

  const strictHook = runCheck(scratch, { stop_hook_active: true });
  assert.equal(strictHook.status, 1);
  assert.equal(JSON.parse(strictHook.stdout).status, "failed");
  const hook = spawnSync(process.execPath, [script, scratch], {
    input: JSON.stringify({ stop_hook_active: true }),
    encoding: "utf8",
  });
  assert.equal(hook.status, 0);
  assert.match(JSON.parse(hook.stdout).systemMessage, /still failing/);
});

test("open requirement traceability still blocks an unsupported Complete phase", () => {
  const scratch = scratchRepo();
  const dir = phaseDir(scratch);
  writePlan(dir);
  writeSummary(dir);
  writeRoadmap(scratch, { progress: "1/1", status: "Complete" });
  writeFileSync(
    join(scratch, ".planning", "REQUIREMENTS.md"),
    "- [ ] **TEST-01**: Test requirement\n\n## Traceability\n| Requirement | Phase | Status |\n|---|---|---|\n| TEST-01 | Phase 30 | Pending |\n",
  );
  expectFail(
    scratch,
    'Closure rule: Phase 30 reads Complete but TEST-01 is "Pending" in REQUIREMENTS traceability',
  );
  writeFileSync(
    join(scratch, ".planning", "REQUIREMENTS.md"),
    "- [ ] **TEST-01**: Test requirement *(open: live evidence required)*\n\n## Traceability\n| Requirement | Phase | Status |\n|---|---|---|\n| TEST-01 | Phase 30 | Pending |\n",
  );
  expectPass(scratch);
});

test("only an exact canonical summary can satisfy a plan or increase completion", () => {
  for (const auxiliary of [
    "30-01-FIX-SUMMARY.md",
    "30-TAIL-SUMMARY.md",
    "30-01-NOTES-SUMMARY.md",
  ]) {
    const scratch = scratchRepo();
    const dir = phaseDir(scratch);
    writePlan(dir);
    writeFileSync(join(dir, auxiliary), "---\nstatus: complete\n---\n");
    writeRoadmap(scratch);
    expectPass(scratch);
    writeRoadmap(scratch, { progress: "1/1", status: "Complete" });
    expectFail(scratch, "ROADMAP: row 30 reports 1/1 but canonical completion is 0/1.");
  }

  const scratch = scratchRepo();
  const dir = phaseDir(scratch);
  writePlan(dir);
  writeSummary(dir);
  writeRoadmap(scratch, { progress: "1/1", status: "Complete" });
  expectPass(scratch);
});

test("every explicit open summary status stays out of completion", () => {
  for (const status of [
    "partial",
    "in_progress",
    "blocked",
    "draft",
    "human_needed",
    "gaps_found",
    "awaiting_live_seed",
    "awaiting_live_evidence",
    "defer",
  ]) {
    const scratch = scratchRepo();
    const dir = phaseDir(scratch);
    writePlan(dir);
    writeSummary(dir, "30-01", `status: ${status}`);
    writeRoadmap(scratch);
    expectPass(scratch);
    writeRoadmap(scratch, { progress: "0/1", status: "Complete" });
    expectFail(
      scratch,
      `ROADMAP: row 30 reads Complete but 30-01 has open SUMMARY status "${status}".`,
    );
  }
});

test("legacy summaries count only when they carry no explicit open evidence", () => {
  const scratch = scratchRepo();
  const dir = phaseDir(scratch);
  writePlan(dir);
  writeFileSync(join(dir, "30-01-SUMMARY.md"), "# Legacy completed summary\n");
  writeRoadmap(scratch, { progress: "1/1", status: "Complete" });
  expectPass(scratch);
  writeFileSync(
    join(dir, "30-01-SUMMARY.md"),
    "# Legacy summary\n\nStatus: awaiting live evidence\n",
  );
  writeRoadmap(scratch, { progress: "0/1", status: "In progress" });
  expectPass(scratch);
  writeRoadmap(scratch, { progress: "0/1", status: "Complete" });
  expectFail(scratch, "ROADMAP: row 30 reads Complete but 30-01 has explicit open evidence");
});

test("explicit body evidence overrides nominal complete frontmatter", () => {
  const scratch = scratchRepo();
  const dir = phaseDir(scratch);
  writePlan(dir);
  writeFileSync(
    join(dir, "30-01-SUMMARY.md"),
    "---\nstatus: complete\n---\n\n**Evidence status:** awaiting_live_evidence\n",
  );
  writeRoadmap(scratch, { progress: "0/1", status: "In progress" });
  expectPass(scratch);
  writeRoadmap(scratch, { progress: "0/1", status: "Complete" });
  expectFail(
    scratch,
    'ROADMAP: row 30 reads Complete but 30-01 has explicit open evidence "awaiting_live_evidence".',
  );
});

test("superseded is a named final disposition, never completion", () => {
  const scratch = scratchRepo();
  const dir = phaseDir(scratch);
  writePlan(dir);
  writeSummary(dir, "30-01", "status: superseded");
  writeRoadmap(scratch, { progress: "0/1", status: "Superseded" });
  expectFail(scratch, "SUMMARY 30-01 is superseded but names no successor");

  writeSummary(dir, "30-01", "status: superseded\nsuperseded_by: 31-01");
  expectPass(scratch);
  writeRoadmap(scratch, { progress: "0/1", status: "Complete" });
  expectFail(
    scratch,
    "ROADMAP: row 30 reads Complete but 30-01 is superseded by 31-01, not completed.",
  );
  writeRoadmap(scratch, { progress: "1/1", status: "Superseded" });
  expectFail(scratch, "ROADMAP: row 30 reports 1/1 but canonical completion is 0/1.");
});

test("present verification evidence can veto Complete but missing historical verification is not invented", () => {
  const scratch = scratchRepo();
  const dir = phaseDir(scratch);
  writePlan(dir);
  writeSummary(dir);
  writeRoadmap(scratch, { progress: "1/1", status: "Complete" });
  expectPass(scratch);
  writeFileSync(join(dir, "30-VERIFICATION.md"), "---\nstatus: gaps_found\n---\n");
  expectFail(
    scratch,
    'ROADMAP: row 30 reads Complete but 30-VERIFICATION.md status is "gaps_found".',
  );
  writeRoadmap(scratch, { progress: "1/1", status: "Partial — verification open" });
  expectPass(scratch);
  writeRoadmap(scratch, { progress: "0/1", status: "Partial — verification open" });
  expectFail(scratch, "ROADMAP: row 30 reports 0/1 but canonical completion is 1/1.");
  writeRoadmap(scratch, { progress: "1/1", status: "Complete" });
  writeFileSync(join(dir, "30-VERIFICATION.md"), "---\nstatus: passed\n---\n");
  expectPass(scratch);
  writeFileSync(join(dir, "30-VERIFICATION.md"), "---\nstatus: verified\n---\n");
  expectPass(scratch);
});

test("roadmap counts use completed-only canonical numerator and canonical plan total", () => {
  const scratch = scratchRepo();
  const dir = phaseDir(scratch);
  writePlan(dir, "30-01");
  writePlan(dir, "30-02");
  writeSummary(dir, "30-01", "status: complete");
  writeSummary(dir, "30-02", "status: superseded\nsuperseded_by: 31-01");
  writeRoadmap(scratch, { progress: "1/2", status: "Superseded" });
  expectPass(scratch);
  writeRoadmap(scratch, { progress: "2/2", status: "Superseded" });
  expectFail(scratch, "ROADMAP: row 30 reports 2/2 but canonical completion is 1/2.");
});

test("STATE, ROADMAP, and GSD routing agree on the active phase", () => {
  const scratch = scratchRepo();
  writeFileSync(
    join(scratch, ".planning", "STATE.md"),
    "---\ncurrent_phase: 37.1\nstatus: in_progress\n---\n",
  );
  writeRoadmap(scratch, { phase: "37.1", progress: "0/0", status: "In progress" });
  writeFileSync(
    join(scratch, ".planning", "GSD-ROUTING.json"),
    JSON.stringify({ active: { phase: "37.1" } }),
  );
  expectPass(scratch);

  writeFileSync(
    join(scratch, ".planning", "GSD-ROUTING.json"),
    JSON.stringify({ active: { phase: "23" } }),
  );
  expectFail(scratch, "Planning route disagreement: STATE=37.1, ROADMAP=37.1, GSD-ROUTING=23.");
  writeFileSync(
    join(scratch, ".planning", "GSD-ROUTING.json"),
    JSON.stringify({ active: { phase: "37.1" } }),
  );
  writeRoadmap(scratch, { phase: "23", progress: "0/0", status: "In progress" });
  expectFail(scratch, "Planning route disagreement: STATE=37.1, ROADMAP=23, GSD-ROUTING=37.1.");
});

test("SITE/LAND/SHOP definitions have one traceability owner in an existing roadmap phase", () => {
  const scratch = scratchRepo();
  writeRoadmap(scratch, { phase: "48", progress: "0/0", status: "Not planned" });
  const requirements = (rows) =>
    writeFileSync(
      join(scratch, ".planning", "REQUIREMENTS.md"),
      `- [ ] **SITE-01**: Structured site\n\n## Traceability\n| Requirement | Phase | Status |\n|---|---|---|\n${rows}`,
    );
  requirements("| SITE-01 | Phase 48 | Pending |\n");
  expectPass(scratch);
  requirements("| SITE-01 | Phase 48 | Pending |\n| SITE-01 | Phase 48 | Pending |\n");
  expectFail(scratch, "REQUIREMENTS: SITE-01 has 2 traceability owners; exactly one is required.");
  requirements("| SITE-01 | Phase 99 | Pending |\n");
  expectFail(scratch, "REQUIREMENTS: SITE-01 names missing ROADMAP Phase 99.");
  requirements("| SITE-02 | Phase 48 | Pending |\n");
  expectFail(scratch, "REQUIREMENTS: SITE-01 has 0 traceability owners; exactly one is required.");
});
