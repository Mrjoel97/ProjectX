// @vitest-environment node
//
// The render stage's pure half, asserted with NO SDK in sight and at $0 (plan 20-15 Task 2).
//
// The two structural invariants — `persistent: false` and `networkPolicy: "deny-all"` — are the
// whole reason `buildSandboxOptions` is a function rather than an inline literal. They are the
// cross-tenant leak vectors, and both mutation checks in the plan's verification block point HERE:
// delete either field and this file must go red.
//
// The return-validation matrix reuses the COMMITTED sidecar fixtures from plan 20-13 rather than
// inventing new strings, so the runner is driven against the same bytes the validator was written
// to. `overrun-scene-4.json` in particular is D8's hard error arriving from the renderer.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  buildSandboxOptions,
  CAPTION_MAX_ASS_BYTES,
  CARD_COLOR,
  CARD_DEFAULT_BG,
  CARD_DEFAULT_INK,
  cardColorsOf,
  convexSiteOrigin,
  deckStillNeedsJob,
  handleRenderRequest,
  isRenderableCardText,
  isTransientRenderCode,
  RENDER_INPUT_NAME,
  RENDER_MAX_BYTES,
  RENDER_MAX_CARD_CHARS,
  RENDER_MAX_DURATION_S,
  RENDER_MIN_BYTES,
  RENDER_SANDBOX_TIMEOUT_MS,
  RENDER_SANDBOX_VCPUS,
  type RenderDeps,
  reasonCodeFor,
  renderInputName,
  type SandboxOptions,
  TRANSIENT_RENDER_CODES,
  validateRenderReturn,
} from "./render";
import { VISUAL_KINDS } from "./storyboard";

const fixture = (name: string) =>
  readFileSync(
    fileURLToPath(new URL(`./__fixtures__/assembly/${name}.json`, import.meta.url)),
    "utf8",
  );

/** A buffer that passes every check EXCEPT whatever the case under test breaks. `ftyp` at 4..8,
 *  and padded past the 200 KB floor. */
function plausibleMp4(bytes = RENDER_MIN_BYTES + 1024): Uint8Array {
  const buf = new Uint8Array(bytes);
  buf.set([0x00, 0x00, 0x00, 0x20, 0x66, 0x74, 0x79, 0x70], 0); // size + "ftyp"
  return buf;
}

const codeOf = (r: ReturnType<typeof validateRenderReturn>) => (r.ok ? "ok" : r.code);

describe("buildSandboxOptions: the two leak vectors are closed by the OPTIONS, not by a promise", () => {
  const opts = buildSandboxOptions({ snapshotId: "snap_abc123" });

  it("sets persistent: false — the SDK default is TRUE, and unset means tenant A's clips survive into tenant B's VM", () => {
    // MUTATION CHECK (plan 20-15 verification): delete `persistent: false` from the builder and
    // this assertion goes red. It has been observed red.
    expect(opts.persistent).toBe(false);
  });

  it("never passes a `name` — a named sandbox is resumable BY NAME, which IS the persistence mechanism", () => {
    // `"name" in opts`, not `opts.name === undefined`: an explicit `name: undefined` would pass the
    // weaker check while still handing the SDK the key.
    expect("name" in opts).toBe(false);
  });

  it("sets networkPolicy: deny-all — the egress vector, enforced by infrastructure", () => {
    // MUTATION CHECK: delete `networkPolicy` and this goes red.
    expect(opts.networkPolicy).toBe("deny-all");
  });

  it("pins the snapshot as the source — ffmpeg is baked, never downloaded per invocation", () => {
    expect(opts.source).toEqual({ type: "snapshot", snapshotId: "snap_abc123" });
  });

  it("asks for 2 vCPU — the size the 60-150 s render estimate was modelled at", () => {
    expect(opts.resources.vcpus).toBe(RENDER_SANDBOX_VCPUS);
  });

  it("times out STRICTLY BELOW the route's maxDuration, so the VM is torn down and not orphaned", () => {
    expect(opts.timeout).toBe(RENDER_SANDBOX_TIMEOUT_MS);
    expect(opts.timeout).toBeLessThan(RENDER_MAX_DURATION_S * 1000);
  });

  it("CLAMPS a caller who asks for more than the ceiling — the invariant is the builder's, not the caller's", () => {
    const greedy = buildSandboxOptions({
      snapshotId: "s",
      timeoutMs: RENDER_MAX_DURATION_S * 1000,
    });
    expect(greedy.timeout).toBe(RENDER_SANDBOX_TIMEOUT_MS);
    expect(greedy.timeout).toBeLessThan(RENDER_MAX_DURATION_S * 1000);
  });

  it("honours a SHORTER timeout — clamping is a ceiling, not a constant", () => {
    expect(buildSandboxOptions({ snapshotId: "s", timeoutMs: 60_000 }).timeout).toBe(60_000);
  });
});

describe("renderInputName: the 0-based row index becomes the script's 1-based, 2-digit filename", () => {
  it("derives BOTH names from the same counter — the mismatch upstream needed a flag for", () => {
    expect(renderInputName("video", 0)).toBe("block01.mp4");
    expect(renderInputName("tts", 0)).toBe("voice01.wav");
    expect(renderInputName("video", 5)).toBe("block06.mp4");
    expect(renderInputName("tts", 5)).toBe("voice06.wav");
  });

  it("zero-pads to two digits, and keeps padding past 9", () => {
    expect(renderInputName("video", 8)).toBe("block09.mp4");
    expect(renderInputName("video", 9)).toBe("block10.mp4");
  });

  it("every name it can produce is accepted by the runner's own filename guard", () => {
    for (let i = 0; i < 12; i++) {
      for (const kind of ["video", "tts", "image", "card"] as const) {
        expect(RENDER_INPUT_NAME.test(renderInputName(kind, i))).toBe(true);
      }
    }
  });

  it("a still shares its CLIP's stem, and a card has its own (20.2 wave 5)", () => {
    // Same stem, different extension: the assembler picks its branch from the scene KIND it was
    // given, never from what it found in the directory, so `block02.png` and `block02.mp4` are the
    // same slot rather than two. A card is `cardNN.txt` because it is not a picture we fetched —
    // it is text we were handed, and the different stem is what lets the runner keep the two
    // apart when it decides which inputs to fetch and which to write from the body.
    expect(renderInputName("image", 1)).toBe("block02.png");
    expect(renderInputName("card", 2)).toBe("card03.txt");
  });

  it("card text is bounded: printable, non-empty, and under the ceiling", () => {
    expect(isRenderableCardText("Ninety minutes a day: gone.")).toBe(true);
    expect(isRenderableCardText("two\nlines")).toBe(true); // newline is how a card gets two lines
    expect(isRenderableCardText("")).toBe(false);
    expect(isRenderableCardText("   ")).toBe(false);
    expect(isRenderableCardText("x".repeat(RENDER_MAX_CARD_CHARS + 1))).toBe(false);
    // A NUL truncates the file for whatever reads it next; a lone CR moves the cursor back over
    // what was already drawn. Neither is a glyph anyone asked to burn into a frame.
    expect(isRenderableCardText("a\u0000b")).toBe(false);
    expect(isRenderableCardText("a\rb")).toBe(false);
    expect(isRenderableCardText("a\u007Fb")).toBe(false);
    // `%{...}` is NOT refused here — `expansion=none` in the script is what defuses it, and
    // refusing a literal percent-brace would reject a legitimate card for a reason that no longer
    // applies. This asserts the division of labour, not an oversight.
    expect(isRenderableCardText("100%{ish} of the time")).toBe(true);
  });

  it("REFUSES a path traversal, a nested path and a stray extension — the writeFiles guard", () => {
    for (const bad of [
      "../../etc/passwd",
      "in/block01.mp4",
      "block1.mp4",
      "block01.sh",
      "voice01.mp3",
      "block01.mp4 ",
      "assemble_final.sh",
    ]) {
      expect(RENDER_INPUT_NAME.test(bad), `${bad} must be refused`).toBe(false);
    }
  });
});

