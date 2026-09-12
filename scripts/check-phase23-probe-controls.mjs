// Offline CI bridge. Importing these tests performs no authentication or provider calls.
if (process.argv.length !== 3 || process.argv[2] !== "--self-check") {
  throw new Error("Use --self-check for offline Phase 23 browser budget controls.");
}
await import("./check-phase23-probe-controls.test.mjs");
