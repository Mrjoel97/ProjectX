// @vitest-environment node
//
// EXTR-I offline coverage (Phase 3.8 Lane 4) — the transcription rail driven ENTIRELY by
// SMOKE::transcribe:: sentinel bytes (NO video fixtures, NO encoder dep: real containers cannot
// be generated in-test; container ACCEPTANCE is the mandatory live smoke). Offline proves:
// the sentinel spine walk (pending_extraction → processing via the ingest seam), the honest
// container rejection (mime-only — needs no real bytes), the governed stop as a RETURN, the
// counts-only audit (needle-scanned for transcript absence), the fail-closed scan gate, and
// VAULT_EXTRACT_CHAR_CAP truncation.
//
// Registers the components the spine touches offline: rateLimiter (guardrails.preCall /
// recordSpend), auditCounts (the aggregate audit.log maintains), workflow + workflow/workpool
// (ingestExtractedText → workflow.start). Durable workflow steps do NOT run synchronously under
// convex-test — `status: "processing"` IS the seam's synchronous effect (vault.test.ts pattern).
import { VAULT_EXTRACT_CHAR_CAP } from "@pikar/vault";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

// Fake timers — the `vault.test.ts` / `vaultExtract.test.ts` guard, applied here for the same
// reason (2026-08-04). Anything that reaches `startIngest` schedules the WORKFLOW component's
// workpool functions; under real timers they fire after this file finishes and retry-loop against a
// torn-down module runner, throwing `crypto is not defined` / `process is not defined` inside
// whichever file the worker runs next. These tests assert synchronous effects, so the timers never
// need to advance.
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

import aggregateSchema from "../node_modules/@convex-dev/aggregate/src/component/schema.js";
import rateLimiterSchema from "../node_modules/@convex-dev/rate-limiter/src/component/schema.js";
import workflowSchema from "../node_modules/@convex-dev/workflow/src/component/schema.js";
import workpoolSchema from "../node_modules/@convex-dev/workpool/src/component/schema.js";
import { internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);
const rateLimiterModules = import.meta.glob(
  "../node_modules/@convex-dev/rate-limiter/src/component/**/!(*.test).ts",
);
const aggregateModules = import.meta.glob(
  "../node_modules/@convex-dev/aggregate/src/component/**/!(*.test).ts",
);
const workflowModules = import.meta.glob(
  "../node_modules/@convex-dev/workflow/src/component/**/!(*.test).ts",
);
const workpoolModules = import.meta.glob(
  "../node_modules/@convex-dev/workpool/src/component/**/!(*.test).ts",
);

const TENANT = "tenant_transcribe";
type T = ReturnType<typeof convexTest>;

function setup(): T {
  const t = convexTest(schema, modules);
  t.registerComponent("rateLimiter", rateLimiterSchema, rateLimiterModules);
  t.registerComponent("auditCounts", aggregateSchema, aggregateModules);
  t.registerComponent("workflow", workflowSchema, workflowModules);
  t.registerComponent("workflow/workpool", workpoolSchema, workpoolModules);
  // 15.3-04: vault.scheduleExtraction now enqueues on the app's OWN named pool.
  t.registerComponent("vaultIngestPool", workpoolSchema, workpoolModules);
  return t;
}

/** Seed a pending_extraction upload row + its stored bytes (the state vaultUpload leaves a
 *  recognized binary in before scheduling transcribeDoc). */
async function seedDoc(t: T, bytes: string, mimeType: string, title = "clip.mp4") {
  const storageId = await t.run((ctx) => ctx.storage.store(new Blob([bytes], { type: mimeType })));
  const vaultDocId = await t.run((ctx) =>
    ctx.db.insert("vaultDocuments", {
      tenantId: TENANT,
      title,
      kind: "upload",
      category: "videos",
      source: "upload",
      mimeType,
      size: bytes.length,
      contentHash: `hash-${Math.random()}`,
      storageId,
      status: "pending_extraction",
      createdAt: Date.now(),
    }),
  );
  return vaultDocId;
}

const runTranscribe = (t: T, vaultDocId: Awaited<ReturnType<typeof seedDoc>>) =>
  t.action(internal.vaultTranscribe.transcribeDoc, { vaultDocId, tenantId: TENANT });

const getDoc = (t: T, id: Awaited<ReturnType<typeof seedDoc>>) => t.run((ctx) => ctx.db.get(id));
const allAudit = (t: T) => t.run((ctx) => ctx.db.query("audit").collect());

