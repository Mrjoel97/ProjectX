import { describe, expect, test } from "vitest";
import { projectSocialServiceOutcome, type SocialOutcomeInput } from "./socialServiceOutcome";

const now = Date.parse("2026-10-23T12:00:00Z");
function input(): SocialOutcomeInput {
  return {
    tenantId: "tenant-a",
    runId: "run-a",
    now,
    maxReportAgeMs: 86400_000,
    selectedConnectionId: "zernio-connection",
    selectedAccountIds: ["zernio-account"],
    draft: {
      draftRef: "local-draft",
      tenantId: "tenant-a",
      managedServiceRunId: "run-a",
      connectionId: "buffer-connection",
      channelId: "buffer-channel",
      revision: 2,
      platform: "instagram",
      status: "sent",
      approvedAt: now - 2000,
      bufferPostId: "buffer-post",
    },
    report: {
      tenantId: "tenant-a",
      connectionId: "zernio-connection",
      report: {
        fromDate: "2026-10-01",
        toDate: "2026-10-23",
        fetchedAt: now - 1000,
        accounts: [
          {
            accountId: "zernio-account",
            platform: "instagram",
            posts: [
              {
                postId: "native-post",
                source: "external",
                updatedAt: "2026-10-23T11:00:00Z",
                metrics: { likes: 0, views: 12 },
              },
            ],
          },
        ],
      },
    },
    nativeLink: {
      tenantId: "tenant-a",
      runId: "run-a",
      draftRef: "local-draft",
      draftRevision: 2,
      bufferConnectionId: "buffer-connection",
      bufferChannelId: "buffer-channel",
      bufferPostId: "buffer-post",
      zernioConnectionId: "zernio-connection",
      zernioAccountId: "zernio-account",
      platform: "instagram",
      nativePostId: "native-post",
      receiptRef: "trusted-native-receipt",
    },
  };
}
function report(value: SocialOutcomeInput) {
  if (!value.report) throw new Error("fixture report");
  return value.report.report;
}
function link(value: SocialOutcomeInput) {
  if (!value.nativeLink) throw new Error("fixture link");
  return value.nativeLink;
}
function account(value: SocialOutcomeInput) {
  const result = report(value).accounts[0];
  if (!result) throw new Error("fixture account");
  return result;
}
function post(value: SocialOutcomeInput) {
  const result = account(value).posts[0];
  if (!result) throw new Error("fixture post");
  return result;
}

test("a native receipt binds exact approved revision, run, account and post without claiming business growth", () => {
  const result = projectSocialServiceOutcome(input());
  expect(result.publisherAttribution).toBe("buffer_receipt_linked");
  expect(result.reporting.reasons).toEqual([]);
  expect(result.evidence?.metrics).toEqual({ likes: 0, views: 12 });
  expect(result.evidence?.missingMetrics).toContain("reach");
  expect(result.evidence?.missingMetrics).not.toContain("likes");
  expect(result.evidence?.metricScope).toBe("post_lifetime");
  expect(result.nextAction).toBe("review_results_and_propose_next_cycle");
  expect(result.businessImprovement).toBe("not_established");
  expect(result.automaticallyStartNextCycle).toBe(false);
});

test("current native stores lacking a mapping never infer Buffer publisher from matching IDs or external source", () => {
  const value = input();
  delete value.nativeLink;
  post(value).postId = "buffer-post";
  const result = projectSocialServiceOutcome(value);
  expect(result.publisherAttribution).toBe("unverified");
  expect(result.evidence).toBeNull();
  expect(result.reporting.reasons).toContain("native_mapping_unavailable");
  expect(result.reporting.coveredAccountCount).toBe(1);
  expect(result.reporting.accounts[0]?.observedPostCount).toBe(1);
  expect(result.nextAction).toBe("verify_native_mapping");
});

test("receipt mismatches cannot move another draft, revision, account or platform into this outcome", () => {
  const mutations: ((value: SocialOutcomeInput) => void)[] = [
    (v) => {
      link(v).tenantId = "tenant-b";
    },
    (v) => {
      link(v).runId = "other-run";
    },
    (v) => {
      link(v).draftRef = "other-draft";
    },
    (v) => {
      link(v).draftRevision++;
    },
    (v) => {
      link(v).bufferConnectionId = "reconnected";
    },
    (v) => {
      link(v).bufferChannelId = "other-channel";
    },
    (v) => {
      link(v).bufferPostId = "other-buffer-post";
    },
    (v) => {
      link(v).zernioConnectionId = "other-connection";
    },
    (v) => {
      link(v).zernioAccountId = "other-account";
    },
    (v) => {
      link(v).platform = "tiktok";
    },
    (v) => {
      link(v).receiptRef = "";
    },
  ];
  for (const mutate of mutations) {
    const value = input();
    mutate(value);
    const result = projectSocialServiceOutcome(value);
    expect(result.publisherAttribution).toBe("unverified");
    expect(result.evidence).toBeNull();
    expect(result.reporting.reasons).toContain("native_mapping_mismatch");
    expect(result.nextAction).toBe("review_publication_record");
  }
});

test("a native post ID in the wrong account or platform does not match", () => {
  for (const mutate of [
    (v: SocialOutcomeInput) => {
      account(v).accountId = "other-account";
    },
    (v: SocialOutcomeInput) => {
      account(v).platform = "tiktok";
    },
  ]) {
    const value = input();
    mutate(value);
    const result = projectSocialServiceOutcome(value);
    expect(result.evidence).toBeNull();
    expect(result.reporting.reasons).toContain("post_not_observed");
  }
});

