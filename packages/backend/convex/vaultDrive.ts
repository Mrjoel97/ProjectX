/**
 * The Google Drive import rail (15.3-09, VALT-13).
 *
 * **DELIBERATELY NOT `"use node"`**, unlike its sibling Google adapters `gmail.ts` and
 * `calendar.ts`. Those are actions-only modules, and the 01-07 rule is that a `"use node"` module
 * holds ONLY actions — but this rail's fan-in is a mutation (`landFile`), which has to commit in
 * the same transaction as the counter that decides whether the folder opens. Nothing here needs a
 * Node builtin: `fetch`, `Blob`, `TextDecoder` and `crypto.subtle` are all in Convex's V8 runtime.
 * So the module stays V8 and keeps its actions and mutations together, exactly as `vault.ts` does.
 * Adding `"use node"` later would silently break the mutations, not just relocate them.
 *
 * **A SCOPE-WIDENING OF THE EXISTING GOOGLE GRANT, NOT A SECOND INTEGRATION.** No new secret, no
 * new HTTP route, no second token table, no second refresh POST — exactly as Calendar was. The
 * token plane is `gmailAuth` + `gmail.freshAccessToken`, reused verbatim; Calendar already proved a
 * non-Gmail module may import that root.
 *
 * **A DRIVE FOLDER IS AN ORDINARY VAULT FOLDER.** Everything after the bytes land is the shipped
 * spine: `vaultFolders` for the money and the seal, `vaultIngestPool` for the work,
 * `walkFolderMembers` for the dispatch, `tryComplete` for the unseal. This module owns exactly two
 * things the spine does not have — talking to Drive, and knowing when the last file has landed.
 *
 * ── THE ORDER, WHICH IS THE WHOLE DESIGN ──────────────────────────────────────────────────────
 *
 * 1. scope check → reauth, BEFORE `freshAccessToken` and before any network call;
 * 2. enumerate (metadata only — no bytes);
 * 3. RESERVE, from that metadata;
 * 4. only then download anything.
 *
 * Step 3 sits before step 4 deliberately, and this is the one place the Drive rail is ordered
 * differently from the upload rail. On the upload rail the browser has already sent the bytes by
 * the time a manifest exists, so the reservation is necessarily taken last. Here `files.list`
 * returns count, size and type BEFORE a single byte is exported (15.3-CONTEXT), so a refused folder
 * can be refused without downloading a gigabyte first. Refuse-intact stops being a property we
 * assert and becomes a property proven by absence.
 *
 * ── THE TWO CORRECTED DECISIONS (CONTEXT §A6, §A7) ────────────────────────────────────────────
 *
 * §A6 — "the byte cap does not apply to Drive" was factually wrong. Non-native files are
 * DOWNLOADED, into a ~512 MB action; a 600 MB video OOMs the action before any cap could refuse
 * it. The same per-file caps apply, checked against `size` metadata during pre-flight, so the count
 * the user approves is the count that imports.
 *
 * §A7 — Drive metadata has no `size` for Google-native docs. See `estimatedBytesFor`; reading a
 * missing size as 0 reserves nothing and strands the folder mid-run.
 */

import { DRIVE_READONLY_SCOPE, hasScope } from "@pikar/core";
import {
  categoryFor,
  isSearchable,
  VAULT_FILE_CAP_BYTES,
  VAULT_VIDEO_CAP_BYTES,
} from "@pikar/vault";
import { estimatedBytesFor } from "@pikar/vault/driveEstimate";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { internalAction, internalMutation, type MutationCtx } from "./_generated/server";
import { freshAccessToken } from "./gmail";
import { tenantAction } from "./lib/functions";
import { contentHash } from "./lib/hash";
import { tryComplete } from "./vaultFolders";

const DRIVE_FILES_ENDPOINT = "https://www.googleapis.com/drive/v3/files";
const DRIVE_DRIVES_ENDPOINT = "https://www.googleapis.com/drive/v3/drives";

/** Google's own folder mime. A folder is a file in Drive, which is why enumeration recurses. */
const FOLDER_MIME = "application/vnd.google-apps.folder";

/**
 * Native kinds with NO text-bearing export. Enumerated EXPLICITLY, and everything not in the
 * handled set below defaults to unreadable — never silently skipped. A Form is a response
 * collector, a Site is a website, a Map/Jam/Script/drive-sdk file is not a document: exporting any
 * of them yields either an error or a shell with no content, and importing that shell would put a
 * confidently empty document into the grounding corpus.
 */
const NO_TEXT_EXPORT = new Set([
  "application/vnd.google-apps.form",
  "application/vnd.google-apps.site",
  "application/vnd.google-apps.map",
  "application/vnd.google-apps.jam",
  "application/vnd.google-apps.script",
  "application/vnd.google-apps.drive-sdk",
]);

/**
 * Export target per Google-native kind. **LOAD-BEARING FOR DEDUP, not a formatting preference.**
 *
 * Docs and Slides → `text/plain`, which is deterministic: the same unedited Doc exports to the same
 * bytes every time, so `contentHash` is stable across refreshes. It is also in `SEARCHABLE_MIME`,
 * so those documents skip extraction entirely and ride the ingest workflow directly.
 *
 * Sheets → **xlsx, NOT `text/csv`.** Drive's csv export is FIRST SHEET ONLY and silently drops
 * every other tab — a three-tab workbook would import as a third of itself with nothing anywhere
 * saying so. xlsx is in `OFFICE_MIME`, so it rides the shipped extraction rail with zero new code.
 *
 * ⚠ THE CONSEQUENCE OF THE XLSX CHOICE, AND WHY `contentHash` CANNOT BE THE RE-IMPORT KEY. OOXML is
 * a zip: it carries timestamps and generated ids, so two exports of an UNCHANGED spreadsheet are
 * almost certainly not byte-identical. Dedup on `contentHash` alone would therefore re-hash
 * differently on every refresh and duplicate the entire folder. `driveFileId + modifiedTime` is the
 * primary key precisely because of this; `contentHash` is the fallback that catches an edit which
 * did not move `modifiedTime`.
 */
