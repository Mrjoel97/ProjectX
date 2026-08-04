// The 15.3-06 folder-digest guarantees, convex-test, ZERO spend.
//
// What this file is FOR: the digest must be RETRIEVABLE (not merely labelled), it must never be an
// input to itself, its staleness must be exact at folder scale, and it must say out loud what the
// folder could not read. Each guarantee is one describe block carrying the MUTATION that was
// actually run against it (`Mutation RUN:` — the guardrails.test.ts / vaultFolders.test.ts
// convention). A green suite that does not sample its own guarantee is the failure mode this
// feature is most exposed to, because its central risk is an ABSENCE.
//
// ── Why every model call in here is free ─────────────────────────────────────
// The folder NAME carries `SMOKE::digest::`, which lands in the assembled prompt and short-circuits
// synthesis to a deterministic fixture. That fixture's first line is `SMOKE::graph::…`, which in
// turn takes the free path through the digest's OWN ingest — `vaultRag.embedDoc` returns a fake
// entryId on any `SMOKE::` prefix and `vaultLlm.extractGraph` returns a fixture on `SMOKE::graph::`
// at position 0. So the whole chain (synthesis → embed → extract → markReady) runs offline.
//
// ── Why the ingest workflow is DRIVEN here and nowhere else in the repo ──────
// `ragEntryId != null` is the only observable that distinguishes a groundable digest from a
// silently dead one, and it is written by step 6 of `vaultIngest.ingestDoc`. Every other suite
// simulates that step by calling `internal.vault.markReady` by hand (vault.test.ts, vaultFolders
// .test.ts, vaultSealing.test.ts) — which would make the headline assertion VACUOUS here, since it
// would pass with the `startIngest` call deleted. So this file drives the real workflow to
// completion instead: fake timers + `finishAllScheduledFunctions(vi.runAllTimers)`. That is what
// makes mutation (a) below sample anything at all.
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import aggregateSchema from "../node_modules/@convex-dev/aggregate/src/component/schema.js";
import rateLimiterSchema from "../node_modules/@convex-dev/rate-limiter/src/component/schema.js";
import workflowSchema from "../node_modules/@convex-dev/workflow/src/component/schema.js";
import workpoolSchema from "../node_modules/@convex-dev/workpool/src/component/schema.js";
import { api, internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import schema from "./schema";

const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);
const aggregateModules = import.meta.glob(
  "../node_modules/@convex-dev/aggregate/src/component/**/!(*.test).ts",
);
const rateLimiterModules = import.meta.glob(
  "../node_modules/@convex-dev/rate-limiter/src/component/**/!(*.test).ts",
);
const workflowModules = import.meta.glob(
  "../node_modules/@convex-dev/workflow/src/component/**/!(*.test).ts",
);
const workpoolModules = import.meta.glob(
  "../node_modules/@convex-dev/workpool/src/component/**/!(*.test).ts",
);

type Harness = ReturnType<typeof convexTest>;

/** THE sentinel, carried in the folder NAME so it reaches the prompt whatever the members are —
 *  a folder whose only member FAILED contributes no excerpt at all. */
const SMOKE = "SMOKE::digest::";

// The workflow's workpool schedules its steps through the scheduler; under real timers they fire
// after the suite and retry-loop against vitest's torn-down module runner (vaultExtract.test.ts:40).
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

/** rateLimiter for preCall/recordSpend, workflow + workpool for startIngest. Mandatory here. */
function budgetHarness(): Harness {
  const t = convexTest(schema, modules);
  // `audit.log` maintains the auditCounts aggregate (audit.ts:40) and the digest's refusal branch
  // writes one, so this component is mandatory here too or the REAL insert path throws.
  t.registerComponent("auditCounts", aggregateSchema, aggregateModules);
  t.registerComponent("rateLimiter", rateLimiterSchema, rateLimiterModules);
  t.registerComponent("workflow", workflowSchema, workflowModules);
  t.registerComponent("workflow/workpool", workpoolSchema, workpoolModules);
  return t;
}

