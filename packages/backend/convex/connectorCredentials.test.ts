// The Phase 28 credential adapter, tested against a real in-memory Convex backend. Every test is
// $0 — convex-test only, no network, no provider, no model.
//
// Three things are being proven, and only the first is ordinary:
//
//  1. TWO-TENANT ISOLATION. Tenant B cannot read, open or see tenant A's connection, and lifting
//     A's ciphertext into B's row does not decrypt it. 28-CONTEXT makes this a precondition for any
//     provider appearing in the product at all.
//  2. NOTHING PLAINTEXT SURVIVES THE WRITE. A sentinel token is sealed, stored, and then hunted
//     for across every byte of the stored row and every byte of the client projection.
//  3. THE REVOCATION RECORD DOES NOT LIE. Disconnecting a provider Pikar cannot revoke upstream
//     must not read as "revoked" — the row has to keep saying that only the local copy went.
import {
  CONNECTION_FAILURE_CLASSES,
  CONNECTION_STATUSES,
  CONNECTOR_ENVIRONMENTS,
  importCredentialKey,
  openCredential,
  PROVIDERS,
  REVOCATION_UPSTREAM_STATES,
  sealCredential,
} from "@pikar/revenue";
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.*s");

/** Raw sources for the public-surface scan below. edge-runtime has no `node:fs`. */
const rawSources = import.meta.glob("./**/*.ts", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

/** The sentinel. If this string appears anywhere outside a decrypt result, something leaked. */
const SENTINEL = "SUPERSECRET-ACCESS-TOKEN-DO-NOT-LEAK";
const CREDENTIAL = JSON.stringify({
  access: SENTINEL,
  refresh: "SUPERSECRET-REFRESH-TOKEN-DO-NOT-LEAK",
  scope: "com.intuit.quickbooks.accounting",
  externalAccountId: "9130350000000000",
});

function keyB64(fill: number): string {
  let binary = "";
  for (const b of new Uint8Array(32).fill(fill)) binary += String.fromCharCode(b);
  return btoa(binary);
}

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

const connectionRows = (h: Harness) =>
  h.t.run((ctx) => ctx.db.query("connectorConnections").collect());

/** Seal a credential for a scope and store it exactly as a provider callback would. */
async function connect(
  h: Harness,
  tenantId: string,
  opts: { connectionId?: string; plaintext?: string } = {},
) {
  const connectionId = opts.connectionId ?? `conn_${tenantId}`;
  const scope = {
    tenantId,
    provider: "quickbooks" as const,
    connectionId,
    environment: "production" as const,
  };
  const key = await importCredentialKey(keyB64(0x11), "v1");
  const envelope = await sealCredential(key, scope, opts.plaintext ?? CREDENTIAL);
  await h.t.mutation(internal.connectorCredentials.upsertSealed, {
    tenantId,
    provider: scope.provider,
    environment: scope.environment,
    connectionId,
    credentialCiphertextB64: envelope.ciphertextB64,
    credentialIvB64: envelope.ivB64,
    keyVersion: envelope.keyVersion,
    accessExpiresAt: Date.now() + 3_600_000,
    externalAccountHash: "a".repeat(64),
  });
  return { scope, envelope, key, connectionId };
}

// ── The closed unions in schema.ts must equal the closed sets in @pikar/revenue ───────────────

/** Literal values out of a Convex union validator, read from the runtime table definition. */
function literalsOf(table: string, field: string): string[] {
  const fields = (
    schema.tables[table as keyof typeof schema.tables] as unknown as {
      validator: { fields: Record<string, unknown> };
    }
  ).validator.fields;
  const walk = (node: unknown): string[] => {
    const n = node as { kind?: string; members?: unknown[]; value?: unknown };
    if (n?.kind === "literal") return [String(n.value)];
    if (n?.kind === "union") return (n.members ?? []).flatMap(walk);
    return [];
  };
  return walk(fields[field]);
}

describe("schema literals are pinned to the @pikar/revenue closed sets", () => {
  // THE `agentSteps.tool` TRAP IN REVERSE, and this codebase has been bitten by it four times: a
  // value the pure package considers legal but the schema has no literal for makes the insert
  // throw `ArgumentValidationError` — here, at the exact moment a user finishes an OAuth consent.
  test("the extractor actually reads literals, so the pins cannot pass vacuously", () => {
    expect(literalsOf("connectorConnections", "provider").length).toBe(4);
    expect(literalsOf("connectorConnections", "status").length).toBeGreaterThan(3);
  });

  test.each([
    ["connectorConnections", "provider", PROVIDERS],
    ["connectorConnections", "environment", CONNECTOR_ENVIRONMENTS],
    ["connectorConnections", "status", CONNECTION_STATUSES],
    ["connectorOAuthStates", "provider", PROVIDERS],
    ["connectorOAuthStates", "environment", CONNECTOR_ENVIRONMENTS],
    ["contactProviderRefs", "provider", PROVIDERS],
    ["providerGates", "provider", PROVIDERS],
    ["providerGates", "environment", CONNECTOR_ENVIRONMENTS],
  ] as const)("%s.%s matches its package constant", (table, field, expected) => {
    expect(literalsOf(table, field).sort()).toEqual([...expected].sort());
  });

  test("the optional failure-class and revocation unions are pinned too", () => {
    // Both sit inside a `v.optional(...)` / `v.object(...)` wrapper, so they are read from the
    // JSON form of the table validator rather than the top-level field walk above.
    // `.json` is a runtime getter on every Convex validator but is absent from `VObject`'s public
    // type, so the cast is required — and `tsc --noEmit` is what said so, while this test was
    // already green under vitest.
    const json = JSON.stringify(
      (schema.tables.connectorConnections.validator as unknown as { json: unknown }).json,
    );
    for (const cls of CONNECTION_FAILURE_CLASSES) expect(json).toContain(`"${cls}"`);
    for (const state of REVOCATION_UPSTREAM_STATES) expect(json).toContain(`"${state}"`);
    // Non-vacuity: a value that is NOT in either set must be absent.
    expect(json).not.toContain('"teapot"');
  });
});

// ── Round-trip and isolation ─────────────────────────────────────────────────────────────────

describe("sealed credentials round-trip, and only within their own tenant", () => {
  test("a stored envelope opens back to the exact credential", async () => {
    const h = await harness();
    const { scope, key } = await connect(h, h.tenantA);
    const row = await h.t.query(internal.connectorCredentials.get, {
      tenantId: h.tenantA,
      provider: "quickbooks",
      environment: "production",
    });
    expect(row?.status).toBe("connected");
    const opened = await openCredential(key, scope, {
      ciphertextB64: row?.credentialCiphertextB64 as string,
      ivB64: row?.credentialIvB64 as string,
      keyVersion: "v1",
      algorithm: "AES-256-GCM",
    });
    expect(opened).toBe(CREDENTIAL);
  });

  test("tenant B's row is separate and B's scope cannot open A's ciphertext", async () => {
    const h = await harness();
    const a = await connect(h, h.tenantA);
    await connect(h, h.tenantB);
    expect((await connectionRows(h)).length).toBe(2);

    // The realistic bug AND the realistic attack: A's ciphertext lifted into B's row.
    await expect(
      openCredential(a.key, { ...a.scope, tenantId: h.tenantB }, a.envelope),
    ).rejects.toThrow(/authentication/i);
    // ...and with B's own connectionId too, in case only the tenant were bound.
    await expect(
      openCredential(
        a.key,
        {
          tenantId: h.tenantB,
          provider: "quickbooks",
          connectionId: `conn_${h.tenantB}`,
          environment: "production",
        },
        a.envelope,
      ),
    ).rejects.toThrow(/authentication/i);
  });

  test("the public status query returns only the caller's own connections", async () => {
    const h = await harness();
    await connect(h, h.tenantA);
    const asA = await h.asA.query(api.connectorCredentials.connectorStatuses, {});
    const asB = await h.asB.query(api.connectorCredentials.connectorStatuses, {});
    expect(asA.map((s) => s.provider)).toEqual(["quickbooks"]);
    expect(asB).toEqual([]);
  });

  test("an unauthenticated caller gets nothing at all", async () => {
    const h = await harness();
    await connect(h, h.tenantA);
    await expect(h.t.query(api.connectorCredentials.connectorStatuses, {})).rejects.toThrow(
      /UNAUTHENTICATED/,
    );
  });
});

// ── Nothing plaintext survives the write ─────────────────────────────────────────────────────

describe("no secret reaches a stored row, a projection or a client", () => {
  test("the stored row contains no plaintext token and no scope string", async () => {
    const h = await harness();
    await connect(h, h.tenantA);
    const serialized = JSON.stringify(await connectionRows(h));
    expect(serialized).not.toContain(SENTINEL);
    expect(serialized).not.toContain("SUPERSECRET-REFRESH-TOKEN-DO-NOT-LEAK");
    // The granted scope is a CAPABILITY INVENTORY (gmailAuth's standing rule) and the provider
    // account id is the tenant's business identity. Both are inside the sealed blob.
    expect(serialized).not.toContain("com.intuit.quickbooks.accounting");
    expect(serialized).not.toContain("9130350000000000");
  });

  test("the client projection carries no ciphertext, IV, key version, connection id or account hash", async () => {
    const h = await harness();
    await connect(h, h.tenantA);
    const [status] = await h.asA.query(api.connectorCredentials.connectorStatuses, {});
    const serialized = JSON.stringify(status);
    for (const forbidden of [
      SENTINEL,
      "credentialCiphertextB64",
      "credentialIvB64",
      "keyVersion",
      "connectionId",
      "externalAccountHash",
      "revision",
      "refreshLeaseId",
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
    // Non-vacuity: the projection is not empty — it says the useful, safe things.
    expect(status?.provider).toBe("quickbooks");
    expect(status?.status).toBe("connected");
  });

  test("the module declares NO public write surface — there is no 'store secret' mutation", () => {
    // 28-RESEARCH: "Do not create a public 'store secret' mutation. Only provider callback
    // handlers can create/replace an envelope." A source scan, not `Object.keys(api...)`: the
    // generated `api` is `anyApi`, a Proxy that enumerates nothing, so a key check there would
    // pass vacuously forever. Same `import.meta.glob` raw loader importGuard.test.ts uses,
    // because edge-runtime has no `node:fs`.
    const src = rawSources["./connectorCredentials.ts"];
    expect(src).toBeTruthy();
    // Non-vacuity: the scan really is looking at this module's code.
    expect(src).toMatch(/tenantQuery\(/);
    expect(src).toMatch(/internalMutation\(/);
    // The public write builders. `internalMutation`/`internalQuery` never match — the regex is
    // case-sensitive and anchored on a word boundary before the lowercase name.
    expect(src).not.toMatch(/\b(tenantMutation|ownerMutation|tenantAction|ownerAction)\s*\(/);
    expect(src).not.toMatch(/\bexport const \w+ = mutation\(/);
  });
});

// ── The QuickBooks rolling-refresh hazard: lease + CAS ───────────────────────────────────────

describe("refresh is single-flight and replaces both tokens atomically", () => {
  const scopeArgs = (tenantId: string) => ({
    tenantId,
    provider: "quickbooks" as const,
    environment: "production" as const,
  });

  test("a second refresher cannot take the lease while the first holds it", async () => {
    const h = await harness();
    await connect(h, h.tenantA);
    const first = await h.t.mutation(internal.connectorCredentials.acquireRefreshLease, {
      ...scopeArgs(h.tenantA),
      leaseId: "lease-1",
      ttlMs: 30_000,
    });
    expect(first.ok).toBe(true);

    const second = await h.t.mutation(internal.connectorCredentials.acquireRefreshLease, {
      ...scopeArgs(h.tenantA),
      leaseId: "lease-2",
      ttlMs: 30_000,
    });
    // Intuit revokes the token the FIRST call issued when a second races it, so the connection
    // dies and the user must re-consent. Refusing is the only safe answer.
    expect(second.ok).toBe(false);
  });

  test("an EXPIRED lease can be taken over — a crashed refresher must not wedge the connection", async () => {
    const h = await harness();
    await connect(h, h.tenantA);
    await h.t.mutation(internal.connectorCredentials.acquireRefreshLease, {
      ...scopeArgs(h.tenantA),
      leaseId: "lease-dead",
      ttlMs: -1, // already expired
    });
    const taken = await h.t.mutation(internal.connectorCredentials.acquireRefreshLease, {
      ...scopeArgs(h.tenantA),
      leaseId: "lease-live",
      ttlMs: 30_000,
    });
    expect(taken.ok).toBe(true);
  });

  test("commitRefresh replaces ciphertext AND iv together and bumps the revision", async () => {
    const h = await harness();
    const { scope, key } = await connect(h, h.tenantA);
    const lease = await h.t.mutation(internal.connectorCredentials.acquireRefreshLease, {
      ...scopeArgs(h.tenantA),
      leaseId: "lease-1",
      ttlMs: 30_000,
    });
    const rotated = JSON.stringify({ access: "ROTATED-ACCESS", refresh: "ROTATED-REFRESH" });
    const fresh = await sealCredential(key, scope, rotated);

    const result = await h.t.mutation(internal.connectorCredentials.commitRefresh, {
      ...scopeArgs(h.tenantA),
      leaseId: "lease-1",
      revision: lease.revision as number,
      credentialCiphertextB64: fresh.ciphertextB64,
      credentialIvB64: fresh.ivB64,
      keyVersion: "v1",
      accessExpiresAt: Date.now() + 3_600_000,
    });
    expect(result.ok).toBe(true);

    const [row] = await connectionRows(h);
    expect(row?.revision).toBe((lease.revision as number) + 1);
    // BOTH fields moved. A patch that replaced only the ciphertext would leave an IV that cannot
    // decrypt it, and the connection would be silently dead rather than refreshed.
    expect(row?.credentialCiphertextB64).toBe(fresh.ciphertextB64);
    expect(row?.credentialIvB64).toBe(fresh.ivB64);
    expect(
      await openCredential(key, scope, {
        ciphertextB64: row?.credentialCiphertextB64 as string,
        ivB64: row?.credentialIvB64 as string,
        keyVersion: "v1",
        algorithm: "AES-256-GCM",
      }),
    ).toBe(rotated);
    // The lease is released, so the next refresh can proceed.
    expect(row?.refreshLeaseId).toBeUndefined();
  });

  test("a STALE revision is refused and the stored credential is left untouched", async () => {
    const h = await harness();
    const { scope, key } = await connect(h, h.tenantA);
    const lease = await h.t.mutation(internal.connectorCredentials.acquireRefreshLease, {
      ...scopeArgs(h.tenantA),
      leaseId: "lease-1",
      ttlMs: 30_000,
    });
    const good = await sealCredential(key, scope, JSON.stringify({ access: "FIRST" }));
    await h.t.mutation(internal.connectorCredentials.commitRefresh, {
      ...scopeArgs(h.tenantA),
      leaseId: "lease-1",
      revision: lease.revision as number,
      credentialCiphertextB64: good.ciphertextB64,
      credentialIvB64: good.ivB64,
      keyVersion: "v1",
    });

    // A refresher that slept past its lease comes back with the OLD revision. The lease alone
    // would not stop it — that is why there is a fencing token.
    const stale = await sealCredential(key, scope, JSON.stringify({ access: "STALE" }));
    const refused = await h.t.mutation(internal.connectorCredentials.commitRefresh, {
      ...scopeArgs(h.tenantA),
      leaseId: "lease-1",
      revision: lease.revision as number,
      credentialCiphertextB64: stale.ciphertextB64,
      credentialIvB64: stale.ivB64,
      keyVersion: "v1",
    });
    expect(refused.ok).toBe(false);
    const [row] = await connectionRows(h);
    expect(row?.credentialCiphertextB64).toBe(good.ciphertextB64);
  });

  test("the FENCE refuses a stale revision even when the lease check would pass", async () => {
    // THIS TEST EXISTS BECAUSE MUTATION TESTING FOUND THE HOLE. Weakening the fence to
    // `row.revision < revision` left the suite above fully GREEN: after a successful commit the
    // lease is released, so the stale retry was being refused by the LEASE check and the fence was
    // never exercised. The test proved "the lease was released", not "the fence works" — and a
    // lease without a working fence is a lock that lies.
    //
    // The realistic path: a refresher renews its own lease and retries with the revision it cached
    // BEFORE its first commit landed.
    const h = await harness();
    const { scope, key } = await connect(h, h.tenantA);
    const lease = await h.t.mutation(internal.connectorCredentials.acquireRefreshLease, {
      ...scopeArgs(h.tenantA),
      leaseId: "lease-1",
      ttlMs: 30_000,
    });
    const good = await sealCredential(key, scope, JSON.stringify({ access: "FIRST" }));
    await h.t.mutation(internal.connectorCredentials.commitRefresh, {
      ...scopeArgs(h.tenantA),
      leaseId: "lease-1",
      revision: lease.revision as number,
      credentialCiphertextB64: good.ciphertextB64,
      credentialIvB64: good.ivB64,
      keyVersion: "v1",
    });

    // Same worker, same lease id, so the lease check will PASS and only the fence can refuse.
    const renewed = await h.t.mutation(internal.connectorCredentials.acquireRefreshLease, {
      ...scopeArgs(h.tenantA),
      leaseId: "lease-1",
      ttlMs: 30_000,
    });
    expect(renewed.ok).toBe(true);

    const stale = await sealCredential(key, scope, JSON.stringify({ access: "STALE" }));
    const refused = await h.t.mutation(internal.connectorCredentials.commitRefresh, {
      ...scopeArgs(h.tenantA),
      leaseId: "lease-1",
      revision: lease.revision as number,
      credentialCiphertextB64: stale.ciphertextB64,
      credentialIvB64: stale.ivB64,
      keyVersion: "v1",
    });
    expect(refused.ok).toBe(false);
    const [row] = await connectionRows(h);
    expect(row?.credentialCiphertextB64).toBe(good.ciphertextB64);
  });

  test("a foreign lease holder cannot commit", async () => {
    const h = await harness();
    const { scope, key } = await connect(h, h.tenantA);
    const lease = await h.t.mutation(internal.connectorCredentials.acquireRefreshLease, {
      ...scopeArgs(h.tenantA),
      leaseId: "lease-1",
      ttlMs: 30_000,
    });
    const sealed = await sealCredential(key, scope, JSON.stringify({ access: "IMPOSTOR" }));
    const refused = await h.t.mutation(internal.connectorCredentials.commitRefresh, {
      ...scopeArgs(h.tenantA),
      leaseId: "lease-someone-else",
      revision: lease.revision as number,
      credentialCiphertextB64: sealed.ciphertextB64,
      credentialIvB64: sealed.ivB64,
      keyVersion: "v1",
    });
    expect(refused.ok).toBe(false);
  });
});

// ── Revocation must not overstate what happened ──────────────────────────────────────────────

describe("revocation records what Pikar actually did, not what it wishes it did", () => {
  const scopeArgs = (tenantId: string) => ({
    tenantId,
    provider: "quickbooks" as const,
    environment: "production" as const,
  });

  test("recording a revocation clears the ciphertext but KEEPS the row", async () => {
    const h = await harness();
    await connect(h, h.tenantA);
    await h.t.mutation(internal.connectorCredentials.recordRevocation, {
      ...scopeArgs(h.tenantA),
      upstream: "confirmed",
      statusCode: 200,
    });
    const [row] = await connectionRows(h);
    // The secret is gone...
    expect(row?.credentialCiphertextB64).toBeUndefined();
    expect(row?.credentialIvB64).toBeUndefined();
    expect(JSON.stringify(row)).not.toContain(SENTINEL);
    // ...and the honest record survives. Deleting the row would destroy the one fact the user
    // most needs after disconnecting a provider Pikar may not be able to revoke.
    expect(row?.status).toBe("revoked");
    expect(row?.revocation?.upstream).toBe("confirmed");
    expect(row?.revocation?.localClearedAt).toBeGreaterThan(0);
  });

  test("an UNSUPPORTED upstream revoke never reads as a confirmed one", async () => {
    const h = await harness();
    await connect(h, h.tenantA);
    // PayPal documents no revoke endpoint; Stripe Apps documents no platform-initiated revoke.
    // Local deletion is all that happened, and the projection must keep saying so.
    await h.t.mutation(internal.connectorCredentials.recordRevocation, {
      ...scopeArgs(h.tenantA),
      upstream: "unsupported",
    });
    const [status] = await h.asA.query(api.connectorCredentials.connectorStatuses, {});
    expect(status?.status).toBe("revoked");
    expect(status?.revocation?.upstream).toBe("unsupported");
    expect(status?.revocation?.upstream).not.toBe("confirmed");
  });

  test("a FAILED upstream attempt is distinguishable from both, so a retry is offerable", async () => {
    const h = await harness();
    await connect(h, h.tenantA);
    await h.t.mutation(internal.connectorCredentials.recordRevocation, {
      ...scopeArgs(h.tenantA),
      upstream: "attempted_failed",
      statusCode: 503,
    });
    const [status] = await h.asA.query(api.connectorCredentials.connectorStatuses, {});
    expect(status?.revocation?.upstream).toBe("attempted_failed");
    // The provider's status CODE is operator detail; it must not ride out to the browser.
    expect(JSON.stringify(status)).not.toContain("503");
  });

  test("HubSpot's unproven cascade is expressible: the grant may outlive the revoke", async () => {
    const h = await harness();
    await connect(h, h.tenantA);
    const residual = Date.now() + 1_800_000;
    await h.t.mutation(internal.connectorCredentials.recordRevocation, {
      ...scopeArgs(h.tenantA),
      upstream: "confirmed",
      residualAccessUntil: residual,
    });
    const [status] = await h.asA.query(api.connectorCredentials.connectorStatuses, {});
    // The UI needs this to say "access ends by <time>" instead of claiming an instant cutoff.
    expect(status?.revocation?.residualAccessUntil).toBe(residual);
  });
});

// ── Read outcomes stay refs/enums only ───────────────────────────────────────────────────────

describe("read outcomes carry a closed class, never a provider message", () => {
  test("a success stamps lastReadAt and clears the previous failure", async () => {
    const h = await harness();
    await connect(h, h.tenantA);
    await h.t.mutation(internal.connectorCredentials.recordReadOutcome, {
      tenantId: h.tenantA,
      provider: "quickbooks",
      environment: "production",
      failureClass: "rate_limited",
    });
    await h.t.mutation(internal.connectorCredentials.recordReadOutcome, {
      tenantId: h.tenantA,
      provider: "quickbooks",
      environment: "production",
    });
    const [row] = await connectionRows(h);
    expect(row?.lastReadAt).toBeGreaterThan(0);
    expect(row?.lastFailureClass).toBeUndefined();
  });

  test("a reauth failure moves the connection to reauth_required, honestly", async () => {
    const h = await harness();
    await connect(h, h.tenantA);
    await h.t.mutation(internal.connectorCredentials.recordReadOutcome, {
      tenantId: h.tenantA,
      provider: "quickbooks",
      environment: "production",
      failureClass: "reauth",
    });
    const [status] = await h.asA.query(api.connectorCredentials.connectorStatuses, {});
    expect(status?.status).toBe("reauth_required");
    expect(status?.lastFailureClass).toBe("reauth");
  });

  test("a revoked connection is not resurrected by a late read outcome", async () => {
    const h = await harness();
    await connect(h, h.tenantA);
    await h.t.mutation(internal.connectorCredentials.recordRevocation, {
      tenantId: h.tenantA,
      provider: "quickbooks",
      environment: "production",
      upstream: "unsupported",
    });
    await h.t.mutation(internal.connectorCredentials.recordReadOutcome, {
      tenantId: h.tenantA,
      provider: "quickbooks",
      environment: "production",
    });
    const [row] = await connectionRows(h);
    // An in-flight read completing after a disconnect must not flip the row back to connected.
    expect(row?.status).toBe("revoked");
  });
});
