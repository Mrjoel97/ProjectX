// The Content shelf (CONT-01, plan 26-12).
//
// Two kinds of evidence live here and they prove different things:
//   • behavioural — auth, isolation, the positive kind whitelist, cross-kind cursor stability,
//     capped counts, legacy provenance, reel proof and promotion eligibility;
//   • a STATIC SCAN of `content.ts` — the module is read-only BY CONSTRUCTION. "Reuse never
//     duplicates, sends or dispatches" and "a signed URL never reaches a log" are not payload
//     assertions here: there is no mutation, no `storage.getUrl` and no audit call in the module
//     at all. An absent call site cannot be edited into a leak by accident; a shaped payload can.
//     Same reasoning as `vaultRedaction.test.ts`, which is the shipped precedent.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
// Registered only by `withIngest()` below, for the one test that crosses into the real promotion
// mutation — `promoteToReference` calls `startIngest`, which reaches `workflow.start`. Same shape
// as vault.test.ts, which is where that pattern is documented.
import workflowSchema from "../node_modules/@convex-dev/workflow/src/component/schema.js";
import workpoolSchema from "../node_modules/@convex-dev/workpool/src/component/schema.js";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);
const workflowModules = import.meta.glob(
  "../node_modules/@convex-dev/workflow/src/component/**/!(*.test).ts",
);
const workpoolModules = import.meta.glob(
  "../node_modules/@convex-dev/workpool/src/component/**/!(*.test).ts",
);
const TENANT = "tenant_a";
const OTHER = "tenant_b";

function withIngest() {
  const t = convexTest(schema, modules);
  t.registerComponent("workflow", workflowSchema, workflowModules);
  t.registerComponent("workflow/workpool", workpoolSchema, workpoolModules);
  return t;
}

type DocSeed = {
  tenantId?: string;
  title?: string;
  kind: string;
  createdAt: number;
  status?: "processing" | "ready" | "failed" | "pending_extraction" | "extracting";
  origin?: "agent" | "agent_promoted" | "folder_digest";
  text?: string;
  storageId?: Id<"_storage">;
  storedMimeType?: string;
  sourceThreadId?: string;
  sourcePlanId?: Id<"plans">;
  reelMeta?: { planId: Id<"plans">; citations: [] };
};

async function seedDoc(t: ReturnType<typeof convexTest>, seed: DocSeed) {
  return t.run(async (ctx) =>
    ctx.db.insert("vaultDocuments", {
      tenantId: seed.tenantId ?? TENANT,
      title: seed.title ?? `${seed.kind}-${seed.createdAt}`,
      kind: seed.kind,
      category: "workspace-docs",
      source: "agent",
      mimeType: "text/markdown",
      size: 12,
      contentHash: `hash-${seed.kind}-${seed.createdAt}`,
      status: seed.status ?? "ready",
      createdAt: seed.createdAt,
      ...(seed.origin === undefined ? {} : { origin: seed.origin }),
      ...(seed.text === undefined ? {} : { text: seed.text }),
      ...(seed.storageId === undefined ? {} : { storageId: seed.storageId }),
      ...(seed.storedMimeType === undefined ? {} : { storedMimeType: seed.storedMimeType }),
      ...(seed.sourceThreadId === undefined ? {} : { sourceThreadId: seed.sourceThreadId }),
      ...(seed.sourcePlanId === undefined ? {} : { sourcePlanId: seed.sourcePlanId }),
      ...(seed.reelMeta === undefined ? {} : { reelMeta: seed.reelMeta }),
    }),
  );
}

async function seedBytes(t: ReturnType<typeof convexTest>, body = "bytes") {
  return t.run(async (ctx) => ctx.storage.store(new Blob([body])));
}

