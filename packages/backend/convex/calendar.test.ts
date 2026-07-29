import { CALENDAR_EVENTS_SCOPE, CALENDAR_FREEBUSY_SCOPE, GMAIL_MODIFY_SCOPE } from "@pikar/core";
import { convexTest } from "convex-test";
import { afterEach, describe, expect, test, vi } from "vitest";
import aggregateSchema from "../node_modules/@convex-dev/aggregate/src/component/schema.js";
import { internal } from "./_generated/api";
import { buildAuthorizeUrl } from "./gmailAuth";
import schema from "./schema";

// @ts-expect-error import.meta.glob is provided by Vite/vitest at runtime.
const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);
// @ts-expect-error import.meta.glob is provided by Vite/vitest at runtime.
const aggregateModules = import.meta.glob(
  "../node_modules/@convex-dev/aggregate/src/component/**/!(*.test).ts",
);
// @ts-expect-error import.meta.glob is provided by Vite/vitest at runtime.
const convexSources = import.meta.glob("./**/*.ts", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

function harness() {
  const t = convexTest(schema, modules);
  t.registerComponent("auditCounts", aggregateSchema, aggregateModules);
  return t;
}

const TENANT = "tenant_calendar";
const BASE_MS = 1_577_880_000_000;

afterEach(() => vi.unstubAllEnvs());

describe("calendar fixture seam", () => {
  test("seed/get round-trip is deterministic and replaces the tenant row", async () => {
    const t = harness();
    expect(await t.query(internal.smoke.getCalendarFixture, { tenantId: TENANT })).toBeNull();

    expect(
      await t.mutation(internal.smoke.seedCalendarFixture, {
        tenantId: TENANT,
        baseMs: BASE_MS,
      }),
    ).toEqual({ busyCount: 3 });
    await t.mutation(internal.smoke.seedCalendarFixture, {
      tenantId: TENANT,
      baseMs: BASE_MS + 1_000,
    });

    const fixture = await t.query(internal.smoke.getCalendarFixture, { tenantId: TENANT });
    expect(fixture?.busy).toEqual([
      { startMs: BASE_MS + 1_000 + 3_600_000, endMs: BASE_MS + 1_000 + 7_200_000 },
      { startMs: BASE_MS + 1_000 + 14_400_000, endMs: BASE_MS + 1_000 + 19_800_000 },
      { startMs: BASE_MS + 1_000 + 93_600_000, endMs: BASE_MS + 1_000 + 97_200_000 },
    ]);
    const rows = await t.run((ctx) => ctx.db.query("calendarFixtures").collect());
    expect(rows).toHaveLength(1);
  });
});

describe("one Google consent flow", () => {
  test("the one authorize URL requests mail, free/busy, and event scopes", async () => {
    vi.stubEnv("GOOGLE_OAUTH_CLIENT_ID", "client-id");
    vi.stubEnv("GOOGLE_OAUTH_CLIENT_SECRET", "client-secret");
    vi.stubEnv("GMAIL_OAUTH_REDIRECT_URI", "https://example.test/gmail/callback");

    const url = new URL(await buildAuthorizeUrl(TENANT));
    const scopes = new Set(url.searchParams.get("scope")?.split(" ") ?? []);
    expect(scopes).toEqual(
      new Set([GMAIL_MODIFY_SCOPE, CALENDAR_FREEBUSY_SCOPE, CALENDAR_EVENTS_SCOPE]),
    );
  });

  test("buildAuthorizeUrl is the only Google authorize-URL construction in convex", () => {
    const constructions = Object.entries(convexSources).flatMap(([path, source]) =>
      [...source.matchAll(/accounts\.google\.com\/o\/oauth2/g)].map(() => path),
    );
    expect(constructions.length, "the scan found no authorize URL and is vacuous").toBeGreaterThan(
      0,
    );
    // Mutation check: adding a second GOOGLE_AUTH_ENDPOINT template literal makes this RED.
    expect(constructions).toEqual(["./gmailAuth.ts"]);
  });
});
