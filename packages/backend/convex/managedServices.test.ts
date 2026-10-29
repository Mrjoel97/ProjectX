import { readFileSync } from "node:fs";
import { projectAuditRow } from "@pikar/contracts/auditProjection";
import {
  deletableTables,
  exportableTables,
  type TenantDataExportPage,
} from "@pikar/core/tenantData";
import { makeFunctionReference } from "convex/server";
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { confirmServiceKnowledgeFixture } from "../__fixtures__/serviceKnowledge";
import aggregateSchema from "../node_modules/@convex-dev/aggregate/src/component/schema.js";
import { api, internal } from "./_generated/api";
import { contentHash } from "./lib/hash";
import schema from "./schema";

const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);
const aggregateModules = import.meta.glob(
  "../node_modules/@convex-dev/aggregate/src/component/**/!(*.test).ts",
);
const base = {
  serviceId: "weekly-review",
  expectedRevision: 0,
  goal: "PRIVATE_GOAL_7f2b1",
  operationIds: ["business.review" as const],
  accounts: [],
  skills: [],
  budgetLimitCents: 0,
};
async function harness() {
  const t = convexTest(schema, modules);
  t.registerComponent("auditCounts", aggregateSchema, aggregateModules);
  const a = await t.run((ctx) => ctx.db.insert("users", { owner: false }));
  const b = await t.run((ctx) => ctx.db.insert("users", { owner: false }));
  return {
    t,
    a,
    b,
    asA: t.withIdentity({ subject: `${a}|a` }),
    asB: t.withIdentity({ subject: `${b}|b` }),
  };
}

test("ordinary authenticated tenants own independent setup; missing/foreign status reveals nothing", async () => {
  const { t, a, b, asA, asB } = await harness();
  await asA.mutation(api.managedServices.setup, base);
  expect(await asB.query(api.managedServices.status, { serviceId: base.serviceId })).toBeNull();
  await asB.mutation(api.managedServices.setup, { ...base, goal: "B_ONLY_GOAL" });
  const rows = await t.run((ctx) => ctx.db.query("managedServices").collect());
  expect(rows.map((r) => r.tenantId).sort()).toEqual([a, b].sort());
  const listA = await asA.query(api.managedServices.list, {});
  expect(listA.items).toHaveLength(1);
  expect(JSON.stringify(listA)).toContain(base.goal);
  expect(JSON.stringify(listA)).not.toContain("B_ONLY_GOAL");
  expect(
    (await asA.query(api.managedServices.status, { serviceId: base.serviceId }))?.readiness,
  ).toMatchObject({ ready: false, qualification: "unavailable" });
});

test("native authentication and exact argument validation reject missing auth and client-selected tenant", async () => {
  const { t, asA, b } = await harness();
  await expect(t.mutation(api.managedServices.setup, base)).rejects.toThrow("UNAUTHENTICATED");
  const forged = makeFunctionReference<"mutation">("managedServices:setup");
  await expect(asA.mutation(forged, { ...base, tenantId: b })).rejects.toThrow();
  await expect(
    asA.mutation(forged, { ...base, admittedOperationIds: ["business.review"] }),
  ).rejects.toThrow();
  expect(await t.run((ctx) => ctx.db.query("managedServices").collect())).toHaveLength(0);
});

test("CAS is native and concurrent edits cannot both win; configuration revisions fence prior controls", async () => {
  const { asA } = await harness();
  await asA.mutation(api.managedServices.setup, base);
  const edits = await Promise.allSettled(
    ["one", "two"].map((goal) =>
      asA.mutation(api.managedServices.setup, { ...base, expectedRevision: 1, goal }),
    ),
  );
  expect(edits.filter((x) => x.status === "fulfilled")).toHaveLength(1);
  expect(edits.filter((x) => x.status === "rejected")).toHaveLength(1);
  const status = await asA.query(api.managedServices.status, { serviceId: base.serviceId });
  expect(status).toMatchObject({ revision: 2, controlRevision: 2 });
  await expect(
    asA.query(api.managedServices.readiness, { serviceId: base.serviceId, expectedRevision: 1 }),
  ).rejects.toThrow("SERVICE_STALE_REVISION");
});

