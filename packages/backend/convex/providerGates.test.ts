// The Phase 28 provider gate plane, tested against a real in-memory Convex backend. Every test is
// $0 — convex-test only, no network, no provider, no model.
//
// WHAT THIS FILE EXISTS TO PROVE. On 2026-08-27 the owner admitted all four providers
// `approved_production`, and THREE of those four rest on human testimony rather than evidence
// (Stripe is an override against its own record; QuickBooks and PayPal are attestations of vendor
// approvals nothing here can check). Not one of the four approvals resolved its record's open
// condition, and no lane has ever run.
//
// So the danger is precise: if "the owner approved this" and "this provider proved itself" ever
// collapse into one flag, wave 7's live-gate seals (28-22..25) become decorative and a provider goes
// discoverable on a say-so. These tests hold the two axes apart:
//
//  1. AN ADMISSION IS NOT A PASSED LANE. `approved_production` + `lane: "parked"` is the normal
//     state for most of this phase and it must resolve to unavailable.
//  2. THE COMPOSITE RULE IS ENFORCED AT THE WRITE, NOT JUST THE READ. `sealGate` refuses to record
//     `passed` for anything the resolver would not call passed — one rule, one implementation.
//  3. THE OPEN CONDITIONS ARE LOAD-BEARING. A provider whose register condition is unresolved
//     cannot be sealed passed, so 28-22..25 cannot skip theirs.
//  4. IT CANNOT CONTRADICT THE READ ALLOW-LIST. `PROVIDER_READ_PATHS.stripe` is `[]` BY DECISION;
//     a provider that may read nothing can never be eligible, whatever the owner approved.
//  5. NO TENANT CAN WIDEN IT. The table is deployment-global with no `tenantId`: two tenants see
//     the identical projection and neither can write.
import {
  ADMISSIONS,
  LANES,
  PROVIDER_OPEN_CONDITIONS,
  PROVIDERS,
  resolveProviderEligibility,
} from "@pikar/revenue";
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import { PROVIDER_READ_PATHS } from "./connectorFetch";
import { openConditionIdsFor } from "./providerGates";
import schema from "./schema";

const modules = import.meta.glob("./**/*.*s");

