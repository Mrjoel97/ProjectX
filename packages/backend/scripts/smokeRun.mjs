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
import { dirname, resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const backendDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const convexBin = resolve(backendDir, "node_modules/convex/bin/main.js");

// Distinctive markers the convex CLI prints on a genuine function failure.
const FAILURE = /Failed to run function|Uncaught Error|isn't running|not listening/;
const BACKEND_UNAVAILABLE = /isn't running|not listening/i;

/** Reduce process/CLI failures to the only two facts preflight may safely reveal. Never return or
 * interpolate stderr, error messages, paths, URLs, lengths, or credential-derived material. */
export function safeConvexFailureReason({ spawnErrorCode, stderr = "" } = {}) {
  return spawnErrorCode === "ETIMEDOUT" || BACKEND_UNAVAILABLE.test(stderr)
    ? "backend_unavailable"
    : "transport_error";
}

class ConvexInvocationFailure extends Error {
  constructor(message, safeReason) {
    super(message);
    this.safeReason = safeReason;
  }
}

/**
 * WHICH DEPLOYMENT. `convex run` with no flag targets whatever the local config points at — the DEV
 * deployment — and every pack eval, smoke script and browser provisioning step goes through here.
 * That is correct and safe as a default: an unflagged run can never touch production by accident.
 *
 * **IT ALSO MEANT THE PACK GATE COULD NOT BE SATISFIED ON PRODUCTION AT ALL**, which is not a
 * config problem but a missing capability: evidence lives on the skills ROW of ONE deployment, so a
 * dev run can never certify a prod candidate (see `docs/playbooks/skill-registry.md`). Set
 * `PIKAR_CONVEX_TARGET=prod` to pass `--prod` through. It is an EXPLICIT opt-in per invocation and
 * there is deliberately no way to make it the default — a harness that could silently point at
 * production is a harness that eventually will.
 */
const TARGET_ARGS = process.env.PIKAR_CONVEX_TARGET === "prod" ? ["--prod"] : [];

export function convexSpawnOptions(timeoutMs) {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error("CONVEX_TIMEOUT_INVALID");
  return { encoding: "utf8", timeout: timeoutMs, killSignal: "SIGTERM" };
}

function invoke(fn, args, timeoutMs) {
  const res = spawnSync(
    process.execPath,
    [convexBin, "run", ...TARGET_ARGS, fn, JSON.stringify(args)],
    {
      cwd: backendDir,
      ...(timeoutMs === undefined ? { encoding: "utf8" } : convexSpawnOptions(timeoutMs)),
    },
  );
  const err = res.stderr || "";
  const out = res.stdout || "";
  if (res.error)
    throw new ConvexInvocationFailure(
      `spawn failed for ${fn}: ${res.error.message}`,
      safeConvexFailureReason({ spawnErrorCode: res.error.code, stderr: err }),
    );
  if (FAILURE.test(err))
    throw new ConvexInvocationFailure(err.trim(), safeConvexFailureReason({ stderr: err }));
  return out;
}

/** `convex run` prints JSON even for void results. An empty final stdout is a transport
 * failure, not a malformed function response; the caller may first opt into one safe read retry. */
export function requireConvexResult(output) {
  if (typeof output === "string" && output.trim() !== "") return output;
  const error = new Error("CONVEX_EMPTY_RESULT");
  error.safeReason = "transport_error";
  throw error;
}

/** Run once; on failure print the deployment's output and rethrow.
 *
 * `retryOnEmpty` (16-09) — retry ONCE when stdout is EMPTY and no failure banner was printed.
 * That combination is never a real result: `convex run` prints the return value as JSON on every
 * success. It is the Windows/Node 24 exit-teardown crash this module's header already documents,
 * surfacing one layer later — the CLI dies after the function ran but before stdout was flushed,
 * so the caller does `JSON.parse("")` and reports `Unexpected end of JSON input`, which reads like
 * a case failure and is not one. Measured cost: it took a PASS away from eval run `89e5ee98`
 * fixture 33, whose correct verdict (1 search, 0 sources, insufficient_evidence) is in the audit
 * trail.
 *
 * OPT-IN, never the default, because `must` also wraps `llm:runCockpitAgent` (a retry BILLS a
 * second model turn) and `skills:recordEvalEvidence` (a retry writes a DUPLICATE evidence row).
 * Only pass it for pure, free, idempotent reads.
 */
export function must(
  fn,
  args = {},
  { retryOnEmpty = false, redactErrors = false, timeoutMs } = {},
) {
  try {
    const out = invoke(fn, args, timeoutMs);
    return requireConvexResult(
      retryOnEmpty && out.trim() === "" ? invoke(fn, args, timeoutMs) : out,
    );
  } catch (e) {
    if (redactErrors) {
      const redacted = new Error("CONVEX_FUNCTION_FAILED");
      redacted.safeReason =
        e?.safeReason === "backend_unavailable" ? "backend_unavailable" : "transport_error";
      throw redacted;
    }
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
