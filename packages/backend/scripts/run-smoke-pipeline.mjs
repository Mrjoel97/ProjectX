// 02-06 full-spine smoke: drive the REAL pipelineWorkflow end-to-end against the
// dev deployment — route → draft → review gate (approve) → Gmail delivery.
//
// The seeded goal carries the llm.ts SMOKE::route sentinel so route/draft run
// deterministically without an LLM key. Tenant "smoke" has no Gmail token, so
// delivery lands in `awaiting_reauth` (the automatable half of DLVR-01/03 — a real
// send needs human OAuth consent, manual per 02-VALIDATION.md). With a token present
// the same path reaches `sent` + a telemetry row (assertPipelineDelivered accepts both).
import { randomUUID } from "node:crypto";
import { must, pollPass } from "./smokeRun.mjs";

const cid = `smoke-pipeline-${randomUUID()}`;
console.log(`[smoke:pipeline] seeding direct_llm spine (cid=${cid})`);
must("smoke:seedPipeline", { correlationId: cid, route: "direct_llm" });

// Approve at the gate. pollPass retries until the gate has armed (sendDecision throws
// "no pending review gate" until then), then sends exactly one approve.
console.log("[smoke:pipeline] approving at the review gate...");
await pollPass("review:sendDecision", { correlationId: cid, attempt: 0, decision: "approve" });

console.log("[smoke:pipeline] polling for delivery outcome (awaiting_reauth|sent)...");
await pollPass("smokeAssert:assertPipelineDelivered", { correlationId: cid });

console.log("[smoke:pipeline] PASSED");
