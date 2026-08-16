// DLVR-02: the Microsoft Graph send arm and the two-provider dispatcher.
//
// THE CENTRAL CLAIM HERE IS A PARITY CLAIM. Two providers means two chances to send a message with
// no unsubscribe footer, or to a suppressed address — so the tests that matter most are the ones
// asserting the Microsoft arm carries the SAME governance bytes as the Google arm, produced by the
// same `prepareGovernedMessage`. A test that only checked "Graph got called" would pass with every
// guard removed.
//
// Every test is $0 — convex-test plus a stubbed fetch, no network.
import {
  MICROSOFT_SCOPES,
  MS_CALENDARS_READWRITE_SCOPE,
  MS_OFFLINE_ACCESS_SCOPE,
} from "@pikar/core";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import aggregateSchema from "../node_modules/@convex-dev/aggregate/src/component/schema.js";
import { internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);
const aggregateModules = import.meta.glob(
  "../node_modules/@convex-dev/aggregate/src/component/**/!(*.test).ts",
);

const TENANT = "tenant_graph";
const SECRET = "0123456789abcdef0123456789abcdef";
const SITE = "https://example.convex.site";
const POSTAL = "Pikar AI, 12 Samora Ave, Dar es Salaam, TZ";
const RECIPIENT = "dest@example.com";
const SUBJECT = "Quarterly note";
const BODY = "Here is the update you asked for.";
const BASE_MS = 1_800_000_000_000;

const GRAPH_SEND = "https://graph.microsoft.com/v1.0/me/sendMail";
const GMAIL_SEND = "https://gmail.googleapis.com/gmail/v1/users/me/messages/send";

/** A send-capable grant (the ADR-018 default) vs a 17-05-era calendar-only one.
 *  `MICROSOFT_SCOPES` is already the space-joined string the grant stores. */
const FULL_SCOPE = MICROSOFT_SCOPES;
const CALENDAR_ONLY = `${MS_OFFLINE_ACCESS_SCOPE} ${MS_CALENDARS_READWRITE_SCOPE}`;

function harness() {
  const t = convexTest(schema, modules);
  t.registerComponent("auditCounts", aggregateSchema, aggregateModules);
  return t;
}

/** Records every fetch. Graph's success is 202 with an EMPTY body — the shape that would break a
 *  naive `await res.json()`, so the mock reproduces it exactly rather than returning `{}`. */
function mockGraph(opts: { sendStatus?: number; sendBody?: string } = {}) {
  const calls: { url: string; body: string; headers: Record<string, string> }[] = [];
  const fetchMock = vi.fn(async (url: unknown, init?: RequestInit) => {
    calls.push({
      url: String(url),
      body: init?.body ? String(init.body) : "",
      headers: (init?.headers ?? {}) as Record<string, string>,
    });
    if (String(url).includes("login.microsoftonline.com")) {
      return new Response(JSON.stringify({ access_token: "graph-at", expires_in: 3600 }), {
        status: 200,
      });
    }
    if (String(url).startsWith("https://oauth2.googleapis.com/token")) {
      return new Response(JSON.stringify({ access_token: "g-at", expires_in: 3600 }), {
        status: 200,
      });
    }
    if (String(url) === GMAIL_SEND) {
      return new Response(JSON.stringify({ id: "gmail-msg-1" }), { status: 200 });
    }
    return new Response(opts.sendBody ?? "", { status: opts.sendStatus ?? 202 });
  });
  vi.stubGlobal("fetch", fetchMock);
  return {
    calls,
    graphPosts: () => calls.filter((c) => c.url === GRAPH_SEND),
    gmailPosts: () => calls.filter((c) => c.url === GMAIL_SEND),
    /** The decoded RFC-2822 bytes actually handed to Graph — never the stored draft. */
    mime: () => {
      const sent = calls.filter((c) => c.url === GRAPH_SEND);
      expect(sent).toHaveLength(1);
      // STANDARD base64, not URL-safe: decoding with the wrong alphabet is exactly the bug this
      // reads back to catch.
      return Buffer.from(sent[0]?.body ?? "", "base64").toString("utf8");
    },
  };
}