/**
 * A harness with the `folder-digest` (and `graph-extractor`) rows seeded through the REAL
 * `seedSkills`. Never a hand-written skills row and NEVER a pinned version: `seedSkills` inserts at
 * v1/active only on an empty table and otherwise at `maxVersion + 1`, so a version literal in a
 * test is a lie waiting to happen. `getActiveSkill` is the only correct read.
 */
async function seeded(): Promise<Harness> {
  const t = budgetHarness();
  await t.mutation(internal.skills.seedSkills, {});
  return t;
}

const asTenant = (t: Harness, tenantId: string) => t.withIdentity({ subject: tenantId });

const folderRow = (t: Harness, folderId: Id<"vaultFolders">) =>
  t.run((ctx) => ctx.db.get(folderId));
const docRow = (t: Harness, docId: Id<"vaultDocuments">) => t.run((ctx) => ctx.db.get(docId));

/** Scheduled digest builds. convex-test leaves a `scheduler.runAfter` entry pending, so the wiring
 *  is asserted HERE and the action is then invoked directly (vaultFolders.test.ts:131-139). */
const scheduledDigests = (t: Harness) =>
  t.run(async (ctx) =>
    (await ctx.db.system.query("_scheduled_functions").collect()).filter((s) =>
      /buildFolderDigest/.test(s.name),
    ),
  );

type MemberSpec = { title: string; status: "ready" | "failed" | "processing"; reason?: string };

const seedFolder = (
  t: Harness,
  tenantId: string,
  opts: { status: Doc<"vaultFolders">["status"]; memberCount: number; terminalCount?: number },
) =>
  t.run((ctx) =>
    ctx.db.insert("vaultFolders", {
      tenantId,
      name: `${SMOKE} Acme onboarding`,
      source: "upload" as const,
      status: opts.status,
      memberCount: opts.memberCount,
      terminalCount: opts.terminalCount ?? opts.memberCount,
      failedCount: 0,
      reservedCents: 0,
      spentCents: 0,
      createdAt: Date.now(),
    }),
  );

const seedMember = (
  t: Harness,
  tenantId: string,
  folderId: Id<"vaultFolders">,
  m: MemberSpec,
): Promise<Id<"vaultDocuments">> =>
  t.run((ctx) =>
    ctx.db.insert("vaultDocuments", {
      tenantId,
      title: m.title,
      kind: "upload",
      category: "my-uploads",
      source: "upload",
      mimeType: "text/plain",
      size: 32,
      contentHash: `h-${tenantId}-${m.title}`,
      text: `${m.title} body text`,
      status: m.status,
      ...(m.reason ? { failureReason: m.reason } : {}),
      folderId,
      createdAt: Date.now(),
    }),
  );

/** Build the digest AND drive its ingest workflow to completion (the reason this file exists). */
async function build(
  t: Harness,
  tenantId: string,
  folderId: Id<"vaultFolders">,
  rebuild?: boolean,
) {
  const result = await t.action(internal.vaultDigest.buildFolderDigest, {
    tenantId,
    folderId,
    ...(rebuild ? { rebuild: true } : {}),
  });
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  return result;
}

const digestOf = async (t: Harness, folderId: Id<"vaultFolders">) => {
  const folder = await folderRow(t, folderId);
  const id = folder?.digestDocId;
  return { folder, digestDocId: id, digest: id ? await docRow(t, id) : null };
};

const stateOf = (t: Harness, tenantId: string, folderId: Id<"vaultFolders">) =>
  asTenant(t, tenantId).query(api.vaultDigest.folderDigestState, { folderId });

