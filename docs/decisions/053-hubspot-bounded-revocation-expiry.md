# ADR-053: HubSpot bounded revocation expiry with a verified warning

Status: Accepted — 2026-09-30 (release criterion only; not customer activation)

## Evidence and owner decision

The controlled live test in `docs/connectors/hubspot-live-evidence-2026-09-30.json`
observed successful refresh-grant revocation but a still-usable previously issued access token.
Local encrypted credentials were cleared and further Pikar reads refused. The deployed
Connections panel dropped the stored residual expiry after disconnect.

The owner explicitly answered **“Accept bounded expiry with verified warning”** to:

> Live testing shows HubSpot revokes the refresh grant but an already-issued access token can
> remain usable until its expiry (about 30 minutes in this test). Should the release criterion
> accept that bounded window once the missing warning is fixed and verified, or should HubSpot
> remain owner-only until immediate revocation is available? This changes the product requirement;
> it does not activate customer access.

## Decision

For HubSpot only, replace the immediate access-token cascade requirement with all of:

1. Controlled, state-protected consent and bounded read evidence for the intended account.
2. Confirmed refresh-grant revocation, local credential clearing, and refusal of subsequent reads
   by Pikar. A provider failure must remain a partial/failed revocation, never confirmed by fiat.
3. Preserve the actual finite access-expiry timestamp supplied through the token lifecycle and
   disclose that previously issued access may survive until that time. About 30 minutes is the
   observed test lifetime, **not** a new universal or hardcoded provider guarantee.
4. Verify the warning before disconnect and its persistent precise-expiry form after disconnect
   on the released application. Missing/invalid expiry is explicitly unknown and cannot satisfy
   the release evidence requirement. Reconnection must not be mistaken for completion of the gate.
5. Keep read-only scopes, tenant isolation, state binding, evidence expiry, current suitability,
   and the separate evidence-backed release seal unchanged.

The current condition is `revocation-bounded-expiry-and-warning`, owned by plan 28-22. Historical
`revoke-cascades-to-access-tokens` evidence remains immutable and valid as an observation, but that
old clearance alone cannot satisfy the new condition. The observation must never be changed to
`cascaded: true` or `resolved: true` to support the new decision.

## Consequences and boundary

An issued token held outside Pikar may remain usable until expiry. Deleting Pikar's copy prevents
new Pikar reads; it is not immediate vendor-side invalidation. Customers must see that distinction.
The existing parked production gate and empty cleared-condition list remain unchanged. This ADR
authorizes the bounded criterion and warning correction, not marketplace listing, expanded scopes,
paid calls, unrelated deployment changes, or customer activation. Release still requires the
deployed warning and complete evidence; local tests alone cannot clear it.
