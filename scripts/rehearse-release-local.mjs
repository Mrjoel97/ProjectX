// Secret-free clean-checkout rehearsal. Never invokes a deploy, codegen or provider command.
// Run: node scripts/rehearse-release-local.mjs <40-char-SHA> <absolute-pnpm.cjs> <absolute-store-dir>
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { closeSync, mkdirSync, mkdtempSync, openSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const [revision, pnpmCli, storeDir] = process.argv.slice(2);
if (
  !/^[a-f0-9]{40}$/.test(revision ?? "") ||
  !isAbsolute(pnpmCli ?? "") ||
  !isAbsolute(storeDir ?? "")
)
  throw new Error(
    "Expected exact commit SHA, absolute pnpm.cjs path and absolute offline store path",
  );
mkdirSync(join(root, ".tmp"), { recursive: true });
const artifact = mkdtempSync(join(root, ".tmp", "release-rehearsal-"));
const checkout = join(artifact, "checkout");
mkdirSync(checkout);
const env = Object.fromEntries(
  Object.entries(process.env).filter(([name]) =>
    /^(path|systemroot|windir|comspec|pathext|temp|tmp|home|userprofile|appdata|localappdata)$/i.test(
      name,
    ),
  ),
);
for (const name of ["userconfig", "globalconfig"]) {
  const path = join(artifact, `${name}.npmrc`);
  writeFileSync(path, "");
  env[`npm_config_${name}`] = path;
}
Object.assign(env, { CI: "true", TURBO_TELEMETRY_DISABLED: "1", DO_NOT_TRACK: "1" });
const evidence = {
  revision,
  node: process.version,
  startedAt: new Date().toISOString(),
  scope:
    "Local offline clean snapshot only; no hosted release, rollback, codegen or provider qualification",
  steps: [],
};
function run(name, executable, args, cwd = checkout) {
  const fd = openSync(join(artifact, `${name}.log`), "w");
  const start = Date.now();
  const result = spawnSync(executable, args, {
    cwd,
    env,
    stdio: ["ignore", fd, fd],
    timeout: 15 * 60_000,
  });
  closeSync(fd);
  evidence.steps.push({
    name,
    exitCode: result.status,
    elapsedMs: Date.now() - start,
    passed: result.status === 0,
  });
  writeFileSync(join(artifact, "evidence.json"), `${JSON.stringify(evidence, null, 2)}\n`);
  if (result.status !== 0) throw new Error(`${name} failed; inspect local artifact ${artifact}`);
}
try {
  run(
    "archive",
    "git",
    [
      "-c",
      `safe.directory=${root.replaceAll("\\", "/")}`,
      "archive",
      "--format=tar",
      `--output=${join(artifact, "source.tar")}`,
      revision,
    ],
    root,
  );
  run("extract", "tar", ["-xf", join(artifact, "source.tar"), "-C", checkout]);
  const lock = readFileSync(join(checkout, "pnpm-lock.yaml"));
  evidence.lockfileSha256 = createHash("sha256").update(lock).digest("hex");
  evidence.packageManager = JSON.parse(
    readFileSync(join(checkout, "package.json"), "utf8"),
  ).packageManager;
  run("pnpm-version", process.execPath, [pnpmCli, "--version"]);
  const actualVersion = readFileSync(join(artifact, "pnpm-version.log"), "utf8").trim();
  if (evidence.packageManager !== `pnpm@${actualVersion}`)
    throw new Error("pnpm version does not match packageManager");
  run("frozen-offline-install", process.execPath, [
    pnpmCli,
    "install",
    "--offline",
    "--frozen-lockfile",
    "--ignore-scripts",
    "--store-dir",
    storeDir,
  ]);
  run("typecheck", process.execPath, [pnpmCli, "typecheck", "--force", "--concurrency=1"]);
  if (!readFileSync(join(checkout, "pnpm-lock.yaml")).equals(lock))
    throw new Error("Lockfile changed during rehearsal");
  evidence.passed = true;
} finally {
  evidence.finishedAt = new Date().toISOString();
  writeFileSync(join(artifact, "evidence.json"), `${JSON.stringify(evidence, null, 2)}\n`);
  console.log(`Local rehearsal artifacts: ${artifact}`);
}
