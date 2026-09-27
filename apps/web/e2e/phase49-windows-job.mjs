import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { Phase49LifecycleError } from "./phase49-stack-lifecycle.mjs";

const brokerPath = join(import.meta.dirname, "phase49-windows-job-broker.ps1");
const repo = resolve(import.meta.dirname, "../../../");

function failure(code) {
  return new Phase49LifecycleError(code, "backend-job");
}

function channel(child) {
  let buffer = "";
  let ended = false;
  let invalid = false;
  const queue = [];
  const waiters = [];
  let finishExit;
  const exited = new Promise((done) => {
    finishExit = done;
  });
  function deliver(message) {
    const waiter = waiters.shift();
    if (waiter) waiter(message);
    else queue.push(message);
  }
  child.stdout.on("data", (chunk) => {
    buffer += chunk.toString("utf8");
    if (buffer.length > 4096) {
      invalid = true;
      buffer = "";
      deliver(null);
      return;
    }
    let newline = buffer.indexOf("\n");
    while (newline >= 0) {
      const line = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      try {
        const message = JSON.parse(line);
        if (!message || typeof message !== "object" || typeof message.event !== "string")
          throw new Error("invalid event");
        deliver(message);
      } catch {
        invalid = true;
        deliver(null);
      }
      newline = buffer.indexOf("\n");
    }
  });
  child.once("error", () => {
    ended = true;
    finishExit({ code: null, error: true });
    deliver(null);
  });
  child.once("exit", (code, signal) => {
    ended = true;
    finishExit({ code, signal });
    deliver(null);
  });
  async function receive(timeoutMs = 25000) {
    if (invalid) throw failure("JOB_PROTOCOL_INVALID");
    if (queue.length) {
      const item = queue.shift();
      if (item) return item;
      throw failure("JOB_BROKER_EXITED");
    }
    if (ended) throw failure("JOB_BROKER_EXITED");
    let timer;
    let pending;
    const item = await Promise.race([
      new Promise((done) => {
        pending = done;
        waiters.push(done);
      }),
      new Promise((done) => {
        timer = setTimeout(() => {
          const index = waiters.indexOf(pending);
          if (index >= 0) waiters.splice(index, 1);
          done(null);
        }, timeoutMs);
      }),
    ]);
    clearTimeout(timer);
    if (!item || invalid) throw failure("JOB_BROKER_UNOBSERVED");
    return item;
  }
  return { receive, exited };
}

async function exitWithin(child, exited, timeoutMs = 10000) {
  let timer;
  const result = await Promise.race([
    exited,
    new Promise((done) => {
      timer = setTimeout(() => done(null), timeoutMs);
    }),
  ]);
  clearTimeout(timer);
  if (result) return result;
  child.kill("SIGTERM"); // exact captured broker; closing its sole job handle kills owned members
  const forced = await Promise.race([
    exited,
    new Promise((done) => setTimeout(() => done(null), 5000)),
  ]);
  if (!forced) throw failure("JOB_BROKER_TERMINATION_UNOBSERVED");
  return forced;
}

/** The broker gates execution until assignment to a kill-on-close Windows job. */
export async function startWindowsJob({ binary, args, cwd, env }) {
  if (process.platform !== "win32" || !existsSync(brokerPath)) throw failure("JOB_UNAVAILABLE");
  const child = spawn(
    "pwsh.exe",
    ["-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-File", brokerPath],
    { cwd: repo, env, stdio: ["pipe", "pipe", "ignore"], windowsHide: true },
  );
  child.stdin.on("error", () => {}); // closed protocol reports failure; never surface raw pipe errors
  const protocol = channel(child);
  try {
    const request = JSON.stringify({ binary, args, cwd });
    if (request.length > 32768) throw failure("JOB_REQUEST_INVALID");
    child.stdin.write(`${request}\n`);
    const ready = await protocol.receive();
    if (
      ready.event !== "ready" ||
      !Number.isInteger(ready.brokerPid) ||
      ready.brokerPid !== child.pid ||
      !Number.isInteger(ready.gatePid) ||
      !Number.isInteger(ready.backendPid) ||
      ready.memberCount < 2
    )
      throw failure("JOB_START_UNVERIFIED");
    return {
      child,
      protocol,
      brokerPid: child.pid,
      gatePid: ready.gatePid,
      backendPid: ready.backendPid,
    };
  } catch (error) {
    child.stdin.end(); // owner EOF triggers broker job close, including startup failures
    try {
      await exitWithin(child, protocol.exited);
    } catch (cleanupError) {
      throw new AggregateError([error, cleanupError], "JOB_START_AND_CLEANUP_FAILED");
    }
    throw error;
  }
}

export async function queryWindowsJobMembers(job) {
  job.child.stdin.write("members\n");
  const message = await job.protocol.receive(5000);
  if (
    message.event !== "members" ||
    !Array.isArray(message.pids) ||
    !message.pids.every((pid) => Number.isInteger(pid) && pid > 0)
  )
    throw failure("JOB_MEMBERSHIP_UNVERIFIED");
  return message.pids;
}

export async function stopWindowsJob(job) {
  try {
    if (job.child.exitCode !== null || job.child.signalCode !== null)
      throw failure("JOB_BROKER_EARLY_EXIT");
    job.child.stdin.write("stop\n");
    const message = await job.protocol.receive(10000);
    const result = await exitWithin(job.child, job.protocol.exited);
    if (message.event !== "stopped" || message.observed !== true || result.code !== 0)
      throw failure("JOB_TERMINATION_UNVERIFIED");
    return { stopped: true, brokerPid: job.brokerPid, backendPid: job.backendPid };
  } catch (error) {
    job.child.stdin.end();
    try {
      await exitWithin(job.child, job.protocol.exited);
    } catch (cleanupError) {
      throw new AggregateError([error, cleanupError], "JOB_STOP_AND_CLEANUP_FAILED");
    }
    throw error;
  }
}
