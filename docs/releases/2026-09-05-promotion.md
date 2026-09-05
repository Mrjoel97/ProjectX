# Release manifest — 2026-09-05 production promotion

**Range:** production `860e3f5` (2026-08-27) → this release's merge of `origin/main` (`980a42e`) + `feat/28.1-billing-mapping` (`7bd72c8`).
**Size:** 428 commits across every ref; 21 files needed a hand merge.
**Owner decisions applied:** one release, not two (2026-09-05). Production env confirmed: OpenRouter funded, `PEXELS_API_KEY` set, `OPENAI_API_KEY` kept for voice.

The reviewable unit is the plan, not the commit. Every plan below has a `SUMMARY.md` under `.planning/phases/` naming its files, tests, mutations and what stays gated. This page is the mechanical cross-cut of all of them: what production runs differently the moment the deploy lands.

## 1. What ships, by phase

| Phase | Plans in this release | State on production after deploy |
|---|---|---|
| 28 Connector-backed revenue pack | 28-01 … 28-26, 28-28, 28-29 (28 of 29; 28-27 is the owner seal) | **Dark.** Four connector lanes exist behind `providerGates`; no gate row is sealed, so the Connections panel, the revenue pack panel and every revenue tool are absent. |
| 28.1 Pikar's own Stripe billing | 28.1-01 … 28.1-11 (all) | **Dark.** No `BILLING_STRIPE_*` value is set; the webhook route refuses unsigned events, the billing panel renders nothing on `unknown`, the daily rollup finds no periods. Has never spoken to Stripe. |
| 29 Unified knowledge and routines | 29-01 … 29-13 plus the six `-FIX` plans | **Live.** Knowledge search panel in the workspace, workflow-pack customizer and pinned routines on the Workflows page. Needs the two `knowledge-*` skills, which the deploy seed activates. |
| 33.1 Media provider migration | 33.1-01 … 33.1-05 (33.1-06 is the owner-gated live proof, after this deploy) | **Live.** Images and video generate through OpenRouter (grok-imagine-video, gpt-image-2); the duration grid is 1–15 s; a music bed comes from Openverse; `persistDeck` accepts `music`. |
| 33.2 Storyboard model pin | 33.2-01 … 33.2-03, plus the 33.2-04/05/06 fixes (one resolver, transcription on OpenRouter, Sora deleted) | **Live.** Storyboards are authored by gpt-4.1-mini (ADR-032). Every transcription and the PDF/image extraction rail spend OpenRouter credit. `sora-2` is gone before its 2026-09-24 withdrawal. |
| 25.1 hardening, 27 packs | already on production | unchanged |

ADRs added: 026–032 (`docs/decisions/`).

## 2. Mechanical delta

**Schema** (`packages/backend/convex/schema.ts`): 46 → 57 tables. Every change is additive or widen-only, so the forward deploy validates existing rows:

- New tables: `knowledgeSearches`, `connectorConnections`, `connectorOAuthStates`, `contactProviderRefs`, `providerGates`, `billingStripeEvents`, `billingCustomers`, `billingEvents`, `billingCoverage`, `billingUnapplied`, `billingPeriods`.
- Widened literals: media `provider` gains `stock`; media `kind` gains `audio`. `audit.workflowId` becomes optional. `tenantSkills` gains optional `templateId`, `templateVersion`, `customizationValues`, `customizationHash`, `browserEvidence`.
- Consequence: a **rollback to the old schema is not a deploy** once a row uses a new literal or table. Roll forward.

**Environment** (`convex/lib/env.ts`): 16 new names, all tier `feature` — `BILLING_STRIPE_PRICE_ID`, `BILLING_STRIPE_SECRET_KEY`, `BILLING_STRIPE_WEBHOOK_SECRET`, `HUBSPOT_OAUTH_*` (3), `QUICKBOOKS_*` (4), `STRIPE_APP_*` (4), `PAYPAL_PARTNER_MERCHANT_ID`, `PEXELS_API_KEY`. Nothing new is `required`; `OPENROUTER_API_KEY` was already required on production. What each key now pays for: OpenRouter carries agent turns, embeddings, images, clips, captions, transcription and hosted PDF/image extraction; OpenAI carries the voice session only.