/** Raw sources for the structural scans. edge-runtime has no `node:fs`. */
const rawSources = import.meta.glob("./**/*.ts", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

const DAY = 86_400_000;

async function harness() {
  const t = convexTest(schema, modules);
  // `owner: true` written straight onto the row rather than through `bootstrapOwner`, which logs an
  // audit event and would drag the `auditCounts` aggregate component into a test about gates.
  // `owner.test.ts` proves the bootstrap path; this file is about what an owner may then seal.
  const ownerId = await t.run((ctx) => ctx.db.insert("users", { owner: true }));
  const otherId = await t.run((ctx) => ctx.db.insert("users", {}));
  return {
    t,
    asOwner: t.withIdentity({ subject: `${ownerId}|session_owner` }),
    asTenantA: t.withIdentity({ subject: `${ownerId}|session_a` }),
    asTenantB: t.withIdentity({ subject: `${otherId}|session_b` }),
  };
}

/** The hubspot condition, resolved from the register copy rather than retyped here. */
const hubspotConditions = () => [...openConditionIdsFor("hubspot")];

const sealArgs = (over: Record<string, unknown> = {}) => ({
  provider: "hubspot" as const,
  environment: "production" as const,
  admission: "approved_production" as const,
  lane: "passed" as const,
  evidenceRef: "28-22-SUMMARY.md#live-read",
  reviewBy: Date.now() + 30 * DAY,
  clearedConditions: hubspotConditions(),
  ...over,
});

// ── The two axes stay apart ───────────────────────────────────────────────────────────────

describe("providerGates — an admission decision is not a passed live gate", () => {
  test("a fresh deployment offers nothing: no row is `pending`, never `passed`", async () => {
    const { asTenantA, asOwner } = await harness();
    expect(await asTenantA.query(api.providerGates.availableProviders, {})).toEqual([]);
    for (const provider of PROVIDERS) {
      const e = await asOwner.query(api.providerGates.inspectGate, {
        provider,
        environment: "production",
      });
      expect(e.eligibility.state).toBe("pending");
    }
  });

  test("approved_production with a lane that never ran is admitted but NOT available", async () => {
    const { asOwner, asTenantA } = await harness();
    await asOwner.mutation(api.providerGates.sealGate, sealArgs({ lane: "parked" }));

    const seen = await asOwner.query(api.providerGates.inspectGate, {
      provider: "hubspot",
      environment: "production",
    });
    expect(seen.admission).toBe("approved_production");
    expect(seen.lane).toBe("parked");
    expect(seen.eligibility.state).toBe("parked");
    expect(seen.eligibility.reasons).toContain("lane_not_passed");
    expect(await asTenantA.query(api.providerGates.availableProviders, {})).toEqual([]);
  });

  test("a lane becomes available only when both axes agree", async () => {
    const { asOwner, asTenantA } = await harness();
    await asOwner.mutation(api.providerGates.sealGate, sealArgs());
    expect(await asTenantA.query(api.providerGates.availableProviders, {})).toEqual([
      { provider: "hubspot", environment: "production" },
    ]);
  });
});

// ── The composite rule is enforced at the WRITE ───────────────────────────────────────────

describe("providerGates.sealGate — a seal cannot invent a pass", () => {
  test("refuses to seal passed while the register's open condition is unresolved", async () => {
    const { asOwner } = await harness();
    await expect(
      asOwner.mutation(api.providerGates.sealGate, sealArgs({ clearedConditions: [] })),
    ).rejects.toThrow(/open_condition_unresolved/);
  });

  test("refuses a condition token that is not one of this provider's conditions", async () => {
    const { asOwner } = await harness();
    await expect(
      asOwner.mutation(
        api.providerGates.sealGate,
        sealArgs({ clearedConditions: ["something-else"] }),
      ),
    ).rejects.toThrow(/open_condition_unresolved/);
  });

  test("refuses to seal passed on evidence that has already expired", async () => {
    const { asOwner } = await harness();
    await expect(
      asOwner.mutation(api.providerGates.sealGate, sealArgs({ reviewBy: Date.now() - 1 })),
    ).rejects.toThrow(/evidence_expired/);
  });

  test("refuses to seal production passed on a beta-only admission", async () => {
    const { asOwner } = await harness();
    await expect(
      asOwner.mutation(api.providerGates.sealGate, sealArgs({ admission: "approved_beta" })),
    ).rejects.toThrow(/admission_does_not_permit/);
  });

  // The point of contact with 28-04 and 28-07. Stripe's allow-list was EMPTY BY DECISION until
  // 28-07 settled the Stripe App route, and while it was, no seal could make Stripe passed.
  test("an empty read allow-list still refuses a pass, whatever the owner approved", () => {
    // Asserted against the pure rule rather than against a provider, because no provider's list is
    // empty any more — and the guard must outlive the one that happened to be empty.
    const verdict = resolveProviderEligibility(
      {
        provider: "stripe",
        environment: "production",
        admission: "approved_production",
        lane: "passed",
        reviewBy: Date.now() + 86_400_000,
        clearedConditions: [...openConditionIdsFor("stripe")],
      },
      { now: Date.now(), readPathCount: 0, openConditions: openConditionIdsFor("stripe") },
    );
    expect(verdict.state).toBe("parked");
    expect(verdict.reasons).toContain("no_read_paths");
  });

  test("with the allow-list filled, a fully evidenced Stripe seal is accepted", async () => {
    const { asOwner } = await harness();
    expect(PROVIDER_READ_PATHS.stripe.length).toBeGreaterThan(0);
    await asOwner.mutation(
      api.providerGates.sealGate,
      sealArgs({
        provider: "stripe",
        clearedConditions: [...openConditionIdsFor("stripe")],
      }),
    );
    const seen = await asOwner.query(api.providerGates.inspectGate, {
      provider: "stripe",
      environment: "production",
    });
    expect(seen.eligibility.state).toBe("passed");
  });

  test("parking a provider is always allowed — a refusal must never be blocked", async () => {
    const { asOwner } = await harness();
    await asOwner.mutation(
      api.providerGates.sealGate,
      sealArgs({
        provider: "stripe",
        lane: "parked",
        clearedConditions: [],
        reviewBy: Date.now() - 1,
      }),
    );
    const seen = await asOwner.query(api.providerGates.inspectGate, {
      provider: "stripe",
      environment: "production",
    });
    expect(seen.lane).toBe("parked");
  });
});

// ── Replay, CAS and re-enable ─────────────────────────────────────────────────────────────

describe("providerGates.sealGate — optimistic revision", () => {
  test("a first seal expects no revision; a second with the same one is refused", async () => {
    const { asOwner } = await harness();
    const first = await asOwner.mutation(api.providerGates.sealGate, sealArgs());
    expect(first.revision).toBe(1);

    await expect(
      asOwner.mutation(api.providerGates.sealGate, sealArgs({ evidenceRef: "other.md#x" })),
    ).rejects.toThrow(/STALE_REVISION/);

    const second = await asOwner.mutation(
      api.providerGates.sealGate,
      sealArgs({ evidenceRef: "other.md#x", expectedRevision: 1 }),
    );
    expect(second.revision).toBe(2);
  });

  test("a revision expected against a row that does not exist is refused", async () => {
    const { asOwner } = await harness();
    await expect(
      asOwner.mutation(api.providerGates.sealGate, sealArgs({ expectedRevision: 1 })),
    ).rejects.toThrow(/STALE_REVISION/);
  });
});

// ── Expiry and live-refresh failure ───────────────────────────────────────────────────────

describe("providerGates — a passed lane does not stay passed", () => {
  test("an expired record resolves expired and leaves the projection, without any write", async () => {
    const { t, asOwner, asTenantA } = await harness();
    await asOwner.mutation(api.providerGates.sealGate, sealArgs());
    expect(await asTenantA.query(api.providerGates.availableProviders, {})).toHaveLength(1);

    // Rewritten under the hood rather than through `sealGate`, which refuses stale evidence — this
    // is the row going stale as TIME passes, which no mutation performs.
    await t.run(async (ctx) => {
      const row = await ctx.db
        .query("providerGates")
        .withIndex("by_provider_environment", (q) =>
          q.eq("provider", "hubspot").eq("environment", "production"),
        )
        .unique();
      if (row === null) throw new Error("no gate row");
      await ctx.db.patch(row._id, { reviewBy: Date.now() - 1 });
    });

    const seen = await asOwner.query(api.providerGates.inspectGate, {
      provider: "hubspot",
      environment: "production",
    });
    expect(seen.lane).toBe("passed");
    expect(seen.eligibility.state).toBe("expired");
    expect(await asTenantA.query(api.providerGates.availableProviders, {})).toEqual([]);
  });

  test("a live-refresh failure moves passed -> failed and empties the projection at once", async () => {
    const { t, asOwner, asTenantA } = await harness();
    await asOwner.mutation(api.providerGates.sealGate, sealArgs());
    expect(await asTenantA.query(api.providerGates.availableProviders, {})).toHaveLength(1);

    await t.mutation(internal.providerGates.recordLaneFailure, {
      provider: "hubspot",
      environment: "production",
      evidenceRef: "connectorCredentials#refresh-401",
    });

    const seen = await asOwner.query(api.providerGates.inspectGate, {
      provider: "hubspot",
      environment: "production",
    });
    expect(seen.lane).toBe("failed");
    expect(seen.eligibility.state).toBe("failed");
    expect(seen.eligibility.reasons).toEqual(["live_gate_failed"]);
    expect(await asTenantA.query(api.providerGates.availableProviders, {})).toEqual([]);
  });

  test("a failure bumps the revision, so an in-flight seal cannot re-enable the lane", async () => {
    const { t, asOwner, asTenantA } = await harness();
    const { revision } = await asOwner.mutation(api.providerGates.sealGate, sealArgs());

    await t.mutation(internal.providerGates.recordLaneFailure, {
      provider: "hubspot",
      environment: "production",
      evidenceRef: "connectorCredentials#refresh-401",
    });

    // The seal a wave-7 operator already had in flight, carrying the pre-failure revision.
    await expect(
      asOwner.mutation(api.providerGates.sealGate, sealArgs({ expectedRevision: revision })),
    ).rejects.toThrow(/STALE_REVISION/);
    expect(await asTenantA.query(api.providerGates.availableProviders, {})).toEqual([]);
  });

  test("a failure on a gate that was never sealed is refused rather than invented", async () => {
    const { t } = await harness();
    await expect(
      t.mutation(internal.providerGates.recordLaneFailure, {
        provider: "paypal",
        environment: "production",
        evidenceRef: "x#y",
      }),
    ).rejects.toThrow(/NO_GATE_RECORD/);
  });
});

// ── Two tenants, one deployment-global answer ─────────────────────────────────────────────

describe("providerGates — no tenant can widen its own provider access", () => {
  test("two tenants read the identical projection", async () => {
    const { asOwner, asTenantA, asTenantB } = await harness();
    await asOwner.mutation(api.providerGates.sealGate, sealArgs());
    const a = await asTenantA.query(api.providerGates.availableProviders, {});
    const b = await asTenantB.query(api.providerGates.availableProviders, {});
    expect(a).toEqual(b);
    expect(a).toEqual([{ provider: "hubspot", environment: "production" }]);
  });

  test("a non-owner tenant can neither seal nor inspect a gate", async () => {
    const { asTenantB } = await harness();
    await expect(asTenantB.mutation(api.providerGates.sealGate, sealArgs())).rejects.toThrow(
      /OWNER_REQUIRED/,
    );
    await expect(
      asTenantB.query(api.providerGates.inspectGate, {
        provider: "hubspot",
        environment: "production",
      }),
    ).rejects.toThrow(/OWNER_REQUIRED/);
  });

  test("an unauthenticated caller cannot read the projection at all", async () => {
    const { t } = await harness();
    await expect(t.query(api.providerGates.availableProviders, {})).rejects.toThrow(
      /UNAUTHENTICATED/,
    );
  });

  test("the projection carries no evidence ref, revision or review date", async () => {
    const { asOwner, asTenantA } = await harness();
    await asOwner.mutation(api.providerGates.sealGate, sealArgs());
    const [entry] = await asTenantA.query(api.providerGates.availableProviders, {});
    expect(Object.keys(entry ?? {}).sort()).toEqual(["environment", "provider"]);
  });
});

// ── Structural scans: the module cannot grow a public write ───────────────────────────────

describe("providerGates — structural guarantees", () => {
  const source = rawSources["./providerGates.ts"] ?? "";

  test("the module imports no function builder outside the sanctioned set", () => {
    expect(source).not.toBe("");
    // WHOLE-VALUE comparison of the imported NAMES, not a substring search for banned ones:
    // `tenantMutation` contains `Mutation`, `ownerMutation` contains `Mutation`, and a scan that
    // looked for `mutation(` would either miss the ban or fire on the sanctioned builder. Listing
    // what is allowed also fails on a builder nobody thought to ban.
    const imported = [...source.matchAll(/import\s*\{([^}]*)\}\s*from\s*"([^"]+)"/g)]
      .filter(([, , from]) => from === "./_generated/server" || from === "./lib/functions")
      .flatMap(([, names]) => (names ?? "").split(","))
      .map(
        (n) =>
          n
            .trim()
            .replace(/^type\s+/, "")
            .split(/\s+as\s+/)[0] ?? "",
      )
      .filter((n) => n !== "");
    expect(imported.slice().sort()).toEqual(
      [
        "MutationCtx",
        "QueryCtx",
        "internalMutation",
        "internalQuery",
        "ownerMutation",
        "ownerQuery",
        "tenantQuery",
      ]
        .slice()
        .sort(),
    );
  });

  test("eligibility is resolved in ONE place — the pure rule, never re-derived here", () => {
    expect(source).toContain("resolveProviderEligibility");
    // Scoped to the PROJECTION, which is where a shortcut would actually do damage: a filter that
    // read the stored `lane` directly would skip expiry, the admission axis, the allow-list and the
    // open conditions all at once, and would still look right.
    const at = source.indexOf("export const availableProviders");
    expect(at).toBeGreaterThan(0);
    const projection = source.slice(at, source.indexOf("export const inspectGate"));
    expect(projection).toContain("resolve(");
    expect(projection).not.toContain("lane");
  });

  test("the schema's lane literals are exactly LANES, and provider literals exactly PROVIDERS", () => {
    const schemaSource = rawSources["./schema.ts"] ?? "";
    const start = schemaSource.indexOf("providerGates: defineTable(");
    expect(start).toBeGreaterThan(0);
    const block = schemaSource.slice(start, schemaSource.indexOf("by_provider_environment", start));

    /** The one union, delimited by its own balanced parens — a `"),\n"` delimiter stops at the
     *  FIRST literal of a multi-line union and reads as an empty set, which would pass vacuously
     *  against a union that had been emptied. */
    const literalsAfter = (field: string) => {
      const open = block.indexOf(`${field}: v.union(`) + `${field}: v.union`.length;
      expect(open).toBeGreaterThan(0);
      let depth = 0;
      let end = open;
      do {
        if (block[end] === "(") depth += 1;
        if (block[end] === ")") depth -= 1;
        end += 1;
      } while (depth > 0 && end < block.length);
      const region = block.slice(open, end);
      return [...region.matchAll(/v\.literal\("([a-z_]+)"\)/g)].map((m) => m[1]).sort();
    };
    expect(literalsAfter("lane")).toEqual([...LANES].sort());
    expect(literalsAfter("provider")).toEqual([...PROVIDERS].sort());
    // `undecided` has NO schema literal on purpose: a missing row IS undecided, so there is exactly
    // one representation of "nobody judged this".
    expect(literalsAfter("admission")).toEqual(
      ADMISSIONS.filter((a) => a !== "undecided")
        .slice()
        .sort(),
    );
    expect(literalsAfter("admission")).not.toContain("undecided");
  });

  test("every provider's open conditions are exposed to the wave-7 plans that owe them", () => {
    for (const provider of PROVIDERS) {
      expect(openConditionIdsFor(provider)).toEqual(
        PROVIDER_OPEN_CONDITIONS[provider].map((c) => c.id),
      );
      expect(openConditionIdsFor(provider).length).toBeGreaterThan(0);
    }
  });

  test("the adapter and the pure rule agree on what a sealed row means", () => {
    // Belt and braces: the same record the adapter would build, resolved directly.
    expect(
      resolveProviderEligibility(
        {
          provider: "hubspot",
          environment: "production",
          admission: "approved_production",
          lane: "passed",
          reviewBy: Date.now() + DAY,
          clearedConditions: hubspotConditions(),
        },
        {
          now: Date.now(),
          readPathCount: PROVIDER_READ_PATHS.hubspot.length,
          openConditions: hubspotConditions(),
        },
      ).state,
    ).toBe("passed");
  });
});
