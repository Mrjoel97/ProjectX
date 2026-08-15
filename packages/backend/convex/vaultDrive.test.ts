// The Google Drive import rail (15.3-09, VALT-13).
//
// Two kinds of test live here on purpose. The behavioural ones drive the real functions against
// convex-test with `fetch` stubbed; the SOURCE-SCAN one (shared-drive params) is static, because
// its failure mode has no observable behaviour to assert on — Drive answers a param-less request
// with HTTP 200 and an empty file list, so the bug looks exactly like an empty folder. A stub
// cannot catch what a stub is free to return.
import { readFileSync } from "node:fs";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import aggregateSchema from "../node_modules/@convex-dev/aggregate/src/component/schema.js";
import rateLimiterSchema from "../node_modules/@convex-dev/rate-limiter/src/component/schema.js";
import workflowSchema from "../node_modules/@convex-dev/workflow/src/component/schema.js";
import workpoolSchema from "../node_modules/@convex-dev/workpool/src/component/schema.js";
import { api, internal } from "./_generated/api";
import schema from "./schema";

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

// The REAL components, because the fan-in's tail runs `tryComplete` → `settleFolder` → the
// rate-limiter. Stubbing the settle would make every "the folder opened" assertion below vacuous:
// the flip and the settle are the same transaction, by design.
function harness() {
  const t = convexTest(schema, modules);
  t.registerComponent("auditCounts", aggregateSchema, aggregateModules);
  t.registerComponent("rateLimiter", rateLimiterSchema, rateLimiterModules);
  t.registerComponent("workflow", workflowSchema, workflowModules);
  t.registerComponent("workflow/workpool", workpoolSchema, workpoolModules);
  return t;
}

// Fake timers — the `vault.test.ts` / `research.test.ts` guard, and NOT optional here. Landing the
// last file flips the folder to `ingesting`, which schedules `walkFolderMembers`, and `tryComplete`
// schedules `buildFolderDigest`. Under real timers both fire AFTER this file finishes and
// retry-loop against a torn-down module runner, throwing `crypto is not defined` inside whichever
// file the worker runs next. Every assertion below is on a synchronous effect, so the timers never
// need to advance.
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

/** `rows[0]`, narrowed. The preceding length assertion is the real check; this only satisfies
 *  `noUncheckedIndexedAccess` without scattering non-null assertions through the expectations. */
function first<T>(rows: T[]): T {
  const row = rows[0];
  if (row === undefined) throw new Error("expected at least one row");
  return row;
}

const TENANT = "tenant_drive";
const DRIVE_FOLDER = "0ABCdef123";
const DOC_MIME = "application/vnd.google-apps.document";
const NOW = 1_700_000_000_000;

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

/** A Drive grant WITHOUT the Drive scope — i.e. every tenant connected before this phase. */
const PRE_WIDENING_SCOPE = "https://www.googleapis.com/auth/gmail.modify";
const FULL_SCOPE = `${PRE_WIDENING_SCOPE} https://www.googleapis.com/auth/drive.readonly`;

async function seedGrant(t: ReturnType<typeof harness>, scope: string): Promise<void> {
  await t.run(async (ctx) => {
    await ctx.db.insert("gmailTokens", {
      tenantId: TENANT,
      refreshToken: "refresh",
      accessToken: "access",
      expiresAt: NOW + 3_600_000,
      scope,
      updatedAt: NOW,
    });
  });
}

async function openFolder(t: ReturnType<typeof harness>, expected: number) {
  return await t.run(async (ctx) =>
    ctx.db.insert("vaultFolders", {
      tenantId: TENANT,
      name: "Drive folder",
      source: "drive" as const,
      status: "reserving" as const,
      memberCount: 0,
      terminalCount: 0,
      failedCount: 0,
      reservedCents: 10,
      spentCents: 0,
      reservedAt: NOW,
      driveFolderId: DRIVE_FOLDER,
      driveExpectedCount: expected,
      driveLandedCount: 0,
      createdAt: NOW,
    }),
  );
}

// ── 1. The reauth ordering ────────────────────────────────────────────────────

