import type {
  MerchantActionAuthorization,
  MerchantBuyerNotice,
  MerchantCapability,
  MerchantCheckoutAttempt,
  MerchantFailure,
  MerchantFulfilment,
  MerchantInventoryOutcome,
  MerchantOperation,
  MerchantProvider,
  MerchantRefundAttempt,
  MerchantResult,
  NormalizedMerchantPaymentReceipt,
  NormalizedMerchantRefundReceipt,
} from "@pikar/contracts/tenantCommerce";
import { sha256Bytes } from "./webRuntime";

const fail = (reason: MerchantFailure) => ({ ok: false as const, reason });
const ref = (value: unknown): value is string =>
  typeof value === "string" &&
  value.trim().length > 0 &&
  value.length <= 256 &&
  [...value].every((character) => character.charCodeAt(0) >= 32 && character.charCodeAt(0) !== 127);
const opaqueRef = (value: unknown): value is string =>
  ref(value) && !/[\s@]/.test(value) && !value.includes("://");
const minor = (value: unknown): value is number =>
  Number.isSafeInteger(value) && (value as number) >= 0;
const time = (value: unknown): value is number =>
  Number.isSafeInteger(value) && (value as number) >= 0;
const currency = (value: unknown): value is string =>
  typeof value === "string" && /^[A-Z]{3}$/.test(value);
const country = (value: unknown): value is string =>
  typeof value === "string" && /^[A-Z]{2}$/.test(value);
const quoteHash = (value: unknown): value is string =>
  typeof value === "string" && /^sha256:[a-f0-9]{64}$/.test(value);
const provider = (value: unknown): value is MerchantProvider =>
  value === "stripe" || value === "paypal";
/** Exact primitive tuple hashing; never hashes buyer/card/credential content. */
export const merchantActionHash = (tuple: readonly (string | number)[]): string =>
  `sha256:${sha256Bytes(new TextEncoder().encode(JSON.stringify(tuple)))}`;
const key = (purpose: string, tuple: readonly (string | number)[]) =>
  `merchant:${purpose}:v1:${merchantActionHash(tuple).slice(7)}`;

export function admitMerchantCheckout(
  capability: MerchantCapability,
  request: {
    tenantId: string;
    provider: MerchantProvider;
    environment: "test" | "live";
    sellerCountry: string;
    buyerCountry: string;
    currency: string;
    settlementCurrency: string;
    now: number;
    operation?: "checkout" | "refund";
  },
): MerchantResult<MerchantCapability> {
  if (
    !capability ||
    !request ||
    !ref(request.tenantId) ||
    !time(request.now) ||
    !provider(request.provider) ||
    (request.operation !== undefined && !["checkout", "refund"].includes(request.operation))
  )
    return fail("configuration_required");
  if (request.environment !== "test" || capability.environment !== "test")
    return fail("live_mode_disabled");
  if (capability.tenantId !== request.tenantId || capability.provider !== request.provider)
    return fail("foreign");
  if (
    !ref(capability.merchantAccountRef) ||
    !ref(capability.providerAccountRef) ||
    !ref(capability.evidenceRef) ||
    capability.status !== "verified" ||
    !time(capability.verifiedAt) ||
    !time(capability.expiresAt) ||
    capability.verifiedAt > request.now ||
    capability.expiresAt <= request.now ||
    capability.flow !==
      (request.provider === "stripe" ? "stripe_connect_direct" : "paypal_merchant_checkout") ||
    !Array.isArray(capability.operations) ||
    !capability.operations.includes(request.operation ?? "checkout")
  )
    return fail("configuration_required");
  if (
    !country(request.sellerCountry) ||
    !country(request.buyerCountry) ||
    capability.sellerCountry !== request.sellerCountry ||
    !Array.isArray(capability.buyerCountries) ||
    !capability.buyerCountries.includes(request.buyerCountry)
  )
    return fail("unsupported_country");
  if (
    !currency(request.currency) ||
    !currency(request.settlementCurrency) ||
    !Array.isArray(capability.presentmentCurrencies) ||
    !capability.presentmentCurrencies.includes(request.currency) ||
    !Array.isArray(capability.settlementCurrencies) ||
    !capability.settlementCurrencies.includes(request.settlementCurrency)
  )
    return fail("unsupported_currency");
  return { ok: true, value: capability };
}

