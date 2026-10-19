/** Read-only, two-account qualification. No publishing or credential storage. */
export const ZERNIO_PILOT_ORIGIN = "https://zernio.com";
export const ZERNIO_ID = /^[a-f0-9]{24}$/;
export const ZERNIO_METRICS = [
  "impressions",
  "reach",
  "likes",
  "comments",
  "shares",
  "saves",
  "clicks",
  "views",
  "engagementRate",
] as const;
export type ZernioMetrics = Partial<Record<(typeof ZERNIO_METRICS)[number], number>>;

export function zernioRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("ZERNIO_INVALID_RESPONSE");
  return value as Record<string, unknown>;
}
export function zernioMetrics(value: unknown): ZernioMetrics {
  const raw = zernioRecord(value);
  const result: ZernioMetrics = {};
  for (const name of ZERNIO_METRICS) {
    const v = raw[name];
    if (v === null || v === undefined) continue;
    if (typeof v !== "number" || !Number.isFinite(v) || v < 0)
      throw new Error("ZERNIO_INVALID_METRICS");
    result[name] = v;
  }
  return result;
}
export function zernioPilotAccounts(value: unknown, profileId: string) {
  const raw = zernioRecord(value);
  if (!ZERNIO_ID.test(profileId) || !Array.isArray(raw.accounts) || raw.accounts.length > 2)
    throw new Error("ZERNIO_PILOT_ACCOUNT_LIMIT");
  const ids = new Set<string>();
  return raw.accounts.map((item) => {
    const a = zernioRecord(item);
    const profile = typeof a.profileId === "string" ? a.profileId : zernioRecord(a.profileId)._id;
    if (
      typeof a._id !== "string" ||
      !ZERNIO_ID.test(a._id) ||
      ids.has(a._id) ||
      profile !== profileId ||
      !["instagram", "tiktok"].includes(String(a.platform))
    )
      throw new Error("ZERNIO_PILOT_ACCOUNT_NOT_ALLOWED");
    ids.add(a._id);
    return {
      id: a._id,
      platform: a.platform as "instagram" | "tiktok",
      active: a.isActive === true,
      needsReconnection: a.needsReconnection === true,
    };
  });
}
export function zernioPilotPage(
  value: unknown,
  accountId: string,
  platform: string,
  expectedPage: number,
) {
  const raw = zernioRecord(value);
  const pagination = zernioRecord(raw.pagination);
  if (
    !Array.isArray(raw.posts) ||
    raw.posts.length > 100 ||
    pagination.page !== expectedPage ||
    typeof pagination.pages !== "number" ||
    !Number.isInteger(pagination.pages) ||
    pagination.pages < 0 ||
    pagination.pages > 5
  )
    throw new Error("ZERNIO_PILOT_PAGINATION_LIMIT");
  const metrics: {
    postId: string;
    source: "external" | "zernio";
    metrics: ZernioMetrics;
    updatedAt: string | null;
    matchedBufferPost: boolean;
  }[] = [];
  for (const item of raw.posts) {
    const post = zernioRecord(item);
    if (typeof post.isExternal !== "boolean") throw new Error("ZERNIO_PILOT_POST_SOURCE");
    const candidates = Array.isArray(post.platformAnalytics)
      ? post.platformAnalytics
      : Array.isArray(post.platforms)
        ? post.platforms
        : [post];
    if (!candidates.length || candidates.length > 16) throw new Error("ZERNIO_PILOT_POST_SCOPE");
    let matched = false;
    for (const value of candidates) {
      const row = zernioRecord(value);
      const id =
        typeof row.accountId === "string" ? row.accountId : zernioRecord(row.accountId)._id;
      if (id !== accountId) continue;
      if (row.platform !== platform || typeof row.platformPostId !== "string")
        throw new Error("ZERNIO_PILOT_POST_SCOPE");
      // A combined post's aggregate can belong to several accounts. Use per-account metrics.
      const values = zernioRecord(
        row.analytics ?? (candidates.length === 1 ? post.analytics : null),
      );
      const at = values.lastUpdated;
      if (
        at !== undefined &&
        at !== null &&
        (typeof at !== "string" || !Number.isFinite(Date.parse(at)))
      )
        throw new Error("ZERNIO_INVALID_RESPONSE");
      metrics.push({
        postId: row.platformPostId,
        source: post.isExternal ? "external" : "zernio",
        metrics: zernioMetrics(values),
        updatedAt: typeof at === "string" ? at : null,
        matchedBufferPost: false,
      });
      matched = true;
    }
    if (!matched) throw new Error("ZERNIO_PILOT_POST_SCOPE");
  }
  return { metrics, pages: pagination.pages };
}
