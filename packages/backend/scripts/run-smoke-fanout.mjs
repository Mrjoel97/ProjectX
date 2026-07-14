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

const parse = (out) => JSON.parse(out);
const N = 3;
const cids = Array.from({ length: N }, () => `smoke-fanout-${randomUUID()}`);
const failIndex = N - 1;
const failCid = cids[failIndex];
const siblingCids = cids.filter((c) => c !== failCid);
const recipients = cids.map((_, i) => `recipient${i}@smoke.example`);
// Distinctive content needles that must NEVER surface in a log plane (SC5 redaction).
const subjectNeedle = `SUBJ-SECRET-${randomUUID().slice(0, 8)}`;
const bodyNeedle = `BODY-SECRET-${randomUUID().slice(0, 8)}`;
// CKPT-03 (03.4-04): per-recipient personalization — each recipient carries a DISTINCT tailored
// body under the SHARED subject (the INVERSE of the shared attachment). Each distinct body needle
// must ALSO be ABSENT from every audit/deadLetters/telemetry row (§4) — a tailored body is
// content-plane only, exactly like the shared body/subject.
const recipientBodies = cids.map((_, i) => `TAILORED-SECRET-${i}-${randomUUID().slice(0, 8)}`);
// CKPT-02 (V6): a generated attachment rides the governed fan-out. The stored PDF's byte
// marker (and its base64) must NEVER appear in a log plane — refs only (storageId/filename/
// size/counts), never the file bytes (CLAUDE.md §4).
const pdfMarker = `PDFBYTES-SECRET-${randomUUID().slice(0, 8)}`;
const pdfMarkerB64 = Buffer.from(pdfMarker).toString("base64");
const attachmentFilename = "smoke-proposal.pdf";

console.log("[smoke:fanout] storing a fixed-bytes PDF for the shared attachment...");
const { storageId, size } = parse(must("smoke:storeSmokePdf", { marker: pdfMarker }));

console.log(`[smoke:fanout] seeding ${N} recipients (1 forced-fail: ${failCid}) + 1 shared attachment + distinct per-recipient bodies`);
must("smoke:seedFanout", {
  correlationIds: cids,
  recipients,
  failIndex,
  subjectNeedle,
  bodyNeedle,
  recipientBodies, // CKPT-03: distinct body per recipient, shared subject
  attachment: { storageId, filename: attachmentFilename, size },
});

console.log("[smoke:fanout] asserting: the ONE attachment fanned to every recipient (shared ref, V6)...");
must("smokeAssert:assertFanoutAttachmentShared", { correlationIds: cids });

console.log("[smoke:fanout] asserting: DISTINCT per-recipient bodies under a SHARED subject (CKPT-03, inverse of the shared attachment)...");
must("smokeAssert:assertFanoutBodiesDistinct", { correlationIds: cids });

console.log("[smoke:fanout] polling: every non-fail recipient reached awaiting_reauth|sent...");
await pollPass("smokeAssert:assertFanoutReachedAll", { correlationIds: cids, failCid });

console.log("[smoke:fanout] polling: forced-fail row dead-lettered in isolation...");
await pollPass("smokeAssert:assertRecipientDeadLettered", { correlationId: failCid, siblingCids });

console.log("[smoke:fanout] asserting: one terminal per recipient (write-once)...");
await pollPass("smokeAssert:assertFanoutIdempotent", { correlationIds: cids });

console.log("[smoke:fanout] asserting: no raw email content (incl. each distinct tailored body) OR attachment bytes in any log plane...");
const needles = [subjectNeedle, bodyNeedle, ...recipientBodies, ...recipients, pdfMarker, pdfMarkerB64];
await pollPass("smokeAssert:assertNoRawPiiFanout", { correlationIds: cids, needles });

console.log("[smoke:fanout] PASSED");
