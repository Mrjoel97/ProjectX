"use client";

import { api } from "@pikar/backend/api";
import { useAction, useMutation, useQuery } from "convex/react";
import { type CSSProperties, useState } from "react";

const card: CSSProperties = {
  background: "var(--card)",
  border: "1px solid var(--rule)",
  borderRadius: 20,
  padding: 24,
  minWidth: 0,
};
const controls: CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: 12,
  alignItems: "center",
};
const input: CSSProperties = {
  display: "block",
  minHeight: 44,
  width: "100%",
  padding: 10,
  border: "1px solid var(--rule)",
  borderRadius: 8,
  background: "var(--card)",
  color: "var(--ink)",
};
const button: CSSProperties = {
  minHeight: 44,
  padding: "10px 18px",
  borderRadius: 8,
  border: "1px solid var(--rule)",
  background: "var(--canvas)",
  color: "var(--ink)",
  cursor: "pointer",
};

export function BufferConnectionRow() {
  const status = useQuery(api.buffer.status, {});
  const disconnect = useMutation(api.buffer.disconnect);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  return (
    <div style={{ ...card, padding: 18 }}>
      <strong>Buffer — social publishing &amp; engagement reports</strong>
      <p>
        {status === undefined
          ? "Checking connection…"
          : status.connected
            ? `${status.organizationName ?? "Buffer connected"} · ${status.selectedChannelIds.length} channels selected`
            : status.status === "reauth_required"
              ? "Reconnect Buffer to restore access."
              : "Connect your social accounts through Buffer."}
      </p>
      <div style={controls}>
        {status && (
          <a href="/connect-buffer">
            {status.connected
              ? "Manage channels"
              : status.status === "reauth_required"
                ? "Reconnect Buffer"
                : "Connect Buffer"}
          </a>
        )}
        {status?.connected && (
          <button type="button" style={button} onClick={() => setConfirm(true)}>
            Disconnect
          </button>
        )}
      </div>
      {confirm && (
        <div>
          <p>
            Stop Pikar’s Buffer access and daily reports here? Remove the app in Buffer’s API
            settings to revoke the provider grant as well.
          </p>
          <button
            type="button"
            style={button}
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await disconnect({});
                setNotice("Disconnected here. You can also remove Pikar in Buffer’s API settings.");
                setConfirm(false);
              } catch {
                setNotice("The connection could not be updated. Try again.");
              } finally {
                setBusy(false);
              }
            }}
          >
            Confirm disconnect
          </button>
          <button type="button" style={button} onClick={() => setConfirm(false)}>
            Keep connection
          </button>
        </div>
      )}
      {notice && <p role="status">{notice}</p>}
    </div>
  );
}

