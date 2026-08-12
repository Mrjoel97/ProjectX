---
phase: 19-contacts-crm-follow-ups
plan: 04
subsystem: contacts-crm
tags: [contacts, crm, unsubscribe, can-spam, http-route, public-route, hmac, idempotency]
requires:
  - "19-02: internal.contacts.resolveUnsubToken / suppressFromUnsubscribe and the UNSUBSCRIBE_SECRET-signed token"
  - "20-06: the http.ts HMAC path-segment route shape (pathPrefix + lastIndexOf('.'))"
provides:
  - "GET /unsubscribe/<raw>.<hmac> — the inert signed landing page (never writes)"
  - "POST /unsubscribe/<raw>.<hmac> — the confirm-only, idempotent suppression write"
  - "contacts.test.ts: the eight route contract tests (VALIDATION row 18)"
  - "UNSUBSCRIBE_SECRET set on the local deployment — footerFor can now mint a link"
affects:
  - "packages/backend/convex/http.ts (routes six and seven; the file's first PUBLIC unauthenticated ones)"
  - "docs/playbooks/cockpit.md (owns http.ts)"
  - "docs/playbooks/contacts-crm.md (invariants 9 and 10)"
  - "19-05 (the send path mints the links this route resolves)"
  - "19-10 (the UAT that judges how the landing page looks)"
tech-stack:
  added: []
  patterns:
    - "pathPrefix + lastIndexOf('.') path-segment HMAC (the 20-06 shape, third use)"
    - "GET/POST split as the anti-prefetch guard; the confirm button is the write boundary"
    - "the inert-GET assertion counts rows, never reads the response"
    - "one bare 404 for every rejection — no oracle for well-formed-but-stale"
key-files:
  created: []
  modified:
    - packages/backend/convex/http.ts
    - packages/backend/convex/contacts.test.ts
    - docs/playbooks/cockpit.md
    - docs/playbooks/contacts-crm.md
decisions:
  - "The POST resolves the token TWICE — once through resolveUnsubToken for the confirmation's address list, once inside suppressFromUnsubscribe, which re-verifies from scratch. Widening the mutation's return to carry the addresses would have edited 19-02's shipped contract and its assertions to save one free (no-DB-read) query hop"
  - "No env guard and no rate limiter at the route, both by written argument rather than omission — playbook invariants 8 and 10"
  - "The echoed address is HTML-escaped even though the payload is HMAC-signed: the signature proves WE minted it, not that a tenant-authored recipient string is safe to interpolate"
  - "The cross-tenant test re-signs with a WRONG key. Re-signing with the REAL secret produces a legitimately valid tenant-B token — the isolation claim is 'swapping the tenant requires the secret', not 'the tenant field is rejected'"
metrics:
  duration: ~35 min
  tasks: 3
  files: 4
  completed: 2026-08-09
---

# Phase 19 Plan 04: The public unsubscribe route Summary

Two `httpAction` routes on `pathPrefix: "/unsubscribe/"` — an inert signed GET landing page and a
confirm-only idempotent POST — the phase's ONLY public unauthenticated surface, proven inert by a
row count rather than a status code.

## What shipped

### Task 1 — the two routes (commit `f4ee077`, +124 lines on `http.ts`)

`http.ts` routes six and seven, and the first in that file that no bearer token and no signed-in
session guards. Both split the segment with `gmailAuth.verifyState`'s `lastIndexOf(".")` idiom and
both use `pathPrefix` — Convex's router has no `*` glob, so `path: "/unsubscribe/*"` would match
nothing (the 20-06 lesson, third use).

**GET** resolves through `internal.contacts.resolveUnsubToken` and renders. It contains no
`runMutation`, no `ctx.db`, no `ctx.storage` — the header states that as a contract with its reason
(scanners and prefetchers fire every URL in a message, so a GET-suppresses design unsubscribes
people who never clicked). The page echoes the decoded addresses so the recipient can see WHICH
mailbox they are about to unsubscribe, says in as many words that nothing has changed yet, and
carries one same-origin `<form method="POST">` with one submit button. No JS, no external asset, no
tracking pixel — a `fetch()` from a Next page would have needed CORS on the Convex origin.

**POST** resolves for the address list, then calls `internal.contacts.suppressFromUnsubscribe`
(which re-verifies from scratch — the POST never trusts a decode its caller supplied) and confirms,
naming every address the group token decoded to.

Three refusals-by-argument, each written into the source rather than left as an absence:

- **No env guard here.** `verifyUnsubToken` holds the single fail-closed `if (!secret) return null`
  and both entry points route through it; a second copy at the route makes that one vacuous
  (`contacts-crm.md` invariant 8, and the explicit carry-forward from 19-02).
- **No rate limiter.** A valid segment requires the deployment secret, brute-forcing an
  HMAC-SHA-256 digest is infeasible, and a per-address ceiling is meaningless against an idempotent
  upsert. `@convex-dev/rate-limiter` is already pinned if that changes.
- **Only 200 and 404 leave the route.** One bare 404 for every rejection, so a well-formed-but-stale
  token and a malformed one are indistinguishable from outside.

Styling is inline hex copied from BRAND §2 / `globals.css` (`--canvas` `#f8fafc`, `--card`
`#ffffff`, `--ink` `#0e1419`, `--ink-soft` `#55606c`, `--rule` `#d8dbe0`, `--teal-900` `#0b4f4a`,
`--teal-600` `#009689` as a button FILL under white text — BRAND §2 line 112 sanctions exactly that
and forbids small teal text). The `ponytail:` note names the ceiling and the upgrade path.
**Flagged for the 19-10 UAT: nobody has looked at this page yet.**

### Task 2 — the route contract (commit `9cb5fed`, +8 tests, 40 → 48)

Driven through `convex-test`'s `t.fetch` against the real router, copying `media.test.ts`'s webhook
shape and reusing `contacts.test.ts`'s own `signed()` helper rather than inventing a second one:

| Test | What it pins |
|---|---|
| GET, valid segment | 200, the address in the body, `method="POST"` present, and **zero `suppressions` rows before AND after** |
| GET, tampered digest | 404 |
| GET, no dot / leading dot | 404 (`dot <= 0`, not a zero-length raw that happens to verify) |
| unset `UNSUBSCRIBE_SECRET` | 404 on BOTH verbs, no rows — fail closed |
| POST, valid | 200, exactly ONE row, right address / tenant / `source` |
| POST twice | 200 twice, still ONE row, `suppressedAt` unchanged |
| POST, group token | two rows, one per decoded member, both normalized |
| cross-tenant | B's payload under A's digest 404s; a re-sign with a wrong key 404s; **and** B's own valid token lands under B and only B |

**The inert-GET test is mutation-verified.** Adding `await ctx.runMutation(...suppressFromUnsubscribe)`
to the GET handler turns it RED at the row-count line (`received length 1`), confirmed and reverted.
That is the point of counting rows instead of reading the response: a handler that suppressed and
then returned the identical HTML passes a status-only check.

The unset-secret case restores `UNSUBSCRIBE_SECRET` in a `finally` so an unset env cannot leak into a
neighbouring test and pass it vacuously.

### Task 3 — the playbooks (commit `2e641b0`)

`cockpit.md` (owns `http.ts`) gained a new top `Last verified` entry with an explicit SCOPE line —
this covers `http.ts` alone, no cockpit turn/tool/gate/row changed — recording the four decisions:
the GET/POST contract and its enforcing test, why the route is here and not in `apps/web`
(`middleware.ts` is default-deny; a page there costs a matcher edit plus a bearer-secret hop back),
`pathPrefix` over a glob, and `UNSUBSCRIBE_SECRET` as a SEPARATE deployment secret from
`GOOGLE_OAUTH_CLIENT_SECRET` — a link that lives forever in a recipient's inbox must not share the
OAuth signing key.

`contacts-crm.md` gained invariants **9** (a GET writes nothing, with the row-count test and its
mutation check) and **10** (a replay is honoured, and that idempotency is why there is no rate
limiter), renumbering the old 9 to 11. Its Key files entry for `http.ts` now describes what landed
instead of promising it, and points at `cockpit.md` as the file's owner.

## Verification

| Check | Result |
|---|---|
| `pnpm --filter @pikar/backend typecheck` | exit 0 — delta **0** vs the measured zero baseline |
| `npx vitest run convex/contacts.test.ts` | 48/48 green (was 40; row 18) |
| `pnpm test` (full turbo) | 9/9 tasks — backend **72 files / 1368 tests** green |
| `pnpm typecheck` (full turbo) | 10/10 packages, exit 0 |
| `node scripts/check-playbooks.mjs` | exit 0 |
| playbook `19-04` content assertion | `ok` |
| `biome check` on `http.ts` + `contacts.test.ts` | clean |
| mutation check: `runMutation` added to the GET | **1 RED** at the row-count assertion, reverted |
| `grep runMutation\|ctx.db` inside the GET handler | nothing |

