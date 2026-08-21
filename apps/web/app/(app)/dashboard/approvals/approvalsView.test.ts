import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import {
  ApprovalKindBadge,
  ApprovalsStateNotice,
  AwaitingCardBody,
  actionLabel,
  emailApprovalActionLabel,
  emailBusinessAction,
  formatAbsoluteInstant,
  IMAGE_CANVAS_NOTE,
  parseScheduleInput,
  persistentOutcomes,
  PREVIEW_CHARS,
  previewText,
  ResolvedOutcomeCard,
  refusalMessage,
  STALE_PLAN_MESSAGE,
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

  test("an email approval names the business action and person, not an email workflow", () => {
    const plan = {
      recipients: ["amina@example.com"],
      recipientNames: { "amina@example.com": "Amina" },
      subject: "Growth partnership proposal",
      mode: "individual" as const,
    };

    expect(emailBusinessAction(plan)).toBe("Send “Growth partnership proposal” to Amina");
    expect(emailApprovalActionLabel(plan)).toBe("Approve & send to Amina");
    expect(actionLabel("email", plan)).toBe("Approve & send to Amina");
    expect(emailBusinessAction(plan)).not.toMatch(/email (plan|workflow)/i);
  });

  test("reply and multi-recipient approvals remain outcome-specific", () => {
    expect(
      emailBusinessAction({
        recipients: ["amina@example.com"],
        recipientNames: { "amina@example.com": "Amina" },
        subject: "Re: Revised proposal",
        replyThreadId: "gmail-thread-ref",
      }),
    ).toBe("Reply to Amina about “Revised proposal”");

    const group = {
      recipients: ["amina@example.com", "omar@example.com", "team@example.com"],
      recipientNames: {
        "amina@example.com": "Amina",
        "omar@example.com": "Omar",
      },
      subject: "Workshop confirmation",
      mode: "group" as const,
    };
    expect(emailBusinessAction(group)).toBe("Send “Workshop confirmation” to Amina and 2 others");
    expect(emailApprovalActionLabel(group)).toBe("Approve & send to 3 recipients");
  });

  test("approval and cleared-record cards retain exact email channel and address review", () => {
    expect(source).toContain('aria-label="Email delivery details"');
    expect(source).toContain("Email via Gmail");
    expect(source).toContain("name === address ? address :");
    expect(source).toMatch(/function ClearedRow[\s\S]*?<EmailApprovalDetails plan=\{plan\}/);
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
      "That figure can only be updated by you for now — the agent cannot vouch for where it came from. Nothing changed.",
    );
    expect(refusalMessage("malformed_figure_claim")).toBe(
      "This figure update was malformed and was not applied. Nothing changed.",
    );
    // REVIEW FIX: every sibling in this map closes by naming what did NOT happen — an owner
    // reading only this line must be able to tell nothing partially landed.
    expect(refusalMessage("agent_cannot_update_figure")).toContain("Nothing changed.");
  });

  // Step 1: the gate is `item.kind === "email"` and nothing else — one edited condition away from
  // silently letting a finance_write plan (or any other kind) offer a Schedule button it cannot
  // honor (finance_write has no sendAt concept at all).
  test("only an email plan ever offers the Schedule button", () => {
    const gate = source.match(/([\s\S]{0,260})Schedule…/);
    expect(gate?.[1]).toMatch(/item\.kind === "email" &&/);
    expect(gate?.[1]).not.toContain("finance_write");
  });

  // ---- 25.1-04 (D9/D10): every Approve click must end in a visible truth ----
  //
  // These render REAL markup. `AwaitingCardBody` is the presentational half of `AwaitingCard` —
  // the split exists so the two guarantees below (notice ORDER, and the absence of the image
  // Approve button) can be asserted against a DOM instead of a regex over a 130-line JSX blob.
  // A source scan would have gone green on a notice that never rendered at all.

  type BodyProps = Parameters<typeof AwaitingCardBody>[0];
  const reelPlan = { kind: "media", artDirection: "cinematic" } as unknown as BodyProps["plan"];
  const imagePlan = {
    kind: "media",
    mediaMode: "image",
    imagePrompt: "Teal product hero",
  } as unknown as BodyProps["plan"];

  function bodyProps(overrides: Partial<BodyProps> = {}): BodyProps {
    return {
      item: {
        planId: "plan_a",
        threadId: "thread_a",
        kind: "reel",
        createdAt: Date.parse("2026-08-21T09:00:00.000Z"),
        recipientCount: 0,
        attachmentCount: 0,
      },
      plan: reelPlan,
      busy: false,
      result: null,
      attachmentsOpen: false,
      attachments: undefined,
      scheduleOpen: false,
      confirmDiscard: false,
      onApprove: () => {},
      onSchedule: async () => {},
      onDiscard: () => {},
      onToggleAttachments: () => {},
      onToggleSchedule: () => {},
      onRequestDiscard: () => {},
      ...overrides,
    };
  }

  // D9: the refusal used to render BELOW the discard fieldset, off the bottom of the card. It is
  // now the FIRST child of the article — above the held pill and above every action button.
  test("the outcome notice renders at the top of the card, above every action button", () => {
    const html = renderToStaticMarkup(
      createElement(AwaitingCardBody, bodyProps({ result: refusalMessage("no_deck") })),
    );
    const noticeAt = html.indexOf('role="status"');
    const heldPillAt = html.indexOf("Held ");
    const firstButtonAt = html.indexOf("<button");

    expect(noticeAt).toBeGreaterThanOrEqual(0);
    expect(heldPillAt).toBeGreaterThanOrEqual(0);
    expect(firstButtonAt).toBeGreaterThanOrEqual(0);
    expect(noticeAt).toBeLessThan(heldPillAt);
    expect(noticeAt).toBeLessThan(firstButtonAt);
    // The card stays usable behind its refusal — the buttons are not disabled by the notice.
    expect(html).toContain("Approve governed generation");
  });

  // D10: `executePlan`'s media arm reads a SHOT DECK. An image plan has none, so that button
  // returns `no_deck` on every click that has ever been made or ever will be.
  test("an image plan offers no Approve button, only the honest canvas route", () => {
    const html = renderToStaticMarkup(
      createElement(
        AwaitingCardBody,
        bodyProps({
          item: { ...bodyProps().item, kind: "image" },
          plan: imagePlan,
        }),
      ),
    );
    expect(html).not.toContain("Approve governed generation");
    expect(html).toContain(IMAGE_CANVAS_NOTE);
    // Everything else the card could do is untouched.
    expect(html).toContain("Edit in cockpit");
    expect(html).toContain("Discard");
  });

  test("a reel plan still offers its Approve button", () => {
    const html = renderToStaticMarkup(createElement(AwaitingCardBody, bodyProps()));
    expect(html).toContain("Approve governed generation");
    expect(html).not.toContain(IMAGE_CANVAS_NOTE);
  });

  // D9: a successful approve IS the `proposed → approved` transition, so `listAwaiting` drops the
  // row and the card that set the message unmounts before anyone reads it. The message therefore
  // lives in the SECTION, and is rendered as a standalone card once its row is gone.
  test("an outcome survives only once its row has left the awaiting list, and only for its own plan", () => {
    const outcomes = {
      plan_a: "Approval accepted. The governed action is now in flight.",
      plan_b: "Discarded. This plan cannot be re-armed.",
    };
    // Both rows still live: their own cards carry the notice, so nothing is shown twice.
    expect(persistentOutcomes(outcomes, new Set(["plan_a", "plan_b"]))).toEqual([]);
    // plan_a's row dropped off the reactive list — its outcome must still be on screen…
    expect(persistentOutcomes(outcomes, new Set(["plan_b"]))).toEqual([
      ["plan_a", outcomes.plan_a],
    ]);
    // …and it must be plan_a's message, never plan_b's.
    expect(persistentOutcomes(outcomes, new Set(["plan_a"]))).toEqual([
      ["plan_b", outcomes.plan_b],
    ]);
  });

  test("a cleared outcome is not resurrected", () => {
    expect(persistentOutcomes({ plan_a: null }, new Set())).toEqual([]);
  });

  test("the surviving outcome card names the plan and reads as cleared, never as held", () => {
    const html = renderToStaticMarkup(
      createElement(ResolvedOutcomeCard, {
        planId: "plan_a",
        message: "Approval accepted. The governed action is now in flight.",
      }),
    );
    expect(html).toContain('data-plan-id="plan_a"');
    expect(html).toContain('role="status"');
    expect(html).toContain("The governed action is now in flight");
    expect(html).not.toContain("Held ");
  });

  // D9: `executePlan` returns `{ok:true, alreadyStarted:true}` for ANY non-proposed status —
  // discarded and canceled included — so the old copy asserted a start that may never have
  // happened. The one thing it can promise is that THIS click did nothing new.
  test("the stale-card message never claims the plan the user clicked started", () => {
    expect(STALE_PLAN_MESSAGE).toBe(
      "This card was out of date — the plan it showed was already handled or replaced. Nothing new was started.",
    );
    expect(STALE_PLAN_MESSAGE).not.toContain("This plan already started");
    expect(source).not.toContain("This plan already started");
    expect(source).toMatch(/alreadyStarted[\s\S]{0,80}STALE_PLAN_MESSAGE/);
  });

  // The persistence guarantee is WIRING, and wiring is the half a rendered test cannot see: the
  // card must not own the message it produces, because the card is what disappears.
  test("the approve outcome is owned by the section, not by the card that unmounts", () => {
    expect(source).toMatch(/function AwaitingCard\(\{[\s\S]{0,160}onOutcome/);
    expect(source).toMatch(/function AwaitingSection[\s\S]*?setOutcomes\(/);
    expect(source).toMatch(/function AwaitingSection[\s\S]*?persistentOutcomes\(/);
  });

  // ---- 25.1-05 (D11): the held card's preview shows WORDS, not markup ----
  //
  // The preview is a 320-char slice of a body the specialist wrote in Markdown, printed through a
  // pre-wrap paragraph — so the first thing a user read at the approval gate was `# Pricing
  // findings` and `**$25–$40**`. Rendered, not scanned: the markers are still IN the string either
  // way, so only the markup can tell a stripped preview from an unstripped one.
  const MEMO_MARKDOWN =
    "# Pricing findings\n\n## What the market charges\n\nGroup classes run **$25–$40** per session.\n\n- Six-week packages are common\n";

  test("the awaiting preview strips markdown markers instead of showing them", () => {
    const html = renderToStaticMarkup(
      createElement(
        AwaitingCardBody,
        bodyProps({
          item: { ...bodyProps().item, kind: "memo" },
          plan: { kind: "memo", body: MEMO_MARKDOWN } as unknown as BodyProps["plan"],
        }),
      ),
    );
    // The WORDS survive — stripping must not cost the reader the content.
    expect(html).toContain("Pricing findings");
    expect(html).toContain("$25–$40");
    expect(html).toContain("Six-week packages are common");
    // …and the markers do not.
    expect(html).not.toContain("# Pricing");
    expect(html).not.toContain("## What");
    expect(html).not.toContain("**$25");
    expect(html).not.toContain("- Six-week");
  });

  test("previewText keeps the whole document under the cap and truncates only past it", () => {
    // Strip THEN slice: slicing first spends the 320 characters on markers.
    expect(previewText("plain body")).toBe("plain body");
    const long = `# Heading\n\n${"word ".repeat(200)}`;
    expect(previewText(long).length).toBeLessThanOrEqual(PREVIEW_CHARS + 1);
    expect(previewText(long).startsWith("Heading")).toBe(true);
    expect(previewText(long).endsWith("…")).toBe(true);
    // A body that only just fits is NOT given a false ellipsis.
    expect(previewText("x".repeat(PREVIEW_CHARS))).not.toContain("…");
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