// ── 1. GROUNDABILITY — the assertion that matters ────────────────────────────
//
// Mutation RUN (this is the plan's own objective, run rather than reasoned about): delete the
// `await startIngest(...)` call from `vaultDigest.writeDigest` ->
//   • `origin === "folder_digest"`  STAYS GREEN   (the literal is inert; nothing reads it)
//   • `ragEntryId != null`          GOES RED      (nothing ever embedded the row)
//   • `vaultGroundHydrated` still RETURNS the doc — because the offline SMOKE:: seam resolves seed
//     ids straight out of `ownedDocsMeta` and never touches the embedding index. So grounding is
//     the SECONDARY check here and `ragEntryId` is the primary one; both are on the page, and the
//     comment says which is load-bearing. The real-vector path would go red too, but it cannot be
//     exercised without spending.
describe("the digest is groundable — and the origin literal proves nothing", () => {
  const TENANT = "tenant_digest_ground";

  test("a completed folder synthesises a digest that carries a ragEntryId", async () => {
    const t = await seeded();
    const folderId = await seedFolder(t, TENANT, {
      status: "ingesting",
      memberCount: 1,
      terminalCount: 0,
    });
    const member = await seedMember(t, TENANT, folderId, {
      title: "Handbook",
      status: "processing",
    });

    // The REAL completion transition: the last member goes terminal -> bumpFolder -> tryComplete.
    await t.mutation(internal.vault.markReady, { vaultDocId: member, ragEntryId: "entry_member" });
    expect(await folderRow(t, folderId)).toMatchObject({ status: "complete", terminalCount: 1 });

    // The wiring plan 04 left a slot for. convex-test never executes this entry, so it is asserted
    // as a row and the action is invoked directly below.
    expect(await scheduledDigests(t)).toHaveLength(1);

    const result = await build(t, TENANT, folderId);
    expect(result).toMatchObject({ ok: true, memberCount: 1, unreadableCount: 0 });

    const { folder, digestDocId, digest } = await digestOf(t, folderId);
    expect(digestDocId).toBeDefined();
    expect(folder?.digestBuiltAt).toBeGreaterThan(0);

    // ── THE TWO ASSERTIONS, SIDE BY SIDE ────────────────────────────────────
    // (i) the INERT literal. It excludes nothing, includes nothing, and is read by no predicate
    //     anywhere in retrieval. This line is what stays green when the feature is dead.
    expect(digest?.origin).toBe("folder_digest");
    // (ii) the OBSERVABLE check. Written by step 6 of the ingest workflow, which only runs because
    //      `writeDigest` called `startIngest`. THIS is the guarantee.
    expect(digest?.ragEntryId).toBeDefined();
    expect(digest?.status).toBe("ready");

    // …and it comes back through the normal retrieval rails, unsealed (it has no folderId, so
    // `vaultFolders.sealedIn` can never hold it).
    const ground = await t.action(internal.vaultGround.vaultGroundHydrated, {
      tenantId: TENANT,
      query: `SMOKE::${digestDocId}`,
    });
    expect(ground.docIds).toContain(digestDocId);

    // POSITIVE CONTROL for the "inert literal" claim: the digest is a first-class vault document
    // on every axis the rest of the vault reads — markdown, agent-sourced, workspace-docs.
    expect(digest).toMatchObject({
      kind: "folder_digest",
      mimeType: "text/markdown",
      source: "agent",
      category: "workspace-docs",
    });
  });

  test("an unseeded registry fails the build CLOSED — no hardcoded fallback prompt (§5)", async () => {
    // Positive control for the skill load: the same folder builds fine once `seedSkills` has run
    // (every other test in this file), and refuses here. No `folder-digest` row -> no digest.
    const t = budgetHarness(); // deliberately NOT seeded
    const folderId = await seedFolder(t, "tenant_digest_unseeded", {
      status: "complete",
      memberCount: 1,
    });
    await seedMember(t, "tenant_digest_unseeded", folderId, { title: "Handbook", status: "ready" });

    await expect(
      t.action(internal.vaultDigest.buildFolderDigest, {
        tenantId: "tenant_digest_unseeded",
        folderId,
      }),
    ).rejects.toThrow(/NO_ACTIVE_SKILL/);
    expect((await folderRow(t, folderId))?.digestDocId).toBeUndefined();
  });
});

