import assert from "node:assert/strict";
import test from "node:test";
import { childEnvironment, runParity, summarizeDiff } from "./phase48-staging-parity.mjs";

const sha = "a".repeat(40),
  digest = "b".repeat(64);
const env = {
  GITHUB_ACTIONS: "true",
  CI: "true",
  EXPECTED_SOURCE_SHA: sha,
  EXPECTED_CI_RUN_ID: "123",
  STAGING_CONVEX_DEPLOY_KEY: "dev:woozy-wren-368|synthetic-stage-only",
  GITHUB_TOKEN: "synthetic-token",
  OPENROUTER_API_KEY: "synthetic-provider",
  CONVEX_DEPLOYMENT: "prod:wrong",
};
const diff = () => ({
  authDiff: { added: [], removed: [] },
  definitionDiffs: {},
  componentDiffs: {
    "": {
      diffType: { type: "modify" },
      moduleDiff: { added: [], removed: [] },
      udfConfigDiff: null,
      cronDiff: { added: [], updated: [], deleted: [] },
      indexDiff: { added_indexes: [], removed_indexes: [] },
      schemaDiff: null,
    },
  },
});
const output = (value = diff()) =>
  `Remote config would be overwritten with the following changes:\n  \n${JSON.stringify(value, null, 2)}\nWould have deployed Convex functions`;
const selectedKeys = [
  "cockpit-agent",
  "offer-architect",
  "money-model-designer",
  "lead-engine",
  "executive-router",
];

function mock(options = {}) {
  const calls = [];
  let dry = false;
  const execute = (file, args, opts) => {
    calls.push({ file, args, env: opts.env });
    const ok = (stdout) => ({ status: 0, stdout, stderr: "" });
    if (file === "git") {
      if (args[0] === "rev-parse") return ok(options.wrongSha ? "c".repeat(40) : sha);
      if (args[0] === "status") return ok(options.dirty ? " M source.ts" : "");
      if (args[0] === "ls-files") return ok("immutable-index");
    }
    const command = args[1];
    if (command === "dashboard")
      return ok(
        `https://dashboard.convex.dev/d/${options.production ? "opulent-octopus-494" : "woozy-wren-368"}`,
      );
    if (command === "env") {
      if (args[2] === "list")
        return ok("SITE_URL\nFOUNDATION_ONBOARDING_ENABLED\nOPENROUTER_API_KEY");
      if (args[3] === "SITE_URL")
        return ok(
          options.wrongOrigin
            ? "https://www.pikar-ai.com"
            : "https://pikar-ai-staging-joelferuzi.vercel.app",
        );
      if (args[3] === "CONVEX_SITE_URL") return ok("https://woozy-wren-368.convex.site");
      if (args[3] === "FOUNDATION_ONBOARDING_ENABLED") return ok("1");
      throw Error("Unreviewed environment read");
    }
    if (command === "run") {
      assert.equal(args[2], "--inline-query");
      assert.doesNotMatch(args[3], /ctx\.db\.(insert|patch|replace|delete)|runMutation|runAction/);
      if (args[3].includes("process.env.CONVEX_SITE_URL")) {
        const origins = {
          site: "https://woozy-wren-368.convex.site",
          cloud: "https://woozy-wren-368.convex.cloud",
        };
        if (options.runtimeMismatch) origins[options.runtimeMismatch] = "https://wrong.example";
        if (options.runtimeChanged && dry) origins.site = "https://changed.example";
        if (options.runtimeExtra) origins.unexpected = "private diagnostic secret";
        return ok(JSON.stringify(origins));
      }
      if (args[3].includes("foundationInterviews")) {
        assert.match(args[3], /b389a2014e514c7a35e08480dcef446aeb46b360861e2b8b72f9e67fc61f412e/);
        assert.match(args[3], /2026-10-24T10:18:29.493Z/);
        return ok(
          JSON.stringify({
            sha256: dry && options.retentionChanged ? "c".repeat(64) : digest,
            checkpointCount: 1,
          }),
        );
      }
      assert.match(args[3], /ctx\.db\.query\("skills"\)\.take\(1001\)/);
      const selected = selectedKeys.map((key, index) => ({
        key,
        activeCount: 1,
        active: [
          { id: `skill${index}`, version: 1, bodyHash: options.bodyHashes?.[key] ?? digest },
        ],
      }));
      if (options.missingActive) {
        selected[1].activeCount = 0;
        selected[1].active = [];
      }
      if (options.multipleActive) {
        selected[1].activeCount = 2;
        selected[1].active.push({ id: "anotherSkill", version: 2, bodyHash: digest });
      }
      if (options.selectionChanged && dry) selected[1].active[0].bodyHash = "c".repeat(64);
      options.alterSelection?.(selected);
      return ok(
        JSON.stringify({
          sha256: dry && options.registryChanged ? "c".repeat(64) : digest,
          count: 10,
          selected,
        }),
      );
    }
    if (command === "deploy") {
      assert.deepEqual(args.slice(2), [
        "--dry-run",
        "--typecheck",
        "enable",
        "--codegen",
        "disable",
        "--verbose",
        "--skip-workos-check",
      ]);
      dry = true;
      if (options.dryFailure) return { status: 1, stdout: "", stderr: "private diagnostic secret" };
      return ok(options.unknownDiff ? "Would have deployed" : output());
    }
    throw Error("Unexpected command");
  };
  return { execute, calls };
}

