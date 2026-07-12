# Deferred Items — Phase 03.2.1

- **audit.test.ts red (pre-existing, NOT caused by 03.2.1-03):** `audit.log inserts exactly one row that round-trips` throws "Component auditCounts is not registered" under convex-test. Documented since the Phase-2 aggregate. Fix is `t.registerComponent("auditCounts", schema, glob)` (the exact pattern cockpitTools.test.ts now uses). Out of scope here (files_modified excludes audit.test.ts). Adopt the registration in audit.test.ts to green it. — logged 03.2.1-03