type T = ReturnType<typeof convexTest>;

const seedMicrosoft = (t: T, scope = FULL_SCOPE, expiresAt = BASE_MS + 3_600_000) =>
  t.run((ctx) =>
    ctx.db.insert("microsoftCalendarTokens", {
      tenantId: TENANT,
      refreshToken: "ms-refresh",
      accessToken: "ms-access",
      expiresAt,
      scope,
      updatedAt: BASE_MS,
    }),
  );

const seedGoogle = (t: T) =>
  t.run((ctx) =>
    ctx.db.insert("gmailTokens", {
      tenantId: TENANT,
      refreshToken: "g-refresh",
      scope: "s",
      updatedAt: BASE_MS,
    }),
  );

const seedProfile = (t: T) =>
  t.run((ctx) =>
    ctx.db.insert("tenantProfiles", {
      tenantId: TENANT,
      tier: "solopreneur",
      tierSource: "derived",
      derivedAt: BASE_MS,
      postalAddress: POSTAL,
    }),
  );

const seedRequest = (t: T, mailProvider?: "google" | "microsoft", recipient = RECIPIENT) =>
  t.run((ctx) =>
    ctx.db.insert("requests", {
      tenantId: TENANT,
      correlationId: `send_${crypto.randomUUID()}`,
      goal: SUBJECT,
      recipient,
      draft: BODY,
      status: "approved",
      attachmentRefs: [],
      ...(mailProvider ? { mailProvider } : {}),
      createdAt: BASE_MS,
    }),
  );

