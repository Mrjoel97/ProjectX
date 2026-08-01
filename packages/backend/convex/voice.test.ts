// The server-side voice-session engine (voice.ts, VOIC-02/VOIC-03). convex-test + FAKE TIMERS: the
// watchdog is a durable scheduler.runAt timer, so the tests arm it, advance/inspect the scheduled
// system rows, and assert the clean/abnormal CAS transitions. `fetch` is stubbed (hangupCall). The
// brief → vault ingest is driven by the draftVoiceBrief SMOKE sentinel (offline, no model/network).
import { CAP_MS } from "@pikar/voice";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
// Register the components the voice spine touches offline (vaultTranscribe.test.ts set): rateLimiter
// (recordUsage → recordSpend), auditCounts (audit.log aggregate), workflow + workpool (storeBrief →
// ingestDoc). Durable workflow steps do NOT run synchronously — `status: "processing"` on the brief
// vault row IS the synchronous seam effect (vault.test.ts pattern). Relative specifiers because the
// package blocks the deep `/src/component` path.
import aggregateSchema from "../node_modules/@convex-dev/aggregate/src/component/schema.js";
import rateLimiterSchema from "../node_modules/@convex-dev/rate-limiter/src/component/schema.js";
import workflowSchema from "../node_modules/@convex-dev/workflow/src/component/schema.js";
import workpoolSchema from "../node_modules/@convex-dev/workpool/src/component/schema.js";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
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

const TENANT = "tenant_voice_session";
const FAKE_KEY = "sk-voice-test-key";

function setup(): ReturnType<typeof convexTest> {
  const t = convexTest(schema, modules);
  t.registerComponent("rateLimiter", rateLimiterSchema, rateLimiterModules);
  t.registerComponent("auditCounts", aggregateSchema, aggregateModules);
  t.registerComponent("workflow", workflowSchema, workflowModules);
  t.registerComponent("workflow/workpool", workpoolSchema, workpoolModules);
  return t;
}

const asTenant = (t: ReturnType<typeof convexTest>) => t.withIdentity({ subject: TENANT });
const get = (t: ReturnType<typeof convexTest>, id: Id<"voiceSessions">) =>
  t.run((ctx) => ctx.db.get(id));
const listScheduled = (t: ReturnType<typeof convexTest>) =>
  t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect());
const audits = (t: ReturnType<typeof convexTest>, eventType: string) =>
  t.run((ctx) =>
    ctx.db
      .query("audit")
      .filter((q) => q.eq(q.field("eventType"), eventType))
      .collect(),
  );

/** Stub global fetch → 200 (hangupCall's success shape). */
function stubFetch200() {
  vi.stubGlobal("fetch", () => Promise.resolve(new Response(null, { status: 200 })));
}

beforeEach(() => {
  process.env.OPENAI_API_KEY = FAKE_KEY;
});
afterEach(() => {
  vi.unstubAllGlobals();
});

// ── Task 1: startSession + parallel guard + arm watchdog + endSessionClean (CAS) ────────────────

test("startSession persists the callId, marks active, and arms ONE watchdog at startedAt+CAP_MS", async () => {
  vi.useFakeTimers();
  try {
    const t = setup();
    const t0 = Date.now();
    const { sessionId } = await asTenant(t).mutation(api.voice.startSession, {
      callId: "call_abc",
    });

    const s = await get(t, sessionId);
    expect(s?.status).toBe("active");
    expect(s?.callId).toBe("call_abc"); // "active" ONLY with a callId (Pitfall 1)
    expect(s?.watchdogFnId).toBeDefined();
    expect(s?.endsAt).toBe(t0 + CAP_MS); // the wall-clock cap

    // Exactly ONE armed watchdog, firing AT the cap instant (armed once, never re-armed).
    const scheduled = await listScheduled(t);
    expect(scheduled).toHaveLength(1);
    expect(scheduled[0]?.scheduledTime).toBe(t0 + CAP_MS);

    // Refs-only session_started audit: {sessionId} ONLY — never the callId-as-secret (§4).
    const started = await audits(t, "voice.session_started");
    expect(started).toHaveLength(1);
    const payload = JSON.stringify(started[0]?.payload);
    expect(payload).toContain(sessionId);
    expect(payload).not.toContain("call_abc");
  } finally {
    vi.useRealTimers();
  }
});

