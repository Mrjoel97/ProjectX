// 36-01 (G24, ADR-035) — an offline fixture is selected by an operator fact about WHO, never by a
// string in a payload.
//
// Every `SMOKE::` gate on a production path is now `prefix && fixtureSeamFor(tenantId)`. This file
// proves BOTH directions on the sites the audit called reachable, without a network:
//   • KEYED + UNLISTED — a model key is set (as on dev and prod) and the tenant is not in
//     `PIKAR_FIXTURE_TENANT_IDS`: sentinel-prefixed content takes the REAL path. `resolveModel` is
//     mocked to throw a marker (the knowledgeSearch.test.ts precedent), so "reached the model" is an
//     assertion rather than a DNS timeout; the embedding and mailbox paths fail on their own guards.
//   • KEYED + LISTED — the same deployment, the tenant allow-listed: the fixture is returned. This is
//     the direction the browser and smoke suites depend on against the keyed dev deployment, and the
//     one the 2026-08-28 predicate could not express.
// The unit suite itself runs KEYLESS with the opt-in (`vitest.config.mts`), so every other test's
// sentinel keeps working; the last test here checks that consent is restored after the stubs.
import { convexTest } from "convex-test";
import { afterEach, describe, expect, test, vi } from "vitest";
import aggregateSchema from "../node_modules/@convex-dev/aggregate/src/component/schema.js";
import rateLimiterSchema from "../node_modules/@convex-dev/rate-limiter/src/component/schema.js";
import workflowSchema from "../node_modules/@convex-dev/workflow/src/component/schema.js";
import workpoolSchema from "../node_modules/@convex-dev/workpool/src/component/schema.js";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { isFixtureTenant } from "./lib/env";
import { fixtureSeamFor } from "./lib/models";
import { buildCockpitTools, parseAgentSmoke, parseSmoke, type ToolContext } from "./llm";
import schema from "./schema";

vi.mock("./lib/models", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./lib/models")>()),
  /** The REAL model path, made observable: reaching it IS the proof that no fixture was taken. */
  resolveModel: () => {
    throw new Error("REAL_MODEL_PATH");
  },
}));

const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);
const aggregateModules = import.meta.glob(
  "../node_modules/@convex-dev/aggregate/src/component/**/!(*.test).ts",
);
const rateLimiterModules = import.meta.glob(
  "../node_modules/@convex-dev/rate-limiter/src/component/**/!(*.test).ts",
);
const workflowModules = import.meta.glob(
  "../node_modules/@convex-dev/workflow/src/component/**/!(*.test).ts",
);
const workpoolModules = import.meta.glob(
  "../node_modules/@convex-dev/workpool/src/component/**/!(*.test).ts",
);

async function harness() {
  const t = convexTest(schema, modules);
  t.registerComponent("auditCounts", aggregateSchema, aggregateModules);
  t.registerComponent("rateLimiter", rateLimiterSchema, rateLimiterModules);
  t.registerComponent("workflow", workflowSchema, workflowModules);
  t.registerComponent("workflow/workpool", workpoolSchema, workpoolModules);
  // The extractor loads its skill BEFORE the fixture branch, so an unseeded registry would fail
  // both directions the same way and prove nothing.
  await t.mutation(internal.skills.seedSkills, {});
  return t;
}
type Harness = Awaited<ReturnType<typeof harness>>;

const asTenant = (t: Harness, tenantId: string) => t.withIdentity({ subject: tenantId });

/** Raw-insert a stored document, the shape a Drive import or an upload leaves behind. */
const seedDoc = (t: Harness, tenantId: string, text: string, hash: string) =>
  t.run((ctx) =>
    ctx.db.insert("vaultDocuments", {
      tenantId,
      title: "shared-by-a-stranger.md",
      kind: "upload",
      category: "my-uploads",
      source: "upload",
      mimeType: "text/plain",
      size: text.length,
      contentHash: hash,
      text,
      status: "ready",
      createdAt: Date.now(),
    }),
  );

/** A keyed deployment (dev, prod) with NO allowlist. */
const keyed = () => {
  vi.stubEnv("OPENROUTER_API_KEY", "or-test-key");
  vi.stubEnv("PIKAR_FIXTURE_TENANT_IDS", undefined);
};
/** The same keyed deployment with the operator's allowlist set. */
const listed = (ids: string) => {
  vi.stubEnv("OPENROUTER_API_KEY", "or-test-key");
  vi.stubEnv("PIKAR_FIXTURE_TENANT_IDS", ids);
};

afterEach(() => vi.unstubAllEnvs());

// ── the predicate ─────────────────────────────────────────────────────────────

