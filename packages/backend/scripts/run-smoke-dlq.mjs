// OPSG-04 smoke: a deliberately failing workflow lands in deadLetters via
// onComplete, with payload + error + correlationId, plus a deadletter.written
// audit event. Runs against the dev deployment.
import { randomUUID } from "node:crypto";
import { must, pollPass } from "./smokeRun.mjs";

const cid = `smoke-dlq-${randomUUID()}`;
console.log(`[smoke:dlq] starting failing pipeline (cid=${cid})`);
must("smoke:runFailingPipeline", { correlationId: cid });

console.log("[smoke:dlq] polling for deadLetters row + deadletter.written audit...");
await pollPass("smokeAssert:assertDeadLetter", { correlationId: cid });

console.log("[smoke:dlq] PASSED");