test("parallel guard: a second startSession force-ends the prior active session, leaving one active", async () => {
  vi.useFakeTimers();
  try {
    stubFetch200(); // the prior's hangupCall
    const t = setup();
    const asT = asTenant(t);

    const { sessionId: first } = await asT.mutation(api.voice.startSession, { callId: "call_1" });
    const { sessionId: second } = await asT.mutation(api.voice.startSession, { callId: "call_2" });

    // The new session is immediately active; the guard scheduled the prior's force-end (runAfter 0).
    expect((await get(t, second))?.status).toBe("active");
    // Run the abnormal-end the guard armed for the prior.
    await t.action(internal.voice.forceEndSession, { sessionId: first });

    expect((await get(t, first))?.status).toBe("ended_abnormal");
    // Exactly one active session remains for the tenant.
    const active = await t.query(internal.voice.getActiveSession, { tenantId: TENANT });
    expect(active?._id).toBe(second);
  } finally {
    vi.useRealTimers();
  }
});

test("endSessionClean cancels the watchdog under a CAS and writes a refs-only session_ended audit", async () => {
  vi.useFakeTimers();
  try {
    const t = setup();
    const asT = asTenant(t);
    const { sessionId } = await asT.mutation(api.voice.startSession, { callId: "call_x" });

    // The watchdog is pending before the clean end.
    let pending = (await listScheduled(t)).filter((s) => s.state.kind === "pending");
    expect(pending).toHaveLength(1);

    const res = await asT.mutation(api.voice.endSessionClean, { sessionId });
    expect(res).toEqual({ ok: true });
    expect((await get(t, sessionId))?.status).toBe("ended_clean");

    // The watchdog was cancelled — no pending forceEndSession remains.
    pending = (await listScheduled(t)).filter(
      (s) => s.state.kind === "pending" && String(s.name).includes("forceEndSession"),
    );
    expect(pending).toHaveLength(0);

    // Refs-only session_ended audit: {sessionId} + counts, never the callId (§4).
    const ended = await audits(t, "voice.session_ended");
    expect(ended).toHaveLength(1);
    const payload = JSON.stringify(ended[0]?.payload);
    expect(payload).toContain(sessionId);
    expect(payload).not.toContain("call_x");
  } finally {
    vi.useRealTimers();
  }
});

test("a clean end that races the watchdog fire is a CAS no-op (never a double-cancel throw)", async () => {
  vi.useFakeTimers();
  try {
    const t = setup();
    const asT = asTenant(t);
    const { sessionId } = await asT.mutation(api.voice.startSession, { callId: "call_y" });

    // Simulate the watchdog having already fired: the row is terminal, its scheduled id spent.
    await t.run((ctx) => ctx.db.patch(sessionId, { status: "ended_abnormal" }));

    // A clean end now must NOT call scheduler.cancel on the spent id (would throw) — it no-ops.
    const res = await asT.mutation(api.voice.endSessionClean, { sessionId });
    expect(res).toEqual({ ok: true, alreadyEnded: true });
    expect((await get(t, sessionId))?.status).toBe("ended_abnormal"); // unchanged
  } finally {
    vi.useRealTimers();
  }
});

// ── Task 2: forceEndSession (hangup + auto-store) + storeBrief (ingest) + recordUsage ───────────

/** Seed an active session row directly (the post-handshake state startSession leaves). */
function seedActive(t: ReturnType<typeof convexTest>, callId = "call_seed", language?: string) {
  return t.run((ctx) =>
    ctx.db.insert("voiceSessions", {
      tenantId: TENANT,
      status: "active" as const,
      callId,
      startedAt: Date.now(),
      endsAt: Date.now() + CAP_MS,
      inAudioTok: 0,
      outAudioTok: 0,
      textInTok: 0,
      textOutTok: 0,
      language,
      createdAt: Date.now(),
    }),
  );
}

