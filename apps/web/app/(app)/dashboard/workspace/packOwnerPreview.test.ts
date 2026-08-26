// 27-11: the owner's candidate preview, and the one hand-copied literal in the browser evidence
// plane.
//
// SOURCE-TEXT SCAN, the `pinnedPrompts.test.ts` idiom — `apps/web`'s vitest config is node-only with
// no jsdom, so a `.tsx` cannot be rendered here. What this proves is that the shipped source
// contains and does not contain exact things; it does not prove pixels or that anything renders.
//
// WHY IT EXISTS. `workflow-pack-pilot.spec.ts` maps a rendered card TITLE back to a pack id so it
// can write browser evidence against the right registry row. That map cannot import `@pikar/core`
// (the spec drives a BUILT app), so it is hand-copied — and it was already wrong once: it said
// "Process / SOP builder" where the registry says "Process / SOP". A wrong entry means evidence is
// written for the wrong pack or not at all, which is exactly the class of defect the pack gate
// exists to prevent. This test is the check that the copy still matches the original.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { WORKFLOW_PACK_IDS, WORKFLOW_PACKS } from "@pikar/core";
import { describe, expect, test } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const spec = readFileSync(join(here, "../../../../e2e/workflow-pack-pilot.spec.ts"), "utf8");
// Comments stripped for the SURFACE scans below, the `pinnedPrompts.test.ts` rule: every one is
// about the shipped surface, not about prose. Without it the component's own note explaining why it
// is NOT the "Guided workflows" region fails the check that it is not that region, and the only way
// to green would be deleting the explanation — which is how a guard gets silently weakened.
const strip = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const previewSource = readFileSync(join(here, "WorkflowPackOwnerPreview.tsx"), "utf8");
const preview = strip(previewSource);
const page = strip(readFileSync(join(here, "page.tsx"), "utf8"));

describe("the browser evidence plane's title map matches the registry", () => {
  test("the scan read a real spec file", () => {
    expect(spec.length).toBeGreaterThan(6_000);
    expect(spec).toContain("const TITLE_TO_PACK");
  });

  test("every pack's code-owned title maps to its own id", () => {
    const map = spec.slice(
      spec.indexOf("const TITLE_TO_PACK"),
      spec.indexOf("};", spec.indexOf("const TITLE_TO_PACK")),
    );
    expect(map.length).toBeGreaterThan(100);
    for (const packId of WORKFLOW_PACK_IDS) {
      const { title } = WORKFLOW_PACKS[packId];
      expect(map, `the spec's title map is missing or misspells "${title}"`).toContain(
        `"${title}": "${packId}"`,
      );
    }
  });

  test("the map has no entry for a title no pack has", () => {
    const titles = new Set(WORKFLOW_PACK_IDS.map((id) => WORKFLOW_PACKS[id].title));
    const entries = [...spec.matchAll(/"([^"]+)": "([a-z-]+)",/g)]
      .filter(([, , id]) => (WORKFLOW_PACK_IDS as readonly string[]).includes(id ?? ""))
      .map(([, title]) => title ?? "");
    expect(entries.length).toBe(WORKFLOW_PACK_IDS.length);
    for (const title of entries) expect(titles.has(title)).toBe(true);
  });
});

describe("the preview surface stays a preview", () => {
  // A DIFFERENT region from the quick starts. The `@dark` assertions prove the pilot is invisible by
  // requiring "Guided workflows" to be empty; a preview rendering into that region would make them
  // pass for a reason they do not mean.
  test("stripping kept code and removed prose", () => {
    expect(previewSource).toContain("THE DEADLOCK");
    expect(preview).not.toContain("THE DEADLOCK");
    expect(preview).toContain("export function WorkflowPackOwnerPreview");
  });

  test("it renders its own region, not the quick-starts one", () => {
    expect(preview).toContain('aria-labelledby="pack-candidates-label"');
    expect(preview).not.toContain("Guided workflows");
    expect(spec).toContain('name: "Candidate workflows — owner preview"');
  });

  test("it says plainly that nothing here is live", () => {
    expect(preview).toContain("Not live");
    // BRAND §6: the state is carried by the WORD, and §2 reserves amber for the approval gate.
    expect(preview).not.toContain("--held");
  });

  // No marketplace, no install state, no activation control — a pack's capability is code-owned and
  // activation flows through the registry's three-plane gate, never a button here.
  test("no install, enable, activate or tool-grant control", () => {
    for (const forbidden of ["Install", "Marketplace", "Enable", "Activate", "Grant"]) {
      expect(preview).not.toContain(forbidden);
    }
  });

  test("the preview button is labelled per pack, not six identical Starts", () => {
    expect(preview).toContain("aria-label={`Preview ${pack.title}`}");
  });
});

describe("only the owner path can pin a candidate", () => {
  test("the page skips the owner-only query for everyone else", () => {
    expect(page).toContain('viewer?.isOwner === true ? {} : "skip"');
  });

  test("the preview sends the version the card rendered", () => {
    expect(page).toContain("previewVersion: pack.version");
  });
});
