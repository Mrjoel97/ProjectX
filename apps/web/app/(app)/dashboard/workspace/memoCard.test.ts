// The NEXT-STEP MEMO card's readable half (D11, 25.1-05).
//
// Rendered to a STRING with renderToStaticMarkup (the GroundedSources / AwaitingCardBody
// precedent) rather than scanned as source, because both defects this file guards are only
// observable in the MARKUP: a memo body printed through a pre-wrap paragraph still CONTAINS every
// heading — it just shows the reader a literal `#` — and a references block that is coded but
// never reached looks identical to one that renders. On real markup "the logic was deleted" and
// "the element is absent" are the same observation.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { MemoCardBody } from "./cards";

const MARKDOWN = [
  "# Pricing findings",
  "",
  "## What the market charges",
  "",
  "Group classes run **$25–$40** per session.",
  "",
  "- Six-week package is the common bundle",
  "- Private sessions carry a premium",
].join("\n");

/** The component's own format, mirrored — a pin, so changing the format is a deliberate act. */
const retrieved = (ms: number) =>
  new Date(ms).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });

const AUG = Date.parse("2026-08-21T10:00:00.000Z");
const JUL = Date.parse("2026-07-02T10:00:00.000Z");

const render = (props: Parameters<typeof MemoCardBody>[0]) =>
  renderToStaticMarkup(createElement(MemoCardBody, props));

describe("MemoCardBody — the memo reads as a document", () => {
  test("the body renders as HEADING ELEMENTS, never as literal markdown markers", () => {
    const html = render({ body: MARKDOWN });
    // Both halves matter. Only the first proves the renderer ran; only the second proves the raw
    // paragraph is gone — a card that rendered headings AND still printed the markers would pass
    // either assertion alone.
    expect(html).toContain("<h1>Pricing findings</h1>");
    expect(html).toContain("<h2>What the market charges</h2>");
    expect(html).toContain("<strong>$25–$40</strong>");
    expect(html).toContain("<li>Six-week package is the common bundle</li>");
    expect(html, "a literal markdown marker reached the reader").not.toMatch(/#|\*\*/);
  });

  test("an empty body renders nothing rather than crashing the card", () => {
    expect(render({ body: "" })).not.toContain("<h1>");
  });

  // WIRING is the half a rendered test cannot see: `PlanCard` needs live Convex hooks, so nothing
  // above proves the MEMO CARD reaches this component rather than keeping its own paragraph.
  test("the memo plan card renders through this component, and the pre-wrap paragraph is gone", () => {
    const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "cards.tsx"), "utf8");
    const at = source.indexOf('data-testid="memo-plan-card"');
    expect(at, "the memo card is gone — this test is scanning nothing").toBeGreaterThan(0);
    const branch = source.slice(at, at + 700);
    expect(branch).toContain("<MemoCardBody");
    expect(branch).toContain("sources={plan.sources}");
    expect(branch, "the raw pre-wrap paragraph is still there").not.toContain("pre-wrap");
  });
});

describe("MemoCardBody — the references block", () => {
  const sources = [
    { title: "Chicago session rates", url: "https://pricing.example/chicago", retrievedAt: AUG },
    { title: "Trainer benchmarks", url: "https://market.example/benchmarks", retrievedAt: JUL },
  ];

  test("each source renders its title, its URL and its OWN retrieval date", () => {
    const html = render({ body: MARKDOWN, sources });
    for (const s of sources) {
      expect(html).toContain(s.title);
      expect(html).toContain(`href="${s.url}"`);
      // The URL is READABLE, not only hoverable — the point of the block is that a human can check
      // where a paid finding came from without a mouse.
      expect(html).toContain(s.url);
    }
    // Two different dates, so a component that stamped every row from the first source (or from
    // `Date.now()`) reddens here rather than passing on a single-source fixture.
    expect(html).toContain(retrieved(AUG));
    expect(html).toContain(retrieved(JUL));
    expect(html.match(/data-testid="memo-source"/g)).toHaveLength(2);
  });

  test("EVERY source survives — the block hides nothing and drops nothing", () => {
    // The GroundedSources invariant, restated: a `.slice(0, N)` would pass every count-free
    // assertion above while destroying the provenance this block exists to show.
    const many = Array.from({ length: 9 }, (_, i) => ({
      title: `Source ${i}`,
      url: `https://example.test/${i}`,
      retrievedAt: AUG,
    }));
    const html = render({ body: MARKDOWN, sources: many });
    for (const s of many) expect(html).toContain(s.url);
    expect(html.match(/data-testid="memo-source"/g)).toHaveLength(9);
  });

  test("a source whose title came back empty links its URL rather than an empty anchor", () => {
    // `sourcesFromToolOutput` defaults a missing title to "" — a real shape, not a hypothetical.
    const html = render({
      body: MARKDOWN,
      sources: [{ title: "  ", url: "https://untitled.example/page", retrievedAt: AUG }],
    });
    expect(html).toContain(">https://untitled.example/page</a>");
  });

  test("no sources means NO block — not an empty heading", () => {
    // Absence asserted both ways: the field missing (a legacy row, or a run that never searched)
    // and the field present but empty.
    for (const html of [render({ body: MARKDOWN }), render({ body: MARKDOWN, sources: [] })]) {
      expect(html).not.toContain("Sources");
      expect(html).not.toContain("memo-source");
    }
  });
});