describe("publication and its next decision stay separate from engagement", () => {
  test.each([
    ["draft", "review_draft"],
    ["discarded", "prepare_replacement"],
    ["approved", "check_buffer_status"],
    ["scheduled", "check_buffer_status"],
    ["buffer_review", "check_buffer_status"],
    ["submitting", "check_buffer_before_retry"],
    ["unknown", "check_buffer_before_retry"],
    ["failed", "review_failed_publication"],
  ] as const)("%s is never delivery or a replay instruction", (status, expected) => {
    const value = input();
    value.draft.status = status;
    const result = projectSocialServiceOutcome(value);
    expect(result.publication.status).toBe(status);
    expect(result.publisherAttribution).toBe("unverified");
    expect(result.evidence).toBeNull();
    expect(result.nextAction).toBe(expected);
    expect(result.automaticallyStartNextCycle).toBe(false);
  });
});

test("missing approval or service lineage prevents attribution even when provider status is sent", () => {
  for (const mutate of [
    (v: SocialOutcomeInput) => {
      delete v.draft.approvedAt;
    },
    (v: SocialOutcomeInput) => {
      delete v.draft.managedServiceRunId;
    },
    (v: SocialOutcomeInput) => {
      v.draft.managedServiceRunId = "old-run";
    },
  ]) {
    const value = input();
    mutate(value);
    const result = projectSocialServiceOutcome(value);
    expect(result.publisherAttribution).toBe("unverified");
    expect(result.evidence).toBeNull();
    expect(result.nextAction).toBe("review_publication_record");
  }
});

test("fresh retrieval cannot make unknown or stale upstream metrics fresh", () => {
  const value = input();
  post(value).updatedAt = "2026-10-23 11:00:00";
  expect(projectSocialServiceOutcome(value).evidence?.freshness).toEqual({
    retrieval: "fresh",
    upstream: "unknown",
    sourceObservedAt: null,
  });
  post(value).updatedAt = null;
  expect(projectSocialServiceOutcome(value).evidence?.freshness.upstream).toBe("unknown");
  post(value).updatedAt = "2026-10-01T10:00:00Z";
  expect(projectSocialServiceOutcome(value).evidence?.freshness.upstream).toBe("stale");
  report(value).fetchedAt = now - 2 * 86400_000;
  const result = projectSocialServiceOutcome(value);
  expect(result.reporting.retrieval).toBe("stale");
  expect(result.reporting.reasons).toContain("report_stale");
  expect(result.nextAction).toBe("refresh_report");
});

test("missing cache and replaced connection remain unavailable rather than zero engagement", () => {
  const missing = input();
  missing.report = null;
  const absent = projectSocialServiceOutcome(missing);
  expect(absent.evidence).toBeNull();
  expect(absent.reporting.reasons).toContain("report_unavailable");
  expect(absent.reporting.retrieval).toBe("unknown");
  const replaced = input();
  replaced.selectedConnectionId = "new-connection";
  const result = projectSocialServiceOutcome(replaced);
  expect(result.reporting.accounts).toEqual([]);
  expect(result.evidence).toBeNull();
  expect(result.reporting.reasons).toContain("report_connection_changed");
});

test("a missing post in a 20-post sample is incomplete evidence, not a proved absence", () => {
  const value = input();
  account(value).posts = Array.from({ length: 20 }, (_, i) => ({
    ...post(input()),
    postId: `other-${i}`,
  }));
  account(value).postCount = 100;
  account(value).sampled = true;
  const result = projectSocialServiceOutcome(value);
  expect(result.reporting.sampled).toBe(true);
  expect(result.reporting.accounts[0]).toMatchObject({
    observedPostCount: 20,
    totalPostCount: 100,
  });
  expect(result.evidence).toBeNull();
  expect(result.reporting.reasons).toContain("post_not_observed");
  expect(result.nextAction).toBe("review_full_report");
});

test("an empty metric object remains missing and no reach/rate or cross-account totals are invented", () => {
  const value = input();
  post(value).metrics = {};
  const result = projectSocialServiceOutcome(value);
  expect(result.evidence?.metrics).toEqual({});
  expect(result.evidence?.missingMetrics).toHaveLength(9);
  expect(result.nextAction).toBe("report_unavailable_metrics");
  expect(result).not.toHaveProperty("totalReach");
  expect(result).not.toHaveProperty("engagementRate");
});

test("tenant confusion, duplicate native rows, invalid metrics and oversized reports refuse", () => {
  const mutations: ((value: SocialOutcomeInput) => void)[] = [
    (v) => {
      v.draft.tenantId = "tenant-b";
    },
    (v) => {
      if (v.report) v.report.tenantId = "tenant-b";
    },
    (v) => {
      account(v).posts.push({ ...post(v) });
    },
    (v) => {
      post(v).metrics.likes = Number.NaN;
    },
    (v) => {
      post(v).metrics.views = -1;
    },
    (v) => {
      v.now = Infinity;
    },
    (v) => {
      account(v).posts = Array.from({ length: 501 }, (_, i) => ({
        ...post(input()),
        postId: `id-${i}`,
      }));
    },
    (v) => {
      report(v).fromDate = "2026-02-31";
    },
  ];
  for (const mutate of mutations) {
    const value = input();
    mutate(value);
    expect(() => projectSocialServiceOutcome(value)).toThrow();
  }
});

test("content, credentials, unknown metric properties and provider errors never enter projection", () => {
  const value = input();
  Object.assign(value.draft, {
    text: "private draft content",
    failure: "raw provider error",
    ciphertextB64: "private-key-bytes",
  });
  Object.assign(post(value).metrics, { token: "secret-token" });
  const output = JSON.stringify(projectSocialServiceOutcome(value));
  for (const secret of [
    "private draft content",
    "raw provider error",
    "private-key-bytes",
    "secret-token",
  ])
    expect(output).not.toContain(secret);
});
