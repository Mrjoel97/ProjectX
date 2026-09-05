// The HubSpot rail's pure half (28-05). Offline, $0, no network, no Convex.
//
// MUTATION NOTE. Several assertions here compare a WHOLE value against a WRITTEN-OUT LITERAL
// rather than testing membership. That is deliberate: a deletion-only mutation cannot see a
// substring match, and this repo has already shipped a rename through a fully green symbol gate.
// Renaming `crm.objects.deals.read` to `crm.objects.deal.read`, or `2026-03` to `v3`, must turn
// this file red.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { validateProjection, validateSourceRef } from "../contracts";
import {
  buildHubSpotAuthorizeUrl,
  HUBSPOT_AUTHORIZE_SCOPES,
  HUBSPOT_AUTHORIZE_URL,
  HUBSPOT_COMPANY_PROPERTIES,
  HUBSPOT_CONTACT_PROPERTIES,
  HUBSPOT_DEAL_PROPERTIES,
  HUBSPOT_READ_PATHS,
  HUBSPOT_READ_SCOPES,
  HUBSPOT_REVOKE_URL,
  HUBSPOT_TOKEN_URL,
  hubspotProjection,
  parseCompanyPage,
  parseContactPage,
  parseDealPage,
  parseDealPipelinePage,
  parseOwnerPage,
  parseTokenResponse,
  revokeBody,
  tokenExchangeBody,
  tokenRefreshBody,
} from "./hubspot";

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 7, 27);
const WINDOW = { startMs: NOW - 30 * DAY, endMs: NOW };
const iso = (ms: number) => new Date(ms).toISOString();

describe("scopes — the exact evidenced read set, pinned to literals", () => {
  it("is exactly the five verified read scopes, in order", () => {
    expect([...HUBSPOT_READ_SCOPES]).toEqual([
      "crm.objects.contacts.read",
      "crm.objects.companies.read",
      "crm.objects.deals.read",
      "crm.objects.owners.read",
      "crm.schemas.deals.read",
    ]);
  });

  it("contains no write, import, export, send, workflow or sensitive-data scope", () => {
    for (const scope of HUBSPOT_READ_SCOPES) {
      expect(scope.endsWith(".read")).toBe(true);
      for (const banned of ["write", "import", "export", "send", "workflow", "sensitive"]) {
        expect(scope).not.toContain(banned);
      }
    }
  });

  it("never uses crm.pipelines.* — that scope family is ORDER pipelines, not deal pipelines", () => {
    for (const scope of HUBSPOT_READ_SCOPES) expect(scope.startsWith("crm.pipelines.")).toBe(false);
    // Deal pipelines/stages come from these two together, which is the trap the register records.
    expect(HUBSPOT_READ_SCOPES).toContain("crm.objects.deals.read");
    expect(HUBSPOT_READ_SCOPES).toContain("crm.schemas.deals.read");
  });

  it("adds HubSpot's mandatory oauth scope only to the installation scope set", () => {
    expect([...HUBSPOT_AUTHORIZE_SCOPES]).toEqual(["oauth", ...HUBSPOT_READ_SCOPES]);
    expect(HUBSPOT_READ_SCOPES).not.toContain("oauth");
  });

  // HubSpot enforces the scope set declared in the APP MANIFEST, not the one we send: an install
  // URL asking for a scope the app does not declare is rejected outright, and a scope the app
  // declares but we never request silently yields a token that cannot read what the rails expect.
  // `apps/hubspot/src/app/app-hsmeta.json` is that declaration and it lives in this repo, so the
  // two can drift in a single commit. They are the same list by construction, asserted as a set
  // equality in both directions so neither file can quietly gain or lose one.
  it("matches the scope set declared in the HubSpot app manifest", () => {
    const manifest = JSON.parse(
      readFileSync(
        fileURLToPath(new URL("../../../../apps/hubspot/src/app/app-hsmeta.json", import.meta.url)),
        "utf8",
      ),
    );
    const declared: string[] = manifest.config.auth.requiredScopes;
    expect([...declared].sort()).toEqual([...HUBSPOT_AUTHORIZE_SCOPES].sort());
    expect(manifest.config.auth.optionalScopes).toEqual([]);
  });
});

