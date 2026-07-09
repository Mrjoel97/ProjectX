// @pikar/audit — the audit event-type taxonomy and helpers (pure TS).
//
// Consumers (the Convex insert-only audit module and future governance surfaces)
// import from here to keep audit event names consistent and typed. This package
// deliberately contains NO Convex/runtime dependencies so the taxonomy stays
// portable and unit-testable without the backend.

export * from "./eventTypes";
