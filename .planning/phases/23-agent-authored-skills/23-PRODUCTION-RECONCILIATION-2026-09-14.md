# Phase 23 production reconciliation — 2026-09-14

This record closes the read-only state check required after the interrupted authorized authoring
probe. It records production state only; it does not authorize another model call, evaluation, or
activation.

## Exact source and authorization

- Deployed source under test: `07350fc122ece7d2fbb5ddc5051e699fb2e81d57`.
- Authorized continuation run: `b819287a-d61d-4c10-ae7d-36321ab59d22`.
- Authorization SHA-256:
  `f9cdd5d3700b34742bbaa0506091cc4c93e99d88eea3e65cc355e202bf787178`.
- Production deployment hash returned by the exact-source inspector:
  `b8c08f7d1a5e16e1c80eb69ccdd1c9870a923d4479387c1f1c28439bc39a49bf`.

## Read-only recovery and results

The failed Playwright run's `phase23-budget-recovery` attachment had been replaced by later test
runs. The budget was therefore recovered without replaying the probe: the controlled owner's
tenant was resolved through `owner:inspectUsersByEmail`, and the bounded reasoning ledger window
was queried through `spendLedger:listEvents`. Exactly one `eval_envelope` matched the authorization
hash above.

- Budget ref: `ps76dmw7zp8rngqbdbcddw6f558edfxc`.
- Source thread ref: `m57929vc8gh530905dxbs799hd8ecmv4`.
- Budget: closed and expired; cap 100 cents; actual spend USD 0; call count 0; settled count 0;
  unsettled count 0; unresolved cents 0; breached false.
- Authoring probe: started 0; finished 0; failed 0; containment refusals 0; policy acceptance false.
- Exact source inspection: active count 0; candidate count 0; total row count 0; authoring tool
  calls 0; approved plans 0; audit rows 0; requests 0.
- Authenticated `/ops`: `No tenant skill candidates awaiting review.`

The source inspector exits non-zero when it does not find exactly one agent row. In this
reconciliation that refusal is expected: its emitted read-only JSON showed zero rows for the exact
tenant and source thread. No candidate ID exists to freeze into a live handoff.

## Disposition

The prior authorization expired unused at the backend boundary. The browser-visible sequence must
not be described as a completed candidate authoring turn: production recorded no root submission,
no provider call, no spend, and no candidate. The one-shot locks remain historical evidence and
must not be removed to reuse the expired authorization.

Any new authoring probe needs a fresh, bounded authorization. Full evaluation remains a separate
authorization after a new candidate and certified `23-LIVE-HANDOFF.json` exist. Activation remains
an owner UI action after exact-version evidence and the required non-owner refusal check.