const EXPORT_TARGET: Record<string, string> = {
  "application/vnd.google-apps.document": "text/plain",
  "application/vnd.google-apps.presentation": "text/plain",
  "application/vnd.google-apps.spreadsheet":
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

/**
 * `files.export` fails hard above this — Google's documented limit on the export endpoint, not
 * ours. A native doc past it lands in the unreadable bucket with its own code rather than as a
 * generic failure, because "this Doc is too big for Drive to export" is a different sentence from
 * "the import broke".
 */
const DRIVE_EXPORT_CAP_BYTES = 10 * 1024 * 1024;

/**
 * Enumeration bounds. Drive nesting is unbounded and can CYCLE through shortcuts, so a recursive
 * walk needs both a visited set and a hard node cap or it does not terminate.
 *
 * ponytail: these caps are also what makes the 10-minute action limit a non-issue, which is why
 * there is no scheduled enumeration continuation. `pageSize=1000` means the file cap is at most a
 * handful of `files.list` round-trips and the folder cap at most 200 more — seconds of network,
 * not minutes. The plan specified a self-scheduling continuation; bounding the work below the limit
 * is the smaller way to satisfy the same requirement, and the ceiling is explicit rather than
 * implicit. Upgrade path if a real tenant ever hits the caps: persist `{queue, visited, cursor}` on
 * the folder row and self-schedule from there — the walk below is already written as an explicit
 * queue, not as recursion, so it lifts out unchanged.
 */
const DRIVE_MAX_FILES = 2_000;
const DRIVE_MAX_FOLDERS = 200;

/** Why a file was not imported. REFS-ONLY CODES, never a filename (CLAUDE.md §4). */
export type DriveSkipCode =
  | "no_download_permission"
  | "shortcut_unresolved"
  | "no_text_export"
  | "over_file_cap"
  | "over_video_cap"
  | "export_too_large"
  | "export_failed";

type DriveFile = {
  id: string;
  name: string;
  mimeType: string;
  size?: string;
  modifiedTime?: string;
  shortcutDetails?: { targetId?: string; targetMimeType?: string };
  capabilities?: { canDownload?: boolean };
};

/** One importable file, already resolved to what it will become in the vault. */
type Importable = {
  driveFileId: string;
  name: string;
  /** The mime the vault row will carry — the EXPORT target for natives, the original otherwise. */
  mimeType: string;
  /** The mime to ask Drive for. Absent ⇒ `alt=media` download rather than `files.export`. */
  exportMime?: string;
  /** Conservative bytes for the reservation — never 0 (see `estimatedBytesFor`). */
  estBytes: number;
  modifiedTime: number;
};

// ── Drive HTTP ────────────────────────────────────────────────────────────────

/**
 * `supportsAllDrives` on EVERY call, `includeItemsFromAllDrives` on every LIST.
 *
 * ⚠ THIS IS THE HIGHEST-CONSEQUENCE, LOWEST-VISIBILITY DETAIL IN THE FILE. Omit them and a
 * shared-drive folder does not error — it returns HTTP 200 with an EMPTY `files` array. The user
 * picks a folder with 300 documents in it and the product says "imported 0 files, folder complete".
 * A lying folder is worse than a failed one, and nothing in the response distinguishes the two.
 * `vaultDrive.test.ts` scans this source for both params for exactly that reason.
 */
function driveUrl(path: string, params: Record<string, string>): string {
  const q = new URLSearchParams({ ...params, supportsAllDrives: "true" });
  return `${DRIVE_FILES_ENDPOINT}${path}?${q.toString()}`;
}

/**
 * `drives.list` — the SHARED DRIVES themselves, which `files.list` cannot see.
 *
 * A separate builder because this is not a `files` endpoint: it takes no `supportsAllDrives` and no
 * `includeItemsFromAllDrives` (there is nothing to include items *from* — the drives ARE the
 * result). Routed through a helper anyway so the "no inline googleapis URL" scan stays true and
 * every outbound Drive call remains greppable from one place.
 */
function drivesUrl(params: Record<string, string>): string {
  return `${DRIVE_DRIVES_ENDPOINT}?${new URLSearchParams(params).toString()}`;
}

/**
 * Drive ids are `[A-Za-z0-9_-]`. Validated at the TRUST BOUNDARY because the id is pasted by the
 * user and then interpolated into the `q=` search expression as `'<id>' in parents` — a value
 * carrying a quote would close that literal and rewrite the query. `URLSearchParams` percent-encodes
 * the parameter, so this is not a URL-injection guard; it is a guard against injection into Drive's
 * own query LANGUAGE, which the encoding does nothing about.
 */
const DRIVE_ID_RE = /^[A-Za-z0-9_-]{1,256}$/;

/**
 * One Drive GET with backoff on the rate-limit codes ONLY.
 *
 * A 300-file folder is 300+ requests against a per-user quota, so a spurious 403
 * `userRateLimitExceeded` is expected rather than exceptional. Without the retry that transient
 * throttle is indistinguishable from a permission failure, and a perfectly readable file would be
 * reported to the user as unreadable — a lie in the manifest the folder promises is honest.
 *
 * ponytail: fixed exponential backoff, no jitter, 3 attempts. Sequential per-file actions on the
 * ingest pool are not a thundering herd, so jitter would buy nothing. Upgrade path if the pool ever
 * fans out wider: add jitter here, one line.
 */
async function driveFetch(url: string, token: string): Promise<Response> {
  let delayMs = 500;
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (res.ok || attempt >= 2) return res;
    if (res.status !== 429 && res.status !== 403) return res;
    // A 403 is only retried when Drive says it is a RATE limit. A 403 for insufficient scope or a
    // missing file is permanent, and retrying it would turn a clean refusal into a slow one.
    if (res.status === 403 && !/rateLimitExceeded/i.test(await res.clone().text())) return res;
    await new Promise((r) => setTimeout(r, delayMs));
    delayMs *= 2;
  }
}