/** A render-complete plan: the artifact triple the reel URL guarantee is built on (media.ts). */
async function seedReelPlan(
  t: ReturnType<typeof convexTest>,
  opts: {
    tenantId?: string;
    threadId?: string;
    renderStorageId?: Id<"_storage"> | null;
    sidecarStorageId?: Id<"_storage"> | null;
    renderSummary?: boolean;
    renderStatus?: string;
  } = {},
) {
  return t.run(async (ctx) =>
    ctx.db.insert("plans", {
      tenantId: opts.tenantId ?? TENANT,
      threadId: opts.threadId ?? "thread-reel",
      status: "done",
      recipients: [],
      subject: "Reel",
      body: "",
      createdAt: 1,
      ...(opts.renderStorageId ? { renderStorageId: opts.renderStorageId } : {}),
      ...(opts.sidecarStorageId ? { sidecarStorageId: opts.sidecarStorageId } : {}),
      ...(opts.renderSummary === false
        ? {}
        : { renderSummary: { durationS: 28, sceneCount: 6, gates: [] } }),
      renderStatus: opts.renderStatus ?? "rendered",
    }),
  );
}

const asTenant = (t: ReturnType<typeof convexTest>, tenantId = TENANT) =>
  t.withIdentity({ subject: tenantId });

describe("Content shelf — the trust boundary", () => {
  test("every read fails closed without an identity", async () => {
    const t = convexTest(schema, modules);
    const id = await seedDoc(t, { kind: "created_document", createdAt: 100, origin: "agent" });

    await expect(t.query(api.content.summary, {})).rejects.toThrow(/UNAUTHENTICATED/);
    await expect(t.query(api.content.listArtifacts, { limit: 10 })).rejects.toThrow(
      /UNAUTHENTICATED/,
    );
    await expect(t.query(api.content.artifactById, { vaultDocId: id })).rejects.toThrow(
      /UNAUTHENTICATED/,
    );
  });

  test("another tenant's artifacts are invisible, and a guessed id is not an oracle", async () => {
    const t = convexTest(schema, modules);
    await seedDoc(t, { kind: "created_document", createdAt: 100, origin: "agent" });
    const foreign = await seedDoc(t, {
      tenantId: OTHER,
      title: "SECRET-FOREIGN-TITLE",
      kind: "created_document",
      createdAt: 200,
      origin: "agent",
    });

    const page = await asTenant(t).query(api.content.listArtifacts, { limit: 10 });
    expect(page.items).toHaveLength(1);
    expect(JSON.stringify(page)).not.toContain("SECRET-FOREIGN-TITLE");
    expect(JSON.stringify(page)).not.toContain(OTHER);

    // Foreign and non-existent collapse to the SAME null — a throw or a distinct shape would tell
    // the caller that somebody else's id exists (the `promoteToReference` rule).
    expect(await asTenant(t).query(api.content.artifactById, { vaultDocId: foreign })).toBeNull();

    const counts = await asTenant(t).query(api.content.summary, {});
    expect(counts.total.count).toBe(1);
  });

  test("the shelf is a POSITIVE kind whitelist: research, digests, uploads and images stay out", async () => {
    const t = convexTest(schema, modules);
    // In: the three shelf lanes.
    await seedDoc(t, { kind: "created_document", createdAt: 10, origin: "agent" });
    await seedDoc(t, { kind: "created_content", createdAt: 11, origin: "agent" });
    await seedDoc(t, { kind: "next_step_memo", createdAt: 12 });
    await seedDoc(t, { kind: "reel", createdAt: 13 });
    // Out, and each for its own reason:
    //   web_research → the Knowledge Vault owns cited grounding material that goes stale (26-11).
    //   folder_digest / business_profile / upload → never "something Pikar made for you to reuse".
    //   image → a media intermediate, not a shelf artifact.
    const brief = await seedDoc(t, { kind: "web_research", createdAt: 14 });
    await seedDoc(t, { kind: "folder_digest", createdAt: 15, origin: "folder_digest" });
    await seedDoc(t, { kind: "business_profile", createdAt: 16 });
    await seedDoc(t, { kind: "upload", createdAt: 17 });
    await seedDoc(t, { kind: "image", createdAt: 18 });

    const page = await asTenant(t).query(api.content.listArtifacts, { limit: 50 });
    expect(page.items.map((i) => i.lane).sort()).toEqual(["document", "document", "memo", "reel"]);

    const counts = await asTenant(t).query(api.content.summary, {});
    expect(counts.total.count).toBe(4);
    expect(counts.lanes.document.count).toBe(2);
    expect(counts.lanes.memo.count).toBe(1);
    expect(counts.lanes.reel.count).toBe(1);

    // A research brief is not addressable through Content either — the detail read applies the
    // same whitelist, so Content can never become a second door onto the Vault's own surfaces.
    expect(await asTenant(t).query(api.content.artifactById, { vaultDocId: brief })).toBeNull();
  });

  test("sent mail has no lane here at all — Content reads no delivery row", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      const planId = await ctx.db.insert("plans", {
        tenantId: TENANT,
        threadId: "thread-mail",
        status: "done",
        recipients: ["someone@example.com"],
        subject: "SENT-MAIL-SUBJECT",
        body: "b",
        createdAt: 5,
      });
      await ctx.db.insert("requests", {
        tenantId: TENANT,
        planId,
        goal: "SENT-MAIL-SUBJECT",
        recipient: "someone@example.com",
        status: "sent",
        correlationId: "corr-1",
        attachmentRefs: [],
        createdAt: 6,
      });
    });

    const page = await asTenant(t).query(api.content.listArtifacts, { limit: 50 });
    expect(page.items).toHaveLength(0);
    expect(JSON.stringify(page)).not.toContain("SENT-MAIL-SUBJECT");
    // CONT-01 was AMENDED on 2026-08-22: sent mail is a record of what happened and belongs to
    // Reports (RPRT-01), not to a shelf of things you reuse. `requests` is never queried here.
    expect(readContentSource()).not.toMatch(/\.query\(\s*["']requests["']/);
  });
});

