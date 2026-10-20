// Separate, explicitly authorized staging apply path. Never seeds, invokes models or retries apply.
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { childEnvironment, runParity } from "./phase48-staging-parity.mjs";

const backend = fileURLToPath(new URL("../../packages/backend/", import.meta.url));
const labels = {
  GOLDEN_OPENROUTER_BILLING: "standard",
  GOLDEN_TAVILY_BILLING: "free",
  GOLDEN_TAVILY_CREDIT_USD: "0",
};
const preservedHashes = [
  "watchedConfigurationSha256",
  "registrySha256",
  "protectedRetentionSha256",
];
const demand = (ok) => {
  if (!ok) throw Error("PHASE48_STAGING_RELEASE_REFUSED");
};

export async function runRelease(env = process.env, execute = spawnSync, onPhase = () => {}) {
  let phase = "admission",
    failurePhase = null,
    before,
    after;
  let mutationAttempted = false;
  const state = {
    preflightPassed: false,
    billingLabelsMayHaveChanged: false,
    billingLabelsVerified: false,
    applyAttempted: false,
    applyCompleted: false,
    postflightAttempted: false,
    postflightPassed: false,
    preservationVerified: false,
    postflightParityZero: false,
  };
  const stage = (value) => {
    phase = value;
    onPhase(value);
  };
  let cli;
  try {
    demand(/^[a-f0-9]{64}$/.test(env.STAGING_RELEASE_AUTHORIZATION_SHA256 ?? ""));
    const childEnv = childEnvironment(env);
    cli = (args) => {
      const result = execute(
        process.execPath,
        [resolve(backend, "node_modules/convex/bin/main.js"), ...args],
        {
          cwd: backend,
          env: childEnv,
          encoding: "utf8",
          timeout: 600000,
          maxBuffer: 8 * 1024 * 1024,
          stdio: ["ignore", "pipe", "pipe"],
        },
      );
      demand(!result.error && result.status === 0);
      return (result.stdout ?? "").trim();
    };
    before = await runParity(env, execute, (value) => stage(`preflight_${value}`));
    stage("preflight_evidence");
    demand(["zero", "changes"].includes(before.diffStatus));
    state.preflightPassed = true;
    stage("billing_inspection");
    const names = new Set(cli(["env", "list", "--names-only"]).split(/\r?\n/));
    const existing = new Map();
    // Inspect all three before the first write; unexpected values are never overwritten.
    for (const [name, expected] of Object.entries(labels)) {
      const value = names.has(name) ? cli(["env", "get", name]) : null;
      demand(value === null || value === expected);
      existing.set(name, value);
    }
    stage("billing_configuration");
    for (const [name, value] of existing) {
      if (value !== null) continue;
      mutationAttempted = true;
      state.billingLabelsMayHaveChanged = true;
      cli(["env", "set", name, labels[name]]);
    }
    stage("billing_verification");
    for (const [name, expected] of Object.entries(labels))
      demand(cli(["env", "get", name]) === expected);
    state.billingLabelsVerified = true;
    stage("apply");
    mutationAttempted = true;
    state.applyAttempted = true;
    cli([
      "deploy",
      "--codegen",
      "disable",
      "--typecheck",
      "enable",
      "--skip-workos-check",
      "--message",
      `Approved Phase48 staging backend ${env.EXPECTED_SOURCE_SHA}`,
    ]);
    state.applyCompleted = true;
  } catch {
    failurePhase = phase;
  }
  // Even a failed/timed-out apply may have reached Convex. Observe once; never retry or roll back.
  if (mutationAttempted) {
    state.postflightAttempted = true;
    state.billingLabelsVerified = false;
    try {
      after = await runParity(env, execute, (value) => stage(`postflight_${value}`));
      state.postflightPassed = true;
      state.preservationVerified = preservedHashes.every((name) => before[name] === after[name]);
      state.postflightParityZero = after.diffStatus === "zero" && after.parityEstablished === true;
      stage("postflight_preservation");
      demand(state.preservationVerified && state.postflightParityZero);
      stage("postflight_billing");
      for (const [name, expected] of Object.entries(labels))
        demand(cli(["env", "get", name]) === expected);
      state.billingLabelsVerified = true;
    } catch {
      failurePhase ??= phase;
    }
  }
  return {
    schema: "phase48-staging-release.v1",
    target: "woozy-wren-368",
    success:
      failurePhase === null &&
      state.applyCompleted &&
      state.postflightPassed &&
      state.preservationVerified &&
      state.postflightParityZero,
    phase: failurePhase ?? "complete",
    ...state,
    privateDiagnosticsSuppressed: true,
    ...(before
      ? {
          sourceSha: before.sourceSha,
          ciRunId: before.ciRunId,
          authorizationSha256: env.STAGING_RELEASE_AUTHORIZATION_SHA256,
          before: Object.fromEntries(preservedHashes.map((key) => [key, before[key]])),
        }
      : {}),
    ...(after
      ? { after: Object.fromEntries(preservedHashes.map((key) => [key, after[key]])) }
      : {}),
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 2) {
    console.error(
      JSON.stringify({ success: false, phase: "entry", privateDiagnosticsSuppressed: true }),
    );
    process.exitCode = 1;
  } else {
    const result = await runRelease();
    console.log(JSON.stringify(result));
    process.exitCode = result.success ? 0 : 1;
  }
}
