import { sealedIn } from "./vaultFolders";
import {
  assessMerchantSetup,
  type MerchantSetup,
  type MerchantSetupBinding,
  type MerchantSetupIssue,
  merchantSetupHash,
  parseMerchantSetupDraft,
} from "@pikar/core/merchantSetup";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { appendAudit } from "./audit";
import { tenantMutation, tenantQuery } from "./lib/functions";
import { assertTenantWritable } from "./lib/tenantLifecycle";
import { configureAutomationForTenant, merchantProductConfigRef } from "./merchantCommerce";
import { bindDigitalDeliveryForTenant } from "./merchantOperations";
import { onlinePresenceShopContext } from "./onlinePresence";
import { createProductForTenant, updateProductForSetup } from "./tenantCatalogue";
import { configurePolicyForTenant, mapProductForTenant } from "./tenantOrders";

/** Closed public read shape keeps generated API types independent of private transaction inference. */
export type ShopSetupReview = {
  planId: Id<"plans">;
  expectedRevision: number;
  projectId: Id<"webProjects"> | null;
  version: number | null;
  contentHash: string | null;
  catalogueItems: { id: string; name: string }[];
  inventoryReview: {
    catalogueItemId: string;
    action: "preserve" | "set";
    currentOnHand: number | null;
    requestedOnHand: number | null;
  }[];
  ready: boolean;
  missing: MerchantSetupIssue[];
  setup: MerchantSetup | null;
  packageHash: string | null;
  approval: {
    packageHash: string;
    version: number;
    productIds: string[];
    policyRevision: number;
    automationRevision: number;
    current: boolean;
  } | null;
};

type Ctx = MutationCtx | QueryCtx;
const EVENT = "online_presence.shop_setup_approved";
const ACTOR = "online-presence-shop-owner-review";
const correlation = (planId: string) => `online-presence-shop:${planId}`;
const record = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
function catalogue(document: unknown): unknown[] {
  if (!record(document) || !Array.isArray(document.pages)) return [];
  const items: unknown[] = [];
  const visit = (nodes: unknown[], depth = 0) => {
    if (depth > 8) throw Error("SHOP_SETUP_CATALOGUE_INVALID");
    for (const node of nodes)
      if (record(node)) {
        if (node.kind === "catalogue" && Array.isArray(node.items)) items.push(...node.items);
        if (Array.isArray(node.children)) visit(node.children, depth + 1);
      }
  };
  for (const page of document.pages)
    if (record(page) && Array.isArray(page.nodes)) visit(page.nodes);
  return items;
}
async function approvalFor(ctx: Ctx, tenantId: string, planId: string) {
  const rows = await ctx.db
    .query("audit")
    .withIndex("by_correlation", (q) => q.eq("correlationId", correlation(planId)))
    .order("desc")
    .take(21);
  if (rows.length > 20) throw Error("SHOP_SETUP_REVIEW_HISTORY_LIMIT");
  return (
    rows.find(
      (row) => row.tenantId === tenantId && row.eventType === EVENT && row.actor === ACTOR,
    ) ?? null
  );
}
const missing = (field: string, question: string): MerchantSetupIssue => ({
  field,
  reason: "missing",
  question,
});

