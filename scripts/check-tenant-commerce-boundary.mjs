import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const phase = ".planning/phases/50-tenant-merchant-commerce";

// Exact Phase 50 source inventory. Planned files are optional only until their owning plan has a SUMMARY.
// Shared sources are scanned solely inside tenant-commerce markers so existing Pikar billing is unaffected.
const inventory = [
  ["packages/contracts/src/tenantCommerce.ts", "01"],
  ["packages/core/src/tenantCommerce.ts", "01"],
  ["packages/core/src/tenantInventory.ts", "02"],
  ["packages/backend/convex/tenantCatalogue.ts", "02"],
  ["packages/core/src/tenantOrder.ts", "04"],
  ["packages/backend/convex/tenantOrders.ts", "04"],
  ["packages/backend/convex/tenantMerchant.ts", "07"],
  ["packages/backend/convex/merchantProviderSelected.ts", "07"],
  ["packages/core/src/tenantPayment.ts", "09"],
  ["packages/backend/convex/tenantPayments.ts", "09"],
  ["packages/core/src/storefrontReadiness.ts", "10"],
  ["packages/backend/convex/http.ts", "05", "shared"],
  ["packages/backend/convex/webRecipes.ts", "10", "shared"],
  ["packages/backend/convex/webProjects.ts", "10", "shared"],
  ["packages/backend/convex/webRuntime.ts", "10", "shared"],
  ["packages/contracts/src/webRuntime.ts", "10", "shared"],
  ["packages/core/src/webRuntime.ts", "12", "shared"],
  ["packages/core/src/webDesignRenderer.ts", "12", "shared"],
  ["apps/web/app/(app)/dashboard/sites/TenantCatalogue.tsx", "03"],
  ["apps/web/app/(app)/dashboard/sites/SiteEditor.tsx", "13", "shared"],
  ["apps/web/app/(app)/dashboard/sites/preview/PreviewCanvas.tsx", "13", "shared"],
];

