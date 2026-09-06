---
status: resolved
trigger: "calendar_insert 403 accessNotConfigured; correlationId d6ef226d-642c-4ecc-8661-9c0bceb443e5; planId p5709ajh788jahyeca6rbqm3ed8cfrp8; 8/14/2026, 3:18:39 AM"
created: 2026-08-14T01:22:54.5336503Z
updated: 2026-08-14T01:36:00.0000000Z
---

## Current Focus

hypothesis: Confirmed and remediated externally: Google Calendar API service `calendar-json.googleapis.com` was not enabled in the OAuth consumer project pikar-ai / 940109926661.
test: Verify the completed Service Usage operation and read the post-change enabled-service state.
expecting: The operation completes successfully and the service registry returns `calendar-json.googleapis.com` in STATE ENABLED for project 940109926661.
next_action: Retry the original app calendar insertion after propagation if end-to-end confirmation is required; no diagnostic event was created in this investigation.

## Symptoms

expected: Executing calendar_insert through the app successfully creates a Google Calendar event.
actual: The event insertion fails with HTTP 403 and status accessNotConfigured.
errors: "calendar_insert 403 accessNotConfigured; correlationId d6ef226d-642c-4ecc-8661-9c0bceb443e5; planId p5709ajh788jahyeca6rbqm3ed8cfrp8"
reproduction: Execute calendar_insert through the app.
started: Observed 2026-08-14 03:18:39 Africa/Dar_es_Salaam; earlier history is not established.

## Eliminated

- hypothesis: The failure was caused by a missing Calendar OAuth scope, missing stored token, or failed token refresh.
  evidence: calendar.ts returns the separate `reauth` outcome for those conditions. The reported terminal dead letter can only occur after an authenticated HTTP response from the Calendar events.insert endpoint.
  timestamp: 2026-08-14T01:29:30.0000000Z

- hypothesis: The event payload, plan staging, recipient/attendee behavior, or Calendar quota/rate limiting caused the 403.
  evidence: Incomplete plan staging returns status 0 before network access; the adapter emits transient failures for 429/5xx; the observed provider reason was the service-activation-specific `accessNotConfigured`. Google Service Usage subsequently identified the Calendar API service as disabled in the consumer project.
  timestamp: 2026-08-14T01:36:00.0000000Z

## Evidence

- timestamp: 2026-08-14T01:25:30.0000000Z
  checked: Repository-wide text search for calendar_insert and Google Calendar integration markers.
  found: The implementation is in packages/backend/convex/calendar.ts; planning and tests identify the operation as Google Calendar API v3 events.insert, while calendarComplete.ts formats terminal failures as `calendar_insert <status> <reason>`.
  implication: The reported `calendar_insert 403 accessNotConfigured` is the app's normalized terminal record for a failed Google Calendar events.insert request, not a locally invented authorization decision.

- timestamp: 2026-08-14T01:29:30.0000000Z
  checked: Complete packages/backend/convex/calendar.ts and calendarComplete.ts execution path.
  found: createEvent posts to `https://www.googleapis.com/calendar/v3/calendars/primary/events` using the access token returned by the shared `freshAccessToken` function from gmail.ts. For a non-401/non-reauth 403, reasonCode preserves Google's first `error.errors[0].reason`; calendarComplete then writes exactly `calendar_insert 403 <reason>`.
  implication: `accessNotConfigured` came from Google's Calendar endpoint. Scope absence, missing tokens, and refresh failure take the separate `reauth` branch and cannot produce this dead-letter string.

- timestamp: 2026-08-14T01:29:30.0000000Z
  checked: Resolved adjacent Gmail incident `.planning/debug/gmail-api-service-disabled.md`.
  found: The deployed shared Google OAuth consumer project was independently verified as pikar-ai / 940109926661; Calendar explicitly reuses the same stored grant and refresh root.
  implication: pikar-ai / 940109926661 is the evidence-backed candidate consumer project for this Calendar request, but the Calendar service's own registry state must be checked rather than inferred from Gmail.

- timestamp: 2026-08-14T01:36:00.0000000Z
  checked: Google Service Usage catalog and project metadata using the project-authorized identity joel.feruzi@gmail.com.
  found: Project number 940109926661 resolves to project pikar-ai, and the catalog maps Google Calendar API to the canonical service name `calendar-json.googleapis.com`.
  implication: The exact service and consumer project are directly verified; `calendar.googleapis.com` and the request hostname `www.googleapis.com` are not the Service Usage identifier for this API.

- timestamp: 2026-08-14T01:36:00.0000000Z
  checked: External remediation operation `operations/acat.p2-940109926661-b6ec2ed9-b47c-4174-b7da-c23c7d5d803a` and post-change enabled-services query.
  found: The enable operation completed successfully, and Google Cloud reports `calendar-json.googleapis.com` in STATE ENABLED for project 940109926661.
  implication: The provider configuration responsible for the 403 has been corrected. The remediation was performed by the authorized primary operator, not by this read-only diagnostic subtask.

## Resolution

root_cause: Google rejected the Calendar API v3 events.insert request at the Service Usage gate because the OAuth consumer project pikar-ai (project number 940109926661) did not have the Google Calendar API service `calendar-json.googleapis.com` enabled. The app preserved Google's legacy reason `accessNotConfigured` and wrote `calendar_insert 403 accessNotConfigured` for correlationId d6ef226d-642c-4ecc-8661-9c0bceb443e5 and planId p5709ajh788jahyeca6rbqm3ed8cfrp8. The rejection occurred before Google processed the event payload or created an event.
fix: The project-authorized primary operator enabled `calendar-json.googleapis.com` in pikar-ai / 940109926661. This diagnostic subtask made no external configuration changes.
verification: Service Usage operation `operations/acat.p2-940109926661-b6ec2ed9-b47c-4174-b7da-c23c7d5d803a` completed successfully, and a read-only post-change query returned `calendar-json.googleapis.com` in STATE ENABLED. No calendar event was created, so provider configuration is verified remediated while the original end-to-end calendar_insert workflow remains untested after propagation.
files_changed:
  - .planning/debug/calendar-api-service-disabled.md
