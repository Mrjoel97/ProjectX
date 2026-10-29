import { nativeSocialPostReference } from "./buffer";
import type { ZernioReport } from "./zernio";
import { ZERNIO_METRICS } from "./zernioPilot";

export const SERVICE_OBSERVATION_LIMIT = 30;
type Freshness = "fresh" | "stale" | "unknown";

/** Retrieval and upstream observation are independent clocks; zoneless strings prove neither. */
export function serviceSourceFreshness(input: {
  fetchedAt: number;
  sourceUpdatedAt: string | null;
  now: number;
  maxAgeMs: number;
}): { retrieval: Freshness; upstream: Freshness; sourceObservedAt: number | null } {
  const valid =
    Number.isFinite(input.now) &&
    input.now >= 0 &&
    Number.isFinite(input.maxAgeMs) &&
    input.maxAgeMs >= 0;
  const classify = (time: number): Freshness =>
    !valid || !Number.isFinite(time) || time < 0 || time > input.now
      ? "unknown"
      : input.now - time > input.maxAgeMs
        ? "stale"
        : "fresh";
  const source =
    input.sourceUpdatedAt && /(?:Z|[+-]\d{2}:\d{2})$/.test(input.sourceUpdatedAt)
      ? Date.parse(input.sourceUpdatedAt)
      : Number.NaN;
  const upstream = classify(source);
  return {
    retrieval: classify(input.fetchedAt),
    upstream,
    sourceObservedAt: upstream === "unknown" ? null : source,
  };
}

/** Canonical metrics scope, excluding retrieval time; array order cannot manufacture history. */
export function serviceReportIdentity(report: ZernioReport): string {
  if (
    !Number.isSafeInteger(report.fetchedAt) ||
    report.fetchedAt < 0 ||
    report.accounts.length > 2 ||
    !/^\d{4}-\d{2}-\d{2}$/.test(report.fromDate) ||
    !/^\d{4}-\d{2}-\d{2}$/.test(report.toDate) ||
    report.fromDate > report.toDate
  )
    throw new Error("INVALID_SERVICE_OBSERVATION");
  const accountIds = new Set<string>();
  let count = 0;
  const accounts = report.accounts
    .map((account) => {
      if (
        accountIds.has(account.accountId) ||
        !account.accountId ||
        !["instagram", "tiktok"].includes(account.platform)
      )
        throw new Error("INVALID_SERVICE_OBSERVATION");
      accountIds.add(account.accountId);
      const posts = new Set<string>();
      return {
        accountId: account.accountId,
        platform: account.platform,
        posts: account.posts
          .map((post) => {
            const key = `${post.source}:${post.postId}`;
            if (
              ++count > 1000 ||
              !post.postId ||
              posts.has(key) ||
              !["external", "zernio"].includes(post.source)
            )
              throw new Error("INVALID_SERVICE_OBSERVATION");
            posts.add(key);
            const metrics = Object.fromEntries(
              ZERNIO_METRICS.flatMap((name) => {
                const value = post.metrics[name];
                if (value === undefined) return [];
                if (!Number.isFinite(value) || value < 0)
                  throw new Error("INVALID_SERVICE_OBSERVATION");
                return [[name, value]];
              }),
            );
            const native =
              post.nativePostUrl === undefined
                ? null
                : nativeSocialPostReference(account.platform, post.nativePostUrl);
            if (post.nativePostUrl !== undefined && native?.url !== post.nativePostUrl)
              throw new Error("INVALID_SERVICE_OBSERVATION");
            return {
              postId: post.postId,
              source: post.source,
              updatedAt: post.updatedAt,
              metrics,
              ...(native ? { nativePostUrl: native.url } : {}),
            };
          })
          .sort((a, b) => a.source.localeCompare(b.source) || a.postId.localeCompare(b.postId)),
      };
    })
    .sort((a, b) => a.accountId.localeCompare(b.accountId));
  return JSON.stringify({ fromDate: report.fromDate, toDate: report.toDate, accounts });
}

/** Values describe post-lifetime movement, never campaign attribution or business improvement. */
export function serviceReportMovement(
  previous: ZernioReport,
  current: ZernioReport,
  now: number,
  maxAgeMs: number,
) {
  serviceReportIdentity(previous);
  serviceReportIdentity(current);
  return current.accounts.flatMap((account) =>
    account.posts.map((post) => {
      const before = previous.accounts
        .find((a) => a.accountId === account.accountId && a.platform === account.platform)
        ?.posts.find((p) => p.postId === post.postId && p.source === post.source);
      const freshness = serviceSourceFreshness({
        fetchedAt: current.fetchedAt,
        sourceUpdatedAt: post.updatedAt,
        now,
        maxAgeMs,
      });
      const priorSource = before
        ? serviceSourceFreshness({
            fetchedAt: previous.fetchedAt,
            sourceUpdatedAt: before.updatedAt,
            now,
            maxAgeMs,
          }).sourceObservedAt
        : null;
      const comparable =
        !!before &&
        current.fetchedAt >= previous.fetchedAt &&
        freshness.retrieval === "fresh" &&
        freshness.upstream === "fresh" &&
        priorSource !== null &&
        freshness.sourceObservedAt !== null &&
        freshness.sourceObservedAt >= priorSource;
      return {
        accountId: account.accountId,
        platform: account.platform,
        postId: post.postId,
        source: post.source,
        freshness,
        metrics: ZERNIO_METRICS.map((metric) => {
          const from = before?.metrics[metric];
          const to = post.metrics[metric];
          return {
            metric,
            previous: from ?? null,
            current: to ?? null,
            delta:
              comparable &&
              from !== undefined &&
              to !== undefined &&
              (freshness.sourceObservedAt !== priorSource || from === to)
                ? to - from
                : null,
          };
        }),
      };
    }),
  );
}
