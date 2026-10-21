// Pure stock selection; adapters supply duration tolerances from priced configuration.
export type MusicCredit = {
  title: string;
  creator: string;
  license: string;
  licenseUrl: string;
  sourceUrl: string;
  attribution: string;
};

export function pickStockAudio(
  body: Record<string, unknown>,
  seconds: number,
  minDurationSlackSeconds: number,
): { link: string; assetId: string; credit: MusicCredit } | null {
  const results = body.results;
  if (!Array.isArray(results)) throw new Error("shape");
  const floorMs = (seconds - minDurationSlackSeconds) * 1000;
  for (const raw of results) {
    const r = raw as Record<string, unknown>;
    if (typeof r.duration !== "number" || r.duration < floorMs) continue;
    if (typeof r.url !== "string" || !r.url.startsWith("https://")) continue;
    if (typeof r.id !== "string" && typeof r.id !== "number") continue;
    if (typeof r.attribution !== "string" || r.attribution.trim() === "") continue;
    const str = (k: string): string => (typeof r[k] === "string" ? (r[k] as string) : "");
    return {
      link: r.url,
      assetId: String(r.id),
      credit: {
        title: str("title"),
        creator: str("creator"),
        license: `${str("license")} ${str("license_version")}`.trim(),
        licenseUrl: str("license_url"),
        sourceUrl: str("foreign_landing_url"),
        attribution: r.attribution.trim(),
      },
    };
  }
  return null;
}

export function pickStockVideo(
  body: Record<string, unknown>,
  seconds: number,
  minDurationSlackSeconds: number,
): { link: string; assetId: string } | null {
  const videos = body.videos;
  if (!Array.isArray(videos)) throw new Error("shape");
  const floor = seconds - minDurationSlackSeconds;
  for (const raw of videos) {
    if (!raw || typeof raw !== "object") continue;
    const video = raw as { id?: unknown; duration?: unknown; video_files?: unknown };
    if (
      typeof video.duration !== "number" ||
      !Number.isFinite(video.duration) ||
      video.duration <= 0 ||
      video.duration < floor
    )
      continue;
    if (typeof video.id !== "number" && typeof video.id !== "string") continue;
    if (!Array.isArray(video.video_files)) continue;
    const files = video.video_files
      .filter((f): f is Record<string, unknown> => f !== null && typeof f === "object")
      .map((f) => f as { link?: unknown; file_type?: unknown; height?: unknown; width?: unknown })
      .filter(
        (f): f is { link: string; height: number; width: number } =>
          typeof f.link === "string" &&
          /^https:\/\/\S+$/i.test(f.link) &&
          typeof f.height === "number" &&
          typeof f.width === "number" &&
          Number.isFinite(f.height) &&
          f.height > 0 &&
          Number.isFinite(f.width) &&
          f.width > 0 &&
          f.file_type === "video/mp4",
      )
      // Prefer a real portrait with sufficient native detail for the code-owned 720p export.
      // Then preserve the most source detail and closest 9:16 framing. Provider result order
      // remains the relevance ranking; this only chooses a rendition of the same stock video.
      .sort(
        (l, r) =>
          Number(r.height > r.width) - Number(l.height > l.width) ||
          Math.min(1, r.width / 720, r.height / 1280) -
            Math.min(1, l.width / 720, l.height / 1280) ||
          Math.abs(l.width / l.height - 9 / 16) - Math.abs(r.width / r.height - 9 / 16) ||
          Math.abs(l.height - 1280) - Math.abs(r.height - 1280),
      );
    const best = files[0];
    if (best) return { link: best.link, assetId: String(video.id) };
  }
  return null;
}

export function pickStockPhoto(
  body: Record<string, unknown>,
): { link: string; assetId: string } | null {
  const photos = body.photos;
  if (!Array.isArray(photos)) throw new Error("shape");
  for (const raw of photos) {
    const photo = raw as { id?: unknown; src?: Record<string, unknown> };
    if (typeof photo.id !== "number" && typeof photo.id !== "string") continue;
    const src = photo.src ?? {};
    const link = ["large2x", "large", "portrait", "original"]
      .map((k) => src[k])
      .find((u): u is string => typeof u === "string" && u.length > 0);
    if (link) return { link, assetId: String(photo.id) };
  }
  return null;
}
