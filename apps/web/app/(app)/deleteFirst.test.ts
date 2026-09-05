// Phase 25.2 — the delete-first UX pass, items 1-7 (25.2-RESEARCH.md).
//
// These are SOURCE scans in the approvalsView.test.ts idiom: the JSX under test lives inline in
// components that need live Convex hooks to render, so the falsifiable claim is about the source.
// Each test names the item it pins; deleting the guard is a deliberate act, not drift.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { refusalMessage } from "./dashboard/approvals/ApprovalsView";
import { deliveryStatusLabel } from "./dashboard/workspace/cards";

const here = dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => readFileSync(join(here, rel), "utf8");
const layout = read("layout.tsx");
const chatPane = read("dashboard/workspace/ChatPane.tsx");
const workspacePage = read("dashboard/workspace/page.tsx");
const connectionsPanel = read("dashboard/profile/ConnectionsPanel.tsx");
const segmentAnatomy = read("dashboard/profile/SegmentAnatomy.tsx");
const approvals = read("dashboard/approvals/ApprovalsView.tsx");
const cards = read("dashboard/workspace/cards.tsx");

describe("25.2 item 1 — no 'Soon' placeholder in the rail", () => {
  test("every NAV entry has an href and nothing renders a Soon badge", () => {
    expect(layout).not.toMatch(/soon:\s*true/);
    expect(layout).not.toContain("rail-soon");
    expect(layout).not.toContain("Join Community");
  });
});

describe("25.2 item 2 — Compliance is owner-only in the rail", () => {
  test("the Compliance entry is marked ownerOnly and the rail filters on the owner flag", () => {
    const entry = layout.slice(
      layout.indexOf('label: "Compliance"'),
      layout.indexOf("My Workspace"),
    );
    expect(entry).toMatch(/ownerOnly:\s*true/);
    expect(layout).toMatch(/NAV\.filter\(\(item\) => !item\.ownerOnly \|\| isOwner\)/);
    expect(layout).toContain("useQuery(api.owner.viewer, {})");
  });
});

describe("25.2 item 3 — the delivery report speaks, it does not print an enum", () => {
  test("every status the badge colours has a label without underscores", () => {
    const badgeMap = cards.slice(
      cards.indexOf("function badge("),
      cards.indexOf("return {", cards.indexOf("function badge(")),
    );
    const keys = [...badgeMap.matchAll(/^\s+([a-z_]+):\s*\{ bg/gm)].map((m) => m[1] ?? "");
    expect(keys.length).toBeGreaterThan(3);
    for (const k of keys) {
      expect(deliveryStatusLabel(k), k).not.toBe(k);
      expect(deliveryStatusLabel(k)).not.toMatch(/_/);
    }
  });
  test("an unknown status is still words, and the row renders the label", () => {
    expect(deliveryStatusLabel("some_new_state")).toBe("some new state");
    expect(cards).toContain("{deliveryStatusLabel(r.status)}");
    expect(cards).not.toMatch(/badge\(r\.status\)\}>\{r\.status\}/);
  });
});

describe("25.2 item 4 — approvals copy is for the user, not the operator", () => {
  test("no string says tenant, deployment or scheduler", () => {
    for (const word of ["This tenant", "deployment budget", "scheduler won"]) {
      expect(approvals, word).not.toContain(word);
    }
  });
  test("an unmapped refusal code is shown as words", () => {
    expect(refusalMessage("brand_new_refusal")).toContain("brand new refusal");
    expect(refusalMessage("brand_new_refusal")).not.toContain("brand_new_refusal");
    expect(refusalMessage("gmail_not_connected")).toContain("Gmail is not connected");
  });
});

describe("25.2 item 5 — the Connections page shows nothing it cannot connect", () => {
  test("no 'Not available' rows anywhere on the profile surfaces", () => {
    expect(connectionsPanel).not.toContain("Not available");
    expect(connectionsPanel).not.toContain("BLOCKED");
    expect(segmentAnatomy).not.toContain("Not available");
    expect(segmentAnatomy).not.toContain("BLOCKED");
  });
});

describe("25.2 item 6 — no dead model pill in the composer", () => {
  test("the disabled Auto pill is gone", () => {
    expect(chatPane).not.toContain("Model routing is automatic");
    expect(chatPane).not.toMatch(/>\s*Auto\s*</);
  });
});

describe("25.2 item 7 — skill authoring is an owner entry", () => {
  test("the menu item renders only inside the owner check", () => {
    const at = workspacePage.indexOf("Adapt a business skill");
    expect(at).toBeGreaterThan(-1);
    const before = workspacePage.slice(Math.max(0, at - 600), at);
    expect(before).toContain("viewer?.isOwner === true &&");
  });
});
