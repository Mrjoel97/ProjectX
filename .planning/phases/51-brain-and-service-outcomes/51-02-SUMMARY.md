---
phase: 51-brain-and-service-outcomes
plan: "02"
status: partial
completed: false
requirements-completed: []
---

# 51-02 — Source-aware Business Ledger implemented locally

The existing profile now renders actual blueprint fields through blueprint.businessLedger and BusinessLedgerPanel. No new navigation or fact store was introduced. A bounded versioned sidecar on tenantProfiles binds exact blueprint/entry hashes, original owned source IDs/hash/creation times and actual immutable review references. First-recorded/review times survive unchanged carry-forward; unknown observation time remains unknown. The native user review records a proposal decision, not independent verification or userProvided authority.

Synthesis preserves original retrieved chunk boundaries and the exact native profile prefix. A bounded snapshot query checks those witnesses against the same owned ready source bytes it hashes before paid work. Changed/withdrawn witnesses refuse synthesis; native write/confirm hash fences cover later races. Reviews add closed field/hash references to the existing count/ref-only audit payload. Reads validate exact native user audit/document/field/hash/time identity, source ownership/readiness/sealing and bytes. No title-based citation or fabricated review exists.

Business Ledger and Executive standing context share the projection. The interface retains legacy, changed and withdrawn values with explicit source state and opens only accessible sources. Assured context excludes those unverified claims. The existing origin markers remain statements/inferences; their wording no longer promotes an agent-authored profile into settled user truth. serviceBrainView includes the same bounded cited field view alongside goal, original profile snapshot metadata and operational/usefulness/measurement outcomes.

Focused proof: 61 core Blueprint tests, 45 native Blueprint tests and 8 Ledger UI tests passed. Six mounted local Chrome views at390/1440 pixels were captured and inspected without overflow; synthetic data and production CSS/fonts were used. These are source/native/local-browser results, not hosted authenticated acceptance. ADR065 records the decision. Native source changes conservatively refuse noncontiguous prejoined passages that cannot be proven byte-for-byte.

Remaining: current-source release and authenticated source/erasure journey, plus Phase51-04 end-to-end qualification. No provider call, paid evaluation, registry activation, source refiling, goal transition or production deployment occurred.
