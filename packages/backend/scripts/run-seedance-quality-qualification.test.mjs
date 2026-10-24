import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { inspectQualificationLedger } from "./run-image-quality-qualification.mjs";
import {
  main,
  runSeedanceQualification,
  seedanceManifest,
} from "./run-seedance-quality-qualification.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const approvalRef = "phase53-owner-2026-10-22-five-usd-testing";
const hash = (x) => createHash("sha256").update(x).digest("hex");
const json = (x, status = 200) => new Response(JSON.stringify(x), { status });
function fixture(t, profile = "comparison") {
  mkdirSync(resolve(ROOT, ".tmp"), { recursive: true });
  const out = mkdtempSync(resolve(ROOT, ".tmp/seedance-qualification-test-"));
  t.after(() => rmSync(out, { recursive: true, force: true }));
  const baseline = resolve(out, "baseline");
  mkdirSync(resolve(baseline, "delivered"), { recursive: true });
  const requests = [0, 1].map((i) => {
    const bytes = Buffer.from(`already purchased baseline ${i}`),
      assetPath = `delivered/video-${i}.mp4`;
    writeFileSync(resolve(baseline, assetPath), bytes);
    return {
      event: "request_settled",
      requestId: `video-${i}`,
      assetPath,
      assetSha256: hash(bytes),
      costUsd: 0.35,
      elapsedMs: 60_000,
    };
  });
  writeFileSync(resolve(baseline, "result.json"), JSON.stringify({ requests }));
  writeFileSync(
    resolve(baseline, "manifest.json"),
    JSON.stringify({
      manifest: {
        requests: [0, 1].map((i) => ({
          id: `video-${i}`,
          kind: "video",
          body: {
            model: "x-ai/grok-imagine-video",
            prompt: `Exact original brief ${i}`,
            duration: 5,
            resolution: "720p",
            aspect_ratio: "9:16",
          },
        })),
      },
    }),
  );
  const reference =
    profile === "standard_reference_launch"
      ? {
          url: "https://woozy-wren-368.convex.cloud/api/storage/approved-reference",
          path: `${out}/reference.png`,
          sourceVideoPath: `${baseline}/delivered/video-0.mp4`,
          sourceVideoSha256: requests[0].assetSha256,
          sha256: hash(
            Buffer.concat([
              Buffer.from("89504e470d0a1a0a", "hex"),
              Buffer.from("approved bottle fixture"),
            ]),
          ),
        }
      : undefined;
  if (reference)
    writeFileSync(
      reference.path,
      Buffer.concat([
        Buffer.from("89504e470d0a1a0a", "hex"),
        Buffer.from("approved bottle fixture"),
      ]),
    );
  const plan = seedanceManifest(baseline, profile, reference);
  writeFileSync(resolve(out, "manifest.json"), JSON.stringify(plan));
  const ledger = resolve(out, "charges.jsonl");
  writeFileSync(
    ledger,
    `${[
      { event: "budget_opened", approvalRef, allowanceUsd: 5 },
      { event: "request_started", approvalRef, attemptId: "prior" },
      { event: "request_settled", approvalRef, attemptId: "prior", costUsd: 0.9213768 },
    ]
      .map(JSON.stringify)
      .join("\n")}\n`,
  );
  const options = {
    out,
    ledger,
    reviewHash: plan.sha256,
    apiKey: "synthetic-not-a-key",
    policyAllowanceAck: true,
    creditBillingOnly: true,
    sleep: async () => {},
    probeMedia: () => ({
      format: { duration: "5" },
      streams: [{ codec_type: "video", width: 720, height: 1280 }],
    }),
  };
  return { out, ledger, plan, options, reference };
}
function transport(f, change = {}) {
  const calls = [];
  let posts = 0;
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url, init });
    if (url.endsWith("/videos/models"))
      return json({
        data: [
          {
            id: "bytedance/seedance-1-5-pro",
            supported_durations: [5],
            supported_resolutions: ["720p"],
            supported_aspect_ratios: ["9:16"],
            supported_sizes: ["720x1280"],
            generate_audio: true,
            pricing_skus: { video_tokens_without_audio: "0.0000012" },
          },
          {
            id: "bytedance/seedance-2.0-mini",
            supported_durations: [5],
            supported_resolutions: ["720p"],
            supported_aspect_ratios: ["9:16"],
            supported_sizes: ["720x1280"],
            generate_audio: true,
            pricing_skus: { video_tokens_without_audio: "0.0000035" },
          },
        ],
      });
    if (url.endsWith("/key")) return json({ data: { is_free_tier: false } });
    if (init.method === "POST") {
      posts++;
      assert.equal(
        JSON.parse(readFileSync(f.ledger, "utf8").trim().split("\n").at(-1)).event,
        "request_started",
      );
      assert.equal(inspectQualificationLedger(f.ledger).unsettled.length, 1);
      if (change.post) return change.post(posts);
      return json(
        {
          id: `job-${posts}`,
          status: "pending",
          polling_url: "https://untrusted.invalid/never-follow",
        },
        202,
      );
    }
    if (url.includes("/content?index=0")) return new Response(Buffer.from("synthetic video bytes"));
    return json({
      id: `job-${posts}`,
      status: "completed",
      model: posts === 3 ? "bytedance/seedance-2.0-mini" : "bytedance/seedance-1-5-pro",
      generation_id: `gen-${posts}`,
      usage: { cost: 0.1296, is_byok: false },
      ...(change.payload ?? {}),
    });
  };
  return { calls, fetchImpl, posts: () => posts };
}

