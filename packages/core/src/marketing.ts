/** Phase 31 A1/B1/C1: aggregate raw requests, fixed source per token, no publishing. */
export const MARKETING_CHANNEL_CATALOG = [
  { id: "gmail", name: "Gmail" },
  { id: "meta-instagram", name: "Meta/Instagram" },
  { id: "linkedin", name: "LinkedIn" },
  { id: "tiktok", name: "TikTok" },
  { id: "x", name: "X" },
  { id: "youtube", name: "YouTube" },
] as const;
export type MarketingChannelId = (typeof MARKETING_CHANNEL_CATALOG)[number]["id"];
export type MarketingChannelState =
  | { status: "connected" }
  | { status: "connectable"; cta: { label: string; href: "/connect-gmail" } }
  | { status: "blocked-with-reason"; reason: string };

export function marketingChannelState(
  id: MarketingChannelId,
  gmail: { connected?: boolean; configured?: boolean },
): MarketingChannelState | null {
  if (id !== "gmail")
    return {
      status: "blocked-with-reason",
      reason:
        "The legal entity is not formed, and provider suitability and permissions review has not started.",
    };
  if (gmail.connected === true) return { status: "connected" };
  if (gmail.connected !== false || gmail.configured === undefined) return null;
  return gmail.configured
    ? { status: "connectable", cta: { label: "Connect Gmail", href: "/connect-gmail" } }
    : { status: "blocked-with-reason", reason: "Google OAuth is not configured." };
}

export const FUNNEL_STAGES = ["visit", "claim", "download"] as const;
export type FunnelStage = (typeof FUNNEL_STAGES)[number];
export const FUNNEL_STAGE_COUNTER = {
  visit: "visits",
  claim: "claims",
  download: "downloads",
} as const;
export type FunnelCounters = { visits: number; claims: number; downloads: number };
export const FUNNEL_SOURCE_MAX_LENGTH = 64;
export const FUNNEL_TITLE_MAX_LENGTH = 120;
export const FUNNEL_RAW_COUNT_CAVEAT =
  "Raw requests, including bots and retries; not unique people or completed steps. No sequence is required.";

export function parseFunnelStage(value: unknown): FunnelStage | null {
  return typeof value === "string" && (FUNNEL_STAGES as readonly string[]).includes(value)
    ? (value as FunnelStage)
    : null;
}

/** Reject control characters before trimming; source never becomes a public-controlled map key. */
export function normalizeFunnelSource(value: unknown): string | null {
  if (
    typeof value !== "string" ||
    value.length > FUNNEL_SOURCE_MAX_LENGTH ||
    !/^[a-zA-Z0-9 _-]+$/.test(value)
  )
    return null;
  const source = value.trim().toLowerCase().replace(/ +/g, "-");
  return /^[a-z0-9][a-z0-9_-]*$/.test(source) ? source : null;
}

function isCount(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}
export function parseFunnelCounters(value: unknown): FunnelCounters | null {
  if (typeof value !== "object" || value === null) return null;
  const row = value as Record<string, unknown>;
  return isCount(row.visits) && isCount(row.claims) && isCount(row.downloads)
    ? { visits: row.visits, claims: row.claims, downloads: row.downloads }
    : null;
}
export function formatFunnelCount(value: unknown): string {
  return isCount(value) ? String(value) : "—";
}
