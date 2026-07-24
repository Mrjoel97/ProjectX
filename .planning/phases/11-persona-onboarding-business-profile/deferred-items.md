
## 11-04 execution — out-of-scope discovery

- **audit.test.ts flake:** `convex/audit.test.ts > "audit.log inserts exactly one row that round-trips"` fails with `Component "auditCounts" is not registered. Call "t.registerComponent"` — a convex-test harness registration gap in the aggregate component. Unrelated to 11-04 (audit.test.ts untouched since 01-03 `fb947fc`); the full backend suite otherwise passes 462/463, incl. onboarding.test.ts + profileRedaction.test.ts. Not fixed here (scope boundary — not caused by this task's changes).
