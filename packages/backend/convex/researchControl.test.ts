// @vitest-environment node
import { convexTest } from "convex-test";
import { afterEach, expect, test, vi } from "vitest";
import { internal } from "./_generated/api";
import { buildWebResearchTool } from "./llm";
import schema from "./schema";

const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);
const requestId = "00000000-0000-4000-8000-000000000001";
const tenantId = "research-owner";
const page = "https://example.com/pricing";
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

test("native admission is immutable and concurrent claims share one finite allowance", async () => {
  const t = convexTest(schema, modules);
  const input = { tenantId, requestId, limit: 2 };
  const ids = await Promise.all([
    t.mutation(internal.researchControl.admit, input),
    t.mutation(internal.researchControl.admit, input),
  ]);
  expect(ids[0]).toBe(ids[1]);
  const cleanupJobs = (
    await t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect())
  ).filter((row) => String(row.name).includes("purgeExpired"));
  expect(cleanupJobs).toHaveLength(1);
  await expect(t.mutation(internal.researchControl.admit, { ...input, limit: 6 })).rejects.toThrow(
    "RESEARCH_LIMIT_IMMUTABLE",
  );
  const controlId = ids[0];
  if (controlId === undefined) throw new Error("missing admitted research control");
  const claim = { tenantId, requestId, controlId };
  expect(
    await t.mutation(internal.researchControl.claim, {
      ...claim,
      tenantId: "foreign",
      attemptId: crypto.randomUUID(),
    }),
  ).toBe(false);
  expect(
    await t.mutation(internal.researchControl.claim, {
      ...claim,
      requestId: crypto.randomUUID(),
      attemptId: crypto.randomUUID(),
    }),
  ).toBe(false);
  expect(
    await t.mutation(internal.researchControl.claim, {
      ...claim,
      attemptId: "------------------------------------",
    }),
  ).toBe(false);
  const attempts = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()];
  const results = await Promise.all(
    attempts.map((attemptId) =>
      t.mutation(internal.researchControl.claim, { ...claim, attemptId }),
    ),
  );
  expect(results.filter(Boolean)).toHaveLength(2);
  const firstAcceptedAttempt = attempts[results.indexOf(true)];
  if (firstAcceptedAttempt === undefined) throw new Error("missing accepted claim");
  expect(
    await t.mutation(internal.researchControl.claim, {
      ...claim,
      attemptId: firstAcceptedAttempt,
    }),
  ).toBe(false);
  expect((await t.run((ctx) => ctx.db.get(controlId)))?.attempts).toHaveLength(2);
});

test("expired controls retain a replay tombstone and their one-shot cleanup later removes it", async () => {
  const t = convexTest(schema, modules);
  const controlId = await t.mutation(internal.researchControl.admit, {
    tenantId,
    requestId,
    limit: 1,
  });
  await t.run((ctx) => ctx.db.patch(controlId, { expiresAt: Date.now() - 1 }));
  expect(
    await t.mutation(internal.researchControl.purgeExpired, {
      tenantId,
      requestId,
      controlId,
    }),
  ).toBe(false);
  expect(await t.mutation(internal.researchControl.admit, { tenantId, requestId, limit: 1 })).toBe(
    controlId,
  );
  await t.run((ctx) =>
    ctx.db.patch(controlId, { expiresAt: Date.now() - 24 * 60 * 60 * 1000 - 1 }),
  );
  expect(
    await t.mutation(internal.researchControl.purgeExpired, {
      tenantId,
      requestId,
      controlId,
    }),
  ).toBe(true);
  expect(await t.run((ctx) => ctx.db.get(controlId))).toBeNull();
});

test("closure, expiry and zero mode never refill when readmitted", async () => {
  const t = convexTest(schema, modules);
  for (const mode of ["closed", "expired", "zero"] as const) {
    const root = crypto.randomUUID();
    const input = { tenantId, requestId: root, limit: mode === "zero" ? 0 : 2 };
    const controlId = await t.mutation(internal.researchControl.admit, input);
    if (mode === "closed")
      await t.mutation(internal.researchControl.close, {
        tenantId,
        requestId: root,
        controlId,
      });
    if (mode === "expired")
      await t.run((ctx) => ctx.db.patch(controlId, { expiresAt: Date.now() - 1 }));
    expect(await t.mutation(internal.researchControl.admit, input)).toBe(controlId);
    expect(
      await t.mutation(internal.researchControl.claim, {
        tenantId,
        requestId: root,
        controlId,
        attemptId: crypto.randomUUID(),
      }),
    ).toBe(false);
  }
});