// ── 2. NON-RECURSION ─────────────────────────────────────────────────────────
//
// Mutation RUN: add `folderId,` to the `ctx.db.insert("vaultDocuments", …)` in
// `vaultDigest.writeDigest` (the "it belongs to the folder, surely" instinct) -> RED. The digest
// becomes a `ready` member of its own folder that is not in `digestSourceDocIds`, so the stale
// count reads 1 the moment the build finishes and the Rebuild banner fires forever — each rebuild
// creating exactly the row that keeps it firing.
describe("a digest is never an input to itself", () => {
  const TENANT = "tenant_digest_recursion";

  test("no folderId, not in its own source set, and zero stale immediately after a build", async () => {
    const t = await seeded();
    const folderId = await seedFolder(t, TENANT, { status: "complete", memberCount: 2 });
    const a = await seedMember(t, TENANT, folderId, { title: "Contract A", status: "ready" });
    const b = await seedMember(t, TENANT, folderId, { title: "Contract B", status: "ready" });

    await build(t, TENANT, folderId);
    const { folder, digestDocId, digest } = await digestOf(t, folderId);

    // THE guard, and it is an ABSENT FIELD rather than a predicate: with no `folderId` the digest
    // cannot enter `by_tenant_folder` at all, so no query anywhere needs to know about it.
    expect(digest?.folderId).toBeUndefined();
    expect(folder?.digestSourceDocIds).not.toContain(digestDocId);
    expect(folder?.digestSourceDocIds).toEqual([a, b]);

    // POSITIVE CONTROL for that absence: the member rows DO carry the folderId, so the query the
    // digest is being kept out of genuinely reads them (otherwise "not counted" would be free).
    expect((await docRow(t, a))?.folderId).toBe(folderId);
    expect(await stateOf(t, TENANT, folderId)).toEqual({ state: "fresh", unincorporatedCount: 0 });
  });
});

// ── 3. STALENESS FIRES AND CLEARS ────────────────────────────────────────────
//
// NOTE ON THE GENERATOR: a member cannot be added to a completed folder through any shipped path
// (`vault.ts:205-211` — members may only be added while the folder is `reserving`). The ONE real
// way a complete folder gains a `ready` member is a member that was FAILED at completion and is
// later rescued (`vaultSweep.retryExtraction`). That is what is simulated here, via the terminal
// mutation the rescue ends in — not a raw insert, which would test a state the app cannot reach.
//
// Mutation RUN: drop `!sourceSet.has(doc._id)` from `unincorporatedForFolder`'s filter -> RED, the
// count reads 2 (then 3) instead of 0/1 — every ready member is "unincorporated" forever.
describe("staleness fires on a new ready member and clears on rebuild", () => {
  const TENANT = "tenant_digest_stale";

  test("build -> 0, rescue a failed member -> 1, rebuild -> 0", async () => {
    const t = await seeded();
    const folderId = await seedFolder(t, TENANT, { status: "complete", memberCount: 3 });
    await seedMember(t, TENANT, folderId, { title: "Deck", status: "ready" });
    await seedMember(t, TENANT, folderId, { title: "Notes", status: "ready" });
    const broken = await seedMember(t, TENANT, folderId, {
      title: "Scan.pdf",
      status: "failed",
      reason: "unsupported_format",
    });

    await build(t, TENANT, folderId);
    const first = await digestOf(t, folderId);
    expect(first.folder?.digestSourceDocIds).toHaveLength(2); // the two READY members only
    expect(await stateOf(t, TENANT, folderId)).toEqual({ state: "fresh", unincorporatedCount: 0 });

    // The rescue lands. `countTerminal` early-returns (the prior status was already terminal), so
    // the folder's counters stay history and ONLY the stale set moves.
    await t.mutation(internal.vault.markReady, { vaultDocId: broken, ragEntryId: "entry_rescued" });
    expect(await folderRow(t, folderId)).toMatchObject({ terminalCount: 3, memberCount: 3 });
    expect(await stateOf(t, TENANT, folderId)).toEqual({ state: "stale", unincorporatedCount: 1 });

    // NOTHING has spent a cent to learn that: the state read is a pure diff and nothing reacts to
    // it. The rebuild is the user's click, and it SCHEDULES the action (a mutation cannot run one).
    const before = await scheduledDigests(t);
    expect(await asTenant(t, TENANT).mutation(api.vaultDigest.rebuildDigest, { folderId })).toEqual(
      {
        ok: true,
      },
    );
    expect((await scheduledDigests(t)).length).toBe(before.length + 1);

    await build(t, TENANT, folderId, true);
    expect(await stateOf(t, TENANT, folderId)).toEqual({ state: "fresh", unincorporatedCount: 0 });

    // ONE digest document for one folder, patched in place — a second groundable digest would keep
    // answering with the stale synthesis.
    const second = await digestOf(t, folderId);
    expect(second.digestDocId).toBe(first.digestDocId);
    expect(second.folder?.digestSourceDocIds).toHaveLength(3);
    expect(
      await t.run((ctx) =>
        ctx.db
          .query("vaultDocuments")
          .filter((q) => q.eq(q.field("kind"), "folder_digest"))
          .collect(),
      ),
    ).toHaveLength(1);
  });
});

