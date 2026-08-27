// Phase 28 bounded provider READ transport — the shared failure semantics, not a connector client.
//
// This module exists because the four provider adapters (28-05..28-08) would otherwise each
// re-invent pagination, retry and "what does a 429 mean" — and the third one would get it slightly
// wrong. It is deliberately NOT a generic HTTP client:
//
//   • THERE IS NO METHOD, ORIGIN, HOST, HEADER OR BODY PARAMETER. A caller picks a provider, an
//     environment and a path from a COMPILE-TIME allow-list; everything else is fixed here. For
//     QuickBooks this is the entire containment story: `com.intuit.quickbooks.accounting` is the
//     only Accounting-API scope, it grants WRITES, and Intuit publishes no read-only alternative
//     (docs/connectors/quickbooks-suitability.md, carried-forward item 1). The allow-list is what
//     stands between a stolen access token and a journal entry, so it is a closed literal table and
//     path matching is whole-segment equality — never `includes`, never a prefix.
//   • A CAP IS NEVER A COMPLETE ANSWER. Hitting a page/item/byte cap, spinning on a repeated
//     cursor, or losing page three of four returns what was actually read with `partial: true`.
//     Missing history is unknown, never zero: a capped receivables read that presented as complete
//     would silently understate what a tenant is owed.
//   • NOTHING VENDOR-SHAPED LEAVES. No console, no audit, no dead letter, no telemetry. A provider
//     error message is vendor text that can embed a customer name or an invoice memo, so only the
//     closed `ConnectionFailureClass` travels (CLAUDE.md §4).
//
// Not "use node" and not a Convex function: it is a plain async helper an adapter action calls.
import {
  CAPS,
  type ConnectionFailureClass,
  type ConnectorEnvironment,
  type Provider,
} from "@pikar/revenue";

// ── The compile-time allow-list ───────────────────────────────────────────────────────────

/**
 * Where each provider's API lives, per environment. Bare origins, no trailing slash, HTTPS only.
 *
 * HubSpot and Stripe serve both environments from one host (a HubSpot sandbox is a separate portal,
 * a Stripe test mode is a separate key) — the shape stays uniform so a caller can never forget to
 * pass an environment and silently land in production.
 */
export const PROVIDER_API_ORIGINS: Record<Provider, Record<ConnectorEnvironment, string>> = {
  hubspot: {
    sandbox: "https://api.hubapi.com",
    production: "https://api.hubapi.com",
  },
  quickbooks: {
    sandbox: "https://sandbox-quickbooks.api.intuit.com",
    production: "https://quickbooks.api.intuit.com",
  },
  stripe: {
    sandbox: "https://api.stripe.com",
    production: "https://api.stripe.com",
  },
  paypal: {
    sandbox: "https://api-m.sandbox.paypal.com",
    production: "https://api-m.paypal.com",
  },
};

/**
 * Every path any provider adapter may ever GET. `{}` is a placeholder for exactly ONE non-empty
 * path segment (a QuickBooks realm id, a report name) — it is not a wildcard and it cannot swallow
 * a `/`.
 *
 * Adding an entry here is a security change, not a feature change. The rule for extending it is in
 * docs/playbooks/revenue-connectors.md: the path must be a documented READ, it must be listed
 * whole (no prefixes), and for QuickBooks it must stay inside `query` and `reports` because every
 * other Accounting-API path has a write sibling reachable with the same token.
 */
export const PROVIDER_READ_PATHS: Record<Provider, readonly string[]> = {
  // Supplemental only — deal stages are colour, never a total.
  hubspot: ["/crm/v3/objects/deals", "/crm/v3/objects/contacts"],
  // Query and reports ONLY. No entity path, because `/v3/company/{}/invoice` is also the CREATE
  // route and the scope that reads it can write it.
  quickbooks: ["/v3/company/{}/query", "/v3/company/{}/reports/{}"],
  // EMPTY BY DECISION, not by omission. The Stripe route is an unbuilt Stripe App with `*_read`
  // permissions and its server-initiated revocation condition is still open
  // (docs/connectors/stripe-suitability.md). 28-07 lands the concrete paths when the route is
  // settled; until then Stripe can read nothing and every call fails closed.
  stripe: [],
  // The only two endpoints PayPal publishes for this data.
  paypal: ["/v1/reporting/transactions", "/v1/reporting/balances"],
};

