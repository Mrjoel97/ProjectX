// The tenant-facing connector surface (28-09 Task 1): the passed-only projection, and the
// connect-START gate that closes the hole the callback slice left open.
//
// FOUR things are being proven:
//
//  1. DISCOVERY IS A FUNCTION OF THE GATE, NOT OF WHAT THE TENANT HOLDS. A tenant row whose lane
//     is not passed is ABSENT — not "disconnected", absent — so a provider that was never proven,
//     or was proven and then broke, cannot keep rendering as a working integration.
//  2. THE CONNECT-START IS GATED, and gated on a DIFFERENT axis from the callback. A passed lane
//     is open to every tenant; an admitted-but-unproven one is open to the OWNER alone, which is
//     what keeps the wave-7 evidence path reachable without exposing it to customers.
//  3. A REFUSAL NAMES NO AXIS. `PROVIDER_NOT_CONNECTABLE` reaches a browser; which gate refused is
//     operator information.
//  4. THE PROJECTION CARRIES NO SECRET AND NO OPERATOR FIELD — no ciphertext, no connection id, no
//     evidence ref, no review date, no gate revision.
//
// Every test is $0: convex-test and Web Crypto only, no network, no provider.
import { PROVIDER_OPEN_CONDITIONS } from "@pikar/revenue";
import { convexTest } from "convex-test";
import { afterEach, describe, expect, test, vi } from "vitest";
import { passedGate } from "../__fixtures__/providerGates";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.*s");

const YEAR = 365 * 86_400_000;
type Provider = "hubspot" | "quickbooks" | "stripe" | "paypal";
type Env = "sandbox" | "production";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

async function harness(owner = false) {
  const t = convexTest(schema, modules);
  const userId = await t.run((ctx) => ctx.db.insert("users", owner ? { owner: true } : {}));
  const other = await t.run((ctx) => ctx.db.insert("users", {}));
  return {
    t,
    tenantId: String(userId),
    otherId: String(other),
    as: t.withIdentity({ subject: `${userId}|session` }),
    asOther: t.withIdentity({ subject: `${other}|session` }),
  };
}
type Harness = Awaited<ReturnType<typeof harness>>;

/** A gate row in whatever state the test is about. Defaults to PARKED — the state every real lane
 *  is in today, and the one a passing surface must hide. */
const gate = (
  h: Harness,
  over: {
    provider?: Provider;
    environment?: Env;
    lane?: "passed" | "parked" | "failed";
    admission?: "approved_beta" | "approved_production" | "blocked" | "deferred";
    reviewBy?: number;
    cleared?: readonly string[];
  } = {},
) => {
  const provider = over.provider ?? "hubspot";
  return h.t.run((ctx) =>
    ctx.db.insert("providerGates", {
      provider,
      environment: over.environment ?? "sandbox",
      admission: over.admission ?? "approved_production",
      lane: over.lane ?? "parked",
      evidenceRef: "docs/connectors/hubspot-suitability.md#decision",
      reviewBy: over.reviewBy ?? Date.now() + YEAR,
      clearedConditions: [...(over.cleared ?? [])],
      revision: 1,
      updatedAt: Date.now(),
    }),
  );
};

/** A gate the resolver actually accepts — every open condition cleared, from the real source. */
const passed = (h: Harness, provider: Provider = "hubspot", environment: Env = "sandbox") =>
  h.t.run((ctx) => ctx.db.insert("providerGates", passedGate(provider, environment)));

const connection = (
  h: Harness,
  tenantId: string,
  provider: Provider,
  over: { environment?: Env; sealed?: boolean; status?: "connected" | "reauth_required" } = {},
) =>
  h.t.run((ctx) =>
    ctx.db.insert("connectorConnections", {
      tenantId,
      provider,
      environment: over.environment ?? "sandbox",
      connectionId: `conn_${provider}`,
      status: over.status ?? ("connected" as const),
      keyVersion: "v1" as const,
      revision: 1,
      updatedAt: 1,
      connectedAt: 1,
      ...(over.sealed === false
        ? {}
        : { credentialCiphertextB64: "CIPHERTEXT_SENTINEL", credentialIvB64: "IV_SENTINEL" }),
    }),
  );

