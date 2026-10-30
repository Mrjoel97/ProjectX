/** Deterministic finishing cues; times are relative to the source scene. */
export type MediaFinishing = {
  overlay?: string;
  overlayStartMs?: number;
  overlayEndMs?: number;
  transitionOut?: "cut" | "fade";
  motionGraphic?: "orbit-ring";
};
export function parseMediaFinishing(
  raw: MediaFinishing,
  durationMs: number,
): MediaFinishing | null {
  const { overlay, overlayStartMs, overlayEndMs, transitionOut, motionGraphic } = raw;
  if (motionGraphic !== undefined && motionGraphic !== "orbit-ring") return null;
  if (motionGraphic !== undefined && (!Number.isInteger(durationMs) || durationMs > 15000))
    return null;
  if (transitionOut !== undefined && transitionOut !== "cut" && transitionOut !== "fade")
    return null;
  if (
    overlay !== undefined &&
    (typeof overlay !== "string" ||
      !overlay.trim() ||
      overlay.length > 80 ||
      overlay.trim().split(/\s+/u).length > 12 ||
      overlay
        .trim()
        .split(/\s+/u)
        .some((word) => word.length > 25) ||
      [...overlay].some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127))
  )
    return null;
  if (overlay === undefined && (overlayStartMs !== undefined || overlayEndMs !== undefined))
    return null;
  const start = overlayStartMs ?? 0;
  const end = overlayEndMs ?? durationMs;
  if (
    !Number.isInteger(start) ||
    !Number.isInteger(end) ||
    start < 0 ||
    end > durationMs ||
    end - start < 500
  )
    return null;
  return {
    ...(overlay === undefined ? {} : { overlay, overlayStartMs: start, overlayEndMs: end }),
    ...(transitionOut === undefined ? {} : { transitionOut }),
    ...(motionGraphic === undefined ? {} : { motionGraphic }),
  };
}
