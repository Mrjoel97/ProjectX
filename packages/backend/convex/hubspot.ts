// HubSpot bounded CRM reads — the THIN adapter (CLAUDE.md §1).
//
// Five datasets, five allow-listed GET paths, five pure parsers. This module owns none of that: it
// picks a parser from `@pikar/revenue/providers/hubspot`, hands it to `connectorFetch.readPages`
// (which hardcodes GET, refuses a redirect and enforces every code-owned cap), and turns the result
// into one bounded `Projection`. There is no write path, no request builder and no direct fetch —
// the only POST the connector plane makes lives in `connectorOAuth.postTokenForm`.
//
// WHAT MUST NEVER LEAVE HERE: a vendor payload. The parsers keep ids, timestamps, stage keys and a
// money FIGURE, and the property allow-lists mean Pikar never even ASKS HubSpot for a name, an
// email or a deal title. That is why the "no second CRM" invariant is structural rather than a
// filter someone could forget: Phase 19's contacts substrate stays the only person store, and this
// rail hands it provider refs to attach.
//
// PARTIAL IS NEVER A SMALLER COMPLETE. A 429, a 500, a page cap or a repeated cursor all come back
// as `partial` with a named reason. A capped pipeline read that presented as `ready` would let a
// downstream report say "you have 12 open deals" when the truth is "we saw 12 of an unknown number".

import { CAPS, type ConnectorEnvironment, type Projection, type SourceRef } from "@pikar/revenue";
import {
  HUBSPOT_DATASET_PATHS,
  HUBSPOT_DATASET_PROPERTIES,
  type HubSpotDataset,
  type HubSpotRow,
  hubspotProjection,
  parseCompanyPage,
  parseContactPage,
  parseDealPage,
  parseDealPipelinePage,
  parseOwnerPage,
} from "@pikar/revenue/providers/hubspot";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { type ActionCtx, internalAction } from "./_generated/server";
import { type ParsedPage, readPages } from "./connectorFetch";
import { ensureHubSpotAccessToken } from "./hubspotAuth";
import { tenantAction } from "./lib/functions";
import { emitConnectorReadEvent } from "./revenueTelemetry";

const PROVIDER = "hubspot" as const;
const DAY_MS = 86_400_000;

const environmentArg = v.union(v.literal("sandbox"), v.literal("production"));
/** Written out because a Convex validator needs its literals inline; pinned to `HUBSPOT_DATASETS`
 *  by a source scan in `hubspot.test.ts`, the same idiom `providerGates.ts` uses. */
const datasetArg = v.union(
  v.literal("contacts"),
  v.literal("companies"),
  v.literal("deals"),
  v.literal("owners"),
  v.literal("dealPipelines"),
);

/** HubSpot's own maximum for the object list endpoints. Fewer round trips inside the same cap. */
const PAGE_LIMIT = "100";

/** The default coverage window when a caller names none. 90 days of deal movement is "recent". */
export const DEFAULT_WINDOW_DAYS = 90;

/** The parser for each dataset. Exhaustive over `HubSpotDataset` by the record's own type. */
const PARSERS: Record<HubSpotDataset, (raw: unknown) => ParsedPage<HubSpotRow>> = {
  contacts: parseContactPage,
  companies: parseCompanyPage,
  deals: parseDealPage,
  owners: parseOwnerPage,
  dealPipelines: parseDealPipelinePage,
};

/**
 * Datasets whose rows carry a creation time, and can therefore be placed inside a window.
 *
 * Owners and pipelines are CONFIGURATION, not events: a pipeline definition is not "from March",
 * so filtering it by a window would silently empty the projection. They carry the requested window
 * as their coverage and are not filtered — stated here rather than left implicit, because the
 * quiet version of this decision is how a correct read starts returning nothing.
 */
const TIME_BOUNDED: ReadonlySet<HubSpotDataset> = new Set(["contacts", "companies", "deals"]);

const hasCreatedAt = (row: HubSpotRow): row is HubSpotRow & { createdAt: number } =>
  "createdAt" in row && typeof row.createdAt === "number";

export type HubSpotReadResult = {
  dataset: HubSpotDataset;
  projection: Projection<HubSpotRow>;
};

/**
 * One bounded read.
 *
 * A PLAIN FUNCTION with two thin Convex wrappers below: the browser reaches it through a
 * `tenantAction` that can only ever ask about its own tenant, and the wave-7 lane runner reaches it
 * through an `internalAction` that names one. One implementation, so the surface a smoke script
 * exercises is the surface a user gets.
 */