const view = (h: Harness) => h.as.query(api.connectorConnections.connections, {});

// ── Discovery follows the gate ────────────────────────────────────────────────────────────

describe("the surface shows passed lanes and nothing else", () => {
  test("no gate rows at all means an EMPTY surface, not four disconnected rows", async () => {
    const h = await harness();
    expect(await view(h)).toEqual([]);
  });

  // THE CORE PROPERTY. The tenant genuinely holds a live connection; the lane does not pass; the
  // provider is absent. Rendering it would show a working integration on a provider nothing has
  // proven — which is what `availableProviders` exists to prevent and what reading
  // `connectorStatuses` directly would have done.
  test.each([
    ["parked", { lane: "parked" as const }],
    ["failed", { lane: "failed" as const }],
    ["expired", { lane: "passed" as const, reviewBy: Date.now() - 1 }],
    ["blocked admission", { admission: "blocked" as const, lane: "passed" as const }],
    ["passed but an open condition uncleared", { lane: "passed" as const }],
  ])("a %s lane is ABSENT even when the tenant holds a live connection", async (_name, over) => {
    const h = await harness();
    await gate(h, over);
    await connection(h, h.tenantId, "hubspot");
    expect(await view(h)).toEqual([]);
  });

  test("a passed lane with no connection appears as CONNECTABLE, not as missing", async () => {
    const h = await harness();
    await passed(h);
    const rows = await view(h);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.provider).toBe("hubspot");
    expect(rows[0]?.connected).toBe(false);
    expect(rows[0]?.status).toBeNull();
  });

  test("one passed lane and three parked shows exactly one row", async () => {
    const h = await harness();
    await passed(h, "quickbooks");
    for (const p of ["hubspot", "stripe", "paypal"] as const) await gate(h, { provider: p });
    const rows = await view(h);
    expect(rows.map((r) => r.provider)).toEqual(["quickbooks"]);
  });

  // A lane that breaks after a tenant connected must disappear on the NEXT read, with no
  // migration and nothing to clean up — the row is untouched, the gate did all the work.
  test("a lane that fails after connection removes the row from the surface immediately", async () => {
    const h = await harness();
    const gateId = await passed(h);
    await connection(h, h.tenantId, "hubspot");
    expect(await view(h)).toHaveLength(1);

    await h.t.run((ctx) => ctx.db.patch(gateId, { lane: "failed" }));
    expect(await view(h)).toEqual([]);
    // The tenant's own row is still there — the surface hid it, nothing deleted it.
    const rows = await h.t.run((ctx) => ctx.db.query("connectorConnections").collect());
    expect(rows).toHaveLength(1);
  });

  test("a disconnected row (ciphertext cleared) is connectABLE, not connectED", async () => {
    const h = await harness();
    await passed(h);
    await connection(h, h.tenantId, "hubspot", { sealed: false });
    const rows = await view(h);
    expect(rows[0]?.connected).toBe(false);
    expect(rows[0]?.status).toBe("connected");
  });

  test("one tenant never sees another tenant's connection", async () => {
    const h = await harness();
    await passed(h);
    await connection(h, h.otherId, "hubspot");
    const rows = await view(h);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.connected).toBe(false);
  });

  // §4. The projection is the browser's whole view of this plane.
  test("the projection carries no secret, no connection id and no operator field", async () => {
    const h = await harness();
    await passed(h);
    await connection(h, h.tenantId, "hubspot");
    const rows = await view(h);
    const serialized = JSON.stringify(rows);
    for (const forbidden of [
      "CIPHERTEXT_SENTINEL",
      "IV_SENTINEL",
      "conn_hubspot",
      "evidenceRef",
      "reviewBy",
      "revision",
      "suitability",
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
    // ...and a CLOSED key set on top, because the loop above can only refuse names somebody already
    // thought of. A field added to `ConnectorView` passes the substring scan silently; the whole
    // risk of this projection is a field nobody classified, so the assertion has to be exhaustive
    // rather than a blocklist. Adding a field here is deliberate work, not an accident.
    expect(Object.keys(rows[0] ?? {}).sort()).toEqual([
      "connected",
      "connectedAt",
      "environment",
      "grantRemainsLiveUpstream",
      "lastFailureClass",
      "lastReadAt",
      "provider",
      "revokeSupport",
      "status",
      "unproven",
    ]);
  });

  // The disconnect button has to be able to tell the truth before it is pressed.
  test("each row carries whether a revoke can actually kill the grant upstream", async () => {
    const h = await harness();
    for (const p of ["hubspot", "quickbooks", "stripe", "paypal"] as const) await passed(h, p);
    const byProvider = Object.fromEntries(
      (await view(h)).map((r) => [r.provider, r.revokeSupport]),
    );
    expect(byProvider).toEqual({
      quickbooks: "confirmed",
      hubspot: "unproven",
      stripe: "unsupported",
      paypal: "unsupported",
    });
  });
});