/** One authority path for both review and commit. No model-supplied tenant, hashes or approval flag. */
async function review(ctx: Ctx, tenantId: string, planId: Id<"plans">) {
  const { session, sources } = await onlinePresenceShopContext(ctx, tenantId, planId);
  const base = {
    planId,
    expectedRevision: session.revision,
    projectId: session.projectId ?? null,
    version: session.projectVersion ?? null,
    contentHash: session.projectContentHash ?? null,
    catalogueItems: [] as { id: string; name: string }[],
    inventoryReview: [] as {
      catalogueItemId: string;
      action: "preserve" | "set";
      currentOnHand: number | null;
      requestedOnHand: number | null;
    }[],
  };
  const unavailable = (issues: MerchantSetupIssue[]) => ({
    ...base,
    ready: false as const,
    missing: issues,
    setup: null,
    packageHash: null,
    approval: null,
  });
  if (!record(session.brief) || session.brief.kind !== "shop")
    return unavailable([missing("shopSetup", "Prepare an online shop draft first.")]);
  if (!session.projectId || !session.projectVersion || !session.projectContentHash)
    return unavailable([missing("project", "Build the private catalogue before reviewing setup.")]);
  const project = await ctx.db.get(session.projectId);
  if (!project || project.tenantId !== tenantId || project.kind !== "storefront")
    throw Error("SHOP_SETUP_PROJECT_UNAVAILABLE");
  const version = await ctx.db
    .query("webProjectVersions")
    .withIndex("by_tenant_project_version", (q) =>
      q
        .eq("tenantId", tenantId)
        .eq("projectId", project._id)
        .eq("version", session.projectVersion!),
    )
    .unique();
  if (
    !version ||
    version.contentHash !== session.projectContentHash ||
    project.draftVersion !== version.version
  )
    return unavailable([
      missing(
        "project",
        "Review the current exact private catalogue version; rebuild if it changed.",
      ),
    ]);
  const items = catalogue(version.document);
  if (
    items.length < 1 ||
    items.length > 20 ||
    merchantSetupHash(items) !== merchantSetupHash(session.brief.catalogue)
  )
    return unavailable([
      missing("catalogue", "Build the current catalogue item list before setup review."),
    ]);
  const itemIds = items.map((item) => (record(item) && typeof item.id === "string" ? item.id : ""));
  if (itemIds.includes("") || new Set(itemIds).size !== itemIds.length)
    throw Error("SHOP_SETUP_CATALOGUE_INVALID");
  base.catalogueItems = items.map((item) => ({
    id: (item as { id: string }).id,
    name: String((item as { name: unknown }).name),
  }));
  const policy = await ctx.db
    .query("tenantCommercePolicies")
    .withIndex("by_tenant_project_revision", (q) =>
      q.eq("tenantId", tenantId).eq("projectId", project._id),
    )
    .order("desc")
    .first();
  const automation = await ctx.db
    .query("tenantMerchantAutomation")
    .withIndex("by_tenant_project", (q) => q.eq("tenantId", tenantId).eq("projectId", project._id))
    .unique();
  const mappingRows = await Promise.all(
    itemIds.map(async (catalogueItemId) => {
      const row = await ctx.db
        .query("tenantCommerceMappings")
        .withIndex("by_tenant_project_item", (q) =>
          q
            .eq("tenantId", tenantId)
            .eq("projectId", project._id)
            .eq("presentationItemId", catalogueItemId),
        )
        .unique();
      return { catalogueItemId, row };
    }),
  );
  const mappings = mappingRows.map(({ catalogueItemId, row }) => ({
    catalogueItemId,
    revision: row?.revision ?? 0,
  }));
  const parsed = parseMerchantSetupDraft(session.brief.shopSetup);
  if (!parsed.value) return unavailable(parsed.missing);
  const accepted = await approvalFor(ctx, tenantId, planId);
  const acceptedPayload = record(accepted?.payload) ? accepted.payload : null;
  const stockRefs = Array.isArray(acceptedPayload?.stockConfigRefs)
    ? acceptedPayload.stockConfigRefs
    : [];
  const productStates = await Promise.all(
    mappingRows.map(async ({ catalogueItemId, row }) => {
      if (!row) return null;
      const product = await ctx.db.get(row.productId);
      const stock = await ctx.db
        .query("tenantStock")
        .withIndex("by_tenant_product", (q) =>
          q.eq("tenantId", tenantId).eq("productId", row.productId),
        )
        .unique();
      if (!product || product.tenantId !== tenantId || !stock)
        throw Error("SHOP_SETUP_PRODUCT_UNAVAILABLE");
      const desired = parsed.value!.products.find((p) => p.catalogueItemId === catalogueItemId);
      if (!desired) return null;
      const policyUnchanged =
        stock.kind === desired.stock.kind &&
        (stock.kind !== "finite" ||
          desired.stock.kind !== "finite" ||
          stock.reservationTtlMs === desired.stock.reservationTtlMs) &&
        (stock.kind !== "untracked" || stock.approvedUntracked === true);
      const preserveStock =
        policyUnchanged && stockRefs.includes(`${product._id}#${merchantSetupHash(desired.stock)}`);
      return { catalogueItemId, row, product, stock, desired, preserveStock };
    }),
  );
  base.inventoryReview = parsed.value.products.map((desired) => {
    const state = productStates.find((s) => s?.catalogueItemId === desired.catalogueItemId);
    return {
      catalogueItemId: desired.catalogueItemId,
      action: state?.preserveStock ? "preserve" : "set",
      currentOnHand: state?.stock.kind === "finite" ? (state.stock.onHand ?? null) : null,
      requestedOnHand: desired.stock.kind === "finite" ? desired.stock.onHand : null,
    };
  });
  const binding: MerchantSetupBinding = {
    tenantId,
    projectId: project._id,
    version: version.version,
    contentHash: version.contentHash,
    catalogueItemIds: itemIds,
    policyRevision: policy?.revision ?? 0,
    automationRevision: automation?.revision ?? 0,
    mappings,
    products: productStates.flatMap((state) =>
      state
        ? [
            {
              catalogueItemId: state.catalogueItemId,
              productId: state.product._id,
              revision: state.product.revision,
              stockRevision: state.stock.revision,
              preserveStock: state.preserveStock,
            },
          ]
        : [],
    ),
  };
  const digitalSources: { ref: string; identityHash: string }[] = [];
  for (const product of parsed.value?.products ?? [])
    if (product.digitalDeliverySourceRef) {
      const id = ctx.db.normalizeId("vaultDocuments", product.digitalDeliverySourceRef.slice(6));
      const doc = id ? await ctx.db.get(id) : null;
      const metadata = doc?.storageId ? await ctx.db.system.get(doc.storageId) : null;
      if (
        !doc ||
        doc.tenantId !== tenantId ||
        doc.status !== "ready" ||
        (await sealedIn(ctx, [doc])).has(doc._id) ||
        !metadata ||
        metadata.size < 1 ||
        metadata.size > 10 * 1024 * 1024
      )
        return unavailable([
          missing(
            "digitalDeliverySourceRef",
            "Provide a current ready owned Vault file for sale (up to 10 MiB).",
          ),
        ]);
      digitalSources.push({
        ref: product.digitalDeliverySourceRef,
        identityHash: merchantSetupHash([
          doc._id,
          doc.storageId,
          doc.contentHash,
          metadata.sha256,
          metadata.size,
        ]),
      });
    }
  binding.digitalSources = digitalSources;
  const assessment = assessMerchantSetup(session.brief.shopSetup, {
    binding,
    sources,
    sourceSnapshots: session.sourceSnapshots ?? [],
  });
  if (!assessment.ready) return unavailable(assessment.missing);
  // Acceptance identity excludes pre-commit CAS counters. Native approval changes those counters.
  const fingerprint = merchantSetupHash({
    tenantId,
    projectId: project._id,
    version: version.version,
    contentHash: version.contentHash,
    catalogueItemIds: itemIds,
    setup: assessment.setup,
    sourceSnapshots: assessment.sourceSnapshots,
    digitalSources,
  });
  const p = accepted?.payload;
  const approval =
    record(p) &&
    p.fingerprint === fingerprint &&
    typeof p.packageHash === "string" &&
    Array.isArray(p.productIds)
      ? {
          packageHash: p.packageHash,
          version: version.version,
          productIds: p.productIds as string[],
          policyRevision: p.policyRevision as number,
          automationRevision: p.automationRevision as number,
          current:
            p.policyRevision === (policy?.revision ?? 0) &&
            p.automationRevision === (automation?.revision ?? 0) &&
            productStates.every(
              (state) =>
                state &&
                (p.productIds as unknown[]).includes(state.product._id) &&
                state.product.sku === state.desired.sku &&
                state.product.variant === state.desired.variant &&
                state.product.currency === assessment.setup.currency &&
                state.product.priceMinor === state.desired.priceMinor &&
                state.product.goodsKind === state.desired.goodsKind &&
                state.product.status === "active" &&
                state.stock.kind === state.desired.stock.kind &&
                (state.stock.kind !== "finite" ||
                  state.desired.stock.kind !== "finite" ||
                  state.stock.reservationTtlMs === state.desired.stock.reservationTtlMs),
            ),
        }
      : null;
  const conflicts: MerchantSetupIssue[] = [];
  if (!approval?.current) {
    for (const product of assessment.setup.products) {
      const state = productStates.find((s) => s?.catalogueItemId === product.catalogueItemId);
      if (state) {
        if (
          state.product.sku !== product.sku ||
          state.product.variant !== product.variant ||
          state.product.currency !== assessment.setup.currency ||
          state.product.goodsKind !== product.goodsKind
        )
          conflicts.push(
            missing(
              "products",
              "Use a new catalogue item/SKU when changing a product identity, currency or goods kind.",
            ),
          );
        if (!state.preserveStock) {
          const changed =
            state.stock.kind !== product.stock.kind ||
            (state.stock.kind === "finite" &&
              product.stock.kind === "finite" &&
              (state.stock.onHand !== product.stock.onHand ||
                state.stock.reservationTtlMs !== product.stock.reservationTtlMs));
          if (changed) {
            const held = await ctx.db
              .query("tenantReservations")
              .withIndex("by_tenant_product_status_expiry", (q) =>
                q.eq("tenantId", tenantId).eq("productId", state.product._id).eq("status", "held"),
              )
              .first();
            if (held || (state.stock.kind === "finite" && (state.stock.reserved ?? 0) > 0))
              conflicts.push(
                missing(
                  "stock",
                  "Settle or release held reservations before changing inventory counts or policy.",
                ),
              );
          }
        }
        continue;
      }
      const existing = await ctx.db
        .query("tenantProducts")
        .withIndex("by_tenant_sku_variant", (q) =>
          q.eq("tenantId", tenantId).eq("sku", product.sku).eq("variant", product.variant),
        )
        .unique();
      if (existing)
        conflicts.push(
          missing(
            "products",
            "An authoritative SKU/variant already exists. Initial setup will not overwrite existing financial or inventory records.",
          ),
        );
    }
  }
  return {
    ...base,
    ready: conflicts.length === 0 && !approval?.current,
    missing: conflicts,
    setup: assessment.setup,
    packageHash: assessment.packageHash,
    approval,
    binding,
    fingerprint,
    session,
    storedVersion: version,
    sourceSnapshots: assessment.sourceSnapshots,
    productStates,
    policy,
    automation,
  };
}

