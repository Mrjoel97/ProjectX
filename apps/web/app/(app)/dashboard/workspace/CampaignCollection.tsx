"use client";

import { api } from "@pikar/backend/api";
import { useQuery } from "convex/react";
import type { GenericId } from "convex/values";
import { useEffect, useRef, useState } from "react";
import { ArtifactViewerBody } from "../artifacts/ArtifactViewer";
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
  const campaign = useQuery(api.mediaCampaign.byId, { campaignId, threadId });
  const [index, setIndex] = useState(0);
  const [controls, setControls] = useState(false);
  const selected = campaign?.items[Math.min(index, (campaign?.items.length ?? 1) - 1)];
  const url = useQuery(
    api.mediaCampaign.download,
    campaign && selected?.downloadable && !controls
      ? { campaignId, itemIndex: Math.min(index, campaign.items.length - 1) }
      : "skip",
  );
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
      </header>
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
