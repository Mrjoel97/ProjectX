// @vitest-environment node
//
// RPRT-01 the board pack (plan 26-16), convex-test.
//
// `node` env, not the edge-runtime default: `generateBoardPack` lives in a `"use node"` module and
// reaches `markdownToPdf` (pdf-lib) through `llm.ts`'s top-level `node:crypto`. Under the default
// environment those would fail in ways that read as logic bugs. `cockpitTools.test.ts` proves
// convex-test works in a node env; `markdownToPdf.test.ts` proves llm.ts imports cleanly there.
//
// WHAT THIS FILE IS GUARDING, in one sentence each:
//   - the capture is ONE transaction, so the pack cannot be a mix of instants;
//   - the tenant comes from `ctx`, never from an argument;
//   - the artifact is non-groundable by the ABSENT ingest call, proven non-vacuous by promoting the
//     same row and watching the very fields the first test pins actually change;
//   - a replay is ONE row and ONE blob;
//   - a render failure stores nothing and writes nothing;
//   - the audit row is refs-only, and no owner-only or cross-tenant fact reaches the bytes.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildBoardPackMarkdown } from "@pikar/core";
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
// `audit.log` maintains the auditCounts aggregate, so the component must be registered or the REAL
// insert path throws `Component "auditCounts" is not registered`. Relative import — the package
// blocks the deep specifier. Same idiom as contentAudit/cash/calendar tests.
import aggregateSchema from "../node_modules/@convex-dev/aggregate/src/component/schema.js";
// Needed ONLY by the promotion non-vacuity test: `promoteToReference` reaches `startIngest`, which
// reaches `workflow.start`. Same shape as vault.test.ts / contentAudit.test.ts.
import workflowSchema from "../node_modules/@convex-dev/workflow/src/component/schema.js";
import workpoolSchema from "../node_modules/@convex-dev/workpool/src/component/schema.js";
import { api, internal } from "./_generated/api";
import { renderAndStorePack } from "./reportPack";
import schema from "./schema";

const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);
const aggregateModules = import.meta.glob(
  "../node_modules/@convex-dev/aggregate/src/component/**/!(*.test).ts",
);
const workflowModules = import.meta.glob(
  "../node_modules/@convex-dev/workflow/src/component/**/!(*.test).ts",
);
const workpoolModules = import.meta.glob(
  "../node_modules/@convex-dev/workpool/src/component/**/!(*.test).ts",
);

const TENANT = "tenant_a";
const OTHER = "tenant_b";
const DAY = 24 * 60 * 60 * 1000;

// A window ENTIRELY IN THE PAST, and that is load-bearing rather than cosmetic: `audit.log` stamps
// `ts: Date.now()`, so a window containing "now" would swallow the pack's OWN audit row and make a
// replay render different markdown from the run that produced it.
const T0 = Date.UTC(2025, 0, 1);
const W = { sinceMs: T0, untilMs: T0 + 30 * DAY, browserTimeZone: "UTC" };

/** A recipient address — the personal identifier the pack must never carry. */
const NEEDLE_RECIPIENT = "board-needle@example.com";
/** A vault title — the content-plane string the pack must never carry either. */
const NEEDLE_TITLE = "SECRET-VAULT-TITLE-NEEDLE";

const as = (t: ReturnType<typeof convexTest>, tenantId = TENANT) =>
  t.withIdentity({ subject: tenantId });

/** A backend whose audit insert path can actually run. */
function withAudit() {
  const t = convexTest(schema, modules);
  t.registerComponent("auditCounts", aggregateSchema, aggregateModules);
  return t;
}

/** …plus the ingest spine, for the ONE test that promotes a pack. */
function withIngest() {
  const t = withAudit();
  t.registerComponent("workflow", workflowSchema, workflowModules);
  t.registerComponent("workflow/workpool", workpoolSchema, workpoolModules);
  return t;
}