describe("Content shelf — the bounded cross-kind union", () => {
  test("pages the three lanes as ONE newest-first order with no gap and no duplicate", async () => {
    const t = convexTest(schema, modules);
    // Interleaved on purpose: a per-lane cursor would re-emit or skip rows here.
    const stamps = [100, 101, 102, 103, 104, 105];
    await seedDoc(t, { kind: "created_document", createdAt: 100, origin: "agent" });
    await seedDoc(t, { kind: "next_step_memo", createdAt: 101 });
    await seedDoc(t, { kind: "reel", createdAt: 102 });
    await seedDoc(t, { kind: "created_content", createdAt: 103, origin: "agent" });
    await seedDoc(t, { kind: "next_step_memo", createdAt: 104 });
    await seedDoc(t, { kind: "created_document", createdAt: 105, origin: "agent" });

    const seen: number[] = [];
    let cursor: string | undefined;
    for (let guard = 0; guard < 10; guard++) {
      const page: {
        items: { createdAt: number }[];
        nextCursor: string | null;
        bound: { returned: number; limit: number; partial: boolean };
      } = await asTenant(t).query(api.content.listArtifacts, {
        limit: 2,
        ...(cursor === undefined ? {} : { cursor }),
      });
      expect(page.bound.returned).toBe(page.items.length);
      seen.push(...page.items.map((i) => i.createdAt));
      if (page.nextCursor === null) {
        expect(page.bound.partial).toBe(false);
        break;
      }
      expect(page.bound.partial).toBe(true);
      cursor = page.nextCursor;
    }

    expect(seen).toEqual([...stamps].sort((a, b) => b - a));
    expect(new Set(seen).size).toBe(seen.length);
  });

  test("a lane filter narrows the union without changing its order", async () => {
    const t = convexTest(schema, modules);
    await seedDoc(t, { kind: "created_document", createdAt: 10, origin: "agent" });
    await seedDoc(t, { kind: "created_content", createdAt: 30, origin: "agent" });
    await seedDoc(t, { kind: "next_step_memo", createdAt: 20 });
    await seedDoc(t, { kind: "reel", createdAt: 40 });

    const docs = await asTenant(t).query(api.content.listArtifacts, {
      limit: 10,
      lane: "document",
    });
    expect(docs.items.map((i) => i.createdAt)).toEqual([30, 10]);
    expect(docs.items.every((i) => i.lane === "document")).toBe(true);

    const reels = await asTenant(t).query(api.content.listArtifacts, { limit: 10, lane: "reel" });
    expect(reels.items.map((i) => i.createdAt)).toEqual([40]);
  });

  test("a forged cursor is refused rather than silently restarting the page", async () => {
    const t = convexTest(schema, modules);
    await seedDoc(t, { kind: "created_document", createdAt: 10, origin: "agent" });
    await expect(
      asTenant(t).query(api.content.listArtifacts, { limit: 5, cursor: "not-a-cursor" }),
    ).rejects.toThrow(/cursor/i);
  });

  test("counts are honestly capped rather than exact-at-any-cost", async () => {
    const t = convexTest(schema, modules);
    for (let i = 0; i < 55; i++) {
      await seedDoc(t, { kind: "next_step_memo", createdAt: 1_000 + i });
    }
    const counts = await asTenant(t).query(api.content.summary, {});
    expect(counts.lanes.memo.capped).toBe(true);
    expect(counts.lanes.memo.count).toBeLessThanOrEqual(55);
    expect(counts.total.capped).toBe(true);
    expect(counts.lanes.reel).toEqual({ count: 0, capped: false });
  });

  test("a card carries refs and enums only — no storage id, no body, no raw text", async () => {
    const t = convexTest(schema, modules);
    const storageId = await seedBytes(t);
    await seedDoc(t, {
      kind: "created_document",
      createdAt: 10,
      origin: "agent",
      text: "RAW-DOCUMENT-BODY-THAT-MUST-NOT-TRAVEL",
      storageId,
      storedMimeType: "application/pdf",
    });

    const page = await asTenant(t).query(api.content.listArtifacts, { limit: 10 });
    const serialized = JSON.stringify(page);
    expect(serialized).not.toContain("RAW-DOCUMENT-BODY-THAT-MUST-NOT-TRAVEL");
    expect(serialized).not.toContain(storageId);
    // What the card DOES say is that bytes exist and what they are, so the page can offer a
    // download — the URL itself is minted on demand by `api.vault.vaultDownloadUrl`.
    expect(page.items[0]?.bytes).toEqual({ state: "available", mimeType: "application/pdf" });
  });
});