describe("endpoints — versioned, literal, and never the legacy surface", () => {
  it("pins the date-versioned OAuth endpoints", () => {
    expect(HUBSPOT_TOKEN_URL).toBe("https://api.hubapi.com/oauth/2026-03/token");
    expect(HUBSPOT_REVOKE_URL).toBe("https://api.hubapi.com/oauth/2026-03/token/revoke");
    expect(HUBSPOT_AUTHORIZE_URL).toBe("https://app.hubspot.com/oauth/authorize");
  });

  it("uses no legacy oauth path and no refresh-token DELETE route", () => {
    for (const url of [HUBSPOT_TOKEN_URL, HUBSPOT_REVOKE_URL]) {
      expect(url).not.toContain("/oauth/v1/");
      expect(url).not.toContain("/oauth/v3/");
      expect(url).not.toContain("refresh-tokens");
    }
  });

  it("reads exactly the five allow-listed CRM GET paths", () => {
    expect([...HUBSPOT_READ_PATHS]).toEqual([
      "/crm/v3/objects/contacts",
      "/crm/v3/objects/companies",
      "/crm/v3/objects/deals",
      "/crm/v3/owners",
      "/crm/v3/pipelines/deals",
    ]);
  });
});

describe("property allow-lists — the structural half of 'no second CRM'", () => {
  const ALL = [
    ...HUBSPOT_CONTACT_PROPERTIES,
    ...HUBSPOT_COMPANY_PROPERTIES,
    ...HUBSPOT_DEAL_PROPERTIES,
  ];

  it("never asks HubSpot for a person's name, email, phone or any free-text label", () => {
    for (const banned of [
      "email",
      "firstname",
      "lastname",
      "name",
      "phone",
      "address",
      "dealname",
      "company",
      "notes",
      "description",
    ]) {
      expect(ALL).not.toContain(banned);
    }
  });

  it("asks only for timestamps, ids, stage keys and money fields", () => {
    expect([...HUBSPOT_DEAL_PROPERTIES]).toEqual([
      "amount",
      "closedate",
      "createdate",
      "deal_currency_code",
      "dealstage",
      "hs_lastmodifieddate",
      "hubspot_owner_id",
      "pipeline",
    ]);
  });
});

describe("authorize URL", () => {
  const input = {
    clientId: "cid-1",
    redirectUri: "https://app.example.com/api/connect/hubspot",
    state: "st-abc",
  };

  it("carries client id, redirect, state and the complete required installation scope set", () => {
    const url = new URL(buildHubSpotAuthorizeUrl(input));
    expect(`${url.origin}${url.pathname}`).toBe(HUBSPOT_AUTHORIZE_URL);
    expect(url.searchParams.get("client_id")).toBe("cid-1");
    expect(url.searchParams.get("redirect_uri")).toBe(input.redirectUri);
    expect(url.searchParams.get("state")).toBe("st-abc");
    expect(url.searchParams.get("scope")).toBe(HUBSPOT_AUTHORIZE_SCOPES.join(" "));
    expect(url.searchParams.get("optional_scope")).toBeNull();
  });

  it("allows HubSpot's documented http://localhost development redirect", () => {
    const redirectUri = "http://localhost:3211/connectors/hubspot/callback/production";
    const url = new URL(buildHubSpotAuthorizeUrl({ ...input, redirectUri }));
    expect(url.searchParams.get("redirect_uri")).toBe(redirectUri);
  });

  it("refuses cleartext non-localhost redirects, lookalikes, invalid URLs and an empty state", () => {
    expect(() =>
      buildHubSpotAuthorizeUrl({ ...input, redirectUri: "http://evil.test/cb" }),
    ).toThrow();
    expect(() =>
      buildHubSpotAuthorizeUrl({ ...input, redirectUri: "http://localhost.evil.test/cb" }),
    ).toThrow();
    expect(() =>
      buildHubSpotAuthorizeUrl({ ...input, redirectUri: "http://127.0.0.1:3211/cb" }),
    ).toThrow();
    expect(() => buildHubSpotAuthorizeUrl({ ...input, redirectUri: "not a URL" })).toThrow();
    expect(() => buildHubSpotAuthorizeUrl({ ...input, state: "" })).toThrow();
  });
});

describe("token request bodies", () => {
  const creds = { clientId: "cid", clientSecret: "sec" };

  it("exchanges an authorization code with the documented grant", () => {
    const body = tokenExchangeBody({
      ...creds,
      redirectUri: "https://app.example.com/cb",
      code: "code-1",
    });
    expect(body.get("grant_type")).toBe("authorization_code");
    expect(body.get("code")).toBe("code-1");
    expect(body.get("client_secret")).toBe("sec");
  });

  it("refreshes with grant_type=refresh_token and never sends the code", () => {
    const body = tokenRefreshBody({ ...creds, refreshToken: "rt-1" });
    expect(body.get("grant_type")).toBe("refresh_token");
    expect(body.get("refresh_token")).toBe("rt-1");
    expect(body.get("code")).toBeNull();
  });

  it("revokes RFC-7009 shaped, naming the token type", () => {
    const body = revokeBody({ ...creds, token: "rt-1", tokenTypeHint: "refresh_token" });
    expect(body.get("token")).toBe("rt-1");
    expect(body.get("token_type_hint")).toBe("refresh_token");
    expect(body.get("client_id")).toBe("cid");
    expect(body.get("client_secret")).toBe("sec");
  });
});

