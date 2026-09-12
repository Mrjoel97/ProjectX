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
import { RAG } from "@convex-dev/rag";
import { scanText } from "@pikar/pii";
import { convexTest } from "convex-test";
import { afterEach, expect, test, vi } from "vitest";
import { internal } from "./_generated/api";
import schema from "./schema";

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
  const graphInserts =
    graphSrc.match(/\.insert\(\s*["'](graphNodes|graphEdges)["'][\s\S]*?\}\)/g) ?? [];
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

test("extract steps redact (scanText) BEFORE any model call (redact-then-write)", () => {
  // extractGraph: scanText must precede generateObject (redact-then-extract, §4).
  const llm = readSource("vaultLlm.ts");
  expect(llm.indexOf("scanText("), "vaultLlm does not call scanText").toBeGreaterThanOrEqual(0);
  expect(llm.indexOf("scanText("), "scanText must run before generateObject").toBeLessThan(
    llm.indexOf("generateObject("),
  );
});

afterEach(() => vi.restoreAllMocks());

test.each([
  false,
  true,
])("embedding adapter receives only redacted text (evaluation: %s)", async (evaluation) => {
  const raw = "Send the private report to alice@example.com.";
  const scanned = scanText(raw);
  expect(scanned.ok).toBe(true);
  if (!scanned.ok) throw new Error("redaction fixture rejected");
  expect(scanned.value.safeText).not.toContain("alice@example.com");
  // Intercept the actual RAG boundary for both the ordinary instance and the contextual
  // evaluation instance. No embedding provider is contacted; the production action runs.
  vi.spyOn(RAG.prototype, "findEntryByContentHash").mockResolvedValue(null as never);
  const add = vi.spyOn(RAG.prototype, "add").mockResolvedValue({
    entryId: "offline-redaction-entry",
    usage: { tokens: 0 },
  } as never);
  const t = convexTest(schema, import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]));
  const tenantId = "packeval-abcdef12-redaction";
  const { vaultDocId, budgetId } = await t.run(async (ctx) => ({
    vaultDocId: await ctx.db.insert("vaultDocuments", {
      tenantId,
      title: "Private report",
      kind: "brief",
      category: "market",
      source: "seam",
      mimeType: "text/plain",
      size: raw.length,
      contentHash: "offline-redaction",
      text: raw,
      status: "processing",
      createdAt: Date.now(),
    }),
    budgetId: await ctx.db.insert("spendEvents", {
      tenantId,
      rail: "reasoning",
      phase: "estimated",
      amountCents: 1,
      correlationId: "offline-redaction-budget",
      createdAt: Date.now(),
    }),
  }));
  await t.action(internal.vaultRag.embedDoc, {
    tenantId,
    vaultDocId,
    ...(evaluation ? { evalBudgetId: budgetId } : {}),
  });
  expect(add).toHaveBeenCalledTimes(1);
  expect(add.mock.calls[0]?.[1]).toMatchObject({
    namespace: tenantId,
    text: scanned.value.safeText,
  });
  expect(JSON.stringify(add.mock.calls[0]?.[1])).not.toContain("alice@example.com");
});

test("the RAG instance is built with a v2-spec embedding model (ai@6 compat, NOT the v4 provider)", () => {
  // Runtime regression guard: `@convex-dev/rag@0.7.5` bundles ai@6, whose embedMany accepts ONLY an
  // EmbeddingModelV2 (`specificationVersion: "v2"`). Passing `openai.embedding(...)` from the backend's
  // @ai-sdk/openai@4 (a spec-"v4" model, correct for ai@7 / llm.ts) throws AI_UnsupportedModelVersionError
  // at ingest time — a runtime skew a type-cast silences but does not fix. The vault must hand RAG a v2
  // adapter. Caught live (a Brain Dump stuck on `processing`); this locks the fix in.
  const ragSrc = readSource("vaultRag.ts");
  expect(ragSrc, "vaultRag no longer declares a v2-spec embedding model").toMatch(
    /specificationVersion:\s*["']v2["']/,
  );
  // The v4 trap: never pass the raw provider embedding model straight into the RAG constructor again.
  expect(
    ragSrc,
    "vaultRag passes a raw openai.embedding(...) model to RAG (spec v4 — breaks ingest)",
  ).not.toMatch(/textEmbeddingModel:\s*openai\.embedding\(/);
});
