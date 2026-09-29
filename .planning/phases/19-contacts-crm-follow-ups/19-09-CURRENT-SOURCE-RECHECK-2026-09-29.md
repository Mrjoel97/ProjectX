# Plan 19-09 current-source recheck — 2026-09-29

Scope: repository/offline qualification of the current contacts-capable
`cockpit-agent` body on source revision `688dfb0`. The **plan remains open**:
this note does not assert a current registry version, a current full paid gate,
activation, live model behaviour or owner acceptance.

The canonical Markdown body teaches saved-contact-first resolution,
`stageCrmWrite` as proposal rather than application, and a named contact for
agent-created follow-ups. The contracts sync test verifies the LF-normalized
bundler mirror. Fixture `36-crm-follow-up` remains in the golden corpus with
`crmOperationCount: 1`, the later strengthened `datedFollowUpCount: 1`, and a
nonempty needle; the current runner rejects vacuous zero expectations and its
offline self-check validates all 57 fixtures. The current fixture floor is 46,
not the historical 35, because later cases were added. No paid call was made
for this recheck.

The Plan 19-09 historical summary records a seeded `cockpit-agent@18` candidate
and a 35/35 gate while v17 remained active; it explicitly says there was **no
activation**. The later Phase 19 verification says the 35/35 gate predates the
strengthened CRM assertion and the post-19-11 code, with fixture 36 separately
rerun. Those historical records do not prove a current one-run full strengthened
gate or today's registered active/candidate identity. The source body has also
changed since the old candidate hash. The owner checkpoint cannot be silently
converted into a current verdict by offline tests.

| Evidence | Result |
| --- | --- |
| `packages/contracts/skills/cockpit-agent.md` SHA-256 | `d1fc43eb3423d8da9c4ba8113cf786aba1818324dcd8485b6e1dba0d4c2f180b` |
| `packages/contracts/src/skills/cockpitAgent.ts` SHA-256 | `7f1aa4b7be24cb7473f93a566393b8b753385d4db2d318b27ca9521d862673eb` |
| `packages/backend/scripts/eval-cases/36-crm-follow-up.json` SHA-256 | `ce0c90715d09468342c489e0a0ba14a5ba1efe420e8869e1a3982e65f123fe80` |
| `pnpm --filter @pikar/contracts test` | 127/127 pass, including skill-body sync, exit 0 |
| `pnpm --filter @pikar/contracts typecheck` | exit 0 |
| `node packages/backend/scripts/run-eval-golden.mjs --self-check` | exit 0, 57 fixtures valid; no provider call |
| Current fixture check | `crmOperationCount: 1`, `datedFollowUpCount: 1`, needle and nonvacuous description present |
| `pnpm --filter @pikar/backend test cockpitTools traceParity` | 179/179 pass; includes offline CRM SMOKE staging/trace |
| `pnpm --filter @pikar/backend test smoke` | **Not a valid verifier** in the current tree: no `*smoke*.test.ts` matched and command exited 1. The focused cockpit-tool and golden self-check evidence above is used instead. |

Disposition for `PLAN:19-contacts-crm-follow-ups/19-09`:
`implemented=yes`, `offline_tested=yes`, **current disposition remains open**.
The next gate is a current registered candidate/active identity and evaluator
pin check, a separately bounded full strengthened run if authorized and still
needed, then an explicit owner activation or defer verdict. Until then the
deployed, live-observed, owner-accepted and externally-enabled layers remain
unknown. Wave 1's separate entry gate is also not declared passed.
