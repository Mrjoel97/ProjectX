import { writeSync } from "node:fs";

export const PREFLIGHT_PASSED_LINE =
  "[eval:golden] provider preflight PASSED (secret-safe; no budget opened)";
export const PREFLIGHT_REFUSED_LINE =
  "[eval:golden] provider preflight REFUSED (secret-safe; no budget opened)";

/**
 * Standalone preflight owns its terminal line and exit code. Backend/CLI errors are deliberately
 * not interpolated: deployment stderr can contain configuration details, while callers need only
 * the fail-closed verdict before deciding whether a paid run is allowed.
 */
export function runStandaloneProviderPreflight({
  check,
  // Synchronous writes are intentional: the caller immediately uses `process.exit(code)`, whose
  // forced termination may truncate asynchronous console output when stdout/stderr are pipes.
  stdout = (line) => writeSync(1, `${line}\n`),
  stderr = (line) => writeSync(2, `${line}\n`),
}) {
  try {
    check();
    stdout(PREFLIGHT_PASSED_LINE);
    return 0;
  } catch {
    stderr(PREFLIGHT_REFUSED_LINE);
    return 2;
  }
}
