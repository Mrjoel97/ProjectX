/**
 * Structured logger factory.
 *
 * Emits single-line JSON. By contract, callers MUST pass only redaction-safe
 * fields (ids, refs, hashes, counts) — NEVER raw user content or PII. This
 * mirrors the audit/DLQ redaction-safe payload rule (see CLAUDE.md).
 */
export type LogLevel = "debug" | "info" | "warn" | "error";

export type LogFields = Record<string, unknown>;

export interface Logger {
  debug(msg: string, fields?: LogFields): void;
  info(msg: string, fields?: LogFields): void;
  warn(msg: string, fields?: LogFields): void;
  error(msg: string, fields?: LogFields): void;
}

export function createLogger(scope: string): Logger {
  const emit = (level: LogLevel, msg: string, fields?: LogFields): void => {
    // `...fields` FIRST — the four structural keys must be uncloberrable. With the spread last, a
    // caller passing a field named `msg`/`level`/`scope`/`ts` silently rewrites the log line's own
    // identity, and an entry whose `msg` is not the event name is unsearchable exactly when it
    // matters. Same spread-after-explicit shape as dispatch.ts (5460a81), log plane instead of args.
    const line = JSON.stringify({ ...fields, level, scope, msg, ts: Date.now() });
    if (level === "error") console.error(line);
    else if (level === "warn") console.warn(line);
    else console.log(line);
  };

  return {
    debug: (msg, fields) => emit("debug", msg, fields),
    info: (msg, fields) => emit("info", msg, fields),
    warn: (msg, fields) => emit("warn", msg, fields),
    error: (msg, fields) => emit("error", msg, fields),
  };
}
