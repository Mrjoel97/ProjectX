import { createHash, randomUUID } from "node:crypto";
import { exportableTables, storageIdsIn } from "../../core/src/tenantData.ts";

const assert = (ok) => {
  if (!ok) throw Error("NATIVE_PRIVACY_ASSERTION_FAILED");
};
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");

/** Explicitly invoked only after reviewed staging/provider admission. Ingestion may embed. */
export async function uploadNativePrivacyFile({
  client,
  ref,
  expectedUserId,
  createdUserId,
  freshlyCreated,
}) {
  assert(freshlyCreated === true && expectedUserId === createdUserId);
  const first = await client.query(ref("tenantExport:exportTenantData"), {});
  assert(first.header?.tenantId === expectedUserId);
  const origin = "https://pikar-ai-convex-gpbrsadzc-joelferuzi-gmailcoms-projects.vercel.app";
  const url = await client.mutation(ref("requests:generateUploadUrl"), {});
  const target = new URL(url);
  assert(
    target.origin === "https://woozy-wren-368.convex.site" &&
      target.pathname === "/uploads" &&
      target.searchParams.has("ticket"),
  );
  const preflight = await fetch(url, {
    method: "OPTIONS",
    headers: {
      Origin: origin,
      "Access-Control-Request-Method": "POST",
      "Access-Control-Request-Headers": "content-type",
    },
    signal: AbortSignal.timeout(15000),
  });
  assert(
    preflight.status === 204 && preflight.headers.get("access-control-allow-origin") === origin,
  );
  const foreign = await fetch(url, {
    method: "OPTIONS",
    headers: { Origin: "https://foreign.invalid", "Access-Control-Request-Method": "POST" },
    signal: AbortSignal.timeout(15000),
  });
  assert(foreign.status === 403);
  const text = `Synthetic privacy qualification document ${randomUUID()}. This file contains no customer information. Its bytes must be exportable and erased with this disposable account.`;
  const bytes = Buffer.from(text, "utf8");
  const response = await fetch(url, {
    method: "POST",
    headers: { Origin: origin, "Content-Type": "text/plain" },
    body: bytes,
    signal: AbortSignal.timeout(30000),
  });
  assert(response.ok && response.headers.get("access-control-allow-origin") === origin);
  const receipt = await response.json();
  assert(typeof receipt.storageId === "string");
  const replay = await fetch(url, {
    method: "POST",
    headers: { Origin: origin, "Content-Type": "text/plain" },
    body: bytes,
    signal: AbortSignal.timeout(15000),
  });
  assert(replay.status === 400);
  const document = await client.mutation(ref("vault:vaultUpload"), {
    storageId: receipt.storageId,
    filename: "Native privacy qualification.txt",
    mimeType: "text/plain",
    size: bytes.length,
    contentHash: hash(bytes),
    text,
  });
  assert(document?.vaultDocId && document.deduped === false);
  let ready = false;
  for (let attempt = 0; attempt < 60; attempt++) {
    const row = await client.query(ref("vault:vaultDocText"), { vaultDocId: document.vaultDocId });
    assert(row && row.status !== "failed");
    if (row.status === "ready") {
      assert(row.text === text);
      ready = true;
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  assert(ready);
  return {
    expectedFile: { storageId: receipt.storageId, size: bytes.length, sha256: hash(bytes) },
    vaultDocId: document.vaultDocId,
    evidence: {
      nativeSmallFileUploaded: true,
      allowedOriginPreflightVerified: true,
      foreignOriginRefused: true,
      uploadTicketReplayRefused: true,
      nativeFileIndexed: true,
      browserTransportQualified: false,
    },
  };
}

// Same-process handoff only. Callers must never serialize this return value or errors.
// No provider calls, admin identity, implicit account deletion, or credentials are created here.
export async function inspectNativeExport({
  client,
  ref,
  expectedUserId,
  expectedTables = exportableTables(),
  expectedFiles = [],
  verifyContent,
}) {
  assert(typeof expectedUserId === "string" && expectedUserId.length > 0);
  assert(Array.isArray(expectedTables) && expectedTables.length > 0 && expectedTables.length < 150);
  const tables = {},
    files = [],
    cursors = new Set();
  let cursor,
    generatedAt,
    last,
    complete = false;
  for (let pageNumber = 0; pageNumber < 200; pageNumber++) {
    const page = await client.query(ref("tenantExport:exportTenantData"), cursor ? { cursor } : {});
    assert(page.header?.tenantId === expectedUserId && !page.limits?.truncated);
    assert(typeof page.header.generatedAt === "string");
    generatedAt ??= page.header.generatedAt;
    assert(page.header.generatedAt === generatedAt);
    assert(
      expectedTables.includes(page.table?.name) &&
        Array.isArray(page.table.rows) &&
        Array.isArray(page.files),
    );
    for (const row of page.table.rows)
      assert(row.tenantId === undefined || row.tenantId === expectedUserId);
    tables[page.table.name] ??= [];
    tables[page.table.name].push(...page.table.rows);
    files.push(...page.files);
    last = page;
    if (page.nextCursor === null) {
      complete = true;
      break;
    }
    assert(page.nextCursor && typeof page.nextCursor === "object");
    const key = JSON.stringify(page.nextCursor);
    assert(!cursors.has(key));
    cursors.add(key);
    cursor = page.nextCursor;
  }
  assert(complete && expectedTables.every((name) => Object.hasOwn(tables, name)));
  assert(tables.users?.length === 1 && tables.users[0]._id === expectedUserId);
  assert(last.limits.totalRows === Object.values(tables).reduce((n, rows) => n + rows.length, 0));
  for (const file of files)
    assert(
      tables[file.table]?.some(
        (row) => row._id === file.rowId && storageIdsIn(file.table, row).includes(file.storageId),
      ),
    );
  for (const [table, rows] of Object.entries(tables))
    for (const row of rows)
      for (const storageId of storageIdsIn(table, row))
        assert(
          files.some(
            (file) =>
              file.table === table && file.rowId === row._id && file.storageId === storageId,
          ),
        );
  for (const expected of expectedFiles) {
    const file = files.find((file) => file.storageId === expected.storageId);
    assert(file && typeof file.url === "string");
    const url = new URL(file.url);
    assert(
      url.protocol === "https:" &&
        ["woozy-wren-368.convex.cloud", "woozy-wren-368.convex.site"].includes(url.hostname),
    );
    const response = await fetch(url, { signal: AbortSignal.timeout(15000), redirect: "error" });
    assert(
      response.ok &&
        Number(response.headers.get("content-length")) === expected.size &&
        expected.size <= 1024 * 1024,
    );
    const reader = response.body.getReader();
    const chunks = [];
    let size = 0;
    try {
      for (;;) {
        const part = await reader.read();
        if (part.done) break;
        size += part.value.length;
        assert(size <= expected.size);
        chunks.push(part.value);
      }
    } finally {
      await reader.cancel();
    }
    assert(size === expected.size && hash(Buffer.concat(chunks)) === expected.sha256);
  }
  if (verifyContent) await verifyContent({ tables, files });
  return {
    tables,
    files,
    evidence: {
      nativeIdentityExportVerified: true,
      allExportTablesVisited: true,
      exportNotTruncated: true,
      allPageFileLinksPreserved: true,
      expectedFileBodiesVerified: expectedFiles.length > 0,
    },
  };
}

async function denied(operation) {
  let rejected = false;
  try {
    await operation();
  } catch (error) {
    const data = error?.data;
    rejected =
      data?.code === "UNAUTHENTICATED" ||
      (typeof data === "string" && data.includes("UNAUTHENTICATED")) ||
      (error instanceof Error && error.message.includes("UNAUTHENTICATED"));
  }
  assert(rejected); // Network/validation/provider failure cannot pass this check.
}

export async function eraseNativeFixture({
  client,
  ref,
  expectedUserId,
  createdUserId,
  freshlyCreated,
  foundationFinished,
  exported,
  capturePhysicalReferences,
  confirmPhysicalAbsence,
}) {
  assert(
    freshlyCreated === true && foundationFinished === true && createdUserId === expectedUserId,
  );
  assert(exported?.tables?.users?.length === 1 && exported.tables.users[0]._id === expectedUserId);
  // Optional trusted read-only supervisor holds private refs in memory and returns booleans only.
  const physical = capturePhysicalReferences
    ? await capturePhysicalReferences({ expectedUserId, exported })
    : undefined;
  const result = await client.action(ref("tenantDelete:deleteTenantData"), {
    confirmation: "DELETE MY DATA",
  });
  assert(result?.deletedByTable?.users === 1);
  await denied(() => client.query(ref("foundation:get"), {}));
  await denied(() =>
    client.mutation(ref("demo:addItem"), { label: "synthetic erased-tenant rejection check" }),
  );
  await denied(() =>
    client.action(ref("foundation:answer"), {
      revision: 0,
      eventId: "erased-tenant-action-check",
      answer: "Synthetic planned statement.",
      section: "essentials",
      intent: "planned",
    }),
  );
  await denied(() =>
    client.action(ref("tenantDelete:deleteTenantData"), { confirmation: "DELETE MY DATA" }),
  );
  const proof = physical && confirmPhysicalAbsence ? await confirmPhysicalAbsence(physical) : {};
  assert(Object.values(proof).every((value) => typeof value === "boolean"));
  return {
    nativeSelfDeletionSucceeded: true,
    staleJwtQueryRejected: true,
    staleJwtMutationRejected: true,
    staleJwtActionRejected: true,
    staleJwtErasureActionRejected: true,
    physicalStorageAbsenceVerified: proof.storageAbsent === true,
    physicalRagAbsenceVerified: proof.ragAbsent === true,
    physicalUserAbsenceVerified: proof.userAbsent === true,
    physicalReceiptAbsenceVerified: proof.receiptsAbsent === true,
    inFlightWorkVerified: false,
    providerCleanupVerified: false,
  };
}
