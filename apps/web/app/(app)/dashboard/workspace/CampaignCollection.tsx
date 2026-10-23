"use client";

import { api } from "@pikar/backend/api";
import { useConvex, useQuery } from "convex/react";
import type { GenericId } from "convex/values";
import { useEffect, useRef, useState } from "react";
import { ArtifactViewerBody } from "../artifacts/ArtifactViewer";
import { BatchDownloadError, downloadOwnedBatch } from "../artifacts/batchDownload";
import { downloadOwnedOriginal } from "../artifacts/originalDownload";
import { ImageIcon, VideoIcon } from "../vault/icons";
import styles from "./CampaignCollection.module.css";
import { CampaignCard } from "./MediaCampaign";

const itemStatus: Record<string, string> = {
  proposal: "Planning",
  ready: "Awaiting approval",
  reserved: "Queued",
  running: "Producing",
  succeeded: "Ready",
  failed: "Needs attention",
  cancelled: "Cancelled",
  needs_reconciliation: "Checking outcome",
};

/** Only the open collection's visible tiles request media. The global output inventory stays metadata-only. */
function Thumbnail({
  campaignId,
  index,
  kind,
  ready,
}: {
  campaignId: GenericId<"mediaCampaigns">;
  index: number;
  kind: "image" | "video";
  ready: boolean;
}) {
  const node = useRef<HTMLSpanElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (!node.current || !ready) return;
    if (typeof IntersectionObserver === "undefined") {
      setVisible(true);
      return;
    }
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        setVisible(true);
        observer.disconnect();
      }
    });
    observer.observe(node.current);
    return () => observer.disconnect();
  }, [ready]);
  const url = useQuery(
    api.mediaCampaign.download,
    visible && ready ? { campaignId, itemIndex: index } : "skip",
  );
  return (
    <span ref={node} className={styles.thumbnail}>
      {url ? (
        kind === "image" ? (
          // biome-ignore lint/performance/noImgElement: use the owned storage URL directly; an image optimization proxy must not receive this capability.
          <img src={url} alt="" loading="lazy" referrerPolicy="no-referrer" />
        ) : (
          <video src={`${url}#t=0.1`} muted playsInline preload="metadata" />
        )
      ) : kind === "image" ? (
        <ImageIcon size={24} />
      ) : (
        <VideoIcon size={24} />
      )}
    </span>
  );
}

