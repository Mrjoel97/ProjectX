// Voice-doc discussion (DOCV-01) — convex-test. Wave-0 coverage: this file exists to prove the
// 14-01 schema widening actually reached the SCHEMA-DERIVED write validator, with zero edits to
// `insertEvaluation`. SC1 / SC2 / BETA-05 assertions land here in plans 14-03 and 14-05.

import {
  CAP_MS,
  DOC_REVIEW_FRAMEWORK,
  EXCERPT_CHAR_CAP,
  RETRIEVAL_CHAR_CAP,
  RETRIEVAL_MAX_PASSAGES,
  voiceDocThreadId,
} from "@pikar/voice";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
// The evaluation write path's refs-only audit hits the auditCounts aggregate; register the
// component (relative import — the package blocks the deep specifier), the evaluations.test.ts idiom.
import aggregateSchema from "../node_modules/@convex-dev/aggregate/src/component/schema.js";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

// @ts-expect-error import.meta.glob is provided by Vite/vitest at runtime.
const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);
// @ts-expect-error import.meta.glob is provided by Vite/vitest at runtime.
const aggregateModules = import.meta.glob(
  "../node_modules/@convex-dev/aggregate/src/component/**/!(*.test).ts",
);

const TENANT = "tenant_a";
const TENANT_B = "tenant_b";

function newTest(): ReturnType<typeof convexTest> {
  const t = convexTest(schema, modules);
  t.registerComponent("auditCounts", aggregateSchema, aggregateModules);
  return t;
}

// ── 14-03: the doc-scoped retrieval action (SC1 drill-in · SC4 refs-only audit · BETA-05) ────────
//
// Everything below rides the `SMOKE::<docId,…>` grounding seam that `vaultGround.ts` already
// honours: the sentinel bypasses `rag.search` entirely (no embedding network, no OPENAI_API_KEY)
// and resolves the seed doc ids through the TENANT-SCOPED `internal.vault.ownedDocsMeta` — which is
// exactly why a cross-tenant seed drops out here the same way `namespace = tenantId` would exclude
// it in a real search. That is what makes the BETA-05 assertion below a real isolation proof rather
// than an assertion about an error string.

const REPORT_TEXT =
  "Churn rose to 9% in Q3, concentrated in the self-serve tier.\n\n" +
  "Exit interviews cite setup friction in 7 of 9 cancellations.\n\n" +
  "Enterprise renewals held at 96% with no discounting.";

const OTHER_TEXT = "Warehouse throughput fell 12% after the Leeds depot move.";

/** A groundable (`ready`, non-blank text) vault doc — the only shape startSession will accept. */
function seedReadyDoc(
  t: ReturnType<typeof convexTest>,
  tenantId: string,
  text: string,
  title = "Q3 Performance Report",
): Promise<Id<"vaultDocuments">> {
  return t.run((ctx) =>
    ctx.db.insert("vaultDocuments", {
      tenantId,
      title,
      kind: "upload",
      category: "business",
      source: "seam",
      mimeType: "text/markdown",
      size: text.length,
      contentHash: `hash_${Math.random().toString(36).slice(2)}`,
      text,
      status: "ready" as const,
      createdAt: Date.now(),
    }),
  );
}

const asTenant = (t: ReturnType<typeof convexTest>, subject: string) => t.withIdentity({ subject });

/**
 * Open a doc-scoped session through the REAL public entry point, so the `docRef` guard runs too.
 * ONE call per tenant per instance: a second one trips the parallel-session guard, whose force-end
 * schedules `storeBrief` → the ingest WORKFLOW component. Seed the row directly (`seedSession`)
 * when the session itself is fixture, not subject.
 */
async function startDocSession(
  t: ReturnType<typeof convexTest>,
  tenantId: string,
  docRef: Id<"vaultDocuments">,
): Promise<Id<"voiceSessions">> {
  const { sessionId } = await asTenant(t, tenantId).mutation(api.voice.startSession, {
    callId: `call_${tenantId}`,
    docRef,
  });
  return sessionId;
}