function publicReview(value: ShopSetupReview): ShopSetupReview {
  return {
    planId: value.planId,
    expectedRevision: value.expectedRevision,
    projectId: value.projectId,
    version: value.version,
    contentHash: value.contentHash,
    catalogueItems: value.catalogueItems,
    inventoryReview: value.inventoryReview,
    ready: value.ready,
    missing: value.missing,
    setup: value.setup,
    packageHash: value.packageHash,
    approval: value.approval,
  };
}
/** Code-only read seam for the agent's existing context tool. Never returns execution authority. */
export async function shopSetupReviewForTenant(
  ctx: Ctx,
  tenantId: string,
  planId: Id<"plans">,
): Promise<ShopSetupReview> {
  return publicReview(await review(ctx, tenantId, planId));
}
export const setupForPlan = tenantQuery({
  args: { planId: v.id("plans") },
  handler: async (ctx, args) => publicReview(await review(ctx, ctx.tenantId, args.planId)),
});
export const setupForProject = tenantQuery({
  args: { projectId: v.id("webProjects") },
  handler: async (ctx, args) => {
    const project = await ctx.db.get(args.projectId);
    if (!project || project.tenantId !== ctx.tenantId)
      throw Error("SHOP_SETUP_PROJECT_UNAVAILABLE");
    const session = await ctx.db
      .query("onlinePresenceSessions")
      .withIndex("by_tenant_project", (q) =>
        q.eq("tenantId", ctx.tenantId).eq("projectId", args.projectId),
      )
      .unique();
    return session ? publicReview(await review(ctx, ctx.tenantId, session.planId)) : null;
  },
});

