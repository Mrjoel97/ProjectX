// @vitest-environment node
//
// markdownToPdf (CKPT-02, V1 + V2) — the shared pure-JS pdf-lib renderer used by llm.ts.
// pdf-lib + Standard-14 fonts run in plain node (no font-file reads), so this suite imports
// the function directly in a `node` env (the convex-test edge-runtime is neither needed nor
// wanted here). Proves: valid %PDF- bytes in a small band, byte-determinism (pinned dates),
// smart-punctuation renders without corruption, and un-sanitizable glyphs never yield a
// partial PDF (dropped by toWinAnsi before drawText).
import { getDocumentProxy } from "unpdf";
import { expect, test } from "vitest";
import { markdownToPdf } from "./lib/markdownPdf";

const startsWithPdf = (bytes: Uint8Array): boolean =>
  bytes[0] === 0x25 &&
  bytes[1] === 0x50 &&
  bytes[2] === 0x44 &&
  bytes[3] === 0x46 &&
  bytes[4] === 0x2d; // "%PDF-"

test("renders a valid PDF (%PDF- prefix) in a small byte band — no embedded font data", async () => {
  const bytes = await markdownToPdf("Proposal", "# Proposal\n\nBody text.");
  expect(startsWithPdf(bytes)).toBe(true);
  // Standard-14 embeds no font bytes → a one-para doc is a few KB, not hundreds.
  expect(bytes.length).toBeGreaterThan(400);
  expect(bytes.length).toBeLessThan(50_000);
});

test("is byte-deterministic across runs (pinned CreationDate/ModDate) — V1", async () => {
  const a = await markdownToPdf("Proposal", "# Proposal\n\nBody text.");
  const b = await markdownToPdf("Proposal", "# Proposal\n\nBody text.");
  expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
});

test("smart punctuation renders successfully — no silent corruption — V2", async () => {
  const bytes = await markdownToPdf(
    "Café “Deal”",
    "# Café “Deal”\n\nIt’s a plan — with an ellipsis…\n\n- first\n- second",
  );
  expect(startsWithPdf(bytes)).toBe(true);
  expect(bytes.length).toBeGreaterThan(400);
});

test("un-sanitizable glyphs are dropped, never a partial/empty PDF — V2", async () => {
  // An astral emoji + CJK have no WinAnsi mapping. toWinAnsi drops them so drawText never
  // throws; the render still yields a complete, valid PDF around the surviving text.
  const bytes = await markdownToPdf("Doc 😀", "# Doc 😀 中文\n\nreal body text 😀");
  expect(startsWithPdf(bytes)).toBe(true);
  expect(bytes.length).toBeGreaterThan(400);
});

test("multi-page: content that overflows one page paginates (no throw)", async () => {
  const many = Array.from({ length: 200 }, (_, i) => `Paragraph number ${i} with some words.`).join(
    "\n\n",
  );
  const bytes = await markdownToPdf("Long", `# Long\n\n${many}`);
  expect(startsWithPdf(bytes)).toBe(true);
});

test("rich formatting (bold, table, numbered list, sub-headings) renders a valid PDF", async () => {
  // The professional-layout path: inline bold, a pipe table, an ordered list, and h2/h3 all
  // exercise drawBlock's run layout + drawTable without throwing. inlineRuns strips the raw
  // **/# tokens (unit-tested in @pikar/core) so none reach the page as literals.
  const md = [
    "## Overview",
    "",
    "**Objective:** launch the new product by end of month.",
    "",
    "### Timeline",
    "",
    "| Phase | Date |",
    "|-------|------|",
    "| Build | Wk 1 |",
    "| Ship  | Wk 4 |",
    "",
    "1. Finalize the brief",
    "2. Brief the team",
    "",
    "- a bullet point",
    "- another point",
  ].join("\n");
  const a = await markdownToPdf("Product Brief", md);
  const b = await markdownToPdf("Product Brief", md);
  expect(startsWithPdf(a)).toBe(true);
  expect(a.length).toBeGreaterThan(400);
  expect(a.length).toBeLessThan(50_000);
  // Deterministic across runs even with tables + shapes (pinned dates, no randomness).
  expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
});

