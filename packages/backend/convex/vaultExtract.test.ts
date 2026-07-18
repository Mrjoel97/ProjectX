// @vitest-environment node
//
// Lane-1 (03.8-02) offline coverage for the extractDoc dispatcher — EXTR-B/D/E/F.
// Every path here drives the REAL spine (gate -> markExtracting -> bytes -> SMOKE sniff /
// dispatch -> scanText fail-closed -> refs-only audit -> ingestExtractedText seam) with ZERO
// real API calls: SMOKE::extract:: sentinel bytes short-circuit the model, the skill registry
// stays deliberately unseeded (a hosted branch fails closed at getActiveSkill — which is
// exactly how the "hosted path chosen" assertions observe the branch offline), and the
// downstream ingest workflow is only STARTED (convex-test never runs the durable steps).
//
// Components registered (intake.test.ts / vault.test.ts precedent): rateLimiter
// (guardrails.preCall/recordSpend), workflow + workflow/workpool (the seam's workflow.start),
// auditCounts (the aggregate audit.log maintains on every insert).
import { VAULT_EXTRACT_CHAR_CAP } from "@pikar/vault";
import { convexTest } from "convex-test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";
import aggregateSchema from "../node_modules/@convex-dev/aggregate/src/component/schema.js";
import rateLimiterSchema from "../node_modules/@convex-dev/rate-limiter/src/component/schema.js";
import workflowSchema from "../node_modules/@convex-dev/workflow/src/component/schema.js";
import workpoolSchema from "../node_modules/@convex-dev/workpool/src/component/schema.js";

// @ts-expect-error import.meta.glob is provided by Vite/vitest at runtime.
const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);
// @ts-expect-error import.meta.glob is provided by Vite/vitest at runtime.
const rateLimiterModules = import.meta.glob("../node_modules/@convex-dev/rate-limiter/src/component/**/!(*.test).ts");
// @ts-expect-error import.meta.glob is provided by Vite/vitest at runtime.
const workflowModules = import.meta.glob("../node_modules/@convex-dev/workflow/src/component/**/!(*.test).ts");
// @ts-expect-error import.meta.glob is provided by Vite/vitest at runtime.
const workpoolModules = import.meta.glob("../node_modules/@convex-dev/workpool/src/component/**/!(*.test).ts");
// @ts-expect-error import.meta.glob is provided by Vite/vitest at runtime.
const aggregateModules = import.meta.glob("../node_modules/@convex-dev/aggregate/src/component/**/!(*.test).ts");

const TENANT = "tenant_extract";
type T = ReturnType<typeof convexTest>;

function setup(): T {
  const t = convexTest(schema, modules);
  t.registerComponent("rateLimiter", rateLimiterSchema, rateLimiterModules);
  t.registerComponent("workflow", workflowSchema, workflowModules);
  t.registerComponent("workflow/workpool", workpoolSchema, workpoolModules);
  t.registerComponent("auditCounts", aggregateSchema, aggregateModules);
  return t;
}

/** Seed a doc through the REAL vaultUpload path (stores bytes + inserts the row). */
async function uploadBytes(
  t: T,
  bytes: BlobPart,
  mimeType: string,
  filename: string,
): Promise<Id<"vaultDocuments">> {
  const asT = t.withIdentity({ subject: TENANT });
  const storageId = await t.run((ctx) => ctx.storage.store(new Blob([bytes], { type: mimeType })));
  const { vaultDocId } = await asT.mutation(api.vault.vaultUpload, {
    storageId,
    filename,
    mimeType,
    size: 64, // metadata only — the action derives truth from the real loaded bytes
    contentHash: `h-${Math.random()}`,
  });
  return vaultDocId;
}

const runExtract = (t: T, vaultDocId: Id<"vaultDocuments">) =>
  t.action(internal.vaultExtract.extractDoc, { vaultDocId, tenantId: TENANT });

const getDoc = (t: T, id: Id<"vaultDocuments">) => t.run((ctx) => ctx.db.get(id));
const auditRows = (t: T) => t.run((ctx) => ctx.db.query("audit").collect());

