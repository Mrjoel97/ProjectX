# Phase 20: Media Canvas - Context

**Gathered:** 2026-08-01
**Status:** RE-SCOPED 2026-08-01 — see D8/D9/D10. Ready for re-planning.
**Source:** Owner decisions taken at `/gsd:plan-phase 20`, on top of the discharged spike
(`20-SPIKE.md`), the provider evaluation (`20-PROVIDER-EVAL.md`) and ADR-011.

> ## ⚠ RE-SCOPE 2026-08-01 (owner, explicit, after the first 12 plans were committed)
>
> **Phase 20 now ships a FINISHED REEL, not a set of assets.** The owner was shown the trade-offs
> — a render worker outside Convex, a new ADR superseding ADR-011's ≤15 s line, re-derived caps,
> and re-derivation of the batch-reserve / refs-only-audit / webhook-sole-writer invariants — and
> chose the production spine anyway.
>
> **This supersedes, in this document:** the `/assemble` OUT rows in D6, the D4 cap numbers, and
> the "Out of scope" video-length line in the Phase Boundary. Those are struck through below rather
> than deleted, so the next reader sees what changed and why. **D1, D2, D3, D7 are UNCHANGED.**
>
> The 12 plans committed at `4010e10` are **not discarded**. Their generation half — price table,
> batch-reserve mutation, fal adapter, HMAC webhook, `media` route, canvas — survives, because a
> reel is still built from N generated clips that each need pricing, capping and safe landing.
> What changes is the output contract, the cap arithmetic, and four stages appended after
> generation. **Revise, do not restart.**

<domain>
## Phase Boundary

Phase 20 delivers **image and short-form video generation as async, governed, separately-capped
jobs**, reached through the dispatch spine as a new `media` specialist route, and SEEN in a media
canvas that the specialist spins up in the workspace.

**In scope:**
- A new `media` entry in `SPECIALIST_ROUTES` (`packages/core/src/specialists.ts:23-28`) with its
  own ADR, skill registry row, `stepTool` literal and capability-grant review.
- The koda-stack **media** stages ported as registry skill bodies: art-direction → storyboard →
  generate (D6).
- A **media canvas in the workspace right pane** showing the storyboard, the generated images and
  videos, and a simple per-shot editor (D7).
- A media price table in code, modelled on `packages/cost`, failing closed on unknown model.
- A separate named rate-limiter window + its own kill-switch, never folded into the token budget.
- A fal.ai adapter action (`FAL_KEY` deployment secret) submitting to fal's queue with a
  `webhook_url`, and an **authenticated** callback route on `convex/http.ts`.
- Tenant-scoped asset refs, refs-only audit, and a media isolation assertion.
- A documented price-table reconciliation step + a `ponytail:` ceiling comment.

**Out of scope (explicitly):**
- Video longer than **15 seconds**. This is a MODEL ceiling across 28 models from eight labs, not
  a provider limitation (ADR-011). Multi-minute output exists only by ASSEMBLY (concatenating
  clips) or by re-cutting existing footage — both are different features.
- **koda's `/assemble` stage** (reel from shots + voiceover). It is the natural finale of the koda
  pipeline and will be tempting; ADR-011 rules it out of this phase. See Deferred.
- Any OAuth / refresh-token machinery. `gmailAuth.ts`'s token store, rotation and crown-jewel
  handling are NOT copied. An API key in a deployment secret is the whole auth story.
- The Pikar-Ai MCP. It is a claude.ai **client-side** account connector, absent from `.mcp.json`
  and structurally unreachable from a Convex action. There is no backend token-exchange to build.

</domain>

<decisions>
## Implementation Decisions

### D1 — Surface: a new `media` specialist route (LOCKED, owner, 2026-08-01)

Media is reached by DISPATCH, not by a standalone page and not by a cockpit tool. This is the
heaviest of the three options considered and was chosen deliberately for future agent-orchestrated
media.

Consequences the planner must carry:
- `"media"` is added to `SPECIALIST_ROUTES`. That file's own comments (lines 10-22) make widening
  the dispatchable set **ADR territory** (see ADR-009, ADR-010). **A new ADR is required** and is
  part of this phase's deliverable, not a follow-up.
