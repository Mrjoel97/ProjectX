import { execFileSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { dirname, resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const backend = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DASHBOARD = "https://dashboard.convex.dev/d/woozy-wren-368";
const SITE = "https://woozy-wren-368.convex.site";
const ORIGIN = "https://pikar-ai-convex-gpbrsadzc-joelferuzi-gmailcoms-projects.vercel.app";
const check = (value) => {
  if (!value) throw new Error("PRIVACY_DRILL_FAILED");
};
const literal = JSON.stringify;
export function requireStaging(target) {
  check(target.trim() === DASHBOARD);
}
export function booleanEvidence(value) {
  check(Object.values(value).every((item) => typeof item === "boolean"));
  return JSON.stringify(value);
}
function cli(args) {
  // Never print argv, returned objects or CLI errors: they include private fixture references.
  try {
    return execFileSync(
      process.execPath,
      [resolve(backend, "node_modules/convex/bin/main.js"), ...args],
      {
        cwd: backend,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        timeout: 180000,
        maxBuffer: 2 * 1024 * 1024,
      },
    );
  } catch {
    throw new Error("PRIVATE_STAGING_OPERATION_FAILED");
  }
}
// Installed CLI deliberately emits no stdout for a successful Convex null result.
export function decodeCliResult(output) {
  return output.trim() === "" ? null : JSON.parse(output);
}
const transport = {
  target: async () => cli(["dashboard", "--no-open"]),
  invoke: async (fn, args, tenant, component) =>
    decodeCliResult(
      cli([
        "run",
        fn,
        literal(args),
        ...(tenant ? ["--identity", literal({ subject: tenant })] : []),
        ...(component ? ["--component", component] : []),
      ]),
    ),
  query: async (source, component) =>
    JSON.parse(
      cli(["run", "--inline-query", source, ...(component ? ["--component", component] : [])]),
    ),
  upload: async (url) => {
    check(new URL(url).origin === SITE && new URL(url).pathname === "/uploads");
    const response = await fetch(url, {
      method: "POST",
      headers: { Origin: ORIGIN, "Content-Type": "application/octet-stream" },
      body: new Uint8Array(1024),
      signal: AbortSignal.timeout(30000),
    });
    check(response.ok);
    const result = await response.json();
    check(typeof result.storageId === "string");
    return result.storageId;
  },
  wait: () => sleep(1000),
};
const receiptsQuery = (tenant) =>
  `return (await ctx.db.query("uploadReceipts").withIndex("by_tenant",q=>q.eq("tenantId",${literal(tenant)})).take(101)).length;`;
const docsQuery = (tenant) =>
  `return (await ctx.db.query("vaultDocuments").withIndex("by_tenant",q=>q.eq("tenantId",${literal(tenant)})).take(11)).map(d=>({id:d._id,entryId:d.ragEntryId??null}));`;
const ragCapture = (ids) =>
  `const ids=${literal(ids)};const result=[];for(const id of ids){const e=await ctx.db.get(id);if(!e)throw Error("MISSING_FIXTURE");const chunks=await ctx.db.query("chunks").withIndex("entryId_order",q=>q.eq("entryId",id)).take(33);if(chunks.length<1||chunks.length>32||chunks.some(c=>c.state.kind!=="ready"))throw Error("FIXTURE_BOUND");result.push(id,...chunks.flatMap(c=>[c._id,c.contentId,...(c.state.embeddingId?[c.state.embeddingId]:[])]));}return result;`;
const absentQuery = (ids) =>
  `return (await Promise.all(${literal(ids)}.map(id=>ctx.db.get(id)))).every(x=>x===null);`;
const storageQuery = (ids) =>
  `return (await Promise.all(${literal(ids)}.map(id=>ctx.db.system.get(id)))).every(x=>x===null);`;
const namespacesQuery = (tenant) =>
  `const ids=[];for(const kind of ["ready","pending","replaced"]){const rows=await ctx.db.query("namespaces").withIndex("status_namespace_version",q=>q.eq("status.kind",kind).eq("namespace",${literal(tenant)})).take(4);if(rows.length>3)throw Error("FIXTURE_BOUND");ids.push(...rows.map(r=>r._id));}return ids;`;
export async function cleanupFixture(io, fixture) {
  check(/^packeval-[a-f0-9]{8}-privacy-[ab]$/.test(fixture.tenant));
  const docs = await io.query(docsQuery(fixture.tenant));
  check(docs.length <= 10);
  if (docs.length)
    await io.invoke("vaultSmoke:purge", {
      tenantId: fixture.tenant,
      docIds: docs.map((d) => d.id),
    });
  // Namespace ownership is exact and fixture-generated; also catches unlinked completed entries.
  const namespaces = await io.query(namespacesQuery(fixture.tenant), "rag");
  for (const namespaceId of namespaces)
    await io.invoke("namespaces:deleteNamespace", { namespaceId }, undefined, "rag");
  for (let attempt = 0; attempt < 60; attempt++) {
    if ((await io.query(namespacesQuery(fixture.tenant), "rag")).length === 0) break;
    check(attempt < 59);
    await io.wait();
  }
  for (let page = 0; page < 50; page++) {
    const result = await io.invoke("tenantDelete:purgeEvalTenant", {
      tenantId: fixture.tenant,
      exact: true,
      limit: 100,
      preserveSpendEvents: true,
    });
    if (result.done) return;
  }
  throw new Error("CLEANUP_BOUND");
}
export async function runPrivacyDrill(io = transport) {
  const evidence = {
    stagingTarget: false,
    syntheticAdminContext: true,
    nativeAccountDeletionVerified: false,
    uploadExport: false,
    crossTenantIsolation: false,
    ragExport: false,
    fixtureRowsRemoved: false,
    knownStorageRemoved: false,
    knownRagRowsRemoved: false,
    otherTenantPreserved: false,
    cleanupCompleted: false,
    budgetClosed: false,
    hostedInflightRaceVerified: false,
    sevenDayElapsedVerified: false,
  };
  const run = randomBytes(4).toString("hex");
  const fixtures = ["a", "b"].map((suffix) => ({
    tenant: `packeval-${run}-privacy-${suffix}`,
    storageIds: [],
    ragIds: [],
  }));
  let admitted = false;
  let budget;
  try {
    requireStaging(await io.target());
    evidence.stagingTarget = true;
    admitted = true;
    budget = await io.invoke("guardrails:openEvalBudget", {
      tenantIds: fixtures.map((f) => f.tenant),
      capCents: 10,
    });
    for (const fixture of fixtures) {
      // CLI impersonation only establishes a synthetic fixture context, never native auth evidence.
      const url = await io.invoke("requests:generateUploadUrl", {}, fixture.tenant);
      fixture.storageIds.push(await io.upload(url));
      const text = `Synthetic privacy drill ${fixture.tenant}. Fictional workshop schedules one weekly planning meeting.`;
      const id = await io.invoke("vaultSmoke:insertBrief", {
        tenantId: fixture.tenant,
        title: "Synthetic privacy fixture",
        text,
        hash: createHash("sha256").update(text).digest("hex"),
      });
      const embedded = await io.invoke("vaultRag:embedDoc", {
        vaultDocId: id,
        tenantId: fixture.tenant,
        evalBudgetId: budget,
      });
      await io.invoke("vault:markReady", { vaultDocId: id, ragEntryId: embedded.entryId });
      fixture.docId = id;
      fixture.ragIds = await io.query(ragCapture([embedded.entryId]), "rag");
      let cursor;
      let exportedBlob = false;
      let exportedDoc = false;
      for (let page = 0; page < 100; page++) {
        const data = await io.invoke(
          "tenantExport:exportTenantData",
          cursor ? { cursor } : {},
          fixture.tenant,
        );
        check(!data.limits.truncated && data.header.tenantId === fixture.tenant);
        for (const file of data.files ?? [])
          if (fixture.storageIds.includes(file.storageId)) exportedBlob = true;
        if (data.table.name === "vaultDocuments")
          exportedDoc ||= data.table.rows.some(
            (d) => d._id === id && d.ragEntryId === embedded.entryId && d.text === text,
          );
        cursor = data.nextCursor;
        if (!cursor) break;
        check(page < 99);
      }
      check(exportedBlob && exportedDoc);
    }
    evidence.uploadExport = true;
    evidence.ragExport = true;
    const [a, b] = fixtures;
    check((await io.invoke("vault:vaultDocText", { vaultDocId: a.docId }, b.tenant)) === null);
    check((await io.invoke("vault:vaultDocText", { vaultDocId: b.docId }, a.tenant)) === null);
    evidence.crossTenantIsolation = true;
    await cleanupFixture(io, a);
    check(
      (await io.query(docsQuery(a.tenant))).length === 0 &&
        (await io.query(receiptsQuery(a.tenant))) === 0,
    );
    evidence.fixtureRowsRemoved = true;
    check(await io.query(storageQuery(a.storageIds)));
    evidence.knownStorageRemoved = true;
    for (let attempt = 0; attempt < 60; attempt++) {
      if (await io.query(absentQuery(a.ragIds), "rag")) {
        evidence.knownRagRowsRemoved = true;
        break;
      }
      await io.wait();
    }
    check(evidence.knownRagRowsRemoved);
    check((await io.invoke("vault:vaultDocText", { vaultDocId: b.docId }, b.tenant)) !== null);
    check(!(await io.query(storageQuery(b.storageIds))));
    evidence.otherTenantPreserved = true;
  } catch {
    /* Output is only the allowlisted boolean evidence, never provider failures. */
  } finally {
    if (admitted) {
      let clean = true;
      for (const fixture of fixtures) {
        try {
          await cleanupFixture(io, fixture);
          check(
            (await io.query(docsQuery(fixture.tenant))).length === 0 &&
              (await io.query(receiptsQuery(fixture.tenant))) === 0,
          );
          check(await io.query(storageQuery(fixture.storageIds)));
          let absent = fixture.ragIds.length === 0;
          for (let attempt = 0; !absent && attempt < 60; attempt++) {
            absent = await io.query(absentQuery(fixture.ragIds), "rag");
            if (!absent) await io.wait();
          }
          check(absent);
        } catch {
          clean = false;
        }
      }
      evidence.cleanupCompleted = clean;
      if (budget) {
        try {
          await io.invoke("guardrails:closeEvalBudget", { budgetId: budget });
          evidence.budgetClosed = true;
        } catch {
          /* retain accounting */
        }
      }
    }
  }
  return evidence;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const allowed =
    process.env.GITHUB_ACTIONS === "true" &&
    process.env.PRIVACY_DRILL_RUN === "1" &&
    process.env.PRIVACY_DRILL_ALLOW_PAID === "1" &&
    Boolean(process.env.CONVEX_DEPLOY_KEY);
  if (!allowed) {
    process.stdout.write('{"configurationAccepted":false}\n');
    process.exitCode = 1;
  } else {
    const evidence = await runPrivacyDrill();
    process.stdout.write(`${booleanEvidence(evidence)}\n`);
    if (!evidence.otherTenantPreserved || !evidence.cleanupCompleted || !evidence.budgetClosed)
      process.exitCode = 1;
  }
}