describe("token response parsing", () => {
  it("accepts a well-formed response and carries hub_id when present", () => {
    const r = parseTokenResponse({
      access_token: "at",
      refresh_token: "rt",
      expires_in: 1800,
      hub_id: 12345,
    });
    expect(r.ok && r.value).toEqual({
      accessToken: "at",
      refreshToken: "rt",
      expiresInSec: 1800,
      hubId: "12345",
    });
  });

  it("treats a missing hub_id as unknown rather than inventing a binding", () => {
    const r = parseTokenResponse({ access_token: "at", refresh_token: "rt", expires_in: 1800 });
    expect(r.ok && r.value.hubId).toBeNull();
  });

  it("refuses a missing token, a blank token and a non-numeric expiry", () => {
    expect(parseTokenResponse({ refresh_token: "rt", expires_in: 10 }).ok).toBe(false);
    expect(parseTokenResponse({ access_token: "", refresh_token: "rt", expires_in: 10 }).ok).toBe(
      false,
    );
    expect(
      parseTokenResponse({ access_token: "at", refresh_token: "rt", expires_in: "soon" }).ok,
    ).toBe(false);
    expect(parseTokenResponse(null).ok).toBe(false);
    expect(parseTokenResponse("nope").ok).toBe(false);
  });
});

describe("page parsing — bounded projections, no vendor shapes", () => {
  const contactPage = {
    results: [
      {
        id: "701",
        createdAt: iso(NOW - DAY),
        updatedAt: iso(NOW),
        properties: { createdate: iso(NOW - DAY), firstname: "Ada", email: "ada@example.com" },
      },
    ],
    paging: { next: { after: "cur-2", link: "https://api.hubapi.com/whatever" } },
  };

  it("keeps ids and timestamps and drops every free-text property", () => {
    const page = parseContactPage(contactPage);
    expect(page.cursor).toBe("cur-2");
    expect(page.items).toEqual([
      {
        ref: { provider: "hubspot", kind: "contact", id: "701" },
        createdAt: NOW - DAY,
        updatedAt: NOW,
      },
    ]);
    expect(JSON.stringify(page.items)).not.toContain("Ada");
    expect(JSON.stringify(page.items)).not.toContain("ada@example.com");
  });

  it("returns a null cursor at the end of the list", () => {
    expect(parseContactPage({ results: [] }).cursor).toBeNull();
    expect(parseContactPage({ results: [], paging: {} }).cursor).toBeNull();
  });

  it("throws on a shape it does not recognise rather than silently reading zero rows", () => {
    expect(() => parseContactPage({ items: [] })).toThrow();
    expect(() => parseContactPage(null)).toThrow();
  });

  it("drops a row whose id is not a usable ref instead of poisoning the projection", () => {
    const page = parseCompanyPage({
      results: [
        { id: 'a"quote', createdAt: iso(NOW) },
        { id: "902", createdAt: iso(NOW) },
        { id: "x".repeat(200), createdAt: iso(NOW) },
      ],
    });
    expect(page.items.map((i) => i.ref.id)).toEqual(["902"]);
    for (const item of page.items) expect(validateSourceRef(item.ref).ok).toBe(true);
  });

  it("normalizes a deal to stage keys, an owner ref and a money FIGURE", () => {
    const page = parseDealPage({
      results: [
        {
          id: "5001",
          createdAt: iso(NOW - 2 * DAY),
          updatedAt: iso(NOW),
          properties: {
            amount: "1500.50",
            deal_currency_code: "usd",
            closedate: iso(NOW + 10 * DAY),
            dealstage: "appointmentscheduled",
            pipeline: "default",
            hubspot_owner_id: "44",
            dealname: "Acme — huge deal",
          },
        },
      ],
    });
    const deal = page.items[0];
    if (deal === undefined) throw new Error("expected one normalized deal");
    expect(deal.ref).toEqual({ provider: "hubspot", kind: "deal", id: "5001" });
    expect(deal.pipelineId).toBe("default");
    expect(deal.stageId).toBe("appointmentscheduled");
    expect(deal.ownerRef).toBe("44");
    expect(deal.closeAt).toBe(NOW + 10 * DAY);
    expect(deal.amount).toEqual({
      state: "known",
      origin: "observed",
      value: { minor: 150050, currency: "USD" },
    });
    expect(JSON.stringify(page.items)).not.toContain("Acme");
  });

  it("reports a missing amount as UNKNOWN, never as zero", () => {
    const page = parseDealPage({
      results: [{ id: "5002", createdAt: iso(NOW), properties: { dealstage: "x" } }],
    });
    expect(page.items[0]?.amount.state).toBe("unknown");
    expect(page.items[0]?.amount).not.toHaveProperty("value");
  });

  it("reports an amount with no currency as UNKNOWN rather than guessing USD", () => {
    const page = parseDealPage({
      results: [{ id: "5003", createdAt: iso(NOW), properties: { amount: "42.00" } }],
    });
    expect(page.items[0]?.amount.state).toBe("unknown");
  });

  it("normalizes deal pipelines to stage ids and closed flags, dropping labels", () => {
    const page = parseDealPipelinePage({
      results: [
        {
          id: "default",
          label: "Sales Pipeline",
          stages: [
            {
              id: "s1",
              label: "Appointment scheduled",
              displayOrder: 0,
              metadata: { isClosed: "false" },
            },
            { id: "s2", label: "Closed won", displayOrder: 1, metadata: { isClosed: "true" } },
            { id: "s3", label: "Mystery", displayOrder: 2, metadata: {} },
          ],
        },
      ],
    });
    expect(page.cursor).toBeNull();
    expect(page.items).toEqual([
      {
        ref: { provider: "hubspot", kind: "deal_pipeline", id: "default" },
        stages: [
          { stageId: "s1", displayOrder: 0, closed: false },
          { stageId: "s2", displayOrder: 1, closed: true },
          { stageId: "s3", displayOrder: 2, closed: null },
        ],
      },
    ]);
    expect(JSON.stringify(page.items)).not.toContain("Sales Pipeline");
  });

  it("normalizes owners to ids alone — never an email or a person's name", () => {
    const page = parseOwnerPage({
      results: [{ id: "44", email: "rep@example.com", firstName: "Rep", lastName: "One" }],
    });
    expect(page.items).toEqual([{ ref: { provider: "hubspot", kind: "owner", id: "44" } }]);
    expect(JSON.stringify(page.items)).not.toContain("rep@example.com");
  });
});

