import { describe, expect, test } from "vitest";
import {
  bufferCreateArguments,
  bufferDraftRequirements,
  nativeSocialPostReference,
  normalizeBufferChannels,
  normalizeBufferMetrics,
  normalizeBufferPublicationReceipt,
  unpackBufferTool,
  validateBufferDraft,
} from "./buffer";

const id = "1234567890abcdef12345678";
const draft = { channelId: id, text: "A real campaign draft", mode: "addToQueue" as const };

describe("authoritative Buffer publication references", () => {
  const postId = "1234567890abcdef12345679",
    nativeId = "7425678901234567890";
  const approvedAt = Date.parse("2026-10-24T10:00:00Z"),
    sentAt = "2026-10-24T10:01:00Z";
  const expected = {
    bufferPostId: postId,
    channelId: id,
    platform: "tiktok",
    nativeAccountId: "native_account",
    draftRevision: 2,
    approvedAt,
    text: draft.text,
  };
  const response = {
    id: postId,
    channelId: id,
    channelService: "tiktok",
    status: "sent",
    schedulingType: "automatic",
    text: draft.text,
    externalLink: `https://www.tiktok.com/@pikar_ai/video/${nativeId}`,
    sentAt,
    channel: { id, service: "tiktok", serviceId: "native_account" },
  };
  const now = Date.parse("2026-10-24T10:02:00Z");
  test("keeps provider-native IDs distinct and never converts an Instagram shortcode to a media ID", () => {
    expect(nativeSocialPostReference("instagram", "https://instagram.com/reel/Cx_Ab-123/")).toEqual(
      { url: "https://www.instagram.com/reel/Cx_Ab-123/", postId: null },
    );
    expect(normalizeBufferPublicationReceipt(response, expected, now)).toMatchObject({
      source: "buffer-status-v1",
      bufferPostId: postId,
      nativePostId: nativeId,
      nativeAccountId: "native_account",
      draftRevision: 2,
      approvedAt,
      sentAt: Date.parse(sentAt),
      observedAt: now,
    });
    expect(
      normalizeBufferPublicationReceipt(
        {
          ...response,
          channelService: "instagram",
          externalLink: "https://www.instagram.com/p/Cx_Ab-123/",
          channel: { id, service: "instagram", serviceId: "native_account" },
        },
        { ...expected, platform: "instagram" },
        now,
      ),
    ).toMatchObject({
      platform: "instagram",
      nativePostId: null,
      nativePostUrl: "https://www.instagram.com/p/Cx_Ab-123/",
    });
  });
  test("refuses spoofed, credential-bearing, shortened, unsupported and ambiguous post URLs", () => {
    for (const url of [
      "http://www.tiktok.com/@pikar_ai/video/7425678901234567890",
      "https://www.tiktok.com.evil.test/@pikar_ai/video/7425678901234567890",
      "https://evil@www.tiktok.com/@pikar_ai/video/7425678901234567890",
      "https://www.tiktok.com/@pikar_ai/video/7425678901234567890?token=private",
      "https://www.tiktok.com/@pikar_ai/video/7425678901234567890#other",
      "https://vm.tiktok.com/ABCDEF/",
      "https://www.tiktok.com/@pikar_ai/photo/7425678901234567890",
      "https://www.tiktok.com/@pikar_ai/video/12",
    ])
      expect(nativeSocialPostReference("tiktok", url)).toBeNull();
    expect(
      nativeSocialPostReference("instagram", "https://www.instagram.com/stories/pikar/12345/"),
    ).toBeNull();
  });
  test("only records an exact approved API-created post that Buffer automatically sent", () => {
    for (const patch of [
      { id },
      { channelId: postId },
      { status: "scheduled" },
      { schedulingType: "notification" },
      { text: "Changed in Buffer" },
      { channelService: "instagram" },
      { channel: { ...response.channel, serviceId: "other" } },
      { channel: { ...response.channel, id: postId } },
      { sentAt: null },
      { sentAt: "2026-10-24 10:01:00" },
      { sentAt: "2026-10-24T10:03:00Z" },
      { sentAt: "2026-10-24T09:59:00Z" },
    ])
      expect(
        normalizeBufferPublicationReceipt({ ...response, ...patch }, expected, now),
      ).toBeNull();
    expect(
      normalizeBufferPublicationReceipt(response, { ...expected, draftRevision: NaN }, now),
    ).toBeNull();
    expect(
      normalizeBufferPublicationReceipt(response, { ...expected, approvedAt: NaN }, now),
    ).toBeNull();
  });
});

