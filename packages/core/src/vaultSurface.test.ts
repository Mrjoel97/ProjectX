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

/**
 * TWO FILES `surfaceOf` CANNOT SEE, read on purpose.
 *
 * `preflightCopy.ts` is a `.ts`, and the filter above takes `.tsx` only — asserting "the refusal
 * sentence lives here" against `src` would be vacuously green forever. `vaultFolders.ts` is the
 * backend half of the same guarantee: the codes live there, the prose must not.
 */
const preflightCopySrc = readFileSync(
  new URL("../../../apps/web/app/(app)/dashboard/vault/preflightCopy.ts", import.meta.url),
  "utf8",
);
const vaultFoldersSrc = readFileSync(
  new URL("../../../packages/backend/convex/vaultFolders.ts", import.meta.url),
  "utf8",
);

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
    // 15.3-07 added three components and a backend query; each block below slices on one of these.
    expect(src).toContain("export function PreFlight"); // PreFlight.tsx
    expect(src).toContain("export function FolderBreadcrumb"); // FolderBreadcrumb.tsx
    expect(src).toContain("api.vaultFolders.folderEstimate"); // PreFlight.tsx
    expect(src).toContain('aria-disabled="true"'); // DocGrid.tsx — the real disabled pattern
    // 15.3-08 added the display-name rule and the identity editor.
    expect(src).toContain("export const docLabel"); // DocGrid.tsx
    expect(src).toContain("Document identity"); // PreviewModal.tsx
    // …and the two files the `.tsx` filter cannot see.
    expect(preflightCopySrc).toContain("export function refusalCopy");
    expect(vaultFoldersSrc).toContain("export const folderEstimate");
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

  // ── Document identity is a DISPLAY name, never the file (15.3-08, VALT-12) ────────────────
  //
  // The whole surface now shows `identityLine` where it used to show `title`, which makes a
  // find-and-replace of `doc.title` → `docLabel(doc)` a two-character mutation that silently
  // renames every downloaded file to its identity line and rewrites every image's alt text. That
  // is a shipped guarantee, so it is asserted here.
  //
  // The anchor variable was renamed `a` → `anchor` by the 15.4 preview rework, which is exactly
  // why the assertion binds to the ASSIGNMENT TARGET and the assigned value rather than the whole
  // statement — the guarantee is "the download name is `doc.title`", not "the local is called a".
  test("the download and the alt text still carry the real filename", () => {
    expect(src).toMatch(/\.download\s*=\s*doc\.title/);
    expect(src).toContain("alt={doc.title}");
  });

  test("the display name falls back to the filename, and the user-set promise is visible", () => {
    // ONE rule, exported, so the card / heading / aria-labels cannot disagree. Losing the `||`
    // leaves every unclassified row with a blank primary line.
    expect(src).toContain("d.identityLine || d.title");
    // The never-overwritten promise, made visible to the person it was made to. Deleting it is
    // otherwise completely silent.
    expect(src).toContain("identityUserSet === true");
    // The identity-line cap lives at the write boundary (`vault.ts`). Re-typing it here is the
    // same single-source defect the size-cap block above exists to punish.
    expect(src).not.toMatch(/maxLength=\{120\}/);
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

  // ── The pre-flight names every number BEFORE it offers Start (15.3-07, VALT-06) ───────────
  //
  // A Start button with no figure beside it is the defect this panel exists to prevent: the user
  // commits a multi-gigabyte folder and a chunk of today's ingest budget without being told either
  // the size or the price. The five elements are asserted by their SOURCE text — the captions are
  // written uppercase in `PreFlight.tsx` on purpose, so a `textTransform` rule cannot defeat this.
  test("the pre-flight names all five numbers and only then offers Start", () => {
    const start = src.indexOf("export function PreFlight");
    expect(
      start,
      "export function PreFlight not found — the scan below would be vacuous",
    ).toBeGreaterThan(-1);
    const block = src.slice(start, src.indexOf("</section>", start));
    expect(block.length).toBeGreaterThan(1000);

    expect(block).toContain("N FILES");
    expect(block).toContain("TOTAL SIZE");
    expect(block).toContain("EST. COST");
    expect(block).toContain("READY IN");
    // The skipped files are NAMED, not silently dropped from the count.
    expect(block).toContain("skipCopy(");
    // A BARE Start control. `\s*` spans the JSX line break around the label, and the trailing
    // `\s*<` is what stops "Start over" (the post-refusal button) satisfying this on its own.
    expect(block).toMatch(/>\s*Start\s*</);
  });

  // ── The refusal sentence has exactly ONE writer (CLAUDE.md §4) ───────────────────────────
  //
  // A refusal reason is a refs-only code that lives in `convex/` and is never shown to a user; the
  // wording belongs in the surface that renders it (`failureCopy.ts:17-18` forbids moving copy
  // backend-side, and a sentence in an audit-adjacent module is prose behind the §4 boundary).
  // Two writers is the failure mode: one gets edited, the other keeps promising the old number.
  test("the refusal sentence is written in preflightCopy.ts and nowhere else", () => {
    expect(preflightCopySrc).toContain("This folder needs about");
    expect(preflightCopySrc).toContain("left today");

    // Not a second copy on the rendering surface…
    expect(src).not.toContain("This folder needs about");
    // …and not behind the refs-only boundary either.
    expect(vaultFoldersSrc).not.toContain("This folder needs about");
    expect(vaultFoldersSrc).not.toContain("left today");
  });

  // ── A sealed folder exposes no usable action (VALT-11) ───────────────────────────────────
  //
  // A folder still being read has nothing to ground a conversation on, and a control that LOOKS
  // actionable but is not is worse than no control: a `<Link>` with `pointer-events:none` is
  // invisible to a screen reader, which reads out an actionable link that does nothing.
  test("the folder card branch exposes no link and no enabled Discuss", () => {
    const start = src.indexOf("folders?.map((f) => {");
    expect(
      start,
      "folders?.map((f) => { not found — the scan below would be vacuous",
    ).toBeGreaterThan(-1);
    const block = src.slice(start, src.indexOf("rows.map((doc)", start));
    expect(block.length).toBeGreaterThan(500);

    expect(block).not.toContain("href");
    expect(block).not.toContain("<Link");
    expect(block).not.toContain("pointerEvents");
    // The wait control is a REAL disabled button.
    expect(block).toContain('aria-disabled="true"');
  });

  // ── The stale digest reuses the 17.1 idiom (BlueprintPanel.tsx:188) ──────────────────────
  //
  // Staleness is DERIVED from an unincorporated count, never a stored flag, and the affordance is
  // the SAME button flipping secondary→primary — one label, one handler, only the emphasis moves.
  // The alternative the plan bans by name is `ReconnectBanner`: a dismissible localStorage notice
  // would let a user permanently hide a digest that is genuinely out of date, on one browser.
  //
  // 15.4 SPLIT THIS ACROSS TWO FILES: `FolderBreadcrumb` derives `stale` and mounts exactly one
  // `DigestRebuildControl`, and the control (in `VaultBrowseControls.tsx`) owns the class flip.
  // The RENDERED flip therefore moved to `apps/web/.../VaultBrowseControls.test.ts`, which renders
  // the markup — the same migration `preflightCopy.test.ts` made once `apps/web` had a runner.
  // What only a whole-surface scan can prove stays here: derivation, single control, no banner.
  test("the stale digest flips emphasis on one control rather than adding a second", () => {
    const start = src.indexOf("export function FolderBreadcrumb");
    expect(
      start,
      "export function FolderBreadcrumb not found — the scan below would be vacuous",
    ).toBeGreaterThan(-1);
    // Every file in the surface opens with the client directive, so the next one marks the end.
    const block = src.slice(start, src.indexOf('"use client"', start));
    expect(block.length).toBeGreaterThan(500);

    // DERIVED from the reducer over the unincorporated count, never read off a stored flag.
    expect(block).toContain('viewState.digest.kind === "stale"');
    expect(block).toMatch(/<DigestRebuildControl[\s\S]{0,400}stale=\{stale\}/);

    // ONE control on the whole surface: one definition, one mount, one label.
    expect(src.match(/export function DigestRebuildControl/g)?.length).toBe(1);
    expect(src.match(/<DigestRebuildControl/g)?.length).toBe(1);
    expect(src.match(/Rebuild digest/g)?.length).toBe(1);

    // No dismissible banner. Comments are stripped first because the surface DOCUMENTS this ban
    // in prose — a raw scan would punish its own explanation (importGuard.test.ts:54 hit exactly
    // this trap and strips comments for the same reason).
    expect(src.replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, "")).not.toContain("localStorage");
  });

  // The BEHAVIOURAL half of "the refusal names both numbers" moved OUT of this file on 2026-08-04,
  // to `apps/web/app/(app)/dashboard/vault/preflightCopy.test.ts`, once `apps/web` finally had a
  // runner (see `apps/web/vitest.config.mts`). It lived here only because a test file over there
  // executed nowhere. What stays is the SINGLE-WRITER scan above — a source check this file is the
  // right home for, and one that deliberately cannot prove the sentence names both figures.

  // ── must_have: "Refresh does not kick the user out of a folder or discard a picked selection" ──
  //
  // THE HEADLINE GUARANTEE OF THIS PLAN, AND IT HAD NO RUNNABLE CHECK. `page.tsx` remounts
  // <VaultBody> via `key={nonce}` on Refresh, which DESTROYS every `useState` that component owns.
  // Moving the drill-in scope or the picked directory down into <VaultBody> — the exact pre-15.3-07
  // shape — teleports the user out of the folder and throws away a 1.5 GB pick, and it typechecks
  // clean. This slices the file at the component boundary and asserts which side each atom is on.
  test("state that must survive Refresh is owned ABOVE the remount key", () => {
    const pageSrc = readFileSync(
      new URL("../../../apps/web/app/(app)/dashboard/vault/page.tsx", import.meta.url),
      "utf8",
    );
    const boundary = pageSrc.indexOf("function VaultBody");
    expect(boundary).toBeGreaterThan(-1); // non-vacuity: the component still has that name
    const page = pageSrc.slice(0, boundary);
    const body = pageSrc.slice(boundary);

    // The remount key is what makes all of this load-bearing; if it goes, re-read this test.
    expect(page).toContain("key={nonce}");

    // The canonical declaration, as a plain substring — `const [picked, setPicked] = useState`.
    // No regex: the setter PRECEDES `useState` here, and every escaping variant of that is harder
    // to read than the thing it matches. Biome formats this file, so the spacing is stable; if it
    // ever changes, the positive assertion below goes RED loudly rather than passing silently.
    const declOf = (atom: string) =>
      `[${atom}, set${atom.charAt(0).toUpperCase()}${atom.slice(1)}] = useState`;

    for (const atom of ["currentFolderId", "picked", "phase"]) {
      expect(page).toContain(declOf(atom));
      expect(body).not.toContain(declOf(atom));
    }
    // `selected` (the preview modal) is deliberately BELOW — a remount SHOULD close it. That
    // asymmetry is what makes the assertions above a real boundary rather than "no state below".
    expect(body).toContain(declOf("selected"));
  });

  // ── Amber is the approval gate's alone (BRAND §2) ────────────────────────────────────────
  //
  // This matches USES, not the token NAME: `DocGrid.tsx:129` names `--held` in prose to explain why
  // it is NOT used, and that comment is the documentation, not the violation. Nor can it ban
  // amber-LOOKING hexes — `#fef3c7`/`#92400e` already ship as the `processing` chip and are
  // sanctioned (`DocGrid.tsx:20-23`). `#f59e0b` is `ReconnectBanner`'s hand-rolled amber, so
  // banning that one literal is the runnable form of "do not copy that banner onto this surface".
  test("no amber is spent on the vault surface", () => {
    expect(src).not.toContain("var(--held");
    expect(src).not.toMatch(/#f0a22e/i);
    expect(src).not.toMatch(/#8f5406/i);
    expect(src).not.toMatch(/#f59e0b/i);
  });
});
