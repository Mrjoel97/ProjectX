// The 15.3-08 document-identity guarantees (VALT-12), convex-test, ZERO spend.
//
// Four claims, each one describe block carrying the MUTATION that was actually run against it
// (`Mutation RUN:` — the vaultDigest.test.ts / vaultFolders.test.ts convention):
//   1. A user-set identity is NEVER overwritten by re-classification — AND the same call lands
//      when it is absent, or the guard would be satisfied by a mutation that never writes.
//   2. An unseeded classifier row degrades the LABEL, it never fails the document.
//   3. A string outside the closed union never reaches the schema's `v.union`.
//   4. The whole `ingestDoc` workflow, end to end, offline.
//
// ── Why every model call in here is free, and why the fixture text looks like that ──────────
// `ingestDoc` runs THREE paid steps over the same text — embedDoc, extractGraph, classifyDoc —
// so an offline document has to satisfy all three seams at once:
//   • `vaultRag.embedDoc`    — free on any `SMOKE::` prefix.
//   • `vaultLlm.extractGraph`— free ONLY on `SMOKE::graph::` at POSITION 0. Not negotiable.
//   • `vaultLlm.classifyDoc` — free on any `SMOKE::` prefix; DRIVEN by a `SMOKE::classify::`
//                              segment found anywhere in the text.
// Hence `fixture()` below: the graph sentinel FIRST because it is the one pinned to position 0,
// the classify sentinel on the next line. Reverse them and step (3) buys a real extraction call.
import { DOCUMENT_CLASSIFIER_SKILL } from "@pikar/contracts/skill";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import aggregateSchema from "../node_modules/@convex-dev/aggregate/src/component/schema.js";
import rateLimiterSchema from "../node_modules/@convex-dev/rate-limiter/src/component/schema.js";
import workflowSchema from "../node_modules/@convex-dev/workflow/src/component/schema.js";
import workpoolSchema from "../node_modules/@convex-dev/workpool/src/component/schema.js";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
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

/** A document that drives all three ingest seams offline. Graph sentinel FIRST (see the header). */
const fixture = (docType: string, identityLine: string) =>
  `SMOKE::graph::Acme|FY2025|covers\nSMOKE::classify::${docType}|${identityLine}`;

// The workflow's workpool schedules its steps through the scheduler; under real timers they fire
// after the suite and retry-loop against vitest's torn-down module runner (vaultExtract.test.ts:40).
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

/** rateLimiter for preCall/recordSpend, workflow + workpool for startIngest, auditCounts because
 *  `audit.log` maintains that aggregate and the governed paths write one. */
function harness() {
  const t = convexTest(schema, modules);
  t.registerComponent("auditCounts", aggregateSchema, aggregateModules);
  t.registerComponent("rateLimiter", rateLimiterSchema, rateLimiterModules);
  t.registerComponent("workflow", workflowSchema, workflowModules);
  t.registerComponent("workflow/workpool", workpoolSchema, workpoolModules);
  return t;
}

/** INFERRED from `harness()`, never `ReturnType<typeof convexTest>` — the bare form drops the
 *  schema generic, and `ctx.db.query("skills").withIndex(...)` then resolves against SystemIndexes
 *  and fails to typecheck. */
type Harness = ReturnType<typeof harness>;

/** Skill rows through the REAL `seedSkills`. NEVER a hand-written row and NEVER a pinned version:
 *  `seedSkills` inserts at v1/active only on an empty table and otherwise at `maxVersion + 1`, so a
 *  version literal in a test is a lie waiting to happen. `getActiveSkill` is the only correct read. */
async function seeded(): Promise<Harness> {
  const t = harness();
  await t.mutation(internal.skills.seedSkills, {});
  return t;
}

const asTenant = (t: Harness, tenantId: string) => t.withIdentity({ subject: tenantId });
const docRow = (t: Harness, id: Id<"vaultDocuments">) => t.run((ctx) => ctx.db.get(id));