describe("Content shelf — provenance, reuse and reel proof", () => {
  test("legacy artifacts report UNKNOWN provenance instead of inventing a thread", async () => {
    const t = convexTest(schema, modules);
    await seedDoc(t, { kind: "created_document", createdAt: 20, origin: "agent" }); // pre-26-11
    await seedDoc(t, {
      kind: "created_document",
      createdAt: 10,
      origin: "agent",
      sourceThreadId: "thread-known",
    });

    const page = await asTenant(t).query(api.content.listArtifacts, { limit: 10 });
    const [legacy, known] = page.items;
    expect(legacy?.provenance).toEqual({ state: "unknown" });
    expect(legacy?.reuse).toEqual({ state: "unavailable", reason: "unknown-thread" });
    expect(known?.provenance).toMatchObject({ state: "known", threadId: "thread-known" });
    expect(known?.reuse).toEqual({
      state: "available",
      href: "/dashboard/workspace?thread=thread-known",
    });
  });

  test("a foreign thread id is never turned into a reuse link for this tenant", async () => {
    const t = convexTest(schema, modules);
    // A row this tenant owns whose provenance names a thread — reuse only ever opens the cockpit,
    // which resolves the thread under the caller's own identity. Nothing here dispatches.
    await seedDoc(t, {
      kind: "created_document",
      createdAt: 10,
      origin: "agent",
      sourceThreadId: "thread with spaces & symbols",
    });
    const page = await asTenant(t).query(api.content.listArtifacts, { limit: 10 });
    expect(page.items[0]?.reuse).toEqual({
      state: "available",
      href: "/dashboard/workspace?thread=thread%20with%20spaces%20%26%20symbols",
    });
  });

  test("a reel plays only with bytes AND live sidecar proof pointing at THIS row", async () => {
    const t = convexTest(schema, modules);

    const provedBytes = await seedBytes(t, "final");
    const sidecar = await seedBytes(t, "assembly");
    const provedPlan = await seedReelPlan(t, {
      threadId: "thread-proved",
      renderStorageId: provedBytes,
      sidecarStorageId: sidecar,
    });
    const provedDoc = await seedDoc(t, {
      kind: "reel",
      createdAt: 30,
      storageId: provedBytes,
      storedMimeType: "video/mp4",
      reelMeta: { planId: provedPlan, citations: [] },
    });
    await t.run(async (ctx) => ctx.db.patch(provedPlan, { reelVaultDocId: provedDoc }));

    // Same shape, but the plan was reset: the triple is gone, so the render that produced these
    // bytes has no live assembly record to stand on (D8).
    const staleBytes = await seedBytes(t, "stale");
    const stalePlan = await seedReelPlan(t, {
      threadId: "thread-stale",
      renderStorageId: staleBytes,
      sidecarStorageId: null,
      renderStatus: "pending",
    });
    await seedDoc(t, {
      kind: "reel",
      createdAt: 20,
      storageId: staleBytes,
      reelMeta: { planId: stalePlan, citations: [] },
    });

    // And a reel row whose plan has since re-rendered into a DIFFERENT vault doc. The plan's triple
    // is intact, so a naive proof would hand this card the OTHER reel's video under this title.
    const otherBytes = await seedBytes(t, "reel-two");
    const repointedPlan = await seedReelPlan(t, {
      threadId: "thread-repointed",
      renderStorageId: otherBytes,
      sidecarStorageId: sidecar,
    });
    const supersededDoc = await seedDoc(t, {
      kind: "reel",
      createdAt: 10,
      storageId: await seedBytes(t, "reel-one"),
      reelMeta: { planId: repointedPlan, citations: [] },
    });
    await t.run(async (ctx) =>
      ctx.db.patch(repointedPlan, {
        reelVaultDocId: await ctx.db.insert("vaultDocuments", {
          tenantId: TENANT,
          title: "reel two",
          kind: "reel",
          category: "workspace-docs",
          source: "media",
          mimeType: "text/markdown",
          size: 1,
          contentHash: "h2",
          status: "ready",
          createdAt: 9,
        }),
      }),
    );

    const page = await asTenant(t).query(api.content.listArtifacts, { limit: 10, lane: "reel" });
    const byCreatedAt = new Map(page.items.map((i) => [i.createdAt, i]));

    expect(byCreatedAt.get(30)?.reel).toMatchObject({
      planId: provedPlan,
      renderStatus: "rendered",
      playback: { state: "proved" },
      canvasHref: "/dashboard/workspace?thread=thread-proved&view=canvas",
    });
    expect(byCreatedAt.get(20)?.reel).toMatchObject({
      playback: { state: "unproved", reason: "no-sidecar" },
      renderStatus: "pending",
    });
    expect(byCreatedAt.get(10)?.reel).toMatchObject({
      playback: { state: "unproved", reason: "superseded" },
    });
    expect(supersededDoc).toBeDefined();

    // The proved reel's URL is served by the EXISTING guarantee, not by a second copy of it here.
    const reel = await asTenant(t).query(api.media.reel, { planId: provedPlan });
    expect(reel.url).not.toBeNull();
    const stale = await asTenant(t).query(api.media.reel, { planId: stalePlan });
    expect(stale.url).toBeNull();
  });

  test("a reel row pointing at ANOTHER tenant's plan leaks nothing and proves nothing", async () => {
    // The join reads `reelMeta.planId` — a field on a row this tenant owns, which is exactly the
    // kind of assumption worth mutating: the plan it names is trusted to be ours. It is re-checked,
    // so a corrupted or hand-written pointer yields the same "no-plan" a missing one does, and the
    // other tenant's thread id never becomes a canvas link on this tenant's card.
    const t = convexTest(schema, modules);
    const bytes = await seedBytes(t, "foreign-final");
    const foreignPlan = await seedReelPlan(t, {
      tenantId: OTHER,
      threadId: "FOREIGN-THREAD",
      renderStorageId: bytes,
      sidecarStorageId: await seedBytes(t, "foreign-sidecar"),
    });
    const doc = await seedDoc(t, {
      kind: "reel",
      createdAt: 10,
      storageId: bytes,
      reelMeta: { planId: foreignPlan, citations: [] },
    });
    await t.run(async (ctx) => ctx.db.patch(foreignPlan, { reelVaultDocId: doc }));

    const card = await asTenant(t).query(api.content.artifactById, { vaultDocId: doc });
    expect(card?.reel).toEqual({
      planId: null,
      renderStatus: null,
      canvasHref: null,
      playback: { state: "unproved", reason: "no-plan" },
    });
    expect(JSON.stringify(card)).not.toContain("FOREIGN-THREAD");
  });

  test("a reel with no bytes and one with no plan are both unproved, never silently playable", async () => {
    const t = convexTest(schema, modules);
    await seedDoc(t, { kind: "reel", createdAt: 20 }); // legacy: no reelMeta, no bytes
    const plan = await seedReelPlan(t, { renderStorageId: null, sidecarStorageId: null });
    await seedDoc(t, { kind: "reel", createdAt: 10, reelMeta: { planId: plan, citations: [] } });

    const page = await asTenant(t).query(api.content.listArtifacts, { limit: 10, lane: "reel" });
    expect(page.items.map((i) => i.reel?.playback)).toEqual([
      { state: "unproved", reason: "no-plan" },
      { state: "unproved", reason: "no-bytes" },
    ]);
  });
});

