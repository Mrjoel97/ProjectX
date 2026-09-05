import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

const read = (relative: string) =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");

describe("tenant data control reachability", () => {
  test("mounts the downloader on a routed settings page linked from the rail", () => {
    expect(read("./page.tsx")).toMatch(/<DataControls\s*\/>/);
    expect(read("../../layout.tsx")).toContain('href="/dashboard/profile?tab=settings"');
    expect(read("../../layout.tsx")).toContain("Settings</span>");
  });

  test("downloads the complete continuation sequence as structured JSON", () => {
    const source = read("./DataControls.tsx");

    expect(source).toContain('"tenantExport:exportTenantData"');
    expect(source).toContain("while (cursor)");
    expect(source).toContain('type: "application/json"');
    expect(source).toContain("Download my data");
  });

  // 22.1-05 Task 3. Erasure is irreversible, so the surface — not just the server — must refuse a
  // single click. The server already takes `v.literal("DELETE MY DATA")`; these pin that the UI arms
  // on the SAME exact phrase, and that the card repeats the privacy policy's own erasure/audit
  // resolution rather than inventing a softer promise.
  // ponytail: source guards, matching this file's existing idiom. Ceiling — they prove wiring, not
  // rendered behaviour. Upgrade path: server-render with instrumented hooks the way
  // `apps/web/app/(app)/ops/opsPresentation.test.ts` does, if this surface ever grows branches.
  test("arms erasure only on the exact typed phrase and states what survives it", () => {
    const source = read("./DataControls.tsx");

    expect(source).toContain('"tenantDelete:deleteTenantData"');
    expect(source).toContain('const DELETE_PHRASE = "DELETE MY DATA"');
    expect(source).toContain("const armed = phrase === DELETE_PHRASE");
    expect(source).toContain("disabled={!armed");
    expect(source).toContain("Delete my data");
  });

  test("states what erasure removes and what the audit archive retains", () => {
    const source = read("./DataControls.tsx");

    expect(source).toContain("references, identifiers, hashes, and counts");
    expect(source).toContain("cannot be undone");
    expect(source).toMatch(/revok|disconnect/i);
  });

  // GOVN-03 is "the policy is the specification, not the marketing". The Microsoft grant is the one
  // place the product CANNOT deliver what a reader might assume from the Google paragraph, so both
  // the card and the published policy must name the gap AND hand over the real control. Without the
  // links this is an honest dead end; with them it is an exercisable right.
  test("hands the user Microsoft's own consent control instead of implying parity with Google", () => {
    const card = read("./DataControls.tsx");
    const policy = read("../../../privacy/page.tsx");

    for (const source of [card, policy]) {
      expect(source).toContain("account.microsoft.com/privacy/app-access");
      expect(source).toContain("myapps.microsoft.com");
    }

    // the policy must say plainly that we do NOT revoke at Microsoft — never a bare "you can
    // disconnect" that reads as Google-equivalent
    expect(policy).toMatch(/cannot revoke the grant at Microsoft/i);
    // and it must not have quietly dropped the Google route it already promised
    expect(policy).toContain("myaccount.google.com/permissions");
  });
});