test("reconstructed tools and concurrent children share native claims before extraction; failed extraction consumes its slot", async () => {
  const t = convexTest(schema, modules);
  const controlId = await t.mutation(internal.researchControl.admit, {
    tenantId,
    requestId,
    limit: 2,
  });
  vi.stubEnv("TAVILY_API_KEY", "synthetic");
  const fetchMock = vi.fn(async (url: string) => ({
    ok: true,
    status: 200,
    json: async () =>
      url.endsWith("/search")
        ? { results: [{ url: page, title: "Pricing", content: "summary" }] }
        : { results: [] },
  }));
  vi.stubGlobal("fetch", fetchMock);
  type Exec = (input: unknown, options: never) => Promise<unknown>;
  const make = async () => {
    const tools = buildWebResearchTool(undefined, {
      tenantId,
      requestId,
      controlId,
      ctx: { runMutation: t.mutation.bind(t) } as never,
    }) as unknown as Record<string, { execute: Exec }>;
    const webResearch = tools.webResearch;
    const readPage = tools.readPage;
    if (!webResearch || !readPage) throw new Error("research tools missing");
    await webResearch.execute({ query: "pricing" }, {} as never);
    return () => readPage.execute({ url: page, focus: "price" }, {} as never);
  };
  const reads = await Promise.all([make(), make(), make()]);
  await Promise.all(reads.map((read) => read()));
  await (await make())();
  expect(fetchMock.mock.calls.filter(([url]) => url.endsWith("/extract"))).toHaveLength(2);
  expect((await t.run((ctx) => ctx.db.get(controlId)))?.attempts).toHaveLength(2);
});

test.each([
  false,
  undefined,
  "true",
  "ambiguous",
])("claim response %s cannot authorize extraction", async (response) => {
  vi.stubEnv("TAVILY_API_KEY", "synthetic");
  const fetchMock = vi.fn(async (_url: unknown) => ({
    ok: true,
    json: async () => ({ results: [{ url: page, title: "Pricing", content: "summary" }] }),
  }));
  vi.stubGlobal("fetch", fetchMock);
  const tools = buildWebResearchTool(undefined, {
    tenantId,
    requestId,
    controlId: "synthetic" as never,
    ctx: {
      runMutation: async () => {
        if (response === "ambiguous") throw new Error("transport");
        return response;
      },
    } as never,
  }) as unknown as Record<
    string,
    { execute: (input: unknown, options: never) => Promise<unknown> }
  >;
  const webResearch = tools.webResearch;
  const readPage = tools.readPage;
  if (!webResearch || !readPage) throw new Error("research tools missing");
  await webResearch.execute({ query: "pricing" }, {} as never);
  await readPage.execute({ url: page, focus: "price" }, {} as never);
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

test("zero mode searches but performs no page extraction", async () => {
  const t = convexTest(schema, modules);
  const controlId = await t.mutation(internal.researchControl.admit, {
    tenantId,
    requestId,
    limit: 0,
  });
  vi.stubEnv("TAVILY_API_KEY", "synthetic");
  const fetchMock = vi.fn(async (_url: unknown) => ({
    ok: true,
    status: 200,
    json: async () => ({ results: [{ url: page, title: "Pricing", content: "summary" }] }),
  }));
  vi.stubGlobal("fetch", fetchMock);
  const tools = buildWebResearchTool(undefined, {
    tenantId,
    requestId,
    controlId,
    ctx: { runMutation: t.mutation.bind(t) } as never,
  }) as unknown as Record<
    string,
    { execute: (input: unknown, options: never) => Promise<Record<string, unknown>> }
  >;
  const webResearch = tools.webResearch;
  const readPage = tools.readPage;
  if (!webResearch || !readPage) throw new Error("research tools missing");
  await webResearch.execute({ query: "pricing" }, {} as never);
  const refused = await readPage.execute({ url: page, focus: "price" }, {} as never);
  expect(refused.note).toContain("allowance is unavailable or exhausted");
  expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith("/extract"))).toHaveLength(0);
});
