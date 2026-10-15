import assert from "node:assert/strict";
import test from "node:test";
import {
  booleanEvidence,
  cleanupFixture,
  decodeCliResult,
  requireStaging,
  runPrivacyDrill,
} from "./run-privacy-staging.mjs";

test("a wrong deployment cannot seed or clean any fixtures", async () => {
  let called = false;
  const result = await runPrivacyDrill({
    target: async () => "https://dashboard.convex.dev/d/production",
    invoke: async () => {
      called = true;
    },
    query: async () => {
      called = true;
    },
  });
  assert.equal(called, false);
  assert.equal(result.stagingTarget, false);
  assert.throws(() =>
    requireStaging("https://dashboard.convex.dev/d/woozy-wren-368.attacker.example"),
  );
});
test("provider errors remain private and cleanup is attempted for both exact fresh tenants", async () => {
  const targets = new Set();
  const functions = [];
  const result = await runPrivacyDrill({
    target: async () => "https://dashboard.convex.dev/d/woozy-wren-368",
    query: async (source) =>
      source.includes("fresh-fixture-check") ||
      source.includes("system.get") ||
      source.includes("Promise.all")
        ? true
        : source.includes('"uploadReceipts"')
          ? 0
          : [],
    invoke: async (fn, args) => {
      functions.push(fn);
      if (fn === "guardrails:openEvalBudget") return "private-budget-id";
      if (fn === "requests:generateUploadUrl") throw Error("secret-url-and-provider-body");
      if (fn === "tenantDelete:purgeEvalTenant") {
        assert.equal(args.exact, true);
        assert.equal(args.preserveSpendEvents, true);
        targets.add(args.tenantId);
        return { done: true };
      }
      return {};
    },
  });
  assert.equal(targets.size, 2);
  assert.ok([...targets].every((t) => /^packeval-[a-f0-9]{8}-privacy-[ab]$/.test(t)));
  assert.equal(result.cleanupCompleted, true);
  assert.equal(result.budgetClosed, true);
  assert.equal(result.uploadExport, false);
  const log = booleanEvidence(result);
  assert.equal(log.includes("secret-url"), false);
  assert.equal(log.includes("private-budget"), false);
  assert.ok(functions.includes("guardrails:closeEvalBudget"));
});
test("cleanup refuses non-fixture tenants and exposes no arbitrary metadata in evidence", async () => {
  await assert.rejects(() => cleanupFixture({}, { tenant: "real-user-id" }));
  assert.throws(() => booleanEvidence({ storageId: "private-storage-id" }));
  assert.throws(() => booleanEvidence({ count: 3 }));
});
test("cleanup stops after its page bound instead of broadening or looping forever", async () => {
  let calls = 0;
  await assert.rejects(() =>
    cleanupFixture(
      {
        query: async (source) => (source.includes("Promise.all") ? true : []),
        invoke: async () => {
          calls++;
          return { done: false };
        },
      },
      { tenant: "packeval-12345678-privacy-a" },
    ),
  );
  assert.equal(calls, 50);
});

test("successful silent CLI results represent null without masking malformed output", () => {
  assert.equal(decodeCliResult("\n"), null);
  assert.equal(decodeCliResult("false\n"), false);
  assert.deepEqual(decodeCliResult("[]\n"), []);
  assert.throws(() => decodeCliResult("unparseable provider failure"));
});

import { exportableTables } from "../../core/src/tenantData.ts";
import { classifyFailure, fixtureExportBoundary } from "./run-privacy-staging.mjs";

test("synthetic export stops only before final identity and diagnostics expose only known classifications", () => {
  assert.equal(exportableTables().at(-1), "users");
  assert.equal(fixtureExportBoundary(), exportableTables().length - 1);
  assert.equal(
    classifyFailure({ stderr: "ArgumentValidationError with PRIVATE_IDENTIFIER" }),
    "validation",
  );
  assert.equal(
    classifyFailure({ stderr: "missing OPENROUTER_API_KEY value PRIVATE_KEY" }),
    "configuration",
  );
  assert.equal(classifyFailure(new Error("private unexpected response")), "unknown");
});

