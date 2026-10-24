import { SOCIAL_SCOPES, type SocialProvider, socialString } from "./social";

export type SocialIntent =
  | "identity"
  | "read"
  | "publish"
  | "publish_facebook"
  | "publish_instagram";
export type SocialAsset = {
  id: string;
  name: string;
  kind: "facebook_page" | "instagram" | "youtube" | "tiktok";
};
export function requestedSocialScopes(
  provider: SocialProvider,
  intent: SocialIntent = "identity",
): string[] {
  if ((intent === "publish_facebook" || intent === "publish_instagram") && provider !== "meta")
    throw new Error("SOCIAL_INVALID_INTENT");
  if (provider === "x" && intent !== "identity") throw new Error("SOCIAL_X_DEFERRED");
  return [
    ...SOCIAL_SCOPES[provider],
    ...(provider === "tiktok" && intent !== "identity" ? ["video.list"] : []),
    ...(provider === "tiktok" && intent === "publish" ? ["video.publish"] : []),
    ...(provider === "youtube" && intent === "publish"
      ? ["https://www.googleapis.com/auth/youtube.upload"]
      : []),
    ...(provider === "meta" && (intent === "publish" || intent === "publish_facebook")
      ? ["pages_manage_posts"]
      : []),
    ...(provider === "meta" && (intent === "publish" || intent === "publish_instagram")
      ? ["instagram_content_publish"]
      : []),
  ];
}
export function assertSocialScopes(scopes: readonly string[], required: readonly string[]) {
  if (!required.every((s) => scopes.includes(s))) throw new Error("SOCIAL_PERMISSION_REQUIRED");
}
export function socialAsset(value: SocialAsset): SocialAsset {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(value.id)) throw new Error("SOCIAL_INVALID_ASSET");
  return { id: value.id, name: socialString(value.name, 200), kind: value.kind };
}
export type SocialDraft = {
  assetId: string;
  text: string;
  title?: string;
  storageId?: string;
  privacy?: string;
  madeForKids?: boolean;
  aiGenerated?: boolean;
  ownBrand?: boolean;
  paidPartnership?: boolean;
  allowComments?: boolean;
  allowDuet?: boolean;
  allowStitch?: boolean;
};
export function validateSocialDraft(d: SocialDraft, kind: SocialAsset["kind"]) {
  if (!d.text.trim() || d.text.length > (kind === "tiktok" || kind === "instagram" ? 2200 : 5000))
    throw new Error("SOCIAL_INVALID_DRAFT");
  if (kind !== "facebook_page" && !d.storageId) throw new Error("SOCIAL_MEDIA_REQUIRED");
  if (kind === "facebook_page" && d.storageId) throw new Error("SOCIAL_FACEBOOK_TEXT_ONLY");
  if (
    kind === "youtube" &&
    (!d.title?.trim() ||
      d.title.length > 100 ||
      !["private", "unlisted", "public"].includes(d.privacy ?? "") ||
      typeof d.madeForKids !== "boolean" ||
      typeof d.aiGenerated !== "boolean")
  )
    throw new Error("SOCIAL_YOUTUBE_METADATA_REQUIRED");
  if (
    kind === "tiktok" &&
    (!d.privacy ||
      [
        d.aiGenerated,
        d.ownBrand,
        d.paidPartnership,
        d.allowComments,
        d.allowDuet,
        d.allowStitch,
      ].some((v) => typeof v !== "boolean"))
  )
    throw new Error("SOCIAL_TIKTOK_CHOICES_REQUIRED");
  if (kind === "tiktok" && d.paidPartnership && d.privacy === "SELF_ONLY")
    throw new Error("SOCIAL_TIKTOK_BRAND_PRIVACY");
}
export function publishingScopes(kind: SocialAsset["kind"]) {
  return kind === "facebook_page"
    ? ["pages_manage_posts"]
    : kind === "instagram"
      ? ["instagram_basic", "instagram_content_publish"]
      : kind === "youtube"
        ? ["https://www.googleapis.com/auth/youtube.upload"]
        : ["video.publish"];
}
export const SOCIAL_MEDIA_LIMIT = 20 * 1024 * 1024;
export function validateSocialMedia(kind: SocialAsset["kind"], size: number, mimeType?: string) {
  if (
    !Number.isFinite(size) ||
    size <= 0 ||
    size > SOCIAL_MEDIA_LIMIT ||
    (kind === "instagram"
      ? mimeType !== "image/jpeg" || size > 8 * 1024 * 1024
      : mimeType !== "video/mp4")
  )
    throw new Error("SOCIAL_MEDIA_FORMAT_OR_SIZE");
}
export function socialUploadTarget(provider: "youtube" | "tiktok", value: string): string {
  const u = new URL(value);
  if (
    u.protocol !== "https:" ||
    u.username ||
    u.password ||
    (provider === "youtube"
      ? u.hostname !== "www.googleapis.com" || u.pathname !== "/upload/youtube/v3/videos"
      : u.hostname !== "open-upload.tiktokapis.com" ||
        !["/video/", "/upload/"].includes(u.pathname))
  )
    throw new Error("SOCIAL_INVALID_UPLOAD_TARGET");
  return u.toString();
}
export function safeSocialLink(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length > 2048) return undefined;
  try {
    const u = new URL(value);
    return u.protocol === "https:" && !u.username && !u.password ? u.toString() : undefined;
  } catch {
    return undefined;
  }
}

/** Read the MP4 movie header without trusting a filename or a client duration claim. */
export function mp4Duration(bytes: Uint8Array): number {
  const d = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  function scan(
    start: number,
    end: number,
    find: string,
  ): { start: number; end: number } | undefined {
    for (let i = start, count = 0; i + 8 <= end && count < 10000; count++) {
      let size = d.getUint32(i),
        header = 8;
      const type = String.fromCharCode(...bytes.subarray(i + 4, i + 8));
      if (size === 1) {
        if (i + 16 > end) throw Error("SOCIAL_MP4_INVALID");
        const big = d.getBigUint64(i + 8);
        if (big > BigInt(Number.MAX_SAFE_INTEGER)) throw Error("SOCIAL_MP4_INVALID");
        size = Number(big);
        header = 16;
      }
      if (size === 0) size = end - i;
      if (size < header || i + size > end) throw Error("SOCIAL_MP4_INVALID");
      if (type === find) return { start: i + header, end: i + size };
      i += size;
    }
  }
  const moov = scan(0, bytes.length, "moov");
  if (!moov) throw Error("SOCIAL_MP4_INVALID");
  const mvhd = scan(moov.start, moov.end, "mvhd");
  if (!mvhd) throw Error("SOCIAL_MP4_INVALID");
  const v = bytes[mvhd.start],
    offset = mvhd.start + (v === 1 ? 20 : 12);
  if ((v !== 0 && v !== 1) || offset + (v === 1 ? 12 : 8) > mvhd.end)
    throw Error("SOCIAL_MP4_INVALID");
  const scale = d.getUint32(offset),
    ticks = v === 1 ? Number(d.getBigUint64(offset + 4)) : d.getUint32(offset + 4);
  const seconds = ticks / scale;
  if (!scale || !Number.isFinite(seconds) || seconds <= 0) throw Error("SOCIAL_MP4_INVALID");
  return seconds;
}
