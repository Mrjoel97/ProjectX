---
phase: 28-connector-backed-revenue-pack
plan: 01
subsystem: revenue-connectors
tags: [governance, provider-admission, oauth, suitability, owner-decision]
requires: [28-17]
provides:
  - "docs/connectors/README.md — provider admission register, closed decision vocabulary, 90-day evidence expiry"
  - "Four independent machine-readable admission markers (`decision: approved_production`) at docs/connectors/*-suitability.md"
  - "Four named open conditions, each assigned to a downstream plan"
affects: [28-05, 28-06, 28-07, 28-08, 28-22, 28-23, 28-24, 28-25, 28-26]
tech-stack:
  added: []
  patterns:
    - "Admission by marker block, not by prose: `grep -h '^decision:' docs/connectors/*-suitability.md`"
    - "Testimony vs evidence split, per docs/connectors/phase28-readiness.md house style"
key-files:
  created:
    - docs/connectors/README.md
    - docs/connectors/hubspot-suitability.md
    - docs/connectors/quickbooks-suitability.md
    - docs/connectors/stripe-suitability.md
    - docs/connectors/paypal-suitability.md
  modified:
    - docs/playbooks/revenue-connectors.md
    - docs/playbooks/connector-hubspot.md
    - docs/playbooks/connector-quickbooks.md
    - docs/playbooks/connector-stripe.md
    - docs/playbooks/connector-paypal.md
    - .planning/phases/28-connector-backed-revenue-pack/deferred-items.md
decisions:
  - "HubSpot approved_production on the evidence: unlisted install cap accepted, Marketplace listing deferred"
  - "Stripe approved_production as an explicit OWNER OVERRIDE against its own record (revocation undocumented)"
  - "QuickBooks approved_production on OWNER ATTESTATION of live Intuit production credentials"
  - "PayPal approved_production on OWNER ATTESTATION of live partner acceptance with an assigned partner manager"
  - "No approved_beta stage was recorded for any provider — the beta step was skipped, not passed"
requirements-completed: []
metrics:
  duration: "~2h across two agents (Task 1 + checkpoint + Task 3)"
  completed: 2026-08-27
---

# Phase 28 Plan 01: Provider admission gates Summary

Four vendors were researched from primary documentation, four independent owner judgments were
recorded, and **three of the four rest on human testimony rather than on the evidence in their own
records** — which is the finding this plan exists to make legible.

## What shipped

- `docs/connectors/README.md` — the register: closed decision vocabulary
  (`approved_beta | approved_production | blocked | deferred | undecided`, where a typo reads
  `undecided`), the marker-block format, a 90-day evidence life (`review_by: 2026-11-27`),
  re-review triggers, the secrets rule, and the standing statement that `.mcp.json` is evidence of
  nothing.
- Four suitability records, each with a verified / could-NOT-verify split, both evidence dates
  (2026-08-05 research, 2026-08-27 re-verification), the one owner question no vendor doc can
  answer, and now one recorded decision.
- Five playbooks updated in the same commit (CLAUDE.md §9): the shared `revenue-connectors.md` and
  all four provider playbooks, whose "Admission blocker" sections were stale the moment the
  decisions landed.

## The four decisions — 2026-08-27

All four markers read `approved_production`. **There is no all-provider flag**; each record carries
its own marker, its own date, its own evidence refs, its own expiry and its own open condition.

| Provider | Decision | Basis | Kind |
|---|---|---|---|
| HubSpot | `approved_production` | Unlisted OAuth needs no HubSpot permission; install cap accepted, Marketplace listing deferred | **Evidence** |
| Stripe | `approved_production` | Owner approved after being shown that the record does **not** support production | **OVERRIDE** |
| QuickBooks | `approved_production` | Owner attests Pikar holds live Intuit production credentials (App Assessment Questionnaire approved) | **ATTESTATION** |
| PayPal | `approved_production` | Owner attests Pikar holds PayPal partner acceptance with an assigned partner manager on a live partner account | **ATTESTATION** |

### The testimony / evidence split — the load-bearing part

Only **HubSpot** is straightforwardly supported by its own record.

- **Stripe is an OVERRIDE, not a finding.** The record states — and still states — that production
  is not supportable today because platform-initiated revocation for Stripe Apps is undocumented,
  and 28-CONTEXT makes per-tenant revocation a hard requirement. The owner was shown that and
  approved anyway. The record says so plainly, in the decision section, the header blockquote, the
  header table, the register table and the playbook. It must never be restated as an
  evidence-supported decision.
- **QuickBooks and PayPal are ATTESTATIONS** of vendor approvals granted outside this repository.
  Nothing here checked them and no vendor page can. Both are written in the house style already set
  by `docs/connectors/phase28-readiness.md` — *"This is testimony, not evidence"* — with the owner's
  claim reproduced as a blockquote, dated, and followed by what happens if it is wrong (the approval
  is void and the provider is `blocked` again).

This repo has a recorded defect class in which supplied claims get laundered into observed facts by
being restated one document downstream. Three of four approvals here are exactly that shape, so the
qualifier travels with them into every document they reach.

