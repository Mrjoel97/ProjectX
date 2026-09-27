import { makeFunctionReference } from "convex/server";
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import schema from "./schema";

const modules = import.meta.glob("./**/*.*s");
const path = "/p/store/home/commerce/cart";
const body = JSON.stringify({
  items: [{ presentationItemId: "lamp", quantity: 1 }],
  addressCountry: "TZ",
});
const resolvePublished = makeFunctionReference<
  "query",
  { host: string; slug: string },
  { state: string }
>("webProjects:resolvePublished");

function post(
  t: ReturnType<typeof convexTest>,
  target = path,
  input = body,
  headers: Record<string, string> = {},
) {
  return t.fetch(target, {
    method: "POST",
    headers: {
      Origin: "https://some.convex.site",
      "Content-Type": "application/json",
      "Idempotency-Key": "cart-intent-1",
      ...headers,
    },
    body: input,
  });
}

async function assertNoCommerceWrites(t: ReturnType<typeof convexTest>) {
  const rows = await t.run(async (ctx) => ({
    carts: await ctx.db.query("tenantCarts").collect(),
    orders: await ctx.db.query("tenantOrders").collect(),
    attempts: await ctx.db.query("tenantOrderAttempts").collect(),
    holds: await ctx.db.query("tenantReservations").collect(),
  }));
  expect(rows).toEqual({ carts: [], orders: [], attempts: [], holds: [] });
}

