/**
 * HubSpot, the PURE half (28-05). No Convex, no network, no LLM (CLAUDE.md §1).
 *
 * Everything here is a constant, a URL/body builder, or a total function from a raw vendor page to
 * a BOUNDED projection. The transport lives in `convex/connectorFetch.ts` (GET-only, allow-listed)
 * and the credential lifecycle in `convex/connectorCredentials.ts`; this module invents neither.
 *
 * THE ONE RULE THIS FILE ENFORCES STRUCTURALLY: HubSpot must not become a second CRM. It does that
 * not with a filter at the end but with the `*_PROPERTIES` allow-lists at the start — Pikar never
 * ASKS HubSpot for a name, an email, a phone number or a deal title, so there is no free text in
 * the response to leak into a prompt or a React tree. Everything retained is an id, a timestamp, a
 * stage key or a money figure. Names and consent live in Phase 19's contacts substrate, which this
 * rail attaches provider refs to and never duplicates.
 *
 * EVIDENCE. Scope strings, the date-versioned OAuth endpoints and the `crm.pipelines.*` trap are
 * recorded, with primary-source links, in `docs/connectors/hubspot-suitability.md`. Change a
 * literal here only by changing that record first.
 */
import { err, ok, type Result } from "@pikar/core/result";
import {
  CAPS,
  type CoverageWindow,
  type MoneyFigure,
  type Projection,
  type SourceRef,
  type Unresolved,
  validateSourceRef,
} from "../contracts";
import { parseMoney } from "../money";

// ── OAuth surface ─────────────────────────────────────────────────────────────────────────

/**
 * HubSpot's OAuth API is DATE-versioned, and the build-apps guide is stale relative to the API
 * reference: it still points at `/oauth/v3/token` and links refresh into the LEGACY section, while
 * the reference and the deprecation changelog present `2026-03` as current (`/oauth/v1` sunsets
 * 2027-02-16). These are pinned from the reference. The test compares them to written-out literals
 * so a rename cannot pass as a refactor.
 */
export const HUBSPOT_OAUTH_VERSION = "2026-03";
export const HUBSPOT_AUTHORIZE_URL = "https://app.hubspot.com/oauth/authorize";
export const HUBSPOT_TOKEN_URL = `https://api.hubapi.com/oauth/${HUBSPOT_OAUTH_VERSION}/token`;
/**
 * RFC 7009-shaped. NOT the legacy `DELETE /oauth/v1/refresh-tokens/{token}`, which HubSpot
 * documents verbatim as deleting the refresh token ONLY — "Access tokens generated with the
 * refresh token will not be deleted". Using it would make "disconnect" a lie.
 *
 * Whether THIS endpoint cascades to already-issued access tokens is UNDOCUMENTED, and that is the
 * provider's open condition `revoke-cascades-to-access-tokens`. Nothing in this repository may
 * assume it does; see `convex/connectorOAuth.PROVIDER_REVOKE_SUPPORT.hubspot === "unproven"`.
 */
export const HUBSPOT_REVOKE_URL = `https://api.hubapi.com/oauth/${HUBSPOT_OAUTH_VERSION}/token/revoke`;

/**
 * The exact evidenced read scopes, and nothing else. No `.write`, no import, no export, no
 * marketing-send, no workflow, no sensitive-data scope — HubSpot's read and write scopes are
 * independent strings, so a read-only install is expressible and this is it.
 *
 * THE TRAP: there is no `crm.pipelines.deals.read`. The only `crm.pipelines.*` strings are
 * `crm.pipelines.orders.*`, which are ORDER pipelines. DEAL pipelines and stages come from
 * `crm.objects.deals.read` + `crm.schemas.deals.read` together.
 */
export const HUBSPOT_READ_SCOPES = [
  "crm.objects.contacts.read",
  "crm.objects.companies.read",
  "crm.objects.deals.read",
  "crm.objects.owners.read",
  "crm.schemas.deals.read",
] as const;

/**
 * Every path this rail may GET, mirrored into `convex/connectorFetch.PROVIDER_READ_PATHS.hubspot`.
 * Two copies exist because the allow-list must be enforceable without importing a Convex module
 * into a pure package; `hubspot.test.ts` (backend) compares them so they cannot drift.
 *
 * CRM Search is deliberately absent. HubSpot's "110 requests / 10 s per installed account" limit
 * EXCLUDES the Search API, which carries its own stricter limits — so Search needs its own budget
 * and its own decision, not a quiet addition to this list.
 */
