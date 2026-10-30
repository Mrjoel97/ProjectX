import { createHash } from "node:crypto";
import { expect, test } from "vitest";
import { hasUnsafeWebMarkup, WEB_CAROUSEL_SCRIPT, WEB_CAROUSEL_SCRIPT_POLICY, WEB_CAROUSEL_TAG } from "./webCarouselRuntime";

test("CSP pins the exact immutable runtime bytes", () => {
  expect(WEB_CAROUSEL_SCRIPT_POLICY).toBe(`script-src 'sha256-${createHash("sha256").update(WEB_CAROUSEL_SCRIPT).digest("base64")}'`);
  expect(hasUnsafeWebMarkup(`<html>${WEB_CAROUSEL_TAG}</html>`)).toBe(false);
  for (const script of [WEB_CAROUSEL_TAG.repeat(2), WEB_CAROUSEL_TAG.replace("4200", "4201"), '<script src="/trusted.js"></script>', '<img onerror="bad()">', '<iframe></iframe>', '<meta http-equiv="refresh" content="1">']) {
    expect(hasUnsafeWebMarkup(`<html>${script}</html>`)).toBe(true);
  }
});
