// 03-05 phase gate: the dev-deployment integration suite for every guardrail
// behavior convex-test cannot emulate (action-cache isolation/hit, rate-limiter,
// kill switch, budget window, real fallback) plus GRDL-02's no-raw-PII needle scan.
//
// The components don't run under convex-test in this repo (03-RESEARCH caveat), so
// this drives the REAL pipeline against a live `convex dev` deployment and judges
// pass/fail by the CLI's output banner — NEVER the exit code (Windows/Node24 crashes
// on exit; see smokeRun.mjs + 01-06-SUMMARY.md).
//
// Cleanup is failure-proof: the kill-switch and budget sections are try/finally-wrapped
// so a mid-section failure can never leave the switch on or the global spend window
// drained — either would brick every later smoke on this deployment (Pitfall 5).
//
// `convex run` prints the function's return value as JSON on stdout (logs go to
// stderr), so `JSON.parse(must(...))` recovers a returned safeTextHash.
import { randomUUID } from "node:crypto";
import { must, pollPass } from "./smokeRun.mjs";

const uid = () => randomUUID().slice(0, 8);
const parse = (out) => JSON.parse(out);

// Same goal string across tenants → same safeText → same safeTextHash → ISOLATED
// cache entries keyed by (tenantId, safeTextHash). Carries email + SSN so redaction
// + the no-raw-PII scan have real needles. cache=1 routes THROUGH preCall + the cache.
const RAW_EMAIL = "jane.doe@example.com";
const RAW_SSN = "123-45-6789";
const PII_GOAL = `SMOKE::route=direct_llm::cache=1:: email ${RAW_EMAIL} about SSN ${RAW_SSN}`;

/** Seed one request and wait until its review gate is armed, then reject to close it.
 *  All assertions read persisted append-only/content-plane rows that survive the
 *  rejection, so asserting AFTER the reject is safe (and avoids a wait primitive). */
async function seedThroughReview(tenant, goal, cid) {
  must("smoke:seedPipeline", { correlationId: cid, route: "direct_llm", tenant, goal });
  // pollPass retries sendDecision until the gate arms (it throws "no pending review
  // gate" until route+draft complete), then rejects — the wait AND the close in one.
  await pollPass("review:sendDecision", { correlationId: cid, attempt: 0, decision: "reject" });
}

console.log("[smoke:guardrails] 1/6 redaction + no-raw-PII (GRDL-01/02)");
{
  const cid = `grd-pii-${uid()}`;
  await seedThroughReview("smokeA", PII_GOAL, cid);
  const { safeTextHash } = parse(
    must("smokeAssert:assertRedacted", { correlationId: cid, placeholders: ["[EMAIL_1]", "[SSN_1]"] }),
  );
  must("smokeAssert:assertNoRawPii", { correlationId: cid, safeTextHash, needles: [RAW_EMAIL, RAW_SSN] });
  console.log(`  ok — redacted, hash=${safeTextHash.slice(0, 8)}, zero raw PII in any log plane`);

  console.log("[smoke:guardrails] 2/6 cache isolation (two tenants) + model-free hit (GRDL-04)");
  // Second tenant, identical goal → its OWN cache entry → a second real draft run.
  const cidB = `grd-cacheB-${uid()}`;
  await seedThroughReview("smokeB", PII_GOAL, cidB);
  must("smokeAssert:assertLlmCalledCount", { safeTextHash, tenantId: "smokeA", stage: "draft", expected: 1 });
  must("smokeAssert:assertLlmCalledCount", { safeTextHash, tenantId: "smokeB", stage: "draft", expected: 1 });

  // Same tenant repeats the identical goal → served from cache, NO new model call.
  const cidRepeat = `grd-cacheHit-${uid()}`;
  await seedThroughReview("smokeA", PII_GOAL, cidRepeat);
  must("smokeAssert:assertLlmCalledCount", { safeTextHash, tenantId: "smokeA", stage: "draft", expected: 1 });
  console.log("  ok — smokeA=1, smokeB=1 (isolated), smokeA repeat still 1 (cache hit, no model call)");
}

console.log("[smoke:guardrails] 3/6 real primary-failure fallback (GRDL-05)");
{
  const cid = `grd-fb-${uid()}`;
  const goal = "SMOKE::route=direct_llm::cache=1::fail=primary:: draft a note";
  await seedThroughReview("smokeFb", goal, cid);
  const { safeTextHash } = parse(must("smokeAssert:assertRedacted", { correlationId: cid }));
  must("smokeAssert:assertFallback", { safeTextHash });
  console.log(`  ok — llm.fallback audited for hash=${safeTextHash.slice(0, 8)}, request still reached review`);
}

console.log("[smoke:guardrails] 4/6 kill switch blocks at the governed terminal (GRDL-06)");
try {
  must("guardrails:setKillSwitch", { on: true });
  const cid = `grd-kill-${uid()}`;
  must("smoke:seedPipeline", { correlationId: cid, route: "direct_llm", tenant: "smokeKill", goal: PII_GOAL });
  await pollPass("smokeAssert:assertBlocked", { correlationId: cid, reason: "kill_switch" });
  console.log("  ok — blocked (kill_switch), no dead letter");
} finally {
  must("guardrails:setKillSwitch", { on: false });
}

console.log("[smoke:guardrails] 5/6 daily budget: prepare-path AND mid-flight preCall (GRDL-06)");
try {
  // A parks at review BEFORE the drain, so its regenerate hits preCall (not prepare).
  const cidA = `grd-budgetA-${uid()}`;
  const goalA = `SMOKE::route=direct_llm::cache=1:: budget probe ${uid()}`;
  must("smoke:seedPipeline", { correlationId: cidA, route: "direct_llm", tenant: "smokeBudget", goal: goalA });
  await pollPass("smokeAssert:assertAtReview", { correlationId: cidA });

  must("smoke:drainDailySpend", {});

  // B is fresh → blocked at prepare's daily-spend check.
  const cidB = `grd-budgetB-${uid()}`;
  must("smoke:seedPipeline", { correlationId: cidB, route: "direct_llm", tenant: "smokeBudget", goal: PII_GOAL });
  await pollPass("smokeAssert:assertBlocked", { correlationId: cidB, reason: "daily_budget_exhausted" });

  // A regenerates mid-flight → llm.draft preCall re-checks the drained window → blocked
  // (NOT failed; assertBlocked's no-deadLetters check proves it never touched the DLQ).
  await pollPass("review:sendDecision", { correlationId: cidA, attempt: 0, decision: "regenerate" });
  await pollPass("smokeAssert:assertBlocked", { correlationId: cidA, reason: "daily_budget_exhausted" });
  console.log("  ok — B blocked at prepare, A blocked mid-flight (preCall), neither dead-lettered");
} finally {
  must("smoke:resetDailySpend", {});
}

console.log("[smoke:guardrails] 6/6 submit rate limiter rejects the 6th consume (GRDL-06)");
must("smoke:assertSubmitRateLimited", {});
console.log("  ok — token bucket capacity 5 enforced");

console.log("[smoke:guardrails] PASSED");
