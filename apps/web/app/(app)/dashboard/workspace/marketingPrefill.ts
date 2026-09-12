import { MARKETING_CHANNEL_CATALOG } from "@pikar/core/marketing";

/** Closed intent only: URLs never carry a funnel token, recipient, or arbitrary prompt. */
export function marketingPrefill(search: string): string | null {
  const params = new URLSearchParams(search);
  if (params.getAll("intent").length !== 1 || params.get("intent") !== "marketing") return null;
  if (params.getAll("channel").length !== 1) return null;
  const channel = MARKETING_CHANNEL_CATALOG.find((item) => item.id === params.get("channel"));
  return channel
    ? `Help me draft a marketing plan for ${channel.name}. Propose the next step for my review. Do not send or publish anything.`
    : null;
}

export function applyMarketingPrefill(current: string, incoming: string | null, sending: boolean) {
  return current || sending || !incoming ? current : incoming;
}
