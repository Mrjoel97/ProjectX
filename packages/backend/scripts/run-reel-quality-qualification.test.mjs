import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { inspectQualificationLedger } from "./run-image-quality-qualification.mjs";
import {
  localChildEnv,
  main,
  parseVoiceStream,
  receiptFailure,
  reelManifest,
  runReelQualification,
  validateManualCatalog,
  validateMusicCatalog,
} from "./run-reel-quality-qualification.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const approvalRef = "phase53-owner-2026-10-22-five-usd-testing";
const hash = (s) => createHash("sha256").update(s).digest("hex");
const json = (value, status = 200) =>
  new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
async function fixture(t) {
  const base = resolve(ROOT, ".tmp");
  mkdirSync(base, { recursive: true });
  const out = mkdtempSync(resolve(base, "reel-qualification-test-"));
  t.after(() => rmSync(out, { recursive: true, force: true }));
  mkdirSync(resolve(out, "assets"));
  const makeAsset = (i) => {
    const path = `assets/test-${i}`,
      bytes = Buffer.from(`local mock ${i}`);
    writeFileSync(resolve(out, path), bytes);
    return {
      id: `stock-${i}`,
      path,
      sha256: hash(bytes),
      licenseUrl: "https://example.org/license",
      sourceUrl: "https://example.org/source",
      attribution: "Synthetic transport fixture, never rendered",
    };
  };
  const assets = {
    videos: Array.from({ length: 6 }, (_, i) => makeAsset(i)),
    music: makeAsset("music"),
  };
  const plan = await reelManifest(assets);
  writeFileSync(resolve(out, "manifest.json"), JSON.stringify(plan));
  const ledger = resolve(out, "charges.jsonl");
  writeFileSync(
    ledger,
    `${[
      { event: "budget_opened", approvalRef, allowanceUsd: 5, guaranteedInvoiceCeilingUsd: null },
      { event: "request_started", approvalRef, attemptId: "images-already-reviewed" },
      {
        event: "request_settled",
        approvalRef,
        attemptId: "images-already-reviewed",
        costUsd: 0.211995,
      },
    ]
      .map(JSON.stringify)
      .join("\n")}\n`,
  );
  return {
    out,
    ledger,
    plan,
    options: {
      out,
      ledger,
      reviewHash: plan.sha256,
      policyAllowanceAck: true,
      creditBillingOnly: true,
      apiKey: "synthetic-not-a-key",
      render: false,
      verifyImage: () => {}, // Pure transport fixture: no ignored paid image required in CI.
      probeMedia: () => ({
        format: { duration: "5" },
        streams: [{ codec_type: "video", width: 720, height: 1280 }],
      }),
      sleep: async () => {},
    },
  };
}
function transport(f, modify = {}) {
  const calls = [];
  const fetchImpl = async (input, init = {}) => {
    const url = String(input);
    calls.push({ url, method: init.method ?? "GET" });
    if (url.endsWith("/key")) return json({ data: { is_free_tier: false } });
    if (init.method === "POST") {
      const rows = readFileSync(f.ledger, "utf8").trim().split("\n").map(JSON.parse);
      assert.equal(rows.at(-1).event, "request_started", "receipt persisted before any POST");
      assert.equal(inspectQualificationLedger(f.ledger).unsettled.length, 1);
      if (modify.post) {
        const result = await modify.post(url, init, calls);
        if (result) return result;
      }
      if (url.endsWith("/videos"))
        return json({
          id: `mock-video-${calls.length}`,
          status: "completed",
          usage: { cost: 0.35, is_byok: false },
        });
      if (url.endsWith("/chat/completions")) {
        const body = JSON.parse(init.body),
          spoken = body.messages[1].content;
        return new Response(
          [
            `data: ${JSON.stringify({ id: `mock-voice-${calls.length}`, model: body.model, choices: [{ delta: { audio: { data: Buffer.alloc(24000).toString("base64"), transcript: spoken } } }] })}`,
            `data: ${JSON.stringify({ usage: { cost: 0.001, is_byok: false }, choices: [] })}`,
            "data: [DONE]",
          ].join("\n"),
        );
      }
      if (url.endsWith("/audio/transcriptions")) {
        assert(init.body instanceof FormData);
        assert.equal(init.body.get("response_format"), "verbose_json");
        return json({ words: [{ word: "Give", start: 0, end: 0.1 }], usage: { cost: 0.001 } });
      }
    }
    if (url.includes("/content?"))
      return modify.content
        ? modify.content()
        : new Response(Buffer.from("mock mp4 transport bytes"));
    if (url.includes("/videos/"))
      return modify.poll
        ? modify.poll()
        : json({ status: "completed", usage: { cost: 0.35, is_byok: false } });
    throw new Error("unexpected_mock_request");
  };
  return { fetchImpl, calls };
}
test("manifest freezes 2 video + 16 unique exact voices + last STT, bounded 30/60 scene plans", async () => {
  const { manifest } = await reelManifest();
  assert.equal(manifest.requests.length, 19);
  assert.equal(manifest.requests.at(-1).kind, "stt");
  assert.equal(manifest.requests.filter((r) => r.kind === "tts").length, 16);
  assert.equal(
    new Set(
      manifest.requests.filter((r) => r.kind === "tts").map((r) => r.body.messages[1].content),
    ).size,
    16,
  );
  assert.deepEqual(
    manifest.requests
      .slice(0, 2)
      .map((r) => [r.body.duration, r.body.resolution, r.body.aspect_ratio]),
    [
      [5, "720p", "9:16"],
      [5, "720p", "9:16"],
    ],
  );
  assert.deepEqual(
    manifest.reels.map((r) => r.sources.length * 5),
    [30, 60],
  );
  assert.equal(manifest.reusedImage.additionalPaidImageRequests, 0);
  assert.equal(manifest.guaranteedInvoiceCeilingUsd, null);
  assert(Math.abs(manifest.requests.reduce((a, r) => a + r.policyAllowanceUsd, 0) - 1.9) < 1e-10);
});
test("default prepare never calls fetch", async (t) => {
  const f = await fixture(t);
  const old = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = () => {
    calls++;
    throw new Error("no_egress");
  };
  try {
    await main(["--prepare", "--out", f.out]);
  } finally {
    globalThis.fetch = old;
  }
  assert.equal(calls, 0);
});
test("child environment contains operating-system paths, never either qualification key or other application secrets", () => {
  assert.deepEqual(
    localChildEnv({
      PATH: "/bin",
      SystemRoot: "C:/Windows",
      OPENROUTER_QUALIFICATION_API_KEY: "never-child",
      PEXELS_QUALIFICATION_API_KEY: "never-child",
      OTHER_SECRET: "never-child",
    }),
    { PATH: "/bin", SystemRoot: "C:/Windows" },
  );
});
test("stream parser reads terminal usage and exact split audio/transcript without inventing model", () => {
  const result = parseVoiceStream(
    ': comment\ndata: {"choices":[{"delta":{"audio":{"data":"AAE=","transcript":"hello"}}}]}\ndata: {"usage":{"cost":0.02,"is_byok":false},"choices":[]}\ndata: [DONE]',
  );
  assert.equal(result.usage.cost, 0.02);
  assert.equal(result.spoken, "hello");
  assert.equal(result.reportedModel, null);
  assert.deepEqual([...result.pcm], [0, 1]);
});
test("empty terminal stream usage cannot erase a known cost or billing provenance", () => {
  const parsed = parseVoiceStream(
    'data: {"usage":{"cost":0.004,"is_byok":false}}\ndata: {"usage":{}}\ndata: [DONE]',
  );
  assert.equal(parsed.usage.cost, 0.004);
  assert.equal(parsed.usage.is_byok, false);
});
test("billing provenance distinguishes absent STT is_byok from response false and never assumes zero cost", () => {
  assert.equal(receiptFailure({ cost: 0.001 }, 0.1, { stt: true }), null);
  assert.equal(receiptFailure({ cost: 0.001 }, 0.1), "billing_provenance_unknown");
  assert.equal(receiptFailure({ is_byok: false }, 0.1, { stt: true }), "actual_cost_unknown");
  assert.equal(
    receiptFailure({ cost: 0.001, is_byok: true }, 0.1, { stt: true }),
    "byok_not_approved",
  );
});
test("manual stock catalog requires six unique public Pexels records and never accepts arbitrary credential hosts", () => {
  const catalog = Array.from({ length: 6 }, (_, i) => ({
    id: `stock-${i}`,
    assetId: String(i),
    query: "illustrative shot",
    sourceUrl: `https://www.pexels.com/video/shot-${i}/`,
    creator: "Fixture author",
    downloadUrl: `https://videos.pexels.com/video-files/${i}/video.mp4`,
  }));
  assert.equal(validateManualCatalog(catalog), catalog);
  assert.throws(
    () =>
      validateManualCatalog(
        catalog.map((a, i) => (i === 0 ? { ...a, downloadUrl: "https://localhost/private" } : a)),
      ),
    /public_https_required/,
  );
  assert.throws(
    () => validateManualCatalog(catalog.map((a) => ({ ...a, assetId: "same" }))),
    /manual_stock_ids_invalid/,
  );
  assert.throws(
    () =>
      validateManualCatalog(
        catalog.map((a, i) =>
          i === 0 ? { ...a, sourceUrl: "https://unreviewed.example/video/" } : a,
        ),
      ),
    /manual_stock_page_invalid/,
  );
});
test("curated music accepts BY/CC0 provenance but refuses SA/NC and missing local digest", () => {
  const music = {
    path: "assets/music.mp3",
    sha256: "a".repeat(64),
    title: "Fixture",
    creator: "Author",
    sourceUrl: "https://example.org/track",
    attribution: "Fixture by Author",
    durationS: 60,
    licenseUrl: "https://creativecommons.org/licenses/by/3.0/",
  };
  assert.equal(validateMusicCatalog(music), music);
  assert.throws(
    () =>
      validateMusicCatalog({
        ...music,
        licenseUrl: "https://creativecommons.org/licenses/by-sa/3.0/",
      }),
    /music_license_not_by_or_cc0/,
  );
  assert.throws(() => validateMusicCatalog({ ...music, sha256: "" }), /music_catalog_invalid/);
});
test("changed review digest and alternate CLI ledger refuse before network", async (t) => {
  const f = await fixture(t);
  let calls = 0;
  await assert.rejects(
    runReelQualification({
      ...f.options,
      reviewHash: "wrong",
      fetchImpl: async () => {
        calls++;
      },
    }),
    /review_digest_mismatch/,
  );
  await assert.rejects(
    main(["--execute", "--out", f.out, "--ledger", f.ledger]),
    /canonical_shared_ledger_required/,
  );
  assert.equal(calls, 0);
});
test("unsettled prior spend blocks every request", async (t) => {
  const f = await fixture(t);
  writeFileSync(
    f.ledger,
    `${readFileSync(f.ledger)}${JSON.stringify({ event: "request_started", approvalRef, attemptId: "uncertain-old-request" })}\n`,
  );
  let calls = 0;
  await assert.rejects(
    runReelQualification({
      ...f.options,
      fetchImpl: async () => {
        calls++;
      },
    }),
    /unsettled_shared_ledger/,
  );
  assert.equal(calls, 0);
});
test("known video cost survives content failure and blocks all later purchases", async (t) => {
  const f = await fixture(t),
    mock = transport(f, { content: () => new Response("missing", { status: 503 }) });
  const result = await runReelQualification({ ...f.options, ...mock });
  assert.equal(result.status, "stopped");
  assert.equal(result.requests.length, 1);
  assert.equal(result.requests[0].costUsd, 0.35);
  assert.equal(result.requests[0].assetPath, null);
  assert.equal(result.requests[0].event, "request_unresolved");
  assert.equal(mock.calls.filter((c) => c.method === "POST").length, 1);
  assert(Math.abs(inspectQualificationLedger(f.ledger).spentUsd - 0.561995) < 1e-10);
});
test("later empty async usage cannot erase a known finite cost", async (t) => {
  const f = await fixture(t),
    mock = transport(f, {
      post: async (url) =>
        url.endsWith("/videos")
          ? json({ id: "mock-pending", status: "pending", usage: { cost: 0.35, is_byok: false } })
          : null,
      poll: () => json({ status: "completed", usage: {} }),
      content: () => new Response("missing", { status: 503 }),
    });
  const result = await runReelQualification({ ...f.options, ...mock });
  assert.equal(result.requests[0].costUsd, 0.35);
  assert.equal(result.requests[0].usage.is_byok, false);
  assert.equal(mock.calls.filter((c) => c.method === "POST").length, 1);
});
test("unknown video usage stops after one POST, leaves unsettled ledger, never auto retries", async (t) => {
  const f = await fixture(t),
    mock = transport(f, {
      post: async (url) =>
        url.endsWith("/videos") ? json({ id: "mock-free-unknown", status: "completed" }) : null,
    });
  const result = await runReelQualification({ ...f.options, ...mock });
  assert.equal(result.reason, "actual_cost_unknown");
  assert.equal(result.requests[0].costUsd, null);
  assert.equal(mock.calls.filter((c) => c.method === "POST").length, 1);
  assert.equal(inspectQualificationLedger(f.ledger).unsettled.length, 1);
});
test("short or undersized delivered video stops before buying the second clip or voices, preserving charge", async (t) => {
  const f = await fixture(t),
    mock = transport(f);
  const result = await runReelQualification({
    ...f.options,
    ...mock,
    probeMedia: () => ({
      format: { duration: "3" },
      streams: [{ codec_type: "video", width: 480, height: 854 }],
    }),
  });
  assert.equal(result.reason, "video_geometry_or_duration_invalid");
  assert.equal(result.requests[0].costUsd, 0.35);
  assert.equal(mock.calls.filter((c) => c.method === "POST").length, 1);
});
test("over-policy video charge is retained while later purchases stop", async (t) => {
  const f = await fixture(t),
    mock = transport(f, {
      post: async (url) =>
        url.endsWith("/videos")
          ? json({ id: "mock-overrun", status: "completed", usage: { cost: 0.65, is_byok: false } })
          : null,
    });
  const result = await runReelQualification({ ...f.options, ...mock });
  assert.equal(result.reason, "request_policy_allowance_exceeded");
  assert.equal(result.requests[0].costUsd, 0.65);
  assert.equal(mock.calls.filter((c) => c.method === "POST").length, 1);
});
test("explicit different reported model retains charge and stops", async (t) => {
  const f = await fixture(t),
    mock = transport(f, {
      post: async (url) =>
        url.endsWith("/videos")
          ? json({
              id: "mock-model",
              model: "unreviewed/other",
              status: "completed",
              usage: { cost: 0.35, is_byok: false },
            })
          : null,
    });
  const result = await runReelQualification({ ...f.options, ...mock });
  assert.equal(result.reason, "reported_model_mismatch");
  assert.equal(result.requests[0].costUsd, 0.35);
  assert.equal(mock.calls.filter((c) => c.method === "POST").length, 1);
});
test("voice over five-cent policy preserves charge and stops before buying any sibling voice", async (t) => {
  const f = await fixture(t),
    mock = transport(f, {
      post: async (url, init) => {
        if (!url.endsWith("/chat/completions")) return null;
        const body = JSON.parse(init.body);
        return new Response(
          `data: ${JSON.stringify({ choices: [{ delta: { audio: { data: Buffer.alloc(24000).toString("base64"), transcript: body.messages[1].content } } }], usage: { cost: 0.06, is_byok: false } })}\ndata: [DONE]`,
        );
      },
    });
  const result = await runReelQualification({ ...f.options, ...mock });
  assert.equal(result.reason, "request_policy_allowance_exceeded");
  assert.equal(result.requests.at(-1).costUsd, 0.06);
  assert.equal(mock.calls.filter((c) => c.method === "POST").length, 3);
});
test("last STT with absent usage retains delivered transcript and all earlier charges but remains unresolved", async (t) => {
  const f = await fixture(t),
    mock = transport(f, {
      post: async (url) =>
        url.endsWith("/audio/transcriptions")
          ? json({ words: [{ word: "Give", start: 0, end: 0.1 }] })
          : null,
    });
  const result = await runReelQualification({ ...f.options, ...mock });
  assert.equal(result.reason, "actual_cost_unknown");
  assert.equal(result.requests.at(-1).costUsd, null);
  assert.equal(result.requests.at(-1).responseIsByok, null);
  assert(existsSync(resolve(f.out, "delivered/transcript.json")));
  assert.equal(mock.calls.filter((c) => c.method === "POST").length, 19);
  const ledger = inspectQualificationLedger(f.ledger);
  assert.equal(ledger.unsettled.length, 1);
  assert(Math.abs(ledger.spentUsd - (0.211995 + 0.7 + 0.016)) < 1e-10);
});
test("STT read-only generation corroboration can settle known cost without inventing is_byok", async (t) => {
  const f = await fixture(t),
    mock = transport(f, {
      post: async (url) =>
        url.endsWith("/audio/transcriptions")
          ? new Response(JSON.stringify({ words: [{ word: "Give", start: 0, end: 0.1 }] }), {
              headers: { "x-generation-id": "gen-mock-stt" },
            })
          : null,
    });
  const base = mock.fetchImpl;
  mock.fetchImpl = async (input, init) =>
    String(input).includes("/generation?id=")
      ? json({ data: { total_cost: 0.003, is_byok: false } })
      : base(input, init);
  const result = await runReelQualification({ ...f.options, ...mock });
  assert.equal(result.status, "completed");
  assert.equal(result.requests.at(-1).costUsd, 0.003);
  assert.equal(result.requests.at(-1).responseIsByok, null);
  assert.equal(result.requests.at(-1).generationMetadataIsByok, false);
  assert.equal(result.requests.at(-1).billingBasis, "read_only_generation_metadata_is_byok");
  assert.equal(result.requests.at(-1).usage.costSource, "read_only_generation_total_cost");
  assert.equal(inspectQualificationLedger(f.ledger).unsettled.length, 0);
});
test("mock full delivery makes exactly 19 POSTs with STT last, distinguishes account attestation, and is single use", async (t) => {
  const f = await fixture(t),
    mock = transport(f);
  const result = await runReelQualification({ ...f.options, ...mock });
  assert.equal(result.status, "completed");
  assert.equal(result.completed, 19);
  assert.equal(mock.calls.filter((c) => c.method === "POST").length, 19);
  assert(mock.calls.at(-1).url.endsWith("/audio/transcriptions"));
  assert.equal(result.requests.at(-1).responseIsByok, null);
  assert.equal(
    result.requests.at(-1).billingBasis,
    "current_staging_key_metadata_and_owner_standard_credit_attestation",
  );
  assert.equal(inspectQualificationLedger(f.ledger).unsettled.length, 0);
  assert(existsSync(resolve(f.out, "delivered/clean-voices.json")));
  await assert.rejects(runReelQualification({ ...f.options, ...mock }), /run_already_attempted/);
  assert.equal(mock.calls.filter((c) => c.method === "POST").length, 19);
  assert(!readFileSync(resolve(f.out, "result.json"), "utf8").includes("synthetic-not-a-key"));
});
test("shared five-dollar policy refuses next half-dollar purchase using actual earlier lane charges", async (t) => {
  const f = await fixture(t);
  const rows = readFileSync(f.ledger, "utf8").trim().split("\n").map(JSON.parse);
  rows.at(-1).costUsd = 4.6;
  writeFileSync(f.ledger, `${rows.map(JSON.stringify).join("\n")}\n`);
  const mock = transport(f);
  const result = await runReelQualification({ ...f.options, ...mock });
  assert.equal(result.reason, "shared_policy_allowance_stop");
  assert.equal(mock.calls.filter((c) => c.method === "POST").length, 0);
});
