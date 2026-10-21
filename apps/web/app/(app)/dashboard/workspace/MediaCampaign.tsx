"use client";

import { api } from "@pikar/backend/api";
import { useConvex, useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { useState } from "react";

type Campaign = FunctionReturnType<typeof api.mediaCampaign.list>[number];
const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;
const statusCopy: Record<string, string> = {
  draft: "Review before generation",
  proposal: "Planning video",
  ready: "Ready for review",
  reserved: "Queued",
  running: "Producing",
  succeeded: "Ready to download",
  complete: "All files ready",
  partial: "Some files ready",
  failed: "Needs attention",
  cancelled: "Cancelled",
  needs_reconciliation: "Checking the purchase outcome",
};
const refusalCopy: Record<string, string> = {
  stale_campaign: "The campaign changed. Review its latest state and try again.",
  stale_review:
    "A plan changed after your review. Check the latest plan and cost before generating.",
  planning_in_progress: "The video director is still preparing this plan.",
  campaign_maximum_exceeded:
    "The approved maximum does not cover these items. Review the maximum before generating.",
  campaign_in_flight: "Work is already running or its purchase outcome still needs checking.",
  unconfirmed_claims: "Open the video plan and confirm its figures before generating.",
  media_daily_exhausted: "Your daily media allowance cannot cover this set yet.",
  deployment_media_exhausted: "Media generation is paused by the shared daily allowance.",
  no_deck: "The video plan is still being prepared. Review it when planning finishes.",
  campaign_plan: "Use the campaign's generation approval for this item.",
};
const buttonStyle = {
  border: "1px solid var(--rule)",
  borderRadius: 10,
  padding: "8px 12px",
  cursor: "pointer",
  minHeight: 44,
  maxWidth: "100%",
} as const;

export function CampaignCard({
  campaign,
  onOpenPlan,
}: {
  campaign: Campaign;
  onOpenPlan?: (id: string) => void;
}) {
  const convex = useConvex();
  const approve = useMutation(api.mediaCampaign.approve);
  const cancel = useMutation(api.mediaCampaign.cancel);
  const refresh = useMutation(api.mediaCampaign.refresh);
  const [maximum, setMaximum] = useState((campaign.maxCostCents / 100).toFixed(2));
  const [selected, setSelected] = useState<number[]>([]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [downloadUrls, setDownloadUrls] = useState<Record<number, string>>({});
  const failures = campaign.items.filter((item) => item.status === "failed");
  const firstGeneration = campaign.status === "draft";
  const canApprove =
    !campaign.tenantBusy &&
    (firstGeneration
      ? campaign.items.every((item) => item.status === "ready" && !item.refusal)
      : selected.length > 0 &&
        campaign.items.every(
          (item) => !["running", "reserved", "needs_reconciliation"].includes(item.status),
        ));
  const additionalCents = firstGeneration
    ? campaign.nextMaximumCents
    : selected.reduce((total, index) => total + (campaign.items[index]?.estimateCents ?? 0), 0);

  async function act(task: () => Promise<unknown>) {
    setPending(true);
    setError(null);
    try {
      await task();
    } catch {
      setError("The campaign could not be updated. Please try again.");
    } finally {
      setPending(false);
    }
  }

  async function generate() {
    if (!/^\d+(?:\.\d{1,2})?$/.test(maximum)) {
      setError("Enter a maximum in dollars with up to two decimal places.");
      return;
    }
    await act(async () => {
      const result = await approve({
        campaignId: campaign.id,
        expectedUpdatedAt: campaign.updatedAt,
        expectedReviewHash: campaign.reviewHash,
        maxCostCents: Math.round(Number(maximum) * 100),
        ...(firstGeneration ? {} : { itemIndexes: selected }),
      });
      if (!result.ok)
        setError(
          refusalCopy[result.reason] ??
            "Generation could not start. Review each plan and its cost, then try again.",
        );
      else setSelected([]);
    });
  }

  function downloadManifest() {
    const manifest = {
      campaignId: campaign.id,
      title: campaign.title,
      status: campaign.status,
      mediaMaximumCents: campaign.maxCostCents,
      reservedMaximumCents: campaign.reservedCents,
      items: campaign.items.map((item, index) => ({
        index,
        planId: item.planId,
        label: item.label,
        kind: item.kind,
        status: item.status,
        included: item.downloadable,
        musicCredit: item.musicCredit,
      })),
      note: "Files are downloaded individually. Only items marked included have completed artifacts. This manifest contains no temporary download links.",
    };
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(manifest, null, 2)], { type: "application/json" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = "media-campaign-manifest.json";
    link.click();
    URL.revokeObjectURL(url);
  }

  const done = campaign.items.filter((item) => item.status === "succeeded").length;
  return (
    <section
      aria-label={`Media campaign: ${campaign.title}`}
      style={{
        background: "var(--card)",
        color: "var(--ink)",
        border: "1px solid var(--rule)",
        borderRadius: 18,
        padding: 20,
        marginBottom: 16,
        fontVariantNumeric: "tabular-nums",
      }}
    >
      <p
        style={{
          fontSize: 12,
          letterSpacing: ".08em",
          textTransform: "uppercase",
          color: "var(--ink-soft)",
        }}
      >
        Media campaign
      </p>
      <h3 style={{ margin: "6px 0" }}>{campaign.title}</h3>
      <p aria-live="polite">
        {statusCopy[campaign.status]} · {done} of {campaign.items.length} files ready
      </p>
      <progress
        aria-label="Campaign files ready"
        value={done}
        max={campaign.items.length}
        style={{ width: "100%", height: 8, accentColor: "var(--teal-900)" }}
      />
      <p style={{ color: "var(--ink-soft)", fontSize: 13 }}>
        Reserved maximum so far: {money(campaign.reservedCents)}. Up to two campaign items run
        together. One campaign runs at a time for your account.
      </p>
      <ul style={{ padding: 0, listStyle: "none" }}>
        {campaign.items.map((item, index) => (
          <li key={item.planId} style={{ padding: "12px 0", borderTop: "1px solid var(--rule)" }}>
            <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              {item.status === "failed" && !campaign.cancelled && (
                <input
                  type="checkbox"
                  aria-label={`Retry ${item.label}`}
                  checked={selected.includes(index)}
                  onChange={(event) =>
                    setSelected((current) =>
                      event.target.checked
                        ? [...current, index]
                        : current.filter((value) => value !== index),
                    )
                  }
                />
              )}
              <strong>{item.label}</strong>
              <span style={{ color: "var(--ink-soft)", fontSize: 13 }}>
                {item.kind === "image" ? "Image" : "Finished video"} · {statusCopy[item.status]}
              </span>
            </div>
            {item.refusal && (
              <p style={{ fontSize: 13 }}>
                {refusalCopy[item.refusal] ??
                  "Open this plan to resolve its generation requirements."}
              </p>
            )}
            {item.status === "needs_reconciliation" && (
              <p style={{ fontSize: 13 }}>
                This item will not be purchased again while the original outcome is uncertain.
              </p>
            )}
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                alignItems: "center",
                gap: 14,
                marginTop: 8,
                fontSize: 13,
              }}
            >
              <a
                href={`/dashboard/workspace?thread=${encodeURIComponent(campaign.threadId)}&plan=${encodeURIComponent(item.planId)}&view=canvas`}
                onClick={
                  onOpenPlan
                    ? (event) => {
                        event.preventDefault();
                        onOpenPlan(item.planId);
                      }
                    : undefined
                }
                style={{ color: "var(--teal-900)" }}
              >
                Review plan
              </a>
              {downloadUrls[index] ? (
                <a
                  href={downloadUrls[index]}
                  download
                  target="_blank"
                  rel="noreferrer"
                  style={{ color: "var(--teal-900)" }}
                >
                  Download {item.kind === "image" ? "image" : "MP4"}
                </a>
              ) : (
                item.downloadable && (
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() =>
                      void act(async () => {
                        const url = await convex.query(api.mediaCampaign.download, {
                          campaignId: campaign.id,
                          itemIndex: index,
                        });
                        if (url) setDownloadUrls((current) => ({ ...current, [index]: url }));
                        else
                          setError(
                            "This file is not available yet. Check its status and try again.",
                          );
                      })
                    }
                    style={buttonStyle}
                  >
                    Prepare {item.kind === "image" ? "image" : "MP4"} download
                  </button>
                )
              )}
              {(item.status === "ready" || item.status === "failed") && (
                <span style={{ marginLeft: "auto", fontVariantNumeric: "tabular-nums" }}>
                  Maximum {money(item.estimateCents)}
                </span>
              )}
            </div>
          </li>
        ))}
      </ul>
      {!campaign.cancelled && (firstGeneration || failures.length > 0) && (
        <div style={{ borderTop: "1px solid var(--rule)", paddingTop: 14 }}>
          <label style={{ display: "block", fontSize: 13 }}>
            Media generation maximum (USD, including earlier media attempts)
            <input
              aria-label="Campaign maximum in USD"
              inputMode="decimal"
              value={maximum}
              onChange={(event) => setMaximum(event.target.value)}
              style={{
                display: "block",
                margin: "6px 0 10px",
                padding: 8,
                minHeight: 44,
                width: 140,
                border: "1px solid var(--rule)",
                borderRadius: 8,
              }}
            />
          </label>
          <p style={{ fontSize: 13 }}>
            This approval reserves up to {money(additionalCents)} more. Completed files stay
            available. Generation does not publish your work.
          </p>
          {campaign.items.some((item) => item.kind === "video") && (
            <p style={{ fontSize: 13, color: "var(--ink-soft)" }}>
              Video planning uses your AI allowance separately. This maximum covers media
              generation.
            </p>
          )}
          <button
            type="button"
            disabled={pending || !canApprove}
            onClick={() => void generate()}
            style={{
              ...buttonStyle,
              background: pending || !canApprove ? "var(--canvas)" : "var(--teal-900)",
              color: pending || !canApprove ? "var(--ink-soft)" : "white",
            }}
          >
            {firstGeneration
              ? "Approve and generate campaign"
              : "Approve paid retry of selected items"}
          </button>
        </div>
      )}
      {campaign.tenantBusy && (
        <p role="status" style={{ fontSize: 13 }}>
          Another campaign is still running or checking a purchase. You can review this campaign now
          and approve it once the other campaign finishes.
        </p>
      )}
      <div
        style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10, marginTop: 12 }}
      >
        {campaign.status === "needs_reconciliation" && (
          <button
            type="button"
            disabled={pending}
            onClick={() => void act(() => refresh({ campaignId: campaign.id }))}
            style={buttonStyle}
          >
            Check completed work
          </button>
        )}
        {done > 0 && (
          <button type="button" onClick={downloadManifest} style={buttonStyle}>
            Download manifest and credits
          </button>
        )}
        {!campaign.cancelled &&
          ["draft", "running", "needs_reconciliation"].includes(campaign.status) && (
            <button
              type="button"
              disabled={pending}
              onClick={() => void act(() => cancel({ campaignId: campaign.id }))}
              style={buttonStyle}
            >
              Cancel queued items
            </button>
          )}
      </div>
      {campaign.cancelled && (
        <p style={{ fontSize: 13 }}>
          Queued items were cancelled. Submitted work may still finish. No refund is assumed.
        </p>
      )}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}

export function MediaCampaign({ threadId }: { threadId: string | null }) {
  const campaigns = useQuery(api.mediaCampaign.list, threadId ? { threadId } : "skip");
  if (!campaigns?.length) return null;
  return (
    <div>
      {campaigns.map((campaign) => (
        <CampaignCard key={campaign.id} campaign={campaign} />
      ))}
    </div>
  );
}