test("forceEndSession hangs up the stored callId, marks ended_abnormal, and auto-stores a brief", async () => {
  let hangupUrl: string | undefined;
  vi.stubGlobal("fetch", (url: string) => {
    hangupUrl = String(url);
    return Promise.resolve(new Response(null, { status: 200 }));
  });
  const t = setup();
  const sessionId = await seedActive(t, "call_force");

  const res = await t.action(internal.voice.forceEndSession, { sessionId });
  expect(res).toEqual({ ended: true });
  expect(hangupUrl).toContain("call_force"); // hangupCall targeted the stored callId

  const s = await get(t, sessionId);
  expect(s?.status).toBe("ended_abnormal");
  expect(s?.briefRef).toBeDefined(); // auto-stored (no human present to gate)
  const doc = await t.run((ctx) => ctx.db.get(s!.briefRef!));
  expect(doc?.kind).toBe("brief");
  expect(doc?.source).toBe("voice");
  expect(doc?.status).toBe("processing"); // ingest workflow armed
});

test("forceEndSession is a CAS no-op on an already-ended session (no double hangup)", async () => {
  let fetched = false;
  vi.stubGlobal("fetch", () => {
    fetched = true;
    return Promise.resolve(new Response(null, { status: 200 }));
  });
  const t = setup();
  const sessionId = await seedActive(t, "call_done");
  await t.run((ctx) => ctx.db.patch(sessionId, { status: "ended_clean" })); // a clean end already won

  const res = await t.action(internal.voice.forceEndSession, { sessionId });
  expect(res).toEqual({ noop: true });
  expect(fetched).toBe(false); // never re-hangs up an ended session
  expect((await get(t, sessionId))?.status).toBe("ended_clean"); // unchanged
});

test("storeBrief drafts via the SMOKE transcript and ingests a kind:brief vault doc (PII/content kept)", async () => {
  const t = setup();
  await t.mutation(internal.skills.seedSkills, {}); // voice-brief skill (draftVoiceBrief fail-closed load)
  const sessionId = await seedActive(t, "call_brief", "en");

  const res = await t.action(internal.voice.storeBrief, {
    sessionId,
    transcript: [
      { speaker: "user", text: "SMOKE::route=direct_llm:: let's plan Q3" },
      { speaker: "assistant", text: "Sure — here are the decisions." },
    ],
    language: "en",
  });
  expect("vaultDocId" in res).toBe(true);
  const vaultDocId = (res as { vaultDocId: Id<"vaultDocuments"> }).vaultDocId;

  const doc = await t.run((ctx) => ctx.db.get(vaultDocId));
  expect(doc?.kind).toBe("brief");
  expect(doc?.source).toBe("voice");
  expect(doc?.mimeType).toBe("text/markdown");
  expect(doc?.status).toBe("processing"); // ingest workflow armed — durable steps run in vaultIngest's own tests
  // The brief BODY is vault content: the transcript is welded in verbatim (PII kept, NOT scanText-stripped).
  expect(doc?.text).toContain("let's plan Q3");
  // session.briefRef patched to the stored doc.
  expect((await get(t, sessionId))?.briefRef).toBe(vaultDocId);

  // Idempotent: a second store returns the SAME doc (never a duplicate brief).
  const again = await t.action(internal.voice.storeBrief, {
    sessionId,
    transcript: [{ speaker: "user", text: "SMOKE::route=direct_llm::" }],
    language: "en",
  });
  expect(again).toEqual({ vaultDocId });
});

// ── 14-03 Task 1: startSession's optional, ownership-and-status-validated docRef (DOCV-01) ──────
//
// The server is the TRUST BOUNDARY for the doc scope, not the UI (14-07's picker is a courtesy):
// the CONTEXT decision "never burn capped 15-minute time discussing a document the agent cannot
// actually see" is only TRUE if startSession refuses. A rejected doc must also never leave an
// `active` row holding a watchdog — validation runs before any write.

/** Seed a vault doc for the docRef tests. `status`/`text`/`tenantId` are the three axes validated. */
function seedDoc(
  t: ReturnType<typeof convexTest>,
  opts: {
    tenantId?: string;
    status?: "processing" | "ready" | "failed" | "pending_extraction" | "extracting";
    text?: string;
  } = {},
) {
  return t.run((ctx) =>
    ctx.db.insert("vaultDocuments", {
      tenantId: opts.tenantId ?? TENANT,
      title: "Q3 Performance Report",
      kind: "upload",
      category: "business",
      source: "seam",
      mimeType: "text/markdown",
      size: 32,
      contentHash: `hash_${Math.random().toString(36).slice(2)}`,
      text: opts.text ?? "Churn rose to 9% in Q3, concentrated in the self-serve tier.",
      status: opts.status ?? ("ready" as const),
      createdAt: Date.now(),
    }),
  );
}

