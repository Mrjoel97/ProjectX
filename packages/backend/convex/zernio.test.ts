import { deletableTables, exportableTables } from "@pikar/core/tenantData";
import { importCredentialKey, openCredential } from "@pikar/revenue";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { schedulingTest } from "../test/pausedScheduler";
import { api, internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.*s");
const profile = "1234567890abcdef12345678",
  accountId = "1234567890abcdef12345679",
  key = `zrk_${"a".repeat(64)}`;
const account = {
  _id: accountId,
  profileId: profile,
  platform: "tiktok",
  username: "business",
  isActive: true,
};
const keyB64 = btoa(String.fromCharCode(...new Uint8Array(32).fill(7)));
beforeEach(() => {
  vi.stubEnv("CONNECTOR_CREDENTIAL_KEY_V1", keyB64);
  vi.stubEnv("CONVEX_SITE_URL", "https://test.convex.site");
  vi.stubEnv("SITE_URL", "https://pikar.example");
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});
async function setup() {
  const t = convexTest(schema, modules);
  const userId = await t.run((ctx) => ctx.db.insert("users", {}));
  const otherId = await t.run((ctx) => ctx.db.insert("users", {}));
  return {
    t,
    tenantId: String(userId),
    user: t.withIdentity({ subject: `${userId}|session1` }),
    other: t.withIdentity({ subject: `${otherId}|session2` }),
  };
}
function provider() {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    expect(url.origin).toBe("https://zernio.com");
    expect(init?.method).toBe("GET");
    if (url.pathname.endsWith("/auth/verify"))
      return Response.json({ valid: true, name: "private", email: "private@example.com" });
    expect(url.searchParams.get("profileId")).toBe(profile);
    if (url.pathname.endsWith("/accounts")) return Response.json({ accounts: [account] });
    expect(url.searchParams.get("accountId")).toBe(accountId);
    return Response.json({
      posts: [
        {
          platform: "tiktok",
          accountId,
          isExternal: true,
          platformPostId: "200",
          analytics: { likes: 0, views: 99, lastUpdated: "2026-10-18 15:13:29" },
        },
      ],
      pagination: { page: 1, pages: 1 },
    });
  });
}
async function connect(h: Awaited<ReturnType<typeof setup>>) {
  const { url } = await h.user.mutation(api.zernio.beginConnect, { profileId: profile });
  const response = await h.t.fetch(new URL(url).pathname + new URL(url).search, {
    method: "POST",
    headers: { Origin: "https://pikar.example", "Content-Type": "application/json" },
    body: JSON.stringify({ key }),
  });
  expect(response.status).toBe(200);
  return url;
}
describe("Zernio tenant-bound production connector", () => {
  schedulingTest(
    "daily refresh requires opt-in and queues one generation-bound worker without provider calls",
    async () => {
      const mock = provider();
      vi.stubGlobal("fetch", mock);
      const h = await setup();
      await connect(h);
      await h.t.mutation(internal.zernio.tickReports, {});
      expect(
        await h.t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect()),
      ).toHaveLength(0);
      await h.user.mutation(api.zernio.selectAccounts, {
        accountIds: [accountId],
        dailyReports: true,
      });
      const count = mock.mock.calls.length;
      await h.t.mutation(internal.zernio.tickReports, {});
      await h.t.mutation(internal.zernio.tickReports, {});
      const jobs = await h.t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect());
      expect(jobs).toHaveLength(1);
      expect(jobs[0]?.args[0]).toMatchObject({ tenantId: h.tenantId });
      expect(mock.mock.calls).toHaveLength(count);
    },
  );
  test("credential export is a summary, reports are portable, and erasure blocks late writes", async () => {
    vi.stubGlobal("fetch", provider());
    const h = await setup();
    await connect(h);
    await h.user.mutation(api.zernio.selectAccounts, {
      accountIds: [accountId],
      dailyReports: false,
    });
    await h.user.action(api.zernioActions.refreshReport, {});
    const cursor = (name: "zernioConnections" | "zernioReports") => ({
      tableIndex: exportableTables().indexOf(name),
      cursor: null,
      rowsExported: 0,
      tableRows: 0,
      truncated: false,
      generatedAt: new Date().toISOString(),
    });
    const credentials = await h.user.query(api.tenantExport.exportTenantData, {
      cursor: cursor("zernioConnections"),
    });
    expect(credentials.table.rows).toHaveLength(1);
    expect(JSON.stringify(credentials.table.rows)).not.toContain("ciphertext");
    expect(JSON.stringify(credentials.table.rows)).not.toContain(profile);
    const data = await h.user.query(api.tenantExport.exportTenantData, {
      cursor: cursor("zernioReports"),
    });
    expect(JSON.stringify(data.table.rows)).toContain('"views":99');
    expect(deletableTables()).toContain("zernioConnections");
    expect(deletableTables()).toContain("zernioReports");
    const row = await h.t.query(internal.zernio.connection, { tenantId: h.tenantId });
    if (!row) throw Error("missing");
    await h.t.run((ctx) =>
      ctx.db.insert("authRevocations", {
        userId: h.tenantId,
        state: "deleting",
        expiresAt: Date.now() + 86400_000,
        requireLiveSession: true,
      }),
    );
    expect(await h.t.query(internal.zernio.connection, { tenantId: h.tenantId })).toBeNull();
    expect((await h.t.query(internal.zernio.agentReport, { tenantId: h.tenantId })).state).toBe(
      "unavailable",
    );
    await expect(
      h.t.mutation(internal.zernio.claimReport, {
        tenantId: h.tenantId,
        connectionId: row.connectionId,
        revision: row.revision,
        lease: "late",
      }),
    ).rejects.toThrow("TENANT_ERASURE_IN_PROGRESS");
  });
  test("HTTP intake is origin-checked, one-use and encrypted before database arguments; credentials never reach status/export", async () => {
    vi.stubGlobal("fetch", provider());
    const h = await setup();
    await expect(h.t.mutation(api.zernio.beginConnect, { profileId: profile })).rejects.toThrow(
      "UNAUTHENTICATED",
    );
    const { url } = await h.user.mutation(api.zernio.beginConnect, { profileId: profile });
    const path = new URL(url).pathname + new URL(url).search;
    expect(
      (
        await h.t.fetch(path, {
          method: "POST",
          headers: { Origin: "https://foreign.example", "Content-Type": "application/json" },
          body: JSON.stringify({ key }),
        })
      ).status,
    ).toBe(403);
    const request = {
      method: "POST",
      headers: { Origin: "https://pikar.example", "Content-Type": "application/json" },
      body: JSON.stringify({ key }),
    };
    expect((await h.t.fetch(path, request)).status).toBe(200);
    expect((await h.t.fetch(path, request)).status).toBe(400);
    const row = await h.t.query(internal.zernio.connection, { tenantId: h.tenantId });
    expect(row?.ciphertextB64).toBeTruthy();
    expect(JSON.stringify(row)).not.toContain(key);
    if (!row?.keyVersion || !row.ciphertextB64 || !row.ivB64) throw Error("missing sealed grant");
    const opened = await openCredential(
      await importCredentialKey(keyB64, row.keyVersion),
      {
        tenantId: h.tenantId,
        connectionId: row.connectionId,
        provider: "zernio",
        environment: "production",
      },
      {
        ciphertextB64: row.ciphertextB64,
        ivB64: row.ivB64,
        keyVersion: row.keyVersion,
        algorithm: "AES-256-GCM",
      },
    );
    expect(JSON.parse(opened).key).toBe(key);
    const safe = await h.user.query(api.zernio.status, {});
    expect(JSON.stringify(safe)).not.toContain("ciphertext");
    expect(JSON.stringify(safe)).not.toContain(key);
    expect((await h.other.query(api.zernio.status, {})).status).toBe("disconnected");
    expect(await h.other.query(api.zernio.latestReport, {})).toBeNull();
  });
  test("selected accounts are tenant-bound; refresh retains zero values, throttles and keeps old data on provider failure", async () => {
    const mock = provider();
    vi.stubGlobal("fetch", mock);
    const h = await setup();
    await connect(h);
    await expect(
      h.other.mutation(api.zernio.selectAccounts, { accountIds: [accountId], dailyReports: true }),
    ).rejects.toThrow("ZERNIO_ACCOUNT_NOT_ALLOWED");
    await expect(
      h.user.mutation(api.zernio.selectAccounts, { accountIds: [profile], dailyReports: false }),
    ).rejects.toThrow();
    await h.user.mutation(api.zernio.selectAccounts, {
      accountIds: [accountId],
      dailyReports: false,
    });
    expect((await h.user.action(api.zernioActions.refreshReport, {})).state).toBe("updated");
    const saved = await h.user.query(api.zernio.latestReport, {});
    expect(saved?.accounts[0]?.posts[0]?.metrics.likes).toBe(0);
    expect(await h.other.query(api.zernio.latestReport, {})).toBeNull();
    const count = mock.mock.calls.length;
    expect((await h.user.action(api.zernioActions.refreshReport, {})).state).toBe(
      "not_due_or_connection_changed",
    );
    expect(mock.mock.calls).toHaveLength(count);
    await h.t.run(async (ctx) => {
      const row = await ctx.db
        .query("zernioConnections")
        .withIndex("by_tenant", (q) => q.eq("tenantId", h.tenantId))
        .unique();
      if (row) await ctx.db.patch(row._id, { nextRefreshAt: 0 });
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("private provider body", { status: 429 })),
    );
    expect((await h.user.action(api.zernioActions.refreshReport, {})).state).toBe("rate_limited");
    expect(await h.user.query(api.zernio.latestReport, {})).toEqual(saved);
    expect((await h.t.query(internal.zernio.agentReport, { tenantId: h.tenantId })).state).toBe(
      "stale",
    );
  });
  test("disconnect and changed selection fence late refresh completion and remove local credentials/report", async () => {
    vi.stubGlobal("fetch", provider());
    const h = await setup();
    await connect(h);
    await h.user.mutation(api.zernio.selectAccounts, {
      accountIds: [accountId],
      dailyReports: true,
    });
    const row = await h.t.query(internal.zernio.connection, { tenantId: h.tenantId });
    if (!row) throw Error("missing");
    const args = {
      tenantId: h.tenantId,
      connectionId: row.connectionId,
      revision: row.revision,
      lease: "test",
    };
    expect(await h.t.mutation(internal.zernio.claimReport, args)).not.toBeNull();
    await h.user.mutation(api.zernio.selectAccounts, { accountIds: [], dailyReports: false });
    expect(
      await h.t.mutation(internal.zernio.finishReport, {
        ...args,
        report: {
          fromDate: "2026-07-22",
          toDate: "2026-10-19",
          fetchedAt: Date.now(),
          accounts: [],
        },
      }),
    ).toBe(false);
    await h.user.mutation(api.zernio.disconnect, {});
    expect(
      (await h.t.query(internal.zernio.connection, { tenantId: h.tenantId }))?.ciphertextB64,
    ).toBeUndefined();
    expect(await h.user.query(api.zernio.latestReport, {})).toBeNull();
    expect((await h.user.query(api.zernio.status, {})).dailyReports).toBe(false);
  });
  test("a consumed connection ticket cannot resurrect access after disconnect", async () => {
    const h = await setup();
    const { url } = await h.user.mutation(api.zernio.beginConnect, { profileId: profile });
    const ticket = new URL(url).searchParams.get("ticket");
    const { hashZernioTicket } = await import("./zernio");
    const pending = await h.t.mutation(internal.zernio.claimConnect, {
      ticketHash: await hashZernioTicket(ticket ?? ""),
    });
    if (!pending) throw Error("missing");
    await h.user.mutation(api.zernio.disconnect, {});
    expect(
      await h.t.mutation(internal.zernio.completeConnect, {
        tenantId: h.tenantId,
        connectionId: pending.connectionId,
        channels: [],
        ciphertextB64: "x",
        ivB64: "x",
        keyVersion: "v1",
      }),
    ).toBe(false);
  });
});
