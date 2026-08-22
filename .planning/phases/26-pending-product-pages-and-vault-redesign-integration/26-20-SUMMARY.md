---
phase: 26-pending-product-pages-and-vault-redesign-integration
plan: 20
subsystem: dashboard-pages
tags: [home-01, command-center, owner-uat, browser-gate, approved]
requirements-completed: [HOME-01]
completed: 2026-08-23
---

# Plan 26-20: Command Center v2, owner-approved

`/dashboard` renders `CommandCenter.tsx` and nothing else. The reversible switch and
`LegacyDashboard.tsx` were deleted on approval.

## Owner UAT — what was actually said

The owner ran the surface on the local stack (production build on :3111, local Convex on :3210)
on 2026-08-23 and approved verbatim:

> "It's looking good. The new command centre is looking good. I like it. proceed"

**RECORDED HONESTLY: this is an overall approval, not the per-step observations §§2-9 of
`26-20-UAT-SCRIPT.md` asked for.** The script's blanks (each recommendation in ladder order, each
stat's definition, owner-vs-non-owner health, the injected health failure, every nav route) were
NOT individually filled in. What IS covered by executed evidence is the 8/8 browser gate below.
The judgement items the gate cannot make — whether the ranking matches how the owner wants a
morning ranked, whether each stat counts what they meant — rest on the general approval alone.
No claim in this file should be read as a per-step owner attestation.

## The browser gate — 8/8, executed

`e2e/command-center.spec.ts` ran green 8/8, repeatedly and idempotently. It covers: the Command
Center is the mounted surface with each section in its own state; no failure renders as the number
zero; one non-reporting source makes the verdict Unknown with the all-clear nowhere; the briefing
renders with workspace-only links; no state carried by colour alone; responsive at 1440/834/390;
keyboard order and visible focus; and the priority ladder.

### FOUR defects it caught that 3,900 unit tests, three typechecks and a production build did not

1. **The functions were never deployed.** `convex/lib/foglamp.ts` sat under `convex/` without a
   `"use node"` directive, so `foglamp`'s `node:http` import failed to resolve and **aborted every
   push**. `home.js:summary`, `home.js:health` and `briefings.js:latestForTenant` were absent from
   the deployment and all five sections rendered `error` — while everything in CI was green.
   `convex-test` runs in-process and can never see that a function failed to REACH the backend.
   **Always confirm with `npx convex function-spec | grep <module>`.**
2. **The spec assumed ABSENCE as a fixture on a database that persists across runs** — three
   times, in three tables. It expected `scheduled-risk` and got `stale-approval` (the tenant holds
   1056 `proposed` plans days old); it expected `scheduled-risk` to clear when it cancelled its own
   plan, but other `scheduled` rows remain. The PRODUCT WAS RIGHT every time. The ladder now
   asserts monotonic descent plus at least one strict advance, and asserts `Clear` only on signals
   whose absence it guarantees.
3. **"7 listed of 2 in this window."** The briefing card rendered `listedCount`/`itemCount` swapped
   and mislabelled — a part larger than its whole — **and the spec pinned that exact string**, so
   the gate was green over it. The unit fixture was itself impossible (`listedCount: 2,
   itemCount: 9`). Now "Summarized N of M" with `summarized <= listed` asserted. Caught by reading
   the live screen, not by any test.
4. **A reflow race read as a clip.** `setViewportSize` resolves before CSS grid re-lays-out, so
   `boundingBox` returned the previous breakpoint's geometry (`right: 402` at 390px where a settled
   probe measured `374`). Fixed with a double-rAF barrier plus `expect.poll`.

## On approval

- `dashboard/page.tsx` reduced to `return <CommandCenter />;`.
- `LegacyDashboard.tsx` deleted; removed from `watch.json`.
- The switch suite and its TRIPWIRE test deleted, replaced by two tests asserting the route mounts
  the Command Center with no fork, no build-time env switch, and no legacy file left orphaned.
- `workspace/cockpitAccess.test.ts`'s legacy half retired; the "never lead with Gmail" invariant is
  asserted against v2's RENDERED hero.

## Final gate

| Gate | Result |
|---|---|
| `e2e/command-center.spec.ts` | **8/8** on the switch-free build |
| `packages/core` | 41 files, **1123/1123** |
| `packages/backend` | 96 files, **2369/2369** |
| `apps/web` | 32 files, **568/568** |
| core / backend / web typecheck | clean |
| `apps/web` production build | clean, `/dashboard` in the route manifest |

## Rollback

No longer a flag. Revert the approval commit; the source queries are untouched by that revert and
every source page works either way. Presentation is reversible, stored data is unaffected.

## OPEN — needs an owner ruling, not blocking

**`connection-failure` ranks FIRST**, so a disconnected mailbox outranks all business work in the
hero. The shipped cockpit invariant says the dashboard never leads with the email channel. Both are
deliberate and they contradict. 26-19 locks the order, so it was implemented as specified; the
owner saw the live page leading with "Connect your mailbox" and approved the surface, but did not
rule on the conflict itself.

**The ladder cannot be walked below `stale-approval` on this tenant** — 1056 stale `proposed` plans
keep priority 2 triggered permanently. Correct behaviour; it just means rungs 4-7 are not
observable live without clearing that queue.
