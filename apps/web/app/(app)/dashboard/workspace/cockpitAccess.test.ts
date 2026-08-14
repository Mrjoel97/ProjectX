import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { PLAN_REFUSALS } from "./cards";

const here = dirname(fileURLToPath(import.meta.url));
const pageSource = readFileSync(join(here, "page.tsx"), "utf8");
const chatSource = readFileSync(join(here, "ChatPane.tsx"), "utf8");
const dashboardSource = readFileSync(join(here, "..", "page.tsx"), "utf8");
const stripComments = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const page = stripComments(pageSource);
const chat = stripComments(chatSource);
const dashboard = stripComments(dashboardSource);

describe("cockpit access is independent of Gmail", () => {
  test("the workspace never queries Gmail or swaps the composer for a connection gate", () => {
    expect(page).toContain("<ChatPane");
    expect(page).not.toContain("api.gmailAuth.gmailStatus");
    expect(page).not.toContain("status.connected");
    expect(page).not.toContain('href="/connect-gmail"');
    expect(page).not.toContain("Connect Gmail to start planning");
  });

  test("the dashboard always recommends business work, even while email is disconnected", () => {
    const nextMove = dashboard.slice(
      dashboard.indexOf("const nextMove ="),
      dashboard.indexOf("const count ="),
    );
    expect(nextMove.length).toBeGreaterThan(250);
    expect(nextMove).toContain('href: "/dashboard/workspace"');
    expect(nextMove).toContain('cta: "Open workspace"');
    expect(nextMove).not.toContain("gmail");
    expect(nextMove).not.toContain("connect-gmail");
    // Gmail remains represented honestly as one optional channel status.
    expect(dashboard).toContain('label="Email channel"');
  });
});

describe("business-first cockpit language", () => {
  test("the identity, empty state, and composer start with outcomes rather than email", () => {
    expect(page).toContain("Business Operating Partner");
    expect(page).toContain("Operating workspace");
    expect(chat).toContain("Run the business with Pikar.");
    expect(chat).toContain("Plan strategy, analyze business knowledge, create assets");
    expect(chat).toContain('placeholder="What business outcome should we work on?"');
    expect(chat).not.toContain("Tell me who to email and what to say.");
  });

  test("starter prompts cover planning and analysis and only populate the composer", () => {
    const starters = chat.slice(
      chat.indexOf("export const COCKPIT_STARTERS"),
      chat.indexOf("function messageText"),
    );
    expect(starters.length).toBeGreaterThan(250);
    expect(starters).toContain("highest-leverage next move");
    expect(starters).toContain("30-day operating plan");
    expect(starters).toContain("pipeline, and finances");
    expect(starters.toLowerCase()).not.toContain("email");

    const emptyState = chat.slice(
      chat.indexOf('data-testid="cockpit-empty-state"'),
      chat.indexOf("messages.results.map"),
    );
    expect(emptyState.length).toBeGreaterThan(700);
    expect(emptyState).toContain("COCKPIT_STARTERS.map");
    expect(emptyState).toContain("onClick={() => setText(starter)}");
    expect(emptyState).not.toContain("onSend");
  });
});

describe("Gmail is requested only at the email action boundary", () => {
  test("a refused email approval explains the exact channel need and offers its connection", () => {
    expect(PLAN_REFUSALS.gmail_not_connected).toEqual({
      text: "This email is ready, but Gmail is not connected. Connect it to send this approved message.",
      link: { href: "/connect-gmail", label: "Connect Gmail" },
    });
  });
});
