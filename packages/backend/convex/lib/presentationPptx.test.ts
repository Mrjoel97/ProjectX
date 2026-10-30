import { inflateRawSync } from "node:zlib";
import type { PresentationSpec } from "@pikar/core/presentation";
import { describe, expect, it, vi } from "vitest";
import { PPTX_MIME, presentationToPptx } from "./presentationPptx";

// Read the actual ZIP central directory without introducing a second production dependency.
function unzip(bytes: Uint8Array) {
  const zip = Buffer.from(bytes);
  const end = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (end < 0) throw new Error("Not an OOXML ZIP");
  let offset = zip.readUInt32LE(end + 16);
  const result = new Map<string, Buffer>();
  for (let i = 0; i < zip.readUInt16LE(end + 10); i++) {
    expect(zip.readUInt32LE(offset)).toBe(0x02014b50);
    const method = zip.readUInt16LE(offset + 10);
    const compressedSize = zip.readUInt32LE(offset + 20);
    const nameLength = zip.readUInt16LE(offset + 28);
    const extraLength = zip.readUInt16LE(offset + 30);
    const commentLength = zip.readUInt16LE(offset + 32);
    const local = zip.readUInt32LE(offset + 42);
    const name = zip.subarray(offset + 46, offset + 46 + nameLength).toString("utf8");
    const start = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
    const data = zip.subarray(start, start + compressedSize);
    result.set(name, method === 8 ? inflateRawSync(data) : data);
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return result;
}

const specimen: PresentationSpec = {
  title: "Business review: Q3",
  theme: "teal",
  subtitle: "Sample evidence for editable output",
  sources: [{ id: "ledger", label: "Synthetic monthly ledger", url: "https://example.com/source" }],
  slides: [
    { kind: "cover", title: "Revenue rose in Q3", subtitle: "A clear plan for the next quarter" },
    {
      kind: "bullets",
      title: "A stronger position for the next quarter",
      bullets: [
        "Revenue grew while operating costs stayed stable.",
        "The next quarter prioritizes retention and delivery.",
      ],
      notes: "Synthetic example only.",
      sourceIds: ["ledger"],
    },
    {
      kind: "metrics",
      title: "Performance at a glance",
      metrics: [
        { label: "Revenue", value: "$48k", detail: "Compared with $40k last quarter" },
        { label: "Retention", value: "94%", detail: "Quarter-end customer cohort" },
        { label: "Margin", value: "28%", detail: "Before tax" },
      ],
    },
    {
      kind: "table",
      title: "Costs remain controlled",
      columns: ["Category", "Quarter 2", "Quarter 3"],
      rows: [
        ["Delivery", "$12k", "$13k"],
        ["Marketing", "$4k", "$4k"],
        ["Administration", "$3k", "$3k"],
      ],
    },
    {
      kind: "chart",
      title: "Sales increased each month",
      chartType: "column",
      categories: ["July", "August", "September"],
      series: [
        { name: "Sales", values: [13, 16, 19] },
        { name: "Prior quarter", values: [11, 14, 15] },
      ],
      unit: "USD thousands",
      sourceIds: ["ledger"],
    },
    {
      kind: "comparison",
      title: "Two investment options",
      left: {
        heading: "Improve retention",
        bullets: ["Prioritize existing customers", "Use current delivery capacity"],
      },
      right: {
        heading: "Expand acquisition",
        bullets: ["Test a new audience", "Require a larger marketing budget"],
      },
    },
    {
      kind: "process",
      title: "Next quarter's delivery plan",
      steps: [
        { title: "Review", description: "Confirm the evidence and priorities." },
        { title: "Prepare", description: "Assign owners and budget." },
        { title: "Deliver", description: "Monitor progress every week." },
      ],
    },
  ],
};

describe("native editable PowerPoint export", () => {
  it("writes actual slides, native editable shapes/tables/charts, embedded data and source notes", async () => {
    const files = unzip(await presentationToPptx(specimen));
    const xml = (name: string) => files.get(name)?.toString("utf8") ?? "";
    expect(PPTX_MIME).toBe(
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    );
    expect(
      [...files.keys()].filter((name) => /^ppt\/slides\/slide\d+\.xml$/u.test(name)),
    ).toHaveLength(7);
    expect(xml("ppt/slides/slide2.xml")).toContain(
      "Revenue grew while operating costs stayed stable.",
    );
    expect(xml("ppt/slides/slide2.xml")).toContain("<p:sp>");
    expect(xml("ppt/slides/slide4.xml")).toContain("<a:tbl>");
    expect(xml("ppt/slides/slide4.xml")).toContain("Administration");
    expect(xml("ppt/slides/slide5.xml")).toContain("<c:chart");
    expect(xml("ppt/charts/chart1.xml")).toContain("<c:barChart>");
    expect(xml("ppt/charts/chart1.xml")).toContain("September");
    expect(xml("ppt/charts/chart1.xml")).toContain("<c:v>19</c:v>");
    expect(
      [...files.keys()].filter((name) => /^ppt\/embeddings\/.+\.xlsx$/u.test(name)),
    ).toHaveLength(1);
    expect(xml("ppt/notesSlides/notesSlide2.xml")).toContain("Synthetic example only.");
    expect(xml("ppt/notesSlides/notesSlide5.xml")).toContain("https://example.com/source");
    expect(xml("ppt/theme/theme1.xml")).toContain("Aptos");
    expect(
      [...files.keys()].filter((name) => name.startsWith("ppt/media/") && !name.endsWith("/")),
    ).toHaveLength(0);
    expect([...files.values()].some((file) => file.includes(Buffer.from("vbaProject")))).toBe(
      false,
    );
    // Bounds are measured from actual serialized Office geometry, not the source layout.
    for (let i = 1; i <= 7; i++) {
      const source = xml(`ppt/slides/slide${i}.xml`);
      for (const match of source.matchAll(
        /<a:xfrm[^>]*>[\s\S]*?<a:off x="(\d+)" y="(\d+)"\/>[\s\S]*?<a:ext cx="(\d+)" cy="(\d+)"\/>/gu,
      )) {
        expect(Number(match[1]) + Number(match[3])).toBeLessThanOrEqual(12192200);
        expect(Number(match[2]) + Number(match[4])).toBeLessThanOrEqual(6858000);
      }
    }
  });
  it.each([
    "line",
    "bar",
  ] as const)("renders a native %s chart including negative/zero data", async (chartType) => {
    const files = unzip(
      await presentationToPptx({
        title: "Numbers",
        slides: [
          {
            kind: "chart",
            title: "Mixed results",
            chartType,
            categories: ["A", "B"],
            series: [{ name: "Actual", values: [-3, 0] }],
          },
        ],
      }),
    );
    const chart = [...files.entries()]
      .find(([name]) => /^ppt\/charts\/chart\d+\.xml$/u.test(name))![1]
      .toString("utf8");
    expect(chart).toContain(chartType === "line" ? "<c:lineChart>" : '<c:barDir val="bar"/>');
    expect(chart).toContain("<c:v>-3</c:v>");
  });
  it("escapes hostile plain text without fetching source URLs", async () => {
    const fetch = vi.fn(() => {
      throw new Error("Forbidden network");
    });
    vi.stubGlobal("fetch", fetch);
    try {
      const files = unzip(
        await presentationToPptx({
          title: "Plain data",
          sources: [{ id: "s", label: "Evidence", url: "https://127.0.0.1/private" }],
          slides: [
            {
              kind: "bullets",
              title: "<script>alert(1)</script>",
              bullets: ["<img src=x onerror=alert(1)>", "A & B"],
              sourceIds: ["s"],
            },
          ],
        }),
      );
      const slide = files.get("ppt/slides/slide1.xml")!.toString("utf8");
      expect(slide).toContain("&lt;script&gt;");
      expect(slide).toContain("A &amp; B");
      expect(slide).not.toContain("<script>");
      expect(fetch).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });
  it("refuses an oversized specification before making a file", async () => {
    await expect(
      presentationToPptx({
        title: "Bad",
        slides: [{ kind: "bullets", title: "Overflow", bullets: ["a\nb\nc\nd"] }],
      }),
    ).rejects.toThrow("textFit");
  });
});
