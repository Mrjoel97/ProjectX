import { randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { pathToFileURL } from "node:url";
import {
  ZERNIO_ID,
  ZERNIO_PILOT_ORIGIN,
  zernioPilotAccounts,
  zernioPilotPage,
  zernioRecord,
} from "../../core/src/zernioPilot.ts";

// ponytail: qualify two existing accounts with built-in HTTP; hosted integration follows live proof.
// No SDK, credential files, application sessions, writes or provider error-body logging.
// bufferPostIds must come from an explicit Buffer publishing receipt, not merely Sent history.
export async function runZernioPilot({
  key,
  profileId,
  bufferPostIds = [],
  fetcher = fetch,
  now = Date.now(),
}) {
  if (
    !/^(sk_|zrk_)[a-f0-9]{64}$/.test(key) ||
    !ZERNIO_ID.test(profileId) ||
    bufferPostIds.length > 10 ||
    bufferPostIds.some((id) => !/^[A-Za-z0-9_-]{1,128}$/.test(id))
  )
    throw new Error("ZERNIO_PILOT_INPUT_INVALID");
  const get = async (path, params = {}) => {
    const url = new URL(`/api/v1/${path}`, ZERNIO_PILOT_ORIGIN);
    url.search = new URLSearchParams(params).toString();
    let response;
    try {
      response = await fetcher(url, {
        method: "GET",
        redirect: "error",
        signal: AbortSignal.timeout(20_000),
        headers: { Authorization: `Bearer ${key}`, Accept: "application/json" },
      });
    } catch {
      throw new Error("ZERNIO_UNAVAILABLE");
    }
    if (!response.ok)
      throw new Error(
        response.status === 401
          ? "ZERNIO_REAUTH"
          : response.status === 403
            ? "ZERNIO_ACCESS_DENIED"
            : response.status === 429
              ? "ZERNIO_RATE_LIMITED"
              : response.status === 402
                ? "ZERNIO_BILLING_REQUIRED"
                : "ZERNIO_UNAVAILABLE",
      );
    let text;
    try {
      text = await response.text();
    } catch {
      throw new Error("ZERNIO_UNAVAILABLE");
    }
    if (text.length > 2_000_000) throw new Error("ZERNIO_INVALID_RESPONSE");
    try {
      return zernioRecord(JSON.parse(text));
    } catch {
      throw new Error("ZERNIO_INVALID_RESPONSE");
    }
  };
  const valid = await get("auth/verify");
  if (valid.valid !== true) throw new Error("ZERNIO_REAUTH");
  const accounts = zernioPilotAccounts(await get("accounts", { profileId }), profileId);
  const fromDate = new Date(now - 89 * 86400_000).toISOString().slice(0, 10);
  const toDate = new Date(now).toISOString().slice(0, 10);
  const result = {
    readOnly: true,
    profileFiltered: true,
    fromDate,
    toDate,
    accounts: [],
    bufferMatchCount: 0,
    complete: false,
  };
  for (const account of accounts) {
    const row = {
      platform: account.platform,
      active: account.active,
      needsReconnection: account.needsReconnection,
      state: "unavailable",
      posts: 0,
      externalPosts: 0,
      bufferMatches: 0,
      metrics: [],
      missingMetricsRemainUnavailable: true,
    };
    try {
      const posts = new Map();
      for (let page = 1, pages = 1; page <= pages; page++) {
        const rawPage = await get("analytics", {
          profileId,
          accountId: account.id,
          source: "all",
          fromDate,
          toDate,
          limit: "100",
          page: String(page),
        });
        const data = zernioPilotPage(rawPage, account.id, account.platform, page);
        pages = data.pages;
        for (const post of data.metrics) posts.set(post.postId, post);
      }
      row.posts = posts.size;
      row.externalPosts = [...posts.values()].filter((post) => post.source === "external").length;
      row.bufferMatches = [...posts.values()].filter(
        (post) => post.source === "external" && bufferPostIds.includes(post.postId),
      ).length;
      row.metrics = [...posts.values()].map((p) => ({
        metrics: p.metrics,
        source: p.source,
        updatedAt: p.updatedAt,
        matchedBufferPost: p.source === "external" && bufferPostIds.includes(p.postId),
      }));
      row.state = !row.posts
        ? "no_posts_in_window"
        : row.metrics.some((post) => Object.keys(post.metrics).length > 0)
          ? "metrics_returned"
          : "metrics_unavailable";
      result.bufferMatchCount += row.bufferMatches;
    } catch (error) {
      row.state = safePilotError(error);
    }
    result.accounts.push(row);
  }
  result.complete =
    accounts.length === 2 &&
    new Set(accounts.map((a) => a.platform)).size === 2 &&
    result.accounts.every(
      (a) => a.state === "metrics_returned" && a.active && !a.needsReconnection,
    ) &&
    result.bufferMatchCount > 0;
  return result;
}
export function safePilotError(error) {
  const message = error instanceof Error ? error.message : "";
  return /^ZERNIO_[A-Z_]+$/.test(message) ? message : "ZERNIO_PILOT_FAILED";
}

export async function serveZernioPilot({
  profileId,
  bufferPostIds = [],
  port = 8766,
  run = runZernioPilot,
}) {
  if (!ZERNIO_ID.test(profileId)) throw new Error("ZERNIO_PILOT_INPUT_INVALID");
  const nonce = randomBytes(32).toString("hex");
  let consumed = false;
  const server = createServer(async (req, res) => {
    const headers = {
      "Cache-Control": "no-store",
      "Content-Security-Policy": "default-src 'none'; form-action 'self'; frame-ancestors 'none'",
      "Referrer-Policy": "same-origin",
      "X-Content-Type-Options": "nosniff",
    };
    const end = (status, text) => {
      res.writeHead(status, { ...headers, "Content-Type": "text/html; charset=utf-8" });
      res.end(text);
    };
    if (req.headers.host !== `127.0.0.1:${server.address().port}` || req.url !== `/${nonce}`)
      return end(404, "Not found");
    if (req.method === "GET")
      return end(
        200,
        `<!doctype html><html lang="en"><meta charset="utf-8"><title>Pikar analytics pilot</title><h1>Pikar analytics pilot</h1><p>Read-only verification for the existing Instagram and TikTok profile. The key stays in memory and is never saved.</p><form method="post" action="/${nonce}"><label>Read-only Zernio API key <input name="key" type="password" autocomplete="off" required></label><button>Run read-only checks</button></form></html>`,
      );
    if (
      req.method !== "POST" ||
      consumed ||
      req.headers.origin !== `http://127.0.0.1:${server.address().port}` ||
      req.headers["content-type"]?.split(";")[0]?.trim() !== "application/x-www-form-urlencoded"
    ) {
      return end(403, "Request refused");
    }
    consumed = true;
    try {
      let body = "";
      for await (const chunk of req) {
        body += chunk.toString();
        if (body.length > 1024) throw new Error("ZERNIO_PILOT_INPUT_INVALID");
      }
      const form = new URLSearchParams(body);
      if (form.getAll("key").length !== 1) throw new Error("ZERNIO_PILOT_INPUT_INVALID");
      let key = form.get("key") ?? "";
      const report = await run({ key, profileId, bufferPostIds });
      key = "";
      body = "";
      form.delete("key");
      const json = JSON.stringify(report, null, 2);
      console.log(
        JSON.stringify({
          fromDate: report.fromDate,
          toDate: report.toDate,
          complete: report.complete,
          bufferMatchCount: report.bufferMatchCount,
          accounts: report.accounts?.map(({ metrics, ...summary }) => summary),
        }),
      );
      end(
        200,
        `<!doctype html><html lang="en"><meta charset="utf-8"><title>Pikar analytics pilot result</title><h1>Analytics pilot result</h1><pre>${json.replaceAll("&", "&amp;").replaceAll("<", "&lt;")}</pre></html>`,
      );
    } catch (error) {
      const reason = safePilotError(error);
      console.log(JSON.stringify({ state: reason, complete: false }));
      end(200, `<h1>Pilot incomplete</h1><p>${reason}</p>`);
    }
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });
  const timeout = setTimeout(() => server.close(), 30 * 60_000);
  timeout.unref();
  server.on("close", () => clearTimeout(timeout));
  return { server, url: `http://127.0.0.1:${server.address().port}/${nonce}` };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  if (
    args[0] !== "serve" ||
    !ZERNIO_ID.test(args[1] ?? "") ||
    args.slice(2).some((id) => !/^\d{1,32}$/.test(id))
  )
    throw new Error("ZERNIO_PILOT_INPUT_INVALID");
  const { url } = await serveZernioPilot({ profileId: args[1], bufferPostIds: args.slice(2) });
  console.log(JSON.stringify({ pilotUrl: url, readOnly: true, expiresInMinutes: 30 }));
}
