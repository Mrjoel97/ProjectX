#!/usr/bin/env node
// Offline content-plane review preparation. Never authenticates a reviewer or records release evidence.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildVerticalReviewPacket, referenceProfileText } from "./vertical-eval-review.mjs";
import { compileSources, sourceManifest } from "./vertical-eval-sources.mjs";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const requireFact = (condition) => assert(condition, "VERTICAL_REVIEW_INPUT_INVALID");

function boundedRead(path, maximum) {
  const size = statSync(path).size;
  requireFact(size > 0 && size <= maximum);
  const bytes = readFileSync(path);
  requireFact(bytes.byteLength === size && bytes.byteLength <= maximum);
  return bytes;
}

/** Exact fixture bytes must still match the run; edited fixtures require their original revision. */
export function prepareVerticalReview({ report, caseId, fixture, reply }) {
  requireFact(
    report &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(report.runId) &&
      report.sourceMode === "fixed-owned-fixtures" &&
      report.semanticReviewRequired === true &&
      report.releaseEvidenceRecorded === false &&
      report.activated === false &&
      /^[a-z0-9][a-z0-9-]{0,63}$/.test(caseId),
  );
  const matches = (rows) => {
    requireFact(Array.isArray(rows) && rows.length <= 64);
    const selected = rows.filter((row) => (row.caseId ?? row.pin?.caseId) === caseId);
    requireFact(selected.length === 1);
    return selected[0];
  };
  const manifest = matches(report.manifest);
  const observed = matches(report.observations);
  const archive = matches(report.outputArchives);
  const qualification = observed.observation;
  const pin = manifest.pin;
  requireFact(
    pin.runId === report.runId &&
      qualification.runId === report.runId &&
      qualification.caseId === caseId &&
      qualification.verticalId === pin.verticalId &&
      qualification.candidateVersion === pin.candidateVersion &&
      qualification.bodyHash === pin.bodyHash &&
      qualification.requestHash === pin.requestHash &&
      qualification.caseHash === pin.caseHash &&
      observed.caseHash === pin.caseHash &&
      `${pin.verticalId}-${fixture.id}` === caseId &&
      sha(JSON.stringify(fixture)) === pin.caseHash,
  );
  requireFact(typeof reply === "string" && Buffer.byteLength(reply) <= 2 * 1024 * 1024);
  requireFact(sha(reply) === archive.sha256 && archive.sha256 === qualification.replySha256);
  const compiled = compileSources(pin.verticalId, fixture);
  const compiledManifest = sourceManifest(compiled);
  assert.deepEqual(compiledManifest, manifest.sourceManifest, "VERTICAL_REVIEW_SOURCE_DRIFT");
  assert.deepEqual(compiledManifest, observed.sourceManifest, "VERTICAL_REVIEW_SOURCE_DRIFT");
  const refs = new Map();
  const add = (docId, hash) => {
    requireFact(typeof docId === "string" && /^[a-zA-Z0-9_-]{1,128}$/.test(docId));
    requireFact(!refs.has(docId) || refs.get(docId) === hash);
    refs.set(docId, hash);
  };
  requireFact(Array.isArray(qualification.sourceReads) && qualification.sourceReads.length <= 5);
  for (const source of qualification.sourceReads) add(source.docId, source.chunkHash);
  for (const source of [qualification.dataSource, qualification.visualSource])
    if (source) add(source.docId, source.sha256);
  const sourceSnapshots = [...refs].map(([docId, hash]) => {
    const index = compiledManifest.findIndex((source) => source.sha256 === hash);
    requireFact(index >= 0);
    return { docId, mimeType: compiled[index].mimeType, bytes: compiled[index].bytes };
  });
  return {
    ...buildVerticalReviewPacket({ qualification, reply, sourceSnapshots }),
    sourceSnapshots,
  };
}

export function main(argv = process.argv.slice(2), root = ROOT) {
  requireFact(argv.length === 4 && argv[0] === "--report" && argv[2] === "--case");
  const report = JSON.parse(boundedRead(resolve(root, argv[1]), 10 * 1024 * 1024).toString("utf8"));
  const caseId = argv[3];
  requireFact(/^[a-z0-9][a-z0-9-]{0,63}$/.test(caseId));
  requireFact(/^[0-9a-f-]{36}$/.test(report.runId));
  const lane = caseId.split("-")[0];
  requireFact(["data", "product", "design", "legal", "hr", "engineering"].includes(lane));
  const fixtureFile = JSON.parse(
    boundedRead(
      resolve(root, `packages/backend/scripts/vertical-eval-cases/${lane}.json`),
      2 * 1024 * 1024,
    ).toString("utf8"),
  );
  const fixture = fixtureFile.cases.find((item) => `${lane}-${item.id}` === caseId);
  requireFact(fixture !== undefined);
  // Never follow an outputRef supplied by JSON to an arbitrary file on the operator's machine.
  const replyPath = resolve(root, ".tmp", `vertical-eval-${report.runId}`, `${caseId}.md`);
  const archives = report.outputArchives?.filter((item) => item.caseId === caseId);
  requireFact(archives?.length === 1 && resolve(archives[0].outputRef) === replyPath);
  const reply = boundedRead(replyPath, 2 * 1024 * 1024).toString("utf8");
  const result = prepareVerticalReview({ report, caseId, fixture, reply });
  const directory = resolve(root, ".tmp", `vertical-review-${report.runId}`, caseId);
  // A packet is immutable after preparation. A second run cannot overwrite a review in progress.
  mkdirSync(resolve(directory, ".."), { recursive: true });
  mkdirSync(directory);
  writeFileSync(resolve(directory, "output.md"), reply, { flag: "wx" });
  if (result.referenceProfile !== undefined)
    writeFileSync(
      resolve(directory, "profile.json"),
      referenceProfileText(result.referenceProfile),
      {
        flag: "wx",
      },
    );
  for (const source of result.sourceSnapshots)
    writeFileSync(resolve(directory, `${source.docId}.source`), new Uint8Array(source.bytes), {
      flag: "wx",
    });
  // The packet appears only after every referenced content file has been written.
  writeFileSync(resolve(directory, "packet.json"), `${JSON.stringify(result.packet, null, 2)}\n`, {
    flag: "wx",
  });
  return { directory, caseId, semanticReviewRequired: true, releasePassed: false };
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    console.log(JSON.stringify(main(), null, 2));
  } catch {
    console.error(
      "VERTICAL_REVIEW_PREPARATION_FAILED: verify the exact run, fixture revision and output archives; no release evidence was recorded.",
    );
    process.exitCode = 2;
  }
}