/**
 * Legal characters in one path segment. Deliberately excludes `%`: a percent-encoded `%2f` is the
 * classic way to smuggle a second segment past a segment-wise matcher, and no real provider id or
 * report name needs one.
 */
const SEGMENT_CHARS = /^[A-Za-z0-9._-]+$/;

const isSafeSegment = (segment: string): boolean =>
  SEGMENT_CHARS.test(segment) && !/^\.+$/.test(segment);

/** Whole-segment equality against one template. Never a prefix or substring match. */
function matchesTemplate(template: string, segments: readonly string[]): boolean {
  const expected = template.slice(1).split("/");
  if (expected.length !== segments.length) return false;
  return expected.every((seg, i) => seg === "{}" || seg === segments[i]);
}

/**
 * Is this exact path a documented read for this provider?
 *
 * Everything that could relocate the request dies before the table is consulted: an absolute URL,
 * a protocol-relative `//host`, a backslash, a query string, a fragment, a traversal segment, an
 * empty segment and a trailing slash. What survives is a list of plain segments compared one by
 * one for equality.
 */
export function isAllowedRead(provider: Provider, path: string): boolean {
  if (typeof path !== "string") return false;
  if (!path.startsWith("/") || path.startsWith("//")) return false;
  if (path.includes("?") || path.includes("#") || path.includes("\\")) return false;
  const segments = path.slice(1).split("/");
  if (!segments.every(isSafeSegment)) return false;
  const templates = PROVIDER_READ_PATHS[provider];
  if (templates === undefined) return false;
  return templates.some((template) => matchesTemplate(template, segments));
}

/**
 * The only way a request URL is ever constructed. Throws rather than returning a fallback: a read
 * that cannot be proven allowed must not happen at all, and a caller that swallowed a `null` would
 * turn a refused endpoint into a silent empty result.
 */
export function buildReadUrl(
  provider: Provider,
  environment: ConnectorEnvironment,
  path: string,
  query?: URLSearchParams,
): URL {
  if (!isAllowedRead(provider, path)) {
    throw new Error(`This path is not on the ${provider} read allow-list.`);
  }
  const target = new URL(PROVIDER_API_ORIGINS[provider][environment]);
  target.pathname = path;
  if (query !== undefined) {
    for (const [key, value] of query) target.searchParams.append(key, value);
  }
  return target;
}

// ── Bounds owned by this repo ─────────────────────────────────────────────────────────────

/** One attempt's wall clock. Intuit times a request out at 120 s; a Convex action cannot wait. */
export const READ_TIMEOUT_MS = 20_000;

/** Retries per READ, not per page. A sick provider costs three calls total, not three per page. */
export const MAX_RETRIES = 2;

/**
 * The retry budget. A `Retry-After` longer than this means STOP, not "retry sooner" — Intuit
 * documents "wait 60 s" on a 429, an action cannot sleep that long, and calling back inside the
 * provider's stated window is how a rate limit becomes a suspension.
 */
export const MAX_RETRY_DELAY_MS = 2_000;

/** First backoff step; doubled per attempt and jittered, then clamped to the budget above. */
const BACKOFF_BASE_MS = 250;

// ── Classification ────────────────────────────────────────────────────────────────────────

export type StatusFailure = { failureClass: ConnectionFailureClass; retriable: boolean };

/**
 * An HTTP status as one of the closed connection failure classes, or `null` for success.
 *
 * A 3xx lands in the default arm on purpose. `redirect: "error"` already refuses to follow one at
 * the transport level, because undici would replay the `Authorization` header at whatever origin
 * the provider named — so a redirect is a failure to report, never a hop to take.
 */
export function classifyStatus(status: number): StatusFailure | null {
  if (status >= 200 && status < 300) return null;
  if (status === 401) return { failureClass: "reauth", retriable: false };
  if (status === 403) return { failureClass: "forbidden", retriable: false };
  if (status === 429) return { failureClass: "rate_limited", retriable: true };
  if (status >= 500) return { failureClass: "provider_error", retriable: true };
  return { failureClass: "provider_error", retriable: false };
}

