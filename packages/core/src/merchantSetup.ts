import type { OnlinePresenceSource } from "./onlinePresence";
import { sha256Bytes } from "./webRuntime";

export type MerchantSetupEvidence = { sourceRef: string; quote: string };
export type MerchantSetupProduct = {
  catalogueItemId: string;
  sku: string;
  variant: string;
  goodsKind: "physical" | "digital";
  priceMinor: number;
  stock: { kind: "finite"; onHand: number; reservationTtlMs: number } | { kind: "untracked" };
  digitalDeliverySourceRef?: string;
  evidence: MerchantSetupEvidence[];
};
type CommonPolicy = {
  taxSourceRef: string;
  taxBasisPoints: number;
  refundPolicyRef: string;
  buyerRetentionRef: string;
};
export type MerchantSetup = {
  version: 1;
  sellerCountry: string;
  currency: string;
  countries: string[];
  products: MerchantSetupProduct[];
  policy: {
    sellerOfRecordRef: string;
    taxRounding: "half_up";
    physical?: CommonPolicy & {
      shippingSourceRef: string;
      shippingMinor: number;
      returnsPolicyRef: string;
    };
    digital?: CommonPolicy & { deliveryRef: string; revocationRef: string; noShipping: true };
  };
  automation: {
    autoDigitalDelivery: boolean;
    digitalValidityDays: number;
    buyerRetentionDays: number;
    policyRef: string;
  };
  evidence: MerchantSetupEvidence[];
};
type PartialDraft<T> = T extends readonly (infer E)[]
  ? PartialDraft<E>[]
  : T extends object
    ? { [K in keyof T]?: PartialDraft<T[K]> }
    : T;
/** A draft may be incomplete. Only native approval of a complete, source-bound package creates authority. */
export type MerchantSetupDraft = PartialDraft<MerchantSetup>;
export type MerchantSetupIssue = {
  field: string;
  reason: "missing" | "invalid" | "source_unavailable" | "source_changed" | "unsupported_evidence";
  question: string;
};
export type MerchantSetupBinding = {
  tenantId: string;
  projectId: string;
  version: number;
  contentHash: string;
  catalogueItemIds: readonly string[];
  policyRevision: number;
  automationRevision: number;
  mappings: readonly { catalogueItemId: string; revision: number }[];
  /** Trusted file identity, never a model-provided URL or release grant. */
  digitalSources?: readonly { ref: string; identityHash: string }[];
  products?: readonly {
    catalogueItemId: string;
    productId: string;
    revision: number;
    stockRevision: number;
    preserveStock: boolean;
  }[];
};
const record = (x: unknown): x is Record<string, unknown> =>
  !!x && typeof x === "object" && !Array.isArray(x);
const text = (x: unknown, max = 256): x is string =>
  typeof x === "string" &&
  !!x.trim() &&
  x === x.trim() &&
  x.length <= max &&
  !Array.from(x).some((character) => character.charCodeAt(0) < 32);
const integer = (x: unknown, min: number, max = 1_000_000_000) =>
  Number.isSafeInteger(x) && (x as number) >= min && (x as number) <= max;
const canonical = (x: unknown): unknown =>
  Array.isArray(x)
    ? x.map(canonical)
    : record(x)
      ? Object.fromEntries(
          Object.keys(x)
            .sort()
            .map((key) => [key, canonical(x[key])]),
        )
      : x;
export const merchantSetupHash = (x: unknown): string =>
  sha256Bytes(new TextEncoder().encode(JSON.stringify(canonical(x))));

/** Closed draft fields only; callers must still verify prior snapshot membership and current ownership. */
export function merchantSetupSourceRefs(input: unknown): string[] {
  if (!parseMerchantSetupDraft(input).valid) return [];
  const refs = new Set<string>();
  const visit = (value: unknown) => {
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    if (!record(value)) return;
    for (const [key, child] of Object.entries(value)) {
      if (key.endsWith("Ref") && typeof child === "string") refs.add(child);
      else if (child && typeof child === "object") visit(child);
    }
  };
  visit(input);
  return [...refs];
}

