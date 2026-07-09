// SC-4 (WORM half) smoke: run the export action against the live dev deployment
// and confirm it takes the stub-skip path cleanly. Reuses smokeRun.must, which
// judges pass/fail by the CLI's OUTPUT — the convex CLI returns a bogus non-zero
// exit code on Windows/Node24 (UV_HANDLE_CLOSING) even on success.
import { must } from "./smokeRun.mjs";

console.log("[smoke:worm] running worm:exportAudit (expecting stub-skip)...");
const out = must("worm:exportAudit", {});

// The action both logs and returns the exact skip line; `must` returns stdout,
// which carries the function's return value, so this match is robust regardless
// of whether the CLI streams console.log to stdout or stderr.
if (!/worm export skipped \(stub\)/.test(out)) {
  console.error(out);
  throw new Error("[smoke:worm] did not observe 'worm export skipped (stub)' in output");
}

console.log("[smoke:worm] PASSED — worm:exportAudit logged 'worm export skipped (stub)'");
