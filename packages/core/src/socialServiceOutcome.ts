import {
  type BufferDraft,
  type BufferPublicationReceipt,
  nativeSocialPostReference,
} from "./buffer";
import { serviceSourceFreshness } from "./serviceOutcomes";
import type { ZernioAccountReport, ZernioReport } from "./zernio";
import { ZERNIO_METRICS, zernioMetrics } from "./zernioPilot";

export type SocialDraftFact = Pick<BufferDraft, "channelId"> & {
  draftRef: string;
  tenantId: string;
  connectionId: string;
  managedServiceRunId?: string;
  revision: number;
  platform: string;
  status:
    | "draft"
    | "approved"
    | "submitting"
    | "scheduled"
    | "buffer_review"
    | "sent"
    | "failed"
    | "unknown"
    | "discarded";
  approvedAt?: number;
  bufferPostId?: string;
};

/** Only trusted persisted Buffer receipts joined to scoped provider analytics may supply this link.
 * Labels, similar ID strings and the Zernio external flag never establish publisher attribution. */
export type SocialNativePostLink = {
  tenantId: string;
  runId: string;
  draftRef: string;
  draftRevision: number;
  bufferConnectionId: string;
  bufferChannelId: string;
  bufferPostId: string;
  zernioConnectionId: string;
  zernioAccountId: string;
  platform: "instagram" | "tiktok";
  nativePostId: string;
  receiptRef: string;
};

type ReportAccount = ZernioAccountReport & { postCount?: number; sampled?: boolean };
export type SocialReportSnapshot = {
  tenantId: string;
  connectionId: string;
  report: Omit<ZernioReport, "accounts"> & { accounts: ReportAccount[] };
};
export type SocialOutcomeInput = {
  tenantId: string;
  runId: string;
  draft: SocialDraftFact;
  report: SocialReportSnapshot | null;
  selectedConnectionId: string | null;
  selectedAccountIds: readonly string[];
  nativeLink?: SocialNativePostLink;
  now: number;
  maxReportAgeMs: number;
};
type MissingReason =
  | "run_lineage_unavailable"
  | "approval_unavailable"
  | "publication_unconfirmed"
  | "report_unavailable"
  | "report_connection_changed"
  | "report_stale"
  | "account_not_covered"
  | "report_sampled"
  | "native_mapping_unavailable"
  | "native_mapping_mismatch"
  | "post_not_observed"
  | "metrics_unavailable";
type NextAction =
  | "review_draft"
  | "prepare_replacement"
  | "review_failed_publication"
  | "check_buffer_before_retry"
  | "check_buffer_status"
  | "review_publication_record"
  | "refresh_report"
  | "review_reporting_accounts"
  | "verify_native_mapping"
  | "review_full_report"
  | "report_unavailable_metrics"
  | "review_results_and_propose_next_cycle";
const invalid = (): never => {
  throw new Error("SOCIAL_OUTCOME_INVALID");
};
const ref = (v: unknown): v is string => typeof v === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(v);
const time = (v: unknown): v is number =>
  typeof v === "number" && Number.isSafeInteger(v) && v >= 0;

/** The adapter supplies current owned Buffer scope; this pure join requires exact provider URLs.
 * Instagram shortcodes never become numeric media IDs: the ID comes from actual analytics. */