export function CampaignCollection({
  campaignId,
  threadId,
  onOpenPlan,
}: {
  campaignId: GenericId<"mediaCampaigns">;
  threadId: string;
  onOpenPlan: (id: string) => void;
}) {
  const convex = useConvex();
  const campaign = useQuery(api.mediaCampaign.byId, { campaignId, threadId });
  const [index, setIndex] = useState(0);
  const [controls, setControls] = useState(false);
  const archiveRequest = useRef<AbortController | null>(null);
  const [archiveBusy, setArchiveBusy] = useState(false);
  const [archiveStatus, setArchiveStatus] = useState<string | null>(null);
  const [archiveError, setArchiveError] = useState<string | null>(null);
  useEffect(() => {
    void campaignId;
    void threadId;
    setArchiveBusy(false);
    setArchiveStatus(null);
    setArchiveError(null);
    return () => {
      archiveRequest.current?.abort();
      archiveRequest.current = null;
    };
  }, [campaignId, threadId]);
  useEffect(() => {
    if (campaign === null) {
      archiveRequest.current?.abort();
      archiveRequest.current = null;
      setArchiveBusy(false);
      setArchiveStatus(null);
    }
  }, [campaign]);
  const selected = campaign?.items[Math.min(index, (campaign?.items.length ?? 1) - 1)];
  const url = useQuery(
    api.mediaCampaign.download,
    campaign && selected?.downloadable && !controls
      ? { campaignId, itemIndex: Math.min(index, campaign.items.length - 1) }
      : "skip",
  );
  async function downloadBatch() {
    if (!campaign || archiveRequest.current) return;
    const request = new AbortController();
    archiveRequest.current = request;
    setArchiveBusy(true);
    setArchiveStatus("Preparing ZIP…");
    setArchiveError(null);
    try {
      const manifest = await convex.query(api.mediaCampaign.downloadManifest, {
        campaignId,
        threadId,
      });
      request.signal.throwIfAborted();
      if (archiveRequest.current !== request) return;
      if (!manifest || manifest.campaignId !== campaignId || manifest.threadId !== threadId)
        throw new BatchDownloadError("unavailable");
      if (manifest.entries.length === 0) {
        setArchiveStatus(null);
        setArchiveError(
          "No ready files are available. Try again when this batch has completed files.",
        );
        return;
      }
      await downloadOwnedBatch(manifest, request.signal, ({ completed, total, bytes }) => {
        if (request.signal.aborted || archiveRequest.current !== request) return;
        setArchiveStatus(
          completed === total
            ? `Creating ZIP for ${total} ${total === 1 ? "file" : "files"}…`
            : `Downloading file ${completed + 1} of ${total} · ${(bytes / (1024 * 1024)).toFixed(1)} MiB`,
        );
      });
      request.signal.throwIfAborted();
      if (archiveRequest.current !== request) return;
      const count = manifest.entries.length;
      const omitted = manifest.omitted.length;
      setArchiveStatus(
        `ZIP download started with ${count} ${count === 1 ? "file" : "files"}.${
          omitted
            ? ` ${omitted} ${omitted === 1 ? "item was" : "items were"} omitted; details are in the ZIP readme.`
            : ""
        }`,
      );
    } catch (error) {
      if (request.signal.aborted || archiveRequest.current !== request) return;
      setArchiveStatus(null);
      setArchiveError(
        error instanceof BatchDownloadError && error.code === "byte_limit"
          ? "This ZIP exceeds the 200 MiB limit. Download the files individually instead."
          : "The ZIP couldn't be downloaded. No partial ZIP was saved. Try again.",
      );
    } finally {
      if (archiveRequest.current === request) {
        archiveRequest.current = null;
        setArchiveBusy(false);
      }
    }
  }
  function cancelArchive() {
    archiveRequest.current?.abort();
    archiveRequest.current = null;
    setArchiveBusy(false);
    setArchiveError(null);
    setArchiveStatus("ZIP download cancelled. You can try again.");
  }
  if (campaign === undefined)
    return (
      <p className={styles.empty} role="status">
        Opening media batch…
      </p>
    );
  if (!campaign)
    return (
      <p className={styles.empty} role="alert">
        This batch is unavailable in this conversation.
      </p>
    );
  const completed = campaign.items.filter((item) => item.status === "succeeded").length;
  const available = campaign.items.filter((item) => item.downloadable).length;
  const production = controls || completed === 0;
  return (
    <section className={styles.collection} aria-label={`${campaign.title} media batch`}>
      <header className={styles.header}>
        <div>
          <span className={styles.scope}>Media batch · {campaign.items.length} outputs</span>
          <h2>{campaign.title}</h2>
          <p aria-live="polite">
            {completed} of {campaign.items.length} ready
            {campaign.cancelled ? " · queued work cancelled" : ""}
          </p>
        </div>
        <div className={styles.actions}>
          <div className={styles.archiveActions}>
            <button
              type="button"
              className={styles.archiveButton}
              disabled={archiveBusy || available === 0}
              onClick={() => void downloadBatch()}
              title="Original ready files and a readme, in one ZIP. Up to 200 MiB."
            >
              {archiveBusy ? "Preparing ZIP…" : `Download ready files (${available})`}
            </button>
            {archiveBusy && (
              <button type="button" className={styles.archiveButton} onClick={cancelArchive}>
                Cancel ZIP
              </button>
            )}
            <small>ZIP · 200 MiB max</small>
          </div>
          <fieldset
            className={styles.switch}
            aria-label="Batch view"
            style={{ border: 0, padding: 0, margin: 0 }}
          >
            <button
              type="button"
              aria-pressed={!production}
              disabled={completed === 0}
              onClick={() => setControls(false)}
            >
              Gallery
            </button>
            <button type="button" aria-pressed={production} onClick={() => setControls(true)}>
              Review and generation
            </button>
          </fieldset>
        </div>
      </header>
      {archiveStatus || archiveError ? (
        <div className={styles.archiveStatus}>
          {archiveStatus ? <p role="status">{archiveStatus}</p> : null}
          {archiveError ? <p role="alert">{archiveError}</p> : null}
        </div>
      ) : null}
      {production ? (
        <div className={styles.production} onFocusCapture={() => setControls(true)}>
          <CampaignCard campaign={campaign} onOpenPlan={onOpenPlan} />
        </div>
      ) : (
        <div className={styles.gallery}>
          <nav className={styles.tiles} aria-label="Batch items">
            {campaign.items.map((item, itemIndex) => (
              <button
                type="button"
                key={item.planId}
                aria-pressed={index === itemIndex}
                className={`${styles.tile} ${index === itemIndex ? styles.selected : ""}`}
                onClick={() => setIndex(itemIndex)}
              >
                <Thumbnail
                  campaignId={campaignId}
                  index={itemIndex}
                  kind={item.kind}
                  ready={item.downloadable}
                />
                <span className={styles.tileText}>
                  <strong>{item.label}</strong>
                  <small>
                    {item.kind === "image" ? "Image" : "Video"} ·{" "}
                    {itemStatus[item.status] ?? "In progress"}
                  </small>
                </span>
              </button>
            ))}
          </nav>
          <div className={styles.stage}>
            {selected?.downloadable ? (
              <ArtifactViewerBody
                key={selected.planId}
                artifact={{
                  id: selected.planId,
                  title: selected.label,
                  mimeType: selected.kind === "image" ? "image/png" : "video/mp4",
                  url,
                  loading: url === undefined,
                  hasOriginal: Boolean(url),
                }}
                onDownload={
                  url
                    ? (signal) =>
                        downloadOwnedOriginal(
                          url,
                          selected.kind === "image" ? "campaign-image.png" : "campaign-video.mp4",
                          signal ?? new AbortController().signal,
                        )
                    : undefined
                }
              />
            ) : (
              <div className={styles.pending}>
                <span>
                  {selected?.kind === "image" ? <ImageIcon size={32} /> : <VideoIcon size={32} />}
                </span>
                <h3>{selected?.label}</h3>
                <p>{selected ? itemStatus[selected.status] : "Choose an item"}</p>
                <button type="button" onClick={() => setControls(true)}>
                  Open generation controls
                </button>
              </div>
            )}
            {selected && (
              <footer className={styles.footer}>
                <span>
                  {index + 1} of {campaign.items.length}
                </span>
                <button
                  type="button"
                  disabled={index === 0}
                  onClick={() => setIndex((value) => Math.max(0, value - 1))}
                >
                  Previous
                </button>
                <button
                  type="button"
                  disabled={index >= campaign.items.length - 1}
                  onClick={() =>
                    setIndex((value) => Math.min(campaign.items.length - 1, value + 1))
                  }
                >
                  Next
                </button>
                <button type="button" onClick={() => onOpenPlan(selected.planId)}>
                  Open production plan
                </button>
              </footer>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
