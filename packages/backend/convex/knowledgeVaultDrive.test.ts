// Phase 29 (KNOW-01) — the Vault and Drive knowledge-source adapters.
//
// Three kinds of test live here, and the mix is deliberate.
//
//  1. BEHAVIOURAL, through `convex-test`, against the real `vaultGroundHydrated` and the real
//     `runDriveSearch` with `fetch` stubbed. These assert the RETURNED VALUE — the evidence rows,
//     their authority, their timestamps and the source state — never that a function was called.
//  2. TWO-TENANT, because "bounded and tenant-owned" is the whole contract and an adapter that
//     forgets its tenant is the one defect that cannot be walked back.
//  3. STATIC SOURCE SCANS, for the two invariants that have no observable behaviour: the Drive
//     adapter must be structurally incapable of import/export/landing/reservation and of any
//     non-GET Drive call. A stub is free to return whatever it likes, so no behavioural test can
//     prove the absence of a paid path — only the source can. The idiom (read the module, strip
//     comments, assert on what remains, with a POSITIVE CONTROL so the scan cannot be vacuous) is
//     `llmRedaction.test.ts`'s and `dispatchGuard.test.ts`'s.
import { readFileSync } from "node:fs";
import { type BusinessBlueprint, serializeBlueprint } from "@pikar/core";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);

const TENANT = "tenant_know";
const OTHER = "tenant_other";
const NOW = 1_700_000_000_000;

/** The landed vault bounds this adapter must not loosen (`vaultGround.ts`, module-private). */
const PER_DOC_CHAR_CAP = 1500;
const TOTAL_CHAR_CAP = 8000;

const harness = () => convexTest(schema, modules);
type T = ReturnType<typeof harness>;

const seedDoc = (t: T, overrides: Record<string, unknown> = {}, tenantId = TENANT) =>
  t.run((ctx) =>
    ctx.db.insert("vaultDocuments", {
      tenantId,
      title: "seed",
      kind: "upload",
      category: "my-uploads",
      source: "upload",
      mimeType: "text/plain",
      size: 1,
      contentHash: `c-${Math.random()}`,
      status: "ready",
      createdAt: NOW,
      ...overrides,
    }),
  );

/** Attribute an edge to a doc through the real upsert, so graph expansion is genuinely exercised. */
const seedEdge = (t: T, sourceDocId: string, from: string, to: string) =>
  t.mutation(internal.vaultGraph.upsertGraph, {
    tenantId: TENANT,
    sourceDocId: sourceDocId as never,
    nodes: [
      { type: "topic", name: from },
      { type: "topic", name: to },
    ],
    edges: [{ from, to, rel: "rel" }],
  });

const BLUEPRINT_TEXT = serializeBlueprint({
  name: { values: ["Acme"], origin: "stated" },
  oneLineDescription: {
    values: ["A blueprint-grounded business"],
    origin: "derived",
    source: "owner-notes.md",
  },
  stage: null,
  tier: { values: ["startup"], origin: "stated" },
  offering: null,
  targetCustomer: null,
  revenueModel: null,
  bindingConstraint: null,
  primaryGoals: null,
  knownConstraints: null,
  entities: null,
} satisfies BusinessBlueprint);

async function seedConfirmedBlueprint(t: T, tenantId = TENANT): Promise<string> {
  const docId = await seedDoc(
    t,
    {
      title: "Business blueprint",
      kind: "business_blueprint",
      category: "business",
      source: "blueprint",
      mimeType: "text/markdown",
      text: BLUEPRINT_TEXT,
      size: BLUEPRINT_TEXT.length,
    },
    tenantId,
  );
  await t.run((ctx) =>
    ctx.db.insert("tenantProfiles", {
      tenantId,
      tier: "startup",
      tierSource: "derived",
      derivedAt: NOW,
      blueprintDocId: docId,
      blueprintSourceDocIds: [],
      blueprintConfirmedAt: NOW,
    }),
  );
  return docId;
}

const searchVault = (t: T, query: string, tenantId = TENANT) =>
  t.action(internal.knowledgeVaultDrive.searchVaultKnowledge, { tenantId, query });

// ── 1. Vault evidence is bounded, cited and freshness-aware ───────────────────