/** A session row inserted directly — the post-handshake state, with no watchdog and no guard. */
function seedSession(
  t: ReturnType<typeof convexTest>,
  opts: {
    tenantId?: string;
    docRef?: Id<"vaultDocuments">;
    status?: "active" | "ended_clean" | "ended_abnormal";
  } = {},
): Promise<Id<"voiceSessions">> {
  return t.run((ctx) =>
    ctx.db.insert("voiceSessions", {
      tenantId: opts.tenantId ?? TENANT,
      status: opts.status ?? ("active" as const),
      callId: "call_seed",
      startedAt: Date.now(),
      endsAt: Date.now() + CAP_MS,
      inAudioTok: 0,
      outAudioTok: 0,
      textInTok: 0,
      textOutTok: 0,
      ...(opts.docRef && { docRef: opts.docRef }),
      createdAt: Date.now(),
    }),
  );
}

/** The tenant's `voicedoc.searched` audit rows. */
const searchAudits = (t: ReturnType<typeof convexTest>, tenantId: string) =>
  t.run((ctx) =>
    ctx.db
      .query("audit")
      .filter((q) =>
        q.and(q.eq(q.field("tenantId"), tenantId), q.eq(q.field("eventType"), "voicedoc.searched")),
      )
      .collect(),
  );