test("foreign and nonexistent connection references share a refusal; status never exposes credential bytes", async () => {
  const { t, a, asA, asB } = await harness();
  await t.run((ctx) =>
    ctx.db.insert("bufferConnections", {
      tenantId: a,
      connectionId: "owned-connection",
      revision: 1,
      status: "connected",
      keyVersion: "v1",
      ciphertextB64: "CREDENTIAL_NEEDLE_75ae",
      ivB64: "IV_NEEDLE",
      expiresAt: Date.now() + 100000,
      updatedAt: 1,
      channels: [
        { id: "channel", name: "PRIVATE_CHANNEL_NAME", service: "instagram", available: true },
      ],
      selectedChannelIds: ["channel"],
      dailyReports: false,
      nextReportAt: 0,
    }),
  );
  const accounts = [
    {
      provider: "buffer" as const,
      connectionId: "owned-connection",
      accountId: "channel",
      connectionRevision: 1,
    },
  ];
  for (const client of [asB])
    await expect(client.mutation(api.managedServices.setup, { ...base, accounts })).rejects.toThrow(
      "SERVICE_REFERENCE_NOT_OWNED",
    );
  await expect(
    asB.mutation(api.managedServices.setup, {
      ...base,
      accounts: [{ ...accounts[0], connectionId: "nonexistent" }] as typeof accounts,
    }),
  ).rejects.toThrow("SERVICE_REFERENCE_NOT_OWNED");
  await asA.mutation(api.managedServices.setup, { ...base, accounts });
  const status = await asA.query(api.managedServices.status, { serviceId: base.serviceId });
  expect(status?.readiness.accounts[0]?.connected).toBe(true);
  expect(JSON.stringify(status)).not.toMatch(/CREDENTIAL_NEEDLE|IV_NEEDLE|PRIVATE_CHANNEL_NAME/);
});

test("disconnected, unselected, unavailable and changed permission pins each fail independently", async () => {
  const { t, a, asA } = await harness();
  const initial = {
    tenantId: a,
    connectionId: "c",
    revision: 1,
    status: "connected" as const,
    keyVersion: "v1" as const,
    ciphertextB64: "LOCAL_KEY_NEEDLE",
    ivB64: "LOCAL_IV_NEEDLE",
    expiresAt: Date.now() + 100000,
    updatedAt: 1,
    channels: [{ id: "ch", name: "label", service: "instagram", available: true }],
    selectedChannelIds: ["ch"],
    dailyReports: false,
    nextReportAt: 0,
  };
  const id = await t.run((ctx) => ctx.db.insert("bufferConnections", initial));
  await asA.mutation(api.managedServices.setup, {
    ...base,
    accounts: [{ provider: "buffer", connectionId: "c", accountId: "ch", connectionRevision: 1 }],
  });
  expect(
    (
      await asA.query(api.managedServices.readiness, {
        serviceId: base.serviceId,
        expectedRevision: 1,
      })
    ).accounts[0]?.connected,
  ).toBe(true);
  for (const patch of [
    { status: "disconnected" as const },
    { selectedChannelIds: [] },
    { channels: [{ ...initial.channels[0], available: false }] as typeof initial.channels },
    { revision: 2 },
  ]) {
    await t.run((ctx) => ctx.db.replace(id, { ...initial, ...patch }));
    expect(
      (
        await asA.query(api.managedServices.readiness, {
          serviceId: base.serviceId,
          expectedRevision: 1,
        })
      ).reasons,
    ).toContain("account_unavailable");
  }
});

