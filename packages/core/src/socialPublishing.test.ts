import { expect, test } from "vitest";
import {
  mp4Duration,
  requestedSocialScopes,
  socialUploadTarget,
  validateSocialDraft,
  validateSocialMedia,
} from "./socialPublishing";

test("permission upgrades are explicit and X remains deferred", () => {
  expect(requestedSocialScopes("tiktok")).toEqual(["user.info.basic"]);
  expect(requestedSocialScopes("tiktok", "read")).toEqual(["user.info.basic", "video.list"]);
  expect(requestedSocialScopes("youtube", "publish")).toContain(
    "https://www.googleapis.com/auth/youtube.upload",
  );
  expect(() => requestedSocialScopes("x", "publish")).toThrow("SOCIAL_X_DEFERRED");
});
test("publishing metadata cannot silently pick audience, AI or commercial disclosures", () => {
  expect(() =>
    validateSocialDraft({ assetId: "a", text: "hello", storageId: "s" }, "youtube"),
  ).toThrow();
  expect(() =>
    validateSocialDraft(
      {
        assetId: "a",
        text: "hello",
        storageId: "s",
        privacy: "SELF_ONLY",
        aiGenerated: false,
        ownBrand: false,
        paidPartnership: true,
        allowComments: false,
        allowDuet: false,
        allowStitch: false,
      },
      "tiktok",
    ),
  ).toThrow("SOCIAL_TIKTOK_BRAND_PRIVACY");
  expect(() => validateSocialMedia("instagram", 10, "video/mp4")).toThrow();
  expect(() => validateSocialMedia("youtube", 21 * 1024 * 1024, "video/mp4")).toThrow();
  expect(() =>
    socialUploadTarget(
      "youtube",
      "https://www.googleapis.com.attacker.test/upload/youtube/v3/videos",
    ),
  ).toThrow();
});
test("MP4 duration uses bounded movie metadata and rejects malformed headers", () => {
  const b = new Uint8Array(40),
    d = new DataView(b.buffer);
  d.setUint32(0, 40);
  b.set([109, 111, 111, 118], 4);
  d.setUint32(8, 32);
  b.set([109, 118, 104, 100], 12);
  d.setUint32(28, 1000);
  d.setUint32(32, 2000);
  expect(mp4Duration(b)).toBe(2);
  d.setUint32(8, 400);
  expect(() => mp4Duration(b)).toThrow("SOCIAL_MP4_INVALID");
  expect(() => mp4Duration(new Uint8Array(2))).toThrow();
});

test("Meta customers can enable each publishing capability independently", () => {
  expect(requestedSocialScopes("meta", "publish_facebook")).toContain("pages_manage_posts");
  expect(requestedSocialScopes("meta", "publish_facebook")).not.toContain(
    "instagram_content_publish",
  );
  expect(requestedSocialScopes("meta", "publish_instagram")).toContain("instagram_content_publish");
  expect(requestedSocialScopes("meta", "publish_instagram")).not.toContain("pages_manage_posts");
  expect(() => requestedSocialScopes("tiktok", "publish_instagram")).toThrow(
    "SOCIAL_INVALID_INTENT",
  );
});