test("only the selected staging key reaches children; tokens, provider secrets and other targets do not", () => {
  const child = childEnvironment(env);
  assert.equal(child.CONVEX_DEPLOY_KEY, env.STAGING_CONVEX_DEPLOY_KEY);
  for (const name of [
    "STAGING_CONVEX_DEPLOY_KEY",
    "GITHUB_TOKEN",
    "OPENROUTER_API_KEY",
    "CONVEX_DEPLOYMENT",
  ])
    assert.equal(child[name], undefined);
});
for (const key of [
  "project:team:project|synthetic",
  "preview:team:project|synthetic",
  "preview:woozy-wren-368|synthetic",
  "prod:opulent-octopus-494|synthetic",
  "prod:woozy-wren-368|synthetic",
  "dev:another-stage-123|synthetic",
  "",
  " ",
  "dev:woozy-wren-368",
  "dev:woozy-wren-368|",
  "dev:woozy-wren-368|synthetic|extra",
  "dev:woozy-wren-368|synthetic\n",
  " dev:woozy-wren-368|synthetic",
  "dev:woozy-wren-368:extra|synthetic",
]) {
  test(`rejects unsafe key selector case ${key.split("|")[0].trim() || "blank"}`, async () => {
    const { execute, calls } = mock();
    await assert.rejects(runParity({ ...env, STAGING_CONVEX_DEPLOY_KEY: key }, execute));
    assert.equal(calls.length, 0, "refusal precedes every child command");
  });
}
test("structured zero diff establishes parity only with the observed empty config diff", () => {
  assert.equal(summarizeDiff(output()).diffStatus, "zero");
  assert.equal(summarizeDiff(output()).parityEstablished, true);
  assert.equal(summarizeDiff(JSON.stringify(diff())).parityEstablished, false);
});
test("module and config changes are reported without returning paths or source", () => {
  const changed = diff();
  changed.componentDiffs[""].moduleDiff.added.push("private-module.js");
  const result = summarizeDiff(output(changed));
  assert.equal(result.diffStatus, "changes");
  assert.equal(result.parityEstablished, false);
  assert.ok(!JSON.stringify(result).includes("private-module"));
  assert.equal(
    summarizeDiff(output().replace("\n  \n", "\n  Change the server's version\n")).diffStatus,
    "changes",
  );
});
test("success prose, duplicate JSON and unknown or malformed fields never imply parity", () => {
  const extended = diff();
  extended.extra = true;
  const definitions = diff();
  definitions.definitionDiffs.x = {};
  const malformed = diff();
  malformed.componentDiffs[""].moduleDiff.added = null;
  for (const text of [
    "Would have deployed",
    `${output()}\n${output()}`,
    output(extended),
    output(definitions),
    output(malformed),
  ])
    assert.deepEqual(summarizeDiff(text), { diffStatus: "unknown", parityEstablished: false });
});
test("dry-run reads preserve exact source, origins, registry and retention; no secret value read", async () => {
  const { execute, calls } = mock();
  const result = await runParity(env, execute);
  assert.equal(result.parityEstablished, true);
  assert.equal(result.applyRequested, false);
  assert.equal(calls.filter((x) => x.args[1] === "deploy").length, 1);
  assert.equal(calls.filter((x) => x.args[1] === "run").length, 6);
  assert.ok(!calls.some((x) => x.args.includes("OPENROUTER_API_KEY")));
  assert.ok(!calls.some((x) => x.args[1] === "env" && x.args.includes("CONVEX_SITE_URL")));
});
test("successful dry-run without structured evidence reports unknown, not source parity", async () => {
  const { execute } = mock({ unknownDiff: true });
  assert.equal((await runParity(env, execute)).diffStatus, "unknown");
});

