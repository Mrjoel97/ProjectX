// The server↔OpenAI Realtime seam (voiceToken.ts, VOIC-01/VOIC-02). `fetch` is stubbed (no
// network, no live OpenAI): the tests assert the OUTGOING request shape and that the resolved
// value NEVER carries OPENAI_API_KEY. There is no convex-test fixture seam here — the whole
// contract is "what leaves Convex, and what comes back", so a captured mock fetch is the seam.
import {
  CLIENT_SECRETS_URL,
  DEFAULT_REALTIME_MODEL,
  hangupUrl,
  TURN_DETECTION_TYPE,
} from "@pikar/voice";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { internal } from "./_generated/api";
import schema from "./schema";
import { voiceSessionSkillBody } from "@pikar/contracts/skills/voiceSession";

// @ts-expect-error import.meta.glob is provided by Vite/vitest at runtime.
const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);

const TENANT = "tenant_voice";
// A DISTINCTIVE key so the no-leak assertion is unambiguous — a substring search for it in the
// serialized result must find nothing (Pitfall 4: the key never rides back to the browser).
const FAKE_KEY = "sk-LEAK-CANARY-do-not-return-0xDEADBEEF";

/** Capture the last fetch call so a test can assert URL/headers/body. */
type Captured = { url: string; init: RequestInit };
let captured: Captured | undefined;

/** Stub global fetch with a caller-supplied responder; record every call. */
function stubFetch(responder: (url: string, init: RequestInit) => Response) {
  captured = undefined;
  vi.stubGlobal("fetch", (url: string, init: RequestInit = {}) => {
    captured = { url, init };
    return Promise.resolve(responder(url, init));
  });
}

beforeEach(() => {
  process.env.OPENAI_API_KEY = FAKE_KEY;
});
afterEach(() => {
  vi.unstubAllGlobals();
});

const asTenant = (t: ReturnType<typeof convexTest>) => t.withIdentity({ subject: TENANT });

// ── Task 1: mintClientSecret ──────────────────────────────────────────────────────────────────

test("mintClientSecret POSTs the client_secrets endpoint with the Bearer key + the registry persona", async () => {
  const t = convexTest(schema, modules);
  await t.mutation(internal.skills.seedSkills, {}); // seeds voice-session as active v1
  stubFetch(() => Response.json({ client_secret: "ek_ephemeral_abc", expires_at: 1234 }));

  await asTenant(t).action(internal.voiceToken.mintClientSecret, {});

  expect(captured, "mint must call fetch").toBeTruthy();
  expect(captured!.url).toBe(CLIENT_SECRETS_URL);
  const headers = captured!.init.headers as Record<string, string>;
  expect(headers.Authorization).toBe(`Bearer ${FAKE_KEY}`);
  const body = JSON.parse(captured!.init.body as string);
  // The session config comes from the pinned realtime.ts constants…
  expect(body.session.model).toBe(DEFAULT_REALTIME_MODEL);
  expect(body.session.turn_detection.type).toBe(TURN_DETECTION_TYPE);
  // …and the live-session instructions are the REGISTRY skill body, not a hardcoded prompt (§5).
  expect(body.session.instructions).toBe(voiceSessionSkillBody);
});

test("mintClientSecret returns ONLY {clientSecret, expiresAt} and NEVER the API key", async () => {
  const t = convexTest(schema, modules);
  await t.mutation(internal.skills.seedSkills, {});
  stubFetch(() => Response.json({ client_secret: "ek_ephemeral_xyz", expires_at: 9999 }));

  const res = await asTenant(t).action(internal.voiceToken.mintClientSecret, {});

  expect(Object.keys(res).sort()).toEqual(["clientSecret", "expiresAt"]);
  expect(res.clientSecret).toBe("ek_ephemeral_xyz");
  expect(res.expiresAt).toBe(9999);
  // The linchpin: the server key is structurally absent from what the browser receives.
  expect(JSON.stringify(res)).not.toContain(FAKE_KEY);
});

test("mintClientSecret fails closed when no active voice-session skill is seeded (NO_ACTIVE_SKILL)", async () => {
  const t = convexTest(schema, modules);
  // No seedSkills → no active persona. A registry-backed mint MUST throw (a hardcoded prompt
  // would never consult the registry and would silently proceed).
  stubFetch(() => Response.json({ client_secret: "ek", expires_at: 1 }));
  await expect(asTenant(t).action(internal.voiceToken.mintClientSecret, {})).rejects.toThrow();
});

// ── Task 2: hangupCall ──────────────────────────────────────────────────────────────────────

test("hangupCall POSTs /v1/realtime/calls/{callId}/hangup with the Bearer key and resolves on 200", async () => {
  const t = convexTest(schema, modules);
  stubFetch(() => new Response(null, { status: 200 }));

  const res = await t.action(internal.voiceToken.hangupCall, { callId: "call_123" });

  expect(res).toEqual({ ended: true });
  expect(captured!.url).toBe(hangupUrl("call_123"));
  expect(captured!.init.method).toBe("POST");
  const headers = captured!.init.headers as Record<string, string>;
  expect(headers.Authorization).toBe(`Bearer ${FAKE_KEY}`);
  // Refs-only: the callId targets the URL; the key never rides into the result.
  expect(JSON.stringify(res)).not.toContain(FAKE_KEY);
});

test("hangupCall surfaces a non-200 as an error the caller can log refs-only", async () => {
  const t = convexTest(schema, modules);
  stubFetch(() => new Response("nope", { status: 404 }));
  await expect(t.action(internal.voiceToken.hangupCall, { callId: "call_gone" })).rejects.toThrow();
});
