"use client";

import { useMutation, useQuery } from "convex/react";
import { makeFunctionReference } from "convex/server";
import { type FormEvent, useEffect, useState } from "react";

type Product = {
  _id: string;
  sku: string;
  variant: string;
  currency: string;
  priceMinor: number;
  status: "draft" | "active" | "retired";
  goodsKind: "physical" | "digital" | null;
  revision: number;
  stockRevision: number;
  available: number | "untracked";
  reservationTtlMs: number | null;
};
const listProducts = makeFunctionReference<
  "query",
  { cursor?: string | null; limit?: number },
  { products: Product[]; nextCursor: string | null }
>("tenantCatalogue:listProducts");
const createProduct = makeFunctionReference<
  "mutation",
  {
    sku: string;
    variant: string;
    currency: string;
    priceMinor: number;
    status: "draft" | "active";
    goodsKind: "physical" | "digital";
    stock:
      | { kind: "finite"; onHand: number; reservationTtlMs?: number }
      | { kind: "untracked"; approved: boolean };
  },
  unknown
>("tenantCatalogue:createProduct");
const editProduct = makeFunctionReference<
  "mutation",
  {
    productId: string;
    expectedRevision: number;
    priceMinor?: number;
    status?: "draft" | "active" | "retired";
    goodsKind?: "physical" | "digital";
  },
  unknown
>("tenantCatalogue:editProduct");
const adjustStock = makeFunctionReference<
  "mutation",
  {
    productId: string;
    expectedRevision: number;
    delta: number;
  },
  unknown
>("tenantCatalogue:adjustStock");
const configureStockPolicy = makeFunctionReference<
  "mutation",
  {
    productId: string;
    expectedStockRevision: number;
    policy: { kind: "finite"; reservationTtlMs: number } | { kind: "untracked"; approved: boolean };
  },
  unknown
>("tenantCatalogue:configureStockPolicy");

const card = {
  background: "var(--card)",
  border: "1px solid var(--rule)",
  borderRadius: 18,
  padding: 24,
};
const field = {
  minHeight: 44,
  border: "1px solid var(--rule)",
  borderRadius: 8,
  padding: "0.5rem",
  color: "var(--ink)",
  background: "var(--card)",
  width: "100%",
};
const action = {
  minHeight: 44,
  border: 0,
  borderRadius: 8,
  padding: "0.6rem 1rem",
  background: "var(--teal-600)",
  color: "white",
  fontWeight: 700,
};

function messageFor(error: unknown): string {
  const detail = error instanceof Error ? error.message : "";
  if (detail.includes("STALE_REVISION"))
    return "This catalogue view is stale. Refresh the page, check the latest version, then retry.";
  if (detail.includes("DUPLICATE_SKU"))
    return "That SKU and variant already exist in your catalogue.";
  if (detail.includes("INVENTORY_POLICY_REQUIRED"))
    return "Set an approved stock policy before making this product active.";
  if (detail.includes("GOODS_KIND_REQUIRED"))
    return "Choose physical or digital goods before saving this product.";
  if (detail.includes("PRODUCT_UNAVAILABLE") || detail.includes("UNAUTHENTICATED"))
    return "This product is unavailable to your account. Sign in or refresh.";
  return "The change was refused. Check your values and retry; nothing was published.";
}

function whole(value: string, min: number): number | null {
  const parsed = Number(value);
  return value.trim() !== "" && Number.isSafeInteger(parsed) && parsed >= min ? parsed : null;
}

