// 27-09 (PACK-02/PACK-04): the discovery plane.
//
// The property this file exists for is ACTIVE-ONLY. The pilot ships dark, six candidates are
// published on the deployment right now, and a discovery query that reached for "the newest row"
// instead of "the active row" would put every one of them in front of every user the moment 27-08
// ran — with no eval evidence, no browser evidence and no owner decision behind any of them.
//
// The second property is that a quick start SHOWS ITS GAPS. Every pack in this pilot has at least
// one matrix-missing source (owner decision A), so offering a title with no preflight would be
// advertising work while hiding the thing the user most needs to know about it.

import { convexTest, type TestConvex } from "convex-test";
import { describe, expect, test } from "vitest";
import aggregateSchema from "../node_modules/@convex-dev/aggregate/src/component/schema.js";
import { api, internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);
const aggregateModules = import.meta.glob(
  "../node_modules/@convex-dev/aggregate/src/component/**/*.ts",
);

const TENANT = "tenant-discovery";
const asTenant = (t: TestConvex<typeof schema>) => t.withIdentity({ subject: TENANT });

/** A published candidate, exactly as `seedPackCandidates` leaves one. */
async function publish(t: TestConvex<typeof schema>, name: string, version = 1) {
  await t.run((ctx) =>
    ctx.db.insert("skills", {
      name,
      version,
      body: `# ${name}`,
      status: "candidate",
      createdAt: 1,
    }),
  );
}

async function activate(t: TestConvex<typeof schema>, name: string, version = 1) {
  await t.run(async (ctx) => {
    const row = await ctx.db
      .query("skills")
      .withIndex("by_name_version", (q) => q.eq("name", name).eq("version", version))
      .unique();
    if (row === null) throw new Error("row missing");
    await ctx.db.patch(row._id, { status: "active" });
  });
}

describe("listPacks is ACTIVE-ONLY", () => {
  test("a deployment full of candidates offers NOTHING", async () => {
    const t = convexTest(schema, modules);
    for (const name of [
      "pack-business-pulse",
      "pack-campaign-plan",
      "pack-customer-complaint",
      "pack-sales-call-prep",
      "pack-process-sop",
      "pack-brand-review",
    ]) {
      await publish(t, name);
    }

    expect(await asTenant(t).query(api.workflowPackDiscovery.listPacks, {})).toEqual([]);
  });

  test("an empty registry offers nothing rather than throwing", async () => {
    const t = convexTest(schema, modules);
    expect(await asTenant(t).query(api.workflowPackDiscovery.listPacks, {})).toEqual([]);
  });

  // The activation gate is what moves a row to `active`, so this is the ONE transition that may
  // change what a user sees. Exactly one pack, not the whole pilot.
  test("activating one pack exposes exactly that pack", async () => {
    const t = convexTest(schema, modules);
    await publish(t, "pack-brand-review");
    await publish(t, "pack-business-pulse");
    await activate(t, "pack-brand-review");

    const packs = await asTenant(t).query(api.workflowPackDiscovery.listPacks, {});
    expect(packs.map((p) => p.packId)).toEqual(["brand-review"]);
    expect(packs[0]?.version).toBe(1);
    expect(packs[0]?.title).toBe("Brand review");
  });

  // An ARCHIVED row is what `deactivatePack` leaves behind. Turning a pack off must remove it from
  // discovery, or "deactivate" would only mean "stop loading its body" while the button stayed.
  test("a deactivated pack disappears from discovery", async () => {
    const t = convexTest(schema, modules);
    await publish(t, "pack-brand-review");
    await activate(t, "pack-brand-review");
    expect(await asTenant(t).query(api.workflowPackDiscovery.listPacks, {})).toHaveLength(1);

    const userId = await t.run((ctx) => ctx.db.insert("users", { owner: true }));
    await t
      .withIdentity({ subject: userId })
      .mutation(api.skills.deactivatePack, { name: "pack-brand-review" });

    expect(await asTenant(t).query(api.workflowPackDiscovery.listPacks, {})).toEqual([]);
  });

  test("an anonymous caller cannot list packs at all", async () => {
    const t = convexTest(schema, modules);
    await publish(t, "pack-brand-review");
    await activate(t, "pack-brand-review");
    await expect(t.query(api.workflowPackDiscovery.listPacks, {})).rejects.toThrow();
  });
});

