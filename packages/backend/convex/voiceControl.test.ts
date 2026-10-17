import { EventEmitter } from "node:events";
import { convexTest } from "convex-test";
import { afterEach, expect, test, vi } from "vitest";
import aggregateSchema from "../node_modules/@convex-dev/aggregate/src/component/schema.js";
import rateLimiterSchema from "../node_modules/@convex-dev/rate-limiter/src/component/schema.js";
import { api, internal } from "./_generated/api";
import schema from "./schema";

const behavior = vi.hoisted(() => ({
  missingUsage: false,
  badAck: false,
  audioTokens: 1,
  deferFirstResponse: false,
  sent: [] as string[],
}));
vi.mock("ws", () => ({
  default: class extends EventEmitter {
    static OPEN = 1;
    readyState = 1;
    responses = 0;
    constructor() {
      super();
      queueMicrotask(() => this.emit("open"));
    }
    send(raw: string) {
      behavior.sent.push(raw);
      const e = JSON.parse(raw);
      if (e.type === "session.update")
        queueMicrotask(() =>
          this.emit(
            "message",
            JSON.stringify({
              type: "session.updated",
              session: {
                ...e.session,
                model: "gpt-realtime-2.1",
                ...(behavior.badAck ? { truncation: undefined } : {}),
              },
            }),
          ),
        );
      if (e.type === "response.create") {
        const responseNumber = ++this.responses;
        const responseId = `resp_test_${responseNumber}`;
        queueMicrotask(() => {
          this.emit(
            "message",
            JSON.stringify({ type: "response.created", response: { id: responseId } }),
          );
        });
        const complete = () => {
          this.emit(
            "message",
            JSON.stringify({
              type: "response.done",
              response: {
                id: responseId,
                output: [],
                ...(behavior.missingUsage
                  ? {}
                  : {
                      usage: {
                        input_tokens: behavior.audioTokens + 2,
                        output_tokens: 7,
                        input_token_details: { audio_tokens: behavior.audioTokens, text_tokens: 2 },
                        output_token_details: { audio_tokens: 3, text_tokens: 4 },
                      },
                    }),
              },
            }),
          );
          if (!behavior.deferFirstResponse || responseNumber > 1)
            setTimeout(() => this.emit("close"), 30);
        };
        if (behavior.deferFirstResponse && responseNumber === 1) setTimeout(complete, 800);
        else queueMicrotask(complete);
      }
    }
    close() {
      this.readyState = 3;
      this.emit("close");
    }
    terminate() {
      this.close();
    }
  },
}));
const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);
const rateModules = import.meta.glob(
  "../node_modules/@convex-dev/rate-limiter/src/component/**/!(*.test).ts",
);
const aggregateModules = import.meta.glob(
  "../node_modules/@convex-dev/aggregate/src/component/**/!(*.test).ts",
);
function setup() {
  const t = convexTest(schema, modules);
  t.registerComponent("rateLimiter", rateLimiterSchema, rateModules);
  t.registerComponent("auditCounts", aggregateSchema, aggregateModules);
  return t;
}
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  behavior.sent = [];
  behavior.missingUsage = false;
  behavior.badAck = false;
  behavior.audioTokens = 1;
  behavior.deferFirstResponse = false;
});

test("typed input received during a response gets an admitted follow-up after settlement", async () => {
  behavior.deferFirstResponse = true;
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(null, { status: 200 })),
  );
  const t = setup();
  const id = await t.run((ctx) =>
    ctx.db.insert("voiceSessions", {
      tenantId: "voice_deferred",
      onboarding: true,
      controlled: true,
      status: "active",
      callId: "rtc_deferred",
      startedAt: Date.now(),
      endsAt: Date.now() + 4000,
      createdAt: Date.now(),
      controlCommands: [{ seq: 1, text: "Please correct my planned price." }],
      inAudioTok: 0,
      outAudioTok: 0,
      textInTok: 0,
      textOutTok: 0,
    }),
  );
  await t.action(internal.voiceControl.run, { sessionId: id });
  const events = behavior.sent.map((raw) => JSON.parse(raw));
  expect(events.filter((e) => e.type === "response.create")).toHaveLength(2);
  expect(events.filter((e) => e.type === "conversation.item.create")).toHaveLength(1);
  const ledger = await t.run((ctx) => ctx.db.query("spendEvents").collect());
  expect(ledger.filter((e) => e.phase === "reserved").map((e) => e.amountCents)).toEqual([84, 84]);
  expect(ledger.filter((e) => e.phase === "actual")).toHaveLength(2);
  expect((await t.run((ctx) => ctx.db.get(id)))?.hangupConfirmedAt).toBeDefined();
});

