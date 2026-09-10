// A deliberate owner-wrapper downgrade exists ONLY in Vitest's in-memory module transform.
// No source file is modified and no deployment/watch process ever sees weakened authority.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const backend = join(root, "packages/backend");
const sourcePath = join(backend, "convex/skills.ts");
const digest = (value) => createHash("sha256").update(value).digest("hex");
if (process.argv.length !== 3 || process.argv[2] !== "--self-check") {
  process.stderr.write(
    "Use --self-check for the isolated, offline owner-boundary mutation proof.\n",
  );
  process.exitCode = 1;
} else {
  const before = readFileSync(sourcePath);
  const sourceSha256 = digest(before);
  const scratchRoot = join(root, ".tmp");
  mkdirSync(scratchRoot, { recursive: true });
  const scratch = mkdtempSync(join(scratchRoot, "phase23-owner-"));
  const setupPath = join(scratch, "offline-setup.mjs");
  const marker = join(scratch, "mutated-source.sha256");
  writeFileSync(
    setupPath,
    'globalThis.fetch = async () => { throw new Error("PHASE23_NETWORK_FORBIDDEN"); };\n',
  );
  const from = "export const activateAgentCandidate = ownerMutation({";
  const to = "export const activateAgentCandidate = tenantMutation({";
  assert.equal(before.toString().split(from).length, 2, "exactly one mutation target required");
  function config(mutated) {
    const path = join(scratch, mutated ? "mutated.config.mjs" : "clean.config.mjs");
    writeFileSync(
      path,
      `
import base from ${JSON.stringify(join(backend, "vitest.config.mts"))};
import { writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
export default {
  ...base,
  plugins: ${
    mutated
      ? `[{ name: "phase23-memory-only-mutation", enforce: "pre", transform(code, id) {
    if (id.replaceAll("\\\\", "/").split("?")[0] !== ${JSON.stringify(sourcePath.replaceAll("\\", "/"))}) return null;
    if (code.split(${JSON.stringify(from)}).length !== 2) throw new Error("PHASE23_MUTATION_TARGET_MISSING");
    const altered = code.replace(${JSON.stringify(from)}, ${JSON.stringify(to)});
    writeFileSync(${JSON.stringify(marker)}, createHash("sha256").update(altered).digest("hex"));
    return { code: altered, map: null };
  } }]`
      : "[]"
  },
  test: { ...base.test, watch: false, setupFiles: [${JSON.stringify(setupPath)}] }
};\n`,
    );
    return path;
  }
  // Explicit small env: no credential, deployment, NODE_OPTIONS or provider variable inheritance.
  const env = Object.fromEntries(
    [
      "PATH",
      "Path",
      "SystemRoot",
      "SYSTEMROOT",
      "WINDIR",
      "TEMP",
      "TMP",
      "HOME",
      "USERPROFILE",
      "APPDATA",
      "LOCALAPPDATA",
    ]
      .filter((key) => process.env[key] !== undefined)
      .map((key) => [key, process.env[key]]),
  );
  const run = (path) =>
    spawnSync(
      process.execPath,
      [
        join(backend, "node_modules/vitest/vitest.mjs"),
        "run",
        "convex/skills.test.ts",
        "--config",
        path,
        "--maxWorkers=1",
        "-t",
        "the four cells are non-vacuous",
      ],
      {
        cwd: backend,
        env: { ...env, PIKAR_OFFLINE_FIXTURES: "1" },
        encoding: "utf8",
        timeout: 180_000,
        maxBuffer: 8 * 1024 * 1024,
      },
    );
  try {
    const cleanConfig = config(false);
    const clean = run(cleanConfig);
    assert.equal(clean.status, 0, "clean owner/eval four-cell control must pass");
    const mutated = run(config(true));
    assert.equal(mutated.status, 1, "wrapper downgrade must fail the existing behavioral test");
    const output = `${mutated.stdout}${mutated.stderr}`;
    assert.match(output, /OWNER_REQUIRED/);
    assert.match(output, /EVAL_GATE/);
    const mutationSha256 = readFileSync(marker, "utf8");
    assert.notEqual(mutationSha256, sourceSha256, "the in-memory module was actually changed");
    const restored = run(cleanConfig);
    assert.equal(restored.status, 0, "a fresh clean process must pass after the red run");
    assert.equal(
      digest(readFileSync(sourcePath)),
      sourceSha256,
      "source bytes must remain unchanged",
    );
    process.stdout.write(
      `${JSON.stringify({ schema: "phase23-isolated-owner-mutation.v1", cleanExit: clean.status, mutatedExit: mutated.status, restoredExit: restored.status, sourceSha256, sourceAfterSha256: digest(readFileSync(sourcePath)), mutationSha256, networkDisabled: true, sourceWritten: false })}\n`,
    );
  } catch (error) {
    process.stderr.write(
      `PHASE23_ISOLATED_OWNER_MUTATION_FAILED: ${error instanceof Error ? error.message : "unknown check failure"}\n`,
    );
    process.exitCode = 1;
  }
}
