# 25-16 admission and isolation evidence — 2026-09-21

Status: **repository implementation and controlled browser acceptance complete**.

## Current executable evidence

- `convex/invites.test.ts`: valid provider-qualified admission is idempotent and refusals leave no
  orphan identity state.
- `convex/isolation.test.ts`: runtime-derived classification/owner guards plus non-empty A/B rows
  driven through production tenant APIs and export.
- `convex/httpBoundary.test.ts`: actual router behavior for valid public bearers, malformed/tampered
  tokens, stage/path/query mismatch, unsupported methods, and the private SkillOpt bearer.
- `apps/web/e2e/admin.spec.ts`: controlled owner/non-owner `/admin` mount and control boundary.

Focused backend result: **132/132 passed** across invites, isolation, HTTP boundary, export, and
erasure. Playwright discovery found the setup, admin, and first-send specs (**3 tests / 3 files**).

Controlled local browser result: **2/2 passed** for dual-identity auth setup and the Admin boundary.
The run proved the primary identity denied as a non-owner, temporary owner bootstrap, waitlist invite
minting with the one-time link retained after the reactive queue row disappeared, foreign-identity
denial, and guaranteed owner revocation in cleanup. The fixture was re-queried as non-owner before
the succeeding run.

The acceptance run also repaired two defects found by observation: Node 24 on Windows can return
valid Convex CLI JSON before a shutdown assertion, so setup now validates the result instead of
trusting only the process status; and the Admin UI now retains a freshly issued invite in session
memory after it leaves the pending query.

## Scope boundary

No hosted identity, provider, deployment, paid, legal, or Wave 8 evidence is inferred from this
controlled local proof.
