# Deferred Items — Phase 03.3

## Pre-existing (out of scope, NOT regressions)

- **audit.test.ts red — `Component "auditCounts" is not registered`.** convex-test
  needs `t.registerComponent` for the `@convex-dev/aggregate` `auditCounts` component;
  the test never registers it. Silently red since the Phase-2 aggregate landed, tracked
  across STATE.md ("pre-existing red, NOT a regression"). Untouched by 03.3-03 (which only
  edits gmail.ts / gmailAuth.ts). Fix = register the component in the audit test harness.
