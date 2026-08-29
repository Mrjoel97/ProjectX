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
import { importCredentialKey, sealCredential } from "@pikar/revenue";
import {
  PAYPAL_MAX_PAGES,
  PAYPAL_MAX_WINDOW_DAYS,
  PAYPAL_READ_PATHS,
} from "@pikar/revenue/providers/paypal";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import { PROVIDER_READ_PATHS } from "./connectorFetch";
import { classifyRevokeOutcome, PROVIDER_REVOKE_SUPPORT } from "./connectorOAuth";
import {
  checkGrantedFeatures,
  classifyGrantSubject,
  isPayPalMerchantId,
  PAYPAL_PARTNER_SURFACE_GAP,
  PAYPAL_READ_SCOPES,
  PAYPAL_REFUSED_FEATURES,
  PAYPAL_REQUESTED_FEATURES,
  parsePayPalCredential,
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

function keyB64(fill: number): string {
  let binary = "";
  for (const b of new Uint8Array(32).fill(fill)) binary += String.fromCharCode(b);
  return btoa(binary);
}

const KEY_B64 = keyB64(23);
const ACCESS_1 = "SENTINEL-PAYPAL-ACCESS-DO-NOT-LEAK";

beforeEach(() => {
  process.env.CONNECTOR_CREDENTIAL_KEY_V1 = KEY_B64;
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

// ── The bounded read ──────────────────────────────────────────────────────────────────────

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const txnRow = (id: string, over: Record<string, unknown> = {}) => ({
  transaction_info: {
    transaction_id: id,
    transaction_event_code: "T0006",
    transaction_initiation_date: "2026-08-20T10:15:00+0000",
    transaction_amount: { currency_code: "USD", value: "19.99" },
    transaction_status: "S",
    invoice_id: null,
    ...over,
  },
});

const txnPage = (rows: unknown[], page = 1, totalPages = 1) =>
  jsonResponse({
    transaction_details: rows,
    account_number: "REDACTED",
    page,
    total_items: rows.length,
    total_pages: totalPages,
  });

/** Seal a connection straight into the DB, the way a completed onboarding would leave it. */
async function seedConnection(
  t: Awaited<ReturnType<typeof harness>>["t"],
  tenantId: string,
  over: { merchantId?: string; sealFor?: string; accessExpiresAt?: number } = {},
) {
  const connectionId = `conn_${tenantId}`;
  const key = await importCredentialKey(KEY_B64, "v1");
  const merchantId = over.merchantId ?? TENANT_MERCHANT;
  const sealed = await sealCredential(
    key,
    {
      // `sealFor` exists so a test can seal under ONE tenant and store the row under another —
      // the graft an attacker would attempt. AES-GCM's AAD is what refuses it.
      tenantId: over.sealFor ?? tenantId,
      provider: "paypal",
      connectionId,
      environment: "sandbox",
    },
    JSON.stringify({ accessToken: ACCESS_1, merchantId, scope: "reporting" }),
  );
  await t.run(async (ctx) => {
    await ctx.db.insert("connectorConnections", {
      tenantId,
      provider: "paypal",
      environment: "sandbox",
      status: "connected",
      revision: 1,
      connectionId,
      credentialCiphertextB64: sealed.ciphertextB64,
      credentialIvB64: sealed.ivB64,
      keyVersion: sealed.keyVersion,
      accessExpiresAt: over.accessExpiresAt ?? Date.now() + 3_600_000,
      connectedAt: Date.now(),
      updatedAt: Date.now(),
    });
  });
  return connectionId;
}

async function sealLane(
  t: Awaited<ReturnType<typeof harness>>["t"],
  over: { lane?: "passed" | "parked" | "failed"; cleared?: string[] } = {},
) {
  await t.run((ctx) =>
    ctx.db.insert("providerGates", {
      provider: "paypal",
      environment: "sandbox",
      admission: "approved_production",
      lane: over.lane ?? "passed",
      evidenceRef: "test-fixture",
      reviewBy: Date.now() + 30 * 86_400_000,
      clearedConditions: over.cleared ?? ["no-documented-revoke-endpoint"],
      revision: 1,
      updatedAt: Date.now(),
    }),
  );
}

describe("the allow-list and the pure module cannot drift", () => {
  test("every allow-listed PayPal path has a parser, and every parser's path is allow-listed", () => {
    expect([...PROVIDER_READ_PATHS.paypal].sort()).toEqual(Object.values(PAYPAL_READ_PATHS).sort());
  });

  test("the bounds the connector spends are the pure module's, asserted as literals", () => {
    expect(PAYPAL_MAX_PAGES).toBe(5);
    expect(PAYPAL_MAX_WINDOW_DAYS).toBe(31);
  });
});

describe("a PayPal app token is refused at READ time, after decryption", () => {
  test("a credential bound to the PARTNER'S OWN merchant cannot produce a projection", async () => {
    // THE DEFECT, at the last place it could still be caught. The read would have SUCCEEDED — the
    // token is valid and PayPal would answer — and every row that came back would be Pikar's own.
    const h = await harness();
    await sealLane(h.t);
    await seedConnection(h.t, h.tenantA, { merchantId: PARTNER_MERCHANT });
    const fetchMock = vi.fn(async () => txnPage([txnRow("T1")]));
    vi.stubGlobal("fetch", fetchMock);

    const projection = await h.asA.action(api.paypalConnector.readEntity, {
      environment: "sandbox",
      entity: "transactions",
    });
    expect(projection.state).toBe("unavailable");
    expect(projection).toMatchObject({
      because: "this PayPal credential reads Pikar's own account, not this tenant's merchant",
    });
    // And it refused BEFORE the wire, so the wrong merchant's rows were never even fetched.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("an unset PAYPAL_PARTNER_MERCHANT_ID fails closed rather than reading anything", async () => {
    // Without it the app's own account and a tenant's merchant are indistinguishable, so there is
    // no safe way to proceed — and the unsafe way still returns rows.
    const h = await harness();
    await sealLane(h.t);
    await seedConnection(h.t, h.tenantA);
    process.env.PAYPAL_PARTNER_MERCHANT_ID = "";
    const fetchMock = vi.fn(async () => txnPage([txnRow("T1")]));
    vi.stubGlobal("fetch", fetchMock);

    const projection = await h.asA.action(api.paypalConnector.readEntity, {
      environment: "sandbox",
      entity: "transactions",
    });
    expect(projection.state).toBe("unavailable");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("the gate governs CONSUMPTION, and evidence has its own door", () => {
  test("an unsealed lane makes a tenant read unavailable", async () => {
    const h = await harness();
    await seedConnection(h.t, h.tenantA);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => txnPage([txnRow("T1")])),
    );
    const projection = await h.asA.action(api.paypalConnector.readEntity, {
      environment: "sandbox",
      entity: "transactions",
    });
    expect(projection.state).toBe("unavailable");
  });

  test("a PARKED lane makes a tenant read unavailable even with an admission", async () => {
    const h = await harness();
    await sealLane(h.t, { lane: "parked" });
    await seedConnection(h.t, h.tenantA);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => txnPage([txnRow("T1")])),
    );
    const projection = await h.asA.action(api.paypalConnector.readEntity, {
      environment: "sandbox",
      entity: "transactions",
    });
    expect(projection.state).toBe("unavailable");
  });

  test("an uncleared open condition refuses a tenant read", async () => {
    // `no-documented-revoke-endpoint` is 28-25's to clear, with a partner-manager answer — never
    // with a green test, and never by a local ciphertext clear.
    const h = await harness();
    await sealLane(h.t, { cleared: [] });
    await seedConnection(h.t, h.tenantA);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => txnPage([txnRow("T1")])),
    );
    const projection = await h.asA.action(api.paypalConnector.readEntity, {
      environment: "sandbox",
      entity: "transactions",
    });
    expect(projection.state).toBe("unavailable");
  });

  test("the SAME unsealed state: the tenant door refuses and the evidence door reads", async () => {
    const h = await harness();
    await seedConnection(h.t, h.tenantA);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => txnPage([txnRow("T1")])),
    );
    const tenantDoor = await h.asA.action(api.paypalConnector.readEntity, {
      environment: "sandbox",
      entity: "transactions",
    });
    const evidenceDoor = await h.t.action(internal.paypalConnector.paypalReadEvidence, {
      tenantId: h.tenantA,
      environment: "sandbox",
      entity: "transactions",
    });
    expect(tenantDoor.state).toBe("unavailable");
    expect(evidenceDoor.state).toBe("ready");
    expect(evidenceDoor.itemCount).toBe(1);
    expect(evidenceDoor.delegatedMerchant).toBe(true);
  });

  test("the evidence door records an app-owner credential as NOT delegated", async () => {
    const h = await harness();
    await seedConnection(h.t, h.tenantA, { merchantId: PARTNER_MERCHANT });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => txnPage([txnRow("T1")])),
    );
    const evidence = await h.t.action(internal.paypalConnector.paypalReadEvidence, {
      tenantId: h.tenantA,
      environment: "sandbox",
      entity: "transactions",
    });
    expect(evidence.delegatedMerchant).toBe(false);
    expect(evidence.state).toBe("unavailable");
  });
});