test("selected global prerequisites expose exact refs and source matches separately from semantic proof", async () => {
  const initial = await runParity(env, mock().execute);
  const observed = initial.globalSkillPrerequisites;
  assert.equal(observed.allSelectedHaveExactlyOneActive, true);
  assert.equal(observed.allSelectedActiveBodiesMatchSource, false);
  assert.equal(observed.semanticProof, false);
  assert.deepEqual(
    observed.selected.map((s) => s.key),
    selectedKeys,
  );
  const bodyHashes = Object.fromEntries(observed.selected.map((s) => [s.key, s.sourceBodyHash]));
  const matched = (await runParity(env, mock({ bodyHashes }).execute)).globalSkillPrerequisites;
  assert.equal(matched.allSelectedActiveBodiesMatchSource, true);
  assert.equal(matched.semanticProof, false);
  for (const selected of matched.selected) {
    assert.deepEqual(Object.keys(selected).sort(), [
      "active",
      "activeCount",
      "key",
      "sourceBodyHash",
    ]);
    assert.deepEqual(Object.keys(selected.active[0]).sort(), [
      "bodyHash",
      "id",
      "matchesSource",
      "version",
    ]);
    assert.equal(selected.active[0].matchesSource, true);
  }
});

test("missing or ambiguous active prerequisites are observations, never a qualification claim", async () => {
  for (const option of ["missingActive", "multipleActive"]) {
    const report = (await runParity(env, mock({ [option]: true }).execute))
      .globalSkillPrerequisites;
    assert.equal(report.allSelectedHaveExactlyOneActive, false);
    assert.equal(report.allSelectedActiveBodiesMatchSource, false);
    assert.equal(report.semanticProof, false);
  }
});

test("selected metadata changes fail preservation even with an unchanged registry hash", async () => {
  const phases = [];
  await assert.rejects(
    runParity(env, mock({ selectionChanged: true }).execute, (p) => phases.push(p)),
    /PHASE48_STAGING_PARITY_REFUSED/,
  );
  assert.equal(phases.at(-1), "preservation");
});

