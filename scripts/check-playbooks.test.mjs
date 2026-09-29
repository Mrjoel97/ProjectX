import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const script = fileURLToPath(new URL("./check-playbooks.mjs", import.meta.url));
const scratchDirs = new Set();
const scratch = () => {
  const dir = mkdtempSync(join(tmpdir(), "pikar-playbooks-test-"));
  scratchDirs.add(dir);
  return dir;
};
const gitMock = (dir) => {
  const mockPath = join(dir, "git-mock.mjs");
  writeFileSync(
    mockPath,
    `import childProcess from "node:child_process";\nimport { createHash } from "node:crypto";\n` +
      `import fs from "node:fs";\nimport { readFileSync } from "node:fs";\nimport { resolve } from "node:path";\nimport { syncBuiltinESMExports } from "node:module";\n` +
      `const actualLstat = fs.lstatSync;\nfs.lstatSync = (path, ...args) => {\n` +
      `  if (String(path) === process.env.MOCK_FS_LSTAT_FAIL) { const error = new Error("fixture access denied"); error.code = "EACCES"; throw error; }\n` +
      `  return actualLstat(path, ...args);\n};\n` +
      `const actual = childProcess.execFileSync;\nchildProcess.execFileSync = (file, args = [], options = {}) => {\n` +
      `  if (file !== "git") return actual(file, args, options);\n` +
      `  if (args[0] === "rev-parse" && args[1] === "--show-toplevel") return process.cwd();\n` +
      `  if (args[0] === "rev-parse" && args[1] === "--git-dir") return ".git";\n` +
      `  if (args[0] === "diff" && process.env.MOCK_GIT_DIFF_FAIL === "1") throw new Error("fixture diff failed");\n` +
      `  if (args[0] === "diff" && args[1] === "--name-only" && args[2] === "--diff-filter=A") return process.env.MOCK_GIT_ADDED || "";\n` +
      `  if (args[0] === "diff" && args[1] === "--name-only" && args[2] === "HEAD") return process.env.MOCK_GIT_CHANGED || "";\n` +
      `  if (args[0] === "ls-files") return process.env.MOCK_GIT_UNTRACKED || "";\n` +
      `  if (args[0] === "cat-file" && process.env.MOCK_GIT_BASELINE_FAIL === "1") throw new Error("fixture baseline unavailable");\n` +
      `  if (args[0] === "hash-object") {\n` +
      `    if (process.env.MOCK_GIT_HASH_FAIL === "1") throw new Error("fixture hash failed");\n` +
      `    return createHash("sha256").update(readFileSync(resolve(process.cwd(), args[1]))).digest("hex");\n` +
      `  }\n` +
      `  return "";\n};\nsyncBuiltinESMExports();\n`,
  );
  return mockPath;
};
const run = (cwd, args = ["check", "--exit-code"], options = {}) => {
  const preload = options.mockGit ? ["--import", pathToFileURL(gitMock(cwd)).href] : [];
  const { mockGit: _mockGit, ...spawnOptions } = options;
  return spawnSync(process.execPath, [...preload, script, ...args], {
    cwd,
    input: "{}",
    encoding: "utf8",
    ...spawnOptions,
  });
};

const gitFixture = () => {
  const dir = scratch();
  mkdirSync(join(dir, "docs", "playbooks"), { recursive: true });
  mkdirSync(join(dir, "scripts"), { recursive: true });
  writeFileSync(join(dir, "docs", "playbooks", "sample.md"), "# Sample\n");
  writeFileSync(
    join(dir, "docs", "playbooks", "watch.json"),
    JSON.stringify({ "sample.md": ["scripts/sample.mjs"] }),
  );
  writeFileSync(join(dir, "scripts", "sample.mjs"), "export {};\n");
  mkdirSync(join(dir, ".git"));
  return dir;
};

test.after(() => {
  for (const dir of scratchDirs) rmSync(dir, { recursive: true, force: true });
});

