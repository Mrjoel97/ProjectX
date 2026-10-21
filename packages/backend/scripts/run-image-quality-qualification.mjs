#!/usr/bin/env node
/** One owner-approved pricing experiment; never imported by app runtime or automatic tests.
 * Default --prepare does no network I/O. --execute requires an exact reviewed manifest digest,
 * explicit policy/BYOK attestations and a process-only operator qualification credential.
 * $5 is the shared testing POLICY allowance, not a guaranteed provider invoice ceiling.
 * Zero retries. Unknown receipts block the shared ledger; no automatic hold expiry/resume. */
import { createHash, randomUUID } from "node:crypto";
import {
  appendFileSync,
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { IMAGE_QUALITY_BENCHMARK } from "../../core/src/productionQuality.fixtures.ts";

const SCRIPT = fileURLToPath(import.meta.url);
const ROOT = resolve(dirname(SCRIPT), "../../..");
const ROUTE = "https://openrouter.ai/api/v1/images";
const KEY_ROUTE = "https://openrouter.ai/api/v1/key";
const APPROVAL = "phase53-owner-2026-10-22-five-usd-testing";
const ALLOWANCE_USD = 5;
const hash = (value) => createHash("sha256").update(value).digest("hex");
const positive = (value) => typeof value === "number" && Number.isFinite(value) && value >= 0;
function requireCondition(condition, code) {
  if (!condition) throw new Error(code);
}

export function qualificationManifest() {
  const source = IMAGE_QUALITY_BENCHMARK;
  const portrait = source.sizes[0];
  const manifest = {
    version: 1,
    approvalRef: APPROVAL,
    sharedPolicyAllowanceUsd: ALLOWANCE_USD,
    guaranteedInvoiceCeilingUsd: null,
    automaticRetries: 0,
    concurrency: 1,
    runnerSha256: hash(readFileSync(SCRIPT)),
    fixtureSha256: hash(
      readFileSync(resolve(dirname(SCRIPT), "../../core/src/productionQuality.fixtures.ts")),
    ),
    requests: ["low", "medium", "high"].map((quality) => ({
      route: ROUTE,
      policyAllowanceUsd: { low: 0.25, medium: 0.5, high: 0.75 }[quality],
      estimatedOutputUsd:
        (portrait.outputTokens[quality] * source.outputUsdPerMillionTokens) / 1_000_000,
      fullRequestEstimateUsd: null,
      body: {
        model: source.model,
        prompt: source.prompt,
        n: 1,
        size: "1024x1536",
        quality,
        output_format: "png",
        background: "opaque",
        stream: false,
        provider: { only: [source.provider], allow_fallbacks: false },
      },
    })),
  };
  return { manifest, sha256: hash(JSON.stringify(manifest)) };
}

function privatePath(path) {
  const absolute = resolve(path);
  const rel = relative(resolve(ROOT, ".tmp"), absolute);
  requireCondition(
    rel !== "" && rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel),
    "output_must_be_inside_worktree_tmp",
  );
  return absolute;
}
function appendReceipt(path, receipt) {
  const fd = openSync(path, "a", 0o600);
  try {
    appendFileSync(fd, `${JSON.stringify(receipt)}\n`);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

/** Shared by every authorized benchmark lane. Missing completion or unknown usage stops new work.
 * These local receipts are operator evidence; they neither spend/refund the app's tenant rails. */
export function inspectQualificationLedger(path) {
  if (!existsSync(path)) return { spentUsd: 0, unsettled: [], attempts: 0 };
  const rows = readFileSync(path, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  requireCondition(
    rows[0]?.event === "budget_opened" &&
      rows[0].approvalRef === APPROVAL &&
      rows[0].allowanceUsd === ALLOWANCE_USD,
    "ledger_approval_mismatch",
  );
  const attempts = new Map();
  let spentUsd = 0;
  for (const row of rows.slice(1)) {
    requireCondition(
      row.approvalRef === APPROVAL && typeof row.attemptId === "string",
      "ledger_invalid_receipt",
    );
    if (row.event === "request_started") {
      requireCondition(!attempts.has(row.attemptId), "ledger_duplicate_start");
      attempts.set(row.attemptId, "started");
    } else {
      requireCondition(attempts.get(row.attemptId) === "started", "ledger_invalid_completion");
      requireCondition(
        ["request_settled", "request_unresolved"].includes(row.event),
        "ledger_invalid_event",
      );
      if (row.costUsd !== null) {
        requireCondition(positive(row.costUsd), "ledger_invalid_cost");
        spentUsd += row.costUsd;
      }
      attempts.set(row.attemptId, row.event === "request_settled" ? "settled" : "unresolved");
    }
  }
  return {
    spentUsd,
    unsettled: [...attempts].filter(([, status]) => status !== "settled").map(([id]) => id),
    attempts: attempts.size,
  };
}

function parseUsage(body) {
  const usage = body?.usage;
  const costUsd = positive(usage?.cost) ? usage.cost : null;
  const counts = [usage?.prompt_tokens, usage?.completion_tokens, usage?.total_tokens];
  const known =
    costUsd !== null &&
    counts.every((value) => Number.isSafeInteger(value) && value >= 0) &&
    counts[1] > 0 &&
    counts[0] + counts[1] === counts[2];
  return {
    costUsd,
    known,
    usage: known
      ? {
          prompt_tokens: counts[0],
          completion_tokens: counts[1],
          total_tokens: counts[2],
          cost: costUsd,
          is_byok: usage.is_byok ?? null,
        }
      : null,
  };
}
function pngOutput(body) {
  const item = body?.data?.[0];
  requireCondition(
    Array.isArray(body?.data) && body.data.length === 1 && typeof item.b64_json === "string",
    "image_missing_or_count_mismatch",
  );
  requireCondition(
    item.media_type === undefined || item.media_type === "image/png",
    "unexpected_image_format",
  );
  requireCondition(
    item.b64_json.length < 40_000_000 && /^[A-Za-z0-9+/]+={0,2}$/.test(item.b64_json),
    "image_encoding_invalid",
  );
  const bytes = Buffer.from(item.b64_json, "base64");
  requireCondition(
    bytes.length >= 24 &&
      bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) &&
      bytes.toString("ascii", 12, 16) === "IHDR",
    "image_header_invalid",
  );
  requireCondition(
    bytes.readUInt32BE(16) === 1024 && bytes.readUInt32BE(20) === 1536,
    "image_size_mismatch",
  );
  return bytes;
}

export async function runImageQualification({
  out,
  ledger,
  reviewHash,
  policyAllowanceAck,
  creditBillingOnly,
  apiKey,
  fetchImpl = globalThis.fetch,
}) {
  const { manifest, sha256 } = qualificationManifest();
  requireCondition(reviewHash === sha256, "review_hash_mismatch");
  requireCondition(
    policyAllowanceAck === true && creditBillingOnly === true,
    "explicit_policy_and_credit_billing_attestation_required",
  );
  requireCondition(
    typeof apiKey === "string" && apiKey.trim().length > 0,
    "qualification_credential_missing",
  );
  out = privatePath(out);
  ledger = privatePath(ledger);
  mkdirSync(out, { recursive: true });
  mkdirSync(dirname(ledger), { recursive: true });
  // A run directory cannot be purchased again. Keep this marker even after successful completion.
  const runLock = openSync(resolve(out, "execution.lock"), "wx", 0o600);
  closeSync(runLock);
  let budgetLock;
  try {
    budgetLock = openSync(`${ledger}.lock`, "wx", 0o600);
  } catch {
    throw new Error("qualification_budget_locked");
  }
  const runId = randomUUID();
  const journal = resolve(out, "journal.jsonl");
  const outcome = {
    version: 1,
    runId,
    manifestSha256: sha256,
    status: "stopped",
    reason: null,
    completed: 0,
  };
  const checkpoint = () =>
    writeFileSync(
      resolve(out, "result.json"),
      `${JSON.stringify({ ...outcome, budget: inspectQualificationLedger(ledger) }, null, 2)}\n`,
      { mode: 0o600 },
    );
  try {
    if (!existsSync(ledger))
      appendReceipt(ledger, {
        event: "budget_opened",
        approvalRef: APPROVAL,
        allowanceUsd: ALLOWANCE_USD,
        guaranteedInvoiceCeilingUsd: null,
      });
    requireCondition(
      inspectQualificationLedger(ledger).unsettled.length === 0,
      "qualification_unresolved_prior_purchase",
    );
    writeFileSync(
      resolve(out, "manifest.json"),
      `${JSON.stringify({ manifest, sha256 }, null, 2)}\n`,
      { mode: 0o600 },
    );
    checkpoint();
    // Read-only check. Never save the key label, hash, raw response, Authorization or exception text.
    let keyResponse;
    try {
      keyResponse = await fetchImpl(KEY_ROUTE, {
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(30_000),
      });
    } catch {
      throw new Error("key_preflight_unreachable");
    }
    requireCondition(keyResponse.ok, "key_preflight_refused");
    const keyInfo = await keyResponse.json().catch(() => null);
    requireCondition(
      keyInfo?.data && Object.hasOwn(keyInfo.data, "limit_remaining"),
      "key_preflight_invalid",
    );
    const remaining = keyInfo.data.limit_remaining;
    requireCondition(
      remaining === null || (positive(remaining) && remaining > 0),
      "key_budget_exhausted",
    );
    appendReceipt(journal, {
      event: "key_preflight",
      keyLimitUsd: positive(keyInfo.data.limit) ? keyInfo.data.limit : null,
      keyRemainingUsd: remaining,
      noInvoiceCeilingClaim: true,
    });
    for (const request of manifest.requests) {
      const budget = inspectQualificationLedger(ledger);
      requireCondition(budget.unsettled.length === 0, "qualification_unresolved_prior_purchase");
      requireCondition(
        budget.spentUsd + request.policyAllowanceUsd <= ALLOWANCE_USD,
        "policy_allowance_stop",
      );
      const attemptId = randomUUID(),
        startedAt = Date.now();
      const started = {
        event: "request_started",
        approvalRef: APPROVAL,
        runId,
        attemptId,
        startedAt,
        manifestSha256: sha256,
        requestedModel: request.body.model,
        quality: request.body.quality,
        size: request.body.size,
        requestSha256: hash(JSON.stringify(request.body)),
      };
      appendReceipt(ledger, started);
      appendReceipt(journal, started);
      let body,
        response,
        failure = null;
      try {
        response = await fetchImpl(request.route, {
          method: "POST",
          headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify(request.body),
          signal: AbortSignal.timeout(240_000),
        });
        body = await response.json();
      } catch {
        failure = "purchase_outcome_unknown";
      }
      const priced = parseUsage(body);
      let imagePath = null,
        imageSha256 = null;
      if (!failure && !response.ok) failure = "provider_http_refusal";
      if (!failure && body?.model !== undefined && body.model !== request.body.model)
        failure = "response_model_mismatch";
      if (!failure && body?.provider !== undefined && !["openai", "OpenAI"].includes(body.provider))
        failure = "response_provider_mismatch";
      if (!failure && body?.usage?.is_byok !== false)
        failure =
          body?.usage?.is_byok === true ? "external_billing_detected" : "billing_mode_unknown";
      if (response?.ok && body) {
        try {
          const bytes = pngOutput(body);
          imagePath = resolve(out, `${request.body.quality}.png`);
          writeFileSync(imagePath, bytes, { flag: "wx", mode: 0o600 });
          imageSha256 = hash(bytes);
        } catch {
          failure = failure ?? "image_output_invalid";
        }
      }
      if (!priced.known) failure = failure ?? "usage_unknown";
      if (
        !failure &&
        Math.abs(
          priced.costUsd -
            (priced.usage.prompt_tokens * 0.000005 + priced.usage.completion_tokens * 0.00003),
        ) > 1e-8
      )
        failure = "billing_rate_variance";
      if (!failure && priced.costUsd > request.policyAllowanceUsd)
        failure = "profile_policy_allowance_exceeded";
      const receipt = {
        event: !failure && priced.known ? "request_settled" : "request_unresolved",
        approvalRef: APPROVAL,
        runId,
        attemptId,
        elapsedMs: Date.now() - startedAt,
        httpStatus: response?.status ?? null,
        providerRequestId: response?.headers.get("x-request-id") ?? null,
        requestedModel: request.body.model,
        reportedModel: typeof body?.model === "string" ? body.model : null,
        requestedProvider: "openai",
        providerIdentityBasis: "request_allowlist_no_fallback",
        quality: request.body.quality,
        size: request.body.size,
        policyAllowanceUsd: request.policyAllowanceUsd,
        costUsd: priced.costUsd,
        usage: priced.usage,
        imagePath,
        imageSha256,
        failure,
      };
      appendReceipt(ledger, receipt);
      appendReceipt(journal, receipt);
      if (failure) {
        outcome.reason = failure;
        checkpoint();
        return outcome;
      }
      outcome.completed++;
      checkpoint();
      if (inspectQualificationLedger(ledger).spentUsd >= ALLOWANCE_USD) {
        outcome.reason = "policy_allowance_stop";
        checkpoint();
        return outcome;
      }
    }
    outcome.status = "completed";
    checkpoint();
    return outcome;
  } catch (error) {
    // Only internally controlled codes reach the report; never persist provider/transport messages.
    outcome.reason = /^[a-z_]+$/.test(error?.message ?? "")
      ? error.message
      : "qualification_stopped";
    checkpoint();
    return outcome;
  } finally {
    closeSync(budgetLock);
    // A completed process releases concurrency, but unresolved ledger rows still block new calls.
    // An abrupt process loss leaves this lock for reviewed manual reconciliation, never auto replay.
    unlinkSync(`${ledger}.lock`);
  }
}

export async function main(argv = process.argv.slice(2)) {
  const flag = (name) => argv.includes(name);
  const value = (name) => {
    const index = argv.indexOf(name);
    return index >= 0 ? argv[index + 1] : undefined;
  };
  const values = new Set(["--out", "--ledger", "--review-hash"]);
  const booleans = new Set([
    "--prepare",
    "--execute",
    "--policy-allowance-ack",
    "--credit-billing-only",
  ]);
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    requireCondition(values.has(arg) || booleans.has(arg), "unknown_argument");
    requireCondition(argv.indexOf(arg) === i, "duplicate_argument");
    if (values.has(arg)) {
      requireCondition(argv[i + 1] && !argv[i + 1].startsWith("--"), "missing_argument_value");
      i++;
    }
  }
  requireCondition(!(flag("--prepare") && flag("--execute")), "conflicting_modes");
  const out = privatePath(value("--out") ?? resolve(ROOT, ".tmp/phase53-image-qualification"));
  const ledger = privatePath(
    value("--ledger") ?? resolve(ROOT, ".tmp/phase53-paid-qualification/charges.jsonl"),
  );
  const plan = qualificationManifest();
  if (!flag("--execute")) {
    mkdirSync(out, { recursive: true });
    requireCondition(!existsSync(resolve(out, "execution.lock")), "run_already_attempted");
    writeFileSync(resolve(out, "manifest.json"), `${JSON.stringify(plan, null, 2)}\n`, {
      mode: 0o600,
    });
    console.info(
      JSON.stringify({
        mode: "prepared_no_egress",
        manifestSha256: plan.sha256,
        requests: 3,
        sharedPolicyAllowanceUsd: 5,
        guaranteedInvoiceCeilingUsd: null,
        out,
        ledger,
      }),
    );
    return;
  }
  const result = await runImageQualification({
    out,
    ledger,
    reviewHash: value("--review-hash"),
    policyAllowanceAck: flag("--policy-allowance-ack"),
    creditBillingOnly: flag("--credit-billing-only"),
    apiKey: process.env.OPENROUTER_QUALIFICATION_API_KEY,
  });
  console.info(
    JSON.stringify({
      status: result.status,
      reason: result.reason,
      completed: result.completed,
      out,
    }),
  );
  if (result.status !== "completed") process.exitCode = 2;
}
if (process.argv[1] && resolve(process.argv[1]) === SCRIPT)
  main().catch(() => {
    console.error("IMAGE_QUALIFICATION_REFUSED");
    process.exitCode = 2;
  });
