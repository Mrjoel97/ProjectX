---
status: resolved
trigger: "Error: Uncaught Error: gmail.send: 403 PERMISSION_DENIED SERVICE_DISABLED; Gmail API has not been used in project 940109926661 before or it is disabled; correlationId 3ace5084-7e5c-48b5-b225-c8918cae899a at 2026-08-14 01:09:58 Africa/Dar_es_Salaam"
created: 2026-08-14T01:09:58+03:00
updated: 2026-08-14T02:15:00+03:00
---

## Current Focus

hypothesis: Confirmed and remediated: Gmail API was disabled in OAuth consumer project pikar-ai (project number 940109926661).
test: Query enabled Google services as a project-authorized account after enabling gmail.googleapis.com.
expecting: The service registry returns NAME gmail.googleapis.com and STATE ENABLED for project 940109926661.
next_action: User may retry the original app send after Google Service Usage propagation; no diagnostic email was sent during this session.

## Symptoms

expected: Sending an email through the app succeeds via gmail.send.
actual: The send attempt fails before Gmail accepts the message with HTTP 403 PERMISSION_DENIED.
errors: "gmail.send: 403; reason SERVICE_DISABLED; service gmail.googleapis.com; consumer projects/940109926661; Gmail API has not been used in project 940109926661 before or it is disabled."
reproduction: Send an email through the app.
started: Observed 2026-08-14 01:09:58 Africa/Dar_es_Salaam; earlier working state is not established.

## Eliminated

- hypothesis: The 403 was caused by malformed email content, a rejected recipient, or Gmail quota/rate limiting.
  evidence: Google's structured ErrorInfo named SERVICE_DISABLED for gmail.googleapis.com and consumer projects/940109926661, before message delivery.
  timestamp: 2026-08-14T01:09:58+03:00

- hypothesis: The numeric project in the error was an unrelated or mistargeted project.
  evidence: An authorized project account resolved the target as project pikar-ai with project number 940109926661 and verified the Gmail API state there.
  timestamp: 2026-08-14T02:15:00+03:00

## Evidence

- timestamp: 2026-08-14T01:09:58+03:00
  checked: Provider error payload from the failing gmail.send call.
  found: Google returned HTTP 403 PERMISSION_DENIED with ErrorInfo reason SERVICE_DISABLED, service gmail.googleapis.com, consumer projects/940109926661, and an activation URL scoped to project 940109926661.
  implication: The failure is at Google Service Usage configuration for the OAuth consumer project, before message delivery; it is not evidence of bad message content or a recipient-level rejection.

- timestamp: 2026-08-14T02:00:00+03:00
  checked: Read-only gcloud projects describe for numeric project 940109926661.
  found: Google Cloud rejected the query because active account joelofficialbiz@gmail.com lacks permission to access project 940109926661, or the project is not visible to that identity.
  implication: This local gcloud identity cannot be used to independently inspect or enable services in the OAuth consumer project; project ownership/IAM access is a separate operational blocker.

- timestamp: 2026-08-14T02:05:00+03:00
  checked: Active gcloud account and read-only enabled-services query for gmail.googleapis.com in project 940109926661.
  found: Active identity is joelofficialbiz@gmail.com. Service Usage returned AUTH_PERMISSION_DENIED and explicitly denied listing services for consumer projects/940109926661.
  implication: Independent Service Usage verification is blocked by missing project IAM, not by an ambiguous gcloud target. The provider's SERVICE_DISABLED response remains the authoritative service-state evidence.

- timestamp: 2026-08-14T02:15:00+03:00
  checked: Google Service Usage after remediation, using project-authorized account joel.feruzi@gmail.com.
  found: Project resolved as pikar-ai / 940109926661, and gcloud returned NAME gmail.googleapis.com with STATE ENABLED.
  implication: The exact provider configuration that caused gmail.send to fail is now corrected in the correct OAuth consumer project.

## Resolution

root_cause: The Google OAuth consumer project pikar-ai (project number 940109926661) did not have gmail.googleapis.com enabled. Google therefore rejected gmail.send at the Service Usage gate with HTTP 403 PERMISSION_DENIED / SERVICE_DISABLED before processing the email.
fix: gmail.googleapis.com was enabled in project pikar-ai / 940109926661 by the project-authorized primary operator using joel.feruzi@gmail.com. This diagnostic subtask did not mutate external configuration.
verification: Read-only post-change gcloud verification returned gmail.googleapis.com in STATE ENABLED for project 940109926661. No email was sent as part of verification; the original end-to-end send should be retried after propagation.
files_changed:
  - .planning/debug/gmail-api-service-disabled.md