test("malformed or extended selected refs refuse before dry-run without exposing bodies", async () => {
  for (const alterSelection of [
    (s) => s.pop(),
    (s) => {
      s[0].key = "unselected-private-key";
    },
    (s) => {
      s[0].body = "private prompt body";
    },
    (s) => {
      s[0].activeCount = 2;
    },
    (s) => {
      s[0].activeCount = -1;
    },
    (s) => {
      s[0].active[0].body = "private prompt body";
    },
    (s) => {
      s[0].active[0].bodyHash = "private prompt body";
    },
    (s) => {
      s[0].active[0].version = 0;
    },
    (s) => {
      s[0].active[0].id = "private prompt body";
    },
    (s) => {
      s[1].active[0].id = s[0].active[0].id;
    },
  ]) {
    const { execute, calls } = mock({ alterSelection });
    const phases = [];
    await assert.rejects(
      runParity(env, execute, (p) => phases.push(p)),
      /^Error: PHASE48_STAGING_PARITY_REFUSED$/,
    );
    assert.equal(phases.at(-1), "before_registry");
    assert.equal(calls.filter((c) => c.args[1] === "deploy").length, 0);
  }
});
for (const field of [
  "wrongSha",
  "dirty",
  "production",
  "wrongOrigin",
  "registryChanged",
  "retentionChanged",
  "dryFailure",
])
  test(`refuses ${field} without printing private diagnostics or applying`, async () => {
    const { execute, calls } = mock({ [field]: true });
    await assert.rejects(runParity(env, execute), /^Error: PHASE48_STAGING_PARITY_REFUSED$/);
    assert.ok(
      calls.filter((x) => x.args[1] === "deploy").every((x) => x.args.includes("--dry-run")),
    );
    if (field === "dryFailure") assert.equal(calls.filter((x) => x.args[1] === "run").length, 6);
  });
test("built-in runtime origins need not be listed as stored variables", async () => {
  const { execute, calls } = mock();
  assert.equal((await runParity(env, execute)).preservedStateVerified, true);
  assert.equal(
    calls.filter((x) => x.args[1] === "run" && x.args[3].includes("process.env.CONVEX_SITE_URL"))
      .length,
    2,
  );
});
for (const field of ["site", "cloud"]) {
  test(`runtime ${field} mismatch fails at a fixed phase before dry-run`, async () => {
    const { execute, calls } = mock({ runtimeMismatch: field });
    const phases = [];
    await assert.rejects(
      runParity(env, execute, (phase) => phases.push(phase)),
      /PHASE48_STAGING_PARITY_REFUSED/,
    );
    assert.equal(phases.at(-1), "before_runtime_origins");
    assert.equal(calls.filter((x) => x.args[1] === "deploy").length, 0);
  });
}
test("changed runtime origins and extended runtime shapes remain fail-closed", async () => {
  for (const [option, expectedPhase] of [
    ["runtimeChanged", "after_runtime_origins"],
    ["runtimeExtra", "before_runtime_origins"],
  ]) {
    const { execute } = mock({ [option]: true });
    const phases = [];
    await assert.rejects(
      runParity(env, execute, (phase) => phases.push(phase)),
      /PHASE48_STAGING_PARITY_REFUSED/,
    );
    assert.equal(phases.at(-1), expectedPhase);
    assert.ok(!JSON.stringify(phases).includes("private diagnostic"));
  }
});
test("private CLI failure exposes only a fixed dry-run phase after preserved-state reads", async () => {
  const { execute, calls } = mock({ dryFailure: true });
  const phases = [];
  await assert.rejects(
    runParity(env, execute, (phase) => phases.push(phase)),
    (error) => {
      assert.equal(error.message, "PHASE48_STAGING_PARITY_REFUSED");
      return true;
    },
  );
  assert.equal(phases.at(-1), "dry_run");
  assert.ok(phases.includes("after_registry"));
  assert.equal(calls.filter((x) => x.args[1] === "run").length, 6);
});
test("missing CI/scope/key refuses before any command", async () => {
  for (const field of [
    "CI",
    "GITHUB_ACTIONS",
    "EXPECTED_SOURCE_SHA",
    "EXPECTED_CI_RUN_ID",
    "STAGING_CONVEX_DEPLOY_KEY",
  ]) {
    const { execute, calls } = mock();
    await assert.rejects(runParity({ ...env, [field]: undefined }, execute));
    assert.equal(calls.length, 0);
  }
});
