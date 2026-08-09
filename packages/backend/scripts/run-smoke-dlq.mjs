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

// AGNT-03: a mis-route through the REAL pipeline must dead-letter (never a silent
// default) AND drive the request to the `failed` terminal (status=failed + one failed
// telemetry row — proving no request hangs at "routing", OPSG-01). sub_agent is now an
// implemented route (draft → review → send), so unknown_route is the mis-route case.
// OPSG-05 (07-05): assertDeadLetterReason now also asserts the `deadletter` USER notification
// fired beside the audit (this seedPipeline path carries a requestId ref, so notify runs).
for (const [route, reason] of [["unknown", "unknown_route"]]) {
  const c = `smoke-agnt03-${route}-${randomUUID()}`;
  console.log(`[smoke:dlq] AGNT-03 ${route} -> ${reason} (cid=${c})`);
  must("smoke:seedPipeline", { correlationId: c, route });
  await pollPass("smokeAssert:assertDeadLetterReason", { correlationId: c, reason });
  console.log(
    `[smoke:dlq] AGNT-03 ${route} PASSED (distinct reason + failed terminal + deadletter notify)`,
  );
}

console.log("[smoke:dlq] PASSED");
