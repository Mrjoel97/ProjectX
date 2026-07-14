// @vitest-environment node
//
// Static-scan enforcement of the vault §4 redaction contract (mirrors llmRedaction.test.ts). The
// vault content plane holds raw document text in EXACTLY two places — `vaultDocuments.text` and the
// rag chunks (vaultRag.add). Every OTHER surface the ingest pipeline touches (the graph plane, the
// audit/dead-letter/telemetry log plane) must carry refs/ids/counts/redacted-surface-forms ONLY.
// This asserts that BY CONSTRUCTION: the vault modules write no log-plane row, the graph rows carry
// no raw `text` field, and the extract/embed steps redact (scanText) BEFORE any model/embedding call.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";

const convexDir = dirname(fileURLToPath(import.meta.url));
const readSource = (file: string): string => readFileSync(join(convexDir, file), "utf8");

const VAULT_MODULES = ["vault.ts", "vaultIngest.ts", "vaultGraph.ts", "vaultLlm.ts"];

test("vault modules emit NO audit / deadLetters / telemetry write (redaction-safe by construction)", () => {
  // The vault content plane must never itself write a log-plane row — a governed log write belongs
  // ONLY to the shared delivery layer (keyed by correlationId, refs-only). If these modules insert
  // nothing into audit/deadLetters/telemetry and call no audit.log, raw doc text cannot leak to a
  // log from here (CLAUDE.md §4 — the audit log must never become a PII honeypot).
  for (const file of VAULT_MODULES) {
    const src = readSource(file);
    expect(src, `${file} inserts into a log-plane table`).not.toMatch(
      /\.insert\(\s*["'](audit|deadLetters|telemetry)["']/,
    );
    expect(src, `${file} calls audit.log`).not.toMatch(/audit\.log\b/);
  }
});

test("the graph plane stores NO raw document text — only vaultDocuments.text holds it", () => {
  // graphNodes/graphEdges rows carry type/name/normalizedName/rel/ids/degree — surface forms derived
  // from ALREADY-REDACTED text (extractGraph scans first). No graph insert may carry a `text:` field.
  const graphSrc = readSource("vaultGraph.ts");
  const graphInserts = graphSrc.match(/\.insert\(\s*["'](graphNodes|graphEdges)["'][\s\S]*?\}\)/g) ?? [];
  expect(graphInserts.length, "no graphNodes/graphEdges insert found").toBeGreaterThan(0);
  for (const ins of graphInserts) {
    expect(ins, `a graph insert carries a raw text field: ${ins}`).not.toMatch(/\btext\s*:/);
  }
  // The raw doc `text` field is written ONLY by vault.ts (into vaultDocuments); the workflow module
  // never reads or forwards raw doc text (it passes ids + already-extracted nodes/edges to its steps).
  expect(readSource("vaultIngest.ts"), "the ingest workflow references raw doc text").not.toMatch(
    /\.text\b/,
  );
});

test("extract + embed steps redact (scanText) BEFORE any model / embedding call (redact-then-write)", () => {
  // extractGraph: scanText must precede generateObject (redact-then-extract, §4).
  const llm = readSource("vaultLlm.ts");
  expect(llm.indexOf("scanText("), "vaultLlm does not call scanText").toBeGreaterThanOrEqual(0);
  expect(llm.indexOf("scanText("), "scanText must run before generateObject").toBeLessThan(
    llm.indexOf("generateObject("),
  );
  // embedDoc: scanText must precede rag.add (redact-then-embed — the vault embeds the redacted text).
  const ragSrc = readSource("vaultRag.ts");
  expect(ragSrc.indexOf("scanText("), "vaultRag embedDoc does not call scanText").toBeGreaterThanOrEqual(0);
  expect(ragSrc.indexOf("scanText("), "scanText must run before rag.add").toBeLessThan(
    ragSrc.indexOf("rag.add("),
  );
});