// ── 4. SCAN-CAP SUFFICIENCY — the test that exposes the real risk ────────────
//
// Mutation RUN: replace `.take(folder.memberCount + 1)` with `.take(100)` in
// `unincorporatedForFolder` (blueprint's `DRIFT_SCAN_CAP`, cloned verbatim as the plan warns) ->
// RED. The scan stops at the 100th member, the five stale rows sit at indices 115-119 of the
// `by_tenant_folder` index (which orders by _creationTime within the folder), and the count reads
// 0 — a silent, permanent "your digest is up to date" over a digest that is not.
describe("staleness is exact at folder scale, not bounded by the global drift cap", () => {
  const TENANT = "tenant_digest_cap";
  const DRIFT_SCAN_CAP = 100; // blueprint.ts:43 — module-private there, so it is restated here
  const MEMBERS = DRIFT_SCAN_CAP + 20;
  const STALE = 5;

  test(`${MEMBERS} members, the LAST ${STALE} unincorporated: the count is exactly ${STALE}`, async () => {
    const t = await seeded();
    const folderId = await seedFolder(t, TENANT, { status: "complete", memberCount: MEMBERS });

    // Insert order IS index order under `by_tenant_folder` (["tenantId","folderId"] + _creationTime),
    // so the five that will go stale are the five a 100-row scan can never see.
    const late: Id<"vaultDocuments">[] = [];
    for (let i = 0; i < MEMBERS; i++) {
      const willBeStale = i >= MEMBERS - STALE;
      const id = await seedMember(t, TENANT, folderId, {
        title: `m${i}`,
        status: willBeStale ? "failed" : "ready",
        ...(willBeStale ? { reason: "extraction_stalled" } : {}),
      });
      if (willBeStale) late.push(id);
    }

    await build(t, TENANT, folderId);
    expect((await folderRow(t, folderId))?.digestSourceDocIds).toHaveLength(MEMBERS - STALE);
    expect(await stateOf(t, TENANT, folderId)).toEqual({ state: "fresh", unincorporatedCount: 0 });

    for (const id of late) {
      await t.mutation(internal.vault.markReady, { vaultDocId: id, ragEntryId: `entry-${id}` });
    }

    // EXACTLY 5. Not 0 (a `.take(100)` clone), not "some" — the drill-in renders these ids.
    expect(await stateOf(t, TENANT, folderId)).toEqual({
      state: "stale",
      unincorporatedCount: STALE,
    });
  });
});

