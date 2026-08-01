---
phase: 20
name: media-canvas
type: research-delta
supersedes: none
extends: "20-RESEARCH.md (2026-08-01) — that document remains valid for the fal adapter, fal video/image rates, webhook auth, the price-table pattern, the batch-reserve mutation, the job/asset schema, the dispatch surface, the skill mirror pattern, the canvas, and koda's art-direction/storyboard/generate prompts. NOTHING here re-opens those."
requirements: [MEDIA-01]
researched: 2026-08-01
confidence: HIGH
answers: "20-CONTEXT.md open questions 6 (TTS provider + price), 7 (Vercel Sandbox mechanics), 8 (the captions step), plus the 12-plan delta the 2026-08-01 re-scope forces."
---

# Phase 20: Media Canvas — RESEARCH DELTA (2026-08-01 re-scope)

**Domain:** TTS pricing, ephemeral render compute, burned captions, and what the "finished reel"
re-scope breaks in twelve already-committed plans.

**Confidence:** HIGH. Unlike the first research pass — where fal's pages 429'd every fetch and the
rates rested on two secondary sources — this pass reached **fal's own catalog API**
(`https://fal.ai/api/models?keywords=…`, unauthenticated, machine-readable) and **fal's own OpenAPI
specs** (`https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=…`). Every price and every
schema below is vendor-direct. Vercel Sandbox figures are from Vercel's own docs
(`last_updated: 2026-06-16` and `2026-07-07`).

---

<user_constraints>
## User Constraints (from CONTEXT.md, 2026-08-01 re-scope)

### Locked Decisions — NEW in this re-scope

**D8 — Scope: the PRODUCTION SPINE (LOCKED).** The deliverable is ONE finished video file, not a set
of assets. Stages in order: `script` (tokens) → `art-direction` (tokens) → `storyboard` → N blocks
(tokens) → `generate` — N clips via fal (**fal $**, batch reserve + Approve) → `voiceover` — one TTS
take per block (**TTS $**, same reservation) → `assemble` — ffmpeg → ONE mp4 (sandbox compute,
post-Approve only) → `captions` — burned AFTER assembly (compute, post-Approve only).
Still OUT: `/brief`, `/concept`, `/trends`, `/publish`, `/repurpose`. `/script` moves IN.
Reference implementation: the Higgsfield `faceless-channel-video` workflow v2.0 —
**harvest its CONTRACT; do not clone the repo; do not depend on the MCP at runtime.**
Contract properties to inherit verbatim: fixed-length blocks (N × clip-seconds, default 10);
**no time-stretch, ever** (a voice line longer than its window is a HARD ERROR → rewrite and
regenerate upstream); speech-centred not file-centred; narration-per-window assert;
`assembly.json` sidecar (refs-and-counts only) as the proof-of-governed-render;
**captions are a SEPARATE step run AFTER assembly** — do not re-merge.

**D9 — The renderer: Vercel Sandbox (LOCKED).** Rejected: a persistent Fly/Cloud Run worker;
`ffmpeg.wasm` in the browser. A post-Approve Convex action starts the sandbox, streams clips + voice
takes in, runs the script, and pulls `final.mp4` + `final.mp4.assembly.json` back to `ctx.storage`.
**The sandbox is a trust boundary.** Nothing it returns is trusted without validation, and **no fal
URL or API key is ever passed into it.** Read the `vercel:vercel-sandbox` skill first.

**D10 — Caps for an assembled job (LOCKED, SUPERSEDES D4's numbers).**
`MEDIA_JOB_CAP_USD` = **$3.50**; `MEDIA_DAILY_CENTS` = **1000 ($10.00/day)**.
At 480p/10 s Wan 2.5 = $0.50 per block: 3 blocks PASS · 6 blocks (60 s) = $3.00 PASS ·
12 blocks REFUSED · 6 blocks at 720p REFUSED.
**The whole JOB is the priced and reserved unit** — clips AND voice takes together, in the one
transactional mutation. **Sandbox compute is a cost line too** — estimate it, or record deliberately
that it is unmetered and why. Per-tenant keying and the `deploymentMediaSpendCents` ceiling still
apply, re-sized.

### Locked Decisions — UNCHANGED by the re-scope
**D1** route-based surface · **D2** proposal-only specialist · **D3** fal.ai + Wan 2.5 (ADR-011) ·
**D7** canvas in the workspace right pane. All still binding, all still covered by `20-RESEARCH.md`.

### Claude's Discretion (delta scope)
- The TTS provider and model, and its price-table row shape.
- The STT provider and model, if captions ship.
- Where the assemble script lives and how it is delivered to the sandbox.
- Sandbox image strategy (snapshot vs custom image vs per-invocation install).
- Whether captions ship in Phase 20 or are the first deferral.
- The revised plan/wave decomposition.

### Deferred Ideas (OUT OF SCOPE) — unchanged
Re-cutting user footage · music beds and sung tracks (`--music` / `--song`) · koda content stages ·
a premium model default · automated reconciliation · a real video editor · agent-orchestrated chains.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Delta research support |
|----|-------------|------------------------|
| MEDIA-01 | "A media-creation canvas produces images and video … as async governed jobs with a separate cost cap — generation is wrapped, not rebuilt" | §1 (the TTS line item and its price), §2 (the render worker), §3 (captions), §4 (the revised job economics that keep the cap meaningful), §6 (the plan delta) |

`REQUIREMENTS.md:139` is still stale (it says "≤3 min via the connected Pikar-Ai service").
`20-RESEARCH.md` already assigns that correction to plan `20-11`. **The re-scope changes what the
correction should SAY**: multi-minute output by ASSEMBLY is now in scope; the ≤15 s ceiling is a
per-CLIP ceiling, not a per-DELIVERABLE one. See §6.
</phase_requirements>

---

## 0. VERDICT ON THE LOCKED DECISIONS — read this first

The brief asked for a loud section if a locked decision is unworkable. **No locked decision is
unworkable. Both of the named failure conditions are comfortably false, and here are the numbers.**

| Locked decision | Failure condition the brief named | Verdict | Margin |
|---|---|---|---|
| **D9** — Vercel Sandbox | "a 6-block 480p render cannot finish inside one sandbox invocation" | **HOLDS** | Sandbox max duration is **45 min (Hobby) / 24 h (Pro)**. A 6-block 480p render is **60–150 s**. Margin **18–45×**. The binding ceiling is not the sandbox at all — it is the **Convex Node.js action limit of 10 minutes**, and even that is 4× headroom. |
| **D10** — $3.50/job | "TTS + clips cannot fit $3.50" | **HOLDS** | $3.00 clips + **$0.012** voice + $0.008 captions-STT + ~$0.01 sandbox = **$3.03**. Headroom **$0.47 (13%)**. TTS is **0.4% of the job**, not a threat to the cap. |

**Two things that are NOT blockers but that the owner must be told, because they are new liabilities
nobody has named:**

1. **`VERCEL_TOKEN` is a strictly more powerful secret than `FAL_KEY`.** OIDC auth (the recommended
   path) is only automatic *on Vercel*; a Convex action is a non-Vercel environment, so it must use
   the **access-token** path: `VERCEL_TOKEN` + `VERCEL_TEAM_ID` + `VERCEL_PROJECT_ID`, all three
   together. A Vercel personal access token is scoped to a *team*, not to a capability — it can
   deploy, read project env vars, and delete projects. ADR-011's line *"an API key in a deployment
   secret is the whole auth story"* was true of fal. It is **not** true of the renderer. §2.2 gives
   the mitigation and a token-free alternative.
2. **The reel has a STORAGE cost dimension nobody has costed.** Per job: 6 clips (~30 MB) + 6 voice
   takes (~5 MB) + `final.mp4` (~10 MB) + the captioned cut (~10 MB) ≈ **55 MB**. At D10's 2 jobs/day
   that is **3.3 GB/month** into `ctx.storage`. Convex Free/Starter include **1 GB total**. See §4.3
   for the one-line retention rule that fixes it.

---

## 1. Q1 — THE TTS PROVIDER AND ITS PUBLISHED PRICE

### 1.1 Does fal serve TTS with a published per-character USD price? YES — many.

Read from **fal's own catalog API** on 2026-08-01 (`GET https://fal.ai/api/models?keywords=text-to-speech&page=1`,
unauthenticated, returns each model's vendor-authored `pricingInfoOverride` string plus `deprecated`
/ `status` / `hidePricing` flags). **HIGH confidence — this is vendor-direct, not a comparison blog.**

