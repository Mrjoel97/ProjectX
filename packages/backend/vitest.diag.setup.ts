// TEMPORARY DIAGNOSTIC — not part of the suite. Delete after the flake audit.
//
// Inventories the two ways convex-test's scheduled work can bite a test file:
//   (a) the job threw and convex-test SWALLOWED it — index.js:1125 catches, console.errors,
//       and marks the job `failed`. Invisible unless a test asserts the job's effect.
//       This is the `Component "X" is not registered` shape that killed onboarding §4.2.
//   (b) the job threw OUTSIDE that try/catch (the two `invariant error: Unexpected scheduled
//       function state` throws, and the state-patch blocks) — that rejects the promise nothing
//       awaits, so it lands as an unhandled rejection and Vitest fails the whole FILE.
//
// Both are latent every run; only (b) plus load makes a file "drop". Printing them turns a
// 1-in-N flake into a deterministic inventory.
import { afterAll, expect } from "vitest";

const swallowed: string[] = [];
const rejected: string[] = [];

const origError = console.error;
console.error = (...args: unknown[]) => {
  if (typeof args[0] === "string" && args[0].startsWith("Error when running scheduled function")) {
    swallowed.push(args.map((a) => (a instanceof Error ? a.message : String(a))).join(" "));
  }
  origError(...args);
};

// edge-runtime keeps `process`, but guard anyway — a missing hook must not fail the suite.
try {
  process.on("unhandledRejection", (r: unknown) => {
    rejected.push(r instanceof Error ? r.message : String(r));
  });
} catch {
  /* no process.on in this environment */
}

afterAll(async () => {
  // Give already-fired-but-unsettled jobs one macrotask to land, so we attribute them to the
  // file that scheduled them rather than to whichever file runs next.
  await new Promise((r) => setTimeout(r, 0));

  const file = String(expect.getState().testPath ?? "unknown").split(/[\\/]/).pop();
  for (const m of swallowed) origError(`[DIAG-SWALLOWED] ${file} :: ${m.replace(/\s+/g, " ").slice(0, 220)}`);
  for (const m of rejected) origError(`[DIAG-REJECTED] ${file} :: ${m.replace(/\s+/g, " ").slice(0, 220)}`);
});