describe("a quick start carries its own preflight", () => {
  test("the matrix-missing sources are announced with what would unlock them", async () => {
    const t = convexTest(schema, modules);
    await publish(t, "pack-brand-review");
    await activate(t, "pack-brand-review");

    const [pack] = await asTenant(t).query(api.workflowPackDiscovery.listPacks, {});
    // brand-review reads the vault and nothing else; brand guidance and the content shelf are
    // MISSING in the matrix and stay that way (owner decision A).
    const missing = pack?.sources.filter((s) => s.unlock !== null) ?? [];
    expect(missing.map((s) => s.source).sort()).toEqual(["content-shelf", "tenant-brand-guidance"]);
    for (const s of missing) {
      expect(s.state, `${s.source} is unlockable but not reported unavailable`).toBe("unavailable");
      // A gap named without its unlock leaves the user with a complaint instead of a next step.
      expect(s.unlock?.length ?? 0).toBeGreaterThan(10);
      expect(s.label.length).toBeGreaterThan(4);
    }
    expect(pack?.missingKnownCount).toBe(2);
  });

  // A source a pack CAN reach but this tenant has not connected is a different thing from a
  // capability the product does not have — the first is fixable by the user, the second is not.
  test("a runtime gap is counted separately from a matrix gap, and carries no unlock", async () => {
    const t = convexTest(schema, modules);
    await publish(t, "pack-customer-complaint");
    await activate(t, "pack-customer-complaint");

    const [pack] = await asTenant(t).query(api.workflowPackDiscovery.listPacks, {});
    const inbox = pack?.sources.find((s) => s.source === "inbox");
    // No gmailTokens row for this tenant, so the mailbox is unavailable — but it is REACHABLE.
    expect(inbox?.state).toBe("unavailable");
    expect(inbox?.unlock, "a runtime gap must not claim a product-level unlock").toBe(null);
    expect(pack?.missingRuntimeCount).toBe(1);
    expect(pack?.missingKnownCount).toBe(2);
  });

  // The probe is the SAME resolution the run will use — that is the whole reason it moved out of
  // the "use node" binding. If the two ever diverge, a user is shown one preflight and the model is
  // told another.
  test("the query and the binding read one probe, not two", async () => {
    const t = convexTest(schema, modules);
    await publish(t, "pack-business-pulse");
    await activate(t, "pack-business-pulse");

    const direct = await t.query(internal.workflowPackDiscovery.probeSources, {
      tenantId: TENANT,
    });
    const [pack] = await asTenant(t).query(api.workflowPackDiscovery.listPacks, {});
    for (const view of pack?.sources ?? []) {
      const probed = direct[view.source as keyof typeof direct];
      if (probed === undefined) continue; // a matrix-missing source the probe never reports
      expect(view.state, `${view.source} disagrees with the probe`).toBe(probed);
    }
  });
});