test("foreign tenant skills cannot be saved; candidate, stale hash and effective override never qualify", async () => {
  const { t, a, b, asA, asB } = await harness();
  const global = await t.run((ctx) =>
    ctx.db.insert("skills", {
      name: "style-test",
      version: 1,
      body: "SKILL_BODY_NEEDLE",
      status: "active",
      createdAt: 1,
    }),
  );
  const pin = {
    skillId: global,
    name: "style-test",
    version: 1,
    bodyHash: await contentHash("SKILL_BODY_NEEDLE"),
    tenantId: null,
  };
  await asA.mutation(api.managedServices.setup, { ...base, skills: [pin] });
  expect(
    (
      await asA.query(api.managedServices.readiness, {
        serviceId: base.serviceId,
        expectedRevision: 1,
      })
    ).skills[0]?.qualified,
  ).toBe(true);
  await t.run((ctx) => ctx.db.patch(global, { status: "candidate" }));
  expect(
    (
      await asA.query(api.managedServices.readiness, {
        serviceId: base.serviceId,
        expectedRevision: 1,
      })
    ).reasons,
  ).toContain("skill_unqualified");
  await t.run((ctx) => ctx.db.patch(global, { status: "active", body: "CHANGED_BODY" }));
  expect(
    (
      await asA.query(api.managedServices.readiness, {
        serviceId: base.serviceId,
        expectedRevision: 1,
      })
    ).reasons,
  ).toContain("skill_unqualified");
  const owned = await t.run((ctx) =>
    ctx.db.insert("tenantSkills", {
      tenantId: a,
      name: "style-test",
      version: 2,
      body: "overlay",
      authoredBody: "",
      author: "system",
      status: "active",
      rollbackEligible: true,
      basedOnScope: "global",
      basedOnName: "style-test",
      basedOnVersion: 1,
      basedOnGlobalSkillId: global,
      createdAt: 1,
    }),
  );
  await expect(
    asB.mutation(api.managedServices.setup, {
      ...base,
      skills: [{ ...pin, skillId: owned, tenantId: a }],
    }),
  ).rejects.toThrow("foreign_tenant");
  await expect(
    asB.mutation(api.managedServices.setup, {
      ...base,
      skills: [{ ...pin, skillId: owned, tenantId: b }],
    }),
  ).rejects.toThrow("SERVICE_REFERENCE_NOT_OWNED");
  await t.run((ctx) => ctx.db.patch(global, { body: "SKILL_BODY_NEEDLE" }));
  const status = await asA.query(api.managedServices.status, { serviceId: base.serviceId });
  expect(status?.readiness.reasons).toContain("skill_unqualified");
  expect(JSON.stringify(status)).not.toContain("SKILL_BODY_NEEDLE");
});

test("business source requires owned ready nonempty business profile; a blueprint alone never qualifies", async () => {
  const { t, a, b, asA } = await harness();
  await asA.mutation(api.managedServices.setup, base);
  expect(
    (
      await asA.query(api.managedServices.readiness, {
        serviceId: base.serviceId,
        expectedRevision: 1,
      })
    ).missingSources,
  ).toEqual(["business_profile"]);
  const doc = await t.run((ctx) =>
    ctx.db.insert("vaultDocuments", {
      tenantId: b,
      title: "private",
      kind: "blueprint",
      category: "business",
      source: "test",
      mimeType: "text/plain",
      size: 1,
      contentHash: "a".repeat(64),
      status: "ready",
      createdAt: 1,
    }),
  );
  await t.run((ctx) =>
    ctx.db.insert("tenantProfiles", {
      tenantId: a,
      tier: "startup",
      tierSource: "legacy",
      derivedAt: 1,
      blueprintDocId: doc,
    }),
  );
  expect(
    (
      await asA.query(api.managedServices.readiness, {
        serviceId: base.serviceId,
        expectedRevision: 1,
      })
    ).sources.businessProfileReady,
  ).toBe(false);
  await t.run((ctx) => ctx.db.patch(doc, { tenantId: a, text: "blueprint only" }));
  expect(
    (
      await asA.query(api.managedServices.readiness, {
        serviceId: base.serviceId,
        expectedRevision: 1,
      })
    ).sources.businessProfileReady,
  ).toBe(false);
  await t.run((ctx) => ctx.db.patch(doc, { kind: "business_profile", status: "processing" }));
  expect(
    (
      await asA.query(api.managedServices.readiness, {
        serviceId: base.serviceId,
        expectedRevision: 1,
      })
    ).sources.businessProfileReady,
  ).toBe(false);
  await t.run((ctx) => ctx.db.patch(doc, { status: "ready" }));
  await t.run(async (ctx) => {
    for (const profile of await ctx.db.query("tenantProfiles").collect())
      await ctx.db.delete(profile._id);
  });
  const result = await asA.query(api.managedServices.readiness, {
    serviceId: base.serviceId,
    expectedRevision: 1,
  });
  expect(result.missingSources).toEqual([]);
  expect(result.ready).toBe(false);
  expect(result.reasons).toContain("operation_unqualified");
  await t.run((ctx) => ctx.db.patch(doc, { text: "   " }));
  expect(
    (
      await asA.query(api.managedServices.readiness, {
        serviceId: base.serviceId,
        expectedRevision: 1,
      })
    ).missingSources,
  ).toEqual(["business_profile"]);
});