/**
 * Drive said no — LOG IT, and let the caller return a code instead of throwing.
 *
 * ⚠ WHY THIS EXISTS AT ALL. Every browse path used to `throw new Error("drive: files.list 403")`.
 * A throw out of an action reaches the browser as an untyped `Server Error` AND as an unhandled
 * promise rejection (`void load(...)` in the picker), so the picker painted "Reading Drive…"
 * forever and said nothing — which is exactly what "Drive is not responding" looks like from the
 * outside. Worse, the root level is THREE lists and one throw killed all three: a single 403 on the
 * shared-with-me query hid every folder in My Drive too.
 *
 * The status and Drive's own message go to the SERVER log only. A status code is not user content,
 * but Drive echoes the `q` (which carries a folder id) in its error body, so this is a console line
 * and never an audit payload (§4).
 */
async function logDriveFailure(label: string, res: Response): Promise<void> {
  console.error(`drive: ${label} ${res.status} ${(await res.text()).slice(0, 300)}`);
}

/**
 * Breadth-first enumeration of a Drive folder, metadata only.
 *
 * ONE `files.list` per folder per page — the field projection asks for everything the pre-flight
 * decision needs, so N files cost 1 request rather than N+1 `files.get` calls.
 */
async function enumerateFolder(
  token: string,
  rootId: string,
): Promise<{ files: DriveFile[]; truncated: boolean }> {
  const queue = [rootId];
  const visited = new Set<string>([rootId]);
  const files: DriveFile[] = [];
  let truncated = false;

  while (queue.length > 0) {
    const folderId = queue.shift() as string;
    let pageToken: string | undefined;

    do {
      const url = driveUrl("", {
        q: `'${folderId}' in parents and trashed=false`,
        fields:
          "nextPageToken,files(id,name,mimeType,size,modifiedTime,md5Checksum,shortcutDetails,capabilities/canDownload)",
        pageSize: "1000",
        includeItemsFromAllDrives: "true",
        ...(pageToken ? { pageToken } : {}),
      });
      const res = await driveFetch(url, token);
      if (!res.ok) throw new Error(`drive: files.list ${res.status}`);
      const body = (await res.json()) as { files?: DriveFile[]; nextPageToken?: string };

      for (const f of body.files ?? []) {
        if (f.mimeType === FOLDER_MIME) {
          if (visited.has(f.id)) continue; // a shortcut cycle, and the reason `visited` exists
          if (visited.size > DRIVE_MAX_FOLDERS) {
            truncated = true;
            continue;
          }
          visited.add(f.id);
          queue.push(f.id);
          continue;
        }
        if (files.length >= DRIVE_MAX_FILES) {
          truncated = true;
          continue;
        }
        files.push(f);
      }
      pageToken = body.nextPageToken;
    } while (pageToken);
  }

  return { files, truncated };
}

/**
 * Pre-flight classification: every enumerated file becomes EITHER importable OR a coded skip.
 *
 * Runs on metadata, before anything is downloaded, so the count the user approves is the count that
 * imports. The default arm is `no_text_export`, not "import it anyway": an unrecognised native kind
 * is a kind we cannot export, and guessing produces an empty document rather than an error.
 */
function classifyOne(f: DriveFile): Importable | { skip: DriveSkipCode } {
  if (f.capabilities?.canDownload === false) return { skip: "no_download_permission" };
  // A shortcut is a pointer, not content. `targetId` would need a second resolution pass and the
  // target may live outside the folder the user picked — importing it would pull in a document
  // they did not choose.
  if (f.shortcutDetails !== undefined || f.mimeType === "application/vnd.google-apps.shortcut")
    return { skip: "shortcut_unresolved" };
  if (NO_TEXT_EXPORT.has(f.mimeType)) return { skip: "no_text_export" };

  const isNative = f.mimeType.startsWith("application/vnd.google-apps.");
  const exportMime = EXPORT_TARGET[f.mimeType];
  // The explicit default — an unrecognised native kind is never silently skipped.
  if (isNative && exportMime === undefined) return { skip: "no_text_export" };

  const size = f.size === undefined ? undefined : Number(f.size);
  // §A6: THE CAP, BEFORE THE BYTES. A native file has no size and is bounded instead by Drive's
  // own 10 MB export limit, enforced at export time; everything else is a real download into a
  // ~512 MB action and is refused here, on metadata, while refusing is still free.
  if (!isNative && size !== undefined && Number.isFinite(size)) {
    const isVideo = f.mimeType.startsWith("video/");
    if (size > (isVideo ? VAULT_VIDEO_CAP_BYTES : VAULT_FILE_CAP_BYTES))
      return { skip: isVideo ? "over_video_cap" : "over_file_cap" };
  }

  return {
    driveFileId: f.id,
    name: f.name,
    mimeType: exportMime ?? f.mimeType,
    exportMime,
    estBytes: estimatedBytesFor({ mimeType: f.mimeType, size }),
    modifiedTime: f.modifiedTime ? Date.parse(f.modifiedTime) : 0,
  };
}

const isSkip = (r: Importable | { skip: DriveSkipCode }): r is { skip: DriveSkipCode } =>
  "skip" in r;

function classify(files: DriveFile[]): {
  importable: Importable[];
  skipped: { code: DriveSkipCode }[];
} {
  const importable: Importable[] = [];
  const skipped: { code: DriveSkipCode }[] = [];
  for (const f of files) {
    const r = classifyOne(f);
    if (isSkip(r)) skipped.push({ code: r.skip });
    else importable.push(r);
  }
  return { importable, skipped };
}

// ── Browsing (the picker, rendered by us) ─────────────────────────────────────

/** One row in the folder browser. Names ARE user content, which is why they go to the user's own
 *  screen and NEVER into an audit payload (§4). `kind` exists only so the UI can label a shared
 *  drive as a drive rather than as a folder; both are addressable as a `parents` id. */
export type DriveNode = { id: string; name: string; kind: "folder" | "shared_drive" };

/** One FILE in the browsed level. `readable` is the pre-flight verdict from the SAME classifier the
 *  import runs, so what the picker promises and what the import does cannot drift apart. */
export type DriveEntry = { id: string; name: string; readable: boolean; code?: DriveSkipCode };

const FOLDER_Q = `mimeType='${FOLDER_MIME}' and trashed=false`;
const NODE_FIELDS = "nextPageToken,files(id,name)";
/** Everything `classifyOne` reads, so a browsed level can answer "can this be read?" without a
 *  second round-trip per file. */