export async function readHubSpotDataset(
  ctx: ActionCtx,
  input: {
    tenantId: string;
    environment: ConnectorEnvironment;
    dataset: HubSpotDataset;
    windowDays?: number;
  },
): Promise<HubSpotReadResult> {
  const { tenantId, environment, dataset } = input;
  const days = Math.min(
    Math.max(Math.floor(input.windowDays ?? DEFAULT_WINDOW_DAYS), 1),
    CAPS.maxWindowDays,
  );

  const token = await ensureHubSpotAccessToken(ctx, { tenantId, environment });
  if (!token.ok) {
    // `unavailable` is a first-class answer, not an empty list. "We could not see your CRM" and
    // "your CRM is empty" are different sentences and only one of them is ever true here.
    return {
      dataset,
      projection: { state: "unavailable", provider: PROVIDER, because: token.reason },
    };
  }

  const query = new URLSearchParams({ limit: PAGE_LIMIT });
  const properties = HUBSPOT_DATASET_PROPERTIES[dataset];
  // A FIXED, compile-time property list. Never a caller argument: a `properties` parameter is how a
  // prompt-driven tool would eventually ask for `email` and get it.
  if (properties.length > 0) query.set("properties", properties.join(","));

  const read = await readPages<HubSpotRow>({
    provider: PROVIDER,
    environment,
    path: HUBSPOT_DATASET_PATHS[dataset],
    accessToken: token.accessToken,
    cursorParam: "after",
    query,
    parsePage: PARSERS[dataset],
  });

  const retrievedAt = Date.now();
  const window = { startMs: retrievedAt - days * DAY_MS, endMs: retrievedAt };
  const items = TIME_BOUNDED.has(dataset)
    ? read.items.filter((row) => hasCreatedAt(row) && row.createdAt >= window.startMs)
    : read.items;

  // Closed labels only — a cap reason or a failure class, never a provider message (CLAUDE.md §4).
  const missing: string[] = [];
  if (read.stoppedBy?.kind === "cap") missing.push(read.stoppedBy.reason);
  if (read.stoppedBy?.kind === "failure") missing.push(read.stoppedBy.failureClass);

  await ctx.runMutation(internal.connectorCredentials.recordReadOutcome, {
    tenantId,
    provider: PROVIDER,
    environment,
    ...(read.stoppedBy?.kind === "failure" ? { failureClass: read.stoppedBy.failureClass } : {}),
  });

  return {
    dataset,
    projection: hubspotProjection<HubSpotRow>({
      items,
      retrievedAt,
      window,
      capped: read.capped,
      partial: read.partial,
      missing,
    }),
  };
}

/** The browser's read. The tenant is the caller's own; there is no tenant argument to get wrong. */
export const hubspotRead = tenantAction({
  args: {
    environment: environmentArg,
    dataset: datasetArg,
    windowDays: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<HubSpotReadResult> => {
    const result = await readHubSpotDataset(ctx, { ...args, tenantId: ctx.tenantId });
    await emitConnectorReadEvent(ctx, ctx.tenantId, "hubspot", result.projection);
    return result;
  },
});

/**
 * The sanitized shape the smoke script records as lane evidence: counts, states and closed labels.
 * REFS ARE CAPPED AND HASHED-BY-ABSENCE — the source ids are already opaque provider ids, and
 * nothing here can carry a customer name because nothing upstream ever fetched one.
 */
export type HubSpotReadEvidence = {
  dataset: HubSpotDataset;
  state: Projection<HubSpotRow>["state"];
  itemCount: number;
  capped: boolean;
  missing: string | null;
  retrievedAt: number | null;
  sampleRefs: readonly SourceRef[];
};

/** Evidence for one dataset, in the shape `--verify-evidence` validates. */
export const hubspotReadEvidence = internalAction({
  args: { tenantId: v.string(), environment: environmentArg, dataset: datasetArg },
  handler: async (ctx, args): Promise<HubSpotReadEvidence> => {
    const { dataset, projection } = await readHubSpotDataset(ctx, args);
    if (projection.state === "unavailable") {
      return {
        dataset,
        state: "unavailable",
        itemCount: 0,
        capped: false,
        missing: projection.because,
        retrievedAt: null,
        sampleRefs: [],
      };
    }
    return {
      dataset,
      state: projection.state,
      itemCount: projection.items.length,
      capped: projection.meta.capped,
      missing: projection.state === "partial" ? projection.missing : null,
      retrievedAt: projection.meta.retrievedAt,
      // THREE, not all: evidence is a proof of shape, not a copy of the tenant's CRM.
      sampleRefs: projection.meta.sources.slice(0, 3),
    };
  },
});
