# Playbook: Guardrails (the spend rails, the kill switches, the redaction choke point)

> Last verified: 2026-08-02 (created by 20-04 to close a standing §9 gap — `guardrails.ts` was in
> NO playbook's watch prefix, recorded in 20-RESEARCH §11.3 and never assigned. It is now covered
> here.)
> Build history: `.planning/phases/03-guardrails/`, `.planning/phases/22.1-*/` (22.1-02, the
> per-tenant keying), `.planning/phases/20-media-canvas/` (20-04, the media rail) ·
> Related ADRs: ADR-011 (media provider + separate cost cap)

## Purpose

`packages/backend/convex/guardrails.ts` is the **choke point every spend passes through.** It
answers three questions before any provider is called: *is the system stopped?* (kill switches),
*has this tenant any money left?* (spend windows), and *has the text been redacted?* (the PII scan
that must precede a model call). A governed refusal here is a **returned value**, never a throw —
an expected rejection is not a dead-letter failure.

**Why this file has its own playbook:** it is shared by two subsystems that must not be edited as
if they were one. The LLM rail serves the cockpit; the media rail serves Phase 20. Assigning
`guardrails.ts` to either subsystem's playbook would mean every change to one rail demands
verification of the other's playbook — claiming a review of a diff nobody read.

## Key files

| Path | Role |
|---|---|
| `packages/backend/convex/guardrails.ts` | the module: rails, switches, `prepare` / `preCall` / `recordSpend`, the two remaining-budget readers |
| `packages/backend/convex/guardrails.test.ts` | unit proof of both LLM rails against the REAL rate-limiter component |
| `packages/backend/convex/media.test.ts` | unit proof of both MEDIA rails, and that the two pairs never share |
| `packages/backend/scripts/run-smoke-guardrails.mjs` | `pnpm smoke:guardrails` — the end-to-end prepare/preCall-through-the-pipeline path against a live deployment |
| `packages/cost/src/cost.ts` · `packages/cost/src/media.ts` | the pure estimators. `guardrails.ts` never prices anything itself |

## The four windows

All four are named windows on **ONE** `RateLimiter` instance. A second `RateLimiter` would be a
second component mount for zero gain — add a name, not an instance.

| Window | Rate | Key | Consumed by |
|---|---|---|---|
| `dailySpendCents` | `DAILY_BUDGET_CENTS` = 500 | `tenantId` | `recordSpend`, AFTER the call |
| `deploymentSpendCents` | `DEPLOYMENT_BUDGET_CENTS` = 5,000 | **keyless** | `recordSpend`, AFTER the call |
| `mediaSpendCents` | `MEDIA_DAILY_BUDGET_CENTS` = 1,000 | `tenantId` | `media.reserveJob`, BEFORE the call |
| `deploymentMediaSpendCents` | `DEPLOYMENT_MEDIA_BUDGET_CENTS` = 10,000 | **keyless** | `media.reserveJob`, BEFORE the call |

Worst-case daily exposure: **$50 LLM + $100 media = $150.** The keyless ceilings are what bound it;
per-tenant keying alone makes exposure `N × budget`, unbounded in N. Each rail's deployment ceiling
is **10× its per-tenant window** — one ratio across both rails.

## Invariants — what must never break

- **The two rails NEVER share a window, in either direction.** ADR-011 and D10. `dispatch.ts`'s
  `ENVELOPE_FRACTION` takes its 25% out of the LLM rail *specifically*, so folding media spend in
  would silently shrink every sub-agent envelope. *Enforced:* `media.test.ts` — "THE RAILS NEVER
  SHARE", asserted in both directions.
- **`check` does not consume; `limit` does.** Both inside ONE Convex mutation is ONE serializable
  transaction. *Enforced:* `media.test.ts` concurrency test, observed RED when the check is resized
  or the limit is moved out.
- **Every keyed window's call sites pass `{ key: tenantId }`.** A call without a key silently shares
  one bucket across tenants — the exact bug 22.1-02 fixed. *Enforced:* `guardrails.test.ts` "tenant
  A exhausting its day does not refuse tenant B" and the media twin.
- **`reserve: true` on consumption, always.** The window goes NEGATIVE rather than under-counting,
  so the NEXT check fails closed. *Consequence:* every reader must clamp `>= 0` **before** any
  `Math.min`, or one negative rail zeroes everyone's budget. *Enforced:* the "clamps to 0" tests in
  both suites.
- **Governed stops RETURN a discriminated result; only bugs throw.** A missing row throws. An
  exhausted budget returns `{ ok: false, reason }`. Mixing the two turns an expected refusal into a
  dead-letter entry (03-RESEARCH anti-pattern 1).
