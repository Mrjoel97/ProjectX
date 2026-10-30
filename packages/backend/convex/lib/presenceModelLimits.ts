/** Closed server-selected purposes keep reservation and actual provider output limits identical. */
export const PRESENCE_VISION_MAX_OUTPUT_TOKENS = 4096;
export const PRESENCE_LAYOUT_MAX_OUTPUT_TOKENS = 8192;
export function presenceModelOutputLimit(purpose?: "vision-review"): number {
  if (purpose !== undefined && purpose !== "vision-review")
    throw Error("PAID_WEBSITE_PURPOSE_INVALID");
  return purpose === "vision-review"
    ? PRESENCE_VISION_MAX_OUTPUT_TOKENS
    : PRESENCE_LAYOUT_MAX_OUTPUT_TOKENS;
}
