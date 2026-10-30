import { describe, expect, test } from "vitest";
import { assessWebBrowserQuality, type WebBrowserPageReport } from "./webBrowserQuality";

function report(
  pageSlug: string,
  viewportWidth: number,
  reducedMotion = false,
): WebBrowserPageReport {
  return {
    version: "web-browser-quality-v1",
    pageSlug,
    pathname: `/p/studio/${pageSlug}`,
    viewportWidth,
    documentWidth: viewportWidth,
    reducedMotion,
    complete: true,
    readyState: "complete",
    images: { total: 2, loaded: 2, missingAlt: 0 },
    headings: { h1: 1, empty: 0, clipped: 0 },
    links: { total: 1, brokenAnchors: [], hrefs: ["#main-content"] },
    touchTargets: { total: 2, tooSmall: 0 },
    textContrast: { checked: 3, failed: 0, unknown: 0, minimumRatio: 7 },
    motion: {
      activeAnimations: 0,
      nontrivialDurations: reducedMotion ? 0 : 4,
      smoothScroll: !reducedMotion,
    },
  };
}
function reports() {
  return ["home", "about"].flatMap((slug) => [
    report(slug, 1440),
    report(slug, 390),
    report(slug, 390, true),
  ]);
}
describe("browser quality evidence", () => {
  test("requires desktop, mobile and genuinely reduced-motion reports for every page", () => {
    expect(
      assessWebBrowserQuality({ pageSlugs: ["home", "about"], reports: reports() }).status,
    ).toBe("pass");
    for (let index = 0; index < 6; index += 1) {
      expect(
        assessWebBrowserQuality({
          pageSlugs: ["home", "about"],
          reports: reports().filter((_, i) => i !== index),
        }).issues.some((issue) => issue.code === "missing_report"),
      ).toBe(true);
    }
  });
  test("unknown photographic contrast remains needs_review and cannot become a pass", () => {
    const values = reports();
    values[0]!.textContrast.unknown = 2;
    const result = assessWebBrowserQuality({ pageSlugs: ["home", "about"], reports: values });
    expect(result.status).toBe("needs_review");
    expect(result.issues[0]?.code).toBe("contrast_needs_visual_review");
  });
  test("catches overflow, clipped headings, unloaded imagery, bad anchors, contrast and small controls", () => {
    const values = reports(),
      first = values[0]!;
    first.documentWidth += 25;
    first.headings.clipped = 1;
    first.images.loaded = 1;
    first.links.brokenAnchors.push("#missing");
    first.touchTargets.tooSmall = 1;
    first.textContrast.failed = 1;
    const result = assessWebBrowserQuality({ pageSlugs: ["home", "about"], reports: values });
    expect(result.status).toBe("fail");
    expect(result.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining([
        "horizontal_overflow",
        "heading_layout",
        "image_not_loaded",
        "broken_anchor",
        "small_touch_targets",
        "text_contrast",
      ]),
    );
  });
  test("reduced-motion evidence fails when animation, transitions or smooth scrolling remain", () => {
    for (const patch of [
      { activeAnimations: 1 },
      { nontrivialDurations: 1 },
      { smoothScroll: true },
    ]) {
      const values = reports();
      Object.assign(values[2]!.motion, patch);
      expect(
        assessWebBrowserQuality({ pageSlugs: ["home", "about"], reports: values }).issues.some(
          (issue) => issue.code === "reduced_motion_not_respected",
        ),
      ).toBe(true);
    }
  });
  test("rejects duplicate, foreign, invalid and incomplete evidence", () => {
    expect(
      assessWebBrowserQuality({
        pageSlugs: ["home", "about"],
        reports: [...reports(), report("home", 1440)],
      }).status,
    ).toBe("fail");
    expect(
      assessWebBrowserQuality({
        pageSlugs: ["home", "about"],
        reports: [...reports(), report("foreign", 1440)],
      }).status,
    ).toBe("fail");
    expect(
      assessWebBrowserQuality({
        pageSlugs: ["home", "about"],
        reports: [...reports(), report("home", 768)],
      }).status,
    ).toBe("fail");
    for (const value of [NaN, Infinity, -1, 0.5]) {
      const values = reports();
      values[0]!.images.loaded = value;
      expect(
        assessWebBrowserQuality({ pageSlugs: ["home", "about"], reports: values }).issues.some(
          (issue) => issue.code === "invalid_measurements",
        ),
      ).toBe(true);
    }
    const values = reports();
    values[0]!.complete = false;
    expect(
      assessWebBrowserQuality({ pageSlugs: ["home", "about"], reports: values }).issues.some(
        (issue) => issue.code === "incomplete_inspection",
      ),
    ).toBe(true);
  });
});
