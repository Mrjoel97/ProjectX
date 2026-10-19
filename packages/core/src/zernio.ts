import { ZERNIO_ID, type ZernioMetrics, zernioPilotPage, zernioRecord } from "./zernioPilot";

export const ZERNIO_KEY = /^(sk_|zrk_)[a-f0-9]{64}$/;
export const ZERNIO_REFRESH_MS = 5 * 60_000;
export const ZERNIO_DAY_MS = 86400_000;
export type ZernioChannel = {
  id: string;
  name: string;
  platform: "instagram" | "tiktok";
  available: boolean;
};
export type ZernioPost = {
  postId: string;
  source: "external" | "zernio";
  metrics: ZernioMetrics;
  updatedAt: string | null;
};
export type ZernioAccountReport = {
  accountId: string;
  platform: "instagram" | "tiktok";
  posts: ZernioPost[];
};
export type ZernioReport = {
  fromDate: string;
  toDate: string;
  fetchedAt: number;
  accounts: ZernioAccountReport[];
};
export const ZERNIO_FAILURES = [
  "reauth_required",
  "access_denied",
  "rate_limited",
  "billing_required",
  "unavailable",
  "invalid_response",
  "account_reconnect",
  "report_too_large",
] as const;
export type ZernioFailure = (typeof ZERNIO_FAILURES)[number];
export class ZernioError extends Error {
  constructor(readonly reason: ZernioFailure) {
    super(reason);
  }
}
export function zernioFailure(error: unknown): ZernioFailure {
  return error instanceof ZernioError ? error.reason : "invalid_response";
}
export function zernioChannels(value: unknown, profileId: string): ZernioChannel[] {
  const data = zernioRecord(value);
  if (!ZERNIO_ID.test(profileId) || !Array.isArray(data.accounts) || data.accounts.length > 100)
    throw new ZernioError("invalid_response");
  const ids = new Set<string>();
  const result: ZernioChannel[] = [];
  for (const raw of data.accounts) {
    const a = zernioRecord(raw);
    const profile = typeof a.profileId === "string" ? a.profileId : zernioRecord(a.profileId)._id;
    if (
      profile !== profileId ||
      typeof a._id !== "string" ||
      !ZERNIO_ID.test(a._id) ||
      ids.has(a._id)
    )
      throw new ZernioError("invalid_response");
    ids.add(a._id);
    if (a.platform !== "instagram" && a.platform !== "tiktok") continue;
    result.push({
      id: a._id,
      platform: a.platform,
      name: typeof a.username === "string" ? a.username.slice(0, 100) : a.platform,
      available: a.isActive === true && a.needsReconnection !== true,
    });
  }
  return result;
}
/** Fixed GET-only transport. Provider bodies/errors never become application errors or logs. */
export async function zernioGet(
  key: string,
  path: "auth/verify" | "accounts" | "analytics",
  params: Record<string, string> = {},
  fetcher: typeof fetch = fetch,
): Promise<Record<string, unknown>> {
  const url = new URL(`/api/v1/${path}`, "https://zernio.com");
  url.search = new URLSearchParams(params).toString();
  let response: Response;
  try {
    response = await fetcher(url, {
      method: "GET",
      redirect: "error",
      headers: { Authorization: `Bearer ${key}`, Accept: "application/json" },
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    throw new ZernioError("unavailable");
  }
  if (!response.ok)
    throw new ZernioError(
      response.status === 401
        ? "reauth_required"
        : response.status === 403
          ? "access_denied"
          : response.status === 429
            ? "rate_limited"
            : response.status === 402
              ? "billing_required"
              : "unavailable",
    );
  if (!response.body) throw new ZernioError("invalid_response");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      length += part.value.byteLength;
      if (length > 2_000_000) {
        await reader.cancel();
        throw new ZernioError("report_too_large");
      }
      chunks.push(part.value);
    }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    return zernioRecord(JSON.parse(new TextDecoder().decode(bytes)));
  } catch (error) {
    if (error instanceof ZernioError) throw error;
    throw new ZernioError("invalid_response");
  } finally {
    reader.releaseLock();
  }
}
export async function readZernioReport(
  key: string,
  profileId: string,
  selectedIds: string[],
  now = Date.now(),
  fetcher: typeof fetch = fetch,
): Promise<{ channels: ZernioChannel[]; report: ZernioReport }> {
  if (
    !ZERNIO_KEY.test(key) ||
    !ZERNIO_ID.test(profileId) ||
    !selectedIds.length ||
    selectedIds.length > 2 ||
    new Set(selectedIds).size !== selectedIds.length
  )
    throw new ZernioError("invalid_response");
  const channels = zernioChannels(
    await zernioGet(key, "accounts", { profileId }, fetcher),
    profileId,
  );
  const selected = selectedIds.map((id) => channels.find((c) => c.id === id));
  if (selected.some((c) => !c?.available)) throw new ZernioError("account_reconnect");
  const report: ZernioReport = {
    fromDate: new Date(now - 89 * ZERNIO_DAY_MS).toISOString().slice(0, 10),
    toDate: new Date(now).toISOString().slice(0, 10),
    fetchedAt: now,
    accounts: [],
  };
  for (const account of selected) {
    if (!account) throw new ZernioError("account_reconnect");
    const posts = new Map<string, ZernioPost>();
    for (let page = 1, pages = 1; page <= pages; page++) {
      const raw = await zernioGet(
        key,
        "analytics",
        {
          profileId,
          accountId: account.id,
          source: "all",
          fromDate: report.fromDate,
          toDate: report.toDate,
          limit: "100",
          page: String(page),
        },
        fetcher,
      );
      if (
        typeof zernioRecord(raw.pagination).pages === "number" &&
        (zernioRecord(raw.pagination).pages as number) > 5
      )
        throw new ZernioError("report_too_large");
      const parsed = zernioPilotPage(raw, account.id, account.platform, page);
      pages = parsed.pages;
      for (const post of parsed.metrics) {
        if (!/^[A-Za-z0-9_-]{1,128}$/.test(post.postId)) throw new ZernioError("invalid_response");
        posts.set(post.postId, {
          postId: post.postId,
          source: post.source,
          metrics: post.metrics,
          updatedAt: post.updatedAt,
        });
      }
    }
    if (posts.size && ![...posts.values()].some((p) => Object.keys(p.metrics).length))
      throw new ZernioError("invalid_response");
    report.accounts.push({
      accountId: account.id,
      platform: account.platform,
      posts: [...posts.values()],
    });
  }
  return { channels, report };
}