const BROWSE_FIELDS =
  "nextPageToken,files(id,name,mimeType,size,modifiedTime,shortcutDetails,capabilities/canDownload)";

/** One page-1 `files.list` of folders. Deliberately NOT paginated: a browse level is a HUMAN
 *  reading a list, and 100 folders in one directory is already past what anyone scans.
 *
 *  FAILS CLOSED as `null`, unlike `drives.list`: either `files.list` query failing means the root
 *  result is incomplete and must surface `drive_error`, never masquerade as an empty Drive. */
async function folderPage(token: string, q: string): Promise<DriveNode[] | null> {
  const res = await driveFetch(
    driveUrl("", { q, fields: NODE_FIELDS, pageSize: "100", includeItemsFromAllDrives: "true" }),
    token,
  );
  if (!res.ok) {
    await logDriveFailure("files.list (folders)", res);
    // null, NOT [] — the caller must render an ERROR. A 403 here (the Drive API disabled on the
    // OAuth project, observed 2026-08-15) degraded to "Nothing here — no folders and no files",
    // which reads as a broken connection and cost a live debugging session to see through.
    return null;
  }
  const body = (await res.json()) as { files?: { id: string; name: string }[] };
  return (body.files ?? []).map((f) => ({ id: f.id, name: f.name, kind: "folder" as const }));
}

export type DriveBrowseResult =
  | {
      ok: false;
      reason: "not_connected" | "reauth" | "refresh_failed" | "bad_folder_id" | "drive_error";
    }
  | { ok: true; folders: DriveNode[]; files: DriveEntry[]; truncated: boolean };

export type DriveSearchHit = {
  id: string;
  name: string;
  kind: "folder" | "file";
  parentName?: string;
  readable: boolean;
};

export type DriveSearchResult =
  | { ok: false; reason: "not_connected" | "reauth" | "refresh_failed" | "drive_error" }
  | { ok: true; hits: DriveSearchHit[] };

/** Escape a value embedded inside one of Drive's single-quoted query-language literals. URL
 * encoding happens later and does not protect this boundary: Drive decodes `q` before parsing it. */
const escapeDriveQueryLiteral = (value: string): string =>
  value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");

/**
 * List the folders the user can pick, one level at a time. **THIS IS THE PICKER**, and we render it
 * ourselves rather than mounting Google's.
 *
 * That is affordable precisely because the grant is `drive.readonly` and not `drive.file`: the
 * narrow scope only ever grants access to files handed over through Google's Picker SDK, so
 * choosing it would have forced an external `apis.google.com` script plus an API key and an app id
 * into the client. With read access to the whole Drive we can ask `files.list` for the folders and
 * draw them with our own tokens — no external script, no new dependency, no CSP hole.
 *
 * **THE ROOT LEVEL IS THREE LISTS, NOT ONE**, because Drive has three separate places a folder can
 * live and `'root' in parents` sees only the first. A folder someone shared with you is not in your
 * root, and a shared drive is not a file at all — it is not reachable through `files.list` under any
 * query. Ask for only the first and the product tells a user with a shared-drive-shaped company
 * that they have no folders.
 */
export const listDriveFolders = tenantAction({
  args: { parentId: v.optional(v.string()) },
  handler: async (ctx, { parentId }): Promise<DriveBrowseResult> => {
    if (parentId !== undefined && !DRIVE_ID_RE.test(parentId))
      return { ok: false, reason: "bad_folder_id" };

    // The SAME ordering as the import, for the same reason: a grant that cannot call Drive
    // refreshes perfectly happily, so checking scope after the refresh would show a pre-widening
    // tenant a provider failure instead of a reconnect prompt. `dispatchGuard.test.ts` pins it.
    const token: Doc<"gmailTokens"> | null = await ctx.runQuery(internal.gmailAuth.getTokens, {
      tenantId: ctx.tenantId,
    });
    if (!token) return { ok: false, reason: "not_connected" };
    if (!hasScope(token.scope, DRIVE_READONLY_SCOPE)) return { ok: false, reason: "reauth" };

    const access = await freshAccessToken(ctx, ctx.tenantId);
    if (!access.ok)
      return {
        ok: false,
        reason: access.reason === "not_connected" ? "not_connected" : "refresh_failed",
      };

    // INSIDE A FOLDER: ONE `files.list`, NOT TWO, and deliberately WITHOUT the folder filter.
    //
    // The first cut filtered on `mimeType='...folder'` and returned folders alone — which threw
    // away exactly the information the user needs to choose. There was then no way to tell an empty
    // folder from one holding 200 documents until you pressed Import and were told. Dropping the
    // filter and splitting the result here is the SAME single request, not an extra one.
    if (parentId !== undefined) {
      const res = await driveFetch(
        driveUrl("", {
          q: `'${parentId}' in parents and trashed=false`,
          fields: BROWSE_FIELDS,
          pageSize: "200",
          includeItemsFromAllDrives: "true",
        }),
        access.token,
      );
      if (!res.ok) {
        await logDriveFailure("files.list (level)", res);
        return { ok: false, reason: "drive_error" };
      }
      const body = (await res.json()) as { files?: DriveFile[]; nextPageToken?: string };
      const entries = body.files ?? [];

      const folders: DriveNode[] = [];
      const files: DriveEntry[] = [];
      for (const f of entries) {
        if (f.mimeType === FOLDER_MIME) {
          folders.push({ id: f.id, name: f.name, kind: "folder" });
          continue;
        }
        // The SAME classifier the import runs, so "can't be read" here and "skipped" there can
        // never disagree — the count the user approves is the count that imports.
        const r = classifyOne(f);
        files.push({
          id: f.id,
          name: f.name,
          ...(isSkip(r) ? { readable: false, code: r.skip } : { readable: true }),
        });
      }
      return { ok: true, folders, files, truncated: body.nextPageToken !== undefined };
    }

    const [drives, mine, shared] = await Promise.all([
      (async (): Promise<DriveNode[]> => {
        const res = await driveFetch(drivesUrl({ pageSize: "100" }), access.token);
        // A tenant on a personal Google account has no shared drives and Drive answers 403 here.
        // That is an ordinary shape of this feature, not a failure — degrade to "none".
        if (!res.ok) return [];
        const body = (await res.json()) as { drives?: { id: string; name: string }[] };
        return (body.drives ?? []).map((d) => ({
          id: d.id,
          name: d.name,
          kind: "shared_drive" as const,
        }));
      })(),
      folderPage(access.token, `'root' in parents and ${FOLDER_Q}`),
      folderPage(access.token, `sharedWithMe and ${FOLDER_Q}`),
    ]);

    // A failed folder list is an ERROR, never an empty Drive. Only the shared-drives probe above
    // may degrade to "none" — a personal account 403s that endpoint by design; `files.list` does
    // not fail on any healthy grant.
    if (mine === null || shared === null) return { ok: false, reason: "drive_error" };

    // Dedup by id: a folder can legitimately appear in more than one of the three lists.
    const byId = new Map<string, DriveNode>();
    for (const n of [...drives, ...mine, ...shared]) if (!byId.has(n.id)) byId.set(n.id, n);
    // No files at the ROOT level: the root is a merged view of three lists and is not itself
    // importable (there is no folder id to import), so loose files there would be shown with no
    // action attached to them.
    return { ok: true, folders: [...byId.values()], files: [], truncated: false };
  },
});