/** Raw-insert a stored row (bypasses ingest) for the write-boundary tests. */
const seedDoc = (t: Harness, tenantId: string, text: string) =>
  t.run((ctx) =>
    ctx.db.insert("vaultDocuments", {
      tenantId,
      title: "acme-financials.txt",
      kind: "upload",
      category: "my-uploads",
      source: "upload",
      mimeType: "text/plain",
      size: 64,
      contentHash: `h-${tenantId}`,
      text,
      status: "ready",
      createdAt: Date.now(),
    }),
  );

/** Ingest ONE single-file document end to end and return its row. Deliberately the paste/upload
 *  mutation rather than a folder: the plan's claim is that a SINGLE-FILE upload is classified by
 *  the same step a folder member is, with no second code path. */
async function ingest(t: Harness, tenantId: string, text: string): Promise<Id<"vaultDocuments">> {
  const { vaultDocId } = await asTenant(t, tenantId).mutation(api.vault.vaultIngestText, { text });
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  return vaultDocId;
}

// ── 1. THE USER'S LABEL WINS, AND IT WINS AS AN ABSENCE ──────────────────────────────────────
//
// Mutation RUN: delete `if (doc.identityUserSet === true) return null;` from
// `vault.applyClassification` ->
//   • "survives re-classification byte-unchanged"  GOES RED (deep-equal diff on docType/identityLine)
//   • "with identityUserSet ABSENT the patch lands" STAYS GREEN
// The second test is why the first one means anything: a guard is trivially satisfiable by a
// mutation that writes nothing at all, and only the pair distinguishes "refuses to overwrite" from
// "never writes".
describe("a user-set identity is never overwritten (VALT-12)", () => {
  const TENANT = "tenant_userset";

  test("survives re-classification byte-unchanged", async () => {
    const t = harness();
    const vaultDocId = await seedDoc(t, TENANT, "some financial text");

    await asTenant(t, TENANT).mutation(api.vault.setDocIdentity, {
      vaultDocId,
      docType: "pnl",
      identityLine: "2025 P&L",
    });
    const before = await docRow(t, vaultDocId);
    expect(
      before?.identityUserSet,
      "setDocIdentity did not flag the row — the test below would be vacuous",
    ).toBe(true);

    // The classifier disagrees, on every field it can write.
    await t.mutation(internal.vault.applyClassification, {
      vaultDocId,
      tenantId: TENANT,
      docType: "invoice",
      identityLine: "an invoice from a vendor",
    });

    expect(await docRow(t, vaultDocId)).toEqual(before);
  });

  test("with identityUserSet ABSENT the patch lands", async () => {
    const t = harness();
    const vaultDocId = await seedDoc(t, TENANT, "some financial text");
    expect((await docRow(t, vaultDocId))?.identityUserSet).toBeUndefined();

    await t.mutation(internal.vault.applyClassification, {
      vaultDocId,
      tenantId: TENANT,
      docType: "invoice",
      identityLine: "an invoice from a vendor",
    });

    const after = await docRow(t, vaultDocId);
    expect(after?.docType).toBe("invoice");
    expect(after?.identityLine).toBe("an invoice from a vendor");
    // The classifier must NOT claim the row as user-set — only `setDocIdentity` sets that flag.
    expect(after?.identityUserSet).toBeUndefined();
  });
});