- A new `SpecialistSpec.stepTool` literal (`"dispatchMedia"`) joins the closed union at
  `specialists.ts:39-43`; `agentSteps.tool` and the `cards.tsx` VERB entry must accept it
  together (the Phase 18-02 precedent — schema literal and its trace label ship in one plan).
- New versioned `skills` registry rows carry the media specialist bodies (CLAUDE.md §5 — no
  hardcoded prompts).
- The `SPECIALIST_TOOLS` capability grant is reviewed, not silently widened (see D2).

### D2 — The media specialist PROPOSES and OPENS THE CANVAS; it never GENERATES (LOCKED)

`specialists.ts:46-57` states the grant is `searchVault` **only**, because "every write stays
behind the ONE human Approve gate", and it records `evaluateBusiness` as *deliberately refused*
for persisting rows and re-entering the engine mid-dispatch.

A media tool that called fal.ai from inside a dispatch would be strictly worse than the thing that
comment already rejects: it spends **real dollars** with no human in the loop, and it would falsify
roadmap SC #3 ("an agent or injected content cannot fire generation without human approval").

Therefore the split is:

| Stage | Who acts | Cost | Gate |
|---|---|---|---|
| art-direction → storyboard | media specialist, read-only | tokens only (existing LLM rail) | none needed — no external effect |
| canvas spin-up | media specialist emits the canvas + shot list | none | none — it is a *view* |
| **generate** | **the human**, from the canvas or by approving the plan | **fal.ai dollars** | **media budget rail + Approve** |
| regenerate one shot | **the human**, in-canvas | fal.ai dollars | media budget rail (human-initiated by construction) |

- The media specialist stays **read-only**. It emits prose plus a structured storyboard proposal
  and spins up the canvas to show it — nothing more.
- The fal adapter fires from the **post-`approved`** execution path and from **explicit human
  clicks inside the canvas**. Both are human-initiated; neither is reachable from a dispatched
  specialist.
- "Plan-gated by construction" is satisfied **structurally** — there is no code path from a
  dispatched specialist to a paid generation.
- Do NOT "fix" this by adding a generate tool to `SPECIALIST_TOOLS`.

### D6 — Adopt the koda-stack MEDIA workflow (LOCKED, owner, 2026-08-01)

Source: `timkoda/koda-stack` (MIT), a 10-stage prompt-only content pipeline. Already researched in
this repo on 2026-07-16 — see `.planning/todos/pending/2026-07-16-port-koda-stack-content-prompts-
into-skills-registry.md`. **That todo explicitly SKIPPED the media stages as "heavy"; this decision
reverses that for the media stages only.** Update the todo rather than leaving it contradictory.

**Corroboration worth recording:** koda's `/generate` stage already targets **fal.ai** — the same
provider ADR-011 selected independently on a price-per-clip argument. Two unrelated lines of
reasoning converging is evidence for the ADR, not a coincidence to smooth over.

Stage disposition — the planner must not silently widen this:

| koda stage | Phase 20 disposition |
|---|---|
| `/art-direction` — palette, mood, lighting | **PORT** → registry skill body. Prose only, no API cost. |
| `/storyboard` — every shot with timing + descriptions | **PORT** → registry skill body. Produces the structured shot list that becomes the plan AND the canvas contents. |
| `/generate` — images via fal.ai | **PORT the prompt shape**, but the CALL is ours: our adapter, our price table, our budget rail, our webhook. Do not adopt their invocation. |
| `/assemble` — reel from shots + voiceover | **OUT** — ADR-011. See Deferred. |
| `/trends` | **OUT** — needs live trend data. |
| `/brief`, `/concept`, `/script`, `/publish`, `/repurpose` | **OUT of Phase 20** — content stages, not media. Phase 18's `content-drafter` covers documents/HTML and does NOT claim these; they stay with the pending todo for a later content phase. |

Porting rules (from the 2026-07-16 todo, still binding):
- **MIT — keep an attribution note in each ported skill body's header.**
- **Do NOT clone the repo into the codebase** (CLAUDE.md §5: prompts live in the registry, no
  second ungoverned prompt plane). Port the prompt *text* into registry rows.