export function socialNativeLinkFromReceipt(
  input: Pick<
    SocialOutcomeInput,
    | "tenantId"
    | "runId"
    | "draft"
    | "report"
    | "selectedConnectionId"
    | "selectedAccountIds"
    | "now"
  > & {
    receipt?: BufferPublicationReceipt;
  },
): SocialNativePostLink | undefined {
  const { receipt, draft, report } = input;
  if (
    !receipt ||
    !report ||
    draft.status !== "sent" ||
    draft.tenantId !== input.tenantId ||
    draft.managedServiceRunId !== input.runId ||
    report.tenantId !== input.tenantId ||
    report.connectionId !== input.selectedConnectionId ||
    receipt.source !== "buffer-status-v1" ||
    receipt.bufferPostId !== draft.bufferPostId ||
    receipt.channelId !== draft.channelId ||
    receipt.platform !== draft.platform ||
    receipt.draftRevision !== draft.revision ||
    receipt.approvedAt !== draft.approvedAt ||
    !time(receipt.sentAt) ||
    !time(receipt.observedAt) ||
    !time(receipt.approvedAt) ||
    receipt.approvedAt > receipt.sentAt ||
    receipt.sentAt > receipt.observedAt ||
    receipt.observedAt > input.now
  )
    return undefined;
  const native = nativeSocialPostReference(receipt.platform, receipt.nativePostUrl);
  if (
    !native ||
    native.url !== receipt.nativePostUrl ||
    (receipt.nativePostId !== null && receipt.nativePostId !== native.postId)
  )
    return undefined;
  const matches = report.report.accounts.flatMap((account) =>
    input.selectedAccountIds.includes(account.accountId) && account.platform === receipt.platform
      ? account.posts.flatMap((post) => {
          const observed = post.nativePostUrl
            ? nativeSocialPostReference(account.platform, post.nativePostUrl)
            : null;
          return observed?.url === native.url &&
            ref(post.postId) &&
            (native.postId === null || native.postId === post.postId)
            ? [{ accountId: account.accountId, postId: post.postId }]
            : [];
        })
      : [],
  );
  const match = matches.length === 1 ? matches[0] : undefined;
  if (!match) return undefined;
  if (
    report.report.accounts
      .find((account) => account.accountId === match.accountId)
      ?.posts.filter((post) => post.postId === match.postId).length !== 1
  )
    return undefined;
  return {
    tenantId: input.tenantId,
    runId: input.runId,
    draftRef: draft.draftRef,
    draftRevision: draft.revision,
    bufferConnectionId: draft.connectionId,
    bufferChannelId: draft.channelId,
    bufferPostId: receipt.bufferPostId,
    zernioConnectionId: report.connectionId,
    zernioAccountId: match.accountId,
    platform: receipt.platform,
    nativePostId: match.postId,
    receiptRef: draft.draftRef,
  };
}

function validateReport(snapshot: SocialReportSnapshot) {
  const report = snapshot.report;
  if (
    !report ||
    !ref(snapshot.connectionId) ||
    !time(report.fetchedAt) ||
    !Array.isArray(report.accounts) ||
    report.accounts.length > 2
  )
    invalid();
  const days = [report.fromDate, report.toDate].map((date) => {
    if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return invalid();
    const millis = Date.parse(`${date}T00:00:00.000Z`);
    if (!Number.isFinite(millis) || new Date(millis).toISOString().slice(0, 10) !== date)
      return invalid();
    return millis;
  });
  if ((days[1] ?? 0) < (days[0] ?? 0) || (days[1] ?? 0) - (days[0] ?? 0) > 89 * 86400_000)
    invalid();
  const accounts = new Set<string>();
  for (const account of report.accounts) {
    if (
      !ref(account.accountId) ||
      accounts.has(account.accountId) ||
      !["instagram", "tiktok"].includes(account.platform) ||
      !Array.isArray(account.posts) ||
      account.posts.length > 500
    )
      invalid();
    accounts.add(account.accountId);
    if (
      (account.sampled !== undefined && typeof account.sampled !== "boolean") ||
      (account.postCount !== undefined &&
        (!Number.isSafeInteger(account.postCount) ||
          account.postCount < account.posts.length ||
          account.postCount > 500))
    )
      invalid();
    if (
      (account.sampled === true &&
        (account.postCount === undefined || account.postCount <= account.posts.length)) ||
      (account.sampled === false &&
        account.postCount !== undefined &&
        account.postCount !== account.posts.length)
    )
      invalid();
    const posts = new Set<string>();
    for (const post of account.posts) {
      if (
        !ref(post.postId) ||
        posts.has(`${post.source}:${post.postId}`) ||
        !["external", "zernio"].includes(post.source) ||
        (post.updatedAt !== null &&
          (typeof post.updatedAt !== "string" || post.updatedAt.length > 100))
      )
        invalid();
      posts.add(`${post.source}:${post.postId}`);
      zernioMetrics(post.metrics);
    }
  }
}