describe("transcribeDoc — sentinel spine (EXTR-I offline)", () => {
  test("SMOKE::transcribe:: bytes walk the full spine to processing with a counts-only audit", async () => {
    const t = setup();
    // Distinctive needle so the transcript-absence scan below can't false-negative.
    const vaultDocId = await seedDoc(
      t,
      "SMOKE::transcribe::the quarterly zebra forecast",
      "video/mp4",
    );

    await runTranscribe(t, vaultDocId);

    // Seam's synchronous effects: text landed, row flipped to processing, ingest workflow started.
    const doc = await getDoc(t, vaultDocId);
    expect(doc?.status).toBe("processing");
    expect(doc?.text).toBe("the quarterly zebra forecast");
    expect(doc?.extractionTruncated).toBeUndefined();

    // Success audit: kind "video" + COUNTS ONLY (durationSeconds 0 on the no-API sentinel path).
    const audits = await allAudit(t);
    const extracted = audits.filter((r) => r.eventType === "vault.extracted");
    expect(extracted).toHaveLength(1);
    expect(extracted[0]?.payload).toMatchObject({
      vaultDocId,
      kind: "video",
      durationSeconds: 0,
      charCount: "the quarterly zebra forecast".length,
      truncated: false,
    });
    // Needle scan: transcript text must be ABSENT from every audit row (§4 — counts, never content).
    expect(JSON.stringify(audits)).not.toContain("zebra");
  });

  test("audio/* container rides the same spine (stray audio uploads don't rot)", async () => {
    const t = setup();
    const vaultDocId = await seedDoc(
      t,
      "SMOKE::transcribe::voice memo body",
      "audio/wav",
      "memo.wav",
    );

    await runTranscribe(t, vaultDocId);

    const doc = await getDoc(t, vaultDocId);
    expect(doc?.status).toBe("processing");
    expect(doc?.text).toBe("voice memo body");
  });

  test("a transcript over VAULT_EXTRACT_CHAR_CAP is truncated and the seam told so", async () => {
    const t = setup();
    // Word-shaped filler, not "a".repeat(...): scanText is quadratic on unbroken uniform runs
    // (~6 min at 400k — a pathological non-transcript shape; logged as a @pikar/pii deferred
    // item). Real transcripts are natural language, which scans in ~10ms at this size.
    const long = "lorem ipsum dolor sit amet "
      .repeat(Math.ceil((VAULT_EXTRACT_CHAR_CAP + 10) / 27))
      .slice(0, VAULT_EXTRACT_CHAR_CAP + 10);
    const vaultDocId = await seedDoc(t, `SMOKE::transcribe::${long}`, "video/mp4");

    await runTranscribe(t, vaultDocId);

    const doc = await getDoc(t, vaultDocId);
    expect(doc?.status).toBe("processing");
    expect(doc?.text?.length).toBe(VAULT_EXTRACT_CHAR_CAP);
    expect(doc?.extractionTruncated).toBe(true);

    const audits = await allAudit(t);
    const extracted = audits.find((r) => r.eventType === "vault.extracted");
    expect(extracted?.payload).toMatchObject({
      truncated: true,
      charCount: VAULT_EXTRACT_CHAR_CAP,
    });
  });
});

describe("transcribeDoc — honest failures (EXTR-I)", () => {
  test("an unsupported container (video/quicktime) fails HONESTLY, mime-only, no spend", async () => {
    const t = setup();
    // Deliberately NOT sentinel bytes and NOT a real video: the check must be mime-only.
    const vaultDocId = await seedDoc(t, "mov container bytes", "video/quicktime", "clip.mov");

    await runTranscribe(t, vaultDocId);

    const doc = await getDoc(t, vaultDocId);
    expect(doc?.status).toBe("failed");
    expect(doc?.failureReason).toBe("unsupported_video_container");
    expect(doc?.text).toBeUndefined(); // nothing ingested

    // No success audit for a rejected container.
    const audits = await allAudit(t);
    expect(audits.filter((r) => r.eventType === "vault.extracted")).toHaveLength(0);
  });

  test("kill switch ON → failed + kill_switch as a RETURN (governed stop, never a throw)", async () => {
    const t = setup();
    await t.mutation(internal.guardrails.setKillSwitch, { on: true });
    const vaultDocId = await seedDoc(t, "SMOKE::transcribe::never reached", "video/mp4");

    await expect(runTranscribe(t, vaultDocId)).resolves.toBeNull(); // no throw

    const doc = await getDoc(t, vaultDocId);
    expect(doc?.status).toBe("failed");
    expect(doc?.failureReason).toBe("kill_switch");
  });

  test("a scanText Err fails closed: pii_scan_failed + exactly ONE refs-only audit row", async () => {
    const t = setup();
    // The poison sentinel routes into scanText's OWN non-string Err branch (intake.ts pattern).
    const vaultDocId = await seedDoc(
      t,
      "SMOKE::transcribe::PII_POISON::secret transcript body",
      "video/mp4",
    );

    await runTranscribe(t, vaultDocId);

    const doc = await getDoc(t, vaultDocId);
    expect(doc?.status).toBe("failed");
    expect(doc?.failureReason).toBe("pii_scan_failed");
    expect(doc?.text).toBeUndefined(); // the transcript never persists past a failed scan

    const audits = await allAudit(t);
    const failures = audits.filter((r) => r.eventType === "vault.extraction_failed");
    expect(failures).toHaveLength(1);
    expect(failures[0]?.payload).toMatchObject({
      vaultDocId,
      kind: "video",
      reason: "pii_scan_failed",
    });
    // Refs-only: no fragment of the transcript in ANY audit row.
    expect(JSON.stringify(audits)).not.toContain("secret transcript");
  });
});