test("fixed comparison preserves both original briefs without repurchasing baseline or adding assets", (t) => {
  const f = fixture(t);
  assert.equal(f.plan.manifest.requests.length, 3);
  for (const [i, r] of f.plan.manifest.requests.slice(0, 2).entries()) {
    assert.deepEqual(r.body, {
      model: "bytedance/seedance-1-5-pro",
      prompt: `Exact original brief ${i}`,
      duration: 5,
      resolution: "720p",
      aspect_ratio: "9:16",
      generate_audio: false,
    });
    assert.equal(r.baseline.costUsd, 0.35);
  }
  assert.equal(f.plan.manifest.automaticRetries, 0);
  assert.equal(f.plan.manifest.retirementDate, "2026-11-11");
  assert.equal(f.plan.manifest.requests[2].body.model, "bytedance/seedance-2.0-mini");
  assert.equal(f.plan.manifest.requests[2].body.prompt, f.plan.manifest.requests[0].body.prompt);
  assert.equal(f.plan.manifest.requests[2].estimatedUsd, 0.378);
});

test("15-second launch binds the exact approved reference, native sound and remaining shared allowance", async (t) => {
  const f = fixture(t, "standard_reference_launch");
  const request = f.plan.manifest.requests[0];
  assert.equal(f.plan.manifest.requests.length, 1);
  assert.equal(request.body.duration, 15);
  assert.equal(request.body.generate_audio, true);
  assert.equal(request.policyAllowanceUsd, 2.6);
  assert.equal(f.plan.manifest.automaticRetries, 0);
  assert.deepEqual(request.body.input_references, [
    { type: "image_url", image_url: { url: f.reference.url } },
  ]);
  let posts = 0;
  const fetchImpl = async (url, init = {}) => {
    if (url === f.reference.url)
      return new Response(readFileSync(f.reference.path), {
        headers: { "content-type": "image/png" },
      });
    if (url.endsWith("/videos/models"))
      return json({
        data: [
          {
            id: request.body.model,
            supported_durations: [15],
            supported_resolutions: ["720p"],
            supported_aspect_ratios: ["9:16"],
            supported_sizes: ["720x1280"],
            generate_audio: true,
            pricing_skus: f.plan.manifest.catalogue[0].pricingSkus,
          },
        ],
      });
    if (url.endsWith("/key")) return json({ data: { is_free_tier: false } });
    if (init.method === "POST") {
      posts++;
      assert.deepEqual(JSON.parse(init.body), request.body);
      assert.equal(inspectQualificationLedger(f.ledger).unsettled.length, 1);
      return json({ id: "launch-job", status: "pending" }, 202);
    }
    if (url.includes("/content?index=0")) return new Response(Buffer.from("native launch bytes"));
    return json({
      id: "launch-job",
      status: "completed",
      model: request.body.model,
      usage: { cost: 2.2743, is_byok: false },
    });
  };
  const result = await runSeedanceQualification({
    ...f.options,
    fetchImpl,
    probeMedia: () => ({
      format: { duration: "15.064" },
      streams: [{ codec_type: "video", width: 720, height: 1280 }, { codec_type: "audio" }],
    }),
  });
  assert.equal(result.status, "completed");
  assert.equal(posts, 1);
});

test("changed launch reference bytes refuse before any egress", async (t) => {
  const f = fixture(t, "standard_reference_launch");
  writeFileSync(f.reference.path, Buffer.from("changed image bytes"));
  await assert.rejects(
    runSeedanceQualification({
      ...f.options,
      fetchImpl: () => {
        throw Error("must not call");
      },
    }),
    /reviewed_reference_changed/,
  );
});

