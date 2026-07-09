// Minimal `npx convex run` helper for the smoke scripts. Invokes the local
// convex CLI via node (no shell), passing JSON args as a single argv element so
// Windows shell quoting never mangles them.
//
// IMPORTANT: on Windows + Node 24 the convex CLI process can crash during exit
// teardown ("Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)"), returning
// a bogus non-zero exit code even when the function ran fine. So success/failure
// is decided by the CLI's OUTPUT (the "Failed to run function" / "Uncaught Error"
// banner), NOT by the exit code.
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

const backendDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const convexBin = resolve(backendDir, "node_modules/convex/bin/main.js");

// Distinctive markers the convex CLI prints on a genuine function failure.
const FAILURE = /Failed to run function|Uncaught Error|isn't running|not listening/;

function invoke(fn, args) {
  const res = spawnSync(process.execPath, [convexBin, "run", fn, JSON.stringify(args)], {
    cwd: backendDir,
    encoding: "utf8",
  });
  const err = res.stderr || "";
  const out = res.stdout || "";
  if (res.error) throw new Error(`spawn failed for ${fn}: ${res.error.message}`);
  if (FAILURE.test(err)) throw new Error(err.trim());
  return out;
}

/** Run once; on failure print the deployment's output and rethrow. */
export function must(fn, args = {}) {
  try {
    return invoke(fn, args);
  } catch (e) {
    console.error(e.message);
    throw e;
  }
}

/** Poll until the function succeeds (workflow completion is async). */
export async function pollPass(fn, args = {}, { tries = 30, delayMs = 1000 } = {}) {
  let last;
  for (let i = 0; i < tries; i++) {
    try {
      invoke(fn, args);
      return;
    } catch (e) {
      last = e;
      await sleep(delayMs);
    }
  }
  throw new Error(`${fn} did not pass after ${tries} tries:\n${last?.message}`);
}

export { sleep };