| Endpoint id | Published price (vendor-direct) | Billing unit | Pre-flight estimable? |
|---|---|---|---|
| **`fal-ai/inworld-tts`** | **$0.01 per 1000 characters** | character | **YES — exactly** |
| `xai/tts/v1` | $0.015 per 1000 characters | character | YES |
| `fal-ai/kokoro/american-english` | $0.02 per 1000 characters *(from fal's model page + fal's own 2026 learn content; **not** in the catalog API's `pricingInfoOverride` field)* | character | YES |
| `fal-ai/chatterbox/text-to-speech` | $0.025 per 1000 characters | character | YES |
| `resemble-ai/chatterboxhd/text-to-speech` | $0.04 per 1000 characters | character | YES |
| `fal-ai/minimax/speech-02-turbo` | $0.06 per 1000 characters | character | YES |
| `fal-ai/minimax/speech-02-hd` | $0.10 per 1000 characters | character | YES |
| `fal-ai/vibevoice`, `/7b` | $0.04 per **generated minute**, rounded to nearest 15 s | output duration | **NO** |
| `fal-ai/index-tts-2/text-to-speech`, `fal-ai/maya` | $0.002 per **generated audio second** | output duration | **NO** |

**The decisive criterion is not price — it is the BILLING UNIT.** D10 reserves the whole job in one
transactional mutation *before* a single request is submitted. A model billed per *generated audio
second* cannot be estimated exactly pre-flight: you would have to guess the duration from the
character count, and that guess-vs-submit gap is structurally identical to `20-RESEARCH.md`'s
**pitfall 1** (the "money bug" — estimating at one resolution and submitting at the provider's
default). **The TTS row MUST be priced per character.** Write that rule into the price table's
comment, not just into a plan.

### 1.2 Recommendation: `fal-ai/inworld-tts` — ONE row

**Ponytail reuse:** this is *the same provider, the same `FAL_KEY`, the same `queue.fal.run` submit
path, the same `?fal_webhook=` callback, the same HMAC path segment, the same `mediaJobs` row, the
same landing/verdict/audit code* that plans `20-05` and `20-06` already build. Adding voiceover is
**one price-table row and one `kind` literal** — not a second adapter, not a second secret, not a
second webhook, not a second reconciliation procedure. That is rung 2 of the ladder, and it is the
whole argument. Every non-fal alternative (§1.4) costs a new vendor, a new secret, a new auth model
and a second reconciliation surface to save at most a cent per reel.

Read from fal's OpenAPI spec for `fal-ai/inworld-tts` (**HIGH — vendor-direct**):

```jsonc
// INPUT  (x-fal-order-properties: text, voice, sample_rate_hertz)
{ "text": "<string, required>",
  "voice": "Loretta (en) | Hank (en) | Evelyn (en) | … 70+ English voices, plus zh/nl/fr/…",
  "sample_rate_hertz": 8000 | 16000 | 24000 | 32000 | 40000 | 48000   // default 48000
}
// OUTPUT
{ "audio": { "url": "…", "content_type": "…", "file_name": "…", "file_size": 1234 } }
```

**Two properties of this endpoint that are load-bearing for D8, not incidental:**

1. **There is NO `speed` / `rate` parameter.** The model is *structurally incapable* of time-stretch.
   D8's *"No time-stretch, ever"* invariant is therefore enforced by the provider, not by our
   discipline. **`fal-ai/kokoro/*` has `speed: 0.1–5.0` and is therefore a live foot-gun** — a future
   contributor fixing an overrunning voice line by nudging `speed` to 1.15 would violate D8 silently
   and no test would catch it. That alone outranks Kokoro's differences in voice character.
2. **48 kHz WAV output by default.** Pin `sample_rate_hertz` explicitly on every submit (the
   §10.1 "never rely on a provider default" rule from the first research, applied here) and pin it to
   **24000** — enough for speech, halves the bytes going into the sandbox, and makes the ffmpeg
   resample step deterministic.

**Price-table row shape** — extends `packages/cost/src/media.ts` from `20-RESEARCH.md` §4.2 with a
third pricing dimension, mirroring the existing two:

```ts
// USD per 1000 CHARACTERS of submitted text. Character billing is the REQUIREMENT, not a preference:
// the batch is reserved before any request exists, so a per-output-second model cannot be priced.
export const MEDIA_TTS_PRICING: Record<string, number> = {
  "fal-ai/inworld-tts": 0.01,
};

export const MEDIA_DEFAULT_VOICE = {
  model: "fal-ai/inworld-tts",
  voice: "Evelyn (en)",       // pinned; never a provider default
  sampleRateHertz: 24000,     // pinned; never a provider default
} as const;

// MediaSpec gains a third member — the SAME shape the estimator and the submit body both consume.
| { kind: "tts"; model: string; characters: number }

// estimateMediaUsd(tts)  =  (characters / 1000) * MEDIA_TTS_PRICING[model]
//                            ^ NO Math.ceil on the thousands — fal bills fractionally.
//                              (Contrast images, which DO round megapixels UP.)
// Unknown model -> err({ code: "unknown_model" }) — the cost.ts:64 rule, unchanged.
```

### 1.3 Costing the 6-block 60-second voiceover — the number D10 turns on

English narration runs ~150 wpm ≈ 2.5 words/s. An English word averages ~5.1 characters + 1 space
≈ **6.1 characters/word**, so speech consumes roughly **15 characters per second**.

| Quantity | Value |
|---|---|
| Target script | 150–170 words across 6 blocks |
| Characters | 170 × 6.1 ≈ **1,040**; budget **1,200** with punctuation slack |
| Per-block ceiling (10 s window) | 10 s × 15 chars/s = **150 chars**; enforce at **140** for headroom |
| **Cost at `fal-ai/inworld-tts` ($0.01/1k)** | **$0.012** |
| Cost at Kokoro ($0.02/1k) | $0.024 |
| Cost at the dearest fal row, MiniMax HD ($0.10/1k) | $0.120 |
| Cost at ElevenLabs direct (~$0.05–0.10/1k) | $0.060–0.120 |

**Against D10's $3.50 job cap, with $3.00 of 480p clips:**

| Line item | Cost |
|---|---|
| 6 × Wan 2.5 480p 10 s clips | $3.000 |
| 6 × TTS takes, `fal-ai/inworld-tts`, ~1,200 chars total | **$0.012** |
| 1 × captions STT (§3), `elevenlabs/speech-to-text/scribe-v2`, 1 audio minute | $0.008 |
| Sandbox compute (§2.4) | ~$0.010 |
| **Job total** | **$3.030** |
| **Headroom under `MEDIA_JOB_CAP_USD` = $3.50** | **$0.470 (13.4%)** |

**This does NOT break the locked cap. It is not close to breaking it.** Even at the most expensive
TTS row fal serves, the job total is $3.14 and still passes. **The cap is bounded by the CLIPS, and
the clips were already the locked constraint.** Say so in the ADR so nobody re-derives it.

### 1.4 Alternatives, evaluated on ADR-011's binding criterion

ADR-011 rejected Higgsfield for **credit-denominated pricing with no published per-model cost**. The
same logic binds here. All five named alternatives *pass* the published-price test — none is
credit-denominated — so the rejection is on reuse cost, not on opacity.

| Provider | Published USD list? | Server-to-server from a Convex action? | Auth | Rate (per 1k chars) | Verdict |
|---|---|---|---|---|---|
| **fal (`inworld-tts`)** | **YES — vendor catalog API, machine-readable** | YES — already built | `FAL_KEY`, already a deployment secret | **$0.010** | **CHOSEN** |
| OpenAI TTS (`tts-1`) | YES ($15/1M chars) | YES | `OPENAI_API_KEY` — **already in this deployment** (`llm.ts`) | $0.015 | Runner-up. Only 6 preset voices, no queue/webhook — a synchronous call, so it needs a *different* landing path from every other media job. Rejected on that asymmetry. |
| Deepgram Aura-2 | YES | YES | new key | $0.030 | 3× dearer, new vendor, new secret, new reconciliation surface. |
| Cartesia Sonic | YES ($50/1M) | YES | new key | $0.050 | Sub-100 ms first-byte latency — irrelevant for offline reel narration. |
| ElevenLabs direct | YES | YES | new key | $0.050–0.100 | Best voice quality by a clear margin. 5–10× dearer, new vendor, new secret. **Available on fal as `fal-ai/elevenlabs/tts/turbo-v2.5` if quality ever demands it — a price-table row, not a re-architecture.** |
| PlayHT | Published, but plan/credit-tiered on the consumer side | YES | new key | — | **Closest to the Higgsfield failure mode. Do not use.** |

**No provider evaluated here is credit-denominated except PlayHT's consumer tiers, which is exactly
why PlayHT is out.**

### 1.5 Does the provider return per-request duration or character counts? NO — and that is GOOD.

`fal-ai/inworld-tts`'s output schema is `{ audio: File }` where `File` is `{ url, content_type,
file_name, file_size }`. **There is no `duration` field and no character count.** Same for
`fal-ai/kokoro/*` (verified against its OpenAPI spec). Three consequences, all favourable:

1. **`actual == estimate` by construction for the voice line.** Spend is a pure function of the
   characters *we submitted*, which we know exactly and store on the job row. The webhook's delta
   reconciliation (`20-RESEARCH.md` §4.4) has **nothing to reconcile** for `kind: "tts"` — skip the
   re-price entirely and record `actualCents = estCents`. One `if`, not a new code path.
2. **The narration-fits-its-window check cannot happen at landing time.** Duration is only knowable
   by `ffprobe`, which lives in the sandbox. So D8's *"a voice line longer than its window is a HARD
   ERROR"* is detected at ASSEMBLE time — **after the clips are already paid for.** That is a real
   money hazard, and §5.1 gives the pre-flight guard that closes it.
3. `file_size` is present and is a usable sanity signal: a 24 kHz mono WAV is ~48 KB/s, so a take
   whose `file_size` implies > 12 s is already suspect before the sandbox ever sees it. Cheap
   defence-in-depth; not a substitute for the pre-flight character guard.

---

## 2. Q2 — VERCEL SANDBOX MECHANICS

Read the `vercel:vercel-sandbox` skill first, as D9 instructs
(`~/.claude/plugins/cache/claude-plugins-official/vercel/0.45.1/skills/vercel-sandbox/SKILL.md`).
**Honest note: the shipped skill is entirely about browser automation** — agent-browser + headless
Chrome, Chromium `dnf` deps, an `AGENT_BROWSER_SNAPSHOT_ID`. It contains **nothing about ffmpeg**.
What it *does* give, and what is reusable verbatim, is the **credential-resolution helper shape**,
the **`withX(fn)` create/try/finally-stop wrapper**, and the **snapshot-for-fast-startup pattern**.
Everything below the skill was verified against current Vercel docs (`/docs/sandbox/pricing`
last_updated 2026-06-16; `/docs/sandbox/sdk-reference` last_updated 2026-07-07;
`/docs/sandbox/working-with-sandbox` last_updated 2026-06-30).

### 2.1 Bytes in, bytes out (HIGH — vendor docs)

```ts
import { Sandbox } from "@vercel/sandbox";

const sandbox = await Sandbox.create({
  token: process.env.VERCEL_TOKEN!,          // §2.2 — OIDC is NOT available from Convex
  teamId: process.env.VERCEL_TEAM_ID!,
  projectId: process.env.VERCEL_PROJECT_ID!,
  source: { type: "snapshot", snapshotId: process.env.MEDIA_SANDBOX_SNAPSHOT_ID! }, // §2.3
  resources: { vcpus: 2 },                   // 2048 MB RAM per vCPU -> 4 GB. Default is 2.
  timeout: 8 * 60_000,                       // SHORTER than Convex's 10-min Node action limit
  networkPolicy: "deny-all",                 // §2.5 — the trust boundary, enforced by infrastructure
  persistent: false,                         // §2.5 — MANDATORY. Default is TRUE.
});
try {
  await sandbox.mkDir("/vercel/sandbox/in");
  await sandbox.writeFiles([                 // Buffer in. Bundle related files in ONE call.
    { path: "in/block-01.mp4", content: clipBuf },
    { path: "in/voice-01.wav", content: voiceBuf },
    // …
    { path: "assemble_final.sh", content: Buffer.from(ASSEMBLE_SCRIPT) },  // §2.6
  ]);
  const run = await sandbox.runCommand("sh", ["assemble_final.sh", "--blocks", "6", "--clip-seconds", "10"]);
  if (run.exitCode !== 0) { /* reasonCode, never provider prose — calendar.ts:84 idiom */ }
  const mp4      = await sandbox.readFileToBuffer({ path: "out/final.mp4" });          // Buffer | null
  const sidecar  = await sandbox.readFileToBuffer({ path: "out/final.mp4.assembly.json" });
} finally {
  await sandbox.stop();                      // safe to call multiple times
}
```

| Need | API | Notes |
|---|---|---|
| Bytes **in** | `sandbox.writeFiles([{ path, content: Buffer }])` | Paths default to `/vercel/sandbox`. Batch them — each call is a control-plane round trip. |
| Directory | `sandbox.mkDir(path)` | Call before `writeFiles` into a new dir. |
| Execute | `sandbox.runCommand(cmd, args)` or `runCommand({ cmd, args, sudo, env, cwd, detached })` | `.stdout()`, `.stderr()`, `.exitCode`. Sandbox state persists across commands within a session. |
| Bytes **out** | `sandbox.readFileToBuffer({ path })` → `Buffer \| null` (null when missing) | `sandbox.readFile({ path })` returns a `ReadableStream` if you prefer. There is also a `node:fs/promises`-compatible `sandbox.fs`. |
| Teardown | `sandbox.stop()` / `sandbox.delete()` | Always in a `finally`. Vercel's own cost guidance: *"Stop sandboxes promptly rather than waiting for timeout."* |

**Convex-side constraints that matter (HIGH — Convex docs):**
- The runner must be a **`"use node"` internalAction**. `@vercel/sandbox@2.9.2` is 1.4 MB unpacked with
  **zero native dependencies** (`undici`, `jose`, `tar-stream`, `zod`, `ms`, `async-retry`,
  `@vercel/oidc`, `xdg-app-paths`, `jsonlines`, `picocolors`), so it bundles cleanly.
- **Convex Node.js actions run Node 20 by default**, configurable to 22 or 24 via `convex.json`.
  `undici@7` requires `^20.18.1 || >=22.10.0`. **This repo has no `convex.json`.** Creating one that
  pins `"node": { "version": "22" }` is the cheap, deterministic fix — do it in the same plan as the
  runner, and note it as a boot-order change for `README.md` (CLAUDE.md §7).
- **Convex Node.js action execution limit is 10 minutes** (Convex-runtime actions get 30). The
  sandbox `timeout` must be set **below** that so the VM is torn down rather than orphaned when the
  action is killed. 8 minutes is the recommendation above.
- **Node-action argument limit is 5 MiB** (vs 16 MiB elsewhere). **Never pass clip bytes as action
  args.** Pass `mediaJobs` ids; read bytes with `ctx.storage.get(id)` *inside* the action. This is
  the `vault.ts:645` rule already in force in this repo.

### 2.2 Auth — and the crown-jewel problem

Vercel Sandbox supports exactly two auth methods:

| Method | Works from Convex? | Secrets needed |
|---|---|---|
| **Vercel OIDC token** (recommended by Vercel) | **NO.** `VERCEL_OIDC_TOKEN` is minted by Vercel *for a Vercel deployment*. A Convex action is a non-Vercel environment. | — |
| **Access token** | YES | `VERCEL_TOKEN` + `VERCEL_TEAM_ID` + `VERCEL_PROJECT_ID`, **all three or none** |

**So a Convex-hosted runner requires a long-lived Vercel personal access token as a deployment
secret.** That token is scoped to a *team*, not to a capability: it can deploy, read project
environment variables (i.e. every other secret on the Vercel side), and delete projects.

**Two mitigations, and the planner must pick one deliberately:**

**(a) — Recommended, lazy, one file:** keep the runner in Convex, accept the token, and treat it as a
crown jewel with the discipline `gmailAuth.ts` already documents. Concretely: create the token on a
**dedicated Vercel team/project used only for sandbox rendering**, so its blast radius contains no
production deployment; set it via `npx convex env set`, never `.env.local` (the Phase-2 lesson);
record it in the media playbook's dependency section alongside `FAL_KEY`; and add a `requireEnv`
fail-closed check so an unset token refuses **before** any network call (the `20-05` `FAL_KEY` rule,
reused verbatim).

**(b) — Token-free, one extra hop:** put the runner in `apps/web` as a route handler
(`app/api/media/render/route.ts`), where **OIDC is automatic and no access token exists anywhere**.
Convex calls it with a shared bearer secret — which is *exactly* the shipped `/skillopt/export`
pattern (`http.ts:84-97`) run in the opposite direction, including its fail-closed 401. Costs: one
HTTP hop, one shared secret, and the Vercel function's own max-duration ceiling now binds instead of
Convex's.

Recommend **(a)**, with (b) recorded in the ADR as the upgrade path if the token's scope ever becomes
unacceptable. `ponytail:` comment naming that ceiling belongs at the `Sandbox.create` call.

### 2.3 Is `ffmpeg` present, installable, or must it be layered in?

**`ffmpeg` is NOT present and is NOT in the `dnf` repositories.** The sandbox runs **Amazon Linux
2023**; AL2023 has never shipped ffmpeg in its repos (a licensing decision inherited from AL2).
`dnf install -y ffmpeg` fails. `ffprobe` ships in the same tarball as `ffmpeg` and has the same
status. **`awk` is expected to be present** (AL2023 base includes `gawk`) — **MEDIUM confidence;
verify with one command rather than assuming**, and `dnf install -y gawk` is the fallback and *is*
in the repos.

Three ways to get ffmpeg in, in ascending order of laziness:

| Approach | Cold-start cost | Verdict |
|---|---|---|
| **Per-invocation download of a static build** — `curl` the BtbN `linux64-gpl` tarball (**~125 MB `.tar.xz`**, ffmpeg **and** ffprobe, statically linked, `libass` enabled), `tar -xJf`, move to `/usr/local/bin` | **~15–30 s** every render (download + xz decompress). **Download bandwidth INTO a sandbox is free** — Vercel bills egress only. | Works. Wasteful. Requires egress to be open at start, which conflicts with `deny-all` (§2.5). |
| **Sandbox snapshot** — bake ffmpeg once, boot every render from the snapshot | **Sub-second** | **RECOMMENDED.** One `bake-sandbox-snapshot.mjs` script run by the owner, one `MEDIA_SANDBOX_SNAPSHOT_ID` deployment secret. Storage cost: a ~200 MB extract at $0.08/GB-month ≈ **$0.016/month**. Hobby includes 15 GB lifetime. |
| **Custom image** — push to Vercel Container Registry, `Sandbox.create({ image: "media-render:v1" })` | Sub-second | Cleanest long-term, but introduces a container build + registry push into a repo whose whole boot story is `pnpm install` → `npx convex dev`. **Ponytail rung 1: not yet.** Record as the upgrade path. |

**Snapshot caveat that must be in the playbook:** *"Packages you install don't persist between
sessions"* — and **snapshots expire 30 days after last use by default** (`snapshotExpiration`, or `0`
for never). A media rail that goes 31 days unused wakes up with a dead snapshot id. Either set
`snapshotExpiration: 0` at bake time, or make the runner **fall back to the per-invocation static
download** when boot-from-snapshot fails. Recommend the fallback: it is ~10 lines and it turns a
month-long outage into a 30-second-slower render.

### 2.4 Max duration vs a realistic 6-block render — D9's stated failure condition

**Ceilings (vendor-direct):**

| Limit | Hobby | Pro / Enterprise |
|---|---|---|
| **Max runtime duration** | **45 minutes** | **24 hours** |
| Default timeout if unset | 5 minutes | 5 minutes |
| Max vCPUs / memory | 4 / 8 GB | 8 / 16 GB (Ent. 32 / 64 GB) |
| Concurrent sandboxes | 10 | 2,000 |
| Ephemeral disk | 32 GB | 32 GB |
| Region | `iad1` only | `iad1` only |

**Estimated wall-clock for `assemble_final.sh` on 6 × 10 s 480p blocks at 2 vCPU:**

| Step | Estimate |
|---|---|
| Sandbox create from snapshot | ~1–3 s |
| `writeFiles` — 6 clips (~30 MB) + 6 voice takes (~5 MB) + the script | ~10–30 s (control plane) |
| Per block: `ffprobe` clip · `silencedetect` on the take · re-encode the 10 s window to a uniform codec · freeze metric | ~2–5 s × 6 = **12–30 s** |
| Concat (stream copy — the blocks were normalised, so `-c copy` is safe) | ~1 s |
| **Two-pass `loudnorm`** on the 60 s bed: pass 1 analysis, pass 2 apply | **~5–10 s** |
| Final mux + verification `ffprobe` + sidecar write | ~2 s |
| `readFileToBuffer` — `final.mp4` (~10 MB) + `assembly.json` | ~5–15 s |
| **TOTAL** | **~60–150 s** |

**Verdict: 60–150 s against a 45-minute floor. There is no blocker on D9.** The tightest real ceiling
is **Convex's 10-minute Node action limit**, which still leaves 4×. Guidance for the plan: set the
sandbox `timeout` to 8 minutes, and treat a render exceeding 5 minutes as an anomaly worth a
dead-letter row, not a retry — because at 480p it means something is structurally wrong (wrong
resolution, wrong block count, or an ffmpeg filter falling back to software when it shouldn't).

**720p/1080p are already refused by D10's cap arithmetic on the CLIP side**, so the render never sees
a resolution that would change these numbers. That is a happy accident worth writing down: the budget
rail is also the render-duration rail.

### 2.5 What sandbox compute actually costs — satisfying D10's "estimate it or record why not"

Vercel Sandbox is metered on five dimensions (Pro/Enterprise rates; Hobby has free allotments):

| Metric | Rate | Hobby included |
|---|---|---|
| Active CPU (**vCPU-hours**; I/O wait is NOT billed) | $0.128/hour | 5 hours/month |
| Provisioned Memory (GB-hours, 1-minute minimum) | $0.0212/GB-hour | 420 GB-hours/month |
| Sandbox Creations | $0.60 per 1M | 5,000/month |
| Data Transfer (**egress only**; downloads INTO the sandbox are free) | $0.15/GB | 20 GB/month |
| Snapshot Storage | $0.08/GB-month | 15 GB lifetime |

**Per-render estimate — 2 vCPU / 4 GB, ~150 s wall-clock of which ~60 s is CPU-bound ffmpeg:**

| Line | Arithmetic | Cost |
|---|---|---|
| Active CPU | 2 vCPU × 60 s = 0.0333 vCPU-h × $0.128 | **$0.0043** |
| Provisioned Memory | 4 GB × 150 s (0.0417 h) = 0.167 GB-h × $0.0212 | **$0.0035** |
| Creation | 1 × $0.0000006 | **$0.0000** |
| Egress (`final.mp4` ~10 MB, if `readFile` counts as egress) | 0.01 GB × $0.15 | **$0.0015** |
| **TOTAL per render** | | **≈ $0.010** — budget **$0.02** with slack |

*(Cross-check against Vercel's own worked example: "AI code validation, 5 min, 2 vCPU, 4 GB → ~$0.03".
Our render is shorter and only partly CPU-bound, so ~$0.01 is consistent.)*

**Add `MEDIA_SANDBOX_USD_PER_RENDER = 0.02` to the price table as a flat, named constant** and include
it in the batch reserve, with a `ponytail:` comment: *"a flat estimate, not metered per-render.
Vercel does not expose per-sandbox billing at request time. The ceiling is that a pathological render
could cost more than the constant; the upgrade path is `sandbox.usage` on the returned session
object, reconciled in the manual D5 procedure."* That satisfies D10 literally — the line is
estimated, and its ceiling is stated.

> **The one operational risk in this section, and it is real.** If this project is on **Hobby**, the
> 5 free Active-CPU hours/month divide by ~0.033 vCPU-h per render into **~150 renders/month** — but
> Hobby also caps **concurrency at 10** and, critically, **PAUSES sandbox creation for 30 days once
> the allotment is exhausted** rather than charging. D10 permits 2 jobs/day = ~60/month, so the
> headroom is ~2.5×, which is fine *until* a retry storm or a test suite that accidentally creates
> real sandboxes eats it. **Mitigation: the offline seam (§Validation) must be the DEFAULT in tests,
> and the render action must count creations per day against the same guardrail pattern.** Verify the
> plan tier before execution and record it in the playbook's dependency section.

### 2.6 The trust boundary — what to validate, what must never go in

D9: *"The sandbox is a trust boundary. Nothing it returns is trusted without validation, and no fal
URL or API key is ever passed into it."* Here is how to make that **structural** rather than a
promise.

**Never passed IN — and enforced by a static scan in `llmRedaction.test.ts`, not by review:**

| Never | Why |
|---|---|
| `FAL_KEY`, `OPENAI_API_KEY`, `VERCEL_TOKEN`, `SKILLOPT_TOKEN` | A live credential inside a VM running a script |
| Any **fal signed URL** | Both a content leak and a live credential (CLAUDE.md §4, stated verbatim in CONTEXT) |
| Any **Convex storage signed URL** | `plans.attachmentUrls`' own header calls it a *bearer capability* |
| `tenantId`, user email, thread ids | The sandbox needs an opaque job handle and nothing else |
| The prompt text or the script prose beyond the narration lines being spoken | Minimise what crosses the boundary |

**Three infrastructure-level guarantees, all one option each:**

1. **`networkPolicy: "deny-all"`.** Vercel documents this exact use case: *"start a sandbox, gather
   data, then run some untrusted program on it without risking data exfiltration."* With egress
   denied, tenant clips **cannot leave** even if the script were compromised. This is why §2.3
   recommends the snapshot: `deny-all` and a per-invocation ffmpeg download are mutually exclusive.
   (`sandbox.update({ networkPolicy })` can flip it mid-session if the download fallback fires — do
   the download first, then flip to `deny-all` **before** `writeFiles` puts tenant bytes in.)
2. **`persistent: false`.** **Sandboxes are PERSISTENT BY DEFAULT** as of the current SDK — on stop,
   the filesystem is auto-snapshotted and restored on the next resume. Left at the default, **tenant
   A's clips would survive into the VM that renders tenant B's reel.** That is a cross-tenant data
   leak created by an unset option. This is the single sharpest new pitfall in the whole delta
   (§5.2), and it deserves its own assertion.
3. **The script is CODE, not a registry row.** `assemble_final.sh` must live as a repo file mirrored
   to a bundler-safe TS constant — **exactly the `packages/contracts/skills/*.md` → `src/skills/*.ts`
   five-file mirror pattern** (`20-RESEARCH.md` §7.1), including its byte-identical drift test,
   because the Convex runtime cannot `fs.read` repo files. **It must NOT be a `skills` table row:** a
   registry row is runtime-mutable by a DB write, and a runtime-mutable shell script executed in a VM
   is remote code execution. CLAUDE.md §5 governs *prompts*; this is not a prompt. Write that
   distinction into the playbook in one sentence so nobody "fixes" it later.

**Validated on RETURN — all cheap, all in the runner action:**

| Check | How |
|---|---|
| `final.mp4` exists and is non-empty | `readFileToBuffer` returns `null` when missing → job fails with a code |
| Size within a sane band | e.g. 200 KB–200 MB for a 60 s 480p reel; outside → fail |
| It really is an MP4 | bytes 4..8 === `"ftyp"` (ISO-BMFF box). One line. |
| MIME is **ours**, never the sandbox's | `new Blob([bytes], { type: "video/mp4" })` — we assert the type; nothing read from the VM sets it |
| The sidecar is **valid and complete** | Parse `assembly.json` with a strict validator in `packages/core` (Convex-free, CLAUDE.md §1) and range-check every field. **A render whose sidecar fails validation is NOT a governed render — fail the job, do not publish the file.** The script's own words: *"a final video without one was hand-assembled."* |
| Sidecar is refs-and-counts only | Static scan: the audit write from the render path may carry only `{ jobId, batchId, planId, blockCount, renderMs, assetHash, sidecarHash, gatesPassed }` — no filename, no narration, no URL |
| stdout/stderr never persisted | Map `exitCode` + a matched pattern to a **reasonCode** (`calendar.ts:84` idiom). ffmpeg's stderr contains file paths and can contain narration text from `drawtext`. |

---

## 3. Q3 — THE CAPTIONS STEP

### 3.1 What the Higgsfield scripts imply, and what we should actually build

`scripts/subtitles/burn_caps_clean.sh` + `audio_to_captions.py` + `fetch_fonts.sh` imply, in their
original form: **a Python 3 runtime, Whisper model weights (~1.5–3 GB), a font fetcher, and an
`libass`-enabled ffmpeg**, all inside the render VM.

**Recommendation: do NOT port that shape. Split it.** Move the STT to fal (where the adapter, the
auth, the queue, the webhook, the price table and the reconciliation already exist), keep the caption
timing math in pure TS, and leave the sandbox as **ffmpeg-only**.

| Original | Our version | What it costs us |
|---|---|---|
| `audio_to_captions.py` + Whisper weights in the VM | `fal-ai/elevenlabs/speech-to-text/scribe-v2` (§3.2) + a pure-TS `.ass` writer in `packages/core` | **Zero Python. Zero model weights. Zero new sandbox dependency.** One price row, one job `kind`. |
| `fetch_fonts.sh` | One `.ttf` shipped via `writeFiles` (~700 KB, free — it is not egress), or `dnf install -y dejavu-sans-fonts` baked into the snapshot | Nothing. Do NOT fetch fonts at runtime with `deny-all` egress. |
| `burn_caps_clean.sh` | Kept nearly verbatim — one ffmpeg `subtitles=` pass over `final.mp4` | Constrains the ffmpeg build: **it must be a `libass`-enabled GPL build**. The BtbN `linux64-gpl` tarball is; an LGPL build may not be. Name the exact tarball in the playbook. |

**This is the biggest single simplification available in the whole re-scope.** It removes an entire
language runtime and a multi-gigabyte model from a VM that boots per render.

### 3.2 Is STT a further PRICED line item? YES — and it is nearly free.

Read from fal's catalog API and OpenAPI specs on 2026-08-01 (**HIGH — vendor-direct**):

| Endpoint | Published price | Word-level timestamps? | Pre-flight estimable? | Verdict |
|---|---|---|---|---|
| **`fal-ai/elevenlabs/speech-to-text/scribe-v2`** | **$0.008 per input audio minute** *(keyterms add 30%)* | **YES** — `words: [{ text, start, end, type: "word" \| "spacing" \| "audio_event", speaker_id }]` | **YES** — we know the input duration exactly | **CHOSEN** |
| `fal-ai/elevenlabs/speech-to-text` (v1) | $0.03 per minute *(2025 catalog dump; no `pricingInfoOverride` today)* | YES — same `words[]` shape | YES | Superseded by v2 on both price and currency of the figure |
| `fal-ai/whisper` | **$0.00111 per COMPUTE second** | YES — `chunk_level: "word"` → `chunks: [{ timestamp: [start, end], text }]` | **NO** | **REJECTED.** Compute-second billing cannot be estimated before the run, so it cannot be reserved. Same structural defect as a per-output-second TTS model (§1.1). Ironically it works out to only ~$0.0005/minute in practice — but *"cheap in practice"* is exactly the reasoning ADR-011 exists to forbid. |
| `fal-ai/speech-to-text` (NVIDIA Canary) | $0.0008 per audio second — estimable | **NO** — output is `{ output: string, partial: bool }`, plain text only | YES | **REJECTED — no timings, therefore useless for captions.** |

**Cost for a 60 s reel: 1 audio minute × $0.008 = $0.008.** With the D10 job cap at $3.50 and $3.03
already spent, this is 0.2% of the job. Add the row:

```ts
// USD per INPUT audio MINUTE. Estimable pre-flight because we generated the audio and know its
// window count: blocks * clipSeconds / 60. A compute-second-billed model (fal-ai/whisper) cannot be
// reserved and is therefore refused by construction, not by preference.
export const MEDIA_STT_PRICING: Record<string, number> = {
  "fal-ai/elevenlabs/speech-to-text/scribe-v2": 0.008,
};
| { kind: "stt"; model: string; audioMinutes: number }   // third MediaSpec member
```

**One trust-boundary wrinkle the planner must not miss:** every fal STT endpoint takes `audio_url` —
a URL fal must fetch. Our audio lives in `ctx.storage`. Handing fal a `ctx.storage.getUrl()` result
would hand a **bearer capability** to a third party, which `plans.attachmentUrls`' own header comment
forbids. **Upload the bytes to fal's own storage first** (fal's file-upload endpoint returns a
fal-hosted URL) and pass *that*. That is a genuinely new adapter capability — bytes going *out* to
fal, where every other media call sends only JSON. **Budget it as a real task, not a line.**

### 3.3 The hand-off contract — what the sidecar must carry

**Honest limitation:** the Pikar-Ai MCP is client-side only and unreachable from this agent, so I
**could not read `assemble_final.sh` or its sidecar writer directly.** The field names below are the
ones CONTEXT D8 records verbatim (`speech_abs_s`, `lead_silence_s`); the surrounding shape is derived
from what the captions step provably needs, and **must be confirmed against the script when the
runner is written.** Flagging that rather than presenting a reconstruction as a reading.

Captions are timed on the **CLEAN voice takes** (not the mixed bed — the in-assembler Whisper path
was removed on 2026-07-29 precisely because transcribing MIXED audio swallowed words), and are burned
**AFTER** assembly. To place a word from the clean take onto the assembled timeline you need, **per
block**:

| Field | Meaning | Used for |
|---|---|---|
| `block_index` | 0-based block ordinal | Ordering |
| `window_start_s` | `block_index * clip_seconds` — the block's absolute start in `final.mp4` | The base offset |
| **`lead_silence_s`** | Leading silence measured and IGNORED in the take (D8: *"speech-centred, not file-centred"*) | Subtracted from every word timestamp before rebasing |
| **`speech_abs_s`** | The absolute time in `final.mp4` at which this block's SPEECH begins | The rebase anchor |
| `speech_dur_s` | Measured speech duration | The narration-per-window assert |
| `overrun` | boolean — speech exceeded its window | D8's HARD ERROR flag. Must be `false` on every block or the render is invalid. |

**The rebase, in one line:** `absolute_t = speech_abs_s + (word_t_in_clean_take - lead_silence_s)`.

**Top-level sidecar fields the validator must also range-check:** `block_count`, `clip_seconds`,
`total_duration_s`, and the **gate list** (D8: *"block count, per-block speech/freeze metrics, the
gate list"*). Treat **presence of a valid sidecar as the proof-of-governed-render** — that is D8's
own framing and it is exactly the kind of structural guarantee this repo already prefers over a
promise.

### 3.4 Should captions ship in Phase 20? — a reasoned recommendation

**Recommendation: ship them, but as the LAST wave, in their OWN plan, explicitly marked CUTTABLE —
and cut them the moment the assemble plan's live gate slips or the sandbox image needs a second
iteration.**

The case FOR shipping:
- Marginal money cost is **$0.008 STT + ~$0.01 extra sandbox CPU** — noise against a $3.50 cap.
- No new provider, no new secret, no new webhook: it rides the fal adapter that plans 20-05/20-06
  already build.
- With STT moved off-VM (§3.1), it adds **no Python, no model weights, no font fetcher** — one ffmpeg
  pass, one price row, one `.ass` writer.
- Burned captions are the difference between a reel that works on autoplay-muted social feeds and one
  that does not. For the actual product job — social and marketing assets — that is not decoration.

The case FOR deferring, honestly stated:
- It is the **only stage that needs a third provider capability** (STT), with a **third billing unit**
  (per input audio minute), and the **only one that forces bytes OUT to fal** (§3.2) — a new adapter
  direction.
- It **constrains the ffmpeg build** to a `libass`-enabled GPL variant, and adds a font asset to the
  image. Both are small, both are new failure surfaces in the part of the system that is hardest to
  test at $0.
- It is the **only stage whose absence still yields D8's headline deliverable.** Cut captions and you
  still ship one finished mp4 with voiceover. Cut anything else and you do not.
- D8 *already* mandates it be a separate post-assembly step, so **the seam is in the contract.**
  Deferring costs zero rework — the sidecar's `speech_abs_s` / `lead_silence_s` are produced by the
  assembler whether or not anything consumes them yet.

**Decision rule to hand the planner:** captions are the last plan of the last wave. If the phase is
running long, or if the first live sandbox render needs more than one image iteration, cut that plan
and move it to a follow-on. The sidecar contract must ship regardless — it is what makes the cut free.

---

## 4. THE REVISED JOB ECONOMICS

### 4.1 The one table the ADR and the playbook both need

| Line item | Model | Unit | Qty (6-block 60 s reel) | Cost |
|---|---|---|---|---|
| Clips | `fal-ai/wan-25-preview/text-to-video` @ **480p** | $0.05 / video-second | 6 × 10 s | **$3.000** |
| Voice | `fal-ai/inworld-tts` | $0.01 / 1000 chars | ~1,200 chars | **$0.012** |
| Voice retry allowance (§5.1) | same | — | 1× re-reserve | **$0.012** |
| Captions STT | `fal-ai/elevenlabs/speech-to-text/scribe-v2` | $0.008 / input audio minute | 1 min | **$0.008** |
| Render compute | Vercel Sandbox 2 vCPU / 4 GB | flat estimate | 1 render | **$0.020** |
| **Job total** | | | | **$3.052** |
| **`MEDIA_JOB_CAP_USD`** | | | | **$3.500** |
| **Headroom** | | | | **$0.448 (12.8%)** |

**Wan 2.5 rates are now VENDOR-DIRECT and confirmed:** fal's catalog API returns, for both
`fal-ai/wan-25-preview/text-to-video` and `/image-to-video`, the string *"Your request will cost
**$0.05** per second for **480p**, **$0.10** per second for **720p**, **$0.15** per second for
**1080p**."* — with `deprecated: false`, `status: "public"` today. **This upgrades `20-RESEARCH.md`
§1.3 from MEDIUM to HIGH confidence.** No number there changes; the sourcing does. Say so in ADR-012.

### 4.2 The per-shot cents-floor interaction — a NEW money bug the re-scope creates

`chooseModel:134`'s fail-closed bias is `Math.max(1, Math.ceil(usd * 100))` — a **1-cent floor**.
Applied **per line item**, a 6-block reel's voice line becomes `6 × 1¢ = $0.06` against a true
`$0.012` — a **5× over-reservation**. On a 12-line deck with captions it compounds.

**Rule: floor the cents ONCE, on the BATCH TOTAL. Never per line item.**
`estimateBatchUsd` sums in **USD** (fractional), `chooseMediaBatch` floors once. Each `mediaJobs` row
therefore stores its estimate as **USD (or micro-dollars), not floored cents**, and only the batch's
reservation is expressed in cents. This is a direct edit to what `20-RESEARCH.md` §4.2 sketched and
to plan `20-01`'s Task 3. **A unit test must pin it:** a 6-line batch of $0.002 items reserves **1
cent**, not 6.

### 4.3 The storage line nobody costed

| Artifact | Size (60 s 480p) | Keep? |
|---|---|---|
| 6 source clips | ~30 MB | **Delete after a valid sidecar lands** |
| 6 voice takes | ~5 MB (24 kHz mono WAV) | **Delete after a valid sidecar lands** |
| `final.mp4` | ~10 MB | Keep |
| Captioned cut | ~10 MB | Keep (replaces `final.mp4` if captions ship) |
| `assembly.json` | ~4 KB | Keep — it is the proof-of-governed-render |

Without a retention rule: **~55 MB/job × 2 jobs/day = 3.3 GB/month**, against a Convex Free/Starter
allowance of **1 GB total** and $0.033/GB-month beyond.

**Rule (lazy, one mutation):** on a successful render with a valid sidecar, `ctx.storage.delete()` the
intermediate clip and voice storage ids and null the fields on `mediaJobs`. On failure, **keep them**
— they are the debugging evidence, and a failed render is rare. `ponytail:` — *"delete-on-success is
the whole retention policy. No TTL job, no cron. If failed-render debris ever accumulates, the
upgrade path is a scheduled sweep of `mediaJobs` older than N days."*

---

## 5. NEW PITFALLS (extending `20-RESEARCH.md` §10, which still holds in full)

### 13. A voice line that overruns its window is only detected AFTER the clips are paid for — **the new money bug**
**What goes wrong:** D8 says a voice line longer than its 10 s window is a HARD ERROR → rewrite and
regenerate. But the TTS provider returns **no duration** (§1.5), so the overrun is only measurable by
`ffprobe` — which runs in the sandbox, **after $3.00 of clips have already been generated and paid
for.** A single long sentence in block 4 hard-fails a job the user has already been billed for.
**How to avoid — a pure-TS, $0, deterministic pre-flight guard in `packages/core`, next to the
storyboard parser:** English speech runs ~15 characters/second, so a 10-second window holds ~150
characters. **Refuse any block whose narration exceeds `MAX_CHARS_PER_BLOCK = 140` at STORYBOARD
time**, before a cent is spent, with a refusal reason the canvas can render (*"block 4's line is 186
characters — trim it to 140 or fewer, or the render will fail"*). This is the single most valuable
new invariant in the delta: it converts a post-payment hard failure into a free, pre-payment,
testable refusal.
**Also:** reserve the voice line at **2× the character estimate** so one rewrite round is already
paid for. At $0.012 the doubling is free, and the fail-closed direction is over-reserving.
**Warning sign:** any narration length validation that lives downstream of `reserveBatch`.

### 14. `persistent: true` is the SDK DEFAULT — a cross-tenant leak created by an unset option
**What goes wrong:** *"Sandboxes are persistent by default: when a sandbox stops, the SDK snapshots
its filesystem and restores it on the next resume."* Left at the default, tenant A's clips, voice
takes and `final.mp4` survive in the VM image that later renders tenant B's reel.
**How to avoid:** `persistent: false` on **every** `Sandbox.create`, plus **never pass `name`** (a
named sandbox is resumable by name, which is the whole persistence mechanism). Assert it in the
runner's test: the create-options object must contain `persistent: false`.
**Warning sign:** a `Sandbox.create` call with a `name` option, or one that omits `persistent`.

### 15. A TTS model with a `speed` parameter is a live violation of D8's no-time-stretch rule
**What goes wrong:** `fal-ai/kokoro/*` exposes `speed: 0.1–5.0`. The obvious "fix" for an overrunning
line is `speed: 1.15`. D8 forbids it in words, but words do not fail a build.
**How to avoid:** choose a model with **no rate knob** (`fal-ai/inworld-tts` has none — §1.2), and
add the rule to the price-table comment so a future model swap re-reads it.
**Warning sign:** any `speed`, `rate`, `atempo` or `setpts` token anywhere in the media or render diff.

### 16. `deny-all` egress and a per-invocation ffmpeg download are mutually exclusive
**What goes wrong:** the natural first implementation downloads a static ffmpeg tarball at boot. That
requires open egress. Open egress means a compromised or buggy script can exfiltrate tenant clips —
the exact risk `deny-all` exists to remove.
**How to avoid:** bake ffmpeg into a **snapshot** (§2.3) and create with `networkPolicy: "deny-all"`
from the first instant. If the download fallback fires, do the download **first**, then
`sandbox.update({ networkPolicy: "deny-all" })` **before** the first `writeFiles` puts tenant bytes in.
**Warning sign:** a `writeFiles` of tenant content ordered before the policy flip.

### 17. The assemble script as a `skills` registry row = remote code execution
**What goes wrong:** CLAUDE.md §5 says prompts are registry rows, not source. A contributor
generalises that to "the assemble script should be a registry row too." A registry row is mutable by
a DB write; a mutable shell script executed in a VM is RCE.
**How to avoid:** the script is a repo file mirrored to a TS constant (the `skillBodies` five-file
pattern **minus** the `skills.ts` seed entry), with the same byte-identical drift test. One sentence
in the playbook stating that §5 governs prompts and this is code.
**Warning sign:** `assemble` appearing in `skills.ts`'s `seeds` array.

### 18. Hobby-plan sandbox exhaustion is an OUTAGE, not a bill
**What goes wrong:** on Hobby, exceeding the free Sandbox allotment **pauses sandbox creation for 30
days** rather than charging. The render stage silently stops working, mid-month, with no invoice to
notice.
**How to avoid:** verify the plan tier before execution and record it in the playbook. Make the
offline seam the default in every test so no test suite can create a real sandbox. Count renders per
day on the same guardrail rail as spend.
**Warning sign:** any test that reaches `Sandbox.create` without the fixture env set.

### 19. `ffmpeg` stderr contains tenant content
**What goes wrong:** `drawtext`, `subtitles=` and error paths all echo file names and, for caption
burns, narration text. Piping `run.stderr()` into a log or a `deadLetters.payload` puts tenant content
in the log plane — CLAUDE.md §4.
**How to avoid:** map `exitCode` + a matched pattern to a **reasonCode** (`calendar.ts:84`), and never
persist raw stdout/stderr. Add it to the `llmRedaction.test.ts` static scan alongside the existing
media rules.
**Warning sign:** `stderr()` appearing anywhere except inside a `reasonCode()` helper.

---

## 6. Q4 — WHAT THE RE-SCOPE BREAKS IN THE TWELVE PLANS

Read from the twelve `20-*-PLAN.md` files at their committed state. **Honest headline: no plan
survives byte-unchanged. Four survive structurally unchanged (a new `kind` case, no restructure).
Eight need material revision. Five new plans are needed. The wave graph survives; it grows by one
wave and gains four slots.**

### 6.1 Disposition table

| Plan | Wave | Today's scope | Disposition |
|---|---|---|---|
| **20-01** | 1 | `storyboard.ts` + `media.ts` price table + playbook + `watch.json` | **MATERIAL** — §6.2 |
| **20-02** | 1 | `mediaJobs`, `plans.shots`, `guardrailConfig.mediaKillSwitch`, the `dispatchMedia` literal + VERB | **MATERIAL** — §6.3 |
| **20-03** | 2 | `media-director.md` — the ported koda body | **MATERIAL** — §6.4 |
| **20-04** | 2 | the media rail + `reserveBatch` — the ONE money gate | **MATERIAL** — §6.5 |
| **20-05** | 3 | `buildSubmitBody`, `submitShot`, `submitBatch`, the `FAL_FIXTURE` seam | **SMALL** — `buildSubmitBody` becomes a switch over `kind` (`video \| image \| tts \| stt`). The "the body is a function of the spec, and nothing else" truth is unchanged and now covers four kinds. **Plus one genuinely new task:** an outbound **file upload to fal's storage** for the STT `audio_url` (§3.2) — bytes leave Convex for the first time. |
| **20-06** | 4 | `POST /fal/callback/*`, `landResult`, the static scans | **SMALL** — the HMAC route, byte download, verdict enum, refs-only audit and idempotency are all unchanged. Additions: audio/JSON payload shapes; **skip the delta re-price for `kind: "tts"` and `"stt"`** because estimate == actual by construction (§1.5); an audio landing carries `none_reported` (no moderation field). |
| **20-07** | 5 | `ACTION_TYPES += media`, the `externalAction` arm generalised, the calendar regression | **SMALL** — the arm generalisation and the calendar byte-identical regression are unchanged and still the right call. The media arm now schedules a **chain** (clips + voice → wait-for-all → render → captions) rather than one retrier run. That chain belongs in a NEW plan (§6.7 N4); 20-07 only needs its arm to point at the chain's entry action. |
| **20-08** | 6 | `SPECIALIST_ROUTES`, the `dispatchMedia` tool, `runMedia`, `stageMediaPlan`, `persistStoryboard` | **SMALL** — the persisted plan now carries the script and N fixed-length blocks instead of a free-rhythm shot deck. The grant (`searchVault` verbatim), the `diagnose()`-emits-no-media companion and the no-path scan are all unchanged and all still correct. |
| **20-09** | 6 | media read/write plane — `byPlan`, `assetUrls`, `deckEstimate`, `remainingCents`, the editor mutations | **MATERIAL** — §6.6 |
| **20-10** | 7 | `MediaCanvas.tsx` + the `cards.tsx` branch | **MATERIAL** — §6.6 |
| **20-11** | 8 | ADR-012, the `REQUIREMENTS.md`/`ROADMAP.md` corrections, four playbooks, the live gate | **MATERIAL** — §6.8 |
| **20-12** | 9 | the `cockpit-agent` body section — **the ONLY Phase-16-parked plan** | **MATERIAL (content), UNCHANGED (gate)** — §6.9 |

### 6.2 `20-01` — MATERIAL

The plan's own framing (*"this is the money bug's containment"*) is unchanged and still right.

**Add to `packages/cost/src/media.ts`:**
- `MEDIA_TTS_PRICING` (per 1000 characters) + the `{ kind: "tts"; characters }` `MediaSpec` member.
- `MEDIA_STT_PRICING` (per input audio minute) + the `{ kind: "stt"; audioMinutes }` member — *if
  captions ship; otherwise omit the row entirely rather than shipping an unused one (rung 1).*
- `MEDIA_SANDBOX_USD_PER_RENDER = 0.02` — a flat named constant with its `ponytail:` ceiling (§2.5).
- **`MEDIA_JOB_CAP_USD = 3.50` REPLACES `MEDIA_BUDGET_USD_PER_REQUEST = 1.00`**, and
  **`MEDIA_DAILY_BUDGET_CENTS` moves 500 → 1000.** D10 supersedes D4; do not leave the old constants
  as dead aliases.
- **`chooseMediaBatch` floors cents ONCE on the batch total** (§4.2). Per-line estimates stay in USD.
- The comment rule: *"a media line item MUST be priced per submitted input (characters, megapixels,
  video-seconds, audio-minutes). A model billed per generated output duration or per compute second
  cannot be reserved and is therefore refused."* Pin it with a test.

**Change in `packages/core/src/storyboard.ts` — this is a CONTRACT change, not an addition:**
- D8's **fixed-length blocks (N × `clip_seconds`, default 10)** replace koda's free-rhythm 1.5–2 s
  shot deck. The parser now yields **N blocks**, each with `{ index, prompt, narration, seconds }`
  where `seconds ∈ {5, 10}` and is uniform across the deck.
- **`MAX_CHARS_PER_BLOCK = 140` and its refusal** (§5.1 — the highest-value new invariant).
- **`20-RESEARCH.md` Open Question 4 is RESOLVED by D8** and should be closed rather than carried:
  there are no sub-5-second shots any more, so the "image for short shots, video for 5/10 s" split
  disappears. **Keep ONE image price row (`fal-ai/flux/schnell`), drop the second** — the phase goal
  still names images and D7's canvas still shows them, but an unused quality tier is rung 1.

**`docs/playbooks/media.md`** gains: the TTS/STT rows and their billing-unit rule; the per-block
character ceiling; the job-cap arithmetic table from §4.1; the storage retention rule (§4.3).

### 6.3 `20-02` — MATERIAL

- **`mediaJobs.kind`** — a new closed literal union `"video" | "image" | "tts" | "stt"` (the
  `provider: v.literal("fal")` precedent: closed, a fifth member is a deliberate schema edit).
  `mediaJobs.spec` gains the two new members.
- **`mediaJobs.estUsd: v.number()`** replacing/alongside `estCents`, so the batch floor is applied
  once (§4.2).
- **A render plane.** A reel is one artifact per PLAN, not per job. Recommend **fields on the plan
  row** rather than a second table (`plans.attachments` precedent, all optional → zero migration):
  `renderStatus`, `renderStorageId`, `sidecarStorageId`, `sidecarHash`, `renderReason`. **Do NOT add
  a `mediaRenders` table** — one plan produces at most one reel; rung 1.
- **`plans.shots[]` gains `narration: string`** (the block's spoken line) and the deck gains
  `clipSeconds`. Still content-plane, still never audited, still wiped by `resetPlan` — all three
  existing truths hold and now cover more fields.
- The plan's `lane_gate` warning about Lane D holding `schema.ts`/`cards.tsx` is **still live and
  still correct**; re-read the live `agentSteps.tool` union and VERB map at execution.

### 6.4 `20-03` — MATERIAL

The five-file mirror, the UNGATED-at-v1 decision, the MIT attribution and the round-trip test are all
unchanged and all still right. **The BODY changes:**
- **`/script` is ported IN** (D8 moves it into scope because voiceover has nothing to say without it).
  Decide deliberately: one `media-director` body covering script → art-direction → storyboard, or two
  rows. Recommend **one** — it is one conversational turn producing one proposal, and a second row is
  a second version stream to manage (rung 1).
- The body now emits **N fixed-length blocks with a narration line each**, not a free-rhythm shot deck.
- **The `Duration` legalisation changes shape:** every block is the same length, chosen from `{5, 10}`.
- **The 140-character-per-block ceiling must be TAUGHT in the body**, not only enforced in code — the
  model should write to the window, so the code guard is a backstop rather than the primary UX.
- **The body must now promise a finished reel** — which is the exact opposite of what `20-RESEARCH.md`
  §9.2 told it to say (*"Total duration is NOT a generation … the canvas shows shots, not a reel. Say
  so in the body so the model does not promise a finished video."*). **That instruction is REVERSED by
  D8. Delete it; do not leave both.**

### 6.5 `20-04` — MATERIAL

All six `truths` survive verbatim — the transaction, the all-or-nothing insert, the two kill switches,
the per-tenant window. **What changes is what is inside the transaction:**
- `reserveBatch` now estimates **clips + voice takes + (STT) + the flat sandbox constant** as ONE
  number, against **`MEDIA_JOB_CAP_USD = 3.50`**, and reserves against a **1000-cent** window.
  D10 states this plainly: *"it now has strictly more line items, so the TOCTOU argument that killed
  the check-then-record-later shape is stronger, not weaker."*
- It inserts **N video jobs + N tts jobs (+ 1 stt job)** in the same all-or-nothing transaction.
- **The batch cents floor is applied once** (§4.2) — a test must pin that a 13-line batch of sub-cent
  items reserves 1 cent, not 13.
- **The voice line is reserved at 2× the character estimate** (§5.1), with the rationale in a comment.
- `deploymentMediaSpendCents` re-sizes with the per-tenant number (`20-RESEARCH.md` Open Question 2 is
  still open and should be put to the owner with the new figures: 10 tenants × $10/day = $100/day).

### 6.6 `20-09` / `20-10` — MATERIAL: the canvas now shows a REEL plus per-block state

- **A new top-level artifact.** The canvas gains a reel region above (or below) the block strip:
  render status → the finished `<video>` from a **tenant-guarded** `ctx.storage.getUrl` (the
  `plans.attachmentUrls` template, unchanged), and the sidecar's gate summary in words.
- **Per-block state becomes a pipeline, not a status.** Each tile now shows **two** independent job
  states — clip and voice — plus the block's narration line and its character count against the 140
  ceiling. `20-RESEARCH.md` §8.4's finding that *"`PlanCards` assumes ONE artifact per plan"* is now
  doubly true and the resolution is the same: a new component behind the same one-line `plan.kind`
  switch.
- **`deckEstimate` must itemise.** D7's *"never spend without showing the estimate first"* now means
  four lines, not one: *"6 clips $3.00 · voice $0.02 · captions $0.01 · render $0.02 = $3.05. $6.95 of
  today's $10.00 media budget remains."* That is a copy change AND a return-shape change on the query.
- **The editor's four affordances survive** (edit prompt, regenerate one, reorder, delete) and gain a
  fifth free one: **edit a block's narration line**, with live character-count feedback against 140.
  That is not scope creep — it is the UI half of §5.1's guard, and without it the refusal has no cure.
- **A blocked/failed render must be stated in WORDS** (BRAND §6, already a `truth` in 20-10) — and the
  sidecar-invalid case needs its own words: *"the render finished but did not produce a valid
  assembly record, so it was not published."*
- **Regenerating one block now invalidates the reel.** A canvas that shows a stale `final.mp4` beside
  a freshly regenerated block is lying. Add the truth: *"regenerating any block clears the render, and
  the reel region says so."*

### 6.7 NEW PLANS

| New plan | Scope | Wave | Depends on |
|---|---|---|---|
| **N1 — the assemble contract, offline** | `assemble_final.sh` as a repo file + its auto-derived TS constant + the byte-identical drift test (the `skillBodies` mirror **minus** the `skills.ts` seed — §5.5/§2.6); the **`assembly.json` validator in `packages/core`** (pure TS, Convex-free, CLAUDE.md §1) with its range checks and its "invalid sidecar = not a governed render" refusal | **1** (pure, no deps) | — |
| **N2 — the voiceover stage** | the `tts` price row, the `tts` job kind, `buildSubmitBody`'s tts case, `landResult`'s audio case, the 2× retry reserve | **4** | 20-05, 20-06 |
| **N3 — the sandbox runner** | `convex.json` pinning Node 22; `@vercel/sandbox` dependency; the `"use node"` `renderReel` internalAction with `persistent:false` + `deny-all` + snapshot-or-download; the three Vercel secrets with fail-closed `requireEnv`; the return validators (§2.6); the **offline render seam**; the `bake-sandbox-snapshot.mjs` owner script; `docs/playbooks/media.md`'s render section | **5** | N1, 20-06 |
| **N4 — the assemble stage orchestration** | the post-approve chain: reserve → submit clips + voice → **wait-for-all-landed** → `renderReel` → store `final.mp4` + sidecar → **delete intermediates** (§4.3) → mark the plan rendered; the dead-letter path for a failed render | **6** | N3, 20-07 |
| **N5 — captions (CUTTABLE)** | the `stt` price row + fal file-upload for `audio_url` (§3.2); the pure-TS `.ass` writer + the `speech_abs_s`/`lead_silence_s` rebase (§3.3); the `burn_caps_clean.sh` second ffmpeg pass; the font asset | **8** | N4 |

**N1 is deliberately Wave 1 and deliberately pure.** The sidecar validator and the script mirror have
zero Convex dependency, so they can be written and tested before any of the paid machinery exists —
and having the *contract* land first is what makes N3 and N4 testable at $0.

### 6.8 `20-11` — MATERIAL: ADRs, corrections, and the live gate

**Recommend TWO ADRs, not one.** Ponytail favours fewer files, but D8 and D9 are two decisions with
two different alternatives-rejected sections, and ADRs are immutable — a grab-bag ADR cannot be
partially superseded later.

- **ADR-012 — "Phase 20 ships a reel."** The dispatchable route whose product costs money but whose
  specialist cannot spend it (the D2 structural argument, unchanged); the **corrected ADR-011
  arithmetic**, now upgraded to vendor-direct (§4.1); and — new — **the explicit supersession of
  ADR-011's *"Video is ≤15 s. Any longer artifact is assembly or re-cutting, which are different
  features and out of Phase 20's scope."*** The correct replacement statement: *"a CLIP is ≤15 s (and
  Wan 2.5's own ceiling is 10 s); a DELIVERABLE is N clips assembled, and assembly is now in scope."*
  ADR-011 is Accepted and must not be edited (CLAUDE.md §9).
- **ADR-013 — "the render worker."** Vercel Sandbox chosen; Fly/Cloud Run and `ffmpeg.wasm` rejected
  (D9 already wrote both rejections); **the three-secret plane and the `VERCEL_TOKEN` scope
  liability** (§2.2) with the OIDC-via-`apps/web` upgrade path recorded; and the two structural
  invariants — `persistent: false` and `networkPolicy: "deny-all"` — stated as decisions, not as
  implementation details, so a future contributor cannot relax them without a superseding ADR.

**The `REQUIREMENTS.md:139` correction changes.** `20-RESEARCH.md` said the line's "≤3 min" premise
was refuted. **The re-scope partially un-refutes it:** a 12-block reel is 2 minutes and is refused
only by the *cap*, not by the *models*. The honest corrected line is *"video assembled from ≤15 s
clips, capped at 60 s by budget, not by capability."*

**The live gate re-budgets** — it must now prove the whole spine end to end:
1 × 480p 5 s clip ($0.25) + 1 × FLUX schnell image ($0.009) + 1 × TTS take (~$0.002) +
1 × STT minute ($0.008) + **1 × real sandbox render (~$0.02)** ≈ **$0.29**. Still owner-run, still
D5's first reconciliation run, and now it also validates the sandbox snapshot id and the Vercel
credential triple.

### 6.9 `20-12` — MATERIAL content, UNCHANGED gate

The Phase-16 park is unchanged and is still **the only one in Phase 20**. What changes is the
section's content: the `## Creating images and video` twin of `## Researching the outside world` must
now teach that `dispatchMedia` produces **a proposal for a finished reel** — a script, an art
direction, and N blocks — not a shot list. Its three truths hold verbatim; the second one
(*"the agent tells the user the deck does not arrive this turn, and that generating costs money and
needs a separate click"*) is now **more** important, because the thing being proposed takes minutes of
generation plus a render.

### 6.10 Does the wave ordering still hold? YES — 9 waves become 10

```
W1  20-01(rev) · 20-02(rev) · N1(new, pure)
W2  20-03(rev) · 20-04(rev)
W3  20-05(small)
W4  20-06(small) · N2(new)
W5  20-07(small) · N3(new)
W6  20-08(small) · 20-09(rev) · N4(new)
W7  20-10(rev)
W8  N5(new, CUTTABLE)
W9  20-11(rev)
W10 20-12(rev) — PARKED on Phase 16
```

Ordering constraints that force this and that the planner must not relax:
- **N1 before N3.** The sidecar validator is the runner's return contract; writing the runner first
  means writing it against a contract that does not exist yet.
- **N2 after 20-06.** Voice takes land through the same webhook; the route must exist first.
- **N3 after 20-06** for the same reason plus `_storage` read/write, and **before N4**.
- **N4 after 20-07.** The chain hangs off the generalised `externalAction` arm.
- **20-10 after 20-09 and N4.** The canvas cannot render a reel region against a render plane that
  does not exist.
- **N5 last** — because it is the cut line.
- **`20-11` moves to W9** so the ADRs and the live gate close over the render and the captions too.

**The Lane-R narrowing still HOLDS**: only `20-12` touches `cockpit-agent`. **The Lane-D collision on
`schema.ts` / `cards.tsx` (20-02, 20-10) is unchanged and still the sharpest scheduling hazard** — and
20-10's surface is now larger, so the `cards.tsx` window is longer. Re-read `20-02`'s `lane_gate` note
verbatim; it has not aged.

---

## Validation Architecture (delta)

Extends `20-RESEARCH.md`'s Validation Architecture, which stands in full. Same framework
(**vitest ^3.2.7** + **`convex-test` 0.0.54**, `packages/backend/vitest.config.ts`,
`environment: "edge-runtime"`, `// @vitest-environment node` for off-disk reads). Same three-layer
pattern. **Same absolute rule: the whole suite costs $0. No test may call fal, OpenAI, or Vercel.**

### New surfaces → test map

| New surface | Behavior pinned | Layer | Command | Exists? |
|---|---|---|---|---|
| TTS price row | `(chars/1000) × rate`, **no `Math.ceil` on thousands** (contrast images, which round MP up) | 1 — pure | `pnpm --filter @pikar/cost test` | ❌ Wave 0 |
| **Batch cents floor** | a 13-line batch of $0.002 items reserves **1 cent, not 13** (§4.2) | 1 — pure | same | ❌ Wave 0 |
| **§4.1 job economics, as data** | 6×480p+voice+stt+sandbox = $3.05 **PASS**; 6×720p **REFUSED**; 12×480p **REFUSED** | 1 — pure | same | ❌ Wave 0 |
| Billing-unit rule | a spec whose model is priced per output-second is `unknown_model`, **never** a duration guess | 1 — pure | same | ❌ Wave 0 |
| **140-char block ceiling** (§5.1) | a 186-char narration is refused **at storyboard parse**, with a distinct reason code | 1 — pure | `pnpm --filter @pikar/core test -- storyboard` | ❌ Wave 0 |
| **`assembly.json` validator** | every field range-checked; `overrun: true` on any block ⇒ **invalid**; a missing `speech_abs_s` ⇒ **invalid**; an invalid sidecar ⇒ the reel is **not published** | 1 — pure | `pnpm --filter @pikar/core test -- assembly` | ❌ Wave 0 |
| Assemble-script mirror | `.sh` and its derived `.ts` constant are byte-identical (LF-normalised) — the `skillBodies.test.ts` idiom | 1 — pure | `pnpm --filter @pikar/contracts test` *(or wherever the mirror lands)* | ❌ Wave 0 |
| **Script is NOT a registry row** | static scan: no `assemble` entry in `skills.ts`'s `seeds` array (§5.5) | static scan | `pnpm --filter @pikar/backend test -- llmRedaction` | ✅ file exists — add case |
| Reserve covers clips **and** voice | one transaction inserts N video + N tts rows; a refusal inserts **zero** | 2 — convex-test | `pnpm --filter @pikar/backend test -- media` | ❌ Wave 0 |
| Voice 2× retry reserve | the reserved cents exceed the raw character estimate by exactly 2× | 2 — convex-test | same | ❌ Wave 0 |
| `kind:"tts"` skips delta re-price | landing a voice take sets `actualCents === estCents` and moves the window by **0** | 2 — convex-test | same | ❌ Wave 0 |
| **Sandbox create options** | `persistent === false`, `networkPolicy === "deny-all"`, **no `name`**, `timeout < 10 min` (§5.2) | 3 — offline seam | same | ❌ Wave 0 |
| **Nothing forbidden goes IN** | static scan: the runner's `writeFiles`/`env` payloads contain no `FAL_KEY`, no `VERCEL_TOKEN`, no `http`/`url` substring, no `tenantId` | static scan | `pnpm --filter @pikar/backend test -- llmRedaction` | ✅ file exists — add cases |
| Return validation | a fixture returning `null`, an empty buffer, a non-`ftyp` buffer, an oversize buffer, and a malformed sidecar each fail with a **distinct reason code** and publish nothing | 3 — offline seam | `pnpm --filter @pikar/backend test -- media` | ❌ Wave 0 |
| **stderr never persisted** | static scan: `stderr()` appears only inside `reasonCode()` (§5.7) | static scan | `pnpm --filter @pikar/backend test -- llmRedaction` | ✅ file exists — add case |
| Retention | a successful render **deletes** the clip and voice storage ids; a **failed** render keeps them (§4.3) | 2 — convex-test | `pnpm --filter @pikar/backend test -- media` | ❌ Wave 0 |
| Render invalidation | regenerating any block clears `renderStorageId` | 2 — convex-test | same | ❌ Wave 0 |

### How the sandbox runner is tested WITHOUT a real render

**Follow `llm.ts:922-924` (`render=fail::`) exactly — the shipped offline-seam precedent this repo
already runs on**, and leave the same style of `ponytail:` comment naming the seam and its removal
condition.

1. **A `MEDIA_SANDBOX_FIXTURE` env seam in the runner.** When set, `renderReel` skips
   `Sandbox.create` entirely and returns a **fixture pair**: a tiny valid MP4 (a ~2 KB
   `ftyp`-prefixed stub committed as a test asset) and a fixture `assembly.json`. That exercises
   **every line after the sandbox** — return validation, magic-byte check, `ctx.storage.store`,
   `contentHash`, sidecar parse, the audit shape, the retention delete, and the plan patch — at $0
   and in milliseconds. **This seam must be the DEFAULT in tests** so no suite can ever reach
   `Sandbox.create` (§5.6 — on Hobby, an accidental real create burns a shared monthly allotment).
2. **The create-options object is a pure function, asserted directly.** Factor
   `buildSandboxOptions(jobId)` out of the action so `persistent: false`, `networkPolicy:
   "deny-all"`, the absent `name`, the sub-10-minute `timeout` and the resource shape are **plain
   object assertions with no SDK involved.** This is the same move `20-05` makes with
   `buildSubmitBody` — *"the body is a function of the spec, and nothing else."* Reuse the shape.
3. **The fixture set is the failure matrix, not the happy path.** Seven fixtures:
   valid · missing file (`null`) · empty buffer · non-`ftyp` bytes · oversize · malformed sidecar JSON ·
   **valid JSON with `overrun: true` on block 4**. Each must produce a distinct reason code and
   publish nothing. The last one is the important one: it is D8's HARD ERROR arriving from the
   renderer, and it must not be silently swallowed.
4. **A mutation check, the repo's standing discipline:** delete `persistent: false` from
   `buildSandboxOptions` and the option test must go **RED**; restore and green. Same for
   `networkPolicy`.
5. **One real render, once, owner-run, in `20-11`'s live gate** (≈$0.02 of the ≈$0.29 total). That is
   the only place a real `Sandbox.create` is permitted, and the playbook says so.

### How the TTS price row is pinned WITHOUT spending

**The row is data, and data is testable for free** — this is `cost.test.ts`'s entire model, applied
unchanged.

1. **Layer 1 pins the arithmetic**: `1200 chars × $0.01/1000 = $0.012`, and `estimateMediaUsd` for an
   unpriced TTS model returns `err({ code: "unknown_model" })` — the `cost.ts:64` fail-closed rule,
   asserted for the third pricing dimension.
2. **A committed provenance fixture pins the SOURCE, not just the number.** Commit
   `packages/cost/src/media.fixtures.json` holding the vendor strings this research read on
   2026-08-01 — fal's `pricingInfoOverride` for `fal-ai/wan-25-preview/text-to-video` and
   `fal-ai/elevenlabs/speech-to-text/scribe-v2`, and the recorded Kokoro/Inworld per-character rates —
   each with its source URL and read date. A test asserts the price table **agrees with the fixture**.
   This costs $0, and it makes the D5 reconciliation procedure mechanical: **re-fetch
   `https://fal.ai/api/models?keywords=…`, diff against the fixture, and any change is a one-line
   table edit with a visible diff.** That is a strictly better ceiling than the
   *"hand-maintained table, sourced from secondary comparisons"* comment `20-RESEARCH.md` §4.2 wrote
   when fal's pages were 429ing.
3. **The endpoint-health check is free and belongs in the playbook.** The same catalog API returns
   `deprecated`, `removed` and `status` per model. `20-RESEARCH.md` pitfall 10 (*"Wan 2.5 is a
   `-preview` endpoint; preview paths get renamed and retired"*) now has a **detection mechanism**:
   one unauthenticated GET, no key, no cost. Add it to D5's manual reconciliation step as a second
   bullet beside the invoice comparison.
4. **The first real TTS character is spent exactly once**, in `20-11`'s live gate (~$0.002), and that
   observation is recorded against the table as part of D5's first reconciliation run.

### Sampling rate (delta)

- **Per task commit:** `pnpm --filter @pikar/cost test` + `pnpm --filter @pikar/core test` +
  `pnpm --filter @pikar/backend test -- media` (all < 30 s).
- **Per wave merge:** unchanged — `pnpm test` + `pnpm typecheck` (backend delta **exactly 0** against
  the 150-error baseline) + `pnpm --filter @pikar/web build` for any `cards.tsx` wave +
  `node scripts/check-playbooks.mjs` exit 0.
- **New, once per phase, before N3 merges:** a **10-minute connectivity spike** — one throwaway
  `"use node"` action that logs `process.version` and calls `Sandbox.create({ …, timeout: 60_000 })`
  then `stop()`, to prove the Convex Node runtime + `undici@7` + the credential triple actually work
  together. Cost ≈ $0.001. **Do this before writing N3, not after** — it is the one assumption in the
  delta that no amount of documentation reading can settle.
- **Phase gate:** full suite green → `20-11`'s live gate (≈$0.29, owner-run, recorded) → `/gsd:verify-work`.

### Wave 0 gaps (delta — additive to `20-RESEARCH.md`'s list)

- [ ] `packages/core/src/assembly.ts` + `assembly.test.ts` — the sidecar validator and its refusal.
- [ ] `packages/core/src/storyboard.test.ts` — extend with the fixed-block contract and the 140-char ceiling.
- [ ] `packages/cost/src/media.fixtures.json` — the committed vendor-price provenance fixture.
- [ ] `packages/backend/convex/render/assemble_final.sh` + its derived `.ts` mirror + the drift test.
- [ ] `packages/backend/convex/render/fixtures/` — the seven-fixture failure matrix + a ~2 KB stub MP4.
- [ ] `packages/backend/convex/media.test.ts` — **exists after 20-04**; add the runner-options,
      return-validation, retention and render-invalidation cases.
- [ ] `packages/backend/convex/llmRedaction.test.ts` — **exists**; add the four new static scans
      (nothing-forbidden-in, stderr-never-persisted, no-`assemble`-seed, render-audit allow-list).
- [ ] `packages/backend/convex.json` — **does not exist**; create it pinning the Node version.
- [ ] `docs/playbooks/watch.json` — register the new `packages/backend/convex/render/` prefix and
      `packages/core/src/assembly.ts` under `media.md`, or the creation gap blocks the turn.
- [ ] Framework install: **none.** vitest + convex-test are present and pinned. One new runtime
      dependency: `@vercel/sandbox` (pure JS, no native deps).

---

## Open Questions

1. **Which Vercel plan is this project on?** (§2.5)
   - **Known:** Hobby = 45-min max duration, 5 free Active-CPU hours/month, 10 concurrent, and
     **creation PAUSES for 30 days** when the allotment is exhausted. Pro = 24 h, $20/month credit.
   - **Unclear:** which applies here. It does not change the design; it changes the failure mode from
     "a bill" to "a month-long outage."
   - **Recommendation:** confirm before N3 executes and record it in `docs/playbooks/media.md`'s
     dependency section beside `FAL_KEY`.

2. **Does the Convex Node 20/22 runtime actually run `@vercel/sandbox@2.9.2`?** (§2.1)
   - **Known:** Convex Node actions default to Node 20, configurable to 22/24 via `convex.json`;
     `undici@7` needs `^20.18.1 || >=22.10.0`; the package has zero native deps.
   - **Unclear:** the exact Node 20 patch level Convex ships, and whether Convex's bundler handles the
     package's dual CJS/ESM exports cleanly.
   - **Recommendation:** the 10-minute connectivity spike above, **before** writing N3. Pin
     `convex.json` to Node 22 regardless — it costs one file and removes the whole question.

3. **Does the media rail get a keyless deployment ceiling, at what number?** (carried from
   `20-RESEARCH.md` Open Question 2, now with bigger figures)
   - **Known:** 22.1-02's argument was that per-tenant keying leaves exposure unbounded in N. D10
     doubles the per-tenant number to $10/day.
   - **Unclear:** D10 names only the per-tenant figure.
   - **Recommendation:** `deploymentMediaSpendCents` at **10,000 cents ($100/day)**, matching the same
     10× ratio `DEPLOYMENT_BUDGET_CENTS` holds over `DAILY_BUDGET_CENTS` — or record deliberately why
     not. **Do not leave it unstated; that is how a rail fails open.**

4. **Do the Higgsfield sidecar's field names match §3.3?**
   - **Known:** CONTEXT D8 records `speech_abs_s` and `lead_silence_s` verbatim, plus "block count,
     per-block speech/freeze metrics, the gate list."
   - **Unclear:** the exact top-level keys and the gate-list encoding. **The MCP is client-side only
     and was unreachable from this research session — this is a gap I could not close, not a finding.**
   - **Recommendation:** confirm from the script when N1 is written, and let the *validator* be the
     source of truth thereafter. If the names differ, N1's validator is the only file that changes.

5. **Does `fal-ai/inworld-tts` sound good enough for a marketing reel?**
   - **Known:** 70+ English voices, $0.01/1k chars, no rate knob (a D8 feature, §1.2).
   - **Unclear:** subjective voice quality against ElevenLabs.
   - **Recommendation:** generate ONE take in the `20-11` live gate (~$0.002) and listen. If it is not
     good enough, `fal-ai/elevenlabs/tts/turbo-v2.5` is **a price-table row edit**, not a
     re-architecture — which is the whole point of the table pattern.

6. **Should the render be metered per-invocation rather than flat-estimated?** (§2.5)
   - **Known:** `sandbox.usage` exposes cumulative session metrics; Vercel's Usage dashboard reports
     the five billing dimensions.
   - **Unclear:** whether `usage` is granular and timely enough at `stop()` to record real spend.
   - **Recommendation:** ship the flat `MEDIA_SANDBOX_USD_PER_RENDER` constant with its `ponytail:`
     ceiling. **Log the returned `sandbox.usage` numbers (counts only — CLAUDE.md §4) from the first
     ten real renders**, and let that evidence decide whether metering is worth building. Evidence-gated,
     like D5's automated reconciliation.

---

## Sources

### Primary — vendor-direct, machine-readable (HIGH)
- **fal model catalog API** — `GET https://fal.ai/api/models?keywords={wan-25|text-to-speech|scribe|flux}&page=1`,
  unauthenticated, read 2026-08-01. Returns per-model `pricingInfoOverride` (vendor-authored price
  prose), `deprecated`, `removed`, `status`, `hidePricing`. **This is the source for every price in
  §1.1, §3.2 and §4.1, and it independently confirms Wan 2.5's three-tier rate that `20-RESEARCH.md`
  could only reach at MEDIUM confidence.**
- **fal OpenAPI specs** — `GET https://fal.ai/api/openapi/queue/openapi.json?endpoint_id={…}`, read
  2026-08-01 for `fal-ai/inworld-tts`, `fal-ai/kokoro/american-english`, `fal-ai/whisper`,
  `fal-ai/speech-to-text`, `fal-ai/elevenlabs/speech-to-text`,
  `fal-ai/elevenlabs/speech-to-text/scribe-v2`. Every input/output schema quoted above is from these.
- [Vercel Sandbox pricing and limits](https://vercel.com/docs/sandbox/pricing) — `last_updated: 2026-06-16`.
  Rates, plan limits, max durations, concurrency, regions, worked cost examples.
- [Vercel Sandbox JS SDK Reference](https://vercel.com/docs/sandbox/sdk-reference) — `last_updated: 2026-07-07`.
  `Sandbox.create` options (incl. `persistent`, `networkPolicy`, `image`, `resources`),
  `writeFiles` / `readFileToBuffer` / `runCommand` / `mkDir` / `stop` / `extendTimeout`, the two auth methods.
- [Working with Sandbox](https://vercel.com/docs/sandbox/working-with-sandbox) — `last_updated: 2026-06-30`.
  Persistent-by-default semantics, file APIs, snapshots.
- [How to install system packages in Vercel Sandbox](https://vercel.com/kb/guide/how-to-install-system-packages-in-vercel-sandbox) —
  Amazon Linux 2023 + `dnf` + `sudo: true`; *"packages you install don't persist between sessions."*
- [Vercel Sandbox can now run for up to 24 hours](https://vercel.com/changelog/vercel-sandbox-can-now-run-for-up-to-24-hours)
- npm registry metadata for `@vercel/sandbox@2.9.2` — dependency list (zero native), 1.4 MB unpacked.
- GitHub API — `vercel/sandbox` `examples/install-packages/install-packages.ts` (the `dnf` + `writeFiles` + `runCommand` shape);
  `BtbN/FFmpeg-Builds` latest release asset sizes (`linux64-gpl`, ~125 MB `.tar.xz`).
- [Convex runtimes](https://docs.convex.dev/functions/runtimes) — Node 20 default, 22/24 via `convex.json`.
- [Convex limits](https://docs.convex.dev/production/state/limits) — **Node.js actions 10 min**,
  Convex-runtime actions 30 min, Node action args 5 MiB, storage allowances.

### Primary — repo and local skill (HIGH; read from source this session)
`.planning/phases/20-media-canvas/{20-CONTEXT.md, 20-RESEARCH.md, 20-01..20-12-PLAN.md}`;
`docs/decisions/011-media-provider-fal-wan25.md`; `CLAUDE.md`; `.planning/config.json`;
`packages/backend/package.json`; root `package.json`;
`~/.claude/plugins/cache/claude-plugins-official/vercel/0.45.1/skills/vercel-sandbox/{SKILL.md,upstream/SKILL.md}`
(read as D9 requires — **it is a browser-automation skill and contains nothing about ffmpeg**; what it
contributed is the credential-resolution helper shape, the `withX` create/finally-stop wrapper, and
the snapshot-for-fast-startup pattern).

### Secondary (MEDIUM — cross-checks only; no claim above rests on these alone)
- [all fal.ai models and their prices (gist, azer)](https://gist.github.com/azer/6e8ffa228cb5d6f5807cd4d895b191a4) —
  a structured dump with `pricePerThousandCharacters` / `pricePerMegapixel` / `pricePerAudioSecond` /
  **`pricePerComputeSecond`** keys. **Created May 2025 — 15 months stale, so amounts are NOT relied
  on.** Used only to corroborate the *billing-unit shapes*, in particular that `fal-ai/whisper` is
  compute-second-billed while `fal-ai/speech-to-text` is audio-second-billed.
- [10 Best Text-to-Speech APIs in 2026 | fal](https://fal.ai/learn/tools/best-text-to-speech-apis) and
  [Kokoro TTS | fal](https://fal.ai/models/fal-ai/kokoro/american-english) — Kokoro at $0.02/1k chars
  (fal's own 2026 content, but not in the machine-readable field).
- [Best Text-to-Speech Providers 2026](https://futureagi.com/blog/best-text-to-speech-providers-2026/),
  [Best Text to Speech APIs (Deepgram)](https://deepgram.com/learn/best-text-to-speech-apis-2026),
  [ElevenLabs vs OpenAI TTS vs Cartesia 2026](https://www.pkgpulse.com/guides/elevenlabs-vs-openai-tts-vs-cartesia-text-to-speech-2026) —
  the §1.4 non-fal comparison rates.
- [How to Install FFmpeg on Amazon Linux](https://builder.aws.com/content/2rLsGgmLh36ajFAxX1p2esS8zPP/how-to-install-ffmpeg-on-amazon-linux)
  and [How to Install FFMPEG on AWS Amazon Linux 2023](https://arthurpello.medium.com/how-to-install-ffmpeg-on-aws-arm-amazon-linux-2023-graviton-c4bc092260bf) —
  ffmpeg is absent from AL2023's `dnf` repos; static build is the standard remedy.

### Tertiary (LOW — flagged, not relied on)
- **The 60–150 s render wall-clock (§2.4) is a MODELLED estimate, not a measurement.** It is built
  from x264 480p throughput on 2 vCPU, a two-pass `loudnorm`, and per-block ffprobe passes. The
  *conclusion* (18–45× headroom against a 45-minute floor) is robust to being wrong by 5×; the
  individual numbers are not. **Measure it in `20-11`'s live gate and correct the playbook.**
- **`awk`'s presence in the Vercel Sandbox base image** — expected (AL2023 ships `gawk`), not
  verified. One `command -v awk ffmpeg ffprobe` in the snapshot bake settles it; `dnf install -y gawk`
  is the fallback and *is* in the repos.
- **The `assembly.json` field set beyond `speech_abs_s` / `lead_silence_s`** — reconstructed from what
  the captions rebase provably needs. **The MCP was unreachable from this session; I could not read
  the script.** Confirm at N1.
- **Whether `sandbox.readFileToBuffer` counts as billable egress.** Costed pessimistically as egress
  above ($0.0015 of a $0.010 render), so being wrong makes the estimate *safer*, not worse.

---

## Metadata

**Confidence breakdown:**
- **TTS provider, price and schema: HIGH** — fal's own catalog API and OpenAPI specs, read directly.
- **Job-cap arithmetic (§4.1): HIGH** — every input is vendor-direct; the conclusion (13% headroom)
  survives a 10× error in the TTS line.
- **Vercel Sandbox mechanics, limits and rates: HIGH** — vendor docs dated within the last 60 days.
- **Render wall-clock: LOW as a number, HIGH as a verdict** — see Tertiary. The 45-minute ceiling is
  not close.
- **Sandbox compute cost: MEDIUM-HIGH** — arithmetic from published rates, cross-checked against
  Vercel's own worked example.
- **STT choice and captions economics: HIGH** — vendor-direct price and vendor-direct output schema
  showing word-level timestamps.
- **Trust-boundary controls (`deny-all`, `persistent:false`): HIGH** — both documented, and Vercel
  documents `deny-all` for this exact scenario.
- **Sidecar field contract: LOW** — could not read the source script; stated as a gap, not a finding.
- **Plan delta: HIGH** — read from the twelve committed plan files.
- **`VERCEL_TOKEN` scope liability: MEDIUM-HIGH** — the auth mechanism is documented; the precise
  capability set of a team-scoped Vercel access token is inferred from Vercel's token model.

**Research date:** 2026-08-01
**Valid until:** **2026-08-15** for fal rates and endpoint ids (a `-preview` endpoint and a
promotional tier can both move inside a month — and the catalog API now makes re-checking a single
free GET). **30 days** for Vercel Sandbox limits and pricing. **Until Phase 20 executes** for the
plan delta.