export const HUBSPOT_READ_PATHS = [
  "/crm/v3/objects/contacts",
  "/crm/v3/objects/companies",
  "/crm/v3/objects/deals",
  "/crm/v3/owners",
  "/crm/v3/pipelines/deals",
] as const;

// ── Property allow-lists ──────────────────────────────────────────────────────────────────
//
// Alphabetical so a diff is readable and an addition is obvious. Adding one is a §4 decision, not
// a convenience: every string here is a field Pikar asks a third party to hand over.

/** Timestamps and one association id. No name, no email, no phone. */
export const HUBSPOT_CONTACT_PROPERTIES = ["createdate", "lastmodifieddate"] as const;
/** Timestamps only. A company NAME is free text and is not requested. */
export const HUBSPOT_COMPANY_PROPERTIES = ["createdate", "hs_lastmodifieddate"] as const;
/** Stage keys, money, dates, an owner id. `dealname` is free text and is not requested. */
export const HUBSPOT_DEAL_PROPERTIES = [
  "amount",
  "closedate",
  "createdate",
  "deal_currency_code",
  "dealstage",
  "hs_lastmodifieddate",
  "hubspot_owner_id",
  "pipeline",
] as const;

// ── Builders ──────────────────────────────────────────────────────────────────────────────

const nonEmpty = (v: unknown): v is string => typeof v === "string" && v.trim() !== "";

/**
 * The consent URL. `state` is the one-time nonce minted by `connectorOAuth.mintConnectState` — it
 * is NOT built here, so this function cannot be tricked into signing anything.
 *
 * The redirect must be HTTPS. It comes from deployment configuration rather than a request, so
 * this is a cheap assertion rather than a boundary check, but a misconfigured `http://` redirect
 * would put an authorization code on the wire in the clear and that is worth one `if`.
 */
export function buildHubSpotAuthorizeUrl(input: {
  clientId: string;
  redirectUri: string;
  state: string;
}): string {
  if (!nonEmpty(input.clientId)) throw new Error("HubSpot authorize needs a client id.");
  if (!nonEmpty(input.state)) throw new Error("HubSpot authorize needs a one-time state.");
  if (!input.redirectUri.startsWith("https://")) {
    throw new Error("HubSpot redirect URI must be https.");
  }
  const params = new URLSearchParams({
    client_id: input.clientId,
    redirect_uri: input.redirectUri,
    // Space-joined, and REQUIRED rather than optional: an install that silently drops a scope
    // would read as an empty CRM rather than as a misconfiguration.
    scope: HUBSPOT_READ_SCOPES.join(" "),
    state: input.state,
  });
  return `${HUBSPOT_AUTHORIZE_URL}?${params.toString()}`;
}

export function tokenExchangeBody(input: {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  code: string;
}): URLSearchParams {
  return new URLSearchParams({
    grant_type: "authorization_code",
    client_id: input.clientId,
    client_secret: input.clientSecret,
    redirect_uri: input.redirectUri,
    code: input.code,
  });
}

export function tokenRefreshBody(input: {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}): URLSearchParams {
  return new URLSearchParams({
    grant_type: "refresh_token",
    client_id: input.clientId,
    client_secret: input.clientSecret,
    refresh_token: input.refreshToken,
  });
}

/** RFC 7009 shape, exactly as the `2026-03` reference documents it. */
export function revokeBody(input: {
  clientId: string;
  clientSecret: string;
  token: string;
  tokenTypeHint: "refresh_token" | "access_token";
}): URLSearchParams {
  return new URLSearchParams({
    client_id: input.clientId,
    client_secret: input.clientSecret,
    token: input.token,
    token_type_hint: input.tokenTypeHint,
  });
}

// ── Token response ────────────────────────────────────────────────────────────────────────

export type HubSpotTokens = {
  accessToken: string;
  refreshToken: string;
  expiresInSec: number;
  /**
   * The installing portal, when the response carries one. OPPORTUNISTIC BY DESIGN: no primary page
   * read in the suitability pass promises `hub_id` on the `2026-03` token response, so a missing
   * one is `null` and the account-binding check simply does not run — it is never invented, and it
   * is never satisfied by absence either (see `hubspotAuth.completeHubSpotConnect`).
   */
  hubId: string | null;
};

const asRecord = (raw: unknown): Record<string, unknown> | null =>
  typeof raw === "object" && raw !== null && !Array.isArray(raw)
    ? (raw as Record<string, unknown>)
    : null;

