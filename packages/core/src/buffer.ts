/** Buffer MCP contracts. No credentials, framework calls or provider prose in errors. */
export const BUFFER_MCP_URL = "https://mcp.buffer.com/mcp";
export const BUFFER_AUTH_URL = "https://auth.buffer.com/auth";
export const BUFFER_TOKEN_URL = "https://auth.buffer.com/token";
export const BUFFER_API_URL = "https://api.buffer.com";
// Registered third-party clients cannot request MCP resources or insights access.
export const BUFFER_REPORTS_AVAILABLE = false;
export const BUFFER_SCOPES = [
  "account:read",
  "posts:read",
  "posts:write",
  "offline_access",
] as const;
export const BUFFER_ID = /^[a-f0-9]{24}$/i;
export type BufferMetric = {
  type: string;
  name: string;
  value: number;
  unit: "count" | "percentage";
};
export type BufferChannel = {
  id: string;
  name: string;
  service: string;
  available: boolean;
  nativeAccountId?: string;
  boards?: { id: string; name: string }[];
};
export type BufferPublicationReceipt = {
  source: "buffer-status-v1";
  bufferPostId: string;
  channelId: string;
  platform: "instagram" | "tiktok";
  nativeAccountId: string;
  nativePostId: string | null;
  nativePostUrl: string;
  sentAt: number;
  observedAt: number;
  draftRevision: number;
  approvedAt: number;
};

/** Provider-returned permanent URLs only. No URL fetches, shortened links or shortcode→ID guesses. */
export function nativeSocialPostReference(
  platform: string,
  value: unknown,
): { url: string; postId: string | null } | null {
  if (typeof value !== "string" || value.length > 512 || value.trim() !== value) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.port ||
    url.search ||
    url.hash
  )
    return null;
  if (platform === "instagram" && ["instagram.com", "www.instagram.com"].includes(url.hostname)) {
    const match = /^\/(p|reel)\/([A-Za-z0-9_-]{5,64})\/?$/.exec(url.pathname);
    return match
      ? { url: `https://www.instagram.com/${match[1]}/${match[2]}/`, postId: null }
      : null;
  }
  if (platform === "tiktok" && ["tiktok.com", "www.tiktok.com"].includes(url.hostname)) {
    const match = /^\/@([A-Za-z0-9._]{1,32})\/video\/([0-9]{10,25})\/?$/.exec(url.pathname);
    return match
      ? { url: `https://www.tiktok.com/@${match[1]}/video/${match[2]}`, postId: match[2] ?? null }
      : null;
  }
  return null;
}

/** This accepts only the exact known API-created post and its provider-owned channel response. */
export function normalizeBufferPublicationReceipt(
  value: unknown,
  expected: {
    bufferPostId: string;
    channelId: string;
    platform: string;
    nativeAccountId?: string;
    draftRevision: number;
    approvedAt: number;
    text: string;
  },
  observedAt: number,
): BufferPublicationReceipt | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const post = bufferRecord(value);
  if (!post.channel || typeof post.channel !== "object" || Array.isArray(post.channel)) return null;
  const channel = bufferRecord(post.channel);
  const native = nativeSocialPostReference(expected.platform, post.externalLink);
  const sentAt =
    typeof post.sentAt === "string" && /(?:Z|[+-]\d{2}:\d{2})$/.test(post.sentAt)
      ? Date.parse(post.sentAt)
      : NaN;
  if (
    !native ||
    !BUFFER_ID.test(expected.bufferPostId) ||
    !BUFFER_ID.test(expected.channelId) ||
    (expected.platform !== "instagram" && expected.platform !== "tiktok") ||
    post.id !== expected.bufferPostId ||
    post.channelId !== expected.channelId ||
    post.channelService !== expected.platform ||
    post.status !== "sent" ||
    post.schedulingType !== "automatic" ||
    post.text !== expected.text ||
    channel.id !== expected.channelId ||
    channel.service !== expected.platform ||
    typeof channel.serviceId !== "string" ||
    !/^[A-Za-z0-9_-]{1,128}$/.test(channel.serviceId) ||
    (expected.nativeAccountId !== undefined && expected.nativeAccountId !== channel.serviceId) ||
    !Number.isSafeInteger(expected.draftRevision) ||
    expected.draftRevision < 1 ||
    !Number.isSafeInteger(expected.approvedAt) ||
    expected.approvedAt < 0 ||
    !Number.isSafeInteger(observedAt) ||
    !Number.isSafeInteger(sentAt) ||
    sentAt < expected.approvedAt ||
    sentAt > observedAt
  )
    return null;
  return {
    source: "buffer-status-v1",
    bufferPostId: expected.bufferPostId,
    channelId: expected.channelId,
    platform: expected.platform,
    nativeAccountId: channel.serviceId,
    nativePostId: native.postId,
    nativePostUrl: native.url,
    sentAt,
    observedAt,
    draftRevision: expected.draftRevision,
    approvedAt: expected.approvedAt,
  };
}
export type BufferDraft = {
  channelId: string;
  text: string;
  mode: "addToQueue" | "customScheduled";
  dueAt?: number;
  imageUrl?: string;
  videoUrl?: string;
  mediaTitle?: string;
  categoryId?: string;
  boardId?: string;
  isAiGenerated?: boolean;
};

