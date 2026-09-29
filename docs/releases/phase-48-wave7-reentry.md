# Phase 48 → Wave 7 external-enablement re-entry

Phase 48 closes only the repository-controlled site and landing-page runtime. Its local evidence
does not authorize or establish external enablement. The provisional operating name is `pikar-ai`.
Registered entity name, jurisdiction, registration number, and registered address remain pending.

| Gate | Owner | Prerequisite | Required evidence | Re-entry command | Stop condition |
| --- | --- | --- | --- | --- | --- |
| Legal facts | Founder/legal owner | Formation complete | Registry-issued entity name, jurisdiction, number, and address | Update the approved legal-data source and rerun the legal-page review | Any field pending or inferred |
| Hosting ownership | Infrastructure owner | Account and target selected | Account-owner receipt plus immutable target identifier | Run the Wave 7 hosting preflight for the exact target | Shared/unknown owner or mutable target |
| Domain ownership | Founder/infrastructure owner | Domain acquired | Registrar ownership receipt for the exact name | Run the read-only domain preflight | Domain absent, borrowed, or ambiguous |
| DNS and TLS | Infrastructure owner | Owned domain and hosting target | Authoritative DNS answers and valid certificate chain captured after propagation | Run the Wave 7 DNS/TLS probe | Propagation incomplete, mismatch, or invalid certificate |
| Custom-domain binding | Infrastructure owner | DNS/TLS green | Runtime binding record plus anonymous exact-artifact response and declaration headers | Execute the custom-domain acceptance probe | Pending declaration, foreign tenant, or byte/hash mismatch |
| Provider/form approval | Operations/legal owner | Complete legal facts and policies | Provider dashboard receipt naming the exact account/form and approval state | Execute the provider-specific readback | Review pending, rejected, or scope unclear |
| Anonymous production traffic | Release owner | Deployed exact revision | Timestamped GET/HEAD, rendered CTA, form outcomes, headers, aggregate deltas, and rollback receipt | Run production acceptance on the exact deployed revision | Any local fixture, synthetic claim, or missing cleanup |
| Wave 8 founder qualification | Founder | All Wave 7 gates complete | Separate signed beta script and observed acceptance record | Enter Wave 8; do not amend Phase 48 evidence | Any external gate incomplete |

No paid diagnostic or provider call is authorized by this packet. The previously approved diagnostic
is closed and is not reusable authority. External evidence must be collected only at its owning wave,
against an exact revision, with the applicable account owner present. Run
`node scripts/check-phase48-acceptance.mjs` before re-entry; a green result means only that Phase 48
artifacts did not overclaim these deferred layers.