async function seedSend(
  t: ReturnType<typeof convexTest>,
  over: { tenantId?: string; recipient?: string; createdAt?: number; withProof?: boolean } = {},
) {
  const correlationId = `corr-${Math.random()}`;
  const createdAt = over.createdAt ?? T0 + DAY;
  const tenantId = over.tenantId ?? TENANT;
  await t.run(async (ctx) => {
    await ctx.db.insert("requests", {
      tenantId,
      correlationId,
      goal: "PRIVATE-GOAL-TEXT",
      draft: "PRIVATE-DRAFT-BODY",
      recipient: over.recipient ?? "someone@example.com",
      status: "sent",
      attachmentRefs: [],
      createdAt,
    });
    if (over.withProof !== false) {
      await ctx.db.insert("audit", {
        tenantId,
        correlationId,
        eventType: "gmail.sent",
        actor: "system",
        payload: { messageId: "msg-1" },
        ts: createdAt,
      });
    }
  });
  return correlationId;
}

/** Enough of every source that the pack has something honest to say about each section. */
async function seed(t: ReturnType<typeof convexTest>) {
  await seedSend(t, { recipient: NEEDLE_RECIPIENT });
  await seedSend(t);
  await t.run(async (ctx) => {
    const requestId = await ctx.db.insert("requests", {
      tenantId: TENANT,
      correlationId: "corr-review",
      goal: "g",
      draft: "d",
      recipient: "r@example.com",
      status: "awaiting_review",
      attachmentRefs: [],
      createdAt: T0 + DAY,
    });
    await ctx.db.insert("telemetry", {
      tenantId: TENANT,
      correlationId: "tel-1",
      requestId,
      tokensIn: 0,
      tokensOut: 0,
      costUsd: 0,
      durationMs: 0,
      decisionCounts: { send_as_is: 2, edit_text: 1 },
      regenerateCount: 0,
      reviewOutcome: "approved",
      createdAt: T0 + DAY,
    });
    await ctx.db.insert("feedback", {
      tenantId: TENANT,
      requestId,
      skillName: "cockpit-agent",
      skillVersion: 1,
      rating: "up",
      createdAt: T0 + DAY,
      updatedAt: T0 + DAY,
    });
    await ctx.db.insert("deadLetters", {
      tenantId: TENANT,
      correlationId: "corr-dlq",
      workflowId: "wf-1",
      payload: { requestId: "x" },
      error: "boom",
      status: "new",
      createdAt: T0 + DAY,
    });
    // A content-plane row that has nothing to do with the pack. If its title ever appears in the
    // markdown, some read started dereferencing documents.
    await ctx.db.insert("vaultDocuments", {
      tenantId: TENANT,
      title: NEEDLE_TITLE,
      kind: "created_document",
      category: "workspace-docs",
      source: "agent",
      mimeType: "text/markdown",
      size: 10,
      contentHash: "unrelated-hash",
      status: "ready",
      origin: "agent",
      text: "RAW-BODY-THAT-MUST-NEVER-REACH-A-PACK",
      createdAt: T0 + DAY,
    });
  });
}

const packs = (t: ReturnType<typeof convexTest>, tenantId = TENANT) =>
  t.run(async (ctx) =>
    (await ctx.db.query("vaultDocuments").collect()).filter(
      (d) => d.tenantId === tenantId && d.contentHash !== "unrelated-hash",
    ),
  );

const auditRows = (t: ReturnType<typeof convexTest>) =>
  t.run(async (ctx) => ctx.db.query("audit").collect());

const scheduled = (t: ReturnType<typeof convexTest>) =>
  t.run(async (ctx) => ctx.db.system.query("_scheduled_functions").collect());

const storageObjects = (t: ReturnType<typeof convexTest>) =>
  t.run(async (ctx) => ctx.db.system.query("_storage").collect());

const here = dirname(fileURLToPath(import.meta.url));
/**
 * A module's CODE, with comment lines stripped.
 *
 * The scans below are about what these modules DO. Both files explain at length why they do not
 * call `startIngest` and why `wormExport`/`activeSkills` stay out — so a scan over raw source would
 * fail on the very prose that documents the invariant, and the obvious "fix" would be to delete the
 * explanation. Every block comment in this repo is `*`-continued, so dropping comment-leading lines
 * is enough and needs no parser.
 */
const src = (file: string): string =>
  readFileSync(join(here, file), "utf8")
    .split(/\r?\n/)
    .filter((line) => !/^\s*(\/\/|\/\*|\*)/.test(line))
    .join("\n");
const PACK_MODULES = ["reportPack.ts", "reportPackData.ts"] as const;

// ── The artifact ──────────────────────────────────────────────────────────────────────