// ── 5. PART 3 OF THE CONTRACT IS PRESENT ─────────────────────────────────────
//
// The honest-manifest promise lives in the ARTIFACT the agent reads, not only in the UI. Offline
// this is provable only through the SMOKE fixture — which is derived from the SAME projected
// member metadata the real prompt carries (not a parsed grammar), so the assertion is not vacuous:
// if the projection stopped carrying `failureReason`, or stopped listing non-ready members at all,
// this goes red.
//
// Mutation RUN: drop the `failureReason` field from `digestMembersPage`'s projection -> RED, the
// digest names the document but reports the bare status instead of the reason the manifest gives.
describe("the digest states what the folder could NOT read", () => {
  const TENANT = "tenant_digest_part3";

  test("a failed member is named in the digest text, with its reason", async () => {
    const t = await seeded();
    const folderId = await seedFolder(t, TENANT, { status: "complete", memberCount: 2 });
    await seedMember(t, TENANT, folderId, { title: "Readable memo", status: "ready" });
    await seedMember(t, TENANT, folderId, {
      title: "Corrupt scan.pdf",
      status: "failed",
      reason: "unsupported_format",
    });

    const result = await build(t, TENANT, folderId);
    expect(result).toMatchObject({ ok: true, memberCount: 2, unreadableCount: 1 });

    const { digest } = await digestOf(t, folderId);
    const text = digest?.text ?? "";
    expect(text).toContain("Corrupt scan.pdf");
    expect(text).toContain("unsupported_format");

    // POSITIVE CONTROL — "names the unreadable one" must not be "names everything indiscriminately":
    // the readable member appears in part 1 and NOT in part 3.
    const partThree = text.slice(text.indexOf("could not be read"));
    expect(partThree).toContain("Corrupt scan.pdf");
    expect(partThree).not.toContain("Readable memo");
    expect(text).toContain("Readable memo");
  });
});

// ── 6. THE ADVERSARIAL REPAIRS (15.3-06 verify pass) ─────────────────────────
//
// Three defects the adversarial pass found in the first cut of this plan, each now guarded. They
// share a theme worth naming: ALL THREE are consequences of the digest deliberately having no
// `folderId`. That absence is the recursion guard and it is correct — but it also means the digest
// is invisible to every mechanism that finds work by folder membership.

describe("the digest dies with its folder (cancel of a COMPLETE folder)", () => {
  const TENANT = "tenant_digest_cancel";

  // `cancelFolder` has no status guard, so the one kind of folder that HAS a digest is cancellable.
  // `walkFolderMembers` keys on `folderId`, which the digest does not carry, so nothing else can
  // reach it.
  //
  // Mutation RUN: delete the `deleteVaultDoc` call from `cancelFolder` -> RED. The digest survives
  // as a ready, embedded, groundable document describing a folder that no longer exists, with no
  // pointer left to it anywhere.
  test("cancelling a complete folder removes its digest, not just the folder row", async () => {
    const t = await seeded();
    const folderId = await seedFolder(t, TENANT, { status: "complete", memberCount: 1 });
    await seedMember(t, TENANT, folderId, { title: "Handbook", status: "ready" });

    await build(t, TENANT, folderId);
    const { digestDocId } = await digestOf(t, folderId);
    expect(digestDocId).toBeDefined();
    // NON-VACUITY: it really is a live, embedded, groundable row before the cancel.
    expect(await docRow(t, digestDocId as Id<"vaultDocuments">)).toMatchObject({
      status: "ready",
      origin: "folder_digest",
    });
    expect((await docRow(t, digestDocId as Id<"vaultDocuments">))?.ragEntryId).toBeDefined();

    // TEST-SEAM ONLY, and it does not weaken what is under test. The offline embed hands back a
    // `smoke::<hash>` sentinel, which is not an id of the rag component's `entries` table, so the
    // `rag.deleteAsync` half of `deleteVaultDoc`'s cascade rejects it with a validator error that
    // could never happen against a real entry id. The guarantee here is that CANCEL REACHES THE
    // DIGEST AT ALL; the rag/graph cascade itself is `deleteVaultDoc`'s own contract and is covered
    // in vault.test.ts. Clearing the sentinel first keeps this test about the former.
    await t.run((ctx) =>
      ctx.db.patch(digestDocId as Id<"vaultDocuments">, { ragEntryId: undefined }),
    );

    expect(await asTenant(t, TENANT).mutation(api.vaultFolders.cancelFolder, { folderId })).toEqual(
      { ok: true },
    );
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    expect(await folderRow(t, folderId)).toBeNull();
    expect(await docRow(t, digestDocId as Id<"vaultDocuments">)).toBeNull();

    // The ordinary member is UNTOUCHED — cancel turns members into folder-less documents, and this
    // repair must not have widened into deleting them.
    const survivors = await t.run((ctx) => ctx.db.query("vaultDocuments").collect());
    expect(survivors.map((d) => d.title)).toEqual(["Handbook"]);
  });
});

