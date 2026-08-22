---
phase: 26-pending-product-pages-and-vault-redesign-integration
plan: 13
wave: 10
requirements: [CONT-01]
status: complete
executed: 2026-08-22
---

# 26-13 — the connected Content library, approved and live

## Owner verdict

> "The page is minimalistic. It works great."

Approved 2026-08-22. Task 3 ran on that approval: the rail's `Soon` item became
`{ label: "Content", href: "/dashboard/content" }`.

**What the owner adjudicated, and what they did not.** They opened the page and used it. They did
NOT walk the 390×844 responsive check, the keyboard pass, or the each-kind-opens list item by item —
those are covered by the executed browser gate, not by an owner verdict, and the distinction is
recorded rather than rounded up. What the owner DID adjudicate beyond "it works" is the shape of the
shelf itself, and they found a defect in it (below).

## What shipped

**`/dashboard/content` — and the page adds no backend surface.** Every action ends in a function
that already existed and was already guarded:

| Action | Surface | Why not rebuilt |
|---|---|---|
| Open / download a document or memo | `api.vault.vaultDoc` + the Vault's `PreviewModal` | it already resolves markdown vs PDF bytes, truncation, missing originals, focus trap and Escape. Reached BY ID exactly as `workspace/cards.tsx`'s `VaultDocModal` does. |
| Play a reel | `api.media.reel` | its non-null `url` IS the validated-assembly guarantee (D8) |
| Promote | `api.vault.promoteToReference` | 26-11's single guarded surface, called directly |
| Audit the promotion | `api.contentAudit.recordPromotion` | the caller audits; `vault.ts` is log-free by construction |

**A reel is deliberately NOT opened through `PreviewModal`,** although it would work. That modal
plays the row's own bytes; Content plays only through `media.reel`. The Vault shows you your files,
Content presents governed artifacts, and the difference is a Play button that is **absent** rather
than dead — with the reason on the card (`no-plan` / `no-bytes` / `no-sidecar` / `superseded`) and
the canvas link still open.

**Promotion explains itself before it happens.** The control opens a confirm block carrying the
sentence verbatim — *"Promoting a document makes it reference material the assistant can cite — it
can no longer be rewritten in this conversation"* — plus "this cannot be undone". That is a real
consequence: `patchCreatedDoc` refuses any row whose `origin !== "agent"`, so the only reversal is
deleting the artifact. The transition then renders from the row's own `status`.

**The rollback boundary.** Deleting the href hides the route. It does not touch an artifact's
`origin`: a promoted document stays `agent_promoted` whether or not the page is reachable, because
promotion is a trust decision the user took about their own reference material, not a property of a
route. A rollback that demoted would rewrite a decision the user made.

## DEVIATIONS — three, all recorded

**1. The component test is `contentView.test.ts`, not `.tsx`.** `apps/web/vitest.config.mts`
includes `app/**/*.test.ts` ONLY, and its own header records why: a `.tsx` there is silently skipped
AND needs a DOM. The plan named `.tsx`; writing that file would have produced 23 tests that execute
nowhere while reading as coverage in the diff. Components are rendered to a string with
`renderToStaticMarkup`, the shipped `financeView.test.ts` idiom.

**2. `contentAudit.ts` + `contentAudit.test.ts` — a backend module a web-only plan did not list.**
The `vault.promoted` row had no legal home:

- NOT `vault.ts` — `vaultRedaction.test.ts` keeps the vault content plane log-free by construction.
- NOT `content.ts` — read-only by construction (26-12), and one mutation would turn "cannot write"
  into "writes only this", which is a weaker promise.
- NOT `audit.ts` — its header states it exposes no client-callable builder. **A `tenantMutation`
  there would have passed `auditImmutability.test.ts`,** whose `PUBLIC_BUILDER` regex only matches
  the raw `query`/`mutation`/`action` builders. That gap is a reason to respect the stated invariant,
  not a licence to slip through it.

It is a SEPARATE call from the promotion, not a wrapper: the guard still runs once, in one place.
Only the doc id crosses the wire — `sourceThreadId`/`sourcePlanId` are read off the row the caller
was just verified to own, the same rule 26-11 applied at the four provenance write sites.

**3. `smoke.seedContentShelf` — an E2E fixture seam.** Only one of the three lanes is reachable from
a shipped function (`vault:insertCreatedDoc`); a memo comes from a plain TypeScript function and a
reel from a render terminal, neither CLI-callable, and a reel additionally needs stored bytes. Both
`contentAudit.*` and the smoke seam are registered in `watch.json`.

