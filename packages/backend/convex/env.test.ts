// 25-10: the hosted environment manifest, and the scan that keeps it honest.
//
// A manifest maintained by remembering to update it is a manifest that goes stale — silently, and
// in the direction that matters (a new required key nobody classified reads as "ready"). So the
// first test DERIVES the set of names source actually consumes and fails when one is unclassified.
// That is the same shape as Phase 22.1's table-classification drift test, for the same reason.
import { convexTest } from "convex-test";
import { describe, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import { ENV_MANIFEST, isDurableOrigin, missingEnv, ORIGIN_ENV, REQUIRED_ENV } from "./lib/env";
import schema from "./schema";
import { REGISTRY_SKILL_NAMES } from "./skills";

const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);

const sources = import.meta.glob("./**/*.ts", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

describe("the manifest covers every name source actually reads", () => {
  const consumed = new Set<string>();
  /** Names reached through a LITERAL `process.env.X`. */
  const literal = new Set<string>();
  /** Names reached through `requireEnvMedia("X")` — a `process.env[name]` indirection. */
  const indirect = new Set<string>();
  for (const [path, content] of Object.entries(sources)) {
    if (path.endsWith(".test.ts") || path.includes("/_generated/")) continue;
    // Strip comments, because this module's OWN doc comment writes `process.env.X` as an example
    // and the scan reported a phantom `X` as an unclassified consumer — the guard catching its own
    // documentation.
    //
    // LINE COMMENTS FIRST, AND THAT ORDER IS LOAD-BEARING. Doing block comments first lets a `/*`
    // that appears inside a `//` comment open a block which runs to the next `*/` anywhere in the
    // file, swallowing real code in between. Measured: it ate 20KB of http.ts's 32KB and silently
    // dropped `process.env.MEDIA_RENDER_SECRET`, which made a live consumer look dead.
    const code = content
      .split("\n")
      .filter((line) => !line.trim().startsWith("//"))
      .join("\n")
      .replace(/\/\*[\s\S]*?\*\//g, "");
    for (const [, name] of code.matchAll(/process\.env\.([A-Z_][A-Z_0-9]*)/g)) {
      literal.add(name as string);
      consumed.add(name as string);
    }
    // 25.1-06 (D12): THE SECOND WAY THIS CODEBASE READS AN ENV VAR. `requireEnvMedia("X")`
    // (media.ts) is a `process.env[name]` lookup behind a helper, so the literal scan above cannot
    // see a single one of its names — and every name it hid was a MEDIA name whose absence stalls a
    // render inside a bare scheduled action while `envCheck` goes on reporting the deployment ready.
    // Adding the call sites' string literals puts those names under BOTH drift checks below.
    //
    // Deliberately matches the STRING LITERAL, not a `[A-Z_]` shape: `Video_and_image_API_Key` is
    // mixed-case (Alibaba's own name for the key, ADR-017) and a shape rule would silently drop it —
    // which is how a scan gets a name wrong rather than missing.
    for (const [, name] of code.matchAll(/requireEnvMedia\(\s*"([^"]+)"\s*\)/g)) {
      indirect.add(name as string);
      consumed.add(name as string);
    }
  }

  test("the scan found the real consumers, so the comparison below cannot be vacuous", () => {
    expect(consumed.size).toBeGreaterThan(20);
    expect(consumed).toContain("UNSUBSCRIBE_SECRET");
    expect(consumed).toContain("CONVEX_SITE_URL");
  });

  test("D12: the INDIRECT media reads are discovered, and the literal scan could NOT see them", () => {
    // The second half is what makes this test load-bearing rather than decorative. If any of these
    // names were ALSO read as a literal `process.env.X` somewhere, the extension above would be
    // redundant and its removal would go unnoticed — so the absence is asserted, not assumed.
    for (const name of ["MEDIA_RENDER_URL", "WAN_API_BASE_URL", "Video_and_image_API_Key"]) {
      expect(indirect, `${name} is not read through requireEnvMedia`).toContain(name);
      expect(
        literal,
        `${name} is now a literal read — the requireEnvMedia scan is no longer load-bearing`,
      ).not.toContain(name);
    }
    // A floor, so a broken regex reads as failure rather than as "nothing indirect exists".
    expect(indirect.size).toBeGreaterThanOrEqual(5);
  });

  test("every consumed name is classified — an unclassified addition fails here", () => {
    const classified = new Set(ENV_MANIFEST.map((e) => e.name));
    expect([...consumed].filter((n) => !classified.has(n)).sort()).toEqual([]);
  });

  test("no manifest entry is dead — a name nothing reads is removed, not carried", () => {
    // The other direction. A stale entry makes a readiness screen demand a key that does nothing.
    expect(
      ENV_MANIFEST.map((e) => e.name)
        .filter((n) => !consumed.has(n))
        .sort(),
    ).toEqual([]);
  });

  test("D14: FAL_WEBHOOK_SECRET is gone from BOTH the manifest and source", () => {
    // Not just delisted — unread. Asserting only the manifest half would pass against a codebase
    // that still had the route, which is the thing this plan removed.
    expect(ENV_MANIFEST.map((e) => e.name)).not.toContain("FAL_WEBHOOK_SECRET");
    expect(consumed).not.toContain("FAL_WEBHOOK_SECRET");
    // `FAL_FIXTURE` is NOT dead and must survive: it still short-circuits `media.ts`'s submit.
    expect(consumed).toContain("FAL_FIXTURE");
  });

  test("D14: no source file routes, signs or fetches for a fal callback any more", () => {
    const offenders = Object.entries(sources)
      .filter(([path]) => !path.endsWith(".test.ts") && !path.includes("/_generated/"))
      .filter(([, content]) =>
        // Code only: the tombstone comments that explain the removal name the route on purpose.
        /fal[_/]?(callback|webhook)/i.test(
          content
            .split("\n")
            .filter((line) => !line.trim().startsWith("//") && !line.trim().startsWith("*"))
            .join("\n"),
        ),
      )
      .map(([path]) => path);
    expect(offenders).toEqual([]);
  });

  test("every entry says what breaks, in words an operator can act on", () => {
    for (const entry of ENV_MANIFEST) {
      expect(entry.whatBreaks.length).toBeGreaterThan(20);
    }
  });

  test("the names that stop delivery entirely are REQUIRED, not feature", () => {
    // UNSUBSCRIBE_SECRET is the sharpest: absent, the CAN-SPAM footer cannot be built and EVERY
    // send fails closed. Demoting it to `feature` would make a dead deployment report ready.
    expect(REQUIRED_ENV).toContain("UNSUBSCRIBE_SECRET");
    expect(REQUIRED_ENV).toContain("CONVEX_SITE_URL");
    expect(REQUIRED_ENV).toContain("OPENAI_API_KEY");
    // Microsoft is a FEATURE: the signup button hides itself while it is unset, so its absence is
    // honest rather than broken.
    expect(REQUIRED_ENV).not.toContain("AUTH_MICROSOFT_ENTRA_ID_ID");
  });
});

describe("missingEnv reports names, never values", () => {
  const read = (set: Record<string, string>) => (name: string) => set[name];

  test('a blank value counts as UNSET — `convex env set X ""` is the classic false-ready', () => {
    const all = Object.fromEntries(ENV_MANIFEST.map((e) => [e.name, "x"]));
    expect(missingEnv(read(all)).missingRequired).toEqual([]);

    const blanked = { ...all, UNSUBSCRIBE_SECRET: "   " };
    expect(missingEnv(read(blanked)).missingRequired).toEqual(["UNSUBSCRIBE_SECRET"]);
  });

  test("an empty environment reports every required name and no value anywhere", () => {
    const result = missingEnv(() => undefined);
    expect(result.missingRequired.sort()).toEqual([...REQUIRED_ENV].sort());
    expect(JSON.stringify(result)).not.toContain("secret");
  });

  test("an ACTIVE fixture seam is reported — a faked provider looks like success otherwise", () => {
    const withFixture = { FAL_FIXTURE: "on", CONVEX_CLOUD_URL: "https://x.convex.cloud" };
    const result = missingEnv(read(withFixture));
    expect(result.fixturesActive).toContain("FAL_FIXTURE");
    // Convex sets these itself; their presence is not a warning.
    expect(result.fixturesActive).not.toContain("CONVEX_CLOUD_URL");
  });
});

describe("isDurableOrigin rejects the origins that stop resolving", () => {
  test("a real https host is durable", () => {
    expect(isDurableOrigin("https://www.pikar-ai.com")).toBe(true);
    // `*.convex.site` is durable even though it is not CUSTOM — the distinction 25-10's original
    // wording would have blocked the phase on.
    expect(isDurableOrigin("https://woozy-wren-368.convex.site")).toBe(true);
  });

  test("localhost, http, and a preview build are NOT durable", () => {
    expect(isDurableOrigin("http://localhost:3111")).toBe(false);
    expect(isDurableOrigin("https://localhost")).toBe(false);
    expect(isDurableOrigin("http://www.pikar-ai.com")).toBe(false); // plain http
    expect(isDurableOrigin("https://pikar-ai-git-abc123x.vercel.app")).toBe(false);
  });

  test("absent, blank and unparseable are all not durable", () => {
    expect(isDurableOrigin(undefined)).toBe(false);
    expect(isDurableOrigin("   ")).toBe(false);
    expect(isDurableOrigin("not a url")).toBe(false);
  });
});

describe("envCheck is owner-only and leaks nothing", () => {
  test("a non-owner is refused before reading any environment", async () => {
    const t = convexTest(schema, modules);
    const userId = await t.run((ctx) => ctx.db.insert("users", {}));
    await expect(
      t.withIdentity({ subject: `${userId}|s` }).query(api.ops.envCheck, {}),
    ).rejects.toThrow(/OWNER_REQUIRED/);
  });

  test("the owner sees names and a ready flag, and no value", async () => {
    vi.stubEnv("UNSUBSCRIBE_SECRET", "super-secret-value");
    const t = convexTest(schema, modules);
    const ownerId = await t.run((ctx) => ctx.db.insert("users", { owner: true }));

    const result = await t.withIdentity({ subject: `${ownerId}|s` }).query(api.ops.envCheck, {});

    expect(typeof result.ready).toBe("boolean");
    expect(Array.isArray(result.missingRequired)).toBe(true);
    expect(JSON.stringify(result)).not.toContain("super-secret-value");
    vi.unstubAllEnvs();
  });

  test("a dark FEATURE is not a broken deployment — `ready` ignores missingFeature", async () => {
    // ADR-022 widened `ready`: it is REQUIRED names AND durable origins now, so the origin names
    // need real values here. Stubbing them to the literal "set" like the rest correctly makes
    // `ready` false, which is what caught this test's stale premise.
    for (const name of REQUIRED_ENV) vi.stubEnv(name, "set");
    vi.stubEnv("SITE_URL", "https://www.pikar-ai.com");
    vi.stubEnv("CONVEX_SITE_URL", "https://woozy-wren-368.convex.site");
    vi.stubEnv("GMAIL_OAUTH_REDIRECT_URI", "https://woozy-wren-368.convex.site/gmail/callback");
    // 36-01: `ready` also requires NO active fixture seam, and the unit suite runs with the
    // keyless opt-in set (`vitest.config.mts`) — clear it, since this test is about FEATURES.
    vi.stubEnv("PIKAR_OFFLINE_FIXTURES", "");
    const t = convexTest(schema, modules);
    // SEED THE REGISTRY FIRST. As of 2026-08-30 `ready` also turns on the skill registry, and a
    // fresh convexTest database has no rows — so without this the assertion below would be false
    // for a reason that has nothing to do with the env dimension this test is about. Note what the
    // previous version of this test was: `ready === true` asserted over an UNSEEDED registry, i.e.
    // over exactly the deployment state that shipped a dark feature on 2026-08-30.
    await t.mutation(internal.skills.seedSkills, {});
    const ownerId = await t.run((ctx) => ctx.db.insert("users", { owner: true }));

    const result = await t.withIdentity({ subject: `${ownerId}|s` }).query(api.ops.envCheck, {});

    expect(result.ready).toBe(true);
    expect(result.unseededSkills).toEqual([]);
    // …while feature names are still reported as missing rather than hidden.
    expect(result.missingFeature.length).toBeGreaterThan(0);
    vi.unstubAllEnvs();
  });
});

describe("an UNSEEDED SKILL REGISTRY is a broken deployment, and this screen now says so", () => {
  // THE GAP THIS CLOSES, measured 2026-08-30. §5 puts every agent prompt in the `skills` table and
  // `loadSkill` fails CLOSED (`NO_ACTIVE_SKILL`) — deliberately. But `seedSkills` is an
  // internalMutation an operator must RUN, and nothing reported that it had not been. Phase 29
  // shipped two new skill names into SEEDS, the deployment was never re-seeded, and unified
  // knowledge search was INERT: the browser gate died on `NO_ACTIVE_SKILL` while the whole unit
  // suite stayed green, because `convex-test` seeds the registry INSIDE each test.
  const setEnvGreen = () => {
    for (const name of REQUIRED_ENV) vi.stubEnv(name, "set");
    vi.stubEnv("SITE_URL", "https://www.pikar-ai.com");
    vi.stubEnv("CONVEX_SITE_URL", "https://woozy-wren-368.convex.site");
    vi.stubEnv("GMAIL_OAUTH_REDIRECT_URI", "https://woozy-wren-368.convex.site/gmail/callback");
  };

  test("an unseeded deployment is NOT ready, and every missing agent is named", async () => {
    setEnvGreen();
    const t = convexTest(schema, modules);
    const ownerId = await t.run((ctx) => ctx.db.insert("users", { owner: true }));

    const result = await t.withIdentity({ subject: `${ownerId}|s` }).query(api.ops.envCheck, {});

    // Every env dimension is green, so `ready` can only be false for the registry.
    expect(result.missingRequired).toEqual([]);
    expect(result.nonDurableOrigins).toEqual([]);
    expect(result.ready).toBe(false);
    // NAMED, not counted — an operator needs to know WHICH agent has no prompt.
    expect(result.unseededSkills).toEqual([...REGISTRY_SKILL_NAMES]);
    // The two names whose absence actually shipped a dark feature.
    expect(result.unseededSkills).toContain("knowledge-query-planner");
    expect(result.unseededSkills).toContain("knowledge-synthesizer");
    vi.unstubAllEnvs();
  });

  test("seeding clears it — so the check tracks the registry, not a constant", async () => {
    setEnvGreen();
    vi.stubEnv("PIKAR_OFFLINE_FIXTURES", ""); // 36-01: this test is about the REGISTRY dimension
    const t = convexTest(schema, modules);
    const ownerId = await t.run((ctx) => ctx.db.insert("users", { owner: true }));
    await t.mutation(internal.skills.seedSkills, {});

    const result = await t.withIdentity({ subject: `${ownerId}|s` }).query(api.ops.envCheck, {});

    expect(result.unseededSkills).toEqual([]);
    expect(result.ready).toBe(true);
    vi.unstubAllEnvs();
  });

  test("ONE archived agent is enough to break ready, and only that one is named", async () => {
    // The half that matters after a partial or drifted seed: this must report the EXACT missing
    // name, not "some are missing". Archiving one active row is the smallest real version of a
    // registry that has drifted away from SEEDS. (`archived` — the status union is
    // active|candidate|rolled_back|archived; there is no "retired".)
    setEnvGreen();
    const t = convexTest(schema, modules);
    const ownerId = await t.run((ctx) => ctx.db.insert("users", { owner: true }));
    await t.mutation(internal.skills.seedSkills, {});
    await t.run(async (ctx) => {
      const row = await ctx.db
        .query("skills")
        .withIndex("by_name_status", (q) =>
          q.eq("name", "knowledge-synthesizer").eq("status", "active"),
        )
        .unique();
      if (row === null) throw new Error("fixture: knowledge-synthesizer was not seeded active");
      await ctx.db.patch(row._id, { status: "archived" });
    });

    const result = await t.withIdentity({ subject: `${ownerId}|s` }).query(api.ops.envCheck, {});

    expect(result.unseededSkills).toEqual(["knowledge-synthesizer"]);
    expect(result.ready).toBe(false);
    vi.unstubAllEnvs();
  });
});

describe("ADR-022: a SET but EPHEMERAL origin is caught, which missingRequired cannot see", () => {
  test("every origin name is a real manifest entry", () => {
    const classified = new Set(ENV_MANIFEST.map((e) => e.name));
    for (const name of ORIGIN_ENV) expect(classified.has(name)).toBe(true);
    expect(ORIGIN_ENV.length).toBeGreaterThanOrEqual(4);
  });

  test("a preview-build SITE_URL makes the deployment NOT ready, though nothing is missing", async () => {
    // The whole point. The name is present, so `missingRequired` is empty and every prior check
    // reads green — while the unsubscribe link in a sent email points at a build that stops
    // resolving on the next push.
    for (const name of REQUIRED_ENV) vi.stubEnv(name, "set");
    vi.stubEnv("SITE_URL", "https://pikar-ai-git-abc123x.vercel.app");
    vi.stubEnv("CONVEX_SITE_URL", "https://woozy-wren-368.convex.site");

    const t = convexTest(schema, modules);
    const ownerId = await t.run((ctx) => ctx.db.insert("users", { owner: true }));
    const result = await t.withIdentity({ subject: `${ownerId}|s` }).query(api.ops.envCheck, {});

    expect(result.missingRequired).toEqual([]);
    expect(result.nonDurableOrigins).toContain("SITE_URL");
    expect(result.ready).toBe(false);
    vi.unstubAllEnvs();
  });

  test("durable origins report ready, and *.convex.site is durable", async () => {
    for (const name of REQUIRED_ENV) vi.stubEnv(name, "set");
    vi.stubEnv("SITE_URL", "https://www.pikar-ai.com");
    vi.stubEnv("CONVEX_SITE_URL", "https://woozy-wren-368.convex.site");
    vi.stubEnv("GMAIL_OAUTH_REDIRECT_URI", "https://woozy-wren-368.convex.site/gmail/callback");
    vi.stubEnv("PIKAR_OFFLINE_FIXTURES", ""); // 36-01: this test is about ORIGINS, not fixtures

    const t = convexTest(schema, modules);
    // Seed the registry: `ready` also turns on the skill rows now, and this test is about ORIGINS.
    // Without it the assertion fails for an unrelated reason. (Second test to need this — the
    // premise "every env name set ⇒ ready" quietly stopped being the whole story on 2026-08-30.)
    await t.mutation(internal.skills.seedSkills, {});
    const ownerId = await t.run((ctx) => ctx.db.insert("users", { owner: true }));
    const result = await t.withIdentity({ subject: `${ownerId}|s` }).query(api.ops.envCheck, {});

    expect(result.nonDurableOrigins).toEqual([]);
    expect(result.ready).toBe(true);
    vi.unstubAllEnvs();
  });

  // 36-01 (owner decision, ADR-035). A deployment running ANY fixture seam fakes a provider, so the
  // headline must say NOT ready — not merely list the name under it. MUTATION that must turn this
  // RED: drop `result.fixturesActive.length === 0` from `ready` in ops.ts.
  test("an ACTIVE fixture seam makes the deployment NOT ready, and is named", async () => {
    for (const name of REQUIRED_ENV) vi.stubEnv(name, "set");
    vi.stubEnv("SITE_URL", "https://www.pikar-ai.com");
    vi.stubEnv("CONVEX_SITE_URL", "https://woozy-wren-368.convex.site");
    vi.stubEnv("GMAIL_OAUTH_REDIRECT_URI", "https://woozy-wren-368.convex.site/gmail/callback");
    vi.stubEnv("PIKAR_OFFLINE_FIXTURES", "");
    vi.stubEnv("PIKAR_FIXTURE_TENANT_IDS", "e2e_user,smoke");

    const t = convexTest(schema, modules);
    await t.mutation(internal.skills.seedSkills, {});
    const ownerId = await t.run((ctx) => ctx.db.insert("users", { owner: true }));
    const result = await t.withIdentity({ subject: `${ownerId}|s` }).query(api.ops.envCheck, {});

    expect(result.fixturesActive).toEqual(["PIKAR_FIXTURE_TENANT_IDS"]);
    expect(result.ready).toBe(false);
    vi.unstubAllEnvs();
  });

  test("an UNSET origin is reported as missing, never as non-durable — one fault, one message", async () => {
    for (const name of REQUIRED_ENV) vi.stubEnv(name, "set");
    vi.stubEnv("SITE_URL", "");
    const t = convexTest(schema, modules);
    const ownerId = await t.run((ctx) => ctx.db.insert("users", { owner: true }));
    const result = await t.withIdentity({ subject: `${ownerId}|s` }).query(api.ops.envCheck, {});

    expect(result.missingRequired).toContain("SITE_URL");
    expect(result.nonDurableOrigins).not.toContain("SITE_URL");
    vi.unstubAllEnvs();
  });
});
