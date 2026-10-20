import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runRelease } from "./phase48-staging-release.mjs";

const sha = "a".repeat(40),
  digest = "b".repeat(64);
const labels = {
  GOLDEN_OPENROUTER_BILLING: "standard",
  GOLDEN_TAVILY_BILLING: "free",
  GOLDEN_TAVILY_CREDIT_USD: "0",
};
const env = {
  CI: "true",
  GITHUB_ACTIONS: "true",
  EXPECTED_SOURCE_SHA: sha,
  EXPECTED_CI_RUN_ID: "123",
  STAGING_RELEASE_AUTHORIZATION_SHA256: "d".repeat(64),
  STAGING_CONVEX_DEPLOY_KEY: "dev:woozy-wren-368|synthetic",
  GITHUB_TOKEN: "private-token",
  OPENROUTER_API_KEY: "private-provider",
};
const zeroDiff = { authDiff: { added: [], removed: [] }, definitionDiffs: {}, componentDiffs: {} };
const output = (changed) =>
  `Remote config would be overwritten with the following changes:\n${changed ? "  changed" : "  "}\n${JSON.stringify(zeroDiff)}\nWould have deployed`;
function mock(options = {}) {
  const calls = [],
    stored = { ...(options.labels ?? {}) };
  let applied = false,
    setCount = 0;
  const ok = (stdout = "") => ({ status: 0, stdout, stderr: "" });
  const bad = () => ({
    status: 1,
    stdout: "private prompt diagnostic",
    stderr: "private-provider private-token",
  });
  const execute = (file, args, opts) => {
    calls.push({ file, args, opts });
    assert.equal(opts.env.CONVEX_DEPLOY_KEY, env.STAGING_CONVEX_DEPLOY_KEY);
    assert.equal(opts.env.GITHUB_TOKEN, undefined);
    assert.equal(opts.env.OPENROUTER_API_KEY, undefined);
    assert.equal(opts.env.STAGING_CONVEX_DEPLOY_KEY, undefined);
    if (file === "git") {
      if (args[0] === "rev-parse") return ok(options.wrongSha ? "c".repeat(40) : sha);
      if (args[0] === "status") return ok(options.dirty ? " M private-source" : "");
      if (args[0] === "ls-files") return ok("tracked-index");
    }
    const command = args[1];
    if (command === "dashboard")
      return ok(
        `https://dashboard.convex.dev/d/${options.production ? "opulent-octopus-494" : "woozy-wren-368"}`,
      );
    if (command === "env") {
      if (args[2] === "list")
        return ok(["SITE_URL", "FOUNDATION_ONBOARDING_ENABLED", ...Object.keys(stored)].join("\n"));
      const name = args[3];
      if (args[2] === "get") {
        if (name === "SITE_URL") return ok("https://pikar-ai-staging-joelferuzi.vercel.app");
        if (name === "FOUNDATION_ONBOARDING_ENABLED")
          return ok(applied && options.configurationChanged ? "0" : "1");
        assert.ok(Object.hasOwn(labels, name), "only fixed nonsecret labels may be read");
        if (applied && options.billingChanged && name === "GOLDEN_TAVILY_BILLING")
          return ok("unexpected");
        return Object.hasOwn(stored, name) ? ok(stored[name]) : bad();
      }
      assert.equal(args[2], "set");
      assert.ok(Object.hasOwn(labels, name));
      assert.equal(args[4], labels[name]);
      assert.equal(Object.hasOwn(stored, name), false, "existing labels must never be overwritten");
      setCount++;
      if (options.setFailure && setCount === 2) return bad();
      stored[name] = args[4];
      return ok();
    }
    if (command === "run") {
      assert.equal(args[2], "--inline-query");
      assert.doesNotMatch(args[3], /ctx\.db\.(insert|patch|replace|delete)|runMutation|runAction/);
      if (applied && options.postflightFailure) return bad();
      if (args[3].includes("process.env.CONVEX_SITE_URL"))
        return ok(
          JSON.stringify({
            site: "https://woozy-wren-368.convex.site",
            cloud: "https://woozy-wren-368.convex.cloud",
          }),
        );
      if (args[3].includes("foundationInterviews"))
        return ok(
          JSON.stringify({
            sha256: applied && options.retentionChanged ? "c".repeat(64) : digest,
            checkpointCount: 1,
          }),
        );
      return ok(
        JSON.stringify({
          count: 5,
          sha256: applied && options.registryChanged ? "c".repeat(64) : digest,
          selected: [
            "cockpit-agent",
            "offer-architect",
            "money-model-designer",
            "lead-engine",
            "executive-router",
          ].map((key) => ({ key, activeCount: 0, active: [] })),
        }),
      );
    }
    if (command === "deploy") {
      if (args.includes("--dry-run"))
        return ok(
          options.unknownDiff && !applied
            ? "Would have deployed"
            : output(applied && options.nonzeroPostflight),
        );
      assert.deepEqual(args.slice(2), [
        "--codegen",
        "disable",
        "--typecheck",
        "enable",
        "--skip-workos-check",
        "--message",
        `Approved Phase48 staging backend ${sha}`,
      ]);
      assert.equal(applied, false, "apply is never retried");
      applied = true;
      if (options.applyFailure) return bad();
      if (options.applyTimeout)
        return { status: null, error: { code: "ETIMEDOUT" }, stdout: "private diagnostic" };
      return ok();
    }
    throw Error("Unreviewed command");
  };
  return { execute, calls, stored };
}
const applies = (calls) =>
  calls.filter((c) => c.args[1] === "deploy" && !c.args.includes("--dry-run"));