/** Bounded read-only search over the existing Drive grant. This returns metadata, never bytes,
 * and performs no import, reservation, export, landing or ingest work. */
export const findInDrive = tenantAction({
  args: { query: v.string() },
  handler: async (ctx, { query }): Promise<DriveSearchResult> => {
    const token: Doc<"gmailTokens"> | null = await ctx.runQuery(internal.gmailAuth.getTokens, {
      tenantId: ctx.tenantId,
    });
    if (!token) return { ok: false, reason: "not_connected" };
    if (!hasScope(token.scope, DRIVE_READONLY_SCOPE)) return { ok: false, reason: "reauth" };

    const access = await freshAccessToken(ctx, ctx.tenantId);
    if (!access.ok)
      return {
        ok: false,
        reason: access.reason === "not_connected" ? "not_connected" : "refresh_failed",
      };

    const needle = escapeDriveQueryLiteral(query.trim());
    if (needle === "") return { ok: true, hits: [] };

    const res = await driveFetch(
      driveUrl("", {
        q: `(name contains '${needle}' or fullText contains '${needle}') and trashed=false`,
        fields: BROWSE_FIELDS,
        pageSize: "20",
        includeItemsFromAllDrives: "true",
      }),
      access.token,
    );
    if (!res.ok) {
      await logDriveFailure("files.list (search)", res);
      return { ok: false, reason: "drive_error" };
    }
    const body = (await res.json()) as { files?: DriveFile[] };

    return {
      ok: true,
      hits: (body.files ?? []).map((file): DriveSearchHit => {
        const folder = file.mimeType === FOLDER_MIME;
        return {
          id: file.id,
          name: file.name,
          kind: folder ? "folder" : "file",
          readable: !folder && !isSkip(classifyOne(file)),
        };
      }),
    };
  },
});

// ── The entry point ───────────────────────────────────────────────────────────

export type DriveImportResult =
  | {
      ok: false;
      reason: "not_connected" | "reauth" | "refresh_failed" | "bad_folder_id" | "drive_error";
    }
  | { ok: false; reason: "empty_folder" }
  | {
      ok: false;
      reason: "refused";
      estCents: number;
      remainingCents: number;
      shortfallCents: number;
    }
  | { ok: false; reason: "unchanged"; unchanged: number }
  | {
      ok: true;
      folderId: Id<"vaultFolders">;
      added: number;
      updated: number;
      unchanged: number;
      removed: number;
      skipped: { code: DriveSkipCode }[];
      truncated: boolean;
    };

/**
 * Import (or refresh) one Drive folder.
 *
 * A `tenantAction` because the browser drives it and the tenant comes from the caller's identity —
 * every SCHEDULED function below takes an explicit `tenantId` instead, because a scheduled function
 * has no identity at all (the `research.persistFindings` shape).
 */
