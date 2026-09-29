// BETA-02 / BETA-05: direct HTTP capability-boundary evidence.
//
// These tests call convex-test's real HTTP router. They deliberately do not inspect wrapper
// source or infer authorization from a generic helper: a public bearer link is a capability of
// its own, while the internal SkillOpt route remains a separate shared-bearer exception.
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api } from "./_generated/api";
import { hmacHex } from "./gmailAuth";
import http from "./http";
import schema from "./schema";

const modules = import.meta.glob("./**/*.*s");
const FUNNEL_SITE = "https://some-deployment.convex.site";
const FUNNEL_CLOUD = "https://some-deployment.convex.cloud";
const UNSUBSCRIBE_SECRET = "boundary-unsubscribe-secret";

type Harness = Awaited<ReturnType<typeof harness>>;

async function harness() {
  const t = convexTest(schema, modules);
  const userA = await t.run((ctx) => ctx.db.insert("users", { owner: false }));
  const userB = await t.run((ctx) => ctx.db.insert("users", { owner: false }));
  const storageId = await t.run((ctx) => ctx.storage.store(new Blob(["boundary bytes"])));
  const doc = await t.run((ctx) =>
    ctx.db.insert("vaultDocuments", {
      tenantId: userA,
      title: "Boundary fixture",
      kind: "upload",
      category: "general",
      source: "upload",
      mimeType: "text/plain",
      size: 14,
      contentHash: "boundary-hash",
      status: "ready",
      createdAt: 1,
      storageId,
    }),
  );
  return {
    t,
    userA,
    userB,
    doc,
    storageId,
    asA: t.withIdentity({ subject: `${userA}|session_a` }),
    asB: t.withIdentity({ subject: `${userB}|session_b` }),
  };
}

async function signedUnsubscribe(tenantId: string, recipient: string) {
  const raw = btoa(`${tenantId}|${recipient}`)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  return { raw, digest: await hmacHex(raw, UNSUBSCRIBE_SECRET) };
}

const unsubscribePath = (raw: string, digest: string) => `/unsubscribe/${raw}.${digest}`;

beforeEach(() => {
  vi.stubEnv("CONVEX_SITE_URL", FUNNEL_SITE);
  vi.stubEnv("CONVEX_CLOUD_URL", FUNNEL_CLOUD);
  vi.stubEnv("UNSUBSCRIBE_SECRET", UNSUBSCRIBE_SECRET);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("actual public HTTP boundaries", () => {
  test("the route registry keeps public funnel/unsubscribe and internal bearer methods distinct", () => {
    expect(http.lookup("/f/token/visit", "GET")).not.toBeNull();
    expect(http.lookup("/unsubscribe/token", "GET")).not.toBeNull();
    expect(http.lookup("/unsubscribe/token", "POST")).not.toBeNull();
    expect(http.lookup("/skillopt/export", "GET")).not.toBeNull();
    expect(http.lookup("/skillopt/writeback", "POST")).not.toBeNull();
    expect(http.lookup("/f/token/visit", "POST")).toBeNull();
    expect(http.lookup("/skillopt/export", "POST")).toBeNull();
  });

  test("a valid funnel bearer works anonymously and for another tenant, changing only A's counter", async () => {
    const h = await harness();
    const made = await h.asA.mutation(api.funnels.create, {
      vaultDocId: h.doc,
      title: "Boundary link",
      source: "newsletter",
    });
    const location = await h.t.run((ctx) => ctx.storage.getUrl(h.storageId));

    const anonymous = await h.t.fetch(`/f/${made.token}/visit?s=newsletter`);
    const foreign = await h.asB.fetch(`/f/${made.token}/visit?s=newsletter`);
    for (const response of [anonymous, foreign]) {
      expect(response.status).toBe(302);
      expect(response.headers.get("Location")).toBe(location);
      expect(await response.text()).toBe("");
    }

    expect((await h.asA.query(api.funnels.list, {})).items[0]?.counters).toEqual({
      visits: 2,
      claims: 0,
      downloads: 0,
    });
    expect((await h.asB.query(api.funnels.list, {})).items).toEqual([]);
  });

  test("funnel malformed, tampered, stage-mismatched and redirect-shaped inputs fail closed", async () => {
    const h = await harness();
    const made = await h.asA.mutation(api.funnels.create, {
      vaultDocId: h.doc,
      title: "Boundary link",
      source: "newsletter",
    });
    const root = `/f/${made.token}`;
    const before = await h.asA.query(api.funnels.list, {});
    for (const path of [
      "/f/short/visit",
      `/f/${"a".repeat(43)}/visit`,
      `${root}/VISIT`,
      `${root}/visit?s=a&s=b`,
      `${root}/visit?destination=https://attacker.invalid`,
      `${root}/visit?s=${"a".repeat(65)}`,
      `${root}/claim/extra`,
      "/unsubscribe/not-a-funnel-token",
    ]) {
      const response = await h.t.fetch(path);
      expect(response.status).toBe(404);
      expect(response.headers.get("Location")).toBeNull();
      // Funnel refusals are bodyless; the separate unsubscribe route uses its own generic
      // `not found` body. Neither branch discloses whether a private row exists.
      expect(["", "not found"]).toContain(await response.text());
    }
    expect((await h.asA.query(api.funnels.list, {})).items[0]?.counters).toEqual(
      before.items[0]?.counters,
    );
  });

  test("unsubscribe is anonymous bearer access, but only the signed owner tenant changes", async () => {
    const h = await harness();
    const token = await signedUnsubscribe(String(h.userA), "person@example.com");
    const path = unsubscribePath(token.raw, token.digest);

    const landing = await h.asB.fetch(path, { method: "GET" });
    expect(landing.status).toBe(200);
    expect(await landing.text()).toContain("person@example.com");
    expect(await h.t.run((ctx) => ctx.db.query("suppressions").collect())).toEqual([]);

    const invalid = await h.t.fetch(unsubscribePath(token.raw, `${token.digest.slice(0, -1)}0`), {
      method: "POST",
    });
    expect(invalid.status).toBe(404);
    expect(await h.t.run((ctx) => ctx.db.query("suppressions").collect())).toEqual([]);

    const confirmed = await h.asB.fetch(path, { method: "POST" });
    expect(confirmed.status).toBe(200);
    const rows = await h.t.run((ctx) => ctx.db.query("suppressions").collect());
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ tenantId: h.userA, address: "person@example.com" });

    for (const method of ["HEAD", "PUT", "PATCH", "DELETE", "OPTIONS"] as const) {
      expect((await h.t.fetch(path, { method })).status).toBe(404);
    }
  });

  test("the internal SkillOpt bearer route never becomes an anonymous public surface", async () => {
    const h = await harness();
    vi.stubEnv("SKILLOPT_TOKEN", "boundary-skillopt-token");
    expect((await h.t.fetch("/skillopt/export")).status).toBe(401);
    expect(
      (await h.t.fetch("/skillopt/export", { headers: { Authorization: "Bearer wrong" } })).status,
    ).toBe(401);
    expect(
      (
        await h.asB.fetch("/skillopt/export", {
          headers: { Authorization: "Bearer wrong" },
        })
      ).status,
    ).toBe(401);
  });
});