test("pause/stop CAS persists control fences; editing never resumes; audit contains refs and enums only", async () => {
  const { t, asA, asB } = await harness();
  await asA.mutation(api.managedServices.setup, base);
  await expect(
    asB.mutation(api.managedServices.setControl, {
      serviceId: base.serviceId,
      expectedRevision: 1,
      expectedControlRevision: 1,
      action: "stop",
    }),
  ).rejects.toThrow("SERVICE_STALE_REVISION");
  expect(
    await asA.mutation(api.managedServices.setControl, {
      serviceId: base.serviceId,
      expectedRevision: 1,
      expectedControlRevision: 1,
      action: "pause",
    }),
  ).toMatchObject({
    controlRevision: 2,
    controlState: "paused",
    providerCancellationRequested: false,
  });
  await expect(
    asA.mutation(api.managedServices.setControl, {
      serviceId: base.serviceId,
      expectedRevision: 1,
      expectedControlRevision: 1,
      action: "stop",
    }),
  ).rejects.toThrow("SERVICE_STALE_REVISION");
  await asA.mutation(api.managedServices.setup, { ...base, expectedRevision: 1 });
  expect(await asA.query(api.managedServices.status, { serviceId: base.serviceId })).toMatchObject({
    controlState: "paused",
    revision: 2,
    controlRevision: 3,
  });
  await asA.mutation(api.managedServices.setControl, {
    serviceId: base.serviceId,
    expectedRevision: 2,
    expectedControlRevision: 3,
    action: "stop",
  });
  await asA.mutation(api.managedServices.setup, { ...base, expectedRevision: 2 });
  expect(await asA.query(api.managedServices.status, { serviceId: base.serviceId })).toMatchObject({
    controlState: "stopped",
    revision: 3,
    controlRevision: 5,
  });
  await expect(
    asA.mutation(api.managedServices.setControl, {
      serviceId: base.serviceId,
      expectedRevision: 3,
      expectedControlRevision: 5,
      action: "pause",
    }),
  ).rejects.toThrow("SERVICE_INVALID_CONTROL");
  const events = await t.run((ctx) => ctx.db.query("audit").collect());
  expect(events).toHaveLength(2);
  expect(Object.keys(events[0]?.payload ?? {}).sort()).toEqual([
    "controlRevision",
    "controlState",
    "revision",
    "serviceRef",
  ]);
  expect(events.map(projectAuditRow).every((e) => e.known && e.unsafeDrops === 0)).toBe(true);
  expect(JSON.stringify(events)).not.toContain(base.goal);
});

test("control audit projection refuses free text, credentials and nested payloads", () => {
  const row = projectAuditRow({
    ts: 1,
    actor: "user",
    correlationId: "safe-ref",
    eventType: "managed_service.control_changed",
    payload: {
      serviceRef: "private body prose must not pass",
      revision: 1,
      controlRevision: 2,
      controlState: "paused",
      goal: "GOAL_NEEDLE",
      ciphertextB64: "CREDENTIAL_NEEDLE",
      skillBody: "BODY_NEEDLE",
      nested: { token: "TOKEN_NEEDLE" },
    },
  });
  expect(row.known).toBe(true);
  expect(row.refs).toEqual({ revision: 1, controlRevision: 2, controlState: "paused" });
  expect(row.unsafeDrops).toBe(1);
  expect(JSON.stringify(row)).not.toMatch(/NEEDLE|private body/);
});

