import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(new URL("./check-planning.mjs", import.meta.url));
test("partial summaries remain open and cannot justify a Complete roadmap row", () => {
  const scratch = mkdtempSync(join(tmpdir(), "pikar-planning-test-"));
  try {
    const phase = join(scratch, ".planning", "phases", "30-vertical");
    mkdirSync(phase, { recursive: true });
    writeFileSync(join(scratch, ".planning", "STATE.md"), "---\nstatus: in_progress\n---\n");
    writeFileSync(join(phase, "30-01-PLAN.md"), "# Plan\n");
    const summary = (status) =>
      writeFileSync(join(phase, "30-01-SUMMARY.md"), `---\nstatus: ${status}\n---\n`);
    const check = (status) => {
      writeFileSync(
        join(scratch, ".planning", "ROADMAP.md"),
        `### Phase 30: Vertical\n| 30. Vertical | 0/1 | ${status} | - |\n`,
      );
      return spawnSync(process.execPath, [script, scratch, "--exit-code"], {
        input: "{}",
        encoding: "utf8",
      });
    };
    for (const status of ["partial", "blocked", "draft", "in_progress"]) {
      summary(status);
      assert.equal(check("Partial").status, 0, status);
      const falseClosure = check("Complete");
      assert.equal(falseClosure.status, 1, status);
      assert.match(falseClosure.stdout, /no completed SUMMARY/);
    }
    summary("complete");
    assert.equal(check("Complete").status, 0);
    assert.equal(check("Not started").status, 1);
    writeFileSync(join(phase, "30-01-SUMMARY.md"), "# Legacy completed summary\n");
    assert.equal(check("Complete").status, 0);
  } finally {
    // Only the exact freshly-created unique scratch directory is removed.
    rmSync(scratch, { recursive: true, force: true });
  }
});
