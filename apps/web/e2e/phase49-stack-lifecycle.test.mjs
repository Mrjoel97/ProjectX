import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { EventEmitter } from "node:events";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  assertOwnedRoot,
  concludeRun,
  OWNERSHIP_MARKER,
  removeOwnedRoot,
  safeFailureMetadata,
  stepFailure,
  stopOwnedChild,
  trackOwnedChild,
} from "./phase49-stack-lifecycle.mjs";

const token = "test-owned-token-0123456789abcdef0123456789abcdef";
const runner = fileURLToPath(new URL("./phase49-disposable-stack.mjs", import.meta.url));
function fixture() {
  const base = mkdtempSync(join(tmpdir(), "phase49-lifecycle-test-"));
  const root = join(base, "pikar-phase49-Ab12Cd");
  mkdirSync(root);
  writeFileSync(join(root, OWNERSHIP_MARKER), token, { flag: "wx" });
  return {
    base,
    root,
    finish: () => {
      if (
        !resolve(base).startsWith(resolve(tmpdir()) + "\\") &&
        !resolve(base).startsWith(resolve(tmpdir()) + "/")
      )
        throw new Error("test base escaped temp");
      rmSync(base, { recursive: true, force: true });
    },
  };
}

test("owned root must be one exact direct child with matching marker, never broad or outside", () => {
  const f = fixture();
  try {
    assert.equal(assertOwnedRoot(f.root, f.base, token), resolve(f.root));
    assert.throws(() => assertOwnedRoot(f.base, f.base, token), /ROOT_TARGET_INVALID/);
    assert.throws(() => assertOwnedRoot(f.root, tmpdir(), token), /ROOT_TARGET_INVALID/);
    assert.throws(() => assertOwnedRoot(f.root, f.base, "wrong-token"), /ROOT_IDENTITY_INVALID/);
    const link = join(f.base, "pikar-phase49-Zz99Yy");
    try {
      symlinkSync(f.root, link, process.platform === "win32" ? "junction" : "dir");
      assert.throws(() => assertOwnedRoot(link, f.base, token), /ROOT_TARGET_INVALID/);
    } catch (error) {
      if (error.code !== "EPERM" && error.code !== "EACCES") throw error;
    }
  } finally {
    f.finish();
  }
});

test("cleanup failure is fatal and does not silently assert removal", async () => {
  const f = fixture();
  try {
    await assert.rejects(
      removeOwnedRoot(f.root, f.base, token, {
        remove: () => {
          throw Object.assign(new Error("private sensitive value"), { code: "EPERM" });
        },
        exists: () => true,
        attempts: 2,
        pause: async () => {},
      }),
      /TEMP_CLEANUP_FAILED/,
    );
    const scrubbed = [];
    assert.deepEqual(
      await removeOwnedRoot(f.root, f.base, token, {
        beforeRemove: (actual) => scrubbed.push(actual),
      }),
      { removed: true, attempts: 1 },
    );
    assert.deepEqual(scrubbed, [resolve(f.root)]);
  } finally {
    f.finish();
  }
});

test("termination must be observed after the request, not inferred from timeout or prior exit", async () => {
  const child = new EventEmitter();
  child.pid = 12345;
  const tracked = trackOwnedChild(child, "backend");
  assert.deepEqual(
    await stopOwnedChild(tracked, async () => {
      queueMicrotask(() => child.emit("exit", 0, null));
      return true;
    }),
    { stopped: true, pid: 12345, exitCode: 0, exitSignal: null },
  );
  const early = new EventEmitter();
  early.pid = 12346;
  const earlyState = trackOwnedChild(early, "web");
  early.emit("exit", 0, null);
  await assert.rejects(
    stopOwnedChild(earlyState, async () => true),
    /PROCESS_IDENTITY_UNVERIFIED/,
  );
  const missing = new EventEmitter();
  missing.pid = 12347;
  await assert.rejects(
    stopOwnedChild(trackOwnedChild(missing, "web"), async () => true, 5),
    /PROCESS_TERMINATION_UNOBSERVED/,
  );
  const refused = new EventEmitter();
  refused.pid = 12348;
  await assert.rejects(
    stopOwnedChild(trackOwnedChild(refused, "backend"), async () => false, 5),
    /PROCESS_TERMINATION_REQUEST_FAILED/,
  );
});

test("primary failure is preserved and diagnostics never include captured output or partial secrets", () => {
  const primary = stepFailure("browser", {
    status: 1,
    signal: null,
    stdout: "x".repeat(3500) + "PARTIAL_SECRET",
    stderr: "SECRET_VALUE",
    error: Object.assign(new Error("SECRET_VALUE"), { code: "ETIMEDOUT" }),
  });
  const cleanup = stepFailure("cleanup", { status: 2 });
  try {
    concludeRun(primary, [cleanup]);
    assert.fail("expected aggregate failure");
  } catch (error) {
    assert.ok(error instanceof AggregateError);
    assert.equal(error.errors[0], primary);
    const printed = JSON.stringify(safeFailureMetadata(error));
    assert.ok(!printed.includes("SECRET") && !printed.includes("PARTIAL"));
    assert.deepEqual(
      JSON.parse(printed).map((item) => item.code),
      ["STEP_FAILED", "STEP_FAILED"],
    );
  }
  assert.throws(() => concludeRun(null, [cleanup]), AggregateError);
});

test("the exact spawned child stop is observable in this environment", async () => {
  const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
    stdio: "ignore",
    windowsHide: true,
  });
  const state = trackOwnedChild(child, "test-child");
  try {
    await new Promise((done) => setTimeout(done, 150));
    const result = await stopOwnedChild(state, async () => child.kill("SIGTERM"), 5000);
    assert.equal(result.stopped, true);
    assert.equal(state.exitObserved, true);
  } finally {
    if (!state.exitObserved) child.kill("SIGKILL");
  }
});

test("disposable runner admits only the three existing specs plus Calendar and rejects an unknown spec before startup", () => {
  const source = readFileSync(runner, "utf8");
  const allowlist = source.match(/const specs = new Set\(\[([\s\S]*?)\]\);/)?.[1];
  assert.ok(allowlist, "runner allowlist must exist");
  assert.deepEqual(
    [...allowlist.matchAll(/"(e2e\/[^"]+)"/g)].map((match) => match[1]),
    [
      "e2e/phase48-web-runtime.spec.ts",
      "e2e/phase49-recipe-qualification.spec.ts",
      "e2e/phase49-web-recipes.spec.ts",
      "e2e/calendar-management.spec.ts",
    ],
  );
  assert.match(source, /calendarSpec \? \["--reporter=json"\] : \[\]/);
  assert.match(source, /CALENDAR_TEST_COUNT_INVALID/);
  const denied = spawnSync(process.execPath, [runner, "e2e/not-allowlisted.spec.ts"], {
    encoding: "utf8",
    timeout: 10_000,
  });
  assert.notEqual(denied.status, 0);
  assert.match(denied.stderr, /requires one allowlisted exact browser spec/);
});
