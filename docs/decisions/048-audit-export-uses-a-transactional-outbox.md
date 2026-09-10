# ADR-048 — Audit export uses a transactional outbox

- Status: Accepted
- Date: 2026-09-10
- Scope: internal export reliability only; ADR-002 insert-only audit and ADR-044 WORM arming restrictions remain in force.

The merged system audit G17 required multi-page WORM backlog draining. The implementation advanced `ts > maxTs` after each page, permanently skipping equal-timestamp rows past that page. A timestamp checkpoint also misses backdated events. Convex's `_creationTime` is based on mutation start, not commit order, so moving the same algorithm to creation time is not reliable either. [Convex commit timestamp documentation](https://docs.convex.dev/database/advanced/commit-timestamp) explicitly describes this race. The pinned Convex 1.42.1 package does not expose the newer commit timestamp API; changing that dependency is outside this fix.

`audit.log`, the sole production audit writer, now inserts an `auditExportQueue` reference in the same transaction as the immutable audit row, marking new rows `exportVersion: 2`. The queue carries audit ids only and is global export delivery state. It remains present when WORM is OFF, so arming later cannot discard intervening events.

The exporter freezes at most 1,000 audit ids and their queue ids in its checkpoint before uploading. Body reads also stop near 2 MB (one final document can cross the threshold). Retry loads precisely those immutable audit ids regardless of arrivals or requested page-size changes. SHA256 of canonical NDJSON determines the S3 object key. Only an acknowledged upload permits checkpoint advancement and queue deletion; a revision comparison rejects stale overlapping advances. Audit rows are never updated or deleted. S3 may retain duplicate versions on an ambiguous retry; readers deduplicate by audit `_id`.

Legacy rows have no `exportVersion`. A native paginated index scan of that lane replays all such rows once, including rows below an existing timestamp checkpoint, because the old cursor cannot establish coverage. Its terminal cursor is discarded; subsequent runs drain the queue and do not persist a terminal pagination cursor for future arrivals. An eight-minute action budget bounds each run; remaining work stays queued or checkpointed for the next cron.

Deployment sequencing: keep WORM OFF, deploy schema and the sole writer together, and allow all invocations of the old writer to finish before the first legacy backfill is armed. This closes the legacy migration lane: every later production insert carries a transactional queue entry. Do not directly insert unversioned legacy rows after migration. This is an arming prerequisite, not a claim that deployment or S3 retention was verified locally.

Costs are one small outbox row per unexported event and a serialized checkpoint per export batch, rather than a deployment-global counter contended by every audit writer. The OFF deployment accumulates queue references intentionally. Missing audit ids fail closed; batch failure leaves both checkpoint and queue intact. The governance report counts actual queue and unfinished legacy work; event timestamps are retained only as compatibility/display metadata.

Validation: regression tests cover equal-ts legacy and queue pages, late/backdated arrivals after completion, arrivals during upload, identical retry bodies and keys, partial-run resumption, stale advances, writer transaction rollback, and OFF behavior. Mocked S3 acknowledgement is not live Object Lock evidence. ADR-044 arming triggers and real bucket verification remain required.
