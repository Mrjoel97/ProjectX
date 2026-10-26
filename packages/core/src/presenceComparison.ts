/** Frozen synthetic/public input. No customer Foundation, credentials or operational authority. */
export const PRESENCE_COMPARISON_ARMS = ["current", "kimi", "kimi-stitch"] as const;
export type PresenceComparisonArm = (typeof PRESENCE_COMPARISON_ARMS)[number];
export const PRESENCE_COMPARISON_MODELS = {
  current: "or/openai/gpt-4o-mini",
  kimi: "or/moonshotai/kimi-k3.1-pro",
  "kimi-stitch": "or/moonshotai/kimi-k3.1-pro",
} as const;
export const PRESENCE_COMPARISON_CAP_CENTS = 450;
export const PRESENCE_COMPARISON_TOTAL_USD = 5;
export type PresenceComparisonAdmission = {
  upperBoundUsd: number;
  remainingUsd: number;
  capCents: number;
};
export const PRESENCE_COMPARISON_FIXTURE = Object.freeze({
  id: "fieldwork-studio-website-v1",
  sourceRef: "fixture:presence:fieldwork",
  request:
    "Prepare one high-quality visual website design proposal only. Return a single HTML document with inline CSS, grounded copy, responsive navigation to home/about/services/contact sections, a hero image overlay using the supplied frozen studio photograph and CSS motion respecting prefers-reduced-motion. No JavaScript, event handlers, working submissions, tracking, external fonts or assets other than the supplied image. Use its publicUrl for the image; the review viewer also serves its frozen path. Do not invent testimonials or credentials. This is quarantined visual material, not a compiled native website, publication or operational service.",
  assets: [
    {
      id: "studio",
      mimeType: "image/webp",
      source: "original-generated-fictional-example",
      path: "/presence-examples/studio.webp",
      publicUrl: "https://pikar-presence-stg.vercel.app/presence-examples/studio.webp",
      sha256: "78bacab9b8befa6b92043b4e16f2ce9eff15fa5968eda616666ff37b9db155d4",
      byteLength: 200924,
    },
  ],
  business: {
    name: "Fieldwork Design Studio",
    audience: "Independent businesses",
    summary: "Brand identity and web design for independent businesses.",
    services: ["Brand identity design", "Web design"],
    pages: ["home", "about", "services", "contact"],
    assets:
      "Use the supplied studio image only. No logo, testimonials, certifications, prices, real customer identities or booking destination were supplied. Do not invent them.",
  },
});
export function comparisonModelMatches(requested: string, observed: string | undefined): boolean {
  return requested === "or/openai/gpt-4o-mini"
    ? [
        "openai/gpt-4o-mini",
        "openai/gpt-4o-mini-2024-07-18",
        "gpt-4o-mini",
        "gpt-4o-mini-2024-07-18",
      ].includes(observed ?? "")
    : requested === "or/moonshotai/kimi-k3.1-pro"
      ? ["moonshotai/kimi-k3.1-pro", "moonshotai/kimi-k3.1-pro-20261023", "kimi-k3.1-pro"].includes(
          observed ?? "",
        )
      : false;
}

/** Conservative global original-authorization admission, independent of a new envelope's cap. */
export function comparisonLedgerAdmission(
  rows: readonly {
    _id?: string;
    evalBudgetId?: string;
    tenantId: string;
    rail: string;
    correlationId: string;
    phase: string;
    amountCents: number;
    evalActualUsd?: number;
    evalBreach?: boolean;
    kind?: string;
  }[],
  capCents: number,
): PresenceComparisonAdmission {
  if (rows.length > 5000 || capCents !== PRESENCE_COMPARISON_CAP_CENTS)
    throw Error("PRESENCE_COMPARISON_LEDGER_INVALID");
  let upperBoundUsd = 0;
  const settled = new Set<string>();
  const key = (r: (typeof rows)[number]) => JSON.stringify([r.tenantId, r.rail, r.correlationId]);
  for (const row of rows) {
    if (row.evalBreach) throw Error("PRESENCE_COMPARISON_PRIOR_BREACH");
    if (!Number.isFinite(row.amountCents) || row.amountCents < 0)
      throw Error("PRESENCE_COMPARISON_LEDGER_INVALID");
    if (row.phase === "actual" || (row.phase === "refunded" && row.evalActualUsd === 0)) {
      if (settled.has(key(row))) throw Error("PRESENCE_COMPARISON_DUPLICATE_SETTLEMENT");
      settled.add(key(row));
      const cost = row.evalActualUsd ?? row.amountCents / 100;
      if (!Number.isFinite(cost) || cost < 0) throw Error("PRESENCE_COMPARISON_LEDGER_INVALID");
      upperBoundUsd += cost;
    }
  }
  if (rows.some((row) => row.phase === "reserved" && !settled.has(key(row))))
    throw Error("PRESENCE_COMPARISON_PRIOR_HOLD");
  const closed = new Set(
    rows.filter((row) => row.kind === "eval_budget_closed").map((row) => row.evalBudgetId),
  );
  if (
    rows.some(
      (row) => row.kind === "eval_envelope" && row.phase === "estimated" && !closed.has(row._id),
    )
  )
    throw Error("PRESENCE_COMPARISON_PRIOR_OPEN_BUDGET");
  if (upperBoundUsd + capCents / 100 > PRESENCE_COMPARISON_TOTAL_USD)
    throw Error("PRESENCE_COMPARISON_ORIGINAL_TOTAL_EXHAUSTED");
  return { upperBoundUsd, remainingUsd: PRESENCE_COMPARISON_TOTAL_USD - upperBoundUsd, capCents };
}
