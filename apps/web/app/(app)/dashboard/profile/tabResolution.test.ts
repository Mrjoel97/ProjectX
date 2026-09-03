import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { resolveProfileTabs } from "./page";

const read = (relative: string) =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");

/**
 * Comments stripped. The "must not contain" assertions below are about what the page DOES, and
 * these files explain at length why they no longer read the URL the old way — prose naming the
 * banned API would otherwise fail the very check that documents it.
 */
const codeOnly = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

// The navigation consolidation put Compliance under /dashboard/approvals and Settings under
// /dashboard/profile, both addressed by `?tab=`. That turned a query param into a NAVIGATION
// TARGET, and the bug that followed is the reason this file exists: the pages read `?tab=` once on
// mount, and the App Router serves a same-route `<Link>` as a soft navigation that does not remount
// the page — so the URL changed and the panel did not. Every assertion below guards one half of the
// fix: the derivation is pure (so it cannot go stale), and the pages must keep deriving it.

describe("profile tab resolution", () => {
  const resolve = (query: string) => resolveProfileTabs(new URLSearchParams(query));

  test("an empty query lands on the Business Profile tab's first section", () => {
    expect(resolve("")).toEqual({ tab: "profile", profileTab: "shape" });
  });

  test("the three top-level tabs resolve to themselves", () => {
    expect(resolve("tab=profile").tab).toBe("profile");
    expect(resolve("tab=connections").tab).toBe("connections");
    expect(resolve("tab=settings").tab).toBe("settings");
  });

  // The rail links straight at these two. If they ever stopped resolving, the rail would silently
  // land on the default tab and the entry would look dead — the original defect, one level up.
  test("the rail's own destinations resolve to the tab the rail names", () => {
    expect(resolve("tab=settings")).toEqual({ tab: "settings", profileTab: "shape" });
    expect(resolve("tab=connections")).toEqual({ tab: "connections", profileTab: "shape" });
  });

  // BACK-COMPAT: these three were top-level tab ids before the consolidation.
  test("a legacy deep link opens Business Profile at the section it used to name", () => {
    expect(resolve("tab=shape")).toEqual({ tab: "profile", profileTab: "shape" });
    expect(resolve("tab=business")).toEqual({ tab: "profile", profileTab: "business" });
    expect(resolve("tab=blueprint")).toEqual({ tab: "profile", profileTab: "blueprint" });
  });

  test("the current form addresses a section explicitly", () => {
    expect(resolve("tab=profile&section=blueprint")).toEqual({
      tab: "profile",
      profileTab: "blueprint",
    });
  });

  // A legacy `?tab=` is the whole address, so it must not be overridden by a stray `?section=`
  // carried along by the params-preserving tab writer.
  test("a legacy tab id wins over a section that disagrees with it", () => {
    expect(resolve("tab=business&section=blueprint")).toEqual({
      tab: "profile",
      profileTab: "business",
    });
  });

  test("unknown values fall back instead of rendering nothing", () => {
    expect(resolve("tab=nope")).toEqual({ tab: "profile", profileTab: "shape" });
    expect(resolve("tab=profile&section=nope")).toEqual({ tab: "profile", profileTab: "shape" });
  });
});

describe("the tab pages derive their tab from the URL, never from a mount-time snapshot", () => {
  // This is a source check on purpose: the defect was not a wrong VALUE, it was a wrong SOURCE of
  // truth, and the only durable evidence of that is which API the page reads. Both files are
  // asserted together because the rail now points a same-route `<Link>` at each of them.
  const pages = {
    "approvals/page.tsx": read("../approvals/page.tsx"),
    "profile/page.tsx": read("./page.tsx"),
  };

  for (const [name, source] of Object.entries(pages)) {
    test(`${name} reads useSearchParams and writes through the router`, () => {
      const code = codeOnly(source);
      expect(code).toContain("useSearchParams()");
      expect(code).toContain("router.replace(");
      // The one-shot location read is the repo idiom for redirect-only values (voice, workspace,
      // BillingPanel's `?checkout=`). It is WRONG for a navigable tab, which is what these two are.
      expect(code).not.toContain("window.location.search");
      // A manual history write does not re-run `useSearchParams`, so it would desync the panel
      // from the URL — the exact original bug, reintroduced from the other side.
      expect(code).not.toContain("window.history.replaceState");
    });

    test(`${name} keeps the Suspense boundary useSearchParams requires`, () => {
      expect(source).toContain("<Suspense");
    });
  }
});

describe("the rail reaches the consolidated surfaces", () => {
  const shell = read("../../layout.tsx");

  // Compliance lives in the NAV array (object syntax); Settings is a JSX attribute in the rail
  // foot. Both forms are asserted as written so this fails if either entry is edited back.
  test("Compliance and Settings point at tabs, not at their old standalone routes", () => {
    expect(shell).toContain('href: "/dashboard/approvals?tab=compliance"');
    expect(shell).toContain('href="/dashboard/profile?tab=settings"');
    expect(shell).not.toContain('{ label: "Compliance", href: "/ops"');
  });

  // The <a> was a workaround for the mount-time snapshot: a full document load forced a remount.
  // With the pages deriving from the URL it is no longer needed, and leaving it would mean a full
  // page reload on every Connections click for no reason.
  test("no rail entry falls back to a full document load to force a remount", () => {
    expect(shell).not.toContain('<a\n            href="/dashboard/profile');
  });
});
