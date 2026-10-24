"use client";
import { api } from "@pikar/backend/api";
import type { SocialProvider } from "@pikar/core/social";
import {
  mp4Duration,
  publishingScopes,
  type SocialAsset,
  validateSocialMedia,
} from "@pikar/core/socialPublishing";
import { useAction, useMutation, useQuery } from "convex/react";
import type { GenericId as Id } from "convex/values";
import { useEffect, useRef, useState } from "react";
import styles from "./social.module.css";

type Row = {
  provider: SocialProvider;
  connectionId: string | null;
  assets: SocialAsset[];
  selectedAssetIds: string[];
  selectionRevision?: number;
  publishEnabled: boolean;
  scopes: string[];
};
export default function SocialWorkspace({
  row,
  accessReady = true,
}: {
  row: Row;
  accessReady?: boolean;
}) {
  const discover = useAction(api.socialContentActions.discoverAccounts),
    read = useAction(api.socialContentActions.readContent);
  const select = useMutation(api.socialPublishing.selectAccounts),
    stage = useMutation(api.socialPublishing.stagePost),
    approve = useMutation(api.socialPublishing.approvePost),
    discard = useMutation(api.socialPublishing.discardPost),
    uploadUrl = useMutation(api.socialPublishing.uploadUrl);
  const editDraft = useMutation(api.socialPublishing.editDraft);
  const [editId, setEditId] = useState<string | null>(null),
    [editText, setEditText] = useState(""),
    [editTitle, setEditTitle] = useState("");
  const checkPost = useAction(api.socialContentActions.checkPost);
  const getCreator = useAction(api.socialContentActions.creatorInfo);
  const verifyAccess = useAction(api.socialActions.verifyConnection);
  const allPosts = useQuery(api.socialPublishing.posts, {});
  const [ids, setIds] = useState(row.selectedAssetIds),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState("");
  const [feed, setFeed] = useState<Awaited<ReturnType<typeof read>> | null>(null);
  const [assetId, setAssetId] = useState(""),
    [text, setText] = useState(""),
    [title, setTitle] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null),
    [privacy, setPrivacy] = useState(""),
    [kids, setKids] = useState("");
  useEffect(() => {
    if (!file && fileInput.current) fileInput.current.value = "";
  }, [file]);
  const [ai, setAi] = useState(""),
    [brand, setBrand] = useState("no"),
    [paid, setPaid] = useState("no");
  const [commercial, setCommercial] = useState(false);
  const [comments, setComments] = useState(false),
    [duet, setDuet] = useState(false),
    [stitch, setStitch] = useState(false);
  const [creator, setCreator] = useState<Awaited<ReturnType<typeof getCreator>> | null>(null);
  const [creatorNotice, setCreatorNotice] = useState("");
  const tikTokReviewKey = (allPosts ?? [])
    .filter(
      (p) => p.kind === "tiktok" && p.status === "draft" && p.connectionId === row.connectionId,
    )
    .map((p) => p._id + ":" + p.revision)
    .join("|");
  const selectionKey = JSON.stringify(row.selectedAssetIds);
  const selectionDirty =
    ids.length !== row.selectedAssetIds.length ||
    ids.some((id) => !row.selectedAssetIds.includes(id));
  useEffect(() => {
    setIds(JSON.parse(selectionKey));
    setFeed(null);
    setAssetId("");
    setPrivacy("");
    setCreator(null);
  }, [selectionKey]);
  const selected = row.assets.filter((a) => row.selectedAssetIds.includes(a.id)),
    asset = selected.find((a) => a.id === assetId);
  useEffect(() => {
    let active = true;
    if (
      accessReady &&
      row.provider === "tiktok" &&
      ((asset?.id && asset.kind === "tiktok") || tikTokReviewKey) &&
      row.scopes.includes("video.publish")
    ) {
      setCreator(null);
      setCreatorNotice("");
      void getCreator({}).then(
        (info) => {
          if (active) {
            setCreator(info);
            setComments(false);
            setDuet(false);
            setStitch(false);
          }
        },
        () => {
          if (active) {
            setCreator(null);
            setCreatorNotice("TikTok posting options are unavailable. Try again later.");
          }
        },
      );
    }
    return () => {
      active = false;
    };
  }, [asset?.id, asset?.kind, row.provider, row.scopes, getCreator, tikTokReviewKey, accessReady]);
  async function run(work: () => Promise<void>, failureNotice?: string) {
    setBusy(true);
    setNotice("");
    try {
      await work();
    } catch {
      setNotice(
        failureNotice ??
          "This action could not complete. Check the account selection, permissions and required post details.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <fieldset
      disabled={!accessReady || busy}
      aria-busy={busy}
      className={styles.workspace}
      aria-label="Social account workspace"
      style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}
    >
      <h3>Accounts available to Pikar</h3>
      <p>
        Reading:{" "}
        {row.provider !== "tiktok" || row.scopes.includes("video.list")
          ? "permitted for selected accounts"
          : "needs additional permission"}{" "}
        · Publishing:{" "}
        {row.publishEnabled
          ? "requires publishing permissions and your post approval"
          : "awaiting platform qualification"}
      </p>
      <p>Choose the accounts this workspace may use. Your other accounts stay unselected.</p>
      <button
        type="button"
        disabled={busy}
        onClick={() =>
          run(async () => {
            await discover({ provider: row.provider });
            setNotice("Account list refreshed. Select the accounts you want Pikar to use.");
          })
        }
      >
        Refresh account list
      </button>
      {row.assets.length === 0 && (
        <p>Refresh the account list to see which accounts your connection permits.</p>
      )}
      {row.assets.map((a) => (
        <label key={a.id}>
          <input
            type="checkbox"
            checked={ids.includes(a.id)}
            disabled={busy}
            onChange={(e) =>
              setIds(e.target.checked ? [...ids, a.id] : ids.filter((id) => id !== a.id))
            }
          />
          {a.name} ({a.kind.replaceAll("_", " ")})
        </label>
      ))}
      {!!row.assets.length && (
        <button
          type="button"
          disabled={busy || !row.connectionId}
          onClick={() =>
            run(async () => {
              await select({
                provider: row.provider,
                connectionId: row.connectionId!,
                assetIds: ids,
              });
              setNotice(
                "Account selection saved. Changing account selection requires new drafts before publishing.",
              );
            })
          }
        >
          Save account selection
        </button>
      )}
      {selectionDirty && <p>Save your account selection before reading or preparing posts.</p>}
      {selected.length > 0 && (
        <>
          <label>
            Account
            <select
              value={assetId}
              onChange={(e) => {
                setAssetId(e.target.value);
                setFeed(null);
                setFile(null);
                setPrivacy("");
                setCreator(null);
                setCommercial(false);
                setBrand("no");
                setPaid("no");
                setComments(false);
                setDuet(false);
                setStitch(false);
              }}
            >
              <option value="">Choose an account</option>
              {selected.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name} ({a.kind})
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            disabled={
              busy ||
              selectionDirty ||
              !asset ||
              (row.provider === "tiktok" && !row.scopes.includes("video.list"))
            }
            onClick={() =>
              run(async () => setFeed(await read({ provider: row.provider, assetId })))
            }
          >
            Read recent posts
          </button>
        </>
      )}
      {feed && (
        <section>
          <h4>Recent posts · {feed.account.name}</h4>
          <p>
            Read at {new Date(feed.checkedAt).toLocaleString()}. Up to {feed.limit} posts; this is
            not complete history or analytics.
          </p>
          {feed.posts.length === 0 ? (
            <p>No posts returned.</p>
          ) : (
            feed.posts.map((p) => (
              <article key={p.id}>
                <p>{p.title}</p>
                <p style={{ whiteSpace: "pre-wrap" }}>{p.text}</p>
                <p>{p.publishedAt}</p>
                {p.url && (
                  <a href={p.url} target="_blank" rel="noreferrer">
                    View on platform
                  </a>
                )}
              </article>
            ))
          )}
        </section>
      )}
      {asset && (
        <section className={styles.composer}>
          <h3>Prepare a post for {asset.name}</h3>
          <p>
            The agent may prepare drafts. You review the exact content, account and visibility
            before publishing.
          </p>
          {!row.publishEnabled && (
            <p>
              Publishing is awaiting platform qualification. You can prepare drafts; publishing
              stays unavailable.
            </p>
          )}
          <label>
            Post text
            <textarea
              maxLength={asset.kind === "tiktok" || asset.kind === "instagram" ? 2200 : 5000}
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
          </label>
          {asset.kind !== "facebook_page" && (
            <label>
              {asset.kind === "instagram" ? "JPEG image (up to 8 MiB)" : "MP4 video (up to 20 MiB)"}
              <input
                type="file"
                ref={fileInput}
                accept={asset.kind === "instagram" ? "image/jpeg" : "video/mp4"}
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              />
            </label>
          )}
          {asset.kind === "youtube" && (
            <>
              <label>
                Video title
                <input maxLength={100} value={title} onChange={(e) => setTitle(e.target.value)} />
              </label>
              <label>
                Visibility
                <select value={privacy} onChange={(e) => setPrivacy(e.target.value)}>
                  <option value="">Choose visibility</option>
                  {["private", "unlisted", "public"].map((v) => (
                    <option key={v}>{v}</option>
                  ))}
                </select>
              </label>
              <label>
                Made for children?
                <select value={kids} onChange={(e) => setKids(e.target.value)}>
                  <option value="">Choose audience</option>
                  <option value="yes">Yes</option>
                  <option value="no">No</option>
                </select>
              </label>
            </>
          )}
          {(asset.kind === "youtube" || asset.kind === "tiktok") && (
            <label>
              Contains realistic AI-generated or altered content?
              <select value={ai} onChange={(e) => setAi(e.target.value)}>
                <option value="">Choose disclosure</option>
                <option value="yes">Yes</option>
                <option value="no">No</option>
              </select>
            </label>
          )}
          {asset.kind === "tiktok" && (
            <>
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  run(async () => {
                    setCreator(null);
                    setCreatorNotice("");
                    try {
                      setCreator(await getCreator({}));
                    } catch {
                      setCreatorNotice("TikTok posting options are unavailable. Try again later.");
                      throw Error("TikTok posting options unavailable");
                    }
                    setPrivacy("");
                    setComments(false);
                    setDuet(false);
                    setStitch(false);
                  })
                }
              >
                Load TikTok posting options
              </button>
              {creator && (
                <>
                  <p>
                    Posting as {creator.name}. Maximum video duration: {creator.maxDurationSeconds}{" "}
                    seconds.
                  </p>
                  <label>
                    Visibility
                    <select value={privacy} onChange={(e) => setPrivacy(e.target.value)}>
                      <option value="">Choose visibility</option>
                      {creator.privacyOptions.map((v) => (
                        <option key={v} disabled={paid === "yes" && v === "SELF_ONLY"} value={v}>
                          {v === "PUBLIC_TO_EVERYONE"
                            ? "Everyone"
                            : v === "MUTUAL_FOLLOW_FRIENDS"
                              ? "Friends"
                              : v === "FOLLOWER_OF_CREATOR"
                                ? "Followers"
                                : v === "SELF_ONLY"
                                  ? "Only you"
                                  : v}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    <input
                      type="checkbox"
                      checked={comments}
                      disabled={creator.commentsDisabled}
                      onChange={(e) => setComments(e.target.checked)}
                    />
                    Allow comments
                  </label>
                  <label>
                    <input
                      type="checkbox"
                      checked={duet}
                      disabled={creator.duetDisabled}
                      onChange={(e) => setDuet(e.target.checked)}
                    />
                    Allow Duets
                  </label>
                  <label>
                    <input
                      type="checkbox"
                      checked={stitch}
                      disabled={creator.stitchDisabled}
                      onChange={(e) => setStitch(e.target.checked)}
                    />
                    Allow Stitch
                  </label>
                </>
              )}
              <label>
                <input
                  type="checkbox"
                  checked={commercial}
                  onChange={(e) => {
                    setCommercial(e.target.checked);
                    if (!e.target.checked) {
                      setBrand("no");
                      setPaid("no");
                    }
                  }}
                />
                Disclose commercial content
              </label>
              <p>Turn on for content that promotes a brand, product or service.</p>
              {commercial && (
                <>
                  <label>
                    <input
                      type="checkbox"
                      checked={brand === "yes"}
                      onChange={(e) => setBrand(e.target.checked ? "yes" : "no")}
                    />
                    Your Brand
                  </label>
                  <p>Promote yourself or your own business.</p>
                  <label>
                    <input
                      type="checkbox"
                      checked={paid === "yes"}
                      disabled={privacy === "SELF_ONLY"}
                      title={
                        privacy === "SELF_ONLY"
                          ? "Branded content visibility cannot be set to private."
                          : undefined
                      }
                      onChange={(e) => {
                        setPaid(e.target.checked ? "yes" : "no");
                      }}
                    />
                    Branded Content
                  </label>
                  <p>
                    Promote another brand for payment or another incentive. Your post will be
                    labelled Paid partnership and cannot be private.
                  </p>
                  {privacy === "SELF_ONLY" && (
                    <p>
                      Branded content visibility cannot be set to private. Choose another visibility
                      to select Branded Content.
                    </p>
                  )}
                  {(brand === "yes" || paid === "yes") && (
                    <p>
                      Your video will be labelled{" "}
                      {paid === "yes" ? "Paid partnership" : "Promotional content"}.
                    </p>
                  )}
                  {brand !== "yes" && paid !== "yes" && (
                    <p>Select at least one commercial content type.</p>
                  )}
                </>
              )}
              <p>
                When publishing, you confirm your rights to the media and agree to TikTok's{" "}
                <a
                  href="https://www.tiktok.com/legal/page/global/music-usage-confirmation/en"
                  target="_blank"
                  rel="noreferrer"
                >
                  Music Usage Confirmation
                </a>
                {paid === "yes" && (
                  <>
                    {" "}
                    and{" "}
                    <a
                      href="https://www.tiktok.com/legal/page/global/bc-policy/en"
                      target="_blank"
                      rel="noreferrer"
                    >
                      Branded Content Policy
                    </a>
                  </>
                )}
                .
              </p>
            </>
          )}
          <button
            type="button"
            disabled={
              busy ||
              selectionDirty ||
              !text.trim() ||
              (asset.kind !== "facebook_page" && !file) ||
              (asset.kind === "youtube" && (!title.trim() || !privacy || !kids || !ai)) ||
              (asset.kind === "tiktok" &&
                (!creator ||
                  !privacy ||
                  !ai ||
                  (commercial && brand !== "yes" && paid !== "yes") ||
                  (paid === "yes" && privacy === "SELF_ONLY")))
            }
            onClick={() =>
              run(async () => {
                await verifyAccess({ provider: row.provider });
                let storageId: Id<"_storage"> | undefined;
                if (file) {
                  validateSocialMedia(asset.kind, file.size, file.type);
                  if (
                    asset.kind === "tiktok" &&
                    (!creator ||
                      mp4Duration(new Uint8Array(await file.arrayBuffer())) >
                        creator.maxDurationSeconds)
                  )
                    throw Error("Video exceeds creator duration limit");
                  const url = await uploadUrl({});
                  const response = await fetch(url, {
                    method: "POST",
                    headers: { "Content-Type": file.type },
                    body: file,
                  });
                  if (!response.ok) throw Error();
                  storageId = (await response.json()).storageId;
                }
                await stage({
                  provider: row.provider,
                  assetId,
                  text,
                  ...(storageId ? { storageId } : {}),
                  ...(asset.kind === "youtube"
                    ? { title, privacy, madeForKids: kids === "yes", aiGenerated: ai === "yes" }
                    : {}),
                  ...(asset.kind === "tiktok"
                    ? {
                        privacy,
                        aiGenerated: ai === "yes",
                        ownBrand: brand === "yes",
                        paidPartnership: paid === "yes",
                        allowComments: comments,
                        allowDuet: duet,
                        allowStitch: stitch,
                      }
                    : {}),
                });
                setText("");
                setFile(null);
                setNotice("Draft saved for your review. Nothing has been published.");
              }, "Draft could not be saved. Your content is still in the composer. Verify account access and retry.")
            }
          >
            Save draft for review
          </button>
        </section>
      )}
      <h3>Post reviews</h3>
      {creatorNotice && <p role="status">{creatorNotice}</p>}
      {allPosts
        ?.filter((p) => p.provider === row.provider)
        .map((p) => (
          <article
            className={styles.review}
            key={p._id}
            style={{ border: "1px solid var(--rule)", borderRadius: 12, padding: 16 }}
          >
            <h4>
              {p.assetName} · {p.kind.replaceAll("_", " ")}
            </h4>
            <p>Status: {p.status}</p>
            {p.title && <p>{p.title}</p>}
            <p style={{ whiteSpace: "pre-wrap" }}>{p.text}</p>
            {p.mediaUrl &&
              (p.kind === "instagram" ? (
                <img
                  src={p.mediaUrl}
                  alt="Media to publish"
                  style={{ maxWidth: "100%", maxHeight: 300 }}
                />
              ) : (
                // biome-ignore lint/a11y/useMediaCaption: Preview the customer's original upload; no caption file has been provided.
                <video controls src={p.mediaUrl} style={{ maxWidth: "100%", maxHeight: 300 }} />
              ))}
            <p>This review is the saved post. Editing the composer does not change it.</p>
            {p.status === "draft" && editId === p._id && (
              <section className={styles.composer}>
                <label>
                  Edit saved post text
                  <textarea
                    value={editText}
                    maxLength={p.kind === "tiktok" || p.kind === "instagram" ? 2200 : 5000}
                    onChange={(e) => setEditText(e.target.value)}
                  />
                </label>
                {p.kind === "youtube" && (
                  <label>
                    Edit saved video title
                    <input
                      value={editTitle}
                      maxLength={100}
                      onChange={(e) => setEditTitle(e.target.value)}
                    />
                  </label>
                )}
                <p>Changing the account, media, visibility or disclosures requires a new draft.</p>
                <button
                  type="button"
                  disabled={busy || !editText.trim() || (p.kind === "youtube" && !editTitle.trim())}
                  onClick={() =>
                    run(async () => {
                      await editDraft({
                        postId: p._id,
                        revision: p.revision,
                        text: editText,
                        ...(p.kind === "youtube" ? { title: editTitle } : {}),
                      });
                      setEditId(null);
                      setNotice("Changes saved. Review the updated post before approving it.");
                    })
                  }
                >
                  Save post changes
                </button>
                <button type="button" disabled={busy} onClick={() => setEditId(null)}>
                  Cancel post changes
                </button>
              </section>
            )}
            {p.privacy && <p>Visibility: {p.privacy}</p>}
            {typeof p.madeForKids === "boolean" && (
              <p>Made for children: {p.madeForKids ? "Yes" : "No"}</p>
            )}
            {typeof p.aiGenerated === "boolean" && (
              <p>AI/altered content: {p.aiGenerated ? "Yes" : "No"}</p>
            )}
            {p.kind === "tiktok" && (
              <p>
                Own business: {p.ownBrand ? "Yes" : "No"} · Paid partnership:{" "}
                {p.paidPartnership ? "Yes" : "No"} · Comments: {p.allowComments ? "On" : "Off"} ·
                Duets: {p.allowDuet ? "On" : "Off"} · Stitch: {p.allowStitch ? "On" : "Off"}
              </p>
            )}
            {p.providerPostId && <p>Platform receipt: {p.providerPostId}</p>}
            {p.status === "processing" && (
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  run(async () => {
                    const result = await checkPost({ postId: p._id });
                    setNotice("Platform status: " + result.status);
                  })
                }
              >
                Check publication status
              </button>
            )}
            {p.status === "processing" && (
              <p>Accepted for processing. Publication is not confirmed.</p>
            )}
            {(p.status === "unknown" || p.status === "submitting") && (
              <p>
                Check the platform before trying again. This attempt will not be automatically
                repeated.
              </p>
            )}
            {p.status === "failed" && (
              <p>
                Could not publish. Review the account, permissions and media before preparing
                another draft.
              </p>
            )}
            {p.kind === "tiktok" && p.status === "draft" && (
              <>
                {creator ? (
                  <p>
                    Posting as {creator.name}. Current maximum video duration:{" "}
                    {creator.maxDurationSeconds} seconds.
                  </p>
                ) : (
                  <p>
                    Fresh TikTok posting options are required before approval. Choose the account
                    above to retry loading them.
                  </p>
                )}
                {(!p.customerChoicesConfirmed ||
                  (creator &&
                    (!creator.privacyOptions.includes(p.privacy ?? "") ||
                      (creator.commentsDisabled && p.allowComments) ||
                      (creator.duetDisabled && p.allowDuet) ||
                      (creator.stitchDisabled && p.allowStitch)))) && (
                  <>
                    <p>
                      {!p.customerChoicesConfirmed
                        ? "This agent-prepared or earlier draft needs your TikTok choices."
                        : "Your TikTok posting options changed after this draft was saved."}{" "}
                      Create a new draft in the composer, upload the original video and choose
                      visibility, interactions and disclosures yourself. Nothing will publish from
                      this review.
                    </p>
                    <button
                      type="button"
                      disabled={
                        busy ||
                        selectionDirty ||
                        !row.selectedAssetIds.includes(p.assetId) ||
                        row.connectionId !== p.connectionId
                      }
                      onClick={() => {
                        setAssetId(p.assetId);
                        setText(p.text);
                        setTitle(p.title ?? "");
                        setFile(null);
                        setPrivacy("");
                        setAi("");
                        setCommercial(false);
                        setBrand("no");
                        setPaid("no");
                        setComments(false);
                        setDuet(false);
                        setStitch(false);
                        setNotice(
                          "Caption copied to the composer. Upload the original video and choose your TikTok settings to save a new draft.",
                        );
                      }}
                    >
                      Prepare a customer-reviewed TikTok draft
                    </button>
                  </>
                )}
                <p>
                  By posting, you agree to TikTok’s{" "}
                  <a
                    href="https://www.tiktok.com/legal/page/global/music-usage-confirmation/en"
                    target="_blank"
                    rel="noreferrer"
                  >
                    Music Usage Confirmation
                  </a>
                  {p.paidPartnership && (
                    <>
                      {" "}
                      and{" "}
                      <a
                        href="https://www.tiktok.com/legal/page/global/bc-policy/en"
                        target="_blank"
                        rel="noreferrer"
                      >
                        Branded Content Policy
                      </a>
                    </>
                  )}
                  . Processing may take a few minutes.
                </p>
              </>
            )}
            {p.status === "draft" &&
              (row.connectionId !== p.connectionId ||
                (row.selectionRevision ?? 0) !== (p.selectionRevision ?? 0)) && (
                <p>Account access or selection changed. Prepare a new draft before publishing.</p>
              )}
            {p.status === "draft" && (
              <>
                <button
                  type="button"
                  disabled={
                    busy ||
                    editId === p._id ||
                    selectionDirty ||
                    (row.selectionRevision ?? 0) !== (p.selectionRevision ?? 0) ||
                    !row.publishEnabled ||
                    (p.kind === "tiktok" &&
                      (!p.customerChoicesConfirmed ||
                        !creator ||
                        creator.maxDurationSeconds <= 0 ||
                        !creator.privacyOptions.includes(p.privacy ?? "") ||
                        (creator.commentsDisabled && p.allowComments) ||
                        (creator.duetDisabled && p.allowDuet) ||
                        (creator.stitchDisabled && p.allowStitch))) ||
                    !row.selectedAssetIds.includes(p.assetId) ||
                    row.connectionId !== p.connectionId ||
                    !publishingScopes(p.kind).every((scope) => row.scopes.includes(scope))
                  }
                  onClick={() =>
                    run(async () => {
                      await verifyAccess({ provider: row.provider });
                      await approve({ postId: p._id, revision: p.revision });
                      setNotice("Approved for submission. Check the post status for confirmation.");
                    }, "Approval could not be confirmed. Check the saved post status before trying again.")
                  }
                >
                  Approve and publish this post
                </button>
                <button
                  type="button"
                  disabled={busy || editId !== null}
                  onClick={() => {
                    setEditId(p._id);
                    setEditText(p.text);
                    setEditTitle(p.title ?? "");
                  }}
                >
                  Edit saved post
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    run(async () => {
                      await discard({ postId: p._id });
                    })
                  }
                >
                  Discard draft
                </button>
              </>
            )}
          </article>
        ))}
      <p role="status" aria-live="polite">
        {notice}
      </p>
    </fieldset>
  );
}