// Any network call is a test failure. The SMOKE:: seam must carry the whole flow, so this suite
// passes with no OPENAI_API_KEY and no embedding request — stubbing `fetch` proves that
// structurally rather than trusting the ambient environment.
beforeEach(() => {
  vi.stubGlobal("fetch", () => {
    throw new Error("voiceDoc.test: no network is allowed in this suite");
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("voiceDoc.searchDocument (SC1 — the mid-call drill-in)", () => {
  test("returns passages from THIS document, offline over the SMOKE:: seam", async () => {
    const t = newTest();
    const docId = await seedReadyDoc(t, TENANT, REPORT_TEXT);
    const sessionId = await startDocSession(t, TENANT, docId);

    const res = await asTenant(t, TENANT).action(api.voiceDoc.searchDocument, {
      sessionId,
      query: `SMOKE::${docId}`,
    });

    expect(res.found).toBe(true);
    expect(res.passages.length).toBeGreaterThan(0);
    // An answer the agent did NOT have at connect — grounded in the report's own words.
    expect(res.passages.join("\n")).toContain("setup friction");
  });

  test("a hit on ANOTHER of the tenant's own documents is dropped — this report is the only source", async () => {
    const t = newTest();
    const docId = await seedReadyDoc(t, TENANT, REPORT_TEXT);
    const otherId = await seedReadyDoc(t, TENANT, OTHER_TEXT, "Logistics review");
    const sessionId = await startDocSession(t, TENANT, docId);

    // The seam seeds the OTHER document — the same shape as a vector hit landing on it.
    const res = await asTenant(t, TENANT).action(api.voiceDoc.searchDocument, {
      sessionId,
      query: `SMOKE::${otherId}`,
    });

    expect(res).toEqual({ passages: [], found: false });
    // It never leaks a neighbouring doc's passage as if it were this report's.
    expect(JSON.stringify(res)).not.toContain("Warehouse throughput");
  });

  test("passages respect RETRIEVAL_MAX_PASSAGES and RETRIEVAL_CHAR_CAP", async () => {
    const t = newTest();
    // Five 600-char paragraphs — more passages and more characters than either cap allows.
    const long = Array.from({ length: 5 }, (_, i) => `${i}`.repeat(600)).join("\n\n");
    const docId = await seedReadyDoc(t, TENANT, long, "Long report");
    const sessionId = await startDocSession(t, TENANT, docId);

    const res = await asTenant(t, TENANT).action(api.voiceDoc.searchDocument, {
      sessionId,
      query: `SMOKE::${docId}`,
    });

    expect(res.found).toBe(true);
    expect(res.passages.length).toBeLessThanOrEqual(RETRIEVAL_MAX_PASSAGES);
    expect(res.passages.join("").length).toBeLessThanOrEqual(RETRIEVAL_CHAR_CAP);
  });

  test("an unscoped, an ended, and another tenant's session all yield an honest empty — never a throw", async () => {
    const t = newTest();
    const docId = await seedReadyDoc(t, TENANT, REPORT_TEXT);
    const query = `SMOKE::${docId}`;
    const asA = asTenant(t, TENANT);

    // (a) A session with no docRef — the Phase-6 voice flow has nothing to search.
    const unscoped = await seedSession(t);
    expect(await asA.action(api.voiceDoc.searchDocument, { sessionId: unscoped, query })).toEqual({
      passages: [],
      found: false,
    });

    // (b) An ended session — the call is over; retrieval must not keep answering.
    const ended = await seedSession(t, { docRef: docId, status: "ended_clean" });
    expect(await asA.action(api.voiceDoc.searchDocument, { sessionId: ended, query })).toEqual({
      passages: [],
      found: false,
    });

    // (c) Another tenant's session id — a bail, NOT a thrown relay (Pitfall 5).
    const live = await seedSession(t, { docRef: docId });
    expect(
      await asTenant(t, TENANT_B).action(api.voiceDoc.searchDocument, { sessionId: live, query }),
    ).toEqual({ passages: [], found: false });
  });
});

describe("voiceDoc.searchDocument (SC4 — the refs-only retrieval audit)", () => {
  test("writes exactly one voicedoc.searched row whose payload keys are sessionId/queryHash/resultCount", async () => {
    const t = newTest();
    const docId = await seedReadyDoc(t, TENANT, REPORT_TEXT);
    const sessionId = await startDocSession(t, TENANT, docId);
    const query = `SMOKE::${docId}`;

    await asTenant(t, TENANT).action(api.voiceDoc.searchDocument, { sessionId, query });

    const rows = await searchAudits(t, TENANT);
    expect(rows).toHaveLength(1); // exactly one per invocation
    const payload = rows[0]?.payload as Record<string, unknown>;
    expect(Object.keys(payload).sort()).toEqual(["queryHash", "resultCount", "sessionId"]);
    expect(payload.sessionId).toBe(sessionId);
    expect(payload.resultCount).toBeGreaterThan(0);
    // A HASH, not the query — and never the passages or the report's words (§4).
    expect(payload.queryHash).not.toBe(query);
    expect(String(payload.queryHash)).toMatch(/^[0-9a-f]{64}$/);
    const serialized = JSON.stringify(rows);
    expect(serialized).not.toContain("setup friction");
    expect(serialized).not.toContain("SMOKE::");
  });
});

describe("BETA-05 — tenant A's voice-doc session can never reach tenant B's document", () => {
  test("a cross-tenant seed retrieves nothing and is named in no audit row", async () => {
    const t = newTest();
    const aDoc = await seedReadyDoc(t, TENANT, REPORT_TEXT);
    const bDoc = await seedReadyDoc(t, TENANT_B, OTHER_TEXT, "Tenant B logistics review");
    const sessionId = await startDocSession(t, TENANT, aDoc);

    // Tenant A's own session, searching for TENANT B's document id. The seed drops out inside
    // vaultGround's tenant-scoped ownedDocsMeta — the same way `namespace = tenantId` excludes it.
    const res = await asTenant(t, TENANT).action(api.voiceDoc.searchDocument, {
      sessionId,
      query: `SMOKE::${bDoc}`,
    });
    expect(res).toEqual({ passages: [], found: false });

    // ANTI-VACUOUS: the same seed IS retrievable from tenant B's own session, so the empty result
    // above is a TENANT BOUNDARY, not a malformed id or a seam that silently returns nothing.
    const bSession = await seedSession(t, { tenantId: TENANT_B, docRef: bDoc });
    const bRes = await asTenant(t, TENANT_B).action(api.voiceDoc.searchDocument, {
      sessionId: bSession,
      query: `SMOKE::${bDoc}`,
    });
    expect(bRes.found).toBe(true);
    expect(bRes.passages.join("\n")).toContain("Warehouse throughput");

    // The log plane names neither tenant B's document nor a word of its content.
    const serialized = JSON.stringify(await searchAudits(t, TENANT));
    expect(serialized).not.toContain(bDoc);
    expect(serialized).not.toContain("Warehouse throughput");
    expect(serialized).not.toContain("Tenant B logistics review");
    // Tenant A's audit row exists (the search DID run) and is a hash + a zero count.
    expect(JSON.parse(serialized)).toHaveLength(1);
    expect(
      (JSON.parse(serialized)[0] as { payload: { resultCount: number } }).payload.resultCount,
    ).toBe(0);
  });

  test("startSession refuses a non-ready doc and refuses tenant B's doc outright", async () => {
    const t = newTest();
    const processing = await t.run((ctx) =>
      ctx.db.insert("vaultDocuments", {
        tenantId: TENANT,
        title: "Still ingesting",
        kind: "upload",
        category: "business",
        source: "seam",
        mimeType: "text/markdown",
        size: 10,
        contentHash: "hash_processing",
        text: REPORT_TEXT,
        status: "processing" as const,
        createdAt: Date.now(),
      }),
    );
    const bDoc = await seedReadyDoc(t, TENANT_B, OTHER_TEXT, "Tenant B logistics review");

    await expect(
      asTenant(t, TENANT).mutation(api.voice.startSession, {
        callId: "call_a",
        docRef: processing,
      }),
    ).rejects.toThrow(/voicedoc: document not ready/);
    await expect(
      asTenant(t, TENANT).mutation(api.voice.startSession, { callId: "call_a", docRef: bDoc }),
    ).rejects.toThrow(/voicedoc: document not found/);

    // Tenant B may open a session on its OWN document — the guard is scoping, not a blanket refusal.
    const ok = await startDocSession(t, TENANT_B, bDoc);
    expect(await t.run((ctx) => ctx.db.get(ok))).toMatchObject({
      tenantId: TENANT_B,
      docRef: bDoc,
    });
  });
});

// ── 14-05: the review producer (SC2 — citations, the verified quote, the honesty verdict) ────────
//
// Every case below rides the `SMOKE::docreview::` seam: the FIRST transcript turn's sentinel picks
// a deterministic `RawDocReview` fixture and the model call is skipped entirely, so the whole
// matrix runs with no `OPENAI_API_KEY` — and `fetch` is stubbed to THROW above, which makes the
// no-network claim structural rather than ambient.

/** A transcript whose first turn drives the offline fixture. */
const smokeTranscript = (
  kind: "healthy" | "gaps" | "empty",
): { speaker: string; text: string }[] => [
  { speaker: "user", text: `SMOKE::docreview::${kind}` },
  { speaker: "agent", text: "Let me pull the numbers from the report." },
];

/** The persisted review row on this session's synthetic `voice-doc:<sessionId>` thread. */
const reviewRow = (
  t: ReturnType<typeof convexTest>,
  tenantId: string,
  sessionId: Id<"voiceSessions">,
) =>
  t.query(internal.evaluations.lastForThread, {
    tenantId,
    threadId: voiceDocThreadId(sessionId),
  });

const collapse = (s: string): string => s.replace(/\s+/g, " ").trim().toLowerCase();

describe("voiceDoc.reviewDocument (SC2 — the producer)", () => {
  test("the SMOKE:: seam persists a cited row offline, and returns counts + a verdict ONLY", async () => {
    const t = newTest();
    const docId = await seedReadyDoc(t, TENANT, REPORT_TEXT);
    const sessionId = await seedSession(t, { docRef: docId });

    const res = await t.action(internal.voiceDoc.reviewDocument, {
      tenantId: TENANT,
      sessionId,
      transcript: smokeTranscript("gaps"),
    });

    // Counts and a closed-enum verdict — nothing that could carry prose out of the producer.
    expect(Object.keys(res).sort()).toEqual(["findingCount", "gapCount", "verdict"]);
    expect(res).toEqual({ findingCount: 3, gapCount: 1, verdict: "gaps" });
    const serialized = JSON.stringify(res);
    expect(serialized).not.toContain("setup friction");
    expect(serialized).not.toContain("Churn");

    const row = await reviewRow(t, TENANT, sessionId);
    expect(row?.framework).toBe(DOC_REVIEW_FRAMEWORK);
    expect(row?.findings).toHaveLength(3);
    // A document review has no Growth-OS Scorecard and no user-provided figures.
    expect(row?.scorecard).toEqual({});
    expect(row?.userProvided).toEqual([]);
    expect(row?.delta).toBeUndefined();
  });

  test("a quoted passage survives ONLY when it is really in the report — the finding always survives", async () => {
    const t = newTest();
    const docId = await seedReadyDoc(t, TENANT, REPORT_TEXT);
    const sessionId = await seedSession(t, { docRef: docId });

    await t.action(internal.voiceDoc.reviewDocument, {
      tenantId: TENANT,
      sessionId,
      transcript: smokeTranscript("gaps"),
    });
    const findings = (await reviewRow(t, TENANT, sessionId))?.findings ?? [];
    expect(findings).toHaveLength(3);

    // (a) CARRIED THROUGH — the fixture's first quote is lifted verbatim out of the document.
    const quoted = findings[0]?.citationExcerpt;
    expect(quoted).toBeTruthy();
    expect(String(quoted).length).toBeLessThanOrEqual(EXCERPT_CHAR_CAP);
    expect(collapse(REPORT_TEXT)).toContain(collapse(String(quoted)));

    // (b) ABSENT BY DESIGN — the model quoted nothing. The KEY is omitted, never "".
    expect(findings[1]).not.toHaveProperty("citationExcerpt");

    // (c) REJECTED — the model's quote is nowhere in the report. The EXCERPT is dropped; the
    //     finding is NOT, and its doc-level citation floor still holds.
    expect(findings[2]).not.toHaveProperty("citationExcerpt");

    for (const f of findings) {
      expect(f.citationDocId).toBe(docId);
      expect(f.citationTitle).toBe("Q3 Performance Report");
      expect(f.source).toBe("vault");
    }
  });

  test("no document scope, and another tenant's session, both bail to insufficient with NO row", async () => {
    const t = newTest();
    const docId = await seedReadyDoc(t, TENANT, REPORT_TEXT);
    const bail = { findingCount: 0, gapCount: 0, verdict: "insufficient" };

    // (a) A Phase-6 session with no `docRef` — there is no report to review.
    const unscoped = await seedSession(t);
    expect(
      await t.action(internal.voiceDoc.reviewDocument, {
        tenantId: TENANT,
        sessionId: unscoped,
        transcript: smokeTranscript("gaps"),
      }),
    ).toEqual(bail);
    expect(await reviewRow(t, TENANT, unscoped)).toBeNull();

    // (b) Tenant B asking for tenant A's session — fail-closed, and nothing is written anywhere.
    const foreign = await seedSession(t, { docRef: docId });
    expect(
      await t.action(internal.voiceDoc.reviewDocument, {
        tenantId: TENANT_B,
        sessionId: foreign,
        transcript: smokeTranscript("gaps"),
      }),
    ).toEqual(bail);
    expect(await reviewRow(t, TENANT_B, foreign)).toBeNull();
    expect(await reviewRow(t, TENANT, foreign)).toBeNull();
  });
});

describe("document-review evaluations row", () => {
  test("insertEvaluation accepts the widened framework literal, with zero evaluations.ts edits", async () => {
    const t = newTest();
    const threadId = voiceDocThreadId("session_1");

    await t.mutation(internal.evaluations.insertEvaluation, {
      tenantId: TENANT,
      threadId,
      framework: DOC_REVIEW_FRAMEWORK,
      findings: [
        {
          label: "Churn is attributed to onboarding, not price",
          section: "findings",
          citationDocId: "doc_1",
          citationTitle: "Q3 Performance Report",
          // The persisted half of the LOCKED citation decision — a capped, verified quote.
          citationExcerpt: "Exit interviews cite setup friction in 7 of 9 cancellations.",
          confidence: "high",
          source: "vault",
        },
      ],
      gaps: [],
      notEnoughData: [],
      scorecard: {},
      userProvided: [],
      verdict: "gaps",
    });

    const row = await t.query(internal.evaluations.lastForThread, { tenantId: TENANT, threadId });
    expect(row).not.toBeNull();
    expect(row?.framework).toBe("document-review");
    expect(row?.threadId).toBe("voice-doc:session_1");
  });

  test("citationExcerpt is optional — an absent excerpt is a valid, non-degraded finding", async () => {
    const t = newTest();
    const threadId = voiceDocThreadId("session_2");

    await t.mutation(internal.evaluations.insertEvaluation, {
      tenantId: TENANT,
      threadId,
      framework: DOC_REVIEW_FRAMEWORK,
      findings: [
        {
          label: "Revenue concentration in two accounts",
          section: "findings",
          citationDocId: "doc_1",
          citationTitle: "Q3 Performance Report",
          confidence: "medium",
          source: "vault",
        },
      ],
      gaps: [],
      notEnoughData: [],
      scorecard: {},
      userProvided: [],
      verdict: "gaps",
    });

    const row = await t.query(internal.evaluations.lastForThread, { tenantId: TENANT, threadId });
    expect(row?.findings[0]?.citationExcerpt).toBeUndefined();
    // Absent, not empty-string: the render path branches on presence.
    expect(row?.findings[0]).not.toHaveProperty("citationExcerpt");
  });
});
