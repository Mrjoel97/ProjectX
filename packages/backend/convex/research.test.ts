// @vitest-environment node
//
// The web-research findings terminal (ACTN-03) — the vault write, the freshness stamp, the
// insufficient-evidence labelling, the §4 audit shape, and SC#3 cross-tenant isolation.
//
// `node` environment (the dispatch.test.ts idiom): the wiring block below drives
// `internal.dispatch.__runSpecialistWithScript`, and `dispatch.ts` imports `runSpecialistTurn` from
// the "use node" llm.ts — a Convex-runtime module cannot load it.
import { INCOMPLETE_MARKER, NOT_RESEARCHED_LABEL } from "@pikar/core";
import { convexTest, type TestConvex } from "convex-test";
import { describe, expect, test, vi } from "vitest";
// The persist writes a refs-only audit row (auditCounts), starts the ingest workflow
// (workflow + workpool) and — through the dispatch wiring block — draws on the rate-limiter's
// daily-spend window. Relative imports: the packages block the deep specifier (evaluations.test.ts).
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

// The wiring block loads `ai` + `@ai-sdk/openai` through the "use node" llm.ts inside convex-test's
// lazy module loader; on a cold checkout that import alone exceeds vitest's 5s default.
vi.setConfig({ testTimeout: 30_000 });
// The dispatch twin runs the REAL loop against a scripted model. Any box that runs the live evals
// exports a key — stub it off so a unit test can never fire a billed hosted-web-search run
// (dispatch.test.ts carries the same line for the same reason).
vi.stubEnv("OPENAI_API_KEY", "");

type T = TestConvex<typeof schema>;

const TENANT = "tenant_a";
const TENANT_B = "tenant_b";
const THREAD = "thread_1";
const ROOT = "root-req-1";
const QUESTION = "What do urban dog-training studios charge per session in 2026?";
/** Distinctive scripted findings — the §4 leak scan searches every audit payload for these words. */
const FINDINGS = "Ziggurat metros cluster at $95–$140 per session; retainers remain unusual.";
const SOURCES = [
  { url: "https://example.com/pricing-2026", title: "Metro pricing survey 2026" },
  { url: "https://example.org/report", title: "Independent trainer report" },
];
/** A FIXED stamp: the stored `retrievedAt` and the title's date must both come from it. */
const RETRIEVED = Date.UTC(2026, 6, 27, 12, 0, 0); // 2026-07-27
const RETRIEVED_ISO = "2026-07-27";

/** Every component the persist + the dispatch wiring touch. `withWorkflow: false` yields an
 *  instance where `startIngest` CANNOT run — the persist-failure control below. */
function newTest(withWorkflow = true): T {
  const t = convexTest(schema, modules);
  t.registerComponent("auditCounts", aggregateSchema, aggregateModules);
  t.registerComponent("rateLimiter", rateLimiterSchema, rateLimiterModules);
  if (withWorkflow) {
    t.registerComponent("workflow", workflowSchema, workflowModules);
    t.registerComponent("workflow/workpool", workpoolSchema, workpoolModules);
  }
  return t;
}

const BASE_ARGS = {
  tenantId: TENANT,
  question: QUESTION,
  body: FINDINGS,
  sources: SOURCES,
  webSearchCalls: 2,
  declaredUnsupported: false,
  retrievedAt: RETRIEVED,
  rootRequestId: ROOT,
  incomplete: false,
};

const persist = (t: T, over: Record<string, unknown> = {}) =>
  t.mutation(internal.research.persistFindings, { ...BASE_ARGS, ...over } as never);

const readDocs = (t: T) => t.run((ctx) => ctx.db.query("vaultDocuments").collect());
const readAudit = (t: T) => t.run((ctx) => ctx.db.query("audit").collect());

