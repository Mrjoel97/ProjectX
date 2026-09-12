# apps/web E2E (Playwright)

The repo's **first UI E2E harness** (added in plan 03.1-02). Config lives in
`../playwright.config.ts` (testDir `./e2e`, one `chromium` project, baseURL
`http://127.0.0.1:3111`).

## Running

```bash
pnpm --filter @pikar/web test:e2e   # or, from repo root: pnpm test:e2e
```

## Auth (storageState)

Cockpit pages live behind the `(app)` auth gate, so specs run signed-in. The `setup`
project (`auth.setup.ts`) signs in ONCE via the real `/signin` password form and saves the
session to `e2e/.auth/user.json` (git-ignored — it holds a live token); the `chromium`
project reuses it via `storageState`.

Set the credentials of a **seeded test user** that exists in the live local Convex
deployment:

```bash
export E2E_USER_EMAIL="e2e@pikar.test"
export E2E_USER_PASSWORD="…"
```

The setup throws with a clear message if these are unset. To seed the user, sign up once at
`/signup` (or via a Convex mutation) against the running deployment.

## Prerequisite: the local dev backend must be running

Specs drive the **offline `SMOKE::` delivery path**, which needs the live local
backend. Before running specs, both must be up (per STATE.md):

- `convex dev` (NOT `--once` — `--once` pushes then stops the workpool, so async
  `onComplete`/scheduler steps never advance)
- `next dev` (serving on :3111)

Playwright does **not** auto-start them: `playwright.config.ts` uses
`reuseExistingServer` semantics (no `webServer` block), mirroring the
`scripts/smokeRun.mjs` live-deployment convention. A blank page at :3111 or a
"local backend isn't running" error means the process died, not that a spec broke.

## `convex run` ENDS THE BROWSER SESSION on a local deployment (measured 2026-08-14)

A spec that stages fixtures through `npx convex run` against the **local (anonymous)** backend on
`:3210` signs the browser out. Measured, not inferred: a context restored from `storageState`
reaches `/dashboard`, one `convex run` lands (CLI exit 0), and the very next navigation is
`/signin`. The saved `storageState` is dead from that moment, and so is any session the `setup`
project just minted.

So a spec that needs internal-mutation fixtures must **stage first and authenticate after** —
`media-canvas.spec.ts` signs in once to learn its tenant id (the JWT subject, which is what
`requireTenant` uses), stages, then signs in again. Its `signIn()` helper carries the note. Specs
that only read public data are unaffected.

## Provisioning an owner (27-11)

The pack candidate preview is owner-only, so the browser evidence plane needs a signed-in OWNER —
and `auth.setup.ts` only signs an EXISTING user in. `provision-owner.setup.ts` creates one:



It seeds an invite, signs up through the real form, grants owner by id, and seeds the onboarding
profile. Idempotent: it checks for the account FIRST, because the first successful signup redeems
the invite and a second attempt leaves Create Account disabled forever.

**Do not reuse `e2e@pikar.test` for this.** It pre-exists with a password nobody has, so the signup
silently no-ops, the owner grant lands on the old row, and sign-in then fails "Wrong email or
password" while every step looks like it worked.

## The onboarding gate

A tenant with no committed business profile is force-redirected to `/dashboard/onboarding` by the
`(app)` layout and cannot reach any other route. `onboarding:__seedOnboardedTenant` is the
sanctioned way past it: idempotent, offline, no credits.

## Specs

### Phase 30 free vertical controls harness (authenticated run remains pending)

`vertical-packs.spec.ts` defines 24 opt-in cases: six workflow types at 1280×1000 and 390×844,
with separate workload confirmation and eligible suggestion disable/restore checks. It uses the
existing `chromium` authentication/storage-state setup. It checks the actual browser JWT tenant,
app origin, WebSocket backend host, and each `verticalPacks.discover` candidate row/version before
interaction. Missing or mismatched fixtures fail. A control case skips only when native release
evidence or tenant selection is absent, with an explicit reason; a skip certifies nothing.

List the spec without authentication, browser launch, network or provider spending:

```bash
pnpm --filter @pikar/web test:e2e -- e2e/vertical-packs.spec.ts --project=chromium --list
```

For a later authorized authenticated run, set `PIKAR_VERTICAL_CONTROLS_E2E=1` and
`PIKAR_VERTICAL_CONTROLS_FIXTURE` to a local, uncommitted JSON file. Supply the normal auth
credentials or `PIKAR_E2E_STORAGE_STATE` and the matching `PIKAR_E2E_BASE_URL` from this README.
The fixture is a closed object with these fields:

| Field | Required value |
| --- | --- |
| `dedicatedDisposableTenant` | `true`; never use a customer's working tenant |
| `appOrigin` | Exact browser application origin |
| `convexUrl` | Actual backend deployment URL; must match the browser's WebSocket host |
| `tenantId` | Exact durable subject of the authenticated test identity |
| `candidates` | Six entries, one each for `legal`, `hr`, `product`, `design`, `engineering`, `data` |
| Each candidate | `{id, candidateId, candidateVersion, sources}`; row id/version must match live discovery |
| Each `sources` | Exactly two `{docId, title}` objects naming distinct, already provisioned, ready, unsealed owned documents |

The picker walks at most 40 native pages of five and fails if exact sources are missing or titles
are ambiguous. Use non-sensitive test documents. It saves through the real form, checks persisted
references and unchanged review/playbook preferences, waits for the subscription's `aria-busy=false`
before absence assertions, and checks horizontal overflow at each viewport. Released controls
are disabled/restored through the real UI; server state is read back independently. The harness
never clicks Start, calls a model/preview action, seeds a registry row, grants ownership, changes
release status, or writes evaluation/browser/UAT evidence. Existing eligible Start buttons are
checked only for correct availability.