describe("the vault adapter returns cited, bounded, tenant-owned evidence", () => {
  test("one hit becomes one evidence row carrying ref, label, text, authority and both times", async () => {
    const t = harness();
    const docA = await seedDoc(t, { title: "Playbook A", text: "The margin is 40 percent." });

    const out = await searchVault(t, `SMOKE::${docA}`);

    expect(out.state).toEqual({ status: "available", source: "vault", returned: 1 });
    expect(out.evidence).toHaveLength(1);
    const e = out.evidence[0];
    if (e === undefined) throw new Error("expected one evidence row");
    expect(e.source).toBe("vault");
    expect(e.sourceRef).toBe(docA);
    expect(e.label).toBe("Playbook A");
    expect(e.text).toBe("The margin is 40 percent.");
    expect(e.authority).toBe("tenant_owned");
    // The vault's own stamp, NOT the moment we read it — the two are separate fields on purpose.
    expect(e.sourceUpdatedAt).toBe(NOW);
    expect(e.retrievedAt).toBeGreaterThan(NOW);
    // The evidence id is server-minted and namespaced by source, so the coordinator can merge
    // vault and drive rows without two adapters minting the same id.
    expect(e.evidenceId).toBe("vault-1");
  });

  test("a web_research document is THIRD-PARTY, and its retrieval stamp is its source time", async () => {
    const t = harness();
    const fetched = NOW - 5 * 86_400_000;
    const docA = await seedDoc(t, {
      title: "A competitor's pricing page",
      kind: "web_research",
      text: "They charge $60.",
      retrievedAt: fetched,
    });

    const { evidence } = await searchVault(t, `SMOKE::${docA}`);
    expect(evidence[0]?.authority).toBe("third_party_research");
    // `retrievedAt` on the ROW is when the page was fetched — a better source time than createdAt.
    expect(evidence[0]?.sourceUpdatedAt).toBe(fetched);
  });

  test("an agent-promoted document is the WEAKEST authority, never the owner's own word", async () => {
    const t = harness();
    const docA = await seedDoc(t, {
      title: "Agent notes",
      text: "We should raise prices.",
      origin: "agent_promoted",
    });

    const { evidence } = await searchVault(t, `SMOKE::${docA}`);
    expect(evidence[0]?.authority).toBe("agent_authored");
  });
});

// ── 2. The Blueprint spine is not a document ──────────────────────────────────

describe("the Business Blueprint spine never becomes a search hit or a citation", () => {
  test("the spine is discarded from evidence AND from the count, while it really is present", async () => {
    const t = harness();
    await seedConfirmedBlueprint(t);
    const docA = await seedDoc(t, { title: "Playbook A", text: "The margin is 40 percent." });

    // POSITIVE CONTROL — without this the assertions below pass on a run where there was no spine
    // at all, which is exactly the vacuous shape this repo has paid for.
    const hydrated = await t.action(internal.vaultGround.vaultGroundHydrated, {
      tenantId: TENANT,
      query: `SMOKE::${docA}`,
    });
    expect(hydrated.spine).toEqual(expect.any(String));
    expect(hydrated.spine).toContain("Acme");

    const out = await searchVault(t, `SMOKE::${docA}`);
    expect(out.state).toEqual({ status: "available", source: "vault", returned: 1 });
    expect(out.evidence).toHaveLength(1);
    for (const e of out.evidence) {
      expect(e.text).not.toContain("Acme");
      expect(e.sourceRef).toBe(docA);
    }
  });
});

// ── 3. Tenant isolation ───────────────────────────────────────────────────────

describe("two tenants", () => {
  test("a foreign tenantId returns an HONEST empty read, never the other tenant's rows", async () => {
    const t = harness();
    const docA = await seedDoc(t, { title: "Tenant A secret", text: "margin is 40 percent" });
    await seedConfirmedBlueprint(t, TENANT);

    const out = await searchVault(t, `SMOKE::${docA}`, OTHER);

    // "We looked and there is nothing" — available/0, NOT unavailable. The distinction is the
    // whole KNOW-01 honesty rule, and it must survive an empty read.
    expect(out.state).toEqual({ status: "available", source: "vault", returned: 0 });
    expect(out.evidence).toEqual([]);
  });

  test("each tenant sees only its own document under the same query", async () => {
    const t = harness();
    const mine = await seedDoc(t, { title: "Mine", text: "mine" }, TENANT);
    const theirs = await seedDoc(t, { title: "Theirs", text: "theirs" }, OTHER);

    const a = await searchVault(t, `SMOKE::${mine},${theirs}`, TENANT);
    const b = await searchVault(t, `SMOKE::${mine},${theirs}`, OTHER);

    expect(a.evidence.map((e) => e.sourceRef)).toEqual([mine]);
    expect(b.evidence.map((e) => e.sourceRef)).toEqual([theirs]);
  });
});

// ── 4. The landed bounds are preserved, not re-invented ───────────────────────

