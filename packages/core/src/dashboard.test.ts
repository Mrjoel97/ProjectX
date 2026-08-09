import { describe, expect, it } from "vitest";
import {
  DASHBOARD_STATE_COPY,
  compareDashboardOrder,
  createDashboardBound,
  createDashboardMoney,
  dashboardCursorFor,
  parseDashboardCursor,
  resolveDashboardWindow,
} from "./dashboard";
import type { DashboardResult } from "./dashboard";

const DAY_MS = 86_400_000;

describe("dashboard page contracts", () => {
  describe("resolveDashboardWindow", () => {
    it("keeps a half-open window and records a tenant IANA timezone", () => {
      expect(
        resolveDashboardWindow({
          sinceMs: 1_000,
          untilMs: 2_000,
          maxSpanMs: DAY_MS,
          tenantTimeZone: "Africa/Dar_es_Salaam",
          browserTimeZone: "Europe/London",
        }),
      ).toEqual({
        sinceMs: 1_000,
        untilMs: 2_000,
        timeZone: "Africa/Dar_es_Salaam",
        timeZoneSource: "tenant",
      });
    });

    it("clamps to explicit coverage bounds and marks browser fallback", () => {
      expect(
        resolveDashboardWindow({
          sinceMs: 500,
          untilMs: 5_000,
          maxSpanMs: DAY_MS,
          coverageSinceMs: 1_000,
          coverageUntilMs: 4_000,
          browserTimeZone: "America/New_York",
        }),
      ).toEqual({
        sinceMs: 1_000,
        untilMs: 4_000,
        timeZone: "America/New_York",
        timeZoneSource: "browser-fallback",
      });
    });

    it.each([
      [{ sinceMs: 2_000, untilMs: 1_000, maxSpanMs: DAY_MS }, "before untilMs"],
      [{ sinceMs: 1_000, untilMs: 1_000, maxSpanMs: DAY_MS }, "before untilMs"],
      [{ sinceMs: 0, untilMs: 91 * DAY_MS, maxSpanMs: 90 * DAY_MS }, "maximum"],
      [{ sinceMs: Number.NaN, untilMs: 1_000, maxSpanMs: DAY_MS }, "safe integer"],
    ])("rejects an invalid half-open window %#", (window, message) => {
      expect(() =>
        resolveDashboardWindow({
          ...window,
          browserTimeZone: "UTC",
        }),
      ).toThrow(message);
    });

    it("rejects an invalid named timezone instead of silently changing zones", () => {
      expect(() =>
        resolveDashboardWindow({
          sinceMs: 1_000,
          untilMs: 2_000,
          maxSpanMs: DAY_MS,
          browserTimeZone: "not/a-zone",
        }),
      ).toThrow("IANA");
    });
  });

  describe("money", () => {
    it.each(["estimated", "reserved", "actual", "refunded", "unlanded"] as const)(
      "keeps %s distinct in integer USD cents",
      (phase) => {
        expect(createDashboardMoney(phase, 123)).toEqual({ phase, amountCents: 123, currency: "USD" });
      },
    );

    it.each([-1, 1.5, Number.POSITIVE_INFINITY])("rejects invalid cents %s", (amountCents) => {
      expect(() => createDashboardMoney("actual", amountCents)).toThrow("cents");
    });
  });

  describe("bounded results", () => {
    it("states honest partial coverage even when there is no next page", () => {
      expect(
        createDashboardBound({
          returned: 20,
          limit: 20,
          nextCursor: null,
          partial: true,
          partialReason: "legacy-window",
        }),
      ).toEqual({
        returned: 20,
        limit: 20,
        nextCursor: null,
        partial: true,
        partialReason: "legacy-window",
      });
    });

    it("rejects dishonest or impossible metadata", () => {
      expect(() =>
        createDashboardBound({ returned: 21, limit: 20, nextCursor: null, partial: false }),
      ).toThrow("returned");
      expect(() =>
        createDashboardBound({
          returned: 1,
          limit: 20,
          nextCursor: null,
          partial: false,
          partialReason: "row-cap",
        }),
      ).toThrow("partialReason");
    });
  });

  describe("stable order and cursors", () => {
    it("orders newest first and breaks timestamp ties by id", () => {
      const rows = [
        { createdAt: 20, id: "b" },
        { createdAt: 30, id: "a" },
        { createdAt: 20, id: "a" },
      ];
      expect([...rows].sort(compareDashboardOrder)).toEqual([rows[1], rows[0], rows[2]]);
    });

    it("round-trips a cursor and refuses malformed cursors", () => {
      const key = { createdAt: 1_725_000_000_000, id: "plan:alpha/beta" };
      expect(parseDashboardCursor(dashboardCursorFor(key))).toEqual(key);
      expect(() => parseDashboardCursor("broken")).toThrow("cursor");
    });
  });

  it("owns copy for every page state instead of accepting server prose", () => {
    expect(Object.keys(DASHBOARD_STATE_COPY).sort()).toEqual([
      "busy",
      "empty",
      "error",
      "loading",
      "partial",
      "ready",
      "refusal",
    ]);
    expect(DASHBOARD_STATE_COPY.error.retry).toBe(true);
    expect(DASHBOARD_STATE_COPY.refusal.retry).toBe(false);
  });

  it("keeps data, partial success, errors and refusals in closed result shapes", () => {
    const results: DashboardResult<readonly string[]>[] = [
      { state: "loading" },
      { state: "empty" },
      {
        state: "ready",
        data: [],
        bound: { returned: 0, limit: 20, nextCursor: null, partial: false },
      },
      {
        state: "partial",
        data: ["row"],
        bound: {
          returned: 1,
          limit: 20,
          nextCursor: null,
          partial: true,
          partialReason: "coverage-gap",
        },
      },
      { state: "busy" },
      { state: "error", code: "query-failed", retryable: true },
      { state: "refusal", reason: "owner-required" },
    ];
    expect(results.map((result) => result.state)).toEqual(Object.keys(DASHBOARD_STATE_COPY));
  });
});
