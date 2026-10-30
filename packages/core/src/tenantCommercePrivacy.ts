/** Plan 50-19: closed merchant view for the current commerce schema. Unknown nested fields,
 * including future buyer details or credentials, refuse until their export/erasure disposition
 * is reviewed. These are source refs and quoted facts, never provider secrets or legal terms. */
type CommerceFieldRule = "merchant" | "omit" | CommerceFields | readonly [CommerceFields];
interface CommerceFields {
  readonly [key: string]: CommerceFieldRule;
}
const branchFields: CommerceFields = {
  taxSourceRef: "merchant",
  taxBasisPoints: "merchant",
  refundPolicyRef: "merchant",
  buyerRetentionRef: "merchant",
};
const physicalFields: CommerceFields = {
  ...branchFields,
  shippingSourceRef: "merchant",
  shippingMinor: "merchant",
  returnsPolicyRef: "merchant",
};
const digitalFields: CommerceFields = {
  ...branchFields,
  deliveryRef: "merchant",
  revocationRef: "merchant",
  noShipping: "merchant",
};
const cartLineFields: CommerceFields = {
  presentationItemId: "merchant",
  productId: "merchant",
  quantity: "merchant",
  expectedProductRevision: "merchant",
  expectedUnitMinor: "merchant",
};
const orderLineFields: CommerceFields = {
  presentationItemId: "merchant",
  productId: "merchant",
  sku: "merchant",
  goodsKind: "merchant",
  taxSourceRef: "merchant",
  refundPolicyRef: "merchant",
  buyerRetentionRef: "merchant",
  productRevision: "merchant",
  stockRevision: "merchant",
  unitMinor: "merchant",
  quantity: "merchant",
  lineMinor: "merchant",
};

