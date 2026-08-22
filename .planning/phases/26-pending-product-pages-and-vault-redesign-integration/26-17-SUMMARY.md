---
phase: 26-pending-product-pages-and-vault-redesign-integration
plan: 17
wave: 13
requirements: [RPRT-01]
status: complete
executed: 2026-08-22
---

# 26-17 — Reports, connected end to end, and the nav that only lit after the owner said so

## Owner verdict

**APPROVED 2026-08-22**: *"The report interface is okay"* — with one change requested and made
before Task 3 ran (below). Task 3 activated the nav on that verdict.

## What shipped

`/dashboard/reports` over the three read planes from 26-14/15/16. **The page adds no backend
surface**: three tenantQuerys (`business`, `operations`, `auditPage`), two ownerQuerys
(`wormExport`, `activeSkills`), one tenantAction (`generateBoardPack`) and
`api.vault.vaultDownloadUrl` — the same ownership-checked minting the Vault and Content already use.

### The one decision everything else hangs off

**The window anchor is pinned at mount** — `const [anchorMs] = useState(() => Date.now())`, with a
source scan asserting `Date.now()` appears EXACTLY ONCE in the module. A live clock in render is
wrong twice over:

- every re-render mints a new `untilMs`, so every Convex subscription gets a new query key and the
  page refetches forever instead of staying reactive; and
- `reportPackData.landPack`'s replay key is the CONTENT hash, so a drifting upper bound makes every
  click a different report and fills the vault with near-duplicate packs.

Pinning is what makes 26-16's "generate twice, get one artifact" true **in a browser** rather than
only in a unit test — and the browser gate proves it: the second click returns *"Already generated
for this window"*.

Changing the period recomputes `sinceMs` from the same anchor, and all three sections plus the pack
action receive ONE `args` object (asserted by name). The header renders the window the SERVER
resolved (`auditPage` echoes its `resolveDashboardWindow` output), so "every section shows the same
resolved window" is checkable rather than assumed.

### One vocabulary, two renderers

`countCell`, `coverageWord`, `floorCell`, `fmtDate` and `fmtDateTime` are now exported from
`@pikar/core` and used by BOTH the PDF builder and this screen. A page that said "0" where the pack
says "not measured" would be the 26-14 defect (a fix that never reached the renderer) inverted, and
two surfaces drift by each owning a copy.

### The boundaries, rendered

- **A non-owner never CALLS an owner query** — `useQuery(..., isOwner ? {} : "skip")`. Hiding a
  control is presentation; not making the call is the behaviour.
- **The WORM card renders a cursor position and no health word.** A component test bans
  "Healthy"/"Degraded"/"OK" from that card, because 26-15 removed exactly that claim from both the
  backend and the mockup.
- **An unknown audit event renders as a shell, never as a missing row** — a governance record with
  holes in it is worse than one with rows that say "no detail".

## The UAT change: collapsible cards

The owner's one request: the Governance and Deployment cards were taking the whole page.

They are now native `<details>`/`<summary>`, **arriving CLOSED** — not a `useState` toggle, because
the element brings keyboard operation, the disclosure triangle, correct AT semantics and the
open/closed state for free, and a hand-rolled toggle re-implements all four while getting the third
wrong. Only those two collapse: Business, Operations and Board pack stay open, because collapsing a
section nobody complained about hides a number the reader expects on arrival.