describe("projection assembly — partial is never a smaller complete", () => {
  const items = [{ ref: { provider: "hubspot" as const, kind: "deal", id: "1" } }];

  it("marks a complete read ready, supplemental, with the coverage window and retrieval time", () => {
    const p = hubspotProjection({
      items,
      retrievedAt: NOW,
      window: WINDOW,
      capped: false,
      partial: false,
      missing: [],
    });
    expect(p.state).toBe("ready");
    if (p.state !== "ready") throw new Error("unreachable");
    expect(p.meta.provider).toBe("hubspot");
    expect(p.meta.authority).toBe("supplemental");
    expect(p.meta.retrievedAt).toBe(NOW);
    expect(p.meta.window).toEqual(WINDOW);
    expect(p.meta.sources).toEqual(items.map((i) => i.ref));
    expect(validateProjection(p).ok).toBe(true);
  });

  it("makes a capped read partial and names what is missing", () => {
    const p = hubspotProjection({
      items,
      retrievedAt: NOW,
      window: WINDOW,
      capped: true,
      partial: true,
      missing: ["page_cap"],
    });
    expect(p.state).toBe("partial");
    if (p.state !== "partial") throw new Error("unreachable");
    expect(p.meta.capped).toBe(true);
    expect(p.missing).toContain("page_cap");
    expect(validateProjection(p).ok).toBe(true);
  });

  it("cannot produce a ready projection from a capped read", () => {
    const p = hubspotProjection({
      items,
      retrievedAt: NOW,
      window: WINDOW,
      capped: true,
      partial: false,
      missing: [],
    });
    expect(p.state).toBe("partial");
    expect(validateProjection(p).ok).toBe(true);
  });

  it("still names something when a partial read was given no labels", () => {
    const p = hubspotProjection({
      items,
      retrievedAt: NOW,
      window: WINDOW,
      capped: false,
      partial: true,
      missing: [],
    });
    if (p.state !== "partial") throw new Error("unreachable");
    expect(p.missing.trim()).not.toBe("");
    expect(validateProjection(p).ok).toBe(true);
  });

  it("refuses a coverage window wider than the code-owned cap", () => {
    expect(() =>
      hubspotProjection({
        items,
        retrievedAt: NOW,
        window: { startMs: NOW - 500 * DAY, endMs: NOW },
        capped: false,
        partial: false,
        missing: [],
      }),
    ).toThrow();
  });
});
