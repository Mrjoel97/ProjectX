import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import {
  ApprovalKindBadge,
  ApprovalsStateNotice,
  formatAbsoluteInstant,
  parseScheduleInput,
  refusalMessage,
  withheldSuffix,
} from "./ApprovalsView";

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
  ] as const)("labels the real %s plan kind", (kind, label) => {
    expect(renderToStaticMarkup(createElement(ApprovalKindBadge, { kind }))).toContain(label);
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