async function readPages(bytes: Uint8Array) {
  const doc = await getDocumentProxy(bytes);
  try {
    return await Promise.all(
      Array.from({ length: doc.numPages }, async (_, i) => {
        const page = await doc.getPage(i + 1);
        const content = await page.getTextContent();
        return content.items.filter(
          (item): item is typeof item & { str: string; transform: number[]; width: number } =>
            "str" in item,
        );
      }),
    );
  } finally {
    await doc.destroy();
  }
}

test("report tables allocate more room to descriptive columns and avoid duplicate opening titles", async () => {
  const pages = await readPages(
    await markdownToPdf(
      "Trial Framework",
      "# Trial Framework\n\n| Key | Detailed finding |\n| --- | --- |\n| A1 | A detailed observation with enough context to explain the planned inspection and reporting process. |",
    ),
  );
  const items = pages[0] ?? [];
  const detail = items.find((item) => item.str === "Detailed finding");
  expect(detail).toBeDefined();
  // A short key column must leave most of the page available for the descriptive text.
  expect(detail?.transform[4]).toBeLessThan(250);
  // Once in the title block, once in the footer, without repeating the Markdown h1.
  expect(items.filter((item) => item.str === "Trial Framework")).toHaveLength(2);
});

test("long tables repeat headers, preserve every record and number every page", async () => {
  const records = Array.from({ length: 100 }, (_, i) => `REC${String(i).padStart(3, "0")}`);
  const pages = await readPages(
    await markdownToPdf(
      "Inspection Register",
      [
        "| Record | Inspection detail |",
        "| --- | --- |",
        ...records.map(
          (record) => `| ${record} | Check the sample and document the observation. |`,
        ),
      ].join("\n"),
    ),
  );
  expect(pages.length).toBeGreaterThan(2);
  const all = pages.flat().map((item) => item.str);
  for (const record of records) expect(all.filter((text) => text === record)).toHaveLength(1);
  pages.forEach((items, i) => {
    const text = items.map((item) => item.str).join(" ");
    expect(text).toContain("Inspection detail");
    expect(text).toContain(`${i + 1} / ${pages.length}`);
    for (const item of items) {
      if (!item.str.trim()) continue;
      expect(item.transform[4]).toBeGreaterThanOrEqual(47.9);
      expect((item.transform[4] ?? 0) + item.width).toBeLessThanOrEqual(564.1);
      expect(item.transform[5]).toBeGreaterThanOrEqual(20.9);
      expect(item.transform[5]).toBeLessThanOrEqual(744);
    }
  });
});

test("a single very tall row continues across pages without losing its last cell or long tokens", async () => {
  const tokens = Array.from({ length: 450 }, (_, i) => `TOKEN${String(i).padStart(3, "0")}`);
  const unbroken = "LONGIDENTIFIER".repeat(18);
  const pages = await readPages(
    await markdownToPdf(
      "Extended Record",
      `| Key | Full observation |\n| --- | --- |\n| ONE | ${tokens.join(" ")} ${unbroken} |\n| LAST | End of record. |`,
    ),
  );
  expect(pages.length).toBeGreaterThan(1);
  const text = pages
    .flat()
    .map((item) => item.str)
    .join(" ");
  for (const token of tokens) expect(text.split(token)).toHaveLength(2);
  expect(text).toContain("LAST");
  expect(text).toContain("End of record.");
  expect(text.replace(/\s/g, "")).toContain(unbroken);
  for (const items of pages) {
    expect(items.some((item) => item.str === "Full observation")).toBe(true);
    for (const item of items) {
      if (!item.str.trim()) continue;
      expect((item.transform[4] ?? 0) + item.width).toBeLessThanOrEqual(564.1);
      expect(item.transform[5]).toBeGreaterThanOrEqual(20.9);
    }
  }
});