export const importDriveFolder = tenantAction({
  args: { driveFolderId: v.string(), name: v.string() },
  handler: async (ctx, { driveFolderId, name }): Promise<DriveImportResult> => {
    // 1. THE GRANT, BEFORE THE NETWORK. `freshAccessToken` succeeds for a token that cannot call
    //    Drive at all, so checking scope after it would present a permanent reconnect condition as
    //    a provider failure. `include_granted_scopes` is forward-only: every tenant connected
    //    before this phase holds a grant with no Drive scope and MUST land here.
    //    `dispatchGuard.test.ts` pins this ordering statically.
    if (!DRIVE_ID_RE.test(driveFolderId)) return { ok: false, reason: "bad_folder_id" };

    const token: Doc<"gmailTokens"> | null = await ctx.runQuery(internal.gmailAuth.getTokens, {
      tenantId: ctx.tenantId,
    });
    if (!token) return { ok: false, reason: "not_connected" };
    if (!hasScope(token.scope, DRIVE_READONLY_SCOPE)) return { ok: false, reason: "reauth" };

    const access = await freshAccessToken(ctx, ctx.tenantId);
    // A 7-day Testing-mode refresh token dies on its own schedule, so a refresh that fails weeks
    // later is the RECONNECT flow, not a Drive error. The caller routes both to the same place.
    if (!access.ok)
      return {
        ok: false,
        reason: access.reason === "not_connected" ? "not_connected" : "refresh_failed",
      };

    // 2. Enumerate. Metadata only — nothing is downloaded and nothing has cost anything yet.
    //    A Drive-side failure here is a CODE, never a throw: nothing has been reserved or fetched,
    //    so there is nothing to unwind, and an untyped Server Error would leave the button spinning
    //    with no sentence attached to it (see `logDriveFailure`).
    let enumerated: { files: DriveFile[]; truncated: boolean };
    try {
      enumerated = await enumerateFolder(access.token, driveFolderId);
    } catch (error) {
      console.error(`drive: enumerate failed — ${String(error)}`);
      return { ok: false, reason: "drive_error" };
    }
    const { files, truncated } = enumerated;

    // ⚠ A ZERO-CHILD RESULT ON A FOLDER THE USER EXPLICITLY PICKED IS SUSPICIOUS, NOT A SUCCESS.
    // It is what a missing shared-drive param looks like, and it is what an empty folder looks
    // like, and Drive returns the same 200 for both. Surfacing it beats creating an empty folder
    // and calling it complete.
    if (files.length === 0) return { ok: false, reason: "empty_folder" };

    const { importable, skipped } = classify(files);

    // 3. THE DIFF, against what this tenant already holds from Drive. Computed BEFORE the
    //    reservation so a refresh with nothing new reserves nothing and fetches nothing.
    const diff = await ctx.runMutation(internal.vaultDrive.diffImport, {
      tenantId: ctx.tenantId,
      driveFolderId,
      name,
      files: importable.map((f) => ({
        driveFileId: f.driveFileId,
        modifiedTime: f.modifiedTime,
        mimeType: f.mimeType,
        estBytes: f.estBytes,
      })),
    });

    const work = importable.filter((f) => diff.fetchIds.includes(f.driveFileId));
    if (work.length === 0) {
      return { ok: false, reason: "unchanged", unchanged: diff.unchanged };
    }

    // 4. THE MONEY, BEFORE THE BYTES. `reserveFolderInner`'s internalMutation face re-derives cents
    //    from the manifest — the estimate is never an input the caller chooses.
    const reservation = await ctx.runMutation(internal.guardrails.reserveFolder, {
      tenantId: ctx.tenantId,
      files: work.map((f) => ({ size: f.estBytes, mimeType: f.mimeType })),
    });
    if (!reservation.ok) {
      await ctx.runMutation(internal.vaultDrive.refuseFolder, { folderId: diff.folderId });
      return {
        ok: false,
        reason: "refused",
        estCents: reservation.estCents,
        remainingCents: reservation.remainingCents,
        shortfallCents: reservation.shortfallCents,
      };
    }

    // 5. Open the run and fan out. ONE SCHEDULED ACTION PER FILE, never one action for the folder:
    //    the folder's bytes do not fit an action's heap and its exports do not fit ten minutes.
    await ctx.runMutation(internal.vaultDrive.openRun, {
      folderId: diff.folderId,
      expected: work.length,
      reservedCents: reservation.estCents,
      reservedAt: reservation.reservedAt,
    });
    for (const f of work) {
      await ctx.scheduler.runAfter(0, internal.vaultDrive.exportOne, {
        tenantId: ctx.tenantId,
        folderId: diff.folderId,
        driveFileId: f.driveFileId,
        name: f.name,
        mimeType: f.mimeType,
        exportMime: f.exportMime,
        modifiedTime: f.modifiedTime,
      });
    }

    await ctx.runMutation(internal.audit.log, {
      tenantId: ctx.tenantId,
      correlationId: crypto.randomUUID(),
      eventType: "vault.drive.import",
      actor: "user",
      // REFS AND COUNTS ONLY (§4). No Drive file name, no folder name — a filename is user content
      // and the audit log must never become the place it leaks.
      payload: {
        folderId: diff.folderId,
        fileCount: files.length,
        exportedCount: work.length,
        skippedCount: skipped.length,
        unchangedCount: diff.unchanged,
        removedCount: diff.removed,
        truncated,
      },
    });

    return {
      ok: true,
      folderId: diff.folderId,
      added: diff.added,
      updated: diff.updated,
      unchanged: diff.unchanged,
      removed: diff.removed,
      skipped,
      truncated,
    };
  },
});

// ── The run's bookkeeping ─────────────────────────────────────────────────────

/**
 * Find-or-create the folder, then classify every enumerated file as new / changed / unchanged, and
 * report what vanished from Drive.
 *
 * The lookup is `(tenantId, driveFileId)` on `by_tenant_driveFileId` — an INDEX, not a scan. A
 * 300-file refresh doing 300 table scans is quadratic on the table this phase already had to
 * bound for read-cap reasons.
 *
 * **UNCHANGED IS DECIDED HERE, WHICH IS WHY A NO-OP REFRESH COSTS NOTHING.** A file whose
 * `modifiedTime` has not moved never reaches `fetchIds`, so it is never exported, never re-hashed
 * and never re-inserted — the caller returns before the reservation is even attempted.
 */
export const diffImport = internalMutation({
  args: {
    tenantId: v.string(),
    driveFolderId: v.string(),
    name: v.string(),
    files: v.array(
      v.object({
        driveFileId: v.string(),
        modifiedTime: v.number(),
        mimeType: v.string(),
        estBytes: v.number(),
      }),
    ),
  },
  handler: async (
    ctx,
    { tenantId, driveFolderId, name, files },
  ): Promise<{
    folderId: Id<"vaultFolders">;
    fetchIds: string[];
    added: number;
    updated: number;
    unchanged: number;
    removed: number;
  }> => {
    const existingFolder = (
      await ctx.db
        .query("vaultFolders")
        .withIndex("by_tenant", (q) => q.eq("tenantId", tenantId))
        .collect()
    ).find((f) => f.driveFolderId === driveFolderId);

    const folderId =
      existingFolder?._id ??
      (await ctx.db.insert("vaultFolders", {
        tenantId,
        name: name.slice(0, 200) || "Drive folder",
        source: "drive" as const,
        status: "reserving" as const,
        memberCount: 0,
        terminalCount: 0,
        failedCount: 0,
        reservedCents: 0,
        spentCents: 0,
        driveFolderId,
        createdAt: Date.now(),
      }));

    const fetchIds: string[] = [];
    let added = 0;
    let updated = 0;
    let unchanged = 0;
    const seen = new Set<string>();

    for (const f of files) {
      seen.add(f.driveFileId);
      const row = await ctx.db
        .query("vaultDocuments")
        .withIndex("by_tenant_driveFileId", (q) =>
          q.eq("tenantId", tenantId).eq("driveFileId", f.driveFileId),
        )
        .first();
      if (!row) {
        added++;
        fetchIds.push(f.driveFileId);
      } else if (row.driveModifiedTime !== f.modifiedTime) {
        updated++;
        fetchIds.push(f.driveFileId);
      } else {
        unchanged++;
      }
    }

    // "Removed from Drive" is REPORTED, never acted on. Deleting the user's vault document because
    // a Drive file moved out of one folder is a destructive inference from a read-only rail.
    const removed = (
      await ctx.db
        .query("vaultDocuments")
        .withIndex("by_tenant_folder", (q) => q.eq("tenantId", tenantId).eq("folderId", folderId))
        .take(DRIVE_MAX_FILES)
    ).filter((d) => d.driveFileId !== undefined && !seen.has(d.driveFileId)).length;

    return { folderId, fetchIds, added, updated, unchanged, removed };
  },
});