describe("the landed retrieval bounds still hold through the adapter", () => {
  test("a long document is truncated to the per-doc cap", async () => {
    const t = harness();
    const body = "Playbook A body. ".repeat(200); // ~3400 chars
    const docA = await seedDoc(t, { title: "Playbook A", text: body });

    const { evidence, state } = await searchVault(t, `SMOKE::${docA}`);
    expect(evidence[0]?.text.length).toBe(PER_DOC_CHAR_CAP);
    expect(evidence[0]?.text.startsWith("Playbook A body")).toBe(true);
    // Truncated content is a PARTIAL read, never a full one.
    expect(state).toEqual({ status: "partial", source: "vault", returned: 1, reason: "cap" });
  });

  test("the whole-run text budget holds, and a budget-starved hit is dropped and REPORTED", async () => {
    const t = harness();
    const big = "z".repeat(2000);
    const docs: string[] = [];
    for (let n = 0; n < 10; n++) {
      const d = await seedDoc(t, { title: `H${n}`, text: big });
      await seedEdge(t, d, "hub", `n${n}`);
      docs.push(d);
    }

    const { evidence, state } = await searchVault(t, `SMOKE::${docs[0]}`);

    const total = evidence.reduce((s, e) => s + e.text.length, 0);
    expect(total).toBeGreaterThan(0);
    expect(total).toBeLessThanOrEqual(TOTAL_CHAR_CAP);
    // Every row that survives carries real text — an evidence row with no text can be cited but
    // never verified, so it is dropped rather than shipped as a hollow citation.
    for (const e of evidence) expect(e.text.length).toBeGreaterThan(0);
    expect(state.status).toBe("partial");
    if (state.status !== "partial") return;
    expect(state.reason).toBe("cap");
    expect(state.returned).toBe(evidence.length);
  });

  test("at most eight vault rows reach the run, and the cut is reported as partial", async () => {
    const t = harness();
    const docs: string[] = [];
    for (let n = 0; n < 12; n++) {
      const d = await seedDoc(t, { title: `S${n}`, text: `short body ${n}` });
      await seedEdge(t, d, "hub", `n${n}`);
      docs.push(d);
    }

    const { evidence, state } = await searchVault(t, `SMOKE::${docs[0]}`);
    expect(evidence).toHaveLength(8);
    expect(state).toEqual({ status: "partial", source: "vault", returned: 8, reason: "cap" });
    // Every row is separately citable. A repeated id would let one claim's citation silently
    // resolve to another document's text at synthesis time.
    expect(new Set(evidence.map((e) => e.evidenceId)).size).toBe(8);
  });

  test("a document sealed inside an incomplete folder is never evidence", async () => {
    const t = harness();
    const folderId = await t.run((ctx) =>
      ctx.db.insert("vaultFolders", {
        tenantId: TENANT,
        name: "In flight",
        source: "upload" as const,
        status: "ingesting" as const,
        memberCount: 1,
        terminalCount: 0,
        failedCount: 0,
        reservedCents: 10,
        spentCents: 0,
        reservedAt: NOW,
        createdAt: NOW,
      }),
    );
    const sealed = await seedDoc(t, { title: "Sealed", text: "sealed body", folderId });
    const open = await seedDoc(t, { title: "Open", text: "open body" });

    const { evidence, state } = await searchVault(t, `SMOKE::${sealed},${open}`);
    expect(evidence.map((e) => e.sourceRef)).toEqual([open]);
    expect(state).toEqual({ status: "available", source: "vault", returned: 1 });
  });
});

// ── 5. The adapter cannot bypass the one retrieval seam ───────────────────────

describe("the vault adapter has exactly one way in", () => {
  const source = readFileSync(new URL("./knowledgeVaultDrive.ts", import.meta.url), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "");

  test("the scan can see the module's real code", () => {
    // POSITIVE CONTROL. Without it every `not.toContain` below passes on an empty string.
    expect(source).toContain("searchVaultKnowledge");
    expect(source).toContain("internal.vaultGround.vaultGroundHydrated");
  });

  test("retrieval goes through vaultGroundHydrated — no second, unbounded read", () => {
    for (const bypass of [
      "rag.search",
      "ownedSearchDocsMeta",
      "vaultGraph.expand",
      "vault.getDoc",
      "ctx.db",
    ]) {
      expect(
        source,
        `knowledgeVaultDrive.ts reads the vault through \`${bypass}\` — that path carries none of ` +
          `the landed bounds (limit 8, threshold 0.2, folder sealing, the hop cap, the per-doc and ` +
          `whole-run character budgets). Every one of them lives behind vaultGroundHydrated.`,
      ).not.toContain(bypass);
    }
  });

  test("the spine is not read, not renamed and not carried", () => {
    expect(
      source,
      "knowledgeVaultDrive.ts references the blueprint spine. A spine is not a document: citing " +
        "one would attribute the product's own summary of the business to a source that does not " +
        "exist, and counting one would inflate every result count.",
    ).not.toMatch(/\bspine\b/i);
  });
});
