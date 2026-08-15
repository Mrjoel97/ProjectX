import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

const read = (relative: string) =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");

describe("tenant data control reachability", () => {
  test("mounts the downloader on a routed settings page linked from the rail", () => {
    expect(read("./page.tsx")).toMatch(/<DataControls\s*\/>/);
    expect(read("../../layout.tsx")).toContain('href="/dashboard/settings"');
    expect(read("../../layout.tsx")).toContain("Settings</span>");
  });

  test("downloads the complete continuation sequence as structured JSON", () => {
    const source = read("./DataControls.tsx");

    expect(source).toContain('"tenantExport:exportTenantData"');
    expect(source).toContain("while (cursor)");
    expect(source).toContain('type: "application/json"');
    expect(source).toContain("Download my data");
  });
});