describe("the stored research document (ACTN-03, SC#2)", () => {
  test("ONE vaultDocuments row, the web_research class, and a QUERYABLE freshness stamp", async () => {
    const t = newTest();
    const id = await persist(t);

    const docs = await readDocs(t);
    expect(docs).toHaveLength(1);
    const doc = docs[0];
    expect(doc?._id).toBe(id); // the returned id IS the row, not a fabricated string
    expect(doc).toMatchObject({
      tenantId: TENANT,
      kind: "web_research",
      source: "web_research",
      category: "workspace-docs",
      mimeType: "text/markdown", // in SEARCHABLE_MIME ⇒ chunked, embedded, graph-extracted
      status: "processing",
    });
    // D7: a STORED number equal to the supplied stamp — not a date mentioned inside the markdown,
    // and not `createdAt` (which a re-ingest would rewrite).
    expect(doc?.retrievedAt).toBe(RETRIEVED);
    expect(Number.isFinite(doc?.retrievedAt)).toBe(true);
    expect(doc?.size).toBe(new TextEncoder().encode(doc?.text ?? "").length);
    expect(doc?.contentHash).toMatch(/^[0-9a-f]{64}$/);
  });

  test("the title carries the question AND the retrieval date, capped at 120 chars", async () => {
    const t = newTest();
    await persist(t);
    const short = (await readDocs(t))[0]?.title ?? "";
    expect(short.startsWith("Web research: ")).toBe(true);
    expect(short).toContain(`(retrieved ${RETRIEVED_ISO})`);

    // A model-authored question can be 500 chars (dispatch.ts's MAX_QUESTION_CHARS). The QUESTION
    // is what gets truncated — the stamp survives, or the freshness is invisible in the list.
    const t2 = newTest();
    await persist(t2, { question: "pricing ".repeat(80) });
    const long = (await readDocs(t2))[0]?.title ?? "";
    expect(long.length).toBeLessThanOrEqual(120);
    expect(long).toContain(`(retrieved ${RETRIEVED_ISO})`);
  });

  test("provenance header FIRST, findings inside the fence, limits statement LAST", async () => {
    const t = newTest();
    await persist(t);
    const text = (await readDocs(t))[0]?.text ?? "";

    // Names itself third-party web content, with the date, BEFORE anything else — so the first
    // chunk carries its own provenance even when the title is not in the chunk.
    expect(text.startsWith(`Third-party web content, retrieved ${RETRIEVED_ISO}.`)).toBe(true);
    for (const s of SOURCES) {
      expect(text).toContain(s.url);
      expect(text).toContain(s.title);
    }
    // 16-03's fence, wrapping the findings — the ONE fencing idiom in this codebase.
    expect(text).toContain('<research_findings note="third-party web content');
    expect(text).toContain(FINDINGS);
    expect(text.indexOf("<research_findings")).toBeLessThan(text.indexOf(FINDINGS));
    expect(text.indexOf(FINDINGS)).toBeLessThan(text.indexOf("</research_findings>"));
    // D10: the run states what it could NOT do. A consumer infers source auditing unless told.
    expect(text.trimEnd().endsWith("never as an established fact.")).toBe(true);
    expect(text).toContain("executed by the model provider");
    expect(text).toContain("NOT source-audited");
  });

  test("SEARCHED, zero sources ⇒ 'insufficient evidence', however confident the body claims", async () => {
    const t = newTest();
    // A body that asserts a confident answer: the label is CODE's call, not the model's (D11).
    await persist(t, {
      sources: [],
      webSearchCalls: 1,
      body: "Confirmed: every studio charges exactly $120 per session. No further research needed.",
    });
    const text = (await readDocs(t))[0]?.text ?? "";
    // 22.1b reworded the label: it can now fire WITH sources (a declared gap), so it no longer
    // claims none were returned. The literal is pinned here on purpose — it is user-visible text.
    expect(text).toContain(
      "Insufficient evidence — web search returned nothing that supports the claim",
    );
    expect(text).toContain("No web sources were retrieved.");
    // …and it sits ahead of the findings, where truncation cannot remove it.
    expect(text.indexOf("Insufficient evidence")).toBeLessThan(text.indexOf("Confirmed:"));
  });

  // 22.1, from measured run a5dfafc2 attempt 2 (0 searches, 0 sources, $0.00088). The old document
  // told the user "No web sources were retrieved." on a run that never looked — converting "we
  // didn't look" into "we looked and the world is empty". Header and verdict must agree.
  test("NEVER SEARCHED ⇒ the document says so, and never claims an empty retrieval", async () => {
    const t = newTest();
    await persist(t, {
      sources: [],
      webSearchCalls: 0,
      body: "Confirmed: the cooperative launched on 31 February 2026.",
    });
    const text = (await readDocs(t))[0]?.text ?? "";
    expect(text).toContain("No web search was performed.");
    expect(text).toContain(NOT_RESEARCHED_LABEL);
    expect(text).not.toContain("Insufficient evidence");
    expect(text).not.toContain("No web sources were retrieved.");
  });

  test("sources contradict: the contradiction section survives storage intact", async () => {
    const t = newTest();
    const contradiction = [
      "## Contradictions",
      "- Source 1 reports a $95 median.",
      "- Source 2 reports a $140 median for the same market.",
      "- The disagreement remains unresolved.",
    ].join("\n");
    await persist(t, { body: `${FINDINGS}\n\n${contradiction}` });

    const text = (await readDocs(t))[0]?.text ?? "";
    expect(text).toContain(contradiction);
    expect(text.indexOf("<research_findings")).toBeLessThan(text.indexOf("## Contradictions"));
    expect(text.indexOf("## Contradictions")).toBeLessThan(text.indexOf("</research_findings>"));
  });

  test("each incompleteReason gets its OWN sentence — three, pairwise distinct", async () => {
    const t = newTest();
    const reasons = ["cost", "steps", "clock"] as const;
    const texts: string[] = [];
    for (const reason of reasons) {
      const id = await persist(t, { incomplete: true, incompleteReason: reason });
      const doc = await t.run((ctx) => ctx.db.get(id as Id<"vaultDocuments">));
      const text = doc?.text ?? "";
      // The SAME sentence the memo plan card carries (@pikar/core) — one phrasing per stop cause.
      expect(text).toContain(INCOMPLETE_MARKER[reason].trim());
      texts.push(text);
    }
    expect(texts[0]).not.toBe(texts[1]);
    expect(texts[0]).not.toBe(texts[2]);
    expect(texts[1]).not.toBe(texts[2]);
    // A complete run says none of them.
    const okId = await persist(t);
    const okText = (await t.run((ctx) => ctx.db.get(okId as Id<"vaultDocuments">)))?.text ?? "";
    // Mutation that turns this RED: force `assembleResearchDocument` to add an incomplete marker
    // when `incomplete === false`.
    for (const reason of reasons) expect(okText).not.toContain(INCOMPLETE_MARKER[reason].trim());
  });

  // 22.1: the audit-plane enum is what `smoke.researchInsufficientEvidenceForThread` reads, so this
  // is the harness's actual truth source — a closed enum, never a substring of model prose.
  // MUTATION that turns this RED: drop `evidenceVerdict` from the research.persisted payload.
  test("the research.persisted payload carries the CODE-derived verdict for all three shapes", async () => {
    const shapes = [
      { over: { sources: [], webSearchCalls: 0 }, verdict: "not_researched" }, // a5dfafc2 attempt 2
      { over: { sources: [], webSearchCalls: 1 }, verdict: "insufficient_evidence" },
      { over: { webSearchCalls: 1 }, verdict: "sourced" }, // a5dfafc2 attempt 1 shape: it DID research
      // 22.1b: the SAME shape (sources present) but the specialist DECLARED the gap. The whole
      // point of the channel — a near-miss is a source, not support. MUTATION that turns this RED:
      // drop `declaredUnsupported` from the persistFindings → evidenceVerdict call.
      {
        over: { webSearchCalls: 1, declaredUnsupported: true },
        verdict: "insufficient_evidence",
      },
    ];
    for (const { over, verdict } of shapes) {
      const t = newTest();
      await persist(t, over);
      const row = (await readAudit(t)).find((r) => r.eventType === "research.persisted");
      expect(row?.payload).toMatchObject({ evidenceVerdict: verdict });
    }
  });

  test("the write goes through startIngest — the SOLE legal starter, never a bare insert", async () => {
    // An instance with NO workflow component: `startIngest` is the only thing in this path that
    // touches it, so the persist must fail — and the row must NOT survive the failed transaction.
    const t = newTest(false);
    await expect(persist(t)).rejects.toThrow();
    expect(await readDocs(t)).toHaveLength(0);
  });

  test("§4 — the audit row carries a query HASH, counts and refs; never prose, never a URL", async () => {
    const t = newTest();
    const id = await persist(t);

    const rows = await readAudit(t);
    const persisted = rows.filter((r) => r.eventType === "research.persisted");
    expect(persisted).toHaveLength(1);
    expect(persisted[0]).toMatchObject({ tenantId: TENANT, correlationId: ROOT, actor: "system" });
    expect(persisted[0]?.payload).toMatchObject({
      sourceCount: SOURCES.length,
      webSearchCalls: 2,
      evidenceVerdict: "sourced",
      retrievedAt: RETRIEVED,
      vaultDocId: String(id),
      incomplete: false,
    });
    expect(String(persisted[0]?.payload.queryHash)).toMatch(/^[0-9a-f]{64}$/);

    // Every VALUE of every payload written on this path, so a future field cannot leak silently.
    const secrets = [
      ...FINDINGS.split(/\W+/).filter((w) => w.length >= 5),
      ...QUESTION.split(/\W+/).filter((w) => w.length >= 6),
      ...SOURCES.map((s) => s.url),
    ];
    expect(secrets.length).toBeGreaterThan(3);
    for (const row of rows) {
      for (const [key, value] of Object.entries(row.payload ?? {})) {
        const text = typeof value === "string" ? value : JSON.stringify(value);
        for (const secret of secrets) {
          expect(text, `audit ${row.eventType}.${key} carries "${secret}"`).not.toContain(secret);
        }
      }
    }
  });
});