test("startSession persists a READY, tenant-owned docRef and audits it as a ref (never the title/text)", async () => {
  const t = setup();
  const docRef = await seedDoc(t);

  const { sessionId } = await asTenant(t).mutation(api.voice.startSession, {
    callId: "call_doc",
    docRef,
  });

  expect((await get(t, sessionId))?.docRef).toBe(docRef);

  // The session_started payload may gain the docRef (an id IS a ref) and NOTHING else (§4).
  const started = await audits(t, "voice.session_started");
  const payload = JSON.stringify(started[0]?.payload);
  expect(payload).toContain(docRef);
  expect(payload).not.toContain("Q3 Performance Report"); // no title
  expect(payload).not.toContain("Churn rose"); // no document text
  expect(payload).not.toContain("call_doc"); // still never the callId-as-secret
});

test("startSession REFUSES a non-ready document and leaves no active session behind", async () => {
  const t = setup();
  const asT = asTenant(t);

  for (const status of ["processing", "extracting", "pending_extraction", "failed"] as const) {
    const docRef = await seedDoc(t, { status });
    await expect(
      asT.mutation(api.voice.startSession, { callId: "call_x", docRef }),
    ).rejects.toThrow(/voicedoc: document not ready/);
  }
  // A ready doc with no extracted text is equally undiscussable.
  const empty = await seedDoc(t, { text: "   " });
  await expect(
    asT.mutation(api.voice.startSession, { callId: "call_x", docRef: empty }),
  ).rejects.toThrow(/voicedoc: document not ready/);

  // No row was left `active` holding a watchdog, and nothing was scheduled.
  expect(await t.query(internal.voice.getActiveSession, { tenantId: TENANT })).toBeNull();
  expect(await listScheduled(t)).toHaveLength(0);
});

test("startSession REFUSES another tenant's document (fail-closed, no cross-tenant scope)", async () => {
  const t = setup();
  const foreign = await seedDoc(t, { tenantId: "tenant_other" });

  await expect(
    asTenant(t).mutation(api.voice.startSession, { callId: "call_x", docRef: foreign }),
  ).rejects.toThrow(/voicedoc: document not found/);
  expect(await t.query(internal.voice.getActiveSession, { tenantId: TENANT })).toBeNull();
});

test("startSession with NO docRef is byte-equivalent to the Phase-6 path (docRef stays absent)", async () => {
  const t = setup();
  const { sessionId } = await asTenant(t).mutation(api.voice.startSession, {
    callId: "call_plain",
  });

  const s = await get(t, sessionId);
  expect(s?.status).toBe("active");
  expect(s?.docRef).toBeUndefined(); // absent, not null — the row shape is unchanged
  expect(s?.watchdogFnId).toBeDefined();
  const payload = JSON.stringify((await audits(t, "voice.session_started"))[0]?.payload);
  expect(payload).toBe(JSON.stringify({ sessionId })); // exactly the Phase-6 payload
});

test("recordUsage accumulates the counters and prices the delta onto spend; a bad count fails closed", async () => {
  const t = setup();
  const sessionId = await seedActive(t, "call_meter");
  const asT = asTenant(t);

  const r1 = await asT.mutation(api.voice.recordUsage, {
    sessionId,
    inAudioTok: 100,
    outAudioTok: 200,
    textInTok: 10,
    textOutTok: 20,
  });
  expect(r1).toEqual({ ok: true });
  const s = await get(t, sessionId);
  expect(s?.inAudioTok).toBe(100);
  expect(s?.outAudioTok).toBe(200);
  expect(s?.textInTok).toBe(10);
  expect(s?.textOutTok).toBe(20);

  // A second delta ACCUMULATES onto the cumulative counters (metering.ts fold).
  await asT.mutation(api.voice.recordUsage, {
    sessionId,
    inAudioTok: 50,
    outAudioTok: 0,
    textInTok: 0,
    textOutTok: 0,
  });
  expect((await get(t, sessionId))?.inAudioTok).toBe(150);

  // Fail closed: a negative (priceRealtime Err) delta patches NOTHING and records no spend.
  const before = await get(t, sessionId);
  const bad = await asT.mutation(api.voice.recordUsage, {
    sessionId,
    inAudioTok: -5,
    outAudioTok: 0,
    textInTok: 0,
    textOutTok: 0,
  });
  expect(bad).toEqual({ ok: false });
  expect((await get(t, sessionId))?.inAudioTok).toBe(before?.inAudioTok); // unchanged — no negative counter
});