describe("convexSiteOrigin: the ONE origin the runner may fetch tenant bytes from", () => {
  it("maps a cloud deployment URL to its .convex.site origin", () => {
    expect(convexSiteOrigin("https://happy-otter-123.convex.cloud")).toBe(
      "https://happy-otter-123.convex.site",
    );
  });

  it("maps a LOCAL deployment (:3210) to its HTTP-actions port (:3211)", () => {
    expect(convexSiteOrigin("http://127.0.0.1:3210")).toBe("http://127.0.0.1:3211");
  });

  it("drops any path, query or fragment — an origin, never a URL", () => {
    expect(convexSiteOrigin("https://x.convex.cloud/some/path?a=1#f")).toBe(
      "https://x.convex.site",
    );
  });

  it("THROWS on anything else rather than fetching from a host we did not derive", () => {
    // The SSRF guard's fail-closed direction: an origin we cannot derive is not a default, it is
    // a refusal. An attacker-supplied deployment URL must not become an allowed fetch target.
    for (const bad of [
      "https://evil.com",
      "https://x.convex.cloud.evil.com",
      "http://127.0.0.1:9999",
    ]) {
      expect(() => convexSiteOrigin(bad), `${bad} must not derive an origin`).toThrow();
    }
  });
});

describe("validateRenderReturn: nothing the VM returns is trusted, and every failure has its own code", () => {
  it("a valid mp4 + a valid sidecar parses to the typed report", () => {
    const r = validateRenderReturn({ mp4: plausibleMp4(), sidecar: fixture("valid") });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.report.sceneCount).toBe(4);
    expect(r.report.gates.length).toBeGreaterThan(0);
  });

  it("a null mp4 is missing_output — the script died before writing one", () => {
    expect(codeOf(validateRenderReturn({ mp4: null, sidecar: fixture("valid") }))).toBe(
      "missing_output",
    );
  });

  it("a zero-byte mp4 is empty_output, NOT missing_output — different operational stories", () => {
    expect(
      codeOf(validateRenderReturn({ mp4: new Uint8Array(0), sidecar: fixture("valid") })),
    ).toBe("empty_output");
  });

  it("bytes 4..8 that are not `ftyp` are not_an_mp4 — the VM wrote something that is not a video", () => {
    const notMp4 = plausibleMp4();
    notMp4.set([0x6a, 0x75, 0x6e, 0x6b], 4); // "junk"
    expect(codeOf(validateRenderReturn({ mp4: notMp4, sidecar: fixture("valid") }))).toBe(
      "not_an_mp4",
    );
  });

  it("a header-only file under the 200 KB floor is implausible_size, even with a valid ftyp", () => {
    const r = validateRenderReturn({ mp4: plausibleMp4(1024), sidecar: fixture("valid") });
    expect(codeOf(r)).toBe("implausible_size");
    // The size is reported so an operator can tell "truncated" from "enormous" without the bytes.
    if (!r.ok && r.code === "implausible_size") expect(r.bytes).toBe(1024);
  });

  it("the size ceiling is an abuse stop, and it is the one asserted here rather than assumed", () => {
    expect(RENDER_MAX_BYTES).toBeGreaterThan(RENDER_MIN_BYTES);
    // Not allocating 200 MB in a unit test: the band's UPPER edge is checked by the constant pair
    // plus the floor case above. ponytail: allocating the real buffer buys one boundary and 200 MB
    // of RSS; add it only if the ceiling ever moves for a reason other than arithmetic.
  });

  it("a missing sidecar is invalid_sidecar with detail `missing` — a final video without one was hand-assembled", () => {
    const r = validateRenderReturn({ mp4: plausibleMp4(), sidecar: null });
    expect(codeOf(r)).toBe("invalid_sidecar");
    if (!r.ok && r.code === "invalid_sidecar") expect(r.detail).toBe("missing");
  });

  it("a malformed sidecar is invalid_sidecar and carries the validator's own error through", () => {
    const r = validateRenderReturn({ mp4: plausibleMp4(), sidecar: fixture("malformed") });
    expect(codeOf(r)).toBe("invalid_sidecar");
    if (!r.ok && r.code === "invalid_sidecar") expect(r.detail).toMatchObject({ code: "bad_json" });
  });

  it("an EMPTY sidecar is distinguished from a malformed one, through the shipped validator", () => {
    const r = validateRenderReturn({ mp4: plausibleMp4(), sidecar: fixture("empty") });
    if (!r.ok && r.code === "invalid_sidecar") expect(r.detail).toMatchObject({ code: "empty" });
    else throw new Error("expected invalid_sidecar");
  });

  it("VALID JSON reporting overrun: true on block 4 publishes NOTHING — D8's hard error, not a warning", () => {
    // MUTATION CHECK (plan 20-15 verification): make validateRenderReturn accept an overrunning
    // sidecar and this goes red. The refusal lives in the SHIPPED validator (assembly.ts) — this
    // asserts we do not swallow it on the way past.
    const r = validateRenderReturn({ mp4: plausibleMp4(), sidecar: fixture("overrun-scene-4") });
    expect(r.ok).toBe(false);
    expect(codeOf(r)).toBe("invalid_sidecar");
    if (!r.ok && r.code === "invalid_sidecar") {
      expect(r.detail).toMatchObject({ code: "scene_overrun", sceneIndex: 3 });
    }
  });

  it("the mp4 is checked BEFORE the sidecar — a dead render is not reported as an ungoverned one", () => {
    expect(codeOf(validateRenderReturn({ mp4: null, sidecar: null }))).toBe("missing_output");
  });
});

// ── handleRenderRequest: the route handler's whole body, with the SDK injected ─────────────────
//
// `apps/web` has no unit-test runner, and every assertion below is about CONTROL FLOW — "a bad
// bearer creates NO sandbox", "an untrusted return publishes NOTHING". A Playwright test cannot
// make those claims and a real `Sandbox.create` would charge ~$0.02 each. Injecting the SDK is
// what makes the security behaviour of this endpoint assertable at $0.