// ── The surface and the gate are ONE rule ─────────────────────────────────────────────────

/**
 * THE DEFECT THIS DESCRIBE EXISTS FOR. `connectStartAllowed` grew an owner branch so that somebody
 * could complete a real grant against an admitted-but-unproven lane — without it the phase
 * deadlocks, because a lane cannot pass without evidence and evidence needs a grant. But the
 * surface kept filtering on `passed` alone, so that branch was reachable by NO caller: the gate
 * said yes and there was no row to render a button on. Every test on both sides was green.
 *
 * So the property is not "the owner sees parked lanes". It is that the two answers CANNOT DISAGREE.
 */
describe("what the surface offers is exactly what the gate would accept", () => {
  const connectable = async (h: Harness) => {
    vi.stubEnv("HUBSPOT_OAUTH_CLIENT_ID", "id");
    vi.stubEnv("HUBSPOT_OAUTH_CLIENT_SECRET", "secret");
    vi.stubEnv(
      "HUBSPOT_OAUTH_REDIRECT_URI",
      "https://app.test/connectors/hubspot/callback/sandbox",
    );
    return h.as
      .action(api.connectorConnections.startConnect, {
        provider: "hubspot",
        environment: "sandbox",
        redirectPath: "/dashboard/profile",
      })
      .then(() => true)
      .catch((e: Error) => {
        if (e.message.includes("PROVIDER_NOT_CONNECTABLE")) return false;
        throw e;
      });
  };

  test.each([
    ["no gate row at all", false, null, false, false],
    ["parked, ordinary tenant", false, "parked", false, false],
    ["parked, OWNER", true, "parked", true, true],
    ["passed, ordinary tenant", false, "passed", true, false],
    ["passed, OWNER", true, "passed", true, false],
    ["failed, OWNER", true, "failed", false, false],
    ["expired evidence, OWNER", true, "expired", false, false],
    ["blocked admission, OWNER", true, "blocked", false, false],
  ] as const)("%s → visible=%s", async (_name, isOwner, state, expectVisible, expectUnproven) => {
    const h = await harness(isOwner);
    if (state === "passed") await passed(h);
    else if (state === "expired") await gate(h, { reviewBy: Date.now() - 1 });
    else if (state === "blocked") await gate(h, { admission: "blocked" });
    else if (state !== null) await gate(h, { lane: state });

    const rows = await view(h);
    expect(rows.length).toBe(expectVisible ? 1 : 0);
    if (expectVisible) expect(rows[0]?.unproven).toBe(expectUnproven);

    // The parity that matters: a row exists if and only if a consent may actually be started.
    expect(await connectable(h)).toBe(expectVisible);
  });

  // Non-vacuity: without this the table above could be satisfied by a surface that shows nothing
  // and a gate that refuses everything, in lockstep, forever.
  test("the table exercises both answers, not one repeated eight times", async () => {
    const owner = await harness(true);
    await gate(owner, { lane: "parked" });
    const tenant = await harness();
    await gate(tenant, { lane: "parked" });
    expect((await view(owner)).length).toBe(1);
    expect((await view(tenant)).length).toBe(0);
  });
});

// ── The connect-START gate ────────────────────────────────────────────────────────────────

