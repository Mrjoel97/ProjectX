import type { MerchantSetup } from "@pikar/core/merchantSetup";
import { materializeWebRecipe } from "@pikar/core/webRecipes";
import { sha256Bytes } from "@pikar/core/webRuntime";
import { categoryFor } from "@pikar/vault";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { assertTenantWritable, internalMutation } from "./lib/tenantLifecycle";
import { onlinePresenceShopContext } from "./onlinePresence";
import { shopSetupReviewForTenant } from "./onlinePresenceShop";
import { assertPresenceDesignStage } from "./presenceDesignProbe";
import { createProjectWithVersion } from "./webProjects";

const threadId = "staging-flutterwave-checkout-fixture-v1";
const slug = "flutterwave-tz-checkout-test";
const title = "Tanzania checkout test shop (fictional)";
const actor = "staging-operator:flutterwave-checkout-fixture";
const specification = [
  "Staging operator test specification. All products, prices, quantities and policies here are fictional.",
  "This private example is for testing a checkout. Seller and buyer country TZ, currency TZS.",
  "One physical test postcard, SKU pilot-postcard, variant standard. Unit price TZS 1000 (100000 minor units).",
  "Test stock 10 postcards. Reserve stock for 10 minutes. The staging operator is the fictional seller of record.",
  "Simulated domestic shipping costs 0 minor units. Simulated tax is 0 basis points with half-up rounding.",
  "Test returns and refunds require manual review. No physical postcard will be shipped.",
  "Automatic digital delivery disabled. Digital validity 7 days and buyer information retention 7 days.",
].join(" ");

type Result = {
  tenantId: string;
  projectId: Id<"webProjects">;
  planId: Id<"plans">;
  created: boolean;
  ownerReviewPath: string;
};

/** Restricted operator entry point. All fixture writes share a transaction. It creates a
 * source and a proposal only; the shop's owner must use Sites to approve the actual package. */
export const prepare = internalMutation({
  args: { confirmedOwnerEmail: v.string() },
  handler: async (ctx, { confirmedOwnerEmail }): Promise<Result> => {
    assertPresenceDesignStage();
    const email = confirmedOwnerEmail.trim().toLowerCase();
    const owner = await ctx.db
      .query("users")
      .withIndex("email", (q) => q.eq("email", email))
      .unique();
    if (!email || !owner?.owner || !owner.emailVerificationTime)
      throw Error("FLUTTERWAVE_STAGE_VERIFIED_OWNER_REQUIRED");
    const tenantId = String(owner._id);
    await assertTenantWritable(ctx, tenantId);
    const existing = await ctx.db
      .query("webProjects")
      .withIndex("by_tenant_slug", (q) => q.eq("tenantId", tenantId).eq("slug", slug))
      .unique();
    const session = await ctx.db
      .query("onlinePresenceSessions")
      .withIndex("by_tenant_thread", (q) => q.eq("tenantId", tenantId).eq("threadId", threadId))
      .unique();
    if (existing || session) {
      if (
        !existing ||
        !session ||
        session.projectId !== existing._id ||
        existing.kind !== "storefront" ||
        existing.publishedVersion !== undefined
      )
        throw Error("FLUTTERWAVE_STAGE_FIXTURE_CONFLICT");
      const first = await ctx.db
        .query("webProjectVersions")
        .withIndex("by_tenant_project_version", (q) =>
          q.eq("tenantId", tenantId).eq("projectId", existing._id).eq("version", 1),
        )
        .unique();
      if (first?.createdBy !== actor) throw Error("FLUTTERWAVE_STAGE_FIXTURE_CONFLICT");
      return {
        tenantId,
        projectId: existing._id,
        planId: session.planId,
        created: false,
        ownerReviewPath: `/dashboard/sites?project=${existing._id}`,
      };
    }
    // Explicit technical fixture provenance. No fabricated human conversation, embedding,
    // generated website receipt or merchant approval. Sites reads this exact private note.
    const now = Date.now();
    const bytes = new TextEncoder().encode(specification);
    const document = await ctx.db.insert("vaultDocuments", {
      tenantId,
      title: "Fictional Tanzania checkout specification",
      kind: "checkout_test_fixture",
      category: categoryFor({ source: "paste" }),
      source: "evaluation",
      mimeType: "text/plain",
      size: bytes.length,
      contentHash: sha256Bytes(bytes),
      text: specification,
      status: "ready",
      sourceThreadId: threadId,
      createdAt: now,
    });
    const sourceRef = `vault:${document}`;
    const evidence = [{ sourceRef, quote: specification }];
    const product = {
      id: "pilot-postcard",
      name: "Fictional test postcard",
      description: "One printed postcard from a fictional collection for private testing.",
    };
    const setup: MerchantSetup = {
      version: 1,
      sellerCountry: "TZ",
      currency: "TZS",
      countries: ["TZ"],
      products: [
        {
          catalogueItemId: product.id,
          sku: product.id,
          variant: "standard",
          goodsKind: "physical",
          priceMinor: 100000,
          stock: { kind: "finite", onHand: 10, reservationTtlMs: 600000 },
          evidence,
        },
      ],
      policy: {
        sellerOfRecordRef: sourceRef,
        taxRounding: "half_up",
        physical: {
          shippingSourceRef: sourceRef,
          shippingMinor: 0,
          taxSourceRef: sourceRef,
          taxBasisPoints: 0,
          returnsPolicyRef: sourceRef,
          refundPolicyRef: sourceRef,
          buyerRetentionRef: sourceRef,
        },
      },
      automation: {
        autoDigitalDelivery: false,
        digitalValidityDays: 7,
        buyerRetentionDays: 7,
        policyRef: sourceRef,
      },
      evidence,
    };
    const planId = await ctx.runMutation(internal.plans.insertPlan, { tenantId, threadId });
    const draft = await createProjectWithVersion(
      { ...ctx, tenantId, userId: actor },
      {
        kind: "storefront",
        slug,
        title,
        createdBy: actor,
        sourceRefs: [sourceRef],
        document: materializeWebRecipe("storefront-catalogue", {
          brandName: "Fictional Postcard Studio",
          items: [product],
        }),
      },
    );
    const sessionId = await ctx.db.insert("onlinePresenceSessions", {
      tenantId,
      threadId,
      planId,
      revision: 1,
      humanMessages: [],
      status: "awaiting_review",
      brief: {
        kind: "shop",
        businessName: title,
        headline: "Private Tanzania checkout test",
        audience: "Staging checkout testers",
        summary: "Fictional test item for TZS checkout.",
        catalogue: [product],
        shopSetup: setup,
        sourceRefs: [sourceRef],
      },
      projectId: draft.projectId,
      projectVersion: draft.version,
      projectContentHash: draft.contentHash,
      createdAt: now,
      updatedAt: now,
    });
    const { sources } = await onlinePresenceShopContext(ctx, tenantId, planId);
    const fixture = sources.find((s) => s.ref === sourceRef);
    if (!fixture) throw Error("FLUTTERWAVE_STAGE_SOURCE_UNAVAILABLE");
    await ctx.db.patch(sessionId, {
      sourceSnapshots: [{ ref: sourceRef, revision: fixture.revision }],
    });
    const review = await shopSetupReviewForTenant(ctx, tenantId, planId);
    if (!review.ready || !review.packageHash || review.approval)
      throw Error("FLUTTERWAVE_STAGE_PROPOSAL_NOT_READY");
    return {
      tenantId,
      projectId: draft.projectId,
      planId,
      created: true,
      ownerReviewPath: `/dashboard/sites?project=${draft.projectId}`,
    };
  },
});
