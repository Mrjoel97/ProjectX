import { describe, expect, it } from "vitest";
import {
  presentationJsonSchema,
  presentationTextLines,
  presentationToMarkdown,
  renderPresentationHtml,
  validatePresentationSpec,
} from "./presentation";

const deck = () => ({
  title: "Quarterly review",
  theme: "teal",
  sources: [{ id: "sales", label: "Internal sales ledger", url: "https://example.com/report" }],
  slides: [
    { kind: "cover", title: "Revenue rose 12%", subtitle: "Quarterly review" },
    {
      kind: "chart",
      title: "Monthly sales",
      categories: ["April", "May"],
      chartType: "column",
      series: [{ name: "Sales", values: [20, 30] }],
      sourceIds: ["sales"],
    },
    {
      kind: "table",
      title: "Operating costs",
      columns: ["Month", "Cost"],
      rows: [
        ["April", "$12,000"],
        ["May", "$14,000"],
      ],
    },
  ],
});

describe("presentation admission", () => {
  it("accepts a bounded professional deck and exposes a closed model schema", () => {
    expect(validatePresentationSpec(deck()).slides).toHaveLength(3);
    expect(presentationJsonSchema.additionalProperties).toBe(false);
    expect(presentationJsonSchema.properties.slides.maxItems).toBe(24);
  });
  it.each([
    () => ({ ...deck(), slides: Array(25).fill({ kind: "cover", title: "Extra" }) }),
    () => ({ ...deck(), execute: "fetch('https://evil.example')" }),
    () => ({ ...deck(), slides: [{ kind: "html", title: "Unknown" }] }),
    () => ({
      ...deck(),
      slides: [{ kind: "bullets", title: "Unsafe", bullets: ["Invalid\u0000XML"] }],
    }),
    () => ({ ...deck(), slides: [{ kind: "cover", title: "\ud800" }] }),
    () => ({ ...deck(), slides: [{ kind: "cover", title: "Safe", imagePath: "../../secrets" }] }),
    () => ({ ...deck(), slides: [{ kind: "cover", title: "Safe", sourceIds: ["foreign"] }] }),
    () => ({ ...deck(), sources: [{ id: "sales", label: "Bad", url: "javascript:alert(1)" }] }),
    () => ({
      ...deck(),
      sources: [{ id: "sales", label: "Bad", url: "https://secret:password@example.com" }],
    }),
    () => ({
      ...deck(),
      sources: [
        { id: "sales", label: "A" },
        { id: "sales", label: "B" },
      ],
    }),
    () => ({
      ...deck(),
      slides: [
        {
          kind: "chart",
          title: "Mismatch",
          chartType: "line",
          categories: ["A", "B"],
          series: [{ name: "Data", values: [1, 2, 3] }],
        },
      ],
    }),
    () => ({
      ...deck(),
      slides: [
        {
          kind: "chart",
          title: "Invalid",
          chartType: "line",
          categories: ["A", "B"],
          series: [{ name: "Data", values: [NaN, Infinity] }],
        },
      ],
    }),
    () => ({
      ...deck(),
      slides: [{ kind: "table", title: "Mismatch", columns: ["A", "B"], rows: [["A", "B", "C"]] }],
    }),
    () => ({ ...deck(), slides: [{ kind: "bullets", title: "Overflow", bullets: ["A\nB\nC"] }] }),
    () => ({
      ...deck(),
      slides: [{ kind: "bullets", title: "国".repeat(60), bullets: ["Short"] }],
    }),
  ])("rejects unsupported, hostile, inconsistent or overflowing input %#", (invalid) => {
    expect(() => validatePresentationSpec(invalid())).toThrow(/^Invalid presentation:/u);
  });
  it("counts full-width Unicode and line breaks conservatively", () => {
    expect(presentationTextLines("国".repeat(25), 25)).toBe(2);
    expect(presentationTextLines("A\nB\nC", 100)).toBe(3);
  });
  it("provides a faithful outline, including chart values and sources", () => {
    const markdown = presentationToMarkdown(deck());
    expect(markdown).toContain("Download the PowerPoint");
    expect(markdown).toContain("April 20; May 30");
    expect(markdown).toContain("Internal sales ledger");
    expect(markdown).toContain("| April | $12,000 |");
    const unsafe = {
      title: "Safe",
      slides: [{ kind: "bullets", title: "<script>", bullets: ["[Open](javascript:alert(1))"] }],
    };
    expect(presentationToMarkdown(unsafe)).not.toContain("[Open](javascript:");
  });
  it("renders selected slides from the validated spec with native chart/table previews", () => {
    const all = renderPresentationHtml(deck());
    expect(all.match(/<article /gu)).toHaveLength(3);
    expect(all).toContain("<svg");
    expect(all).toContain("<table>");
    const selected = renderPresentationHtml(deck(), 1);
    expect(selected.match(/<article /gu)).toHaveLength(1);
    expect(selected).toContain("Monthly sales");
    expect(selected).not.toContain("<table>");
    expect(() => renderPresentationHtml(deck(), 3)).toThrow("slideIndex");
    expect(() => renderPresentationHtml(deck(), -1)).toThrow("slideIndex");
  });
  it("escapes every user text surface and forbids script, navigation and network content", () => {
    const html = renderPresentationHtml({
      title: "</title><script>alert(1)</script>",
      slides: [
        {
          kind: "bullets",
          title: '<img src="x" onerror="alert(1)">',
          bullets: ["</style><script>fetch('/private')</script>", "& hostile <iframe src=x>"],
        },
      ],
    });
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("default-src 'none'");
    expect(html).toContain("base-uri 'none'");
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<img ");
    expect(html).not.toContain("<iframe ");
  });
  it.each([
    "line",
    "bar",
    "column",
  ] as const)("produces finite SVG coordinates for %s negative and all-zero charts", (chartType) => {
    for (const values of [
      [-5, 0],
      [0, 0],
    ]) {
      const html = renderPresentationHtml({
        title: "Chart",
        slides: [
          {
            kind: "chart",
            title: "Results",
            chartType,
            categories: ["A", "B"],
            series: [{ name: "Actual", values }],
          },
        ],
      });
      expect(html).toContain("<svg");
      expect(html).not.toMatch(/NaN|Infinity/u);
    }
  });
});
