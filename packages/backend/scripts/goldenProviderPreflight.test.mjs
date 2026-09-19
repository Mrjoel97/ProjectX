import assert from "node:assert/strict";
import test from "node:test";
import {
  PREFLIGHT_PASSED_LINE,
  PREFLIGHT_REFUSED_LINE,
  runStandaloneProviderPreflight,
} from "./goldenProviderPreflight.mjs";

test("standalone preflight emits one canonical ready line and returns exit code zero", () => {
  const stdout = [];
  const stderr = [];
  let checks = 0;
  const code = runStandaloneProviderPreflight({
    check: () => {
      checks++;
    },
    stdout: (line) => stdout.push(line),
    stderr: (line) => stderr.push(line),
  });
  assert.equal(code, 0);
  assert.equal(checks, 1);
  assert.deepEqual(stdout, [PREFLIGHT_PASSED_LINE]);
  assert.deepEqual(stderr, []);
});

test("standalone preflight redacts backend failures, emits refusal, and returns exit code two", () => {
  const stdout = [];
  const stderr = [];
  const privateNeedle = "PRIVATE_DEPLOYMENT_DETAIL";
  const code = runStandaloneProviderPreflight({
    check: () => {
      throw new Error(privateNeedle);
    },
    stdout: (line) => stdout.push(line),
    stderr: (line) => stderr.push(line),
  });
  assert.equal(code, 2);
  assert.deepEqual(stdout, []);
  assert.deepEqual(stderr, [PREFLIGHT_REFUSED_LINE]);
  assert.ok(!stderr.join("\n").includes(privateNeedle));
});
