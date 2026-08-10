import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import {
  ApprovalKindBadge,
  ApprovalsStateNotice,
  actionLabel,
  formatAbsoluteInstant,
  parseScheduleInput,
  refusalMessage,
  withheldSuffix,
} from "./ApprovalsView";

// The Schedule button's gate (`item.kind === "email"`) lives inline in AwaitingCard's JSX, which
// is not exported and needs live Convex hooks to render — so the pin is a SOURCE scan, the
// `pipelineView.test.ts` pattern, rather than a rendered assertion.
const rawSource = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "ApprovalsView.tsx"),
  "utf8",
);
const source = rawSource.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

describe("Approvals connected state contracts", () => {
  test.each([
    ["loading", "Loading approvals"],
    ["empty", "Nothing waiting on you"],
    ["partial", "More approvals exist"],
    ["error", "Couldn’t load approvals"],
    ["refusal", "Nothing was sent"],
  ] as const)("renders an accessible %s state", (state, copy) => {
    const html = renderToStaticMarkup(createElement(ApprovalsStateNotice, { state }));
    expect(html).toContain(copy);
    expect(html).toContain('role="status"');
  });

  test.each([
    ["email", "Email"],
    ["reel", "Reel"],
    ["image", "Image"],
    ["calendar_event", "Calendar event"],
    ["memo", "Next-step memo"],
    ["crm_write", "CRM update"],
    ["finance_write", "Figure update"],
  ] as const)("labels the real %s plan kind", (kind, label) => {
    expect(renderToStaticMarkup(createElement(ApprovalKindBadge, { kind }))).toContain(label);
  });

  // 19-06: every label on this surface must name what Approve DOES. "Approve & send" on a CRM
  // write would promise an email the `inline` arm structurally cannot produce.
  test.each([
    ["email", "Approve & send"],
    ["memo", "Approve & file to vault"],
    ["calendar_event", "Approve & create event"],
    ["crm_write", "Approve & save to records"],
    ["finance_write", "Approve & update the figure"],
  ] as const)("the %s approve button names its own outcome", (kind, copy) => {
    expect(actionLabel(kind)).toBe(copy);
  });

  test("resolves a local wall time to one absolute instant and rejects invalid or past input", () => {
    const now = Date.parse("2026-08-05T08:00:00.000Z");
    expect(parseScheduleInput("not-a-time", now)).toEqual({ state: "invalid" });
    expect(parseScheduleInput("2020-01-01T10:00", now)).toEqual({ state: "past" });

    expect(parseScheduleInput("2030-01-01T10:00", now)).toEqual({ state: "too-far" });
    const future = parseScheduleInput("2026-08-06T10:00", now);
    expect(future.state).toBe("ready");
    if (future.state === "ready") expect(Number.isFinite(future.epochMs)).toBe(true);
  });

  test("absolute-time confirmation always names an IANA zone or the UTC fallback", () => {
    const epoch = Date.parse("2030-01-01T10:00:00.000Z");
    expect(formatAbsoluteInstant(epoch, "Africa/Dar_es_Salaam")).toContain("Africa/Dar_es_Salaam");
    expect(formatAbsoluteInstant(epoch, "")).toContain("UTC");
  });

  test("provider and governance refusals never claim success", () => {
    expect(refusalMessage("gmail_not_connected")).toContain("Nothing was sent");
    expect(refusalMessage("review_escalated")).toContain("cannot be approved");
    expect(refusalMessage("daily_budget_exhausted")).toContain("budget");
    // 19-05: these two must have real copy here, not the raw-enum fallback — this page is the
    // SECOND approve surface and a user who lands here deserves the same lever the cockpit names.
    expect(refusalMessage("no_postal_address")).toContain("postal address");
    expect(refusalMessage("no_postal_address")).not.toContain("no_postal_address");
    expect(refusalMessage("all_recipients_suppressed")).toContain("unsubscribed");
    expect(refusalMessage("all_recipients_suppressed")).not.toContain("all_recipients_suppressed");
  });

  // 2026-08-10: `applyFinanceClaims`'s two refusals reach the card as a RETURN, not a throw Convex
  // would redact in production — this is the delivery half of that fix. The card must show the
  // real lever, not the raw enum.
  test("the two finance-write refusals name the lever, not the raw enum", () => {
    expect(refusalMessage("agent_cannot_update_figure")).toBe(
      "That figure can only be updated by you for now — the agent cannot vouch for where it came from.",
    );
    expect(refusalMessage("malformed_figure_claim")).toBe(
      "This figure update was malformed and was not applied. Nothing changed.",
    );
  });

  // Step 1: the gate is `item.kind === "email"` and nothing else — one edited condition away from
  // silently letting a finance_write plan (or any other kind) offer a Schedule button it cannot
  // honor (finance_write has no sendAt concept at all).
  test("only an email plan ever offers the Schedule button", () => {
    const gate = source.match(/([\s\S]{0,260})Schedule…/);
    expect(gate?.[1]).toMatch(/item\.kind === "email" &&/);
    expect(gate?.[1]).not.toContain("finance_write");
  });

  // 19-05 SC#5: a partial send is a SUCCESS that still has to name who was left out and why.
  test("the withheld report names the count, the reason and every address — and is silent otherwise", () => {
    expect(withheldSuffix()).toBe("");
    expect(withheldSuffix([])).toBe("");
    const suffix = withheldSuffix(["bob@x.com", "eve@y.com"]);
    expect(suffix).toContain("Withheld 2");
    expect(suffix).toContain("unsubscribed");
    expect(suffix).toContain("bob@x.com");
    expect(suffix).toContain("eve@y.com");
  });
});