const forbidden = [
  ["pikar_billing_import", /(?:from\s*["'][^"']*(?:@pikar\/billing|packages\/billing|\/billing(?:Api|Webhook|Ledger)?)[^"']*["']|import\s*\(["'][^"']*(?:@pikar\/billing|packages\/billing|\/billing(?:Api|Webhook|Ledger)?)[^"']*["']\))/i],
  ["connector_import", /(?:from\s*["'][^"']*(?:connectorFetch|stripeConnector|paypalConnector|revenue\/src\/providers)[^"']*["']|import\s*\(["'][^"']*(?:connectorFetch|stripeConnector|paypalConnector|revenue\/src\/providers)[^"']*["']\))/i],
  ["pikar_billing_secret", /\b(?:BILLING_STRIPE_[A-Z_]+|STRIPE_APP_SECRET_KEY)\b/],
  ["pikar_billing_ledger", /\b(?:billingEvents|subscriptionEvents|subscriptionState|spendEvents|billingLedger)\b/],
  ["card_entry_field", /\b(?:cardNumber|card_number|cardCvc|cardCvv|cvv|cvc|expiryMonth|expiryYear|expMonth|expYear)\b/i],
  ["reused_stripe_webhook_route", /(?:["'`]\/stripe(?:\/|["'`])|["'`]\/webhooks?\/stripe(?:\/|["'`]))/i],
];

function merchantSpan(source, path) {
  const start = /\/\/ tenant-commerce:start\b/g;
  const end = /\/\/ tenant-commerce:end\b/g;
  const begins = [...source.matchAll(start)];
  const finishes = [...source.matchAll(end)];
  if (begins.length !== finishes.length) throw new Error(`${path}: unbalanced tenant-commerce markers`);
  const spans = [];
  for (let index = 0; index < begins.length; index += 1) {
    const begin = begins[index];
    const finish = finishes[index];
    if (begin.index >= finish.index || (index > 0 && begins[index - 1].index >= begin.index)) {
      throw new Error(`${path}: misordered tenant-commerce markers`);
    }
    spans.push(source.slice(begin.index, finish.index + finish[0].length));
  }
  return spans.join("\n");
}

function scan(source, path, shared = false) {
  const merchantSource = shared ? merchantSpan(source, path) : source;
  const violations = forbidden.filter(([, pattern]) => pattern.test(merchantSource)).map(([code]) => `${path}: ${code}`);
  if (path.endsWith("/http.ts") && merchantSource) {
    if (!/\/tenant-commerce\//.test(merchantSource)) violations.push(`${path}: missing_distinct_merchant_route`);
  }
  return violations;
}

function selfTest() {
  const cases = [
    ["import x from '@pikar/billing';", "pikar_billing_import"],
    ["import x from './billingWebhook';", "pikar_billing_import"],
    ["import x from './stripeConnector';", "connector_import"],
    ["const secret = BILLING_STRIPE_SECRET_KEY;", "pikar_billing_secret"],
    ["const secret = STRIPE_APP_SECRET_KEY;", "pikar_billing_secret"],
    ["await ctx.db.insert('billingEvents', event);", "pikar_billing_ledger"],
    ["const form = { cardNumber: value };", "card_entry_field"],
    ["path: '/stripe/webhook'", "reused_stripe_webhook_route"],
  ];
  for (const [mutation, expected] of cases) {
    if (!scan(mutation, "fixture/tenantPayment.ts").some((finding) => finding.endsWith(expected))) {
      throw new Error(`Boundary positive control failed: ${expected}`);
    }
  }
  const clean = "export const amountMinor = 1200;";
  if (scan(clean, "fixture/tenantPayment.ts").length !== 0) throw new Error("Clean control failed");
  const shared = `// unrelated Pikar route: '/stripe/webhook'\n// tenant-commerce:start\npath: '/tenant-commerce/checkout'\n// tenant-commerce:end`;
  if (scan(shared, "packages/backend/convex/http.ts", true).length !== 0) throw new Error("Scoped HTTP clean control failed");
  const badShared = `${shared}\n// tenant-commerce:start\npath: '/stripe/webhook'\n// tenant-commerce:end`;
  if (!scan(badShared, "packages/backend/convex/http.ts", true).some((finding) => finding.endsWith("reused_stripe_webhook_route"))) {
    throw new Error("Scoped HTTP route positive control failed");
  }
  return cases.length + 3;
}

function checkTree() {
  const violations = [];
  let scanned = 0;
  for (const [path, ownerPlan, kind] of inventory) {
    const absolute = resolve(root, path);
    const completed = existsSync(resolve(root, phase, `50-${ownerPlan}-SUMMARY.md`));
    if (!existsSync(absolute)) {
      if (completed) violations.push(`${path}: missing_after_plan_${ownerPlan}`);
      continue;
    }
    // Existing shared files are not merchant code until their owning plan adds an explicit span.
    if (kind === "shared" && !completed && !readFileSync(absolute, "utf8").includes("// tenant-commerce:start")) continue;
    const source = readFileSync(absolute, "utf8");
    if (kind === "shared" && completed && !source.includes("// tenant-commerce:start")) {
      violations.push(`${path}: missing_merchant_span_after_plan_${ownerPlan}`);
      continue;
    }
    violations.push(...scan(source, path, kind === "shared"));
    scanned += 1;
  }
  return { scanned, violations };
}

try {
  const positiveControls = process.argv.includes("--self-test") ? selfTest() : 0;
  const result = checkTree();
  if (result.violations.length) {
    process.stderr.write(`${JSON.stringify({ status: "failed", positiveControls, ...result })}\n`);
    process.exitCode = 1;
  } else {
    process.stdout.write(`${JSON.stringify({ status: "passed", positiveControls, scanned: result.scanned })}\n`);
  }
} catch (error) {
  process.stderr.write(`${JSON.stringify({ status: "failed", reason: String(error) })}\n`);
  process.exitCode = 1;
}
