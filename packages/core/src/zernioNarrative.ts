import { ZERNIO_DAY_MS, type ZernioAccountReport, type ZernioReport } from "./zernio";

export type ZernioNarrativeReport = Omit<ZernioReport, "accounts"> & {
  accounts: (ZernioAccountReport & { postCount?: number; sampled?: boolean })[];
};

/** A factual snapshot summary, not an inferred campaign performance assessment. */
export function buildZernioNarrative(report: ZernioNarrativeReport, now: number): string[] {
  const fetched = Number.isFinite(report.fetchedAt)
    ? new Date(report.fetchedAt).toISOString()
    : "unavailable";
  const stale =
    !Number.isFinite(report.fetchedAt) ||
    report.fetchedAt > now ||
    now - report.fetchedAt > ZERNIO_DAY_MS;
  const paragraphs = [
    `Zernio engagement snapshot retrieved ${fetched}. Requested reporting window: ${report.fromDate} to ${report.toDate}. ${stale ? "This cached snapshot is old or has an invalid retrieval time; refresh before making current decisions." : "Retrieval time is when Pikar received the snapshot, not when the social platform last updated its metrics."}`,
    "These are individual posts' lifetime metrics, not engagement earned during the reporting window. Missing metrics mean unavailable, not zero. This snapshot alone cannot establish growth, campaign impact, or whether Buffer published a post. Reach and engagement rates are not aggregated.",
  ];
  for (const account of report.accounts) {
    // Match the agent's bounded view even when the dashboard has the full cached snapshot.
    const posts = account.posts.slice(0, 20);
    const total = Math.max(account.postCount ?? account.posts.length, account.posts.length);
    const sampled = account.sampled === true || total > posts.length;
    paragraphs.push(
      `${account.platform === "tiktok" ? "TikTok" : "Instagram"} account ${account.accountId}: ${total} posts in the retrieved snapshot; this summary examines ${posts.length}${sampled ? " sampled posts, so it is not a ranking of the whole account" : " posts"}.`,
    );
    const ranked = posts
      .filter((post) => Number.isFinite(post.metrics.views) && (post.metrics.views ?? -1) >= 0)
      .sort((a, b) => (b.metrics.views ?? 0) - (a.metrics.views ?? 0));
    const strongest = ranked[0];
    if (!strongest) {
      paragraphs.push(
        "No supported view counts are available in this sample, so a strongest example by views cannot be identified.",
      );
      continue;
    }
    const metrics = (["views", "likes", "comments", "shares"] as const)
      .map(
        (name) =>
          `${name}: ${Number.isFinite(strongest.metrics[name]) && (strongest.metrics[name] ?? -1) >= 0 ? strongest.metrics[name] : "unavailable"}`,
      )
      .join("; ");
    paragraphs.push(
      `Highest reported views among the examined posts: post ${strongest.postId} (${metrics}). Provider update time: ${strongest.updatedAt ?? "unavailable"}. Review this example's content before deciding what to repeat; the numbers alone do not explain its performance.`,
    );
  }
  if (report.accounts.length === 0)
    paragraphs.push("No account evidence is available in this snapshot.");
  return paragraphs;
}
