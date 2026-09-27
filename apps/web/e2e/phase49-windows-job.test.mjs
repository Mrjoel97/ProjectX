import assert from "node:assert/strict";
import { join } from "node:path";
import test from "node:test";
import { queryWindowsJobMembers, startWindowsJob, stopWindowsJob } from "./phase49-windows-job.mjs";

const onWindows = process.platform === "win32";
const pause = (ms) => new Promise((done) => setTimeout(done, ms));
const syntheticArgs = [
  "-e",
  'const { spawn } = require("node:child_process"); spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore", windowsHide: true }); setInterval(() => {}, 1000);',
];
function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
async function membersWithGrandchild(job) {
  for (let attempt = 0; attempt < 50; attempt++) {
    const members = await queryWindowsJobMembers(job);
    if (members.length >= 3) return members;
    await pause(100);
  }
  throw new Error("synthetic grandchild was not observed in job");
}
async function assertGone(pids) {
  for (let attempt = 0; attempt < 50; attempt++) {
    if (pids.every((pid) => !alive(pid))) return;
    await pause(100);
  }
  assert.deepEqual(pids.filter(alive), [], "all exact owned synthetic job members must be gone");
}
function startSynthetic() {
  return startWindowsJob({
    binary: process.execPath,
    args: syntheticArgs,
    cwd: import.meta.dirname,
    env: { ...process.env, CONVEX_DEPLOYMENT: "", CONVEX_DEPLOY_KEY: "" },
  });
}

test("Windows job stops a gated child and inherited grandchild on normal stop", {
  skip: !onWindows,
}, async () => {
  const job = await startSynthetic();
  try {
    const pids = await membersWithGrandchild(job);
    assert.ok(pids.includes(job.gatePid) && pids.includes(job.backendPid));
    assert.deepEqual(await stopWindowsJob(job), {
      stopped: true,
      brokerPid: job.brokerPid,
      backendPid: job.backendPid,
    });
    await assertGone(pids);
  } finally {
    if (alive(job.brokerPid)) job.child.kill("SIGTERM");
  }
});

test("Windows broker closes its job on owner stdin EOF", { skip: !onWindows }, async () => {
  const job = await startSynthetic();
  try {
    const pids = await membersWithGrandchild(job);
    job.child.stdin.end();
    const result = await Promise.race([job.protocol.exited, pause(10000).then(() => null)]);
    assert.equal(result?.code, 0);
    await assertGone(pids);
  } finally {
    if (alive(job.brokerPid)) job.child.kill("SIGTERM");
  }
});

test("Windows broker fails closed before execution for an invalid launch target", {
  skip: !onWindows,
}, async () => {
  await assert.rejects(
    startWindowsJob({
      binary: join(import.meta.dirname, "missing-phase49-executable.exe"),
      args: [],
      cwd: import.meta.dirname,
      env: process.env,
    }),
    /JOB_START_UNVERIFIED|JOB_BROKER_EXITED|JOB_BROKER_UNOBSERVED/,
  );
});