/** Native owner review only; not in any agent tool registry. All writes share this mutation transaction. */
export const approveSetup = tenantMutation({
  args: { planId: v.id("plans"), expectedRevision: v.number(), packageHash: v.string() },
  handler: async (ctx, args) => {
    await assertTenantWritable(ctx, ctx.tenantId);
    const owned = await onlinePresenceShopContext(ctx, ctx.tenantId, args.planId);
    if (
      !Number.isSafeInteger(args.expectedRevision) ||
      owned.session.revision !== args.expectedRevision
    )
      throw Error("STALE_REVISION");
    const result = await review(ctx, ctx.tenantId, args.planId);
    if (!result.ready || !("session" in result) || !result.setup || !result.binding)
      throw Error("SHOP_SETUP_NOT_READY");
    if (!/^[a-f0-9]{64}$/.test(args.packageHash) || result.packageHash !== args.packageHash)
      throw Error("SHOP_SETUP_HASH_MISMATCH");
    const setup = result.setup;
    const productIds: Id<"tenantProducts">[] = [];
    const stockConfigRefs: string[] = [];
    const productConfigRefs: string[] = [];
    for (const product of setup.products) {
      const existing = result.productStates.find(
        (state) => state?.catalogueItemId === product.catalogueItemId,
      );
      const approvedStock =
        product.stock.kind === "finite"
          ? product.stock
          : { kind: "untracked" as const, approved: true };
      const created = existing
        ? {
            productId: existing.product._id,
            ...(await updateProductForSetup(ctx, ctx.tenantId, {
              productId: existing.product._id,
              expectedRevision: existing.product.revision,
              expectedStockRevision: existing.stock.revision,
              currency: setup.currency,
              goodsKind: product.goodsKind,
              priceMinor: product.priceMinor,
              ...(existing.preserveStock ? {} : { stock: approvedStock }),
            })),
          }
        : await createProductForTenant(ctx, ctx.tenantId, {
            sku: product.sku,
            variant: product.variant,
            currency: setup.currency,
            priceMinor: product.priceMinor,
            status: "active",
            goodsKind: product.goodsKind,
            stock: approvedStock,
          });
      productIds.push(created.productId);
      stockConfigRefs.push(`${created.productId}#${merchantSetupHash(product.stock)}`);
      if (product.digitalDeliverySourceRef) {
        const documentId = ctx.db.normalizeId(
          "vaultDocuments",
          product.digitalDeliverySourceRef.slice(6),
        );
        if (!documentId) throw Error("SHOP_SETUP_DIGITAL_SOURCE_UNAVAILABLE");
        const identity = result.binding.digitalSources?.find(
          (source) => source.ref === product.digitalDeliverySourceRef,
        )?.identityHash;
        if (
          !existing ||
          existing.product.digitalDeliveryDocumentId !== documentId ||
          existing.product.digitalDeliverySourceHash !== `sha256:${identity}`
        )
          await bindDigitalDeliveryForTenant(ctx, ctx.tenantId, {
            productId: created.productId,
            expectedRevision: created.revision,
            documentId,
            releaseForSaleConsent: true,
          });
      }
      const actualProduct = await ctx.db.get(created.productId);
      if (!actualProduct || actualProduct.tenantId !== ctx.tenantId)
        throw Error("SHOP_SETUP_PRODUCT_UNAVAILABLE");
      productConfigRefs.push(merchantProductConfigRef(actualProduct, product.catalogueItemId));
      const mapping = result.binding.mappings.find(
        (m) => m.catalogueItemId === product.catalogueItemId,
      )!;
      if (!existing)
        await mapProductForTenant(ctx, ctx.tenantId, {
          projectId: result.session.projectId!,
          presentationItemId: product.catalogueItemId,
          productId: created.productId,
          expectedRevision: mapping.revision,
        });
    }
    const desiredPolicy = { currency: setup.currency, countries: setup.countries, ...setup.policy };
    const currentPolicy = result.policy
      ? {
          currency: result.policy.currency,
          countries: result.policy.countries,
          sellerOfRecordRef: result.policy.sellerOfRecordRef,
          taxRounding: result.policy.taxRounding,
          physical: result.policy.physical,
          digital: result.policy.digital,
        }
      : null;
    const policy =
      result.policy && merchantSetupHash(currentPolicy) === merchantSetupHash(desiredPolicy)
        ? { policyId: result.policy._id, revision: result.policy.revision }
        : await configurePolicyForTenant(ctx, ctx.tenantId, {
            projectId: result.session.projectId!,
            expectedRevision: result.binding.policyRevision,
            currency: setup.currency,
            countries: setup.countries,
            ...setup.policy,
          });
    const currentAutomation = result.automation
      ? {
          autoDigitalDelivery: result.automation.autoDigitalDelivery,
          digitalValidityDays: result.automation.digitalValidityDays,
          buyerRetentionDays: result.automation.buyerRetentionDays,
          policyRef: result.automation.policyRef,
        }
      : null;
    const automation =
      result.automation &&
      merchantSetupHash(currentAutomation) === merchantSetupHash(setup.automation)
        ? { revision: result.automation.revision }
        : await configureAutomationForTenant(ctx, ctx.tenantId, {
            projectId: result.session.projectId!,
            expectedRevision: result.binding.automationRevision,
            ...setup.automation,
          });
    const revision = result.session.revision + 1;
    await ctx.db.patch(result.session._id, { revision, updatedAt: Date.now() });
    await appendAudit(ctx, {
      tenantId: ctx.tenantId,
      correlationId: correlation(args.planId),
      eventType: EVENT,
      actor: ACTOR,
      payload: {
        planId: args.planId,
        projectId: result.session.projectId!,
        version: result.storedVersion!.version,
        contentHash: result.storedVersion!.contentHash,
        packageHash: args.packageHash,
        fingerprint: result.fingerprint!,
        productIds,
        productCount: productIds.length,
        stockConfigRefs,
        productConfigRefs: productConfigRefs.sort(),
        policyId: policy.policyId,
        policyRevision: policy.revision,
        automationRevision: automation.revision,
        sourceRefs: result.sourceSnapshots!.map((s) => `${s.ref}#${s.revision}`),
      },
    });
    return {
      approved: true as const,
      revision,
      packageHash: args.packageHash,
      projectId: result.session.projectId!,
      version: result.storedVersion!.version,
      productIds,
      policyRevision: policy.revision,
      automationRevision: automation.revision,
      testOnly: true as const,
      checkoutReady: false as const,
    };
  },
});
