/** Issued JWTs and erasure revocations must share one explicit lifetime. */
export const AUTH_JWT_DURATION_MS = 60 * 60 * 1000;
export const AUTH_REVOCATION_RETENTION_MS = AUTH_JWT_DURATION_MS + 60 * 1000;
