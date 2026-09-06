// The server↔OpenAI Realtime seam (voiceToken.ts, VOIC-01/VOIC-02). `fetch` is stubbed (no
// network, no live OpenAI): the tests assert the OUTGOING request shape and that the resolved
// value NEVER carries OPENAI_API_KEY. There is no convex-test fixture seam here — the whole
// contract is "what leaves Convex, and what comes back", so a captured mock fetch is the seam.

import { documentAnalystSkillBody } from "@pikar/contracts/skills/documentAnalyst";
import { voiceSessionSkillBody } from "@pikar/contracts/skills/voiceSession";
import {
  CLIENT_SECRETS_URL,
  DEFAULT_REALTIME_MODEL,
  DIGEST_CHAR_CAP,
  DIGEST_FENCE_CLOSE,
  DIGEST_FENCE_OPEN,
  hangupUrl,
  SEARCH_DOCUMENT_TOOL,
  TOOL_CHOICE_AUTO,
  TRANSCRIPTION_MODEL,
  TURN_DETECTION_TYPE,
} from "@pikar/voice";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);

const TENANT = "tenant_voice";
// A DISTINCTIVE key so the no-leak assertion is unambiguous — a substring search for it in the
// serialized result must find nothing (Pitfall 4: the key never rides back to the browser).
const FAKE_KEY = "sk-LEAK-CANARY-do-not-return-0xDEADBEEF";

/** Capture the last fetch call so a test can assert URL/headers/body. */
type Captured = { url: string; init: RequestInit };
let captured: Captured | undefined;
/** EVERY fetch call, in order — the 14-04 tools-at-mint fallback POSTs twice and the SECOND
 *  body is the one that must carry no tool array. `captured` stays the last-call shorthand. */
let calls: Captured[] = [];

/** Stub global fetch with a caller-supplied responder; record every call. */
function stubFetch(responder: (url: string, init: RequestInit) => Response) {
  captured = undefined;
  calls = [];
  vi.stubGlobal("fetch", (url: string, init: RequestInit = {}) => {
    captured = { url, init };
    calls.push({ url, init });
    return Promise.resolve(responder(url, init));
  });
}

/** The parsed `session` object of the Nth (0-based) captured POST body. Throws rather than
 *  returning undefined, so "the fallback never fired" fails as a missing call, not a vague null. */
function sessionOf(i: number): Record<string, unknown> {
  const call = calls[i];
  if (!call) throw new Error(`sessionOf: no captured fetch call at index ${i}`);
  return JSON.parse(call.init.body as string).session;
}

