import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  inspectQualificationLedger,
  main,
  qualificationManifest,
  reconcileQualificationBilling,
  runImageQualification,
} from "./run-image-quality-qualification.mjs";

function unresolvedSttLedger() {
  const files = fixture();
  const approvalRef = "phase53-owner-2026-10-22-five-usd-testing";
  const receipt = {
    event: "request_unresolved",
    approvalRef,
    attemptId: "stt",
    kind: "stt",
    requestId: "captions",
    failure: "stt_words_missing",
    generationId: "gen-stt-known",
    requestedModel: "openai/whisper-1",
    costUsd: 0.0056,
  };
  writeFileSync(
    files.ledger,
    `${[{ event: "budget_opened", approvalRef, allowanceUsd: 5 }, { event: "request_started", approvalRef, attemptId: "stt" }, receipt].map(JSON.stringify).join("\n")}\n`,
  );
  return { ...files, receipt };
}

test("fresh trusted reconciliation appends once without double-counting or erasing failed output", async () => {
  const files = unresolvedSttLedger(),
    original = readFileSync(files.ledger, "utf8");
  let gets = 0;
  const options = {
    ledger: files.ledger,
    apiKey: "synthetic-credential",
    fetchImpl: async (url, init) => {
      gets++;
      assert.equal(url, "https://openrouter.ai/api/v1/generation?id=gen-stt-known");
      assert.equal(init.redirect, "error");
      assert.equal(init.method, undefined);
      return new Response(
        JSON.stringify({
          data: {
            id: "gen-stt-known",
            model: "openai/whisper-1",
            total_cost: 0.0056,
            is_byok: false,
            cancelled: false,
          },
        }),
      );
    },
  };
  const result = await reconcileQualificationBilling(options);
  assert.equal(result.status, "billing_reconciled_output_still_failed");
  assert.equal(result.spentUsd, 0.0056);
  assert.equal(result.unsettled, 0);
  assert.ok(readFileSync(files.ledger, "utf8").startsWith(original));
  assert.equal(inspectQualificationLedger(files.ledger).attempts, 1);
  assert.equal((await reconcileQualificationBilling(options)).status, "already_reconciled");
  assert.equal(gets, 1);
});
test("ledger refuses altered reconciliation proof and duplicate reconciliation without changing counts", async () => {
  const files = unresolvedSttLedger();
  await reconcileQualificationBilling({
    ledger: files.ledger,
    apiKey: "synthetic",
    fetchImpl: async () =>
      new Response(
        JSON.stringify({
          data: {
            id: "gen-stt-known",
            model: "openai/whisper-1",
            total_cost: 0.0056,
            is_byok: false,
            cancelled: false,
          },
        }),
      ),
  });
  const valid = readFileSync(files.ledger, "utf8"),
    rows = valid.trim().split("\n").map(JSON.parse);
  const proof = rows.at(-1);
  writeFileSync(files.ledger, `${valid}${JSON.stringify(proof)}\n`);
  assert.throws(() => inspectQualificationLedger(files.ledger), /ledger_invalid_reconciliation/);
  proof.priorReceiptSha256 = "0".repeat(64);
  writeFileSync(
    files.ledger,
    `${rows.slice(0, -1).map(JSON.stringify).join("\n")}\n${JSON.stringify(proof)}\n`,
  );
  assert.throws(() => inspectQualificationLedger(files.ledger), /ledger_invalid_reconciliation/);
});
for (const [name, patch] of [
  ["wrong id", { id: "other" }],
  ["wrong model", { model: "other" }],
  ["changed charge", { total_cost: 0 }],
  ["BYOK", { is_byok: true }],
  ["cancelled", { cancelled: true }],
  ["missing cost", { total_cost: undefined }],
]) {
  test(`billing reconciliation refuses ${name} without changing the original ledger`, async () => {
    const files = unresolvedSttLedger(),
      original = readFileSync(files.ledger, "utf8");
    await assert.rejects(
      reconcileQualificationBilling({
        ledger: files.ledger,
        apiKey: "synthetic",
        fetchImpl: async () =>
          new Response(
            JSON.stringify({
              data: {
                id: "gen-stt-known",
                model: "openai/whisper-1",
                total_cost: 0.0056,
                is_byok: false,
                cancelled: false,
                ...patch,
              },
            }),
          ),
      }),
      /generation_billing_proof_mismatch/,
    );
    assert.equal(readFileSync(files.ledger, "utf8"), original);
    assert.equal(inspectQualificationLedger(files.ledger).unsettled.length, 1);
  });
}

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const fixture = () => {
  const directory = mkdtempSync(resolve(root, ".tmp/image-qualification-test-"));
  return {
    directory,
    out: resolve(directory, "images"),
    ledger: resolve(directory, "charges.jsonl"),
  };
};
const png = Buffer.alloc(24);
Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(png);
png.write("IHDR", 12);
png.writeUInt32BE(1024, 16);
png.writeUInt32BE(1536, 20);
function answer(quality, overrides = {}) {
  const completion_tokens = { low: 158, medium: 1372, high: 5488 }[quality];
  return {
    data: [{ media_type: "image/png", b64_json: png.toString("base64") }],
    usage: {
      prompt_tokens: 100,
      completion_tokens,
      total_tokens: completion_tokens + 100,
      cost: 100 * 0.000005 + completion_tokens * 0.00003,
      is_byok: false,
    },
    ...overrides,
  };
}
function config(files, fetchImpl) {
  return {
    ...files,
    reviewHash: qualificationManifest().sha256,
    policyAllowanceAck: true,
    creditBillingOnly: true,
    apiKey: "synthetic-test-credential-not-real",
    fetchImpl,
  };
}
function transport(files, responder = (body) => answer(body.quality)) {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, method: options.method ?? "GET" });
    if (!options.method) return Response.json({ data: { limit: 5, limit_remaining: 5 } });
    const rows = readFileSync(files.ledger, "utf8").trim().split("\n").map(JSON.parse);
    assert.equal(
      rows.at(-1).event,
      "request_started",
      "durable receipt must precede provider submission",
    );
    assert.equal(inspectQualificationLedger(files.ledger).unsettled.length, 1);
    return Response.json(responder(JSON.parse(options.body)), {
      headers: { "x-request-id": "synthetic-provider-ref" },
    });
  };
  return { calls, fetchImpl };
}