Reversible preferences and valid previous example references are restored through public product
mutations in cleanup, including after a failed assertion. Cleanup failures fail the case and annotate
that state may remain modified. Historical confirmation/server timestamps cannot be deleted or
backdated through this API, so each write leaves an explicit `retained-history` annotation and
requires a disposable tenant. No hidden cleanup endpoint is used. Tests run serially without retries,
Playwright traces, screenshots or video; use the listing above for local qualification.

This is preparation for authenticated **control** verification. It does not prove useful/partial
outputs, exact runtime provenance display, artifact persistence, two-tenant workflow isolation,
external-effect absence, per-pack human review, or all-six workflow UAT. Those live obligations and
the exposure decision remain separate; no release is enabled by this spec.

### Phase 23 two-identity preparation and opt-in browser proof (live run remains pending)

`PIKAR_PHASE23_TWO_IDENTITIES=1` opts into two seeded password users. Supply the usual
`E2E_USER_EMAIL/PASSWORD` and distinct `E2E_FOREIGN_USER_EMAIL/PASSWORD`. Setup resolves both
durable user ids, refuses owners/ambiguity, seeds onboarding before authentication (CLI calls can
invalidate sessions), and verifies fresh JWT subjects/expiry before saving the two gitignored
states `e2e/.auth/user.json` and `e2e/.auth/foreign.json`. Setup never grants ownership.
The single Chromium project runs serially without retries or traces in this mode. Owner provisioning
and storage-state overrides are refused because either would bypass the non-owner-first boundary.
Use `playwright test --project=setup` to prepare only; ordinary feature runs remain unchanged.

`agent-skill-authoring.spec.ts` is the serial live harness. In addition to the identity flag, it
requires `PIKAR_PHASE23_BROWSER_PROBE=1`, `PIKAR_PHASE23_ALLOW_OWNER_BOOTSTRAP=1`, the SHA-256 of
the explicit browser-spend authorization in `PIKAR_PHASE23_BROWSER_AUTHORIZATION_SHA256`, and the
high-entropy `PHASE23_PRIVATE_NEEDLE`. Set these only after the actual live checkpoint. The harness
runs free gates, verifies both non-owner surfaces, bootstraps only A, then sends exactly two ordinary
cockpit turns (one explicit adaptation and one escalation refusal). B remains non-owner. It resolves
the browser's actual source (`--inspect-agent-source <tenantId>:<sourceThreadId>`), requires duplicate
identical readbacks, and checks real candidate/provenance/governance, owner desktop/mobile rendering
and foreign isolation before exclusive handoff creation. A routing failure stops without substituting
a direct candidate write or changing a skill body. No paid evaluation or activation is included.

List without authenticating or spending:
`pnpm --filter @pikar/web test:e2e -- e2e/agent-skill-authoring.spec.ts --project=chromium --list`.
The actual authorized probe uses the same command without `--list`. The existing tenant/deployment
model budgets govern both turns; authorize those configured budgets at the live checkpoint. The
harness does not manufacture a separate per-probe spending reservation or claim that a prompt is a
budget control. After an interrupted bootstrap, use the retained exact identities and checkpoint
state; do not rerun setup against an already-owner A or create a substitute candidate.

The reusable validator is
`.planning/phases/23-agent-authored-skills/validate-live-artifact.mjs`. It exports
`validateArtifact(kind, value, context)` and `writeImmutableArtifact(path, kind, value, context)`;
the writer uses exclusive creation and refuses overwrite. Context must contain the original private
adaptation needle (at least 24 characters), plus original handoff bytes for `eval`/`live`, and original
eval-result bytes for `live`. The CLI reads prerequisite artifacts from the same directory and fails
when the named secret environment variable is missing. Never put the needle on the command line.

All three schemas are recursively closed. The handoff records candidate identity, source/lineage,
baseline/effective/global/foreign snapshots, fixed auth path labels and browser witness counters.
Eval/live artifacts bind the exact prior bytes, same candidate/deployment/suite, non-owner refusal
state and owner activation/rollback. Browser fields are observations supplied by the operator, not
facts a JSON validator can independently certify. No live artifact is created by the self-test.
CI runs the schema/secret probes and lifecycle checks through `check-phase23-artifacts.mjs`.
It also runs `check-phase23-owner-boundary.mjs`: the missing Phase 23-05 backend downgrade is tested
only in a Vitest memory transform, with fetch disabled and without inherited provider credentials.
Clean/red/fresh-clean processes and unchanged source-byte hashes must all pass.

- **Plan 05** (SC1) — `cockpit-render` (two panes render under the auth gate) +
  `cockpit-split` (divider drags, clamps ≥20%, keyboard-nudges, persists across reload).
- **Plan 09** — cockpit-report / connect-gmail (SC5) — pending.

## Phase 23 production continuation

For the opted-in two-identity authoring probe, set `PIKAR_CONVEX_TARGET=prod` together with the
production `PIKAR_E2E_BASE_URL`. Auth preparation and all direct source/owner queries now forward
the same explicit target as the golden inspector. Keep the actual deployment URL privately in
`CONVEX_URL` for consistent inspector fingerprints. No environment value belongs in evidence.

After a real handoff exists, the read-only continuation check is
`node .planning/phases/23-agent-authored-skills/phase23-operator.mjs preflight handoff
.planning/phases/23-agent-authored-skills/23-LIVE-HANDOFF.json --forbid-env PHASE23_PRIVATE_NEEDLE`
from the repository root. It observes exact stored state; it does not authorize or execute paid
evaluation. See `23-EXECUTION-PREPARATION.md` for the remaining aggregate-budget prerequisites.
