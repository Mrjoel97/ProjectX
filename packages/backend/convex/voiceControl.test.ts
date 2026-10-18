import { EventEmitter } from "node:events";
import { getFunctionName } from "convex/server";
import { convexTest } from "convex-test";
import { afterEach, expect, test, vi } from "vitest";
import aggregateSchema from "../node_modules/@convex-dev/aggregate/src/component/schema.js";
import rateLimiterSchema from "../node_modules/@convex-dev/rate-limiter/src/component/schema.js";
import { api, internal } from "./_generated/api";
import schema from "./schema";
import { run as runVoiceControl } from "./voiceControl";

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

test("a reservation completing at the deadline never sends a new provider response", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(null, { status: 200 })),
  );
  const t = setup();
  const now = Date.now();
  const endsAt = now + 5000;
  const id = await t.run((ctx) =>
    ctx.db.insert("voiceSessions", {
      tenantId: "voice_late_reservation",
      onboarding: true,
      controlled: true,
      status: "active",
      callId: "rtc_late_reservation",
      startedAt: now,
      endsAt,
      createdAt: now,
      inAudioTok: 0,
      outAudioTok: 0,
      textInTok: 0,
      textOutTok: 0,
    }),
  );
  const clock = vi.spyOn(Date, "now").mockReturnValue(now);
  let reservations = 0;
  try {
    await t.action(async (ctx) => {
      const runMutation: typeof ctx.runMutation = async (ref, ...args) => {
        const result = await ctx.runMutation(ref, ...args);
        if (getFunctionName(ref) === "guardrails:reservePaidCall") {
          reservations++;
          // The real reservation commits before the action resumes at its deadline.
          clock.mockReturnValue(endsAt);
        }
        return result;
      };
      // Convex's installed registered function exposes this handler at runtime;
      // our lifecycle builder intentionally narrows its public TypeScript surface.
      const worker = runVoiceControl as unknown as {
        _handler(context: typeof ctx, args: { sessionId: typeof id }): Promise<void>;
      };
      await worker._handler({ ...ctx, runMutation }, { sessionId: id });
    });
  } finally {
    clock.mockRestore();
  }
  expect(reservations).toBe(1);
  expect(
    behavior.sent.map((raw) => JSON.parse(raw)).filter((e) => e.type === "response.create"),
  ).toEqual([]);
  const ledger = await t.run((ctx) => ctx.db.query("spendEvents").collect());
  expect(ledger.filter((e) => e.phase === "reserved").map((e) => e.amountCents)).toEqual([84]);
  expect(ledger.filter((e) => e.phase === "actual" || e.phase === "refunded")).toEqual([]);
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

test("pilot voice admits only onboarding for its tenant and refuses expiry before provider calls", async () => {
  const t = setup(),
    tenantId = "j57aaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  const issuedAt = Date.now(),
    expiresAt = issuedAt + 1800000;
  const fetcher = vi.fn();
  vi.stubGlobal("fetch", fetcher);
  vi.stubEnv("VOICE_SERVER_CONTROL_VERIFIED", "0");
  vi.stubEnv("FOUNDATION_ONBOARDING_ENABLED", "0");
  vi.stubEnv("NATIVE_ONBOARDING_PILOT", JSON.stringify({ tenantId, issuedAt, expiresAt }));
  const owner = t.withIdentity({ subject: tenantId });
  await expect(owner.action(api.voiceToken.connect, { offerSdp: "invalid" })).rejects.toThrow(
    "VOICE_CONTROL_NOT_VERIFIED",
  );
  await expect(
    t
      .withIdentity({ subject: "j57bbbbbbbbbbbbbbbbbbbbbbbbbbbbb" })
      .action(api.voiceToken.connect, { offerSdp: "invalid", onboarding: true }),
  ).rejects.toThrow("VOICE_CONTROL_NOT_VERIFIED");
  // Correct tenant reaches SDP validation, still no provider work for invalid media.
  await expect(
    owner.action(api.voiceToken.connect, { offerSdp: "invalid", onboarding: true }),
  ).rejects.toThrow("VOICE_AUDIO_ONLY_REQUIRED");
  vi.stubEnv(
    "NATIVE_ONBOARDING_PILOT",
    JSON.stringify({ tenantId, issuedAt: issuedAt - 900000, expiresAt: issuedAt }),
  );
  await expect(
    owner.action(api.voiceToken.connect, { offerSdp: "invalid", onboarding: true }),
  ).rejects.toThrow("VOICE_CONTROL_NOT_VERIFIED");
  expect(fetcher).not.toHaveBeenCalled();
});

test.each([
  "0",
  "1",
])("short onboarding pilot refuses provider work even when ordinary voice is enabled (%s)", async (ordinaryVoiceEnabled) => {
  const t = setup();
  const tenantId = "j57aaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  const issuedAt = Date.now();
  const fetcher = vi.fn();
  vi.stubGlobal("fetch", fetcher);
  vi.stubEnv("VOICE_SERVER_CONTROL_VERIFIED", ordinaryVoiceEnabled);
  vi.stubEnv("FOUNDATION_ONBOARDING_ENABLED", "0");
  vi.stubEnv(
    "NATIVE_ONBOARDING_PILOT",
    JSON.stringify({ tenantId, issuedAt, expiresAt: issuedAt + 14 * 60_000 }),
  );
  await expect(
    t.withIdentity({ subject: tenantId }).action(api.voiceToken.connect, {
      offerSdp: "invalid",
      onboarding: true,
    }),
  ).rejects.toThrow("VOICE_PILOT_WINDOW_TOO_SHORT");
  expect(fetcher).not.toHaveBeenCalled();
  expect(await t.run((ctx) => ctx.db.query("spendEvents").collect())).toEqual([]);
});
