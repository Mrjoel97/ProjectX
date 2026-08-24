<!--
Repo snapshot of the "Pikar Consistency Audit" (rev 4, 2026-08-21), originally published as a
claude.ai Artifact: https://claude.ai/code/artifact/d39704cc-8f11-4cc0-aa0a-0371e4172542
Converted HTML -> Markdown on 2026-08-24 so the audit survives independent of claude.ai.
Its findings drove Phase 25.1 (.planning/phases/25.1-consistency-and-reliability-hardening/);
25.1-RESEARCH.md remains the file:line ground truth for every claim. Tables below lost their
header rows in conversion; the row order is unchanged.
-->

Pikar AI · System audit · rev 4 · 2026-08-21 · branch closure/phases-14-25

# Pikar Consistency Audit

Where the application actually stands, why it feels inconsistent, which of the owner's concerns the roadmap already covers, and the gaps that need new plans — traced through the code, the phase plans, and the milestone audit. Rev 2 added three owner reports, each verified against source: batch content creation, media that never reaches the vault, and the Approve button. Rev 3 added the governed fan-out design (owner-approved) and recorded Phase 25.1 in execution. Rev 4 captures G13 — the Goal Engine, the missing orient-and-propose layer — verified against source and documented in `.planning/design/goal-engine.md`.

  The thesis

## Inconsistency is one defect class, not many bugs

Every concern raised traces back to the same root pattern: **work that fails silently, with no terminal state, no watchdog, and no surface the user can see**. The video assembler exists and works — but six different failure points on the way to it leave the plan stuck at "assembling" forever with no error, no retry button, and no record. A research specialist that dies mid-run leaves its card in `collecting` forever, invisibly. The vault had this exact disease, got a daily sweep cron, and was cured; media, dispatch, and captions never got theirs.

The rev-2 verifications strengthen the thesis rather than complicate it. The "broken" Approve button is wired correctly — but success makes the card vanish with no confirmation and refusals whisper from the bottom of an unchanged card, so both outcomes look like nothing happened; and the deployment the owner tests on is missing the five commits that fixed the storyboard parser's coin-flip refusals. "Disappearing" images were never saved anywhere the user can return to. Consistency, here, is mostly the absence of honest terminal states and visible feedback — which is why a small reliability phase buys more trust than any new feature.

1 · Reel / video compilation Partial

The full ffmpeg assembler + caption burn exists and is planned (MEDIA-01). The inconsistency comes from unplanned reliability gaps: silent stalls, no retrier, no sweep.

2 · True-form document canvas Not planned

No requirement, phase, or ADR anywhere covers rendering PDF / DOCX / PPTX / XLSX in their true form. Only text extraction exists. This is a genuine roadmap gap.

3 · Long-running & multi-agent Split

Durable infra is installed but never pointed at agent work (90-second turn ceiling). Parallel agent swarms are explicitly refused by the requirements — for defensible reasons.

4 · Research quality Partial

Depth and per-claim citations were specified and shipped in the skill. But the model only ever sees search snippets, sources never reach the card, and the card renders raw markdown.

5 · One-click workflows Planned

Phases 27–30 productize exactly this (packs, connectors, routines, verticals) — 61 plans authored, zero executed, all gated behind Phase 25's beta closure.

6 · Batch content creation Not planned

One plan = one deliverable, enforced at four independent code layers. No content calendar, no publish-later, no quantity picker exists anywhere — scheduling is email-only.

7 · Vault saves & Approve button Verified defects

Images are never saved to the vault — no code path exists. Reels only vault if captions complete. Approve gives no visible success, and for image plans it structurally cannot work.

8 · Fresh-eyes findings New

Dead letters nobody re-drives, an env readiness manifest that misses the render URL, ADR drift on the media provider, and production 51 commits behind with open signup.

  Section 01

## Where the system stands today

Measure | State |

Phases | 33 of 53 complete · active lane is **Phase 25** (private-beta productionization, 14 plans unchecked) · there is no Phase 34 |

Plans | 291 of 412 complete (71%) — counts carried forward unverified because Phase 20.2 has no per-plan summaries |

Requirements | 19 of 33 satisfied · 2 partial · 12 unsatisfied (incl. MEDIA-01, ACTN-02, ACTN-04, SKILL-02, GOVN-02, BETA-01/02/03/05) |

End-to-end flows | 5 of 10 complete · the media flow (brief → storyboard → real render → decoded frames → activated skill) is one of the broken five |