## Open conditions — none resolved, all assigned

| Provider | Still open | Owner of the obligation |
|---|---|---|
| HubSpot | Does `POST /oauth/2026-03/token/revoke` invalidate already-issued **access** tokens? Docs silent; the legacy `DELETE` explicitly did not cascade. | **28-05 must TEST it** against a live grant; **28-22 must not seal** the lane without the result |
| Stripe | Platform-initiated revocation for Stripe Apps is **undocumented** | **28-24 must confront it.** Not closable by a green test — no test here can prove an undocumented API |
| QuickBooks | App Partner Program **tier unstated** (Builder = 500,000 CorePlus calls/workspace/month); write blast radius **accepted**, so the compile-time GET/query/report-only allow-list is **mandatory** | **28-06** (allow-list + poll budget), **28-23** |
| PayPal | **No revoke endpoint documented anywhere**; sandbox explicitly **non-probative** about production authorization | **28-25**, with the partner manager |

Also carried, unresolved, on all four: data-processing / commercial terms, retention & deletion
duties and data residency / subprocessors are **not researched**. The owner approved production
without them on record, and the records say so.

## Consequences for the phase

- **Every lane is unparked.** 28-05 through 28-08 may be built, and production discovery is
  authorized for all four providers — subject to the open conditions and to the wave-7 seals.
- **Nothing is blocked or deferred**, so no lane is parked and no lane blocks another.
- **A partial release completes no REVN requirement.** REVN-01, REVN-02 and REVN-03 — and therefore
  Phase 28 — close only when every provider they name holds a current production-suitability
  decision **and** a live read/revoke gate marked `passed`. `requirements-completed: []` for this
  plan: it created gates, it implemented no requirement.
- **All four approvals expire 2026-11-27**, or earlier on any re-review trigger — including any of
  the three human claims ceasing to hold.
- **No `approved_beta` marker was ever recorded.** The judgments were issued directly as
  `approved_production`; the production marker carries beta engineering authority, but the beta
  stage was skipped, not passed. Recorded as given, in every record and in the register.

## Deviations from Plan

### Auto-fixed issues

**1. [Rule 3 - Blocking] Five playbooks updated although the plan's `files_modified` names none**

- **Found during:** Task 3
- **Issue:** `docs/connectors/README.md` is watched by `revenue-connectors.md` and each suitability
  record by its provider playbook (`watch.json`), so the Stop hook blocks a decision-only commit that
  leaves them untouched. Worse, the content had gone actively wrong:
  `connector-stripe.md` still instructed "Pikar must be accepted/configured as an Extension" — a door
  Stripe closed ("You can no longer build new Connect extensions") — and all four still declared
  their lane `parked` pending an unanswered question that had just been answered.
- **Fix:** Bumped `Last verified` on all five and rewrote each "Admission blocker" section to lead
  with the recorded decision, its basis (evidence / override / attestation) and the surviving open
  condition, keeping the original constraint prose beneath it as the *reason*, not as a live gate.
- **Commit:** `7969e80`

**2. [Rule 3 - Blocking] Removed 11 untracked vendor-doc dumps left in the phase directory**

- **Found during:** Task 3
- **Issue:** Task 1's primary-source fetches left `auth.html`, `chk.html`, `llms.txt`, `other.txt`,
  `plat.html`, `pr2.html`, `pr2.json`, `rest.html`, `rl.html`, `rt.json`, `ts.html` untracked in
  `.planning/phases/28-connector-backed-revenue-pack/`, where a parallel lane's `git add` could
  sweep them in.
- **Fix:** Deleted. Their content is already distilled into the records and the evidence URLs.
- **Commit:** n/a (untracked files, nothing to commit)

### Not fixed — logged

`deferred-items.md` already records 28-02's `revenue-finance.md` playbook debt from Task 1. Nothing
new was added: the hook ran clean at the end of this task.

## Verification

| Check | Result |
|---|---|
| `echo '{}' \| node scripts/check-playbooks.mjs check` | Empty stdout — no `decision:block`. Run through stdin because the script blocks forever on a bare invocation and **exits 0 on every path**; stdout is the only signal. It did block once mid-task on `revenue-connectors.md`, which is how the playbook debt above was found — this gate was observed both red and green. |
| `node scripts/check-phase28-readiness.mjs` (not piped) | exit `0`, unchanged from the pre-task baseline |
| `grep -h '^decision:' docs/connectors/*-suitability.md` | four × `approved_production`, four × `decided_on: 2026-08-27`, four × `review_by: 2026-11-27` |
| `git diff --stat HEAD -- docs/` after committing | empty — HEAD matches the tree, no partial stage |

## Self-Check: PASSED

- All five `docs/connectors/*.md` records exist and carry their decision markers at HEAD.
- Commits `6e1c4d9` (Task 1) and `7969e80` (Task 3) both present in `git log`.
- `git show HEAD:docs/connectors/stripe-suitability.md` re-read from the commit object, not the
  working tree: the override language is in the committed blob.
