import assert from "node:assert/strict";
import test from "node:test";
import {
  assertGoldenNonProductionTarget,
  PREFLIGHT_PASSED_LINE,
  PREFLIGHT_REFUSAL_REASONS,
  ProviderPreflightRefusal,
  preflightRefusedLine,
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

for (const reason of PREFLIGHT_REFUSAL_REASONS) {
  test(`standalone preflight renders the closed secret-safe refusal reason: ${reason}`, () => {
    const stdout = [];
    const stderr = [];
    const code = runStandaloneProviderPreflight({
      check: () => {
        throw new ProviderPreflightRefusal(reason);
      },
      stdout: (line) => stdout.push(line),
      stderr: (line) => stderr.push(line),
    });
    assert.equal(code, 2);
    assert.deepEqual(stdout, []);
    assert.deepEqual(stderr, [preflightRefusedLine(reason)]);
  });
}

test("standalone preflight redacts unknown failures as transport_error", () => {
  const stdout = [];
  const stderr = [];
  const privateNeedles = [
    "PRIVATE_DEPLOYMENT_DETAIL",
    "https://secret.example/deployment?token=private",
    "key-length=51",
    "whitespace-at=19",
  ];
  const code = runStandaloneProviderPreflight({
    check: () => {
      throw new Error(privateNeedles.join(" "));
    },
    stdout: (line) => stdout.push(line),
    stderr: (line) => stderr.push(line),
  });
  assert.equal(code, 2);
  assert.deepEqual(stdout, []);
  assert.deepEqual(stderr, [preflightRefusedLine("transport_error")]);
  for (const needle of privateNeedles) assert.ok(!stderr.join("\n").includes(needle));
});

test("an unrecognized refusal reason cannot reach terminal output", () => {
  assert.throws(
    () => new ProviderPreflightRefusal("PRIVATE_DEPLOYMENT_DETAIL"),
    /PREFLIGHT_REFUSAL_REASON_INVALID/,
  );
});

test("golden readiness refuses an ambient production target before a deployment call", () => {
  assert.equal(assertGoldenNonProductionTarget({}), true);
  assert.equal(assertGoldenNonProductionTarget({ PIKAR_CONVEX_TARGET: "dev" }), true);
  assert.throws(
    () => assertGoldenNonProductionTarget({ PIKAR_CONVEX_TARGET: "prod" }),
    (error) =>
      error instanceof ProviderPreflightRefusal && error.reason === "production_target_forbidden",
  );
});