describe("Content shelf — promotion is OFFERED here and GUARDED in exactly one place", () => {
  test("the offered state tracks what api.vault.promoteToReference actually does", async () => {
    const t = withIngest();
    const eligible = await seedDoc(t, {
      kind: "created_document",
      createdAt: 40,
      origin: "agent",
    });
    const promoted = await seedDoc(t, {
      kind: "created_content",
      createdAt: 30,
      origin: "agent_promoted",
    });
    const failed = await seedDoc(t, {
      kind: "created_document",
      createdAt: 20,
      origin: "agent_promoted",
      status: "failed",
    });
    const memo = await seedDoc(t, { kind: "next_step_memo", createdAt: 10 });

    const state = async (id: Id<"vaultDocuments">) =>
      (await asTenant(t).query(api.content.artifactById, { vaultDocId: id }))?.promotion;

    expect(await state(eligible)).toEqual({ state: "eligible" });
    expect(await state(promoted)).toEqual({ state: "promoted" });
    expect(await state(failed)).toEqual({ state: "retry" });
    // A memo is written straight into retrieval by `persistNextStepMemo`'s own `startIngest`, so
    // there is nothing to promote — "not-applicable" means already reference material, not refused.
    expect(await state(memo)).toEqual({ state: "not-applicable" });

    // ANTI-DRIFT: the projection above decides whether to OFFER the control; the mutation decides
    // whether to ALLOW it. If those two ever disagree the page grows a button that always refuses
    // (or hides one that would work), so each verdict is checked against the real guard.
    expect(await asTenant(t).mutation(api.vault.promoteToReference, { vaultDocId: memo })).toEqual({
      ok: false,
      reason: "ineligible",
    });
    expect(
      await asTenant(t).mutation(api.vault.promoteToReference, { vaultDocId: promoted }),
    ).toEqual({ ok: true, state: "already_promoted" });
    expect(
      await asTenant(t).mutation(api.vault.promoteToReference, { vaultDocId: eligible }),
    ).toEqual({ ok: true, state: "processing" });

    // …and the shelf reflects the transition on the next read, from the row's own fields.
    const after = await asTenant(t).query(api.content.artifactById, { vaultDocId: eligible });
    expect(after?.promotion).toEqual({ state: "promoted" });
    expect(after?.status).toBe("processing");
  });

  test("artifactById returns the same card the list returns", async () => {
    const t = convexTest(schema, modules);
    const id = await seedDoc(t, {
      kind: "created_document",
      createdAt: 10,
      origin: "agent",
      sourceThreadId: "thread-x",
    });
    const [fromList] = (await asTenant(t).query(api.content.listArtifacts, { limit: 10 })).items;
    const fromId = await asTenant(t).query(api.content.artifactById, { vaultDocId: id });
    expect(fromId).toEqual(fromList);
  });
});