const sets = (calls) => calls.filter((c) => c.args[1] === "env" && c.args[2] === "set");

test("requires authorization and exact source/staging admission before any mutation", async () => {
  for (const override of ["", "bad", "a".repeat(63), "A".repeat(64)]) {
    const m = mock();
    const result = await runRelease(
      { ...env, STAGING_RELEASE_AUTHORIZATION_SHA256: override },
      m.execute,
    );
    assert.equal(result.success, false);
    assert.equal(m.calls.length, 0);
    assert.equal(result.authorizationSha256, undefined);
  }
  for (const option of ["wrongSha", "dirty", "production"]) {
    const m = mock({ [option]: true });
    const result = await runRelease(env, m.execute);
    assert.equal(result.success, false);
    assert.equal(sets(m.calls).length, 0);
    assert.equal(applies(m.calls).length, 0);
    assert.equal(result.authorizationSha256, undefined);
  }
  const m = mock();
  assert.equal(
    (
      await runRelease(
        { ...env, STAGING_CONVEX_DEPLOY_KEY: "project:team:project|synthetic" },
        m.execute,
      )
    ).success,
    false,
  );
  assert.equal(m.calls.length, 0);
});
test("sets only absent fixed billing labels then applies once and verifies all three preserved hashes", async () => {
  const m = mock();
  const result = await runRelease(env, m.execute);
  assert.equal(result.success, true);
  assert.equal(result.authorizationSha256, env.STAGING_RELEASE_AUTHORIZATION_SHA256);
  assert.equal(result.sourceSha, sha);
  assert.equal(result.ciRunId, env.EXPECTED_CI_RUN_ID);
  assert.equal(result.phase, "complete");
  assert.equal(sets(m.calls).length, 3);
  assert.equal(applies(m.calls).length, 1);
  assert.deepEqual(m.stored, labels);
  assert.deepEqual(result.before, result.after);
  assert.equal(result.postflightParityZero, true);
  assert.equal(result.billingLabelsVerified, true);
  assert.equal(m.calls.filter((c) => c.args.includes("--dry-run")).length, 2);
  assert.doesNotMatch(
    JSON.stringify(result),
    /private-provider|private-token|prompt diagnostic|OPENROUTER_API_KEY/,
  );
});
test("unrecognized preflight diff refuses before billing writes or apply", async () => {
  const m = mock({ unknownDiff: true });
  const result = await runRelease(env, m.execute);
  assert.equal(result.success, false);
  assert.equal(result.phase, "preflight_evidence");
  assert.equal(sets(m.calls).length, 0);
  assert.equal(applies(m.calls).length, 0);
});
test("matching billing labels are read back without rewriting; any unexpected value refuses all mutations", async () => {
  const matched = mock({ labels });
  assert.equal((await runRelease(env, matched.execute)).success, true);
  assert.equal(sets(matched.calls).length, 0);
  for (const name of Object.keys(labels)) {
    const m = mock({ labels: { [name]: "unexpected" } });
    const result = await runRelease(env, m.execute);
    assert.equal(result.success, false);
    assert.equal(result.phase, "billing_inspection");
    assert.equal(sets(m.calls).length, 0);
    assert.equal(applies(m.calls).length, 0);
  }
});
test("partial configuration failure is observed once and never retried or followed by apply", async () => {
  const m = mock({ setFailure: true });
  const result = await runRelease(env, m.execute);
  assert.equal(result.success, false);
  assert.equal(result.phase, "billing_configuration");
  assert.equal(result.billingLabelsMayHaveChanged, true);
  assert.equal(result.postflightAttempted, true);
  assert.equal(result.billingLabelsVerified, false);
  assert.equal(applies(m.calls).length, 0);
  assert.equal(sets(m.calls).length, 2);
});
for (const option of ["applyFailure", "applyTimeout"])
  test(`uncertain ${option} receives one postflight with no apply retry`, async () => {
    const m = mock({ [option]: true });
    const result = await runRelease(env, m.execute);
    assert.equal(result.success, false);
    assert.equal(result.phase, "apply");
    assert.equal(result.applyAttempted, true);
    assert.equal(result.applyCompleted, false);
    assert.equal(result.postflightAttempted, true);
    assert.equal(result.postflightParityZero, true);
    assert.equal(applies(m.calls).length, 1);
    assert.doesNotMatch(JSON.stringify(result), /private-provider|private-token|prompt diagnostic/);
  });
