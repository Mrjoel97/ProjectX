export const WEB_BROWSER_QUALITY_VERSION = "web-browser-quality-v1" as const;

export type WebBrowserPageReport = {
  version: typeof WEB_BROWSER_QUALITY_VERSION;
  pageSlug: string | null;
  pathname: string;
  viewportWidth: number;
  documentWidth: number;
  reducedMotion: boolean;
  complete: boolean;
  readyState: string;
  images: { total: number; loaded: number; missingAlt: number };
  headings: { h1: number; empty: number; clipped: number };
  links: { total: number; brokenAnchors: string[]; hrefs: string[] };
  touchTargets: { total: number; tooSmall: number };
  textContrast: { checked: number; failed: number; unknown: number; minimumRatio: number | null };
  motion: { activeAnimations: number; nontrivialDurations: number; smoothScroll: boolean };
};

/** Serialize this whole function into the trusted browser worker's read-only evaluate call.
 * No imports, fetches, DOM writes, timers or external variables. Photographic/transparent
 * backgrounds are deliberately not certified by a computed solid-colour approximation. */
export function inspectRenderedPage(): WebBrowserPageReport {
  const cap = 2000;
  const all = [...document.body.querySelectorAll<HTMLElement>("*")];
  const visible = (element: Element) => {
    const style = getComputedStyle(element),
      rect = element.getBoundingClientRect();
    return (
      style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0
    );
  };
  const nodes = all.slice(0, cap).filter(visible);
  const images = [...document.images].filter(visible);
  const imageRects = images.map((image) => image.getBoundingClientRect());
  const rgb = (value: string): number[] | null => {
    const match =
      /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:\s*[,/]\s*([\d.]+))?\s*\)$/.exec(value);
    if (!match || (match[4] !== undefined && Number(match[4]) !== 1)) return null;
    return [Number(match[1]), Number(match[2]), Number(match[3])];
  };
  const luminance = (color: number[]) =>
    color
      .map((value) => {
        const c = value / 255;
        return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
      })
      .reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index]!, 0);
  let checked = 0,
    failed = 0,
    unknown = 0,
    minimumRatio: number | null = null;
  for (const node of nodes) {
    if (
      ![...node.childNodes].some(
        (child) => child.nodeType === Node.TEXT_NODE && child.textContent?.trim(),
      )
    )
      continue;
    const style = getComputedStyle(node),
      rect = node.getBoundingClientRect(),
      foreground = rgb(style.color);
    let background: number[] | null = null,
      uncertain = false;
    // An image behind/over this text needs screenshot-aware contrast review, even with a scrim.
    if (
      imageRects.some(
        (image) =>
          rect.left < image.right &&
          rect.right > image.left &&
          rect.top < image.bottom &&
          rect.bottom > image.top,
      )
    )
      uncertain = true;
    for (let ancestor: Element | null = node; ancestor; ancestor = ancestor.parentElement) {
      const ancestorStyle = getComputedStyle(ancestor);
      if (
        ancestorStyle.backgroundImage !== "none" ||
        Number(ancestorStyle.opacity) < 1 ||
        ancestorStyle.filter !== "none" ||
        ancestorStyle.mixBlendMode !== "normal"
      )
        uncertain = true;
      for (const pseudo of ["::before", "::after"]) {
        const pseudoStyle = getComputedStyle(ancestor, pseudo);
        if (
          pseudoStyle.content !== "none" &&
          pseudoStyle.content !== "normal" &&
          (pseudoStyle.backgroundImage !== "none" ||
            pseudoStyle.backgroundColor !== "rgba(0, 0, 0, 0)")
        )
          uncertain = true;
      }
      const color = rgb(ancestorStyle.backgroundColor);
      if (
        !color &&
        ancestorStyle.backgroundColor !== "rgba(0, 0, 0, 0)" &&
        ancestorStyle.backgroundColor !== "transparent"
      )
        uncertain = true;
      if (!background && color) background = color;
    }
    if (!foreground || !background || uncertain) {
      unknown += 1;
      continue;
    }
    const light = luminance(foreground),
      dark = luminance(background);
    const ratio = (Math.max(light, dark) + 0.05) / (Math.min(light, dark) + 0.05);
    checked += 1;
    minimumRatio = minimumRatio === null ? ratio : Math.min(minimumRatio, ratio);
    const size = Number.parseFloat(style.fontSize),
      bold = Number.parseInt(style.fontWeight, 10) >= 700;
    if (ratio < (size >= 24 || (bold && size >= 18.66) ? 3 : 4.5)) failed += 1;
  }
  const anchors = [...document.querySelectorAll<HTMLAnchorElement>("a[href]")].filter(visible);
  const brokenAnchors = anchors.flatMap((anchor) => {
    const url = new URL(anchor.href, location.href);
    if (url.origin !== location.origin || url.pathname !== location.pathname || !url.hash)
      return [];
    try {
      return document.getElementById(decodeURIComponent(url.hash.slice(1))) ? [] : [url.hash];
    } catch {
      return [url.hash];
    }
  });
  const headings = nodes.filter((node) => /^H[1-6]$/.test(node.tagName));
  const targets = nodes.filter((node) =>
    node.matches("a[href],button,input:not([type=hidden]),select,textarea,summary,[role=button]"),
  );
  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const seconds = (value: string) =>
    value
      .split(",")
      .map((part) => Number.parseFloat(part) * (part.trim().endsWith("ms") ? 0.001 : 1));
  return {
    version: "web-browser-quality-v1",
    pageSlug: document.querySelector<HTMLElement>("main[data-page]")?.dataset.page ?? null,
    pathname: location.pathname,
    viewportWidth: innerWidth,
    documentWidth: document.documentElement.scrollWidth,
    reducedMotion,
    complete: all.length <= cap,
    readyState: document.readyState,
    images: {
      total: images.length,
      loaded: images.filter((image) => image.complete && image.naturalWidth > 0).length,
      missingAlt: images.filter((image) => !image.hasAttribute("alt")).length,
    },
    headings: {
      h1: headings.filter((node) => node.tagName === "H1").length,
      empty: headings.filter((node) => !node.textContent?.trim()).length,
      clipped: headings.filter((node) => {
        const style = getComputedStyle(node);
        return (
          (style.overflowX === "hidden" && node.scrollWidth > node.clientWidth + 1) ||
          (style.overflowY === "hidden" && node.scrollHeight > node.clientHeight + 1)
        );
      }).length,
    },
    links: {
      total: anchors.length,
      brokenAnchors,
      hrefs: anchors.map((anchor) => anchor.getAttribute("href") ?? ""),
    },
    touchTargets: {
      total: targets.length,
      tooSmall: targets.filter((node) => {
        // A checkbox's wrapping label is its effective clickable target.
        const rect = (
          node.matches('input[type="checkbox"],input[type="radio"]')
            ? (node.closest("label") ?? node)
            : node
        ).getBoundingClientRect();
        return rect.width < 44 || rect.height < 44;
      }).length,
    },
    textContrast: { checked, failed, unknown, minimumRatio },
    motion: {
      activeAnimations: document
        .getAnimations()
        .filter((animation) => animation.playState === "running").length,
      nontrivialDurations: nodes.filter((node) => {
        const style = getComputedStyle(node);
        return [...seconds(style.animationDuration), ...seconds(style.transitionDuration)].some(
          (duration) => duration > 0.01,
        );
      }).length,
      smoothScroll:
        getComputedStyle(document.documentElement).scrollBehavior === "smooth" ||
        nodes.some((node) => getComputedStyle(node).scrollBehavior === "smooth"),
    },
  };
}

