// OPSG-06 automated proof: run the first migration against the live dev
// deployment and assert it recorded a completed (success) state. "A migration
// that has never run is a migration that does not work."
//
// Reuses smokeRun (must/pollPass), which judge pass/fail by the CLI's OUTPUT —
// the convex CLI returns a bogus non-zero exit on Windows/Node24 even on success.
// Requires a running `convex dev` (NOT --once — the workpool must stay up).
import { must, pollPass } from "./smokeRun.mjs";

console.log("[smoke:migration] running migrations:backfillRequestDefaults via the runner...");
must("migrations:run", { fn: "migrations:backfillRequestDefaults" });

console.log("[smoke:migration] asserting the migration recorded a completed state...");
await pollPass("smokeAssert:assertMigrationRan", {});

console.log("[smoke:migration] PASSED — backfillRequestDefaults ran and is tracked as success");
