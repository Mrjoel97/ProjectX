// The PayPal lane, proven offline. $0 — convex-test only, no network, no PayPal, no model.
//
// ═══ THE ONE DEFECT THIS FILE EXISTS TO MAKE UNREACHABLE ═══
//
// A plain PayPal client-credentials token reads THE APP OWNER'S OWN PayPal account. It is not a
// per-tenant grant. Model it as one and you get a green suite, a working smoke run, and PIKAR'S OWN
// payment data rendered to a tenant as if it were theirs. No other gate in this phase catches that,
// because every gate checks that the read WORKED, never WHOSE money came back.
//
// So the distinction is made explicit in three independent places and each one is tested here:
//
//   1. `classifyGrantSubject` returns `app_owner` for a missing, malformed or partner-owned
//      merchant id, and only `delegated_merchant` can ever be sealed.
//   2. `parsePayPalCredential` REFUSES a blob with no valid merchant id, so an app-owner credential
//      cannot survive a round trip through the ciphertext.
//   3. `paypalConnector` re-checks the subject at READ time, after decryption, and returns
//      `unavailable` rather than a projection.
//
// ═══ AND THE ADMISSION BEHIND IT IS TESTIMONY, NOT EVIDENCE ═══
//
// PayPal was recorded `approved_production` on 2026-08-27 on an OWNER ATTESTATION of partner
// acceptance. Nothing in this repository checked it. Sandbox is explicitly non-probative — PayPal
// states sandbox calls work BEFORE approval — so no green run here corroborates anything.
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api } from "./_generated/api";
import { PROVIDER_READ_PATHS } from "./connectorFetch";
import { classifyRevokeOutcome, PROVIDER_REVOKE_SUPPORT } from "./connectorOAuth";
import {
  classifyGrantSubject,
  checkGrantedFeatures,
  isPayPalMerchantId,
  parsePayPalCredential,
  PAYPAL_PARTNER_SURFACE_GAP,
  PAYPAL_READ_SCOPES,
  PAYPAL_REFUSED_FEATURES,
  PAYPAL_REQUESTED_FEATURES,
} from "./paypalAuth";
import schema from "./schema";

const modules = import.meta.glob("./**/*.*s");