describe("starting a consent is gated, and on a different axis from the callback", () => {
  const start = (h: Harness, who: "as" | "asOther" = "as", provider: Provider = "hubspot") =>
    h[who].action(api.connectorConnections.startConnect, {
      provider,
      environment: "sandbox",
      redirectPath: "/dashboard/profile",
    });

  test("no gate row: nobody may start, not even the owner", async () => {
    const h = await harness(true);
    await expect(start(h)).rejects.toThrow(/PROVIDER_NOT_CONNECTABLE/);
  });

  // THE HOLE THE CALLBACK SLICE LEFT OPEN. A sealed park row is exactly the evidence-gathering
  // state, and before this a tenant who called the action directly could complete a real grant
  // against a provider whose lane had not passed.
  test("an admitted but PARKED lane refuses an ordinary tenant", async () => {
    const h = await harness();
    await gate(h, { lane: "parked" });
    await expect(start(h)).rejects.toThrow(/PROVIDER_NOT_CONNECTABLE/);
  });

  // ...and the same row must NOT refuse the owner, or wave 7 can never gather evidence and the
  // phase deadlocks again.
  test("the SAME parked lane admits the OWNER, so the evidence path stays reachable", async () => {
    const h = await harness(true);
    await gate(h, { lane: "parked" });
    vi.stubEnv("HUBSPOT_OAUTH_CLIENT_ID", "id");
    vi.stubEnv("HUBSPOT_OAUTH_CLIENT_SECRET", "secret");
    vi.stubEnv(
      "HUBSPOT_OAUTH_REDIRECT_URI",
      "https://app.test/connectors/hubspot/callback/sandbox",
    );
    const result = await start(h);
    expect("url" in result && typeof result.url === "string").toBe(true);
  });

  test("a PASSED lane admits an ordinary tenant", async () => {
    const h = await harness();
    await passed(h);
    vi.stubEnv("HUBSPOT_OAUTH_CLIENT_ID", "id");
    vi.stubEnv("HUBSPOT_OAUTH_CLIENT_SECRET", "secret");
    vi.stubEnv(
      "HUBSPOT_OAUTH_REDIRECT_URI",
      "https://app.test/connectors/hubspot/callback/sandbox",
    );
    const result = await start(h);
    expect("url" in result && typeof result.url === "string").toBe(true);
  });

  test.each([
    ["a failed lane", { lane: "failed" as const }],
    ["a blocked admission", { admission: "blocked" as const }],
    ["expired evidence", { reviewBy: Date.now() - 1 }],
  ])("%s refuses even the owner", async (_name, over) => {
    const h = await harness(true);
    await gate(h, over);
    await expect(start(h)).rejects.toThrow(/PROVIDER_NOT_CONNECTABLE/);
  });

  // A refusal reaches a browser. Which axis said no is operator information — the owner has
  // `inspectGate` for that.
  test("the refusal names no axis, no admission and no lane", async () => {
    const h = await harness();
    await gate(h, { lane: "parked", admission: "approved_beta" });
    const err = await start(h).catch((e: Error) => e.message);
    expect(err).toBe("PROVIDER_NOT_CONNECTABLE");
  });

  // PayPal is refused by its own module, not by the gate — a different answer, and the surface
  // needs the reason rather than a generic refusal.
  test("PayPal returns its documented reason rather than a URL", async () => {
    const h = await harness();
    await passed(h, "paypal");
    const result = await start(h, "as", "paypal");
    expect(result.url).toBeNull();
    expect("because" in result && result.because.length > 0).toBe(true);
  });

  // Non-vacuity for the whole describe: the condition ids the passed fixture clears are the ones
  // the resolver actually demands. If these drifted, `passed()` would silently stop passing and
  // every "admits" test above would be asserting a refusal it happened to expect.
  test("the passed fixture clears exactly the conditions the resolver demands", () => {
    for (const provider of ["hubspot", "quickbooks", "stripe", "paypal"] as const) {
      const cleared = passedGate(provider, "sandbox").clearedConditions;
      expect(cleared).toEqual(PROVIDER_OPEN_CONDITIONS[provider].map((c) => c.id));
      expect(cleared.length).toBeGreaterThan(0);
    }
  });
});
