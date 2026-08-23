// 27-09 (PACK-02/PACK-04). The quick starts are the ONLY native discovery surface for the pilot,
// so the properties asserted here are the ones that would quietly expose a dark pack or promise
// something the runtime cannot do.
//
// Rendered to a string, like `groundedSources.test.ts` beside it: the failures worth catching are
// "a pack was dropped from the list", "the gap disclosure did not reach the card" and "the button
// says Start for six different workflows", none of which a prop-shaped assertion can see.

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import type { PackSourceView } from "./WorkflowPackPreflight";
import { type WorkflowPackOffer, WorkflowPackQuickStarts } from "./WorkflowPackQuickStarts";

const src = (over: Partial<PackSourceView> = {}): PackSourceView => ({
  source: "vault",
  label: "your knowledge vault",
  state: "available",
  unlock: null,
  ...over,
});

const offer = (over: Partial<WorkflowPackOffer> = {}): WorkflowPackOffer => ({
  packId: "brand-review",
  title: "Brand review",
  blurb: "A review of a piece of your copy, saying plainly what it was reviewed against.",
  output: "document",
  version: 1,
  sources: [src()],
  missingKnownCount: 0,
  missingRuntimeCount: 0,
  ...over,
});

/** The words a user actually reads. Tags stripped so an attribute name cannot satisfy or break a
 *  content assertion. */
const visibleText = (html: string) => html.replace(/<[^>]*>/g, " ").toLowerCase();

const render = (
  packs: readonly WorkflowPackOffer[] | undefined,
  over: { busy?: boolean; starting?: string | null } = {},
) =>
  renderToStaticMarkup(
    createElement(WorkflowPackQuickStarts, {
      packs,
      onStart: () => {},
      busy: over.busy ?? false,
      starting: over.starting ?? null,
    }),
  );

describe("WorkflowPackQuickStarts", () => {
  // `undefined` (the query has not answered) and `[]` (nothing is active) are DIFFERENT, and during
  // the dark pilot the empty case is the normal one — it must render nothing at all, not an error.
  test("a pending query loads; an empty list renders nothing", () => {
    expect(render(undefined)).toContain("Loading workflows");
    expect(render([])).toBe("");
  });

  test("every offered pack reaches the markup — none is sliced away", () => {
    const packs = ["a", "b", "c", "d", "e", "f"].map((id, i) =>
      offer({ packId: id, title: `Workflow ${i}` }),
    );
    const html = render(packs);
    for (const p of packs) expect(html, `${p.title} was dropped`).toContain(p.title);
  });

  // The gap disclosure has to survive the composition. A card that rendered the title and quietly
  // omitted the preflight would be exactly the "advertise the work, hide the limit" failure.
  test("each card carries its own preflight, including the unlock", () => {
    const html = render([
      offer({
        sources: [
          src(),
          src({
            source: "tenant-brand-guidance",
            label: "your confirmed brand guidance",
            state: "unavailable",
            unlock: "somewhere to store brand guidance you have confirmed",
          }),
        ],
        missingKnownCount: 1,
      }),
    ]);
    expect(html).toContain("your confirmed brand guidance");
    expect(html).toContain("would need somewhere to store brand guidance you have confirmed");
  });

  // The output contract, before the run. "Nothing is sent" on the draft_reply pack is the sentence
  // that keeps a customer-complaint quick start from reading like a send button.
  test("each output contract is stated up front, and the reply pack says nothing is sent", () => {
    expect(render([offer({ output: "briefing" })])).toContain("Answers here in the chat");
    expect(render([offer({ output: "document" })])).toContain("Saves a document to your vault");
    const reply = render([offer({ packId: "customer-complaint", output: "draft_reply" })]);
    expect(reply).toContain("nothing is sent");
  });

  // Six buttons all labelled "Start" is a screen-reader dead end. The accessible name must name
  // the workflow it starts.
  test("every Start button is distinguishable by its accessible name", () => {
    const html = render([
      offer({ packId: "brand-review", title: "Brand review" }),
      offer({ packId: "business-pulse", title: "Business pulse" }),
    ]);
    expect(html).toContain('aria-label="Start Brand review"');
    expect(html).toContain('aria-label="Start Business pulse"');
  });

  // One turn at a time — the page's shared in-flight signal. A quick start that stayed live during
  // a running turn could race a typed message onto the same plan row.
  test("a busy page disables every start, and a starting card announces itself", () => {
    const busy = render([offer(), offer({ packId: "business-pulse", title: "Business pulse" })], {
      busy: true,
    });
    expect(busy.match(/disabled=""/g) ?? []).toHaveLength(2);

    const starting = render([offer()], { starting: "brand-review" });
    expect(starting).toContain('aria-busy="true"');
    expect(starting).toContain("Starting…");
  });

  // THE PILOT'S CENTRAL PROPERTY, asserted at the surface a user actually looks at. There is no
  // marketplace, no install state, no enable toggle and no tool picker — a control that appeared to
  // widen a pack's capability would be describing something the runtime structurally cannot do,
  // because the grant is code-owned (`toolsForWorkflowPack`).
  test("it offers no install, enable or tool-grant control of any kind", () => {
    // VISIBLE TEXT only, tags stripped. A raw-markup scan would collide with attribute names —
    // `disabled=""` contains "disable" — and would fail for a reason that has nothing to do with
    // the property being asserted.
    const html = visibleText(render([offer()]));
    for (const forbidden of ["install", "enable", "disable", "marketplace", "add tool", "grant"]) {
      expect(html, `the quick starts render a "${forbidden}" control`).not.toContain(forbidden);
    }
  });

  // Packs are LEAF AGENTS. Nothing here may imply a pack hands work to another agent.
  test("no card implies specialist dispatch", () => {
    const html = visibleText(render([offer()]));
    for (const forbidden of ["specialist", "another agent", "delegate"]) {
      expect(html).not.toContain(forbidden);
    }
  });

  // A version number is registry bookkeeping. Rendering it would put a candidate/active distinction
  // in front of a user who has no way to act on it — and would leak the pilot's internals.
  test("the registry version is never rendered", () => {
    expect(render([offer({ version: 7 })])).not.toContain("v7");
  });
});
