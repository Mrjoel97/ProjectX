import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { deletableTables, TENANT_TABLE_CLASSIFICATION } from "./tenantData";

const schemaSource = readFileSync(
  new URL("../../backend/convex/schema.ts", import.meta.url),
  "utf8",
);

const schemaTables = [...schemaSource.matchAll(/^ {2}([A-Za-z][A-Za-z0-9]*): defineTable\(/gm)].map(
  ([, name]) => name,
);

describe("tenant table classification registry", () => {
  test("classifies every explicit schema table exactly once, in both directions", () => {
    const classifiedTables = Object.keys(TENANT_TABLE_CLASSIFICATION);

    // 43 + the two BETA-01 admission tables (25-01) + workflowPackEvents (27-02, PACK-02)
    // + the four Phase-28 connector tables (28-03) + billingStripeEvents (28.1-01).
    // This count is a TRIPWIRE, not bookkeeping: a new table cannot reach the export/deletion
    // walks without someone deliberately bumping it and classifying the table on the way past.
    //
    // 28.1-01 FOUND THIS TEST RED AT HEAD AND FIXED IT: 28-03 added four tables and classified
    // them, but never bumped this number or the closed set below, so the tripwire had been
    // failing on its own arithmetic ever since — and a genuinely UNCLASSIFIED table would have
    // looked exactly the same. A tripwire nobody can distinguish from noise is not a tripwire.
    expect(schemaTables).toHaveLength(51);
    expect(new Set(schemaTables).size).toBe(schemaTables.length);
    expect(classifiedTables.sort()).toEqual([...schemaTables].sort());
  });

  test("makes credential tables an explicit closed set", () => {
    const credentialTables = Object.entries(TENANT_TABLE_CLASSIFICATION)
      .filter(([, category]) => category === "tenant_credential")
      .map(([table]) => table)
      .sort();

    expect(credentialTables).toEqual([
      // 28-03: the tenant's connector grant (AES-256-GCM ciphertext) and its in-flight OAuth state.
      "connectorConnections",
      "connectorOAuthStates",
      "gmailTokens",
      "microsoftCalendarTokens",
    ]);
  });

  // OWNER DECISION 2026-08-23 (27-02). Asserted POSITIVELY and by name, because the derived
  // equality in the next test reads the classification itself and would stay green if the category
  // silently flipped back. The property being pinned is a product one: one tenant's erasure must
  // not be able to rewrite the denominator of every pack measure.
  test("workflow-pack events sit on the audit plane — erasure and export cannot reach them", () => {
    expect(TENANT_TABLE_CLASSIFICATION.workflowPackEvents).toBe("audit_immutable");
    expect(deletableTables()).not.toContain("workflowPackEvents");
  });

  test("exposes only tenant-owned and credential tables to deletion, with identity last", () => {
    const tables = deletableTables();

    expect(tables).not.toContain("audit");
    expect(tables).not.toContain("deadLetters");
    expect(tables).not.toContain("skills");
    expect(tables).not.toContain("exportCursors");
    // Admission rows are email-keyed and precede every tenant, so neither deletion scope can
    // address them. Excluded by construction, not by an `if` — same posture as `audit`.
    expect(tables).not.toContain("betaWaitlist");
    expect(tables).not.toContain("betaInvites");
    expect(tables.at(-1)).toBe("users");
    expect(tables).toEqual([
      ...Object.entries(TENANT_TABLE_CLASSIFICATION)
        .filter(([, category]) => category === "tenant_owned" || category === "tenant_credential")
        .map(([table]) => table)
        .filter((table) => table !== "users"),
      "users",
    ]);
  });
});