No codegen was needed — `http.ts` is an existing module and no new Convex module or schema field
landed, so `_generated/api.d.ts` is untouched.

`graphify update .` + `node scripts/extract-convex-edges.mjs`: 14332 nodes / 16359 edges,
+404 convex edges, +62 table edges over 36 tables.

## Deviations from Plan

### Auto-fixed

**1. [Rule 2 — missing critical functionality] The echoed address is HTML-escaped**
- **Found during:** Task 1
- **Issue:** The plan says to echo the address into the landing page. The payload is HMAC-signed, so
  a third party cannot forge one — but the recipient string is still tenant-authored text
  (`normalizeAddress` only trims and lowercases; it does not validate), and the signature proves
  only that WE minted the token, not that its contents are safe to interpolate into markup.
- **Fix:** A four-character `esc()` over `& < > "`, applied to every interpolated address and to the
  form's `action` pathname. Everything else on the page is a literal.
- **Commit:** `f4ee077`

**2. [Rule 3 — blocking, for the phase rather than this plan] `UNSUBSCRIBE_SECRET` set on the deployment**
- **Found during:** post-task verification
- **Issue:** `npx convex env list` confirmed the secret was on no deployment, exactly as 19-02
  flagged. Unset means `footerFor` returns `null`, which means **every send is refused** — not
  merely that links 404 — and the symptom surfaces as "sending stopped working".
- **Fix:** a 32-byte random hex value set via `npx convex env set UNSUBSCRIBE_SECRET` from
  `packages/backend` with `CONVEX_LOCAL_BACKEND_STARTUP_TIMEOUT_SECS=180` (the default 30s does not
  start the local backend on this machine), then read back to confirm. Not a code change, so not
  committed. **This is the LOCAL deployment only** — a hosted deployment needs its own.

### Judgement calls recorded

**Task 2 was written as tests-after, not TDD RED-first.** The plan marks it `tdd="true"` but orders
Task 1 (the routes) before Task 2 (their tests), so a RED phase would have meant deleting the
just-verified handlers to watch a test fail. The equivalent proof was obtained where it actually
matters — a targeted MUTATION of the GET handler, confirmed RED on the one assertion the plan calls
"the test that proves the GET is inert", then reverted. Every other test in the block is a
status/row-count contract over behaviour with only one correct answer.

**The POST resolves the token twice.** `suppressFromUnsubscribe` returns `{ ok, suppressed }` — a
count, not the addresses — so naming every suppressed address (the plan's requirement, and the group
case's whole point) needs the resolve. Widening the mutation's return would have edited 19-02's
shipped contract and the assertions pinning it, to save a query that performs no DB read at all.

**The cross-tenant test re-signs with the WRONG key.** The plan says "re-sign it with tenant B's id
and assert the segment 404s" — but re-signing with the REAL secret produces a legitimately valid
tenant-B token, which correctly 200s and suppresses in B. The claim that actually holds is
"swapping the tenant requires the secret", so the test asserts both halves: B's payload under A's
digest 404s, a re-sign with a wrong key 404s, and — the non-vacuity complement — B's own valid
token lands under B and nowhere else.

## Notes for the next plans

- **19-05 (the send path):** `footerFor` can now mint a real link on the local deployment. The
  origin it builds from is `CONVEX_SITE_URL`, NOT `SITE_URL`; a footer pointing at the Next app is a
  dead link the middleware will refuse.
- **19-10 (UAT):** the landing and confirmation pages have **never been looked at by a human**. They
  are inline-styled from BRAND hex and match no screenshot. Both need an eyeball, and the confirm
  button's white-on-`#009689` fill is the one contrast decision worth checking on a real display.
- **A hosted deployment still has no `UNSUBSCRIBE_SECRET`.** Setting it is per-deployment; the value
  set here is local-only.
- `graphify-out/*` was dirty from a prior session throughout this plan and is deliberately not in any
  of these commits. All three commits use the pathspec form.

## Self-Check: PASSED

- `packages/backend/convex/http.ts` — FOUND (`pathPrefix: "/unsubscribe/"` present twice, GET + POST)
- `packages/backend/convex/contacts.test.ts` — FOUND (48 tests, +8)
- `docs/playbooks/cockpit.md` — FOUND (`19-04` present, `check-playbooks.mjs` exit 0)
- `docs/playbooks/contacts-crm.md` — FOUND (`19-04` present, invariants 9 + 10)
- commits `f4ee077`, `9cb5fed`, `2e641b0` — all FOUND in `git log`
</content>
</invoke>