test("Zernio account source resolves only selected available accounts with local key material", async () => {
  const { t, a, asA } = await harness();
  const id = await t.run((ctx) =>
    ctx.db.insert("zernioConnections", {
      tenantId: a,
      connectionId: "z",
      profileId: "p",
      revision: 3,
      status: "connected",
      channels: [{ id: "ig", name: "PRIVATE_ZERNIO_NAME", platform: "instagram", available: true }],
      selectedAccountIds: ["ig"],
      dailyReports: false,
      nextReportAt: 0,
      nextRefreshAt: 0,
      updatedAt: 1,
      ciphertextB64: "ZERNIO_CREDENTIAL_NEEDLE",
      ivB64: "secret-iv",
      keyVersion: "v1",
    }),
  );
  await asA.mutation(api.managedServices.setup, {
    ...base,
    operationIds: ["social.report"],
    accounts: [{ provider: "zernio", connectionId: "z", accountId: "ig", connectionRevision: 3 }],
  });
  const before = await asA.query(api.managedServices.status, { serviceId: base.serviceId });
  expect(before?.readiness.accounts[0]?.connected).toBe(true);
  expect(before?.readiness.ready).toBe(false);
  expect(JSON.stringify(before)).not.toMatch(/ZERNIO_CREDENTIAL|PRIVATE_ZERNIO_NAME|secret-iv/);
  await t.run((ctx) => ctx.db.patch(id, { ciphertextB64: undefined, ivB64: undefined }));
  expect(
    (
      await asA.query(api.managedServices.readiness, {
        serviceId: base.serviceId,
        expectedRevision: 1,
      })
    ).reasons,
  ).toContain("account_unavailable");
});

test("Buffer permission pins survive ordinary credential refresh but fail on changed channel selection", async () => {
  const { t, a, asA } = await harness();
  const channelId = "a".repeat(24),
    otherId = "b".repeat(24);
  const id = await t.run((ctx) =>
    ctx.db.insert("bufferConnections", {
      tenantId: a,
      connectionId: "refreshable",
      revision: 1,
      status: "connected",
      keyVersion: "v1",
      ciphertextB64: "refreshable-ciphertext",
      ivB64: "iv",
      expiresAt: 0,
      updatedAt: 1,
      organizationId: "c".repeat(24),
      channels: [
        { id: channelId, name: "Selected", service: "linkedin", available: true },
        { id: otherId, name: "Other", service: "linkedin", available: true },
      ],
      selectedChannelIds: [channelId],
      dailyReports: false,
      nextReportAt: 0,
    }),
  );
  await asA.mutation(api.managedServices.setup, {
    ...base,
    accounts: [
      {
        provider: "buffer",
        connectionId: "refreshable",
        accountId: channelId,
        connectionRevision: 1,
      },
    ],
  });
  const inspect = () =>
    asA.query(api.managedServices.readiness, { serviceId: base.serviceId, expectedRevision: 1 });
  // Expired access is refreshable only while the owned encrypted grant remains present.
  expect((await inspect()).accounts[0]?.connected).toBe(true);
  expect(
    await t.mutation(internal.buffer.claimRefresh, {
      tenantId: a,
      connectionId: "refreshable",
      revision: 1,
      lease: "refresh-once",
    }),
  ).toBe(true);
  expect(
    await t.mutation(internal.buffer.finishRefresh, {
      tenantId: a,
      connectionId: "refreshable",
      revision: 1,
      lease: "refresh-once",
      expiresAt: Date.now() + 100000,
      credential: { ciphertextB64: "rotated", ivB64: "rotated-iv", keyVersion: "v1" },
    }),
  ).toBe(true);
  expect(await t.run((ctx) => ctx.db.get(id))).toMatchObject({ revision: 2, grantRevision: 1 });
  expect((await inspect()).accounts[0]?.connectionRevision).toBe(1);
  expect((await inspect()).reasons).not.toContain("account_unavailable");
  expect(
    (await asA.query(api.managedServices.setupOptions, {})).accounts[0]?.connectionRevision,
  ).toBe(1);
  await asA.mutation(api.buffer.selectChannels, {
    channelIds: [channelId, otherId],
    dailyReports: false,
  });
  expect((await inspect()).reasons).toContain("account_unavailable");
  await t.run((ctx) =>
    ctx.db.patch(id, { expiresAt: 0, ciphertextB64: undefined, ivB64: undefined }),
  );
  expect((await inspect()).accounts[0]?.connected).toBe(false);
});