export function BufferMarketing() {
  const status = useQuery(api.buffer.status, {});
  const posts = useQuery(api.buffer.posts, {});
  const reports = useQuery(api.buffer.reports, {});
  const stage = useMutation(api.buffer.stagePost);
  const approve = useMutation(api.buffer.approvePost);
  const discard = useMutation(api.buffer.discardPost);
  const refresh = useAction(api.bufferActions.refreshReport);
  const syncPosts = useAction(api.bufferActions.refreshPosts);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [approval, setApproval] = useState<string | null>(null);
  const [mode, setMode] = useState<"addToQueue" | "customScheduled">("addToQueue");
  const [targetChannel, setTargetChannel] = useState("");
  const latest = reports?.[0];
  const channels =
    status?.channels.filter((channel) => status.selectedChannelIds.includes(channel.id)) ?? [];
  const target = channels.find((channel) => channel.id === targetChannel) ?? channels[0];
  return (
    <section style={{ display: "grid", gap: 20 }} aria-label="Buffer social marketing">
      <BufferConnectionRow />
      {status?.connected && (
        <>
          <section style={card}>
            <h2>Plan your next campaign</h2>
            <p>
              Ask the social marketing agent to prepare posts for your selected Buffer channels.
              Every post stays in draft until you approve it here.
            </p>
            <a href="/dashboard/workspace?intent=buffer">Plan a campaign with the agent</a>
            {!channels.length ? (
              <p>
                <a href="/connect-buffer">Select the channels Pikar can use</a> before preparing
                posts or reports.
              </p>
            ) : (
              <form
                style={{ display: "grid", gap: 14, marginTop: 24 }}
                onSubmit={async (event) => {
                  event.preventDefault();
                  const form = event.currentTarget;
                  const data = new FormData(form);
                  setBusy(true);
                  try {
                    await stage({
                      campaign: String(data.get("campaign")),
                      channelId: String(data.get("channelId")),
                      text: String(data.get("text")),
                      mode,
                      ...(mode === "customScheduled"
                        ? { dueAt: new Date(String(data.get("dueAt"))).getTime() }
                        : {}),
                      ...(data.get("imageUrl") ? { imageUrl: String(data.get("imageUrl")) } : {}),
                      ...(data.get("videoUrl") ? { videoUrl: String(data.get("videoUrl")) } : {}),
                      ...(data.get("mediaTitle")
                        ? { mediaTitle: String(data.get("mediaTitle")) }
                        : {}),
                      ...(data.get("categoryId")
                        ? { categoryId: String(data.get("categoryId")) }
                        : {}),
                      ...(data.get("boardId") ? { boardId: String(data.get("boardId")) } : {}),
                      isAiGenerated: data.get("isAiGenerated") === "on",
                    });
                    setNotice("Draft saved. Review it below before approving.");
                    form.reset();
                    setMode("addToQueue");
                    setTargetChannel(channels[0]?.id ?? "");
                  } catch {
                    setNotice(
                      "The draft could not be saved. Check the channel, media and scheduled time.",
                    );
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                <h3>Or prepare a post yourself</h3>
                <label>
                  Campaign name
                  <input style={input} name="campaign" maxLength={120} required />
                </label>
                <label>
                  Channel
                  <select
                    style={input}
                    name="channelId"
                    value={target?.id ?? ""}
                    required
                    onChange={(event) => setTargetChannel(event.target.value)}
                  >
                    {channels.map((channel) => (
                      <option key={channel.id} value={channel.id}>
                        {channel.name} · {channel.service}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Post text
                  <textarea style={input} name="text" rows={5} maxLength={10000} required />
                </label>
                <label>
                  Image URL (optional)
                  <input
                    style={input}
                    name="imageUrl"
                    type="url"
                    placeholder="https://…"
                    maxLength={4096}
                  />
                </label>
                <label>
                  Video URL (optional)
                  <input
                    style={input}
                    name="videoUrl"
                    type="url"
                    placeholder="https://…"
                    maxLength={4096}
                  />
                </label>
                <p>
                  Attach one image or video available to Buffer at a public HTTPS URL. Instagram,
                  TikTok and Pinterest require media; YouTube requires a video.
                </p>
                {["youtube", "pinterest", "tiktok"].includes(target?.service ?? "") && (
                  <label>
                    Post title
                    <input
                      style={input}
                      name="mediaTitle"
                      maxLength={100}
                      required={target?.service === "youtube"}
                    />
                  </label>
                )}
                {target?.service === "youtube" && (
                  <>
                    <label>
                      Video category
                      <select style={input} name="categoryId" required defaultValue="">
                        <option value="">Choose a category</option>
                        <option value="22">People &amp; blogs</option>
                        <option value="26">How-to &amp; style</option>
                        <option value="27">Education</option>
                        <option value="28">Science &amp; technology</option>
                        <option value="24">Entertainment</option>
                        <option value="25">News &amp; politics</option>
                        <option value="29">Nonprofits &amp; activism</option>
                      </select>
                    </label>
                    <p>Approved YouTube videos are published publicly.</p>
                  </>
                )}
                {target?.service === "pinterest" && (
                  <label>
                    Pinterest board
                    <select style={input} name="boardId" required defaultValue="">
                      <option value="">Choose a board</option>
                      {target.boards?.map((board) => (
                        <option key={board.id} value={board.id}>
                          {board.name}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                <label>
                  <input type="checkbox" name="isAiGenerated" /> Disclose that the media is
                  AI-generated on supported platforms
                </label>
                <label>
                  When
                  <select
                    style={input}
                    value={mode}
                    onChange={(event) => setMode(event.target.value as typeof mode)}
                  >
                    <option value="addToQueue">Next Buffer queue slot</option>
                    <option value="customScheduled">Choose a date and time</option>
                  </select>
                </label>
                {mode === "customScheduled" && (
                  <label>
                    Scheduled time in your device’s timezone
                    <input style={input} type="datetime-local" name="dueAt" required />
                  </label>
                )}
                <button type="submit" style={button} disabled={busy}>
                  Save draft for review
                </button>
              </form>
            )}
          </section>
          <section style={card}>
            <h2>Engagement report</h2>
            <p>
              Last 30 days across your selected channels. Buffer refreshes engagement metrics daily;
              missing metrics are unavailable, not zero.
            </p>
            <button
              type="button"
              style={button}
              disabled={busy || !channels.length}
              onClick={async () => {
                setBusy(true);
                try {
                  await refresh({});
                  setNotice("Engagement report refreshed.");
                } catch {
                  setNotice(
                    "The report could not refresh. Buffer may need reconnection or more time before another request.",
                  );
                } finally {
                  setBusy(false);
                }
              }}
            >
              Refresh engagement report
            </button>
            {reports === undefined ? (
              <p>Loading report…</p>
            ) : latest ? (
              <>
                <p>
                  {new Date(latest.startAt).toLocaleDateString()}–
                  {new Date(latest.endAt).toLocaleDateString()} · {latest.channelIds.length}{" "}
                  channels
                </p>
                <dl
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
                    gap: 16,
                  }}
                >
                  {latest.metrics.map((metric) => (
                    <div key={metric.type}>
                      <dt>{metric.name}</dt>
                      <dd style={{ margin: 0, fontSize: 28, fontWeight: 700 }}>
                        {metric.value.toLocaleString()}
                        {metric.unit === "percentage" ? "%" : ""}
                      </dd>
                    </div>
                  ))}
                </dl>
                {!latest.metrics.length && <p>Buffer has no metrics available for this period.</p>}
                <p>
                  {latest.metricsUpdatedAt === null
                    ? "Buffer has not reported a metrics refresh time."
                    : `Metrics last refreshed ${new Date(latest.metricsUpdatedAt).toLocaleString()}.`}
                </p>
                {latest.connectionId &&
                  (latest.organizationId !== status.organizationId ||
                    latest.channelIds.slice().sort().join() !==
                      status.selectedChannelIds.slice().sort().join()) && (
                    <p>
                      This saved report covers a previous channel selection. Refresh to report on
                      your current selection.
                    </p>
                  )}
              </>
            ) : (
              <p>No report yet. Refresh to retrieve actual Buffer engagement data.</p>
            )}
          </section>
        </>
      )}
      <section style={card}>
        <h2>Campaign posts</h2>
        {status?.connected && (
          <button
            type="button"
            style={button}
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                const result = await syncPosts({});
                setNotice(`Checked ${result.checked} pending posts with Buffer.`);
              } catch {
                setNotice(
                  "Publishing status could not refresh. Check Buffer before submitting replacements.",
                );
              } finally {
                setBusy(false);
              }
            }}
          >
            Refresh publishing status
          </button>
        )}
        {posts === undefined ? (
          <p>Loading posts…</p>
        ) : posts.length === 0 ? (
          <p>Your campaign drafts will appear here.</p>
        ) : (
          posts
            .filter((post) => post.status !== "discarded")
            .map((post) => (
              <article
                key={post._id}
                style={{ padding: "20px 0", borderTop: "1px solid var(--rule)" }}
              >
                <h3>{post.campaign}</h3>
                <p>
                  {status?.channels.find((channel) => channel.id === post.channelId)?.name ??
                    "Previous channel"}{" "}
                  ·{" "}
                  {post.status === "submitting" || post.status === "unknown"
                    ? "Publishing outcome needs checking in Buffer"
                    : post.status === "buffer_review"
                      ? "Awaiting review in Buffer"
                      : post.status}
                </p>
                <p style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{post.text}</p>
                {post.imageUrl && (
                  <p>
                    Media: <span style={{ overflowWrap: "anywhere" }}>{post.imageUrl}</span>
                  </p>
                )}
                {post.videoUrl && (
                  <p>
                    Video: <span style={{ overflowWrap: "anywhere" }}>{post.videoUrl}</span>
                  </p>
                )}
                {post.mediaTitle && <p>Title: {post.mediaTitle}</p>}
                {post.boardId && (
                  <p>
                    Pinterest board:{" "}
                    {status?.channels
                      .find((channel) => channel.id === post.channelId)
                      ?.boards?.find((board) => board.id === post.boardId)?.name ??
                      "Previously selected board — reload channels to confirm"}
                  </p>
                )}
                {post.isAiGenerated && <p>AI-generated media disclosure enabled.</p>}
                {status?.channels.find((channel) => channel.id === post.channelId)?.service ===
                  "youtube" && <p>This YouTube video will be public.</p>}
                <p>
                  {post.mode === "customScheduled" && post.dueAt
                    ? `Scheduled for ${new Date(post.dueAt).toLocaleString()}`
                    : "Next available Buffer queue slot"}
                </p>
                {post.status === "draft" && (
                  <div style={controls}>
                    {approval !== post._id ? (
                      <button
                        type="button"
                        style={button}
                        disabled={busy}
                        onClick={() => setApproval(post._id)}
                      >
                        Review approval
                      </button>
                    ) : (
                      <>
                        <p>Approve this exact post and its media for this channel and schedule?</p>
                        <button
                          type="button"
                          style={button}
                          disabled={busy}
                          onClick={async () => {
                            setBusy(true);
                            try {
                              await approve({ postId: post._id, revision: post.revision });
                              setApproval(null);
                              setNotice("Approved. Pikar is submitting this post to Buffer.");
                            } catch {
                              setNotice(
                                "Approval did not complete. Check the draft and connection before trying again.",
                              );
                            } finally {
                              setBusy(false);
                            }
                          }}
                        >
                          Approve and schedule
                        </button>
                        <button type="button" style={button} onClick={() => setApproval(null)}>
                          Back to review
                        </button>
                      </>
                    )}
                    <button
                      type="button"
                      style={button}
                      disabled={busy}
                      onClick={async () => {
                        setBusy(true);
                        try {
                          await discard({ postId: post._id });
                        } catch {
                          setNotice("The draft could not be discarded.");
                        } finally {
                          setBusy(false);
                        }
                      }}
                    >
                      Discard draft
                    </button>
                  </div>
                )}
                {(post.status === "unknown" || post.status === "submitting") && (
                  <p>
                    Check your queue in Buffer before creating a replacement. Pikar will not
                    automatically repeat an uncertain submission.
                  </p>
                )}
              </article>
            ))
        )}
        <p>Showing the latest 100 saved posts.</p>
      </section>
      {notice && <p role="status">{notice}</p>}
    </section>
  );
}