export function parseTokenResponse(raw: unknown): Result<HubSpotTokens, string> {
  const body = asRecord(raw);
  if (body === null) return err("HubSpot token response was not an object.");
  const { access_token, refresh_token, expires_in, hub_id } = body;
  if (!nonEmpty(access_token)) return err("HubSpot token response carried no access token.");
  if (!nonEmpty(refresh_token)) return err("HubSpot token response carried no refresh token.");
  if (typeof expires_in !== "number" || !Number.isFinite(expires_in) || expires_in <= 0) {
    return err("HubSpot token response carried no usable expiry.");
  }
  const hubId =
    typeof hub_id === "number" && Number.isFinite(hub_id)
      ? String(hub_id)
      : nonEmpty(hub_id)
        ? hub_id.trim()
        : null;
  return ok({
    accessToken: access_token,
    refreshToken: refresh_token,
    expiresInSec: expires_in,
    hubId,
  });
}

// ── Normalized rows ───────────────────────────────────────────────────────────────────────

/** A HubSpot contact, as a REFERENCE. Identity belongs to Phase 19; this only points at it. */
export type HubSpotContact = { ref: SourceRef; createdAt: number; updatedAt: number | null };
export type HubSpotCompany = { ref: SourceRef; createdAt: number; updatedAt: number | null };

export type HubSpotDeal = {
  ref: SourceRef;
  /** The pipeline's opaque id. Never its label. */
  pipelineId: string | null;
  /** The stage's opaque id. Never its label, and never mapped onto an invented stage enum. */
  stageId: string | null;
  ownerRef: string | null;
  closeAt: number | null;
  /**
   * A FIGURE, not a number. A deal with no amount, or an amount with no currency, is `unknown` —
   * never zero. `authority` on the projection is `supplemental`, so this is colour and must never
   * be summed into a revenue total (see `contracts.SOURCE_AUTHORITIES`).
   */
  amount: MoneyFigure;
  createdAt: number;
  updatedAt: number | null;
};

export type HubSpotPipelineStage = {
  stageId: string;
  displayOrder: number | null;
  /** `null` when HubSpot's stage metadata does not say. Unknown is not "open". */
  closed: boolean | null;
};
export type HubSpotPipeline = { ref: SourceRef; stages: readonly HubSpotPipelineStage[] };

/** An owner id and nothing else. A HubSpot owner record is a PERSON — name and email stay there. */
export type HubSpotOwner = { ref: SourceRef };

export type HubSpotRow =
  | HubSpotContact
  | HubSpotCompany
  | HubSpotDeal
  | HubSpotPipeline
  | HubSpotOwner;

/** One page as `connectorFetch.readPages` consumes it. Structural, so neither package imports the other. */
export type HubSpotPage<T> = { items: readonly T[]; cursor: string | null };

/** Stages retained per pipeline. A pipeline with more than this is misconfigured, not interesting. */
export const MAX_STAGES_PER_PIPELINE = 50;

const unknownMoney = (needs: string): Unresolved => ({ state: "unknown", needs });

/**
 * `results` or nothing. THROWS on an unrecognised shape rather than returning an empty page —
 * `readPages` turns a throw into `provider_error` + `partial`, while an empty page would be read
 * downstream as "this tenant has no deals". Missing history is unknown, never zero.
 */
function resultsOf(raw: unknown, what: string): readonly unknown[] {
  const body = asRecord(raw);
  const results = body?.results;
  if (!Array.isArray(results)) throw new Error(`HubSpot ${what} page had no results array.`);
  return results;
}

/** `paging.next.after`, or null at the end of the list. The `link` is a full URL and is ignored. */
function cursorOf(raw: unknown): string | null {
  const next = asRecord(asRecord(raw)?.paging)?.next;
  const after = asRecord(next)?.after;
  return nonEmpty(after) ? after : null;
}

/**
 * A vendor id as a validated `SourceRef`, or null.
 *
 * A row whose id will not survive `validateSourceRef` is DROPPED, not repaired: an id carrying a
 * quote or a newline is either not an id or is content wearing one, and both belong outside a
 * structure that ends up in audit refs (CLAUDE.md §4).
 */
function refOf(raw: unknown, kind: string): SourceRef | null {
  const id = asRecord(raw)?.id;
  if (!nonEmpty(id)) return null;
  const ref: SourceRef = { provider: "hubspot", kind, id };
  return validateSourceRef(ref).ok ? ref : null;
}