describe("bounded reads", () => {
  test("a clean read is ready, with a coverage window that ends three hours back", async () => {
    const h = await harness();
    await sealLane(h.t);
    await seedConnection(h.t, h.tenantA);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => txnPage([txnRow("T1"), txnRow("T2")])),
    );
    const projection = await h.asA.action(api.paypalConnector.readEntity, {
      environment: "sandbox",
      entity: "transactions",
    });
    expect(projection.state).toBe("ready");
    if (projection.state !== "ready") return;
    expect(projection.items).toHaveLength(2);
    expect(projection.meta.provider).toBe("paypal");
    expect(projection.meta.authority).toBe("payment_rail");
    expect(projection.meta.capped).toBe(false);
    // PayPal takes up to three hours to list an executed transaction, so a window ending at `now`
    // would claim coverage of a period PayPal had not finished populating.
    expect(projection.meta.retrievedAt - projection.meta.window.endMs).toBeGreaterThanOrEqual(
      3 * 3_600_000,
    );
    expect(projection.meta.sources.map((r) => r.id)).toEqual(["T1", "T2"]);
  });

  test("the request narrows fields and never asks for payer, cart or shipping data", async () => {
    const h = await harness();
    await sealLane(h.t);
    await seedConnection(h.t, h.tenantA);
    const fetchMock = vi.fn(async (_input: unknown) => txnPage([txnRow("T1")]));
    vi.stubGlobal("fetch", fetchMock);
    await h.asA.action(api.paypalConnector.readEntity, {
      environment: "sandbox",
      entity: "transactions",
    });
    const url = new URL(String(fetchMock.mock.calls[0]?.[0]));
    expect(url.origin).toBe("https://api-m.sandbox.paypal.com");
    expect(url.pathname).toBe("/v1/reporting/transactions");
    expect(url.searchParams.get("fields")).toBe("transaction_info");
    for (const banned of ["payer_info", "cart_info", "shipping_info"]) {
      expect(`${banned}:${url.search.includes(banned)}`).toBe(`${banned}:false`);
    }
  });

  test("a page cap makes the read PARTIAL and names it — never a shorter ready list", async () => {
    const h = await harness();
    await sealLane(h.t);
    await seedConnection(h.t, h.tenantA);
    // Every page claims there are more, so the walk runs out of pages rather than out of data.
    let n = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        n += 1;
        return txnPage([txnRow(`T${n}`)], n, 99);
      }),
    );
    const projection = await h.asA.action(api.paypalConnector.readEntity, {
      environment: "sandbox",
      entity: "transactions",
    });
    expect(projection.state).toBe("partial");
    if (projection.state !== "partial") return;
    expect(projection.meta.capped).toBe(true);
    expect(projection.missing).toContain("cap");
    // The rows already read are NEVER discarded: a prefix reported as complete understates what a
    // business took in, and reporting nothing throws away real coverage.
    expect(projection.items.length).toBe(PAYPAL_MAX_PAGES);
  });

  test("a 429 is PARTIAL, not zero — missing history is unknown", async () => {
    const h = await harness();
    await sealLane(h.t);
    await seedConnection(h.t, h.tenantA);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("", { status: 429 })),
    );
    const projection = await h.asA.action(api.paypalConnector.readEntity, {
      environment: "sandbox",
      entity: "transactions",
    });
    expect(projection.state).toBe("partial");
    if (projection.state !== "partial") return;
    expect(projection.items).toEqual([]);
    expect(projection.missing).toContain("PayPal returned");
  });

  test("a balance snapshot reports AVAILABLE money, not the withheld total", async () => {
    const h = await harness();
    await sealLane(h.t);
    await seedConnection(h.t, h.tenantA);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({
          balances: [
            {
              currency: "USD",
              primary: true,
              total_balance: { currency_code: "USD", value: "1234.56" },
              available_balance: { currency_code: "USD", value: "1000.00" },
            },
          ],
          account_id: "REDACTED",
          as_of_time: "2026-08-28T00:00:00+0000",
        }),
      ),
    );
    const result = await h.asA.action(api.paypalConnector.balanceOnHand, {
      environment: "sandbox",
    });
    // The withheld remainder is not money the business can spend, and reporting it as if it were is
    // the whole reason the two are parsed apart.
    expect(result.value).toEqual([{ minor: 100_000, currency: "USD" }]);
  });

  test("an unavailable read is null, never a zero total", async () => {
    const h = await harness();
    await sealLane(h.t);
    const result = await h.asA.action(api.paypalConnector.receiptsSummary, {
      environment: "sandbox",
    });
    // "We could not see your PayPal merchant" and "you received nothing" are different sentences.
    expect(result.value).toBeNull();
  });

  test("receipts total per currency, and a reversal nets itself out", async () => {
    const h = await harness();
    await sealLane(h.t);
    await seedConnection(h.t, h.tenantA);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        txnPage([
          txnRow("T1"),
          txnRow("T2", { transaction_amount: { currency_code: "USD", value: "-4.99" } }),
          txnRow("T3", { transaction_amount: { currency_code: "EUR", value: "10.00" } }),
        ]),
      ),
    );
    const result = await h.asA.action(api.paypalConnector.receiptsSummary, {
      environment: "sandbox",
    });
    // 19.99 - 4.99 = 15.00 USD, and the euro ledger stays its own figure. Two currencies never
    // combine without an FX rate nobody supplied.
    expect(result.value).toEqual([
      { minor: 1000, currency: "EUR" },
      { minor: 1500, currency: "USD" },
    ]);
  });
});

