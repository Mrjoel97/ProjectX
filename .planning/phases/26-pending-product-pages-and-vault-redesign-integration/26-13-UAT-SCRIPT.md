# 26-13 Task 2 — Content artifact UAT (BLOCKING, open)

**Status:** Task 1 shipped and committed (`cd63ebf`). Task 3 (nav activation) must NOT run until you
approve below. This is not the summary — `26-13-SUMMARY.md` is written only after approval.

## The stack is already running

| Piece | Where | Note |
|---|---|---|
| Web | http://127.0.0.1:3111 | **production build**, restarted on the new build (not `next dev`) |
| Convex | local backend on :3210 | `npx convex dev` running in this session |
| Sign in | `e2e-wave6@pikar.test` / `pikar-e2e-2026-Wave6!` | the documented local password identity |
| The page | http://127.0.0.1:3111/dashboard/content | **type the URL** — the nav item is still "Soon" by design |

If the servers are gone by the time you read this: `npx convex dev` from `packages/backend`, then
`npx next build && npx next start -p 3111` from `apps/web`.

## What is already proven, so you do not need to re-check it

`apps/web/e2e/content.spec.ts` ran 7/7 in the browser: the route answers while the nav item stays
disabled, all three shelf kinds render, a document opens and a legacy one offers no reuse link, a
proved reel plays and an unproved one says why it cannot, promotion shows its one-way warning and
completes, and the refs-only `vault.promoted` audit row lands. Component tests 23/23, backend suite
92 files / 2263 passed, web suite 30 files / 476 passed, prod build clean.

**What that does NOT prove, and what your eyes are for:** responsive and keyboard behaviour, whether
the copy reads right, and whether the page is worth having.

## The checklist (plan 26-13 Task 2, verbatim scope)

1. **Nav-hidden direct route.** `/dashboard/content` loads; the rail's Content item is greyed with
   "Soon" and does not navigate.
2. **Responsive + keyboard.** Desktop, tablet, and **390×844 mobile** — 26-10's UAT found a real clip
   at exactly that width on a sibling page, so it is worth a look here. Tab through: every chip,
   card button and link should take focus visibly, and the promote confirm should be reachable and
   escapable by keyboard alone.
3. **Each kind opens.**
   - *Document* — "UAT — promote me (fresh, never promoted)" and "Northfield scope and pricing (…)".
     Open renders the document in place; Escape closes it.
   - *Memo* — "Next step — close the Offer gate (…)". The button says **Read**, not Open.
   - *Reel* — "Reel: launch (…)" plays; "Reel: teaser (…)" offers **no Play** and says
     *"This reel is being made again, so the finished cut isn't the current one."*
4. **Cockpit reuse.** "Reuse in the cockpit" opens `/dashboard/workspace?thread=…` and nothing else
   happens — no copy, no draft, no send. A reel's "Open canvas" adds `&view=canvas`.
   The legacy card shows a disabled "No conversation recorded" instead of a link.
5. **Promotion, on the FRESH document.** *"UAT — promote me"* has never been promoted, which matters:
   promotion is one-way, so a second run on an already-promoted row exercises the `already_promoted`
   branch instead of the transition. Confirm the warning says it can no longer be rewritten AND that
   it cannot be undone, then promote and watch the card become **Reference material**.
6. **The moved surfaces.** The note under the chips names **Reports** as sent mail's owner (unlinked
   — that route does not exist yet) and links the **Knowledge Vault** for research briefs. There is
   no sent-mail lane, no recipient state, no research card and no "Refresh Research" anywhere.
7. **Ownership failure.** Nothing on this page will show you another tenant's artifact; if you want
   to see the refusal, that is what the isolation tests cover.

## Two things to hold me to

- **Seeded rows prove UI states only.** The reel is a few bytes with a video mime and its "sidecar"
  is a marker. Nothing rendered, nothing embedded, no provider ran, no cent was spent. If you want
  live evidence that a real reel plays here, make one in the cockpit and say so — that is a separate,
  paid check and it must be recorded separately.
- **Promotion is irreversible.** Promoting the UAT document is a real, permanent change to that row.
  The only undo is deleting the artifact.

## After you answer

- **Approved** → I write `26-13-SUMMARY.md` and run Task 3 (replace the disabled Content nav item
  with the live route, re-run typecheck/build/watcher, record approval and rollback in both
  playbooks).
- **Defects** → name them exactly; they get fixed before the nav moves.
