---
phase: 31-marketing-surface-and-funnel-v0
status: passed
verified: 2026-09-12
requirements-completed: [MKTG-01, MKTG-02, MKTG-03]
---

# Phase 31 verification

Phase 31's approved A1/B1/C1 product contract is complete on production
`4df076dbdc8330c54ace5a3996259f3e71318024`. The owner approved the contract with
`PROCEED_COMPATIBLE` and later approved navigation with
`APPROVE MARKETING NAV ACTIVATION`, after the live evidence and its method limitation were
presented. These are separate recorded decisions, not inferred approval.

| Requirement | Implementation and evidence |
| --- | --- |
| MKTG-01 | Six honest channel states; connected Gmail and five social channels with explicit blockers; static unsent workspace assistance. Native/component tests plus live desktop/mobile, keyboard and prefill checks passed. The approved Marketing menu works in the desktop rail and compact mobile bar. |
| MKTG-02 | Tenant-authenticated management; cryptographic token disclosed once and stored as a hash; fixed source and original stored file; three independent raw counters; Convex GET-only transport. Native tests cover tenant/storage boundaries, concurrency and overflow. Fresh anonymous clients proved the original byte hash, independent counter deltas, source immutability, HEAD refusal, minimal uncached 404s and deactivation. |
| MKTG-03 | Existing contacts store, explicit user-entered provenance, optional asserted consent and authoritative suppression. Native tests cover consent preservation and approve/send convergence; live recapture preserved one suppressed synthetic contact with absent consent. No message or publishing action was invoked. |

## Qualification

The consolidated local suites, remediation history, codegen and build are recorded in
`31-06-SUMMARY.md`. The first navigation release failed an outdated four-tab assertion and
was never promoted. The correction pins the exact original four routes plus Marketing; all
15 focused split-pane/Marketing tests passed without runtime changes.

Exact CI `34696845981` passed types, lint, all 22 free gates, full tests, operator regressions,
planning evidence and build. Deployment `34697141228` succeeded. The durable URL probe passed
at `13:44:19Z`, followed by production deployment `6410261035`, status `18263904787`, at
`13:44:23Z`. The immutable local receipt is
`.tmp/qualification-2026-09-12/marketing-nav-qualified-production-deployment-receipt.json`.

Post-activation browser checks passed at `13:48:12.226Z`: desktop 1440px and mobile 390px
navigation by keyboard and pointer, current-page state, focus and document fit. The owned
test link remained deactivated with counters `[2,1,1]` and no token/recovery panel.
The receipt is `output/playwright/production-acceptance/marketing-postactivation-result.json`.

## Evidence limits and cleanup

The standalone exported-session three-test suite did not pass. After renewed owner sign-in,
direct Playwright assertions in the existing browser supplied actual UI/HTTP evidence, with
fresh anonymous contexts for public requests. This method deviation was disclosed before the
owner approved activation. It does not certify reusable exported-session automation, broad
provider workflows, unique visitors, conversion sequences, or social publishing.

`31-07-SUMMARY.md` preserves the original failures, release timestamps, exact byte hash,
counter sequence, all redacted receipts and the broader native-test boundaries. Existing
public OAuth/webhook/unsubscribe routes and middleware were retained; the new route is the
approved file capability, not a replacement authentication architecture.

The one successful test link is deactivated. The exact tagged synthetic contact stays suppressed
and retained because Contacts has no deletion seam. The original file and user workspace are
preserved, and the synthetic unsent draft was cleared. Deactivation cannot revoke previously
issued storage URLs or downloaded copies. Provider eligibility and Phase 32 remain separate;
recurrence remains deferred until its own DST/OAuth evidence gates pass.
