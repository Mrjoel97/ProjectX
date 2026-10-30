import assert from "node:assert/strict";
import { createHash } from "node:crypto";
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
const configOutput = (block, value = diff()) =>
  `Remote config would be overwritten with the following changes:\n${block}\nFinalizing push...\n${JSON.stringify(value, null, 2)}\nWould have deployed Convex functions`;
const blockHash = (block) => createHash("sha256").update(block.trim()).digest("hex");
const billingDeclarations = {
  GOLDEN_OPENROUTER_BILLING: "standard",
  GOLDEN_TAVILY_BILLING: "free",
  GOLDEN_TAVILY_CREDIT_USD: "0",
};
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
        return ok(
          [
            "SITE_URL",
            "FOUNDATION_ONBOARDING_ENABLED",
            "OPENROUTER_API_KEY",
            ...Object.keys(options.billingDeclarations ?? {}),
          ].join("\n"),
        );
      if (args[3] === "SITE_URL")
        return ok(
          options.wrongOrigin
            ? "https://www.pikar-ai.com"
            : "https://pikar-ai-staging-joelferuzi.vercel.app",
        );
      if (args[3] === "CONVEX_SITE_URL") return ok("https://woozy-wren-368.convex.site");
      if (args[3] === "FOUNDATION_ONBOARDING_ENABLED") return ok("1");
      if (Object.hasOwn(billingDeclarations, args[3])) {
        assert.equal(args[2], "get");
        assert.ok(Object.hasOwn(options.billingDeclarations ?? {}, args[3]));
        return ok(options.billingDeclarations[args[3]]);
      }
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
            checkpointCount: options.retentionPurged ? 0 : 1,
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
      return ok(options.unknownDiff ? "Would have deployed" : (options.diffOutput ?? output()));
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

test("empty config diagnostics exclude CLI progress and hash only the trimmed config block", () => {
  const report = summarizeDiff(configOutput("  "));
  assert.equal(report.diffStatus, "zero");
  assert.equal(report.parityEstablished, true);
  assert.equal(report.structuredChangedItemCount, 0);
  assert.equal(report.remoteConfigChanged, false);
  assert.equal(report.remoteConfigCategory, "none");
  assert.equal(report.remoteConfigAddedVersionCount, 0);
  assert.equal(report.remoteConfigRemovedVersionCount, 0);
  assert.equal(report.remoteConfigBlockSha256, blockHash(""));
});

test("heading-only Node warnings remain changes while separating structured zero from prose", () => {
  const block = "  Change the server's version for Node.js actions:";
  const report = summarizeDiff(configOutput(block));
  assert.equal(report.diffStatus, "changes");
  assert.equal(report.parityEstablished, false);
  assert.equal(report.changedItemCount, 1);
  assert.equal(report.structuredChangedItemCount, 0);
  assert.equal(report.remoteConfigChanged, true);
  assert.equal(report.remoteConfigCategory, "node_version");
  assert.equal(report.remoteConfigAddedVersionCount, 0);
  assert.equal(report.remoteConfigRemovedVersionCount, 0);
  assert.equal(report.remoteConfigBlockSha256, blockHash(block));
  assert.equal(report.unspecifiedNodeVersionWarning, false);
});

test("only explicit unspecified-node context excludes the exact known heading-only warning", () => {
  const block = "  Change the server's version for Node.js actions:";
  const report = summarizeDiff(configOutput(block), { nodeVersionUnspecified: true });
  assert.equal(report.diffStatus, "zero");
  assert.equal(report.parityEstablished, true);
  assert.equal(report.structuredChangedItemCount, 0);
  assert.equal(report.changedItemCount, 0);
  assert.equal(report.remoteConfigChanged, true);
  assert.equal(report.remoteConfigCategory, "node_version");
  assert.equal(report.remoteConfigAddedVersionCount, 0);
  assert.equal(report.remoteConfigRemovedVersionCount, 0);
  assert.equal(report.remoteConfigBlockSha256, blockHash(block));
  assert.equal(report.unspecifiedNodeVersionWarning, true);
  for (const nodeVersionUnspecified of [false, undefined, 0, 1, "true"]) {
    const refused = summarizeDiff(configOutput(block), { nodeVersionUnspecified });
    assert.equal(refused.diffStatus, "changes");
    assert.equal(refused.parityEstablished, false);
    assert.equal(refused.unspecifiedNodeVersionWarning, false);
  }
});

