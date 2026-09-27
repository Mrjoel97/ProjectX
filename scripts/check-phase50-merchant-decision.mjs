import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const packetPath = "docs/releases/phase-50-merchant-decision.md";
const adrPath = "docs/decisions/049-tenant-merchant-provider-and-policy.md";
const providerFields = [
  "delegatedConnection",
  "credentialCustody",
  "sandboxEligibility",
  "partnerEligibility",
  "hostedCheckout",
  "rawBodySignature",
  "exactAccountFetch",
  "exactAccountRefund",
  "apiVersion",
  "sellerCountryCoverage",
  "paymentMethodCoverage",
  "feeResponsibility",
  "negativeBalanceLiability",
];
const policyFields = [
  "sellerIdentity",
  "stockExpiry",
  "oversellAndLatePaid",
  "taxAuthority",
  "shippingAuthority",
  "refundAuthority",
  "notificationSenderAndApproval",
  "fulfilmentDestinationAndApproval",
  "physicalShippingAndReturns",
  "digitalDeliveryAndRevocation",
  "buyerOrderRetention",
  "merchantPolicyValidation",
  "testModeActivation",
  "quoteSettlementRule",
];
const capabilityKeys = [
  "provider",
  "accountRef",
  "sellerAccountType",
  "onboardingFlow",
  "checkoutProduct",
  "sellerCountry",
  "paymentMethod",
  "quoteCurrency",
  "settlementCurrency",
];
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const present = (value) =>
  typeof value === "string" &&
  value.trim().length > 0 &&
  !/^(?:pending|unknown|tbd|n\/a)$/i.test(value.trim());
const evidencedDate = (value) => {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return (
    Number.isFinite(date.getTime()) &&
    date.toISOString().slice(0, 10) === value &&
    value <= new Date().toISOString().slice(0, 10)
  );
};
const record = (value, synthetic = false) =>
  value &&
  present(value.value) &&
  present(value.source) &&
  (synthetic || !/synthetic|placeholder|example/i.test(`${value.value} ${value.source}`)) &&
  evidencedDate(value.checkedAt);

function parsePacket(markdown) {
  const blocks = [...markdown.matchAll(/```phase50-decision-json\s*\r?\n([\s\S]*?)\r?\n```/g)];
  if (blocks.length !== 1) throw new Error("exactly one phase50-decision-json block required");
  return JSON.parse(blocks[0][1]);
}

function capabilityStatus(matrix, operation) {
  if (!operation || typeof operation !== "object") return "unverified";
  const matches = matrix.entries.filter((entry) =>
    capabilityKeys.every((key) => entry[key] === operation[key]),
  );
  return matches.length === 1 ? matches[0].status : "unverified";
}