// ── The dispatch wiring (Task 2) ──────────────────────────────────────────────────────────────
//
// Driven through `__runSpecialistWithScript` with `research: true`: the twin calls the SAME
// `dispatchAndLand` + `persistResearchFindings` seam `runResearch` does. `runResearch` itself
// cannot be driven offline — a LanguageModel is not Convex-serializable (16-06 deviation 4).

const provUsage = (input: number, output: number) => ({
  inputTokens: { total: input, noCache: input, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: output, text: output, reasoning: 0 },
});
/** A step that never searched. `webSearchCalls` counts provider-executed tool calls
 *  (`llm.ts:2412`), so a pure-text step reports ZERO — which since 16-09's structural floor means
 *  the dispatcher writes no vault document. Kept as the NEGATIVE fixture only. */
const UNSEARCHED_STEP = {
  content: [{ type: "text", text: FINDINGS }],
  finishReason: { unified: "stop", raw: "stop" },
  usage: provUsage(100_000, 100_000), // ≈ 8 cents on DEFAULT_MODEL — inside the envelope
  warnings: [],
};

/** The exact provider-executed part shape observed by the 16-02 live probe (the `searchedStep`
 *  helper in `dispatch.test.ts`, kept in sync by hand — there is no shared test barrel). This is
 *  what a REAL research run looks like, and the default for every positive case here: before
 *  16-09 these tests ran on a step that made no search at all, which the floor now correctly
 *  refuses to persist. */