test("complete fixture pipeline exports both scopes and awaits cleanup while preserving the other tenant", async () => {
  const records = new Map();
  const blobs = new Map();
  const receipts = new Map();
  const pending = new Set();
  const tenants = new Set();
  let count = 0;
  let waits = 0;
  const put = (table, fields) => {
    const id = `private-${table}-${++count}`;
    records.set(id, { _id: id, table, ...fields });
    return id;
  };
  const db = {
    get: async (id) => records.get(id) ?? null,
    system: { get: async (id) => blobs.get(id) ?? null },
    query(table) {
      return {
        withIndex(index, build) {
          const supported = {
            vaultDocuments: "by_tenant",
            uploadReceipts: "by_tenant",
            namespaces: "status_namespace_version",
            entries: "namespaceId_status_key_version",
            chunks: "entryId_order",
          };
          assert.equal(index, supported[table]);
          const conditions = [];
          const q = {
            eq(field, value) {
              conditions.push([field, value]);
              return q;
            },
          };
          build(q);
          return {
            take: async (n) => {
              assert.ok(n <= 101);
              const source =
                table === "uploadReceipts"
                  ? [...receipts.values()]
                  : [...records.values()].filter((r) => r.table === table);
              return source
                .filter((r) =>
                  conditions.every(
                    ([field, value]) => field.split(".").reduce((o, k) => o?.[k], r) === value,
                  ),
                )
                .slice(0, n);
            },
          };
        },
      };
    },
  };
  const io = {
    target: async () => "https://dashboard.convex.dev/d/woozy-wren-368",
    query: async (source, component) => {
      if (source.includes("fresh-fixture-check")) {
        assert.equal(records.size, 0);
        assert.equal(receipts.size, 0);
        return true;
      }
      if (source.includes('"chunks"') || source.includes('"namespaces"'))
        assert.equal(component, "rag");
      return new (Object.getPrototypeOf(async () => {}).constructor)("ctx", source)({ db });
    },
    upload: async (url) => {
      const tenant = new URL(url).searchParams.get("ticket");
      const id = `private-blob-${++count}`;
      blobs.set(id, { tenant });
      receipts.set(tenant, { tenantId: tenant, storageId: id });
      return id;
    },
    wait: async () => {
      waits++;
      for (const tenant of pending)
        for (const [id, row] of records)
          if (row.tenant === tenant && row.table !== "namespaces") records.delete(id);
      pending.clear();
    },
    invoke: async (fn, args, tenant, component) => {
      if (fn === "guardrails:openEvalBudget") {
        assert.equal(args.capCents, 10);
        for (const id of args.tenantIds) tenants.add(id);
        return "private-budget";
      }
      if (fn === "requests:generateUploadUrl") {
        assert.ok(tenants.has(tenant));
        return `https://woozy-wren-368.convex.site/uploads?ticket=${tenant}`;
      }
      if (fn === "vaultSmoke:insertBrief") {
        assert.ok(tenants.has(args.tenantId));
        assert.equal(args.hash.length, 64);
        return put("vaultDocuments", { tenantId: args.tenantId, text: args.text });
      }
      if (fn === "vaultRag:embedDoc") {
        assert.equal(args.evalBudgetId, "private-budget");
        assert.equal(records.get(args.vaultDocId).tenantId, args.tenantId);
        const namespaceId = put("namespaces", {
          namespace: args.tenantId,
          tenant: args.tenantId,
          status: { kind: "ready" },
        });
        const entryId = put("entries", { namespaceId, tenant: args.tenantId });
        const contentId = put("content", { tenant: args.tenantId });
        const embeddingId = put("vectors_1536", { tenant: args.tenantId });
        put("chunks", {
          entryId,
          contentId,
          tenant: args.tenantId,
          state: { kind: "ready", embeddingId },
        });
        return { entryId, costUsd: 0.00001, budgetSettled: true };
      }
      if (fn === "vault:markReady") {
        records.get(args.vaultDocId).ragEntryId = args.ragEntryId;
        return null;
      }
      if (fn === "tenantExport:exportTenantData") {
        // Match the real API contract: synthetic subjects cannot read the identity table.
        if (args.cursor?.tableIndex === exportableTables().indexOf("users"))
          throw Error("Invalid ID for users");
        assert.ok(tenants.has(tenant));
        if (args.cursor) assert.equal(args.cursor.truncated, false);
        if (!args.cursor)
          return {
            header: { tenantId: tenant },
            limits: { truncated: false },
            table: { name: "uploadReceipts", rows: [] },
            files: [{ storageId: receipts.get(tenant).storageId }],
            nextCursor: {
              cursor: null,
              rowsExported: 1,
              tableRows: 0,
              truncated: false,
              generatedAt: new Date().toISOString(),
              tableIndex: exportableTables().indexOf("vaultDocuments"),
            },
          };
        assert.equal(args.cursor.tableIndex, exportableTables().indexOf("vaultDocuments"));
        return {
          header: { tenantId: tenant },
          limits: { truncated: false },
          table: {
            name: "vaultDocuments",
            rows: [...records.values()].filter(
              (r) => r.table === "vaultDocuments" && r.tenantId === tenant,
            ),
          },
          files: [],
          nextCursor: {
            tableIndex: exportableTables().indexOf("users"),
            cursor: null,
            rowsExported: 2,
            tableRows: 0,
            truncated: false,
            generatedAt: new Date().toISOString(),
          },
        };
      }
      if (fn === "vault:vaultDocText") {
        const row = records.get(args.vaultDocId);
        return row?.tenantId === tenant ? { text: row.text } : null;
      }
      if (fn === "vaultSmoke:purge") {
        for (const id of args.docIds) {
          assert.equal(records.get(id).tenantId, args.tenantId);
          records.delete(id);
        }
        pending.add(args.tenantId);
        return { ok: true };
      }
      if (fn === "namespaces:deleteNamespaceSync") {
        assert.equal(component, "rag");
        assert.equal(
          [...records.values()].filter(
            (r) => r.table === "entries" && r.namespaceId === args.namespaceId,
          ).length,
          0,
        );
        records.delete(args.namespaceId);
        return null;
      }
      if (fn === "tenantDelete:purgeEvalTenant") {
        assert.ok(tenants.has(args.tenantId));
        assert.equal(args.exact, true);
        assert.equal(args.preserveSpendEvents, true);
        const r = receipts.get(args.tenantId);
        if (r) blobs.delete(r.storageId);
        receipts.delete(args.tenantId);
        return { done: true };
      }
      if (fn === "guardrails:closeEvalBudget") {
        assert.equal(args.budgetId, "private-budget");
        return { closed: true };
      }
      assert.fail("Unexpected adapter operation");
    },
  };
  const result = await runPrivacyDrill(io);
  for (const key of [
    "budgetOpened",
    "uploadAccepted",
    "docInserted",
    "ragEmbedded",
    "ragCaptured",
    "exportRead",
    "firstFixtureComplete",
    "secondFixtureComplete",
    "uploadExport",
    "vaultContentAndRagRefsExport",
    "crossTenantIsolation",
    "knownStorageRemoved",
    "knownRagRowsRemoved",
    "otherTenantPreserved",
    "otherTenantRagPreserved",
    "cleanupCompleted",
    "budgetClosed",
  ])
    assert.equal(result[key], true, key);
  assert.equal(result.nativeIdentityExportVerified, false);
  assert.equal(result.nativeAccountDeletionVerified, false);
  assert.equal(waits, 2);
  assert.equal(records.size, 0);
  assert.equal(blobs.size, 0);
  assert.equal(receipts.size, 0);
  assert.ok(
    Object.entries(result)
      .filter(([key]) => key.startsWith("failure_") || key.startsWith("cleanupFailure_"))
      .every(([, value]) => value === false),
  );
  const log = booleanEvidence(result);
  assert.equal(log.includes("private-"), false);
  assert.equal(log.includes("packeval-"), false);
});

test("a fixture collision aborts before budget, writes or cleanup", async () => {
  let invoked = false;
  const result = await runPrivacyDrill({
    target: async () => "https://dashboard.convex.dev/d/woozy-wren-368",
    query: async () => false,
    invoke: async () => {
      invoked = true;
      throw Error("MUST_NOT_MUTATE");
    },
  });
  assert.equal(result.stagingTarget, true);
  assert.equal(result.freshFixtureScopes, false);
  assert.equal(result.budgetOpened, false);
  assert.equal(result.cleanupCompleted, false);
  assert.equal(invoked, false);
});