type Recorder = {
  created: SandboxOptions[];
  writes: Array<{ path: string; content: Uint8Array }>;
  commands: Array<{ cmd: string; args?: string[] }>;
  fetches: Array<{ url: string; init?: RequestInit }>;
  stops: number;
};

const SIDECAR_OK = fixture("valid");
const DEPLOYMENT = "https://happy-otter-123.convex.cloud";
const SITE = "https://happy-otter-123.convex.site";
const SECRET = "s3cret-render-bearer";

function deps(
  over: {
    exitCode?: number;
    stderr?: string;
    mp4?: Uint8Array | null;
    sidecar?: string | null;
    secret?: string | undefined;
    snapshotId?: string | undefined;
    deploymentUrl?: string | undefined;
    blobStatus?: number;
    uploadOk?: boolean;
  } = {},
): { deps: RenderDeps; rec: Recorder } {
  const rec: Recorder = { created: [], writes: [], commands: [], fetches: [], stops: 0 };
  const mp4 = over.mp4 === undefined ? plausibleMp4() : over.mp4;
  const sidecar = over.sidecar === undefined ? SIDECAR_OK : over.sidecar;

  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    rec.fetches.push({ url, init });
    if (url.startsWith(`${SITE}/media/blob/`)) {
      const status = over.blobStatus ?? 200;
      return new Response(status === 200 ? new Uint8Array([1, 2, 3, 4]) : null, { status });
    }
    if (over.uploadOk === false) return new Response(null, { status: 500 });
    return Response.json({ storageId: `stor_${rec.fetches.length}` });
  }) as unknown as typeof globalThis.fetch;

  return {
    rec,
    deps: {
      secret: "secret" in over ? over.secret : SECRET,
      snapshotId: "snapshotId" in over ? over.snapshotId : "snap_1",
      deploymentUrl: "deploymentUrl" in over ? over.deploymentUrl : DEPLOYMENT,
      assembleScript: "#!/usr/bin/env bash\necho assemble\n",
      burnScript: "#!/usr/bin/env bash\necho burn\n",
      fetch: fetchImpl,
      createSandbox: async (options) => {
        rec.created.push(options);
        return {
          mkDir: async () => {},
          writeFiles: async (files) => {
            rec.writes.push(...files);
          },
          runCommand: async (cmd, args) => {
            rec.commands.push({ cmd, args });
            return {
              exitCode: over.exitCode ?? 0,
              stderr: async () => over.stderr ?? "",
            };
          },
          readFileToBuffer: async (file) =>
            file.path.endsWith(".json")
              ? sidecar === null
                ? null
                : (new TextEncoder().encode(sidecar) as Uint8Array<ArrayBuffer>)
              : (mp4 as Uint8Array<ArrayBuffer> | null),
          stop: async () => {
            rec.stops += 1;
          },
        };
      },
    },
  };
}

const body = (over: Record<string, unknown> = {}) => ({
  renderId: "batch-1",
  targetSeconds: 30,
  // A MIXED deck on purpose: a clip, a still, a silent drawn card, a clip. Two identical video
  // blocks would pass every guard below while proving nothing about the contract they exist for.
  scenes: [
    { kind: "video", seconds: 8 },
    { kind: "image", seconds: 6 },
    { kind: "card", seconds: 4 },
    { kind: "video", seconds: 12 },
  ],
  inputs: [
    { name: "block01.mp4", jobId: "job1" },
    { name: "voice01.wav", jobId: "job2" },
    { name: "block02.png", jobId: "job3" },
    { name: "voice02.wav", jobId: "job4" },
    { name: "block04.mp4", jobId: "job5" },
    { name: "voice04.wav", jobId: "job6" },
  ],
  // Scene 3 is a silent card: its bytes are HERE, not in `inputs`, and it has no voice take.
  cards: [{ name: "card03.txt", text: "Ninety minutes a day: gone." }],
  uploadUrls: {
    mp4: `${DEPLOYMENT}/api/storage/upload?token=a`,
    sidecar: `${DEPLOYMENT}/api/storage/upload?token=b`,
  },
  ...over,
});

/** A recorded call's headers as a plain map. `?? {}` rather than an optional chain through a cast:
 *  an absent entry must fail the assertion, not throw on the way to it. */
const headersOf = (call?: { init?: RequestInit }): Record<string, string> =>
  (call?.init?.headers ?? {}) as Record<string, string>;

const post = (b: unknown, auth: string | null = `Bearer ${SECRET}`) =>
  new Request("https://app.example.com/api/media/render", {
    method: "POST",
    headers: auth === null ? {} : { Authorization: auth },
    body: JSON.stringify(b),
  });

describe("handleRenderRequest: the bearer, and what happens before it passes", () => {
  it("401s with NO Authorization header — and creates no sandbox", async () => {
    const { deps: d, rec } = deps();
    const res = await handleRenderRequest(post(body(), null), d);
    expect(res.status).toBe(401);
    expect(rec.created).toHaveLength(0);
  });

  it("401s on a WRONG bearer — and creates no sandbox", async () => {
    const { deps: d, rec } = deps();
    const res = await handleRenderRequest(post(body(), "Bearer wrong"), d);
    expect(res.status).toBe(401);
    expect(rec.created).toHaveLength(0);
  });

  it("401s when the secret is UNSET on the server — fail CLOSED, never fail OPEN", async () => {
    // MUTATION CHECK (plan 20-15 verification): drop the `!deps.secret` half of the guard, so the
    // template stringifies `undefined`, and this goes RED — `Bearer undefined` is a string any
    // caller can send, so an unset secret would authenticate the whole internet. Observed red.
    //
    // The FIRST version of this test sent `"Bearer "` and passed even WITH the guard removed:
    // header values are whitespace-trimmed on the way in, so a trailing space is untypeable and
    // the test proved nothing. `Bearer undefined` is the string that actually reaches the compare
    // — and it is the exact fail-open `http.ts:92`'s `!expected` half exists to close.
    const { deps: d, rec } = deps({ secret: undefined });
    for (const attempt of ["Bearer undefined", "Bearer null", "Bearer", `Bearer ${SECRET}`]) {
      const res = await handleRenderRequest(post(body(), attempt), d);
      expect(res.status, `"${attempt}" was accepted against an unset secret`).toBe(401);
    }
    expect(rec.created).toHaveLength(0);
  });

  it("401s BEFORE parsing the body — a malformed body from an unauthed caller is still just a 401", async () => {
    const { deps: d, rec } = deps();
    const res = await handleRenderRequest(post("not an object", "Bearer wrong"), d);
    expect(res.status).toBe(401);
    expect(rec.fetches).toHaveLength(0);
    expect(rec.created).toHaveLength(0);
  });

  it("stops with not_configured when the snapshot id is missing — never a sandbox without ffmpeg", async () => {
    const { deps: d, rec } = deps({ snapshotId: undefined });
    const res = await handleRenderRequest(post(body()), d);
    await expect(res.json()).resolves.toMatchObject({ ok: false, code: "not_configured" });
    expect(rec.created).toHaveLength(0);
  });
});