test("public connection refuses before any provider request without verified transport evidence", async () => {
  const fetcher = vi.fn();
  vi.stubGlobal("fetch", fetcher);
  vi.stubEnv("VOICE_SERVER_CONTROL_VERIFIED", "");
  const t = setup();
  await expect(
    t
      .withIdentity({ subject: "voice_owner" })
      .action(api.voiceToken.connect, { offerSdp: "invalid" }),
  ).rejects.toThrow("VOICE_CONTROL_NOT_VERIFIED");
  expect(fetcher).not.toHaveBeenCalled();
});
test.each([
  false,
  true,
])("trusted sideband settles complete usage and retains missing usage hold (%s)", async (missing) => {
  behavior.missingUsage = missing;
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(null, { status: 200 })),
  );
  const t = setup();
  const initialReservation = await t.mutation(internal.guardrails.reservePaidCall, {
    tenantId: "voice_control",
    model: "gpt-realtime-2.1",
    callId: crypto.randomUUID(),
    ceilingCents: 100,
  });
  const id = await t.run((ctx) =>
    ctx.db.insert("voiceSessions", {
      tenantId: "voice_control",
      onboarding: true,
      spendReservationId: initialReservation,
      controlled: true,
      status: "active",
      callId: "rtc_test",
      startedAt: Date.now(),
      endsAt: Date.now() + 5000,
      createdAt: Date.now(),
      inAudioTok: 0,
      outAudioTok: 0,
      textInTok: 0,
      textOutTok: 0,
    }),
  );
  await t.action(internal.voiceControl.run, { sessionId: id });
  const s = await t.run((ctx) => ctx.db.get(id));
  const ledger = await t.run((ctx) => ctx.db.query("spendEvents").collect());
  expect(
    ledger
      .filter((e) => e.phase === "reserved")
      .map((e) => e.amountCents)
      .sort((a, b) => a - b),
  ).toEqual([84, 100]);
  expect(ledger.filter((e) => e.phase === "actual")).toHaveLength(missing ? 0 : 1);
  expect(s?.hangupConfirmedAt).toBeDefined();
  expect(s?.status).toBe("ended_abnormal");
  expect(
    behavior.sent.map((s) => JSON.parse(s)).find((e) => e.type === "session.update").session.audio
      .input.turn_detection.create_response,
  ).toBe(false);
  expect(
    behavior.sent.map((s) => JSON.parse(s)).filter((e) => e.type === "response.create"),
  ).toHaveLength(1);
});

test("expired content clears and browser counters cannot alter controlled sessions", async () => {
  const t = setup();
  const sessionId = await t.run((ctx) =>
    ctx.db.insert("voiceSessions", {
      tenantId: "voice_control",
      controlled: true,
      status: "ended_clean",
      startedAt: 1,
      endsAt: 2,
      createdAt: 1,
      controlExpiresAt: 3,
      controlEvents: ["private transcript"],
      controlCommands: [{ seq: 1, text: "private typed turn" }],
      inAudioTok: 0,
      outAudioTok: 0,
      textInTok: 0,
      textOutTok: 0,
    }),
  );
  expect(
    await t.withIdentity({ subject: "voice_control" }).mutation(api.voice.recordUsage, {
      sessionId,
      inAudioTok: 999,
      outAudioTok: 0,
      textInTok: 0,
      textOutTok: 0,
    }),
  ).toEqual({ ok: false });
  await t.mutation(internal.voice.sweepTransientControl, {});
  const session = await t.run((ctx) => ctx.db.get(sessionId));
  expect(session?.controlEvents).toBeUndefined();
  expect(session?.controlCommands).toBeUndefined();
  expect(session?.controlExpiresAt).toBeUndefined();
  expect(session?.inAudioTok).toBe(0);
});

test.each([
  "bad_ack",
  "audio_bound",
  "overage",
])("provider contract failure terminates without continuation: %s", async (mode) => {
  behavior.badAck = mode === "bad_ack";
  behavior.audioTokens = mode === "overage" ? 30000 : 8193;
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(null, { status: 200 })),
  );
  const t = setup();
  await t.mutation(internal.guardrails.reservePaidCall, {
    tenantId: "voice_control",
    model: "gpt-realtime-2.1",
    callId: crypto.randomUUID(),
    ceilingCents: 100,
  });
  const id = await t.run((ctx) =>
    ctx.db.insert("voiceSessions", {
      tenantId: "voice_control",
      controlled: true,
      onboarding: true,
      status: "active",
      callId: "rtc_test",
      startedAt: Date.now(),
      endsAt: Date.now() + 5000,
      createdAt: Date.now(),
      inAudioTok: 0,
      outAudioTok: 0,
      textInTok: 0,
      textOutTok: 0,
    }),
  );
  await t.action(internal.voiceControl.run, { sessionId: id });
  const ledger = await t.run((ctx) => ctx.db.query("spendEvents").collect());
  const session = await t.run((ctx) => ctx.db.get(id));
  expect(session?.hangupConfirmedAt).toBeDefined();
  expect(
    behavior.sent.map((s) => JSON.parse(s)).filter((e) => e.type === "response.create"),
  ).toHaveLength(mode === "bad_ack" ? 0 : 1);
  expect(ledger.filter((e) => e.phase === "refunded")).toHaveLength(0);
  expect(ledger.filter((e) => e.phase === "actual").map((e) => e.amountCents)).toEqual(
    mode === "overage" ? [97] : [],
  );
  expect(session?.inAudioTok).toBe(mode === "bad_ack" ? 0 : behavior.audioTokens);
});
