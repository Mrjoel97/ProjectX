import {
  readZernioReport,
  ZERNIO_KEY,
  ZernioError,
  zernioChannels,
  zernioFailure,
  zernioGet,
} from "@pikar/core/zernio";
import { openCredential, sealCredential } from "@pikar/revenue";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { type ActionCtx, httpAction } from "./_generated/server";
import { requireCredentialKey } from "./connectorCredentials";
import { tenantAction } from "./lib/functions";
import { internalAction } from "./lib/tenantLifecycle";
import { hashZernioTicket } from "./zernio";

const scopeFor = (tenantId: string, connectionId: string) => ({
  tenantId,
  connectionId,
  provider: "zernio" as const,
  environment: "production" as const,
});
/** The capability binds an authenticated tenant before raw credentials reach this HTTP body.
 * Only the encrypted envelope crosses into Convex function arguments. */
export const connectHttp = httpAction(async (ctx, req) => {
  const origin = req.headers.get("Origin");
  let allowed: string;
  try {
    allowed = new URL(process.env.SITE_URL ?? "").origin;
  } catch {
    return new Response(null, { status: 503 });
  }
  if (!origin || origin !== allowed) return new Response(null, { status: 403 });
  const headers = {
    "Access-Control-Allow-Origin": allowed,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Cache-Control": "no-store",
    Vary: "Origin",
  };
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers });
  if (
    req.method !== "POST" ||
    req.headers.get("Content-Type")?.split(";")[0] !== "application/json"
  )
    return new Response(null, { status: 400, headers });
  let claim: { tenantId: string; connectionId: string; profileId: string } | null = null;
  try {
    const url = new URL(req.url);
    const ticket = url.searchParams.get("ticket") ?? "";
    if (
      !/^[a-f0-9]{64}$/.test(ticket) ||
      url.searchParams.getAll("ticket").length !== 1 ||
      !req.body
    )
      throw new ZernioError("invalid_response");
    claim = await ctx.runMutation(internal.zernio.claimConnect, {
      ticketHash: await hashZernioTicket(ticket),
    });
    if (!claim) return Response.json({ error: "connection_expired" }, { status: 400, headers });
    const reader = req.body.getReader();
    let body = "";
    const decoder = new TextDecoder();
    try {
      while (true) {
        const part = await reader.read();
        if (part.done) break;
        body += decoder.decode(part.value, { stream: true });
        if (body.length > 2048) {
          await reader.cancel();
          throw new ZernioError("invalid_response");
        }
      }
      body += decoder.decode();
    } finally {
      reader.releaseLock();
    }
    const input = JSON.parse(body);
    body = "";
    let key = typeof input.key === "string" ? input.key.trim() : "";
    delete input.key;
    if (!ZERNIO_KEY.test(key)) throw new ZernioError("invalid_response");
    const valid = await zernioGet(key, "auth/verify");
    if (valid.valid !== true) throw new ZernioError("reauth_required");
    const channels = zernioChannels(
      await zernioGet(key, "accounts", { profileId: claim.profileId }),
      claim.profileId,
    );
    const sealed = await sealCredential(
      await requireCredentialKey(),
      scopeFor(claim.tenantId, claim.connectionId),
      JSON.stringify({ key }),
    );
    key = "";
    const accepted = await ctx.runMutation(internal.zernio.completeConnect, {
      tenantId: claim.tenantId,
      connectionId: claim.connectionId,
      ciphertextB64: sealed.ciphertextB64,
      ivB64: sealed.ivB64,
      keyVersion: sealed.keyVersion,
      channels,
    });
    return Response.json(accepted ? { connected: true } : { error: "connection_expired" }, {
      status: accepted ? 200 : 400,
      headers,
    });
  } catch (error) {
    const failure = zernioFailure(error);
    if (claim) {
      try {
        await ctx.runMutation(internal.zernio.failConnect, {
          tenantId: claim.tenantId,
          connectionId: claim.connectionId,
          failure,
        });
      } catch {
        /* Erasure or a newer connection owns the row now. */
      }
    }
    return Response.json({ error: failure }, { status: 400, headers });
  }
});

async function refresh(
  ctx: ActionCtx,
  tenantId: string,
  connectionId: string,
  revision: number,
): Promise<{ state: string }> {
  const lease = crypto.randomUUID();
  const row = await ctx.runMutation(internal.zernio.claimReport, {
    tenantId,
    connectionId,
    revision,
    lease,
  });
  if (!row) return { state: "not_due_or_connection_changed" };
  try {
    if (!row.ciphertextB64 || !row.ivB64 || !row.keyVersion)
      throw new ZernioError("reauth_required");
    const raw = await openCredential(
      await requireCredentialKey(row.keyVersion),
      scopeFor(tenantId, connectionId),
      {
        ciphertextB64: row.ciphertextB64,
        ivB64: row.ivB64,
        keyVersion: row.keyVersion,
        algorithm: "AES-256-GCM",
      },
    );
    const grant = JSON.parse(raw);
    if (typeof grant.key !== "string" || !ZERNIO_KEY.test(grant.key))
      throw new ZernioError("reauth_required");
    const current = await ctx.runQuery(internal.zernio.connection, { tenantId });
    if (
      !current ||
      current.connectionId !== connectionId ||
      current.revision !== revision ||
      current.status !== "connected"
    )
      return { state: "connection_changed" };
    const { channels, report } = await readZernioReport(
      grant.key,
      row.profileId,
      row.selectedAccountIds,
    );
    delete grant.key;
    const accepted = await ctx.runMutation(internal.zernio.finishReport, {
      tenantId,
      connectionId,
      revision,
      lease,
      channels,
      report,
    });
    return { state: accepted ? "updated" : "connection_changed" };
  } catch (error) {
    const failure = zernioFailure(error);
    await ctx.runMutation(internal.zernio.finishReport, {
      tenantId,
      connectionId,
      revision,
      lease,
      failure,
    });
    return { state: failure };
  }
}
export const refreshReport = tenantAction({
  args: {},
  handler: async (ctx): Promise<{ state: string }> => {
    const row = await ctx.runQuery(internal.zernio.connection, { tenantId: ctx.tenantId });
    if (!row || row.status !== "connected") return { state: "connect_zernio" };
    return refresh(ctx, ctx.tenantId, row.connectionId, row.revision);
  },
});
export const refreshScheduled = internalAction({
  args: { tenantId: v.string(), connectionId: v.string(), revision: v.number() },
  handler: async (ctx, a): Promise<{ state: string }> =>
    refresh(ctx, a.tenantId, a.connectionId, a.revision),
});