export function bufferRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("BUFFER_INVALID_RESPONSE");
  return value as Record<string, unknown>;
}

/** MCP emits the JSON payload and quota as separate text blocks. Never join them before parsing. */
export function unpackBufferTool(value: unknown): Record<string, unknown> {
  const result = bufferRecord(value);
  if (result.isError === true) throw new Error("BUFFER_TOOL_REJECTED");
  if (result.structuredContent) return bufferRecord(result.structuredContent);
  if (Array.isArray(result.content)) {
    for (const part of result.content) {
      const chunk = bufferRecord(part);
      if (chunk.type !== "text" || typeof chunk.text !== "string") continue;
      for (const candidate of [chunk.text, ...chunk.text.split("\n")]) {
        try {
          let parsed: unknown = JSON.parse(candidate);
          if (typeof parsed === "string") parsed = JSON.parse(parsed);
          return bufferRecord(parsed);
        } catch {
          /* Try the next complete text block, never evaluate provider text. */
        }
      }
    }
  }
  throw new Error("BUFFER_INVALID_RESPONSE");
}

export function normalizeBufferMetrics(value: unknown): BufferMetric[] {
  if (!Array.isArray(value) || value.length > 40) throw new Error("BUFFER_INVALID_METRICS");
  const seen = new Set<string>();
  return value.map((item) => {
    const metric = bufferRecord(item);
    if (
      typeof metric.type !== "string" ||
      !/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(metric.type) ||
      seen.has(metric.type) ||
      typeof metric.value !== "number" ||
      !Number.isFinite(metric.value) ||
      metric.value < 0 ||
      (metric.unit !== "count" && metric.unit !== "percentage")
    ) {
      throw new Error("BUFFER_INVALID_METRICS");
    }
    seen.add(metric.type);
    return {
      type: metric.type,
      name: typeof metric.name === "string" ? metric.name.slice(0, 80) : metric.type,
      value: metric.value,
      unit: metric.unit,
    };
  });
}

export function normalizeBufferChannels(value: unknown): BufferChannel[] {
  if (!Array.isArray(value) || value.length > 100) throw new Error("BUFFER_INVALID_CHANNELS");
  return value.map((item) => {
    const channel = bufferRecord(item);
    if (
      typeof channel.id !== "string" ||
      !BUFFER_ID.test(channel.id) ||
      typeof channel.name !== "string" ||
      typeof channel.service !== "string" ||
      typeof channel.isDisconnected !== "boolean" ||
      typeof channel.isLocked !== "boolean"
    ) {
      throw new Error("BUFFER_INVALID_CHANNELS");
    }
    const boards: { id: string; name: string }[] = [];
    if (channel.service === "pinterest" && channel.metadata) {
      const metadata = bufferRecord(channel.metadata);
      if (!Array.isArray(metadata.boards) || metadata.boards.length > 100)
        throw new Error("BUFFER_INVALID_CHANNELS");
      for (const value of metadata.boards) {
        const board = bufferRecord(value);
        if (
          typeof board.serviceId !== "string" ||
          !board.serviceId ||
          typeof board.name !== "string"
        )
          throw new Error("BUFFER_INVALID_CHANNELS");
        boards.push({ id: board.serviceId, name: board.name.slice(0, 160) });
      }
    }
    return {
      id: channel.id,
      name: channel.name.slice(0, 160),
      service: channel.service.slice(0, 40),
      available: !channel.isDisconnected && !channel.isLocked,
      ...(typeof channel.serviceId === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(channel.serviceId)
        ? { nativeAccountId: channel.serviceId }
        : {}),
      ...(boards.length ? { boards } : {}),
    };
  });
}