const capabilityFields: CommerceFields = Object.fromEntries(
  [
    "tenantId",
    "provider",
    "environment",
    "merchantAccountRef",
    "providerAccountRef",
    "flow",
    "status",
    "sellerCountry",
    "buyerCountries",
    "presentmentCurrencies",
    "settlementCurrencies",
    "operations",
    "evidenceRef",
    "verifiedAt",
    "expiresAt",
  ].map((key) => [key, "merchant"]),
);
const merchantStateFields: CommerceFields = {
  ...Object.fromEntries(
    [
      "tenantId",
      "provider",
      "environment",
      "merchantAccountRef",
      "providerAccountRef",
      "orderId",
      "attemptId",
      "quoteHash",
      "currency",
      "totalMinor",
      "expiresAt",
      "status",
      "paymentRef",
      "reviewReason",
      "refundId",
      "amountMinor",
      "authorizationRef",
      "providerRefundRef",
      "fulfilmentId",
      "kind",
      "policyRef",
      "targetRef",
      "evidenceRef",
      "customerRef",
      "template",
      "stateEvidenceRef",
    ].map((key) => [key, "merchant"]),
  ),
  idempotencyKey: "omit",
  events: [{ eventRef: "merchant", fingerprint: "merchant" }],
};
export const COMMERCE_EXPORT_FIELDS: Readonly<Record<string, CommerceFields>> = {
  tenantMerchantAccounts: {
    tenantId: "merchant",
    projectId: "merchant",
    provider: "merchant",
    environment: "merchant",
    sellerCountry: "merchant",
    currency: "merchant",
    revision: "merchant",
    status: "merchant",
    providerAccountId: "merchant",
    trackingId: "omit",
    capability: capabilityFields,
    onboardingUrl: "omit",
    lastFailure: "merchant",
    createdAt: "merchant",
    updatedAt: "merchant",
  },
  tenantMerchantPayments: {
    tenantId: "merchant",
    projectId: "merchant",
    orderId: "merchant",
    localAttemptId: "merchant",
    merchantAccountId: "merchant",
    provider: "merchant",
    state: merchantStateFields,
    providerOrderId: "merchant",
    checkoutUrl: "omit",
    buyerTokenHash: "omit",
    buyerPurgeAt: "merchant",
    buyerEmail: "merchant",
    buyerAddress: {
      name: "merchant",
      line1: "merchant",
      line2: "merchant",
      city: "merchant",
      region: "merchant",
      postalCode: "merchant",
      country: "merchant",
    },
    deliveryReviewReason: "merchant",
    revision: "merchant",
    createdAt: "merchant",
    updatedAt: "merchant",
  },
  tenantMerchantEvents: {
    tenantId: "merchant",
    provider: "merchant",
    eventRef: "merchant",
    paymentId: "merchant",
    fingerprint: "merchant",
    outcome: "merchant",
    createdAt: "merchant",
  },
  tenantMerchantOperations: {
    tenantId: "merchant",
    projectId: "merchant",
    orderId: "merchant",
    paymentId: "merchant",
    kind: "merchant",
    state: merchantStateFields,
    idempotencyKey: "omit",
    storageId: "merchant",
    sourceDocumentId: "merchant",
    sourceHash: "merchant",
    shipmentDetails: { carrier: "merchant", trackingReference: "merchant" },
    expiresAt: "merchant",
    createdAt: "merchant",
    updatedAt: "merchant",
  },
  tenantMerchantAutomation: {
    tenantId: "merchant",
    projectId: "merchant",
    revision: "merchant",
    autoDigitalDelivery: "merchant",
    digitalValidityDays: "merchant",
    policyRef: "merchant",
    buyerRetentionDays: "merchant",
    createdAt: "merchant",
    updatedAt: "merchant",
  },

  tenantProducts: {
    digitalDeliveryDocumentId: "merchant",
    digitalDeliverySourceHash: "merchant",
    tenantId: "merchant",
    sku: "merchant",
    variant: "merchant",
    currency: "merchant",
    priceMinor: "merchant",
    status: "merchant",
    goodsKind: "merchant",
    revision: "merchant",
    createdAt: "merchant",
    updatedAt: "merchant",
  },
  tenantStock: {
    tenantId: "merchant",
    productId: "merchant",
    kind: "merchant",
    onHand: "merchant",
    reserved: "merchant",
    reservationTtlMs: "merchant",
    approvedUntracked: "merchant",
    revision: "merchant",
    updatedAt: "merchant",
  },
  tenantReservations: {
    tenantId: "merchant",
    productId: "merchant",
    quantity: "merchant",
    status: "merchant",
    expiresAt: "merchant",
    createdAt: "merchant",
    updatedAt: "merchant",
    orderId: "merchant",
    attemptId: "merchant",
  },
  tenantCommercePolicies: {
    tenantId: "merchant",
    projectId: "merchant",
    revision: "merchant",
    sellerOfRecordRef: "merchant",
    taxSourceRef: "merchant",
    shippingSourceRef: "merchant",
    refundPolicyId: "merchant",
    currency: "merchant",
    countries: "merchant",
    taxBasisPoints: "merchant",
    taxRounding: "merchant",
    shippingMinor: "merchant",
    physical: physicalFields,
    digital: digitalFields,
    createdAt: "merchant",
  },
  tenantCommerceMappings: {
    tenantId: "merchant",
    projectId: "merchant",
    presentationItemId: "merchant",
    productId: "merchant",
    revision: "merchant",
    createdAt: "merchant",
    updatedAt: "merchant",
  },
  tenantCarts: {
    buyerTokenHash: "omit",
    buyerRequestHash: "omit",
    tenantId: "merchant",
    projectId: "merchant",
    lines: [cartLineFields],
    addressCountry: "merchant",
    revision: "merchant",
    createdAt: "merchant",
    updatedAt: "merchant",
    expiresAt: "merchant",
  },
  tenantOrders: {
    tenantId: "merchant",
    projectId: "merchant",
    cartId: "merchant",
    cartRevision: "merchant",
    snapshot: {
      tenantId: "merchant",
      projectId: "merchant",
      currency: "merchant",
      country: "merchant",
      policyId: "merchant",
      policyRevision: "merchant",
      sellerOfRecordRef: "merchant",
      taxRounding: "merchant",
      taxSourceRef: "merchant",
      shippingSourceRef: "merchant",
      refundPolicyId: "merchant",
      physicalPolicy: physicalFields,
      digitalPolicy: digitalFields,
      lines: [orderLineFields],
      subtotalMinor: "merchant",
      taxMinor: "merchant",
      shippingMinor: "merchant",
      totalMinor: "merchant",
      hash: "merchant",
    },
    snapshotHash: "merchant",
    status: "merchant",
    expiresAt: "merchant",
    createdAt: "merchant",
    updatedAt: "merchant",
  },
  tenantOrderAttempts: {
    tenantId: "merchant",
    orderId: "merchant",
    cartId: "merchant",
    cartRevision: "merchant",
    retryKeyHash: "omit",
    snapshotHash: "merchant",
    status: "merchant",
    createdAt: "merchant",
    updatedAt: "merchant",
  },
};