- Follow the `documentDrafter` / `content-drafter` mirror pattern: markdown body in
  `packages/contracts/skills/`, constant in `@pikar/contracts/skill`, entry in the `seedSkills`
  array in `packages/backend/convex/skills.ts`.
- **Gated vs ungated is a planning decision.** Phase 18-03 landed `content-drafter` deliberately
  UNGATED so it shipped at v1 with no eval and no paid run. Weigh that precedent explicitly; a
  gated media skill inherits the Lane-R contention described under Sequencing.

**"Creative DNA" needs no new storage.** koda keeps Voice / Visual style / Audience / Rules in a
`CLAUDE.md` file. This repo already has all of it: `packages/core/src/businessProfile.ts` +
`tenantProfile.ts` (per-tenant voice, audience, tier) and `docs/design/BRAND.md` (palette,
typography, visual rules, real screenshots). The art-direction skill reads those. **Do not add a
brand-profile table or a creative-DNA document type** — that is ponytail rung 2, reuse what is here.

### D7 — The canvas lives in the WORKSPACE right pane (LOCKED, owner, 2026-08-01)

Not a new route, not a new NAV entry. `apps/web/app/(app)/dashboard/workspace/page.tsx:209-360`
already renders `<SplitPane left={chat} right={workspace} />` (chat ~30% / workspace ~70%,
`SplitPane.tsx`). The media canvas is a surface in that **right pane**, spun up when the media
specialist runs — the same way the workspace already swaps its right-hand content.

