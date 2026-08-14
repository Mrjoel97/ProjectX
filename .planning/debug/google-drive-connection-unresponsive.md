---
status: diagnosed
trigger: "Google Drive connection appears not to respond; attempting to use the app's Google Drive connection produces no successful response. Reported 2026-08-14 after Gmail and Calendar APIs were found disabled in OAuth consumer project pikar-ai / 940109926661."
created: 2026-08-14T04:47:15.3728428+03:00
updated: 2026-08-14T05:02:00+03:00
---

## Current Focus

hypothesis: A provider failure is being hidden by an uncaught client promise, leaving the Vault picker permanently in its loading state.
test: Trace the Drive action and picker error paths, run the existing Drive tests, and inspect the Google Cloud service state if access permits.
expecting: The picker should either handle provider failures or expose the exact upstream response instead of remaining on "Reading Drive...".
next_action: Add a caught, typed provider-error result to the Drive action and picker; separately verify drive.googleapis.com is enabled and reconnect tenants whose token lacks drive.readonly.

## Symptoms

expected: Google Drive connection and actions in the app respond successfully.
actual: The Google Drive connection appears not to respond.
errors: No exact UI or API error was provided.
reproduction: Attempt to use the app's Google Drive connection.
started: Reported 2026-08-14 after Gmail and Calendar APIs in OAuth consumer project pikar-ai / 940109926661 were found disabled; prior working state is unknown.

## Eliminated

- The normal scope, browse, and import logic is not generally broken: the targeted backend Drive suite passed 16/16.
- A missing Drive OAuth scope is already detected before the provider call and returned as `reauth`; it is not the mechanism that leaves the picker spinning.

## Evidence

- `DriveBrowser.tsx` sets `nodes` to null before awaiting `listFolders`, and null renders as `Reading Drive...`.
- The initial effect calls `void load(null)` and `load` has no `try/catch`; a rejected Convex action therefore leaves `nodes` null indefinitely.
- `vaultDrive.ts` throws on non-OK Drive `files.list` responses and collapses the provider body to only the HTTP status. A 403 such as SERVICE_DISABLED therefore becomes an unhandled rejection in the Vault picker.
- Cockpit Drive tools catch the same throw and return a generic failure, so the indefinite spinner is specific to the Vault picker while other surfaces merely hide the provider reason.
- Read-only Google Cloud verification of `drive.googleapis.com` could not run because the escalation reviewer reported an account usage limit. The adjacent Gmail and Calendar SERVICE_DISABLED incidents make a disabled Drive API plausible, but it is not confirmed.

## Resolution

root_cause: The confirmed product defect is an uncaught `listDriveFolders` rejection in the Vault picker. Any upstream Drive failure leaves the UI permanently on `Reading Drive...`; the exact upstream trigger is still unconfirmed.
fix: Diagnosis only. Recommended fix is a typed provider-error return plus a client catch/finally state, followed by enabling `drive.googleapis.com` if disabled and reconnecting grants that lack `drive.readonly`.
verification: Targeted backend Drive tests passed 16/16. External service-state and end-to-end tenant verification remain pending.
files_changed:
  - .planning/debug/google-drive-connection-unresponsive.md