const REPLY_STEP = {
  content: [
    {
      type: "tool-call",
      toolCallId: "ws-1",
      toolName: "web_search",
      input: "{}",
      providerExecuted: true,
    },
    {
      type: "tool-result",
      toolCallId: "ws-1",
      toolName: "web_search",
      result: {
        action: { type: "search", queries: ["ziggurat metro session pricing"] },
        sources: [{ type: "url", url: "https://example.test/pricing" }],
      },
    },
    {
      type: "source",
      sourceType: "url",
      id: "s-0",
      url: "https://example.test/pricing",
      title: "Source 0",
    },
    { type: "text", text: FINDINGS },
  ],
  finishReason: { unified: "stop", raw: "stop" },
  usage: provUsage(100_000, 100_000), // ≈ 8 cents on DEFAULT_MODEL — inside the envelope
  warnings: [],
};

/** The row a research dispatch actually runs against: staged through 16-06's `stageResearchPlan`,
 *  not a bare `insertPlan`. `landSpecialistResult`'s CAS refuses anything that is not
 *  `collecting` + `kind: "memo"`, so a bare row would silently never become approvable. */
async function stagedPlan(t: T, tenantId = TENANT): Promise<Id<"plans">> {
  await t.mutation(internal.skills.seedSkills, {});
  const staged = await t.mutation(internal.plans.stageResearchPlan, {
    tenantId,
    threadId: THREAD,
    subject: "Research",
  });
  if (!staged.ok) throw new Error(`staging refused: ${staged.reason}`);
  return staged.planId;
}

const dispatchArgs = (planId: Id<"plans">, over: Record<string, unknown> = {}) => ({
  tenantId: TENANT,
  threadId: THREAD,
  planId,
  gapIndex: 0,
  route: "research",
  rootRequestId: ROOT,
  parentAgentId: "executive",
  depth: 1,
  ancestry: [] as string[],
  envelopeCents: 0,
  spentCents: 0,
  question: QUESTION,
  research: true,
  primary: [REPLY_STEP],
  ...over,
});