test("new reference pricing SKU refuses before a paid launch", async (t) => {
  const f = fixture(t, "standard_reference_launch");
  await assert.rejects(
    runSeedanceQualification({
      ...f.options,
      fetchImpl: async () =>
        json({
          data: [
            {
              id: "bytedance/seedance-2.0",
              supported_durations: [15],
              supported_resolutions: ["720p"],
              supported_aspect_ratios: ["9:16"],
              supported_sizes: ["720x1280"],
              generate_audio: true,
              pricing_skus: { ...f.plan.manifest.catalogue[0].pricingSkus, image_input: 1 },
            },
          ],
        }),
    }),
    /reference_pricing_changed/,
  );
  assert.equal(inspectQualificationLedger(f.ledger).attempts, 1);
});

for (const hasAudio of [true, false])
  test(`standard native audio requires its requested audio stream (${hasAudio})`, async (t) => {
    const f = fixture(t, "standard_native_audio");
    assert.equal(f.plan.manifest.requests.length, 1);
    const request = f.plan.manifest.requests[0];
    assert.equal(request.body.model, "bytedance/seedance-2.0");
    assert.equal(request.body.generate_audio, true);
    assert.equal(request.body.duration, 4);
    assert.equal(request.policyAllowanceUsd, 1);
    assert.equal(f.plan.manifest.retirementDate, null);
    let posts = 0;
    const fetchImpl = async (url, init = {}) => {
      if (url.endsWith("/videos/models"))
        return json({
          data: [
            {
              id: request.body.model,
              supported_durations: [4],
              supported_resolutions: ["720p"],
              supported_aspect_ratios: ["9:16"],
              supported_sizes: ["720x1280"],
              generate_audio: true,
              pricing_skus: { video_tokens: "0.000007" },
            },
          ],
        });
      if (url.endsWith("/key")) return json({ data: { is_free_tier: false } });
      if (init.method === "POST") {
        posts++;
        assert.deepEqual(JSON.parse(init.body), request.body);
        assert.equal(inspectQualificationLedger(f.ledger).unsettled.length, 1);
        return json({ id: "native-job", status: "pending" }, 202);
      }
      if (url.includes("/content?index=0")) return new Response(Buffer.from("native bytes"));
      return json({
        id: "native-job",
        status: "completed",
        model: request.body.model,
        usage: { cost: 0.6111, is_byok: false },
      });
    };
    const result = await runSeedanceQualification({
      ...f.options,
      fetchImpl,
      probeMedia: () => ({
        format: { duration: "4.041667" },
        streams: [
          { codec_type: "video", width: 720, height: 1280 },
          ...(hasAudio ? [{ codec_type: "audio" }] : []),
        ],
      }),
    });
    assert.equal(result.status, hasAudio ? "completed" : "stopped");
    assert.equal(result.completed, hasAudio ? 1 : 0);
    assert.equal(posts, 1);
    assert.equal(result.requests[0].deliveredMedia.audioStreams, hasAudio ? 1 : 0);
    assert.equal(inspectQualificationLedger(f.ledger).unsettled.length, hasAudio ? 0 : 1);
  });

