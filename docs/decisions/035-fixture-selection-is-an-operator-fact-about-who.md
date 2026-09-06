# ADR-035: An offline fixture is selected by an operator fact about WHO, never by a string in a payload

- **Status**: **Accepted** — 2026-09-06.
- **Supersedes**: nothing. Completes the rule `lib/models.ts` `offlineSeamAvailable()` introduced on
  2026-08-28 (the positive keyless opt-in) by adding the second operator fact that rule could not
  express.
- **Does NOT supersede**: `offlineSeamAvailable()` itself (still the only path on a keyless
  deployment), the `fixture` tier of `ENV_MANIFEST`, CLAUDE.md §4 (redact-then-write), or the eval
  runners' refusal of sentinel turns in fixtures.
- **Evidence**: `.planning/phases/36-smoke-sentinels-out-of-band/36-RESEARCH.md` (the census);
  `.planning/phases/29-unified-knowledge-and-routines/29-SMOKE-SEAM-DEBT.md`;
  `packages/backend/convex/lib/env.ts` (`isFixtureTenant`), `lib/models.ts` (`fixtureSeamFor`),
  `fixtureSeam.test.ts`.

## Context

Every offline fixture in this repository is chosen by a `SMOKE::` sentinel. Until this decision,
most of those gates matched the sentinel against CONTENT — a vault document's own text, bytes a Drive
import wrote, a tool argument the model composed inside a loop whose context carries retrieved
documents, the cockpit message. On a fully keyed production deployment that meant a stranger who could
get one `.md` file into a tenant's Drive could write that tenant's entity graph, assert a document's
classification, or mark a document `ready` with no vector behind it; and an injected document could
steer the agent into a `SMOKE::` argument that returned fabricated mailbox evidence.

The 2026-08-28 fix — `PIKAR_OFFLINE_FIXTURES=1` AND no model key — was the right shape and could not
be applied to the rest, because the browser suite (15 specs) and four smoke scripts drive those exact
sentinels against the KEYED dev deployment, where that predicate is false by construction. Closing the
gates naively would have broken the landed suites; leaving them was the audit's G24.

## Decision

Fixture selection is a conjunction of TWO things, and only the second may come from the payload:

1. **An operator fact about WHO may receive fixtures**, `fixtureSeamFor(tenantId)`:
   `offlineSeamAvailable()` (keyless opt-in: everyone on that deployment) OR `tenantId` is listed in
   `PIKAR_FIXTURE_TENANT_IDS` (a comma-separated allowlist set only through `convex env set`).
2. **The sentinel**, which now only SELECTS which fixture, never whether one runs.

Every gate in the census carries the conjunct. `parseSmoke` and `parseAgentSmoke` take the tenant id
and return `null` without it, so a caller cannot forget. `PIKAR_FIXTURE_TENANT_IDS` is a
`fixture`-tier manifest name, so the readiness screen lists it, and `ops.envCheck` now reports a
deployment NOT ready while any fixture-tier name is set.

## Why an allowlist is acceptable on a deployment that holds credentials

The debt register asked this question explicitly. The answer is that the allowlist is a statement
about identity, not content: no document, email, folder name, upload or model-composed argument can
add a tenant id to a deployment's environment. On dev it names the e2e user and `"smoke"`; on
production it is unset, so every gate is unreachable regardless of what anyone writes. The
misconfiguration direction is narrower than the keyless flag's: listing a real tenant on production
exposes that one tenant's own sentinel-prefixed content to fixtures, visibly (the readiness screen
turns red and names the variable), rather than fabricating for every tenant silently.

## Consequences

- The sentinel grammars, fixture bodies, browser specs, smoke payloads and the unit suite's
  suite-wide consent are unchanged. The unit suite runs keyless with the opt-in, so
  `fixtureSeamFor` is true for every test tenant; the negative tests stub a key to prove the other
  direction.
- Dev needs one env var. Production needs nothing and must show nothing under "Fixture seams
  ACTIVE".
- A future seam must use `fixtureSeamFor(tenantId)` and a `startsWith` selector; a seam without a
  tenant in scope has no business existing.
- The cleaner end state — a mock model provider and no sentinels — remains the tool-registry
  phase's job; this decision does not preclude it.