// ── 29-07 FIX: the base version the form sends is the one the mutation compares against ──────
//
// THE DEFECT THIS CLOSES. `/dashboard/workflows` derived its `baseCandidateVersion` from
// `skills.myUserSkills`, which returns the tenant's 50 most recent `tenantSkills` rows across ALL
// skill names and only then filters to the pack. `publishPackCustomization` compares against the
// newest row for THAT NAME (`readTenantPublishState`'s `by_tenant_name_version` take(1)). Past the
// window the two disagree permanently: the form sends `null`, the mutation answers
// `stale_base_version`, and its copy says "reload" — which reproduces the same window. The tenant
// can never save again.
//
// `listPacks` now resolves it per name, so this file pins the two values EQUAL under exactly the
// condition that used to break them apart.
describe("listPacks resolves this tenant's base version per PACK, not from a recent-rows window", () => {
  const packHarness = async () => {
    const t = convexTest(schema, modules);
    t.registerComponent("auditCounts", aggregateSchema, aggregateModules);
    await publish(t, "pack-business-pulse", 3);
    await activate(t, "pack-business-pulse", 3);
    const user = await t.run((ctx) => ctx.db.insert("users", {}));
    return { t, user, as: t.withIdentity({ subject: `${user}|session` }) };
  };

  const VALUES = { business_terms: "We say members, not customers." } as const;

  const listed = async (as: ReturnType<TestConvex<typeof schema>["withIdentity"]>) => {
    const packs = await as.query(api.workflowPackDiscovery.listPacks, {});
    const pack = packs.find((p) => p.packId === "business-pulse");
    expect(pack, "business-pulse is active and must be listed").toBeDefined();
    return pack as NonNullable<typeof pack>;
  };

  test("no customization yet reads as null on both halves", async () => {
    const { as } = await packHarness();
    const pack = await listed(as);
    expect(pack.myBaseVersion).toBe(null);
    expect(pack.myCustomizationValues).toBe(null);
  });

  test("after one save it names the newest row, and returns the values back for the form", async () => {
    const { as } = await packHarness();
    const res = await as.mutation(api.skills.publishPackCustomization, {
      templateId: "business-pulse",
      templateVersion: 3,
      baseCandidateVersion: null,
      values: VALUES,
    });
    expect(res.ok).toBe(true);

    const pack = await listed(as);
    // The candidate is v2 — `ensureRollbackBaseline` mints the code-authored v1 first.
    expect(pack.myBaseVersion).toBe(2);
    expect(JSON.parse(pack.myCustomizationValues ?? "null")).toEqual({
      business_terms: "We say members, not customers.",
    });
  });

  test("50 newer rows for OTHER skills hide the pack from myUserSkills — and do not move this", async () => {
    const { t, user, as } = await packHarness();
    const first = await as.mutation(api.skills.publishPackCustomization, {
      templateId: "business-pulse",
      templateVersion: 3,
      baseCandidateVersion: null,
      values: VALUES,
    });
    expect(first.ok).toBe(true);

    // The truncation, built the way it happens in production: an ordinary authoring history that
    // is NEWER than the pack row, which is what pushes the pack row out of the recent window.
    const after = Date.now() + 60_000;
    await t.run(async (ctx) => {
      for (let i = 0; i < 60; i++) {
        await ctx.db.insert("tenantSkills", {
          tenantId: String(user),
          name: "offer-architect",
          version: i + 1,
          body: "b",
          authoredBody: "a",
          status: "candidate",
          author: "user",
          authorUserId: user,
          basedOnName: "offer-architect",
          basedOnScope: "global" as const,
          basedOnVersion: 1,
          rollbackEligible: false,
          createdAt: after + i,
        });
      }
    });

    // THE CONDITION. The old client derivation read this list; the pack row is no longer in it.
    const recent = await as.query(api.skills.myUserSkills, {});
    expect(recent.some((r) => r.name === "pack-business-pulse")).toBe(false);

    // The new derivation is unaffected...
    const pack = await listed(as);
    expect(pack.myBaseVersion).toBe(2);

    // ...and that is the value the mutation accepts. `null` — what the old client would have sent
    // — is refused, which is the loop the user was stuck in.
    const stale = await as.mutation(api.skills.publishPackCustomization, {
      templateId: "business-pulse",
      templateVersion: 3,
      baseCandidateVersion: null,
      values: { business_terms: "changed once" },
    });
    expect(stale.ok).toBe(false);
    if (!stale.ok) {
      expect(stale.reason).toBe("stale_base_version");
      // The refusal carries the same number, so adopting it is a retry the client can win.
      if (stale.reason === "stale_base_version") expect(stale.currentBaseVersion).toBe(2);
    }

    const accepted = await as.mutation(api.skills.publishPackCustomization, {
      templateId: "business-pulse",
      templateVersion: 3,
      baseCandidateVersion: pack.myBaseVersion,
      values: { business_terms: "changed once" },
    });
    expect(accepted.ok, "the listed base version must be the one the mutation accepts").toBe(true);
  });

  test("the system rollback baseline counts — the comparand is the newest row, not the newest USER row", async () => {
    const { t, user, as } = await packHarness();
    // A `system` baseline alone (no user candidate yet), exactly as `ensureRollbackBaseline` writes
    // one. `myUserSkills` filters `system` rows out; the mutation's comparand does not.
    await t.run((ctx) =>
      ctx.db.insert("tenantSkills", {
        tenantId: String(user),
        name: "pack-business-pulse",
        version: 1,
        body: "core",
        authoredBody: "",
        status: "archived",
        author: "system",
        basedOnName: "pack-business-pulse",
        basedOnScope: "global" as const,
        basedOnVersion: 3,
        rollbackEligible: true,
        createdAt: 5,
      }),
    );

    const pack = await listed(as);
    expect(pack.myBaseVersion).toBe(1);
    expect(pack.myCustomizationValues, "a system baseline has no form values").toBe(null);
    expect((await as.query(api.skills.myUserSkills, {})).length).toBe(0);
  });
});