describe("Buffer MCP contracts", () => {
  test("reads JSON separately from the quota block used by the actual MCP server", () => {
    expect(
      unpackBufferTool({
        content: [
          { type: "text", text: JSON.stringify({ organizations: [{ id }] }) },
          { type: "text", text: "Quota: 99 requests remain" },
        ],
      }),
    ).toEqual({ organizations: [{ id }] });
    expect(() =>
      unpackBufferTool({
        isError: true,
        content: [{ type: "text", text: "private provider detail" }],
      }),
    ).toThrow("BUFFER_TOOL_REJECTED");
    expect(() => unpackBufferTool({ content: [{ type: "text", text: "not JSON" }] })).toThrow(
      "BUFFER_INVALID_RESPONSE",
    );
  });
  test("preserves real zero values, excludes unavailable metrics, and refuses corrupt numbers", () => {
    expect(
      normalizeBufferMetrics([{ type: "comments", name: "Comments", value: 0, unit: "count" }]),
    ).toEqual([{ type: "comments", name: "Comments", value: 0, unit: "count" }]);
    for (const value of [NaN, Infinity, -1])
      expect(() => normalizeBufferMetrics([{ type: "views", value, unit: "count" }])).toThrow();
    expect(() =>
      normalizeBufferMetrics([
        { type: "views", value: 1, unit: "count" },
        { type: "views", value: 2, unit: "count" },
      ]),
    ).toThrow();
  });
  test("keeps disconnected and locked channels unavailable and copies named Pinterest boards", () => {
    expect(
      normalizeBufferChannels([
        {
          id,
          name: "Brand",
          service: "pinterest",
          isDisconnected: false,
          isLocked: true,
          metadata: { boards: [{ serviceId: "board1", name: "Products" }] },
        },
      ])[0],
    ).toEqual({
      id,
      name: "Brand",
      service: "pinterest",
      available: false,
      boards: [{ id: "board1", name: "Products" }],
    });
    expect(() => normalizeBufferChannels([{ id, name: "Brand", service: "linkedin" }])).toThrow();
  });
  test("refuses past schedules, empty posts, mixed media and credential-bearing media URLs", () => {
    expect(() => validateBufferDraft(draft, 1000)).not.toThrow();
    expect(() =>
      validateBufferDraft({ ...draft, mode: "customScheduled", dueAt: 2000 }, 1000),
    ).toThrow();
    expect(() => validateBufferDraft({ ...draft, text: " " }, 1000)).toThrow();
    expect(() =>
      validateBufferDraft(
        { ...draft, imageUrl: "https://user:secret@example.com/image.jpg" },
        1000,
      ),
    ).toThrow();
    expect(() =>
      validateBufferDraft(
        { ...draft, imageUrl: "https://example.com/a.jpg", videoUrl: "https://example.com/a.mp4" },
        1000,
      ),
    ).toThrow();
  });
  test("creates the exact scheduling and platform metadata rather than accepting arbitrary mutations", () => {
    expect(bufferCreateArguments(draft, "linkedin")).toEqual({
      channelId: id,
      text: draft.text,
      mode: "addToQueue",
      schedulingType: "automatic",
    });
    expect(() => bufferCreateArguments(draft, "instagram")).toThrow("BUFFER_MEDIA_REQUIRED");
    expect(() => bufferCreateArguments(draft, "youtube")).toThrow(
      "BUFFER_YOUTUBE_DETAILS_REQUIRED",
    );
    expect(
      bufferCreateArguments(
        { ...draft, videoUrl: "https://example.com/reel.mp4", isAiGenerated: true },
        "instagram",
      ).metadata,
    ).toEqual({ instagram: { type: "reel", shouldShareToFeed: true, isAiGenerated: true } });
    expect(
      bufferCreateArguments(
        { ...draft, imageUrl: "https://example.com/pin.jpg", boardId: "board1" },
        "pinterest",
      ).metadata,
    ).toEqual({ pinterest: { boardServiceId: "board1" } });
  });
  test("retains valid incomplete local drafts while listing every required publishing detail", () => {
    expect(() => validateBufferDraft(draft, 1000)).not.toThrow();
    expect(bufferDraftRequirements(draft, "tiktok")).toEqual(["media_required"]);
    expect(bufferDraftRequirements(draft, "instagram")).toEqual(["media_required"]);
    expect(bufferDraftRequirements(draft, "pinterest")).toEqual([
      "media_required",
      "pinterest_board_required",
    ]);
    expect(bufferDraftRequirements(draft, "youtube")).toEqual([
      "video_required",
      "media_title_required",
      "youtube_category_required",
    ]);
    const videoDraft = {
      ...draft,
      videoUrl: "https://example.com/video.mp4",
      mediaTitle: "A reviewed video",
      categoryId: "22",
    };
    expect(bufferDraftRequirements(videoDraft, "youtube")).toEqual([]);
    expect(bufferDraftRequirements(videoDraft, "tiktok")).toEqual([]);
    expect(bufferDraftRequirements({ ...videoDraft, categoryId: "invalid" }, "youtube")).toEqual([
      "youtube_category_required",
    ]);
    expect(() =>
      bufferCreateArguments({ ...videoDraft, categoryId: "invalid" }, "youtube"),
    ).toThrow("BUFFER_YOUTUBE_DETAILS_REQUIRED");
    expect(() => validateBufferDraft({ ...draft, mediaTitle: " " }, 1000)).toThrow(
      "BUFFER_INVALID_MEDIA_TITLE",
    );
    expect(() => validateBufferDraft({ ...draft, text: "x".repeat(10001) }, 1000)).toThrow(
      "BUFFER_INVALID_POST",
    );
  });
});
