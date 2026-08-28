// The Phase 28 bounded provider-read transport. Every test is $0 and offline — a fake `fetch` is
// injected, so nothing here touches a provider, a network or a model.
//
// FOUR things are being proven:
//
//  1. THE TRANSPORT CANNOT WRITE. There is no method argument, no body argument and no origin
//     argument. QuickBooks' only scope (`com.intuit.quickbooks.accounting`) grants WRITES and
//     Intuit publishes no read-only scope, so the compile-time allow-list plus a hardcoded GET is
//     the only thing standing between a stolen token and a journal entry.
//  2. A CAP IS NEVER A COMPLETE ANSWER. Hitting a page/item/byte cap, or losing a later page,
//     returns what was actually read marked `partial` — never a shorter list that reads as ready.
//  3. EACH CAP REFUSES ON ITS OWN. The caps are stacked, so every case is built so exactly one can
//     fire and asserts that cap's own reason (the 28-03 absorbed-guard lesson).
//  4. NOTHING VENDOR-SHAPED ESCAPES. No console, no audit, no dead letter, and the bearer token
//     never appears in a result (CLAUDE.md §4).
import { CAPS, PROVIDERS } from "@pikar/revenue";
import { describe, expect, test } from "vitest";
import {
  buildReadUrl,
  classifyStatus,
  isAllowedRead,
  MAX_RETRIES,
  MAX_RETRY_DELAY_MS,
  PROVIDER_API_ORIGINS,
  PROVIDER_READ_PATHS,
  READ_TIMEOUT_MS,
  readPages,
  retryDelayMs,
} from "./connectorFetch";