/**
 * Open a run: reset the per-run counters, record the reservation, and arm the fan-in.
 *
 * The folder stays `reserving` — the ONLY status in which members may be added — until the last
 * file lands. `tryComplete` refuses to fire on anything but `ingesting`, so a fast first file
 * cannot complete a folder whose second file has not landed yet. That structural guard is why the
 * status flip lives in `bumpLanded` and nowhere else.
 *
 * The counters are per-RUN, not lifetime: a refresh re-ingests only what changed, and
 * `terminalCount >= memberCount` has to describe the work currently in flight or the folder either
 * completes early or never completes at all.
 */
export const openRun = internalMutation({
  args: {
    folderId: v.id("vaultFolders"),
    expected: v.number(),
    reservedCents: v.number(),
    reservedAt: v.number(),
  },
  handler: async (ctx, { folderId, expected, reservedCents, reservedAt }): Promise<null> => {
    await ctx.db.patch(folderId, {
      status: "reserving",
      memberCount: 0,
      terminalCount: 0,
      failedCount: 0,
      reservedCents,
      reservedAt,
      spentCents: 0,
      driveExpectedCount: expected,
      driveLandedCount: 0,
    });
    return null;
  },
});

/** A governed refusal: the folder is marked, and NOTHING was downloaded to undo. */
export const refuseFolder = internalMutation({
  args: { folderId: v.id("vaultFolders") },
  handler: async (ctx, { folderId }): Promise<null> => {
    await ctx.db.patch(folderId, { status: "refused" });
    return null;
  },
});

/**
 * THE FAN-IN. Counts one file as landed — inserted, deduped, updated OR failed, all four — and,
 * when the last one lands, flips the folder to `ingesting` and dispatches.
 *
 * Counting failures is not defensive tidiness: a single 404 that did not count would leave the
 * folder in `reserving` forever, holding a reservation nothing settles, with no folder-level
 * watchdog to notice. The tail is `reserveFolder`'s tail verbatim — evaluate completion FIRST
 * (a run whose every file deduped inserted no rows and would otherwise never complete, because
 * nothing will ever call `bumpFolder`), then walk.
 */
async function bumpLanded(ctx: MutationCtx, folderId: Id<"vaultFolders">): Promise<void> {
  const folder = await ctx.db.get(folderId);
  if (folder?.status !== "reserving") return; // cancelled (row gone), or already open
  const landed = (folder.driveLandedCount ?? 0) + 1;
  await ctx.db.patch(folderId, { driveLandedCount: landed });
  if (landed < (folder.driveExpectedCount ?? 0)) return;

  await ctx.db.patch(folderId, { status: "ingesting" });
  if (await tryComplete(ctx, folderId)) return;
  await ctx.scheduler.runAfter(0, internal.vaultFolders.walkFolderMembers, {
    tenantId: folder.tenantId,
    folderId,
    mode: "dispatch" as const,
    cursor: null,
  });
}

// ── Export one file ───────────────────────────────────────────────────────────

/**
 * Fetch ONE file's bytes and land them. Scheduled per file, never per folder: the ten-minute action
 * limit and the ~512 MB heap are both per-action, and a folder is neither.
 *
 * A failure here is TERMINAL FOR THIS FILE AND HARMLESS TO THE FOLDER — it lands as a coded skip so
 * the fan-in still completes. An export that threw would exhaust the action's retries and strand
 * every sibling behind a folder that never leaves `reserving`.
 */
export const exportOne = internalAction({
  args: {
    tenantId: v.string(),
    folderId: v.id("vaultFolders"),
    driveFileId: v.string(),
    name: v.string(),
    mimeType: v.string(),
    exportMime: v.optional(v.string()),
    modifiedTime: v.number(),
  },
  handler: async (ctx, a): Promise<null> => {
    const access = await freshAccessToken(ctx, a.tenantId);
    if (!access.ok) {
      await ctx.runMutation(internal.vaultDrive.landFailure, {
        tenantId: a.tenantId,
        folderId: a.folderId,
        code: "export_failed" as const,
      });
      return null;
    }

    const url = a.exportMime
      ? driveUrl(`/${a.driveFileId}/export`, { mimeType: a.exportMime })
      : driveUrl(`/${a.driveFileId}`, { alt: "media" });

    const res = await driveFetch(url, access.token);
    if (!res.ok) {
      // Drive's own 10 MB export ceiling gets its own code — "too big for Drive to export" is a
      // different sentence from "the import broke", and the manifest should say which.
      const code: DriveSkipCode =
        a.exportMime && (res.status === 403 || res.status === 413)
          ? "export_too_large"
          : "export_failed";
      await ctx.runMutation(internal.vaultDrive.landFailure, {
        tenantId: a.tenantId,
        folderId: a.folderId,
        code,
      });
      return null;
    }

    const bytes = new Uint8Array(await res.arrayBuffer());
    if (a.exportMime && bytes.byteLength > DRIVE_EXPORT_CAP_BYTES) {
      await ctx.runMutation(internal.vaultDrive.landFailure, {
        tenantId: a.tenantId,
        folderId: a.folderId,
        code: "export_too_large" as const,
      });
      return null;
    }

    const storageId = await ctx.storage.store(new Blob([bytes], { type: a.mimeType }));
    // A text export is text: carrying it inline is what lets the row ride the ingest workflow
    // directly instead of waiting on an extraction that has nothing to do.
    const text = isSearchable(a.mimeType) ? new TextDecoder().decode(bytes) : undefined;

    await ctx.runMutation(internal.vaultDrive.landFile, {
      tenantId: a.tenantId,
      folderId: a.folderId,
      driveFileId: a.driveFileId,
      driveModifiedTime: a.modifiedTime,
      title: a.name,
      mimeType: a.mimeType,
      size: bytes.byteLength,
      contentHash: await contentHash(bytes),
      storageId,
      text,
    });
    return null;
  },
});

