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
console.log("[smoke:pipeline] approve→deliver PASSED");

// --- REVW-03: review-inactivity timeout → expired terminal + review.expired notify, NO send ---
const cidExpire = `smoke-pipeline-expire-${randomUUID()}`;
console.log(`[smoke:pipeline] seeding expiry spine (cid=${cidExpire})`);
must("smoke:seedPipeline", { correlationId: cidExpire, route: "direct_llm" });
// fireReviewTimeout throws until the gate has armed; poll fires the SEVEN_DAYS timeout NOW.
console.log("[smoke:pipeline] firing the review timeout...");
await pollPass("smoke:fireReviewTimeout", { correlationId: cidExpire });
console.log("[smoke:pipeline] asserting expired + review.expired notification + NO send...");
await pollPass("smokeAssert:assertReviewExpired", { correlationId: cidExpire });
console.log("[smoke:pipeline] timeout→expired PASSED");

// --- REVW-02: regenerate breach (4 regenerates) → escalated terminal + retry.limit notify, NO send ---
const cidBreach = `smoke-pipeline-breach-${randomUUID()}`;
console.log(`[smoke:pipeline] seeding breach spine (cid=${cidBreach})`);
must("smoke:seedPipeline", { correlationId: cidBreach, route: "direct_llm" });
// MAX_REGENERATE=3: regenerates at attempts 0..2 loop (count 0<3,1<3,2<3); the 4th at
// attempt 3 (count 3>=3) hits classifyReviewDecision's escalate branch — fail closed.
for (let attempt = 0; attempt < 4; attempt++) {
  console.log(`[smoke:pipeline] regenerate #${attempt + 1} (attempt=${attempt})...`);
  await pollPass("review:sendDecision", {
    correlationId: cidBreach,
    attempt,
    decision: "regenerate",
    instruction: "SMOKE::revise please",
  });
}
console.log("[smoke:pipeline] asserting escalated + retry.limit notification + NO send...");
await pollPass("smokeAssert:assertReviewEscalated", { correlationId: cidBreach });
console.log("[smoke:pipeline] breach→escalated PASSED");

console.log("[smoke:pipeline] PASSED");
