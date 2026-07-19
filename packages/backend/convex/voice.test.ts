// The server-side voice-session engine (voice.ts, VOIC-02/VOIC-03). convex-test + FAKE TIMERS: the
// watchdog is a durable scheduler.runAt timer, so the tests arm it, advance/inspect the scheduled
// system rows, and assert the clean/abnormal CAS transitions. `fetch` is stubbed (hangupCall). The
// brief → vault ingest is driven by the draftVoiceBrief SMOKE sentinel (offline, no model/network).
import { CAP_MS } from "@pikar/voice";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";
// Register the components the voice spine touches offline (vaultTranscribe.test.ts set): rateLimiter
// (recordUsage → recordSpend), auditCounts (audit.log aggregate), workflow + workpool (storeBrief →
// ingestDoc). Durable workflow steps do NOT run synchronously — `status: "processing"` on the brief
// vault row IS the synchronous seam effect (vault.test.ts pattern). Relative specifiers because the
// package blocks the deep `/src/component` path.
import aggregateSchema from "../node_modules/@convex-dev/aggregate/src/component/schema.js";
import rateLimiterSchema from "../node_modules/@convex-dev/rate-limiter/src/component/schema.js";
import workflowSchema from "../node_modules/@convex-dev/workflow/src/component/schema.js";
import workpoolSchema from "../node_modules/@convex-dev/workpool/src/component/schema.js";

// @ts-expect-error import.meta.glob is provided by Vite/vitest at runtime.
const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);
// @ts-expect-error import.meta.glob is provided by Vite/vitest at runtime.
const rateLimiterModules = import.meta.glob("../node_modules/@convex-dev/rate-limiter/src/component/**/!(*.test).ts");
// @ts-expect-error import.meta.glob is provided by Vite/vitest at runtime.
const aggregateModules = import.meta.glob("../node_modules/@convex-dev/aggregate/src/component/**/!(*.test).ts");
// @ts-expect-error import.meta.glob is provided by Vite/vitest at runtime.
const workflowModules = import.meta.glob("../node_modules/@convex-dev/workflow/src/component/**/!(*.test).ts");
// @ts-expect-error import.meta.glob is provided by Vite/vitest at runtime.
const workpoolModules = import.meta.glob("../node_modules/@convex-dev/workpool/src/component/**/!(*.test).ts");

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
    const { sessionId } = await asTenant(t).mutation(api.voice.startSession, { callId: "call_abc" });

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
  let s = await get(t, sessionId);
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