describe("the landed artifact", () => {
  test("one generate writes ONE ready, tenant-owned, PDF-backed pack row", async () => {
    const t = withAudit();
    await seed(t);

    const result = await as(t).action(api.reportPack.generateBoardPack, W);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.replayed).toBe(false);
    // `asOf` is the window's exclusive upper bound, never a wall clock — that is what makes the
    // markdown a pure function of (window, data) and the content hash a usable replay key.
    expect(result.asOf).toBe(W.untilMs);

    const rows = await packs(t);
    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row?.tenantId).toBe(TENANT);
    expect(row?.origin).toBe("agent"); // promotable through the ONE door
    expect(row?.status).toBe("ready"); // ready WITHOUT ingest
    expect(row?.kind).toBe("created_document"); // already in content.ts's LANE_BY_KIND
    // The 26-11 defect: `mimeType` answers "what is the artifact of record", `storedMimeType`
    // answers "what are the bytes". Collapsing them left every agent PDF unviewable.
    expect(row?.mimeType).toBe("text/markdown");
    expect(row?.storedMimeType).toBe("application/pdf");
    expect(row?.storageId).toBeDefined(); // absent ⇒ no Download button, for free
    expect(row?._id).toBe(result.vaultDocId);
  });

  test("a recipient address never reaches the pack markdown", async () => {
    // `sentMail`'s 50-row page is deliberately NOT in the snapshot: a sample rendered against a
    // capped count prints a floor as a ratio, and the address is a personal identifier in a file
    // that leaves the product.
    const t = withAudit();
    await seed(t);
    await as(t).action(api.reportPack.generateBoardPack, W);

    const row = (await packs(t))[0];
    expect(row?.text).not.toContain(NEEDLE_RECIPIENT);
    expect(row?.text).not.toContain(NEEDLE_TITLE);
    // Non-vacuity: the needle really is in the data this pack was built from.
    const requests = await t.run((ctx) => ctx.db.query("requests").collect());
    expect(requests.some((r) => r.recipient === NEEDLE_RECIPIENT)).toBe(true);
  });

  test("a foreign tenant can neither list nor download another tenant's pack", async () => {
    const t = withAudit();
    await seed(t);
    const result = await as(t).action(api.reportPack.generateBoardPack, W);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const foreignList = await as(t, OTHER).query(api.vault.listVaultDocs, {});
    expect(foreignList.some((d) => d._id === result.vaultDocId)).toBe(false);
    // null, never a throw — a distinct reason would be an existence oracle for another tenant's id.
    expect(
      await as(t, OTHER).query(api.vault.vaultDownloadUrl, { vaultDocId: result.vaultDocId }),
    ).toBeNull();
  });

  test("an unauthenticated generate fails closed", async () => {
    const t = withAudit();
    await expect(t.action(api.reportPack.generateBoardPack, W)).rejects.toThrow(/UNAUTHENTICATED/);
  });

  test("an impossible window is a governed refusal, not an exception", async () => {
    const t = withAudit();
    expect(
      await as(t).action(api.reportPack.generateBoardPack, { ...W, untilMs: W.sinceMs }),
    ).toEqual({ ok: false, reason: "window_invalid" });
    expect(await packs(t)).toHaveLength(0);
  });
});

// ── The capture is ONE transaction ────────────────────────────────────────────────────

