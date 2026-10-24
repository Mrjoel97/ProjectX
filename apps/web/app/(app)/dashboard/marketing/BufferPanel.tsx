"use client";

import { api } from "@pikar/backend/api";
import { type BufferDraftRequirement, bufferDraftRequirements } from "@pikar/core/buffer";
import { useAction, useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
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
type BufferPost = FunctionReturnType<typeof api.buffer.posts>[number];
type BufferChannels = NonNullable<FunctionReturnType<typeof api.buffer.status>>["channels"];

const draftRequirementMessages: Record<BufferDraftRequirement, string> = {
  media_required: "Add an image or video before approving this post.",
  video_required: "Add a video before approving this post.",
  media_title_required: "Add a title before approving this post.",
  youtube_category_required: "Choose a YouTube category before approving this post.",
  pinterest_board_required: "Choose a Pinterest board before approving this post.",
};

function BufferDraftEditor({
  post,
  channels,
  onClose,
  onSaved,
}: {
  post: BufferPost;
  channels: BufferChannels;
  onClose: () => void;
  onSaved: () => void;
}) {
  const edit = useMutation(api.buffer.editPost);
  const restage = useMutation(api.buffer.restageFailedPost);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [mode, setMode] = useState(post.mode);
  const [channelId, setChannelId] = useState(post.channelId);
  const selectedChannel = channels.find((channel) => channel.id === channelId);
  const localTime = post.dueAt
    ? new Date(post.dueAt - new Date(post.dueAt).getTimezoneOffset() * 60000)
        .toISOString()
        .slice(0, 16)
    : "";
  return (
    <form
      aria-label="Edit social draft"
      style={{ display: "grid", gap: 14, marginTop: 16 }}
      onSubmit={async (event) => {
        event.preventDefault();
        if (busy) return;
        const data = new FormData(event.currentTarget);
        const optional = (name: string) => String(data.get(name) ?? "").trim() || undefined;
        setBusy(true);
        setError("");
        try {
          await (post.status === "failed" ? restage : edit)({
            postId: post._id,
            revision: post.revision,
            campaign: String(data.get("campaign")),
            channelId: String(data.get("channelId")),
            text: String(data.get("text")),
            mode,
            ...(mode === "customScheduled"
              ? { dueAt: new Date(String(data.get("dueAt"))).getTime() }
              : {}),
            imageUrl: optional("imageUrl"),
            videoUrl: optional("videoUrl"),
            mediaTitle: optional("mediaTitle"),
            categoryId: optional("categoryId"),
            boardId: optional("boardId"),
            isAiGenerated: data.get("isAiGenerated") === "on",
          });
          onSaved();
        } catch {
          setError(
            "Changes were not saved. Check the media and time. If this draft changed elsewhere, close the editor and reopen the latest version. Your edits are kept here.",
          );
        } finally {
          setBusy(false);
        }
      }}
    >
      <h4 style={{ margin: 0 }}>
        {post.status === "failed" ? "Prepare a replacement draft" : "Edit before approval"}
      </h4>
      <p style={{ margin: 0 }}>
        Saving creates a new draft revision. Nothing is scheduled until you review and approve it.
      </p>
      <label>
        Campaign name
        <input
          style={input}
          name="campaign"
          defaultValue={post.campaign}
          maxLength={120}
          required
        />
      </label>
      <label>
        Channel
        <select
          style={input}
          name="channelId"
          value={channelId}
          onChange={(event) => setChannelId(event.target.value)}
          required
        >
          {!selectedChannel?.available && (
            <option value="" disabled>
              Choose an available channel
            </option>
          )}
          {channels
            .filter((channel) => channel.available)
            .map((channel) => (
              <option key={channel.id} value={channel.id}>
                {channel.name} · {channel.service}
              </option>
            ))}
        </select>
      </label>
      <label>
        Post text
        <textarea
          style={input}
          name="text"
          defaultValue={post.text}
          rows={5}
          maxLength={10000}
          required
        />
      </label>
      <label>
        Image URL
        <input
          style={input}
          name="imageUrl"
          type="url"
          defaultValue={post.imageUrl ?? ""}
          maxLength={4096}
        />
      </label>
      <label>
        Video URL
        <input
          style={input}
          name="videoUrl"
          type="url"
          defaultValue={post.videoUrl ?? ""}
          maxLength={4096}
        />
      </label>
      {["youtube", "pinterest", "tiktok"].includes(selectedChannel?.service ?? "") && (
        <label>
          Post title
          <input
            style={input}
            name="mediaTitle"
            defaultValue={post.mediaTitle ?? ""}
            maxLength={100}
            required={selectedChannel?.service === "youtube"}
          />
        </label>
      )}
      {selectedChannel?.service === "youtube" && (
        <label>
          Video category
          <select style={input} name="categoryId" defaultValue={post.categoryId ?? ""} required>
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
      )}
      {selectedChannel?.service === "pinterest" && (
        <label>
          Pinterest board
          <select style={input} name="boardId" defaultValue={post.boardId ?? ""} required>
            <option value="">No board</option>
            {selectedChannel.boards?.map((board) => (
              <option key={board.id} value={board.id}>
                {board.name}
              </option>
            ))}
          </select>
        </label>
      )}
      <label>
        <input type="checkbox" name="isAiGenerated" defaultChecked={post.isAiGenerated ?? false} />{" "}
        Disclose AI-generated media
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
          <input
            style={input}
            type="datetime-local"
            name="dueAt"
            defaultValue={localTime}
            required
          />
        </label>
      )}
      {error && <p role="alert">{error}</p>}
      <div style={controls}>
        <button type="submit" style={button} disabled={busy}>
          {busy ? "Saving…" : "Save changes for review"}
        </button>
        <button type="button" style={button} disabled={busy} onClick={onClose}>
          Cancel editing
        </button>
      </div>
    </form>
  );
}

