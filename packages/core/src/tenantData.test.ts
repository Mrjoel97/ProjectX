import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { TENANT_TABLE_CLASSIFICATION } from "./tenantData";

const schemaSource = readFileSync(
  new URL("../../backend/convex/schema.ts", import.meta.url),
  "utf8",
);

const schemaTables = [...schemaSource.matchAll(/^  ([A-Za-z][A-Za-z0-9]*): defineTable\(/gm)].map(
  ([, name]) => name,
);

describe("tenant table classification registry", () => {
  test("classifies every explicit schema table exactly once, in both directions", () => {
    const classifiedTables = Object.keys(TENANT_TABLE_CLASSIFICATION);

    expect(schemaTables).toHaveLength(43);
    expect(new Set(schemaTables).size).toBe(schemaTables.length);
    expect(classifiedTables.sort()).toEqual([...schemaTables].sort());
  });

  test("makes credential tables an explicit closed set", () => {
    const credentialTables = Object.entries(TENANT_TABLE_CLASSIFICATION)
      .filter(([, category]) => category === "tenant_credential")
      .map(([table]) => table)
      .sort();

    expect(credentialTables).toEqual(["gmailTokens", "microsoftCalendarTokens"]);
  });
});
