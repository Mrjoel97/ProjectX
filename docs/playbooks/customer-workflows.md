> Last verified 2026-11-04. Specialist-version and outstanding-run lookups use tenant-first compound indexes.

# Customer specialists and manual workflows

> Last verified 2026-11-03. Local pilot implementation under ADR-072 verified through the public action with a fixture provider. Hosted acceptance pending.

## Purpose

An admitted customer creates a named specialist for their audience, authors a reusable document workflow and runs it for a specific product. Each run opens a conversation with its own generated document in the existing workspace.

## Admission and permissions

`CUSTOMER_WORKFLOWS_PILOT_TENANTS` contains a JSON array of exact tenant IDs. Empty, malformed or oversized configuration admits nobody. At most 100 tenant IDs are supported. Configuration values remain on the backend. The list endpoint returns only the caller's availability and owned records.

The customer controls their task instructions and selected owned knowledge. The active registry supplies the governing system instructions. Backend code controls the operation vocabulary. Each paid/run boundary checks admission and account lifecycle state.

## Data and lifecycle

Customer specialists have stable IDs and immutable revision snapshots. Workflows reference a specialist revision. Runs preserve the reviewed configuration and product brief. Updates reject a stale expected revision. Archived specialists cannot start new work. Request identity distinguishes replay from an explicitly requested new run.

The new tables participate in tenant export and deletion. Audit events contain references and counts. Source text, customer instructions and generated prose belong in tenant-owned records.

## Output and verification

The first pilot generates one composite report with a readable Markdown preview and original PDF download. The existing document writer and workspace discovery provide those outputs. Product reruns must create separately attributable chats and documents.

Use core validation, backend tenant/run tests and UI tests to check the ordinary customer path. Scripted model tests prove orchestration. Provider output quality and hosted browser acceptance require separately recorded evidence.

## Rollout

Start with explicit pilot tenant IDs after the candidate passes its checks. Removing a tenant closes subsequent generation boundaries. Review open runs and provider receipts before retrying an ambiguous attempt. Follow the existing verified release pipeline for code changes.