function ProductCard({ product }: { product: Product }) {
  const edit = useMutation(editProduct);
  const adjust = useMutation(adjustStock);
  const configure = useMutation(configureStockPolicy);
  const [price, setPrice] = useState(String(product.priceMinor));
  const [delta, setDelta] = useState("");
  const [minutes, setMinutes] = useState(
    product.reservationTtlMs === null ? "" : String(product.reservationTtlMs / 60_000),
  );
  useEffect(() => {
    setMinutes(product.reservationTtlMs === null ? "" : String(product.reservationTtlMs / 60_000));
  }, [product.reservationTtlMs]);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [legacyKind, setLegacyKind] = useState<"" | "physical" | "digital">("");
  const run = async (work: () => Promise<unknown>, success: string) => {
    setBusy(true);
    setNotice("");
    try {
      await work();
      setNotice(success);
    } catch (error) {
      setNotice(messageFor(error));
    } finally {
      setBusy(false);
    }
  };
  const priceMinor = whole(price, 1);
  const stockDelta = Number(delta);
  return (
    <article style={{ ...card, display: "grid", gap: "0.75rem", minWidth: 0 }}>
      <div>
        <h3 style={{ margin: 0, overflowWrap: "anywhere" }}>
          {product.sku} · {product.variant}
        </h3>
        <p style={{ margin: "0.25rem 0", color: "var(--ink-soft)" }}>
          {product.status} · {product.currency} {product.priceMinor} minor units · product v
          {product.revision} · stock v{product.stockRevision}
        </p>
        <p style={{ margin: "0.25rem 0", color: "var(--ink-soft)" }}>
          {product.goodsKind === null
            ? "Goods type not set — classify before checkout."
            : `${product.goodsKind === "physical" ? "Physical" : "Digital"} goods`}
        </p>
        <p style={{ margin: 0, fontWeight: 700 }}>
          {product.available === "untracked"
            ? "Stock untracked — explicitly approved"
            : `${product.available} available`}
        </p>
        {typeof product.available === "number" && (
          <p style={{ margin: "0.25rem 0 0", color: "var(--ink-soft)" }}>
            Current reservation window:{" "}
            {product.reservationTtlMs === null
              ? "not configured"
              : `${product.reservationTtlMs / 60_000} minutes`}
          </p>
        )}
      </div>
      {product.goodsKind === null && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: "0.75rem", alignItems: "end" }}>
          <label style={{ minWidth: "12rem" }}>
            Goods type for existing product
            <select
              style={field}
              value={legacyKind}
              onChange={(event) => setLegacyKind(event.target.value as typeof legacyKind)}
            >
              <option value="">Choose goods type</option>
              <option value="physical">Physical goods</option>
              <option value="digital">Digital goods</option>
            </select>
          </label>
          <button
            type="button"
            disabled={busy || legacyKind === ""}
            onClick={() =>
              run(
                () =>
                  edit({
                    productId: product._id,
                    expectedRevision: product.revision,
                    goodsKind: legacyKind as "physical" | "digital",
                  }),
                "Goods type saved for this tenant.",
              )
            }
            style={action}
          >
            Save goods type
          </button>
        </div>
      )}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 12rem), 1fr))",
          gap: "0.75rem",
        }}
      >
        <label>
          New price (minor units)
          <input
            style={field}
            type="number"
            min="1"
            step="1"
            value={price}
            onChange={(event) => setPrice(event.target.value)}
          />
        </label>
        <div style={{ alignSelf: "end" }}>
          <button
            type="button"
            disabled={busy || priceMinor === null}
            onClick={() =>
              run(
                () =>
                  edit({
                    productId: product._id,
                    expectedRevision: product.revision,
                    priceMinor: priceMinor!,
                  }),
                "Price saved for this tenant.",
              )
            }
            style={action}
          >
            Save price
          </button>
        </div>
        {typeof product.available === "number" && (
          <>
            <label>
              Stock adjustment (signed units)
              <input
                style={field}
                type="number"
                step="1"
                value={delta}
                onChange={(event) => setDelta(event.target.value)}
              />
            </label>
            <div style={{ alignSelf: "end" }}>
              <button
                type="button"
                disabled={busy || !Number.isSafeInteger(stockDelta) || stockDelta === 0}
                onClick={() =>
                  run(
                    () =>
                      adjust({
                        productId: product._id,
                        expectedRevision: product.stockRevision,
                        delta: stockDelta,
                      }),
                    "Stock updated for this tenant.",
                  )
                }
                style={action}
              >
                Adjust stock
              </button>
            </div>
          </>
        )}
        {(typeof product.available === "number" || product.status === "draft") && (
          <>
            {typeof product.available === "number" && (
              <label>
                Reservation window (minutes)
                <input
                  style={field}
                  type="number"
                  min="1"
                  max="60"
                  step="1"
                  value={minutes}
                  onChange={(event) => setMinutes(event.target.value)}
                />
              </label>
            )}
            <div style={{ alignSelf: "end" }}>
              <button
                type="button"
                disabled={
                  busy ||
                  (typeof product.available === "number" &&
                    (whole(minutes, 1) === null || Number(minutes) > 60))
                }
                onClick={() =>
                  run(
                    () =>
                      configure({
                        productId: product._id,
                        expectedStockRevision: product.stockRevision,
                        policy:
                          typeof product.available === "number"
                            ? { kind: "finite", reservationTtlMs: Number(minutes) * 60_000 }
                            : { kind: "untracked", approved: true },
                      }),
                    "Stock policy saved. Reload before activation.",
                  )
                }
                style={action}
              >
                Confirm stock policy
              </button>
            </div>
          </>
        )}
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
        {product.status !== "retired" && (
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              run(
                () =>
                  edit({
                    productId: product._id,
                    expectedRevision: product.revision,
                    status: "retired",
                  }),
                "Product paused. Public selling remains closed.",
              )
            }
            style={{ ...action, background: "var(--ink)" }}
          >
            Pause product
          </button>
        )}
        {product.status !== "active" && (
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              run(
                () =>
                  edit({
                    productId: product._id,
                    expectedRevision: product.revision,
                    status: "active",
                  }),
                "Product active in your private catalogue. Checkout is not available.",
              )
            }
            style={action}
          >
            Activate in catalogue
          </button>
        )}
      </div>
      {notice && (
        <p
          role="status"
          style={{
            color:
              notice.includes("refused") || notice.includes("stale")
                ? "var(--held-text)"
                : "var(--ink)",
            margin: 0,
          }}
        >
          {notice}
        </p>
      )}
    </article>
  );
}

