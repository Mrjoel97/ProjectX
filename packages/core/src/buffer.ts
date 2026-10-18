/** Buffer MCP contracts. No credentials, framework calls or provider prose in errors. */
export const BUFFER_MCP_URL = "https://mcp.buffer.com/mcp";
export const BUFFER_AUTH_URL = "https://auth.buffer.com/auth";
export const BUFFER_TOKEN_URL = "https://auth.buffer.com/token";
export const BUFFER_REGISTER_URL = "https://auth.buffer.com/reg";
export const BUFFER_SCOPES = [
  "account:read",
  "posts:read",
  "posts:write",
  "insights:read",
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
  boards?: { id: string; name: string }[];
};
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

/** Platform metadata is code-owned; the model cannot insert arbitrary vendor mutation fields. */
export function bufferCreateArguments(
  draft: BufferDraft,
  service: string,
): Record<string, unknown> {
  if (["instagram", "tiktok", "pinterest"].includes(service) && !draft.imageUrl && !draft.videoUrl)
    throw new Error("BUFFER_MEDIA_REQUIRED");
  if (
    service === "youtube" &&
    (!draft.videoUrl ||
      !draft.mediaTitle ||
      ![
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
      ].includes(draft.categoryId ?? ""))
  )
    throw new Error("BUFFER_YOUTUBE_DETAILS_REQUIRED");
  if (service === "pinterest" && !draft.boardId) throw new Error("BUFFER_PINTEREST_BOARD_REQUIRED");
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