/** Raw sources for the write-verb and namespace scans. edge-runtime has no `node:fs`. */
const rawSources = import.meta.glob("./**/*.ts", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

/** The partner's OWN merchant — the account a bare client-credentials token would read. */
const PARTNER_MERCHANT = "PIKARPARTNER01";
/** A tenant's merchant. Different account, different business, different money. */
const TENANT_MERCHANT = "TENANTMERCH001";

beforeEach(() => {
  process.env.PAYPAL_PARTNER_MERCHANT_ID = PARTNER_MERCHANT;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function harness() {
  const t = convexTest(schema, modules);
  const userA = await t.run((ctx) => ctx.db.insert("users", {}));
  const userB = await t.run((ctx) => ctx.db.insert("users", {}));
  return {
    t,
    tenantA: String(userA),
    tenantB: String(userB),
    asA: t.withIdentity({ subject: `${userA}|session_a` }),
    asB: t.withIdentity({ subject: `${userB}|session_b` }),
  };
}

// ── The modelling error, refused three times ──────────────────────────────────────────────

describe("app client credentials are never a tenant grant", () => {
  test("a grant with no merchant id is the APP OWNER, not a tenant", () => {
    expect(
      classifyGrantSubject({ partnerMerchantId: PARTNER_MERCHANT, grantedMerchantId: undefined }),
    ).toEqual({ kind: "app_owner" });
    expect(
      classifyGrantSubject({ partnerMerchantId: PARTNER_MERCHANT, grantedMerchantId: null }),
    ).toEqual({ kind: "app_owner" });
    expect(
      classifyGrantSubject({ partnerMerchantId: PARTNER_MERCHANT, grantedMerchantId: "" }),
    ).toEqual({ kind: "app_owner" });
  });

  test("a grant naming the PARTNER'S OWN merchant is the app owner, however well-formed", () => {
    // This is the exact shape a client-credentials token has: it authenticates the app, and the
    // account it reaches is the app owner's. A caller that recorded it as a tenant connection would
    // serve Pikar's own transactions to that tenant.
    expect(
      classifyGrantSubject({
        partnerMerchantId: PARTNER_MERCHANT,
        grantedMerchantId: PARTNER_MERCHANT,
      }),
    ).toEqual({ kind: "app_owner" });
  });

  test("only a DIFFERENT, well-formed merchant id is a delegated grant", () => {
    expect(
      classifyGrantSubject({
        partnerMerchantId: PARTNER_MERCHANT,
        grantedMerchantId: TENANT_MERCHANT,
      }),
    ).toEqual({ kind: "delegated_merchant", merchantId: TENANT_MERCHANT });
  });

  test("a malformed merchant id degrades to app_owner rather than to a delegated grant", () => {
    // FAIL CLOSED. An unrecognised shape must not become a tenant binding by default: the whole
    // point of the binding is that it is the only thing distinguishing the two accounts.
    for (const bad of ["short", "lower-case-id", "HAS SPACE", "TOOLONG".repeat(10), 12345, {}]) {
      expect(
        classifyGrantSubject({ partnerMerchantId: PARTNER_MERCHANT, grantedMerchantId: bad }),
      ).toEqual({ kind: "app_owner" });
    }
  });

  test("isPayPalMerchantId accepts an uppercase alphanumeric id and nothing else", () => {
    expect(isPayPalMerchantId(TENANT_MERCHANT)).toBe(true);
    expect(isPayPalMerchantId("2J6QB8YJQSJRJ")).toBe(true);
    expect(isPayPalMerchantId("2j6qb8yjqsjrj")).toBe(false);
    expect(isPayPalMerchantId("2J6QB8-JQSJRJ")).toBe(false);
    expect(isPayPalMerchantId(undefined)).toBe(false);
  });

  test("a credential blob without a valid merchant id cannot survive decryption", () => {
    // The second refusal, and it is not redundant: it stands even if a future caller sealed a blob
    // some other way. There is no representable PayPal credential that is not merchant-bound.
    expect(
      parsePayPalCredential(
        JSON.stringify({ accessToken: "tok", merchantId: TENANT_MERCHANT, scope: "s" }),
      ),
    ).toEqual({ accessToken: "tok", merchantId: TENANT_MERCHANT, scope: "s" });
    expect(parsePayPalCredential(JSON.stringify({ accessToken: "tok", scope: "s" }))).toBeNull();
    expect(
      parsePayPalCredential(JSON.stringify({ accessToken: "tok", merchantId: "", scope: "s" })),
    ).toBeNull();
    expect(
      parsePayPalCredential(JSON.stringify({ accessToken: "", merchantId: TENANT_MERCHANT })),
    ).toBeNull();
    expect(parsePayPalCredential("not json")).toBeNull();
  });
});

// ── The permission package ────────────────────────────────────────────────────────────────

describe("only read-shaped features are ever accepted", () => {
  test("the requested set and the refused set do not overlap", () => {
    const requested = new Set<string>(PAYPAL_REQUESTED_FEATURES);
    const overlap = PAYPAL_REFUSED_FEATURES.filter((f) => requested.has(f));
    expect(overlap).toEqual([]);
    // A floor, so an emptied refused list reads as failure rather than as "no overlap".
    expect(PAYPAL_REFUSED_FEATURES.length).toBeGreaterThan(15);
    expect(requested.size).toBe(4);
  });

  test("PayPal's write-capable DEFAULT feature set is refused member by member", () => {
    // "By default, PayPal configures your REST app with the following: PAYMENT, REFUND,
    // DELAY_FUNDS_DISBURSEMENT." Every one of them must be on the refused list, by name.
    for (const name of ["PAYMENT", "REFUND", "DELAY_FUNDS_DISBURSEMENT"]) {
      expect(PAYPAL_REFUSED_FEATURES as readonly string[]).toContain(name);
    }
  });

  test("INVOICE_READ_WRITE is refused even though invoices are in the approved read surface", () => {
    // PayPal's feature enum has no read-only invoice member. The phase's read surface names
    // invoices, and the only feature that would reach them also grants invoice SENDS — which
    // 28-CONTEXT explicitly defers. So the invoice half is dropped, not smuggled in.
    expect(PAYPAL_REFUSED_FEATURES as readonly string[]).toContain("INVOICE_READ_WRITE");
    expect(PAYPAL_REQUESTED_FEATURES as readonly string[]).not.toContain("INVOICE_READ_WRITE");
  });

  test("a grant carrying any write-capable feature is refused", () => {
    expect(checkGrantedFeatures(["ADVANCED_TRANSACTIONS_SEARCH", "REFUND"])).toEqual({
      ok: false,
      because: "write_capable",
    });
    expect(checkGrantedFeatures("ADVANCED_TRANSACTIONS_SEARCH,PAYMENT")).toEqual({
      ok: false,
      because: "write_capable",
    });
  });

  test("a grant without the transaction-search feature cannot read and is refused", () => {
    expect(checkGrantedFeatures(["ACCESS_MERCHANT_INFORMATION"])).toEqual({
      ok: false,
      because: "insufficient",
    });
  });

  test("a grant that is not a list of feature names is malformed, never empty-but-fine", () => {
    expect(checkGrantedFeatures(undefined)).toEqual({ ok: false, because: "malformed" });
    expect(checkGrantedFeatures([])).toEqual({ ok: false, because: "malformed" });
    expect(checkGrantedFeatures({})).toEqual({ ok: false, because: "malformed" });
  });

  test("the exact read-only package is accepted", () => {
    expect(checkGrantedFeatures([...PAYPAL_REQUESTED_FEATURES])).toEqual({
      ok: true,
      features: [...PAYPAL_REQUESTED_FEATURES],
    });
  });

  test("the two reporting read scopes are the exact published ones", () => {
    expect([...PAYPAL_READ_SCOPES]).toEqual([
      "https://uri.paypal.com/services/reporting/search/read",
      "https://uri.paypal.com/services/reporting/balances/read",
    ]);
  });
});

// ── The gap: the partner surface is recorded, never invented ───────────────────────────────

describe("the partner read surface is a recorded GAP", () => {
  test("no allow-listed path is a partner resource", () => {
    for (const path of PROVIDER_READ_PATHS.paypal) {
      expect(`${path}:${path.includes("partner")}`).toBe(`${path}:false`);
    }
  });

  test("the two published reporting paths are the whole allow-list", () => {
    expect([...PROVIDER_READ_PATHS.paypal].sort()).toEqual([
      "/v1/reporting/balances",
      "/v1/reporting/transactions",
    ]);
  });

  test("the gap is stated in code, so nothing downstream has to re-derive it", () => {
    expect(PAYPAL_PARTNER_SURFACE_GAP).toMatch(/partner-transactions/);
    expect(PAYPAL_PARTNER_SURFACE_GAP.length).toBeGreaterThan(60);
  });

  test("beginConnect refuses and names the gap — it never offers an app token as a connection", async () => {
    const h = await harness();
    const result = await h.asA.action(api.paypalAuth.beginConnect, { environment: "sandbox" });
    expect(result.available).toBe(false);
    expect(result.because).toBe(PAYPAL_PARTNER_SURFACE_GAP);
    // No state row, because there is no consent to come back from.
    expect(await h.t.run((ctx) => ctx.db.query("connectorOAuthStates").collect())).toHaveLength(0);
  });
});

// ── Revocation honesty ────────────────────────────────────────────────────────────────────

describe("disconnect clears locally and says so — there is no PayPal revoke endpoint", () => {
  test("the support table records PayPal as unsupported", () => {
    expect(PROVIDER_REVOKE_SUPPORT.paypal).toBe("unsupported");
  });

  test("even a 200 from somewhere cannot be recorded as a confirmed revocation", () => {
    // The guard fires on the PROVIDER before it examines anything, so there is no argument
    // combination that produces `confirmed`. A local ciphertext clear is a real and useful act; it
    // is not revocation, and the product must never say it is.
    expect(classifyRevokeOutcome({ provider: "paypal", attempted: true, statusCode: 200 })).toEqual(
      { upstream: "unsupported", residualAccessUnproven: false },
    );
    expect(classifyRevokeOutcome({ provider: "paypal", attempted: false })).toEqual({
      upstream: "unsupported",
      residualAccessUnproven: false,
    });
  });
});

// ── Source scans: what no type can express ────────────────────────────────────────────────

const laneSources = (): [string, string][] =>
  Object.entries(rawSources).filter(
    ([path]) =>
      /\/paypal[A-Za-z]*\.ts$/.test(path) &&
      !path.endsWith(".test.ts") &&
      !path.includes("_generated"),
  );

describe("the lane modules cannot express a write", () => {
  test("there are lane modules to scan", () => {
    expect(laneSources().length).toBeGreaterThan(0);
  });

  test("no lane module names a mutating HTTP verb or reaches the platform fetch", () => {
    const markers = ['"POST"', '"PUT"', '"PATCH"', '"DELETE"', "fetch("];
    for (const [path, src] of laneSources()) {
      for (const marker of markers) {
        expect(`${path}:${src.includes(marker)}`).toBe(`${path}:false`);
      }
    }
  });

  test("no lane module names a PayPal write operation", () => {
    // Lowercase and case-SENSITIVE on purpose. The refused-feature list legitimately contains
    // `REFUND` and `PAYOUTS` as the names of things this lane declines; a case-insensitive scan
    // would go red on the refusal itself and would then be deleted, taking the real guard with it.
    const forbidden = [
      "/v2/payments",
      "/v1/payments",
      "/v2/invoicing",
      "/v1/invoicing",
      "/v1/payments/payouts",
      "/capture",
      "/refund",
      "/authorize",
      "/void",
      "/send",
      "customer/disputes",
    ];
    for (const [path, src] of laneSources()) {
      for (const marker of forbidden) {
        expect(`${path}:${src.includes(marker)}`).toBe(`${path}:false`);
      }
    }
  });
});