/** Closed draft parser: missing facts may be saved; malformed or unknown fields may not. No defaults. */
export function parseMerchantSetupDraft(input: unknown): {
  valid: boolean;
  missing: MerchantSetupIssue[];
  value?: MerchantSetup;
} {
  if (JSON.stringify(input ?? null).length > 64_000)
    return {
      valid: false,
      missing: [
        {
          field: "shopSetup",
          reason: "invalid",
          question: "Keep the bounded setup draft within 64,000 characters.",
        },
      ],
    };
  const missing: MerchantSetupIssue[] = [];
  const add = (field: string, reason: "missing" | "invalid", question: string) =>
    missing.push({ field, reason, question });
  const obj = (
    x: unknown,
    path: string,
    allowed: readonly string[],
  ): Record<string, unknown> | undefined => {
    if (x === undefined) {
      add(path, "missing", `Provide ${path}.`);
      return;
    }
    if (!record(x)) {
      add(path, "invalid", `Provide structured ${path}.`);
      return;
    }
    for (const key of Object.keys(x))
      if (!allowed.includes(key))
        add(`${path}.${key}`, "invalid", "Use only supported setup fields.");
    return x;
  };
  const check = (
    x: Record<string, unknown>,
    key: string,
    path: string,
    test: (v: unknown) => boolean,
  ) => {
    if (x[key] === undefined) add(`${path}.${key}`, "missing", `Provide ${path}.${key}.`);
    else if (!test(x[key])) add(`${path}.${key}`, "invalid", `Correct ${path}.${key}.`);
  };
  const evidence = (x: unknown, path: string) => {
    if (x === undefined)
      return add(path, "missing", "Provide exact source excerpts for these choices.");
    if (!Array.isArray(x) || x.length < 1 || x.length > 32)
      return add(path, "invalid", "Provide 1–32 bounded source excerpts.");
    x.forEach((item, i) => {
      const row = obj(item, `${path}[${i}]`, ["sourceRef", "quote"]);
      if (!row) return;
      check(row, "sourceRef", `${path}[${i}]`, (v) => text(v));
      check(row, "quote", `${path}[${i}]`, (v) => text(v, 2000));
    });
  };
  const root = obj(input, "shopSetup", [
    "version",
    "sellerCountry",
    "currency",
    "countries",
    "products",
    "policy",
    "automation",
    "evidence",
  ]);
  if (!root) return { valid: !missing.some((i) => i.reason === "invalid"), missing };
  check(root, "version", "shopSetup", (v) => v === 1);
  check(root, "sellerCountry", "shopSetup", (v) => typeof v === "string" && /^[A-Z]{2}$/.test(v));
  check(root, "currency", "shopSetup", (v) => typeof v === "string" && /^[A-Z]{3}$/.test(v));
  check(
    root,
    "countries",
    "shopSetup",
    (v) =>
      Array.isArray(v) &&
      v.length > 0 &&
      v.length <= 249 &&
      new Set(v).size === v.length &&
      v.every((c) => typeof c === "string" && /^[A-Z]{2}$/.test(c)),
  );
  evidence(root.evidence, "shopSetup.evidence");
  if (root.products === undefined)
    add(
      "shopSetup.products",
      "missing",
      "Provide actual physical or digital products and their price, currency and explicit stock policy.",
    );
  else if (!Array.isArray(root.products) || root.products.length < 1 || root.products.length > 20)
    add("shopSetup.products", "invalid", "Provide 1–20 products.");
  else
    root.products.forEach((item, i) => {
      const path = `shopSetup.products[${i}]`;
      const row = obj(item, path, [
        "catalogueItemId",
        "sku",
        "variant",
        "goodsKind",
        "priceMinor",
        "stock",
        "digitalDeliverySourceRef",
        "evidence",
      ]);
      if (!row) return;
      check(row, "catalogueItemId", path, (v) => text(v, 64));
      for (const key of ["sku", "variant"])
        check(
          row,
          key,
          path,
          (v) => typeof v === "string" && v.length <= 64 && /^[a-z0-9]+(?:[-_][a-z0-9]+)*$/.test(v),
        );
      check(row, "goodsKind", path, (v) => v === "physical" || v === "digital");
      check(row, "priceMinor", path, (v) => integer(v, 1));
      evidence(row.evidence, `${path}.evidence`);
      const stock = obj(row.stock, `${path}.stock`, ["kind", "onHand", "reservationTtlMs"]);
      if (stock) {
        check(stock, "kind", `${path}.stock`, (v) => v === "finite" || v === "untracked");
        if (stock.kind === "finite") {
          check(stock, "onHand", `${path}.stock`, (v) => integer(v, 0));
          check(
            stock,
            "reservationTtlMs",
            `${path}.stock`,
            (v) => integer(v, 60_000, 3_600_000) && (v as number) % 60_000 === 0,
          );
        }
        if (
          stock.kind === "untracked" &&
          (stock.onHand !== undefined || stock.reservationTtlMs !== undefined)
        )
          add(
            `${path}.stock`,
            "invalid",
            "Untracked stock cannot include a count or reservation TTL.",
          );
      }
      if (row.goodsKind === "digital")
        check(row, "digitalDeliverySourceRef", path, (v) => text(v) && v.startsWith("vault:"));
      else if (row.digitalDeliverySourceRef !== undefined)
        add(
          `${path}.digitalDeliverySourceRef`,
          "invalid",
          "Physical goods cannot grant digital delivery.",
        );
    });
  const policy = obj(root.policy, "shopSetup.policy", [
    "sellerOfRecordRef",
    "taxRounding",
    "physical",
    "digital",
  ]);
  if (policy) {
    check(policy, "sellerOfRecordRef", "shopSetup.policy", (v) => text(v));
    check(policy, "taxRounding", "shopSetup.policy", (v) => v === "half_up");
    for (const kind of ["physical", "digital"] as const) {
      const required =
        Array.isArray(root.products) &&
        root.products.some((p) => record(p) && p.goodsKind === kind);
      if (policy[kind] === undefined && !required) continue;
      const common = ["taxSourceRef", "taxBasisPoints", "refundPolicyRef", "buyerRetentionRef"];
      const branch = obj(policy[kind], `shopSetup.policy.${kind}`, [
        ...common,
        ...(kind === "physical"
          ? ["shippingSourceRef", "shippingMinor", "returnsPolicyRef"]
          : ["deliveryRef", "revocationRef", "noShipping"]),
      ]);
      if (!branch) continue;
      for (const key of [
        "taxSourceRef",
        "refundPolicyRef",
        "buyerRetentionRef",
        ...(kind === "physical"
          ? ["shippingSourceRef", "returnsPolicyRef"]
          : ["deliveryRef", "revocationRef"]),
      ])
        check(branch, key, `shopSetup.policy.${kind}`, (v) => text(v));
      check(branch, "taxBasisPoints", `shopSetup.policy.${kind}`, (v) => integer(v, 0, 10_000));
      if (kind === "physical")
        check(branch, "shippingMinor", `shopSetup.policy.${kind}`, (v) => integer(v, 0));
      else check(branch, "noShipping", `shopSetup.policy.${kind}`, (v) => v === true);
    }
  }
  const automation = obj(root.automation, "shopSetup.automation", [
    "autoDigitalDelivery",
    "digitalValidityDays",
    "buyerRetentionDays",
    "policyRef",
  ]);
  if (automation) {
    check(automation, "autoDigitalDelivery", "shopSetup.automation", (v) => typeof v === "boolean");
    for (const key of ["digitalValidityDays", "buyerRetentionDays"])
      check(automation, key, "shopSetup.automation", (v) => integer(v, 1, 30));
    check(automation, "policyRef", "shopSetup.automation", (v) => text(v));
    if (
      automation.autoDigitalDelivery === true &&
      Array.isArray(root.products) &&
      !root.products.some((p) => record(p) && p.goodsKind === "digital")
    )
      add(
        "shopSetup.automation.autoDigitalDelivery",
        "invalid",
        "Automatic digital delivery requires digital goods.",
      );
  }
  const valid = !missing.some((i) => i.reason === "invalid");
  return {
    valid,
    missing,
    ...(missing.length === 0 ? { value: JSON.parse(JSON.stringify(input)) as MerchantSetup } : {}),
  };
}

