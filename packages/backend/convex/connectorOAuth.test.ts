// The Phase 28 connector OAuth round-trip, tested against a real in-memory Convex backend.
// Every test is $0 — convex-test and Web Crypto only, no network, no provider, no model.
//
// FOUR things are being proven:
//
//  1. A CALLBACK CANNOT NAME A TENANT. `consumeConnectState` has no `tenantId` argument at all;
//     the tenant comes out of the state row it just consumed. Tenant grafting is refused by the
//     shape of the function, not by a check inside it.
//  2. EACH GUARD REFUSES ON ITS OWN. `consumeConnectState` stacks five guards. 28-03 shipped a
//     test that was silently satisfied by an OUTER guard and never reached the inner one it named,
//     so every case here is constructed so exactly ONE guard can fire, and asserts that guard's
//     own reason string.
//  3. A REFUSAL YIELDS NO CONNECTION SCOPE. The failure branch carries no tenantId and no
//     connectionId, so there is nothing for a token exchange to seal into — "zero exchange, zero
//     store" is structural rather than a caller's good manners.
//  4. THE REDIRECT CANNOT CARRY A SECRET OR LEAVE THE APP. Both inputs to the callback redirect
//     come from closed sets, so no `code`, `state` or token can reach the location header.
import { PROVIDERS, REVOCATION_UPSTREAM_STATES } from "@pikar/revenue";
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import {
  CONNECT_RESULTS,
  callbackRedirectPath,
  classifyRevokeOutcome,
  DEFAULT_REDIRECT_PATH,
  PROVIDER_REVOKE_SUPPORT,
  safeRedirectPath,
  STATE_TTL_MS,
} from "./connectorOAuth";
import schema from "./schema";

const modules = import.meta.glob("./**/*.*s");

