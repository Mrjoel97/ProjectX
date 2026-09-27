import { existsSync, lstatSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { basename, join, relative, resolve } from "node:path";

const ROOT_NAME = /^pikar-phase49-[A-Za-z0-9]{6}$/;
export const OWNERSHIP_MARKER = ".phase49-owned";

export class Phase49LifecycleError extends Error {
  constructor(code, stage, metadata = {}) {
    super(code);
    this.code = code;
    this.stage = stage;
    this.metadata = metadata;
  }
}

/** The root must be the direct, non-symlink child minted by this invocation. */
export function assertOwnedRoot(root, tempBase, ownershipToken) {
  if (typeof ownershipToken !== "string" || ownershipToken.length < 32)
    throw new Phase49LifecycleError("ROOT_IDENTITY_INVALID", "cleanup");
  try {
    const base = realpathSync(tempBase);
    const absolute = resolve(root);
    const stat = lstatSync(absolute);
    if (!stat.isDirectory() || stat.isSymbolicLink())
      throw new Phase49LifecycleError("ROOT_TARGET_INVALID", "cleanup");
    const actual = realpathSync(absolute);
    const child = relative(base, actual);
    if (!ROOT_NAME.test(child) || child !== basename(actual) || relative(base, absolute) !== child)
      throw new Phase49LifecycleError("ROOT_TARGET_INVALID", "cleanup");
    const marker = join(actual, OWNERSHIP_MARKER);
    const markerStat = lstatSync(marker);
    if (
      !markerStat.isFile() ||
      markerStat.isSymbolicLink() ||
      readFileSync(marker, "utf8") !== ownershipToken
    )
      throw new Phase49LifecycleError("ROOT_IDENTITY_INVALID", "cleanup");
    return actual;
  } catch (error) {
    if (error instanceof Phase49LifecycleError) throw error;
    throw new Phase49LifecycleError("ROOT_IDENTITY_UNREADABLE", "cleanup");
  }
}

export async function removeOwnedRoot(root, tempBase, token, options = {}) {
  const actual = assertOwnedRoot(root, tempBase, token);
  options.beforeRemove?.(actual);
  const remove = options.remove ?? ((path) => rmSync(path, { recursive: true, force: true }));
  const exists = options.exists ?? existsSync;
  const pause = options.pause ?? ((ms) => new Promise((done) => setTimeout(done, ms)));
  const attempts = options.attempts ?? 8;
  for (let index = 0; index < attempts; index++) {
    try {
      remove(actual);
    } catch {
      /* Only closed status is reported; never include OS exception text or paths. */
    }
    if (!exists(actual)) return { removed: true, attempts: index + 1 };
    if (index + 1 < attempts) await pause(250);
  }
  throw new Phase49LifecycleError("TEMP_CLEANUP_FAILED", "cleanup", { attempts });
}

/** Register before requesting termination, so an already-observed exit cannot be mistaken for a kill. */
export function trackOwnedChild(child, stage) {
  let finish;
  const exited = new Promise((resolvePromise) => {
    finish = resolvePromise;
  });
  const state = { child, stage, pid: child.pid, exitObserved: false, exited };
  child.once("exit", (code, signal) => {
    state.exitObserved = true;
    state.exitCode = code;
    state.exitSignal = signal;
    finish();
  });
  child.once("error", () => {
    state.startError = true;
    finish();
  });
  return state;
}

export async function stopOwnedChild(state, requestStop, timeoutMs = 5000) {
  if (!state) return { stopped: true, absent: true };
  if (!Number.isInteger(state.pid) || state.exitObserved || state.startError)
    throw new Phase49LifecycleError("PROCESS_IDENTITY_UNVERIFIED", state.stage);
  const result = await requestStop(state.pid);
  if (result !== true)
    throw new Phase49LifecycleError("PROCESS_TERMINATION_REQUEST_FAILED", state.stage);
  let timer;
  const observed = await Promise.race([
    state.exited.then(() => true),
    new Promise((resolvePromise) => {
      timer = setTimeout(() => resolvePromise(false), timeoutMs);
    }),
  ]);
  clearTimeout(timer);
  if (!observed || !state.exitObserved)
    throw new Phase49LifecycleError("PROCESS_TERMINATION_UNOBSERVED", state.stage);
  return { stopped: true, pid: state.pid, exitCode: state.exitCode, exitSignal: state.exitSignal };
}

export function stepFailure(stage, result) {
  return new Phase49LifecycleError("STEP_FAILED", stage, {
    exitCode: Number.isInteger(result.status) ? result.status : null,
    signal:
      typeof result.signal === "string" && /^[A-Z0-9]+$/.test(result.signal) ? result.signal : null,
    systemCode:
      typeof result.error?.code === "string" && /^[A-Z0-9_]+$/.test(result.error.code)
        ? result.error.code
        : null,
  });
}

export function concludeRun(primary, cleanupFailures) {
  if (primary && cleanupFailures.length)
    throw new AggregateError([primary, ...cleanupFailures], "PHASE49_RUN_AND_CLEANUP_FAILED");
  if (primary) throw primary;
  if (cleanupFailures.length) throw new AggregateError(cleanupFailures, "PHASE49_CLEANUP_FAILED");
}

/** Closed diagnostics only. Never serialize arbitrary Error.message, stdout or stderr. */
export function safeFailureMetadata(error) {
  const failures = error instanceof AggregateError ? error.errors : [error];
  return failures.map((failure) => {
    if (!(failure instanceof Phase49LifecycleError)) return { code: "UNCLASSIFIED" };
    return { code: failure.code, stage: failure.stage, ...failure.metadata };
  });
}