test("unavailable Git is a strict failure and an explicit hook skip", () => {
  const dir = scratch();
  const noGitEnv = { ...process.env, PATH: "" };
  delete noGitEnv.Path;
  const strict = run(dir, ["--exit-code"], { env: noGitEnv });
  assert.equal(strict.status, 1);
  assert.equal(JSON.parse(strict.stdout).status, "failed");
  assert.match(JSON.parse(strict.stdout).reason, /Git root discovery is unavailable/);

  const hook = run(dir, [], { env: noGitEnv });
  assert.equal(hook.status, 0);
  assert.equal(JSON.parse(hook.stdout).status, "skipped");
});

test("strict diff discovery, watch loading, and schema failures are nonzero", () => {
  const diffRoot = gitFixture();
  const diffFailure = run(diffRoot, ["check", "--exit-code"], {
    mockGit: true,
    env: { ...process.env, MOCK_GIT_DIFF_FAIL: "1" },
  });
  assert.equal(diffFailure.status, 1);
  assert.equal(JSON.parse(diffFailure.stdout).status, "failed");
  assert.match(JSON.parse(diffFailure.stdout).reason, /Git diff discovery is unavailable/);

  for (const watchContents of [null, "{ malformed"]) {
    const dir = gitFixture();
    const watchPath = join(dir, "docs", "playbooks", "watch.json");
    if (watchContents === null) rmSync(watchPath);
    else writeFileSync(watchPath, watchContents);
    const result = run(dir, ["check", "--exit-code"], { mockGit: true });
    assert.equal(result.status, 1);
    assert.equal(JSON.parse(result.stdout).status, "failed");
    assert.match(JSON.parse(result.stdout).reason, /watch map is unavailable or malformed/);
  }

  const badSchema = gitFixture();
  writeFileSync(
    join(badSchema, "docs", "playbooks", "watch.json"),
    JSON.stringify({ "sample.md": "scripts/" }),
  );
  const result = run(badSchema, ["check", "--exit-code"], { mockGit: true });
  assert.equal(result.status, 1);
  assert.match(JSON.parse(result.stdout).reason, /watch map is invalid/);
});

test("valid watch coverage passes, while an uncovered playbook change fails", () => {
  const dir = gitFixture();
  const passed = run(dir, ["check", "--exit-code"], { mockGit: true });
  assert.equal(passed.status, 0, passed.stdout || passed.stderr);
  assert.equal(JSON.parse(passed.stdout).status, "passed");

  writeFileSync(join(dir, "scripts", "sample.mjs"), "export const changed = true;\n");
  const failed = run(dir, ["check", "--exit-code"], {
    mockGit: true,
    env: { ...process.env, MOCK_GIT_CHANGED: "scripts/sample.mjs" },
  });
  assert.equal(failed.status, 1);
  assert.equal(JSON.parse(failed.stdout).status, "failed");
  assert.match(JSON.parse(failed.stdout).reason, /playbooks were not updated/);
});

test("strict hashing rejects unreadable existing files but accepts a covered deletion", () => {
  const unreadable = gitFixture();
  const hashFailure = run(unreadable, ["check", "--exit-code"], {
    mockGit: true,
    env: { ...process.env, MOCK_GIT_CHANGED: "scripts/sample.mjs", MOCK_GIT_HASH_FAIL: "1" },
  });
  assert.equal(hashFailure.status, 1);
  assert.match(
    JSON.parse(hashFailure.stdout).reason,
    /could not hash existing changed file scripts\/sample\.mjs/,
  );

  const uninspectable = run(unreadable, ["check", "--exit-code"], {
    mockGit: true,
    env: {
      ...process.env,
      MOCK_GIT_CHANGED: "scripts/sample.mjs",
      MOCK_GIT_HASH_FAIL: "1",
      MOCK_FS_LSTAT_FAIL: "scripts/sample.mjs",
    },
  });
  assert.equal(uninspectable.status, 1);
  assert.match(
    JSON.parse(uninspectable.stdout).reason,
    /could not be inspected after Git hashing failed/,
  );

  const deleted = gitFixture();
  rmSync(join(deleted, "scripts", "sample.mjs"));
  writeFileSync(join(deleted, "docs", "playbooks", "sample.md"), "# Sample updated for deletion\n");
  const coveredDeletion = run(deleted, ["check", "--exit-code"], {
    mockGit: true,
    env: {
      ...process.env,
      MOCK_GIT_CHANGED: "scripts/sample.mjs\ndocs/playbooks/sample.md",
    },
  });
  assert.equal(coveredDeletion.status, 0, coveredDeletion.stdout || coveredDeletion.stderr);
  assert.equal(JSON.parse(coveredDeletion.stdout).status, "passed");
});

