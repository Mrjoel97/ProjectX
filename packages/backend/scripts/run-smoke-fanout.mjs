// 03.1-04 fan-out smoke: drive the REAL deliverApprovedPlan workflow against the dev
// deployment — one gmail.send step per recipient row, grouped by planId.
//
// Tenant "smoke" has no Gmail token, so every well-formed recipient lands in
// `awaiting_reauth` (the automatable half of DLVR-01/03 — a real send needs human OAuth,
// manual per 03.1-VALIDATION). ONE recipient's goal carries the SMOKE::fail sentinel so
// gmail.send throws terminally → the workflow's try/catch dead-letters THAT row in
// isolation while the rest still reach. Proves SC4 (fan-out + write-once terminal) and
// SC5 (per-recipient isolation + no raw email content in any audit/DLQ/telemetry row).
import { randomUUID } from "node:crypto";
import { must, pollPass } from "./smokeRun.mjs";

const N = 3;
const cids = Array.from({ length: N }, () => `smoke-fanout-${randomUUID()}`);
const failIndex = N - 1;
const failCid = cids[failIndex];
const siblingCids = cids.filter((c) => c !== failCid);
const recipients = cids.map((_, i) => `recipient${i}@smoke.example`);
// Distinctive content needles that must NEVER surface in a log plane (SC5 redaction).
const subjectNeedle = `SUBJ-SECRET-${randomUUID().slice(0, 8)}`;
const bodyNeedle = `BODY-SECRET-${randomUUID().slice(0, 8)}`;

console.log(`[smoke:fanout] seeding ${N} recipients (1 forced-fail: ${failCid})`);
must("smoke:seedFanout", { correlationIds: cids, recipients, failIndex, subjectNeedle, bodyNeedle });

console.log("[smoke:fanout] polling: every non-fail recipient reached awaiting_reauth|sent...");
await pollPass("smokeAssert:assertFanoutReachedAll", { correlationIds: cids, failCid });

console.log("[smoke:fanout] polling: forced-fail row dead-lettered in isolation...");
await pollPass("smokeAssert:assertRecipientDeadLettered", { correlationId: failCid, siblingCids });

console.log("[smoke:fanout] asserting: one terminal per recipient (write-once)...");
await pollPass("smokeAssert:assertFanoutIdempotent", { correlationIds: cids });

console.log("[smoke:fanout] asserting: no raw email content in any log plane...");
const needles = [subjectNeedle, bodyNeedle, ...recipients];
await pollPass("smokeAssert:assertNoRawPiiFanout", { correlationIds: cids, needles });

console.log("[smoke:fanout] PASSED");