export function prepareMerchantCheckout(input: {
  capability: MerchantCapability;
  tenantId: string;
  provider: MerchantProvider;
  environment: "test" | "live";
  sellerCountry: string;
  buyerCountry: string;
  currency: string;
  settlementCurrency: string;
  now: number;
  orderId: string;
  attemptId: string;
  quoteHash: string;
  totalMinor: number;
  expiresAt: number;
  existingAttempt?: MerchantCheckoutAttempt;
}): MerchantResult<MerchantCheckoutAttempt> {
  const admitted = admitMerchantCheckout(input.capability, input);
  if (!admitted.ok) return admitted;
  if (
    ![input.orderId, input.attemptId].every(ref) ||
    !quoteHash(input.quoteHash) ||
    !minor(input.totalMinor) ||
    input.totalMinor === 0
  )
    return fail("invalid_amount");
  if (!time(input.expiresAt) || input.expiresAt <= input.now) return fail("expired");
  const capability = admitted.value;
  const idempotencyKey = key("checkout", [
    input.tenantId,
    input.provider,
    input.environment,
    capability.providerAccountRef,
    input.orderId,
    input.attemptId,
    input.quoteHash,
    input.currency,
    input.totalMinor,
  ]);
  if (input.existingAttempt) {
    if (
      input.existingAttempt.tenantId !== input.tenantId ||
      input.existingAttempt.provider !== input.provider ||
      input.existingAttempt.environment !== input.environment ||
      input.existingAttempt.merchantAccountRef !== capability.merchantAccountRef ||
      input.existingAttempt.providerAccountRef !== capability.providerAccountRef
    )
      return fail("foreign");
    if (input.existingAttempt.idempotencyKey !== idempotencyKey) return fail("payment_conflict");
    if (input.existingAttempt.status === "unknown") return fail("unknown_outcome");
    return { ok: true, value: input.existingAttempt };
  }
  return {
    ok: true,
    value: {
      tenantId: input.tenantId,
      provider: input.provider,
      environment: input.environment,
      merchantAccountRef: capability.merchantAccountRef,
      providerAccountRef: capability.providerAccountRef,
      orderId: input.orderId,
      attemptId: input.attemptId,
      quoteHash: input.quoteHash,
      currency: input.currency,
      totalMinor: input.totalMinor,
      idempotencyKey,
      expiresAt: input.expiresAt,
      status: "pending",
      events: [],
    },
  };
}

const verified = (value: NormalizedMerchantPaymentReceipt["verification"]) =>
  !!value && ["signed_webhook", "provider_read"].includes(value.method) && ref(value.evidenceRef);
const bound = (
  attempt: MerchantCheckoutAttempt | MerchantRefundAttempt,
  receipt: NormalizedMerchantPaymentReceipt | NormalizedMerchantRefundReceipt,
) =>
  attempt.tenantId === receipt.tenantId &&
  attempt.provider === receipt.provider &&
  attempt.environment === receipt.environment &&
  attempt.merchantAccountRef === receipt.merchantAccountRef &&
  attempt.providerAccountRef === receipt.providerAccountRef &&
  attempt.orderId === receipt.orderId;
const observed = (
  events: MerchantCheckoutAttempt["events"],
  eventRef: string,
  fingerprint: string,
): MerchantResult<boolean> => {
  const prior = events.find((event) => event.eventRef === eventRef);
  if (prior)
    return prior.fingerprint === fingerprint ? { ok: true, value: true } : fail("event_conflict");
  return events.length >= 1000 ? fail("invalid_receipt") : { ok: true, value: false };
};

