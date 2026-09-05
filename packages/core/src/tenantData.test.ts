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
    //    + the four Phase-28 connector tables (28-03) + billingStripeEvents (28.1-01)
    //    + knowledgeSearches (29-01, KNOW-01 — `tenant_owned`: it holds the user's question, the
    //      answer they were shown and their own document titles).
    // 43 + 2 + 1 + 4 + 1 + 1 = 52.
    // This count is a TRIPWIRE, not bookkeeping: a new table cannot reach the export/deletion
    // walks without someone deliberately bumping it and classifying the table on the way past.
    //
    // 28.1-01 FOUND THIS TEST RED AT HEAD AND FIXED IT: 28-03 added four tables and classified
    // them, but never bumped this number or the closed set below, so the tripwire had been
    // failing on its own arithmetic ever since — and a genuinely UNCLASSIFIED table would have
    // looked exactly the same. A tripwire nobody can distinguish from noise is not a tripwire.
    //
    // THE PHASE-28/29 MERGE IS THE SAME HAZARD IN ITS MOST LIKELY FORM: two lanes each added
    // tables and each bumped this number for their own, so either side's figure resolves the
    // conflict "cleanly" and is wrong by the other side's count. 52 was DERIVED from the merged
    // `schema.ts` and `tenantData.ts` — 52 tables, 52 classifications, nothing unclassified in
    // either direction — not carried over from a branch. Re-derive it the same way after any
    // future merge; do not pick a side.
    // + billingCustomers (28.1-05, the tenant<->Stripe-customer mapping).
    // + billingEvents, billingCoverage, billingUnapplied (28.1-06, the billing book of record).
    // + billingPeriods (28.1-07, the invoice claim row — `tenant_owned`, argued in tenantData.ts).
    // RE-DERIVED 2026-09-05 at the Phase 28/28.1/29/33.x merge: main's 52 (with knowledgeSearches)
    // + the lane's five billing tables = 57. Counted from the merged schema.ts, not carried over.
    expect(schemaTables).toHaveLength(57);
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
      // Phase 29 added NO credential table — `knowledgeSearches` is `tenant_owned`, and a knowledge
      // search reads through the connectors' own credentials rather than holding one of its own.
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

  /**
   * 28.1-05, asserted POSITIVELY and by name for the same reason `workflowPackEvents` is above:
   * the derived equality in the next test reads the classification itself and would stay green if
   * the category silently flipped.
   *
   * The property is a compliance one. `billingCustomers` is the ONLY row joining a tenant to its
   * Stripe customer id, so a tenant erasure that left it behind would leave an orphaned link to a
   * live merchant record. It is NOT `tenant_credential`: `cus_...` grants no access to anything
   * without the secret key, and the credential category SUMMARISES rows on export
   * (`summarizeTenantCredential`), which would replace the one fact the tenant actually wants to
   * see with `{connected, updatedAt, scopeHalves: []}`.
   */
  test("the Stripe-customer mapping is tenant-owned — erasure removes it, export shows it", () => {
    expect(TENANT_TABLE_CLASSIFICATION.billingCustomers).toBe("tenant_owned");
    expect(deletableTables()).toContain("billingCustomers");
    // The delivery log next door is deliberately the OPPOSITE call, and the pair is the point:
    // erasing it would let a redelivered event for that tenant re-apply.
    expect(TENANT_TABLE_CLASSIFICATION.billingStripeEvents).toBe("global");
    expect(deletableTables()).not.toContain("billingStripeEvents");
  });

  /**
   * 28.1-06, asserted POSITIVELY and by name for the same reason the two above are.
   *
   * The pair is the property. `billingEvents` is Pikar's OWN record of what a customer PAID it —
   * erasure must not let a customer delete the merchant's books, and the tenant's own copy of that
   * history is Stripe's hosted Customer Portal, not this table. `billingUnapplied` is the opposite
   * call on purpose: it is mutable, and the money it describes is still the customer's, so it
   * exports and it deletes.
   */
  test("the billing book of record is immutable; unapplied funds are the tenant's own", () => {
    expect(TENANT_TABLE_CLASSIFICATION.billingEvents).toBe("audit_immutable");
    expect(TENANT_TABLE_CLASSIFICATION.billingCoverage).toBe("audit_immutable");
    expect(deletableTables()).not.toContain("billingEvents");
    // Coverage and its events must delete together or never. Never is the answer, and a split
    // would report "unknown coverage" over rows that are sitting right there.
    expect(deletableTables()).not.toContain("billingCoverage");

    expect(TENANT_TABLE_CLASSIFICATION.billingUnapplied).toBe("tenant_owned");
    expect(deletableTables()).toContain("billingUnapplied");
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