/**
 * How long to wait before attempt `attempt + 1`, or `null` for "do not retry".
 *
 * A numeric `Retry-After` is honoured exactly when it fits the budget. The HTTP-date form is legal
 * and unparseable here, so it falls back to backoff rather than to zero — a bad parse must never
 * become an immediate retry.
 */
export function retryDelayMs(attempt: number, retryAfter: string | null): number | null {
  if (retryAfter !== null && retryAfter.trim() !== "") {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds) && seconds >= 0) {
      const ms = seconds * 1000;
      return ms > MAX_RETRY_DELAY_MS ? null : ms;
    }
  }
  const step = BACKOFF_BASE_MS * 2 ** attempt;
  const jittered = step + Math.floor(Math.random() * BACKOFF_BASE_MS);
  return Math.min(jittered, MAX_RETRY_DELAY_MS);
}

// ── The read ──────────────────────────────────────────────────────────────────────────────

/** What a provider adapter extracts from one raw page. Items are already the adapter's own type. */
export type ParsedPage<T> = { items: readonly T[]; cursor: string | null };

/** Why a read stopped short of the provider's own end-of-list. */
export type CapReason = "page_cap" | "item_cap" | "byte_cap" | "repeated_cursor";

export type StoppedBy =
  | { kind: "cap"; reason: CapReason }
  | { kind: "failure"; failureClass: ConnectionFailureClass };

export type ReadPagesOptions<T> = {
  provider: Provider;
  environment: ConnectorEnvironment;
  /** Must be on `PROVIDER_READ_PATHS[provider]`; anything else throws before a request happens. */
  path: string;
  /** Held for the duration of the read and never returned, logged or stored. */
  accessToken: string;
  /** The provider's own pagination parameter name (`after`, `page_token`, `start_position`). */
  cursorParam: string;
  /** Fixed search parameters for every page. The cursor is layered on top, replacing not adding. */
  query?: URLSearchParams;
  /** Adapter-owned shape extraction. Throwing here is reported as a provider error. */
  parsePage: (raw: unknown) => ParsedPage<T>;
  /** Test seam only. Production passes nothing and gets the platform fetch. */
  fetchImpl?: typeof fetch;
  /** Test seam only, so retry timing is asserted without waiting. */
  sleep?: (ms: number) => Promise<void>;
  maxPages?: number;
  maxItems?: number;
  maxBytes?: number;
};

export type ReadPagesResult<T> = {
  /** Everything successfully read, in order. Never discarded because a later page failed. */
  items: readonly T[];
  pagesRead: number;
  retries: number;
  /** True whenever `stoppedBy` is set: the caller saw a PREFIX of reality, not all of it. */
  partial: boolean;
  /** A code-owned bound fired, as opposed to the provider failing. Always implies `partial`. */
  capped: boolean;
  stoppedBy: StoppedBy | null;
};

type AttemptFailure = {
  kind: "failure";
  failureClass: ConnectionFailureClass;
  retriable: boolean;
  retryAfter: string | null;
};

type Attempt<T> =
  | { kind: "page"; page: ParsedPage<T>; bytes: number }
  | AttemptFailure
  | { kind: "cap"; reason: CapReason };

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

const failed = (
  failureClass: ConnectionFailureClass,
  retriable: boolean,
  retryAfter: string | null = null,
): AttemptFailure => ({ kind: "failure", failureClass, retriable, retryAfter });