/** The adapter must call this before consuming inventory, inside its atomic event transaction. */
export function validateMerchantPaymentReceipt(
  attempt: MerchantCheckoutAttempt,
  receipt: NormalizedMerchantPaymentReceipt,
): MerchantResult<{ duplicate: boolean; fingerprint: string }> {
  if (!attempt || !receipt || !bound(attempt, receipt)) return fail("foreign");
  if (attempt.environment !== "test") return fail("live_mode_disabled");
  if (
    !verified(receipt.verification) ||
    !ref(receipt.eventRef) ||
    !ref(receipt.attemptId) ||
    !["pending", "succeeded", "failed", "cancelled"].includes(receipt.outcome)
  )
    return fail("invalid_receipt");
  if (
    receipt.attemptId !== attempt.attemptId ||
    receipt.quoteHash !== attempt.quoteHash ||
    receipt.currency !== attempt.currency ||
    !minor(receipt.amountMinor) ||
    receipt.amountMinor !== attempt.totalMinor
  )
    return fail("payment_conflict");
  if (receipt.outcome === "succeeded" && !ref(receipt.paymentRef)) return fail("invalid_receipt");
  if (attempt.paymentRef && receipt.paymentRef && attempt.paymentRef !== receipt.paymentRef)
    return fail("payment_conflict");
  const fingerprint = merchantActionHash([
    receipt.tenantId,
    receipt.provider,
    receipt.environment,
    receipt.providerAccountRef,
    receipt.orderId,
    receipt.attemptId,
    receipt.quoteHash,
    receipt.currency,
    receipt.amountMinor,
    receipt.outcome,
    receipt.paymentRef ?? "",
  ]);
  const duplicate = observed(attempt.events, receipt.eventRef, fingerprint);
  return duplicate.ok
    ? { ok: true, value: { duplicate: duplicate.value, fingerprint } }
    : duplicate;
}

export function transitionMerchantPayment(
  attempt: MerchantCheckoutAttempt,
  receipt: NormalizedMerchantPaymentReceipt,
  inventoryOutcome?: MerchantInventoryOutcome,
): MerchantResult<{
  attempt: MerchantCheckoutAttempt;
  duplicate: boolean;
  fulfilmentAllowed: boolean;
  merchantReviewRequired: boolean;
}> {
  const checked = validateMerchantPaymentReceipt(attempt, receipt);
  if (!checked.ok) return checked;
  if (checked.value.duplicate)
    return {
      ok: true,
      value: {
        attempt,
        duplicate: true,
        fulfilmentAllowed: false,
        merchantReviewRequired: attempt.status === "merchant_review",
      },
    };
  const events = [
    ...attempt.events,
    { eventRef: receipt.eventRef, fingerprint: checked.value.fingerprint },
  ];
  if (receipt.outcome !== "succeeded") {
    const terminal = ["paid", "merchant_review", "expired", "cancelled"].includes(attempt.status);
    const status =
      terminal || receipt.outcome === "pending"
        ? attempt.status
        : receipt.outcome === "cancelled"
          ? "cancelled"
          : "failed";
    return {
      ok: true,
      value: {
        attempt: { ...attempt, status, events },
        duplicate: false,
        fulfilmentAllowed: false,
        merchantReviewRequired: status === "merchant_review",
      },
    };
  }
  if (attempt.status === "paid" || attempt.status === "merchant_review")
    return {
      ok: true,
      value: {
        attempt: { ...attempt, events },
        duplicate: false,
        fulfilmentAllowed: false,
        merchantReviewRequired: attempt.status === "merchant_review",
      },
    };
  if (
    !inventoryOutcome ||
    !["consumed", "late_paid_exception", "released_paid_exception", "unavailable"].includes(
      inventoryOutcome,
    )
  )
    return fail("configuration_required");
  const reviewReason =
    inventoryOutcome === "released_paid_exception"
      ? "released_hold"
      : inventoryOutcome === "unavailable"
        ? "stock_unavailable"
        : inventoryOutcome === "late_paid_exception" ||
            attempt.status === "expired" ||
            attempt.status === "cancelled"
          ? "late_payment"
          : undefined;
  const next: MerchantCheckoutAttempt = {
    ...attempt,
    status: reviewReason ? "merchant_review" : "paid",
    paymentRef: receipt.paymentRef,
    events,
    ...(reviewReason ? { reviewReason } : {}),
  };
  return {
    ok: true,
    value: {
      attempt: next,
      duplicate: false,
      fulfilmentAllowed: !reviewReason,
      merchantReviewRequired: !!reviewReason,
    },
  };
}

