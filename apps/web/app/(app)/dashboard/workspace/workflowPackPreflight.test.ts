// 27-09 (PACK-04). The preflight is the honest-partial contract's FIRST half — what the workflow
// can and cannot see, said before it is started rather than apologised for afterwards.
//
// Rendered to a STRING (the `groundedSources.test.ts` precedent in this directory) rather than
// asserted as a pure function, because the thing that can go wrong here is not arithmetic — it is
// DROPPING A GAP, or rendering a state only as a colour. Both look correct in every prop-shaped
// assertion and only the emitted markup catches them.

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { type PackSourceView, WorkflowPackPreflight } from "./WorkflowPackPreflight";

const source = (over: Partial<PackSourceView> = {}): PackSourceView => ({
  source: "vault",
  label: "your knowledge vault",
  state: "available",
  unlock: null,
  ...over,
});

const render = (sources: PackSourceView[]) =>
  renderToStaticMarkup(createElement(WorkflowPackPreflight, { sources }));

describe("WorkflowPackPreflight", () => {
  test("every source is named, with its state IN TEXT and not only as a dot", () => {
    const html = render([
      source(),
      source({ source: "inbox", label: "your mailbox", state: "unavailable" }),
      source({ source: "calendar", label: "your calendar events", state: "partial" }),
    ]);

    expect(html).toContain("your knowledge vault");
    expect(html).toContain("your mailbox");
    expect(html).toContain("your calendar events");
    // BRAND §7: a status carried only by colour is invisible to a screen reader and to anyone who
    // cannot separate the two greys. Each state must be readable as words.
    expect(html).toContain("can read");
    expect(html).toContain("cannot read");
    expect(html).toContain("partly readable");
  });

  // THE REGRESSION THIS FILE EXISTS FOR. A `.slice()` or a `.filter(readable)` would look right in
  // any count-based check while silently destroying the gap disclosure the component is FOR.
  test("no source is ever dropped — every one survives to the markup", () => {
    const many = Array.from({ length: 9 }, (_, i) =>
      source({ source: `s${i}`, label: `source number ${i}`, state: "unavailable" }),
    );
    const html = render(many);
    for (const s of many) expect(html, `${s.label} was dropped`).toContain(s.label);
    // …and the hidden summary count must AGREE with the list rather than be computed twice.
    expect(html).toContain("0 of 9 readable");
  });

  // A matrix gap names what would lift it; a runtime gap does not, because the user can simply
  // connect the thing. Deciding that here from the state would be a second copy of a server rule.
  test("only a matrix gap names an unlock, and it names the real one", () => {
    const html = render([
      source({
        source: "tenant-brand-guidance",
        label: "your confirmed brand guidance",
        state: "unavailable",
        unlock: "somewhere to store brand guidance you have confirmed",
      }),
      source({ source: "inbox", label: "your mailbox", state: "unavailable", unlock: null }),
    ]);

    expect(html).toContain("Not readable in this workflow at all");
    expect(html).toContain("would need somewhere to store brand guidance you have confirmed");
    // The runtime gap is listed as unreadable but must NOT be presented as a product limit.
    expect(html).toContain("your mailbox");
    expect(html).not.toContain("your mailbox (would need");
  });

  test("with no matrix gap at all, the unlock paragraph is absent rather than empty", () => {
    const html = render([source(), source({ source: "web", label: "public web research" })]);
    expect(html).not.toContain("Not readable in this workflow at all");
  });

  // Silence would read as "nothing is missing", which is the one thing this component must never
  // say by accident.
  test("an unresolved preflight says so instead of rendering a confident blank", () => {
    const html = render([]);
    expect(html).toContain("could not check what this workflow can see");
  });

  // BRAND §2: amber is the approval gate's alone. An unreadable source is not held, it is absent.
  test("it never spends the approval-gate amber", () => {
    const html = render([
      source({ state: "unavailable", unlock: "a connected task or publishing system" }),
    ]);
    expect(html).not.toContain("--held");
  });
});