for (const option of [
  "configurationChanged",
  "registryChanged",
  "retentionChanged",
  "nonzeroPostflight",
  "postflightFailure",
  "billingChanged",
])
  test(`refuses success after ${option} without rollback or retry`, async () => {
    const m = mock({ [option]: true });
    const result = await runRelease(env, m.execute);
    assert.equal(result.success, false);
    assert.equal(result.applyCompleted, true);
    assert.equal(result.postflightAttempted, true);
    assert.equal(applies(m.calls).length, 1);
    if (["configurationChanged", "registryChanged", "retentionChanged"].includes(option))
      assert.equal(result.preservationVerified, false);
    if (option === "nonzeroPostflight") assert.equal(result.postflightParityZero, false);
    if (option === "postflightFailure") assert.equal(result.postflightPassed, false);
    if (option === "billingChanged") assert.equal(result.billingLabelsVerified, false);
  });
test("workflow remains manual-only, exact-source and credential-isolated", () => {
  const workflow = readFileSync(
    new URL("../workflows/phase48-staging-release.yml", import.meta.url),
    "utf8",
  );
  assert.match(workflow, /workflow_dispatch:/);
  assert.doesNotMatch(workflow, /(?:^|\n)\s+(?:push|pull_request|schedule|workflow_run):/);
  assert.match(workflow, /contents: read/);
  assert.match(workflow, /actions: read/);
  assert.match(workflow, /group: staging-qualification/);
  assert.match(workflow, /cancel-in-progress: false/);
  assert.match(workflow, /authorization_sha256:/);
  assert.match(workflow, /STAGING_RELEASE_AUTHORIZATION_SHA256:/);
  assert.match(workflow, /ref: \$\{\{ inputs\.source_sha \}\}/);
  assert.match(workflow, /pnpm install --frozen-lockfile/);
  assert.equal((workflow.match(/STAGING_CONVEX_DEPLOY_KEY:/g) ?? []).length, 1);
  assert.match(workflow, /node \.github\/scripts\/phase48-staging-release\.mjs/);
});