describe("extractDoc spine — SMOKE, gate, scan-then-audit, seam (EXTR-D/E/F)", () => {
  test("a SMOKE::extract:: sentinel walks the spine to processing with the seam text (EXTR-D)", async () => {
    const t = setup();
    const docId = await uploadBytes(t, "SMOKE::extract::hello", "image/png", "sentinel.png");
    expect((await getDoc(t, docId))?.status).toBe("pending_extraction");

    await runExtract(t, docId);

    const doc = await getDoc(t, docId);
    expect(doc?.status).toBe("processing"); // seam patched + ingest workflow started
    expect(doc?.text).toBe("hello");
    expect(doc?.extractionTruncated).toBeUndefined();

    const success = (await auditRows(t)).find((r) => r.eventType === "vault.extracted");
    expect(success?.payload).toMatchObject({
      vaultDocId: docId,
      kind: "image",
      path: "smoke",
      charCount: 5,
      truncated: false,
      piiCounts: { email: 0, ssn: 0, card: 0, phone: 0 },
    });
  }, 20000);

  test("a governed stop (kill switch) marks failed with the reason — no throw, no audit row (EXTR-E)", async () => {
    const t = setup();
    await t.run((ctx) =>
      ctx.db.insert("guardrailConfig", { killSwitch: true, budgetUsdPerRequest: 0.05, updatedAt: Date.now() }),
    );
    const docId = await uploadBytes(t, "SMOKE::extract::never processed", "image/png", "blocked.png");

    await runExtract(t, docId); // a governed stop is a RETURN, never a throw

    const doc = await getDoc(t, docId);
    expect(doc?.status).toBe("failed");
    expect(doc?.failureReason).toBe("kill_switch");
    expect(doc?.text).toBeUndefined();
    expect((await auditRows(t)).some((r) => r.eventType.startsWith("vault."))).toBe(false);
  });

  test("scanText Err fail-closed: failed + pii_scan_failed + exactly ONE refs-only audit row (EXTR-E)", async () => {
    const t = setup();
    const POISONED = "SMOKE::extract::PII_POISON::this content must never reach the audit plane";
    const docId = await uploadBytes(t, POISONED, "image/png", "poison.png");

    await runExtract(t, docId);

    const doc = await getDoc(t, docId);
    expect(doc?.status).toBe("failed");
    expect(doc?.failureReason).toBe("pii_scan_failed");
    expect(doc?.text).toBeUndefined(); // nothing written past the gate

    const rows = await auditRows(t);
    const failures = rows.filter((r) => r.eventType === "vault.extraction_failed");
    expect(failures).toHaveLength(1);
    expect(failures[0]?.payload).toEqual({ vaultDocId: docId, kind: "image", reason: "pii_scan_failed" });
    expect(rows.some((r) => r.eventType === "vault.extracted")).toBe(false);
    // Needle scan (vaultRedaction.test.ts pattern): the raw text is absent from EVERY audit write.
    const all = JSON.stringify(rows.map((r) => r.payload));
    expect(all).not.toContain("PII_POISON");
    expect(all).not.toContain("never reach the audit plane");
  });

  test("success audit carries counts only — raw extracted text never reaches the audit plane (EXTR-E)", async () => {
    const t = setup();
    const RAW_EMAIL = "john@example.com";
    const RAW_SSN = "123-45-6789";
    const docId = await uploadBytes(
      t,
      `SMOKE::extract::Reach John at ${RAW_EMAIL} SSN ${RAW_SSN}`,
      "image/png",
      "contact.png",
    );

    await runExtract(t, docId);

    const doc = await getDoc(t, docId);
    expect(doc?.status).toBe("processing");
    // Planner-confirmed: RAW text into the content plane (downstream re-scans pre-model).
    expect(doc?.text).toContain(RAW_EMAIL);

    const rows = await auditRows(t);
    const success = rows.find((r) => r.eventType === "vault.extracted");
    expect(success?.payload).toMatchObject({ piiCounts: { email: 1, ssn: 1, card: 0, phone: 0 } });
    const all = JSON.stringify(rows.map((r) => r.payload));
    expect(all).not.toContain(RAW_EMAIL);
    expect(all).not.toContain(RAW_SSN);
  }, 20000);

  test("office dispatch reaches extractOfficeText; the Wave-0 stub's throw maps to office_parse_failed", async () => {
    const t = setup();
    const docId = await uploadBytes(
      t,
      "PK not a real docx",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "deck.docx",
    );

    await runExtract(t, docId);

    const doc = await getDoc(t, docId);
    expect(doc?.status).toBe("failed");
    // Proves Lane 2's merge needs zero Lane-1 changes: the branch exists, the catch maps the throw.
    expect(doc?.failureReason).toBe("office_parse_failed");
  });

  test("text over VAULT_EXTRACT_CHAR_CAP truncates at the cap with truncated: true (EXTR-F)", async () => {
    const t = setup();
    const over = "x".repeat(VAULT_EXTRACT_CHAR_CAP + 500);
    const docId = await uploadBytes(t, `SMOKE::extract::${over}`, "image/png", "big.png");

    await runExtract(t, docId);

    const doc = await getDoc(t, docId);
    expect(doc?.status).toBe("processing");
    expect(doc?.text?.length).toBe(VAULT_EXTRACT_CHAR_CAP);
    expect(doc?.extractionTruncated).toBe(true);

    const success = (await auditRows(t)).find((r) => r.eventType === "vault.extracted");
    expect(success?.payload).toMatchObject({ charCount: VAULT_EXTRACT_CHAR_CAP, truncated: true });
  }, 30000);

  test("an unexpected throw inside the body marks failed with a refs-only reason — never a throw out", async () => {
    const t = setup();
    // Real-looking (non-sentinel) but corrupt PDF bytes: the pdf engine throws, the wrapper catches.
    const docId = await uploadBytes(t, "%PDF-1.4 garbage not parseable", "application/pdf", "corrupt.pdf");

    await runExtract(t, docId); // resolves — the catch-all converted the throw

    const doc = await getDoc(t, docId);
    expect(doc?.status).toBe("failed");
    expect(doc?.failureReason).toMatch(/^extract_error:/);
  });
});

describe("dispatcher source contract (vaultRedaction.test.ts static-scan pattern)", () => {
  const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "vaultExtract.ts"), "utf8");

  test("spine ordering: preCall -> markExtracting -> bytes -> scanText -> audit -> seam", () => {
    const order = ["guardrails.preCall", "markExtracting", "storage.get", "scanText(", "audit.log", "ingestExtractedText"];
    const indexes = order.map((needle) => {
      const i = src.indexOf(needle);
      expect(i, `vaultExtract.ts is missing "${needle}"`).toBeGreaterThanOrEqual(0);
      return i;
    });
    for (let i = 1; i < indexes.length; i++) {
      expect(indexes[i], `"${order[i]}" must come after "${order[i - 1]}"`).toBeGreaterThan(indexes[i - 1]!);
    }
  });

  test("never imports llm.ts (the §96 circular-inference rule)", () => {
    expect(src).not.toMatch(/from\s+["']\.\/llm["']/);
  });
});
