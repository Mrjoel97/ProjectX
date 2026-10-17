import assert from "node:assert/strict";
import test from "node:test";
import { eraseNativeFixture, inspectNativeExport } from "./nativePrivacyScenario.mjs";

const uid = "synthetic-user";
const ref = (x) => x;
function pages() {
  return [
    {
      header: { tenantId: uid, generatedAt: "fixed" },
      table: {
        name: "vaultDocuments",
        rows: [{ _id: "doc-a", tenantId: uid, storageId: "blob-a" }],
      },
      files: [{ table: "vaultDocuments", rowId: "doc-a", storageId: "blob-a", url: null }],
      limits: { truncated: false, totalRows: 1 },
      nextCursor: { tableIndex: 0, cursor: "next" },
    },
    {
      header: { tenantId: uid, generatedAt: "fixed" },
      table: {
        name: "vaultDocuments",
        rows: [{ _id: "doc-b", tenantId: uid, storageId: "blob-b" }],
      },
      files: [{ table: "vaultDocuments", rowId: "doc-b", storageId: "blob-b", url: null }],
      limits: { truncated: false, totalRows: 2 },
      nextCursor: { tableIndex: 1, cursor: null },
    },
    {
      header: { tenantId: uid, generatedAt: "fixed" },
      table: { name: "users", rows: [{ _id: uid }] },
      files: [],
      limits: { truncated: false, totalRows: 3 },
      nextCursor: null,
    },
  ];
}
async function inspect(rows) {
  let n = 0;
  return inspectNativeExport({
    client: { query: async () => rows[n++] },
    ref,
    expectedUserId: uid,
    expectedTables: ["vaultDocuments", "users"],
  });
}
test("native export preserves files on later same-table pages and actual identity row", async () => {
  const result = await inspect(pages());
  assert.deepEqual(
    result.files.map((x) => x.storageId),
    ["blob-a", "blob-b"],
  );
  assert.equal(result.tables.vaultDocuments.length, 2);
  assert.equal(result.evidence.nativeIdentityExportVerified, true);
});
test("native export refuses early completion, foreign tenant and sticky truncation", async () => {
  const early = pages();
  early[0].nextCursor = null;
  await assert.rejects(inspect(early));
  const foreign = pages();
  foreign[1].table.rows[0].tenantId = "other";
  await assert.rejects(inspect(foreign));
  const truncated = pages();
  truncated[1].limits.truncated = true;
  await assert.rejects(inspect(truncated));
});
test("export fails when later-page file or normalized sidecar descriptor is missing", async () => {
  const missing = pages();
  missing[1].files = [];
  await assert.rejects(inspect(missing));
  const sidecar = pages();
  sidecar[1].table.rows[0].transcriptionStorageId = "sidecar";
  await assert.rejects(inspect(sidecar));
  sidecar[1].files.push({
    table: "vaultDocuments",
    rowId: "doc-b",
    storageId: "sidecar",
    url: null,
  });
  assert.equal((await inspect(sidecar)).files.length, 3);
});
test("delete refuses a nonfresh account without calling any action", async () => {
  let writes = 0;
  await assert.rejects(
    eraseNativeFixture({
      client: {
        action: async () => {
          writes++;
        },
      },
      ref,
      expectedUserId: uid,
      createdUserId: uid,
      freshlyCreated: false,
      foundationFinished: true,
      exported: { tables: { users: [{ _id: uid }] } },
    }),
  );
  assert.equal(writes, 0);
});
test("post-erasure authentication evidence rejects network failures and checks action admission", async () => {
  const calls = [];
  let deleted = false;
  const denied = () => {
    throw Object.assign(Error("refused"), { data: { code: "UNAUTHENTICATED" } });
  };
  const client = {
    query: async () => {
      calls.push("query");
      denied();
    },
    mutation: async () => {
      calls.push("mutation");
      denied();
    },
    action: async () => {
      calls.push("action");
      if (deleted) denied();
      deleted = true;
      return { deletedByTable: { users: 1 } };
    },
  };
  const options = {
    client,
    ref,
    expectedUserId: uid,
    createdUserId: uid,
    freshlyCreated: true,
    foundationFinished: true,
    exported: { tables: { users: [{ _id: uid }] } },
  };
  const evidence = await eraseNativeFixture(options);
  assert.equal(evidence.staleJwtErasureActionRejected, true);
  assert.equal(evidence.staleJwtActionRejected, true);
  assert.equal(evidence.physicalRagAbsenceVerified, false);
  assert.deepEqual(calls, ["action", "query", "mutation", "action", "action"]);
  deleted = false;
  client.query = async () => {
    throw Error("network timeout");
  };
  await assert.rejects(eraseNativeFixture(options));
});