describe("a pre-widening grant reauths BEFORE any Drive network call", () => {
  // `include_granted_scopes=true` is forward-only: it widens the NEXT consent and retro-grants
  // nothing. So every already-connected tenant holds a token whose scope string has no Drive in
  // it, and `freshAccessToken` returns {ok:true} for that token quite happily. Checking scope
  // after the refresh would present a permanent reconnect condition as a provider failure.
  test("reauth, and fetch is never called", async () => {
    const t = harness();
    await seedGrant(t, PRE_WIDENING_SCOPE);
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const result = await t
      .withIdentity({ subject: TENANT })
      .action(api.vaultDrive.importDriveFolder, {
        driveFolderId: DRIVE_FOLDER,
        name: "Q3",
      })
      .catch((e: Error) => ({ threw: e.message }));

    expect(result).toEqual({ ok: false, reason: "reauth" });
    // THE HALF THAT MATTERS: not merely that the answer is `reauth`, but that nothing was asked.
    // A refresh POST here would burn the grant's rate budget to learn what the scope string
    // already said.
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test("no grant at all is not_connected, and also silent", async () => {
    const t = harness();
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    expect(
      await t.withIdentity({ subject: TENANT }).action(api.vaultDrive.importDriveFolder, {
        driveFolderId: DRIVE_FOLDER,
        name: "Q3",
      }),
    ).toEqual({ ok: false, reason: "not_connected" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  // The id is interpolated into Drive's `q=` SEARCH EXPRESSION, which percent-encoding does not
  // protect: `' in parents and trashed=false` is a query language, not a URL.
  test("a folder id that could break out of the q= literal is refused before anything else", async () => {
    const t = harness();
    await seedGrant(t, FULL_SCOPE);
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    expect(
      await t.withIdentity({ subject: TENANT }).action(api.vaultDrive.importDriveFolder, {
        driveFolderId: "abc' or '1'='1",
        name: "Q3",
      }),
    ).toEqual({ ok: false, reason: "bad_folder_id" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

// ── 1b. Browsing: one request, split into folders and files ───────────────────

describe("a browsed level shows what is in it, not just its subfolders", () => {
  // The picker's first cut filtered on `mimeType='...folder'` and returned folders alone, so a
  // folder holding 200 documents and an empty one looked identical until you pressed Import. The
  // fix is the SAME single request with the filter dropped, split here.
  test("folders navigate, files are listed, and unreadable files say so", async () => {
    const t = harness();
    await seedGrant(t, FULL_SCOPE);

    // URL-AWARE, because `freshAccessToken` POSTs the token endpoint first. A stub that answers
    // every request with the same body hands the refresh a file list, and `updateAccess` then
    // rejects the undefined access_token — which looks like a Drive bug and is not one.
    const fetchSpy = vi.fn(async (url: string) => {
      if (!String(url).includes("/drive/v3/"))
        return Response.json({ access_token: "fresh", expires_in: 3600 });
      return Response.json({
        files: [
          { id: "sub", name: "Sub", mimeType: "application/vnd.google-apps.folder" },
          { id: "doc", name: "Strategy", mimeType: DOC_MIME, modifiedTime: "2026-01-01T00:00:00Z" },
          { id: "form", name: "Survey", mimeType: "application/vnd.google-apps.form" },
          {
            id: "huge",
            name: "Raw.mp4",
            mimeType: "video/mp4",
            size: String(900 * 1000 * 1000),
          },
        ],
      });
    });
    vi.stubGlobal("fetch", fetchSpy);

    const r = await t
      .withIdentity({ subject: TENANT })
      .action(api.vaultDrive.listDriveFolders, { parentId: DRIVE_FOLDER });

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.folders.map((f) => f.id)).toEqual(["sub"]);
    expect(r.files).toEqual([
      { id: "doc", name: "Strategy", readable: true },
      { id: "form", name: "Survey", readable: false, code: "no_text_export" },
      { id: "huge", name: "Raw.mp4", readable: false, code: "over_video_cap" },
    ]);

    // ⚠ ASSERT ON THE REQUEST, NOT ONLY ON THE RESPONSE. A stub answers with whatever it was told
    // to answer, so every assertion above still passes if the query goes back to asking for
    // folders ONLY — the split is client-side and the fixture is unchanged. The mutation run
    // proved that: restoring `mimeType='...folder'` left all 13 tests green. The query itself is
    // the thing that regressed, so the query itself is what has to be checked.
    const driveCalls = fetchSpy.mock.calls.filter((c) => String(c[0]).includes("/drive/v3/files"));
    expect(driveCalls, "the level must cost ONE request, not one per kind").toHaveLength(1);

    const q = new URL(String(driveCalls[0]?.[0])).searchParams.get("q") ?? "";
    expect(q, "the browse query lost its parent scope").toContain("in parents");
    expect(
      q,
      "the browse query filters to folders — mutation: put `mimeType='...folder'` back. The user " +
        "then cannot tell an empty folder from one holding 200 documents until they press Import.",
    ).not.toContain("google-apps.folder");
  });

  // A failed `files.list` at the ROOT must render as an ERROR, never as an empty Drive. The
  // degrade-to-[] shape showed a tenant with a disabled Drive API (403, observed 2026-08-15)
  // "Nothing here — no folders and no files", which reads as a broken connection.
  test("a failing files.list at the root returns drive_error, not an empty ok", async () => {
    const t = harness();
    await seedGrant(t, FULL_SCOPE);

    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (!String(url).includes("/drive/v3/"))
          return Response.json({ access_token: "fresh", expires_in: 3600 });
        return new Response('{"error":{"code":403}}', { status: 403 });
      }),
    );

    const r = await t.withIdentity({ subject: TENANT }).action(api.vaultDrive.listDriveFolders, {});
    expect(r).toEqual({ ok: false, reason: "drive_error" });
  });

  // The asymmetry is DELIBERATE: the shared-drives probe alone may fail (a personal account 403s
  // `drives.list` by design) and the root still lists — only the two `files.list` calls are load-
  // bearing.
  test("a failing drives.list alone still lists the root", async () => {
    const t = harness();
    await seedGrant(t, FULL_SCOPE);

    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (!String(url).includes("/drive/v3/"))
          return Response.json({ access_token: "fresh", expires_in: 3600 });
        if (String(url).includes("/drive/v3/drives"))
          return new Response('{"error":{"code":403}}', { status: 403 });
        return Response.json({
          files: [{ id: "f1", name: "Plans", mimeType: "application/vnd.google-apps.folder" }],
        });
      }),
    );

    const r = await t.withIdentity({ subject: TENANT }).action(api.vaultDrive.listDriveFolders, {});
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.folders.map((f) => f.id)).toEqual(["f1"]);
  });

  // The classifier is SHARED with the import on purpose: what the picker promises and what the
  // import does cannot drift apart if there is only one function deciding.
  test("the browse verdict is the import's verdict — one classifier, not two", () => {
    const src = readFileSync(new URL("./vaultDrive.ts", import.meta.url), "utf8");
    expect(
      (src.match(/classifyOne\(/g) ?? []).length,
      "classifyOne has fewer than two call sites — the browse and the import have drifted apart, " +
        "so a file the picker calls readable can still be skipped at import time.",
    ).toBeGreaterThanOrEqual(3); // 1 definition + the import's classify() + the browse
  });
});

// ── 2. Landing into the spine ─────────────────────────────────────────────────

describe("an exported file lands as an ordinary vault document", () => {
  test("source google, category google-docs, a real hash, and a resolvable storageId", async () => {
    const t = harness();
    const folderId = await openFolder(t, 1);
    const storageId = await t.run(async (ctx) => ctx.storage.store(new Blob(["hello drive"])));

    await t.mutation(internal.vaultDrive.landFile, {
      tenantId: TENANT,
      folderId,
      driveFileId: "file_a",
      driveModifiedTime: NOW,
      title: "Strategy",
      mimeType: "text/plain",
      size: 11,
      contentHash: "hash_a",
      storageId,
      text: "hello drive",
    });

    const rows = await t.run((ctx) => ctx.db.query("vaultDocuments").collect());
    expect(rows).toHaveLength(1);
    const doc = first(rows);
    expect(doc.source).toBe("google");
    expect(doc.category).toBe("google-docs");
    expect(doc.contentHash).toBe("hash_a");
    expect(doc.folderId).toBe(folderId);
    expect(doc.driveFileId).toBe("file_a");
    // pending_extraction and NOT dispatched: the folder's own walk starts every member once the
    // run opens, which is what keeps "reserve before the first cent" true.
    expect(doc.status).toBe("pending_extraction");
    expect(await t.run((ctx) => ctx.storage.getUrl(doc.storageId as never))).toBeTruthy();
  });

  // The fan-in. The folder may not leave `reserving` until every expected file has landed —
  // `tryComplete` refuses to fire on anything but `ingesting`, so this flip is the ONLY thing
  // standing between a fast first file and a folder that completes while file 2 is in flight.
  test("the folder opens only when the LAST expected file lands", async () => {
    const t = harness();
    const folderId = await openFolder(t, 2);
    const storageId = await t.run(async (ctx) => ctx.storage.store(new Blob(["a"])));

    await t.mutation(internal.vaultDrive.landFile, {
      tenantId: TENANT,
      folderId,
      driveFileId: "f1",
      driveModifiedTime: NOW,
      title: "one",
      mimeType: "text/plain",
      size: 1,
      contentHash: "h1",
      storageId,
      text: "a",
    });
    expect((await t.run((ctx) => ctx.db.get(folderId)))?.status).toBe("reserving");

    await t.mutation(internal.vaultDrive.landFile, {
      tenantId: TENANT,
      folderId,
      driveFileId: "f2",
      driveModifiedTime: NOW,
      title: "two",
      mimeType: "text/plain",
      size: 1,
      contentHash: "h2",
      storageId,
      text: "a",
    });
    expect((await t.run((ctx) => ctx.db.get(folderId)))?.status).toBe("ingesting");
  });

  // A single 404 that did not count would hang the folder in `reserving` forever, holding a
  // reservation nothing settles — there is no folder-level watchdog.
  test("a file that FAILED to export still counts toward the fan-in and creates no row", async () => {
    const t = harness();
    const folderId = await openFolder(t, 1);

    await t.mutation(internal.vaultDrive.landFailure, {
      tenantId: TENANT,
      folderId,
      code: "export_too_large",
    });

    // `complete`, not `ingesting`: the run opened and immediately had nothing to ingest, so
    // `tryComplete` fired in the same transaction (terminalCount 0 >= memberCount 0). THE POINT IS
    // THAT IT REACHED A TERMINAL STATUS AT ALL — without the failure counting toward the fan-in the
    // folder sits at `reserving` forever, holding a reservation nothing settles.
    expect((await t.run((ctx) => ctx.db.get(folderId)))?.status).toBe("complete");
    expect(await t.run((ctx) => ctx.db.query("vaultDocuments").collect())).toHaveLength(0);
  });
});

// ── 3. Dedup attaches identity, never membership ──────────────────────────────

describe("findInDrive uses the existing bounded, shared-drive-aware boundary", () => {
  test("a pre-widening grant returns reauth before fetch", async () => {
    const t = harness();
    await seedGrant(t, PRE_WIDENING_SCOPE);
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    expect(
      await t.withIdentity({ subject: TENANT }).action(api.vaultDrive.findInDrive, {
        query: "quarterly plan",
      }),
    ).toEqual({ ok: false, reason: "reauth" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test("searches name plus fullText with a 20-hit cap and both shared-drive flags", async () => {
    const t = harness();
    await seedGrant(t, FULL_SCOPE);
    const fetchSpy = vi.fn(async (url: string) => {
      if (!String(url).includes("/drive/v3/"))
        return Response.json({ access_token: "fresh", expires_in: 3600 });
      return Response.json({
        files: [
          {
            id: "doc-1",
            name: "Quarterly plan",
            mimeType: "text/plain",
            size: "42",
            modifiedTime: new Date(NOW).toISOString(),
            capabilities: { canDownload: true },
          },
          { id: "folder-1", name: "Plans", mimeType: "application/vnd.google-apps.folder" },
        ],
      });
    });
    vi.stubGlobal("fetch", fetchSpy);

    const result = await t.withIdentity({ subject: TENANT }).action(api.vaultDrive.findInDrive, {
      query: "quarterly plan",
    });
    expect(result).toEqual({
      ok: true,
      hits: [
        { id: "doc-1", name: "Quarterly plan", kind: "file", readable: true },
        { id: "folder-1", name: "Plans", kind: "folder", readable: false },
      ],
    });

    const driveCall = fetchSpy.mock.calls.find(([url]) => String(url).includes("/drive/v3/"));
    expect(driveCall).toBeDefined();
    const url = new URL(String(driveCall?.[0]));
    expect(url.searchParams.get("q")).toBe(
      "(name contains 'quarterly plan' or fullText contains 'quarterly plan') and trashed=false",
    );
    expect(url.searchParams.get("pageSize")).toBe("20");
    expect(url.searchParams.get("supportsAllDrives")).toBe("true");
    expect(url.searchParams.get("includeItemsFromAllDrives")).toBe("true");
  });

  test("escapes quotes inside both Drive query-language literals", async () => {
    const t = harness();
    await seedGrant(t, FULL_SCOPE);
    const fetchSpy = vi.fn(async (url: string) => {
      if (!String(url).includes("/drive/v3/"))
        return Response.json({ access_token: "fresh", expires_in: 3600 });
      return Response.json({ files: [] });
    });
    vi.stubGlobal("fetch", fetchSpy);

    await t.withIdentity({ subject: TENANT }).action(api.vaultDrive.findInDrive, {
      query: "O'Brien' or trashed=true or name contains '",
    });
    const driveCall = fetchSpy.mock.calls.find(([url]) => String(url).includes("/drive/v3/"));
    expect(driveCall).toBeDefined();
    const q = new URL(String(driveCall?.[0])).searchParams.get("q");
    expect(q).toContain("O\\'Brien\\' or trashed=true or name contains \\'");
    expect(q).toBe(
      "(name contains 'O\\'Brien\\' or trashed=true or name contains \\'' or fullText contains 'O\\'Brien\\' or trashed=true or name contains \\'') and trashed=false",
    );
  });
});

describe("a content dedup hit is not annexed into the folder", () => {
  // `vault.vaultUpload`'s dedup branch returns and does nothing else — correct there, WRONG here:
  // the row would carry no driveFileId, so every future refresh would re-export it forever. But
  // attaching `folderId` would SEAL a document the user could already ground on (CONTEXT §B7).
  // Identity yes, membership no.
  test("driveFileId is patched on; folderId is NOT, and memberCount does not move", async () => {
    const t = harness();
    const folderId = await openFolder(t, 1);
    const existing = await t.run(async (ctx) =>
      ctx.db.insert("vaultDocuments", {
        tenantId: TENANT,
        title: "already here",
        kind: "upload",
        category: "my-uploads",
        source: "upload",
        mimeType: "text/plain",
        size: 5,
        contentHash: "shared_hash",
        status: "ready" as const,
        createdAt: NOW,
      }),
    );
    const storageId = await t.run(async (ctx) => ctx.storage.store(new Blob(["x"])));

    await t.mutation(internal.vaultDrive.landFile, {
      tenantId: TENANT,
      folderId,
      driveFileId: "file_dup",
      driveModifiedTime: NOW,
      title: "same bytes",
      mimeType: "text/plain",
      size: 5,
      contentHash: "shared_hash",
      storageId,
      text: "x",
    });

    const row = await t.run((ctx) => ctx.db.get(existing));
    expect(row?.driveFileId).toBe("file_dup");
    expect(row?.folderId).toBeUndefined(); // never sealed into an ingesting folder
    expect(row?.status).toBe("ready"); // and never knocked back off groundable
    expect(await t.run((ctx) => ctx.db.query("vaultDocuments").collect())).toHaveLength(1);
    expect((await t.run((ctx) => ctx.db.get(folderId)))?.memberCount).toBe(0);
  });
});

// ── 4. Re-import ──────────────────────────────────────────────────────────────

describe("re-import is keyed on driveFileId + modifiedTime, never on contentHash", () => {
  // OOXML is a zip — two exports of an unchanged Sheet are not byte-identical, so a contentHash
  // key would duplicate the whole folder on every refresh.
  test("an unchanged listing fetches nothing and creates nothing", async () => {
    const t = harness();
    await t.run(async (ctx) => {
      const folderId = await ctx.db.insert("vaultFolders", {
        tenantId: TENANT,
        name: "Drive folder",
        source: "drive" as const,
        status: "complete" as const,
        memberCount: 1,
        terminalCount: 1,
        failedCount: 0,
        reservedCents: 0,
        spentCents: 4,
        driveFolderId: DRIVE_FOLDER,
        createdAt: NOW,
      });
      await ctx.db.insert("vaultDocuments", {
        tenantId: TENANT,
        title: "Strategy",
        kind: "upload",
        category: "google-docs",
        source: "google",
        mimeType: "text/plain",
        size: 10,
        contentHash: "h",
        status: "ready" as const,
        folderId,
        driveFileId: "file_a",
        driveModifiedTime: NOW,
        createdAt: NOW,
      });
    });

    const diff = await t.mutation(internal.vaultDrive.diffImport, {
      tenantId: TENANT,
      driveFolderId: DRIVE_FOLDER,
      name: "Drive folder",
      files: [{ driveFileId: "file_a", modifiedTime: NOW, mimeType: "text/plain", estBytes: 10 }],
    });

    expect(diff.fetchIds).toEqual([]); // nothing to fetch ⇒ zero export calls, zero spend
    expect(diff.unchanged).toBe(1);
    expect(diff.added).toBe(0);
    expect(await t.run((ctx) => ctx.db.query("vaultDocuments").collect())).toHaveLength(1);
  });

  test("a moved modifiedTime is fetched, and updates the SAME row rather than adding one", async () => {
    const t = harness();
    const folderId = await openFolder(t, 1);
    const original = await t.run(async (ctx) =>
      ctx.db.insert("vaultDocuments", {
        tenantId: TENANT,
        title: "Strategy",
        kind: "upload",
        category: "google-docs",
        source: "google",
        mimeType: "text/plain",
        size: 10,
        contentHash: "old_hash",
        status: "ready" as const,
        folderId,
        driveFileId: "file_a",
        driveModifiedTime: NOW,
        createdAt: NOW,
      }),
    );

    const diff = await t.mutation(internal.vaultDrive.diffImport, {
      tenantId: TENANT,
      driveFolderId: DRIVE_FOLDER,
      name: "Drive folder",
      files: [
        { driveFileId: "file_a", modifiedTime: NOW + 1, mimeType: "text/plain", estBytes: 10 },
      ],
    });
    expect(diff.fetchIds).toEqual(["file_a"]);
    expect(diff.updated).toBe(1);

    const storageId = await t.run(async (ctx) => ctx.storage.store(new Blob(["new"])));
    await t.mutation(internal.vaultDrive.landFile, {
      tenantId: TENANT,
      folderId,
      driveFileId: "file_a",
      driveModifiedTime: NOW + 1,
      title: "Strategy",
      mimeType: "text/plain",
      size: 3,
      contentHash: "new_hash",
      storageId,
      text: "new",
    });

    const rows = await t.run((ctx) => ctx.db.query("vaultDocuments").collect());
    expect(rows).toHaveLength(1); // THE MUTATION TARGET: drop the driveFileId lookup → 2 rows
    expect(first(rows)._id).toBe(original); // in place, so digestSourceDocIds stays stable
    expect(first(rows).contentHash).toBe("new_hash");
    expect(first(rows).status).toBe("pending_extraction"); // re-queued for ingest
  });

  test("a touched-but-unedited file records the new stamp and is NOT re-ingested", async () => {
    const t = harness();
    const folderId = await openFolder(t, 1);
    await t.run(async (ctx) =>
      ctx.db.insert("vaultDocuments", {
        tenantId: TENANT,
        title: "Strategy",
        kind: "upload",
        category: "google-docs",
        source: "google",
        mimeType: "text/plain",
        size: 3,
        contentHash: "same",
        status: "ready" as const,
        folderId,
        driveFileId: "file_a",
        driveModifiedTime: NOW,
        createdAt: NOW,
      }),
    );
    const storageId = await t.run(async (ctx) => ctx.storage.store(new Blob(["abc"])));

    await t.mutation(internal.vaultDrive.landFile, {
      tenantId: TENANT,
      folderId,
      driveFileId: "file_a",
      driveModifiedTime: NOW + 5,
      title: "Strategy",
      mimeType: "text/plain",
      size: 3,
      contentHash: "same",
      storageId,
      text: "abc",
    });

    const rows = await t.run((ctx) => ctx.db.query("vaultDocuments").collect());
    expect(rows).toHaveLength(1);
    expect(first(rows).driveModifiedTime).toBe(NOW + 5); // so the NEXT refresh reads it as unchanged
    expect(first(rows).status).toBe("ready"); // untouched — no re-embed, no re-spend
  });
});

// ── 5. The audit payload carries no user content ──────────────────────────────

describe("the audit payload is refs and counts only", () => {
  test("an unreadable file records its CODE and nothing else identifying", async () => {
    const t = harness();
    const folderId = await openFolder(t, 1);
    await t.mutation(internal.vaultDrive.landFailure, {
      tenantId: TENANT,
      folderId,
      code: "no_download_permission",
    });

    const rows = await t.run((ctx) => ctx.db.query("audit").collect());
    expect(rows).toHaveLength(1);
    expect(first(rows).eventType).toBe("vault.drive.unreadable");
    expect(Object.keys(first(rows).payload as object).sort()).toEqual(["code", "folderId"]);
  });
});