for (const [name, block] of [
  ["additional prose", "  Change the server's version for Node.js actions: additional detail"],
  ["embedded newline", "  Change the server's version for\n  Node.js actions:"],
  [
    "another indented line",
    "  Change the server's version for Node.js actions:\n  Additional detail",
  ],
  ["Unicode colon", "  Change the server's version for Node.js actions："],
  ["embedded zero-width character", "  Change the server's version for Node.js\u200b actions:"],
  [
    "added version",
    "  Change the server's version for Node.js actions:\n  [+] private-new-version",
  ],
  [
    "removed version",
    "  Change the server's version for Node.js actions:\n  [-] private-old-version",
  ],
  [
    "function-version warning",
    "  Change the server's version for Node.js actions:\n  Change the server's function version:",
  ],
]) {
  test(`unspecified-node context does not waive ${name}`, () => {
    const report = summarizeDiff(configOutput(block), { nodeVersionUnspecified: true });
    assert.equal(report.diffStatus, "changes");
    assert.equal(report.parityEstablished, false);
    assert.equal(report.changedItemCount, 1);
    assert.equal(report.remoteConfigChanged, true);
    assert.equal(report.unspecifiedNodeVersionWarning, false);
    assert.equal(report.remoteConfigBlockSha256, blockHash(block));
    assert.doesNotMatch(JSON.stringify(report), /private-new-version|private-old-version/);
  });
}

test("excluding the exact unspecified-node warning never excludes structured changes", () => {
  const changed = diff();
  changed.componentDiffs[""].moduleDiff.added.push("private-module.js");
  const report = summarizeDiff(
    configOutput("  Change the server's version for Node.js actions:", changed),
    { nodeVersionUnspecified: true },
  );
  assert.equal(report.diffStatus, "changes");
  assert.equal(report.parityEstablished, false);
  assert.equal(report.changedItemCount, 1);
  assert.equal(report.structuredChangedItemCount, 1);
  assert.equal(report.remoteConfigChanged, true);
  assert.equal(report.unspecifiedNodeVersionWarning, true);
  assert.doesNotMatch(JSON.stringify(report), /private-module/);
});

test("an unexpected unindented first line remains a change without hashing progress text", () => {
  const report = summarizeDiff(configOutput("Unexpected private progress"));
  assert.equal(report.diffStatus, "changes");
  assert.equal(report.parityEstablished, false);
  assert.equal(report.structuredChangedItemCount, 0);
  assert.equal(report.changedItemCount, 1);
  assert.equal(report.remoteConfigChanged, true);
  assert.equal(report.remoteConfigCategory, "unknown");
  assert.equal(report.remoteConfigAddedVersionCount, 0);
  assert.equal(report.remoteConfigRemovedVersionCount, 0);
  assert.equal(report.remoteConfigBlockSha256, blockHash(""));
  assert.doesNotMatch(JSON.stringify(report), /Unexpected|private|progress/);
});

test("UDF and combined version warnings expose only category, counts and a block hash", () => {
  const udf = [
    "  Change the server's function version:",
    "  [-] private-previous-function-version",
    "  [+] private-next-function-version",
  ].join("\n");
  const node = [
    "  Change the server's version for Node.js actions:",
    "  [-] private-previous-node-version",
    "  [+] private-next-node-version",
  ].join("\n");
  for (const [block, category, count] of [
    [udf, "udf_version", 1],
    [`${udf}\n${node}`, "both", 2],
  ]) {
    const report = summarizeDiff(configOutput(block));
    assert.equal(report.diffStatus, "changes");
    assert.equal(report.parityEstablished, false);
    assert.equal(report.changedItemCount, 1);
    assert.equal(report.structuredChangedItemCount, 0);
    assert.equal(report.remoteConfigCategory, category);
    assert.equal(report.remoteConfigAddedVersionCount, count);
    assert.equal(report.remoteConfigRemovedVersionCount, count);
    assert.equal(report.remoteConfigBlockSha256, blockHash(block));
    assert.doesNotMatch(JSON.stringify(report), /private-|Finalizing push/);
  }
});

test("unrecognized config prose stays a change and counts only trimmed version-line prefixes", () => {
  const block = [
    "  Unrecognized private configuration warning:",
    "  [+] private-added-value",
    "  [-] private-removed-value",
    "  detail [+] not-a-version-line",
    "  detail [-] not-a-version-line",
  ].join("\n");
  const report = summarizeDiff(configOutput(block));
  assert.equal(report.diffStatus, "changes");
  assert.equal(report.parityEstablished, false);
  assert.equal(report.remoteConfigChanged, true);
  assert.equal(report.remoteConfigCategory, "unknown");
  assert.equal(report.remoteConfigAddedVersionCount, 1);
  assert.equal(report.remoteConfigRemovedVersionCount, 1);
  assert.equal(report.remoteConfigBlockSha256, blockHash(block));
  assert.doesNotMatch(JSON.stringify(report), /private|Unrecognized|not-a-version-line/);
});

