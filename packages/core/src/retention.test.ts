import { describe, expect, test } from "vitest";
import { RETENTION_MS, retainUntilDate, serializeAuditNdjson, wormObjectKey } from "./retention";

describe("serializeAuditNdjson (WORM export body)", () => {
  test("empty rows serialize to the empty string (nothing to PutObject)", () => {
    expect(serializeAuditNdjson([])).toBe("");
  });

  test("each row is one newline-terminated JSON object", () => {
    const out = serializeAuditNdjson([{ a: 1 }, { a: 2 }]);
    expect(out).toBe('{"a":1}\n{"a":2}\n');
    // Every line (including the last) is newline-terminated → splitting drops a trailing empty.
    const lines = out.split("\n");
    expect(lines[lines.length - 1]).toBe("");
    expect(lines.filter((l) => l.length > 0)).toHaveLength(2);
  });

  test("key order is stable regardless of input order (byte-identical re-export → idempotent PutObject)", () => {
    const a = serializeAuditNdjson([{ b: 2, a: 1, payload: { z: 1, y: 2 } }]);
    const b = serializeAuditNdjson([{ a: 1, b: 2, payload: { y: 2, z: 1 } }]);
    expect(a).toBe(b);
    // and the keys actually came out sorted
    expect(a).toBe('{"a":1,"b":2,"payload":{"y":2,"z":1}}\n');
  });

  test("round-trips: each line parses back to the source row", () => {
    const rows = [
      { tenantId: "t1", ts: 100, payload: { count: 3 } },
      { tenantId: "t2", ts: 200, payload: { count: 0 } },
    ];
    const parsed = serializeAuditNdjson(rows)
      .split("\n")
      .filter((l) => l.length > 0)
      .map((l) => JSON.parse(l));
    expect(parsed).toEqual(rows);
  });

  test("preserves own prototype-shaped keys without changing the source", () => {
    const row = JSON.parse('{"payload":{"__proto__":"ref123","constructor":"ref456"}}');
    const original = JSON.stringify(row);
    expect(JSON.parse(serializeAuditNdjson([row]))).toEqual(row);
    expect(serializeAuditNdjson([row])).not.toBe(serializeAuditNdjson([{ payload: {} }]));
    expect(JSON.stringify(row)).toBe(original);
  });
});

describe("wormObjectKey", () => {
  test("keys by the UTC date of maxTs with the ts window in the filename", () => {
    // 2026-07-20T22:00:00Z .. 2026-07-20T23:30:00Z
    const since = Date.UTC(2026, 6, 20, 22, 0, 0);
    const max = Date.UTC(2026, 6, 20, 23, 30, 0);
    expect(wormObjectKey(since, max)).toBe(`audit/2026-07-20/${since}-${max}.ndjson`);
  });

  test("date prefix comes from maxTs, not sinceTs (a window that crosses midnight UTC)", () => {
    const since = Date.UTC(2026, 6, 20, 23, 59, 0);
    const max = Date.UTC(2026, 6, 21, 0, 1, 0);
    expect(wormObjectKey(since, max)).toBe(`audit/2026-07-21/${since}-${max}.ndjson`);
  });
});

describe("retainUntilDate", () => {
  test("returns now + RETENTION_MS as a Date", () => {
    const now = Date.UTC(2026, 0, 1, 0, 0, 0);
    expect(retainUntilDate(now).getTime()).toBe(now + RETENTION_MS);
  });

  test("RETENTION_MS is a positive default period", () => {
    expect(RETENTION_MS).toBeGreaterThan(0);
  });
});