beforeEach(() => {
  vi.stubEnv("UNSUBSCRIBE_SECRET", SECRET);
  vi.stubEnv("CONVEX_SITE_URL", SITE);
  vi.stubEnv("MICROSOFT_OAUTH_CLIENT_ID", "ms-client");
  vi.stubEnv("MICROSOFT_OAUTH_CLIENT_SECRET", "ms-secret");
  vi.useFakeTimers();
  vi.setSystemTime(BASE_MS);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("graph.send — the Microsoft arm carries the same governance as the Google arm", () => {
  test("a normal send reaches Graph with the postal address and unsubscribe URL in its MIME", async () => {
    const t = harness();
    await seedMicrosoft(t);
    await seedProfile(t);
    const requestId = await seedRequest(t, "microsoft");
    const g = mockGraph();

    // Graph gives no id, and the contract says so rather than inventing one.
    expect(await t.action(internal.graph.send, { requestId })).toEqual({
      delivered: true,
      messageId: "",
    });

    const mime = g.mime();
    expect(mime).toContain(BODY);
    expect(mime).toContain(POSTAL);
    expect(mime).toContain(`${SITE}/unsubscribe/`);
    expect(mime).toContain(`To: ${RECIPIENT}`);
  });

  test("the bytes are STANDARD base64 and the content type is text/plain", async () => {
    const t = harness();
    await seedMicrosoft(t);
    await seedProfile(t);
    const requestId = await seedRequest(t, "microsoft");
    const g = mockGraph();
    await t.action(internal.graph.send, { requestId });

    const posted = g.graphPosts()[0];
    expect(posted?.headers["Content-Type"]).toBe("text/plain");
    expect(posted?.headers.Authorization).toBe("Bearer ms-access");
    // URL-safe base64 substitutes `-` and `_` for `+` and `/`. Graph rejects that alphabet, and a
    // copy-paste of the Gmail arm is precisely how it would get here.
    expect(posted?.body).not.toMatch(/[-_]/);
  });

  test("BYTE PARITY: the two arms hand their provider the same MIME for the same row", async () => {
    // The whole point of one shared `prepareGovernedMessage`. If these ever diverge, one provider
    // is sending something the other is not — and the footer is the thing most likely to be it.
    const tMs = harness();
    await seedMicrosoft(tMs);
    await seedProfile(tMs);
    const msRequest = await seedRequest(tMs, "microsoft");
    const gMs = mockGraph();
    await tMs.action(internal.graph.send, { requestId: msRequest });
    const microsoftMime = gMs.mime();

    const tG = harness();
    await seedGoogle(tG);
    await seedProfile(tG);
    const gRequest = await seedRequest(tG, "google");
    const gG = mockGraph();
    await tG.action(internal.gmail.send, { requestId: gRequest });
    const googleRaw = JSON.parse(gG.gmailPosts()[0]?.body ?? "{}") as { raw: string };
    const googleMime = Buffer.from(googleRaw.raw, "base64url").toString("utf8");

    // The unsubscribe token is HMAC'd over stable inputs, so these are byte-identical.
    expect(microsoftMime).toBe(googleMime);
  });

  test("a suppressed recipient is refused BEFORE any Graph call", async () => {
    const t = harness();
    await seedMicrosoft(t);
    await seedProfile(t);
    await t.run((ctx) =>
      ctx.db.insert("suppressions", {
        tenantId: TENANT,
        address: RECIPIENT,
        suppressedAt: BASE_MS,
        source: "unsubscribe-link",
      }),
    );
    const requestId = await seedRequest(t, "microsoft");
    const g = mockGraph();

    expect(await t.action(internal.graph.send, { requestId })).toEqual({
      delivered: false,
      reason: "suppressed",
    });
    expect(g.graphPosts()).toHaveLength(0);
  });

  test("a missing postal address fails CLOSED rather than sending without a footer", async () => {
    const t = harness();
    await seedMicrosoft(t);
    // No tenantProfiles row at all → footerFor returns null.
    const requestId = await seedRequest(t, "microsoft");
    const g = mockGraph();

    await expect(t.action(internal.graph.send, { requestId })).rejects.toThrow(
      /no unsubscribe footer/,
    );
    expect(g.graphPosts()).toHaveLength(0);
  });

  test("a CALENDAR-ONLY grant is refused by name, not by a Graph error", async () => {
    // A 17-05-era grant: the row exists, the token is real, and it simply cannot send mail.
    const t = harness();
    await seedMicrosoft(t, CALENDAR_ONLY);
    await seedProfile(t);
    const requestId = await seedRequest(t, "microsoft");
    const g = mockGraph();

    expect(await t.action(internal.graph.send, { requestId })).toEqual({
      delivered: false,
      reason: "mail_scope_missing",
    });
    // Refused before the token round trip, not after Graph 403s.
    expect(g.calls).toHaveLength(0);
  });

  test("no Microsoft connection at all is not_connected", async () => {
    const t = harness();
    await seedProfile(t);
    const requestId = await seedRequest(t, "microsoft");
    mockGraph();
    expect(await t.action(internal.graph.send, { requestId })).toEqual({
      delivered: false,
      reason: "not_connected",
    });
  });

  test("a 5xx and a 429 THROW so the retrier retries", async () => {
    for (const status of [500, 503, 429]) {
      const t = harness();
      await seedMicrosoft(t);
      await seedProfile(t);
      const requestId = await seedRequest(t, "microsoft");
      mockGraph({ sendStatus: status });
      await expect(t.action(internal.graph.send, { requestId })).rejects.toThrow(
        new RegExp(`transient ${status}`),
      );
    }
  });

  test("a 4xx throws with the provider's own message, and does not hold the row", async () => {
    const t = harness();
    await seedMicrosoft(t);
    await seedProfile(t);
    const requestId = await seedRequest(t, "microsoft");
    mockGraph({ sendStatus: 400, sendBody: "ErrorInvalidRecipients" });

    await expect(t.action(internal.graph.send, { requestId })).rejects.toThrow(
      /400 ErrorInvalidRecipients/,
    );
    expect((await t.run((ctx) => ctx.db.get(requestId)))?.status).toBe("approved");
  });

  test("an empty 202 body is success, not a parse failure", async () => {
    const t = harness();
    await seedMicrosoft(t);
    await seedProfile(t);
    const requestId = await seedRequest(t, "microsoft");
    mockGraph({ sendStatus: 202, sendBody: "" });
    expect(await t.action(internal.graph.send, { requestId })).toEqual({
      delivered: true,
      messageId: "",
    });
  });

  test("the audit ref records the provider and NO message id or body (CLAUDE.md §4)", async () => {
    const t = harness();
    await seedMicrosoft(t);
    await seedProfile(t);
    const requestId = await seedRequest(t, "microsoft");
    mockGraph();
    await t.action(internal.graph.send, { requestId });

    const rows = await t.run((ctx) => ctx.db.query("audit").collect());
    const sent = rows.find((r) => r.eventType === "graph.sent");
    expect(sent?.payload).toEqual({ requestId, provider: "microsoft" });
    expect(JSON.stringify(sent?.payload)).not.toContain(BODY);
    expect(JSON.stringify(sent?.payload)).not.toContain(RECIPIENT);
  });
});

describe("delivery.send — the dispatcher routes on the row, and legacy rows still mean Google", () => {
  test("a microsoft row goes to Graph and never touches Gmail", async () => {
    const t = harness();
    await seedMicrosoft(t);
    await seedGoogle(t); // BOTH credentials coexist for one tenant — the ADR-018 shape.
    await seedProfile(t);
    const requestId = await seedRequest(t, "microsoft");
    const g = mockGraph();

    await t.action(internal.delivery.send, { requestId });
    expect(g.graphPosts()).toHaveLength(1);
    expect(g.gmailPosts()).toHaveLength(0);
  });

  test("a google row goes to Gmail and never touches Graph", async () => {
    const t = harness();
    await seedMicrosoft(t);
    await seedGoogle(t);
    await seedProfile(t);
    const requestId = await seedRequest(t, "google");
    const g = mockGraph();

    await t.action(internal.delivery.send, { requestId });
    expect(g.gmailPosts()).toHaveLength(1);
    expect(g.graphPosts()).toHaveLength(0);
  });

  test("a LEGACY row with no mailProvider at all delivers through Google", async () => {
    // The no-backfill claim. Every row written before 25-05 looks exactly like this one.
    const t = harness();
    await seedMicrosoft(t);
    await seedGoogle(t);
    await seedProfile(t);
    const requestId = await seedRequest(t, undefined);
    const g = mockGraph();

    expect(await t.action(internal.delivery.send, { requestId })).toEqual({
      delivered: true,
      messageId: "gmail-msg-1",
    });
    expect(g.gmailPosts()).toHaveLength(1);
    expect(g.graphPosts()).toHaveLength(0);
  });

  test("both tenants' credentials coexist in two tables with no discriminator column", async () => {
    const t = harness();
    await seedMicrosoft(t);
    await seedGoogle(t);

    const gmailRow = await t.run((ctx) =>
      ctx.db
        .query("gmailTokens")
        .withIndex("by_tenant", (q) => q.eq("tenantId", TENANT))
        .unique(),
    );
    const msRow = await t.run((ctx) =>
      ctx.db
        .query("microsoftCalendarTokens")
        .withIndex("by_tenant", (q) => q.eq("tenantId", TENANT))
        .unique(),
    );

    // `.unique()` on by_tenant still resolves for BOTH — which is precisely what a `provider`
    // discriminator column on one shared table would have broken.
    expect(gmailRow).not.toBeNull();
    expect(msRow).not.toBeNull();
    expect(gmailRow).not.toHaveProperty("provider");
  });
});