Production | **www.pikar-ai.com runs with signup fully open on a metered key, 51 commits behind main, no owner row** — a knowing decision (ADR-020), but it compounds daily. The five storyboard-parser fixes that ended the `no_deck` coin flip all sit inside those missing 51 commits, which is why media approvals still misbehave on the deployment the owner tests. |

The milestone audit prescribes a closure order (17-10 → 17-11, then 17.1-10 → 18-10 → 18-09, re-cut 23-06…09, the independent owner gates for 15.3 / 20 / 20.1 / 20.2 / 24, then Phase 25's release gates). Everything proposed below is sequenced to respect that lane, not fight it.

  Section 02 · Concern 1

## The reel that never arrives

What you experience: the agent plans a reel, you approve, and the finished video never appears — sometimes it works, sometimes nothing.

What the code says: the compiler is real and complete. `assemble_final.sh` (504 lines) concatenates scenes, mixes every voice take at its absolute offset, applies broadcast loudness normalization, enforces a duration gate and a full-decode gate, burns captions in a second pass, and emits a machine-readable governance sidecar. The provider is now OpenAI Sora (`sora-2`), not fal.ai/Wan — ADR-011 is superseded in code but not in the decisions folder. **The failure is never in the assembler; it is in reaching it.** Six distinct failure points, in descending order of likelihood:

F1 — The silent permanent stall (primary cause)

When the render trigger fires, `renderReel` first asks `batchToRender` to build the batch. If that refuses — stale inputs after a deck edit, a duration mismatch, a missing asset — the action returns before any status is written (`renderReel.ts:759-761`). No `failed` status, no dead letter, no audit line. The canvas says "assembling" forever, and the retry button refuses because retry requires `failed`. The trigger and the batch-builder check different conditions despite a comment asserting they cannot disagree.

F2 — The render action has no safety net

`renderReel` is scheduled bare — no retrier, no completion callback — while its sibling `submitBatch` gets both. Any throw after "rendering" is stamped (upload-URL failure, a non-JSON response, a storage read) is swallowed by the scheduler, leaving the plan stuck with no terminal.

F3 — Polling chains can sever, and nothing sweeps

Sora polling is a self-perpetuating chain of scheduled actions (max 30 minutes). One throw before the next hop is scheduled severs the chain; the job stays `submitted` forever, which blocks the render trigger forever. There are four cron jobs in the system and none reconciles stuck media jobs or stuck renders — the vault got exactly this sweep after exactly this failure mode.

F4 — Environment names invisible to readiness checks

`MEDIA_RENDER_URL` (and the sandbox snapshot ID) escape the env manifest because they are read through a helper the drift test cannot see. Unset, they kill every render — while readiness reports green. Meanwhile `FAL_WEBHOOK_SECRET` is listed as critical but is dead code: nothing calls the fal webhook route anymore.

F5 — Two approve surfaces, two meanings

Approving on `/dashboard/approvals` reserves budget and starts generation. "Approving" in the workspace canvas does nothing — it requires a separate Generate click. A user who believes they approved may have spent nothing and will wait for a video that was never started.

F6 — Captions can strand the vault save

If caption transcription dies mid-flight (also a bare scheduled action), `captionStatus` sits at `transcribing` forever: the reel publishes but is never saved to the vault and intermediates are never cleaned up. Rev 2 established this is worse than it first looked — see Concern 7: because captions are pinned on for every reel, the caption terminal is in practice the only vault save.

Planned? Assembly itself: yes — ADR-012/013, Phases 20 / 20.2 / 33, with MEDIA-01's live render gate (plans 20-11, 20-12) still open. Notably, the Phase 33 owner gate verdict on record covered storyboard creation and viewing only — no assembled reel has ever been adjudicated by you. **The reliability defects F1–F6 are planned nowhere.**

Recommended move: a small, surgical reliability plan — write a `failed` terminal with a reason on every `batchToRender` refusal; run `renderReel` under the action retrier with a completion callback like its sibling; add one media watchdog cron (stuck `submitted` / `rendering` / `transcribing` / `collecting` rows older than N minutes → terminal + notification); complete the env manifest; unify the two approve surfaces' semantics. Each is a short diff; together they remove the entire "sometimes nothing happens" experience.

  Section 03 · Concern 2

## Documents in their true form

What you experience: the live canvas can't show a PDF as a PDF, a deck as a deck, or a spreadsheet as a grid.

What the code says: the "canvas" today is media-only — it literally answers "No image or reel in this thread yet" for any document. What the system can produce and what it can display:

Format | Can generate? | Can display? |

Markdown | Yes — the artifact of record | Home-grown renderer (headings, lists, tables, bold — no links, images, or code) |

PDF | Yes — `pdf-lib`, deterministic, Helvetica-only | Only in a vault modal via the browser's iframe viewer — never inline in the canvas or cards |

HTML | Yes — governed self-contained renderer (Phase 18) | Sandboxed iframe preview exists for agent-authored HTML |

DOCX / PPTX | No path exists | Flattened to plain text only; preview says "no inline preview, download the original" |

XLSX / sheets | No path — **but the SheetJS writer is already installed and paid for** in the vault package | Tab-separated text dump in a `<pre>` — no grid |

Reel MP4 | Yes — sandbox ffmpeg | Yes — canvas hero video |

Planned? **No.** Nothing in the requirements, roadmap, ADRs, or todos covers true-form viewing or Office-format generation. The planning docs explicitly treat extraction as lossy-on-purpose, and the stack research explicitly rejected a LibreOffice conversion sidecar (for generation, not viewing).

Recommended move — a new "Document Canvas" phase, in three cheap-first steps:

    - **PDF inline now:** the signed-URL + iframe mechanism already works in the vault modal; give the canvas and the output card a document branch that uses it. Mostly plumbing, no new dependencies.

    - **Spreadsheets as grids:** SheetJS already parses workbooks for extraction; render actual rows/columns in a table component instead of a text dump — and the same installed library unlocks generating real .xlsx deliverables.

    - **DOCX/PPTX honestly:** true in-browser Office rendering is heavy; the pragmatic route is generating a PDF twin at creation time (the pipeline already renders markdown→PDF) and viewing uploaded Office files through their extracted text plus original download — an explicit fidelity decision to record in an ADR either way.

  Section 04 · Concern 3

## Long-running work and the single-agent ceiling

What you experience: only one agent works at a time, and long multi-step tasks don't survive.

What the code says: both observations are architecturally true, and deliberate:

Ceiling | Value | Consequence |

Executive turn | 8 steps, 45s hard abort, ×2 attempts ≈ 90s max | On timeout the entire turn's work is discarded — a canned apology, no resume |

Research specialist | 12 steps, 180s, ×2 ≈ 6 min max | Background, one-shot, unretried; a crash leaves the card in `collecting` forever with no watchdog |

Fan-out | Depth 1, one specialist per thread | "No agents spawning agents" is enforced in the requirements text, a static test, and a unique plan-row constraint |

Durability | Zero for agent work | The Workflow component (retries, crash-safety, 7-day waits) is installed and battle-tested — for email delivery and vault ingest only. It has never been pointed at an agent. |

Planned? Durability as a product requirement: no — the word "long-running" appears nowhere in the requirements. Multi-agent swarms: **explicitly refused** ("no nested loops, no agents-spawning-agents"; the anti-features research calls a swarm "over-engineering for a solo user's workloads"). That refusal protects real things — auditability, cost governance, the compliance moat — and I would not reverse it.

**The reframe:** what you actually need is not a swarm. It is three narrower things the current architecture can absorb without breaking its governance model: **(1) durable specialist runs** — move specialist dispatch from bare fire-and-forget scheduling into the Workflow component so a run survives restarts, retries, and can legitimately take 30+ minutes across multiple steps; **(2) parallel threads, not parallel agents** — the one-at-a-time feel comes chiefly from the per-thread plan row plus the frontend's busy flag; letting three threads each run their own specialist concurrently is already nearly legal and gives you the "several agents working" experience within the depth-1 rule; **(3) a running-tasks surface** — a visible tray of everything in flight with states and timestamps, which converts silent background work into trusted background work.

### The governed fan-out design (rev 3, owner-approved)

The owner asked for complex tasks to be worked by several sub-agents in parallel — each dispatched with instructions for its part of the plan, each in its own isolated instance to avoid misalignment, with the executive synthesizing their results into one document. This is the **orchestrator–worker pattern**, and it is not the thing the requirements banned: depth never exceeds 1, no agent spawns an agent (the executive dispatches several), and handoffs stay one-way with explicit payloads — the exact alternative the project's own research endorsed over swarms. The constraint it does break — fan-out of one, from the "one plan row per thread" rule — is an implementation choice, not a governance principle.

**Design commitments:**

**1 · Decomposition goes through the approval gate.** The plan card shows the sub-task breakdown — "dispatch research on X, finance analysis on Y, offer review on Z, estimated cost $N" — and that breakdown is what the user approves. Fan-out never bypasses the governed-approval model; the existing per-tree budget envelope (25% of the remaining daily rail) already caps the whole tree.

**2 · Built on the Workflow component, never bare scheduling.** One specialist dying today leaves one invisible stuck card; five parallel bare-scheduled specialists would mean five chances per task. The fan-out runs as a durable workflow — decompose → N parallel retried specialist steps → join → synthesis → land — crash-safe on the component that is already installed and battle-tested for delivery and ingest.

**3 · Isolation in, provenance out.** Each worker keeps today's clean-context dispatch (skill body + explicit brief, no shared history) — the owner's misalignment instinct, already satisfied structurally. The real misalignment risk is the synthesis step: the provenance-laundering defect class has shipped three times in this codebase, so the synthesized document must keep per-section provenance — which specialist produced what, from what evidence — never one anonymous blended voice.

**4 · Bounded shape.** Fixed fan-out ceiling (~5 workers), depth structurally capped at 1 (specialists still cannot dispatch), lineage recorded per DISP-01. Every run stays a shallow, auditable tree.

**5 · One schema ADR serves two phases.** Fan-out needs one plan with many sub-briefs; the batch content phase (G10) needs one plan with many deliverables. Both break the same "one plan row per thread" constraint — the parent/child plan-row (or sub-items) schema decision is made once, in one ADR, shared by both.

  Section 05 · Concern 4

## Research that convinces

What you experience: shallow, unconvincing output, no references, and literal `#` and `**` characters on screen.

What the code says — three separate defects stacked on one feature:

R1 — The specialist never reads a page

Research is Tavily search at `basic` depth, five snippets (~1.4k chars each) per query. There is no full-page fetch, no follow-up read, no re-ranking — the entire evidence base for any claim is search-result snippets, synthesized by `gpt-4o-mini`. The skill's own six-behaviour spec (decompose, three angles, cross-check, contradictions, per-claim citations, insufficient-evidence) is genuinely good — the model simply has thin material to apply it to. That is the depth ceiling you are feeling.

R2 — Sources are captured, then withheld from you

Source URLs are structurally captured and written into the stored vault document ("Sources:" list, retrieval dates) — but they are deliberately not threaded onto the memo card you actually read. The card shows only the model's prose.

R3 — The card renders raw text while a renderer sits two components away

The memo card prints `plan.body` inside a plain pre-wrap paragraph (`cards.tsx:560-573`), so every `#`, `**`, and `-` shows verbatim. Chat bubbles and document cards already use the in-house `MarkdownDocument` renderer. The fix is not stripping markdown from the model — it is rendering it: keep markdown as the source of truth and give the memo card (and the approvals preview) the renderer everything else uses.

Planned? Depth and citations were an explicit owner requirement ("sophisticated and highly reliable… do not ship a one-shot search") and Phase 16 closed green against its spec. Page-content fetching, card-visible sources, and typeset report rendering were never in any plan. Phase 29's KNOW-01 (cited cross-source search) is adjacent but unstarted.

Recommended move: three sized fixes — **small:** render the memo card with `MarkdownDocument`; **small:** thread `sources` through to the card as a real references block with titles, URLs, and retrieval dates; **medium:** upgrade the evidence base (Tavily `advanced` depth plus its extract/raw-content API, or a fetch-and-read step for the top sources) and consider a stronger model pin for the synthesis step. A structured typeset "research report" artifact can then ride Phase 18's existing governed HTML path rather than a new renderer.

  Section 06 · Concern 5

## Seven capabilities, packaged as workflows

What you asked: the seven things the agent says it can do should be one-click, outcome-producing workflows users can run anytime.

Planned? Yes — this is the best-covered concern. Phases 27–30 are precisely this: a curated knowledge-work pack pilot with a `WorkflowPackQuickStarts` surface (27), connector-backed revenue workflows over HubSpot/QuickBooks/Stripe/PayPal (28), user-customizable routines with recurrence (29), and vertical packs (30). Sixty-one plans authored, **zero executed**, all gated behind Phase 25's beta closure. Mapping your seven:

Agent's stated capability | Underlying capability | Packaged workflow |

Business evaluation | Shipped Phase 12 | Phase 27 "Business Pulse" — not started |

Financial management | Shipped finance tools | Phase 26 Cost/Cash pages — 8/20 plans; the Cash page plan doesn't exist yet |

CRM & follow-ups | Shipped Phases 19/19.1 | Phase 28 connector packs — not started |

Documents & proposals | Partial ACTN-04 open (18-09/18-10 parked) | Rides Phase 18 closure |

Research | Partial see Concern 4 | Phase 29 KNOW-01 — not started |

Content creation | Partial content-drafter shipped; media gated | Phase 27 "Campaign Plan"; the /brief /concept /publish /repurpose /trends prompts remain an open todo |

Email management | Shipped Phases 3.x | Never packaged as a named workflow |

Recommended move: don't reinvent — the plans exist. Two adjustments are worth making: first, a thin version of the Phase 27 quick-start surface over the already-shipped capabilities (evaluation, email briefing, CRM follow-up, document draft) could be pulled ahead of the full pack machinery, because those four need no new capability work to become one-click. Second, workflows only deserve the "anytime without any problem" promise after the reliability phase lands — a one-click workflow that silently stalls is worse than no button.

  Section 07 · Concern 6 (rev 2)

## Batches of content, not one reel per chat

What you asked: one plan should be able to produce multiple reels or images — the user picks a quantity (2, 3, 5, 10), the agent produces the batch, and the pieces can be scheduled across the week. Today that means opening a new window per image, which is the opposite of a marketing workflow.

What the code says: one plan = one deliverable is enforced at four independent layers, and none of them is accidental:

    - **One plan row per thread** — `plans.by_thread` is read with `.unique()` at 15 call sites, and the staging code says it in words: "A user who wants a second reel starts a new chat" (`plans.ts:212-215`).

    - **Single-valued plan columns** — one `mediaMode`, one `imagePrompt`, one `shots` deck, one `renderStorageId`, one `reelVaultDocId`. The schema comment is explicit: "a job produces at most one asset" (`schema.ts:753-758`).

    - **Staging refusals** — `reel_in_flight`, `render_in_flight`, `image_proposal_pending`, `dispatch_in_flight`: every one means "one at a time in this thread."

    - **The pipeline itself** — the render trigger, the once-only `pending → rendering` guard, and the vault upsert all key off single fields on the plan row.

Important nuance: batching within one deliverable already works and is well-built — a reel reserves N video clips + N voice takes + captions + render in one governed transaction, priced as a whole batch. The machinery for "reserve and price N things atomically" exists; what's missing is the notion of N deliverables.

B1 — A plan can never produce a second image, ever

`generateImage` refuses `already_started` if any media job row for the plan is queued, submitted, or succeeded — and nothing in the backend ever deletes `mediaJobs` rows. A plan that has produced one successful image is permanently done, even after a reset. This turns "make me another one" into a silent dead end.

B2 — No content scheduling exists at all

Zero hits for any content-calendar, publish-later, or scheduled-post concept across the entire backend and web app. The only scheduling primitive is `plans.sendAt`, and it is reachable only from the email arm of `executePlan` — the Schedule button literally renders only for email plans. "Produce five reels and schedule them across the week" has no second half to land on.

Planned? **No.** Phase 27's "Campaign Plan" pack plans a campaign document, not batch media production; nothing anywhere covers quantity selection, multi-deliverable plans, or content scheduling.

Recommended move — a new "Content Batches & Scheduling" phase:

    - **Batch plan shape:** widen the plan's media plane from single-valued fields to a `deliverables[]` array — each item carrying its own deck/prompt, status, render fields, and vault doc id — or, more conservatively, a `batchId` that groups N plan rows staged together. Either way this is a real schema migration and the core design decision of the phase (worth an ADR).

    - **Quantity through governance, not around it:** the quantity picker (2–10) prices the whole batch through the existing reservation and budget rails — one approval, one visible total cost, per-item generation. The rails already price multi-line batches; this extends them one level up.

    - **Per-item terminals:** each deliverable succeeds or fails independently — one bad clip must not silently sink the other nine (which is why this phase must land after the reliability phase: batching multiplies today's silent-failure surface tenfold).

    - **The content queue:** a simple schedule surface — each finished deliverable gets a date/slot, generalizing `sendAt` beyond email (or a new `publishAt`). Even before any social-platform connector exists, "produced, approved, scheduled for Tuesday" with a reminder is the workflow the user described; auto-publishing connectors can arrive later (Phase 32 territory, gated on the legal entity).

    - **Fix B1 outright** in the reliability phase — it's a one-guard change and shouldn't wait for the batch schema.

  Section 08 · Concern 7 (rev 2)

## Vanishing media and the Approve button

What you reported: generated images and videos don't get saved to the knowledge vault and just disappear; and the Approve button on the approvals page doesn't work. Both verified against source — here is exactly what happens.

### Why media disappears

V1 — Images are never saved to the vault. No code path exists.

Generated image bytes land in raw storage on the media-job row and nowhere else. Every vault write in the backend was enumerated: blueprint, evaluations, onboarding, research, voice, reels — **none for images**. The only surface that can ever show an image is that one thread's canvas. The moment a new media request recycles the thread's plan row, the canvas stops routing to the image view — **the image becomes unreachable from the UI while its bytes still sit in storage**. That is the literal "just disappears."

V2 — Reels are only vaulted if captions complete

Captions are pinned on for every reel, and the render terminal skips the vault save whenever captions are coming — so in practice **the caption-burn terminal is the only save**. If transcription strands (a bare scheduled action with no retry and no sweep), the reel is published on the canvas but never written to the vault. No cron ever re-attempts the save.

V3 — A second reel overwrites the first one's vault entry

Recycling a plan clears its render fields but **not** `reelVaultDocId`. The vault save is an upsert keyed on that field, so reel #2 repoints reel #1's vault document — title, transcript, video bytes — and the orphan cleanup then deletes the old mp4. The first reel is gone, as a side effect of a field the reset forgot.

### Why Approve "doesn't work"

The button is wired correctly, always fires, and always produces an outcome. Four things make it read as dead — three of them design, one structural:

A1 — Success looks like nothing

On success the plan leaves the "proposed" state, the awaiting list drops it, and **the card unmounts before the success message can render** — a code comment acknowledges the message is "consumed by a component this very transition unmounts." No toast, no confirmation. A card vanishing without a word is indistinguishable from a broken button.

A2 — Refusals whisper from the bottom of the card

On refusal, a small status line is appended below the buttons and the discard controls; the card otherwise doesn't change. For a media plan the most likely refusal is `no_deck` ("This media plan has no generation-ready deck") — accurate, but easy to never see.

A3 — For image plans, Approve is structurally incapable of working

The approvals page lists image plans with an "Approve governed generation" button, but `executePlan`'s media arm has no image branch — it looks for a scene deck, finds none, and returns `no_deck` **every single time**. Images are only actually generatable from the workspace canvas. This button can never succeed and should either gain an image arm or not render.

A4 — The deployment you test is missing the fixes

The five commits that fixed the storyboard parser's coin-flip `no_deck` refusals all sit within the last ~8 commits on main. Production is ~51 commits behind — **every one of those fixes is absent from www.pikar-ai.com**. On the deployment where the owner tests, media approvals still fail exactly the way the fixed defect used to. (Also noted: the only browser test of the Approve click asserts the refusal path; nothing tests what a user sees after success.)

Planned? None of V1–V3 or A1–A4 appears in any plan. The production staleness closes only through the audit's Group C gates and Phase 25's promotion pipeline — and per the standing decision, any production deploy is an owner call made explicitly each time.

Recommended move — all of this folds into the Consistency & Reliability phase: save images to the vault at generation success (a `kind: "image"` vault doc with prompt + stored bytes, mirroring the reel pattern); save reels at the render terminal and re-point after caption burn instead of gating the only save on captions; clear `reelVaultDocId` on plan reset; give Approve a persistent outcome — a toast or a "started" card state that survives the unmount, and move refusal notices to the top; either implement the image arm of `executePlan` or stop rendering Approve for image plans; add a media gallery surface (the vault, once media actually lands there, is the natural home). Separately: schedule the production redeploy decision — the parser fixes being absent from prod is the single cheapest consistency win available, and it costs zero new code.

  Section 09 · Concern 8

## What else the fresh-eyes pass found

    - **Dead letters are write-only.** Failed work is recorded with `status: "new"` and nothing ever consumes, re-drives, or displays it. A DLQ nobody reads is a diary, not a queue.

    - **ADR drift:** the media provider is Sora in code while ADR-011/012 still document fal.ai/Wan; the fal webhook route and its "critical" secret are dead code. Worth one superseding ADR and a deletion.

    - **The markdown fidelity ceiling** (no links, images, or code blocks) will start to hurt the moment research reports render properly — links especially, since references are the point.

    - **"One plan per thread" is never explained to the user.** The governance choice is sound; the UI refusing a second reel without saying "start a new chat for that" reads as a bug, not a rule. (The batch phase in Concern 6 is the real fix; honest refusal copy is the interim one.)

    - **Production posture is the biggest non-code risk:** open signup on a metered key, 51 commits behind, tenant erasure not reaching the admission tables. The audit's Group C owner gates — not new features — are what close this.

    - **The pasted improvement plan has already begun:** `.editorconfig` and `Skills/docs/architecture.md` sit untracked in the working tree — items 4a and 5 of that plan, started but uncommitted. On its open questions, my recommendations: **Q1** — rename directly, no re-export shim (the shim is permanent indirection to save one mechanical typecheck-guided pass); **Q2** — four sequential commits, each gated green; **Q3** — fill the version audit table during that phase, not before. The whole plan is sound engineering hygiene, but note it moves none of the user-facing concerns above — sequence it before the next phase that has to edit `llm.ts` heavily, not before the reliability work.

  Section 10 · rev 4

## G13 — The Goal Engine (Chief-of-Staff loop)

The idea (owner's): a goal-driven "brain" that autonomously drives the system toward the user's desired outcomes — sensing the business, holding a model of its goals, and proactively proposing governed plans. For the idea-stage user, it progressively grows a thin profile into a working business system through conversation instead of demanding data up front.

Verified: as a unified concept this exists in **no document** — "goal engine", "goal-driven", and "north star" have zero hits across the entire planning corpus. But the building blocks are real and mostly shipped: the evaluation engine's ranked gap list (a ready-made agenda), the weekly proactive-review cron (the product's only unprompted act), a user-authored `goals` table whose top three entries already reach the model on every turn, per-field provenance guards (ADR-021), and Phase 27's queued outcome-measurement philosophy. What no layer does today: hold an agenda across threads, propose without being asked, or close the loop from an executed plan back to a goal.

The frame: a closed loop — **sense** (vault, evaluations, connectors) → **orient** (persistent goal/agenda model) → **propose** (plans through the existing approval gate) → **act** (the workflow ecosystem) → **measure** (Phase 27's refs/counts layer) → **learn**. Two convictions hold firm: **the brain proposes, the user approves — autonomy is earned per workflow (suggest → schedule → auto-execute within a pre-approved grant, never the absence of review)**; and **self-filled data is always a cited proposal the user confirms, never a silent write** (the provenance-laundering defect class shipped three times; the guards exist and the design defers to them).

Its other half — the Business Ledger (living dossier): the brain has nowhere to put what it learns today (gaps are thread-scoped and last-write-wins, goals sit in a table the agent may not write, research lands as flat markdown). The ledger is where orientation persists: business-shaped living documents the system maintains as the business evolves. Two invariants make it safe rather than dangerous. **A living document is a rendered view over provenance-tagged claims, never a free-text file the agent edits** — otherwise the agent writes "our CAC is $47," next month's evaluation reads it as ground truth, and the system has promoted its own guess into a fact it will reason from forever. **The raw source is never replaced by the structured version** — extraction here is lossy on purpose, so a structured view that becomes the only copy destroys evidence silently. The taxonomy comes free from the evaluation framework's own gates (Market → Offer → Money → Leads → Scale) rather than being invented, the blueprint already proves the render-from-claims pattern, and auto-filing is staged suggest-at-ingest — never an overnight reorganization of someone's files. For the idea-stage user this closes the loop: empty sections are gaps, gaps become questions, answers become provenance-tagged claims, and the foundational documents materialize as a byproduct of the interview instead of a demand made up front.

Constraints found and respected: the living-map spec bars an agent goal-write tool; ADR-004 requires standing commitments to be grants checked inside human-gated mutations, never tools; ROUT-02 keeps recurrence fail-closed until its six governance questions are decided; "fully autonomous mode" is a named non-goal twice over. The design in `.planning/design/goal-engine.md` carries the full loop mapping, a v0/v1/v2 build sketch (v0 — "the agenda speaks" — is propose-only and needs only 25.1), the three ADRs it will require, and the prerequisite chain.

## The gap register

# | Gap | Planned today? | Proposed vehicle | Size |

G1 | Silent terminal-less failure states (render stall, severed polls, stuck collecting, stranded captions) + no watchdog cron + bare scheduling of `renderReel`/dispatch | No | **New phase: Consistency & Reliability** — highest leverage in the whole register | Small diffs, ~1 phase |

G2 | Running-tasks surface (visible in-flight work with states, retry, and failure reasons) | No | Same reliability phase, UI half | Medium |

G3 | Memo card markdown rendering + sources/references block on research cards | No | Two small plans; can ride any phase | Small |

G4 | Research evidence depth (page reading / extract API, model pin review) | No (KNOW-01 adjacent, unstarted) | **New phase: Research v3**, or fold into Phase 29 | Medium |

G5 | True-form document canvas: inline PDF, spreadsheet grids, Office strategy + generation of .xlsx (writer already installed) | No — nowhere | **New phase: Document Canvas** + one ADR for the Office fidelity decision | Medium |

G6 | Durable specialist runs on the Workflow component + parallel threads + lifting the 90s/6min ceilings + **governed fan-out** (executive dispatches up to ~5 isolated workers in parallel, decomposition approved on the plan card, provenance-preserving synthesis — see the rev-3 design in Concern 3) | No (durability infra shipped, unused for agents; fan-out design owner-approved rev 3) | **New phase: Durable Agent Runs & Governed Fan-Out** — respects the no-swarm rule; shares the plan-row schema ADR with G10 | Medium-large |

G7 | Seven capabilities as one-click workflows | **Yes** — Phases 27–30, 0/61 plans | Execute as planned after 25; optionally pull a thin quick-start surface ahead for already-shipped capabilities | Planned |

G8 | Media live gate (real Sora render adjudicated by the owner, skill activation) | **Yes** — MEDIA-01 open items (20-11, 20-12) | Existing audit closure lane | Planned |

G9 | DLQ consumer/ops view · env manifest completion · ADR-011 supersession · dead fal code removal | No | Fold into the reliability phase | Small |

G10 | Batch content creation: multi-deliverable plans (quantity 2–10, per-item terminals, batch pricing through the existing rails) + a content queue with per-item scheduling (generalize `sendAt` beyond email) | No — one-plan-one-deliverable enforced at four layers; no scheduling concept exists | **New phase: Content Batches & Scheduling** + schema ADR (`deliverables[]` vs batch-grouped rows) | Large |

G11 | Media persistence: image vault save (none exists), reel save decoupled from captions, `reelVaultDocId` cleared on reset, second-image guard (B1), media gallery surface | No | Fold into the reliability phase (V1–V3, B1); gallery may ride the Document Canvas phase | Small-medium |

G12 | Approvals feedback: persistent success outcome, prominent refusals, an honest image arm (implement or remove the button) — plus the production redeploy of the `no_deck` fix cluster | No | Reliability phase (UI + arm); redeploy is an explicit owner decision per the standing deploy gate | Small |

G13 | **The Goal Engine + Business Ledger** — persistent orient-and-propose layer: cross-thread gap agenda with lifecycle, unprompted governed proposals via the existing approval gate, progressive gap-driven interview for thin profiles, goal↔plan↔outcome linkage, earned autonomy tiers — plus the ledger where orientation persists: living documents rendered from provenance-tagged claims, raw sources never replaced, filing suggested at ingest rather than migrated (see the rev-4 section above) | No — zero hits in any document; building blocks shipped in pieces; design captured in `.planning/design/goal-engine.md` | **Future capstone phase(s)**: v0 propose-only after 25.1; v1 after Phase 27's measurement layer; v2 after Phase 29's ROUT-02 decisions + an autonomy-tier ADR | Large (staged) |

### Suggested sequence

Respecting the audit's existing closure order and the Phase 25 gate:

    - **Consistency & Reliability phase (G1, G2, G3, G9, G11, G12) — DONE PLANNING, IN EXECUTION as Phase 25.1** (inserted 2026-08-21): seven plans in seven waves, plan-checker verified first-pass, covering all fourteen verified defects; wave 7 is the owner's live end-to-end reel adjudication. The production redeploy decision rides alongside it as the zero-code consistency win.

    - **Continue the audit closure lane as prescribed** — 17-10/17-11, 17.1, 18, the owner gates for 20/20.1/20.2 (which closes G8 and gives you your first adjudicated end-to-end reel), 23, 24, then Phase 25's release gates.

    - **Document Canvas phase (G5)** and **Research v3 (G4)** — the two user-visible capability upgrades, in either order.

    - **Content Batches & Scheduling (G10)** and **Durable Agent Runs & Governed Fan-Out (G6)** — the two substrate expansions, now linked: both break the "one plan row per thread" constraint, so the parent/child plan-row schema ADR is written once and shared. Both must follow the reliability phase (multiplying parallel work multiplies the silent-failure surface it cures), and batches ideally follow the media owner gate so the thing being batched is itself proven.

    - **Phases 27–30 (G7)** — the productized workflows, on the substrate that now deserves them: a weekly content batch is exactly what the "Campaign Plan" pack should hand off to.

    - **The Goal Engine (G13)** — the capstone the queue has been building toward: 25.1 gives it honest terminals, G6 gives it durable hands, 27–30 give it verbs, 27's measurement layer gives it eyes on outcomes. Its propose-only v0 can be pulled forward any time after 25.1 on the owner's call.

  Compiled 2026-08-21 (rev 4 — adds G13 the Goal Engine, verified by a dedicated nine-point investigation) from seven parallel code-and-planning investigations on branch `closure/phases-14-25` · sources: packages/backend/convex (llm.ts, dispatch.ts, media.ts, mediaComplete.ts, render/, cockpit.ts, plans.ts, research.ts, approvals.ts), apps/web workspace + approvals surfaces, .planning/ (ROADMAP, STATE, REQUIREMENTS, MILESTONE-AUDIT, GAP-LEDGER), docs/decisions/ · plus the owner's capability transcript, improvement-plan draft, and rev-2 defect reports.
