import { describe, expect, test } from "vitest";
import {
  serviceReportIdentity,
  serviceReportMovement,
  serviceSourceFreshness,
} from "./serviceOutcomes";
import type { ZernioReport } from "./zernio";

function head<T>(items: readonly T[]): T {
  const value = items[0];
  if (value === undefined) throw new Error("missing fixture row");
  return value;
}
const now = Date.parse("2026-10-23T12:00:00Z");
const report = (likes: number | undefined = 0): ZernioReport => ({
  fromDate: "2026-08-01",
  toDate: "2026-10-23",
  fetchedAt: now,
  accounts: [
    {
      accountId: "account",
      platform: "instagram",
      posts: [
        {
          postId: "post",
          source: "external",
          updatedAt: "2026-10-23T11:00:00Z",
          metrics: likes === undefined ? {} : { likes },
        },
      ],
    },
  ],
});
describe("service observation provenance", () => {
  test("retrieval does not renew upstream observations or invent a timezone", () => {
    for (const sourceUpdatedAt of [null, "2026-10-23T11:00:00", "invalid", "2026-10-24T11:00:00Z"])
      expect(
        serviceSourceFreshness({ fetchedAt: now, sourceUpdatedAt, now, maxAgeMs: 86400000 }),
      ).toEqual({ retrieval: "fresh", upstream: "unknown", sourceObservedAt: null });
    expect(
      serviceSourceFreshness({
        fetchedAt: now,
        sourceUpdatedAt: "2026-10-20T11:00:00Z",
        now,
        maxAgeMs: 86400000,
      }).upstream,
    ).toBe("stale");
  });
  test("retrieval-only updates deduplicate, source and publication-window changes persist", () => {
    const a = report(),
      b = report();
    b.fetchedAt++;
    expect(serviceReportIdentity(a)).toBe(serviceReportIdentity(b));
    head(head(b.accounts).posts).updatedAt = "2026-10-23T11:30:00Z";
    expect(serviceReportIdentity(a)).not.toBe(serviceReportIdentity(b));
    head(head(b.accounts).posts).updatedAt = head(head(a.accounts).posts).updatedAt;
    b.fromDate = "2026-08-02";
    expect(serviceReportIdentity(a)).not.toBe(serviceReportIdentity(b));
  });
  test("native same-post metrics preserve zero separately from missing and never imply a business result", () => {
    const before = report(0),
      after = report(3);
    head(head(after.accounts).posts).updatedAt = "2026-10-23T11:30:00Z";
    const row = head(serviceReportMovement(before, after, now, 86400000));
    expect(row.metrics.find((m) => m.metric === "likes")).toEqual({
      metric: "likes",
      previous: 0,
      current: 3,
      delta: 3,
    });
    expect(row.metrics.find((m) => m.metric === "reach")?.delta).toBeNull();
    expect(row).not.toHaveProperty("businessImprovement");
  });
  test("foreign post, account, source, stale and missing upstream times cannot prove movement", () => {
    const before = report(0);
    for (const change of [
      (r: ZernioReport) => {
        head(r.accounts).accountId = "other";
      },
      (r: ZernioReport) => {
        head(head(r.accounts).posts).postId = "other";
      },
      (r: ZernioReport) => {
        head(head(r.accounts).posts).source = "zernio";
      },
      (r: ZernioReport) => {
        head(head(r.accounts).posts).updatedAt = null;
      },
      (r: ZernioReport) => {
        head(head(r.accounts).posts).updatedAt = "2026-10-20T11:00:00Z";
      },
    ]) {
      const after = report(3);
      change(after);
      expect(
        head(serviceReportMovement(before, after, now, 86400000)).metrics.find(
          (m) => m.metric === "likes",
        )?.delta,
      ).toBeNull();
    }
  });
  test("duplicate scopes and malformed metrics refuse before persistence", () => {
    const duplicate = report();
    duplicate.accounts.push(head(duplicate.accounts));
    expect(() => serviceReportIdentity(duplicate)).toThrow("INVALID_SERVICE_OBSERVATION");
    for (const value of [NaN, Infinity, -1])
      expect(() => serviceReportIdentity(report(value))).toThrow();
  });
  test("conflicting values at the same source time do not establish movement", () => {
    expect(
      head(serviceReportMovement(report(1), report(2), now, 86400000)).metrics.find(
        (m) => m.metric === "likes",
      )?.delta,
    ).toBeNull();
    expect(
      head(serviceReportMovement(report(0), report(0), now, 86400000)).metrics.find(
        (m) => m.metric === "likes",
      )?.delta,
    ).toBe(0);
  });
});
