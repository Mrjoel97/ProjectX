import { EventEmitter } from "node:events";
import { convexTest } from "convex-test";
import { afterEach, expect, test, vi } from "vitest";
import aggregateSchema from "../node_modules/@convex-dev/aggregate/src/component/schema.js";
import rateLimiterSchema from "../node_modules/@convex-dev/rate-limiter/src/component/schema.js";
import { api, internal } from "./_generated/api";
import schema from "./schema";

const behavior = vi.hoisted(() => ({ missingUsage: false, sent: [] as string[] }));
vi.mock("ws", () => ({
  default: class extends EventEmitter {
    static OPEN = 1;
    readyState = 1;
    constructor() {
      super();
      queueMicrotask(() => this.emit("open"));
    }
    send(raw: string) {
      behavior.sent.push(raw);
      const e = JSON.parse(raw);
      if (e.type === "session.update")
        queueMicrotask(() =>
          this.emit("message", JSON.stringify({ type: "session.updated", session: e.session })),
        );
      if (e.type === "response.create")
        queueMicrotask(() => {
          this.emit(
            "message",
            JSON.stringify({ type: "response.created", response: { id: "resp_test" } }),
          );
          this.emit(
            "message",
            JSON.stringify({
              type: "response.done",
              response: {
                id: "resp_test",
                output: [],
                ...(behavior.missingUsage
                  ? {}
                  : {
                      usage: {
                        input_tokens: 3,
                        output_tokens: 7,
                        input_token_details: { audio_tokens: 1, text_tokens: 2 },
                        output_token_details: { audio_tokens: 3, text_tokens: 4 },
                      },
                    }),
              },
            }),
          );
          setTimeout(() => this.emit("close"), 30);
        });
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
  const id = await t.run((ctx) =>
    ctx.db.insert("voiceSessions", {
      tenantId: "voice_control",
      onboarding: true,
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
  expect(ledger.filter((e) => e.phase === "reserved")).toHaveLength(1);
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
