// The vault UI source scan (15.3-02) — the FIRST test that has ever read this surface.
//
// Grep `dashboard/vault` across every `*.test.ts` before this file: zero hits. That absence is
// exactly how the per-file size cap came to be re-typed as a literal in five places, so that
// raising the server cap produced a client which silently rejected files the backend would accept.
//
// It lives in `@pikar/core` for the same reason the profile scan does: the backend vitest
// environment is `edge-runtime` and has no `node:fs`, so a convex-side version could not read the
// pages at all (`businessProfile.test.ts:548-550`).
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

/**
 * The scanned unit is the SURFACE — every `.tsx` in the route folder — not one named file. Plans
 * 15.3-06 onward split a FolderCard and a pre-flight panel out of this folder; naming files here
 * would turn the scan red on that refactor without anything about the GUARANTEE changing.
 * (`surfaceOf` in `businessProfile.test.ts:569-576`.)
 */
const surfaceOf = (route: string) => {
  const dir = new URL(`../../../apps/web/app/(app)/dashboard/${route}/`, import.meta.url);
  return readdirSync(dir)
    .filter((f) => f.endsWith(".tsx"))
    .sort()
    .map((f) => readFileSync(new URL(f, dir), "utf8"))
    .join("\n");
};

const src = surfaceOf("vault");

describe("the vault surface", () => {
  /**
   * NON-VACUITY FIRST, and it is the most important block in this file. Every guard below is a
   * `not.toContain`, and a `not.toContain` over an empty or wrong string passes forever.
   * `readdirSync` throws on a missing folder; these anchors catch the subtler case of scanning a
   * folder that no longer holds what we think it does. If one of them stops matching, FIX IT FIRST
   * — every other assertion here has been green over the wrong text since it broke.
   */
  test("the route folder is really being scanned (non-vacuity)", () => {
    expect(src.length).toBeGreaterThan(500);
    expect(src).toContain('"use client"');
    expect(src).toContain("api.vault.listVaultDocs"); // page.tsx
    expect(src).toContain("api.vault.vaultSearch"); // DocGrid.tsx
    expect(src).toContain("export function DocGrid"); // DocGrid.tsx
  });

  // ── The cap is declared ONCE (VALT-14) ────────────────────────────────────────────────────
  //
  // `@pikar/vault/constants` is the SUBPATH on purpose: the barrel pulls xlsx (~1 MB) and fflate
  // into the client bundle. Reverting either half — the import, or any of the literals — is the
  // mutation this file exists to catch.
  test("the size caps are imported, never re-declared", () => {
    expect(src).toContain("@pikar/vault/constants");
    expect(src).toContain("VAULT_FILE_CAP_BYTES");
    expect(src).toContain("VAULT_VIDEO_CAP_BYTES");
  });

  test("no cap literal survives anywhere on the surface", () => {
    expect(src).not.toMatch(/100\s*\*\s*1024\s*\*\s*1024/); // the old file cap
    expect(src).not.toContain("25 * 1000 * 1000"); // the video cap
    expect(src).not.toContain("200 * 1000 * 1000"); // and the NEW file cap, re-typed
  });

  test("no cap is spelled out in copy either — the copy is derived from the constant", () => {
    expect(src).not.toContain("max 100 MB");
    expect(src).not.toContain("Up to 100 MB");
    // The raise is worthless if a string still promises the old number to the user.
    expect(src).not.toMatch(/100 MB/);
  });

  // ── The read plane stays projected (15.3-02) ──────────────────────────────────────────────
  //
  // `listVaultDocs` returns a projection with NO `text`, because returning every row's blob to the
  // browser is what walked the vault page into the 16 MiB per-transaction read cap. A component
  // reaching for `doc.text` again is the reintroduction of that defect: one document's text comes
  // from `vault.vaultDocText`, on demand, one document at a time.
  test("no grid row is read for its text blob", () => {
    expect(src).not.toContain("doc.text");
    expect(src).toContain("api.vault.vaultDocText");
  });

  // ── The status gate is subscription-driven (DocGrid.tsx:349-353) ──────────────────────────
  //
  // Convex queries are live: when extraction finishes and `status` flips, the cards re-render on
  // their own. A poll added to "make it update" would re-read the (now bounded) partition on a
  // timer for nothing — the same read amplification, just on a schedule.
  test("nothing polls the vault", () => {
    expect(src).not.toContain("setInterval");
    expect(src).not.toContain("setTimeout(");
  });
});