describe("handleRenderRequest: nothing untrusted reaches the VM", () => {
  it("REFUSES a path-traversal filename — writeFiles never sees it", async () => {
    const { deps: d, rec } = deps();
    const res = await handleRenderRequest(
      post(body({ inputs: [{ name: "../../assemble_final.sh", jobId: "job1" }] })),
      d,
    );
    await expect(res.json()).resolves.toMatchObject({ code: "bad_request" });
    expect(rec.created).toHaveLength(0);
    expect(rec.writes).toHaveLength(0);
  });

  it("REFUSES an upload URL on a foreign origin — the write-direction SSRF guard", async () => {
    const { deps: d, rec } = deps();
    const res = await handleRenderRequest(
      post(
        body({
          uploadUrls: { mp4: "https://evil.example.com/collect", sidecar: `${DEPLOYMENT}/x` },
        }),
      ),
      d,
    );
    await expect(res.json()).resolves.toMatchObject({ code: "bad_request" });
    expect(rec.fetches).toHaveLength(0);
    expect(rec.created).toHaveLength(0);
  });

  it.each([
    ["a non-object body", "nope"],
    ["a targetSeconds nobody priced", body({ targetSeconds: 25 })],
    ["scenes that do not sum to the declared target", body({ targetSeconds: 60 })],
    ["an empty scenes array", body({ scenes: [] })],
    ["a scene kind we did not ship", body({ scenes: [{ kind: "hologram", seconds: 30 }] })],
    // A stale Convex deployment still speaking the v1 contract. It must be REFUSED, not defaulted
    // into a reel of the wrong shape.
    ["the v1 body from a stale deployment", { renderId: "b", blockCount: 2, clipSeconds: 10 }],
    ["an empty inputs array", body({ inputs: [] })],
    ["a jobId with a path separator", body({ inputs: [{ name: "block01.mp4", jobId: "a/b" }] })],
    // The cards list is the one place request-body BYTES cross into the VM.
    ["a card whose name is not a card", body({ cards: [{ name: "block01.mp4", text: "x" }] })],
    ["a card carrying a NUL", body({ cards: [{ name: "card03.txt", text: "a\0b" }] })],
    [
      "a card longer than the ceiling",
      body({ cards: [{ name: "card03.txt", text: "x".repeat(513) }] }),
    ],
    ["an empty card", body({ cards: [{ name: "card03.txt", text: "   " }] })],
    // A `cardNN.txt` in `inputs` would be FETCHED from the blob route, which resolves job ids —
    // so the two lists must not overlap.
    ["a card smuggled in as an input", body({ inputs: [{ name: "card03.txt", jobId: "job9" }] })],
    ["a scene with no input at its index", body({ inputs: [{ name: "block01.mp4", jobId: "j" }] })],
  ])("refuses %s with bad_request and no sandbox", async (_label, b) => {
    const { deps: d, rec } = deps();
    const res = await handleRenderRequest(post(b), d);
    await expect(res.json()).resolves.toMatchObject({ code: "bad_request" });
    expect(rec.created).toHaveLength(0);
  });

  it("builds every blob URL from OUR derived origin and never from the request", async () => {
    const { deps: d, rec } = deps();
    await handleRenderRequest(post(body()), d);
    const blobFetches = rec.fetches.filter((f) => f.url.includes("/media/blob/"));
    // SIX now, not four: the mixed deck has three pictures and three voice takes. The CARD is
    // not among them — its bytes never round-trip through storage.
    expect(blobFetches).toHaveLength(6);
    for (const f of blobFetches) {
      expect(f.url.startsWith(`${SITE}/media/blob/`)).toBe(true);
      expect(headersOf(f).Authorization).toBe(`Bearer ${SECRET}`);
    }
  });

  it("hands the sandbox NO env and NO credential — the options are exactly buildSandboxOptions", async () => {
    const { deps: d, rec } = deps();
    await handleRenderRequest(post(body()), d);
    expect(rec.created).toHaveLength(1);
    expect(rec.created[0]).toEqual(buildSandboxOptions({ snapshotId: "snap_1" }));
    // Belt and braces: the literal key names that must never appear on the create options.
    for (const banned of ["env", "token", "teamId", "projectId", "name"]) {
      expect(banned in (rec.created[0] as object), `${banned} was passed to Sandbox.create`).toBe(
        false,
      );
    }
  });

  it("writes the clips, the voice takes and the assemble script in ONE call, under in/", async () => {
    const { deps: d, rec } = deps();
    await handleRenderRequest(post(body()), d);
    expect(rec.writes.map((w) => w.path)).toEqual([
      "in/block01.mp4",
      "in/voice01.wav",
      "in/block02.png",
      "in/voice02.wav",
      "in/block04.mp4",
      "in/voice04.wav",
      "in/card03.txt",
      "assemble_final.sh",
    ]);
    // The card is written from the BODY, and its bytes are exactly the text that was sent.
    const card = rec.writes.find((w) => w.path === "in/card03.txt");
    expect(new TextDecoder().decode(card?.content)).toBe("Ninety minutes a day: gone.");
  });

  it("invokes the script on the SCENE contract, in deck order", async () => {
    const { deps: d, rec } = deps();
    await handleRenderRequest(post(body()), d);
    expect(rec.commands).toEqual([
      {
        cmd: "sh",
        args: [
          "assemble_final.sh",
          "--scene",
          "video:8",
          "--scene",
          "image:6",
          "--scene",
          "card:4",
          "--scene",
          "video:12",
          "--target-seconds",
          "30",
        ],
      },
    ]);
  });

  // ── The music bed ─────────────────────────────────────────────────────────────────────────
  //
  // The bed is the one thing in the assemble body that is NOT an input: no file is written for it,
  // nothing is fetched for it, and no upload URL carries it. It is a NAME the script resolves
  // against a library baked into the snapshot. These pin that it stays that way.

  it("passes the bed as a --music MOOD and writes no file for it", async () => {
    const { deps: d, rec } = deps();
    await handleRenderRequest(post(body({ music: "calm" })), d);
    expect(rec.commands[0]?.args).toEqual([
      "assemble_final.sh",
      "--scene",
      "video:8",
      "--scene",
      "image:6",
      "--scene",
      "card:4",
      "--scene",
      "video:12",
      "--target-seconds",
      "30",
      "--music",
      "calm",
    ]);
    // NOT AN INPUT. If a bed ever starts arriving as bytes, this is the assertion that has to be
    // deleted first — and deleting it is the moment to notice that `RENDER_INPUT_NAME`, the blob
    // route and the path-traversal guard all now have a new case.
    expect(rec.writes.map((w) => w.path).filter((p) => p.includes("music"))).toEqual([]);
  });

  it("omits the flag entirely when the deck declares no bed", async () => {
    const { deps: d, rec } = deps();
    await handleRenderRequest(post(body()), d);
    expect(rec.commands[0]?.args).not.toContain("--music");
  });

  it.each([
    ["lofi", "a mood outside the closed set"],
    ["../../etc/passwd", "a path"],
    ["", "an empty string"],
    [7, "a number"],
  ])("refuses %s (%s) rather than dropping it to no bed", async (music, _why) => {
    // REFUSED, not silently ignored. A slug this runner does not recognise means the caller and
    // this runner disagree about the library — most likely a Convex deployment newer than the web
    // one — and rendering a quietly bedless reel would hide that behind a finished file.
    const { deps: d, rec } = deps();
    const res = await handleRenderRequest(post(body({ music })), d);
    await expect(res.json()).resolves.toMatchObject({ ok: false, code: "bad_request" });
    expect(rec.commands, "no sandbox is created for a refused body").toEqual([]);
  });

  // ── The card palette ────────────────────────────────────────────────────────────────────────
  //
  // Unlike the bed, these two values are INTERPOLATED INTO A FILTERGRAPH inside the VM. The card's
  // WORDS never are — `textfile=` keeps them out of the filter string and `expansion=none` stops
  // `%{...}` being evaluated — so a colour is the first model-derived value to reach it. That is
  // what these pin: the shape is re-checked at the route even though `cardColorsOf` can only
  // produce it, because this runner validates what it was SENT, not what it assumes was computed.

  it("passes the palette as --card-bg / --card-ink, and writes no file for it", async () => {
    const { deps: d, rec } = deps();
    await handleRenderRequest(post(body({ card: { bg: "0x1B4B43", ink: "0xFFFFFF" } })), d);
    const args = rec.commands[0]?.args ?? [];
    expect(args.slice(-4)).toEqual(["--card-bg", "0x1B4B43", "--card-ink", "0xFFFFFF"]);
    expect(rec.writes.map((w) => w.path).filter((x) => x.includes("card-"))).toEqual([]);
  });

  it("omits both flags when the deck yields no colour — the old black card, unchanged", async () => {
    const { deps: d, rec } = deps();
    await handleRenderRequest(post(body()), d);
    expect(rec.commands[0]?.args).not.toContain("--card-bg");
    expect(rec.commands[0]?.args).not.toContain("--card-ink");
  });

  it.each([
    [{ bg: "black", ink: "0xFFFFFF" }, "a colour word"],
    [{ bg: "0x1B4B43:x=0", ink: "0xFFFFFF" }, "a filtergraph option smuggled onto the value"],
    [{ bg: "0x1B4B43", ink: "white' -vf 'crop=1:1" }, "a quote break"],
    [{ bg: "#1B4B43", ink: "0xFFFFFF" }, "the wrong prefix"],
    [{ bg: "0xGGGGGG", ink: "0xFFFFFF" }, "non-hex digits"],
    [{ bg: "0x1B4B43" }, "a missing ink"],
    [{ bg: 7, ink: "0xFFFFFF" }, "a number"],
    ["0x1B4B43", "a bare string instead of the pair"],
  ])("REFUSES %o (%s) rather than falling back to the default card", async (card, _why) => {
    // Refused, never degraded. A malformed pair means the caller and this runner disagree about
    // what was computed, and drawing the default card would hide that behind a finished file —
    // the same reasoning as the music slug, with a sharper consequence if it were wrong.
    const { deps: d, rec } = deps();
    const res = await handleRenderRequest(post(body({ card })), d);
    await expect(res.json()).resolves.toMatchObject({ ok: false, code: "bad_request" });
    expect(rec.commands, "no sandbox is created for a refused body").toEqual([]);
  });
});