describe("closed host-derived anonymous commerce intent", () => {
  test("valid-looking intent remains closed on a private storefront and preserves all commerce rows", async () => {
    const t = convexTest(schema, modules);
    await t.run((ctx) =>
      ctx.db.insert("webProjects", {
        tenantId: "tenant-a",
        kind: "storefront",
        slug: "store",
        title: "Store",
        publicHost: "some.convex.site",
        domainMode: "platform_path",
        hostingDeclaration: { hosting: "pikar_platform_path", source: "tenant_structured_content" },
        revision: 1,
        createdAt: 1,
        updatedAt: 1,
      }),
    );
    const response = await post(t);
    expect(response.status).toBe(404);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect((await t.fetch("/p/store/home")).status).toBe(404);
    await assertNoCommerceWrites(t);
  });

  test("existing exact host resolver keeps two published site bindings separate and rejects pending, collision and stale pointers", async () => {
    const t = convexTest(schema, modules);
    const document = {
      kind: "site",
      title: "Site",
      description: "Test",
      brand: { name: "Site" },
      navigation: [],
      pages: [{ slug: "home", title: "Home", nodes: [{ kind: "text", text: "Home" }] }],
    };
    const seed = async (
      tenantId: string,
      host: string,
      domainMode: "platform_path" | "custom_pending",
      hash: string,
    ) =>
      t.run(async (ctx) => {
        const projectId = await ctx.db.insert("webProjects", {
          tenantId,
          kind: "site",
          slug: "store",
          title: "Site",
          publicHost: host,
          domainMode,
          hostingDeclaration: {
            hosting:
              domainMode === "platform_path"
                ? "pikar_platform_path"
                : "tenant_custom_domain_pending",
            source: "tenant_structured_content",
          },
          draftVersion: 1,
          approvedVersion: 1,
          approvedContentHash: hash,
          publishedVersion: 1,
          publishedContentHash: hash,
          revision: 1,
          createdAt: 1,
          updatedAt: 1,
        });
        await ctx.db.insert("webProjectVersions", {
          tenantId,
          projectId,
          version: 1,
          document,
          contentHash: "hash-1",
          rendererVersion: "web-runtime-v1",
          artifactHtml: "<main>Home</main>",
          artifacts: [{ pageSlug: "home", html: "<main>Home</main>", byteLength: 17 }],
          artifactByteLength: 17,
          createdBy: "user",
          createdAt: 1,
          sourceRefs: [],
        });
        return projectId;
      });
    await seed("tenant-a", "some.convex.site", "platform_path", "hash-1");
    await seed("tenant-b", "second.example", "platform_path", "hash-1");
    expect(
      (await t.query(resolvePublished, { host: "some.convex.site", slug: "store" })).state,
    ).toBe("published");
    expect((await t.query(resolvePublished, { host: "second.example", slug: "store" })).state).toBe(
      "published",
    );
    expect((await t.query(resolvePublished, { host: "third.example", slug: "store" })).state).toBe(
      "invalid_host",
    );
    const posted = await post(t);
    expect(posted.status).toBe(404); // A site is never a shop.
    await seed("tenant-c", "pending.example", "custom_pending", "hash-1");
    expect(
      (await t.query(resolvePublished, { host: "pending.example", slug: "store" })).state,
    ).toBe("invalid_host");
    await seed("tenant-d", "collision.example", "platform_path", "hash-1");
    await seed("tenant-e", "collision.example", "platform_path", "hash-1");
    expect(
      (await t.query(resolvePublished, { host: "collision.example", slug: "store" })).state,
    ).toBe("invalid_host");
    await seed("tenant-f", "stale.example", "platform_path", "stale-hash");
    expect((await t.query(resolvePublished, { host: "stale.example", slug: "store" })).state).toBe(
      "render_failed",
    );
    await assertNoCommerceWrites(t);
  });

  test("origin, media type, payload size, and closed fields refuse before any write", async () => {
    const t = convexTest(schema, modules);
    expect((await post(t, path, body, { Origin: "https://evil.test" })).status).toBe(403);
    expect((await post(t, path, body, { "Content-Type": "text/plain" })).status).toBe(415);
    expect((await post(t, path, body, { "Idempotency-Key": "" })).status).toBe(400);
    expect((await post(t, path, body, { Origin: "" })).status).toBe(403);
    expect((await post(t, path, body, { "Idempotency-Key": "x".repeat(129) })).status).toBe(400);
    expect(
      (await post(t, path, JSON.stringify({ ...JSON.parse(body), tenantId: "tenant-b" }))).status,
    ).toBe(400);
    expect(
      (await post(t, path, JSON.stringify({ ...JSON.parse(body), accountId: "foreign-account" })))
        .status,
    ).toBe(400);
    expect(
      (await post(t, path, JSON.stringify({ ...JSON.parse(body), cartId: "foreign-cart" }))).status,
    ).toBe(400);
    expect(
      (await post(t, path, JSON.stringify({ ...JSON.parse(body), orderId: "foreign-order" })))
        .status,
    ).toBe(400);
    expect(
      (await post(t, path, JSON.stringify({ ...JSON.parse(body), totalMinor: 1 }))).status,
    ).toBe(400);
    expect(
      (await post(t, path, JSON.stringify({ ...JSON.parse(body), cardNumber: "4111" }))).status,
    ).toBe(400);
    expect((await post(t, path, "x".repeat(8193))).status).toBe(413);
    expect(
      (
        await post(
          t,
          path,
          JSON.stringify({
            items: [{ presentationItemId: "lamp", quantity: 101 }],
            addressCountry: "TZ",
          }),
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await post(
          t,
          path,
          JSON.stringify({
            items: [
              { presentationItemId: "lamp", quantity: 1 },
              { presentationItemId: "lamp", quantity: 1 },
            ],
            addressCountry: "TZ",
          }),
        )
      ).status,
    ).toBe(400);
    await assertNoCommerceWrites(t);
  });

  test("foreign, unknown, malformed and unsupported paths stay closed", async () => {
    const t = convexTest(schema, modules);
    const foreign = await post(t, "/p/other/home/commerce/cart");
    expect(foreign.status).toBe(404);
    expect((await post(t, path, body, { Host: "evil.test" })).status).toBe(404);
    expect((await post(t)).status).toBe(404); // exact retry also cannot create an attempt
    expect((await post(t, `${path}?success=true`)).status).toBe(404);
    expect((await post(t, "/p/store/home/commerce/cart/extra")).status).toBe(404);
    expect((await post(t, "/p/store/home/commerce/status")).status).toBe(404);
    expect((await post(t, "/p/store/../commerce/cart")).status).toBe(404);
    expect((await t.fetch(path, { method: "GET" })).status).toBe(404);
    await assertNoCommerceWrites(t);
  });
});