test("setup limit and list truncation are explicit and tenant indexed", async () => {
  const { t, a, asA } = await harness();
  await asA.mutation(api.managedServices.setup, base);
  const row = await t.run((ctx) => ctx.db.query("managedServices").first());
  if (!row) throw new Error("MISSING_POSITIVE_ROW");
  await t.run(async (ctx) => {
    for (let i = 1; i <= 50; i++) {
      const { _id, _creationTime: _time, ...values } = row;
      await ctx.db.insert("managedServices", { ...values, tenantId: a, serviceId: `svc-${i}` });
    }
  });
  expect(await asA.query(api.managedServices.list, {})).toMatchObject({ truncated: true });
  expect((await asA.query(api.managedServices.list, {})).items).toHaveLength(50);
  await expect(
    asA.mutation(api.managedServices.setup, { ...base, serviceId: "new" }),
  ).rejects.toThrow("SERVICE_LIMIT_REACHED");
});

test("setup is included in the real tenant export and native erasure page; foreign setup survives", async () => {
  const { t, a, b, asA, asB } = await harness();
  await asA.mutation(api.managedServices.setup, base);
  await asB.mutation(api.managedServices.setup, { ...base, goal: "B_ONLY" });
  const page = (await asA.query(api.tenantExport.exportTenantData, {
    cursor: {
      tableIndex: exportableTables().indexOf("managedServices"),
      cursor: null,
      rowsExported: 0,
      tableRows: 0,
      truncated: false,
      generatedAt: new Date().toISOString(),
    },
  })) as TenantDataExportPage;
  expect(page.table.name).toBe("managedServices");
  expect(JSON.stringify(page.table.rows)).toContain(base.goal);
  expect(JSON.stringify(page.table.rows)).not.toContain("B_ONLY");
  await t.mutation(internal.tenantDelete.deleteTenantDataPage, {
    tenantId: a,
    userId: a,
    cursor: { tableIndex: deletableTables().indexOf("managedServices") },
  });
  const rows = await t.run((ctx) => ctx.db.query("managedServices").collect());
  expect(rows).toHaveLength(1);
  expect(rows[0]?.tenantId).toBe(b);
});