- **Redact before you write, and before any model call.** `prepare` destructures ONLY `safeText` +
  counts from the scan — the raw-PII field must never appear in this file. `getSafeTextByHash`
  throws when `safeText` was never written, so a model call structurally cannot obtain raw goal
  text. *Enforced:* the 03-04 static scan.
- **Default-on-read: a missing `guardrailConfig` row means every switch is OFF.** Zero seed, zero
  migration. A newly added switch must be `v.optional` in the schema so pre-existing rows read OFF
  too. *Enforced:* `media.test.ts` "a missing guardrailConfig row reads BOTH switches OFF".
- **The kill switches are INDEPENDENT levers.** Pausing paid media generation must not pause the
  email cockpit, and vice versa. But a consumer MAY check both — `media.reserveJob` does, because
  an all-stop is an all-stop. *Enforced:* `media.test.ts` "setMediaKillSwitch … does NOT touch the
  global switch".
- **Every exported reader declares an explicit `Promise<number>` return type.** An inferred return
  type collapses the generated API to `any` (13-01 shipped 90 `apps/web` errors that way).

## The two consumption shapes — and when each is legitimate

This is the single most important distinction in the file, and getting it wrong is a money bug.

| | LLM rail | Media rail |
|---|---|---|
| Shape | `check` in `prepare` → **consume in `recordSpend` afterwards** | `check` **and** `limit` in the SAME mutation, **before** the first POST |
| Why it is safe | LLM calls in a turn are **serial**, and an overshoot is **cents** | 13+ provider jobs are submitted back-to-back and land minutes apart |
| What the other shape would cost | — | post-hoc recording lets every job pass against a window that had room for one. *An LLM overshoot is cents, a media overshoot is dollars* |

**Do not "unify" these two shapes.** The asymmetry is deliberate and is the whole content of D10.

## How to change safely

**Adding a new rail** (the 20-04 recipe, in order):
1. Two exported constants — per-tenant and a keyless ceiling at **10×**. Never alias an existing
   rail's numbers.
2. Two named windows on the existing `rateLimiter`. Comment the keyless one with *why* it is
   keyless, so nobody deletes it as redundant.
3. A `Promise<number>` reader in the `remainingDailyCents` shape: clamp each rail `>= 0` **before**
   the `Math.min`.
4. A test asserting the new rail does not move the old ones **and** the old ones do not move it.
   Both directions, or the test is half a test.

**Adding a kill switch:** `v.optional` in `schema.ts`, an entry in `DEFAULT_CONFIG`, and a setter
that is `setKillSwitch`'s upsert verbatim. Put the operator command in the doc comment.

**Changing a budget number:** it is a one-line constant edit — but re-read the consumers first.
`dispatch.ts` sizes sub-agent envelopes off `remainingDailyCents`, so lowering the LLM rail shrinks
every envelope proportionally.

**Never** add media spend to `dailySpendCents`/`deploymentSpendCents`, and never add token spend to
the media pair. See the first invariant.

## How to verify

```bash
# unit, $0, no deployment needed — both rails, both directions
pnpm --filter @pikar/backend test -- guardrails
pnpm --filter @pikar/backend test -- media

# end-to-end, needs a live deployment: prepare/preCall through the real pipeline
cd packages/backend && pnpm smoke:guardrails          # 7/7 expected

# operator levers (from packages/backend — the convex CLI only resolves the deployment there)
npx convex run guardrails:setKillSwitch      '{"on":true}'   # stops EVERYTHING incl. media
npx convex run guardrails:setMediaKillSwitch '{"on":true}'   # stops paid generation ONLY
```

## Known gaps & deferred work

- **No media equivalent of `recordSpend`.** The media rail reserves and never reconciles: if 3 of 6
  blocks fail, the reserved cents stay consumed. Over-reservation is the deliberate fail-closed
  bias; refunding would turn a rate-limiter window into a ledger. The upgrade path, if drift ever
  proves material, is a real spend table — not a credit call. The `ponytail:` note is at the site
  in `media.ts`.
- **The windows are fixed 24-hour windows, not rolling.** A tenant exhausted at 23:00 is refused
  until the window rolls, not for 24 hours. Accepted.
- **`run-smoke-guardrails.mjs` covers the LLM rail only.** There is no live smoke for the media
  rail; `media.test.ts` is unit-only against the real component. Plan 20-11's owner-run live gate is
  the first end-to-end exercise of `reserveJob`.
- **Media economics live in `media.md`, not here.** This playbook owns the *mechanism*; the job cap,
  the price tables, the §4.1 arithmetic and the reservation contract are `docs/playbooks/media.md`.
  A change to the media rail's NUMBERS bumps both.