export type WebBrowserQualityIssue = {
  pageSlug?: string;
  viewport?: string;
  code: string;
  severity: "fail" | "needs_review";
};

export function assessWebBrowserQuality(input: {
  pageSlugs: readonly string[];
  reports: readonly WebBrowserPageReport[];
}) {
  const issues: WebBrowserQualityIssue[] = [];
  const add = (
    code: string,
    severity: "fail" | "needs_review",
    pageSlug?: string,
    viewport?: string,
  ) =>
    issues.push({
      code,
      severity,
      ...(pageSlug ? { pageSlug } : {}),
      ...(viewport ? { viewport } : {}),
    });
  if (!input.pageSlugs.length || new Set(input.pageSlugs).size !== input.pageSlugs.length)
    add("invalid_page_inventory", "fail");
  for (const report of input.reports) {
    if (
      !report ||
      report.version !== WEB_BROWSER_QUALITY_VERSION ||
      !report.pageSlug ||
      !input.pageSlugs.includes(report.pageSlug)
    )
      add("unexpected_report", "fail");
    else if (
      !(
        (report.viewportWidth === 1440 && report.reducedMotion === false) ||
        (report.viewportWidth === 390 && typeof report.reducedMotion === "boolean")
      )
    )
      add("unexpected_viewport", "fail", report.pageSlug);
  }
  for (const pageSlug of input.pageSlugs) {
    for (const mode of [
      { width: 1440, reduced: false },
      { width: 390, reduced: false },
      { width: 390, reduced: true },
    ]) {
      const viewport = `${mode.width}:${mode.reduced ? "reduced" : "normal"}`;
      const matches = input.reports.filter(
        (report) =>
          report?.pageSlug === pageSlug &&
          report.viewportWidth === mode.width &&
          report.reducedMotion === mode.reduced,
      );
      if (matches.length !== 1) {
        add(matches.length ? "duplicate_report" : "missing_report", "fail", pageSlug, viewport);
        continue;
      }
      const report = matches[0]!;
      if (!validMeasurements(report)) {
        add("invalid_measurements", "fail", pageSlug, viewport);
        continue;
      }
      if (!report.complete || report.readyState !== "complete")
        add("incomplete_inspection", "fail", pageSlug, viewport);
      if (report.documentWidth > report.viewportWidth + 1)
        add("horizontal_overflow", "fail", pageSlug, viewport);
      if (report.images.loaded !== report.images.total)
        add("image_not_loaded", "fail", pageSlug, viewport);
      if (report.images.missingAlt) add("image_alt_missing", "fail", pageSlug, viewport);
      if (report.headings.h1 !== 1 || report.headings.empty || report.headings.clipped)
        add("heading_layout", "fail", pageSlug, viewport);
      if (report.links.brokenAnchors.length) add("broken_anchor", "fail", pageSlug, viewport);
      if (report.touchTargets.tooSmall) add("small_touch_targets", "fail", pageSlug, viewport);
      if (report.textContrast.failed) add("text_contrast", "fail", pageSlug, viewport);
      if (report.textContrast.unknown || report.textContrast.checked === 0)
        add("contrast_needs_visual_review", "needs_review", pageSlug, viewport);
      if (
        mode.reduced &&
        (report.motion.activeAnimations ||
          report.motion.nontrivialDurations ||
          report.motion.smoothScroll)
      )
        add("reduced_motion_not_respected", "fail", pageSlug, viewport);
    }
  }
  return {
    version: WEB_BROWSER_QUALITY_VERSION,
    status: issues.some((issue) => issue.severity === "fail")
      ? ("fail" as const)
      : issues.length
        ? ("needs_review" as const)
        : ("pass" as const),
    issues,
  };
}

