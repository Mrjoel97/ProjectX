---
phase: 31-marketing-surface-and-funnel-v0
plan: "04"
subsystem: contacts
requirements-addressed: [MKTG-03]
requirements-completed: []
---

# Phase 31-04 — authenticated operator lead recording

Implemented `contacts.recordMarketingLead` using the existing tenant wrapper and `upsertContactRow`.
No public endpoint, schema/table addition, outbound action or parallel CRM was added. The approved C1
contract fixes origin to `user-entered` and explicit consent source to `asserted-by-user`; no client
origin/source override is accepted. Optional consent remains absent unless asserted. Existing first
origin/consent survive duplicates; independent suppression remains authoritative.

Pure bounded input parsing lives in `@pikar/core/marketingLead`. Args are
`{ email, name?, company?, consent?: { wording, context? } }`. Context belongs to explicit consent,
matching the existing data model rather than inventing a generic lead-context field. Return fields are
`contactId`, `created`, `consentRecorded`, `suppressed`, `outboundAllowed`, and `reason`.

Verified 246 tests across contacts, cockpit and Gmail plus eight core tests. The two new convergence
tests capture a suppressed address with valid consent, then prove immediate approve-time withholding
and send-time refusal with zero provider calls. No live account, lead, model, email or provider action ran.
Biome passed with 15 existing warnings. Final backend typecheck passed after the funnel lane's
successful native codegen included `funnels` and the concurrent `authoringProbe` module. Core
typecheck also passed. Coordinating root owns whole-tree qualification and deployment.

Plan deviation: `gmail.send` returns the permanent suppression refusal but leaves the request state
to its workflow caller. Its regression therefore asserts the refusal/zero calls, not a fictitious blocked
mutation. Existing `deliverApprovedPlan`/`recordDeliveryTerminal` and standalone pipeline own blocked
terminal handling, with existing cockpit terminal-routing evidence. No delivery ownership was changed.

Changed: contacts.ts/test, cockpit.test.ts, gmail.test.ts, core marketingLead.ts/test,
contacts-crm playbook/watch, and this summary. Browser profiles and Phase23 baseline evidence were
preserved. Root owns commits, source-graph refresh, codegen, final validation and later live acceptance.