**Crons** (`convex/crons.ts`): +1, `billing-invoice-rollup`, daily 07:00 UTC → `internal.billingRollup.tick`. It claims rows from `billingPeriods`; the table is empty on production, so the job is a no-op that touches nothing.

**HTTP** (`convex/http.ts`): +1 route, `POST /billing/stripe/webhook`. Without `BILLING_STRIPE_WEBHOOK_SECRET` every request is refused before parsing.

**Skill registry** (`pnpm --filter @pikar/backend seed` runs inside the deploy):

- Ten names are new to production and seed **active at v1**: `knowledge-query-planner`, `knowledge-synthesizer`, `revenue-specialist`, `revenue-call-list`, `revenue-cash-flow`, `revenue-customer-pulse`, `revenue-invoice-reminder`, `revenue-lead-triage`, `revenue-payroll-confidence`, `revenue-pipeline-review`. The revenue eight are reachable only through the parked pack; the knowledge two are what make Phase 29 work.
- `media-director` has a new body and is **not** in `GATED_SKILLS`, so the seed archives the active row and activates the new one at deploy time. This is the 33.1/33.2 grid rule and the gpt-4.1-mini pin; it is a behaviour change on a pipeline that has never rendered a reel on production.
- `research-specialist` has a new body and **is** gated: it lands as a candidate and stays inactive until an EVAL_GATE run on production activates it.

**Web** (`apps/web`): no new page routes. Five existing pages and 32 components change.

- Navigation: "Compliance" now points at `/dashboard/approvals?tab=compliance` (was `/ops`); the settings link points at `/dashboard/profile?tab=settings`.
- Workspace: `KnowledgeSearchPanel` (new, live), `RevenuePackPanel` (new, absent while every lane is parked), `MediaCanvas` reel-first changes, chat pane and intake control edits.
- Workflows page: `WorkflowPackCustomizer` and `PinnedWorkflowButton` (new, live).
- Profile: `ConnectionsPanel` (new, renders nothing while no gate is sealed). Settings: `BillingPanel` (new, renders nothing on `unknown`).
- Approvals view, ops readiness screen (now also checks that every registry skill has an active row), admin view.
- `apps/web/app/api/media/render` local sandbox changes.

**Deleted:** `pollOpenAiVideoTask`, the `sora-2` pricing rows and fixtures, every `api.openai.com` reference in `media.ts`. No Convex module was deleted.

## 3. What a production user sees differently

1. Knowledge search in the workspace answers from vault, Drive and the web with citations (Phase 29).
2. Workflows page: customize a pack, save it, pin it as a routine (Phase 29). Saving does not activate anything.
3. Media: storyboards from a different model, clips from grok-imagine-video, stills from gpt-image-2, a music bed, 1–15 s scenes. Reels that failed on the old provider can be retried.
4. Compliance lives under Approvals; Settings is a tab of Profile.
5. Nothing about billing, connectors or the revenue pack is visible. Microsoft stays env-gated and off.

## 4. Merge record

`feat/28.1-billing-mapping` into `origin/main`, 21 conflicting files:

| File | Resolution |
|---|---|
| `convex/lib/models.ts`, `models.test.ts` (add/add) | Union: main's resolver (`offlineSeamAvailable`, `stealth/` settings, `google/` fails closed) + the lane's `transcriptionModel` / `transcriptionUsage` and its narrow literal-call tripwire. |
| `convex/llm.ts` (2 hunks), `vaultDigest.ts` (2), `voiceDoc.ts`, `llmRedaction.test.ts` | main's hunk each time (delegate to the shared resolver; operator-signal offline seam; the both-ends-pinned scan anchor). All other lane changes in those files kept. |
| `contracts/src/auditProjection.ts`, `core/src/workflowPacks.test.ts` | both sides. |
| `core/src/tenantData.test.ts` | table count re-derived from the merged schema: 57. |
| `apps/web/vitest.config.mts` | lane's (it adds a `.test.tsx` the include must reach). |
| `docs/playbooks/watch.json` | main's (broader `lib/models` prefix). |
| `_generated/api.d.ts` | union of both import sets, re-sorted the way codegen sorts; every module on disk is covered. |
| 10 playbooks | both sides' `Last verified` blocks kept, stacked newest first. |

Repairs made during the merge, each caught by a gate and recorded in the owning playbook:

- `schema.ts`: the lane's "TOLERATED, NOT OWNED" placeholder copy of five `tenantSkills` fields deleted now that main's owned copy exists (biome `noDuplicateObjectKeys`); the header table index lists the five billing tables and says 57 (`schema.test.ts`).
- `routines.test.ts` (Phase 29's closed inventories): eight lane modules added to the pinned module list, `billingRollup.ts` to the scheduler call sites, `billing-invoice-rollup` to the pinned cron names. Re-derived from the merged tree, not copied from a side.
- `knowledgeExternalSources.test.ts` (Phase 29 CRM adapter): the lane's 28-16 connect-start gate refuses a provider with no passed lane, so the fixture now seeds a passed HubSpot gate per environment. No product code changed.
- `lib/env.ts`: the lane's 217-character `whatBreaks` sentence for `OPENAI_API_KEY` shortened under the 200-character hardcoded-prompt ceiling (`skills.test.ts`). Same meaning.
- `core/src/render.test.ts`: an optional chain that failed `tsc` on the lane itself.

One mistake caught by the suite: six files were first resolved with `git checkout --ours`, which takes the whole file and dropped the lane's auto-merged hunks (`stageInvoiceReminder` vanished from the tool list; six tests red). Redone hunk-by-hunk with `git checkout -m`.

## 5. Gates run on the merged tree

| Gate | Result |
|---|---|
| `pnpm install --frozen-lockfile` | exit 0 |
| `pnpm typecheck` (12 tasks) | exit 0 |
| `pnpm lint --diagnostic-level=error --max-diagnostics=none` | exit 0, 869 files |
| backend vitest shard 1/2 (final tree) | 2011 passed, 66 files, exit 0 |
| backend vitest shard 2/2 (final tree) | 1928 passed, 65 files, exit 0 |
| web 887 passed, 2 skipped (46 files) · core 1501 · revenue 340 · vault 175 · billing 156 · contracts 119 · cost 95 · voice 57 · extraction 28 · pii 8 | all green, 10/10 turbo tasks |
| `pnpm build` (Next production build, 31 static pages) | exit 0 |

CI runs the same four steps on the push to main; `deploy-production` runs only if CI is green and the head commit subject starts with `[deploy]`.

## 6. Rollback

- Web: `vercel promote` the previous production deployment (Vercel keeps it).
- Convex: there is no rollback deploy once a new-literal row exists; fix forward. The function-level exposure is small because every new surface is env- or gate-dark.
- Skill registry: `media-director`'s previous version is archived, not deleted; `activateSkill` with `mode: "rollback"` restores it without an eval run.

## 7. Owner actions after the deploy lands

1. Open `/ops` on production: `ready` must be true and `unseededSkills` empty.
2. Press Retry on the four reels that failed on the old provider (33.2-05).
3. Run 33.1-06's live proof: one image, one reel with a non-multiple-of-four clip.
4. Run the pack / revenue / cockpit-agent gates from your terminal, then the 28-27 seal if a provider lane is to open.
5. Next in the merged order: Phase 25.2 (delete-first UX), 25.3 (scale constants + armed sweep), then Phase 34 (Goal Engine v0). All three are stubbed in `ROADMAP.md`.