test("no runtime, scheduler, provider or credential import can be reached from setup", () => {
  const source = readFileSync(new URL("./managedServices.ts", import.meta.url), "utf8");
  expect(source).not.toMatch(
    /from ["']\.\/(?:llm|dispatch|bufferActions|zernioActions)|ctx\.scheduler|ctx\.runAction|tenantAction\(/,
  );
  expect(source).toContain(
    'const ATTENDED_SOCIAL_OPERATIONS = ["social.prepare", "social.report"] as const;',
  );
  expect(source).toContain("admittedOperationIds: builtInScope ? ATTENDED_SOCIAL_OPERATIONS : []");
  expect(source).not.toMatch(/process\.env|import\.meta\.env/);
});

async function socialFixture() {
  const f = await harness();
  const body = "Synthetic qualified global Executive instructions";
  const bodyHash = await contentHash(body);
  const refs = await f.t.run(async (ctx) => {
    const skillId = await ctx.db.insert("skills", {
      name: "cockpit-agent",
      version: 1,
      body,
      status: "active",
      createdAt: Date.now(),
    });
    const bufferId = await ctx.db.insert("bufferConnections", {
      tenantId: f.a,
      connectionId: "buffer-owned",
      revision: 1,
      grantRevision: 1,
      status: "connected",
      keyVersion: "v1",
      ciphertextB64: "SYNTHETIC_SECRET",
      ivB64: "SYNTHETIC_IV",
      expiresAt: Date.now() + 100_000,
      organizationId: "org",
      updatedAt: Date.now(),
      channels: [
        {
          id: "aaaaaaaaaaaaaaaaaaaaaaaa",
          name: "Owned Buffer",
          service: "instagram",
          available: true,
        },
      ],
      selectedChannelIds: ["aaaaaaaaaaaaaaaaaaaaaaaa"],
      dailyReports: false,
      nextReportAt: 0,
    });
    const zernioId = await ctx.db.insert("zernioConnections", {
      tenantId: f.a,
      connectionId: "zernio-owned",
      profileId: "bbbbbbbbbbbbbbbbbbbbbbbb",
      revision: 1,
      status: "connected",
      keyVersion: "v1",
      ciphertextB64: "SYNTHETIC_SECRET",
      ivB64: "SYNTHETIC_IV",
      channels: [
        {
          id: "cccccccccccccccccccccccc",
          name: "Owned Instagram",
          platform: "instagram",
          available: true,
        },
      ],
      selectedAccountIds: ["cccccccccccccccccccccccc"],
      dailyReports: false,
      nextReportAt: 0,
      nextRefreshAt: 0,
      updatedAt: Date.now(),
    });
    return { skillId, bufferId, zernioId };
  });
  const config = {
    serviceId: "social-marketing",
    expectedRevision: 0,
    goal: "Prepare and report on selected social accounts",
    operationIds: ["social.prepare" as const, "social.report" as const],
    accounts: [
      {
        provider: "buffer" as const,
        connectionId: "buffer-owned",
        accountId: "aaaaaaaaaaaaaaaaaaaaaaaa",
        connectionRevision: 1,
      },
      {
        provider: "zernio" as const,
        connectionId: "zernio-owned",
        accountId: "cccccccccccccccccccccccc",
        connectionRevision: 1,
      },
    ],
    skills: [
      { skillId: refs.skillId, name: "cockpit-agent", version: 1, bodyHash, tenantId: null },
    ],
    budgetLimitCents: 100,
  };
  const saved = await f.asA.mutation(api.managedServices.setup, config);
  const foundationSetting = process.env.FOUNDATION_ONBOARDING_ENABLED;
  process.env.FOUNDATION_ONBOARDING_ENABLED = "1";
  try {
    await confirmServiceKnowledgeFixture(f.t, f.a);
  } finally {
    if (foundationSetting === undefined) delete process.env.FOUNDATION_ONBOARDING_ENABLED;
    else process.env.FOUNDATION_ONBOARDING_ENABLED = foundationSetting;
  }
  const readiness = () =>
    f.asA.query(api.managedServices.readiness, {
      serviceId: config.serviceId,
      expectedRevision: 1,
    });
  return { ...f, ...refs, config, saved, readiness };
}

test("production readiness and setup options accept the existing active bootstrap body without inventing evaluation evidence", async () => {
  const f = await socialFixture();
  expect(await f.t.run((ctx) => ctx.db.get(f.skillId))).toMatchObject({
    status: "active",
    version: 1,
  });
  expect((await f.t.run((ctx) => ctx.db.get(f.skillId)))?.evidence).toBeUndefined();
  expect((await f.asA.query(api.managedServices.setupOptions, {})).skills).toEqual(f.config.skills);
  expect(await f.readiness()).toMatchObject({
    ready: true,
    reasons: [],
    qualification: "builtin_attended_social",
  });
  const claimed = await f.t.mutation(internal.managedServiceRuns.claim, {
    tenantId: f.a,
    serviceId: f.config.serviceId,
    expectedRevision: 1,
    expectedControlRevision: 1,
    requestKey: "native-qualified-social",
  });
  expect(claimed).toMatchObject({ state: "claimed", existing: false });
  expect(await f.t.run((ctx) => ctx.db.query("managedServiceRuns").collect())).toHaveLength(1);
  expect(await f.t.run((ctx) => ctx.db.query("spendEvents").collect())).toHaveLength(0);
  expect(
    await f.t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect()),
  ).toHaveLength(0);
  expect(JSON.stringify(await f.readiness())).not.toMatch(/SYNTHETIC_SECRET|SYNTHETIC_IV/);
});

