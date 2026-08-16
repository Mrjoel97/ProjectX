---
phase: 25-private-beta-productionization
purpose: "The blocking owner checkpoints, staged: what to run, what it proves, what blocks it"
prepared: 2026-08-17
status: none_run
---

# Phase 25 — the owner gates

Seven blocking checkpoints across five plans. **None has been run.** Each needs something no
automated run can produce: a real provider consent, a live browser, a production release, or a
judgement call.

They are listed in the only order the dependencies allow.

---

## GATE 1 — 25-06 Task 2 · the Microsoft disconnect posture *(decision, no cost)*

**Blocks:** the disconnect COPY in the UI, which is deliberately unwritten because the wording *is*
the decision.

**Do:** read `.planning/phases/25-private-beta-productionization/25-MAIL-MIGRATION-EVIDENCE.md`,
re-verify the three Microsoft docs links (they move), choose Posture A or B, fill in the decision
block at the bottom.

**Costs nothing and blocks nothing else.** Do it first.

---

## GATE 2 — 25-10 Task 2 · the durable-domain ADR *(decision, no cost)*

**Two corrections before you read the plan, both measured at the 25-00 baseline:**

1. **The plan's `docs/decisions/017-…` filename COLLIDES.** `017` is already
   `017-direct-wan-visuals-openai-audio.md`, Accepted. ADRs are immutable (CLAUDE.md §9), so two
   files numbered 017 is permanent. **Use 022.**
2. **The A/B decision was already made and shipped.**
   `020-production-opened-without-an-admission-gate.md` is Accepted and records
   `https://www.pikar-ai.com` live with the full platform, promoted at run `31854161028` off
   `9eada53`. **Branch B is not "decline to ship" — it is "take down a live promoted deployment."**
   The new ADR should RATIFY or SUPERSEDE ADR-020, not re-litigate it.

Also: the plan's demand for durable **custom** origins is wrong. The Convex HTTP-action origin is
`*.convex.site`, fixed by Convex domain configuration and never set by this repo. Durable is the
requirement; custom is not.

---

## GATE 3 — 25-07 · live Gmail continuity + one Microsoft send *(spends money; needs consent)*

**What it must prove:** routing both production callers through `internal.delivery.send` did not
regress Gmail, and the Microsoft arm can complete one governed send over the shared grant.

**Prerequisites, and this is where it will stall:**

- `AUTH_MICROSOFT_ENTRA_ID_ID` / `_SECRET` on the Convex deployment — **not set anywhere today**,
  and *distinct from* the `MICROSOFT_OAUTH_CLIENT_ID` mailbox pair. `/admin` now reports both.
- An Azure app registration whose redirect URI is
  `${CONVEX_SITE_URL}/api/auth/callback/microsoft-entra-id`.
- A Microsoft grant carrying `Mail.Send` **and** `Mail.Read` — a 17-05-era calendar-only grant is
  refused as `mail_scope_missing` by design. Reconnect at `/connect-microsoft` to widen it.

**Run:**

```
# 1. Confirm the deployment is configured — signed in as owner:
#    /admin → "Hosted configuration". Expect zero missing REQUIRED names.
# 2. Gmail continuity (the regression half):
cd apps/web && pnpm test:e2e -- e2e/pipeline-uat.spec.ts
# 3. Microsoft: connect at /connect-microsoft, pick Outlook on a plan (the SEND FROM
#    control appears only when both mailboxes are ready), approve, confirm arrival.
```

**Watch for:** a held send now names the right provider — a Microsoft hold must say "Reconnect
Microsoft", never Gmail. That was a real bug fixed in 25-06 and this is where it is confirmed live.

---

## GATE 4 — 25-08 · Outlook reply threading *(spends money; needs consent)*

Strictly after Gate 3. Proves raw-MIME conversation grouping survives Graph before 25-09's broader
parity lane depends on it.

---

## GATE 5 — 25-11 · the production deploy *(irreversible; re-asked every time)*

**READ THIS BEFORE ANYTHING ELSE:** the plan describes a manual deploy. **There isn't one.**
`deploy-production.yml`'s only trigger is `workflow_run` on `ci` completing, filtered to
`conclusion=='success' && event=='push' && head_branch=='main'`. No `workflow_dispatch`, no SHA
input. **The deployable SHA is whatever head of main last passed CI.**

So the release is: **merge → CI green → the pipeline promotes → record the run id and
`github.event.workflow_run.head_sha`.** A hand-run `convex deploy` / `vercel deploy` bypasses the
staged-then-promote ordering, the `_generated` drift check, the SITE_URL read-back, and the seed
step.

**A red lint on main silently means production is never redeployed** — the deploy is gated on CI,
and nothing on the deploy side reports it.

Also correct the plan's env claim: Vercel production holds `NEXT_PUBLIC_CONVEX_URL`,
`MEDIA_RENDER_SECRET` and `MEDIA_SANDBOX_SNAPSHOT_ID`; `CONVEX_DEPLOY_KEY` lives **only** in
GitHub's `production` environment secrets and is never exposed to the web host. `SITE_URL` is not
hand-set — the pipeline writes it from `vars.PRODUCTION_URL` and fails on read-back mismatch.

**This one is not inherited from any prior approval.** It puts an invite gate in front of a
`pikar-ai.com` that is open right now — which is the point — but it is still a live release.

---

## GATE 6 — 25-12 · production qualification *(after Gate 5)*

**One correction:** the plan's verification command cannot pass as written. Use either the
signed-in `/admin` readiness surface, or:

```
cd packages/backend && npx convex run --prod ops:envCheck --identity '{"subject":"<ownerUserId>|cli"}'
```

All three parts are required — no `convex.json` (so cwd matters), `--prod` (or it hits local dev),
and `--identity` (or `requireScope` throws `UNAUTHENTICATED` before `requireOwner`).

**And:** "all three owner APIs" is **15**. The list is derived by `isolation.test.ts`; read it from
there rather than the plan.

---

## GATE 7 — 25-13 · final acceptance *(after Gate 6)*

**One correction:** the plan asks for a thin profile of "oneLineDescription + persona". **`persona`
is not an input at any layer** — `ProfileInput` omits it and `vProfile` has no such key, so a
fixture carrying one fails typecheck *and* the runtime validator. Entering onboarding needs only
`oneLineDescription`; **completing** it needs the tier row plus all six `REQUIRED_SLOTS`
(oneLineDescription, headcount, paidStaff, revenueStage, funding, yearsOperating).

---

## What is NOT proven, and no gate above closes it

- **No live provider round trip has ever reached the admission callback.** Every admission test
  drives `admitIdentity` with synthetic profiles. Gate 5/6 is the first time a real Google,
  Microsoft or password sign-in walks invite → signup → tenant.
- **Phase 22's owner/non-owner DOM evidence is closed at the COMPONENT level, not in a browser.**
  The Playwright harness has one identity and one storage state; `owner` is hand-granted only; and
  the `(app)` onboarding redirect would have made a non-owner browser assertion pass for the wrong
  reason. Recorded in `beta-admission.md`. **Do not upgrade this to "browser-proven".**
- **Erasure does not reach the admission plane.** A deleted tenant's email survives in
  `betaWaitlist` / `betaInvites`. A real Art. 17 question, deliberately left to Phase 22.1 which
  owns that irreversible surface.
- **GOVN-03's provider-revocation clause stays open** whichever posture Gate 1 chooses.