test("preparation has fixed exact three requests, acknowledged policy allowances and zero egress", async () => {
  const { manifest } = qualificationManifest();
  assert.equal(manifest.guaranteedInvoiceCeilingUsd, null);
  assert.deepEqual(
    manifest.requests.map((x) => x.policyAllowanceUsd),
    [0.25, 0.5, 0.75],
  );
  assert.deepEqual(
    manifest.requests.map((x) => x.body.quality),
    ["low", "medium", "high"],
  );
  assert.equal(new Set(manifest.requests.map((x) => x.body.prompt)).size, 1);
  for (const { body, route } of manifest.requests) {
    assert.equal(route, "https://openrouter.ai/api/v1/images");
    assert.equal(body.model, "openai/gpt-image-2");
    assert.equal(body.n, 1);
    assert.equal(body.size, "1024x1536");
    assert.equal(body.stream, false);
    assert.deepEqual(body.provider, { only: ["openai"], allow_fallbacks: false });
  }
  const files = fixture(),
    previous = globalThis.fetch;
  globalThis.fetch = () => {
    throw Error("network forbidden in prepare");
  };
  try {
    await main(["--prepare", "--out", files.out, "--ledger", files.ledger]);
  } finally {
    globalThis.fetch = previous;
  }
  assert(existsSync(resolve(files.out, "manifest.json")));
  assert(!existsSync(files.ledger));
});
test("approval digest, credential and explicit attestations refuse before all network work", async () => {
  const files = fixture();
  let calls = 0;
  const options = config(files, () => {
    calls++;
    throw Error("must not call");
  });
  await assert.rejects(
    runImageQualification({ ...options, reviewHash: "changed" }),
    /review_hash_mismatch/,
  );
  await assert.rejects(
    runImageQualification({ ...options, creditBillingOnly: false }),
    /attestation_required/,
  );
  await assert.rejects(runImageQualification({ ...options, apiKey: "" }), /credential_missing/);
  assert.equal(calls, 0);
});
test("success writes started-before-submit receipts, exact charges and outputs with no retries", async () => {
  const files = fixture(),
    mock = transport(files);
  const result = await runImageQualification(config(files, mock.fetchImpl));
  assert.equal(result.status, "completed");
  assert.equal(result.completed, 3);
  assert.equal(mock.calls.filter((x) => x.method === "POST").length, 3);
  assert(Math.abs(inspectQualificationLedger(files.ledger).spentUsd - 0.21204) < 1e-10);
  assert.equal(inspectQualificationLedger(files.ledger).unsettled.length, 0);
  for (const quality of ["low", "medium", "high"])
    assert(existsSync(resolve(files.out, `${quality}.png`)));
  await assert.rejects(runImageQualification(config(files, mock.fetchImpl)), /EEXIST/);
  assert.equal(mock.calls.length, 4);
});
test("missing usage stops after one purchase, preserves output and blocks later run", async () => {
  const files = fixture(),
    mock = transport(files, (body) => answer(body.quality, { usage: undefined }));
  const result = await runImageQualification(config(files, mock.fetchImpl));
  assert.equal(result.status, "stopped");
  assert.equal(mock.calls.length, 2);
  assert(existsSync(resolve(files.out, "low.png")));
  assert.equal(inspectQualificationLedger(files.ledger).unsettled.length, 1);
  const second = await runImageQualification(
    config({ ...files, out: resolve(files.directory, "other") }, mock.fetchImpl),
  );
  assert.equal(second.reason, "qualification_unresolved_prior_purchase");
  assert.equal(mock.calls.length, 2);
});
test("missing BYOK metadata and known unexpected charge are retained, never zeroed", async () => {
  const files = fixture(),
    mock = transport(files, (body) => {
      const result = answer(body.quality);
      delete result.usage.is_byok;
      result.usage.cost = 0.4;
      return result;
    });
  const result = await runImageQualification(config(files, mock.fetchImpl));
  assert.equal(result.reason, "billing_mode_unknown");
  assert.equal(inspectQualificationLedger(files.ledger).spentUsd, 0.4);
  assert.equal(mock.calls.length, 2);
});
test("known billing variance halts while recording authoritative actual dollars", async () => {
  const files = fixture(),
    mock = transport(files, (body) => {
      const result = answer(body.quality);
      result.usage.cost = 0.2;
      return result;
    });
  const result = await runImageQualification(config(files, mock.fetchImpl));
  assert.equal(result.reason, "billing_rate_variance");
  assert.equal(inspectQualificationLedger(files.ledger).spentUsd, 0.2);
  assert.equal(mock.calls.length, 2);
});
test("all-zero placeholder usage cannot qualify a real generated image", async () => {
  const files = fixture(),
    mock = transport(files, (body) =>
      answer(body.quality, {
        usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0, cost: 0, is_byok: false },
      }),
    );
  const result = await runImageQualification(config(files, mock.fetchImpl));
  assert.equal(result.reason, "usage_unknown");
  assert.equal(mock.calls.length, 2);
  assert.equal(inspectQualificationLedger(files.ledger).unsettled.length, 1);
});
test("per-profile policy overrun is disclosed and no next purchase starts", async () => {
  const files = fixture(),
    mock = transport(files, (body) =>
      answer(body.quality, {
        usage: {
          prompt_tokens: 0,
          completion_tokens: 10000,
          total_tokens: 10000,
          cost: 0.3,
          is_byok: false,
        },
      }),
    );
  const result = await runImageQualification(config(files, mock.fetchImpl));
  assert.equal(result.reason, "profile_policy_allowance_exceeded");
  assert.equal(inspectQualificationLedger(files.ledger).spentUsd, 0.3);
  assert.equal(mock.calls.length, 2);
});
test("unknown transport outcome is durable, redacted and never retried", async () => {
  const files = fixture();
  let posts = 0;
  const result = await runImageQualification(
    config(files, async (_url, options) => {
      if (!options.method) return Response.json({ data: { limit_remaining: 5, limit: 5 } });
      posts++;
      throw Error(`request failed with ${options.headers.Authorization}`);
    }),
  );
  assert.equal(result.reason, "purchase_outcome_unknown");
  assert.equal(posts, 1);
  const journal = readFileSync(resolve(files.out, "journal.jsonl"), "utf8");
  assert(!journal.includes("synthetic-test-credential"));
  assert(!journal.includes("Bearer"));
  assert.equal(inspectQualificationLedger(files.ledger).unsettled.length, 1);
});
test("shared prior spend leaves no independent $5 allowance for another lane", async () => {
  const files = fixture(),
    plan = qualificationManifest().manifest;
  writeFileSync(
    files.ledger,
    `${[
      { event: "budget_opened", approvalRef: plan.approvalRef, allowanceUsd: 5 },
      { event: "request_started", approvalRef: plan.approvalRef, attemptId: "prior-reel" },
      {
        event: "request_settled",
        approvalRef: plan.approvalRef,
        attemptId: "prior-reel",
        costUsd: 4.8,
      },
    ]
      .map(JSON.stringify)
      .join("\n")}\n`,
  );
  const mock = transport(files),
    result = await runImageQualification(config(files, mock.fetchImpl));
  assert.equal(result.reason, "policy_allowance_stop");
  assert.equal(mock.calls.filter((x) => x.method === "POST").length, 0);
});
