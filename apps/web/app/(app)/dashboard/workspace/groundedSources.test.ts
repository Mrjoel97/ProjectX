// The SOURCE card's grounding list, which the owner reported was "just clouding the workspace".
//
// Rendered to a STRING with renderToStaticMarkup (the ApprovalsStateNotice / ImportDone precedent)
// rather than asserted as a pure function, because the thing that can go wrong here is not
// arithmetic — it is DROPPING A SOURCE. A `.slice(0, CAP)` would look correct in every count-based
// assertion while silently destroying the provenance trail this card exists to show. Only looking
// at the emitted markup catches that.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { GroundedSources, SOURCE_INLINE_CAP } from "./cards";

const titles = (n: number) => Array.from({ length: n }, (_, i) => `Source document ${i + 1}`);
const ids = (n: number) => Array.from({ length: n }, (_, i) => `doc_${i + 1}`);

const render = (n: number) =>
  renderToStaticMarkup(createElement(GroundedSources, { titles: titles(n), docIds: ids(n) }));

describe("GroundedSources", () => {
  test("a short list renders inline — no disclosure to click through", () => {
    const html = render(SOURCE_INLINE_CAP);
    expect(html).not.toContain("source-disclosure");
    expect(html).toContain("Source document 1");
    expect(html).toContain(`Source document ${SOURCE_INLINE_CAP}`);
  });

  test("a long list folds behind a disclosure — the crowding fix", () => {
    const html = render(SOURCE_INLINE_CAP + 1);
    expect(html).toContain("source-disclosure");
    // The summary states the real number, so the fold never hides HOW MUCH was hidden.
    expect(html).toContain(`Show the ${SOURCE_INLINE_CAP + 1} documents`);
  });

  test("EVERY source survives the fold — collapsing hides, it must never drop", () => {
    // The regression this file exists for. A slice would pass both tests above.
    const n = 12;
    const html = render(n);
    for (const title of titles(n)) expect(html).toContain(title);
    // …and each one is still its own clickable row, not flattened into a summary line.
    expect(html.match(/data-testid="source-title"/g)).toHaveLength(n);
  });

  test("the boundary does not fold one document too early", () => {
    // Off-by-one here is user-visible: a 3-source turn suddenly needing a click.
    expect(render(SOURCE_INLINE_CAP)).not.toContain("source-disclosure");
    expect(render(SOURCE_INLINE_CAP + 1)).toContain("source-disclosure");
  });

  test("a source with no docId still renders, as text rather than a dead control", () => {
    // Rows written before ids were carried. VaultDocButton degrades to a <span>; the title must
    // not vanish just because it cannot be opened.
    const html = renderToStaticMarkup(
      createElement(GroundedSources, {
        titles: ["Legacy row without an id"],
        docIds: [undefined],
      }),
    );
    expect(html).toContain("Legacy row without an id");
    expect(html).not.toContain("<button");
  });
});
