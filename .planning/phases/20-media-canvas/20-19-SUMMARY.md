# 20-19 — SUMMARY

**Plan:** vendor price + endpoint-health drift detection. **Status: complete** (2026-08-02).
Cost: **$0** — the catalog endpoint is unauthenticated and no model is invoked.

Closes D5(b). The shipped fixture test compares our table to our **own** committed fixture, so it
catches a table edit that forgot the fixture and **cannot** see vendor drift — both sides are ours.
Nothing read the vendor on any cadence; the `-preview` retirement risk `media.md` names had no
detector at all.

## What shipped

| File | What it is |
|---|---|
| `packages/backend/scripts/check-fal-catalog.mjs` | the three-outcome check. No new dependency — `fetch` is global on Node 18+ |
| `packages/backend/package.json` | `check:fal-catalog` |
| `.github/workflows/fal-catalog.yml` | weekly (`17 6 * * 1`) + `workflow_dispatch`. **No secrets** |
| `docs/playbooks/media.md` | D5(b) rewritten around the command; all three observations recorded |
| `docs/playbooks/ci-gate.md` | the `fal-catalog.yml` section, next to the `skillopt.yml` vacuity warning it was written to avoid |

## ALL THREE OUTCOMES OBSERVED — 2026-08-02, before the workflow was trusted

| Seeded | Exit | Observed output |
|---|---|---|
| nothing (live catalog) | **0** | `AGREE — every pinned id is live, public, and priced exactly as the fixture records.` + four `OK` lines |
| one character in `inworld-tts`'s pinned string (`per 1000 character` → `characters`) | **1** | `DRIFT fal-ai/inworld-tts`, `pricingInfoOverride CHANGED`, fixture and vendor strings on adjacent lines |
| `FAL_CATALOG_BASE` → an unroutable host | **2** | `UNREACHABLE — could not read fal's catalog. This is NOT a price verdict:` / `fetch failed` |

`media.fixtures.json` diffed **byte-identical** to its pre-seed state after restore.

**The third row is the reason the check has this shape.** `STATE.md` records that `skillopt.yml` has
been reporting green for a year because a `|| true` swallows its failing step. A monitor that reports
green when it could not reach the thing it monitors manufactures confidence — the same defect by a
different route. Exit 2 also does not collapse into 1: waking someone for a network blip trains them
to ignore the alarm that matters.

## Design decisions worth knowing

1. **It diffs the STRING, never a parsed number.** A regex that extracts `$0.05` and compares
   numerically silently passes a vendor edit that changes the **unit** — "per second" → "per
   generated second" is exactly the class of change ADR-011 exists to refuse, and it moves no number
   at all. The fixture already stores the verbatim string, so equality is both stricter and less code.
2. **`billingMessage` is diffed as well as `pricingInfoOverride`.** For FLUX schnell the
   `billingMessage` (the rounding RULE) is the only vendor-direct part; diffing only the price string
   would leave it unwatched.
3. **FLUX schnell needs no special case.** The general rule is *an entry with no pinned price string
   is checked for flags and presence only* — and if the vendor ever **starts** publishing one, that
   IS a drift, because the MEDIUM confidence becomes resolvable. Confirmed live on 2026-08-02:
   **still absent, still MEDIUM.**
4. **A MISSING id is a drift, not an error.** That is the `-preview` retirement, and it is the one
   that silently breaks the product.
5. **`process.exitCode`, never `process.exit()`** — the latter can truncate stdout, and a truncated
   diff is the second-most-annoying failure mode of a check like this.
6. **Not a vitest test, deliberately.** A network call in the unit suite makes `pnpm test` flaky,
   non-offline and non-free, and CI would go red on a vendor outage that says nothing about our code.
7. **Not a merge gate.** `schedule` + `workflow_dispatch`, never `pull_request`: a vendor price
   change is a task for a human, not a reason to block someone's unrelated PR.

## The four ids AS THE CATALOG RETURNED THEM, 2026-08-02

A dated re-confirmation of 20-01's preflight — all four `OK`, meaning `status: public`,
`deprecated: false`, `removed: false`, and price strings byte-identical to the fixture:

- `fal-ai/wan-25-preview/text-to-video` — **the `-preview` rename risk still has not fired**
- `fal-ai/inworld-tts`
- `fal-ai/elevenlabs/speech-to-text/scribe-v2` — the +30% keyterm surcharge wording unchanged
- `fal-ai/flux/schnell` — **still no `pricingInfoOverride`**, so $0.003/megapixel remains
  secondary-sourced and MEDIUM. The first invoice, or the first published string, resolves it

## One thing this plan did NOT do

`skillopt.yml`'s own `|| true` is **still there.** This plan avoided repeating the pattern; it did
not fix the original. That remains `ci-gate.md`'s recorded gap and needs an owner.

## Registration note — a foreign session got there first

While this was being built, an unrelated session (profile-tabs) hit the §9 creation gap on the
still-untracked `check-fal-catalog.mjs` and registered it under `media.md` in `watch.json`,
explicitly noting it had classified the file without reading or running it. **The registration it
chose was the correct one and is kept**; the playbook note was rewritten to record that the media
lane has since authored, run and verified the script.

## Verification

`node --check` clean; live run exit 0; both seeded failures observed; full backend **942/942 across
56 files** (unaffected — this is not a vitest test); backend typecheck **13, delta 0**; biome clean
on the new script; a grep asserts the workflow contains no `|| true`, `continue-on-error` or
`if: always()` in executable YAML; `check-playbooks` satisfied for `media.md` and `ci-gate.md`.
