---
phase: 48-readiness-and-qualification-closure
plan: "03"
status: partial
completed: false
requirements-completed: []
---

# 48-03 — Browser protocol preparation and evidence guard repair

2026-10-22 free preparation: six synthetic fixtures now specify the real source/output/edit needs and all required obligation/viewport cells as data. One matrix-integrity check plus nine negative fixture checks pass; the two selected files discover 23 cases including 13 pre-existing cases. No browser journey is implemented by these fixture checks. Both evidence writers remain fail-closed. This is partial Task 1 preparation only; it does not close any browser qualification, owner decision or readiness seal.

Free preparation ran in parallel with48-02 recovery; dependent live journeys have not started.
`48-BROWSER-PREPARATION.md` maps each required matrix cell to current coverage, explicit missing
behavior, synthetic fixture needs and isolated execution order. All cells in48-PACK-ACCEPTANCE
remain pending. The seventh pack still requires its separate inclusion decision/evidence.

Two existing writers could create acceptance records from insufficient observations:

- The pilot imported origin-keyed persisted title/version history, then hardcoded passing case
  and viewport counts. It could carry old observations into a new run.
- Tenant customization checked viewport flags, then resolved an email and selected the newest
  candidate after observation. A concurrent edit or different imported identity could certify
  an unobserved row.

Both writers now stop with explicit missing-protocol errors before reading historical artifacts
or making any backend call. Removed stale lookup/import/write machinery; ordinary UI cases and
historical accepted backend receipts remain unchanged. These are harness repairs, not a stronger
backend activation gate or a claim that historical evidence was retroactively behavioral proof.
An unfiltered browser suite intentionally fails at its selected evidence callback until a genuine
current-run protocol exists.

Two focused regressions execute the actual callbacks in an isolated VM with forged history and
viewport data; both reject with zero artifact reads/backend writes. Broader focused UI checks
passed47tests across5files before the final continuation additions. Both pack specs discover19
tests; the three-spec discovery retains20 total including isolation. Discovery is not execution.
No paid Start/Preview, fixture mutation, activation, registry write, owner decision or rollback
drill ran. Tags are not authorization: Preview can spend and drills can change live availability.

Remaining: finish48-02, prepare exact isolated targets/candidates and bounded scope, implement and
execute each real useful/partial/refusal/edit/reject/injection/privacy/recovery journey, preserve
actual outcomes and owner decisions, verify cleanup, then qualify any replacement evidence writer.
Missing product decision surfaces stay explicit gaps rather than invented passing assertions.
48-03/PACK requirements and the Phase48 readiness seal remain open.