/** Prefix guard makes a future commerce table refuse before the generic export dumps its rows. */
export function isCommerceTable(table: string): boolean {
  return /^tenant(?:Products|Stock|Reservations|Commerce|Carts|Orders|OrderAttempts|Merchant|Payments?|Refunds?|Fulfilment)/.test(
    table,
  );
}

function viewFields(
  value: Record<string, unknown>,
  fields: CommerceFields,
  path: string,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, field] of Object.entries(value)) {
    const rule = key === "_id" || key === "_creationTime" ? "merchant" : fields[key];
    if (rule === undefined) throw new Error(`COMMERCE_FIELD_UNCLASSIFIED:${path}.${key}`);
    if (rule === "omit" || field === undefined) continue;
    if (rule === "merchant") {
      out[key] = field;
      continue;
    }
    if (Array.isArray(rule)) {
      if (!Array.isArray(field)) throw new Error(`COMMERCE_FIELD_UNCLASSIFIED:${path}.${key}`);
      out[key] = field.map((entry) => {
        if (entry === null || typeof entry !== "object" || Array.isArray(entry))
          throw new Error(`COMMERCE_FIELD_UNCLASSIFIED:${path}.${key}[]`);
        return viewFields(
          entry as Record<string, unknown>,
          rule[0] as CommerceFields,
          `${path}.${key}[]`,
        );
      });
    } else {
      if (field === null || typeof field !== "object" || Array.isArray(field))
        throw new Error(`COMMERCE_FIELD_UNCLASSIFIED:${path}.${key}`);
      out[key] = viewFields(
        field as Record<string, unknown>,
        rule as CommerceFields,
        `${path}.${key}`,
      );
    }
  }
  return out;
}

export function commerceExportView(
  table: string,
  row: Record<string, unknown>,
): Record<string, unknown> {
  const fields = COMMERCE_EXPORT_FIELDS[table];
  if (!fields) throw new Error(`COMMERCE_TABLE_UNCLASSIFIED:${table}`);
  const view = viewFields(row, fields, table);
  if (table === "tenantProducts" && row.goodsKind === undefined) {
    view.goodsKind = null;
    view.classification = "legacy_unclassified";
  }
  if (table === "tenantCommercePolicies" && row.physical === undefined && row.digital === undefined)
    view.classification = "legacy_policy_branches_missing";
  if (table === "tenantOrders") {
    const snapshot = row.snapshot as Record<string, unknown> | undefined;
    if (snapshot && snapshot.physicalPolicy === undefined && snapshot.digitalPolicy === undefined)
      view.classification = "legacy_order_policy_missing";
  }
  return view;
}

/** Existing commerce orders and their linkage cannot be erased until financial, fulfilment,
 * refund and buyer-retention authority is accepted. Unused catalogue/policy rows are deletable. */
export function commerceDeletionBlocker(
  table: string,
  row: Record<string, unknown>,
): string | null {
  if (!COMMERCE_EXPORT_FIELDS[table]) throw new Error(`COMMERCE_TABLE_UNCLASSIFIED:${table}`);
  if (table === "tenantOrders")
    return "COMMERCE_RETENTION_POLICY_REQUIRED:ORDER_FINANCIAL_FULFILMENT_REFUND_BUYER";
  if (table === "tenantOrderAttempts") return "COMMERCE_RETENTION_POLICY_REQUIRED:ATTEMPT_HISTORY";
  if (table === "tenantReservations" && (row.orderId !== undefined || row.attemptId !== undefined))
    return "COMMERCE_RETENTION_POLICY_REQUIRED:LINKED_RESERVATION";
  return null;
}

export const TENANT_EXPORT_SCHEMA_VERSION = 1;
export const AUDIT_ARCHIVE_STATEMENT =
  "references, identifiers, hashes, and counts only — never the content of your messages, and no directly identifying data.";

export type TenantExportHeader = {
  schemaVersion: typeof TENANT_EXPORT_SCHEMA_VERSION;
  generatedAt: string;
  tenantId: string;
  auditArchive: typeof AUDIT_ARCHIVE_STATEMENT;
};

export type TenantCredentialSummary = {
  connected: boolean;
  updatedAt: number | null;
  scopeHalves: readonly number[];
};
