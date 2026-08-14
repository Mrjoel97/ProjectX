---
phase: 26-pending-product-pages-and-vault-redesign-integration
plan: 18
subsystem: dashboard-navigation
tags: [pipeline, navigation, actn-05, pipe-01, owner-uat]
requirements-completed: [DASH-01]
completed: 2026-08-12
---

# Plan 26-18: Sales Pipeline navigation activation

The existing narrow `/dashboard/pipeline` surface is now exposed as an active primary-sidebar
link. Phase 26 changed only the navigation seam and its playbook receipts; it added no CRM store,
Pipeline backend, delivery path, opportunity/stage/value model, or revenue claim.

## External gate consumed

- `.planning/phases/19-contacts-crm-follow-ups/19-VERIFICATION.md` records `ACTN-05` and `PIPE-01`
  complete with code evidence, 15/15 live browser UAT, owner sign-off, and owner-attested inbox
  verification of the postal footer and unsubscribe link.
- The owner accepted activation in this session on 2026-08-12.
- The apparent `PipelineView.tsx` dirty marker was reconciled by content: its working-tree blob and
  `HEAD` blob both hash to `5fcfeabc9725978b16d06fcc6dbedcdc551cc996`. Git continues to report a
  Windows line-ending/stat marker, but `git diff` is empty and no Pipeline-owned file was edited.

## Change

- `apps/web/app/(app)/layout.tsx`: replaced the disabled `Soon` item with
  `href="/dashboard/pipeline"`.
- `docs/playbooks/dashboard-pages.md` and `docs/playbooks/cockpit.md`: recorded the external gate,
  owner acceptance, and rollback boundary. Presentation may be hidden again; suppression and the
  postal footer may not be rolled back.

## Verification

- `pnpm --filter @pikar/web test -- pipelineView`: 30/30 passed.
- `pnpm --filter @pikar/backend test -- pipeline.test.ts`: 3/3 passed.
- Broad safety filter: all 9 selected files and 370 tests passed, but Vitest returned nonzero for
  one unrelated unhandled background Gmail/provider error (`process is not defined`) after blocked
  network refresh attempts. This receipt does not misreport that invocation as green.
- `pnpm --filter @pikar/web typecheck`: passed.
- `pnpm --filter @pikar/web build`: passed; `/dashboard/pipeline` is present in the production
  route manifest.
- `node scripts/check-playbooks.mjs`: passed.
- Biome check on the changed layout: passed.
- `git diff --check` on the activation files: passed.
- Browser check against the production build and accepted Phase 19 auth state: exactly one
  `nav a[href="/dashboard/pipeline"]`, text `Sales Pipeline`, no `aria-disabled`, class
  `rail-item is-active` on the route; clicking it from `/dashboard` navigated to
  `/dashboard/pipeline`, where the `Who you owe, and what you owe them` heading rendered.

## Rollback

If presentation must be withdrawn, remove only the nav `href` (or hide the route at the shell).
Do not roll back consent/suppression enforcement, delivery refusal paths, or the mandatory postal
footer.
