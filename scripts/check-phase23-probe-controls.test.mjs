import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import {
  candidateInspectionArgs,
  inspectionTarget,
  probeReadback,
  requestedCap,
} from "../apps/web/e2e/phase23ProbeControls.ts";

const expected = {
  tenantId: "tenant-a",
  threadId: "thread-a",
  budgetId: "budget-a",
  authorizationSha256: "a".repeat(64),
  capCents: 100,
};
const probe = {
  ...expected,
  expiresAt: 2000,
  started: 2,
  finished: 2,
  failed: 0,
  containmentRefusals: 0,
  policyAcceptanceEstablished: false,
};
const budget = {
  budgetId: "budget-a",
  capCents: 100,
  closed: false,
  expired: false,
  breached: false,
  unsettledCount: 0,
  unresolvedCents: 0,
  callCount: 4,
  settledCount: 4,
  actualUsd: 0.01,
};
const read = (p = probe, b = budget) => probeReadback(p, b, expected, 2, false, 1000);

test("the actual browser inspector argv satisfies the evaluator's equals-only expectation parser", () => {
  const source = readFileSync(
    new URL("../packages/backend/scripts/run-eval-golden.mjs", import.meta.url),
    "utf8",
  );
  // Execute only existing pure parser definitions, never the evaluator entry point.
  const definition = (name) => {
    const begin = source.indexOf(`function ${name}(`);
    const end = source.indexOf("\n}", begin);
    assert.ok(begin >= 0 && end > begin);
    return source.slice(begin, end + 2);
  };
  const constants = source.slice(
    source.indexOf("const EXPECT_FLAGS ="),
    source.indexOf("function parseInspectArgs("),
  );
  const parse = runInNewContext(
    [
      definition("parseTenantSkillId"),
      definition("valueFlag"),
      definition("spacedOrEqualsValue"),
      constants,
      definition("parseInspectArgs"),
      "parseInspectArgs",
    ].join("\n"),
    {},
    { timeout: 1000 },
  );
  const args = candidateInspectionArgs("candidate1", "foreign2");
  const parsed = JSON.parse(JSON.stringify(parse(args)));
  assert.deepEqual(parsed, {
    candidateId: "candidate1",
    foreignTenantId: "foreign2",
    json: true,
    expectations: {
      status: "candidate",
      evidenceState: "absent",
      gatePassed: "false",
      rollbackEligible: "false",
    },
  });
  assert.throws(
    () =>
      parse([
        ...args.filter((arg) => arg !== "--expect-status=candidate"),
        "--expect-status",
        "candidate",
      ]),
    /requires a value/,
  );
  assert.throws(
    () =>
      parse(
        args.map((arg) =>
          arg === "--expect-gate-passed=false" ? "--expect-gate-passed=invalid" : arg,
        ),
      ),
    /true\|false/,
  );
  assert.throws(() => parse([...args, "--skill", "cockpit-agent@1"]), /read-only/);
  const harness = readFileSync(
    new URL("../apps/web/e2e/agent-skill-authoring.spec.ts", import.meta.url),
    "utf8",
  );
  assert.match(harness, /const exactArgs = candidateInspectionArgs\(candidateId, foreignId\)/);
});

test("inspection metadata is explicit and canonical; no deployment-selector or disk fallback exists", () => {
  const env = {
    PIKAR_CONVEX_TARGET: "dev",
    CONVEX_URL: "https://woozy-wren-368.convex.cloud",
    CONVEX_DEPLOYMENT: "dev:conflicting-disk-target",
  };
  assert.deepEqual(inspectionTarget(env), {
    url: env.CONVEX_URL,
    dashboard: "https://dashboard.convex.dev/d/woozy-wren-368",
  });
  for (const url of [
    undefined,
    "",
    "http://woozy-wren-368.convex.cloud",
    "https://woozy-wren-368.convex.cloud/",
    "https://user:private@woozy-wren-368.convex.cloud",
    "https://woozy-wren-368.convex.cloud?private",
    "https://woozy-wren-368.convex.cloud#private",
    "https://woozy-wren-368.convex.site",
  ])
    assert.throws(
      () => inspectionTarget({ ...env, CONVEX_URL: url }),
      /EXPLICIT_INSPECTION_URL_REQUIRED/,
    );
  for (const target of [undefined, "", "preview", "DEV"])
    assert.throws(
      () => inspectionTarget({ ...env, PIKAR_CONVEX_TARGET: target }),
      /INSPECTION_TARGET_REQUIRED/,
    );
});

test("an explicit aggregate cap is required and native maximum remains 1000 cents", () => {
  assert.equal(requestedCap("100"), 100);
  for (const value of [undefined, "", "0", "-1", "NaN", "1.5", "1001"])
    assert.throws(() => requestedCap(value));
});
test("native settled two-turn controls remain distinct from policy acceptance", () => {
  assert.equal(read().actualUsd, 0.01);
  assert.equal(read().policyAcceptanceEstablished, false);
  assert.equal(
    probeReadback(probe, { ...budget, closed: true }, expected, 2, true, 1000).closed,
    true,
  );
});
test("wrong tenant/thread/authorization/cap and expired or missing native reads fail closed", () => {
  for (const patch of [
    { tenantId: "other" },
    { threadId: "other" },
    { authorizationSha256: "b".repeat(64) },
    { expiresAt: 999 },
  ])
    assert.throws(() => read({ ...probe, ...patch }));
  assert.throws(() => read(probe, { ...budget, capCents: 101 }));
  assert.throws(() => read(probe, { ...budget, budgetId: "other-envelope" }));
  assert.throws(() => probeReadback(null, budget, expected, 2));
});
test("containment cannot masquerade as an adversarial refusal and unknown provider work cannot pass", () => {
  for (const patch of [
    { containmentRefusals: 1 },
    { failed: 1 },
    { finished: 1 },
    { started: 3 },
    { policyAcceptanceEstablished: true },
  ])
    assert.throws(() => read({ ...probe, ...patch }));
  for (const patch of [
    { unsettledCount: 1 },
    { unresolvedCents: 1 },
    { settledCount: 3 },
    { actualUsd: NaN },
    { actualUsd: 1.01 },
    { breached: true },
    { closed: true },
  ])
    assert.throws(() => read(probe, { ...budget, ...patch }));
});

