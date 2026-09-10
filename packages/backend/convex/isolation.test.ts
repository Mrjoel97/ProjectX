// BETA-02 / BETA-05: the tenant-isolation gate.
//
// This file exists to FAIL when the surface grows, not to record what the surface was on the day
// it was written. Every list below is DERIVED — from the runtime schema, from the Phase 22.1
// classification registry, or from a source scan — so a new table, a new index, a new public
// function or a new owner endpoint is covered automatically or reddens the suite. A hand-authored
// inventory would be a second thing to keep in sync, and keeping it in sync is exactly the job
// nobody remembers to do.
//
// WHAT THIS ADDS OVER Phase 22.1's registry drift test: that test regex-parses the TEXT of
// schema.ts, so it is structurally blind to the six tables Convex Auth injects via the
// `...authTables` spread. `Object.keys(schema.tables)` at RUNTIME sees all 51. The union assertion
// here is the only place those six are pinned.
import { TENANT_TABLE_CLASSIFICATION } from "@pikar/core/tenantData";
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import { RAW_BUILDER_ALLOWLIST } from "./lib/allowlist";
import schema from "./schema";

const sources = import.meta.glob("./**/*.ts", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

const RUNTIME_TABLES = Object.keys(schema.tables).sort();

/**
 * The six tables Convex Auth injects. Hand-authored HERE and nowhere else, because they are the
 * one part of the schema that has no source text to derive from — `...authTables` is a spread of
 * the package's own definitions (schema.ts:73). Everything else comes from the registry.
 *
 * They are exempt from tenant scoping because they ARE the identity plane: `authAccounts` maps a
 * provider subject to a user, `authSessions` is the session itself. Scoping them by tenant would
 * be circular — the tenant is derived FROM them (`lib/functions.ts` `requireScope`).
 */
const EXEMPT_AUTH = [
  "authAccounts",
  "authRateLimits",
  "authRefreshTokens",
  "authSessions",
  "authVerificationCodes",
  "authVerifiers",
] as const;

describe("table coverage is derived from the schema, not frozen in prose", () => {
  test("the registry plus the auth spread accounts for EVERY runtime table, both directions", () => {
    const classified = Object.keys(TENANT_TABLE_CLASSIFICATION);
    const union = [...classified, ...EXEMPT_AUTH].sort();

    // Both directions: a new schema table that nobody classified fails, AND a classification for
    // a table that no longer exists fails.
    expect(union).toEqual(RUNTIME_TABLES);
    // Non-vacuity: if the spread ever stopped resolving, `union` could still equal a shrunken
    // RUNTIME_TABLES and this would pass while proving nothing.
    expect(RUNTIME_TABLES.length).toBeGreaterThan(classified.length);
    expect(RUNTIME_TABLES).toEqual(expect.arrayContaining([...EXEMPT_AUTH]));
  });

  test("no auth table is also classified — the two lists must not overlap", () => {
    for (const table of EXEMPT_AUTH) {
      expect(TENANT_TABLE_CLASSIFICATION).not.toHaveProperty(table);
    }
  });

  /**
   * The registry's categories carry a promise about the DATA, and a table whose validator
   * contradicts its category is the failure this catches. `global` is the load-bearing one: it
   * asserts "contains no tenant data", and every consumer — the export manifest's omission reason
   * especially — repeats that claim to the user.
   *
   * Two deliberate shapes are NOT violations and are named rather than filtered silently:
   *  - `users` is `tenant_owned` with NO `tenantId` column. It is scoped by identity (its own
   *    `_id`), which `tenantTableScope` returns "identity" for.
   *  - `admission_plane` rows precede every tenant, so a `tenantId` on them would be a column
   *    that must not exist.
   */
  test("a table's validator matches the category it claims", () => {
    const withTenantId = new Set(
      RUNTIME_TABLES.filter((name) => {
        const fields = (
          schema.tables[name as keyof typeof schema.tables] as unknown as {
            validator: { fields?: Record<string, unknown> };
          }
        ).validator.fields;
        return Boolean(fields && "tenantId" in fields);
      }),
    );

    // Non-vacuity: the validator introspection must actually see fields.
    expect(withTenantId.size).toBeGreaterThan(30);

    for (const [table, category] of Object.entries(TENANT_TABLE_CLASSIFICATION)) {
      const has = withTenantId.has(table);
      if (category === "global") {
        expect({ table, category, hasTenantId: has }).toEqual({
          table,
          category,
          hasTenantId: false,
        });
      }
      if (category === "admission_plane") {
        expect({ table, hasTenantId: has }).toEqual({ table, hasTenantId: false });
      }
      if ((category === "tenant_owned" || category === "tenant_credential") && table !== "users") {
        expect({ table, category, hasTenantId: has }).toEqual({
          table,
          category,
          hasTenantId: true,
        });
      }
    }
    // The one named identity-scoped exception, pinned so it cannot silently become the rule.
    expect(withTenantId.has("users")).toBe(false);
    expect(TENANT_TABLE_CLASSIFICATION.users).toBe("tenant_owned");
  });
});

/** Every runtime table whose validator declares `tenantId`. This — not the registry category — is
 *  what decides whether the cross-tenant index rule applies, because a table can hold tenant rows
 *  while being classified `audit_immutable` for export/deletion purposes. */
function tenantIdTables(): string[] {
  return RUNTIME_TABLES.filter((name) => {
    const fields = (
      schema.tables[name as keyof typeof schema.tables] as unknown as {
        validator: { fields?: Record<string, unknown> };
      }
    ).validator.fields;
    return Boolean(fields && "tenantId" in fields);
  });
}

/**
 * Every index on a table, read from the runtime `TableDefinition`.
 *
 * The accessor is the quoted `" indexes"` property — experimental and undocumented. If Convex ever
 * removes it the scan would silently see zero indexes and go vacuously green, so a separate
 * assertion proves a KNOWN index is visible before any rule is applied to the result.
 */
function indexesOf(table: string): { indexDescriptor: string; fields: string[] }[] {
  const def = schema.tables[table as keyof typeof schema.tables] as unknown as Record<
    string,
    unknown
  >;
  const accessor = def[" indexes"];
  if (typeof accessor !== "function") return [];
  return (accessor as () => { indexDescriptor: string; fields: string[] }[]).call(def);
}

/**
 * Indexes on tenantId-bearing tables that deliberately do NOT lead with tenantId.
 *
 * The rule's purpose is that no TENANT-FACING reader can range across tenants. These are the
 * exceptions, and each names the consumer that makes it safe. The criterion is "a named
 * internal/owner-plane consumer with no tenant-facing caller" — NOT "a cross-tenant range is
 * impossible", because for several of these a cross-tenant range is precisely the point
 * (`audit.by_ts` is what the WORM export cron scans across every tenant).
 *
 * Adding an index without adding it here fails the suite. That is the whole mechanism.
 */
const NON_TENANT_LEADING: Record<string, string> = {
  "audit.by_correlation": "correlation trace; internal + owner plane, joins one workflow's rows",
  "audit.by_export_version": "internal WORM legacy backfill; deployment-global export only",
  "audit.by_ts":
    "the OPSG-03 WORM export cron scans this ACROSS tenants by design; 26-15 added reportsGovernance.wormExport, an ownerQuery with no tenant-facing caller, reading the same range for lag",
  "deadLetters.by_status": "DLQ triage on the compliance surface; owner-plane only",
  "tenantSkills.by_status_createdAt": "owner candidate-review queue across tenants",
  "requests.by_correlation": "correlation trace, internal",
  "requests.by_plan": "join from a plan row already tenant-checked by its own reader",
  "plans.by_calendar_run": "workflow-engine callback keyed by an opaque run id",
  "plans.by_media_run": "workflow-engine callback keyed by an opaque run id",
  // 25.1-01 (D2) added the third of these when renderReel went under the ActionRetrier. Same
  // shape and same reason as its two siblings: `onRenderComplete` receives only {runId, result},
  // so the lookup is by an opaque, server-minted run id and has no tenant-facing caller.
  "plans.by_render_run": "workflow-engine callback keyed by an opaque run id",
  "attachments.by_request": "join from a request row already tenant-checked by its own reader",
  "telemetry.by_correlation": "correlation trace, internal",
  "vaultDocuments.by_kind": "internal corpus maintenance; no tenant-facing caller",
  "feedback.by_skill": "skill-optimizer aggregation across tenants; owner/token plane",
  "spendEvents.by_correlation": "correlation trace, internal",
  "spendEvents.by_eval_budget":
    "internal evaluation budget groups only its explicitly registered fixture tenants",
  // 28-03. The OAuth callback arrives from the provider with a nonce and NOTHING else — no
  // session, no cookie, no tenant — so the lookup cannot lead with tenantId; that is the entire
  // reason a state row exists instead of a bare HMAC. The consumer is 28-04's callback handler,
  // which has no tenant-facing caller: it resolves the row, checks `usedAt`/`expiresAt`, and the
  // tenant it then acts as comes FROM the row rather than from the request.
  "connectorOAuthStates.by_state":
    "OAuth callback resolves a server-minted nonce; no tenant in the request",
  // 28.1-05. A `customer.subscription.*` delivery carries a `cus_...` and NOTHING that names a
  // tenant — no session, no cookie, no client_reference_id — so the reverse lookup cannot lead
  // with tenantId; that is the entire reason the mapping row exists. Same shape as
  // `connectorOAuthStates.by_state`: the consumer is `billingWebhook.receiveAndApply`, an
  // internalMutation reached only from the signature-verified webhook route, with no tenant-facing
  // caller. The tenant it then acts as comes FROM the row, never from the request.
  "billingCustomers.by_customer":
    "Stripe webhook resolves a customer id to its tenant; no tenant in the delivery",
  // 28.1-06. Identical in shape and reason to `spendEvents.by_correlation` above: the idempotence
  // read is by correlation because that is what a Stripe retry carries, and the TENANT CHECK IS
  // PART OF THE IDENTITY rather than part of the index — `recordBillingMovement` filters the
  // bounded `take(32)` to `row.tenantId === args.tenantId` before it looks at anything else, so a
  // correlation colliding across tenants can neither dedupe nor currency-clash across them. There
  // is no tenant-facing caller: the only reader is `recordBillingMovement`, inside the webhook's
  // internalMutation.
  "billingEvents.by_correlation": "correlation identity read, internal; tenant filtered in code",
  // 28.1-07. The invoice rollup is DEPLOYMENT-WIDE work, not a tenant's request: the daily cron
  // has no tenant in hand and finds due periods across every tenant by (status, dueAt) — that IS
  // the query, so a tenant-leading index cannot serve it. The only readers are
  // `billingRollup.tick` and `billingRollup.periodForPost`, both internal and both reached only
  // from the cron chain; there is no tenant-facing caller and no argument a caller could supply.
  // The tenant-facing surface (`billing.invoices`) uses `by_tenant`, which does lead with tenantId.
  "billingPeriods.by_status_dueAt":
    "deployment-wide claim scan from the cron; no tenant-facing caller",
};

describe("every tenant-owned index leads with tenantId, or names why it does not", () => {
  test("the runtime index accessor is alive, so the scan cannot pass vacuously", () => {
    const auditIndexes = indexesOf("audit").map((i) => i.indexDescriptor);
    expect(auditIndexes).toContain("by_tenant_ts");
    expect(indexesOf("contacts").length).toBeGreaterThan(0);
  });

  test("no unlisted index on a tenant table can range across tenants", () => {
    const offenders: string[] = [];
    let scanned = 0;

    // KEYED ON "HAS A tenantId COLUMN", NOT ON CATEGORY, and that distinction is load-bearing.
    // Filtering to tenant_owned/tenant_credential silently skipped `audit` and `deadLetters`
    // (both `audit_immutable`), which carry tenantId and 3 non-tenant-leading indexes between
    // them — so three entries in NON_TENANT_LEADING were dead code that nothing consulted.
    // Caught by mutation: deleting `audit.by_ts` from the exception list left the suite GREEN.
    for (const table of tenantIdTables()) {
      if (table === "users") continue; // identity-scoped; its email/phone indexes are auth's own
      for (const index of indexesOf(table)) {
        scanned++;
        const key = `${table}.${index.indexDescriptor}`;
        if (index.fields[0] === "tenantId") continue;
        if (key in NON_TENANT_LEADING) continue;
        offenders.push(`${key} [${index.fields.join(", ")}]`);
      }
    }

    expect(scanned).toBeGreaterThan(50); // non-vacuity
    expect(offenders).toEqual([]);
  });

  test("every named exception still exists — a stale allowance is a hole", () => {
    for (const key of Object.keys(NON_TENANT_LEADING)) {
      const [table, descriptor] = key.split(".");
      const found = indexesOf(table as string).find((i) => i.indexDescriptor === descriptor);
      expect({ key, exists: Boolean(found) }).toEqual({ key, exists: true });
      expect({ key, leadsWithTenant: found?.fields[0] === "tenantId" }).toEqual({
        key,
        leadsWithTenant: false,
      });
    }
  });
});

/**
 * The PUBLIC surface scan.
 *
 * It matches the five tenant/owner wrappers AND the three raw builders. Scanning only the wrapper
 * names was correct until 25-01 and is now the wrong shape: `invites.requestAccess` and
 * `invites.preflight` are the repo's first PUBLIC raw-builder functions, and they are the only
 * unauthenticated internet-reachable endpoints the beta has — precisely the ones a scan must not
 * be blind to.
 */
const PUBLIC_EXPORT =
  /export const ([a-zA-Z0-9_]+) = (tenantQuery|tenantMutation|tenantAction|ownerQuery|ownerMutation|ownerAction|query|mutation|action)\(/g;

type PublicFn = { module: string; name: string; builder: string };

const PUBLIC_SURFACE: PublicFn[] = Object.entries(sources)
  .filter(([path]) => !path.endsWith(".test.ts") && !path.includes("/_generated/"))
  .flatMap(([path, content]) =>
    [...content.matchAll(PUBLIC_EXPORT)].map(([, name, builder]) => ({
      module: (path.split("/").pop() ?? path).replace(/\.ts$/, ""),
      name: name as string,
      builder: builder as string,
    })),
  );

/**
 * Unauthenticated, internet-reachable functions. Each needs a WRITTEN reason, because "it had to
 * be callable before login" is not a justification — the bar is that it reads and returns no
 * tenant-owned data and no secret. A new entry here without a reason fails the suite, which is the
 * point: this list should be hard to grow.
 */
const PUBLIC_UNAUTHENTICATED: Record<string, string> = {
  "invites.requestAccess":
    "BETA-01 waitlist. Writes one email-keyed row that precedes every tenant; reads nothing. Idempotent per address.",
  "invites.preflight":
    "BETA-01 invite check. Returns a boolean and a masked address only, and reports an unknown code and a spent code identically so it cannot be used as an oracle.",
  "invites.authProviders":
    "BETA-01 signup affordances. Returns three booleans about which sign-in providers this deployment has credentials for; discloses nothing a rendered button would not, and never a credential.",
};

describe("the public function surface is fully classified", () => {
  test("the scan found the whole surface, so nothing below is vacuous", () => {
    expect(PUBLIC_SURFACE.length).toBeGreaterThan(150);
    expect(PUBLIC_SURFACE.some((f) => f.module === "contacts")).toBe(true);
  });

  test("every raw-builder public function is allow-listed AND has a written reason", () => {
    const raw = PUBLIC_SURFACE.filter((f) => ["query", "mutation", "action"].includes(f.builder));
    // Non-vacuity: 25-01 landed two, so zero means the scan broke.
    expect(raw.length).toBeGreaterThan(0);

    for (const fn of raw) {
      expect(RAW_BUILDER_ALLOWLIST).toContain(`${fn.module}.ts`);
      const key = `${fn.module}.${fn.name}`;
      expect({ key, hasReason: key in PUBLIC_UNAUTHENTICATED }).toEqual({ key, hasReason: true });
      expect(PUBLIC_UNAUTHENTICATED[key]?.length ?? 0).toBeGreaterThan(40);
    }
  });

  test("every other public function goes through a tenant or owner wrapper", () => {
    const unwrapped = PUBLIC_SURFACE.filter(
      (f) =>
        ["query", "mutation", "action"].includes(f.builder) &&
        !(`${f.module}.${f.name}` in PUBLIC_UNAUTHENTICATED),
    );
    expect(unwrapped).toEqual([]);
  });
});

/**
 * OWNER ENDPOINTS — derived, never enumerated.
 *
 * The plan said "all three owner-gated Phase-8 functions". There are FOURTEEN, across four
 * modules, and the five in `finance.ts` — which include the global spend kill switch and the
 * master kill switch — were pinned by nothing at all before this file. A count in prose goes stale
 * the moment someone adds an endpoint; a scan does not.
 */
const OWNER_SURFACE = PUBLIC_SURFACE.filter((f) =>
  ["ownerQuery", "ownerMutation", "ownerAction"].includes(f.builder),
);

/**
 * MEASURED, AND CONTRARY TO WHAT THIS FILE FIRST ASSUMED: **argument validation runs BEFORE the
 * custom wrapper's `requireOwner`.** Calling an owner endpoint with `{}` throws
 * `Validator error: Missing required field`, never `OWNER_REQUIRED` — so a test that passed empty
 * args would "pass" on 8 of these 14 while proving nothing about authorization at all. That is the
 * vacuous-coverage shape this repo keeps re-finding, and it is why every endpoint below gets real,
 * schema-valid arguments.
 *
 * The values are deliberately HARMLESS and the ids deliberately non-existent: `requireOwner` must
 * refuse before any handler runs, so if one of these ever actually executes, the assertion fails
 * anyway — but nothing is flipped on the way past.
 */
const OWNER_ARGS: Record<string, Record<string, unknown>> = {
  "finance.setMasterKillSwitch": { on: false },
  "finance.setMediaKillSwitch": { on: false },
  "finance.setPerRequestBudget": { budgetUsd: 1 },
  "optimizerConfig.setOptimizerEnabled": { enabled: false },
  "skills.activateCandidate": { name: "no-such-skill", version: 1 },
  // 27-09. A REAL pack name, not "no-such-skill": `deactivatePack` refuses a non-pack name with
  // NOT_A_PACK, and that refusal happens after the owner wrapper — so a bogus name here would still
  // pass this test while proving nothing about authorization on the path a real caller takes.
  "skills.deactivatePack": { name: "pack-brand-review" },
  // `id:<table>` is a sentinel: the test inserts a real row of that table and substitutes its id,
  // because `v.id()` validation would reject a hand-made string and we would be back to a
  // validator error masquerading as an authorization one.
  "skills.activateAgentCandidate": { candidateId: "id:tenantSkills" },
  "skills.activateTenantCandidate": { candidateId: "id:tenantSkills" },
  "skills.rollbackTenantSkill": { targetId: "id:tenantSkills" },
  "verticalPacks.rollback": { verticalId: "legal", targetId: "id:tenantSkills" },
  "verticalData.previewDataset": { sourceDocId: "id:vaultDocuments" },
  "invites.approve": { waitlistId: "id:betaWaitlist" },
  // 28-26. Both are HARMLESS on purpose: `sealGate` here would PARK hubspot on a `blocked`
  // admission with an already-expired review date, so if the owner wrapper ever let it through,
  // the worst it could do is switch a provider off.
  "providerGates.inspectGate": { provider: "hubspot", environment: "production" },
  "providerGates.sealGate": {
    provider: "hubspot",
    environment: "production",
    admission: "blocked",
    lane: "parked",
    evidenceRef: "isolation.test#non-owner",
    reviewBy: 0,
  },
  // 28.1-10. HARMLESS on purpose, and every field is VALID: argument validation runs BEFORE the
  // owner wrapper, so a deliberately malformed fixture would fail with a validator error that
  // reads exactly like an authorization one. If the wrapper ever let this through, the worst it
  // could do is open a pending billing period for a tenant that does not exist.
  "billingRollup.raiseAdjustment": {
    tenantId: "tenant-isolation-nonowner",
    ref: "isolation-test",
    amountMinor: 1,
    currency: "USD",
  },
};

/** The endpoints whose validator has at least one required field. Kept beside `OWNER_ARGS` so a
 *  new owner endpoint that needs args cannot be silently called with `{}` and pass on a validator
 *  error instead of an authorization one. */
const REQUIRES_ARGS = new Set(Object.keys(OWNER_ARGS));

describe("owner endpoints reject a non-owner, and the list grows by itself", () => {
  test("the owner surface spans every module that has one", () => {
    // 14 at 25-03, 15 once 25-10 added `ops.envCheck`, 16 once 25.1-06 added
    // `deadLetters.listAll`, 18 once 26-15 added the two `reportsGovernance` owner reads, 19 once
    // 27-09 added `skills.deactivatePack`, 20 once 27-11 added
    // `workflowPackDiscovery.listPackCandidates` — the owner-only candidate preview, which is the
    // surface the browser evidence plane is earned from, 22 once 28-26 added
    // `providerGates.inspectGate`/`sealGate`, 23 once 28.1-10 added
    // `billingRollup.raiseAdjustment` — the ONLY writer of a billing period, and the one owner
    // endpoint that puts money on a customer's bill. THIS ASSERTION HAS NOW DONE ITS JOB SEVEN
    // TIMES: each new owner endpoint turned it red, which is the entire reason the count and the
    // module set are pinned rather than derived-and-forgotten. Update it deliberately when the
    // surface grows.
    expect(OWNER_SURFACE.length).toBeGreaterThanOrEqual(24);
    expect([...new Set(OWNER_SURFACE.map((f) => f.module))].sort()).toEqual([
      "billingRollup",
      "deadLetters",
      "finance",
      "invites",
      "ops",
      "optimizerConfig",
      "providerGates",
      "reportsGovernance",
      "skills",
      "verticalData",
      "verticalPacks",
      "workflowPackDiscovery",
    ]);
    // The kill switches specifically: the highest-consequence owner endpoints in the repo.
    const names = OWNER_SURFACE.map((f) => f.name);
    expect(names).toContain("setMasterKillSwitch");
    expect(names).toContain("setMediaKillSwitch");
  });

  test("every owner endpoint with required args has a fixture, so none is skipped", () => {
    const missing = OWNER_SURFACE.filter(
      (f) => !(`${f.module}.${f.name}` in OWNER_ARGS) && REQUIRES_ARGS.has(`${f.module}.${f.name}`),
    );
    expect(missing).toEqual([]);
  });

  for (const fn of OWNER_SURFACE) {
    test(`${fn.module}.${fn.name} rejects a non-owner with OWNER_REQUIRED`, async () => {
      const t = convexTest(schema, import.meta.glob("./**/*.*s"));
      const userId = await t.run((ctx) => ctx.db.insert("users", {}));
      const asNonOwner = t.withIdentity({ subject: `${userId}|session_x` });

      // The api surface is a union of ~44 module shapes; indexing it by a runtime-derived string
      // has no static type. `unknown` first, deliberately, rather than widening the union.
      const surface = api[fn.module as keyof typeof api] as unknown as Record<string, unknown>;
      const ref = surface[fn.name];

      // Resolve any `id:<table>` sentinel into a real row id.
      const args: Record<string, unknown> = { ...(OWNER_ARGS[`${fn.module}.${fn.name}`] ?? {}) };
      for (const [key, value] of Object.entries(args)) {
        if (typeof value !== "string" || !value.startsWith("id:")) continue;
        args[key] =
          value === "id:betaWaitlist"
            ? await t.run((ctx) =>
                ctx.db.insert("betaWaitlist", {
                  email: "seed@example.com",
                  status: "pending",
                  requestedAt: 0,
                }),
              )
            : value === "id:vaultDocuments"
              ? await t.run((ctx) =>
                  ctx.db.insert("vaultDocuments", {
                    tenantId: "someone-else",
                    title: "owner fixture",
                    kind: "upload",
                    category: "my-uploads",
                    source: "upload",
                    mimeType: "text/csv",
                    size: 0,
                    contentHash: "fixture",
                    status: "ready",
                    createdAt: 0,
                  }),
                )
              : await t.run((ctx) =>
                  ctx.db.insert("tenantSkills", {
                    tenantId: "someone-else",
                    name: "seed",
                    version: 1,
                    body: "seed",
                    authoredBody: "seed",
                    status: "candidate",
                    author: "user",
                    basedOnScope: "global",
                    basedOnName: "seed",
                    basedOnVersion: 1,
                    rollbackEligible: false,
                    createdAt: 0,
                  }),
                );
      }

      // Branch the CALL, not the function reference: `query` and `mutation` are separately
      // generic, so a ternary over them collapses to a union with no callable signature.
      type LooseCall = (ref: unknown, args: unknown) => Promise<unknown>;
      const invoke =
        fn.builder === "ownerQuery"
          ? () => (asNonOwner.query as unknown as LooseCall)(ref, args)
          : fn.builder === "ownerAction"
            ? () => (asNonOwner.action as unknown as LooseCall)(ref, args)
            : () => (asNonOwner.mutation as unknown as LooseCall)(ref, args);

      await expect(invoke()).rejects.toThrow(/OWNER_REQUIRED/);
    });
  }
});

/**
 * GROUNDED-PROSE EXPORT — token plane, NOT owner plane.
 *
 * The plan wanted this wrapped in `ownerQuery`. That would break it: `buildTrajectoryExport` is an
 * `internalQuery` reachable only through the `/skillopt/export` HTTP route behind a fail-closed
 * `Bearer SKILLOPT_TOKEN` compare, and the CI SkillOpt job authenticates with that token and has
 * no `users` row — so `requireOwner`'s `ctx.db.get(userId)` would refuse the whole export plane.
 * There is no `ownerAction` to fall back to either.
 *
 * So the invariant is the opposite of what the plan assumed: grounded prose must stay UNREACHABLE
 * from any public wrapper. That is what these assert.
 */
describe("grounded-prose export stays on the internal + token plane", () => {
  const exportSource = sources["./skilloptExport.ts"] ?? "";
  const httpSource = sources["./http.ts"] ?? "";

  test("the sources were actually read", () => {
    expect(exportSource.length).toBeGreaterThan(500);
    expect(httpSource.length).toBeGreaterThan(500);
  });

  test("it is an internalQuery and appears nowhere in the public surface", () => {
    expect(exportSource).toMatch(/export const buildTrajectoryExport = internalQuery\(/);
    expect(PUBLIC_SURFACE.some((f) => f.module === "skilloptExport")).toBe(false);
  });

  test("its only door is the bearer-gated HTTP route, which fails closed", () => {
    expect(httpSource).toContain("internal.skilloptExport.buildTrajectoryExport");
    // Fail-closed: an unset SKILLOPT_TOKEN must refuse, never admit.
    expect(httpSource).toMatch(/SKILLOPT_TOKEN/);
    expect(httpSource).toMatch(/401/);
  });

  // The ceiling, stated so no later reader mistakes owner-only for scrubbed.
  test("no test in this repo claims packages/pii scrubs names in free prose", () => {
    const claims = Object.entries(sources).filter(
      ([path, content]) =>
        path.endsWith(".test.ts") &&
        /scrub/i.test(content) &&
        /names? in (free )?prose/i.test(content),
    );
    expect(claims).toEqual([]);
  });
});