export function assessMerchantSetup(
  input: unknown,
  context: {
    binding: MerchantSetupBinding;
    sources: readonly OnlinePresenceSource[];
    sourceSnapshots: readonly { ref: string; revision: string }[];
  },
):
  | { ready: false; missing: MerchantSetupIssue[] }
  | {
      ready: true;
      setup: MerchantSetup;
      packageHash: string;
      sourceSnapshots: { ref: string; revision: string }[];
    } {
  const parsed = parseMerchantSetupDraft(input);
  if (!parsed.value) return { ready: false, missing: parsed.missing };
  const setup = parsed.value;
  const missing: MerchantSetupIssue[] = [];
  const issue = (field: string, reason: MerchantSetupIssue["reason"], question: string) =>
    missing.push({ field, reason, question });
  const refs = new Set<string>();
  const snapshots = new Map(context.sourceSnapshots.map((s) => [s.ref, s.revision]));
  const source = (ref: string, field: string) => {
    refs.add(ref);
    const s = context.sources.find((s) => s.ref === ref);
    if (!s || s.status !== "approved" || s.intent !== "current" || s.stale || s.truncated) {
      issue(
        field,
        "source_unavailable",
        "Use current owned business evidence or an explicit current user statement.",
      );
      return;
    }
    if (snapshots.get(ref) !== s.revision) {
      issue(
        field,
        "source_changed",
        "Save the package against the current source revision before review.",
      );
      return;
    }
    return s;
  };
  const evidence = (items: MerchantSetupEvidence[], field: string) =>
    items
      .map((item) => {
        const s = source(item.sourceRef, field);
        if (s && !s.text.includes(item.quote))
          issue(
            field,
            "unsupported_evidence",
            "Use an exact excerpt from the selected current source.",
          );
        return item.quote;
      })
      .join("\n");
  const allEvidence = evidence(setup.evidence, "shopSetup.evidence");
  for (const [key, value] of Object.entries({
    sellerCountry: setup.sellerCountry,
    currency: setup.currency,
    ...Object.fromEntries(setup.countries.map((c, i) => [`countries[${i}]`, c])),
  }))
    if (!new RegExp(`\\b${value}\\b`).test(allEvidence))
      issue(
        `shopSetup.${key}`,
        "unsupported_evidence",
        "Include the explicit country/currency choice in the source excerpt.",
      );
  const ids = new Set<string>();
  const skus = new Set<string>();
  const token = (body: string, n: number) =>
    new RegExp(`(^|[^\\d])${String(n).replace(".", "\\.")}([^\\d]|$)`).test(body);
  for (const [i, p] of setup.products.entries()) {
    const path = `shopSetup.products[${i}]`;
    const sku = `${p.sku}:${p.variant}`;
    if (
      ids.has(p.catalogueItemId) ||
      !context.binding.catalogueItemIds.includes(p.catalogueItemId) ||
      skus.has(sku)
    )
      issue(path, "invalid", "Use each actual catalogue item and SKU/variant once.");
    ids.add(p.catalogueItemId);
    skus.add(sku);
    const body = evidence(p.evidence, `${path}.evidence`);
    if (
      !token(body, p.priceMinor) &&
      !(["USD", "EUR", "GBP"].includes(setup.currency) && token(body, p.priceMinor / 100))
    )
      issue(
        `${path}.priceMinor`,
        "unsupported_evidence",
        "Provide the explicit source price; owner review confirms its currency/minor-unit interpretation.",
      );
    if (p.stock.kind === "finite" && !token(body, p.stock.onHand))
      issue(`${path}.stock`, "unsupported_evidence", "Provide the actual stock quantity source.");
    if (p.stock.kind === "untracked" && !/\b(untracked|unlimited|not tracked)\b/i.test(body))
      issue(
        `${path}.stock`,
        "unsupported_evidence",
        "Provide an explicit untracked stock choice; approval is still required.",
      );
    if (p.digitalDeliverySourceRef)
      source(p.digitalDeliverySourceRef, `${path}.digitalDeliverySourceRef`);
  }
  if (ids.size !== context.binding.catalogueItemIds.length)
    issue(
      "shopSetup.products",
      "missing",
      "Prepare authoritative product data for every item in this exact catalogue version.",
    );
  for (const [key, value] of Object.entries(setup.policy)) {
    if (key.endsWith("Ref") && typeof value === "string") source(value, `shopSetup.policy.${key}`);
    if (record(value))
      for (const [k, v] of Object.entries(value))
        if (k.endsWith("Ref") && typeof v === "string") source(v, `shopSetup.policy.${key}.${k}`);
  }
  source(setup.automation.policyRef, "shopSetup.automation.policyRef");
  for (const kind of ["physical", "digital"] as const) {
    const branch = setup.policy[kind];
    if (!branch) continue;
    for (const key of ["taxBasisPoints", ...(kind === "physical" ? ["shippingMinor"] : [])]) {
      const value = (branch as unknown as Record<string, unknown>)[key] as number;
      if (!token(allEvidence, value))
        issue(
          `shopSetup.policy.${kind}.${key}`,
          "unsupported_evidence",
          "Include the explicitly supplied policy amount/rate in the source excerpt; do not assume zero.",
        );
    }
  }
  for (const key of ["digitalValidityDays", "buyerRetentionDays"] as const)
    if (!token(allEvidence, setup.automation[key]))
      issue(
        `shopSetup.automation.${key}`,
        "unsupported_evidence",
        "Provide the explicit validity/retention choice in current source evidence.",
      );
  const deliveryChoice = setup.automation.autoDigitalDelivery
    ? /(?:auto(?:matic)?\s*digital\s*delivery|autoDigitalDelivery)\s*[:=]?\s*(?:true|yes|enabled|on)\b/i
    : /(?:auto(?:matic)?\s*digital\s*delivery|autoDigitalDelivery)\s*[:=]?\s*(?:false|no|disabled|off)\b/i;
  if (!deliveryChoice.test(allEvidence))
    issue(
      "shopSetup.automation.autoDigitalDelivery",
      "unsupported_evidence",
      "Provide an explicit automatic digital delivery enabled/disabled choice. No standing consent is inferred.",
    );
  if (missing.length) return { ready: false, missing };
  const selected = [...refs].sort().map((ref) => ({ ref, revision: snapshots.get(ref)! }));
  return {
    ready: true,
    setup,
    sourceSnapshots: selected,
    packageHash: merchantSetupHash({ binding: context.binding, setup, sourceSnapshots: selected }),
  };
}
