/** Campaigns compose existing governed media jobs; they never create a second spending rail. */
export const MEDIA_CAMPAIGN_MAX_ITEMS = 15;
export const MEDIA_CAMPAIGN_CONCURRENCY = 2;
export const MEDIA_CAMPAIGN_SETTLEMENT_MS = 2 * 60 * 60 * 1000;

export type CampaignItemStatus =
  | "proposal"
  | "ready"
  | "reserved"
  | "running"
  | "succeeded"
  | "failed"
  | "cancelled"
  | "needs_reconciliation";
export type CampaignStatus =
  | "draft"
  | "running"
  | "complete"
  | "partial"
  | "failed"
  | "cancelled"
  | "needs_reconciliation";
export type CampaignInput = {
  kind: "image" | "video";
  label: string;
  prompt?: string;
  brief?: string;
};

export function validateCampaignInput(
  title: string,
  items: readonly CampaignInput[],
  maxCostCents: number,
): string | null {
  if (!title.trim() || title.length > 120) return "invalid_title";
  if (!Number.isSafeInteger(maxCostCents) || maxCostCents < 0) return "invalid_maximum";
  if (items.length < 1 || items.length > MEDIA_CAMPAIGN_MAX_ITEMS) return "invalid_item_count";
  for (const item of items) {
    const text = item.kind === "image" ? item.prompt : item.brief;
    if (!item.label.trim() || item.label.length > 160) return "invalid_label";
    if (!text?.trim() || text.length > 8000) return "invalid_brief";
  }
  return null;
}

/** Show a conservative maximum from exact USD, matching the shared rail's upward rounding. */
export function campaignMaximumCents(estimatedUsd: number): number {
  if (!Number.isFinite(estimatedUsd) || estimatedUsd < 0) throw new Error("INVALID_MEDIA_ESTIMATE");
  const cents = Math.ceil(estimatedUsd * 100);
  if (!Number.isSafeInteger(cents)) throw new Error("INVALID_MEDIA_ESTIMATE");
  return cents;
}

export function campaignStatus(
  items: readonly { status: CampaignItemStatus }[],
  cancelled: boolean,
): CampaignStatus {
  if (items.some((item) => item.status === "needs_reconciliation")) return "needs_reconciliation";
  if (items.some((item) => item.status === "running" || item.status === "reserved"))
    return "running";
  if (items.every((item) => item.status === "succeeded")) return "complete";
  if (items.some((item) => item.status === "succeeded")) return "partial";
  if (items.some((item) => item.status === "proposal" || item.status === "ready")) return "draft";
  return cancelled ? "cancelled" : "failed";
}

/** Unknown submissions occupy their slot until reconciled, even if a watchdog has stopped polling. */
export function campaignStartIndexes(
  items: readonly { status: CampaignItemStatus }[],
  cancelled: boolean,
  concurrency = MEDIA_CAMPAIGN_CONCURRENCY,
): number[] {
  if (
    cancelled ||
    !Number.isFinite(concurrency) ||
    items.some((item) => item.status === "needs_reconciliation")
  )
    return [];
  const limit = Math.min(MEDIA_CAMPAIGN_CONCURRENCY, Math.max(0, Math.floor(concurrency)));
  let slots = limit - items.filter((item) => item.status === "running").length;
  const selected: number[] = [];
  for (const [index, item] of items.entries()) {
    if (slots <= 0) break;
    if (item.status === "reserved") {
      selected.push(index);
      slots -= 1;
    }
  }
  return selected;
}

/** Closed fail-safe classification: an unknown paid outcome never enables a paid retry. */
export function ambiguousCampaignFailure(reason: string | undefined): boolean {
  return (
    reason === undefined ||
    /timeout|unknown|submit_(?:error|threw)|provider_error|retrier|network|transport|no_request_id|upstream/i.test(
      reason,
    )
  );
}
