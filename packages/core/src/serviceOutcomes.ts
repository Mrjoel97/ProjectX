import { nativeSocialPostReference } from "./buffer";
import type { projectSocialServiceOutcome } from "./socialServiceOutcome";
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

const servicePage = "/dashboard/marketing#social-service";
const publishingPage = "/dashboard/marketing#publishing";
const reportingPage = "/dashboard/marketing#reports";

type DecisionEvidence = {
  operational: string;
  usefulness: string;
  reporting: {
    state: string;
    sourceFailure: boolean;
    movement: ReturnType<typeof serviceReportMovement> | null;
  };
  social: ReadonlyArray<
    Pick<ReturnType<typeof projectSocialServiceOutcome>, "evidence" | "nextAction">
  >;
};

export function chooseSocialDecision(outcome: DecisionEvidence, reports: boolean) {
  const decision = (
    code: string,
    title: string,
    reason: string,
    actionLabel: string,
    href = servicePage,
  ) => ({ code, title, reason, actionLabel, href });
  if (outcome.operational === "unknown")
    return decision(
      "reconcile",
      "Check the interrupted social run",
      "Its final status is uncertain. Check the record before starting more work.",
      "Check run",
    );
  if (outcome.operational === "failed" || outcome.operational === "stopped")
    return decision(
      "recover",
      "Review the interrupted social run",
      "The latest run ended before the service completed its work.",
      "Review run",
    );
  if (outcome.usefulness === "rejected")
    return decision(
      "revise",
      "Revise your social brief",
      "You marked the latest result as needing improvement. Review the brief before preparing another batch.",
      "Review service setup",
    );
  if (
    outcome.social.some(
      (post) =>
        post.nextAction === "check_buffer_before_retry" ||
        post.nextAction === "review_failed_publication",
    )
  )
    return decision(
      "check_publication",
      "Check the posting status",
      "A saved post has an unresolved or failed publication. Check its status before trying again.",
      "Review posts",
      publishingPage,
    );
  if (outcome.social.some((post) => post.nextAction === "review_draft"))
    return decision(
      "review_drafts",
      "Review your prepared social drafts",
      "The latest run has saved drafts waiting for your review.",
      "Review drafts",
      publishingPage,
    );
  if (outcome.usefulness === "unreviewed")
    return decision(
      "review_result",
      "Was the latest social work useful?",
      "Your social run completed. Review its output and tell Pikar what to change.",
      "Review result",
    );
  if (reports && outcome.reporting.state === "unavailable")
    return decision(
      "check_reporting",
      "Check your reporting connection",
      "The selected reporting accounts cannot currently supply evidence for this run.",
      "Open reporting",
      reportingPage,
    );
  if (reports && outcome.reporting.state === "stale")
    return decision(
      "refresh_report",
      "Refresh the social report",
      "The latest report needs a successful refresh before it can guide another cycle.",
      "Open reporting",
      reportingPage,
    );
  const linked = outcome.social.find(
    (post) =>
      post.nextAction === "review_results_and_propose_next_cycle" &&
      post.evidence?.freshness.upstream === "fresh" &&
      post.evidence.freshness.retrieval === "fresh",
  );
  if (linked?.evidence && !outcome.reporting.sourceFailure) {
    const evidence = linked.evidence;
    const comparison = outcome.reporting.movement
      ?.find(
        (row) =>
          row.accountId === evidence.accountId &&
          row.platform === evidence.platform &&
          row.postId === evidence.postId &&
          row.source === evidence.source,
      )
      ?.metrics.find((metric) => metric.delta !== null && metric.delta !== 0);
    if (comparison)
      return decision(
        "plan_next_cycle",
        "Test a variation of your last post",
        `Lifetime ${comparison.metric} on the linked ${evidence.platform} post changed from ${comparison.previous} to ${comparison.current}. Try a draft on the same topic with a different opening, then compare the posts at the same age.`,
        "Review results",
        reportingPage,
      );
    const example = Object.entries(evidence.metrics)[0];
    if (example)
      return decision(
        "plan_next_cycle",
        "Use the latest post as a baseline",
        `The linked ${evidence.platform} post has a lifetime ${example[0]} count of ${example[1]}. Keep this as a baseline and check the next comparable observation before changing the plan.`,
        "Review results",
        reportingPage,
      );
  }
  if (reports && outcome.reporting.state === "ready")
    return decision(
      "compare",
      "Review your latest account observations",
      "Two account snapshots are available. Compare their coverage and dates before changing your social plan.",
      "Review evidence",
      reportingPage,
    );
  return null;
}