// ── 2. AN UNSEEDED CLASSIFIER DEGRADES THE LABEL, NOT THE DOCUMENT ───────────────────────────
//
// This is the test that stops an unseeded deployment failing every ingest it has. `getActiveSkill`
// is fail-closed BY CONTRACT everywhere else; inside `classifyDoc` the same throw would retry three
// times, fail the run, and `onIngestComplete` would mark the row `failed` — losing the embedding
// and the graph, and inflating the folder's failure count, for a cosmetic label.
//
// Mutation RUN: delete the `catch { return UNIDENTIFIED; }` from `vaultLlm.classifyDoc` ->
// status GOES RED (`failed`, and `ragEntryId` never written). See the summary for the real output.
describe("an unseeded classifier row degrades the label, never the document", () => {
  const TENANT = "tenant_unseeded";

  test("the document still reaches ready, carrying unclassified", async () => {
    const t = await seeded();
    // Remove ONLY the classifier's active row: `graph-extractor` stays seeded, because
    // `extractGraph` is fail-closed by contract and would fail the document first — which would
    // make this test green for entirely the wrong reason.
    await t.run(async (ctx) => {
      const row = await ctx.db
        .query("skills")
        .withIndex("by_name_status", (q) =>
          q.eq("name", DOCUMENT_CLASSIFIER_SKILL).eq("status", "active"),
        )
        .unique();
      if (row) await ctx.db.delete(row._id);
    });

    // The precondition, asserted rather than assumed: without it this test would pass just as well
    // against a fully seeded backend and would sample nothing.
    await expect(
      t.query(internal.skills.getActiveSkill, { name: DOCUMENT_CLASSIFIER_SKILL }),
    ).rejects.toThrow("NO_ACTIVE_SKILL");

    // The fixture NAMES `pnl`, so `unclassified` below can only come from the degraded path.
    const doc = await docRow(t, await ingest(t, TENANT, fixture("pnl", "2025 P&L")));

    expect(doc?.status).toBe("ready");
    expect(doc?.ragEntryId, "the workflow did not reach markReady").toBeTruthy();
    expect(doc?.docType).toBe("unclassified");
    expect(doc?.identityLine).toBe("");
  });
});

// ── 3. THE CLOSED UNION IS A TRUST BOUNDARY, NOT A REQUEST ───────────────────────────────────
//
// `classifySchema` sends `enum: [...DOC_TYPES]` to the provider, but a provider-side enum is a
// request. An out-of-union string reaching `applyClassification` throws "invalid argument" at the
// ARG VALIDATOR — inside the workflow, i.e. it fails the whole document, which is the exact outcome
// classifyDoc's try/catch exists to prevent. So the coercion is what keeps the schema honest.
//
// Mutation RUN: replace `isDocType(type) ? type : "unclassified"` in `smokeIdentityFixture` with a
// bare `type as DocType` -> docType GOES RED and so does `status`, because the invalid value then
// throws at applyClassification's validator and fails the run. Both halves are asserted below so
// the failure is legible either way.
describe("a string outside the closed union never reaches the database", () => {
  const TENANT = "tenant_coercion";

  test("an undefined docType is coerced to unclassified, and the document still lands", async () => {
    const t = await seeded();
    const doc = await docRow(
      t,
      await ingest(t, TENANT, fixture("financial_statement", "Acme FY2025 statement")),
    );

    expect(doc?.docType).toBe("unclassified");
    expect(doc?.docType).not.toBe("financial_statement");
    // The identity LINE is free prose and is kept — only the TYPE is closed.
    expect(doc?.identityLine).toBe("Acme FY2025 statement");
    expect(doc?.status).toBe("ready");
  });
});

// ── 4. OFFLINE END TO END, THROUGH THE WHOLE ingestDoc WORKFLOW ──────────────────────────────
//
// The other three blocks would all pass with the workflow step deleted (they assert `unclassified`
// / no-write). This one is the only place a REAL docType has to survive every step, so it is what
// proves classification is wired into ingest at all.
//
// Mutation RUN: delete the `classifyDoc` + `applyClassification` step from `vaultIngest.ingestDoc`
// -> this test AND the two ingest-driven blocks above all GO RED (`docType` reads `undefined`
// everywhere), while `ragEntryId`/`status` stay green — the rest of the workflow is untouched.
describe("classification runs inside ingest, offline, for a single-file upload", () => {
  const TENANT = "tenant_e2e";

  test("a driven fixture lands its type and identity line on the row", async () => {
    const t = await seeded();
    const doc = await docRow(t, await ingest(t, TENANT, fixture("pnl", "2025 P&L")));

    expect(doc?.status).toBe("ready");
    expect(doc?.ragEntryId, "the workflow did not reach markReady").toBeTruthy();
    expect(doc?.docType).toBe("pnl");
    expect(doc?.identityLine).toBe("2025 P&L");
    // Machine-set, so a later re-classification is still allowed to correct it.
    expect(doc?.identityUserSet).toBeUndefined();
  });
});