describe("a refused digest build is never silent", () => {
  const TENANT = "tenant_digest_refused";

  // The build is reached by `scheduler.runAfter` from `tryComplete`, which discards the return
  // value. A budget refusal therefore left NO trace: `digestBuiltAt` unset (so the `already_built`
  // belt does not apply and nothing retries) and the folder reading `complete` with no digest —
  // indistinguishable from a digest that was never attempted.
  //
  // Mutation RUN: delete the `audit.log` call from the `!gate.ok` branch -> RED.
  test("a budget refusal writes one refs-only audit row", async () => {
    const t = await seeded();
    const folderId = await seedFolder(t, TENANT, { status: "complete", memberCount: 1 });
    await seedMember(t, TENANT, folderId, { title: "Handbook", status: "ready" });

    // Drain the ingest window so `preCall` refuses on the rail the digest actually charges.
    // `recordSpend` uses `reserve: true`, so one oversized entry drives the window negative and
    // the NEXT `preCall` fails closed — the same mechanism real spend uses, not a test-only door.
    await t.mutation(internal.guardrails.recordSpend, {
      tenantId: TENANT,
      costUsd: 999,
      rail: "ingest",
    });

    const result = await build(t, TENANT, folderId);
    expect(result).toMatchObject({ ok: false });
    expect((result as { reason?: string }).reason).toBeDefined();

    // No digest, and the folder is honest about it.
    expect((await folderRow(t, folderId))?.digestDocId).toBeUndefined();

    const rows = await t.run((ctx) =>
      ctx.db
        .query("audit")
        .filter((q) => q.eq(q.field("eventType"), "folder.digest_refused"))
        .collect(),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ tenantId: TENANT, actor: "system" });
    // §4 — refs, ids and counts ONLY. No title, no text, no member name.
    expect(Object.keys(rows[0].payload as object).sort()).toEqual([
      "folderId",
      "memberCount",
      "reason",
    ]);
  });
});

describe("the staleness read is bounded by BYTES, not only by rows", () => {
  const TENANT = "tenant_digest_bytes";

  // `.take(memberCount + 1)` bounds ROWS. Convex has no projection, so each row arrives with its
  // whole `text` (up to 400k chars) — a few hundred max-size members is ~120 MB against a 16 MiB
  // per-transaction cap, and this runs inside `folderDigestState`, the drill-in BANNER read. The
  // failure mode was the folder page THROWING, not a wrong number.
  //
  // Mutation RUN: restore `.take(folder.memberCount + 1)` in place of the streaming loop ->
  // this test reports 3 instead of 2, i.e. the byte budget is provably what stops the scan.
  test("the scan stops on the byte budget and the page still renders", async () => {
    const t = await seeded();
    const folderId = await seedFolder(t, TENANT, { status: "complete", memberCount: 3 });
    await seedMember(t, TENANT, folderId, { title: "Seed", status: "ready" });
    await build(t, TENANT, folderId);
    expect(await stateOf(t, TENANT, folderId)).toEqual({ state: "fresh", unincorporatedCount: 0 });

    // Three NEW members, each carrying 5 MiB of text against an 8 MiB budget: rows 1 and 2 are
    // read (the budget is checked BEFORE the row is added, so row 2 still gets in at 5 MiB) and
    // the scan stops before row 3.
    const fat = "x".repeat(5 * 1024 * 1024);
    for (const title of ["Fat A", "Fat B", "Fat C"]) {
      await t.run((ctx) =>
        ctx.db.insert("vaultDocuments", {
          tenantId: TENANT,
          title,
          kind: "upload",
          category: "my-uploads",
          source: "upload",
          mimeType: "text/plain",
          size: fat.length,
          contentHash: `h-${title}`,
          text: fat,
          status: "ready",
          folderId,
          createdAt: Date.now(),
        }),
      );
    }

    // It RETURNS — that is the headline. And it under-reports by design rather than throwing.
    expect(await stateOf(t, TENANT, folderId)).toEqual({ state: "stale", unincorporatedCount: 2 });
  });
});