/**
 * Land one exported file as an ordinary vault document, and count it.
 *
 * An `internalMutation` with an EXPLICIT `tenantId` because its caller is a scheduled action with
 * no identity — `vault.vaultUpload` is a `tenantMutation` and is therefore physically unreachable
 * from here (the `research.persistFindings` / `onboarding` shape).
 *
 * ⚠ THE DUP EARLY-RETURN TRAP. `vault.vaultUpload`'s dedup branch returns `{vaultDocId}` and does
 * nothing else, which is correct there and WRONG here. Copied verbatim, a file whose bytes this
 * tenant already holds would get no `driveFileId` and no `folderId` — invisible to the folder,
 * invisible to the next refresh's diff (so it would re-export forever), and the folder would report
 * N files while owning fewer.
 *
 * So the dup branch ATTACHES IDENTITY WITHOUT ATTACHING MEMBERSHIP: it patches `driveFileId` /
 * `driveModifiedTime` so the re-import key works, and it deliberately does NOT set `folderId`.
 * Annexing a pre-existing document into an `ingesting` folder would SEAL a document the user could
 * ground on yesterday — retroactively removing access they already had (CONTEXT §B7). Same rule as
 * the upload rail, reached by a different route.
 */
export const landFile = internalMutation({
  args: {
    tenantId: v.string(),
    folderId: v.id("vaultFolders"),
    driveFileId: v.string(),
    driveModifiedTime: v.number(),
    title: v.string(),
    mimeType: v.string(),
    size: v.number(),
    contentHash: v.string(),
    storageId: v.id("_storage"),
    text: v.optional(v.string()),
  },
  handler: async (ctx, a): Promise<null> => {
    const folder = await ctx.db.get(a.folderId);
    if (!folder) return null; // cancelled mid-flight — the lenient join, same as every folder read

    // (1) The re-import primary key. A row we already own for this Drive file is UPDATED IN PLACE,
    //     so the member set and `digestSourceDocIds` stay stable across refreshes — a new row would
    //     orphan the digest's source list and duplicate the document in the grid.
    const byDriveId = await ctx.db
      .query("vaultDocuments")
      .withIndex("by_tenant_driveFileId", (q) =>
        q.eq("tenantId", a.tenantId).eq("driveFileId", a.driveFileId),
      )
      .first();

    if (byDriveId) {
      if (byDriveId.contentHash !== a.contentHash) {
        await ctx.db.patch(byDriveId._id, {
          driveModifiedTime: a.driveModifiedTime,
          contentHash: a.contentHash,
          size: a.size,
          storageId: a.storageId,
          text: a.text,
          folderId: a.folderId,
          status: "pending_extraction" as const,
          failureReason: undefined,
        });
        await ctx.db.patch(a.folderId, { memberCount: folder.memberCount + 1 });
      } else {
        // `modifiedTime` moved but the bytes did not (a Drive touch, or an OOXML re-export). Record
        // the new stamp so the NEXT refresh sees it as unchanged, and do not re-ingest.
        await ctx.db.patch(byDriveId._id, { driveModifiedTime: a.driveModifiedTime });
      }
      await bumpLanded(ctx, a.folderId);
      return null;
    }

    // (2) Content dedup — the trap above. Identity yes, membership no, sealing never.
    const dup = await ctx.db
      .query("vaultDocuments")
      .withIndex("by_tenant_contentHash", (q) =>
        q.eq("tenantId", a.tenantId).eq("contentHash", a.contentHash),
      )
      .first();
    if (dup) {
      await ctx.db.patch(dup._id, {
        driveFileId: a.driveFileId,
        driveModifiedTime: a.driveModifiedTime,
      });
      await bumpLanded(ctx, a.folderId);
      return null;
    }

    // (3) A new member. `pending_extraction` and NO dispatch: the folder's own walk starts every
    //     member once the run opens, which is what keeps "reserve before the first cent" true.
    await ctx.db.insert("vaultDocuments", {
      tenantId: a.tenantId,
      title: a.title,
      kind: "upload",
      category: categoryFor({ source: "google", mimeType: a.mimeType }),
      source: "google",
      mimeType: a.mimeType,
      size: a.size,
      contentHash: a.contentHash,
      storageId: a.storageId,
      text: a.text,
      status: "pending_extraction" as const,
      folderId: a.folderId,
      driveFileId: a.driveFileId,
      driveModifiedTime: a.driveModifiedTime,
      createdAt: Date.now(),
    });
    await ctx.db.patch(a.folderId, { memberCount: folder.memberCount + 1 });
    await bumpLanded(ctx, a.folderId);
    return null;
  },
});

/**
 * A file that could not be exported. Counts toward the fan-in and creates NO row — an unreadable
 * file is recorded, never parked as a document that will never have text.
 *
 * The code is written to `audit` rather than dropped. The pre-flight skips are returned to the
 * caller synchronously, but an export failure happens long after that action returned, so audit is
 * the only channel that still exists. Refs and counts only: the CODE, never the file's name.
 *
 * ponytail: audit, not a folder-level failure list. `failedCount` is deliberately NOT bumped —
 * it counts failed MEMBERS, and a file that never became a row is not a member; bumping it would
 * break `memberCount = read + unread`. Ceiling, stated: these codes are visible to an operator
 * reading the audit log, not to the user in the folder card. Upgrade path when the UI needs them:
 * an optional `driveSkips: v.array(...)` on the folder row, appended here.
 */
export const landFailure = internalMutation({
  args: { tenantId: v.string(), folderId: v.id("vaultFolders"), code: v.string() },
  handler: async (ctx, { tenantId, folderId, code }): Promise<null> => {
    await ctx.runMutation(internal.audit.log, {
      tenantId,
      correlationId: crypto.randomUUID(),
      eventType: "vault.drive.unreadable",
      actor: "system",
      payload: { folderId, code },
    });
    await bumpLanded(ctx, folderId);
    return null;
  },
});
