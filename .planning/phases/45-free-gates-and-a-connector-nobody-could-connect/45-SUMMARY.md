# Phase 45 — The gates nobody ran, and a connector nobody could connect

**Opened and closed 2026-09-09.** Ten plans: `d8fab20` (45-01), `3b65412` (45-02), `d32acf5`
(45-03), `76db16c` (45-04), `a2d2e77` (45-05), `634124e` (45-06), `e34a447` (45-07), `3b993a6`
(45-08), `8a935cd` (45-09) and this commit (45-10). Seven carry `[deploy]`; the last three are
records, with nothing to promote.

Built commit-by-commit from the merged order and the owner's terminal items — this phase has NO
`45-0N-PLAN.md` files, which is why its record is one phase-level SUMMARY rather than ten per-plan
ones, the same shape as Phase 43 and Phase 44.

The phase opened on one owner instruction ("run the QuickBooks lane with production keys, and close
the two gaps that keep perpetuating themselves every time I keep building") and ended having closed
both gaps and having proven the QuickBooks blocker is not ours.

## 45-01 — the runbook nobody could execute (`d8fab20`)

The QuickBooks lane was blocked, and not on a credential or a decision — `quickbooks-suitability.md`
had recorded `decision: approved_production` since 2026-08-27. Step 2 of the OWNER RUNBOOK could not
be executed **by anyone**: `sealGate` is an `ownerMutation`, `npx convex run` carries an admin key
with NO user identity (`UNAUTHENTICATED`), and no UI calls `sealGate` either. `providerGates` was
therefore EMPTY on production and unwritable.

Fixed by splitting the handler into a shared `sealGateFor(ctx, args)` and adding
`sealGateAsOperator` (an `internalMutation`), mirroring the shipped
`activateSkillVersion`/`activateSkill`/`activateCandidate` shape and its stated reasoning. The owner
surface is untouched and still pinned by `isolation.test.ts`; an admin key already outranks the
owner, so this grants nothing new. `check-provider-lane.mjs --apply` now honours
`PIKAR_CONVEX_TARGET=prod` and calls it through `process.execPath` + the convex bin with no shell,
because Windows `shell: true` strips the quotes out of a JSON payload.

Also here: `run-eval-golden.mjs` had **no teardown**, which is the root cause of the synthetic data
45-02 went on to purge.

## 45-02/03/04 — the production data the eval harness left behind

Measured, then removed:

| | before | after |
|---|---|---|
| `audit` rows | 1894 (1225 synthetic) | 672 (0 synthetic) |
| `plans` rows | 632 | 51 |
| `vaultDocuments` | 733 | 59 |
| storage | 438 blobs / 218 MB, 140 orphaned | 175 blobs / 150.5 MB, 0 real orphans |

`purgeEvalTenant` is prefix-guarded (`/^(eval|packeval)-/`) and uses a prefix RANGE rather than
equality, because derived tenants are named `eval-<runId>-<fixture>-a<n>`. `reapOrphanedBlobs`
builds its reference set from the same `STORAGE_ID_FIELDS` map Phase 44 introduced, and refuses to
touch anything younger than `ORPHAN_REAP_MIN_AGE_MS` (24 h) — the two orphans remaining at close are
both inside that window and are protected, not missed.

**Three of my own errors during this work, each caught before it did damage and each worth keeping:**

1. **Predicate drift.** I audited "before" with `.startsWith("eval-")` and "after" with
   `/^(eval|packeval)-/`, which made it look as though 485 real `vaultDocuments` had been destroyed.
   Diffing the row `_id`s showed 0 real rows lost. Compare two measurements only when the SAME
   predicate produced both.
2. **A purge loop that reported success on failure.** Its `0 0 true` fallback was indistinguishable
   from "done", and 90 `packeval-*` tenants survived silently. Re-run with errors surfaced.
3. **A wrong orphan count of my own (142).** I omitted the `attachments` table; the mutation's 140,
   derived from `STORAGE_ID_FIELDS`, was right. The declarative map beat my hand count.

## 45-05 — the callback forwarder, on a premise later disproved (`a2d2e77`)

Added `apps/web/app/connectors/[provider]/callback/[environment]/route.ts`, a server-side forwarder
that takes only the PATH from the upstream redirect (`${resolved.pathname}${resolved.search}`), so an
open redirect is unreachable even if `SITE_URL` were misconfigured. Five tests.

**Its commit subject — "Intuit refuses a convex.site redirect URI" — is FALSE, and 45-10 proved it.**
That belief came from the owner's report, and it was never tested. The route is harmless and stays
(it is real, tested, and useful if the callback must move to our own domain), but the reason given
for building it was not established. Recorded here rather than quietly left standing.

## 45-06 — the two gaps that kept recurring (`634124e`)

**Gap one: red gates nobody ran.** Sixteen scripts carry an offline `--self-test` / `--self-check`
mode — zero-cost checks that exist to redden BEFORE anyone spends money or touches a deployment —
and no automation had ever invoked one. Two were found red BY ACCIDENT this week: the pack harness
had asserted `PACK_EVAL_SUITE.packs.size === 6` since 35-02 added a seventh, and
`check-provider-lane --self-test` failed three checks whose premises had been borrowed from the real
tree and expired.

`scripts/check-free-gates.mjs` now runs in CI between Lint and Test. Its registry is a HAND-WRITTEN
allowlist that fails when the filesystem and the list disagree in EITHER direction — deriving it
from the scan would make the file agree with whatever it found, which is not a check. Exit codes are
read DIRECTLY from `spawnSync`, never through a pipe, because a pipeline reports the exit of its
LAST stage. Its own `--self-test` runs first as a separate command.

All three `check-provider-lane` failures were stale premises, not logic breaks: "hubspot's lane is
unbuilt" and "stripe's allow-list is empty" were true when written and false once someone did the
work they assumed nobody had done. Each now BUILDS its premise into the fixture, and a new
`mustReplace` helper throws when a substitution matches nothing — `String.replace` with a stale
pattern returns the input unchanged, and the fixture then quietly asserts against the real tree.

**Gap two: checks that cannot fail.** `expect(locator).toHaveCount(0)` succeeds on its FIRST poll,
so an absence assertion placed straight after a `goto` passes against "Loading…" and reports it as
proof. `scripts/check-absence-guards.mjs` flags only an absence assertion with nothing before it in
its own `test(` block — a blanket rule would flag 82 sites on day one, and a gate red for a
non-reason stops being read, which is the failure the whole family exists to prevent.

**The scanner's first run flagged five sites and FOUR WERE ITS OWN BUG** — a `toBeVisible\(\)`
pattern requiring EMPTY parens, which cannot match the `toBeVisible({ timeout: 15_000 })` this
codebase actually writes. Had they been "fixed", four healthy tests would have gained redundant
assertions to satisfy a broken detector and the bug would have been laundered into the suite. One
was real (`reports.spec.ts`). Reading every flag before acting on it is what caught this.

`workflow-pack-pilot.spec.ts`'s `@dark` block is fixed properly: its precondition is read OUT OF
BAND from the deployment (`somePackIsLive()`, memoised), never from the page it is asserting about —
skipping based on that page would make the block unfalsifiable all over again.

## 45-07 — the new gate's first red was real (`e34a447`)

The free-gates step reddened on its very first CI run. Not a bug in the gate: `ci.yml` pinned
`node-version: "20"` while `deploy-production.yml` built on `"24"` and every developer machine ran
24. `run-workflow-pack-evals.mjs --self-test` strips TS types natively (floor 22.6) and exits **2**,
its documented ENVIRONMENT ABORT, on anything older.

The finding is larger than the one red script: **typecheck, lint, test and build had never once been
verified on the Node that production ships.** `ci.yml` and `skillopt.yml` moved to 24;
`engines.node` is now `>=24`, deliberately NOT the `>=22.6` those two scripts individually need,
because a version range nobody exercises is a claim with no check behind it — the exact failure mode
this phase was spent on. A comment at `runGate` records why an exit 2 must STAY red: "the
environment could not run the check" is indistinguishable from "nobody ran the check".

## 45-08/09/10 — QuickBooks: diagnosed, and the blocker is Intuit's

The owner supplied production keys and asked for the lane. It does not connect, and after three
rounds of measurement the cause is established and is not ours.

**The keys are correct.** They live in the root `.env` as `INTUITAPP_CLIENT_ID` /
`INTUITAPP_CLIENT_SECRET` — not `QUICKBOOKS_*`, which is why a grep for the wrong spelling reported
them absent and briefly made "wrong keys on prod" the leading theory. By SHA-256 (values never
printed) the deployment pair is byte-identical to `.env`.

**The chain, every link measured:**

1. `POST /oauth2/v1/tokens/bearer` with a bogus code returns `invalid_grant`, not `invalid_client` —
   the app EXISTS and its credentials are provisioned.
2. The consent page reads "Sorry, but **undefined** didn't connect". That `undefined` is the app's
   DISPLAY NAME failing to resolve; given (1), appcenter cannot READ the app record.
3. The developer console cannot read it either: `developerdeveloper.api.intuit.com/v4/graphql`
   returns `responseStatus: 0` on its second call after a 200 on the first, and never retries.

ONE unreadable app record explains all four symptoms — the workspace list that never resolves, the
absent Create-workspace control, the missing Save button on Keys and credentials (the owner's own
report), and the refused consent.

**The decisive test:** the app's ONLY registered redirect URI is Intuit's Playground default.
Production was pointed at that exact string and consent STILL failed. A registered URI is refused,
so the redirect URI was never the variable — and the hours spent choosing which URI to register were
spent on the wrong question.

**Two methodological corrections, both mine:**

- I read "Intuit accepted the URI, so the failure is upstream" off the authorize error page. A
  FABRICATED client_id produces the identical page, so that surface discriminates nothing and the
  reading was unfalsifiable. The control costs one navigation and should have come first.
- I then suspected the OneTrust `Script error.`; OneTrust had in fact initialised normally. Dropped
  rather than built on.

`undefined` becomes evidence only when paired with (1), which independently rules out
non-existence. Two weak signals that constrain each other beat one strong-sounding signal read alone.

The reusable lesson is recorded in `docs/playbooks/connector-quickbooks.md`: probe the TOKEN
endpoint to test credentials, never the authorize page. A standby bridge is recorded for the case
where Intuit repairs the app record but not the console — point the redirect URI at the Playground,
consent, take `state`/`code`/`realmId` from the ADDRESS BAR, and call
`quickbooksAuth:handleCallback`, the same internalAction the HTTP callback invokes.

## State at close

**Closed:** both recurring gaps, now enforced in CI on the Node production actually ships;
production's synthetic data and orphaned blobs; the unexecutable seal step.

**Not closed, and honestly open:**

- **QuickBooks** — blocked on Intuit repairing this account's app record. `QUICKBOOKS_REDIRECT_URI`
  is restored to the convex.site callback (live, fails closed). The lane stays UNSEALED, correctly:
  no live read has happened, so there is nothing to seal. The four revenue skills
  (`revenue-specialist@1`, `revenue-invoice-reminder@1`, `revenue-cash-flow@1`,
  `revenue-payroll-confidence@1`) remain ungated behind it. A support ticket naming the failing call
  is in the playbook.
- **WORM stays OFF** — the `billingEvents` → Stripe bridge (ADR-044 C2) is untouched.
- Two mobile-viewport failures in `workflow-pack-pilot.spec.ts` (`@discovery`, `@preview`).
- Post-erasure re-export is unproven.
