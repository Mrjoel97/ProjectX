"use client";

import { api } from "@pikar/backend/api";
import type { ZernioChannel, ZernioReport } from "@pikar/core/zernio";
import { useAction, useMutation, useQuery } from "convex/react";
import { type CSSProperties, useState } from "react";

const card: CSSProperties = {
  background: "var(--card)",
  border: "1px solid var(--rule)",
  borderRadius: 20,
  padding: 24,
  minWidth: 0,
};
const control: CSSProperties = {
  minHeight: 44,
  padding: "10px 16px",
  border: "1px solid var(--rule)",
  borderRadius: 8,
  background: "var(--card)",
  color: "var(--ink)",
};
export function zernioNotice(state: string) {
  const messages: Record<string, string> = {
    updated: "Report updated.",
    connect_zernio: "Connect Zernio to read your reports.",
    reauth_required: "Your Zernio key has expired or was revoked. Reconnect Zernio.",
    account_reconnect: "Reconnect your social account in Zernio, then try again.",
    access_denied: "Your Zernio key needs Accounts and Analytics read access.",
    rate_limited: "Zernio is limiting requests. Your previous report is retained; try again later.",
    billing_required: "Review your plan in Zernio. Your previous report is retained.",
    report_too_large:
      "This report exceeds the current 500-post limit per account. Your previous report is retained.",
    connection_expired: "This connection attempt expired. Start again.",
    not_due_or_connection_changed:
      "Choose your accounts first, or wait five minutes between refreshes.",
    connection_changed: "Your connection changed during the refresh. Check your selected accounts.",
    invalid_response:
      "Zernio could not provide a complete report. Your previous report is retained.",
    unavailable: "Zernio could not be reached. Your previous report is retained.",
  };
  return messages[state] ?? "The connection could not be updated. Try again.";
}
export function ZernioConnectionRow() {
  const status = useQuery(api.zernio.status, {});
  return (
    <div style={card}>
      <strong>Zernio — social reports</strong>
      <p>
        {!status
          ? "Checking connection…"
          : status.status === "connected"
            ? `${status.selectedAccountIds.length} accounts selected for reports`
            : status.status === "reauth_required"
              ? "Reconnect Zernio to restore reports."
              : "Read Instagram and TikTok performance from your Zernio account."}
      </p>
      <a href="/connect-zernio">
        {status?.status === "connected" ? "Manage Zernio" : "Connect Zernio"}
      </a>
    </div>
  );
}
function AccountSelection({
  channels,
  selected,
  daily,
}: {
  channels: ZernioChannel[];
  selected: string[];
  daily: boolean;
}) {
  const save = useMutation(api.zernio.selectAccounts);
  const [ids, setIds] = useState(selected);
  const [automatic, setAutomatic] = useState(daily);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        try {
          await save({ accountIds: ids, dailyReports: automatic });
          setNotice("Report settings saved.");
        } catch {
          setNotice("Choose up to two available accounts and try again.");
        } finally {
          setBusy(false);
        }
      }}
    >
      <h2>Choose accounts for reports</h2>
      <p>Choose up to two Instagram or TikTok accounts in this Zernio profile.</p>
      {!channels.length && (
        <p>
          No supported accounts found. Connect Instagram or TikTok in Zernio, then reconnect here.
        </p>
      )}
      <fieldset disabled={busy}>
        <legend>Social accounts</legend>
        {channels.map((c) => (
          <label key={c.id} style={{ display: "block", padding: 10 }}>
            <input
              type="checkbox"
              checked={ids.includes(c.id)}
              disabled={!c.available || (!ids.includes(c.id) && ids.length >= 2)}
              onChange={(e) =>
                setIds(e.target.checked ? [...ids, c.id] : ids.filter((id) => id !== c.id))
              }
            />{" "}
            {c.name} · {c.platform}
            {!c.available && " · Reconnect in Zernio"}
          </label>
        ))}
      </fieldset>
      <label style={{ display: "block", padding: "16px 0" }}>
        <input
          type="checkbox"
          checked={automatic}
          disabled={busy}
          onChange={(e) => setAutomatic(e.target.checked)}
        />{" "}
        Refresh my report daily
      </label>
      <p>Daily refresh reads only these accounts. Zernio plan and platform limits apply.</p>
      <button type="submit" disabled={busy || (automatic && !ids.length)} style={control}>
        Save report settings
      </button>
      {notice && <p role="status">{notice}</p>}
    </form>
  );
}
export function ZernioConnect() {
  const status = useQuery(api.zernio.status, {});
  const begin = useMutation(api.zernio.beginConnect);
  const disconnect = useMutation(api.zernio.disconnect);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [replace, setReplace] = useState(false);
  const [confirm, setConfirm] = useState(false);
  if (!status) return <p role="status">Loading connection…</p>;
  return (
    <main style={{ display: "grid", gap: 24, minWidth: 0 }}>
      <header>
        <p className="caps-label">Social reporting</p>
        <h1>Connect Zernio reports</h1>
        <p>
          Use your own Zernio profile for Instagram and TikTok insights. Buffer continues to handle
          publishing.
        </p>
        <a href="/dashboard/marketing">Back to Marketing</a>
      </header>
      <section style={card}>
        <h2>Your connection</h2>
        <p>
          {status.status === "connected"
            ? "Zernio connected"
            : status.status === "reauth_required"
              ? "Reconnect Zernio"
              : "Connect your Zernio profile"}
        </p>
        {!status.configured ? (
          <p role="status">Zernio reporting is not configured yet.</p>
        ) : status.status !== "connected" || replace ? (
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              const form = e.currentTarget;
              const fields = new FormData(form);
              let key = String(fields.get("key") ?? "");
              fields.delete("key");
              const profileId = String(fields.get("profileId") ?? "").trim();
              setBusy(true);
              setNotice("");
              try {
                const { url } = await begin({ profileId });
                const response = await fetch(url, {
                  method: "POST",
                  credentials: "omit",
                  redirect: "error",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ key }),
                });
                key = "";
                form.reset();
                const result = await response.json();
                if (!response.ok || result.connected !== true)
                  throw new Error(typeof result.error === "string" ? result.error : "unavailable");
                setReplace(false);
                setNotice("Connected. Choose your accounts below.");
              } catch (error) {
                setNotice(zernioNotice(error instanceof Error ? error.message : "unavailable"));
              } finally {
                key = "";
                form.reset();
                setBusy(false);
              }
            }}
            style={{ display: "grid", gap: 16, maxWidth: 620 }}
          >
            <p>
              In{" "}
              <a href="https://zernio.com/dashboard/api-keys" target="_blank" rel="noreferrer">
                Zernio API Keys
              </a>
              , create a read-only key for this profile with Accounts and Analytics access. Keep
              other resource groups disabled. Your key is stored encrypted and used only for report
              reads.
            </p>
            <p>
              Find the profile ID in your{" "}
              <a
                href="https://zernio.com/dashboard/connections?group=profile"
                target="_blank"
                rel="noreferrer"
              >
                Zernio profile settings
              </a>
              . Use the profile that contains your business accounts.
            </p>
            {replace && (
              <p>
                This replaces your saved connection and clears its report and account selection.
              </p>
            )}
            <label>
              Profile ID
              <input
                style={{ ...control, display: "block", width: "100%" }}
                name="profileId"
                required
                pattern="[a-f0-9]{24}"
                maxLength={24}
                autoComplete="off"
              />
            </label>
            <label>
              Read-only API key
              <input
                style={{ ...control, display: "block", width: "100%" }}
                name="key"
                type="password"
                required
                maxLength={68}
                autoComplete="off"
                spellCheck={false}
              />
            </label>
            <button style={control} disabled={busy} type="submit">
              {busy ? "Connecting…" : "Connect reports"}
            </button>
          </form>
        ) : (
          <>
            <button type="button" style={control} disabled={busy} onClick={() => setReplace(true)}>
              Replace connection
            </button>{" "}
            <button type="button" style={control} disabled={busy} onClick={() => setConfirm(true)}>
              Disconnect Zernio
            </button>
          </>
        )}
        {status.lastFailure && <p role="status">{zernioNotice(status.lastFailure)}</p>}
        {confirm && (
          <div>
            <p>
              Remove Pikar’s saved key and cached report? Your social accounts stay connected in
              Zernio. Revoke the key in Zernio API Keys to remove its access there.
            </p>
            <button
              style={control}
              disabled={busy}
              type="button"
              onClick={async () => {
                setBusy(true);
                try {
                  await disconnect({});
                  setConfirm(false);
                  setReplace(false);
                  setNotice(
                    "Disconnected from Pikar. Revoke the key in Zernio to remove its access there too.",
                  );
                } catch {
                  setNotice("Disconnect failed. Try again.");
                } finally {
                  setBusy(false);
                }
              }}
            >
              Confirm disconnect
            </button>{" "}
            <button type="button" style={control} disabled={busy} onClick={() => setConfirm(false)}>
              Keep connection
            </button>
          </div>
        )}
        {notice && <p role="status">{notice}</p>}
      </section>
      {status.status === "connected" && (
        <section style={card}>
          <AccountSelection
            key={`${status.selectedAccountIds.join(",")}:${status.dailyReports}`}
            channels={status.channels}
            selected={status.selectedAccountIds}
            daily={status.dailyReports}
          />
        </section>
      )}
    </main>
  );
}
function AccountPosts({ account }: { account: ZernioReport["accounts"][number] }) {
  const [count, setCount] = useState(10);
  const posts = account.posts;
  return (
    <>
      {!posts.length ? (
        <p>No posts were returned for this publication window.</p>
      ) : (
        <>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", textAlign: "left", borderSpacing: "0 12px" }}>
              <caption>Lifetime metrics per post. A dash means unavailable.</caption>
              <thead>
                <tr>
                  <th>Post</th>
                  <th>Views</th>
                  <th>Likes</th>
                  <th>Comments</th>
                  <th>Shares</th>
                  <th>Engagement rate</th>
                </tr>
              </thead>
              <tbody>
                {posts.slice(0, count).map((p) => (
                  <tr key={p.postId}>
                    <th scope="row">
                      {account.platform === "tiktok" && /^\d+$/.test(p.postId) ? (
                        <a
                          href={`https://www.tiktok.com/@_/video/${p.postId}`}
                          target="_blank"
                          rel="noreferrer"
                        >
                          Post {p.postId.slice(-6)}
                        </a>
                      ) : (
                        `Post ${p.postId.slice(-6)}`
                      )}
                      <span style={{ display: "block", fontWeight: 400, fontSize: 13 }}>
                        {p.source === "external"
                          ? "Published outside Zernio"
                          : "Published through Zernio"}
                      </span>
                      <span style={{ display: "block", fontWeight: 400, fontSize: 12 }}>
                        Provider update: {p.updatedAt ?? "Unavailable"}
                        {p.updatedAt && " (timezone as supplied)"}
                      </span>
                    </th>
                    <td>{p.metrics.views ?? "—"}</td>
                    <td>{p.metrics.likes ?? "—"}</td>
                    <td>{p.metrics.comments ?? "—"}</td>
                    <td>{p.metrics.shares ?? "—"}</td>
                    <td>
                      {p.metrics.engagementRate === undefined
                        ? "—"
                        : `${p.metrics.engagementRate}%`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {count < posts.length && (
            <button type="button" style={control} onClick={() => setCount(count + 10)}>
              Show more posts
            </button>
          )}
        </>
      )}
    </>
  );
}
export function ZernioReportView({
  report,
  channels,
}: {
  report: ZernioReport;
  channels: ZernioChannel[];
}) {
  return (
    <>
      <p>
        Posts published {report.fromDate} to {report.toDate}, inclusive UTC dates.
      </p>
      <p>
        Retrieved from Zernio: {new Date(report.fetchedAt).toLocaleString()}. Metrics are lifetime
        snapshots for these posts, not activity limited to this period. Zernio may refresh platform
        data later.
      </p>
      <p>
        “Published outside Zernio” includes native posts and other publishing tools. It does not
        identify Buffer as the publisher.
      </p>
      {report.accounts.map((a) => (
        <article style={{ paddingTop: 16, borderTop: "1px solid var(--rule)" }} key={a.accountId}>
          <h3>
            {channels.find((c) => c.id === a.accountId)?.name ?? a.platform} · {a.platform}
          </h3>
          <p>{a.posts.length} posts returned</p>
          <AccountPosts account={a} />
        </article>
      ))}
    </>
  );
}
export function ZernioMarketing() {
  const status = useQuery(api.zernio.status, {});
  const report = useQuery(api.zernio.latestReport, {});
  const refresh = useAction(api.zernioActions.refreshReport);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  return (
    <section style={{ display: "grid", gap: 20 }} aria-label="Zernio social reports">
      <ZernioConnectionRow />
      {status?.status === "connected" && (
        <section style={card}>
          <h2>Review social performance</h2>
          <p>
            Your selected Instagram and TikTok accounts ·{" "}
            {status.dailyReports ? "Daily refresh enabled" : "Manual refresh"}
          </p>
          <button
            style={control}
            type="button"
            disabled={busy || !status.selectedAccountIds.length}
            onClick={async () => {
              setBusy(true);
              try {
                const result = await refresh({});
                setNotice(zernioNotice(result.state));
              } catch {
                setNotice("The report could not be refreshed. Your previous report is retained.");
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? "Refreshing…" : "Refresh report"}
          </button>
          <p>Up to two accounts, 500 posts per account, and one refresh every five minutes.</p>
          {!status.selectedAccountIds.length && (
            <p>
              <a href="/connect-zernio">Choose accounts for reports</a>.
            </p>
          )}
          {status.lastFailure && (
            <p role="alert">
              The last refresh failed. {zernioNotice(status.lastFailure)} Any report below is an
              earlier snapshot.
            </p>
          )}
          {notice && <p role="status">{notice}</p>}
          {report === undefined ? (
            <p>Loading report…</p>
          ) : report ? (
            <ZernioReportView report={report} channels={status.channels} />
          ) : (
            <p>No report saved yet. Choose accounts and refresh to load your metrics.</p>
          )}
        </section>
      )}
    </section>
  );
}