Canvas contents:
- The art direction (palette / mood / lighting) as a compact header.
- The storyboard: one tile per shot, in order, with its timing and description.
- Each tile shows its generated image or video once the job lands, and its live job status before
  then (SC #2 — never a synchronous hang; a 15 s clip takes minutes of wall-clock).
- Assets render from tenant-scoped refs, never from a URL held in audit (CLAUDE.md §4).

**"Simple editor" — the floor, and the ceiling.** Ponytail §8 applies: this is a canvas, not a
video editor. In scope: edit a shot's prompt text, regenerate that one shot, reorder shots, delete
a shot. Out of scope unless explicitly asked for: timeline scrubbing, transitions, filters, layers,
masking, audio, or any client-side rendering. Every regenerate is a **paid** action and re-enters
the budget rail — the editor must not offer a control that can spend money without showing the
estimate first.

Reuse: `cards.tsx` already owns the workspace card vocabulary (`briefingSheet`, `capsTeal`,
`traceText`, the `plan.kind` switch at :254/:281). A media canvas is another `kind`, not a parallel
rendering system. Follow `docs/design/BRAND.md` and use `globals.css` tokens — never a hardcoded
hex (CLAUDE.md §10). The app has no component library; do not add one.

### D3 — Provider and model (LOCKED by ADR-011)

- Provider **fal.ai**; default model **Wan 2.5** (~$0.05/s). Replicate is the recorded fallback.
- Auth: one `FAL_KEY` Convex deployment secret.
- Async: fal queue + `webhook_url` → `convex/http.ts` (which already hosts the Gmail OAuth callback).
- **Exact per-model rates MUST be re-read from fal's live pricing page when the adapter is
  written.** The figures in ADR-011 are indicative, sourced from third-party comparisons, not from
  the vendor API. This is open work under roadmap SC #1.

### D4 — Budget numbers (LOCKED, owner, 2026-08-01)

| Constant | Value | Rationale |
|---|---|---|
| media per-request cap | **$1.00** | A 15 s Wan 2.5 clip is ~$0.75 → passes with headroom. Veo 3 (~$6.00) and Seedance 1080p (~$10.23) fail closed. |
| media daily cap | **500 cents ($5.00/day)** | Mirrors `DAILY_BUDGET_CENTS` exactly, for symmetry and easy reasoning. ~6 clips/day. |

- Worst-case daily exposure is **$5 media + $5 text = $10**, across two rails that never share a
  window. `budgetUsdPerRequest = 0.05` is NOT reused — it would refuse every clip (ADR-011).
- The daily media window must be **keyed per tenant**, matching the correction Phase 22.1-02 just
  landed on `dailySpendCents`. Do not ship a second keyless deployment-wide window; that is the
  exact defect 22.1-02 existed to close.
- **A storyboard is N shots, so one approval can mean N generations.** The per-request cap alone
  does not bound a storyboard. The planner must decide how a multi-shot storyboard is estimated and
  capped *as a batch* against the daily window, and what the canvas shows the user before they
  commit. This is the sharpest new risk D6 introduces.

### D8 — Scope: the PRODUCTION SPINE (LOCKED, owner, 2026-08-01 re-scope)

The deliverable is ONE finished video file, not a set of assets.

**Stages, in order:**

| # | Stage | Cost | Gate |
|---|---|---|---|
| 1 | `script` | tokens | none (proposal) |
| 2 | `art-direction` | tokens | none (proposal) |
| 3 | `storyboard` → N blocks | tokens | none (proposal) |
| 4 | `generate` — N clips via fal | **fal $** | **batch reserve + Approve** |
| 5 | `voiceover` — one TTS take per block | **TTS $** | same reservation |
| 6 | `assemble` — ffmpeg → ONE mp4 | sandbox compute | post-Approve only |
| 7 | `captions` — burned AFTER assembly | compute | post-Approve only |

**Still OUT** (koda + the roadmap): `/brief`, `/concept`, `/trends`, `/publish`, `/repurpose`.
They follow later, per the 2026-07-16 todo. `/script` moves IN (it was previously left to that todo)
because voiceover has nothing to say without it.

**The reference implementation is the Higgsfield `faceless-channel-video` workflow v2.0**, read from
the Pikar-Ai MCP catalog on 2026-08-01. Its `scripts/assemble_final.sh` (27 KB) is battle-tested
ffmpeg with the failure modes recorded in its own comments. Harvest its CONTRACT — do not clone the
repo (CLAUDE.md §5) and do not depend on the MCP at runtime (it is client-side only and unreachable
from a Convex action; that finding is the whole reason ADR-011 exists).

Contract properties worth inheriting verbatim, because each encodes a real failure:
- **Fixed-length blocks — N × `clip-seconds`, default 10.** This is exactly Wan 2.5's ceiling
  (5 or 10 s), so generation and assembly agree by construction. A clip shorter than its window is
  a HARD ERROR, never a held still frame.
- **No time-stretch, ever.** A voice line longer than its window is a hard error → rewrite and
  regenerate upstream. No `atempo`, no trimming speech.
- **Speech-centred, not file-centred.** Leading/trailing TTS silence is measured and ignored.
- **Narration-per-window assert** before any music bed can mask a silent block.
- **`assembly.json` sidecar** — block count, per-block speech/freeze metrics, the gate list.
  Refs-and-counts only, zero content: it drops into CLAUDE.md §4's audit contract unmodified.
  The script's own words: *"a final video without one was hand-assembled."* Treat presence of a
  valid sidecar as the proof-of-governed-render.
- **Captions are a SEPARATE step run AFTER assembly**, on the clean voice takes plus the sidecar's
  `speech_abs_s` / `lead_silence_s`. Their in-assembler Whisper path was removed on 2026-07-29 for
  transcribing MIXED audio and swallowing words. Do not re-merge these two stages.

### D9 — The renderer: Vercel Sandbox (LOCKED, owner, 2026-08-01)

Convex cannot encode video. `assemble_final.sh` needs `ffmpeg`, `ffprobe` and `awk` — a POSIX shell.

**Chosen: Vercel Sandbox** (ephemeral Firecracker microVMs). Rejected: a persistent Fly/Cloud Run
worker (a whole new deploy target, secret plane and monthly floor — the first infrastructure outside
Vercel + Convex); and `ffmpeg.wasm` in the browser (the tab must stay open for minutes, OOMs on
multi-block 1080p, and — decisively — assembly would run client-side where it cannot be audited and
the sidecar would be self-reported by the browser rather than produced by a trusted runner).

- Zero new vendors, zero always-on cost, and the bundled bash runs near-verbatim.
- A post-Approve Convex action starts the sandbox, streams clips + voice takes in, runs the script,
  and pulls `final.mp4` + `final.mp4.assembly.json` back to `ctx.storage`.
- **The sandbox is a trust boundary.** It receives tenant content. Nothing it returns is trusted
  without validation, and no fal URL or API key is ever passed into it.
- `vercel:vercel-sandbox` is an available skill — read it before writing the runner (ponytail §8).

### D10 — Caps for an assembled job (LOCKED, owner, 2026-08-01 — SUPERSEDES D4's numbers)

| Constant | Value | Rationale |
|---|---|---|
| `MEDIA_JOB_CAP_USD` | **$3.50** | A 60 s / 6-block 480p video is $3.00 of clips, plus TTS. Fits with headroom. |
| `MEDIA_DAILY_CENTS` | **1000 ($10.00/day)** | ~2 full 60 s videos per day. |

At 480p/10 s Wan 2.5 = $0.50 per block: 3 blocks (30 s) = $1.50 PASS · 6 blocks (60 s) = $3.00 PASS ·
12 blocks (2 min) = $6.00 REFUSED · 6 blocks at 720p = $6.00 REFUSED.

- **The whole JOB is the priced and reserved unit** — clips AND voice takes together, in the one
  transactional mutation. This is D4's batch finding, widened: it now has strictly more line items,
  so the TOCTOU argument that killed the check-then-record-later shape is stronger, not weaker.
- **Sandbox compute is a cost line too.** Estimate it, or record deliberately that it is unmetered
  and why. Do not leave it unstated — that is how a rail fails open.
- The per-tenant keying and the `deploymentMediaSpendCents` ceiling from the first planning pass
  both still apply, re-sized to these numbers.

### D5 — Reconciliation (Claude's discretion, per ponytail §8)

Roadmap SC #5 requires a documented reconciliation step, not an automated one. The laziest
solution that works: a documented **manual** procedure in the media playbook (compare recorded
spend against fal's actual invoice/balance) plus a `ponytail:` comment naming the ceiling and the
upgrade path. No cron, no `/ops` panel, no reconciliation table unless evidence demands it.

### Claude's Discretion
- Which fal image model joins the price table alongside Wan 2.5 (pick from fal's live pricing page
  at implementation time; the phase goal names images as well as video).
- Webhook authentication mechanism — signature verification vs a secret path segment. **Match what
  `http.ts` already does for the Gmail callback** rather than inventing a third pattern.
- Table/schema shape for media jobs and assets, and where the isolation assertion lives.
- Whether art-direction and storyboard are two registry rows or one; whether they are gated.
- Plan/wave decomposition.

</decisions>

<specifics>
## Specific Ideas

**Reuse map (from `20-PROVIDER-EVAL.md` §2 — this is assembly, not invention):**

| Need | Existing pattern to reuse |
|---|---|
| Pre-flight per-request cap | `chooseModel` + `budgetUsdPerRequest` (`guardrails.ts` `DEFAULT_CONFIG`) |
| Price table, fail-closed on unknown model | `packages/cost` `estimateCostUsd` / `unknown_model` |
| Separate daily cap | a second **named** rate-limiter window beside `dailySpendCents` (`guardrails.ts:23-28`) — the component already supports named windows |
| Own kill switch | the `guardrailConfig` single-row upsert pattern (`setKillSwitch`) |
| Record actual spend | `recordSpend`'s `reserve: true` semantics |
| Async job + callback | `convex/http.ts` (already hosts the Gmail OAuth callback) |
| Human gate | the `plans.ts` `proposed → approved` lifecycle, reused verbatim |
| Canvas shell | `SplitPane` right pane + `cards.tsx` card vocabulary and `plan.kind` switch |
| Creative DNA | `businessProfile.ts` + `tenantProfile.ts` + `docs/design/BRAND.md` |
| Skill mirror pattern | `content-drafter` (Phase 18-03) / `documentDrafter` five-file mirror |

**Open questions carried from `20-PROVIDER-EVAL.md` §5 — resolve in RESEARCH, not in execution:**
1. **Moderation verdict ref (SC #4).** Confirm whether fal returns a moderation/safety signal. If
   it does not, decide what the audited "verdict ref" honestly is. **Do not invent a verdict.**
2. **Webhook authenticity.** An unverified callback is an unauthenticated write endpoint.
3. **Price-table drift cadence** and where the `ponytail:` ceiling comment lives.
4. Live fal rates (see D3).
5. **NEW (D4):** batch estimation and capping for an N-shot storyboard.
6. **NEW (D8/D10) — the TTS provider and its price.** Voiceover is now a priced line item and there
   is NO decision on it yet. Does fal serve a TTS model whose per-character/per-second USD is
   published, so it joins the same price table? If not, what does? **Do not plan voiceover against
   an unpriced provider** — that reintroduces exactly the credit-denominated opacity ADR-011
   rejected Higgsfield for.
7. **NEW (D9) — Vercel Sandbox mechanics.** Cold-start time, max duration against a multi-block
   render, how bytes get in and out, whether ffmpeg is installable or must be layered, and what the
   compute actually costs. Read the `vercel:vercel-sandbox` skill first.
8. **NEW (D8) — the captions step.** `burn_caps_clean.sh` + `audio_to_captions.py` imply a Python
   runtime and an STT model in the sandbox alongside ffmpeg. Confirm what that pulls in, and whether
   STT is a further priced line item.

**Governance constraints that bind this phase:**
- CLAUDE.md §2 — no raw `query`/`mutation`/`action` imports; use the tenant wrappers.
- CLAUDE.md §4 — audit carries asset id/hash + verdict ref ONLY. Never the asset, never its URL.
  A signed fal URL in an audit row would be both a content leak and a live credential.
- CLAUDE.md §5 — media specialist bodies are registry rows, not source. No cloned prompt plane.
- CLAUDE.md §9 — a new playbook for the media subsystem, registered in
  `docs/playbooks/watch.json`, or the Stop hook blocks the phase.
- CLAUDE.md §10 — `globals.css` tokens, `docs/design/BRAND.md`, no component library.

</specifics>

<deferred>
## Deferred Ideas

- ~~**koda `/assemble` — the reel from shots + voiceover.**~~ **PROMOTED INTO SCOPE by the
  2026-08-01 re-scope — see D8.** Left visible rather than deleted so the reversal is legible.
- **Re-cutting footage the user already has** — still OUT. Phase 20 assembles what it generated;
  it does not ingest and re-cut user footage. That remains a different feature.
- **Music beds and sung tracks.** `assemble_final.sh` supports `--music` (ducked bed) and `--song`
  (kids music-video mode). Neither is in D8's stage list. Ship without them; the flags stay
  available if evidence asks for them.
- **koda content stages** (`/brief`, `/concept`, `/script`, `/publish`, `/repurpose`) and
  `/trends` — stay with the pending 2026-07-16 todo for a later content phase.
- **A premium model default (Veo 3 / Seedance).** Reversible later as a price-table entry behind a
  deliberately raised cap and an explicit owner decision — never as a default (ADR-011).
- **Automated reconciliation** (cron or `/ops` panel). Evidence-gated on the manual step actually
  proving drift. See D5.
- **A real video editor** in the canvas — timeline, transitions, filters, layers, audio. See D7.
- **Agent-orchestrated media chains** — the reason D1 chose the specialist route, but the
  specialist stays proposal-only in this phase (D2).

</deferred>

<sequencing>
## Execution Gate (NOT a planning gate)

D1 + D6 require new versioned `skills` registry rows and touch the gated-skill layer. Per
`.planning/STATE.md`, `cockpit-agent` is a GATED skill with ONE candidate stream that Lane R holds
un-activated at v16, and Phase 18 must edit that same body. Phase 18 → 19 already run SERIAL by
owner decision (2026-07-31).

**Planning proceeds now. Execution serializes behind Phase 16 closing**, exactly as Phase 18 does.
The planner MUST state this gate in the plan frontmatter/notes rather than leaving a lane to
discover it.

**Narrowing opportunity the planner should test explicitly:** if the media skill bodies are NEW
registry rows that never touch the `cockpit-agent` body — and if they follow the 18-03 precedent of
landing UNGATED at v1 — the contention narrows to the dispatch-surface edits alone
(`specialists.ts`, `agentSteps.tool`, `cards.tsx` VERB). That is a much smaller gate, and it may
let Phase 20 run earlier than Phase 18. Say so in the plans if it holds; do not assume it.

</sequencing>

---

*Phase: 20-media-canvas*
*Context gathered: 2026-08-01 via /gsd:plan-phase owner decisions (D1, D4, D6, D7)*