test("structured changes remain distinct from the single config warning increment", () => {
  const changed = diff();
  changed.componentDiffs[""].moduleDiff.added.push("private-module.js");
  changed.componentDiffs[""].schemaDiff = {
    previous_schema: "private-previous-schema",
    next_schema: "private-next-schema",
  };
  const report = summarizeDiff(
    configOutput("  Change the server's version for Node.js actions:", changed),
  );
  assert.equal(report.structuredChangedItemCount, 2);
  assert.equal(report.changedItemCount, 3);
  assert.equal(report.remoteConfigChanged, true);
  assert.equal(report.remoteConfigCategory, "node_version");
  assert.doesNotMatch(JSON.stringify(report), /private/);
  const withoutWarning = summarizeDiff(configOutput("  ", changed));
  assert.equal(withoutWarning.structuredChangedItemCount, 2);
  assert.equal(withoutWarning.changedItemCount, 2);
  assert.equal(withoutWarning.remoteConfigCategory, "none");
  assert.equal(withoutWarning.remoteConfigChanged, false);
});

test("ambiguous config headers keep the exact unknown result without speculative diagnostics", () => {
  const header = "Remote config would be overwritten with the following changes:";
  assert.deepEqual(summarizeDiff(`${header}\n  \n${configOutput("  ")}`), {
    diffStatus: "unknown",
    parityEstablished: false,
  });
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
  ]) {
    assert.deepEqual(summarizeDiff(text), { diffStatus: "unknown", parityEstablished: false });
    assert.deepEqual(summarizeDiff(text, { nodeVersionUnspecified: true }), {
      diffStatus: "unknown",
      parityEstablished: false,
    });
  }
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

test("a verified purged retention snapshot remains protected across both parity reads", async () => {
  const { execute, calls } = mock({ retentionPurged: true });
  const result = await runParity(env, execute);
  assert.equal(result.protectedRetentionUnchanged, true);
  assert.equal(result.protectedRetentionSha256, digest);
  assert.equal(result.parityEstablished, true);
  const retentionReads = calls.filter(
    (call) => call.args[1] === "run" && call.args[3].includes("foundationInterviews"),
  );
  assert.equal(retentionReads.length, 2);
  for (const call of retentionReads) {
    assert.match(call.args[3], /foundation_retention\.purged/);
    assert.match(call.args[3], /MISSING_PURGE_RECEIPT/);
    assert.doesNotMatch(
      call.args[3],
      /ctx\.db\.(insert|patch|replace|delete)|runMutation|runAction/,
    );
  }
  const changed = mock({ retentionPurged: true, retentionChanged: true });
  await assert.rejects(runParity(env, changed.execute));
});

test("runParity derives the narrow unspecified-node context from the pinned local CLI configuration", async () => {
  const { execute, calls } = mock({
    diffOutput: configOutput("  Change the server's version for Node.js actions:"),
  });
  const report = await runParity(env, execute);
  assert.equal(report.unspecifiedNodeVersionWarning, true);
  assert.equal(report.diffStatus, "zero");
  assert.equal(report.parityEstablished, true);
  assert.equal(report.remoteConfigChanged, true);
  assert.equal(report.structuredChangedItemCount, 0);
  assert.equal(report.changedItemCount, 0);
  assert.equal(calls.filter((call) => call.args[1] === "deploy").length, 1);
  assert.ok(
    calls
      .filter((call) => call.args[1] === "deploy")
      .every((call) => call.args.includes("--dry-run")),
  );
});

test("absent billing declarations are observed as null without reading or setting them", async () => {
  const { execute, calls } = mock();
  const report = await runParity(env, execute);
  assert.deepEqual(report.billingDeclarations, {
    GOLDEN_OPENROUTER_BILLING: null,
    GOLDEN_TAVILY_BILLING: null,
    GOLDEN_TAVILY_CREDIT_USD: null,
  });
  assert.ok(
    !calls.some((call) => call.args.some((arg) => Object.hasOwn(billingDeclarations, arg))),
  );
  assert.ok(!calls.some((call) => call.args[1] === "env" && call.args[2] === "set"));
});

test("only the three supported nonsecret billing declarations are returned", async () => {
  const { execute, calls } = mock({ billingDeclarations });
  assert.deepEqual((await runParity(env, execute)).billingDeclarations, billingDeclarations);
  for (const name of Object.keys(billingDeclarations))
    assert.equal(
      calls.filter(
        (call) => call.args[1] === "env" && call.args[2] === "get" && call.args[3] === name,
      ).length,
      2,
    );
  assert.ok(!calls.some((call) => call.args[1] === "env" && call.args[2] === "set"));
  assert.ok(!calls.some((call) => call.args.includes("OPENROUTER_API_KEY")));
});

for (const name of Object.keys(billingDeclarations)) {
  test(`unexpected ${name} declaration refuses without leaking its value`, async () => {
    const { execute, calls } = mock({
      billingDeclarations: { ...billingDeclarations, [name]: "private-unsupported-value" },
    });
    await assert.rejects(runParity(env, execute), {
      message: "PHASE48_STAGING_PARITY_REFUSED",
    });
    assert.equal(calls.filter((call) => call.args[1] === "deploy").length, 0);
    assert.ok(!calls.some((call) => call.args[1] === "env" && call.args[2] === "set"));
  });
}
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