function validate(decision, adrBytes, synthetic = false) {
  const failures = [];
  const need = (ok, code) => {
    if (!ok) failures.push(code);
  };
  need(decision?.status === "accepted", "status_not_accepted");
  need(
    JSON.stringify(decision?.releaseProviders) === '["stripe","paypal"]',
    "both_providers_required",
  );
  need(decision?.accountModel === "merchant-owned-direct", "merchant_direct_accounts_required");
  need(decision?.shopPolicyOwner === "merchant", "merchant_policy_owner_required");
  need(decision?.sellerCountryTarget === "all", "seller_country_target_changed");
  need(
    JSON.stringify(decision?.goodsScope) === '["physical","digital"]',
    "physical_and_digital_goods_required",
  );
  need(
    JSON.stringify(decision?.targetSettlementCurrencies) === '["USD","EUR","GBP"]',
    "settlement_targets_changed",
  );
  need(
    decision?.productionEnabled === false && decision?.productionStorefrontEnabled === false,
    "production_open",
  );
  need(
    present(decision?.owner?.name) && record(decision?.owner?.approval, synthetic),
    "owner_approval_missing",
  );
  need(
    decision?.adr?.path === adrPath && /^[a-f0-9]{64}$/.test(decision?.adr?.sha256 || ""),
    "accepted_adr_identity_missing",
  );
  need(!!adrBytes && sha256(adrBytes) === decision?.adr?.sha256, "accepted_adr_hash_mismatch");
  need(
    !!adrBytes &&
      /Status:\s*Accepted/i.test(adrBytes.toString("utf8")) &&
      /Stripe/i.test(adrBytes.toString("utf8")) &&
      /PayPal/i.test(adrBytes.toString("utf8")),
    "accepted_adr_content_missing",
  );
  for (const id of ["stripe", "paypal"]) {
    const provider = decision?.providers?.[id];
    need(
      provider?.id === id && provider?.receivingAccountOwner === "merchant",
      `${id}_account_identity_missing`,
    );
    for (const field of providerFields)
      need(record(provider?.[field], synthetic), `${id}_${field}_evidence_missing`);
  }
  const paypalSdk = decision?.providers?.paypal?.buyerSdkGeneration;
  need(
    record(paypalSdk, synthetic) &&
      ["javascript-sdk-v5", "javascript-sdk-v6"].includes(paypalSdk?.value),
    "paypal_buyer_sdk_generation_missing",
  );
  need(
    record(decision?.providers?.paypal?.buyerSdkMerchantBinding, synthetic),
    "paypal_buyer_sdk_merchant_binding_missing",
  );
  if (paypalSdk?.value === "javascript-sdk-v5") {
    need(
      record(decision?.providers?.paypal?.v5Exception, synthetic),
      "paypal_v5_exception_missing",
    );
  }
  for (const field of policyFields)
    need(record(decision?.policy?.[field], synthetic), `policy_${field}_missing`);
  need(
    decision?.policy?.quoteSettlementRule?.value?.includes("independent") &&
      decision?.policy?.quoteSettlementRule?.value?.includes("refuse"),
    "quote_settlement_distinction_missing",
  );
  const hold = decision?.stockHoldPolicy;
  need(
    hold?.configuredBy === "merchant" &&
      hold.minMinutes === 1 &&
      hold.maxMinutes === 60 &&
      hold.onExpiry === "release",
    "stock_hold_policy_invalid",
  );
  const late = decision?.latePaidUnavailable;
  need(
    late?.trigger === "expired_hold_and_stock_unavailable" &&
      late.state === "merchant_review" &&
      late.automaticFulfillment === false &&
      late.automaticRefund === false,
    "late_paid_unavailable_boundary_invalid",
  );
  for (const field of ["reviewAuthority", "permittedActions", "customerNotice"]) {
    need(record(late?.[field], synthetic), `late_paid_${field}_missing`);
  }
  need(late?.reviewAuthority?.value === "merchant_admin", "late_paid_merchant_admin_required");
  need(
    late?.permittedActions?.value === "refund_or_documented_fulfilment_alternative",
    "late_paid_actions_changed",
  );
  need(late?.customerNotice?.value === "buyer_status_notice", "late_paid_buyer_notice_required");
  const matrix = decision?.capabilityMatrix;
  need(
    present(matrix?.version) &&
      evidencedDate(matrix?.checkedAt) &&
      matrix?.defaultStatus === "unverified",
    "matrix_version_or_default_missing",
  );
  const entries = Array.isArray(matrix?.entries) ? matrix.entries : [];
  need(entries.length > 0, "matrix_empty");
  const keys = new Set();
  for (const [index, entry] of entries.entries()) {
    const key = capabilityKeys.map((name) => entry?.[name]);
    need(
      ["stripe", "paypal"].includes(entry?.provider) &&
        key.slice(1).every((value) => present(value) && value !== "*"),
      `matrix_row_${index}_identity_missing`,
    );
    need(
      /^[A-Z]{2}$/.test(entry?.sellerCountry || "") &&
        /^[A-Z]{3}$/.test(entry?.quoteCurrency || "") &&
        /^[A-Z]{3}$/.test(entry?.settlementCurrency || ""),
      `matrix_row_${index}_codes_invalid`,
    );
    need(
      ["supported", "unsupported", "unverified"].includes(entry?.status) &&
        record(entry?.evidence, synthetic),
      `matrix_row_${index}_status_or_evidence_missing`,
    );
    const joined = JSON.stringify(key);
    need(!keys.has(joined), `matrix_row_${index}_duplicate`);
    keys.add(joined);
  }
  for (const id of ["stripe", "paypal"])
    need(
      entries.some((e) => e.provider === id && e.status === "supported"),
      `${id}_no_supported_entry`,
    );
  const operations = Array.isArray(decision?.approvedOperations) ? decision.approvedOperations : [];
  need(operations.length >= 2, "approved_operations_missing");
  for (const [index, operation] of operations.entries()) {
    need(
      capabilityStatus({ entries }, operation) === "supported",
      `operation_${index}_not_supported`,
    );
  }
  for (const id of ["stripe", "paypal"])
    need(
      operations.some((o) => o.provider === id),
      `${id}_approved_operation_missing`,
    );
  return failures;
}