/** An ISO-8601 timestamp or an epoch-milliseconds string, as ms. `null` for anything else. */
function msOf(raw: unknown): number | null {
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (!nonEmpty(raw)) return null;
  const parsed = Date.parse(raw);
  if (Number.isFinite(parsed)) return parsed;
  const epoch = Number(raw);
  return Number.isFinite(epoch) ? epoch : null;
}

const propsOf = (raw: unknown): Record<string, unknown> =>
  asRecord(asRecord(raw)?.properties) ?? {};

/**
 * `createdAt`/`updatedAt` from the envelope, falling back to the requested date properties. A row
 * with no usable creation time is dropped by the callers: a timestamp is what puts it inside or
 * outside a coverage window, and a row that cannot be placed cannot be honestly counted.
 */
function timestamps(
  raw: unknown,
  createdProp: string,
  updatedProp: string,
): { createdAt: number; updatedAt: number | null } | null {
  const props = propsOf(raw);
  const createdAt = msOf(asRecord(raw)?.createdAt) ?? msOf(props[createdProp]);
  if (createdAt === null) return null;
  return { createdAt, updatedAt: msOf(asRecord(raw)?.updatedAt) ?? msOf(props[updatedProp]) };
}

export function parseContactPage(raw: unknown): HubSpotPage<HubSpotContact> {
  const items: HubSpotContact[] = [];
  for (const row of resultsOf(raw, "contact")) {
    const ref = refOf(row, "contact");
    const at = timestamps(row, "createdate", "lastmodifieddate");
    if (ref !== null && at !== null) items.push({ ref, ...at });
  }
  return { items, cursor: cursorOf(raw) };
}

export function parseCompanyPage(raw: unknown): HubSpotPage<HubSpotCompany> {
  const items: HubSpotCompany[] = [];
  for (const row of resultsOf(raw, "company")) {
    const ref = refOf(row, "company");
    const at = timestamps(row, "createdate", "hs_lastmodifieddate");
    if (ref !== null && at !== null) items.push({ ref, ...at });
  }
  return { items, cursor: cursorOf(raw) };
}

export function parseDealPage(raw: unknown): HubSpotPage<HubSpotDeal> {
  const items: HubSpotDeal[] = [];
  for (const row of resultsOf(raw, "deal")) {
    const ref = refOf(row, "deal");
    const at = timestamps(row, "createdate", "hs_lastmodifieddate");
    if (ref === null || at === null) continue;
    const props = propsOf(row);
    // Both halves must be present. HubSpot's portal currency is a PORTAL setting we did not read,
    // so defaulting to USD here would fabricate a currency for every non-US tenant.
    const amountRaw = props.amount;
    const currencyRaw = props.deal_currency_code;
    let amount: MoneyFigure;
    if (!nonEmpty(amountRaw)) {
      amount = unknownMoney("HubSpot reported no amount on this deal.");
    } else if (!nonEmpty(currencyRaw)) {
      amount = unknownMoney("HubSpot reported an amount with no currency code.");
    } else {
      const money = parseMoney(amountRaw, currencyRaw);
      amount = money.ok
        ? { state: "known", origin: "observed", value: money.value }
        : unknownMoney("HubSpot reported an amount this rail could not read as money.");
    }
    items.push({
      ref,
      ...at,
      pipelineId: nonEmpty(props.pipeline) ? props.pipeline : null,
      stageId: nonEmpty(props.dealstage) ? props.dealstage : null,
      ownerRef: nonEmpty(props.hubspot_owner_id) ? props.hubspot_owner_id : null,
      closeAt: msOf(props.closedate),
      amount,
    });
  }
  return { items, cursor: cursorOf(raw) };
}

/**
 * `GET /crm/v3/pipelines/deals`. Labels are the user's own words and are dropped; what survives is
 * the stage key, its order and whether HubSpot calls it closed. `metadata.isClosed` arrives as the
 * STRING "true"/"false" in v3, and anything else is `null` rather than `false` — a stage we cannot
 * classify is unknown, not open.
 */
