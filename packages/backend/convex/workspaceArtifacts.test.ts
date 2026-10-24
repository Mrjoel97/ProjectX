import type { FunctionReturnType } from "convex/server";
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import rateLimiterSchema from "../node_modules/@convex-dev/rate-limiter/src/component/schema.js";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);
const rateLimiterModules = import.meta.glob(
  "../node_modules/@convex-dev/rate-limiter/src/component/**/!(*.test).ts",
);
const TENANT = "inventory_owner";
const THREAD = "inventory_chat";
const setup = () => {
  const t = convexTest(schema, modules);
  t.registerComponent("rateLimiter", rateLimiterSchema, rateLimiterModules);
  return { t, user: t.withIdentity({ subject: TENANT }) };
};
async function doc(
  t: ReturnType<typeof convexTest>,
  threadId = THREAD,
  tenantId = TENANT,
  kind = "created_document",
) {
  return t.run((ctx) =>
    ctx.db.insert("vaultDocuments", {
      tenantId,
      sourceThreadId: threadId,
      title: "Private report",
      kind,
      category: "workspace-docs",
      source: "agent",
      mimeType: "text/markdown",
      size: 123,
      contentHash: "hash",
      status: "ready",
      createdAt: 100,
      text: "SECRET_BODY",
    }),
  );
}