describe("handleRenderRequest: nothing the VM returns is published unchecked", () => {
  it("publishes on the happy path, with OUR MIME type on the mp4", async () => {
    const { deps: d, rec } = deps();
    const res = await handleRenderRequest(post(body()), d);
    await expect(res.json()).resolves.toMatchObject({
      ok: true,
      mp4StorageId: expect.any(String),
      sidecarStorageId: expect.any(String),
      sceneCount: 4,
    });
    const uploads = rec.fetches.filter((f) => f.init?.method === "POST");
    expect(uploads).toHaveLength(2);
    // ASSERTED BY US, never read from the VM's response.
    expect(headersOf(uploads[0])["Content-Type"]).toBe("video/mp4");
    expect(headersOf(uploads[1])["Content-Type"]).toBe("application/json");
  });

  it.each([
    ["a null mp4", { mp4: null }, "missing_output"],
    ["an empty mp4", { mp4: new Uint8Array(0) }, "empty_output"],
    ["a non-ftyp buffer", { mp4: new Uint8Array(300_000) }, "not_an_mp4"],
    ["a header-only mp4", { mp4: plausibleMp4(1024) }, "implausible_size"],
    ["a missing sidecar", { sidecar: null }, "invalid_sidecar"],
    ["a malformed sidecar", { sidecar: "{{{" }, "invalid_sidecar"],
  ])("publishes NOTHING for %s, with its own code", async (_label, over, code) => {
    const { deps: d, rec } = deps(over);
    const res = await handleRenderRequest(post(body()), d);
    await expect(res.json()).resolves.toMatchObject({ ok: false, code });
    expect(rec.fetches.filter((f) => f.init?.method === "POST")).toHaveLength(0);
  });

  it("publishes NOTHING for a VALID sidecar reporting overrun — D8's hard error from the renderer", async () => {
    const { deps: d, rec } = deps({ sidecar: fixture("overrun-scene-4") });
    const res = await handleRenderRequest(post(body()), d);
    await expect(res.json()).resolves.toMatchObject({ ok: false, code: "invalid_sidecar" });
    expect(rec.fetches.filter((f) => f.init?.method === "POST")).toHaveLength(0);
  });

  it("turns a non-zero exit into a CODE and never reads the sidecar", async () => {
    const { deps: d, rec } = deps({
      exitCode: 1,
      stderr: "ERROR: clip 2 is only 8.1s (<10s) — a held still frame is not a scene.",
    });
    const res = await handleRenderRequest(post(body()), d);
    const json = (await res.json()) as { ok: boolean; code: string };
    expect(json).toMatchObject({ ok: false, code: "clip_too_short" });
    // The stderr text must not survive into the response in any form.
    expect(JSON.stringify(json)).not.toContain("8.1s");
    expect(JSON.stringify(json)).not.toContain("still frame");
    expect(rec.fetches.filter((f) => f.init?.method === "POST")).toHaveLength(0);
  });

  it("refuses to publish when an input blob cannot be fetched — and never starts a VM for it", async () => {
    const { deps: d, rec } = deps({ blobStatus: 404 });
    const res = await handleRenderRequest(post(body()), d);
    await expect(res.json()).resolves.toMatchObject({ code: "input_fetch_failed" });
    expect(rec.created).toHaveLength(0);
  });

  it("reports upload_failed rather than a half-published reel", async () => {
    const { deps: d } = deps({ uploadOk: false });
    const res = await handleRenderRequest(post(body()), d);
    await expect(res.json()).resolves.toMatchObject({ code: "upload_failed" });
  });

  it("ALWAYS stops the sandbox — on success and on every failure after it exists", async () => {
    for (const over of [{}, { exitCode: 1 }, { mp4: null }, { uploadOk: false }]) {
      const { deps: d, rec } = deps(over);
      await handleRenderRequest(post(body()), d);
      expect(rec.stops, `sandbox not stopped for ${JSON.stringify(over)}`).toBe(1);
    }
  });
});

