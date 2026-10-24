#!/usr/bin/env node
import { spawnSync } from "node:child_process";
/** Isolated operator experiment; never imported by the application. Default prepare is offline.
 * Read-only catalogue preparation is explicit. Paid execution requires the frozen manifest hash,
 * process-only staging credentials, owner-approved policy allowance and a settled shared ledger.
 * Policy allowances are admission targets, NOT guaranteed provider invoice ceilings. No retries. */
import { createHash, randomUUID } from "node:crypto";
import {
  appendFileSync,
  closeSync,
  copyFileSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { buildSubmitBody } from "../../core/src/mediaProviderContract.ts";
import { REEL_QUALITY_BENCHMARKS } from "../../core/src/productionQuality.fixtures.ts";
import { inspectQualificationLedger } from "./run-image-quality-qualification.mjs";

const SCRIPT = fileURLToPath(import.meta.url);
const ROOT = resolve(dirname(SCRIPT), "../../..");
const API = "https://openrouter.ai/api/v1";
const APPROVAL = "phase53-owner-2026-10-22-five-usd-testing";
const HIGH_SHA = "fc62e5a6fca4e9829ba9a6390428cb7fddeb6e90e640afceb8c6f835b23ac1d4";
const MAX_BYTES = 24 * 1024 * 1024;
const hash = (x) => createHash("sha256").update(x).digest("hex");
const finiteCost = (x) => typeof x === "number" && Number.isFinite(x) && x >= 0;
function check(value, code) {
  if (!value) throw new Error(code);
}
function privatePath(path) {
  const absolute = resolve(path),
    rel = relative(resolve(ROOT, ".tmp"), absolute);
  check(
    rel && rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel),
    "private_path_required",
  );
  return absolute;
}
function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
}
export function localChildEnv(source = process.env) {
  const keys = [
    "PATH",
    "Path",
    "SystemRoot",
    "WINDIR",
    "TEMP",
    "TMP",
    "HOME",
    "USERPROFILE",
    "COMSPEC",
    "PATHEXT",
    "NUMBER_OF_PROCESSORS",
  ];
  return Object.fromEntries(
    keys.filter((key) => typeof source[key] === "string").map((key) => [key, source[key]]),
  );
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
let helpersPromise;
async function helpers() {
  if (!helpersPromise)
    helpersPromise = (async () => {
      const backendRequire = createRequire(resolve(ROOT, "packages/backend/package.json"));
      const vitestRequire = createRequire(backendRequire.resolve("vitest"));
      const viteRequire = createRequire(vitestRequire.resolve("vite"));
      const { buildSync } = viteRequire("esbuild");
      const result = buildSync({
        stdin: {
          contents: [
            'export {pcm16ToWav,concatWavTakes,buildCaptionLines,toAss} from "./packages/core/src/captions.ts";',
            'export {parseAssemblySidecar} from "./packages/core/src/assembly.ts";',
            'export {pickStockVideo,pickStockAudio} from "./packages/core/src/stockSelection.ts";',
            'export {MEDIA_DEFAULT_VIDEO,MEDIA_DEFAULT_VOICE,MEDIA_DEFAULT_STT} from "./packages/cost/src/media.ts";',
          ].join("\n"),
          resolveDir: ROOT,
        },
        bundle: true,
        platform: "node",
        format: "esm",
        write: false,
      });
      return import(
        `data:text/javascript;base64,${Buffer.from(result.outputFiles[0].contents).toString("base64")}`
      );
    })();
  return helpersPromise;
}
export const STOCK_QUERIES = Object.freeze([
  "hands arranging reusable water bottles",
  "pouring water into glass",
  "organized kitchen shelf",
  "hands placing bottle on counter",
  "water flowing bottle",
  "minimal kitchen counter",
]);
const VIDEO_PROMPTS = Object.freeze([
  "A five-second editorial product film, vertical 9:16. Three unbranded reusable bottles on a warm ivory shelf: deep teal foreground right, terracotta behind at two heights. Soft window light from camera left, tactile matte surfaces, restrained warm shadows. Slow deliberate push-in, stable believable bottle geometry. Quiet central upper third. No people, text, logos, letters, extra objects or watermarks. Illustrative fictional concept, not an actual product photograph.",
  "A five-second editorial detail film, vertical 9:16. Close view of a single unbranded deep teal reusable bottle on warm ivory beside a terracotta bottle softly out of focus. Soft window light from camera left, tactile matte surface and restrained warm shadows. One slow lateral camera move reveals the bottle silhouette. Stable geometry. No hands, faces, text, logos, letters, extra objects or watermarks. Illustrative fictional concept.",
]);
const SOURCES = [
  "packages/core/src/mediaProviderContract.ts",
  "packages/core/src/productionQuality.fixtures.ts",
  "packages/core/src/captions.ts",
  "packages/core/src/assembly.ts",
  "packages/core/src/stockSelection.ts",
  "packages/core/src/result.ts",
  "packages/cost/src/media.ts",
  "packages/backend/convex/render/assemble_final.sh",
  "packages/backend/convex/render/burn_caps.sh",
  "packages/backend/scripts/run-image-quality-qualification.mjs",
];
export async function reelManifest(assets = null) {
  const h = await helpers();
  const narration = [...new Set(REEL_QUALITY_BENCHMARKS.flatMap((r) => [...r.narration]))];
  const requests = [
    ...VIDEO_PROMPTS.map((prompt, i) => ({
      id: `video-${i}`,
      kind: "video",
      route: `${API}/videos`,
      policyAllowanceUsd: 0.5,
      estimatedUsd: 0.35,
      body: buildSubmitBody({ kind: "video", ...h.MEDIA_DEFAULT_VIDEO, seconds: 5 }, prompt),
    })),
    ...narration.map((text, i) => ({
      id: `voice-${i}`,
      kind: "tts",
      route: `${API}/chat/completions`,
      policyAllowanceUsd: 0.05,
      estimatedUsd: null,
      body: buildSubmitBody(
        { kind: "tts", ...h.MEDIA_DEFAULT_VOICE, characters: text.length },
        text,
      ),
    })),
    {
      id: "captions",
      kind: "stt",
      route: `${API}/audio/transcriptions`,
      policyAllowanceUsd: 0.1,
      estimatedUsd:
        "0.006 USD per measured clean-audio minute; duration unknown before voice delivery",
      multipart: {
        model: h.MEDIA_DEFAULT_STT.model,
        response_format: "verbose_json",
        "timestamp_granularities[]": "word",
        file: "all 18 clean voice occurrences, fixture order 30s then 60s, concatenated WAV; SHA256 logged before submit",
      },
    },
  ];
  check(requests.length === 19 && narration.length === 16, "fixture_count_changed");
  const manifest = {
    version: 1,
    approvalRef: APPROVAL,
    sharedPolicyAllowanceUsd: 5,
    reelPolicyAllowanceUsd: 1.9,
    guaranteedInvoiceCeilingUsd: null,
    automaticRetries: 0,
    concurrency: 1,
    billingBasis:
      "Standard OpenRouter credit billing: current staging key metadata plus owner attestation; response-reported provenance recorded separately",
    runnerSha256: hash(readFileSync(SCRIPT)),
    sourceSha256: Object.fromEntries(
      SOURCES.map((path) => [path, hash(readFileSync(resolve(ROOT, path)))]),
    ),
    reusedImage: {
      relativePath: ".tmp/phase53-image-qualification/high.png",
      sha256: HIGH_SHA,
      additionalPaidImageRequests: 0,
    },
    assets,
    requests,
    reels: REEL_QUALITY_BENCHMARKS.map((r) => ({
      id: r.id,
      seconds: r.targetSeconds,
      brief: r.brief,
      sceneSeconds: 5,
      visuals: r.visuals,
      narration: r.narration,
      voiceIds: r.narration.map((s) => `voice-${narration.indexOf(s)}`),
      sources:
        r.targetSeconds === 30
          ? ["video-0", "stock-0", "stock-1", "high", "stock-2", "card"]
          : [
              "video-0",
              "stock-3",
              "stock-1",
              "high",
              "stock-4",
              "card",
              "stock-0",
              "video-1",
              "stock-2",
              "high",
              "stock-5",
              "card",
            ],
    })),
    render: {
      output: "720x1280",
      fps: 30,
      sceneSeconds: 5,
      cuts: "hard",
      captionSource:
        "single last-paid STT of clean voice takes, rebased through governed assembly sidecars",
      music: "licensed instrumental at canonical fixed bed level",
      cardBg: "0xF3EDE1",
      cardInk: "0x123E3A",
      localFont: "Arial; local operator comparison, not hosted-font acceptance",
    },
    stopRules: [
      "unsettled shared ledger",
      "next policy allowance exceeds remaining shared 5 USD",
      "unknown or nonfinite actual cost",
      "reported BYOK true",
      "request exceeds own policy allowance",
      "voice drift or missing audio",
      "voice longer than 5 seconds",
      "missing licence or insufficient assets",
      "async video unknown outcome: retain ID, never resubmit",
    ],
  };
  return { manifest, sha256: hash(JSON.stringify(manifest)) };
}
function safeUrl(value) {
  const url = new URL(value);
  check(
    url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      !/^(localhost|127\.|0\.|10\.|192\.168\.|169\.254\.|\[)/i.test(url.hostname),
    "public_https_required",
  );
  return url;
}
async function getBytes(url, fetchImpl, maxBytes = MAX_BYTES) {
  safeUrl(url);
  const response = await fetchImpl(url, {
    redirect: "error",
    signal: AbortSignal.timeout(120_000),
  });
  check(response.ok, "asset_get_failed");
  check(
    !response.headers.get("content-length") ||
      Number(response.headers.get("content-length")) <= maxBytes,
    "asset_too_large",
  );
  const chunks = [];
  let bytes = 0;
  for await (const chunk of response.body) {
    bytes += chunk.length;
    check(bytes <= maxBytes, "asset_too_large");
    chunks.push(chunk);
  }
  check(bytes > 0, "asset_empty");
  return Buffer.concat(chunks);
}
function probe(path) {
  const r = spawnSync(
    "ffprobe",
    ["-v", "error", "-show_format", "-show_streams", "-of", "json", path],
    { encoding: "utf8", windowsHide: true, env: localChildEnv() },
  );
  check(r.status === 0, "probe_failed");
  return JSON.parse(r.stdout);
}
/** Explicitly free catalogue GETs; credentials only ever go to api.pexels.com. */
export function validateManualCatalog(catalog) {
  check(Array.isArray(catalog) && catalog.length === 6, "six_manual_stock_assets_required");
  const ids = new Set();
  for (const [i, asset] of catalog.entries()) {
    check(
      asset.id === `stock-${i}` &&
        typeof asset.assetId === "string" &&
        asset.assetId &&
        !ids.has(asset.assetId),
      "manual_stock_ids_invalid",
    );
    ids.add(asset.assetId);
    const page = safeUrl(asset.sourceUrl),
      download = safeUrl(asset.downloadUrl);
    check(
      page.hostname === "www.pexels.com" && page.pathname.startsWith("/video/"),
      "manual_stock_page_invalid",
    );
    check(
      ["videos.pexels.com", "images.pexels.com"].includes(download.hostname),
      "manual_stock_download_invalid",
    );
    check(
      typeof asset.creator === "string" &&
        asset.creator.trim() &&
        typeof asset.query === "string" &&
        asset.query.trim(),
      "manual_stock_credit_required",
    );
  }
  return catalog;
}
export function validateMusicCatalog(music) {
  check(
    music && music.path === "assets/music.mp3" && /^[a-f0-9]{64}$/.test(music.sha256),
    "music_catalog_invalid",
  );
  const license = safeUrl(music.licenseUrl);
  check(
    license.hostname === "creativecommons.org" &&
      (/^\/licenses\/by\//.test(license.pathname) ||
        /^\/publicdomain\/zero\//.test(license.pathname)),
    "music_license_not_by_or_cc0",
  );
  check(
    music.title &&
      music.creator &&
      music.sourceUrl &&
      music.attribution &&
      Number(music.durationS) >= 60,
    "music_credit_missing",
  );
  safeUrl(music.sourceUrl);
  return music;
}
export async function prepareStock({
  out,
  pexelsKey,
  catalog = null,
  musicCatalog = null,
  fetchImpl = fetch,
}) {
  out = privatePath(out);
  if (catalog) validateManualCatalog(catalog);
  else check(pexelsKey, "missing_pexels_qualification_key");
  mkdirSync(resolve(out, "assets"), { recursive: true });
  check(!existsSync(resolve(out, "execution.lock")), "run_already_attempted");
  const h = await helpers(),
    videos = [],
    selectedIds = new Set();
  for (let i = 0; i < STOCK_QUERIES.length; i++) {
    let picked, entry;
    if (catalog) {
      const manual = catalog[i];
      picked = { link: manual.downloadUrl, assetId: manual.assetId };
      entry = { url: manual.sourceUrl, user: { name: manual.creator, url: manual.creatorUrl } };
    } else {
      const url = new URL("https://api.pexels.com/videos/search");
      url.searchParams.set("query", STOCK_QUERIES[i]);
      url.searchParams.set("orientation", "portrait");
      url.searchParams.set("per_page", "15");
      const response = await fetchImpl(url, {
        headers: { Authorization: pexelsKey },
        redirect: "error",
        signal: AbortSignal.timeout(30_000),
      });
      check(response.ok, "stock_search_failed");
      const body = await response.json();
      const pool = { videos: (body.videos ?? []).filter((v) => !selectedIds.has(String(v.id))) };
      picked = h.pickStockVideo(pool, 5, 0.5);
      check(picked, "stock_match_missing");
      entry = pool.videos.find((v) => String(v.id) === picked.assetId);
    }
    check(entry?.url && entry?.user?.name, "stock_provenance_missing");
    const bytes = await getBytes(picked.link, fetchImpl),
      path = `assets/stock-${i}.mp4`;
    writeFileSync(resolve(out, path), bytes, { mode: 0o600 });
    const media = probe(resolve(out, path));
    check(Number(media.format.duration) >= 4.5, "stock_too_short");
    const stream = media.streams.find((s) => s.codec_type === "video");
    check(stream, "stock_video_missing");
    videos.push({
      id: `stock-${i}`,
      assetId: picked.assetId,
      query: catalog?.[i].query ?? STOCK_QUERIES[i],
      selectionBasis: catalog
        ? "manually_curated_public_pexels_page_not_app_api_acceptance"
        : "existing_app_stock_picker_pexels_api",
      sourceUrl: entry.url,
      creator: entry.user.name,
      creatorUrl: entry.user.url,
      license: "Pexels License",
      licenseUrl: "https://www.pexels.com/license/",
      attribution: `Video by ${entry.user.name} from Pexels (${entry.url})`,
      path,
      sha256: hash(bytes),
      bytes: bytes.length,
      durationS: Number(media.format.duration),
      width: stream.width,
      height: stream.height,
      illustrativeOnly: true,
    });
    selectedIds.add(picked.assetId);
  }
  let music;
  if (musicCatalog) {
    validateMusicCatalog(musicCatalog);
    const path = resolve(out, musicCatalog.path),
      bytes = readFileSync(path);
    check(hash(bytes) === musicCatalog.sha256, "music_digest_changed");
    const info = probe(path);
    check(Number(info.format.duration) >= 60, "music_too_short");
    music = {
      ...musicCatalog,
      selectionBasis:
        musicCatalog.selectionBasis ??
        "manually_curated_primary_composer_source_and_license_not_app_api_acceptance",
      bytes: bytes.length,
      durationS: Number(info.format.duration),
    };
  } else {
    const musicUrl = new URL("https://api.openverse.org/v1/audio/");
    musicUrl.search = new URLSearchParams({
      q: "instrumental",
      category: "music",
      license_type: "commercial",
      license: "by,cc0",
      page_size: "20",
    });
    const response = await fetchImpl(musicUrl, {
      headers: { "User-Agent": "pikar-ai/1.0 (media qualification; https://pikar.ai)" },
      redirect: "error",
      signal: AbortSignal.timeout(30_000),
    });
    check(response.ok, "music_search_failed");
    const body = await response.json();
    const musicPool = {
      results: (body.results ?? []).filter((r) => ["by", "cc0"].includes(r.license)),
    };
    const picked = h.pickStockAudio(musicPool, 60, 0);
    check(picked, "music_match_missing");
    const bytes = await getBytes(picked.link, fetchImpl),
      musicPath = "assets/music.mp3";
    writeFileSync(resolve(out, musicPath), bytes, { mode: 0o600 });
    const info = probe(resolve(out, musicPath));
    check(Number(info.format.duration) >= 60, "music_too_short");
    music = {
      assetId: picked.assetId,
      query: musicUrl.toString(),
      ...picked.credit,
      path: musicPath,
      sha256: hash(bytes),
      bytes: bytes.length,
      durationS: Number(info.format.duration),
    };
    validateMusicCatalog(music);
  }
  const assets = {
    acquiredAt: new Date().toISOString(),
    videos,
    music,
    reviewRequired:
      "Integration owner reviews stock frames and music licence/source metadata before this bounded operator comparison. Actual music/final-mix listening remains pending and blocks finished creative or production acceptance, not this authorized benchmark. Metadata is not instrumental-audio proof.",
  };
  writeJson(resolve(out, "assets.json"), assets);
  return assets;
}
export function parseVoiceStream(raw) {
  let base64 = "",
    spoken = "",
    usage = null,
    requestId = null,
    reportedModel = null;
  for (const line of raw.split("\n")) {
    if (!line.startsWith("data:")) continue;
    const payload = line.slice(5).trim();
    if (!payload || payload === "[DONE]") continue;
    let frame;
    try {
      frame = JSON.parse(payload);
    } catch {
      continue;
    }
    if (typeof frame.id === "string") requestId ??= frame.id;
    if (typeof frame.model === "string") reportedModel ??= frame.model;
    if (frame.usage && typeof frame.usage === "object") {
      const known = usage?.cost;
      usage = { ...(usage ?? {}), ...frame.usage };
      if (!finiteCost(usage.cost) && finiteCost(known)) usage.cost = known;
    }
    const audio = frame.choices?.[0]?.delta?.audio;
    if (typeof audio?.data === "string") base64 += audio.data;
    if (typeof audio?.transcript === "string") spoken += audio.transcript;
  }
  return { pcm: Buffer.from(base64, "base64"), spoken, usage, requestId, reportedModel };
}
export function receiptFailure(usage, allowance, { stt = false } = {}) {
  if (!finiteCost(usage?.cost)) return "actual_cost_unknown";
  if (usage?.is_byok === true) return "byok_not_approved";
  if (!stt && usage?.is_byok !== false) return "billing_provenance_unknown";
  if (usage.cost > allowance + 1e-10) return "request_policy_allowance_exceeded";
  return null;
}
const normalize = (s) =>
  s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
function verifyReusedImage(manifest) {
  check(
    hash(readFileSync(resolve(ROOT, manifest.reusedImage.relativePath))) === HIGH_SHA,
    "reused_image_changed",
  );
}
function verifyAssets(out, manifest, verifyImage = verifyReusedImage) {
  check(manifest.assets?.videos?.length === 6 && manifest.assets?.music, "assets_not_prepared");
  for (const asset of [...manifest.assets.videos, manifest.assets.music]) {
    const path = resolve(out, asset.path),
      rel = relative(out, path);
    check(rel && !rel.startsWith("..") && !isAbsolute(rel), "invalid_asset_path");
    check(asset.sha256 === hash(readFileSync(path)), "asset_digest_changed");
    check(asset.licenseUrl && asset.sourceUrl && asset.attribution, "asset_license_missing");
  }
  verifyImage(manifest);
}
/** A POST is journalled before submission. Every error keeps its attempt unresolved; no replay. */
export async function runReelQualification({
  out,
  ledger,
  reviewHash,
  policyAllowanceAck,
  creditBillingOnly,
  apiKey,
  fetchImpl = fetch,
  sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
  render = true,
  verifyImage = verifyReusedImage,
  probeMedia = probe,
}) {
  out = privatePath(out);
  ledger = privatePath(ledger);
  check(policyAllowanceAck && creditBillingOnly, "policy_ack_required");
  check(apiKey, "missing_qualification_key");
  const saved = JSON.parse(readFileSync(resolve(out, "manifest.json"), "utf8"));
  const plan = await reelManifest(saved.manifest.assets);
  check(reviewHash === plan.sha256 && saved.sha256 === plan.sha256, "review_digest_mismatch");
  verifyAssets(out, plan.manifest, verifyImage);
  const state = inspectQualificationLedger(ledger);
  check(!state.unsettled.length, "unsettled_shared_ledger");
  check(state.attempts > 0, "shared_image_ledger_required");
  const keyResponse = await fetchImpl(`${API}/key`, {
    headers: { Authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(30_000),
  });
  check(keyResponse.ok, "key_metadata_unavailable");
  const keyMeta = await keyResponse.json();
  check(keyMeta.data?.is_free_tier === false, "credit_key_required");
  const lock = openSync(`${ledger}.lock`, "wx", 0o600);
  let runLock;
  try {
    runLock = openSync(resolve(out, "execution.lock"), "wx", 0o600);
    closeSync(runLock);
  } catch {
    closeSync(lock);
    unlinkSync(`${ledger}.lock`);
    throw new Error("run_already_attempted");
  }
  const h = await helpers(),
    runId = randomUUID();
  const result = {
    status: "stopped",
    reason: null,
    runId,
    manifestSha256: plan.sha256,
    completed: 0,
    requests: [],
    creditBillingBasis: plan.manifest.billingBasis,
  };
  const auth = { Authorization: `Bearer ${apiKey}` };
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
      let body = request.body,
        joined = null;
      if (request.kind === "stt") {
        const all = plan.manifest.reels.flatMap((r) =>
          r.voiceIds.map((id) => new Uint8Array(readFileSync(resolve(out, `delivered/${id}.wav`)))),
        );
        const concat = h.concatWavTakes(all);
        check(concat.ok, "voice_concat_failed");
        joined = concat.value;
        check(joined.wav.length <= 6 * 1024 * 1024, "stt_audio_too_large");
        writeFileSync(resolve(out, "delivered/clean-voices.wav"), joined.wav, { mode: 0o600 });
        writeJson(resolve(out, "delivered/clean-voices.json"), {
          sha256: hash(joined.wav),
          offsetsS: joined.offsetsS,
          durationS: joined.durationS,
        });
        body = new FormData();
        body.set("file", new Blob([joined.wav], { type: "audio/wav" }), "clean-voices.wav");
        body.set("model", request.multipart.model);
        body.set("response_format", "verbose_json");
        body.set("timestamp_granularities[]", "word");
      }
      const attemptId = randomUUID(),
        started = Date.now();
      const start = {
        event: "request_started",
        approvalRef: APPROVAL,
        runId,
        attemptId,
        startedAt: new Date().toISOString(),
        manifestSha256: plan.sha256,
        requestId: request.id,
        kind: request.kind,
        requestedModel: request.body?.model ?? request.multipart.model,
        policyAllowanceUsd: request.policyAllowanceUsd,
        requestSha256: request.body ? hash(JSON.stringify(body)) : hash(joined.wav),
      };
      append(ledger, start);
      append(resolve(out, "journal.jsonl"), start);
      let usage = null,
        knownCostUsd = null,
        failure = null,
        httpStatus = null,
        providerRequestId = null,
        generationId = null,
        responseIsByok = null,
        generationMetadataIsByok = null,
        reportedModel = null,
        deliveredMedia = null,
        assetPath = null;
      const rememberUsage = (value, source = "response") => {
        if (value && typeof value === "object") {
          if (typeof value.is_byok === "boolean") {
            if (source === "response") responseIsByok = value.is_byok;
            else generationMetadataIsByok = value.is_byok;
          }
          usage = { ...(usage ?? {}), ...value };
          if (finiteCost(value.cost)) knownCostUsd = value.cost;
          if (knownCostUsd !== null) usage.cost = knownCostUsd;
        }
      };
      try {
        const response = await fetchImpl(request.route, {
          method: "POST",
          headers: {
            ...auth,
            ...(request.kind !== "stt" ? { "Content-Type": "application/json" } : {}),
          },
          body: request.kind === "stt" ? body : JSON.stringify(body),
          signal: AbortSignal.timeout(180_000),
        });
        httpStatus = response.status;
        providerRequestId = response.headers.get("x-request-id");
        generationId = response.headers.get("x-generation-id");
        if (request.kind === "tts" && response.ok) {
          const voice = parseVoiceStream(await response.text());
          rememberUsage(voice.usage);
          providerRequestId = voice.requestId ?? providerRequestId;
          reportedModel = voice.reportedModel;
          if (voice.pcm.length) {
            const wav = h.pcm16ToWav(
              new Uint8Array(voice.pcm),
              h.MEDIA_DEFAULT_VOICE.sampleRateHertz,
            );
            const path = `delivered/${request.id}.wav`;
            writeFileSync(resolve(out, path), wav, { mode: 0o600 });
            assetPath = path;
            if (normalize(voice.spoken) !== normalize(request.body.messages[1].content))
              failure = "voice_not_verbatim";
            if (voice.pcm.length / (2 * h.MEDIA_DEFAULT_VOICE.sampleRateHertz) > 5)
              failure ??= "voice_longer_than_scene";
          } else failure = "voice_audio_missing";
        } else {
          let payload = await response.json();
          rememberUsage(payload.usage);
          reportedModel = payload.model ?? null;
          if (request.kind === "video" && response.ok) {
            check(
              typeof payload.id === "string" && /^[A-Za-z0-9._-]+$/.test(payload.id),
              "video_id_missing",
            );
            providerRequestId = payload.id;
            append(resolve(out, "journal.jsonl"), {
              event: "async_job_acknowledged",
              attemptId,
              providerJobId: payload.id,
            });
            const id = payload.id;
            for (let n = 0; n < 90 && !["completed", "failed"].includes(payload.status); n++) {
              await sleep(5_000);
              const polled = await fetchImpl(`${API}/videos/${encodeURIComponent(id)}`, {
                headers: auth,
                signal: AbortSignal.timeout(30_000),
              });
              check(polled.ok, "video_poll_failed");
              payload = await polled.json();
              rememberUsage(payload.usage);
              generationId = payload.generation_id ?? generationId;
              reportedModel = payload.model ?? reportedModel;
            }
            if (payload.status !== "completed") failure = "video_not_completed";
            else {
              const path = `delivered/${request.id}.mp4`;
              const content = await fetchImpl(
                `${API}/videos/${encodeURIComponent(id)}/content?index=0`,
                { headers: auth, redirect: "error", signal: AbortSignal.timeout(120_000) },
              );
              check(content.ok, "video_content_unavailable");
              const bytes = Buffer.from(await content.arrayBuffer());
              check(bytes.length && bytes.length <= MAX_BYTES, "video_content_invalid");
              writeFileSync(resolve(out, path), bytes, { mode: 0o600 });
              assetPath = path;
              const info = probeMedia(resolve(out, path));
              const video = info.streams?.find((s) => s.codec_type === "video");
              deliveredMedia = {
                durationS: Number(info.format?.duration),
                width: video?.width ?? null,
                height: video?.height ?? null,
              };
              if (
                !Number.isFinite(deliveredMedia.durationS) ||
                deliveredMedia.durationS < 4.5 ||
                !video ||
                video.width < 720 ||
                video.height < 1280 ||
                video.height <= video.width
              )
                failure = "video_geometry_or_duration_invalid";
            }
          } else if (request.kind === "stt" && response.ok) {
            writeJson(resolve(out, "delivered/transcript.json"), payload);
            assetPath = "delivered/transcript.json";
            if (
              !Array.isArray(payload.words) ||
              !payload.words.length ||
              payload.words.some(
                (w) =>
                  typeof w.word !== "string" ||
                  !finiteCost(w.start) ||
                  !finiteCost(w.end) ||
                  w.end <= w.start,
              )
            )
              failure = "stt_words_missing";
            // Read-only corroboration can recover an absent formal optional usage.cost, never zero.
            if (
              !finiteCost(usage?.cost) &&
              generationId &&
              /^[A-Za-z0-9._-]+$/.test(generationId)
            ) {
              const meta = await fetchImpl(
                `${API}/generation?id=${encodeURIComponent(generationId)}`,
                { headers: auth, signal: AbortSignal.timeout(30_000) },
              );
              if (meta.ok) {
                const data = (await meta.json()).data;
                if (finiteCost(data?.total_cost)) {
                  writeJson(resolve(out, "delivered/stt-generation-metadata.json"), {
                    id: generationId,
                    total_cost: data.total_cost,
                    is_byok: data.is_byok ?? null,
                  });
                  rememberUsage(
                    {
                      cost: data.total_cost,
                      ...(typeof data.is_byok === "boolean" ? { is_byok: data.is_byok } : {}),
                      costSource: "read_only_generation_total_cost",
                    },
                    "generation_metadata",
                  );
                }
              }
            }
          } else failure = "provider_http_error";
        }
      } catch {
        failure ??= "request_or_delivery_uncertain";
      }
      if (reportedModel && reportedModel !== start.requestedModel)
        failure ??= "reported_model_mismatch";
      failure ??= receiptFailure(usage, request.policyAllowanceUsd, {
        stt: request.kind === "stt",
      });
      // Preserve actual charge even when output/identity/allowance validation fails.
      const receipt = {
        event: failure ? "request_unresolved" : "request_settled",
        approvalRef: APPROVAL,
        runId,
        attemptId,
        requestId: request.id,
        kind: request.kind,
        requestedModel: start.requestedModel,
        reportedModel,
        providerRequestId,
        generationId,
        policyAllowanceUsd: request.policyAllowanceUsd,
        costUsd: knownCostUsd,
        usage,
        responseIsByok,
        generationMetadataIsByok,
        authoritativeCostSource:
          knownCostUsd === null ? null : (usage?.costSource ?? "response_usage_cost"),
        billingBasis:
          responseIsByok !== null
            ? "response_usage_is_byok"
            : generationMetadataIsByok !== null
              ? "read_only_generation_metadata_is_byok"
              : "current_staging_key_metadata_and_owner_standard_credit_attestation",
        elapsedMs: Date.now() - started,
        httpStatus,
        assetPath,
        deliveredMedia,
        assetSha256: assetPath ? hash(readFileSync(resolve(out, assetPath))) : null,
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
    if (render) await renderReels(out, plan.manifest);
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
function command(program, args, options = {}) {
  const result = spawnSync(program, args, {
    encoding: "utf8",
    windowsHide: true,
    maxBuffer: 20 * 1024 * 1024,
    env: localChildEnv(),
    ...options,
  });
  if (options.logPath)
    writeFileSync(options.logPath, `${result.stdout ?? ""}\n${result.stderr ?? ""}`, {
      mode: 0o600,
    });
  check(result.status === 0, "local_render_failed");
  return result.stdout;
}
function renderEnvironment(directory) {
  const env = {
    ...localChildEnv(),
    ASSEMBLE_FONT: "in/font.ttf",
    MSYS2_ARG_CONV_EXCL: "subtitles=",
  };
  if (process.platform === "win32") {
    const found = spawnSync("where.exe", ["ffmpeg"], {
      encoding: "utf8",
      windowsHide: true,
      env: localChildEnv(),
    });
    check(found.status === 0, "ffmpeg_unavailable");
    const executable = found.stdout
      .trim()
      .split(/\r?\n/)[0]
      .replaceAll("\\", "/")
      .replace(/^([A-Za-z]):/, (_, drive) => `/${drive.toLowerCase()}`);
    const bin = resolve(directory, "fixture-bin");
    mkdirSync(bin, { recursive: true });
    const quoted = `'${executable.replaceAll("'", "'\\''")}'`;
    writeFileSync(resolve(bin, "ffmpeg"), `#!/usr/bin/env bash\nexec ${quoted} -cpucount 2 "$@"\n`);
    const prior = env.PATH ?? env.Path ?? "";
    delete env.Path;
    env.PATH = `${bin};${prior}`;
  }
  return env;
}
export async function renderReels(out, manifest) {
  out = privatePath(out);
  verifyAssets(out, manifest);
  const h = await helpers();
  const transcript = JSON.parse(readFileSync(resolve(out, "delivered/transcript.json"), "utf8"));
  const clean = JSON.parse(readFileSync(resolve(out, "delivered/clean-voices.json"), "utf8"));
  const bash = process.platform === "win32" ? "C:/Program Files/Git/bin/bash.exe" : "bash";
  let ordinal = 0;
  for (const reel of manifest.reels) {
    const directory = resolve(out, reel.id);
    mkdirSync(resolve(directory, "in"), { recursive: true });
    mkdirSync(resolve(directory, "out"), { recursive: true });
    for (const [i, source] of reel.sources.entries()) {
      const index = String(i + 1).padStart(2, "0");
      copyFileSync(
        resolve(out, `delivered/${reel.voiceIds[i]}.wav`),
        resolve(directory, `in/voice${index}.wav`),
      );
      if (source === "card")
        writeFileSync(
          resolve(directory, `in/card${index}.txt`),
          i === reel.sources.length - 1
            ? "Make a place.\nRefill. Start again."
            : "A place to return.",
        );
      else if (source === "high")
        copyFileSync(
          resolve(ROOT, manifest.reusedImage.relativePath),
          resolve(directory, `in/block${index}.png`),
        );
      else
        copyFileSync(
          resolve(
            out,
            source.startsWith("stock")
              ? manifest.assets.videos.find((a) => a.id === source).path
              : `delivered/${source}.mp4`,
          ),
          resolve(directory, `in/block${index}.mp4`),
        );
    }
    copyFileSync(resolve(out, manifest.assets.music.path), resolve(directory, "in/music.mp3"));
    const font =
      process.platform === "win32"
        ? "C:/Windows/Fonts/arial.ttf"
        : "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf";
    copyFileSync(font, resolve(directory, "in/font.ttf"));
    for (const file of ["assemble_final.sh", "burn_caps.sh"])
      copyFileSync(
        resolve(ROOT, `packages/backend/convex/render/${file}`),
        resolve(directory, file),
      );
    const env = renderEnvironment(directory);
    const scenes = reel.visuals.flatMap((v) => [
      "--scene",
      `${v === "animated_image" ? "image" : v === "text_card" ? "card" : "video"}:5`,
    ]);
    command(
      bash,
      [
        "--noprofile",
        "--norc",
        "assemble_final.sh",
        ...scenes,
        "--target-seconds",
        String(reel.seconds),
        "--in",
        "in",
        "--out",
        "out/final.mp4",
        "--music",
        "warm",
        "--music-file",
        "in/music.mp3",
        "--card-bg",
        "0xF3EDE1",
        "--card-ink",
        "0x123E3A",
      ],
      { cwd: directory, env, logPath: resolve(directory, "assembly.log") },
    );
    const raw = readFileSync(resolve(directory, "out/final.mp4.assembly.json"), "utf8");
    const parsed = h.parseAssemblySidecar(raw);
    check(parsed.ok, "invalid_assembly_sidecar");
    const start = clean.offsetsS[ordinal],
      end = clean.offsetsS[ordinal + reel.voiceIds.length] ?? clean.durationS;
    const words = transcript.words
      .filter((w) => w.start >= start - 0.01 && w.start < end)
      .map((w) => ({ text: w.word, start: w.start - start, end: w.end - start, type: "word" }));
    const caps = h.buildCaptionLines({
      words,
      report: parsed.value,
      offsetsS: clean.offsetsS.slice(ordinal, ordinal + reel.voiceIds.length).map((v) => v - start),
    });
    check(caps.length > 0, "empty_captions");
    writeFileSync(resolve(directory, "in/caps.ass"), h.toAss(caps));
    command(
      bash,
      [
        "--noprofile",
        "--norc",
        "burn_caps.sh",
        "--in",
        "out/final.mp4",
        "--subs",
        "in/caps.ass",
        "--out",
        "out/final.captioned.mp4",
      ],
      { cwd: directory, env, logPath: resolve(directory, "captions.log") },
    );
    const output = probe(resolve(directory, "out/final.captioned.mp4"));
    check(Math.abs(Number(output.format.duration) - reel.seconds) <= 0.5, "render_duration_wrong");
    const video = output.streams.find((s) => s.codec_type === "video");
    check(video?.width === 720 && video?.height === 1280, "render_geometry_wrong");
    check(
      output.streams.some((s) => s.codec_type === "audio"),
      "render_audio_missing",
    );
    command(
      "ffmpeg",
      [
        "-cpucount",
        "2",
        "-v",
        "error",
        "-i",
        resolve(directory, "out/final.captioned.mp4"),
        "-f",
        "null",
        "-",
      ],
      { logPath: resolve(directory, "decode.log") },
    );
    writeJson(resolve(directory, "verification.json"), {
      durationS: Number(output.format.duration),
      width: video.width,
      height: video.height,
      fps: video.avg_frame_rate,
      captionLines: caps.length,
      decodePassed: true,
      visualAndListeningReview: "pending; operator local render only",
    });
    ordinal += reel.voiceIds.length;
  }
}
export async function main(argv = process.argv.slice(2)) {
  const flags = new Set([
    "--prepare",
    "--fetch-stock",
    "--execute",
    "--render-only",
    "--policy-allowance-ack",
    "--credit-billing-only",
  ]);
  const values = new Set([
      "--out",
      "--ledger",
      "--review-hash",
      "--stock-catalog",
      "--music-catalog",
    ]),
    options = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    check(flags.has(arg) || values.has(arg), "unknown_argument");
    check(!(arg in options), "duplicate_argument");
    if (values.has(arg)) {
      check(argv[i + 1] && !argv[i + 1].startsWith("--"), "missing_argument_value");
      options[arg] = argv[++i];
    } else options[arg] = true;
  }
  check(
    ["--prepare", "--execute", "--render-only"].filter((v) => options[v]).length <= 1,
    "conflicting_modes",
  );
  check(
    !options["--stock-catalog"] || options["--fetch-stock"],
    "stock_catalog_requires_fetch_stock",
  );
  check(
    !options["--music-catalog"] || options["--fetch-stock"],
    "music_catalog_requires_fetch_stock",
  );
  const out = privatePath(options["--out"] ?? resolve(ROOT, ".tmp/phase53-reel-qualification"));
  mkdirSync(out, { recursive: true });
  const ledger = privatePath(
    options["--ledger"] ?? resolve(ROOT, ".tmp/phase53-paid-qualification/charges.jsonl"),
  );
  if (options["--execute"])
    check(
      ledger === resolve(ROOT, ".tmp/phase53-paid-qualification/charges.jsonl"),
      "canonical_shared_ledger_required",
    );
  if (options["--render-only"]) {
    const saved = JSON.parse(readFileSync(resolve(out, "manifest.json"), "utf8"));
    const current = await reelManifest(saved.manifest.assets);
    check(
      options["--review-hash"] === current.sha256 && saved.sha256 === current.sha256,
      "review_digest_mismatch",
    );
    await renderReels(out, current.manifest);
    console.info(JSON.stringify({ status: "rendered_local_only", out }));
    return;
  }
  if (!options["--execute"]) {
    check(!existsSync(resolve(out, "execution.lock")), "run_already_attempted");
    let assets = existsSync(resolve(out, "assets.json"))
      ? JSON.parse(readFileSync(resolve(out, "assets.json"), "utf8"))
      : null;
    if (options["--fetch-stock"])
      assets = await prepareStock({
        out,
        pexelsKey: process.env.PEXELS_QUALIFICATION_API_KEY,
        catalog: options["--stock-catalog"]
          ? JSON.parse(readFileSync(privatePath(options["--stock-catalog"]), "utf8"))
          : null,
        musicCatalog: options["--music-catalog"]
          ? JSON.parse(readFileSync(privatePath(options["--music-catalog"]), "utf8"))
          : null,
      });
    const plan = await reelManifest(assets);
    writeJson(resolve(out, "manifest.json"), plan);
    console.info(
      JSON.stringify({
        mode: options["--fetch-stock"] ? "prepared_read_only_stock_gets" : "prepared_no_egress",
        requests: plan.manifest.requests.length,
        manifestSha256: plan.sha256,
        assetsPrepared: !!assets,
        reelPolicyAllowanceUsd: 1.9,
        guaranteedInvoiceCeilingUsd: null,
        out,
      }),
    );
    return;
  }
  check(!options["--fetch-stock"], "stock_fetch_not_allowed_during_paid_execution");
  const result = await runReelQualification({
    out,
    ledger,
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
    console.error("REEL_QUALIFICATION_REFUSED");
    process.exitCode = 2;
  });