function validMeasurements(report: WebBrowserPageReport): boolean {
  const count = (value: unknown) =>
    typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
  if (
    !report.images ||
    !report.headings ||
    !report.links ||
    !report.touchTargets ||
    !report.textContrast ||
    !report.motion
  )
    return false;
  return (
    [
      report.documentWidth,
      report.viewportWidth,
      ...Object.values(report.images),
      ...Object.values(report.headings),
      report.links.total,
      ...Object.values(report.touchTargets),
      report.textContrast.checked,
      report.textContrast.failed,
      report.textContrast.unknown,
      report.motion.activeAnimations,
      report.motion.nontrivialDurations,
    ].every(count) &&
    report.images.loaded <= report.images.total &&
    report.images.missingAlt <= report.images.total &&
    report.touchTargets.tooSmall <= report.touchTargets.total &&
    report.textContrast.failed <= report.textContrast.checked &&
    typeof report.complete === "boolean" &&
    typeof report.motion.smoothScroll === "boolean" &&
    typeof report.pathname === "string" &&
    Array.isArray(report.links.brokenAnchors) &&
    report.links.brokenAnchors.every((value) => typeof value === "string") &&
    Array.isArray(report.links.hrefs) &&
    report.links.hrefs.every((value) => typeof value === "string") &&
    report.links.hrefs.length === report.links.total &&
    (report.textContrast.checked === 0
      ? report.textContrast.minimumRatio === null
      : report.textContrast.minimumRatio !== null &&
        Number.isFinite(report.textContrast.minimumRatio) &&
        report.textContrast.minimumRatio >= 1 &&
        report.textContrast.minimumRatio <= 21)
  );
}