test("ordinary browser turns use the registered thread and close its budget before immutable handoff", () => {
  const source = readFileSync(
    new URL("../apps/web/e2e/agent-skill-authoring.spec.ts", import.meta.url),
    "utf8",
  );
  assert.equal((source.match(/await say\(/g) ?? []).length, 2);
  assert.equal((source.match(/query\("authoringProbe:prepare"/g) ?? []).length, 1);
  assert.equal((source.match(/await openProbe\(page, probe\)/g) ?? []).length, 2);
  const openProbe = source.slice(
    source.indexOf("async function openProbe("),
    source.indexOf("async function say("),
  );
  assert.ok(openProbe.indexOf("verifyInspectionTarget();") >= 0);
  assert.ok(openProbe.indexOf("verifyInspectionTarget();") < openProbe.indexOf("await page.goto("));
  const ownerGuard = source.indexOf(
    "verifyInspectionTarget();",
    source.indexOf("let previousAttempt:"),
  );
  assert.ok(ownerGuard >= 0 && ownerGuard < source.indexOf('query("owner:bootstrapOwner"'));
  assert.match(
    source,
    /verifyInspectionTarget\(\);\s+const prepared = query\("authoringProbe:prepare"/,
  );
  assert.ok(
    source.indexOf("readProbe(probe, 2, true)") <
      source.indexOf("validator.writeImmutableArtifact"),
  );
  assert.ok(!source.includes("__convexAuthJWT"));
  assert.ok(!source.includes('name: "New chat"'));
});

test("auth-only readiness cannot invoke the paid runner and both contexts start empty", () => {
  const auth = readFileSync(
    new URL("../apps/web/e2e/phase23-auth-only.spec.ts", import.meta.url),
    "utf8",
  );
  const helper = readFileSync(
    new URL("../apps/web/e2e/phase23NativeAuth.ts", import.meta.url),
    "utf8",
  );
  const paid = readFileSync(
    new URL("../apps/web/e2e/agent-skill-authoring.spec.ts", import.meta.url),
    "utf8",
  );
  for (const source of [auth, helper]) {
    for (const forbidden of [
      "authoringProbe:",
      "owner:bootstrapOwner",
      "cockpit:send",
      "__convexAuthJWT",
      "agent-skill-authoring.spec",
    ])
      assert.ok(!source.includes(forbidden));
  }
  assert.equal((helper.match(/"owner:findUserIdByEmail"/g) ?? []).length, 1);
  assert.ok(auth.includes('from "./phase23NativeAuth"'));
  assert.ok(paid.includes('from "./phase23NativeAuth"'));
  for (const source of [auth, paid]) {
    assert.equal(
      (source.match(/storageState: \{ cookies: \[\], origins: \[\] \}/g) ?? []).length,
      2,
    );
    assert.ok(!source.includes('storageState: "e2e/.auth/'));
  }
  assert.match(helper, /throw new Error\(`PHASE23_AUTH_\$\{stage\}_FAILED`\)/);
  assert.ok(!helper.includes("error.message"));
  assert.ok(auth.indexOf("await nonOwner") < auth.indexOf(".storageState({ path:"));
});

test("auth-only existing-owner mode stays explicit, native and independent of spend authorization", () => {
  const auth = readFileSync(
    new URL("../apps/web/e2e/phase23-auth-only.spec.ts", import.meta.url),
    "utf8",
  );
  const helper = readFileSync(
    new URL("../apps/web/e2e/phase23NativeAuth.ts", import.meta.url),
    "utf8",
  );
  const paid = readFileSync(
    new URL("../apps/web/e2e/agent-skill-authoring.spec.ts", import.meta.url),
    "utf8",
  );
  assert.ok(
    auth.includes("const continuation = process.env.PIKAR_PHASE23_CONTINUE_EXISTING_OWNER"),
  );
  assert.ok(auth.includes('continuation !== undefined && continuation !== "1"'));
  assert.match(
    auth,
    /existingOwnerAtStart\s*\?\s*await existingOwner\(page\)\s*:\s*await nonOwner\(page\)/,
  );
  assert.ok(auth.includes("primaryOwner: existingOwnerAtStart"));
  assert.ok(auth.includes("foreignOwner: false"));
  assert.ok(auth.includes("existingOwnerAtStart: true"));
  for (const forbidden of [
    "phase23OwnerContinuation",
    "phase23OwnerMode",
    "AUTHORIZATION_SHA256",
    "openEvalBudget",
    "capCents",
  ])
    assert.ok(!auth.includes(forbidden));
  assert.ok(paid.includes("authenticate, existingOwner, nonOwner"));
  assert.ok(!paid.includes("async function existingOwner"));
  assert.match(helper, /user\?\.owner !== expectedOwner\s*\|\|\s*user\.userId !== expectedId/);
  assert.equal((helper.match(/readExpectedIdentity\(false, true\)/g) ?? []).length, 2);
  assert.ok(
    helper.indexOf(
      "await authenticate(page);",
      helper.indexOf("export async function existingOwner"),
    ) < helper.lastIndexOf("readExpectedIdentity(false, true)"),
  );
});