function authorized(
  authorization: MerchantActionAuthorization,
  tenantId: string,
  operation: MerchantOperation,
  subjectRef: string,
  actionHash: string,
  now: number,
): boolean {
  return (
    !!authorization &&
    ref(authorization.ref) &&
    authorization.tenantId === tenantId &&
    authorization.operation === operation &&
    ["merchant_admin", "standing_policy"].includes(authorization.kind) &&
    authorization.subjectRef === subjectRef &&
    authorization.actionHash === actionHash &&
    time(now) &&
    time(authorization.expiresAt) &&
    authorization.expiresAt > now
  );
}
export function merchantRefundActionHash(input: {
  tenantId: string;
  provider: MerchantProvider;
  environment: "test" | "live";
  merchantAccountRef: string;
  providerAccountRef: string;
  orderId: string;
  paymentRef: string;
  refundId: string;
  amountMinor: number;
  currency: string;
}): string {
  return merchantActionHash([
    "refund",
    input.tenantId,
    input.provider,
    input.environment,
    input.merchantAccountRef,
    input.providerAccountRef,
    input.orderId,
    input.paymentRef,
    input.refundId,
    input.amountMinor,
    input.currency,
  ]);
}
/** Pending/unknown refund amounts must remain reserved in the adapter transaction. */
export function admitMerchantOperation(
  capability: MerchantCapability,
  attempt: MerchantCheckoutAttempt,
  operation: "refund",
  now: number,
): MerchantResult<MerchantCapability> {
  if (!capability || !attempt || !time(now) || operation !== "refund")
    return fail("configuration_required");
  if (capability.environment !== "test" || attempt.environment !== "test")
    return fail("live_mode_disabled");
  if (
    capability.tenantId !== attempt.tenantId ||
    capability.provider !== attempt.provider ||
    capability.merchantAccountRef !== attempt.merchantAccountRef ||
    capability.providerAccountRef !== attempt.providerAccountRef
  )
    return fail("foreign");
  if (
    capability.status !== "verified" ||
    capability.flow !==
      (attempt.provider === "stripe" ? "stripe_connect_direct" : "paypal_merchant_checkout") ||
    !ref(capability.evidenceRef) ||
    !time(capability.verifiedAt) ||
    capability.verifiedAt > now ||
    !time(capability.expiresAt) ||
    capability.expiresAt <= now ||
    !Array.isArray(capability.operations) ||
    !capability.operations.includes(operation)
  )
    return fail("configuration_required");
  return { ok: true, value: capability };
}
export function prepareMerchantRefund(
  attempt: MerchantCheckoutAttempt,
  input: {
    capability: MerchantCapability;
    refundId: string;
    amountMinor: number;
    alreadyRefundedMinor: number;
    reservedRefundMinor: number;
    authorization: MerchantActionAuthorization;
    now: number;
  },
): MerchantResult<MerchantRefundAttempt> {
  const admitted = admitMerchantOperation(input.capability, attempt, "refund", input.now);
  if (!admitted.ok) return admitted;
  if (attempt.environment !== "test") return fail("live_mode_disabled");
  if (!["paid", "merchant_review"].includes(attempt.status) || !ref(attempt.paymentRef))
    return fail("payment_not_confirmed");
  if (
    !ref(input.refundId) ||
    !minor(attempt.totalMinor) ||
    !minor(input.amountMinor) ||
    input.amountMinor === 0 ||
    !minor(input.alreadyRefundedMinor) ||
    !minor(input.reservedRefundMinor)
  )
    return fail("invalid_amount");
  const remaining =
    BigInt(attempt.totalMinor) -
    BigInt(input.alreadyRefundedMinor) -
    BigInt(input.reservedRefundMinor);
  if (BigInt(input.amountMinor) > remaining) return fail("refund_exceeds_paid");
  const action = {
    tenantId: attempt.tenantId,
    provider: attempt.provider,
    environment: attempt.environment,
    merchantAccountRef: attempt.merchantAccountRef,
    providerAccountRef: attempt.providerAccountRef,
    orderId: attempt.orderId,
    paymentRef: attempt.paymentRef,
    refundId: input.refundId,
    amountMinor: input.amountMinor,
    currency: attempt.currency,
  };
  if (
    input.authorization?.kind !== "merchant_admin" ||
    !authorized(
      input.authorization,
      attempt.tenantId,
      "refund",
      attempt.orderId,
      merchantRefundActionHash(action),
      input.now,
    )
  )
    return fail("approval_required");
  return {
    ok: true,
    value: {
      ...action,
      idempotencyKey: key("refund", [
        attempt.tenantId,
        attempt.provider,
        attempt.environment,
        attempt.providerAccountRef,
        attempt.orderId,
        attempt.paymentRef,
        input.refundId,
        input.amountMinor,
        attempt.currency,
      ]),
      authorizationRef: input.authorization.ref,
      status: "pending",
      events: [],
    },
  };
}