test("an active tenant cockpit override, global candidate, changed version or body refuses attended admission", async () => {
  for (const changed of ["overlay", "candidate", "version", "body"] as const) {
    const f = await socialFixture();
    await f.t.run(async (ctx) => {
      if (changed === "candidate") await ctx.db.patch(f.skillId, { status: "candidate" });
      if (changed === "version") await ctx.db.patch(f.skillId, { version: 2 });
      if (changed === "body") await ctx.db.patch(f.skillId, { body: "Another unpinned body" });
      if (changed === "overlay")
        await ctx.db.insert("tenantSkills", {
          tenantId: f.a,
          name: "cockpit-agent",
          version: 2,
          body: "Owned override",
          authoredBody: "",
          author: "system",
          status: "active",
          rollbackEligible: true,
          basedOnScope: "global",
          basedOnName: "cockpit-agent",
          basedOnVersion: 1,
          basedOnGlobalSkillId: f.skillId,
          createdAt: Date.now(),
        });
    });
    expect(await f.readiness()).toMatchObject({ ready: false, qualification: "unavailable" });
    expect((await f.readiness()).reasons).toContain("skill_unqualified");
    await expect(
      f.t.mutation(internal.managedServiceRuns.claim, {
        tenantId: f.a,
        serviceId: f.config.serviceId,
        expectedRevision: 1,
        expectedControlRevision: 1,
        requestKey: "refused-skill",
      }),
    ).rejects.toThrow("SERVICE_EXECUTION_UNAVAILABLE");
    expect(await f.t.run((ctx) => ctx.db.query("managedServiceRuns").collect())).toHaveLength(0);
  }
});

test("native scope, permission generation, control and budget limits remain independent admission fences", async () => {
  for (const changed of [
    "buffer-permission",
    "zernio-permission",
    "selection",
    "connection",
    "unavailable",
    "paused",
    "zero-budget",
    "excess-budget",
  ] as const) {
    const f = await socialFixture();
    await f.t.run(async (ctx) => {
      if (changed === "buffer-permission") await ctx.db.patch(f.bufferId, { grantRevision: 2 });
      if (changed === "zernio-permission") await ctx.db.patch(f.zernioId, { revision: 2 });
      if (changed === "selection") await ctx.db.patch(f.zernioId, { selectedAccountIds: [] });
      if (changed === "connection") await ctx.db.patch(f.bufferId, { status: "reauth_required" });
      if (changed === "unavailable")
        await ctx.db.patch(f.zernioId, {
          channels: [
            {
              id: "cccccccccccccccccccccccc",
              name: "Owned",
              platform: "instagram",
              available: false,
            },
          ],
        });
      if (changed === "paused") await ctx.db.patch(f.saved.id, { controlState: "paused" });
      if (changed === "zero-budget") await ctx.db.patch(f.saved.id, { budgetLimitCents: 0 });
      if (changed === "excess-budget") await ctx.db.patch(f.saved.id, { budgetLimitCents: 1001 });
    });
    expect((await f.readiness()).ready).toBe(false);
    expect((await f.readiness()).reasons).toContain(
      changed === "paused"
        ? "service_paused_or_stopped"
        : changed.endsWith("budget")
          ? "budget_limit_unavailable"
          : "account_unavailable",
    );
    expect(await f.t.run((ctx) => ctx.db.query("spendEvents").collect())).toHaveLength(0);
  }
});

test("service aliases, other operations and additional skill pins cannot inherit built-in admission", async () => {
  for (const changed of ["identity", "business-review", "pack", "extra-skill"] as const) {
    const f = await socialFixture();
    await f.t.run(async (ctx) => {
      if (changed === "identity")
        await ctx.db.patch(f.saved.id, { serviceId: "other-social-service" });
      if (changed === "business-review")
        await ctx.db.patch(f.saved.id, { operationIds: ["business.review"] });
      if (changed === "pack")
        await ctx.db.patch(f.saved.id, { operationIds: ["workflow.pack.run"] });
      if (changed === "extra-skill") {
        const extra = await ctx.db.insert("skills", {
          name: "unused-extra",
          version: 1,
          body: "Extra",
          status: "active",
          createdAt: Date.now(),
        });
        await ctx.db.patch(f.saved.id, {
          skills: [
            ...f.config.skills,
            {
              skillId: extra,
              name: "unused-extra",
              version: 1,
              bodyHash: await contentHash("Extra"),
              tenantId: null,
            },
          ],
        });
      }
    });
    const status = await f.asA.query(api.managedServices.status, {
      serviceId: changed === "identity" ? "other-social-service" : "social-marketing",
    });
    expect(status?.readiness.ready).toBe(false);
    expect(status?.readiness.reasons).toContain("operation_unqualified");
  }
});