describe("tenant isolation", () => {
  test("a tenant with no PayPal connection reads nothing, whatever another tenant has", async () => {
    const h = await harness();
    await sealLane(h.t);
    await seedConnection(h.t, h.tenantA);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => txnPage([txnRow("T1")])),
    );
    const asB = await h.asB.action(api.paypalConnector.readEntity, {
      environment: "sandbox",
      entity: "transactions",
    });
    expect(asB.state).toBe("unavailable");
    expect(asB).toMatchObject({ because: "this tenant has no PayPal connection" });
  });

  test("a ciphertext grafted from another tenant's row cannot be opened", async () => {
    // The AAD tuple is (tenantId, provider, connectionId, environment). Copying the row is not
    // enough: the ciphertext refuses to decrypt under a tenant it was not sealed for.
    const h = await harness();
    await sealLane(h.t);
    await seedConnection(h.t, h.tenantB, { sealFor: h.tenantA });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => txnPage([txnRow("T1")])),
    );
    const asB = await h.asB.action(api.paypalConnector.readEntity, {
      environment: "sandbox",
      entity: "transactions",
    });
    expect(asB.state).toBe("unavailable");
    expect(asB).toMatchObject({ because: "the PayPal credential is not available" });
  });

  test("a disconnected connection stays disconnected — a read cannot resurrect it", async () => {
    const h = await harness();
    await sealLane(h.t);
    await seedConnection(h.t, h.tenantA);
    const outcome = await h.asA.action(api.paypalAuth.disconnect, { environment: "sandbox" });
    expect(outcome.cleared).toBe(true);
    // A local clear is not a revocation, and the record must say exactly that.
    expect(outcome.upstream).toBe("unsupported");
    expect(outcome.statusCode).toBeNull();

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => txnPage([txnRow("T1")])),
    );
    const projection = await h.asA.action(api.paypalConnector.readEntity, {
      environment: "sandbox",
      entity: "transactions",
    });
    expect(projection).toMatchObject({ because: "the PayPal connection was disconnected" });
  });
});

describe("lane evidence carries no vendor payload", () => {
  test("evidence is counts, states and closed labels only", async () => {
    const h = await harness();
    await seedConnection(h.t, h.tenantA);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => txnPage([txnRow("5TY05013RG002845M"), txnRow("0AB12345CD678901E")])),
    );
    const evidence = await h.t.action(internal.paypalConnector.paypalReadEvidence, {
      tenantId: h.tenantA,
      environment: "sandbox",
      entity: "transactions",
    });
    const serialized = JSON.stringify(evidence);
    for (const leak of [
      ACCESS_1,
      TENANT_MERCHANT,
      PARTNER_MERCHANT,
      "5TY05013RG002845M",
      "19.99",
      "1999",
    ]) {
      expect(`${leak}:${serialized.includes(leak)}`).toBe(`${leak}:false`);
    }
    expect(evidence.itemCount).toBe(2);
    expect(evidence.refCount).toBe(2);
  });
});