describe("reasonCodeFor: a code, and provably never its input", () => {
  it("exit 0 is ok", () => {
    expect(reasonCodeFor(0, "")).toBe("ok");
  });

  it.each([
    ["ERROR: 'ffmpeg' not found", "missing_binary"],
    [
      "ERROR: this ffmpeg has no 'drawtext' filter — libfreetype is missing from the image",
      "missing_binary",
    ],
    ["ERROR: clip not found: in/block03.mp4", "input_missing"],
    // Every string here is the script's OWN wording, copied from `assemble_final.sh`. Wave 4
    // rewrote three of these messages and this table was not moved with them, so a line running
    // past the reel came back as the catch-all `render_failed` — the codes below are the fix, and
    // `assembleScript.test.ts` now pins the wording on the other side.
    ["ERROR: unsupported --clip-seconds: 7", "bad_invocation"],
    ["ERROR: --target-seconds must be a positive integer, got: x", "bad_invocation"],
    [
      "ERROR: the scenes sum to 30s but the deck declares --target-seconds 45 — fix the deck; the assembler will not pad or trim to reach a target.",
      "bad_invocation",
    ],
    ["ERROR: unknown scene kind: hologram (want video, image or card)", "bad_invocation"],
    [
      "ERROR: voice 4 is still speaking at 31.400s but the reel ends at 30s — the line would be cut mid-word.",
      "speech_out_of_window",
    ],
    [
      "ERROR: voice 2 runs to 19.400s but voice 4 starts at 18.200s — two narrators would speak at once.",
      "speech_out_of_window",
    ],
    ["ERROR: clip 2 is only 8.1s (<10s) — a held still frame is not a scene.", "clip_too_short"],
    [
      "ERROR: the narration declared for scene(s) [3,5] is NOT in the mix — those spans are silent through their centre.",
      "missing_narration",
    ],
    ["ERROR: final duration 47.2s != declared 60s (+/-0.5s)", "duration_mismatch"],
    ["ERROR: final has no readable audio stream", "no_audio_stream"],
    ["ERROR: final failed decode validation — corrupted stream", "decode_failed"],
  ])("maps the script's own wording to a code: %s", (stderr, code) => {
    expect(reasonCodeFor(1, stderr)).toBe(code);
  });

  it("maps the wall-clock exits (124/137/143) to sandbox_timeout", () => {
    for (const exit of [124, 137, 143]) expect(reasonCodeFor(exit, "")).toBe("sandbox_timeout");
  });

  it("falls back to render_failed rather than inventing a diagnosis", () => {
    expect(reasonCodeFor(1, "something nobody has seen before")).toBe("render_failed");
  });

  it("NEVER echoes its input — not a filename, and not a narration line (CLAUDE.md §4)", () => {
    // The property that matters. ffmpeg's stderr carries file paths and, on a caption burn, the
    // spoken line itself. Feed it both and assert neither substring survives into the result.
    const filename = "in/voice04-alice-smith-quarterly.wav";
    const narration = "Alice, our margins slipped four points last quarter.";
    const stderr = `ERROR: ${filename}: voice 4 is still speaking past the end of the reel — the line would be cut mid-word — "${narration}"`;
    const code = reasonCodeFor(1, stderr);

    expect(code).toBe("speech_out_of_window");
    expect(code).not.toContain(filename);
    expect(code).not.toContain(narration);
    expect(code).not.toContain("Alice");
    expect(code).not.toContain(".wav");
    // …and the same for a stderr that matches NOTHING, where a lazy implementation would be most
    // tempted to pass the string through.
    expect(reasonCodeFor(9, `${filename} ${narration}`)).toBe("render_failed");
  });
});

describe("isTransientRenderCode: the CLOSED set behind the one automatic retry (33-04)", () => {
  it("the set is closed and exactly these members — adding one is a money decision, not a patch", () => {
    // Pinned as a LIST, not as membership checks alone: the retry buys a second sandbox, so a
    // member added casually widens what the doubled render line must cover. Environmental codes
    // only: the snapshot/env race (missing_binary — the 2026-08-15 SIGPIPE class), the transport
    // legs (route_unreachable, input_fetch_failed, upload_failed), a submit that never reached
    // the provider (submit_failed), and the catch-all render_failed — unknown is not provably
    // structural, so it gets its one retry.
    expect(TRANSIENT_RENDER_CODES).toEqual([
      "missing_binary",
      "route_unreachable",
      "input_fetch_failed",
      "upload_failed",
      "submit_failed",
      "render_failed",
    ]);
  });

  it("every member classifies as transient", () => {
    for (const code of TRANSIENT_RENDER_CODES) {
      expect(isTransientRenderCode(code), code).toBe(true);
    }
  });

  it.each([
    // Deterministic ffmpeg codes — the render repeats the same failure at any temperature, and a
    // retry is a second $0.02 sandbox buying the same stderr (20-16's reasoning, which stands for
    // these).
    "duration_mismatch",
    "speech_out_of_window",
    "clip_too_short",
    "missing_narration",
    "bad_invocation",
    "input_missing",
    "decode_failed",
    "no_audio_stream",
    "caption_track_empty",
    // Wall-clock exhaustion: the operator route is "cut blocks or raise the ceiling" — a
    // structural remedy, not a re-roll.
    "sandbox_timeout",
    // Runner/route decisions: the same request gets the same verdict.
    "unauthorized",
    "not_configured",
    "bad_request",
    "route_rejected",
    "sidecar_rejected_on_return",
    // Trigger-side refusals never reach the retry seam, but classify them honestly anyway.
    "empty_batch",
    "incomplete_blocks",
    "not_all_succeeded",
    "stale_inputs",
  ])("NEVER retries the deterministic code %s", (code) => {
    expect(isTransientRenderCode(code)).toBe(false);
  });

  it("an unknown string is NOT transient — except the named catch-all, nothing defaults to a retry", () => {
    expect(isTransientRenderCode("some_future_code")).toBe(false);
    expect(isTransientRenderCode("")).toBe(false);
    // The one deliberate exception, IN the closed list rather than a fallthrough branch:
    expect(isTransientRenderCode("render_failed")).toBe(true);
  });
});