/** Join content-plane facts only. Buffer queue acceptance, analytics retrieval, a successful
 * agent job and improved business results are four different observations. No writes or IO. */
export function projectSocialServiceOutcome(input: SocialOutcomeInput) {
  const { draft, report: snapshot, nativeLink: link } = input;
  if (link !== undefined && (!link || typeof link !== "object" || Array.isArray(link))) invalid();
  if (
    !ref(input.tenantId) ||
    !ref(input.runId) ||
    !draft ||
    draft.tenantId !== input.tenantId ||
    !ref(draft.draftRef) ||
    !ref(draft.connectionId) ||
    !ref(draft.channelId) ||
    !Number.isSafeInteger(draft.revision) ||
    draft.revision < 1 ||
    typeof draft.platform !== "string" ||
    draft.platform.length > 50 ||
    ![
      "draft",
      "approved",
      "submitting",
      "scheduled",
      "buffer_review",
      "sent",
      "failed",
      "unknown",
      "discarded",
    ].includes(draft.status) ||
    !time(input.now) ||
    !Number.isSafeInteger(input.maxReportAgeMs) ||
    input.maxReportAgeMs < 1 ||
    input.maxReportAgeMs > 90 * 86400_000 ||
    !Array.isArray(input.selectedAccountIds) ||
    input.selectedAccountIds.length > 2 ||
    input.selectedAccountIds.some((id) => !ref(id)) ||
    new Set(input.selectedAccountIds).size !== input.selectedAccountIds.length ||
    (input.selectedConnectionId !== null && !ref(input.selectedConnectionId)) ||
    (draft.approvedAt !== undefined && (!time(draft.approvedAt) || draft.approvedAt > input.now)) ||
    (draft.bufferPostId !== undefined && !ref(draft.bufferPostId))
  )
    invalid();
  if (snapshot) {
    if (snapshot.tenantId !== input.tenantId) invalid();
    validateReport(snapshot);
  }
  const reasons = new Set<MissingReason>();
  const lineage = draft.managedServiceRunId === input.runId;
  const approvalRecorded =
    draft.approvedAt !== undefined && !["draft", "discarded"].includes(draft.status);
  if (!lineage) reasons.add("run_lineage_unavailable");
  if (!approvalRecorded) reasons.add("approval_unavailable");
  if (draft.status !== "sent" || !draft.bufferPostId) reasons.add("publication_unconfirmed");
  const currentReport =
    snapshot && snapshot.connectionId === input.selectedConnectionId ? snapshot.report : null;
  if (!snapshot) reasons.add("report_unavailable");
  else if (!currentReport) reasons.add("report_connection_changed");
  const freshness = serviceSourceFreshness({
    fetchedAt: currentReport?.fetchedAt ?? -1,
    sourceUpdatedAt: null,
    now: input.now,
    maxAgeMs: input.maxReportAgeMs,
  });
  if (currentReport && freshness.retrieval !== "fresh") reasons.add("report_stale");
  const accounts =
    currentReport?.accounts.filter((account) =>
      input.selectedAccountIds.includes(account.accountId),
    ) ?? [];
  if (accounts.length !== input.selectedAccountIds.length || !accounts.length)
    reasons.add("account_not_covered");
  const sampled = accounts.some(
    (account) =>
      account.sampled === true ||
      (account.postCount ?? account.posts.length) > account.posts.length,
  );
  if (sampled) reasons.add("report_sampled");
  if (!link) reasons.add("native_mapping_unavailable");
  const linkMatches =
    link !== undefined &&
    ref(link.receiptRef) &&
    ref(link.nativePostId) &&
    Object.values(link).every((value) =>
      typeof value === "number" ? Number.isSafeInteger(value) && value > 0 : ref(value),
    ) &&
    link.tenantId === input.tenantId &&
    link.runId === input.runId &&
    link.draftRef === draft.draftRef &&
    link.draftRevision === draft.revision &&
    link.bufferConnectionId === draft.connectionId &&
    link.bufferChannelId === draft.channelId &&
    link.bufferPostId === draft.bufferPostId &&
    link.zernioConnectionId === input.selectedConnectionId &&
    input.selectedAccountIds.includes(link.zernioAccountId) &&
    link.platform === draft.platform &&
    ["instagram", "tiktok"].includes(link.platform);
  if (link && !linkMatches) reasons.add("native_mapping_mismatch");
  const attributed =
    lineage &&
    approvalRecorded &&
    draft.status === "sent" &&
    Boolean(draft.bufferPostId) &&
    linkMatches;
  const account = attributed
    ? accounts.find(
        (account) =>
          account.accountId === link?.zernioAccountId && account.platform === link.platform,
      )
    : undefined;
  const matchingPosts = account?.posts.filter((post) => post.postId === link?.nativePostId) ?? [];
  const post = matchingPosts.length === 1 ? matchingPosts[0] : undefined;
  if (attributed && !post) reasons.add("post_not_observed");
  const metrics = post ? zernioMetrics(post.metrics) : null;
  if (post && Object.keys(metrics ?? {}).length === 0) reasons.add("metrics_unavailable");
  const evidence =
    account && post && metrics
      ? {
          accountId: account.accountId,
          platform: account.platform,
          postId: post.postId,
          source: post.source,
          metrics,
          missingMetrics: ZERNIO_METRICS.filter((name) => metrics[name] === undefined),
          providerUpdatedAt: post.updatedAt,
          freshness: serviceSourceFreshness({
            fetchedAt: currentReport?.fetchedAt ?? -1,
            sourceUpdatedAt: post.updatedAt,
            now: input.now,
            maxAgeMs: input.maxReportAgeMs,
          }),
          metricScope: "post_lifetime" as const,
        }
      : null;
  let nextAction: NextAction;
  if (["unknown", "submitting"].includes(draft.status)) nextAction = "check_buffer_before_retry";
  else if (!lineage || (draft.status === "sent" && !approvalRecorded))
    nextAction = "review_publication_record";
  else if (draft.status === "draft") nextAction = "review_draft";
  else if (draft.status === "discarded") nextAction = "prepare_replacement";
  else if (draft.status === "failed") nextAction = "review_failed_publication";
  else if (draft.status !== "sent") nextAction = "check_buffer_status";
  else if (!currentReport || freshness.retrieval !== "fresh") nextAction = "refresh_report";
  else if (reasons.has("account_not_covered")) nextAction = "review_reporting_accounts";
  else if (link && !linkMatches) nextAction = "review_publication_record";
  else if (!link) nextAction = "verify_native_mapping";
  else if (!post) nextAction = sampled ? "review_full_report" : "refresh_report";
  else if (!Object.keys(metrics ?? {}).length) nextAction = "report_unavailable_metrics";
  else nextAction = "review_results_and_propose_next_cycle";
  return {
    draftRef: draft.draftRef,
    runId: input.runId,
    publication: {
      status: draft.status,
      approvalRecorded,
      bufferPostId: draft.bufferPostId ?? null,
    },
    publisherAttribution: attributed ? ("buffer_receipt_linked" as const) : ("unverified" as const),
    reporting: {
      provider: "zernio" as const,
      fetchedAt: currentReport?.fetchedAt ?? null,
      retrieval: freshness.retrieval,
      window: currentReport
        ? { fromDate: currentReport.fromDate, toDate: currentReport.toDate }
        : null,
      selectedAccountCount: input.selectedAccountIds.length,
      coveredAccountCount: accounts.length,
      accounts: accounts.map((account) => ({
        accountId: account.accountId,
        platform: account.platform,
        observedPostCount: account.posts.length,
        totalPostCount: account.postCount ?? account.posts.length,
      })),
      sampled,
      reasons: [...reasons],
    },
    evidence,
    nextAction,
    // Neither a known zero nor a fresh lifetime metric proves causation or business improvement.
    businessImprovement: "not_established" as const,
    automaticallyStartNextCycle: false as const,
  };
}
