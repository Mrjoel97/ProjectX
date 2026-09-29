# Plan 19-06 current-source recheck — 2026-09-29

Scope: the Plan 19-06 repository/offline objective. Current source baseline is
`ecaff400ba389e8a34ca4ba591ff7c9b854d5e7b`. This is not a deployed,
live-observed, owner-accepted or externally-enabled CRM verdict, nor does it
clear the still-open Wave 1 entry gate.

Plan 19-06's literal **five-member** exit assertion is historical, not a
current cardinality claim. Commit `ccad3ce1a843a106ef1340c4ed02d593d75b5a6b`
introduced `crm_write` as the fifth `ACTION_TYPES` member on the `inline` arm;
its exact-array test and the corrected Phase-18/19 prediction appear in that
commit. The implementation summary enumerates **fourteen**, not eleven,
registration sites and records the reverted runtime-validator mutation check:
dropping `crm_write` from `patchPlan`'s mirror alone made two tests red while
typecheck still passed. Later additive commits `693824a` (`finance_write`,
sixth) and `d17ab1d` (`calendar_manage`, seventh; Plan 17-05) superseded the
five-member cardinality without removing the CRM arm. Today's exact-array test
requires all seven in order and `armFor("crm_write") === "inline"` still passes.
No test today is reported as proving that the current set has only five.

Current source retains the shared operation parser's empty-list, missing-date,
contactless-agent-follow-up and size refusals; both arm-table bindings and the
schema/`patchPlan` union; and the inline approve path that applies the full
list transactionally, sets `done`, seeds no mail requests and no-ops on a second
approve. The CRM card renders its own operation list before email controls and
excludes the duplicate draft card. The historical one-commit registration and
mutation checks are cited as historical evidence, not rerun mutation proof.

| Evidence | Result |
| --- | --- |
| `packages/core/src/actionType.ts` SHA-256 | `a956278b4f2ddc9b549d6402ea7cffebcb87509580aab4f8a484b9b57972de5a` |
| `packages/core/src/actionType.test.ts` SHA-256 | `aa205fb795983b8a973d758e30ea0609c64bb1bc30fe096f024e386976cb3257` |
| `packages/backend/convex/cockpit.ts` SHA-256 | `6ee587b73f177d552ce381f70e9650b532052b413bf5efe622f75047680a9dbd` |
| `apps/web/app/(app)/dashboard/workspace/cards.tsx` SHA-256 | `35089cb56935cf140ac5426f179b2d1fdac8fc88704e061358dd361c21edb11d` |
| `pnpm --filter @pikar/core test actionType contacts` | 45/45 pass (16 action-type, 29 contacts), exit 0 |
| `pnpm --filter @pikar/core typecheck` | exit 0 |
| `pnpm --filter @pikar/web test crmCard` | 12/12 pass, exit 0 |
| `pnpm --filter @pikar/backend test` | 183 files / 4,648 tests pass, exit 0; includes current CRM approval, runtime validator and no-send cases |
| Exact-head CI on `9998de6`, run `36500841194` | success across typecheck, lint, free gates, full tests, controlled candidate, operator regressions, planning and production build. No product source changed between it and this note. |

Disposition for `PLAN:19-contacts-crm-follow-ups/19-06`:
`implemented=yes`, `offline_tested=yes`, objective closed at those layers,
with the original fifth-member cardinality explicitly superseded by the two
named additive commits. Deployed, live-observed, owner-accepted and
externally-enabled layers remain unknown.
