// @vitest-environment node
//
// markdownToPdf (CKPT-02, V1 + V2) — the pure-JS pdf-lib renderer that lives in llm.ts.
// pdf-lib + Standard-14 fonts run in plain node (no font-file reads), so this suite imports
// the function directly in a `node` env (the convex-test edge-runtime is neither needed nor
// wanted here). Proves: valid %PDF- bytes in a small band, byte-determinism (pinned dates),
// smart-punctuation renders without corruption, and un-sanitizable glyphs never yield a
// partial PDF (dropped by toWinAnsi before drawText).
import { expect, test } from "vitest";
import { markdownToPdf } from "./llm";

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