test("strict mode refuses an unusable stored baseline instead of falling back to HEAD", () => {
  const dir = gitFixture();
  writeFileSync(
    join(dir, ".git", "claude-playbooks-default"),
    "0123456789abcdef0123456789abcdef01234567",
  );
  const strict = run(dir, ["check", "--exit-code"], {
    mockGit: true,
    env: { ...process.env, MOCK_GIT_BASELINE_FAIL: "1" },
  });
  assert.equal(strict.status, 1);
  assert.match(JSON.parse(strict.stdout).reason, /Stored playbook baseline is unavailable in Git/);

  const hook = run(dir, ["check"], {
    mockGit: true,
    env: { ...process.env, MOCK_GIT_BASELINE_FAIL: "1" },
  });
  assert.equal(hook.status, 0);
  assert.equal(hook.stdout, "");

  const inaccessible = gitFixture();
  writeFileSync(
    join(inaccessible, ".git", "claude-playbooks-default"),
    "0123456789abcdef0123456789abcdef01234567",
  );
  const baselinePath = join(".git", "claude-playbooks-default");
  const statFailure = run(inaccessible, ["check", "--exit-code"], {
    mockGit: true,
    env: { ...process.env, MOCK_FS_LSTAT_FAIL: baselinePath },
  });
  assert.equal(statFailure.status, 1);
  assert.match(
    JSON.parse(statFailure.stdout).reason,
    /Stored playbook baseline cannot be inspected/,
  );

  const hookFallback = run(inaccessible, ["check"], {
    mockGit: true,
    env: { ...process.env, MOCK_FS_LSTAT_FAIL: baselinePath },
  });
  assert.equal(hookFallback.status, 0);
  assert.equal(hookFallback.stdout, "");
});

test("acknowledgments invalidate when changed bytes differ and new uncovered code is found", () => {
  const dir = gitFixture();
  const changed = "scripts/sample.mjs\ndocs/playbooks/sample.md";
  writeFileSync(join(dir, "scripts", "sample.mjs"), "export const changed = 1;\n");
  writeFileSync(join(dir, "docs", "playbooks", "sample.md"), "# Updated\n");
  const acked = run(dir, ["check", "--exit-code"], {
    mockGit: true,
    env: { ...process.env, MOCK_GIT_CHANGED: changed },
  });
  assert.equal(acked.status, 0, acked.stdout || acked.stderr);
  const sameBytes = run(dir, ["check", "--exit-code"], {
    mockGit: true,
    env: { ...process.env, MOCK_GIT_CHANGED: "scripts/sample.mjs" },
  });
  assert.equal(sameBytes.status, 0, sameBytes.stdout || sameBytes.stderr);

  writeFileSync(join(dir, "scripts", "sample.mjs"), "export const changed = 2;\n");
  const staleAck = run(dir, ["check", "--exit-code"], {
    mockGit: true,
    env: { ...process.env, MOCK_GIT_CHANGED: "scripts/sample.mjs" },
  });
  assert.equal(staleAck.status, 1);
  assert.match(JSON.parse(staleAck.stdout).reason, /playbooks were not updated/);

  mkdirSync(join(dir, "packages", "new", "src"), { recursive: true });
  writeFileSync(join(dir, "packages", "new", "src", "worker.mjs"), "export {};\n");
  const uncovered = run(dir, ["check", "--exit-code"], {
    mockGit: true,
    env: { ...process.env, MOCK_GIT_UNTRACKED: "packages/new/src/worker.mjs" },
  });
  assert.equal(uncovered.status, 1);
  assert.match(JSON.parse(uncovered.stdout).reason, /New code files are not covered/);
  assert.match(JSON.parse(uncovered.stdout).reason, /packages\/new\/src\/worker\.mjs/);
});
