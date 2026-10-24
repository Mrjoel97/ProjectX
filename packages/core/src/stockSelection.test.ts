import { describe, expect, it } from "vitest";
import { pickStockVideo } from "./stockSelection";

const rendition = (name: string, width: number, height: number) => ({
  link: `https://cdn.example/${name}.mp4`,
  width,
  height,
  file_type: "video/mp4",
});
const pick = (files: unknown[], duration = 10) =>
  pickStockVideo({ videos: [{ id: 123, duration, video_files: files }] }, 8, 0.5);

describe("portrait stock rendition quality", () => {
  it("prefers native 720p 9:16 over square, landscape, undersized and narrower portraits", () => {
    expect(
      pick([
        rendition("square", 1280, 1280),
        rendition("landscape", 1920, 1080),
        rendition("tiny", 180, 320),
        rendition("narrow", 400, 1280),
        rendition("target", 720, 1280),
      ])?.link,
    ).toContain("target.mp4");
  });
  it("chooses greater source detail when every portrait would need upscaling", () => {
    expect(pick([rendition("tiny", 180, 320), rendition("larger", 600, 1200)])?.link).toContain(
      "larger.mp4",
    );
  });
  it("avoids an oversized download when target-size and larger renditions have equal detail/framing", () => {
    expect(pick([rendition("large", 2160, 3840), rendition("target", 720, 1280)])?.link).toContain(
      "target.mp4",
    );
  });
  it("keeps provider video relevance order rather than selecting another video's attractive rendition", () => {
    const selected = pickStockVideo(
      {
        videos: [
          { id: 1, duration: 10, video_files: [rendition("relevant", 640, 1136)] },
          { id: 2, duration: 10, video_files: [rendition("other", 720, 1280)] },
        ],
      },
      8,
      0.5,
    );
    expect(selected?.assetId).toBe("1");
  });
  it.each([NaN, Infinity, -1, 0, 6])("rejects invalid or insufficient duration %s", (duration) => {
    expect(pick([rendition("target", 720, 1280)], duration)).toBeNull();
  });
  it("rejects malformed renditions without throwing and falls through to a valid file", () => {
    const selected = pick([
      null,
      rendition("zero", 0, 1280),
      rendition("nan", NaN, 1280),
      rendition("infinite", 720, Infinity),
      { ...rendition("http", 720, 1280), link: "http://cdn.example/file.mp4" },
      rendition("valid", 720, 1280),
    ]);
    expect(selected?.link).toContain("valid.mp4");
  });
});
