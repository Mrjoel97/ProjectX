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

/** Seed a vault row in a NON-ready lifecycle state — the picker must not offer these. */
function seedDocWithStatus(
  t: ReturnType<typeof convexTest>,
  tenantId: string,
  status: "pending_extraction" | "extracting" | "processing" | "failed",
  title: string,
): Promise<Id<"vaultDocuments">> {
  return t.run((ctx) =>
    ctx.db.insert("vaultDocuments", {
      tenantId,
      title,
      kind: "upload",
      category: "my-uploads",
      source: "upload",
      mimeType: "application/pdf",
      size: 1024,
      contentHash: `hash_${Math.random().toString(36).slice(2)}`,
      text: "",
      status,
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
// The `SMOKE::docreview::` seam is gated on OPENAI_API_KEY being ABSENT (`voiceDoc.ts` explains
// why: `reviewSession` is a PUBLIC action, so an ungated sentinel would let any tenant user have a
// fabricated review persisted). Other suites in this package SET the variable, and vitest reuses
// workers across files, so clear it here rather than trusting the ambient environment — the same
// discipline as the throwing `fetch` stub.
let savedKey: string | undefined;

beforeEach(() => {
  savedKey = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  vi.stubGlobal("fetch", () => {
    throw new Error("voiceDoc.test: no network is allowed in this suite");
  });
});
afterEach(() => {
  if (savedKey === undefined) delete process.env.OPENAI_API_KEY;
  else process.env.OPENAI_API_KEY = savedKey;
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

describe("voiceDoc.reviewSession (SC2 — the persisted, cited findings row)", () => {
  test("every persisted finding cites the report; the quoted passage is capped and verified", async () => {
    const t = newTest();
    const docId = await seedReadyDoc(t, TENANT, REPORT_TEXT);
    const sessionId = await seedSession(t, { docRef: docId });

    const res = await asTenant(t, TENANT).action(api.voiceDoc.reviewSession, {
      sessionId,
      transcript: smokeTranscript("gaps"),
    });
    // The thread travels back so the caller never re-derives the `voice-doc:<id>` convention.
    expect(res.threadId).toBe(voiceDocThreadId(sessionId));

    const findings = (await reviewRow(t, TENANT, sessionId))?.findings ?? [];
    expect(findings).toHaveLength(3);

    // SC2's floor: the DOCUMENT-LEVEL citation is on EVERY finding, welded from the doc argument
    // — the model's schema has no citation field to omit.
    expect(
      findings.every(
        (f) =>
          f.citationDocId === docId &&
          f.citationTitle === "Q3 Performance Report" &&
          f.source === "vault",
      ),
    ).toBe(true);

    // …PLUS a quoted passage WHERE AVAILABLE — the three states, all three legal:
    // carried through (really in the report), absent by design, and rejected as unverifiable.
    const quoted = findings[0]?.citationExcerpt;
    expect(quoted).toBeTruthy();
    expect(String(quoted).length).toBeLessThanOrEqual(EXCERPT_CHAR_CAP);
    expect(collapse(REPORT_TEXT)).toContain(collapse(String(quoted)));
    expect(findings[1]).not.toHaveProperty("citationExcerpt");
    expect(findings[2]).not.toHaveProperty("citationExcerpt");
  });

  test("honest 'no gaps' — the healthy fixture pairs the verdict WITH findings and zero gaps", async () => {
    const t = newTest();
    const docId = await seedReadyDoc(t, TENANT, REPORT_TEXT);
    const sessionId = await seedSession(t, { docRef: docId });

    const res = await asTenant(t, TENANT).action(api.voiceDoc.reviewSession, {
      sessionId,
      transcript: smokeTranscript("healthy"),
    });

    // ANTI-VACUOUS (the Phase-12 `28-healthy-no-gaps` lesson): `gapCount === 0` ALONE also passes
    // on the thin-data `insufficient` verdict, so all THREE parts are asserted together. This is
    // an affirmative "the report holds up", not an empty result wearing a healthy label.
    expect(res.verdict).toBe("healthy");
    expect(res.findingCount).toBeGreaterThan(0);
    expect(res.gapCount).toBe(0);

    const row = await reviewRow(t, TENANT, sessionId);
    expect(row?.verdict).toBe("healthy");
    expect(row?.findings.length).toBeGreaterThan(0);
    expect(row?.gaps).toEqual([]);
  });

  test("no fabricated gap — an ungroundable report is insufficient with zero gaps", async () => {
    const t = newTest();
    const docId = await seedReadyDoc(t, TENANT, REPORT_TEXT);
    const sessionId = await seedSession(t, { docRef: docId });

    const res = await asTenant(t, TENANT).action(api.voiceDoc.reviewSession, {
      sessionId,
      transcript: smokeTranscript("empty"),
    });

    // The `empty` fixture DOES offer a gap. Zero grounded findings means there was nothing to have
    // found a gap IN, so the code rule force-clears them — the model cannot argue its way past it.
    expect(res.verdict).toBe("insufficient");
    expect(res.gapCount).toBe(0);
    const row = await reviewRow(t, TENANT, sessionId);
    expect(row?.findings).toEqual([]);
    expect(row?.gaps).toEqual([]);
    // …and the honest thin-data state is recorded instead of a diagnosis.
    expect(row?.notEnoughData.length).toBeGreaterThan(0);
  });

  test("every persisted gap carries the four values buildMemo prints as user-visible prose", async () => {
    const t = newTest();
    const docId = await seedReadyDoc(t, TENANT, REPORT_TEXT);
    const sessionId = await seedSession(t, { docRef: docId });

    await asTenant(t, TENANT).action(api.voiceDoc.reviewSession, {
      sessionId,
      transcript: smokeTranscript("gaps"),
    });

    const gaps = (await reviewRow(t, TENANT, sessionId))?.gaps ?? [];
    expect(gaps.length).toBeGreaterThan(0);
    for (const g of gaps) {
      // `route` and `playbook` are WELDED constants — the model never chooses them — and all four
      // are printed verbatim into an approvable memo, so an empty one ships nonsense at the
      // consent screen (Pitfall 8).
      expect(g.route).toBe("document-analyst");
      expect(g.playbook).toBe("document-review");
      expect(String(g.reason).length).toBeGreaterThan(0);
      expect(String(g.proofMetric).length).toBeGreaterThan(0);
      expect(g.leverageRank).toBeGreaterThan(0);
    }
  });

  test("idempotent per session — a re-mounted post-call screen sees ONE consolidated row", async () => {
    const t = newTest();
    const docId = await seedReadyDoc(t, TENANT, REPORT_TEXT);
    const sessionId = await seedSession(t, { docRef: docId });
    const args = { sessionId, transcript: smokeTranscript("gaps") };

    const first = await asTenant(t, TENANT).action(api.voiceDoc.reviewSession, args);
    const second = await asTenant(t, TENANT).action(api.voiceDoc.reviewSession, args);
    expect(second).toEqual(first);

    // `evaluations` is append-only, so idempotence is a READ-GUARD: exactly one row on the thread.
    const rows = await t.run((ctx) =>
      ctx.db
        .query("evaluations")
        .filter((q) => q.eq(q.field("threadId"), voiceDocThreadId(sessionId)))
        .collect(),
    );
    expect(rows).toHaveLength(1);

    // …and exactly one refs-only review audit row, whose payload keys are counts and a verdict.
    const audits = await t.run((ctx) =>
      ctx.db
        .query("audit")
        .filter((q) => q.eq(q.field("eventType"), "voicedoc.reviewed"))
        .collect(),
    );
    expect(audits).toHaveLength(1);
    const payload = audits[0]?.payload as Record<string, unknown>;
    expect(Object.keys(payload).sort()).toEqual([
      "findingCount",
      "gapCount",
      "sessionId",
      "verdict",
    ]);
    // §4: no finding label, no quoted passage, no report content of any kind in the log plane.
    const serialized = JSON.stringify(audits);
    expect(serialized).not.toContain("setup friction");
    expect(serialized).not.toContain("Churn rose");
    expect(serialized).not.toContain("citationExcerpt");
    expect(serialized).not.toContain("workstream");
  });

  test("the SMOKE:: sentinel is INERT once a model key exists — a public entry cannot fabricate a review", async () => {
    const t = newTest();
    const docId = await seedReadyDoc(t, TENANT, REPORT_TEXT);
    const sessionId = await seedSession(t, { docRef: docId });

    // `transcript` is entirely client-supplied on a PUBLIC tenantAction, so an ungated sentinel
    // would let any authenticated user POST one turn and get canned gaps persisted as a real
    // `evaluations` row — a production endpoint fabricating a gap on request, which is the exact
    // opposite of Success Criterion 2. With a key present the sentinel is just text: the ordinary
    // model path runs, which here fails closed at the unseeded `document-analyst` persona (§5)
    // rather than short-circuiting into a fixture.
    process.env.OPENAI_API_KEY = "sk-voicedoc-seam-guard-test";
    await expect(
      asTenant(t, TENANT).action(api.voiceDoc.reviewSession, {
        sessionId,
        transcript: smokeTranscript("gaps"),
      }),
    ).rejects.toThrow(/NO_ACTIVE_SKILL/);

    // Nothing was persisted, so there is no fabricated row for `actOnGap` to act on.
    expect(await reviewRow(t, TENANT, sessionId)).toBeNull();
  });

  test("BETA-05 — tenant B can neither review nor read tenant A's voice-doc thread", async () => {
    const t = newTest();
    const docId = await seedReadyDoc(t, TENANT, REPORT_TEXT);
    const sessionId = await seedSession(t, { docRef: docId });

    // Fail-closed: a cross-tenant session id reads as missing — a STATUS, never content.
    await expect(
      asTenant(t, TENANT_B).action(api.voiceDoc.reviewSession, {
        sessionId,
        transcript: smokeTranscript("gaps"),
      }),
    ).rejects.toThrow(/voicedoc: session not found/);

    // ANTI-VACUOUS: the owner CAN review the very same session, so the refusal above is a tenant
    // boundary and not a broken fixture.
    const res = await asTenant(t, TENANT).action(api.voiceDoc.reviewSession, {
      sessionId,
      transcript: smokeTranscript("gaps"),
    });
    expect(res.findingCount).toBe(3);

    // The row exists — and is invisible to tenant B on the very same synthetic thread id.
    const threadId = voiceDocThreadId(sessionId);
    expect(
      await asTenant(t, TENANT).query(api.evaluations.byThread, { threadId }),
    ).not.toBeNull();
    expect(await asTenant(t, TENANT_B).query(api.evaluations.byThread, { threadId })).toBeNull();
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

// ── 14-07: docContext — the tiny read behind the in-call doc strip ────────────────────────────
//
// The strip needs three facts to name the report under discussion. It deliberately does NOT reuse
// `listVaultDocs`, which `.collect()`s whole rows INCLUDING `text` — the voice page has no business
// holding a book-sized blob to render a title. These tests pin the projection, so a future "just
// return the row" simplification fails loudly instead of quietly shipping document text to a page.
describe("voiceDoc.docContext (14-07 — the doc strip's read)", () => {
  test("returns title, status and truncated for the caller's own document", async () => {
    const t = newTest();
    const docId = await seedReadyDoc(t, TENANT, REPORT_TEXT, "Q3 Performance Report");

    const ctx = await asTenant(t, TENANT).query(api.voiceDoc.docContext, { docId });

    expect(ctx).not.toBeNull();
    expect(ctx?.title).toBe("Q3 Performance Report");
    expect(ctx?.status).toBe("ready");
    expect(ctx?.truncated).toBe(false); // absent `extractionTruncated` reads as false, never undefined
  });

  test("reports a partial read when extraction was truncated", async () => {
    const t = newTest();
    const docId = await seedReadyDoc(t, TENANT, REPORT_TEXT);
    await t.run(async (dbCtx) => {
      await dbCtx.db.patch(docId, { extractionTruncated: true });
    });

    const ctx = await asTenant(t, TENANT).query(api.voiceDoc.docContext, { docId });

    expect(ctx?.truncated).toBe(true);
  });

  test("is fail-closed cross-tenant — null, and never the other tenant's title", async () => {
    const t = newTest();
    const bDoc = await seedReadyDoc(t, TENANT_B, OTHER_TEXT, "Tenant B logistics review");

    const ctx = await asTenant(t, TENANT).query(api.voiceDoc.docContext, { docId: bDoc });

    // Null, not a throw: a throw distinguishes "exists but yours it isn't" from "does not exist",
    // which is an ownership oracle. One answer for both (BETA-05).
    expect(ctx).toBeNull();
    expect(JSON.stringify(ctx)).not.toContain("logistics");
  });

  test("carries NO text key — the strip cannot leak document content into the page", async () => {
    const t = newTest();
    const docId = await seedReadyDoc(t, TENANT, REPORT_TEXT);

    const ctx = await asTenant(t, TENANT).query(api.voiceDoc.docContext, { docId });

    expect(ctx).not.toHaveProperty("text");
    expect(Object.keys(ctx ?? {}).sort()).toEqual(["status", "title", "truncated"]);
  });
});

// ── 14-10: pickableDocs — the pre-flight picker's list ────────────────────────────────────────
//
// The picker may only offer what `voice.startSession` will ACCEPT (ready + non-empty text);
// offering a row the server refuses would be a lie. Non-ready rows are not listed but ARE counted,
// so a just-uploaded document does not appear to have vanished — the confusion that motivated this
// feature. Like docContext, this pins the PROJECTION: a future "just return the row" simplification
// must fail loudly rather than quietly ship document text to the voice page.
describe("voiceDoc.pickableDocs (14-10 — the pre-flight picker's read)", () => {
  test("lists only READY documents with text, newest first, as id + title", async () => {
    const t = newTest();
    await seedReadyDoc(t, TENANT, REPORT_TEXT, "Older Report");
    await seedReadyDoc(t, TENANT, REPORT_TEXT, "Newer Report");

    const res = await asTenant(t, TENANT).query(api.voiceDoc.pickableDocs, {});

    expect(res.docs.map((d) => d.title)).toEqual(["Newer Report", "Older Report"]);
    // The projection is exactly two keys — no `text`, no `status`, no `size`.
    expect(Object.keys(res.docs[0] ?? {}).sort()).toEqual(["docId", "title"]);
  });

  test("excludes non-ready documents from docs but counts them as processing", async () => {
    const t = newTest();
    await seedReadyDoc(t, TENANT, REPORT_TEXT, "Ready Report");
    await seedDocWithStatus(t, TENANT, "pending_extraction", "Queued Deck");
    await seedDocWithStatus(t, TENANT, "extracting", "Reading Deck");
    await seedDocWithStatus(t, TENANT, "processing", "Embedding Deck");

    const res = await asTenant(t, TENANT).query(api.voiceDoc.pickableDocs, {});

    expect(res.docs.map((d) => d.title)).toEqual(["Ready Report"]);
    expect(res.processingCount).toBe(3);
  });

  test("a failed document is neither listed nor counted as processing", async () => {
    const t = newTest();
    await seedDocWithStatus(t, TENANT, "failed", "Broken Scan");

    const res = await asTenant(t, TENANT).query(api.voiceDoc.pickableDocs, {});

    expect(res.docs).toEqual([]);
    expect(res.processingCount).toBe(0);
  });

  test("a READY row with empty text is not offered — startSession would reject it", async () => {
    const t = newTest();
    await t.run((ctx) =>
      ctx.db.insert("vaultDocuments", {
        tenantId: TENANT,
        title: "Empty Ready Doc",
        kind: "upload",
        category: "business",
        source: "seam",
        mimeType: "text/markdown",
        size: 0,
        contentHash: "hash_empty_ready",
        text: "   ",
        status: "ready" as const,
        createdAt: Date.now(),
      }),
    );

    const res = await asTenant(t, TENANT).query(api.voiceDoc.pickableDocs, {});

    expect(res.docs).toEqual([]);
  });

  test("a READY row with no text field at all is not offered or counted", async () => {
    const t = newTest();
    await t.run((ctx) =>
      ctx.db.insert("vaultDocuments", {
        tenantId: TENANT,
        title: "Textless Ready Doc",
        kind: "upload",
        category: "business",
        source: "seam",
        mimeType: "text/markdown",
        size: 0,
        contentHash: "hash_textless_ready",
        status: "ready" as const,
        createdAt: Date.now(),
      }),
    );

    const res = await asTenant(t, TENANT).query(api.voiceDoc.pickableDocs, {});

    expect(res.docs).toEqual([]);
    expect(res.processingCount).toBe(0);
  });

  test("another tenant's documents never appear (BETA-05)", async () => {
    const t = newTest();
    await seedReadyDoc(t, TENANT_B, REPORT_TEXT, "Tenant B Report");

    const res = await asTenant(t, TENANT).query(api.voiceDoc.pickableDocs, {});

    expect(res.docs).toEqual([]);
    expect(res.processingCount).toBe(0);
  });
});