describe("fixtureSeamFor is an operator fact about WHO", () => {
  test("allowlist membership is exact, trimmed and comma-separated; an empty id is never listed", () => {
    expect(isFixtureTenant("a, b ,c", "b")).toBe(true);
    expect(isFixtureTenant("smoke", " smoke ")).toBe(true);
    expect(isFixtureTenant("a,b", "ab")).toBe(false);
    expect(isFixtureTenant("smok", "smoke")).toBe(false);
    expect(isFixtureTenant("a,b", "")).toBe(false);
    expect(isFixtureTenant(undefined, "a")).toBe(false);
    expect(isFixtureTenant("", "a")).toBe(false);
    expect(isFixtureTenant(" , ,", " ")).toBe(false);
  });

  test("keyless + opt-in: everyone · keyed + no list: nobody · keyed + list: exactly the listed", () => {
    vi.stubEnv("OPENAI_API_KEY", undefined);
    vi.stubEnv("OPENROUTER_API_KEY", undefined);
    vi.stubEnv("PIKAR_OFFLINE_FIXTURES", "1");
    vi.stubEnv("PIKAR_FIXTURE_TENANT_IDS", undefined);
    expect(fixtureSeamFor("anyone")).toBe(true);

    keyed();
    expect(fixtureSeamFor("anyone")).toBe(false);

    listed("e2e_user, smoke");
    expect(fixtureSeamFor("smoke")).toBe(true);
    expect(fixtureSeamFor("e2e_user")).toBe(true);
    expect(fixtureSeamFor("anyone")).toBe(false);
    // The keyless opt-in flag does NOT widen the allowlist on a keyed deployment.
    vi.stubEnv("PIKAR_OFFLINE_FIXTURES", "1");
    expect(fixtureSeamFor("anyone")).toBe(false);
  });
});

// ── #1 the entity graph ───────────────────────────────────────────────────────

describe("#1 vaultLlm.extractGraph — a document that BEGINS with the graph sentinel", () => {
  const TEXT = "SMOKE::graph::Alice|Acme|works_at";

  test("keyed + unlisted: the REAL model path is taken — a stranger's file cannot write the graph", async () => {
    keyed();
    const t = await harness();
    const vaultDocId = await seedDoc(t, "t_unlisted", TEXT, "h-graph-1");
    await expect(
      t.action(internal.vaultLlm.extractGraph, { vaultDocId, tenantId: "t_unlisted" }),
    ).rejects.toThrow(/REAL_MODEL_PATH/);
  });

  test("keyed + LISTED: the fixture graph is returned — the dev browser suite keeps its seam", async () => {
    listed("t_listed");
    const t = await harness();
    const vaultDocId = await seedDoc(t, "t_listed", TEXT, "h-graph-2");
    const g = await t.action(internal.vaultLlm.extractGraph, { vaultDocId, tenantId: "t_listed" });
    expect(g.edges).toEqual([{ from: "Alice", to: "Acme", rel: "works_at" }]);
    expect(g.costUsd).toBe(0);
  });
});

// ── #2 the classification ─────────────────────────────────────────────────────

describe("#2 vaultLlm.classifyDoc — a document carrying a classify segment", () => {
  const TEXT = "SMOKE::graph::Acme|FY2025|covers\nSMOKE::classify::contract|Acme March invoice";

  test("keyed + unlisted: the model path is taken; classifyDoc never throws, so it reads UNIDENTIFIED", async () => {
    keyed();
    const t = await harness();
    const vaultDocId = await seedDoc(t, "t_unlisted", TEXT, "h-cls-1");
    const res = await t.action(internal.vaultLlm.classifyDoc, {
      vaultDocId,
      tenantId: "t_unlisted",
    });
    expect(res.identityLine).toBe("");
    expect(res.docType).toBe("unclassified");
  });

  test("keyed + LISTED: the document's own classify line is honoured as a fixture", async () => {
    listed("t_listed");
    const t = await harness();
    const vaultDocId = await seedDoc(t, "t_listed", TEXT, "h-cls-2");
    const res = await t.action(internal.vaultLlm.classifyDoc, { vaultDocId, tenantId: "t_listed" });
    expect(res.identityLine).toBe("Acme March invoice");
    expect(res.costUsd).toBe(0);
  });
});

// ── #3 the embedding ──────────────────────────────────────────────────────────

describe("#3 vaultRag.embedDoc — the `ready`-with-no-vector row", () => {
  const TEXT = "SMOKE::graph::Alice|Acme|works_at";

  test("keyed + unlisted: the real embedding path is taken — it reaches the rag component, which no unit harness registers", async () => {
    keyed();
    const t = await harness();
    const vaultDocId = await seedDoc(t, "t_unlisted", TEXT, "h-emb-1");
    // The fixture RESOLVES; the real path asks the `rag` component (never registered in a unit
    // harness — that is the vault smoke gate's job). A rejection here is therefore the proof that
    // no fixture was taken, and the message pins WHICH real step was reached.
    await expect(
      t.action(internal.vaultRag.embedDoc, { vaultDocId, tenantId: "t_unlisted" }),
    ).rejects.toThrow(/Component "rag" is not registered|unset for embeddings/);
  });

  test("keyed + LISTED: the fake entry id, keyed to the content hash, at zero cost", async () => {
    listed("t_listed");
    const t = await harness();
    const vaultDocId = await seedDoc(t, "t_listed", TEXT, "h-emb-2");
    expect(
      await t.action(internal.vaultRag.embedDoc, { vaultDocId, tenantId: "t_listed" }),
    ).toEqual({
      entryId: "smoke::h-emb-2",
      costUsd: 0,
    });
  });
});