## Evidence

| Check | Result |
|---|---|
| `e2e/content.spec.ts` | **7/7 EXECUTED**, twice — before Task 3 (nav dark) and after (nav live) |
| `contentView.test.ts` | 23/23 · **7/7 view mutants caught** |
| Web suite / backend suite | 30 files / 476 passed · 92 files / 2263 passed |
| Web typecheck · prod build · watcher | clean |
| Playbook gate | verified **LIVE** for the `smoke.ts` → `agent-runtime.md` coupling (ack cleared + playbook reverted ⇒ a real block naming `smoke.ts`) |
| `vault.promoted` row, read back from the deployment | `{result:"processing", sourceThreadId:"…", sourcePlanId:null, vaultDocId:"…"}`, actor `user`, correlation `vault:promote:<docId>` — no title, no body |

View mutants: V1 offer Play regardless of proof; V2 always render reuse as a link; V3 drop the
one-way sentence; V4 offer promotion on a promoted row; V5 read the delivery spine from the page;
V6 drop the capped marker; V7 subscribe every card to its reel url. All caught.

## THE E2E'S FIRST RUN FAILED, AND THE FAILURE WAS REAL

Test 6 asserted only that the card said "Reference material" — which appears the moment the reactive
query sees the patched row, **while the caller-side audit call is still in flight**. The test ended,
Playwright tore the context down mid-mutation, and test 7 then found an empty audit table for a
promotion that had genuinely happened.

**A fire-and-forget follow-up call is not observable through the state the first call changes.** The
fix is a sequencing point, never a sleep: `setConfirmingId(null)` runs after `recordPromotion`
resolves, so waiting for the confirm block to detach proves the whole chain ran. Any plan whose
terminal is "call A, then call B" needs an assertion that can only be true after B.

## ONE ASSERTION WAS INVERTED ON PURPOSE

Before Task 3, test 1 asserted the nav item carried `aria-disabled="true"` and that no
`a[href="/dashboard/content"]` existed anywhere in the DOM — and the gate proved that. After the
approval it asserts the opposite. The record of "the nav was still dark when the browser gate ran"
lives here and in the playbook; leaving a test asserting a state the product deliberately left
behind would have been the dishonest option.

## THE OWNER FOUND A DEFECT IN 26-12, AND IT IS NOT A SCOPE QUESTION

The Content whitelist excludes `kind: "image"` with a comment calling those rows "media
intermediates". **That is false.** `mediaComplete.saveImageToVault` is explicitly *"scoped to the
STANDALONE IMAGE"* (`plans.mediaMode === "image"`) and is `saveReelToVault`'s twin; a reel's scene
images never become vault docs at all, because `deleteIntermediates` removes them at the render
terminal. Every `kind: "image"` vault row is a finished deliverable, so the shelf of "everything
Pikar has made" is missing one of the two things Pikar makes.

**The lesson is the comment, not the line.** A whitelist entry justified by a claim about another
module is only as true as that claim, and mine was written from the field name rather than from the
write site. Owner directed the fix as its own follow-up plan — **26-13.1**, with title search and
thumbnails alongside it.

## Owner decisions taken this session

1. **UAT approved; nav activated.**
2. **The image lane is a follow-up plan (26-13.1)**, with search and thumbnails, before anything else.
3. **Funnels stay on the roadmap.** Phase 31 (tranche A, funnel v0 link-only) is buildable without a
   legal entity, but the owner chose to finish Phase 26 first.
4. **The legal entity has NOT started.** It blocks, simultaneously: Phase 32 (social connection,
   publishing, per-post metrics), Google OAuth verification, custom domains (Phase 25 SC#6), CASA
   and billing. Recorded on the roadmap as the top external blocker with its dependents listed.

## Not done / handed on

- **No search, no thumbnails, no image lane** — 26-13.1.
- **No "what happened to it" line.** The shelf shows what Pikar made, never what it was used for.
  Every artifact already carries its thread and plan, so "sent to 3 people" / "cited 4 times" is
  derivable rather than new plumbing. Proposed, not scheduled.
- **Still open, not introduced here:** the agent-relayed citation-label gap recorded in
  26-12-SUMMARY (memos, reel transcripts and research briefs carry no `origin`, so they are cited as
  plain `vault`), two red finance tests from 26-10, and 26-VALIDATION rows 26-06/07/08.
