import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  eraseNativeFixture,
  inspectNativeExport,
  uploadNativePrivacyFile,
} from "./nativePrivacyScenario.mjs";

const uid = "synthetic-user";
const ref = (x) => x;
test("file export verifies decoded bytes with absent or compressed wire length", async () => {
  const originalFetch = globalThis.fetch;
  const bytes = Buffer.from("synthetic bytes");
  const expected = {
    storageId: "blob-a",
    size: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
  async function verify(body, headers = {}) {
    globalThis.fetch = async () => new Response(body, { headers });
    const rows = pages();
    rows[0].files[0].url = "https://woozy-wren-368.convex.cloud/api/storage/synthetic";
    let n = 0;
    return inspectNativeExport({
      client: { query: async () => rows[n++] },
      ref,
      expectedUserId: uid,
      expectedTables: ["vaultDocuments", "users"],
      expectedFiles: [expected],
    });
  }
  try {
    assert.equal((await verify(bytes)).evidence.expectedFileBodiesVerified, true);
    assert.equal(
      (await verify(bytes, { "content-encoding": "gzip" })).evidence.expectedFileBodiesVerified,
      true,
    );
    assert.equal(
      (await verify(bytes, { "content-encoding": "gzip", "content-length": "3" })).evidence
        .expectedFileBodiesVerified,
      true,
    );
    await assert.rejects(verify(Buffer.from("different bytes")));
    await assert.rejects(verify(Buffer.from("synthetic byteX")));
    await assert.rejects(verify(bytes.subarray(0, 3)));
    await assert.rejects(verify(bytes, { "content-length": "3" }));
    await assert.rejects(verify(bytes, { "content-length": "-1" }));
  } finally {
    globalThis.fetch = originalFetch;
  }
});
test("native small file validates relay before owned ingestion and exports exact bytes", async () => {
  const originalFetch = globalThis.fetch;
  let bytes;
  let uploaded;
  let posts = 0;
  const origin = "https://pikar-ai-convex-gpbrsadzc-joelferuzi-gmailcoms-projects.vercel.app";
  globalThis.fetch = async (_url, options) => {
    if (!options.method)
      return new Response(bytes, { headers: { "content-length": String(bytes.length) } });
    if (options.method === "OPTIONS")
      return new Response(null, {
        status: options.headers.Origin === origin ? 204 : 403,
        headers: { "access-control-allow-origin": origin },
      });
    posts++;
    bytes = options.body;
    return posts === 1
      ? new Response(JSON.stringify({ storageId: "blob-a" }), {
          headers: { "access-control-allow-origin": origin },
        })
      : new Response(null, { status: 400 });
  };
  try {
    const client = {
      query: async (name) =>
        name === "tenantExport:exportTenantData"
          ? { header: { tenantId: uid } }
          : { status: "ready", text: uploaded.text },
      mutation: async (name, args) => {
        if (name === "requests:generateUploadUrl")
          return "https://woozy-wren-368.convex.site/uploads?ticket=synthetic";
        assert.equal(posts, 2);
        uploaded = args;
        return { vaultDocId: "doc-a", deduped: false };
      },
    };
    const result = await uploadNativePrivacyFile({
      client,
      ref,
      expectedUserId: uid,
      createdUserId: uid,
      freshlyCreated: true,
    });
    assert.equal(result.evidence.nativeFileIndexed, true);
    assert.equal(result.expectedFile.size, bytes.length);
    const rows = pages();
    rows[0].files[0].url = "https://woozy-wren-368.convex.cloud/api/storage/synthetic";
    let n = 0;
    const exported = await inspectNativeExport({
      client: { query: async () => rows[n++] },
      ref,
      expectedUserId: uid,
      expectedTables: ["vaultDocuments", "users"],
      expectedFiles: [result.expectedFile],
    });
    assert.equal(exported.evidence.expectedFileBodiesVerified, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
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