describe("deckStillNeedsJob: a terminal job row holds the reel only while the deck still needs it (33-04)", () => {
  it("a generated scene needs its clip; a card/upload scene does not — that is what a kind-switch fix frees", () => {
    expect(deckStillNeedsJob({ visual: "generated_video", narration: "x" }, "video")).toBe(true);
    expect(deckStillNeedsJob({ visual: "text_card", narration: "x" }, "video")).toBe(false);
    expect(deckStillNeedsJob({ visual: "uploaded_video", narration: "x" }, "video")).toBe(false);
    // A BLOCK row (no `visual`) is a video by construction — behavior unchanged for block decks.
    expect(deckStillNeedsJob({ narration: "x" }, "video")).toBe(true);
  });
  it("stills and voice follow the same rule: animated_image needs its still, a narrated scene its take", () => {
    expect(deckStillNeedsJob({ visual: "animated_image", narration: "" }, "image")).toBe(true);
    expect(deckStillNeedsJob({ visual: "generated_video", narration: "" }, "image")).toBe(false);
    expect(deckStillNeedsJob({ visual: "text_card", narration: "hi" }, "tts")).toBe(true);
    expect(deckStillNeedsJob({ visual: "text_card", narration: "  " }, "tts")).toBe(false);
  });
  it("a row whose scene the deck no longer has is history, not a hold", () => {
    expect(deckStillNeedsJob(undefined, "video")).toBe(false);
  });

  it("a STOCK scene needs its landed row exactly as a bought one does", () => {
    // The bytes are free and they are still fetched, stored and awaited. Answering `false` here
    // would let the render trigger fire before the fetch landed and hold the reel forever.
    expect(deckStillNeedsJob({ visual: "stock_video", narration: "x" }, "video")).toBe(true);
    expect(deckStillNeedsJob({ visual: "stock_image", narration: "x" }, "image")).toBe(true);
    // ...and each stays in its OWN slot, so a stock clip is never satisfied by a still.
    expect(deckStillNeedsJob({ visual: "stock_video", narration: "x" }, "image")).toBe(false);
    expect(deckStillNeedsJob({ visual: "stock_image", narration: "x" }, "video")).toBe(false);
  });

  it("EVERY VisualKind is decided here — the guard against the next kind being missed", () => {
    // THE POINT OF THIS TEST. `deckStillNeedsJob` string-compares `visual`, so it is compile-SILENT:
    // adding a member to VISUAL_KINDS is a type error in `PAID_VISUAL` and `SCENE_VISUAL_LINE` and
    // is NOT one here. `stock_video` and `stock_image` were both missed exactly this way, and the
    // symptom is not a crash — it is a reel held at `incomplete_blocks` with no lever, because a
    // scene that buys bytes reported that it was waiting for none.
    //
    // A kind must appear in exactly one column: it lands a video row, an image row, or no row at
    // all (its picture is drawn, or already the tenant's). Anything else is undecided.
    const LANDS_NO_ROW = new Set(["uploaded_video", "text_card"]);
    for (const kind of VISUAL_KINDS) {
      const video = deckStillNeedsJob({ visual: kind, narration: "x" }, "video");
      const image = deckStillNeedsJob({ visual: kind, narration: "x" }, "image");
      const decided = LANDS_NO_ROW.has(kind) ? !video && !image : video !== image;
      expect(decided, `${kind} is not accounted for in deckStillNeedsJob`).toBe(true);
    }
  });
});

// ── The CAPTION mode (plan 20-17) ──────────────────────────────────────────────────────────────
//
// The route's second mode. It shares the bearer, the sandbox and the return checks with assemble
// and shares none of its input shape — so what these tests pin is mostly the SHARING.

const captionBody = (over: Record<string, unknown> = {}) => ({
  mode: "caption",
  renderId: "batch-1",
  sourceId: "plan1",
  ass: "[Script Info]\n[Events]\nDialogue: 0,0:00:00.00,0:00:01.00,Default,,0,0,0,,hello\n",
  uploadUrls: { mp4: `${DEPLOYMENT}/api/storage/upload?token=a` },
  ...over,
});

describe("the caption burn shares the sandbox, and that is the point", () => {
  it("produces an options object IDENTICAL to the assemble mode's", async () => {
    const assemble = deps();
    await handleRenderRequest(post(body()), assemble.deps);
    const caption = deps();
    await handleRenderRequest(post(captionBody()), caption.deps);

    // A second sandbox-creation path is a second place for `persistent: false` to go missing —
    // which is a cross-tenant leak created by an unset option, not by a bug. Asserting EQUALITY
    // rather than re-asserting the two fields is what makes that hold for fields nobody has
    // thought of yet.
    expect(caption.rec.created).toHaveLength(1);
    expect(caption.rec.created[0]).toEqual(assemble.rec.created[0]);
    expect("name" in (caption.rec.created[0] as object)).toBe(false);
  });

  it("401s without the bearer, and creates NO sandbox", async () => {
    const { deps: d, rec } = deps();
    const res = await handleRenderRequest(post(captionBody(), null), d);
    expect(res.status).toBe(401);
    expect(rec.created).toHaveLength(0);
  });

  it("writes the reel, the track and the burn script — and NOT the assembler", async () => {
    const { deps: d, rec } = deps();
    await handleRenderRequest(post(captionBody()), d);

    const paths = rec.writes.map((w) => w.path);
    expect(paths).toEqual(["in/final.mp4", "in/caps.ass", "burn_caps.sh"]);
    expect(rec.commands).toEqual([{ cmd: "sh", args: ["burn_caps.sh"] }]);
    const script = new TextDecoder().decode(
      rec.writes.find((w) => w.path === "burn_caps.sh")?.content,
    );
    expect(script).toContain("echo burn");
    expect(script).not.toContain("echo assemble");
  });

  it("returns the captioned cut and NO sidecar — the original stays the record", async () => {
    const { deps: d, rec } = deps();
    const res = await handleRenderRequest(post(captionBody()), d);
    const json = (await res.json()) as Record<string, unknown>;
    expect(json.ok).toBe(true);
    expect(typeof json.mp4StorageId).toBe("string");
    // ONE upload, not two. The caption pass does not re-govern the render — it re-encodes a reel
    // that was already proven, and the sidecar it was proven by is untouched.
    expect(rec.fetches.filter((f) => f.init?.method === "POST")).toHaveLength(1);
    expect(json).not.toHaveProperty("sidecarStorageId");
  });

  it("holds the burn to the SAME return checks — an implausible file publishes nothing", async () => {
    // 4 bytes: valid-ish, far under RENDER_MIN_BYTES. The assemble pass refuses this and so must
    // a burn, or a caption pass becomes a way to replace a validated reel with anything at all.
    const { deps: d, rec } = deps({ mp4: new Uint8Array([0, 0, 0, 0, 0x66, 0x74, 0x79, 0x70]) });
    const res = await handleRenderRequest(post(captionBody()), d);
    expect(((await res.json()) as { code: string }).code).toBe("implausible_size");
    // Nothing was uploaded: the uncaptioned reel is still the published one.
    expect(rec.fetches.filter((f) => f.init?.method === "POST")).toHaveLength(0);
    expect(rec.stops).toBe(1); // …and the VM was still torn down
  });

  it("refuses an oversized track — the only content this endpoint accepts is bounded", async () => {
    const { deps: d, rec } = deps();
    const res = await handleRenderRequest(
      post(captionBody({ ass: "x".repeat(CAPTION_MAX_ASS_BYTES + 1) })),
      d,
    );
    expect(((await res.json()) as { code: string }).code).toBe("bad_request");
    expect(rec.created).toHaveLength(0);
  });

  it("refuses an upload URL on a foreign origin — the write-direction SSRF guard", async () => {
    const { deps: d, rec } = deps();
    const res = await handleRenderRequest(
      post(captionBody({ uploadUrls: { mp4: "https://attacker.example/collect" } })),
      d,
    );
    expect(((await res.json()) as { code: string }).code).toBe("bad_request");
    expect(rec.created).toHaveLength(0);
  });

  it("refuses a sourceId carrying path characters — it is only ever appended to OUR origin", async () => {
    const { deps: d, rec } = deps();
    const res = await handleRenderRequest(post(captionBody({ sourceId: "../../etc/passwd" })), d);
    expect(((await res.json()) as { code: string }).code).toBe("bad_request");
    expect(rec.created).toHaveLength(0);
  });

  it("maps the burn script's OWN error wording to codes, and never returns the wording", async () => {
    for (const [stderr, code] of [
      [
        "ERROR: this ffmpeg has no 'subtitles' filter — libass is missing from the image",
        "missing_binary",
      ],
      ["ERROR: subtitle track is empty: in/caps.ass", "caption_track_empty"],
      [
        "ERROR: burned duration 11.4s != expected 20.0s — the caption pass re-timed the video",
        "duration_mismatch",
      ],
    ] as const) {
      const { deps: d } = deps({ exitCode: 1, stderr });
      const res = await handleRenderRequest(post(captionBody()), d);
      const json = (await res.json()) as { code: string };
      expect(json.code).toBe(code);
      // ffmpeg's stderr on a caption burn can echo NARRATION. The response is a code and nothing
      // else — by construction, since `reasonCodeFor` returns a member of a closed union.
      expect(JSON.stringify(json)).not.toContain("ERROR");
    }
  });
});