beforeEach(() => {
  // `vi.stubEnv`, never a raw assignment. The raw form had no cleanup and LEAKED into every later
  // file in the worker; under 36-01 a leaked key closes every `SMOKE::` gate downstream, which
  // surfaced as proactiveReview.test.ts hitting the timer-pump ceiling only in a full-suite run.
  vi.stubEnv("OPENAI_API_KEY", FAKE_KEY);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

const asTenant = (t: ReturnType<typeof convexTest>) => t.withIdentity({ subject: TENANT });

const DOC_TITLE = "Q3 Revenue Retrospective";
const DOC_TEXT = "Churn rose to eleven percent in the third quarter across the mid-market segment.";

/** Seed a vault document row directly (the mint reads it through `internal.voiceToken.docForMint`;
 *  the real ingest workflow is not the subject here). Defaults to a `ready` doc with text. */
function seedDoc(
  t: ReturnType<typeof convexTest>,
  over: { tenantId?: string; status?: string; text?: string; extractionTruncated?: boolean } = {},
): Promise<Id<"vaultDocuments">> {
  return t.run(async (ctx) =>
    ctx.db.insert("vaultDocuments", {
      tenantId: over.tenantId ?? TENANT,
      title: DOC_TITLE,
      kind: "upload",
      category: "reference",
      source: "upload",
      mimeType: "text/plain",
      size: 128,
      contentHash: `hash_${Math.random()}`,
      text: over.text ?? DOC_TEXT,
      status: (over.status ?? "ready") as "ready",
      ...(over.extractionTruncated === undefined
        ? {}
        : { extractionTruncated: over.extractionTruncated }),
      createdAt: Date.now(),
    }),
  );
}

/** Seed the smallest confirmed live blueprint needed to exercise the voice grounding boundary. */
async function seedConfirmedBlueprint(t: ReturnType<typeof convexTest>): Promise<void> {
  const blueprintDocId = await t.run(async (ctx) =>
    ctx.db.insert("vaultDocuments", {
      tenantId: TENANT,
      title: "Business blueprint",
      kind: "business_blueprint",
      category: "business",
      source: "generated",
      mimeType: "text/markdown",
      size: 96,
      contentHash: "voice_blueprint_hash",
      text: "# Business blueprint\n\n- One-line description: Repairs bicycles for city commuters [stated]\n",
      status: "ready",
      createdAt: Date.now(),
    }),
  );
  await t.run(async (ctx) => {
    await ctx.db.insert("tenantProfiles", {
      tenantId: TENANT,
      tier: "sme",
      tierSource: "confirmed",
      derivedAt: Date.now(),
      blueprintDocId,
      blueprintConfirmedAt: Date.now(),
      blueprintSourceDocIds: [],
    });
  });
}

// ── Task 1: mintClientSecret ──────────────────────────────────────────────────────────────────

test("mintClientSecret POSTs the client_secrets endpoint with the Bearer key + the registry persona", async () => {
  const t = convexTest(schema, modules);
  await t.mutation(internal.skills.seedSkills, {}); // seeds voice-session as active v1
  stubFetch(() => Response.json({ value: "ek_ephemeral_abc", expires_at: 1234 }));

  await asTenant(t).action(api.voiceToken.mintClientSecret, {});

  expect(captured, "mint must call fetch").toBeTruthy();
  expect(captured!.url).toBe(CLIENT_SECRETS_URL);
  const headers = captured!.init.headers as Record<string, string>;
  expect(headers.Authorization).toBe(`Bearer ${FAKE_KEY}`);
  const body = JSON.parse(captured!.init.body as string);
  // The session config comes from the pinned realtime.ts constants…
  expect(body.session.model).toBe(DEFAULT_REALTIME_MODEL);
  // …LIVE-VERIFIED 2026-07-20: turn_detection + transcription nest under audio.input (a top-level
  // session.turn_detection 400s). A regression here is exactly what the mock could not catch.
  expect(body.session.audio.input.turn_detection.type).toBe(TURN_DETECTION_TYPE);
  expect(body.session.audio.input.transcription.model).toBe(TRANSCRIPTION_MODEL);
  // …and the live-session instructions are the REGISTRY skill body, not a hardcoded prompt (§5).
  expect(body.session.instructions).toBe(voiceSessionSkillBody);
  // 14-04 regression pin: an UNSCOPED mint is byte-unchanged from Phase 6. No digest is appended
  // (exact equality above) and the tool keys are ABSENT — not empty arrays, absent — so a
  // doc-scoped feature can never quietly change the shape of every ordinary voice call.
  expect(Object.hasOwn(body.session, "tools")).toBe(false);
  expect(Object.hasOwn(body.session, "tool_choice")).toBe(false);
});

test("an unscoped voice session receives the tenant's confirmed blueprint spine", async () => {
  const t = convexTest(schema, modules);
  await t.mutation(internal.skills.seedSkills, {});
  await seedConfirmedBlueprint(t);
  stubFetch(() => Response.json({ value: "ek_blueprint", expires_at: 1234 }));

  await asTenant(t).action(api.voiceToken.mintClientSecret, {});

  const instructions = sessionOf(0).instructions as string;
  expect(instructions.startsWith(voiceSessionSkillBody)).toBe(true);
  expect(instructions).toContain("<business_blueprint>");
  expect(instructions).toContain("Repairs bicycles for city commuters");
  expect(instructions).toContain("</business_blueprint>");
  expect(instructions).not.toContain("# Business blueprint");
});

test("mintClientSecret returns ONLY {clientSecret, expiresAt, toolsAtMint} and NEVER the API key", async () => {
  const t = convexTest(schema, modules);
  await t.mutation(internal.skills.seedSkills, {});
  stubFetch(() => Response.json({ value: "ek_ephemeral_xyz", expires_at: 9999 }));

  const res = await asTenant(t).action(api.voiceToken.mintClientSecret, {});

  // `toolsAtMint` (14-04) is the ONE deliberate extension to the Phase-6 contract — transport
  // control, not a secret. The key set is still asserted EXACTLY, so a third field cannot creep in.
  expect(Object.keys(res).sort()).toEqual(["clientSecret", "expiresAt", "toolsAtMint"]);
  expect(res.clientSecret).toBe("ek_ephemeral_xyz");
  expect(res.expiresAt).toBe(9999);
  // Trivially true with no doc scope: nothing was declared, so the browser has nothing to re-declare.
  expect(res.toolsAtMint).toBe(true);
  // The linchpin: the server key is structurally absent from what the browser receives.
  expect(JSON.stringify(res)).not.toContain(FAKE_KEY);
});

test("mintClientSecret fails closed when no active voice-session skill is seeded (NO_ACTIVE_SKILL)", async () => {
  const t = convexTest(schema, modules);
  // No seedSkills → no active persona. A registry-backed mint MUST throw (a hardcoded prompt
  // would never consult the registry and would silently proceed).
  stubFetch(() => Response.json({ value: "ek", expires_at: 1 }));
  await expect(asTenant(t).action(api.voiceToken.mintClientSecret, {})).rejects.toThrow();
});

// ── Plan 14-04: the DOC-SCOPED mint (DOCV-01 / SC1) ───────────────────────────────────────────

test("a doc-scoped mint bakes the document-analyst persona + the fenced digest into instructions", async () => {
  const t = convexTest(schema, modules);
  await t.mutation(internal.skills.seedSkills, {});
  const docId = await seedDoc(t);
  stubFetch(() => Response.json({ value: "ek_doc", expires_at: 4242 }));

  const res = await asTenant(t).action(api.voiceToken.mintClientSecret, { docId });

  const session = sessionOf(0);
  const instructions = session.instructions as string;
  // The PERSONA comes first and is the registry row for `document-analyst`, not `voice-session`
  // and not a hardcoded prompt (§5). `startsWith` (rather than equality) is what lets the digest
  // be appended without loosening the "the persona is a registry row" assertion.
  expect(instructions.startsWith(documentAnalystSkillBody)).toBe(true);
  expect(instructions).not.toBe(voiceSessionSkillBody);
  // …then the DIGEST: fenced on both sides, naming this specific report.
  expect(instructions).toContain(DIGEST_FENCE_OPEN);
  expect(instructions).toContain(DIGEST_FENCE_CLOSE);
  expect(instructions).toContain(DOC_TITLE);
  expect(instructions).toContain(DOC_TEXT);
  // The instruction BUDGET. gpt-realtime-2.1 is a 32k window and `instructions` are re-billed as
  // input on every turn, so a future digest change must not silently blow past the cap: persona +
  // capped slice + a little chrome (title, disclosure, fence markers, safety line).
  expect(instructions.length).toBeLessThan(documentAnalystSkillBody.length + DIGEST_CHAR_CAP + 500);
  // Return contract, doc-scoped: still exactly three keys, still no key material.
  expect(Object.keys(res).sort()).toEqual(["clientSecret", "expiresAt", "toolsAtMint"]);
  expect(JSON.stringify(res)).not.toContain(FAKE_KEY);
});

test("a doc-scoped mint declares exactly ONE tool, in the FLAT Realtime shape, with tool_choice auto", async () => {
  const t = convexTest(schema, modules);
  await t.mutation(internal.skills.seedSkills, {});
  const docId = await seedDoc(t);
  stubFetch(() => Response.json({ value: "ek_doc", expires_at: 1 }));

  const res = await asTenant(t).action(api.voiceToken.mintClientSecret, { docId });

  const session = sessionOf(0);
  const tools = session.tools as Record<string, unknown>[];
  // EXACTLY one, and it is the read-only retrieval tool. The tool SET is the containment: nothing
  // a prompt injected into the report could ask for is reachable (no write, no send, no plan).
  expect(tools).toHaveLength(1);
  const [tool] = tools;
  if (!tool) throw new Error("expected exactly one declared tool"); // narrows for tsc
  expect(tool.name).toBe(SEARCH_DOCUMENT_TOOL.name);
  expect(tool.name).toBe("search_document");
  // FLAT — {type,name,description,parameters} — NOT the Chat-Completions {type,function:{…}}
  // nesting. Getting this wrong 400s the mint, and a mock cannot tell us that any other way.
  expect(Object.hasOwn(tool, "parameters")).toBe(true);
  expect(Object.hasOwn(tool, "function")).toBe(false);
  expect(session.tool_choice).toBe(TOOL_CHOICE_AUTO);
  expect(session.tool_choice).toBe("auto");
  // One POST was enough — the 400 fallback did not fire.
  expect(calls).toHaveLength(1);
  expect(res.toolsAtMint).toBe(true);
});

test("a 400 on the tools-carrying mint re-POSTs WITHOUT tools and reports toolsAtMint false", async () => {
  const t = convexTest(schema, modules);
  await t.mutation(internal.skills.seedSkills, {});
  const docId = await seedDoc(t);
  // Open Question 3: if `client_secrets` refuses `tools` in the body, the session must still open.
  let n = 0;
  stubFetch(() =>
    n++ === 0
      ? new Response("unknown parameter: session.tools", { status: 400 })
      : Response.json({ value: "ek_no_tools", expires_at: 77 }),
  );

  const res = await asTenant(t).action(api.voiceToken.mintClientSecret, { docId });

  expect(calls).toHaveLength(2);
  // The FIRST attempt carried them…
  expect(Object.hasOwn(sessionOf(0), "tools")).toBe(true);
  // …the SECOND carries neither key, and still carries the persona + digest.
  expect(Object.hasOwn(sessionOf(1), "tools")).toBe(false);
  expect(Object.hasOwn(sessionOf(1), "tool_choice")).toBe(false);
  expect(sessionOf(1).instructions as string).toContain(DIGEST_FENCE_OPEN);
  // The session OPENED, and the browser is told to declare the tools over the data channel (14-06).
  expect(res.clientSecret).toBe("ek_no_tools");
  expect(res.toolsAtMint).toBe(false);
});

test("a non-400 mint failure still throws (the fallback is a SHAPE retry, not a retry policy)", async () => {
  const t = convexTest(schema, modules);
  await t.mutation(internal.skills.seedSkills, {});
  const docId = await seedDoc(t);
  stubFetch(() => new Response("boom", { status: 500 }));

  await expect(asTenant(t).action(api.voiceToken.mintClientSecret, { docId })).rejects.toThrow();
  expect(calls).toHaveLength(1); // no second POST on a 500
});

test("a doc-scoped mint fails closed when document-analyst has no active row — while the unscoped mint still works", async () => {
  const t = convexTest(schema, modules);
  await t.mutation(internal.skills.seedSkills, {});
  // Remove ONLY the document-analyst rows. `voice-session` stays active, which is what makes this
  // assertion non-vacuous: the failure is the MISSING PERSONA, not a broken harness (mirrors the
  // NO_ACTIVE_SKILL pattern above, which unseeds everything).
  await t.run(async (ctx) => {
    for (const row of await ctx.db.query("skills").collect()) {
      if (row.name === "document-analyst") await ctx.db.delete(row._id);
    }
  });
  const docId = await seedDoc(t);
  stubFetch(() => Response.json({ value: "ek", expires_at: 1 }));

  await expect(asTenant(t).action(api.voiceToken.mintClientSecret, { docId })).rejects.toThrow();
  // …and no request left Convex: a registry-backed mint consults the registry FIRST.
  expect(calls).toHaveLength(0);
  // Anti-vacuous: the same harness mints fine without a doc scope.
  await expect(asTenant(t).action(api.voiceToken.mintClientSecret, {})).resolves.toBeTruthy();
});

test("the mint is a second trust boundary: a missing/cross-tenant doc and a non-ready doc are both refused", async () => {
  const t = convexTest(schema, modules);
  await t.mutation(internal.skills.seedSkills, {});
  const foreign = await seedDoc(t, { tenantId: "tenant_other" });
  const processing = await seedDoc(t, { status: "processing" });
  stubFetch(() => Response.json({ value: "ek", expires_at: 1 }));

  // Cross-tenant reads as MISSING (fail-closed — the message never says "another tenant's").
  await expect(
    asTenant(t).action(api.voiceToken.mintClientSecret, { docId: foreign }),
  ).rejects.toThrow(/document not found/);
  await expect(
    asTenant(t).action(api.voiceToken.mintClientSecret, { docId: processing }),
  ).rejects.toThrow(/document not ready/);
  expect(calls).toHaveLength(0); // refused before any request left Convex
});

test("a truncated extraction is disclosed inside the digest before the fence opens", async () => {
  const t = convexTest(schema, modules);
  await t.mutation(internal.skills.seedSkills, {});
  const docId = await seedDoc(t, { extractionTruncated: true });
  stubFetch(() => Response.json({ value: "ek", expires_at: 1 }));

  await asTenant(t).action(api.voiceToken.mintClientSecret, { docId });

  const instructions = sessionOf(0).instructions as string;
  expect(instructions).toContain("Only the first portion of this document could be extracted.");
  expect(instructions.indexOf("Only the first portion")).toBeLessThan(
    instructions.indexOf(DIGEST_FENCE_OPEN),
  );
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
