# Plan 19-05 current-source recheck — 2026-09-29

Scope: the Plan 19-05 repository/offline objective on source revision
`9998de612a9835404d3ea7148792eef993ef4d61`. This is not a deployment,
live mailbox, legal-compliance, owner-acceptance or Wave 2 release verdict.

The current approve mutation checks the tenant postal address and partitions
suppressed addresses **before** the `proposed` → `approved` patch and before a
group recipient list is joined. A full suppression refuses with no request;
a partial suppression persists the withheld set for the user. The present send
architecture differs from Plan 19-05's old caller sketch: cockpit and pipeline
both use `delivery.send`, which dispatches to Gmail or Microsoft. Both provider
actions use the same `prepareGovernedMessage` suppression/footer builder.
`deliverApprovedPlan` records a permanent suppression as an idempotent blocked
terminal and adjusts the plan counters; pipeline blocks its planless request.
Service notices call `buildMime` separately and receive no commercial footer.

The new regression in `cockpit.test.ts` closes an evidence gap in the original
row-14 test: it approves a real future `sendAt` while the recipient is clean,
adds the suppression afterward, fires the frozen scheduled callback and its
workflow, then observes `blocked`, zero remaining recipients/queued/sent/failed,
and zero transport calls. The older direct `gmail.send` test remains the narrow
trust-boundary proof. Historical Plan 19-05 summary and VALIDATION row 13 record
the reverted mutation check: moving the all-suppressed guard after the CAS made
the `plan stays proposed` test red. The current source ordering and current
status assertions were rechecked; the historical mutation itself was not rerun.

| Evidence | Result |
| --- | --- |
| `packages/backend/convex/cockpit.test.ts` SHA-256 | `eb43431ad96a4bbfb7eb2910b6296e7157e41d7f03b573ca82461c3d09aa4baf` |
| `packages/backend/convex/cockpit.ts` SHA-256 | `6ee587b73f177d552ce381f70e9650b532052b413bf5efe622f75047680a9dbd` |
| `packages/backend/convex/gmail.ts` SHA-256 | `ea13cfa68399b6d0b1da35b0a3d00cc3e337af19f86edafc3bc7d3ab54c2f78b` |
| `packages/backend/convex/deliverApprovedPlan.ts` SHA-256 | `ac4016ea7fae6a061ee2d79a3cbd0e5604455163af82a796704971e1057e73e9` |
| `pnpm --filter @pikar/backend test cockpit.test.ts` | 86/86 pass, including the actual scheduled-fire regression |
| `pnpm --filter @pikar/backend test` | 183 files / 4,648 tests pass, exit 0; run began before a type-only explicit-table read correction in the new test; the corrected cockpit file was then rerun at 86/86 |
| `pnpm --filter @pikar/backend typecheck` | exit 0 after the explicit-table read correction |
| Biome on `cockpit.test.ts` | no blocking diagnostics; six pre-existing warnings outside the new test |
| Full `pnpm test` first attempt | 10/11 tasks and all 4,647 backend tests passed, but the backend task exited nonzero on one Vitest worker RPC timeout while another test process overlapped it. It is **not** counted as a passing full-suite gate. |
| Exact-head GitHub CI on `9998de6` | run `36500841194` completed **success**: typecheck, lint, free gates, full test, disabled recurrence candidate, operator regressions, planning evidence and production build all passed. Separate SkillOpt offline contract run `36500841202` also passed. |

Disposition for `PLAN:19-contacts-crm-follow-ups/19-05`:
`implemented=yes`, `offline_tested=yes`, objective closed at those layers.
The local overlapping-process `pnpm test` timeout is retained above as a failed
attempt, not disguised as a pass; exact-head CI and the serialized backend run
are the passing checks. Deployed, live-observed, owner-accepted and
externally-enabled layers require their own evidence. Wave 1's entry gate is
not declared passed here.