describe("chat artifact inventory", () => {
  test("metadata pagination reaches history beyond25, including equal timestamps, without content or URLs", async () => {
    const { t, user } = setup();
    for (let i = 0; i < 29; i++) await doc(t);
    await doc(t, "other_chat");
    await doc(t, THREAD, "other_owner");
    const seen = new Set<string>();
    let cursor: string | null = null;
    do {
      const result: FunctionReturnType<typeof api.workspaceArtifacts.list> = await user.query(
        api.workspaceArtifacts.list,
        {
          threadId: THREAD,
          stream: "documents",
          paginationOpts: { cursor, numItems: 8 },
        },
      );
      expect(result.page.length).toBeLessThanOrEqual(8);
      for (const item of result.page) seen.add(item.key);
      expect(JSON.stringify(result)).not.toContain("SECRET_BODY");
      expect(JSON.stringify(result)).not.toContain("https:");
      cursor = result.isDone ? null : result.continueCursor;
    } while (cursor);
    expect(seen.size).toBe(29);
  });

  test("exact restores and downloads reject foreign/wrong-thread/malformed/deleted documents", async () => {
    const { t, user } = setup();
    const own = await doc(t);
    const wrong = await doc(t, "elsewhere");
    const foreign = await doc(t, THREAD, "elsewhere");
    const ownKey = `doc:${own}`;
    const resolved = await user.query(api.workspaceArtifacts.resolve, {
      threadId: THREAD,
      key: ownKey,
    });
    expect(resolved?.kind).toBe("document");
    expect(JSON.stringify(resolved)).not.toContain("SECRET_BODY");
    expect(
      await user.query(api.workspaceArtifacts.resolveKeys, { threadId: THREAD, keys: [ownKey] }),
    ).toHaveLength(1);
    await expect(
      user.query(api.workspaceArtifacts.resolveKeys, {
        threadId: THREAD,
        keys: Array(5).fill(ownKey),
      }),
    ).rejects.toThrow("INVALID_WORKSPACE_KEYS");
    for (const key of [`doc:${wrong}`, `doc:${foreign}`, "doc:garbage", "https://foreign"]) {
      expect(
        await user.query(api.workspaceArtifacts.resolve, { threadId: THREAD, key }),
      ).toBeNull();
      expect(
        await user.query(api.workspaceArtifacts.download, { threadId: THREAD, key }),
      ).toBeNull();
    }
    await t.run((ctx) => ctx.db.delete(own));
    expect(
      await user.query(api.workspaceArtifacts.resolve, { threadId: THREAD, key: ownKey }),
    ).toBeNull();
    await expect(
      t.query(api.workspaceArtifacts.list, {
        threadId: THREAD,
        stream: "documents",
        paginationOpts: { cursor: null, numItems: 8 },
      }),
    ).rejects.toThrow("UNAUTHENTICATED");
  });

  test("source authorization uses its actual owned chat row and verifies the live document", async () => {
    const { t, user } = setup();
    const source = await doc(t, "original_source_chat");
    const row = await t.run((ctx) =>
      ctx.db.insert("vaultSources", {
        tenantId: TENANT,
        threadId: THREAD,
        docIds: [source],
        titles: ["Source"],
        count: 1,
        createdAt: 200,
      }),
    );
    const key = `source:${row}:${source}`;
    expect(
      (await user.query(api.workspaceArtifacts.resolve, { threadId: THREAD, key }))?.kind,
    ).toBe("document");
    expect(
      await user.query(api.workspaceArtifacts.resolve, { threadId: "other_chat", key }),
    ).toBeNull();
    await t.run((ctx) => ctx.db.delete(source));
    expect(await user.query(api.workspaceArtifacts.resolve, { threadId: THREAD, key })).toBeNull();
  });

  test("bounded native rows retain every source and attachment ref", async () => {
    const { t, user } = setup();
    const source = await doc(t, "source_chat");
    await t.run(async (ctx) => {
      await ctx.db.insert("vaultSources", {
        tenantId: TENANT,
        threadId: THREAD,
        docIds: Array(55).fill(source),
        titles: Array(55).fill("Source"),
        count: 55,
        createdAt: 200,
      });
      const storageId = await ctx.storage.store(new Blob(["sample"]));
      await ctx.db.insert("plans", {
        tenantId: TENANT,
        threadId: THREAD,
        status: "proposed",
        createdAt: 100,
        attachments: Array.from({ length: 55 }, (_, i) => ({
          storageId,
          filename: `Attachment${i}`,
          mimeType: "text/plain",
          size: 6,
        })),
      });
    });
    for (const stream of ["sources", "plans"] as const) {
      let cursor: string | null = null;
      let count = 0;
      do {
        const result: FunctionReturnType<typeof api.workspaceArtifacts.list> = await user.query(
          api.workspaceArtifacts.list,
          {
            threadId: THREAD,
            stream,
            paginationOpts: { cursor, numItems: 8 },
          },
        );
        count += result.page.length;
        cursor = result.isDone ? null : result.continueCursor;
      } while (cursor);
      expect(count).toBe(55);
    }
  });

  test("native page windows retain source refs when a new row arrives between pages", async () => {
    const { t, user } = setup();
    const source = await doc(t, "source_chat");
    const seed = (count: number) =>
      t.run((ctx) =>
        ctx.db.insert("vaultSources", {
          tenantId: TENANT,
          threadId: THREAD,
          docIds: Array(count).fill(source),
          titles: Array(count).fill("Source"),
          count,
          createdAt: Date.now(),
        }),
      );
    await seed(2);
    await seed(55);
    const first = await user.query(api.workspaceArtifacts.list, {
      threadId: THREAD,
      stream: "sources",
      paginationOpts: { cursor: null, numItems: 1 },
    });
    expect(first.page).toHaveLength(55);
    await seed(1);
    const updated = await user.query(api.workspaceArtifacts.list, {
      threadId: THREAD,
      stream: "sources",
      paginationOpts: { cursor: null, endCursor: first.continueCursor, numItems: 1 },
    });
    expect(updated.page).toHaveLength(56);
    const older = await user.query(api.workspaceArtifacts.list, {
      threadId: THREAD,
      stream: "sources",
      paginationOpts: { cursor: first.continueCursor, numItems: 1 },
    });
    expect(older.page).toHaveLength(2);
  });

  test("legacy created snapshots authorize provenance-unknown output without a reverse history scan", async () => {
    const { t, user } = setup();
    const old = await doc(t);
    await t.run((ctx) => ctx.db.patch(old, { sourceThreadId: undefined }));
    const row = await t.run((ctx) =>
      ctx.db.insert("vaultSources", {
        tenantId: TENANT,
        threadId: THREAD,
        docIds: [old],
        titles: ["Older report"],
        count: 1,
        role: "created",
        createdAt: 100,
      }),
    );
    const key = `source:${row}:${old}`;
    const result = await user.query(api.workspaceArtifacts.list, {
      threadId: THREAD,
      stream: "sources",
      paginationOpts: { cursor: null, numItems: 1 },
    });
    expect(result.page[0]?.kind).toBe("document");
    expect(
      (await user.query(api.workspaceArtifacts.resolve, { threadId: THREAD, key }))?.item.kind,
    ).toBe("document");
    expect(await user.query(api.workspaceArtifacts.resolve, { threadId: "wrong", key })).toBeNull();
    expect(
      await user.query(api.workspaceArtifacts.resolve, { threadId: THREAD, key: `doc:${old}` }),
    ).toBeNull();
  });

  test("private campaign plans never become standalone tabs; exact old collections still resolve", async () => {
    const { t, user } = setup();
    const campaign = await t.run((ctx) =>
      ctx.db.insert("mediaCampaigns", {
        tenantId: TENANT,
        threadId: THREAD,
        title: "Collection",
        status: "draft",
        maxCostCents: 100,
        reservedCents: 0,
        concurrency: 2,
        items: [],
        createdAt: 1,
        updatedAt: 1,
      }),
    );
    const plan = await t.run((ctx) =>
      ctx.db.insert("plans", {
        tenantId: TENANT,
        threadId: THREAD,
        status: "collecting",
        kind: "media",
        mediaCampaignId: campaign,
        mediaMode: "image",
        createdAt: 2,
      }),
    );
    expect(
      await user.query(api.workspaceArtifacts.resolve, { threadId: THREAD, key: `plan:${plan}` }),
    ).toBeNull();
    expect(
      (
        await user.query(api.workspaceArtifacts.list, {
          threadId: THREAD,
          stream: "plans",
          paginationOpts: { cursor: null, numItems: 8 },
        })
      ).page,
    ).toEqual([]);
    expect(
      (
        await user.query(api.workspaceArtifacts.resolve, {
          threadId: THREAD,
          key: `campaign:${campaign}`,
        })
      )?.kind,
    ).toBe("campaign");
    expect(
      await user.query(api.mediaCampaign.byId, { threadId: "wrong", campaignId: campaign }),
    ).toBeNull();
    expect(
      await t
        .withIdentity({ subject: "foreign" })
        .query(api.mediaCampaign.byId, { threadId: THREAD, campaignId: campaign }),
    ).toBeNull();
    expect(
      (await user.query(api.mediaCampaign.byId, { threadId: THREAD, campaignId: campaign }))?.id,
    ).toBe(campaign);
    await t.run((ctx) =>
      ctx.db.patch(campaign, {
        items: [
          { planId: plan, kind: "image", label: "Image", estimateCents: 1, status: "proposal" },
        ],
      }),
    );
    expect(
      (await user.query(api.workspaceArtifacts.resolve, { threadId: THREAD, key: `plan:${plan}` }))
        ?.kind,
    ).toBe("media");
    expect(
      await user.query(api.workspaceArtifacts.resolve, { threadId: "wrong", key: `plan:${plan}` }),
    ).toBeNull();
    expect(
      await t
        .withIdentity({ subject: "foreign" })
        .query(api.workspaceArtifacts.resolve, { threadId: THREAD, key: `plan:${plan}` }),
    ).toBeNull();
    await t.run((ctx) => ctx.db.patch(campaign, { threadId: "wrong" }));
    expect(
      await user.query(api.workspaceArtifacts.resolve, { threadId: THREAD, key: `plan:${plan}` }),
    ).toBeNull();
  });

  test("only the selected current attachment mints a URL after exact chat authorization", async () => {
    const { t, user } = setup();
    const { plan, storageId } = await t.run(async (ctx) => {
      const storageId = await ctx.storage.store(new Blob(["native file"]));
      const plan = await ctx.db.insert("plans", {
        tenantId: TENANT,
        threadId: THREAD,
        status: "proposed",
        createdAt: 100,
        attachments: [
          {
            storageId,
            filename: "Report.xlsx",
            mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            size: 11,
          },
        ],
      });
      return { plan, storageId };
    });
    const key = `attachment:${plan}:${storageId}`;
    expect(
      (await user.query(api.workspaceArtifacts.download, { threadId: THREAD, key }))?.url,
    ).toBeTruthy();
    expect(
      await user.query(api.workspaceArtifacts.download, { threadId: "wrong", key }),
    ).toBeNull();
    expect(
      await t
        .withIdentity({ subject: "foreign" })
        .query(api.workspaceArtifacts.download, { threadId: THREAD, key }),
    ).toBeNull();
    await t.run((ctx) => ctx.db.patch(plan, { attachments: [] }));
    expect(await user.query(api.workspaceArtifacts.download, { threadId: THREAD, key })).toBeNull();
  });
});