async function fetchOnce<T>(
  target: URL,
  accessToken: string,
  parsePage: (raw: unknown) => ParsedPage<T>,
  fetchImpl: typeof fetch,
  byteBudget: number,
): Promise<Attempt<T>> {
  let response: Response;
  try {
    response = await fetchImpl(target.toString(), {
      method: "GET",
      redirect: "error",
      signal: AbortSignal.timeout(READ_TIMEOUT_MS),
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
      },
    });
  } catch (error) {
    const name = (error as { name?: unknown } | null)?.name;
    // A blown deadline is not a blip: the attempt already spent the whole budget, so retrying it
    // just spends it again. A transport error might be a blip, so that one is retriable.
    const timedOut = name === "TimeoutError" || name === "AbortError";
    return failed(timedOut ? "timeout" : "network", !timedOut);
  }

  const status = classifyStatus(response.status);
  if (status !== null) {
    return failed(status.failureClass, status.retriable, response.headers.get("retry-after"));
  }

  // Refuse an oversized page on its declared length, BEFORE the body is touched. Buffering two
  // megabytes only to discard them is the cap failing open on memory.
  const declared = response.headers.get("content-length");
  if (declared !== null) {
    const declaredBytes = Number(declared);
    if (Number.isFinite(declaredBytes) && declaredBytes > byteBudget) {
      return { kind: "cap", reason: "byte_cap" };
    }
  }

  let text: string;
  try {
    text = await response.text();
  } catch {
    return failed("network", false);
  }

  const bytes = new TextEncoder().encode(text).length;
  if (bytes > byteBudget) return { kind: "cap", reason: "byte_cap" };

  try {
    return { kind: "page", page: parsePage(JSON.parse(text)), bytes };
  } catch {
    // A maintenance HTML page served as 200, or a shape the adapter does not recognise. Not
    // retried: the same request returns the same non-JSON. The text itself never leaves here.
    return failed("provider_error", false);
  }
}

/**
 * Walk a provider's cursor pagination under every bound this repo owns.
 *
 * The contract downstream depends on: PAGES ALREADY READ ARE NEVER DISCARDED. A 500 on page three
 * returns pages one and two with `partial: true`, so a projection can report honest coverage
 * instead of choosing between a lie and nothing.
 */
export async function readPages<T>(options: ReadPagesOptions<T>): Promise<ReadPagesResult<T>> {
  const {
    provider,
    environment,
    path,
    accessToken,
    cursorParam,
    query,
    parsePage,
    fetchImpl = fetch,
    sleep = defaultSleep,
    maxPages = CAPS.maxPages,
    maxItems = CAPS.maxItems,
    maxBytes = CAPS.maxBytes,
  } = options;

  const items: T[] = [];
  const seenCursors = new Set<string>();
  let cursor: string | null = null;
  let pagesRead = 0;
  let retries = 0;
  let bytesRead = 0;
  let stoppedBy: StoppedBy | null = null;

  while (pagesRead < maxPages) {
    const params = new URLSearchParams(query);
    // `set`, not `append`: the previous page's cursor must be replaced or the provider sees two.
    if (cursor !== null) params.set(cursorParam, cursor);
    const target = buildReadUrl(provider, environment, path, params);

    const budget = maxBytes - bytesRead;
    let attempt = await fetchOnce(target, accessToken, parsePage, fetchImpl, budget);
    while (attempt.kind === "failure" && attempt.retriable && retries < MAX_RETRIES) {
      const delay = retryDelayMs(retries, attempt.retryAfter);
      if (delay === null) break;
      retries += 1;
      await sleep(delay);
      attempt = await fetchOnce(target, accessToken, parsePage, fetchImpl, budget);
    }

    if (attempt.kind === "failure") {
      stoppedBy = { kind: "failure", failureClass: attempt.failureClass };
      break;
    }
    if (attempt.kind === "cap") {
      stoppedBy = { kind: "cap", reason: attempt.reason };
      break;
    }

    pagesRead += 1;
    bytesRead += attempt.bytes;
    items.push(...attempt.page.items);
    if (items.length > maxItems) {
      items.length = maxItems;
      stoppedBy = { kind: "cap", reason: "item_cap" };
      break;
    }

    const next = attempt.page.cursor;
    if (next === null) {
      cursor = null;
      break;
    }
    // A provider handing back a cursor it already gave would otherwise spin to the page cap,
    // reporting a bounded read when the truth is a broken one.
    if (seenCursors.has(next)) {
      stoppedBy = { kind: "cap", reason: "repeated_cursor" };
      break;
    }
    seenCursors.add(next);
    cursor = next;
  }

  // Left the loop with more to read: that is the page cap, and it is partial like any other.
  if (stoppedBy === null && cursor !== null) {
    stoppedBy = { kind: "cap", reason: "page_cap" };
  }

  return {
    items,
    pagesRead,
    retries,
    partial: stoppedBy !== null,
    capped: stoppedBy?.kind === "cap",
    stoppedBy,
  };
}