/** Authenticated operator controls only. Phase 49 storefront remains dark. */
export function TenantCatalogue() {
  const [cursor, setCursor] = useState<string | null>(null);
  const [previous, setPrevious] = useState<(string | null)[]>([]);
  const page = useQuery(listProducts, { cursor, limit: 24 });
  const create = useMutation(createProduct);
  const [sku, setSku] = useState("");
  const [variant, setVariant] = useState("");
  const [currency, setCurrency] = useState("USD");
  const [price, setPrice] = useState("");
  const [posture, setPosture] = useState<"finite" | "untracked">("finite");
  const [units, setUnits] = useState("0");
  const [minutes, setMinutes] = useState("15");
  const [approved, setApproved] = useState(false);
  const [status, setStatus] = useState<"draft" | "active">("draft");
  const [goodsKind, setGoodsKind] = useState<"" | "physical" | "digital">("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setNotice("");
    const priceMinor = whole(price, 1);
    const onHand = whole(units, 0);
    const ttl = whole(minutes, 1);
    if (
      !/^[a-z0-9]+(?:[-_][a-z0-9]+)*$/.test(sku) ||
      !/^[a-z0-9]+(?:[-_][a-z0-9]+)*$/.test(variant) ||
      !goodsKind ||
      !/^[A-Z]{3}$/.test(currency) ||
      priceMinor === null ||
      (posture === "finite" && (onHand === null || ttl === null || ttl > 60)) ||
      (posture === "untracked" && !approved)
    ) {
      setNotice(
        "Choose physical or digital goods. SKU and variant need lowercase letters, numbers, hyphens or underscores; also check currency, positive price and stock policy.",
      );
      return;
    }
    setBusy(true);
    try {
      await create({
        sku,
        variant,
        currency,
        priceMinor,
        status,
        goodsKind,
        stock:
          posture === "finite"
            ? { kind: "finite", onHand: onHand!, reservationTtlMs: ttl! * 60_000 }
            : { kind: "untracked", approved: true },
      });
      setNotice("Product created in your private catalogue. Checkout is not available.");
    } catch (error) {
      setNotice(messageFor(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-labelledby="tenant-catalogue-heading" style={{ display: "grid", gap: "1rem" }}>
      <header>
        <p className="caps-label" style={{ margin: 0 }}>
          Tenant catalogue
        </p>
        <h2 id="tenant-catalogue-heading" style={{ margin: "0.25rem 0" }}>
          Maintain your products and stock
        </h2>
        <p style={{ color: "var(--ink-soft)", margin: 0 }}>
          These are private operator controls. Checkout is not available; no merchant provider is
          connected.
        </p>
      </header>
      <form
        onSubmit={submit}
        aria-label="Create product"
        style={{ ...card, display: "grid", gap: "0.75rem" }}
      >
        <h3 style={{ margin: 0 }}>Create a product</h3>
        <p style={{ margin: 0, color: "var(--ink-soft)" }}>
          SKU and variant use lowercase letters, numbers, hyphens or underscores. Finite-stock holds
          must be 1–60 whole minutes.
        </p>
        <div
          data-testid="catalogue-grid"
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 18rem), 1fr))",
            gap: "0.75rem",
          }}
        >
          <label>
            SKU
            <input
              style={field}
              value={sku}
              onChange={(event) => setSku(event.target.value)}
              required
              maxLength={64}
            />
          </label>
          <label>
            Variant
            <input
              style={field}
              value={variant}
              onChange={(event) => setVariant(event.target.value)}
              required
              maxLength={64}
            />
          </label>
          <label>
            Currency
            <input
              style={field}
              value={currency}
              onChange={(event) => setCurrency(event.target.value.toUpperCase())}
              required
              maxLength={3}
            />
          </label>
          <label>
            Goods type
            <select
              style={field}
              value={goodsKind}
              onChange={(event) => setGoodsKind(event.target.value as typeof goodsKind)}
              required
            >
              <option value="">Choose physical or digital</option>
              <option value="physical">Physical goods</option>
              <option value="digital">Digital goods</option>
            </select>
          </label>
          <label>
            Price (minor units)
            <input
              style={field}
              type="number"
              min="1"
              step="1"
              value={price}
              onChange={(event) => setPrice(event.target.value)}
              required
            />
          </label>
          <label>
            Stock posture
            <select
              style={field}
              value={posture}
              onChange={(event) => setPosture(event.target.value as "finite" | "untracked")}
            >
              <option value="finite">Finite stock</option>
              <option value="untracked">Explicitly untracked</option>
            </select>
          </label>
          <label>
            Catalogue status
            <select
              style={field}
              value={status}
              onChange={(event) => setStatus(event.target.value as "draft" | "active")}
            >
              <option value="draft">Draft</option>
              <option value="active">Active in private catalogue</option>
            </select>
          </label>
          {posture === "finite" ? (
            <>
              <label>
                Starting units
                <input
                  style={field}
                  type="number"
                  min="0"
                  step="1"
                  value={units}
                  onChange={(event) => setUnits(event.target.value)}
                />
              </label>
              <label>
                Reservation window (minutes)
                <input
                  style={field}
                  type="number"
                  min="1"
                  max="60"
                  step="1"
                  value={minutes}
                  onChange={(event) => setMinutes(event.target.value)}
                />
              </label>
            </>
          ) : (
            <label style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
              <input
                type="checkbox"
                checked={approved}
                onChange={(event) => setApproved(event.target.checked)}
              />{" "}
              I explicitly approve untracked stock
            </label>
          )}
        </div>
        <button type="submit" disabled={busy} style={{ ...action, justifySelf: "start" }}>
          {busy ? "Saving…" : "Create product"}
        </button>
        {notice && (
          <p
            role="status"
            style={{
              margin: 0,
              color: notice.includes("created") ? "var(--ink)" : "var(--held-text)",
            }}
          >
            {notice}
          </p>
        )}
      </form>
      <div style={{ ...card, display: "grid", gap: "0.75rem" }}>
        <h3 style={{ margin: 0 }}>Your catalogue</h3>
        {page === undefined ? (
          <p role="status">Loading your catalogue…</p>
        ) : page.products.length === 0 ? (
          <p>No products yet on this page. Create one above or return to an earlier page.</p>
        ) : (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 20rem), 1fr))",
              gap: "0.75rem",
            }}
          >
            {page.products.map((product) => (
              <ProductCard key={product._id} product={product} />
            ))}
          </div>
        )}
        {page && (page.nextCursor || previous.length > 0) && (
          <nav
            aria-label="Catalogue pages"
            style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}
          >
            {previous.length > 0 && (
              <button
                type="button"
                style={action}
                onClick={() => {
                  setCursor(previous.at(-1) ?? null);
                  setPrevious(previous.slice(0, -1));
                }}
              >
                Previous page
              </button>
            )}
            {page.nextCursor && (
              <>
                <span>More products are available.</span>
                <button
                  type="button"
                  style={action}
                  onClick={() => {
                    setPrevious([...previous, cursor]);
                    setCursor(page.nextCursor);
                  }}
                >
                  Next page
                </button>
              </>
            )}
          </nav>
        )}
      </div>
    </section>
  );
}