function selfTest() {
  const fact = (value) => ({
    value,
    source: "synthetic://self-test-only",
    checkedAt: "2026-09-24",
  });
  const adrBytes = Buffer.from(
    "# Synthetic ADR\nStatus: Accepted\nStripe and PayPal synthetic only\n",
  );
  const row = (provider, status, country = "US") => ({
    provider,
    accountRef: `${provider}-synthetic-account`,
    sellerAccountType: "synthetic-account-type",
    onboardingFlow: "synthetic-before-payment",
    checkoutProduct: "synthetic-hosted-checkout",
    sellerCountry: country,
    paymentMethod: "synthetic-method",
    quoteCurrency: "USD",
    settlementCurrency: "EUR",
    status,
    evidence: fact("synthetic eligibility"),
  });
  const decision = {
    status: "accepted",
    releaseProviders: ["stripe", "paypal"],
    accountModel: "merchant-owned-direct",
    shopPolicyOwner: "merchant",
    sellerCountryTarget: "all",
    goodsScope: ["physical", "digital"],
    targetSettlementCurrencies: ["USD", "EUR", "GBP"],
    productionEnabled: false,
    productionStorefrontEnabled: false,
    owner: { name: "Synthetic Owner", approval: fact("synthetic approval") },
    adr: { path: adrPath, sha256: sha256(adrBytes) },
    providers: {},
    policy: {},
    stockHoldPolicy: {
      configuredBy: "merchant",
      minMinutes: 1,
      maxMinutes: 60,
      onExpiry: "release",
    },
    latePaidUnavailable: {
      trigger: "expired_hold_and_stock_unavailable",
      state: "merchant_review",
      automaticFulfillment: false,
      automaticRefund: false,
      reviewAuthority: fact("merchant_admin"),
      permittedActions: fact("refund_or_documented_fulfilment_alternative"),
      customerNotice: fact("buyer_status_notice"),
    },
    capabilityMatrix: {
      version: "synthetic-v1",
      checkedAt: "2026-09-24",
      defaultStatus: "unverified",
      entries: [
        row("stripe", "supported"),
        row("paypal", "supported"),
        row("stripe", "unsupported", "GB"),
      ],
    },
  };
  for (const id of ["stripe", "paypal"]) {
    decision.providers[id] = { id, receivingAccountOwner: "merchant" };
    for (const field of providerFields) decision.providers[id][field] = fact(`synthetic ${field}`);
  }
  decision.providers.paypal.buyerSdkGeneration = fact("javascript-sdk-v6");
  decision.providers.paypal.buyerSdkMerchantBinding = fact(
    "synthetic merchant-bound browser and server proof",
  );
  for (const field of policyFields) decision.policy[field] = fact(`synthetic ${field}`);
  decision.policy.quoteSettlementRule = fact(
    "quote and settlement are independent; refuse unverified conversion",
  );
  decision.approvedOperations = [row("stripe", "supported"), row("paypal", "supported")].map(
    ({ status, evidence, ...operation }) => operation,
  );
  if (validate(decision, adrBytes, true).length)
    throw new Error("synthetic positive control failed");
  const negative = [
    [
      "missing_paypal",
      (d) => {
        delete d.providers.paypal;
      },
    ],
    [
      "one_provider_release",
      (d) => {
        d.releaseProviders = ["stripe"];
      },
    ],
    [
      "pooled_account",
      (d) => {
        d.accountModel = "platform-pooled";
      },
    ],
    [
      "platform_policies",
      (d) => {
        d.shopPolicyOwner = "platform";
      },
    ],
    [
      "one_goods_type",
      (d) => {
        d.goodsScope = ["physical"];
      },
    ],
    [
      "missing_digital_delivery_policy",
      (d) => {
        delete d.policy.digitalDeliveryAndRevocation;
      },
    ],
    [
      "missing_field",
      (d) => {
        delete d.providers.stripe.rawBodySignature;
      },
    ],
    [
      "impossible_provider_evidence_date",
      (d) => {
        d.providers.stripe.rawBodySignature.checkedAt = "2026-02-30";
      },
    ],
    [
      "future_owner_approval_date",
      (d) => {
        d.owner.approval.checkedAt = "2099-01-01";
      },
    ],
    [
      "impossible_matrix_date",
      (d) => {
        d.capabilityMatrix.checkedAt = "2026-13-01";
      },
    ],
    [
      "future_matrix_date",
      (d) => {
        d.capabilityMatrix.checkedAt = "2099-01-01";
      },
    ],
    [
      "missing_paypal_sdk_generation",
      (d) => {
        delete d.providers.paypal.buyerSdkGeneration;
      },
    ],
    [
      "invalid_paypal_sdk_generation",
      (d) => {
        d.providers.paypal.buyerSdkGeneration.value = "unspecified";
      },
    ],
    [
      "missing_paypal_sdk_merchant_binding",
      (d) => {
        delete d.providers.paypal.buyerSdkMerchantBinding;
      },
    ],
    [
      "v5_without_exception",
      (d) => {
        d.providers.paypal.buyerSdkGeneration.value = "javascript-sdk-v5";
      },
    ],
    [
      "stale_adr_hash",
      (d) => {
        d.adr.sha256 = "0".repeat(64);
      },
    ],
    [
      "collapsed_quote_settlement",
      (d) => {
        d.policy.quoteSettlementRule.value = "same currency always";
      },
    ],
    [
      "unsupported_operation",
      (d) => {
        d.approvedOperations[0] = { ...d.approvedOperations[0], sellerCountry: "GB" };
      },
    ],
    [
      "mutated_unsupported_capability",
      (d) => {
        d.capabilityMatrix.entries[0].status = "unsupported";
      },
    ],
    [
      "unverified_operation",
      (d) => {
        d.approvedOperations[0] = { ...d.approvedOperations[0], sellerCountry: "ZZ" };
      },
    ],
    [
      "different_account_type",
      (d) => {
        d.approvedOperations[1].sellerAccountType = "different-type";
      },
    ],
    [
      "different_onboarding_flow",
      (d) => {
        d.approvedOperations[1].onboardingFlow = "after-payment";
      },
    ],
    [
      "different_checkout_product",
      (d) => {
        d.approvedOperations[1].checkoutProduct = "expanded-checkout";
      },
    ],
    [
      "missing_matrix_flow",
      (d) => {
        delete d.capabilityMatrix.entries[1].onboardingFlow;
      },
    ],
    [
      "platform_stock_hold",
      (d) => {
        d.stockHoldPolicy.configuredBy = "platform";
      },
    ],
    [
      "zero_stock_hold",
      (d) => {
        d.stockHoldPolicy.minMinutes = 0;
      },
    ],
    [
      "narrowed_stock_hold",
      (d) => {
        d.stockHoldPolicy.minMinutes = 2;
      },
    ],
    [
      "over_sixty_stock_hold",
      (d) => {
        d.stockHoldPolicy.maxMinutes = 61;
      },
    ],
    [
      "unbounded_stock_hold",
      (d) => {
        d.stockHoldPolicy.maxMinutes = 1441;
      },
    ],
    [
      "missing_expiry_release",
      (d) => {
        d.stockHoldPolicy.onExpiry = "retain";
      },
    ],
    [
      "late_payment_wrong_trigger",
      (d) => {
        d.latePaidUnavailable.trigger = "all_late_payments";
      },
    ],
    [
      "automatic_late_fulfillment",
      (d) => {
        d.latePaidUnavailable.automaticFulfillment = true;
      },
    ],
    [
      "automatic_late_refund",
      (d) => {
        d.latePaidUnavailable.automaticRefund = true;
      },
    ],
    [
      "late_payment_wrong_state",
      (d) => {
        d.latePaidUnavailable.state = "paid";
      },
    ],
    [
      "missing_review_authority",
      (d) => {
        delete d.latePaidUnavailable.reviewAuthority;
      },
    ],
    [
      "wrong_review_authority",
      (d) => {
        d.latePaidUnavailable.reviewAuthority.value = "platform_operator";
      },
    ],
    [
      "missing_review_actions",
      (d) => {
        delete d.latePaidUnavailable.permittedActions;
      },
    ],
    [
      "wrong_review_actions",
      (d) => {
        d.latePaidUnavailable.permittedActions.value = "automatic_refund";
      },
    ],
    [
      "missing_customer_notice",
      (d) => {
        delete d.latePaidUnavailable.customerNotice;
      },
    ],
    [
      "silent_customer_notice",
      (d) => {
        d.latePaidUnavailable.customerNotice.value = "none";
      },
    ],
  ];
  for (const [name, mutate] of negative) {
    const copy = structuredClone(decision);
    mutate(copy);
    if (!validate(copy, adrBytes, true).length)
      throw new Error(`synthetic negative control passed: ${name}`);
  }
  const v5WithException = structuredClone(decision);
  v5WithException.providers.paypal.buyerSdkGeneration.value = "javascript-sdk-v5";
  v5WithException.providers.paypal.v5Exception = fact("synthetic documented exception");
  if (validate(v5WithException, adrBytes, true).length)
    throw new Error("synthetic v5 exception control failed");
  if (!validate(decision, adrBytes).length)
    throw new Error("synthetic marker accepted by real checker");
  if (validate({ status: "pending" }, null).length === 0)
    throw new Error("real pending control passed");
  return negative.length + 3;
}

try {
  if (process.argv.includes("--self-test")) {
    process.stdout.write(
      `${JSON.stringify({ status: "passed", syntheticControls: selfTest(), realDecision: "not_evaluated" })}\n`,
    );
  } else {
    const decision = parsePacket(readFileSync(resolve(root, packetPath), "utf8"));
    let adrBytes = null;
    try {
      adrBytes = readFileSync(resolve(root, adrPath));
    } catch {
      /* missing accepted ADR is a refusal */
    }
    const failures = validate(decision, adrBytes);
    process.stdout.write(
      `${JSON.stringify({ status: failures.length ? "pending" : "accepted", failures })}\n`,
    );
    if (failures.length) process.exitCode = 1;
  }
} catch (error) {
  process.stderr.write(`${JSON.stringify({ status: "failed", reason: String(error) })}\n`);
  process.exitCode = 1;
}
