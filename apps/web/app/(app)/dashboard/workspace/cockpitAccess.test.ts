import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { RecommendationCard } from "../CommandCenter";
import { COCKPIT_STARTERS } from "./ChatPane";
import { PLAN_REFUSALS } from "./cards";

const here = dirname(fileURLToPath(import.meta.url));
const pageSource = readFileSync(join(here, "page.tsx"), "utf8");
const chatSource = readFileSync(join(here, "ChatPane.tsx"), "utf8");
// `LegacyDashboard.tsx` was deleted on owner approval (2026-08-23), so the legacy half of this
// guard went with it. Command Center v2 IS the surface a tenant lands on, and the invariant is
// asserted against its own rendered hero below.
const dashboardEntry = readFileSync(join(here, "..", "page.tsx"), "utf8");
const stripComments = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const page = stripComments(pageSource);
const chat = stripComments(chatSource);

describe("cockpit access is independent of Gmail", () => {
  test("the workspace never queries Gmail or swaps the composer for a connection gate", () => {
    expect(page).toContain("<ChatPane");
    expect(page).not.toContain("api.gmailAuth.gmailStatus");
    expect(page).not.toContain("status.connected");
    expect(page).not.toContain('href="/connect-gmail"');
    expect(page).not.toContain("Connect Gmail to start planning");
  });

  test("the dashboard route mounts the cockpit-independent Command Center", () => {
    // The legacy `nextMove` object this once inspected is deleted. What remains assertable at the
    // ROUTE level is that /dashboard has no second home and no Gmail gate of its own; the real
    // "never lead with Gmail" claim is now made against v2's rendered hero, immediately below.
    expect(dashboardEntry).toContain("return <CommandCenter />;");
    expect(dashboardEntry).not.toContain("LegacyDashboard");
    expect(dashboardEntry).not.toContain("api.gmailAuth.gmailStatus");
    expect(dashboardEntry).not.toContain('href="/connect-gmail"');
  });
});

// ── the same invariant, restated against Command Center v2 ────────────────────
// v2 ranks `connection-failure` FIRST by contract, so "never lead with Gmail" cannot be carried
// over verbatim — it becomes: v2 leads with Gmail ONLY when the mailbox signal is TRIGGERED, and
// the moment it is not, the hero is business work again. Asserted on the RENDERED hero, so a
// renamed copy constant cannot leave the visible symptom standing.
//
// OPEN, AND NOT FIXABLE FROM THIS SIDE: `packages/backend/convex/home.ts` sets that signal to
// `triggered` on `!gmailStatus.connected` alone, and `gmailStatus` is `connected: !!row` — so a
// tenant who NEVER connected a mailbox is indistinguishable from one whose connection broke, and
// gets "Connect your mailbox" for a connection that never existed. A `HomeSignal` carries a code
// and a state and nothing else, so no component can tell the two apart; the fix belongs in
// `home.ts`, not here, and these tests are written so it does not need restating when it lands.

const heroOf = (connection: "ok" | "triggered" | "unknown"): string =>
  renderToStaticMarkup(
    createElement(RecommendationCard, {
      health: {
        state: connection === "ok" ? "healthy" : "degraded",
        signals: [
          { code: "connection-failure", state: connection },
          { code: "unresolved-dead-letters", state: "ok" },
          { code: "stale-approval", state: "ok" },
          { code: "scheduled-risk", state: "ok" },
          { code: "diagnostic-blocker", state: "ok" },
          { code: "binding-constraint", state: "ok" },
        ],
      },
    } as never),
  );

describe("Command Center v2 leads with Gmail only when the mailbox connection has failed", () => {
  test("a connected mailbox puts business work in the hero, never a connection prompt", () => {
    const hero = heroOf("ok");
    expect(hero).toContain('data-cc-priority="workspace"');
    expect(hero).toContain("Open the workspace");
    expect(hero).toContain('href="/dashboard/workspace"');
    expect(hero).not.toContain("Connect your mailbox");
    expect(hero).not.toContain("connect-gmail");
    expect(hero.toLowerCase()).not.toContain("mailbox");
  });

  test("a mailbox that did NOT report is not treated as a broken one", () => {
    // `unknown` is what `home.ts` returns when the Gmail read throws. An unread source is not a
    // failure, so it must not produce reconnect copy — and it must not produce an all-clear either.
    const hero = heroOf("unknown");
    expect(hero).not.toContain("Connect your mailbox");
    expect(hero).not.toContain("connect-gmail");
    expect(hero).toContain("Some checks did not report");
  });

  test("a genuinely failed connection DOES lead — the guard above is not blanket suppression", () => {
    const hero = heroOf("triggered");
    expect(hero).toContain('data-cc-priority="connection-failure"');
    expect(hero).toContain("Connect your mailbox");
    expect(hero).toContain('href="/connect-gmail"');
  });

  test("Gmail is one rung, not a gate: clearing it hands the hero back to business work", () => {
    expect(heroOf("triggered")).toContain('data-cc-priority="connection-failure"');
    expect(heroOf("ok")).toContain('data-cc-priority="workspace"');
  });
});

describe("business-first cockpit language", () => {
  test("the identity, empty state, and composer start with outcomes rather than email", () => {
    expect(page).toContain("Business Operating Partner");
    expect(page).toContain("Operating workspace");
    // The empty state was REDESIGNED from a headline + subhead into the COCKPIT_STARTERS pills,
    // and this assertion still named the deleted strings — so the guard failed while the property
    // it guards (business-first, never email-first) was intact and arguably stronger. Assert the
    // MECHANISM that carries the intent now, not the copy that used to.
    expect(chat).toContain("COCKPIT_STARTERS");
    expect(chat).toContain("Suggested business prompts");
    expect(COCKPIT_STARTERS[0]).toContain("Review my business");
    expect(COCKPIT_STARTERS.some((s) => /email/i.test(s))).toBe(false);
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
