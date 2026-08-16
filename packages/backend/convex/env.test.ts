// 25-10: the hosted environment manifest, and the scan that keeps it honest.
//
// A manifest maintained by remembering to update it is a manifest that goes stale — silently, and
// in the direction that matters (a new required key nobody classified reads as "ready"). So the
// first test DERIVES the set of names source actually consumes and fails when one is unclassified.
// That is the same shape as Phase 22.1's table-classification drift test, for the same reason.
import { convexTest } from "convex-test";
import { describe, expect, test, vi } from "vitest";
import { api } from "./_generated/api";
import { ENV_MANIFEST, isDurableOrigin, missingEnv, ORIGIN_ENV, REQUIRED_ENV } from "./lib/env";
import schema from "./schema";

const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);

const sources = import.meta.glob("./**/*.ts", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

describe("the manifest covers every name source actually reads", () => {
  const consumed = new Set<string>();
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
      consumed.add(name as string);
    }
  }

  test("the scan found the real consumers, so the comparison below cannot be vacuous", () => {
    expect(consumed.size).toBeGreaterThan(20);
    expect(consumed).toContain("UNSUBSCRIBE_SECRET");
    expect(consumed).toContain("CONVEX_SITE_URL");
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
    const t = convexTest(schema, modules);
    const ownerId = await t.run((ctx) => ctx.db.insert("users", { owner: true }));

    const result = await t.withIdentity({ subject: `${ownerId}|s` }).query(api.ops.envCheck, {});

    expect(result.ready).toBe(true);
    // …while feature names are still reported as missing rather than hidden.
    expect(result.missingFeature.length).toBeGreaterThan(0);
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

    const t = convexTest(schema, modules);
    const ownerId = await t.run((ctx) => ctx.db.insert("users", { owner: true }));
    const result = await t.withIdentity({ subject: `${ownerId}|s` }).query(api.ops.envCheck, {});

    expect(result.nonDurableOrigins).toEqual([]);
    expect(result.ready).toBe(true);
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