describe("the dispatcher — not the specialist — writes the findings", () => {
  test("a successful research dispatch leaves BOTH artifacts: the card AND one document", async () => {
    const t = newTest();
    const planId = await stagedPlan(t);
    const res = await t.action(internal.dispatch.__runSpecialistWithScript, dispatchArgs(planId));

    expect(res.ok).toBe(true);
    const docs = (await readDocs(t)).filter((d) => d.kind === "web_research");
    expect(docs).toHaveLength(1);
    expect(res.ok && res.vaultDocId).toBe(String(docs[0]?._id));
    // The card the user actually acts on landed FIRST and carries the findings.
    const plan = await t.run((ctx) => ctx.db.get(planId));
    expect(plan?.status).toBe("proposed");
    expect(plan?.kind).toBe("memo");
    expect(plan?.body).toContain(FINDINGS);
  });

  // ── 16-09's structural floor ────────────────────────────────────────────────────────────────
  //
  // Measured, not hypothetical: run 56bff5b8 fixture 34 declared the question unsupported having
  // made ZERO searches, and run eval-f795ede0 logged webSearchCalls of 1,1,1,0,0,4 across six
  // dispatches. The skill body has said "every run searches the web, without exception" through
  // three separate tunings and the model violated it anyway — so containment is CODE.
  test("a run that never searched writes NO vault document — it is not research", async () => {
    const t = newTest();
    const planId = await stagedPlan(t);
    const res = await t.action(
      internal.dispatch.__runSpecialistWithScript,
      dispatchArgs(planId, { primary: [UNSEARCHED_STEP] }),
    );

    // The RUN still succeeds and still costs money — this is not a refusal.
    expect(res.ok).toBe(true);
    expect(res.ok && res.webSearchCalls).toBe(0);
    // ...but nothing retrievable was created. The vault is a RETRIEVAL surface: `vaultSearch`
    // returns arbitrary CHUNKS, so a slice of this body would carry neither NOT_RESEARCHED_LABEL
    // (which sits BEFORE the fence) nor the fence, and the Phase-12 engine would cite a
    // model-memory answer as a grounded market fact.
    expect((await readDocs(t)).filter((d) => d.kind === "web_research")).toHaveLength(0);
    expect(res.ok && res.vaultDocId).toBeUndefined();

    // NOTHING VISIBLE IS WITHHELD. The memo card is landed by `dispatchAndLand` BEFORE the
    // persist seam, so the user still reads the findings AND the honest label. Withholding the
    // card too would hide the failure instead of containing it.
    const plan = await t.run((ctx) => ctx.db.get(planId));
    expect(plan?.status).toBe("proposed");
    expect(plan?.body).toContain(FINDINGS);

    // The skip is auditable by CODE, with refs and counts only (§4) — never the body.
    const rows = await t.run((ctx) => ctx.db.query("audit").collect());
    const skipped = rows.filter((r) => r.eventType === "research.persist_skipped");
    expect(skipped).toHaveLength(1);
    expect(skipped[0]?.payload).toMatchObject({ reason: "not_researched", webSearchCalls: 0 });
    expect(JSON.stringify(skipped[0]?.payload)).not.toContain(FINDINGS);
  });

  // NON-VACUITY for the case above: the SAME dispatch, differing ONLY in whether the step made a
  // provider-executed search, DOES persist. Without this the assertion above would pass on a
  // dispatcher that never writes a document at all.
  test("the same dispatch WITH a search does persist — the floor is the only difference", async () => {
    const t = newTest();
    const planId = await stagedPlan(t);
    const res = await t.action(internal.dispatch.__runSpecialistWithScript, dispatchArgs(planId));

    expect(res.ok && res.webSearchCalls).toBeGreaterThan(0);
    expect((await readDocs(t)).filter((d) => d.kind === "web_research")).toHaveLength(1);
    const rows = await t.run((ctx) => ctx.db.query("audit").collect());
    expect(rows.filter((r) => r.eventType === "research.persist_skipped")).toHaveLength(0);
  });

  test("a governed refusal writes NO vault document — a paused conversation is not a finding", async () => {
    const t = newTest();
    const planId = await stagedPlan(t);
    const res = await t.action(
      internal.dispatch.__runSpecialistWithScript,
      dispatchArgs(planId, { route: "not-a-route" }),
    );

    expect(res).toMatchObject({ ok: false, reason: "unknown_route" });
    expect((await readDocs(t)).filter((d) => d.kind === "web_research")).toHaveLength(0);
    // The refusal's OWN reply is on the card (16-06's fallbackBody), not the generic memo.
    const plan = await t.run((ctx) => ctx.db.get(planId));
    expect(plan?.status).toBe("proposed");
    expect(plan?.body).toBe(res.ok ? "" : res.reply);
  });

  test("a persist failure costs GROUNDABILITY, never the findings", async () => {
    // No workflow component ⇒ `startIngest` throws inside `persistFindings`. The run must still
    // succeed, the card must still hold the findings, and the failure must be audited by CODE only.
    const t = newTest(false);
    const planId = await stagedPlan(t);
    const res = await t.action(internal.dispatch.__runSpecialistWithScript, dispatchArgs(planId));

    expect(res.ok).toBe(true);
    expect(res.ok && res.vaultDocId).toBeUndefined();
    expect(await readDocs(t)).toHaveLength(0);
    const plan = await t.run((ctx) => ctx.db.get(planId));
    expect(plan?.status).toBe("proposed");
    expect(plan?.body).toContain(FINDINGS);

    const failures = (await readAudit(t)).filter((r) => r.eventType === "research.persist_failed");
    expect(failures).toHaveLength(1);
    expect(failures[0]?.payload).toMatchObject({ reason: "persist_error", rootRequestId: ROOT });
  });
});