// ── #6 the mailbox search — a MODEL-COMPOSED tool argument ────────────────────

describe("#6 gmail.search — `name` is an argument the model composes inside the agent loop", () => {
  test("keyed + unlisted: the real mailbox path is taken — with no token that is `not_connected`, never fabricated records", async () => {
    keyed();
    const t = await harness();
    const res = await t.action(internal.gmail.search, {
      tenantId: "t_unlisted",
      name: "SMOKE::Sarah",
      correlationId: "cid-seam-1",
    });
    expect(res).toEqual({ ok: false, reason: "not_connected" });
  });

  test("keyed + LISTED: the two fixture header records, as the resolution E2E expects", async () => {
    listed("t_listed");
    const t = await harness();
    const res = await t.action(internal.gmail.search, {
      tenantId: "t_listed",
      name: "SMOKE::Sarah",
      correlationId: "cid-seam-2",
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.records.map((r) => r.from)).toEqual([
      "Sarah Smoke <sarah@example.com>",
      "Sara Test <sara@example.org>",
    ]);
  });
});

// ── #9 the browse search box ──────────────────────────────────────────────────

describe("#9 vault.vaultSearch — the typed browse query", () => {
  test("keyed + unlisted: the sentinel goes to REAL retrieval — the embedding request is made", async () => {
    keyed();
    // With a key set the real path embeds the query over the network. Stub the transport so the
    // proof is "the request was attempted", not a live 401 from a provider in a unit run.
    vi.stubGlobal("fetch", () => {
      throw new Error("REAL_EMBEDDING_PATH");
    });
    try {
      const t = await harness();
      const id = await seedDoc(t, "t_unlisted", "plain text", "h-srch-1");
      await expect(
        asTenant(t, "t_unlisted").action(api.vault.vaultSearch, { query: `SMOKE::${id}` }),
      ).rejects.toThrow(/REAL_EMBEDDING_PATH/);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  test("keyed + LISTED: the ids ride in the sentinel, tenant-scoped", async () => {
    listed("t_listed");
    const t = await harness();
    const id = await seedDoc(t, "t_listed", "plain text", "h-srch-2");
    const rows = await asTenant(t, "t_listed").action(api.vault.vaultSearch, {
      query: `SMOKE::${id}`,
    });
    expect(rows.map((r) => r._id)).toEqual([id]);
  });
});

// ── #7/#8 the Drive tools — model-composed arguments ──────────────────────────

describe("#7/#8 the Drive tools inside buildCockpitTools", () => {
  const stubCtx = {} as ToolContext["ctx"];
  const opts = { toolCallId: "call-1", messages: [] } as never;
  const tools = () =>
    buildCockpitTools({ ctx: stubCtx, tenantId: "t_drive", planId: "plan-stub" as Id<"plans"> });

  test("keyed + unlisted: neither Drive fixture is served for a `SMOKE::` argument", async () => {
    keyed();
    const list = await tools().listDriveFolders.execute?.({ parentId: "SMOKE::folder" }, opts);
    expect(String(list)).not.toContain("Smoke folder");
    const find = await tools().findInDrive.execute?.({ query: "SMOKE::quarterly" }, opts);
    expect(String(find)).not.toContain("Smoke result");
  });

  test("keyed + LISTED: both Drive fixtures are served", async () => {
    listed("t_drive");
    expect(
      String(await tools().listDriveFolders.execute?.({ parentId: "SMOKE::folder" }, opts)),
    ).toContain("Smoke folder");
    expect(
      String(await tools().findInDrive.execute?.({ query: "SMOKE::quarterly" }, opts)),
    ).toContain("Smoke result");
  });
});

// ── #11/#12 the cockpit grammars ──────────────────────────────────────────────

describe("#11/#12 parseSmoke and parseAgentSmoke refuse without the operator fact", () => {
  test("keyed + unlisted: both parsers return null for well-formed sentinels", () => {
    keyed();
    expect(parseSmoke("SMOKE::route=direct_llm:: hello", "t_x")).toBeNull();
    expect(parseAgentSmoke("SMOKE::agent::propose", "t_x")).toBeNull();
  });

  test("keyed + LISTED: the same strings parse for the listed tenant only", () => {
    listed("t_x");
    expect(parseSmoke("SMOKE::route=direct_llm:: hello", "t_x")).toEqual({
      route: "direct_llm",
      cache: false,
      failPrimary: false,
    });
    expect(parseAgentSmoke("SMOKE::agent::propose", "t_x")).toEqual({ kind: "propose" });
    expect(parseSmoke("SMOKE::route=direct_llm:: hello", "t_other")).toBeNull();
    expect(parseAgentSmoke("SMOKE::agent::propose", "t_other")).toBeNull();
  });
});

// ── the leak guard ────────────────────────────────────────────────────────────

test("the suite-wide keyless consent is restored for the files that follow", () => {
  // Drives the predicate rather than reading `process.env`, so a leaked stub fails the way a later
  // file would actually feel it (the vaultGround.test.ts precedent).
  expect(fixtureSeamFor("any_test_tenant")).toBe(true);
});