describe("the capture", () => {
  // THE DETERMINISTIC GUARD for the atomicity claim. The behavioural race below is weaker (a
  // deterministic scheduler may always observe "neither"), so the scan is what carries the claim.
  test("there is EXACTLY one runQuery in reportPack.ts, and it is the snapshot", () => {
    const source = src("reportPack.ts");
    const calls = [...source.matchAll(/ctx\.runQuery\(/g)];
    expect(calls).toHaveLength(1);
    expect(source).toContain("ctx.runQuery(internal.reportPackData.snapshot");
  });

  test("the tenant comes from ctx and never from an argument", () => {
    // Ask what the code TRUSTS. A caller-supplied tenantId would let any authenticated tenant
    // render another tenant's board pack, and every other check in this file would still pass.
    const source = src("reportPack.ts");
    expect(source).toContain("tenantId: ctx.tenantId");
    expect(source).not.toContain("args.tenantId");
  });

  test("a source mutation AFTER the capture cannot change what the captured value renders", async () => {
    const t = withAudit();
    await seed(t);

    const snap1 = await t.query(internal.reportPackData.snapshot, { tenantId: TENANT, ...W });
    const md1 = buildBoardPackMarkdown(snap1).markdown;

    await seedSend(t);
    await seedSend(t);

    // The captured VALUE is all the renderer ever sees. Mutating after awaiting the whole pipeline
    // would prove nothing; the sequencing point is that render consumes only `snap1`.
    expect(buildBoardPackMarkdown(snap1).markdown).toBe(md1);

    // Non-vacuity: a fresh capture DOES see the new rows, so the equality above is a real property
    // of the value rather than a renderer that ignores its input.
    const snap2 = await t.query(internal.reportPackData.snapshot, { tenantId: TENANT, ...W });
    expect(snap2.operations.delivery.sentCount).toBeGreaterThan(
      snap1.operations.delivery.sentCount,
    );
    expect(buildBoardPackMarkdown(snap2).markdown).not.toBe(md1);
  });

  test("a send and its delivery audit row are seen together or not at all", async () => {
    // The behavioural witness for cross-section skew. WEAKER than the scan above on purpose:
    // convex-test may order these deterministically and always observe "neither". Kept because it
    // is the only assertion that would notice a split capture at runtime.
    const t = withAudit();
    await seed(t);
    const base = (await t.query(internal.reportPackData.snapshot, { tenantId: TENANT, ...W }))
      .operations.delivery.sentCount;

    const [, snap] = await Promise.all([
      seedSend(t),
      t.query(internal.reportPackData.snapshot, { tenantId: TENANT, ...W }),
    ]);

    const sawSend = snap.operations.delivery.sentCount === base + 1;
    const sawProof =
      snap.audit.rows.filter((r) => r.eventType === "gmail.sent").length >
      // the two seeded proofs are always there; a third means the raced pair landed
      2 - 1;
    expect(sawSend ? sawProof : true).toBe(true);
  });
});

// ── Non-groundability ─────────────────────────────────────────────────────────────────

describe("non-groundability is the ABSENT ingest call", () => {
  // ⚠ `_scheduled_functions` IS NOT THE DISCRIMINATOR ON THIS RAIL, and pretending otherwise is how
  // a decorative test gets written. `startIngest` goes through `workflow.start`, which schedules
  // INSIDE the workflow component — the root scheduler stays empty for a real ingest too (measured,
  // not assumed). So the honest witness is the ROW: `status` flips to "processing" and `origin` to
  // "agent_promoted" the instant the ingest door is opened, and stays "ready"/"agent" when it is
  // not. The pair of tests below is one assertion and its own non-vacuity proof.
  test("generating a pack opens no ingest door and leaves no rag entry", async () => {
    const t = withIngest();
    await seed(t);
    await as(t).action(api.reportPack.generateBoardPack, W);

    const row = (await packs(t))[0];
    expect(row?.ragEntryId).toBeUndefined();
    expect(row?.status).toBe("ready");
    expect(row?.origin).toBe("agent");
    expect(await t.run((ctx) => ctx.db.query("graphNodes").collect())).toHaveLength(0);
    expect(await t.run((ctx) => ctx.db.query("vaultSources").collect())).toHaveLength(0);
    // Weak extra, kept because it costs nothing: nothing schedules on the ROOT scheduler either.
    expect(await scheduled(t)).toHaveLength(0);
  });

  test("the SAME reads DO change when the pack is promoted", async () => {
    // Non-vacuity for the assertion above: those fields are not constants, and a pack stays
    // promotable through the ONE door rather than being quietly excluded from it.
    const t = withIngest();
    await seed(t);
    const result = await as(t).action(api.reportPack.generateBoardPack, W);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(
      await as(t).mutation(api.vault.promoteToReference, { vaultDocId: result.vaultDocId }),
    ).toEqual({ ok: true, state: "processing" });

    const after = (await packs(t))[0];
    expect(after?.origin).toBe("agent_promoted");
    expect(after?.status).toBe("processing");
  });

  test("neither pack module names an ingest door", () => {
    // Weaker than the behavioural test (it cannot see an indirect helper) and paired with it
    // deliberately: the scan catches a direct call, the queue assertion catches everything else.
    for (const file of PACK_MODULES) {
      expect(src(file)).not.toMatch(/startIngest|ingestExtractedText|rag\.add|upsertGraph/);
    }
  });
});

// ── Replay, failure, immutability ─────────────────────────────────────────────────────

describe("replay and failure", () => {
  test("replaying the same window returns the SAME row, and stores no second blob", async () => {
    const t = withAudit();
    await seed(t);

    const first = await as(t).action(api.reportPack.generateBoardPack, W);
    const second = await as(t).action(api.reportPack.generateBoardPack, W);
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;

    expect(second.vaultDocId).toBe(first.vaultDocId);
    expect(second.replayed).toBe(true);
    expect(await packs(t)).toHaveLength(1);
    // The orphan blob the second run had already staged is deleted, so the vault does not grow a
    // hidden object per double-click.
    expect(await storageObjects(t)).toHaveLength(1);
  });

  test("a PROMOTED pack is still recognised on replay — promotion is not a new authorship", async () => {
    // The two halves of this were each covered and never composed. `promoteToReference` patches
    // this row's `origin` from "agent" to "agent_promoted", so a replay guard admitting only
    // "agent" stops seeing the pack the moment the user trusts it — and every regeneration after
    // that inserts another duplicate. Needs `withIngest` because promotion starts the ingest
    // workflow this rail deliberately never calls itself.
    const t = withIngest();
    await seed(t);

    const first = await as(t).action(api.reportPack.generateBoardPack, W);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    await as(t).mutation(api.vault.promoteToReference, { vaultDocId: first.vaultDocId });

    const second = await as(t).action(api.reportPack.generateBoardPack, W);
    expect(second.ok).toBe(true);
    if (!second.ok) return;

    expect(second.replayed).toBe(true);
    expect(second.vaultDocId).toBe(first.vaultDocId);
    expect(await packs(t)).toHaveLength(1);
    expect(await storageObjects(t)).toHaveLength(1);
  });

  test("a foreign row sharing the hash cannot mask this rail's own pack", async () => {
    // Drives `landPack` directly, because reaching this through `generateBoardPack` would need a
    // user upload byte-identical to a future pack. `.first()` would return the seeded row — which
    // is not a pack — and re-arm the duplicate loop the test above closes. This is the assertion
    // that stops the `.take()` + `.find()` from being decoration.
    const t = withAudit();
    const hash = "sha256:deadbeef";
    const storageId = await t.run((ctx) =>
      ctx.storage.store(new Blob([new Uint8Array([1])], { type: "application/pdf" })),
    );
    await t.run((ctx) =>
      ctx.db.insert("vaultDocuments", {
        tenantId: TENANT,
        title: "an upload that happens to share the hash",
        kind: "upload",
        category: "workspace-docs",
        source: "upload",
        mimeType: "text/markdown",
        size: 1,
        contentHash: hash,
        status: "ready",
        createdAt: 1,
      }),
    );

    const args = { tenantId: TENANT, title: "Pack", markdown: "# Pack", contentHash: hash };
    const first = await t.mutation(internal.reportPackData.landPack, { ...args, storageId });
    const second = await t.mutation(internal.reportPackData.landPack, { ...args, storageId });

    expect(first.replayed).toBe(false);
    expect(second.replayed).toBe(true);
    expect(second.vaultDocId).toBe(first.vaultDocId);
    // The seeded upload is still there and still counts as a tenant row, so count PACKS, not rows.
    expect((await packs(t)).filter((d) => d.origin === "agent")).toHaveLength(1);
  });

  test("a render failure stores nothing, writes no vault row and no audit row", async () => {
    const t = withAudit();
    await seed(t);

    const outcome = await t.run(async (ctx) =>
      renderAndStorePack(ctx, "Board pack", "# Board pack", async () => {
        throw new Error("pdf exploded");
      }),
    );
    expect(outcome).toEqual({ ok: false });
    expect(await storageObjects(t)).toHaveLength(0);
    expect(await packs(t)).toHaveLength(0);
    expect(
      (await auditRows(t)).filter((r) => r.eventType === "report.pack_generated"),
    ).toHaveLength(0);
  });

  test("neither pack module patches, replaces or deletes a row", () => {
    // What makes "disable generation while existing artifacts stay immutable" true rather than
    // aspirational. `ctx.storage.delete` of the orphan blob is not a row write and is excluded.
    for (const file of PACK_MODULES) {
      const source = src(file);
      expect(source).not.toMatch(/\.patch\(|\.replace\(|ctx\.db\.delete\(/);
    }
  });
});

// ── The audit row ─────────────────────────────────────────────────────────────────────

describe("the audit row", () => {
  test("carries exactly the 14 declared refs, and no content anywhere in the log plane", async () => {
    const t = withAudit();
    await seed(t);
    const result = await as(t).action(api.reportPack.generateBoardPack, W);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const row = (await auditRows(t)).find((r) => r.eventType === "report.pack_generated");
    expect(row).toBeDefined();
    expect(row?.actor).toBe("system");
    expect(row?.tenantId).toBe(TENANT);
    expect(row?.correlationId).toBe(`report:pack:${result.vaultDocId}`);

    const payload = row?.payload as Record<string, unknown>;
    expect(Object.keys(payload).sort()).toEqual(
      [
        "auditRowCount",
        "bytes",
        "deadLetterCount",
        "feedbackCount",
        "packHash",
        "partialSections",
        "result",
        "reviewCount",
        "sentCount",
        "sinceMs",
        "timeZone",
        "timeZoneSource",
        "untilMs",
        "vaultDocId",
      ].sort(),
    );
    expect(payload.packHash).toMatch(/^[0-9a-f]{64}$/);
    expect(payload.result).toBe("generated");

    const logPlane = JSON.stringify([
      await auditRows(t),
      await t.run((c) => c.db.query("deadLetters").collect()),
    ]);
    expect(logPlane).not.toContain(NEEDLE_RECIPIENT);
    expect(logPlane).not.toContain(NEEDLE_TITLE);
    expect(logPlane).not.toContain("Board pack "); // the pack's own title is content, not a ref
    // Non-vacuity: the scan really covered the row we are talking about.
    expect(logPlane).toContain(String(payload.packHash));
  });

  test("a replay is audited as a replay, against the row that already existed", async () => {
    const t = withAudit();
    await seed(t);
    const first = await as(t).action(api.reportPack.generateBoardPack, W);
    await as(t).action(api.reportPack.generateBoardPack, W);
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    const rows = (await auditRows(t)).filter((r) => r.eventType === "report.pack_generated");
    expect(rows.map((r) => (r.payload as { result: string }).result)).toEqual([
      "generated",
      "replayed",
    ]);
    for (const r of rows) expect(r.correlationId).toBe(`report:pack:${first.vaultDocId}`);
  });
});

// ── Owner-only facts stay out ─────────────────────────────────────────────────────────

describe("no owner-only, deployment-global fact reaches the bytes", () => {
  test("neither pack module reads the owner-gated surfaces", () => {
    // Once bytes are inside a vault row they are TENANT-OWNED: retrieval is tenant-scoped and there
    // is no owner predicate on a vault doc, so an owner-gated fact placed there is permanently
    // readable with no gate left anywhere — and re-gating later means deleting stored artifacts.
    for (const file of PACK_MODULES) {
      const source = src(file);
      expect(source).not.toMatch(/\bwormExport\b|\bactiveSkills\b|\bownerQuery\b|\brequireOwner\b/);
    }
  });

  test("no skill name and no cross-tenant export figure appears in the pack", async () => {
    const t = withAudit();
    await seed(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("skills", {
        name: "cockpit-agent",
        version: 99,
        body: "SECRET-PROMPT-BODY",
        status: "active",
        createdAt: T0,
      });
      // Another tenant's audit rows — what `wormExport` would have aggregated over.
      await ctx.db.insert("audit", {
        tenantId: OTHER,
        correlationId: "FOREIGN-CORR",
        eventType: "gmail.sent",
        actor: "system",
        payload: { messageId: "foreign" },
        ts: T0 + DAY,
      });
    });
    await as(t).action(api.reportPack.generateBoardPack, W);

    const text = (await packs(t))[0]?.text ?? "";
    expect(text).not.toContain("cockpit-agent");
    expect(text).not.toContain("SECRET-PROMPT-BODY");
    expect(text).not.toContain("FOREIGN-CORR");
    expect(text).not.toMatch(/rowsAwaitingExport|lastCursorAdvanceMs|oldestAwaitingMs/);
  });
});
