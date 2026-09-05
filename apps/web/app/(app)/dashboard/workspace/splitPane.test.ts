// Phase 25.2 items 8-9 (G15): one pane at a time on a phone, and a labelled four-item bar.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { NARROW_QUERY, paneLayout } from "./SplitPane";

const here = dirname(fileURLToPath(import.meta.url));
const splitPane = readFileSync(join(here, "SplitPane.tsx"), "utf8");
const layout = readFileSync(join(here, "..", "..", "layout.tsx"), "utf8");
const css = readFileSync(join(here, "..", "..", "..", "globals.css"), "utf8");

describe("paneLayout — the truth table", () => {
  test("desktop keeps the persisted split and both panes, whatever the toggle says", () => {
    expect(paneLayout(false, false, 30)).toEqual({
      showLeft: true,
      showRight: true,
      columns: "30% 6px 1fr",
    });
    expect(paneLayout(false, true, 42)).toEqual({
      showLeft: true,
      showRight: true,
      columns: "42% 6px 1fr",
    });
  });
  test("narrow shows exactly one pane: chat by default, work on toggle", () => {
    expect(paneLayout(true, false, 30)).toEqual({
      showLeft: true,
      showRight: false,
      columns: "1fr",
    });
    expect(paneLayout(true, true, 30)).toEqual({
      showLeft: false,
      showRight: true,
      columns: "1fr",
    });
  });
});

describe("SplitPane wires the helper to a live media query and a visible toggle", () => {
  test("the query is the 48rem breakpoint the stylesheet uses, tracked with a change listener", () => {
    expect(NARROW_QUERY).toBe("(max-width: 48rem)");
    expect(splitPane).toContain("window.matchMedia(NARROW_QUERY)");
    expect(splitPane).toContain('mq.addEventListener("change", sync)');
  });
  test("the toggle names both directions and both panes stay mounted (hidden, not unmounted)", () => {
    expect(splitPane).toContain('"Back to chat" : "Show work"');
    expect(splitPane).toContain("aria-pressed={showWork}");
    expect(splitPane).toContain("hidden={!layout.showLeft}");
    expect(splitPane).toContain("hidden={!layout.showRight}");
    expect(splitPane).toContain("hidden={narrow}"); // the drag handle
  });
});

describe("the compact bar has exactly four tabs, all drawn from NAV", () => {
  test("TABBAR_HREFS is four hrefs and every one is a NAV entry", () => {
    const m = layout.match(/const TABBAR_HREFS = \[([^\]]+)\];/);
    expect(m).not.toBeNull();
    const hrefs = [...(m?.[1] ?? "").matchAll(/"([^"]+)"/g)].map((x) => x[1]);
    expect(hrefs).toHaveLength(4);
    for (const h of hrefs) expect(layout, h).toContain(`href: "${h}"`);
    expect(layout).toContain('<nav className="tabbar" aria-label="Primary (compact)">');
    expect(layout).toContain('aria-current={isActive(item.href) ? "page" : undefined}');
  });
  test("the stylesheet hides the bar on desktop and swaps it for the rail below 48rem", () => {
    const base = css.slice(css.indexOf(".tabbar {"), css.indexOf("}", css.indexOf(".tabbar {")));
    expect(base).toContain("display: none");
    const mobile = css.slice(
      css.indexOf("@media (max-width: 48rem) {\n  /* 25.2"),
      css.indexOf("\n}\n", css.indexOf("@media (max-width: 48rem) {\n  /* 25.2")),
    );
    expect(mobile).toMatch(/\.rail \{\s*display: none;/);
    expect(mobile).toMatch(/\.tabbar \{\s*display: flex;/);
    expect(css).not.toContain("rail-soon");
  });
});