export function parseDealPipelinePage(raw: unknown): HubSpotPage<HubSpotPipeline> {
  const items: HubSpotPipeline[] = [];
  for (const row of resultsOf(raw, "deal pipeline")) {
    const ref = refOf(row, "deal_pipeline");
    if (ref === null) continue;
    const rawStages = asRecord(row)?.stages;
    const stages: HubSpotPipelineStage[] = [];
    if (Array.isArray(rawStages)) {
      for (const stage of rawStages.slice(0, MAX_STAGES_PER_PIPELINE)) {
        const stageRef = refOf(stage, "deal_stage");
        if (stageRef === null) continue;
        const order = asRecord(stage)?.displayOrder;
        const isClosed = asRecord(asRecord(stage)?.metadata)?.isClosed;
        stages.push({
          stageId: stageRef.id,
          displayOrder: typeof order === "number" && Number.isFinite(order) ? order : null,
          closed:
            isClosed === true || isClosed === "true"
              ? true
              : isClosed === false || isClosed === "false"
                ? false
                : null,
        });
      }
    }
    items.push({ ref, stages });
  }
  // The pipelines endpoint returns the whole (small) set; there is no cursor to follow.
  return { items, cursor: null };
}

export function parseOwnerPage(raw: unknown): HubSpotPage<HubSpotOwner> {
  const items: HubSpotOwner[] = [];
  for (const row of resultsOf(raw, "owner")) {
    const ref = refOf(row, "owner");
    if (ref !== null) items.push({ ref });
  }
  return { items, cursor: cursorOf(raw) };
}

// ── Projection assembly ───────────────────────────────────────────────────────────────────

export const HUBSPOT_DATASETS = [
  "contacts",
  "companies",
  "deals",
  "owners",
  "dealPipelines",
] as const;
export type HubSpotDataset = (typeof HUBSPOT_DATASETS)[number];

/** The one place a dataset chooses its endpoint. Keys are exhaustive over `HubSpotDataset`. */
export const HUBSPOT_DATASET_PATHS: Record<HubSpotDataset, (typeof HUBSPOT_READ_PATHS)[number]> = {
  contacts: "/crm/v3/objects/contacts",
  companies: "/crm/v3/objects/companies",
  deals: "/crm/v3/objects/deals",
  owners: "/crm/v3/owners",
  dealPipelines: "/crm/v3/pipelines/deals",
};

/** The properties each dataset requests. Empty means "the envelope's own fields are enough". */
export const HUBSPOT_DATASET_PROPERTIES: Record<HubSpotDataset, readonly string[]> = {
  contacts: HUBSPOT_CONTACT_PROPERTIES,
  companies: HUBSPOT_COMPANY_PROPERTIES,
  deals: HUBSPOT_DEAL_PROPERTIES,
  owners: [],
  dealPipelines: [],
};

/**
 * Assemble the bounded projection.
 *
 * THE INVARIANT: `capped` implies `partial`, structurally, not by convention. A caller that passed
 * `capped: true, partial: false` gets a PARTIAL projection anyway — `validateProjection` would
 * reject the other combination, and a rail that could produce a rejected shape is a rail that will
 * one day produce it in production instead of in a test. A capped receivables-adjacent read that
 * presented as complete is exactly how "we saw everything" becomes false.
 *
 * `sources` is a bounded INDEX, capped at `CAPS.maxSources`; the items themselves carry every ref,
 * so truncating the index loses no fact and claims no coverage.
 */
export function hubspotProjection<T extends { ref: SourceRef }>(input: {
  items: readonly T[];
  retrievedAt: number;
  window: CoverageWindow;
  capped: boolean;
  partial: boolean;
  /** Closed labels — cap reasons and failure classes. NEVER a vendor message (CLAUDE.md §4). */
  missing: readonly string[];
}): Projection<T> {
  const span = input.window.endMs - input.window.startMs;
  if (!Number.isFinite(span) || span < 0 || span > CAPS.maxWindowDays * 86_400_000) {
    throw new Error("HubSpot coverage window is outside the code-owned cap.");
  }
  const meta = {
    provider: "hubspot" as const,
    // HubSpot is COLOUR, never a total (`contracts.SOURCE_AUTHORITIES`). Hardcoded so no caller
    // can promote a deal amount into accounting authority by passing an argument.
    authority: "supplemental" as const,
    retrievedAt: input.retrievedAt,
    window: input.window,
    capped: input.capped,
    sources: input.items.slice(0, CAPS.maxSources).map((i) => i.ref),
  };
  if (!input.partial && !input.capped) return { state: "ready", meta, items: input.items };
  return {
    state: "partial",
    meta,
    items: input.items,
    missing:
      input.missing.length > 0
        ? input.missing.join("; ")
        : // A partial read with no label still has to say something, or `validateProjection`
          // refuses it and the caller learns about the gap from a crash.
          "coverage incomplete",
  };
}