**A closed card still discloses whether it has anything**, via a `hint` in the summary ("3 shown,
more available", "12 active skills"). Hiding content is fine; hiding the EXISTENCE of content would
make an empty governance record and a full one look identical.

## Three things only running the gate could teach

The spec was written before it could run (the deployment was refusing every push — see Blockers).
Running it produced three corrections, all folded back in:

1. **Wait for the window line by PATTERN, never by "it changed."** Switching periods hands every
   subscription new args, so `useQuery` returns undefined and the header honestly reads "Resolving
   the window…". Reading at the moment the text merely DIFFERS captures that intermediate state.
   (All three sections blank together on the same args change, so no stale number ever sits under a
   new header.)
2. **Never hardcode a timezone.** The first draft asserted "UTC" and **failed a correct page** on a
   runner reporting `Africa/Dar_es_Salaam`. What the contract promises is a named IANA zone plus the
   `(from your browser)` disclosure — `timeZoneSource: "browser-fallback"` is the documented
   temporary state, and hiding it would claim a precision the report does not have.
3. **`convex run` ENDS THE BROWSER SESSION** (already in `e2e/README.md` and the spec's own header),
   so the one test calling it mid-test — the owner bootstrap/revoke — must run LAST. In the middle it
   left every later test unauthenticated and `auditPage` never resolved, which presents as a **hung
   query** rather than a dead session.

Cheaply learned alongside: a 307 from an unauthenticated `curl` proves nothing about whether a route
exists — the auth middleware redirects before the 404 is determined.

## A test a prose comment could satisfy is not a test

The first hint assertion was `expect(source).toContain("shown")` — and the explanatory **comment**
above the hint satisfied it, so deleting the hint left the suite green. Caught by mutation. It now
renders `Section` and asserts the hint appears INSIDE `</summary>`; moving it into the body turns
the test red. The call-site hints are covered by the browser gate's `getByText(/shown/)`, not by the
component suite — recorded because "covered" and "covered where" are different facts.

## Blockers hit, and what they actually were

**The gate looked unrunnable on missing credentials. It was not.** Nothing had deployed since
~19:0x: `convex/lib/foglamp.ts` (a SECOND LANE live in the same working tree) carries no `"use node"`
directive, so the V8 bundle pulled in `foglamp@0.9.0`'s `import { createServer } from "node:http"`
and **every push failed, for every module** — with the `convex dev` process alive and failing
silently. On the owner's authorisation that lane was parked and restored **byte-exact**: 13 files
backed up by raw copy (not `git stash`), tracked ones reverted with `git checkout HEAD --`, the two
untracked moved aside, then all 13 copied back and verified with `cmp`/`md5sum`. None of it is in
any commit from this plan; the shared-file hunks in `cockpit.md`/`vault.md`/`watch.json` were
withheld each time and restored afterwards. **That lane's bug is back with it** and will refuse every
push until fixed.

**Seeding an account needed a seam.** `/signup` is invite-gated and the only issuance path is
`approve`, an `ownerMutation` that `npx convex run` can never call, so `invites.__seedInvite` (a
`__`-prefixed `internalMutation`, the `onboarding.__seedOnboardedTenant` convention) mints the row
and `e2e/seed-user.setup.ts` drives the real signup form. Not an authorization hole structurally: an
`internalMutation` is not client-callable, it writes the same row `approve` writes via the same
`mintCode()`, and `admitIdentity` remains the boundary. The seeder is inert unless invoked
explicitly — it ends in `.setup.ts`, matching neither the `setup` project's `testMatch` nor
Playwright's default spec glob.

## Deviations

- **The component test is `reportsView.test.ts`, not the `.tsx` the plan names** —
  `apps/web/vitest.config.mts` includes `app/**/*.test.ts` ONLY, and a `.tsx` there is SILENTLY
  SKIPPED. Same deviation and reason as 26-13.
- **`packages/core/src/reports.ts`** exports the five copy helpers (see "one vocabulary").
- **`packages/backend/convex/invites.ts` + `docs/playbooks/beta-admission.md`** for the seam;
  **`apps/web/e2e/seed-user.setup.ts`** is new.
- **Typed test fixtures caught three fictions** the render cast had hidden: an invented
  `not-comparable` movement state, a `p50`/`p95` latency that does not exist, and a `DashboardBound`
  missing its `nextCursor`. Fixtures are now `BoardPackInput["operations"|"business"]`.

## Evidence

- component **28/28**; `e2e/reports.spec.ts` **EXECUTED 7/7** against a rebuilt `:3111` with the nav
  live; web typecheck + prod build clean; core 40 files/1096; backend typecheck clean; biome clean;
  watcher clean.
- **The board pack is the one non-seeded claim in that run.** Its audit rows are seeded and prove UI
  states only, but `generateBoardPack` executed the real `markdownToPdf` (pdf-lib, deterministic, no
  network, no provider, no cent) and the real `ctx.storage.store`; the download href was a minted
  `https:` storage URL.
- Mutation-verified this session: `<details open>` (caught), hint moved out of the summary (caught),
  and — before the fix — the prose-satisfiable hint assertion (SURVIVED, which is why it changed).

## Rollback

Delete the `href` from the Reports rail item; the branch keys off `href`. **Rollback touches no
data**: a generated board pack is an ordinary vault row, nothing on that rail rewrites one, and
`reportPack.ts`/`reportPackData.ts` contain no `.patch`, `.replace` or `.delete` (statically
scanned). An artifact's `origin` is likewise untouched — promotion is a trust decision the user took
about their own material, not a property of a route.

## Still open, not introduced here

The agent-relayed citation-label gap from 26-12-SUMMARY, and 26-VALIDATION rows 26-06/07/08.
