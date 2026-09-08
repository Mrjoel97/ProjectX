<!--
Repo snapshot of the "Pikar System Audit — rev 5 (merged)", published as a claude.ai Artifact:
https://claude.ai/code/artifact/693f27e1-5ca6-4904-b7d9-d92e4719e262
Merges three records: the Consistency Audit rev 4 (2026-08-21, `consistency-audit-2026-08-21.md`,
gaps G1-G13), the service-architecture design note (2026-08-24,
`service-architecture-post-beta.md`, the owner's "how to move forward" brainstorm), and the
value / usability / scale audit run 2026-09-03 (five parallel code-and-planning investigations on
branch `feat/28.1-billing-mapping`). Every claim below either carries forward a rev-4 claim with
its status re-checked, or cites a file/playbook read on 2026-09-03. No code was changed.
-->

Pikar AI · System audit · rev 5 (merged) · 2026-09-03 · branch feat/28.1-billing-mapping · production = main @ 2026-08-27

# Pikar System Audit — rev 5

## 0. What this revision merges

| Record | Date | Question it answered | Where it lives |
|---|---|---|---|
| Consistency Audit rev 4 | 2026-08-21 | Why does the product feel inconsistent? (G1-G13) | `consistency-audit-2026-08-21.md` |
| Service-architecture note | 2026-08-24 | Should tools / RAG / research / marketing / finance / sales / workspace become services, and in what order? | `service-architecture-post-beta.md` |
| Value, usability and scale audit | 2026-09-03 | Does the system deliver tangible value to a non-technical solopreneur; can it scale; can it run long and recurring work? | this document, artifact above |

## 1. The thesis, updated

Rev 4 found one defect class: **work that fails silently with no terminal state, no watchdog, and no surface the user can see.** Phase 25.1 closed the code half of that (honest terminals, retrier on `renderReel`, a stuck-work sweep, image vault save, approve feedback, memo markdown, DLQ listing). Two things remain from it: the sweep ships **dormant** behind `RELIABILITY_SWEEP_ARMED=1` and covers only media jobs and plan render states (`reliabilitySweep.ts:353`), and the 25.1-07 owner checkpoint is a **partial pass** with five items recorded as un-attested.

Rev 5 finds a second class sitting on top of the first: **value that exists but is dark, invisible, or unreachable.** Six workflow packs live on dev and candidate-v1 on prod. Three owner-approved revenue skills are pinned but not activated. ~600 commits sit unmerged across three lanes while production has not been promoted since 2026-08-27. The only money-in lane (revenue connectors and invoice reminders) is parked. The governance that makes the product trustworthy (audit spine, eval gates, WORM, ISO map) is invisible to the buyer, while the surfaces a solopreneur does see carry about 40 named concepts, an operations tab, raw enums, and a cockpit that does not stack on a phone.

Both classes have the same cure shape: not a new feature, but activation, deletion, and a few constants. The 08-24 note said it in different words: *"Every reliability failure in this repo's memory has been a verification failure with a green suite over it, never an architecture failure."* Rev 5 adds: every **value** failure so far has been a shipping or exposure failure, never a capability failure.

## 2. Where the system stands (rev 4 → rev 5)

| Measure | Rev 4 (2026-08-21) | Rev 5 (2026-09-03) |
|---|---|---|
| Phases complete | 33 of 53 | 36 of 53 (STATE.md), ROADMAP table stale in a dozen rows |
| Plans complete | 291 of 412 (71%) | 353 of 421 (83%) |
| v2.0 requirements | 19 satisfied · 2 partial · 12 unsatisfied | unchanged by audit; milestone audit 2026-08-20 still the last strict count |
| Post-beta requirements (PACK, REVN, BILL, KNOW, ROUT, VERT, MKTG) | 0 of 35 | 0 of 35 — Phase 27 closed with PACK-01..04 still Pending; 28.1 sealed with `requirements-completed: []` |
| Production | 51 commits behind main, open signup | main @ 08-27; this branch +245, Phase 29 lane +203, Phase 34 lane +149; `/signup` now invite-gated in code |
| Validated users | none | none (`PROJECT.md` "Validated: (None yet)") |
| Backend | — | 141k lines · 246 files · 57 tables · `llm.ts` 6,857 lines (was 6,382 on 08-24) |
| Deployment LLM budget | — | $50/day hardcoded (`guardrails.ts:43`) ≈ 50 active users/day |
| Legal entity | not started | **still not started** (reconfirmed 2026-08-22) |
| Hard date | — | **2026-09-24** Sora-2 withdrawal; 33.1-06 merge + ~$2 live spend unexecuted |

## 3. Capability matrix (rev 5, replaces the rev-4 "seven capabilities" table)

Status set: **LIVE** = owner/real-account evidence on a playbook · **CODE** = complete, never proven live · **PARKED** = env-gated, unpaid gate, or dark on prod · **INVISIBLE** = real but not perceivable by the ICP.

| Capability | User outcome | Status | Value type |
|---|---|---|---|
| Chat → governed email (recipients, personalise, PDF attach, schedule, approve, Gmail send) | "Email Jane and Bob about X Thursday with a one-pager" | LIVE | time saved |
| Contacts, follow-ups, consent, unsubscribe, CSV import, Pipeline page | Who owes me a reply; never email an opt-out | LIVE | time saved + compliance |
| Vault upload, extraction (PDF/Office/OCR/audio), cited search; Drive browse | Drop files, the agent cites them | LIVE | clarity, compounding memory |
| Business evaluation, scorecard, Growth OS diagnostic | "What is the one thing costing me money" | LIVE | clarity |
| Documents → Content shelf; Reports; Command Center | "Write me a one-pager"; daily summary | LIVE | time saved |
| Inbox briefing, quick peek, reply in-thread | "Brief me", "reply to Sarah" | CODE | time saved |
| Weekly proactive review | Monday card | CODE | clarity (thin, cannot be conversed with) |
| Google Calendar create / availability / manage | "Book 30 min with Sam" | CODE (17-10/11 never run) | time saved |
| Web research specialist | Cited memo to vault | CODE (sources block landed 25.1-05; evidence still snippets, G4 open) | time saved |
| Offer Architect, Money Model, Lead Engine | Hormozi-style memo cited to own docs | CODE | clarity → money-in only if the user executes |
| Media image + reel (OpenRouter, ffmpeg sandbox) | Promo image or ≤60s video | CODE (one live submit 08-30; no adjudicated finished mp4 line found) | potential money-in; costliest feature |
| Voice live session, dictation, attach-and-dictate | Talk a report through | CODE — OpenAI credit reported exhausted (`production-beta.md:16`), may be dead | clarity |
| Drive folder import | Import a whole folder | CODE — stubbed in every run, $0 spent | — |
| Six workflow packs | One-click knowledge jobs | PARKED on prod (dev active v4-v11, prod candidate v1) | time saved |
| Revenue specialist, call list, lead triage, invoice reminders, cash flow | Who to call, which invoice to chase | PARKED (8 rows `candidate`; 3 owner-approved, not activated) | **money-in — the only such lane** |
| HubSpot / QuickBooks / Stripe / PayPal read connectors | Real deal and book data | PARKED — none has spoken to a provider | — |
| Microsoft calendar / Outlook | Same on Microsoft | PARKED — probe failed, update-only (ADR-023) | — |
| Pikar billing (28.1) | Pay for Pikar | PARKED — never touched Stripe; price placeholder | owner revenue |
| User- and agent-authored skills | Customise the agent | PARKED (unpaid eval) | none the ICP perceives |
| ISO map, WORM export, audit spine, eval gates | Trust posture | INVISIBLE | sells to procurement |

## 4. The gap register, merged

Rev 4 gaps carried forward with their 2026-09-03 status; rev 5 gaps appended. Sizes are unchanged where the gap is unchanged.

| # | Gap | Rev 4 vehicle | Status 2026-09-03 |
|---|---|---|---|
| G1 | Silent terminal-less failures, no watchdog, bare scheduling | Phase 25.1 | **Code closed** (25.1-01/02). Sweep **dormant** (`RELIABILITY_SWEEP_ARMED`), covers media + plan render only; voice ×6, vaultFolders ×6, vaultDigest ×4, vaultDrive, cockpit `runAfter` chains still unswept. Arm it; extend coverage or move chains to `workflow.define`. |
| G2 | Running-tasks surface | 25.1 UI half | **Partial** — agent steps stream (CKPT-05); no cross-thread "in flight" tray. Still open. |
| G3 | Memo markdown + sources block | two small plans | **Closed** (25.1-05). |
| G4 | Research evidence depth (page reading, model pin) | Research v3 / Phase 29 | **Open.** 08-24 note reframes it as a *build* (system-executed fetch + findings store + `observedAt`), not an extraction. Unscheduled. |
| G5 | True-form document canvas (inline PDF, sheet grids, Office strategy, .xlsx generation) | Document Canvas phase + ADR | **Open, unscheduled.** Still no requirement anywhere. |
| G6 | Durable specialist runs + parallel threads + governed fan-out (≤5 workers, depth 1) | New phase; shares plan-row ADR with G10 | **Open.** Rev 5 confirms only 2 of ~15 chains use the Workflow component; turns cap at 45s/180s; 30-min work survives only as `runAfter` links. |
| G7 | Seven capabilities as one-click workflows | Phases 27-30 | **Half-closed.** Phase 27 shipped six packs; live on dev, **dark on prod**. 28 parked; 29/30 unstarted. |
| G8 | Media live gate (adjudicated reel, skill activation) | MEDIA-01 closure | **Partial** — 25.1-07 proved a rendered reel in prod by data; provider now OpenRouter (ADR-027); `media-director` activation status unknown; 33.1-06 unexecuted with a 09-24 deadline. |
| G9 | DLQ view, env manifest, ADR-011 supersession, dead fal code | 25.1 | **Closed** (25.1-06, ADR-024/026/027). DLQ page owner-attestation still un-recorded. |
| G10 | Batch content + content queue (`deliverables[]`, `publishAt`) | New phase + schema ADR | **Open, unscheduled.** One-plan-per-thread still enforced at four layers. |
| G11 | Media persistence (image vault save, reel save, `reelVaultDocId`, second-image guard) | 25.1 | **Closed in code** (25.1-03); owner attestation of D5/D8 un-recorded. |
| G12 | Approvals feedback + image arm + prod redeploy | 25.1 | **Closed in code** (25.1-04); production promoted 08-23 and 08-27, so the `no_deck` fix cluster is live. **Re-opened in a new form:** production is again behind (see G18). |
| G13 | Goal Engine + Business Ledger (orient-and-propose layer) | Capstone; v0 propose-only after 25.1 | **Open, unscheduled.** 25.1 (its only v0 prerequisite) is done. Rev 5 ranks v0 as the single most tangible unbuilt outcome. |
| **G14** | **Concept load and configuration leakage in the tenant UI** — ~40 named concepts in 10 families; Compliance/ops tab in every tenant's rail with DLQ, fallback and kill-switch tiles; raw enums rendered (`cards.tsx:1385` delivery report, `MediaCanvas.tsx:338`, `ApprovalsView.tsx:142`, `connectorRows.ts:141`, `DocGrid.tsx:49`); developer copy on approvals ("tenant", "deployment", "scheduler won the race"); three "Not available" connection rows citing ADR-007; skill authoring and a dead model pill in the composer; 15-item rail | — | **New.** Ten-item delete-first pass, ~1 short phase. Deletion, not design. |
| **G15** | **Mobile cockpit** — `SplitPane` is a fixed `pct% 6px 1fr` grid at every width; chat ≈110px on a phone; rail collapses to 15 unlabelled icons | — | **New.** Chat-only below 48rem with a "Show work" toggle; 4-item bottom bar. |
| **G16** | **Entry path** — home page has "Sign in" and a mailto only; `/signup` disabled until an invite code passes preflight; `/connect-gmail` is a bare heading with no framing of the restricted-scope consent | — | **New.** Decide invite vs open (memory says open is settled; code says invite); add a "Create account" path either way; one sentence before the Google screen. |
| **G17** | **Scale constants** — $50/day deployment LLM cap, $100 media, $250 ingest (`guardrails.ts:42-78`); three unsharded deployment counters (`:80-98`); `runWeekly` collects every `business_profile` with full text in one mutation, `runAfter(0)` herd, no budget gate, bare `catch` (`proactiveReview.ts:41-112`); `flagExpiringTokens` full scan, no dedupe (`gmailAuth.ts:241`); WORM export one 10k page/day (`worm.ts:79`); `retryStuckIngests` / `backfillAuditCounts` cannot run on a real deployment | — | **New.** Four small diffs + arming G1's sweep make 10k users honest; sharding makes 100k feasible; 500k needs status indexes on cron scans, a retention ADR and a seat model. Not a rewrite. |
| **G18** | **Release cadence** — `[deploy]`-prefixed merge is the only promotion; ~600 commits unmerged across three lanes; shipped code is not shipped product | rev 4 named the 51-commit lag | **Re-opened.** Weekly merge-and-promote cadence; 33.1-06 first (deadline 09-24). |
| **G19** | **Dark-on-prod activations** — six packs (candidate v1 on prod), three owner-approved revenue pins, `cockpit-agent` v25/v26 candidates, `media-director` v3 | 08-24 note step 1 | **CLOSED 2026-09-08.** Every gated candidate ahead of active on production has been activated; a re-read of the prod registry now returns none. `cockpit-agent` **v8 → v13** (46/46, `$0.90`) — v8 dated 2026-08-15, so the body teaching `dispatchTeam` and `createVariants` had never been live even though both tools were REACHABLE since 42-03. `pack-business-pulse` and `pack-sales-call-prep` **v1 → v2** (5/5 each). `research-specialist` **v1 → v3** (46/46, `$0.81`). `media-director` was already v6 and the packs already v1/v2 active, so this row's inventory was stale. THE GATE WAS NEVER THE CREDIT: `PIKAR_CONVEX_TARGET=prod` routes the eval runners at production (explicit opt-in, never defaultable), and the pack lane needs a THIRD plane — browser — earned through `capture-prod-session.mjs` because prod's only accounts are Google and no password sign-in exists. Total spend `~$2.9`. Cost: the pilot spec's `@drill rollback` has no restore step and left `pack-business-pulse` DARK on production until it was re-activated (fixed in 44-05). |
| **G20** | **Legal entity** — gates Google OAuth verification (7-day Gmail tokens → the core feature degrades weekly for any beta user), custom domain/TLS, CASA, billing tax country, Meta/LinkedIn | ROADMAP "EXTERNAL BLOCKER" | **Open, no owner date.** Highest-leverage non-code task in the project. |
| **G21** | **Pricing and unit economics** — price is a placeholder ($49/mo, `stripe-dashboard-setup.md` §3); rails are per day not per month ($10/day media, $25/day ingest, 15-min voice unpriced); one shared OpenAI key, no BYOK seam | — | **New.** Decide a price; make media/ingest metered or credit-packed; cap voice per month. |
| **G22 — QuickBooks UNBLOCKED 2026-09-09** | The lane was never waiting on a credential or a decision. `docs/connectors/quickbooks-suitability.md` already recorded `decision: approved_production`, the Intuit app already existed, and the OWNER RUNBOOK'S STEP 2 WAS UNEXECUTABLE: `sealGate` is an `ownerMutation` and `npx convex run` has no user identity, while no UI calls it either — so `providerGates` could not be written on production by ANYONE and was EMPTY. Fixed in 45-01 (`sealGateAsOperator`, sharing one `sealGateFor` body). The gate is now sealed `approved_production`/`parked`, `connectPermitted` is TRUE, and client id/secret/redirect are set on prod. REMAINING and owner-only: the Intuit consent (runbook step 3). | Phase 28 | **Open — one owner action.** |
| **G22 (original row)** | **Money-in lane parked** — invoice reminders, call list, lead triage, cash flow exist as skills; connectors exist as code; all parked by owner choice 08-31 | Phase 28 | **Open.** Unpark ONE connector (Stripe read or QuickBooks) + invoice reminders; it is the only capability whose outcome is a bank deposit. |
| **G23** | **Promise vs proof** — landing page sells "connecting to your tools" and "executes end to end"; actuator set is Gmail + Calendar create; every specialist returns a memo; Command Center speaks "binding constraint" and "blocked work" | — | **New.** Rewrite in outcome language; make the artifact (finished offer + 30-day lead plan) the product for idea-stage users, not a memo about one. |
| **G24** | **In-band fixture sentinels** — `SMOKE::` selectors in production paths (`gmail.ts:263,370`, `graph.ts:59`, `intake.ts:42`, `llm.ts:921,2331,3792,3830,5293`, `blueprint.ts:53`, `evaluations.ts:97`) matched against content a stranger can supply | memory: 6 sites, 3 open | **Open.** Move selection out of band (env or test-only tenant). |
| **G25** | **Recurring routines primitive** — no per-tenant schedule table; only one-shot `runAt` (deferred send) and six static crons; ROUT-02 fail-closed; the deciding ADR is itself unscheduled | ROUT-02 / Phase 29 | **Open by design.** Correct order: OAuth verification (G20) → standing-approval ADR (08-24 §4) → schedule row that re-arms + per-run budget gate + DLQ. Do not build the table first. |
| **G26** | **Planning-corpus drift** — STATE.md carries 36 stacked frontmatter blocks; ROADMAP table stale (rows 1-3.1, 21, 23, 24, 25, no rows for 27/29/30/33/33.1); requirement rows never ticked for shipped phases; three Hormozi PDFs committed under `Skills/` against the design note | milestone audit "tech debt" | **Open.** One repair pass; then a rule: a phase closes only when its requirement rows and its ROADMAP row move in the same commit. |

## 5. Reconciling the 08-24 "how to move forward" order with rev 5

The 08-24 note's order was: (1) top up the key, run pack evals, activate · (2) Phase 25, one real user, one real result in production · (3) workspace identity + membership + roles · (4) tool registry · (5) Phase 21 · (6) research engine · (7) autonomy ADR → legal entity → connectors → marketing loop.

What rev 5 changes and why:

| 08-24 step | Rev 5 verdict |
|---|---|
| 1 · key + activate | **Keep, do first.** Still not done ten days later (G19). Add: merge the three lanes and ship 33.1-06 (G18). |
| 2 · Phase 25, one real user | **Keep, but the user must be able to self-serve.** G14/G15/G16 are prerequisites for "one real result" from anyone but the owner. The delete-first pass is small and precedes beta, not follows it. |
| 3 · workspace identity | **Defer behind first paying user.** It is the right structural move and it gets costlier with every tenant, but it produces no outcome the ICP can perceive. Do it at the first sign of a team customer. |
| 4 · tool registry | **Keep as the next `llm.ts` refactor**, sequenced before the next phase that edits `llm.ts` heavily (rev 4 said the same of the hygiene plan). |
| 5 · Phase 21 | **Done** (SKILL-01 closed 08-18). |
| 6 · research engine (G4) | **Keep, after Goal Engine v0.** A better research engine feeding a system with no initiative is a better memo. |
| 7 · autonomy ADR → entity → connectors → marketing | **Pull the entity out and start it now** (G20). It is a non-code track that runs in parallel with everything above and its lead time is the longest in the project. The autonomy ADR stays where it is. |
| — (not in 08-24) | **Insert Goal Engine v0** (G13) right after activation: propose-only, prerequisite done, the chief-of-staff promise. |
| — (not in 08-24) | **Insert one revenue connector + invoice reminders** (G22) and **a price** (G21) before Phases 29/30. |
| — (not in 08-24) | **Insert the four scale constants** (G17) before the beta opens; they are hours of work and the beta invites exactly the load that trips them. |

### The merged order

**Track 0 — non-code, start today:** the legal entity (G20). Pricing decision (G21). Invite-vs-open decision (G16).

**Track A — this month, no new features:**
1. Restore OpenAI credit; confirm voice; run the pack, revenue and cockpit-agent gates; activate on prod (G19).
2. Merge the three lanes; ship 33.1-06 before 2026-09-24; adopt a weekly merge-and-promote cadence (G18).
3. Delete-first UX pass — ten items (G14, G15, G16).
4. Four scale constants + arm the sweep (G17, G1).
5. Repair the planning corpus once (G26).

**Track B — one tangible outcome per tier, then charge:**
6. Goal Engine v0, "the agenda speaks" (G13).
7. One revenue connector + invoice reminders (G22).
8. Landing page and Command Center in outcome language; the finished artifact for idea-stage users (G23).
9. Phase 25 release gates: one real, self-served, paying user; measure time-to-first-outcome (the first "Validated" line).

**Track C — structure, with evidence:**
10. Tool registry (08-24 §3) before the next heavy `llm.ts` phase; SMOKE sentinels out of band (G24).
11. Research engine (G4); Document Canvas (G5); durable runs + fan-out and batches under one plan-row ADR (G6, G10).
12. Workspace identity (08-24 §3) at the first team customer; retention ADR; BYOK seam.
13. Autonomy ADR → recurring routines (G25) → connectors → marketing loop.

**Freeze until a paying user asks:** Phase 30 vertical packs, Phase 24 ISO map, Phase 23 agent-authored skills, Outlook parity (25-08/09), the remaining three connectors.

## 6. Owner decisions — DECIDED 2026-09-03

| # | Decision | Owner's call | Consequence to design around |
|---|---|---|---|
| 1 | Legal entity start | **After first beta evidence** (not within the month; recommendation was two weeks) | Gmail refresh tokens keep dying every 7 days through the whole beta; every beta user reconnects weekly (the reconnect banner and `awaiting_reauth` path are the product's beta-critical surfaces). No custom domain, no CASA, no billing tax country until then. `SEND_TIME_HORIZON_MS` stays 7 days. |
| 2 | Price and plan shape | **Free beta, price later** | Phase 28.1 stays parked and sealed. Cost control for the beta is invite-only admission plus the per-tenant daily rails; the deployment-wide caps (G17) become the real spend ceiling and must be read from env before the first invite. No "Validated" line can come from revenue; it must come from behaviour (telemetry, DLQ, interviews). |
| 3 | Signup posture | **Invite-only** | Matches code. G16 narrows to copy: say invite-only on the home page and replace the mailto with the existing waitlist form. |
| 4 | Live spend + `[deploy]` merge | Owner action, sequenced by the 09-24 date: 33.1-06 first, then pack / revenue / cockpit-agent gates, then the promotion merge. Convex runs come from the owner's terminal. | — |
| 5 | Freeze list | **Nothing frozen** (recommendation was to freeze Phase 30, 24, 23, Outlook parity, remaining connectors) | The §5 tracks are an ORDER, not a gate: Phase 30 / 24 / 23 / Outlook / connectors remain schedulable but sit after Tracks A and B. The corpus keeps building ahead of validation by owner choice, as with ADR-015. |

## 7. Verdicts carried in one place

- **Tangible value today:** governed email work, contact hygiene, a cited knowledge vault, an honest diagnosis. Real, modest, mostly time-saved and clarity. No money-in outcome is live.
- **Non-technical usability:** yes on desktop for the core loop (state a goal → approve); stalls at entry, first Gmail connect, the rail, and the phone. The configuration surfaces are where it stops being for them.
- **Scale:** ~50 active users/day today by constant, ~10k after four small diffs, ~100k after sharding and retention, 500k needs index/queue work and a seat model. Convex is not the limit; scan patterns and constants are.
- **Long-running work:** survives only as scheduler chains; two of ~15 are durable; the sweep is dormant.
- **Recurring work:** no mechanism; correctly deferred; the deciding ADR must be scheduled.

*Compiled 2026-09-03 (rev 5) from the rev-4 audit, the 2026-08-24 service-architecture note, the goal-engine design capture, and five parallel investigations (backend capability matrix, non-technical UX, scale and long-running work, roadmap and future, ICP value and economics). Sources: packages/backend/convex, apps/web, packages/contracts/skills, docs/playbooks, docs/decisions, .planning/.*