export function transitionMerchantRefund(
  attempt: MerchantRefundAttempt,
  receipt: NormalizedMerchantRefundReceipt,
): MerchantResult<{
  attempt: MerchantRefundAttempt;
  duplicate: boolean;
  newlyRefundedMinor: number;
}> {
  if (!attempt || !receipt || !bound(attempt, receipt)) return fail("foreign");
  if (attempt.environment !== "test") return fail("live_mode_disabled");
  if (
    !verified(receipt.verification) ||
    !ref(receipt.eventRef) ||
    !ref(receipt.providerRefundRef) ||
    !["pending", "succeeded", "failed"].includes(receipt.outcome)
  )
    return fail("invalid_receipt");
  if (
    attempt.refundId !== receipt.refundId ||
    attempt.paymentRef !== receipt.paymentRef ||
    attempt.currency !== receipt.currency ||
    !minor(receipt.amountMinor) ||
    attempt.amountMinor !== receipt.amountMinor ||
    (attempt.providerRefundRef && attempt.providerRefundRef !== receipt.providerRefundRef)
  )
    return fail("payment_conflict");
  const fingerprint = merchantActionHash([
    receipt.provider,
    receipt.environment,
    receipt.providerAccountRef,
    receipt.orderId,
    receipt.paymentRef,
    receipt.refundId,
    receipt.providerRefundRef,
    receipt.currency,
    receipt.amountMinor,
    receipt.outcome,
  ]);
  const duplicate = observed(attempt.events, receipt.eventRef, fingerprint);
  if (!duplicate.ok) return duplicate;
  if (duplicate.value)
    return { ok: true, value: { attempt, duplicate: true, newlyRefundedMinor: 0 } };
  const status =
    attempt.status === "succeeded"
      ? "succeeded"
      : receipt.outcome === "pending"
        ? attempt.status
        : receipt.outcome;
  return {
    ok: true,
    value: {
      attempt: {
        ...attempt,
        status,
        providerRefundRef: receipt.providerRefundRef,
        events: [...attempt.events, { eventRef: receipt.eventRef, fingerprint }],
      },
      duplicate: false,
      newlyRefundedMinor:
        status === "succeeded" && attempt.status !== "succeeded" ? attempt.amountMinor : 0,
    },
  };
}

export function merchantFulfilmentActionHash(input: {
  tenantId: string;
  orderId: string;
  fulfilmentId: string;
  kind: MerchantFulfilment["kind"];
  policyRef: string;
  targetRef: string;
  expiresAt?: number;
}): string {
  return merchantActionHash([
    "fulfilment",
    input.tenantId,
    input.orderId,
    input.fulfilmentId,
    input.kind,
    input.policyRef,
    input.targetRef,
    input.expiresAt ?? 0,
  ]);
}
export function prepareMerchantFulfilment(
  attempt: MerchantCheckoutAttempt,
  input: {
    fulfilmentId: string;
    kind: MerchantFulfilment["kind"];
    goodsKind: "physical" | "digital";
    policyRef: string;
    targetRef: string;
    expiresAt?: number;
    refundedMinor: number;
    authorization: MerchantActionAuthorization;
    now: number;
  },
): MerchantResult<MerchantFulfilment> {
  if (attempt.environment !== "test") return fail("live_mode_disabled");
  if (attempt.status === "merchant_review") return fail("review_required");
  if (attempt.status !== "paid" || !ref(attempt.paymentRef)) return fail("payment_not_confirmed");
  if (!minor(input.refundedMinor) || input.refundedMinor > 0) return fail("review_required");
  if (
    !["physical_shipment", "digital_entitlement"].includes(input.kind) ||
    ![input.fulfilmentId, input.policyRef].every(ref) ||
    !opaqueRef(input.targetRef) ||
    !time(input.now)
  )
    return fail("configuration_required");
  if (input.goodsKind !== (input.kind === "physical_shipment" ? "physical" : "digital"))
    return fail("configuration_required");
  if (input.expiresAt !== undefined && (!time(input.expiresAt) || input.expiresAt <= input.now))
    return fail("expired");
  const action = {
    tenantId: attempt.tenantId,
    orderId: attempt.orderId,
    fulfilmentId: input.fulfilmentId,
    kind: input.kind,
    policyRef: input.policyRef,
    targetRef: input.targetRef,
    ...(input.expiresAt === undefined ? {} : { expiresAt: input.expiresAt }),
  };
  if (
    !authorized(
      input.authorization,
      attempt.tenantId,
      input.kind,
      attempt.orderId,
      merchantFulfilmentActionHash(action),
      input.now,
    )
  )
    return fail("approval_required");
  return {
    ok: true,
    value: {
      ...action,
      paymentRef: attempt.paymentRef,
      idempotencyKey: key("fulfilment", [
        attempt.tenantId,
        attempt.orderId,
        input.fulfilmentId,
        input.kind,
      ]),
      authorizationRef: input.authorization.ref,
      status: "prepared",
    },
  };
}

