// Criterion 4 smoke: the awaitEvent-timeout race, both branches, against the
// dev deployment.
//   Gate A: send a decision → workflow resumes on the decision branch AND the
//           scheduled timeout is canceled (pendingTimeouts row cleared).
//   Gate B: send nothing → the scheduled timeout fires the escalation branch.
// Events are namespaced by correlationId so a stale timeout can never cross gates.
import { randomUUID } from "node:crypto";
import { must, pollPass, sleep } from "./smokeRun.mjs";

// --- Gate A: decision cancels the timeout ---
const cidA = `smoke-review-decide-${randomUUID()}`;
console.log(`[smoke:reviewgate] gate A / decision (cid=${cidA})`);
// Long timeout so it can only fire if cancellation fails.
must("smoke:startReviewGate", { correlationId: cidA, timeoutMs: 60000 });
// Retry until the gate has armed (pendingTimeouts row exists), then decide.
await pollPass("review:sendDecision", { correlationId: cidA, decision: "approve" });
await pollPass("smokeAssert:assertReviewOutcome", { correlationId: cidA, expected: "decision" });
console.log("[smoke:reviewgate] gate A PASSED (decision branch + timeout canceled)");

// --- Gate B: no decision → timeout fires ---
const cidB = `smoke-review-timeout-${randomUUID()}`;
console.log(`[smoke:reviewgate] gate B / timeout (cid=${cidB})`);
must("smoke:startReviewGate", { correlationId: cidB, timeoutMs: 3000 });
console.log("[smoke:reviewgate] waiting for the 3s timeout to fire...");
await sleep(5000);
await pollPass("smokeAssert:assertReviewOutcome", { correlationId: cidB, expected: "timeout" });
console.log("[smoke:reviewgate] gate B PASSED (timeout escalation branch)");

console.log("[smoke:reviewgate] PASSED");
