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
  const namedLocal = "CONVEX_DEPLOYMENT=local:local-golden-test # team: test, project: test";
  assert.equal(assertGoldenNonProductionTarget({}, namedLocal), true);
  assert.equal(assertGoldenNonProductionTarget({ PIKAR_CONVEX_TARGET: "dev" }, namedLocal), true);
  assert.throws(
    () => assertGoldenNonProductionTarget({ PIKAR_CONVEX_TARGET: "prod" }, namedLocal),
    (error) =>
      error instanceof ProviderPreflightRefusal && error.reason === "production_target_forbidden",
  );
});

test("golden readiness needs an explicitly named non-production deployment", () => {
  for (const declared of [
    "",
    "CONVEX_URL=http://127.0.0.1:3210",
    "CONVEX_DEPLOYMENT=anonymous:anonymous-Pikar-Ai",
    "CONVEX_DEPLOYMENT=prod:production-example",
  ]) {
    assert.throws(
      () => assertGoldenNonProductionTarget({}, declared),
      (error) =>
        error instanceof ProviderPreflightRefusal &&
        error.reason === "named_nonproduction_target_required",
      `refuse missing, anonymous or production target: ${declared.split("=")[0]}`,
    );
  }
  assert.equal(
    assertGoldenNonProductionTarget({ CONVEX_DEPLOYMENT: "dev:named-golden-test" }, ""),
    true,
  );
});

test("a named local target cannot disguise a remote or conflicting Convex endpoint", () => {
  const named = "CONVEX_DEPLOYMENT=local:local-golden-test";
  assert.equal(
    assertGoldenNonProductionTarget({}, `${named}\nCONVEX_URL=http://127.0.0.1:3210`),
    true,
  );
  for (const file of [
    `${named}\nCONVEX_URL=https://production.convex.cloud`,
    `${named}\nCONVEX_SELF_HOSTED_URL=https://remote.example.com`,
    `${named}\nCONVEX_URL=http://127.0.0.1:3210\nCONVEX_URL=http://127.0.0.1:3211`,
  ])
    assert.throws(
      () => assertGoldenNonProductionTarget({}, file),
      (error) =>
        error instanceof ProviderPreflightRefusal &&
        error.reason === "named_nonproduction_target_required",
    );
  assert.throws(
    () =>
      assertGoldenNonProductionTarget(
        { CONVEX_URL: "http://127.0.0.1:3211" },
        `${named}\nCONVEX_URL=http://127.0.0.1:3210`,
      ),
    (error) =>
      error instanceof ProviderPreflightRefusal &&
      error.reason === "named_nonproduction_target_required",
  );
});

test("a named self-hosted local target uses the CLI-supported route without CONVEX_DEPLOYMENT", () => {
  const local = {
    PIKAR_GOLDEN_LOCAL_INSTANCE: "phase49-test-instance",
    CONVEX_SELF_HOSTED_URL: "http://127.0.0.1:3410",
    CONVEX_SELF_HOSTED_ADMIN_KEY: "synthetic-admin-key",
    CONVEX_URL: "http://127.0.0.1:3410",
  };
  assert.equal(assertGoldenNonProductionTarget(local, ""), true);
  for (const env of [
    { ...local, CONVEX_DEPLOYMENT: "local:phase49-test-instance" },
    { ...local, PIKAR_GOLDEN_LOCAL_INSTANCE: "" },
    { ...local, CONVEX_SELF_HOSTED_ADMIN_KEY: "" },
    { ...local, CONVEX_URL: "http://127.0.0.1:3411" },
    { ...local, CONVEX_SELF_HOSTED_URL: "https://remote.example.com" },
  ])
    assert.throws(
      () => assertGoldenNonProductionTarget(env, ""),
      (error) =>
        error instanceof ProviderPreflightRefusal &&
        error.reason === "named_nonproduction_target_required",
    );
  assert.throws(
    () => assertGoldenNonProductionTarget(local, "CONVEX_DEPLOYMENT=local:other"),
    (error) =>
      error instanceof ProviderPreflightRefusal &&
      error.reason === "named_nonproduction_target_required",
  );
});

test("a named cloud dev target refuses a mismatched explicit URL or declaration", () => {
  const named = "CONVEX_DEPLOYMENT=dev:named-golden-test";
  assert.equal(
    assertGoldenNonProductionTarget(
      {},
      `${named}\nCONVEX_URL=https://named-golden-test.convex.cloud`,
    ),
    true,
  );
  for (const file of [
    `${named}\nCONVEX_URL=https://production.convex.cloud`,
    `${named}\nCONVEX_SELF_HOSTED_URL=http://127.0.0.1:3210`,
    `${named}\nCONVEX_URL=https://named-golden-test.convex.cloud?token=secret`,
    `${named}\nCONVEX_DEPLOYMENT=dev:other`,
  ])
    assert.throws(
      () => assertGoldenNonProductionTarget({}, file),
      (error) =>
        error instanceof ProviderPreflightRefusal &&
        error.reason === "named_nonproduction_target_required",
    );
  assert.throws(
    () => assertGoldenNonProductionTarget({ CONVEX_DEPLOYMENT: "dev:other" }, named),
    (error) =>
      error instanceof ProviderPreflightRefusal &&
      error.reason === "named_nonproduction_target_required",
  );
});