test("standard native profile is hash-bound and unrelated profile values refuse", (t) => {
  const f = fixture(t);
  const native = seedanceManifest(resolve(f.out, "baseline"), "standard_native_audio");
  assert.notEqual(native.sha256, f.plan.sha256);
  assert.throws(() => seedanceManifest(resolve(f.out, "baseline"), "fast"), /unknown_profile/);
});
test("catalogue price drift refuses before key inspection or paid submission", async (t) => {
  const f = fixture(t);
  let gets = 0;
  await assert.rejects(
    runSeedanceQualification({
      ...f.options,
      fetchImpl: async (url) => {
        gets++;
        assert.ok(url.endsWith("/videos/models"));
        return json({
          data: [
            {
              id: "bytedance/seedance-1-5-pro",
              supported_durations: [5],
              supported_resolutions: ["720p"],
              supported_aspect_ratios: ["9:16"],
              supported_sizes: ["720x1280"],
              generate_audio: true,
              pricing_skus: { video_tokens_without_audio: "0.000009" },
            },
          ],
        });
      },
    }),
    /catalogue_contract_changed/,
  );
  assert.equal(gets, 1);
  assert.equal(existsSync(resolve(f.out, "execution.lock")), false);
});
test("successful transport journals before POST and only fetches constructed same-origin URLs", async (t) => {
  const f = fixture(t),
    tx = transport(f);
  const r = await runSeedanceQualification({ ...f.options, fetchImpl: tx.fetchImpl });
  assert.equal(r.status, "completed");
  assert.equal(r.completed, 3);
  assert.equal(tx.posts(), 3);
  assert.equal(inspectQualificationLedger(f.ledger).unsettled.length, 0);
  assert.ok(tx.calls.every((c) => c.url.startsWith("https://openrouter.ai/api/v1/")));
  assert.ok(tx.calls.every((c) => c.init.redirect === "error"));
  assert.equal(r.requests[0].assetSha256, hash(Buffer.from("synthetic video bytes")));
  assert.equal(r.requests[0].costUsd, 0.1296);
  await assert.rejects(
    runSeedanceQualification({ ...f.options, fetchImpl: tx.fetchImpl }),
    /run_already_attempted/,
  );
  assert.equal(tx.posts(), 3);
});
test("unresolved shared receipt refuses before credential checks or any network I/O", async (t) => {
  const f = fixture(t);
  writeFileSync(
    f.ledger,
    `${[
      { event: "budget_opened", approvalRef, allowanceUsd: 5 },
      { event: "request_started", approvalRef, attemptId: "unknown" },
      { event: "request_unresolved", approvalRef, attemptId: "unknown", costUsd: 0.0056 },
    ]
      .map(JSON.stringify)
      .join("\n")}\n`,
  );
  let calls = 0;
  await assert.rejects(
    runSeedanceQualification({
      ...f.options,
      apiKey: null,
      fetchImpl: () => {
        calls++;
        throw new Error("unexpected");
      },
    }),
    /unsettled_shared_ledger/,
  );
  assert.equal(calls, 0);
  assert.equal(existsSync(resolve(f.out, "execution.lock")), false);
});
for (const [name, payload, reason] of [
  ["missing price", { usage: { is_byok: false } }, "cost_unknown"],
  ["BYOK", { usage: { cost: 0.1296, is_byok: true } }, "credit_billing_unverified"],
  ["missing billing basis", { usage: { cost: 0.1296 } }, "credit_billing_unverified"],
  ["allowance exceeded", { usage: { cost: 0.31, is_byok: false } }, "request_allowance_exceeded"],
  ["model mismatch", { model: "unreviewed/model" }, "reported_model_mismatch"],
  ["failed terminal", { status: "failed" }, "video_not_completed"],
])
  test(`${name} stops after one submission and preserves its hold`, async (t) => {
    const f = fixture(t),
      tx = transport(f, { payload });
    const r = await runSeedanceQualification({ ...f.options, fetchImpl: tx.fetchImpl });
    assert.equal(r.reason, reason);
    assert.equal(r.status, "stopped");
    assert.equal(tx.posts(), 1);
    assert.equal(inspectQualificationLedger(f.ledger).unsettled.length, 1);
    assert.equal(tx.calls.filter((c) => c.url.includes("/content")).length, 0);
  });
test("unknown submission is never retried or resumed by a second run", async (t) => {
  const f = fixture(t),
    tx = transport(f, {
      post: () => {
        throw new Error("arbitrary provider text must never be saved");
      },
    });
  const r = await runSeedanceQualification({ ...f.options, fetchImpl: tx.fetchImpl });
  assert.equal(r.reason, "request_or_delivery_uncertain");
  assert.equal(tx.posts(), 1);
  await assert.rejects(
    runSeedanceQualification({ ...f.options, fetchImpl: tx.fetchImpl }),
    /unsettled_shared_ledger/,
  );
  assert.equal(tx.posts(), 1);
  assert.ok(!readFileSync(resolve(f.out, "result.json"), "utf8").includes("arbitrary provider"));
});
test("silent media/profile checks retain reported cost if output fails", async (t) => {
  const f = fixture(t),
    tx = transport(f);
  const r = await runSeedanceQualification({
    ...f.options,
    fetchImpl: tx.fetchImpl,
    probeMedia: () => ({
      format: { duration: "5" },
      streams: [{ codec_type: "video", width: 720, height: 1280 }, { codec_type: "audio" }],
    }),
  });
  assert.equal(r.reason, "video_profile_invalid");
  assert.equal(r.requests[0].costUsd, 0.1296);
  assert.equal(tx.posts(), 1);
  assert.equal(inspectQualificationLedger(f.ledger).unsettled.length, 1);
});
test("changed review and unknown CLI arguments refuse", async (t) => {
  const f = fixture(t);
  await assert.rejects(
    runSeedanceQualification({ ...f.options, reviewHash: "0".repeat(64) }),
    /review_digest_mismatch/,
  );
  await assert.rejects(main(["--paid-retry"]), /unknown_argument/);
});