export function validateBufferDraft(draft: BufferDraft, now: number): void {
  if (
    !BUFFER_ID.test(draft.channelId) ||
    !draft.text.trim() ||
    draft.text.length > 10000 ||
    !["addToQueue", "customScheduled"].includes(draft.mode)
  )
    throw new Error("BUFFER_INVALID_POST");
  if (
    draft.mode === "customScheduled" &&
    (typeof draft.dueAt !== "number" ||
      !Number.isFinite(draft.dueAt) ||
      draft.dueAt < now + 60_000 ||
      draft.dueAt > now + 365 * 86400_000)
  )
    throw new Error("BUFFER_INVALID_SCHEDULE");
  if (draft.mode === "addToQueue" && draft.dueAt !== undefined)
    throw new Error("BUFFER_INVALID_SCHEDULE");
  if (draft.imageUrl && draft.videoUrl) throw new Error("BUFFER_ONE_MEDIA_ONLY");
  if (draft.mediaTitle !== undefined && (!draft.mediaTitle.trim() || draft.mediaTitle.length > 100))
    throw new Error("BUFFER_INVALID_MEDIA_TITLE");
  for (const mediaUrl of [draft.imageUrl, draft.videoUrl]) {
    if (!mediaUrl) continue;
    let url: URL;
    try {
      url = new URL(mediaUrl);
    } catch {
      throw new Error("BUFFER_INVALID_MEDIA");
    }
    if (
      mediaUrl.length > 4096 ||
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      !url.hostname.includes(".") ||
      url.hostname.startsWith("[") ||
      /\.(local|internal|localhost)\.?$/i.test(url.hostname) ||
      /^(localhost|127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)/.test(url.hostname)
    ) {
      throw new Error("BUFFER_INVALID_MEDIA");
    }
  }
}

const YOUTUBE_CATEGORY_IDS = [
  "1",
  "2",
  "10",
  "15",
  "17",
  "19",
  "20",
  "22",
  "23",
  "24",
  "25",
  "26",
  "27",
  "28",
  "29",
];

export type BufferDraftRequirement =
  | "media_required"
  | "video_required"
  | "media_title_required"
  | "youtube_category_required"
  | "pinterest_board_required";

/** Missing publishing details do not prevent saving a local, unapproved draft. */
export function bufferDraftRequirements(
  draft: BufferDraft,
  service: string,
): readonly BufferDraftRequirement[] {
  const missing: BufferDraftRequirement[] = [];
  if (["instagram", "tiktok", "pinterest"].includes(service) && !draft.imageUrl && !draft.videoUrl)
    missing.push("media_required");
  if (service === "youtube") {
    if (!draft.videoUrl) missing.push("video_required");
    if (!draft.mediaTitle?.trim()) missing.push("media_title_required");
    if (!YOUTUBE_CATEGORY_IDS.includes(draft.categoryId ?? ""))
      missing.push("youtube_category_required");
  }
  if (service === "pinterest" && !draft.boardId) missing.push("pinterest_board_required");
  return missing;
}

/** Platform metadata is code-owned; the model cannot insert arbitrary vendor mutation fields. */
export function bufferCreateArguments(
  draft: BufferDraft,
  service: string,
): Record<string, unknown> {
  const missing = bufferDraftRequirements(draft, service);
  if (missing.includes("media_required")) throw new Error("BUFFER_MEDIA_REQUIRED");
  if (service === "youtube" && missing.length) throw new Error("BUFFER_YOUTUBE_DETAILS_REQUIRED");
  if (missing.includes("pinterest_board_required"))
    throw new Error("BUFFER_PINTEREST_BOARD_REQUIRED");
  const disclosure =
    draft.isAiGenerated === undefined ? {} : { isAiGenerated: draft.isAiGenerated };
  return {
    channelId: draft.channelId,
    text: draft.text,
    schedulingType: "automatic",
    mode: draft.mode,
    ...(draft.mode === "customScheduled" ? { dueAt: new Date(draft.dueAt!).toISOString() } : {}),
    ...(draft.imageUrl ? { assets: [{ image: { url: draft.imageUrl } }] } : {}),
    ...(draft.videoUrl ? { assets: [{ video: { url: draft.videoUrl } }] } : {}),
    ...(service === "instagram"
      ? {
          metadata: {
            instagram: {
              type: draft.videoUrl ? "reel" : "post",
              shouldShareToFeed: true,
              ...disclosure,
            },
          },
        }
      : {}),
    ...(service === "tiktok"
      ? {
          metadata: {
            tiktok: { ...(draft.mediaTitle ? { title: draft.mediaTitle } : {}), ...disclosure },
          },
        }
      : {}),
    ...(service === "youtube"
      ? {
          metadata: {
            youtube: {
              title: draft.mediaTitle,
              categoryId: draft.categoryId,
              privacy: "public",
              ...disclosure,
            },
          },
        }
      : {}),
    ...(service === "pinterest"
      ? {
          metadata: {
            pinterest: {
              boardServiceId: draft.boardId,
              ...(draft.mediaTitle ? { title: draft.mediaTitle } : {}),
            },
          },
        }
      : {}),
  };
}