/** Receipt evidence is produced by a trusted delivery adapter or a recorded merchant handoff. */
export function transitionMerchantFulfilment(
  state: MerchantFulfilment,
  receipt: {
    tenantId: string;
    orderId: string;
    fulfilmentId: string;
    status: "pending" | "unknown" | "succeeded" | "failed" | "revoked";
    evidenceRef: string;
  },
): MerchantResult<MerchantFulfilment> {
  if (
    state.tenantId !== receipt.tenantId ||
    state.orderId !== receipt.orderId ||
    state.fulfilmentId !== receipt.fulfilmentId
  )
    return fail("foreign");
  if (
    !ref(receipt.evidenceRef) ||
    !["pending", "unknown", "succeeded", "failed", "revoked"].includes(receipt.status)
  )
    return fail("invalid_receipt");
  if (state.status === "revoked" && receipt.status !== "revoked") return fail("invalid_transition");
  if (state.status === "succeeded" && !["succeeded", "revoked"].includes(receipt.status))
    return fail("invalid_transition");
  if (
    receipt.status === "revoked" &&
    (state.kind !== "digital_entitlement" ||
      (state.status !== "succeeded" && state.status !== "revoked"))
  )
    return fail("invalid_transition");
  return {
    ok: true,
    value: { ...state, status: receipt.status, evidenceRef: receipt.evidenceRef },
  };
}

export function digitalEntitlementAccessible(
  state: MerchantFulfilment,
  input: { tenantId: string; orderId: string; now: number },
): boolean {
  return (
    state.tenantId === input.tenantId &&
    state.orderId === input.orderId &&
    state.kind === "digital_entitlement" &&
    state.status === "succeeded" &&
    time(input.now) &&
    (state.expiresAt === undefined || state.expiresAt > input.now)
  );
}

/** Preparation only: no email address, free-form message, send operation or invented delivery claim. */
export function prepareMerchantNotice(
  attempt: MerchantCheckoutAttempt,
  input: {
    customerRef: string;
    policyRef: string;
    stateEvidenceRef: string;
    template: MerchantBuyerNotice["template"];
    fulfilment?: MerchantFulfilment;
    refund?: MerchantRefundAttempt;
  },
): MerchantResult<MerchantBuyerNotice> {
  if (!opaqueRef(input.customerRef) || ![input.policyRef, input.stateEvidenceRef].every(ref))
    return fail("configuration_required");
  const fulfilment = input.fulfilment;
  const sameFulfilment =
    !!fulfilment &&
    fulfilment.tenantId === attempt.tenantId &&
    fulfilment.orderId === attempt.orderId &&
    fulfilment.paymentRef === attempt.paymentRef &&
    fulfilment.status === "succeeded";
  const sameRefund =
    !!input.refund &&
    input.refund.tenantId === attempt.tenantId &&
    input.refund.orderId === attempt.orderId &&
    input.refund.paymentRef === attempt.paymentRef &&
    input.refund.status === "succeeded";
  const allowed =
    input.template === "payment_received"
      ? attempt.status === "paid"
      : input.template === "merchant_review"
        ? attempt.status === "merchant_review"
        : input.template === "shipment_dispatched"
          ? sameFulfilment && fulfilment?.kind === "physical_shipment"
          : input.template === "digital_ready"
            ? sameFulfilment && fulfilment?.kind === "digital_entitlement"
            : input.template === "refund_completed" && sameRefund;
  if (!allowed) return fail("invalid_transition");
  return {
    ok: true,
    value: {
      tenantId: attempt.tenantId,
      orderId: attempt.orderId,
      customerRef: input.customerRef,
      template: input.template,
      policyRef: input.policyRef,
      stateEvidenceRef: input.stateEvidenceRef,
      idempotencyKey: key("notice", [
        attempt.tenantId,
        attempt.orderId,
        input.customerRef,
        input.template,
        input.stateEvidenceRef,
      ]),
      status: "prepared",
    },
  };
}