/** Raw sources for the structural scans below. edge-runtime has no `node:fs`. */
const rawSources = import.meta.glob("./**/*.ts", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

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

type Harness = Awaited<ReturnType<typeof harness>>;

const stateRows = (h: Harness) => h.t.run((ctx) => ctx.db.query("connectorOAuthStates").collect());

const mint = (h: Harness, who: "asA" | "asB" = "asA", over: Record<string, unknown> = {}) =>
  h[who].mutation(api.connectorOAuth.mintConnectState, {
    provider: "hubspot",
    environment: "sandbox",
    redirectPath: "/dashboard/profile",
    ...over,
  } as never);

const consume = (h: Harness, over: Record<string, unknown>) =>
  h.t.mutation(internal.connectorOAuth.consumeConnectState, {
    provider: "hubspot",
    environment: "sandbox",
    ...over,
  } as never);

// ── Minting ───────────────────────────────────────────────────────────────────────────────

describe("mintConnectState", () => {
  test("stores only the HASH of a server-random nonce, never the nonce itself", async () => {
    const h = await harness();
    const { state } = await mint(h);

    expect(state.length).toBeGreaterThanOrEqual(32);
    const rows = await stateRows(h);
    expect(rows).toHaveLength(1);
    expect(rows[0].stateHash).not.toBe(state);
    // The nonce must not survive anywhere in the row — a database read must not yield a state
    // a caller could then present at the callback.
    expect(JSON.stringify(rows[0])).not.toContain(state);
  });

  test("binds the CALLER's tenant and refuses to be told a different one", async () => {
    const h = await harness();
    await mint(h, "asA");
    expect((await stateRows(h))[0].tenantId).toBe(h.tenantA);

    // Convex rejects an argument the validator does not declare, so there is no tenantId to spoof.
    await expect(mint(h, "asA", { tenantId: h.tenantB })).rejects.toThrow();
  });

  test("two mints never collide", async () => {
    const h = await harness();
    const a = await mint(h);
    const b = await mint(h);
    expect(a.state).not.toBe(b.state);
    expect(a.connectionId).not.toBe(b.connectionId);
    expect(new Set((await stateRows(h)).map((r) => r.stateHash)).size).toBe(2);
  });

  test("expires within the declared TTL", async () => {
    const h = await harness();
    const before = Date.now();
    const { expiresAt } = await mint(h);
    expect(expiresAt).toBeGreaterThanOrEqual(before);
    expect(expiresAt).toBeLessThanOrEqual(Date.now() + STATE_TTL_MS);
  });

  test("an unauthenticated caller cannot mint", async () => {
    const h = await harness();
    await expect(
      h.t.mutation(api.connectorOAuth.mintConnectState, {
        provider: "hubspot",
        environment: "sandbox",
        redirectPath: "/dashboard/profile",
      }),
    ).rejects.toThrow(/UNAUTHENTICATED/);
  });

  test("an off-app redirect target is refused at MINT, before any consent happens", async () => {
    const h = await harness();
    for (const bad of ["//evil.test/pwn", "https://evil.test", "/dash?x=1", "/dash#f", "\\\\evil"]) {
      await expect(mint(h, "asA", { redirectPath: bad })).rejects.toThrow(/redirect/i);
    }
    expect(await stateRows(h)).toHaveLength(0);
  });
});

// ── Consuming: one guard at a time ────────────────────────────────────────────────────────

describe("consumeConnectState — each guard refuses on its own", () => {
  test("the happy path yields the MINTING tenant and its connection", async () => {
    const h = await harness();
    const { state, connectionId } = await mint(h, "asB");
    const r = await consume(h, { state });
    expect(r).toMatchObject({
      ok: true,
      tenantId: h.tenantB,
      connectionId,
      redirectPath: "/dashboard/profile",
    });
    expect((await stateRows(h))[0].usedAt).toEqual(expect.any(Number));
  });

  test("UNKNOWN: a state that was never minted — only this guard can fire", async () => {
    const h = await harness();
    const r = await consume(h, { state: "never-minted-anywhere" });
    expect(r).toEqual({ ok: false, reason: "unknown_state" });
    expect(await stateRows(h)).toHaveLength(0);
  });

  test("PROVIDER MISMATCH: fresh, unused, in-date — only this guard can fire", async () => {
    const h = await harness();
    const { state } = await mint(h);
    const r = await consume(h, { state, provider: "quickbooks" });
    expect(r).toEqual({ ok: false, reason: "provider_mismatch" });
    // Refused, and NOT consumed: a wrong-provider probe must not burn the user's real state.
    expect((await stateRows(h))[0].usedAt).toBeUndefined();
  });

  test("ENVIRONMENT MISMATCH: right provider, fresh, unused — only this guard can fire", async () => {
    const h = await harness();
    const { state } = await mint(h);
    const r = await consume(h, { state, environment: "production" });
    expect(r).toEqual({ ok: false, reason: "environment_mismatch" });
    expect((await stateRows(h))[0].usedAt).toBeUndefined();
  });

  test("REPLAY: consumed once, still well inside its TTL — only the used guard can fire", async () => {
    const h = await harness();
    const { state } = await mint(h);
    expect(await consume(h, { state })).toMatchObject({ ok: true });

    const rowsAfterFirst = await stateRows(h);
    const r = await consume(h, { state });
    expect(r).toEqual({ ok: false, reason: "already_used" });
    // The replay changed nothing at all — same usedAt, same row count.
    expect(await stateRows(h)).toEqual(rowsAfterFirst);
  });

  test("EXPIRED: never used, right provider, right environment — only the expiry guard can fire", async () => {
    const h = await harness();
    const { state } = await mint(h);
    await h.t.run(async (ctx) => {
      const row = (await ctx.db.query("connectorOAuthStates").collect())[0];
      await ctx.db.patch(row._id, { expiresAt: Date.now() - 1 });
    });

    const r = await consume(h, { state });
    expect(r).toEqual({ ok: false, reason: "expired" });
    expect((await stateRows(h))[0].usedAt).toBeUndefined();
  });

  test("a refusal carries NO tenantId and NO connectionId — nothing for an exchange to seal into", async () => {
    const h = await harness();
    const { state } = await mint(h);
    for (const args of [
      { state: "nope" },
      { state, provider: "quickbooks" as const },
      { state, environment: "production" as const },
    ]) {
      const r = await consume(h, args);
      expect(r.ok).toBe(false);
      expect(Object.keys(r).sort()).toEqual(["ok", "reason"]);
    }
  });

  test("consumeConnectState declares no tenantId argument at all", () => {
    const src = rawSources["./connectorOAuth.ts"];
    const body = src.slice(src.indexOf("export const consumeConnectState"));
    const args = body.slice(body.indexOf("args:"), body.indexOf("handler:"));
    expect(args).not.toMatch(/tenantId/);
  });

  test("one tenant's state cannot be consumed into another tenant", async () => {
    const h = await harness();
    const a = await mint(h, "asA");
    const b = await mint(h, "asB");
    expect(await consume(h, { state: a.state })).toMatchObject({ ok: true, tenantId: h.tenantA });
    expect(await consume(h, { state: b.state })).toMatchObject({ ok: true, tenantId: h.tenantB });
  });
});

// ── The diagnostic read ───────────────────────────────────────────────────────────────────

describe("pendingConnectStates", () => {
  test("counts only — no hash, no nonce, no connection id, and scoped to the caller", async () => {
    const h = await harness();
    await mint(h, "asA");
    await mint(h, "asA", { provider: "quickbooks" });
    await mint(h, "asB");

    const forA = await h.asA.query(api.connectorOAuth.pendingConnectStates, {});
    expect(forA.map((r) => r.provider).sort()).toEqual(["hubspot", "quickbooks"]);
    expect(forA.every((r) => r.pending === 1)).toBe(true);
    expect(JSON.stringify(forA)).not.toMatch(/stateHash|connectionId|conn_/);

    const forB = await h.asB.query(api.connectorOAuth.pendingConnectStates, {});
    expect(forB).toEqual([{ provider: "hubspot", environment: "sandbox", pending: 1 }]);
  });

  test("a consumed state stops being pending", async () => {
    const h = await harness();
    const { state } = await mint(h, "asA");
    await consume(h, { state });
    expect(await h.asA.query(api.connectorOAuth.pendingConnectStates, {})).toEqual([]);
  });
});

// ── Redirect hygiene ──────────────────────────────────────────────────────────────────────

describe("safeRedirectPath", () => {
  test("accepts in-app paths", () => {
    for (const p of ["/", "/dashboard", "/dashboard/profile", "/a/b-c_d.e~f"]) {
      expect(safeRedirectPath(p)).toBe(p);
    }
  });

  test("refuses everything that could leave the app or smuggle a scheme", () => {
    for (const p of [
      "//evil.test/pwn", // protocol-relative — the classic open redirect
      "/\\evil.test", // backslash variant some parsers normalise to //
      "https://evil.test",
      "evil.test",
      "/dash?next=https://evil.test",
      "/dash#frag",
      "/dash%2f%2fevil.test",
      "/dash@evil.test",
      "/a/../../etc",
      "/dash\nLocation: https://evil.test",
      "",
      `/${"x".repeat(300)}`,
    ]) {
      expect(safeRedirectPath(p)).toBeNull();
    }
  });
});

describe("callbackRedirectPath", () => {
  test("emits exactly two params, both from closed sets", () => {
    for (const provider of PROVIDERS) {
      for (const result of CONNECT_RESULTS) {
        const loc = callbackRedirectPath("/dashboard/profile", provider, result);
        expect(loc).toBe(`/dashboard/profile?connect=${provider}&result=${result}`);
      }
    }
  });

  test("no code, state or token can reach the location — the inputs are not free text", () => {
    const loc = callbackRedirectPath(
      "/dashboard/profile?code=SECRET&state=SECRET",
      "hubspot",
      "connected",
    );
    expect(loc).not.toMatch(/SECRET|code=|state=|token/);
    // The unsafe path fell back rather than being partly honoured.
    expect(loc.startsWith(`${DEFAULT_REDIRECT_PATH}?`)).toBe(true);
  });

  test("a result outside the closed set degrades to unavailable rather than being echoed", () => {
    const loc = callbackRedirectPath(
      "/dashboard/profile",
      "hubspot",
      "invalid_grant: token ABC123" as never,
    );
    expect(loc).toBe("/dashboard/profile?connect=hubspot&result=unavailable");
  });
});

// ── Revocation honesty ────────────────────────────────────────────────────────────────────

describe("classifyRevokeOutcome", () => {
  test("every provider has a declared revoke-support fact", () => {
    for (const p of PROVIDERS) {
      expect(["confirmed", "unproven", "unsupported"]).toContain(PROVIDER_REVOKE_SUPPORT[p]);
    }
    // The 2026-08-27 admissions: only Intuit documents a revocation endpoint.
    expect(PROVIDER_REVOKE_SUPPORT.quickbooks).toBe("confirmed");
    expect(PROVIDER_REVOKE_SUPPORT.hubspot).toBe("unproven");
    expect(PROVIDER_REVOKE_SUPPORT.stripe).toBe("unsupported");
    expect(PROVIDER_REVOKE_SUPPORT.paypal).toBe("unsupported");
  });

  test("a provider with no revoke endpoint records UNSUPPORTED — never a silent success", () => {
    for (const provider of ["stripe", "paypal"] as const) {
      // Even handed a 200 it must refuse to say confirmed: there is no endpoint that 200 could
      // have come from, and "we deleted our copy" is not "the grant is dead".
      expect(classifyRevokeOutcome({ provider, attempted: true, statusCode: 200 }).upstream).toBe(
        "unsupported",
      );
      expect(classifyRevokeOutcome({ provider, attempted: false }).upstream).toBe("unsupported");
    }
  });

  test("NOT_ATTEMPTED is distinct from unsupported", () => {
    // QuickBooks HAS an endpoint. Skipping the call is a different fact from not having one.
    expect(classifyRevokeOutcome({ provider: "quickbooks", attempted: false }).upstream).toBe(
      "not_attempted",
    );
  });

  test("a 2xx on a real endpoint is confirmed; anything else is attempted_failed", () => {
    expect(
      classifyRevokeOutcome({ provider: "quickbooks", attempted: true, statusCode: 200 }).upstream,
    ).toBe("confirmed");
    for (const statusCode of [400, 401, 403, 429, 500, undefined]) {
      expect(
        classifyRevokeOutcome({ provider: "quickbooks", attempted: true, statusCode }).upstream,
      ).toBe("attempted_failed");
    }
  });

  test("HubSpot's unproven cascade demands a residual window alongside confirmed", () => {
    const ok = classifyRevokeOutcome({ provider: "hubspot", attempted: true, statusCode: 200 });
    expect(ok).toEqual({ upstream: "confirmed", residualAccessUnproven: true });
    // A confirmed QuickBooks revoke needs no such caveat.
    expect(
      classifyRevokeOutcome({ provider: "quickbooks", attempted: true, statusCode: 200 }),
    ).toEqual({ upstream: "confirmed", residualAccessUnproven: false });
  });

  test("the result is always one of the four upstream states — never a fifth, never a boolean", () => {
    for (const provider of PROVIDERS) {
      for (const attempted of [true, false]) {
        for (const statusCode of [undefined, 200, 400, 500]) {
          const { upstream } = classifyRevokeOutcome({ provider, attempted, statusCode });
          expect(REVOCATION_UPSTREAM_STATES).toContain(upstream);
        }
      }
    }
  });
});

// ── Structural scans ──────────────────────────────────────────────────────────────────────

describe("connectorOAuth.ts structure", () => {
  test("exposes no public write beyond the mint, and no public read of a state", () => {
    const src = rawSources["./connectorOAuth.ts"];
    const publicBuilders = [...src.matchAll(/export const (\w+) = (tenant|owner)(Mutation|Query|Action)/g)];
    expect(publicBuilders.map((m) => m[1]).sort()).toEqual([
      "mintConnectState",
      "pendingConnectStates",
    ]);
  });

  test("never logs, and never reaches audit or dead letters with a state", () => {
    const src = rawSources["./connectorOAuth.ts"];
    expect(src).not.toMatch(/console\./);
    expect(src).not.toMatch(/deadLetters/);
  });
});