const convexDir = dirname(fileURLToPath(import.meta.url));
const readContentSource = (): string => readFileSync(join(convexDir, "content.ts"), "utf8");

describe("Content shelf — read-only by construction (static scan)", () => {
  test("the module writes nothing: no db write, no scheduler, no audit row", () => {
    const src = readContentSource();
    // "Reuse opens the cockpit and never duplicates, attaches, sends or dispatches" is a property
    // of a module that CANNOT write, not of a handler that promises not to.
    expect(src, "content.ts writes to the database").not.toMatch(
      /ctx\.db\.(insert|patch|replace|delete)\(/,
    );
    expect(src, "content.ts schedules work").not.toMatch(/ctx\.scheduler\./);
    expect(src, "content.ts runs a mutation or action").not.toMatch(/ctx\.run(Mutation|Action)\(/);
    expect(src, "content.ts writes a log-plane row").not.toMatch(/audit\.log\b/);
  });

  test("every export is a tenantQuery — the module has no write surface to reach at all", () => {
    const exports = readContentSource().match(/export const \w+ = \w+\(/g) ?? [];
    expect(exports.length, "no exports found — the scan is vacuous").toBeGreaterThan(0);
    for (const declaration of exports) {
      expect(declaration, `${declaration} is not a tenantQuery`).toMatch(/= tenantQuery\($/);
    }
  });

  test("no signed URL is minted here, so none can be logged from here", () => {
    // The URL is a bearer capability (plans.ts's rule). Content hands the page a `vaultDocId` or a
    // `planId`; the two existing ownership-checked minters — `vault.vaultDownloadUrl` and
    // `media.reel` — stay the only places a URL comes into being.
    const src = readContentSource();
    expect(src, "content.ts mints a storage URL").not.toMatch(
      /storage\.(getUrl|generateUploadUrl)/,
    );
    expect(src, "content.ts puts a storageId on the wire").not.toMatch(/storageId:\s*doc\./);
  });

  test("the promotion side effect is not re-implemented here", () => {
    // 26-11 owner decision: `api.vault.promoteToReference` is the SINGLE promotion surface, and a
    // second copy of its guard is how one of the two paths ends up unguarded. This module reads
    // `origin` to decide what to OFFER and gets no closer than that — no ingest, no status flip.
    const src = readContentSource();
    expect(src, "content.ts starts an ingest").not.toMatch(/startIngest/);
    expect(src, "content.ts flips a promotion field").not.toMatch(/origin:\s*["']agent_promoted/);
  });
});