export function BufferConnectionRow() {
  const status = useQuery(api.buffer.status, {});
  const disconnect = useMutation(api.buffer.disconnect);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  return (
    <div style={{ ...card, padding: 18 }}>
      <strong>Buffer — social publishing</strong>
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
  const [approval, setApproval] = useState<{ id: string; revision: number } | null>(null);
  const [editing, setEditing] = useState<BufferPost | null>(null);
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
              Buffer does not currently allow engagement reports through third-party app
              connections. View analytics in Buffer. Reconnecting will not enable this permission.
            </p>
            <button
              type="button"
              style={button}
              disabled={busy || !channels.length || !status.reportsAvailable}
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
              <p>No engagement report is available through this connection.</p>
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
            .map((post) => {
              const channel = channels.find((item) => item.id === post.channelId);
              const requirements = [
                ...bufferDraftRequirements(post, channel?.service ?? post.platform ?? ""),
              ];
              if (
                channel?.service === "pinterest" &&
                post.boardId &&
                !channel.boards?.some((board) => board.id === post.boardId)
              )
                requirements.push("pinterest_board_required");
              const accountUnavailable = !status?.connected || !channel?.available;
              const approvalBlocked = accountUnavailable || requirements.length > 0;
              return (
                <article
                  key={post._id}
                  data-testid={`buffer-post-${post._id}`}
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
                  {post.status === "draft" && approvalBlocked && (
                    <div role="status">
                      <p>This draft is saved. Complete these details before approval:</p>
                      {accountUnavailable && (
                        <p>Reconnect and select this account before approving this post.</p>
                      )}
                      {requirements.map((requirement) => (
                        <p key={requirement}>{draftRequirementMessages[requirement]}</p>
                      ))}
                    </div>
                  )}
                  {editing?._id === post._id &&
                  (post.status === "draft" || post.status === "failed") ? (
                    <BufferDraftEditor
                      post={editing}
                      channels={channels}
                      onClose={() => setEditing(null)}
                      onSaved={() => {
                        setEditing(null);
                        setApproval(null);
                        setNotice(
                          "Changes saved as a new draft. Review it again before approving.",
                        );
                      }}
                    />
                  ) : (
                    post.status === "draft" && (
                      <div style={controls}>
                        <button
                          type="button"
                          style={button}
                          disabled={busy}
                          onClick={() => {
                            setApproval(null);
                            setEditing(post);
                          }}
                        >
                          Edit draft
                        </button>
                        {approval?.id !== post._id || approval.revision !== post.revision ? (
                          <button
                            type="button"
                            style={{
                              ...button,
                              ...(busy || approvalBlocked
                                ? { opacity: 0.5, cursor: "not-allowed" }
                                : {}),
                            }}
                            disabled={busy || approvalBlocked}
                            onClick={() => setApproval({ id: post._id, revision: post.revision })}
                          >
                            Review approval
                          </button>
                        ) : (
                          <>
                            <p>
                              Approve this exact post and its media for this channel and schedule?
                            </p>
                            <button
                              type="button"
                              style={{
                                ...button,
                                ...(busy || approvalBlocked
                                  ? { opacity: 0.5, cursor: "not-allowed" }
                                  : {}),
                              }}
                              disabled={busy || approvalBlocked}
                              onClick={async () => {
                                setBusy(true);
                                try {
                                  await approve({ postId: post._id, revision: approval.revision });
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
                              await discard({ postId: post._id, revision: post.revision });
                              setApproval(null);
                              setNotice("Draft rejected. It will not be scheduled.");
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
                    )
                  )}
                  {(post.status === "unknown" || post.status === "submitting") && (
                    <p>
                      Check your queue in Buffer before creating a replacement. Pikar will not
                      automatically repeat an uncertain submission.
                    </p>
                  )}
                  {post.status === "failed" &&
                    !post.bufferPostId &&
                    !post.replacementPostId &&
                    ["connection_changed", "schedule_expired", "provider_rejected"].includes(
                      post.failure ?? "",
                    ) &&
                    editing?._id !== post._id && (
                      <button
                        type="button"
                        style={button}
                        disabled={busy}
                        onClick={() => {
                          setApproval(null);
                          setEditing(post);
                        }}
                      >
                        Create replacement draft
                      </button>
                    )}
                  {post.replacementPostId && (
                    <p>
                      A replacement draft has been created for review. This failed version will not
                      be resubmitted.
                    </p>
                  )}
                </article>
              );
            })
        )}
        <p>Showing the latest 100 saved posts.</p>
      </section>
      {notice && <p role="status">{notice}</p>}
    </section>
  );
}
