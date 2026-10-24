#!/usr/bin/env node
/** Isolated two-shot comparison. Preparation is offline; paid submission is single-use,
 * append-before-submit, and blocked by every unresolved shared qualification receipt.
 * Policy allowances are not provider invoice ceilings. Never imported by app runtime. */
import { spawnSync } from "node:child_process";
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
import { inspectQualificationLedger } from "./run-image-quality-qualification.mjs";

const SCRIPT = fileURLToPath(import.meta.url);
const ROOT = resolve(dirname(SCRIPT), "../../..");
const API = "https://openrouter.ai/api/v1";
const APPROVAL = "phase53-owner-2026-10-22-five-usd-testing";
const MODEL = "bytedance/seedance-1-5-pro";
const MINI = "bytedance/seedance-2.0-mini";
const STANDARD = "bytedance/seedance-2.0";
const BASELINE = resolve(ROOT, ".tmp/phase53-reel-qualification");
const LEDGER = resolve(ROOT, ".tmp/phase53-paid-qualification/charges.jsonl");
const MAX_BYTES = 24 * 1024 * 1024;
const hash = (x) => createHash("sha256").update(x).digest("hex");
const cost = (x) => typeof x === "number" && Number.isFinite(x) && x >= 0;
function check(value, code) {
  if (!value) throw new Error(code);
}
function privatePath(path) {
  const value = resolve(path),
    rel = relative(resolve(ROOT, ".tmp"), value);
  check(
    rel && rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel),
    "private_path_required",
  );
  return value;
}
function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
}
function append(path, value) {
  const fd = openSync(path, "a", 0o600);
  try {
    appendFileSync(fd, `${JSON.stringify(value)}\n`);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}
export function seedanceManifest(baselineDir = BASELINE, profile = "comparison") {
  check(["comparison", "standard_native_audio"].includes(profile), "unknown_profile");
  baselineDir = privatePath(baselineDir);
  const original = JSON.parse(readFileSync(resolve(baselineDir, "manifest.json"), "utf8"));
  const result = JSON.parse(readFileSync(resolve(baselineDir, "result.json"), "utf8"));
  const requests = original.manifest.requests.filter((r) => r.kind === "video");
  check(requests.length === 2, "two_baseline_shots_required");
  const shots = requests.map((request, i) => {
    const receipt = result.requests.find((r) => r.requestId === request.id);
    check(
      request.id === `video-${i}` &&
        request.body.model === "x-ai/grok-imagine-video" &&
        request.body.duration === 5 &&
        request.body.resolution === "720p" &&
        request.body.aspect_ratio === "9:16",
      "baseline_contract_changed",
    );
    check(
      receipt?.event === "request_settled" &&
        cost(receipt.costUsd) &&
        Number.isSafeInteger(receipt.elapsedMs) &&
        receipt.elapsedMs > 0 &&
        receipt.assetPath === `delivered/video-${i}.mp4`,
      "baseline_receipt_required",
    );
    const bytes = readFileSync(resolve(baselineDir, receipt.assetPath));
    check(hash(bytes) === receipt.assetSha256, "baseline_asset_changed");
    return {
      id: `seedance-${i}`,
      kind: "video",
      policyAllowanceUsd: 0.3,
      estimatedUsd: 0.1296,
      baseline: {
        path: relative(ROOT, resolve(baselineDir, receipt.assetPath)),
        sha256: receipt.assetSha256,
        costUsd: receipt.costUsd,
        elapsedMs: receipt.elapsedMs,
      },
      body: { ...request.body, model: MODEL, generate_audio: false },
    };
  });
  shots.push({
    ...shots[0],
    id: "seedance-mini-0",
    policyAllowanceUsd: 0.6,
    estimatedUsd: 0.378,
    body: { ...shots[0].body, model: MINI },
  });
  if (profile === "standard_native_audio") {
    shots.splice(0, shots.length, {
      id: "seedance-standard-native-0",
      kind: "video",
      policyAllowanceUsd: 1,
      estimatedUsd: 0.6048,
      body: {
        model: STANDARD,
        prompt:
          'Premium cinematic product launch. A single matte black insulated bottle stands on dark stone, amber rim light and a slow deliberate camera push-in. The bottle remains grounded with stable shape. Warm confident English voice says exactly: "Meet your everyday upgrade." Subtle modern instrumental pulse beneath the voice, no other speech. No people, logos, text or watermarks. Illustrative fictional product.',
        duration: 4,
        resolution: "720p",
        aspect_ratio: "9:16",
        generate_audio: true,
      },
    });
  }
  const manifest = {
    version: 1,
    profile,
    approvalRef: APPROVAL,
    sharedPolicyAllowanceUsd: 5,
    guaranteedInvoiceCeilingUsd: null,
    runnerSha256: hash(readFileSync(SCRIPT)),
    ledgerReaderSha256: hash(
      readFileSync(resolve(dirname(SCRIPT), "run-image-quality-qualification.mjs")),
    ),
    baselineDir: relative(ROOT, baselineDir),
    baselineManifestSha256: hash(readFileSync(resolve(baselineDir, "manifest.json"))),
    baselineReceiptSha256: hash(readFileSync(resolve(baselineDir, "result.json"))),
    models: profile === "comparison" ? [MODEL, MINI] : [STANDARD],
    retirementDate: profile === "comparison" ? "2026-11-11" : null,
    automaticRetries: 0,
    concurrency: 1,
    comparison:
      profile === "comparison"
        ? "Two exact purchased text-to-video briefs; no new Grok charge. Not image-to-video, branded-product preservation, a complete launch film, or evidence of faster 30/45/60-second production."
        : "One standard Seedance 2.0 native-audio request with a new four-second product brief. No separate TTS, music, stock, image or STT request. This is not a matched quality benchmark, a complete film or proof of exact spoken-script fidelity.",
    requests: shots,
    catalogue:
      profile === "comparison"
        ? [
            { model: MODEL, silentVideoTokenUsd: 0.0000012 },
            { model: MINI, silentVideoTokenUsd: 0.0000035 },
          ]
        : [{ model: STANDARD, audioVideoTokenUsd: 0.000007 }],
  };
  return { manifest, sha256: hash(JSON.stringify(manifest)) };
}
function probe(path) {
  const env = Object.fromEntries(
    ["PATH", "Path", "SystemRoot", "WINDIR", "TEMP", "TMP", "PATHEXT"]
      .filter((key) => typeof process.env[key] === "string")
      .map((key) => [key, process.env[key]]),
  );
  const r = spawnSync(
    "ffprobe",
    ["-v", "error", "-show_format", "-show_streams", "-of", "json", path],
    { encoding: "utf8", windowsHide: true, env },
  );
  check(r.status === 0, "probe_failed");
  return JSON.parse(r.stdout);
}
async function bytes(response) {
  check(response.ok, "video_content_unavailable");
  const length = response.headers.get("content-length");
  check(
    !length ||
      (Number.isSafeInteger(Number(length)) && Number(length) > 0 && Number(length) <= MAX_BYTES),
    "video_content_invalid",
  );
  const chunks = [];
  let total = 0;
  for await (const chunk of response.body) {
    total += chunk.length;
    check(total <= MAX_BYTES, "video_content_invalid");
    chunks.push(chunk);
  }
  check(total > 0, "video_content_invalid");
  return Buffer.concat(chunks);
}
export async function runSeedanceQualification({
  out,
  ledger = LEDGER,
  reviewHash,
  policyAllowanceAck,
  creditBillingOnly,
  apiKey,
  fetchImpl = fetch,
  sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
  probeMedia = probe,
}) {
  out = privatePath(out);
  ledger = privatePath(ledger);
  check(policyAllowanceAck && creditBillingOnly, "policy_ack_required");
  const saved = JSON.parse(readFileSync(resolve(out, "manifest.json"), "utf8"));
  const plan = seedanceManifest(resolve(ROOT, saved.manifest.baselineDir), saved.manifest.profile);
  check(reviewHash === plan.sha256 && saved.sha256 === plan.sha256, "review_digest_mismatch");
  const state = inspectQualificationLedger(ledger);
  check(state.attempts > 0 && !state.unsettled.length, "unsettled_shared_ledger");
  check(apiKey, "missing_qualification_key");
  const catalogResponse = await fetchImpl(`${API}/videos/models`, {
    redirect: "error",
    signal: AbortSignal.timeout(30_000),
  });
  check(catalogResponse.ok, "catalogue_unavailable");
  const catalog = await catalogResponse.json();
  for (const expected of plan.manifest.catalogue) {
    const model = catalog.data?.find((m) => m.id === expected.model);
    const duration = plan.manifest.requests.find((r) => r.body.model === expected.model).body
      .duration;
    const audio = typeof expected.audioVideoTokenUsd === "number";
    check(
      model?.supported_durations?.includes(duration) &&
        model.supported_resolutions?.includes("720p") &&
        model.supported_aspect_ratios?.includes("9:16") &&
        model.supported_sizes?.includes("720x1280") &&
        model.generate_audio === true &&
        Number(model.pricing_skus?.[audio ? "video_tokens" : "video_tokens_without_audio"]) ===
          (audio ? expected.audioVideoTokenUsd : expected.silentVideoTokenUsd),
      "catalogue_contract_changed",
    );
  }
  const auth = { Authorization: `Bearer ${apiKey}` };
  const key = await fetchImpl(`${API}/key`, {
    headers: auth,
    signal: AbortSignal.timeout(30_000),
    redirect: "error",
  });
  check(key.ok && (await key.json()).data?.is_free_tier === false, "credit_key_required");
  const lock = openSync(`${ledger}.lock`, "wx", 0o600);
  try {
    const runLock = openSync(resolve(out, "execution.lock"), "wx", 0o600);
    closeSync(runLock);
  } catch {
    closeSync(lock);
    unlinkSync(`${ledger}.lock`);
    throw new Error("run_already_attempted");
  }
  const runId = randomUUID(),
    result = {
      status: "stopped",
      reason: null,
      runId,
      manifestSha256: plan.sha256,
      completed: 0,
      requests: [],
    };
  const checkpoint = () => {
    result.sharedBudget = inspectQualificationLedger(ledger);
    writeJson(resolve(out, "result.json"), result);
  };
  mkdirSync(resolve(out, "delivered"), { recursive: true });
  try {
    for (const request of plan.manifest.requests) {
      const current = inspectQualificationLedger(ledger);
      check(!current.unsettled.length, "unsettled_shared_ledger");
      check(
        current.spentUsd + request.policyAllowanceUsd <= 5 + 1e-10,
        "shared_policy_allowance_stop",
      );
      const attemptId = randomUUID(),
        started = Date.now();
      const start = {
        event: "request_started",
        approvalRef: APPROVAL,
        runId,
        attemptId,
        requestId: request.id,
        kind: "video",
        requestedModel: request.body.model,
        policyAllowanceUsd: request.policyAllowanceUsd,
        manifestSha256: plan.sha256,
        requestSha256: hash(JSON.stringify(request.body)),
        startedAt: new Date().toISOString(),
      };
      append(ledger, start);
      append(resolve(out, "journal.jsonl"), start);
      let failure = null,
        costUsd = null,
        isByok = null,
        providerRequestId = null,
        generationId = null,
        httpStatus = null,
        assetPath = null,
        assetSha256 = null,
        deliveredMedia = null,
        reportedModel = null;
      const remember = (payload) => {
        if (cost(payload.usage?.cost)) costUsd = payload.usage.cost;
        if (typeof payload.usage?.is_byok === "boolean") isByok = payload.usage.is_byok;
        if (typeof payload.model === "string") reportedModel = payload.model;
        if (typeof payload.generation_id === "string") generationId = payload.generation_id;
      };
      try {
        const response = await fetchImpl(`${API}/videos`, {
          method: "POST",
          headers: { ...auth, "Content-Type": "application/json" },
          body: JSON.stringify(request.body),
          redirect: "error",
          signal: AbortSignal.timeout(180_000),
        });
        httpStatus = response.status;
        let payload = await response.json();
        remember(payload);
        check(response.ok, "provider_http_error");
        check(
          typeof payload.id === "string" && /^[A-Za-z0-9._-]+$/.test(payload.id),
          "video_id_missing",
        );
        providerRequestId = payload.id;
        append(resolve(out, "journal.jsonl"), {
          event: "async_job_acknowledged",
          attemptId,
          providerJobId: providerRequestId,
        });
        for (let n = 0; n < 90 && ["pending", "in_progress"].includes(payload.status); n++) {
          await sleep(5_000);
          const poll = await fetchImpl(`${API}/videos/${encodeURIComponent(providerRequestId)}`, {
            headers: auth,
            redirect: "error",
            signal: AbortSignal.timeout(30_000),
          });
          check(poll.ok, "video_poll_failed");
          payload = await poll.json();
          remember(payload);
        }
        check(payload.status === "completed", "video_not_completed");
        check(
          reportedModel === null || reportedModel === request.body.model,
          "reported_model_mismatch",
        );
        check(costUsd !== null, "cost_unknown");
        check(isByok === false, "credit_billing_unverified");
        check(costUsd <= request.policyAllowanceUsd, "request_allowance_exceeded");
        const content = await fetchImpl(
          `${API}/videos/${encodeURIComponent(providerRequestId)}/content?index=0`,
          { headers: auth, redirect: "error", signal: AbortSignal.timeout(120_000) },
        );
        const buffer = await bytes(content);
        assetPath = `delivered/${request.id}.mp4`;
        assetSha256 = hash(buffer);
        writeFileSync(resolve(out, assetPath), buffer, { mode: 0o600 });
        const info = probeMedia(resolve(out, assetPath)),
          video = info.streams?.find((s) => s.codec_type === "video");
        deliveredMedia = {
          durationS: Number(info.format?.duration),
          width: video?.width ?? null,
          height: video?.height ?? null,
          audioStreams: info.streams?.filter((s) => s.codec_type === "audio").length ?? 0,
        };
        check(
          Number.isFinite(deliveredMedia.durationS) &&
            deliveredMedia.durationS >= request.body.duration - 0.2 &&
            deliveredMedia.durationS <= request.body.duration + 0.3 &&
            video?.width >= 720 &&
            video?.height >= 1280 &&
            deliveredMedia.audioStreams === (request.body.generate_audio ? 1 : 0),
          "video_profile_invalid",
        );
      } catch (error) {
        failure = /^[a-z_]+$/.test(error?.message ?? "")
          ? error.message
          : "request_or_delivery_uncertain";
      }
      const receipt = {
        event: failure ? "request_unresolved" : "request_settled",
        approvalRef: APPROVAL,
        runId,
        attemptId,
        requestId: request.id,
        kind: "video",
        requestedModel: request.body.model,
        reportedModel,
        providerRequestId,
        generationId,
        policyAllowanceUsd: request.policyAllowanceUsd,
        costUsd,
        usage: { cost: costUsd, is_byok: isByok },
        elapsedMs: Date.now() - started,
        httpStatus,
        assetPath,
        assetSha256,
        deliveredMedia,
        failure,
      };
      append(ledger, receipt);
      append(resolve(out, "journal.jsonl"), receipt);
      result.requests.push(receipt);
      checkpoint();
      if (failure) {
        result.reason = failure;
        checkpoint();
        return result;
      }
      result.completed++;
      checkpoint();
    }
    result.status = "completed";
    checkpoint();
    return result;
  } catch (error) {
    result.reason = /^[a-z_]+$/.test(error?.message ?? "")
      ? error.message
      : "qualification_stopped";
    checkpoint();
    return result;
  } finally {
    closeSync(lock);
    unlinkSync(`${ledger}.lock`);
  }
}
export async function main(argv = process.argv.slice(2)) {
  const options = {};
  const values = new Set(["--out", "--review-hash"]),
    flags = new Set([
      "--prepare",
      "--execute",
      "--policy-allowance-ack",
      "--credit-billing-only",
      "--native-audio",
    ]);
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    check(values.has(arg) || flags.has(arg), "unknown_argument");
    check(!(arg in options), "duplicate_argument");
    if (values.has(arg)) {
      check(argv[i + 1] && !argv[i + 1].startsWith("--"), "missing_argument_value");
      options[arg] = argv[++i];
    } else options[arg] = true;
  }
  check(!(options["--prepare"] && options["--execute"]), "conflicting_modes");
  const out = privatePath(
    options["--out"] ??
      resolve(
        ROOT,
        options["--native-audio"]
          ? ".tmp/phase53-seedance-standard-native-20261024"
          : ".tmp/phase53-seedance-qualification-20261024",
      ),
  );
  if (!options["--execute"]) {
    check(!existsSync(resolve(out, "execution.lock")), "run_already_attempted");
    const plan = seedanceManifest(
      BASELINE,
      options["--native-audio"] ? "standard_native_audio" : "comparison",
    );
    mkdirSync(out, { recursive: true });
    writeJson(resolve(out, "manifest.json"), plan);
    const state = inspectQualificationLedger(LEDGER);
    console.info(
      JSON.stringify({
        mode: "prepared_no_egress",
        manifestSha256: plan.sha256,
        requests: plan.manifest.requests.length,
        estimatedUsd: plan.manifest.requests.reduce((n, r) => n + r.estimatedUsd, 0),
        policyAllowancesUsd: plan.manifest.requests.reduce((n, r) => n + r.policyAllowanceUsd, 0),
        reportedPriorCostUsd: state.spentUsd,
        unresolvedPriorAttempts: state.unsettled.length,
        paidExecutionBlocked: state.unsettled.length > 0,
        out,
      }),
    );
    return;
  }
  const result = await runSeedanceQualification({
    out,
    ledger: LEDGER,
    reviewHash: options["--review-hash"],
    policyAllowanceAck: options["--policy-allowance-ack"],
    creditBillingOnly: options["--credit-billing-only"],
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
    console.error("SEEDANCE_QUALIFICATION_REFUSED");
    process.exitCode = 2;
  });