// ── THE CARD PALETTE (phase 3) ─────────────────────────────────────────────────────────────────
//
// The deck already carried a palette; the renderer drew every card black-and-white. What is tested
// here is the narrowing that happens on the way: model-authored free text becoming two values that
// are safe to interpolate into an ffmpeg filtergraph, with the ink chosen so the words stay
// readable on whatever the background turned out to be.

describe("cardColorsOf: a model-written palette becomes two filtergraph-safe colours", () => {
  const contrast = (a: string, b: string): number => {
    const lum = (c: string): number => {
      const ch = (i: number): number => {
        const v = Number.parseInt(c.slice(2 + i * 2, 4 + i * 2), 16) / 255;
        return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
      };
      return 0.2126 * ch(0) + 0.7152 * ch(1) + 0.0722 * ch(2);
    };
    const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
    return ((hi ?? 0) + 0.05) / ((lo ?? 0) + 0.05);
  };

  it("reads a hex however the specialist happened to write it", () => {
    // The parser deliberately does NOT validate the palette, so all of these really do arrive.
    for (const entry of ["#1B4B43", "1B4B43", "teal (#1B4B43)", "  #1b4b43  "]) {
      expect(cardColorsOf([entry]).bg, entry).toBe("0x1B4B43");
    }
  });

  it("falls back to the OLD CARD when the palette names colours in words", () => {
    // "warm amber" is a legal palette entry — the hex rule is the skill body's to teach, not the
    // parser's — and it must not become a colour. The reel renders exactly as it did before.
    expect(cardColorsOf(["warm amber", "bone"])).toEqual({
      bg: CARD_DEFAULT_BG,
      ink: CARD_DEFAULT_INK,
    });
    expect(cardColorsOf([])).toEqual({ bg: CARD_DEFAULT_BG, ink: CARD_DEFAULT_INK });
    expect(cardColorsOf(undefined)).toEqual({ bg: CARD_DEFAULT_BG, ink: CARD_DEFAULT_INK });
  });

  it("takes the FIRST usable hex, skipping entries that name no colour", () => {
    expect(cardColorsOf(["warm amber", "#1B4B43", "#F5F0E6"]).bg).toBe("0x1B4B43");
  });

  it("NEVER produces anything but 0xRRGGBB — these strings enter a filtergraph", () => {
    // The property that matters, asserted over hostile input rather than over the happy path. A
    // palette entry is model-authored text and the card's words are kept OUT of the filter string
    // by `textfile=`; a colour cannot be, so this is the narrowing that replaces that protection.
    const hostile = [
      "black;rm -rf /",
      "0x000000:x=0",
      "red' -vf 'crop=1:1",
      "#GGGGGG",
      "#12345",
      "#1234567",
      "",
      "${IFS}",
    ];
    for (const entry of hostile) {
      const { bg, ink } = cardColorsOf([entry]);
      expect(CARD_COLOR.test(bg), `bg from ${JSON.stringify(entry)}`).toBe(true);
      expect(CARD_COLOR.test(ink), `ink from ${JSON.stringify(entry)}`).toBe(true);
    }
    // Seven hex digits must not be read as six-plus-one: that would silently shift the colour.
    expect(cardColorsOf(["#1234567"]).bg).toBe(CARD_DEFAULT_BG);
  });

  it("CHOOSES THE INK FOR CONTRAST, which is the whole reason it is computed and not picked", () => {
    // A mid-tone on a mid-tone is a card nobody can read, and it passes every gate this pipeline
    // has: the file decodes, the duration is right, the sidecar is well-formed. Only the words are
    // gone. So the ink is never taken from the palette.
    expect(cardColorsOf(["#1B4B43"]).ink).toBe("0xFFFFFF"); // deep teal -> white
    expect(cardColorsOf(["#F5F0E6"]).ink).toBe("0x000000"); // bone      -> black
    expect(cardColorsOf(["#FFFF00"]).ink).toBe("0x000000"); // yellow is LIGHT despite the hex
    expect(cardColorsOf(["#0000FF"]).ink).toBe("0xFFFFFF"); // blue is DARK despite the hex
  });

  it("clears WCAG AA large-text contrast for every colour in the space, not just the examples", () => {
    // A sweep rather than four hand-picked pairs: the threshold is a single number and a wrong one
    // would still pass the cases above. 3:1 is the AA bar for large text, which a card always is.
    for (let r = 0; r < 256; r += 51) {
      for (let g = 0; g < 256; g += 51) {
        for (let b = 0; b < 256; b += 51) {
          const hex = `#${[r, g, b].map((n) => n.toString(16).padStart(2, "0")).join("")}`;
          const { bg, ink } = cardColorsOf([hex]);
          expect(contrast(bg, ink), `${hex} -> ${ink}`).toBeGreaterThanOrEqual(3);
        }
      }
    }
  });

  it("green and blue of the SAME hex value get different ink — luminance is not an average", () => {
    // The cheap implementation (average the channels) gets this wrong, and it is the case that
    // actually appears: brand greens are common and read far lighter than the same-valued blue.
    expect(cardColorsOf(["#00CC00"]).ink).toBe("0x000000");
    expect(cardColorsOf(["#0000CC"]).ink).toBe("0xFFFFFF");
  });
});