const rawSources = import.meta.glob("./**/*.ts", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

function source(name: string): string {
  const src = rawSources[name];
  if (src === undefined) throw new Error(`no raw source for ${name}`);
  return src;
}

/** A HubSpot-shaped page. `after` is HubSpot's cursor param. */
const page = (ids: readonly string[], after: string | null) =>
  new Response(JSON.stringify({ results: ids.map((id) => ({ id })), after }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

const parsePage = (raw: unknown) => {
  const r = raw as { results?: unknown[]; after?: string | null };
  return { items: r.results ?? [], cursor: r.after ?? null };
};

/** A read that only ever succeeds if the transport does the right thing. */
function hubspotRead(
  responses: Array<Response | (() => never)>,
  over: Record<string, unknown> = {},
) {
  const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
  let i = 0;
  const fetchImpl = (async (input: string | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    const next = responses[Math.min(i, responses.length - 1)];
    i += 1;
    if (typeof next === "function") return next();
    if (next === undefined) throw new Error("fake fetch exhausted");
    return next;
  }) as unknown as typeof fetch;

  return {
    calls,
    run: () =>
      readPages({
        provider: "hubspot" as const,
        environment: "production" as const,
        path: "/crm/v3/objects/contacts",
        accessToken: "TOKEN-DO-NOT-LEAK",
        cursorParam: "after",
        parsePage,
        fetchImpl,
        sleep: async () => {},
        ...over,
      }),
  };
}

// ── The allow-list ────────────────────────────────────────────────────────────────────────

describe("compile-time endpoint allow-list", () => {
  test("every provider has an origin for both environments, and every origin is HTTPS", () => {
    for (const p of PROVIDERS) {
      for (const env of ["sandbox", "production"] as const) {
        const origin = PROVIDER_API_ORIGINS[p][env];
        expect(origin.startsWith("https://")).toBe(true);
        expect(new URL(origin).pathname).toBe("/");
      }
    }
  });

  test("QuickBooks reads are query/report only — no entity path an accounting write could ride", () => {
    // The scope grants writes and there is no read-only alternative, so this list IS the control.
    expect(PROVIDER_READ_PATHS.quickbooks).toEqual([
      "/v3/company/{}/query",
      "/v3/company/{}/reports/{}",
    ]);
  });

  test("a provider whose route is unsettled has an EMPTY list and can read nothing", () => {
    expect(PROVIDER_READ_PATHS.stripe).toEqual([]);
    expect(isAllowedRead("stripe", "/v1/charges")).toBe(false);
    expect(() => buildReadUrl("stripe", "production", "/v1/charges")).toThrow(/allow-list/i);
  });

  test("a template placeholder matches exactly ONE path segment", () => {
    expect(isAllowedRead("quickbooks", "/v3/company/193514/reports/ProfitAndLoss")).toBe(true);
    expect(isAllowedRead("quickbooks", "/v3/company/193514/query")).toBe(true);
    // An extra segment must not slide through the placeholder.
    expect(isAllowedRead("quickbooks", "/v3/company/193514/reports/a/b")).toBe(false);
    expect(isAllowedRead("quickbooks", "/v3/company/193514/invoice")).toBe(false);
    expect(isAllowedRead("quickbooks", "/v3/company//query")).toBe(false);
  });

  test("one provider's allow-listed path is not another's", () => {
    expect(isAllowedRead("hubspot", "/crm/v3/objects/contacts")).toBe(true);
    expect(isAllowedRead("paypal", "/crm/v3/objects/contacts")).toBe(false);
    expect(isAllowedRead("paypal", "/v1/reporting/transactions")).toBe(true);
    expect(isAllowedRead("hubspot", "/v1/reporting/transactions")).toBe(false);
  });

  test("nothing that could relocate the request survives", () => {
    for (const p of [
      "https://evil.test/crm/v3/objects/contacts",
      "//evil.test/crm/v3/objects/contacts",
      "/crm/v3/objects/../../../v3/company/1/invoice",
      "/crm/v3/objects/contacts?x=1",
      "/crm/v3/objects/contacts#f",
      "crm/v3/objects/contacts",
      "/crm/v3/objects/contacts/",
    ]) {
      expect(isAllowedRead("hubspot", p)).toBe(false);
    }
  });

  test("the built URL stays on the provider's own origin for that environment", () => {
    const url = buildReadUrl(
      "quickbooks",
      "sandbox",
      "/v3/company/193514/query",
      new URLSearchParams({ query: "select * from Invoice" }),
    );
    expect(url.origin).toBe(PROVIDER_API_ORIGINS.quickbooks.sandbox);
    expect(url.pathname).toBe("/v3/company/193514/query");
    expect(url.origin).not.toBe(PROVIDER_API_ORIGINS.quickbooks.production);
  });
});

// ── Status classification ─────────────────────────────────────────────────────────────────

describe("classifyStatus", () => {
  test("2xx is not a failure", () => {
    for (const s of [200, 201, 204, 299]) expect(classifyStatus(s)).toBeNull();
  });

  test("each status maps to its own class, and only 429/5xx are retriable", () => {
    expect(classifyStatus(401)).toEqual({ failureClass: "reauth", retriable: false });
    expect(classifyStatus(403)).toEqual({ failureClass: "forbidden", retriable: false });
    expect(classifyStatus(429)).toEqual({ failureClass: "rate_limited", retriable: true });
    expect(classifyStatus(500)).toEqual({ failureClass: "provider_error", retriable: true });
    expect(classifyStatus(503)).toEqual({ failureClass: "provider_error", retriable: true });
    expect(classifyStatus(400)).toEqual({ failureClass: "provider_error", retriable: false });
    expect(classifyStatus(404)).toEqual({ failureClass: "provider_error", retriable: false });
  });

  test("a redirect is a failure, never a hop — following one would carry the token off-origin", () => {
    expect(classifyStatus(302)).toEqual({ failureClass: "provider_error", retriable: false });
  });
});

describe("retryDelayMs", () => {
  test("honours Retry-After when it is inside the budget", () => {
    expect(retryDelayMs(0, "2")).toBe(2000);
  });

  test("a Retry-After beyond the budget means DO NOT RETRY, not retry sooner", () => {
    // Intuit documents "wait 60 s" on a 429. An action cannot sleep that long, and hammering the
    // provider before its window is how a rate limit becomes a ban.
    expect(retryDelayMs(0, "60")).toBeNull();
    expect(retryDelayMs(0, String(MAX_RETRY_DELAY_MS / 1000 + 1))).toBeNull();
  });

  test("backs off within the budget when the provider says nothing", () => {
    for (let attempt = 0; attempt < MAX_RETRIES; attempt += 1) {
      const d = retryDelayMs(attempt, null);
      expect(d).not.toBeNull();
      expect(d).toBeGreaterThan(0);
      expect(d).toBeLessThanOrEqual(MAX_RETRY_DELAY_MS);
    }
  });

  test("an unparseable Retry-After falls back to backoff rather than to zero", () => {
    const d = retryDelayMs(0, "Wed, 21 Oct 2026 07:28:00 GMT");
    expect(d).not.toBeNull();
    expect(d).toBeGreaterThan(0);
  });
});

// ── The request itself ────────────────────────────────────────────────────────────────────

describe("readPages issues one kind of request and only one", () => {
  test("GET, bearer auth, an abort signal, and redirects refused", async () => {
    const h = hubspotRead([page(["a"], null)]);
    await h.run();
    expect(h.calls).toHaveLength(1);
    const [call] = h.calls;
    if (!call) throw new Error("no request was made");
    expect(
      call.url.startsWith(`${PROVIDER_API_ORIGINS.hubspot.production}/crm/v3/objects/contacts`),
    ).toBe(true);
    expect(call.init?.method).toBe("GET");
    expect(call.init?.body).toBeUndefined();
    // A 3xx must not be followed: undici would replay the Authorization header at the new origin.
    expect(call.init?.redirect).toBe("error");
    expect(call.init?.signal).toBeInstanceOf(AbortSignal);
    expect((call.init?.headers as Record<string, string> | undefined)?.Authorization).toBe(
      "Bearer TOKEN-DO-NOT-LEAK",
    );
  });

  test("the access token never appears in the result", async () => {
    const h = hubspotRead([page(["a"], null)]);
    const r = await h.run();
    expect(JSON.stringify(r)).not.toContain("TOKEN-DO-NOT-LEAK");
  });

  test("an unallow-listed path throws BEFORE any request is made", async () => {
    const h = hubspotRead([page(["a"], null)], { path: "/crm/v3/objects/contacts/1/associations" });
    await expect(h.run()).rejects.toThrow(/allow-list/i);
    expect(h.calls).toHaveLength(0);
  });
});

// ── The happy path ────────────────────────────────────────────────────────────────────────

describe("readPages pagination", () => {
  test("follows the cursor to the end and reports a complete read", async () => {
    const h = hubspotRead([page(["a"], "c1"), page(["b"], "c2"), page(["c"], null)]);
    const r = await h.run();
    expect(r.items).toHaveLength(3);
    expect(r.partial).toBe(false);
    expect(r.capped).toBe(false);
    expect(r.stoppedBy).toBeNull();
    expect(r.pagesRead).toBe(3);
    const [, second] = h.calls;
    if (!second) throw new Error("no second page was requested");
    expect(new URL(second.url).searchParams.get("after")).toBe("c1");
  });

  test("the caller's query params survive alongside the cursor", async () => {
    const h = hubspotRead([page(["a"], "c1"), page(["b"], null)], {
      query: new URLSearchParams({ limit: "100" }),
    });
    await h.run();
    const [, second] = h.calls;
    if (!second) throw new Error("no second page was requested");
    const q = new URL(second.url).searchParams;
    expect(q.get("limit")).toBe("100");
    expect(q.get("after")).toBe("c1");
    // One cursor, not two: the previous page's value must be replaced, not appended.
    expect(q.getAll("after")).toHaveLength(1);
  });
});

// ── Each cap refuses on its own ───────────────────────────────────────────────────────────

describe("caps — one at a time", () => {
  test("PAGE cap: items and bytes are nowhere near their limits", async () => {
    const h = hubspotRead([page(["a"], "c1"), page(["b"], "c2"), page(["c"], "c3")], {
      maxPages: 2,
    });
    const r = await h.run();
    expect(r.stoppedBy).toEqual({ kind: "cap", reason: "page_cap" });
    expect(r.pagesRead).toBe(2);
    expect(r.items).toHaveLength(2); // what was read is KEPT
    expect(r.partial).toBe(true);
    expect(r.capped).toBe(true);
  });

  test("ITEM cap: pages and bytes are nowhere near their limits", async () => {
    const h = hubspotRead([page(["a", "b", "c"], "c1"), page(["d"], null)], { maxItems: 2 });
    const r = await h.run();
    expect(r.stoppedBy).toEqual({ kind: "cap", reason: "item_cap" });
    expect(r.items).toHaveLength(2); // truncated to the cap, never over it
    expect(r.partial).toBe(true);
    expect(r.capped).toBe(true);
    expect(h.calls).toHaveLength(1); // and it stopped asking for more
  });

  test("BYTE cap: pages and items are nowhere near their limits", async () => {
    const big = page(
      Array.from({ length: 50 }, (_, i) => `id-${i}`),
      "c1",
    );
    const h = hubspotRead([big], { maxBytes: 64 });
    const r = await h.run();
    expect(r.stoppedBy).toEqual({ kind: "cap", reason: "byte_cap" });
    expect(r.partial).toBe(true);
    expect(r.capped).toBe(true);
  });

  test("BYTE cap from content-length is refused without reading the body at all", async () => {
    const body = JSON.stringify({ results: [{ id: "a" }], after: null });
    const res = new Response(body, {
      status: 200,
      headers: { "content-type": "application/json", "content-length": "9999999" },
    });
    const h = hubspotRead([res], { maxBytes: 1000 });
    const r = await h.run();
    expect(r.stoppedBy).toEqual({ kind: "cap", reason: "byte_cap" });
    expect(res.bodyUsed).toBe(false);
  });

  test("REPEATED CURSOR: no cap is anywhere near — only the loop guard can fire", async () => {
    const h = hubspotRead([page(["a"], "same"), page(["b"], "same")]);
    const r = await h.run();
    expect(r.stoppedBy).toEqual({ kind: "cap", reason: "repeated_cursor" });
    expect(r.items).toHaveLength(2);
    expect(r.partial).toBe(true);
    // A provider that keeps handing back the same cursor must not spin to the page cap.
    expect(h.calls.length).toBeLessThan(CAPS.maxPages);
  });

  test("the defaults are the repo's own code-owned caps, not a provider's page size", () => {
    expect(READ_TIMEOUT_MS).toBeGreaterThan(0);
    expect(CAPS.maxPages).toBe(20);
    expect(CAPS.maxItems).toBe(2_000);
    expect(CAPS.maxBytes).toBe(2_000_000);
  });
});

// ── Failure preserves what was already read ───────────────────────────────────────────────

describe("a later page never destroys an earlier one", () => {
  test("a 500 after two good pages keeps both and marks the read partial", async () => {
    const h = hubspotRead([
      page(["a"], "c1"),
      page(["b"], "c2"),
      new Response("boom", { status: 500 }),
    ]);
    const r = await h.run();
    expect(r.items).toHaveLength(2);
    expect(r.partial).toBe(true);
    expect(r.capped).toBe(false); // a failure is not a cap
    expect(r.stoppedBy).toEqual({ kind: "failure", failureClass: "provider_error" });
  });

  test("a 401 on the FIRST page is an empty partial, never an empty success", async () => {
    const h = hubspotRead([new Response("", { status: 401 })]);
    const r = await h.run();
    expect(r.items).toHaveLength(0);
    expect(r.partial).toBe(true);
    expect(r.stoppedBy).toEqual({ kind: "failure", failureClass: "reauth" });
  });

  test("malformed JSON is a provider_error and keeps the pages that parsed", async () => {
    const h = hubspotRead([
      page(["a"], "c1"),
      new Response("<html>maintenance</html>", { status: 200 }),
    ]);
    const r = await h.run();
    expect(r.items).toHaveLength(1);
    expect(r.stoppedBy).toEqual({ kind: "failure", failureClass: "provider_error" });
    expect(r.partial).toBe(true);
  });

  test("a network throw is `network`; an abort is `timeout`", async () => {
    const netErr = () => {
      throw new TypeError("fetch failed");
    };
    const net = await hubspotRead([netErr]).run();
    expect(net.stoppedBy).toEqual({ kind: "failure", failureClass: "network" });

    const abortErr = () => {
      const e = new Error("The operation was aborted");
      e.name = "TimeoutError";
      throw e;
    };
    const to = await hubspotRead([abortErr]).run();
    expect(to.stoppedBy).toEqual({ kind: "failure", failureClass: "timeout" });
  });
});

// ── Retry discipline ──────────────────────────────────────────────────────────────────────

describe("retry", () => {
  test("a 500 is retried and a later success is kept", async () => {
    const h = hubspotRead([new Response("", { status: 500 }), page(["a"], null)]);
    const r = await h.run();
    expect(r.items).toHaveLength(1);
    expect(r.partial).toBe(false);
    expect(r.retries).toBe(1);
    expect(h.calls).toHaveLength(2);
  });

  test("retries are capped — a permanently sick provider does not loop", async () => {
    const h = hubspotRead([new Response("", { status: 503 })]);
    const r = await h.run();
    expect(r.retries).toBe(MAX_RETRIES);
    expect(h.calls).toHaveLength(MAX_RETRIES + 1);
    expect(r.stoppedBy).toEqual({ kind: "failure", failureClass: "provider_error" });
  });

  test("a 401 is NOT retried — a second call with the same dead token is a second 401", async () => {
    const h = hubspotRead([new Response("", { status: 401 })]);
    const r = await h.run();
    expect(r.retries).toBe(0);
    expect(h.calls).toHaveLength(1);
  });

  test("a 429 whose Retry-After exceeds the budget stops rather than hammering", async () => {
    const h = hubspotRead([new Response("", { status: 429, headers: { "retry-after": "60" } })]);
    const r = await h.run();
    expect(r.retries).toBe(0);
    expect(h.calls).toHaveLength(1);
    expect(r.stoppedBy).toEqual({ kind: "failure", failureClass: "rate_limited" });
  });

  test("a 429 inside the budget is retried and honours the provider's delay", async () => {
    const slept: number[] = [];
    const h = hubspotRead(
      [new Response("", { status: 429, headers: { "retry-after": "1" } }), page(["a"], null)],
      {
        sleep: async (ms: number) => {
          slept.push(ms);
        },
      },
    );
    const r = await h.run();
    expect(slept).toEqual([1000]);
    expect(r.items).toHaveLength(1);
    expect(r.partial).toBe(false);
  });
});

// ── Structural scans ──────────────────────────────────────────────────────────────────────

describe("connectorFetch.ts structure", () => {
  test("no write verb appears anywhere in the module", () => {
    const src = source("./connectorFetch.ts");
    const code = src
      .split("\n")
      .filter((l) => !l.trimStart().startsWith("*") && !l.trimStart().startsWith("//"))
      .join("\n");
    for (const verb of ['"POST"', '"PUT"', '"PATCH"', '"DELETE"', "body:"]) {
      expect(code).not.toContain(verb);
    }
  });

  test("there is no method, origin, host or header parameter to steer", () => {
    const src = source("./connectorFetch.ts");
    const options = src.slice(src.indexOf("export type ReadPagesOptions"));
    const body = options.slice(0, options.indexOf("};"));
    for (const steerable of ["method", "origin", "host", "headers", "url"]) {
      expect(body).not.toMatch(new RegExp(`\\b${steerable}\\??:`));
    }
  });

  test("never logs and never reaches audit, telemetry or dead letters", () => {
    const src = source("./connectorFetch.ts");
    expect(src).not.toMatch(/console\./);
    expect(src).not.toMatch(/deadLetters|internal\.audit|internal\.telemetry/);
  });

  test("declares no Convex function at all — it is transport, not a public surface", () => {
    const src = source("./connectorFetch.ts");
    expect(src).not.toMatch(/(tenant|owner|internal)(Query|Mutation|Action)\(/);
  });
});