// ── 14-08: SC3 — ONE artifact per voice-doc session, whichever path was taken ──────────────────
//
// The CONTEXT decision is that a user should find exactly ONE new thing in their vault after a
// voice-doc session — not a brief AND a memo, and not two memos because the call dropped and the
// watchdog also stored one. This is that decision as a test. It holds because the doc branch reuses
// the SAME `storeBrief`/`briefRef` spine as Phase 6 rather than adding a second write path, so the
// idempotence was inherited, not re-implemented — these assertions pin that it stays inherited.
test("a doc-scoped session leaves exactly ONE brief artifact, across repeat stores", async () => {
  const t = setup();
  await t.mutation(internal.skills.seedSkills, {});
  const vaultDocId = await t.run((ctx) =>
    ctx.db.insert("vaultDocuments", {
      tenantId: TENANT,
      title: "Q3 Performance Report",
      kind: "upload",
      category: "business",
      source: "upload",
      mimeType: "text/markdown",
      size: 32,
      contentHash: "hash_docscoped_one_artifact",
      text: "Churn rose in month two.",
      status: "ready" as const,
      createdAt: Date.now(),
    }),
  );
  const sessionId = await seedActive(t, "call_doc_one_artifact", "en");
  await t.run((ctx) => ctx.db.patch(sessionId, { docRef: vaultDocId }));

  const transcript = [
    { speaker: "user", text: "SMOKE::route=direct_llm:: what does the report say about churn?" },
    { speaker: "assistant", text: "Churn concentrates in month two." },
  ];
  const first = await t.action(internal.voice.storeBrief, { sessionId, transcript, language: "en" });
  const second = await t.action(internal.voice.storeBrief, { sessionId, transcript, language: "en" });

  // Same doc back both times — `briefRef` is the idempotence key, so a re-store (a re-click, or a
  // race between this and the watchdog's auto-store) can never mint a second artifact.
  expect(second).toEqual(first);
  const briefs = await t.run(async (ctx) =>
    (await ctx.db.query("vaultDocuments").collect()).filter((d) => d.kind === "brief"),
  );
  expect(briefs).toHaveLength(1);
  expect((await get(t, sessionId))?.docRef).toBe(vaultDocId); // the doc scope survives the store
});

test("the ABNORMAL end of a doc-scoped session also leaves exactly one", async () => {
  const t = setup();
  await t.mutation(internal.skills.seedSkills, {});
  const vaultDocId = await t.run((ctx) =>
    ctx.db.insert("vaultDocuments", {
      tenantId: TENANT,
      title: "Q3 Performance Report",
      kind: "upload",
      category: "business",
      source: "upload",
      mimeType: "text/markdown",
      size: 32,
      contentHash: "hash_docscoped_abnormal",
      text: "Churn rose in month two.",
      status: "ready" as const,
      createdAt: Date.now(),
    }),
  );
  const sessionId = await seedActive(t, "call_doc_abnormal", "en");
  await t.run((ctx) => ctx.db.patch(sessionId, { docRef: vaultDocId }));

  // Store once (the auto-store a dropped call performs), then mark the session abnormally ended and
  // store again — the shape of "the call dropped, then the watchdog fired".
  const stored = await t.action(internal.voice.storeBrief, {
    sessionId,
    transcript: [{ speaker: "user", text: "SMOKE::route=direct_llm:: quick question" }],
    language: "en",
  });
  await t.run((ctx) => ctx.db.patch(sessionId, { status: "ended_abnormal" as const }));
  const again = await t.action(internal.voice.storeBrief, {
    sessionId,
    transcript: [{ speaker: "user", text: "SMOKE::route=direct_llm:: quick question" }],
    language: "en",
  });

  expect(again).toEqual(stored);
  const briefs = await t.run(async (ctx) =>
    (await ctx.db.query("vaultDocuments").collect()).filter((d) => d.kind === "brief"),
  );
  expect(briefs).toHaveLength(1);
});
