import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import {
  commerceDeletionBlocker,
  commerceExportView,
  deletableTables,
  isCommerceTable,
  STORAGE_ID_FIELDS,
  storageIdsIn,
  TENANT_TABLE_CLASSIFICATION,
} from "./tenantData";

describe("Plan 50-19 closed commerce field classification", () => {
  test("unused buyer-free rows erase, but orders, attempts and linked holds refuse by name", () => {
    expect(commerceDeletionBlocker("tenantProducts", { sku: "unused" })).toBeNull();
    expect(commerceDeletionBlocker("tenantCommercePolicies", { revision: 7 })).toBeNull();
    expect(commerceDeletionBlocker("tenantReservations", { status: "held" })).toBeNull();
    expect(commerceDeletionBlocker("tenantOrders", {})).toBe(
      "COMMERCE_RETENTION_POLICY_REQUIRED:ORDER_FINANCIAL_FULFILMENT_REFUND_BUYER",
    );
    expect(commerceDeletionBlocker("tenantOrderAttempts", {})).toBe(
      "COMMERCE_RETENTION_POLICY_REQUIRED:ATTEMPT_HISTORY",
    );
    expect(commerceDeletionBlocker("tenantReservations", { orderId: "linked" })).toBe(
      "COMMERCE_RETENTION_POLICY_REQUIRED:LINKED_RESERVATION",
    );
    expect(commerceDeletionBlocker("tenantReservations", { attemptId: "linked" })).toBe(
      "COMMERCE_RETENTION_POLICY_REQUIRED:LINKED_RESERVATION",
    );
  });
  const physical = {
    shippingSourceRef: "ship-v1",
    shippingMinor: 300,
    returnsPolicyRef: "returns-v1",
    taxSourceRef: "tax-physical",
    taxBasisPoints: 1000,
    refundPolicyRef: "refund-physical",
    buyerRetentionRef: "retain-physical",
  };
  const digital = {
    deliveryRef: "delivery-v1",
    revocationRef: "revoke-v1",
    noShipping: true,
    taxSourceRef: "tax-digital",
    taxBasisPoints: 500,
    refundPolicyRef: "refund-digital",
    buyerRetentionRef: "retain-digital",
  };
  const policy = {
    _id: "policy-1",
    _creationTime: 1,
    tenantId: "tenant-a",
    projectId: "site-a",
    revision: 2,
    sellerOfRecordRef: "seller-v1",
    currency: "USD",
    countries: ["TZ"],
    taxRounding: "half_up",
    physical,
    digital,
    createdAt: 1,
  };
  const line = {
    presentationItemId: "card-1",
    productId: "product-1",
    sku: "lamp",
    goodsKind: "physical",
    taxSourceRef: "tax-physical",
    refundPolicyRef: "refund-physical",
    buyerRetentionRef: "retain-physical",
    productRevision: 2,
    stockRevision: 3,
    unitMinor: 1000,
    quantity: 1,
    lineMinor: 1000,
  };
  const order = {
    _id: "order-1",
    _creationTime: 1,
    tenantId: "tenant-a",
    projectId: "site-a",
    cartId: "cart-1",
    cartRevision: 1,
    snapshot: {
      tenantId: "tenant-a",
      projectId: "site-a",
      currency: "USD",
      country: "TZ",
      policyId: "policy-1",
      policyRevision: 2,
      sellerOfRecordRef: "seller-v1",
      taxRounding: "half_up",
      physicalPolicy: physical,
      digitalPolicy: digital,
      lines: [line],
      subtotalMinor: 1000,
      taxMinor: 100,
      shippingMinor: 300,
      totalMinor: 1400,
      hash: "sha256:snapshot",
    },
    snapshotHash: "sha256:snapshot",
    status: "pending",
    expiresAt: 1000,
    createdAt: 1,
    updatedAt: 1,
  };

  test("exports exact merchant-owned kinds, branch provenance, amounts and metadata", () => {
    expect(commerceExportView("tenantCommercePolicies", policy)).toMatchObject({
      _id: "policy-1",
      _creationTime: 1,
      revision: 2,
      physical: { shippingMinor: 300, buyerRetentionRef: "retain-physical" },
      digital: { noShipping: true, deliveryRef: "delivery-v1" },
    });
    expect(commerceExportView("tenantOrders", order)).toMatchObject({
      snapshot: {
        policyRevision: 2,
        shippingMinor: 300,
        lines: [{ goodsKind: "physical", unitMinor: 1000 }],
      },
    });
    expect(
      commerceExportView("tenantProducts", {
        _id: "product-1",
        _creationTime: 1,
        tenantId: "tenant-a",
        sku: "lamp",
        variant: "one",
        currency: "USD",
        priceMinor: 1000,
        status: "active",
        goodsKind: "physical",
        revision: 2,
        createdAt: 1,
        updatedAt: 1,
      }),
    ).toMatchObject({ goodsKind: "physical", revision: 2 });
  });

  test("omits retry-key hashes and names legacy unclassified rows", () => {
    expect(
      commerceExportView("tenantOrderAttempts", {
        _id: "attempt-1",
        _creationTime: 1,
        tenantId: "tenant-a",
        orderId: "order-1",
        cartId: "cart-1",
        cartRevision: 1,
        retryKeyHash: "secret-hash",
        snapshotHash: "sha256:snapshot",
        status: "local_pending",
        createdAt: 1,
        updatedAt: 1,
      }),
    ).not.toHaveProperty("retryKeyHash");
    expect(
      commerceExportView("tenantProducts", {
        _id: "legacy",
        _creationTime: 1,
        tenantId: "tenant-a",
        sku: "legacy",
        variant: "one",
        currency: "USD",
        priceMinor: 100,
        status: "active",
        revision: 1,
        createdAt: 1,
        updatedAt: 1,
      }),
    ).toMatchObject({ goodsKind: null, classification: "legacy_unclassified" });
    expect(
      commerceExportView("tenantCommercePolicies", {
        ...policy,
        physical: undefined,
        digital: undefined,
      }),
    ).toMatchObject({ classification: "legacy_policy_branches_missing" });
  });

  test("unknown commerce table and top-level or nested buyer/credential fields fail closed", () => {
    expect(isCommerceTable("tenantMerchantAccounts")).toBe(true);
    expect(() => commerceExportView("tenantMerchantAccounts", { tenantId: "tenant-a" })).toThrow(
      "COMMERCE_TABLE_UNCLASSIFIED",
    );
    expect(() =>
      commerceExportView("tenantProducts", { _id: "p", buyerEmail: "buyer@example.test" }),
    ).toThrow("COMMERCE_FIELD_UNCLASSIFIED:tenantProducts.buyerEmail");
    expect(() =>
      commerceExportView("tenantCommercePolicies", {
        ...policy,
        physical: { ...physical, credentialCiphertextB64: "secret" },
      }),
    ).toThrow(
      "COMMERCE_FIELD_UNCLASSIFIED:tenantCommercePolicies.physical.credentialCiphertextB64",
    );
    expect(() =>
      commerceExportView("tenantOrders", {
        ...order,
        snapshot: { ...order.snapshot, buyerEmail: "buyer@example.test" },
      }),
    ).toThrow("COMMERCE_FIELD_UNCLASSIFIED:tenantOrders.snapshot.buyerEmail");
    expect(() =>
      commerceExportView("tenantOrders", {
        ...order,
        snapshot: { ...order.snapshot, lines: [{ ...line, buyerName: "Buyer" }] },
      }),
    ).toThrow("COMMERCE_FIELD_UNCLASSIFIED:tenantOrders.snapshot.lines[].buyerName");
  });
});

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
    // + agenda (34-01, ADR-033 — the weekly review's gap lifecycle) = 58.
    // + vaultSheets (40-01, DOC-01 — a workbook's capped grid) = 59. RE-DERIVED, not bumped: this
    // + auditExportQueue (ADR-048, transactional export delivery state) = 60. This
    // count and `schema.ts`'s own header index ("60 tables", asserted independently by
    // schema.test.ts against the same source) are two readers of one file that now agree.
    // + funnels (31-01): tenant-owned fixed-source aggregate links = 61.
    // + researchControls (2026-09-12 request controls): tenant-owned bounded attempt state = 62.
    // + goldenEvalAttempts (2026-09-20): refs/hash-only paid-workflow recovery journal = 63.
    // + betaJourneyEvents (25-15): tenant-owned refs-only product journey measurements = 64.
    // + webProjects, webProjectVersions, webMetrics and webSubmissions (48-02) = 68.
    // + tenantProducts, tenantStock and tenantReservations (50-02) = 71.
    // + five provider-independent local policy/mapping/cart/order/attempt rows (50-04) = 76.
    expect(schemaTables).toHaveLength(76);
    expect(new Set(schemaTables).size).toBe(schemaTables.length);
    expect(classifiedTables.sort()).toEqual([...schemaTables].sort());
  });

  test("Phase 48 rows are tenant-owned and rendered artifacts are reachable", () => {
    expect(TENANT_TABLE_CLASSIFICATION.webProjects).toBe("tenant_owned");
    expect(TENANT_TABLE_CLASSIFICATION.webProjectVersions).toBe("tenant_owned");
    expect(TENANT_TABLE_CLASSIFICATION.webMetrics).toBe("tenant_owned");
    expect(TENANT_TABLE_CLASSIFICATION.webSubmissions).toBe("tenant_owned");
    expect(deletableTables()).toEqual(
      expect.arrayContaining(["webProjects", "webProjectVersions", "webMetrics", "webSubmissions"]),
    );
    expect(STORAGE_ID_FIELDS.webProjectVersions).toEqual(["artifactStorageId"]);
    expect(storageIdsIn("webProjectVersions", { artifactStorageId: "web-artifact" })).toEqual([
      "web-artifact",
    ]);
  });

  test("Phase 50 buyer-free catalogue, stock and reservation rows are exported and erased", () => {
    for (const table of ["tenantProducts", "tenantStock", "tenantReservations"] as const) {
      expect(TENANT_TABLE_CLASSIFICATION[table]).toBe("tenant_owned");
      expect(deletableTables()).toContain(table);
    }
  });

  test("Plan 50-04 local order content and coordination rows are tenant-owned", () => {
    for (const table of [
      "tenantCommercePolicies",
      "tenantCommerceMappings",
      "tenantCarts",
      "tenantOrders",
      "tenantOrderAttempts",
    ] as const) {
      expect(TENANT_TABLE_CLASSIFICATION[table]).toBe("tenant_owned");
      expect(deletableTables()).toContain(table);
    }
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

  /**
   * THE SET THAT SURVIVES ERASURE IS CLOSED, AND IT IS DERIVED — NEVER HAND-ENUMERATED.
   *
   * ADR-044 C2 asked "which surviving table still resolves to a person" and answered it by hand:
   * it named `betaInvites` and `billingEvents`, and said of the rest "Every other surviving table
   * was checked — `billingCoverage`, `workflowPackEvents` and `billingStripeEvents` — the failure
   * is these two and no others." That sentence was wrong in two places, and BOTH omissions were
   * invisible precisely because the list was typed rather than derived (47-09):
   *
   *   • `deadLetters` (`audit_immutable`) was never mentioned. `billingWebhook.ts`'s dead-letter
   *     payload carries `stripeCustomerId` and `billedTenantId` together — the same shape ADR-044
   *     objected to in `billingEvents`, one table over.
   *   • `betaWaitlist` (`admission_plane`) was never mentioned. It holds a RAW `email`, a `name`
   *     and a free-text `referral`, it is excluded from the erasure walk exactly as `betaInvites`
   *     is — and unlike every other row in this argument it is NOT hypothetical: production held
   *     live rows when this test was written.
   *
   * So the classification map is the source, and this list is the assertion. Adding a table to any
   * surviving class now FAILS HERE, by name, and the person adding it has to say what personal
   * data it carries. That is the whole point: the defect was never a wrong answer, it was a
   * question asked of a list somebody remembered.
   *
   * `tenant_owned` and `tenant_credential` are deliberately NOT pinned — they are erased, so a new
   * one carries no obligation and pinning them would be noise that trains people to edit the list
   * without thinking.
   */
  test("the tables that OUTLIVE an erasure are a closed, named set", () => {
    const surviving = (klass: string) =>
      Object.entries(TENANT_TABLE_CLASSIFICATION)
        .filter(([, c]) => c === klass)
        .map(([t]) => t)
        .sort();

    // Excluded from the erasure walk by construction. Every one of these is a table whose rows a
    // deletion request cannot reach, so every one of them is a place personal data must not be.
    expect(surviving("audit_immutable")).toEqual([
      "audit",
      "billingCoverage",
      "billingEvents",
      "deadLetters",
      "goldenEvalAttempts",
      "workflowPackEvents",
    ]);

    // The admission plane. `betaInvites` is cleared at erasure (ADR-045 D1) rather than deleted,
    // so the invite stays spent. `betaWaitlist` is NOT cleared by anything — see ADR-047.
    expect(surviving("admission_plane")).toEqual(["betaInvites", "betaWaitlist"]);

    // Deployment bookkeeping, including refs to the already-immutable audit log;
    // tenant erasure must not discard pending export delivery state.
    expect(surviving("global")).toEqual([
      "auditExportQueue",
      "billingStripeEvents",
      "exportCursors",
      "guardrailConfig",
      "optimizerConfig",
      "pendingTimeouts",
      "providerGates",
      "skills",
    ]);

    // POSITIVE CONTROL: the filter really reads the map, so the three assertions above cannot be
    // passing over an empty result. Without this, renaming the class strings would turn every
    // list into `[]` and all three would still be green.
    expect(surviving("tenant_owned").length).toBeGreaterThan(10);
    expect(surviving("not-a-real-classification")).toEqual([]);
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

// ══ WHERE THE BYTES ARE (2026-09-08) ══════════════════════════════════════════════════════════
//
// `storageIdsIn` is the whole reason erasure can now delete a user's files. It is pure, so it is
// provable here without a database — and it MUST be, because the paths it walks are the part a
// behaviour test cannot see: a row whose attachments array is missing looks identical to one whose
// attachments carried no bytes.
describe("storageIdsIn — every byte reachable from one row", () => {
  // MUTATION: drop the `attachments[].storageId` entry from STORAGE_ID_FIELDS → red. That entry is
  // the single largest class of generated file in the product, and it is the one a top-level-fields
  // -only map would silently miss.
  test("walks INTO an inline array of objects, not just top-level fields", () => {
    expect(
      storageIdsIn("plans", {
        renderStorageId: "kg_reel",
        sidecarStorageId: "kg_sidecar",
        attachments: [{ storageId: "kg_pdf_a" }, { storageId: "kg_pdf_b" }],
      }),
    ).toEqual(["kg_reel", "kg_sidecar", "kg_pdf_a", "kg_pdf_b"]);
  });

  // FAIL-SAFE, and it is the difference between a bad row and a user who cannot delete their
  // account: every field but two is `v.optional`, so a half-written row is reachable in practice,
  // and handing `undefined` to `ctx.storage.delete` THROWS inside the erasure walk.
  // MUTATION: return the raw values without the `typeof === "string"` guard → red on every row.
  test("drops absent, null, empty and non-string ids rather than returning them", () => {
    expect(storageIdsIn("plans", {})).toEqual([]);
    expect(storageIdsIn("plans", { renderStorageId: null, sidecarStorageId: undefined })).toEqual(
      [],
    );
    expect(storageIdsIn("plans", { renderStorageId: "" })).toEqual([]);
    expect(storageIdsIn("plans", { attachments: "not-an-array" })).toEqual([]);
    expect(storageIdsIn("plans", { attachments: [null, 7, {}, { storageId: 3 }] })).toEqual([]);
  });

  // A table with no bytes must yield nothing rather than throw — the walk calls this for EVERY
  // deletable table, and most of them carry no files at all.
  test("an unlisted table yields nothing", () => {
    expect(storageIdsIn("contacts", { storageId: "kg_nope" })).toEqual([]);
    expect(storageIdsIn("audit", {})).toEqual([]);
  });

  // NON-VACUITY for the test above: `storageId` is a real field name on OTHER tables, so "unlisted
  // yields nothing" must not be passing because the extractor is broken for everyone.
  test("...but the same field name IS read on a table that declares it", () => {
    expect(storageIdsIn("vaultDocuments", { storageId: "kg_doc" })).toEqual(["kg_doc"]);
    expect(storageIdsIn("mediaJobs", { assetStorageId: "kg_asset" })).toEqual(["kg_asset"]);
  });
});

// ══ THE DRIFT GUARD — a new table carrying bytes cannot land unnoticed ═══════════════════════
//
// The dangerous edit here is an OMITTED table, which no compiler, linter or behaviour test can
// see: add a table with a `v.id("_storage")` field, forget to declare it, and erasure silently
// stops covering it while every test stays green. That is EXACTLY how the original defect
// survived — `tenantDelete.ts` never mentioned storage at all and nothing noticed for months.
//
// This parses `schema.ts` the same way the classification drift test above does, and it is the
// reason `STORAGE_ID_FIELDS` is a declarative map rather than branches at the delete site.
describe("STORAGE_ID_FIELDS covers every _storage field in schema.ts", () => {
  /** Every `v.id("_storage")` occurrence, paired with the table whose `defineTable(` most
   *  recently opened above it. Nested-in-an-array fields are found too — `plans.attachments[]`
   *  is exactly such a case, and it is the largest class of generated file in the product. */
  const storageSites = (): { table: string; field: string }[] => {
    const out: { table: string; field: string }[] = [];
    let table: string | null = null;
    for (const line of schemaSource.split("\n")) {
      const opened = /^ {2}([A-Za-z][A-Za-z0-9]*): defineTable\(/.exec(line);
      if (opened?.[1] !== undefined) table = opened[1];
      const field = /([A-Za-z][A-Za-z0-9]*):\s*v\.(?:optional\(\s*)?v?\.?id\("_storage"\)/.exec(
        line,
      );
      if (field?.[1] !== undefined && table !== null) out.push({ table, field: field[1] });
    }
    return out;
  };

  // MUTATION: delete any entry from STORAGE_ID_FIELDS → red, naming the table.
  test("every table with a _storage field is declared", () => {
    const sites = storageSites();
    // NON-VACUITY FLOOR. A regex that stopped matching would make this whole describe pass over
    // nothing — the failure mode the classification guard above was also written to refuse.
    expect(sites.length, "the _storage regex matched nothing — the scan is broken").toBeGreaterThan(
      5,
    );
    // EVERY SITE, not every table. Checking table coverage alone was the first version of this
    // guard and it was too weak: dropping the `attachments[].storageId` PATH from a `plans` entry
    // that still exists left it green, which mutation testing caught. The leaf field is what has
    // to be covered, because that is what the extractor actually reads.
    const declaredLeaves = new Set(
      Object.entries(STORAGE_ID_FIELDS).flatMap(([table, paths]) =>
        paths.map((p) => `${table}.${p.includes("[].") ? p.slice(p.indexOf("[].") + 3) : p}`),
      ),
    );
    const undeclared = [
      ...new Set(
        sites
          .filter((x) => !declaredLeaves.has(`${x.table}.${x.field}`))
          .map((x) => `${x.table}.${x.field}`),
      ),
    ];
    expect(
      undeclared,
      "these fields hold file bytes that erasure would silently leave behind",
    ).toEqual([]);
  });

  // The other direction: a declared path that no longer exists is a delete that quietly stops
  // finding anything. Renaming `assetStorageId` and forgetting this map would go unnoticed.
  test("every declared path still exists in schema.ts", () => {
    const sites = storageSites();
    const missing: string[] = [];
    for (const [table, paths] of Object.entries(STORAGE_ID_FIELDS)) {
      for (const path of paths) {
        const leaf = path.includes("[].") ? path.slice(path.indexOf("[].") + 3) : path;
        if (!sites.some((x) => x.table === table && x.field === leaf))
          missing.push(`${table}.${path}`);
      }
    }
    expect(missing, "declared storage paths that schema.ts no longer has").toEqual([]);
  });

  // AND THE PATHS ARE REACHED BY THE EXTRACTOR, not merely listed. A map that is correct and an
  // extractor that cannot walk it are the same bug from the user's side.
  test("storageIdsIn reaches every declared path", () => {
    for (const [table, paths] of Object.entries(STORAGE_ID_FIELDS)) {
      for (const path of paths) {
        const marker = `kg_${table}_${path}`;
        const row: Record<string, unknown> = path.includes("[].")
          ? {
              [path.slice(0, path.indexOf("[]."))]: [
                { [path.slice(path.indexOf("[].") + 3)]: marker },
              ],
            }
          : { [path]: marker };
        expect(storageIdsIn(table, row), `${table}.${path} is declared but unreachable`).toContain(
          marker,
        );
      }
    }
  });
});
