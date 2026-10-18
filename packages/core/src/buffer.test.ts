import { describe, expect, test } from "vitest";
import {
  bufferCreateArguments,
  normalizeBufferChannels,
  normalizeBufferMetrics,
  unpackBufferTool,
  validateBufferDraft,
} from "./buffer";

const id = "1234567890abcdef12345678";
const draft = { channelId: id, text: "A real campaign draft", mode: "addToQueue" as const };

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
});
