// Refuse a delayed workflow_run release when main has advanced past its verified CI SHA.
// --self-test is offline; the normal mode reads only the public remote main ref.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { argv, env, exit, stdout } from "node:process";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const workflow = resolve(root, ".github/workflows/deploy-production.yml");
const sha = /^[0-9a-f]{40}$/;

export function releaseHeadRefusal(expected, remoteOutput) {
  if (!sha.test(expected ?? "")) return "invalid_verified_sha";
  const lines = remoteOutput.trim().split(/\r?\n/);
  if (lines.length !== 1) return "remote_head_unavailable";
  const match = /^([0-9a-f]{40})\trefs\/heads\/main$/.exec(lines[0]);
  if (!match) return "remote_head_unavailable";
  return match[1] === expected ? null : "main_advanced";
}

function workflowGuarded(source) {
  const positions = [...source.matchAll(/node scripts\/check-production-head\.mjs/g)].map(
    (match) => match.index,
  );
  const verified = source.indexOf("- name: Verify checked-out SHA");
  const build = source.indexOf("- name: Build staged Vercel production artifact");
  const backend = source.indexOf("- name: Pin Convex Auth and render route");
  const deployed = source.indexOf("- name: Deploy Convex production backend");
  const promote = source.indexOf("- name: Promote staged Vercel deployment");
  return (
    positions.length === 3 &&
    verified >= 0 &&
    verified < positions[0] &&
    positions[0] < build &&
    build < positions[1] &&
    positions[1] < backend &&
    backend < deployed &&
    deployed < positions[2] &&
    positions[2] < promote
  );
}

function selfTest() {
  const a = "a".repeat(40);
  const b = "b".repeat(40);
  const cases = [
    ["current verified main", releaseHeadRefusal(a, `${a}\trefs/heads/main\n`) === null],
    ["advanced main", releaseHeadRefusal(a, `${b}\trefs/heads/main\n`) === "main_advanced"],
    ["missing head", releaseHeadRefusal(a, "") === "remote_head_unavailable"],
    ["wrong ref", releaseHeadRefusal(a, `${a}\trefs/heads/other\n`) === "remote_head_unavailable"],
    [
      "ambiguous remote",
      releaseHeadRefusal(a, `${a}\trefs/heads/main\n${b}\trefs/heads/main\n`) ===
        "remote_head_unavailable",
    ],
    [
      "invalid CI identity",
      releaseHeadRefusal("not-a-sha", `${a}\trefs/heads/main\n`) === "invalid_verified_sha",
    ],
  ];
  const source = readFileSync(workflow, "utf8");
  cases.push(["three ordered release checks", workflowGuarded(source)]);
  cases.push([
    "removed check refused",
    !workflowGuarded(source.replace("node scripts/check-production-head.mjs", "echo missing")),
  ]);
  for (const [name, ok] of cases) stdout.write(`${ok ? "OK" : "FAIL"} ${name}\n`);
  return cases.every(([, ok]) => ok) ? 0 : 1;
}

if (argv.length === 3 && argv[2] === "--self-test") exit(selfTest());
if (argv.length !== 2) {
  stdout.write("REFUSED invalid release-head invocation\n");
  exit(1);
}
if (!sha.test(env.DEPLOY_SHA ?? "")) {
  stdout.write("REFUSED invalid_verified_sha\n");
  exit(1);
}
const result = spawnSync("git", ["ls-remote", "--exit-code", "origin", "refs/heads/main"], {
  cwd: root,
  encoding: "utf8",
  timeout: 10_000,
  windowsHide: true,
  env: { ...env, GIT_TERMINAL_PROMPT: "0" },
});
const reason =
  result.error || result.status !== 0
    ? "remote_head_unavailable"
    : releaseHeadRefusal(env.DEPLOY_SHA, result.stdout ?? "");
stdout.write(reason ? `REFUSED ${reason}\n` : "PASS verified CI SHA is current main\n");
exit(reason ? 1 : 0);