describe("SC#3 — stored findings are tenant-scoped", () => {
  test("two tenants under the SAME rootRequestId partition cleanly, on every plane", async () => {
    const t = newTest();
    await persist(t); // tenant A
    await persist(t, { tenantId: TENANT_B, body: "Tenant B's own findings." }); // same ROOT

    const docs = await readDocs(t);
    expect(docs).toHaveLength(2);
    const a = docs.filter((d) => d.tenantId === TENANT);
    const b = docs.filter((d) => d.tenantId === TENANT_B);
    expect(a).toHaveLength(1); // non-empty on BOTH sides, or every claim below is vacuous
    expect(b).toHaveLength(1);
    expect(a[0]?.text).not.toContain("Tenant B's own findings.");
    expect(b[0]?.text).not.toContain(FINDINGS);

    // The audit rows collide on the correlation key and STILL partition by tenant.
    const rows = (await readAudit(t)).filter((r) => r.eventType === "research.persisted");
    expect(rows).toHaveLength(2);
    for (const r of rows) expect(r.correlationId).toBe(ROOT);
    expect(rows.filter((r) => r.tenantId === TENANT)).toHaveLength(1);
    expect(rows.filter((r) => r.tenantId === TENANT_B)).toHaveLength(1);
  });

  test("tenant B cannot read tenant A's findings through the tenant-scoped surface", async () => {
    const t = newTest();
    await persist(t); // A's document
    await persist(t, { tenantId: TENANT_B, body: "Tenant B's own findings." });

    // Read through the PUBLIC tenant-scoped query (CLAUDE.md §2 — the wrapper is what users get),
    // never ctx.db, or the assertion proves nothing about the isolation that actually ships.
    const asA = await t.withIdentity({ subject: TENANT }).query(api.vault.listVaultDocs, {});
    const asB = await t.withIdentity({ subject: TENANT_B }).query(api.vault.listVaultDocs, {});

    // The browse projection carries neither `tenantId` nor `text` (15.3-02), so isolation is read
    // off the ids, and the content half goes through the one-doc query the preview pane uses —
    // which is now ALSO a public surface and therefore also has to be tenant-scoped.
    expect(asA).toHaveLength(1);
    // BOTH halves: A is invisible to B, AND B can see its OWN — so this cannot pass because the
    // read path returned nothing for everyone.
    expect(asB).toHaveLength(1);
    const aDocId = asA[0]?._id;
    const bDocId = asB[0]?._id;
    expect(bDocId).not.toBe(aDocId);

    const bReadsOwn = await t
      .withIdentity({ subject: TENANT_B })
      .query(api.vault.vaultDocText, { vaultDocId: bDocId! });
    expect(bReadsOwn?.text).toContain("Tenant B's own findings.");
    const bReadsA = await t
      .withIdentity({ subject: TENANT_B })
      .query(api.vault.vaultDocText, { vaultDocId: aDocId! });
    expect(bReadsA).toBeNull();
    expect(JSON.stringify([asB, bReadsOwn, bReadsA])).not.toContain(FINDINGS);
  });
});
