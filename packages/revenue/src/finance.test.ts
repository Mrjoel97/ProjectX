import { unwrap } from "@pikar/core/result";
import { describe, expect, it } from "vitest";
import {
  CONFIDENCE_RANK,
  type Coverage,
  type Figure,
  type FinanceConfidence,
  type Invoice,
  type Money,
  type Obligation,
  type Payment,
  type Projection,
  type Provider,
  SOURCE_AUTHORITIES,
  type SourceAuthority,
  type SourceRef,
} from "./contracts";
import {
  AGING_BUCKETS,
  agingReport,
  cashTimeline,
  confidenceFor,
  coverageOf,
  financeResult,
  paymentLag,
  payrollGap,
  receiptsTotal,
  reconcilePayments,
} from "./finance";
import { formatMoneyAmount, moneyFromMinor } from "./money";

const DAY = 86_400_000;
const ASOF = Date.UTC(2026, 7, 27); // 2026-08-27T00:00:00Z
const usd = (minor: number): Money => unwrap(moneyFromMinor(minor, "USD"));
const eur = (minor: number): Money => unwrap(moneyFromMinor(minor, "EUR"));

const ref = (id: string, provider: Provider = "quickbooks", kind = "invoice"): SourceRef => ({
  provider,
  kind,
  id,
});

const invoice = (over: Partial<Invoice> & { id: string }): Invoice => ({
  ref: ref(over.id),
  customerRef: "cust_1",
  issuedAt: ASOF - 40 * DAY,
  dueAt: ASOF - 10 * DAY,
  total: usd(10_000),
  outstanding: usd(10_000),
  ...over,
});

const payment = (over: Partial<Payment> & { id: string }): Payment => ({
  ref: ref(over.id, "quickbooks", "payment"),
  authority: "accounting_authority",
  invoiceId: null,
  paidAt: ASOF - 5 * DAY,
  amount: usd(10_000),
  ...over,
});

const obligation = (over: Partial<Obligation> & { id: string }): Obligation => ({
  ref: ref(over.id, "quickbooks", "obligation"),
  kind: "other",
  dueAt: ASOF + 5 * DAY,
  amount: usd(10_000),
  ...over,
});

function mustKnow<V>(f: Figure<V>): V {
  if (f.state !== "known") throw new Error(`expected a known figure, got ${f.state}`);
  return f.value;
}

// ── AR aging ──────────────────────────────────────────────────────────────────────────────

describe("agingReport", () => {
  const at = (daysOverdue: number, id: string): Invoice =>
    invoice({ id, dueAt: ASOF - daysOverdue * DAY, issuedAt: ASOF - (daysOverdue + 30) * DAY });

  it("puts each invoice in exactly one bucket, at the boundaries", () => {
    const cases: [number, string][] = [
      [-5, "current"],
      [0, "current"],
      [1, "d1_30"],
      [30, "d1_30"],
      [31, "d31_60"],
      [60, "d31_60"],
      [61, "d61_90"],
      [90, "d61_90"],
      [91, "d90_plus"],
      [200, "d90_plus"],
    ];
    for (const [days, bucket] of cases) {
      const r = unwrap(agingReport([at(days, `i${days}`)], ASOF, "USD"));
      const hit = AGING_BUCKETS.filter((b) => r.buckets[b].count > 0);
      expect(hit).toEqual([bucket]);
      expect(r.buckets[bucket as (typeof AGING_BUCKETS)[number]].total.minor).toBe(10_000);
    }
  });

  it("buckets by UTC day, so clock time within the same day never shifts an invoice", () => {
    // Due at 23:00 on the as-of day, read at 01:00 on the as-of day: still `current`, not overdue.
    const lateSameDay = unwrap(
      agingReport([invoice({ id: "i1", dueAt: ASOF + 23 * 3_600_000 })], ASOF + 3_600_000, "USD"),
    );
    expect(lateSameDay.buckets.current.count).toBe(1);
    // One millisecond before the as-of day is a full day overdue.
    const yesterday = unwrap(agingReport([invoice({ id: "i2", dueAt: ASOF - 1 })], ASOF, "USD"));
    expect(yesterday.buckets.d1_30.count).toBe(1);
  });

  it("keeps a missing due date UNKNOWN rather than calling it current", () => {
    const r = unwrap(agingReport([invoice({ id: "i1", dueAt: null })], ASOF, "USD"));
    expect(r.buckets.unknown.count).toBe(1);
    expect(r.buckets.current.count).toBe(0);
    expect(r.outstanding.minor).toBe(10_000);
  });

  it("ignores a settled invoice and refuses a negative balance", () => {
    const settled = unwrap(agingReport([invoice({ id: "i1", outstanding: usd(0) })], ASOF, "USD"));
    expect(settled.outstanding.minor).toBe(0);
    expect(AGING_BUCKETS.every((b) => settled.buckets[b].count === 0)).toBe(true);
    expect(agingReport([invoice({ id: "i2", outstanding: usd(-1) })], ASOF, "USD").ok).toBe(false);
  });

  it("refuses to fold a second currency into one total", () => {
    const mixed = [
      invoice({ id: "i1" }),
      invoice({ id: "i2", total: eur(500), outstanding: eur(500) }),
    ];
    expect(agingReport(mixed, ASOF, "USD").ok).toBe(false);
    expect(agingReport([invoice({ id: "i1" })], ASOF, "EUR").ok).toBe(false);
  });

  it("reports an empty ledger as a real zero in the requested currency", () => {
    const r = unwrap(agingReport([], ASOF, "usd"));
    expect(r.currency).toBe("USD");
    expect(formatMoneyAmount(r.outstanding)).toBe("0.00");
  });
});

// ── Payment lag ───────────────────────────────────────────────────────────────────────────

describe("paymentLag", () => {
  const settled = (id: string, issuedDaysAgo: number, paidDaysAgo: number): [Invoice, Payment] => [
    invoice({ id, issuedAt: ASOF - issuedDaysAgo * DAY, dueAt: ASOF - paidDaysAgo * DAY }),
    payment({ id: `p_${id}`, invoiceId: id, paidAt: ASOF - paidDaysAgo * DAY }),
  ];

  it("measures days from issue to settlement by UTC day", () => {
    const [inv, pay] = settled("i1", 40, 10); // 30 days
    const r = unwrap(paymentLag([inv], [pay]));
    expect(mustKnow(r.settledCount)).toBe(1);
    expect(mustKnow(r.medianDays)).toBe(30);
    expect(mustKnow(r.p90Days)).toBe(30);
  });

  it("treats a same-day settlement as zero, not as negative", () => {
    const inv = invoice({ id: "i1", issuedAt: ASOF + 23 * 3_600_000 });
    const pay = payment({ id: "p1", invoiceId: "i1", paidAt: ASOF + 3_600_000 });
    expect(mustKnow(unwrap(paymentLag([inv], [pay])).medianDays)).toBe(0);
  });

  it("refuses a payment dated a whole day before its invoice", () => {
    const inv = invoice({ id: "i1", issuedAt: ASOF });
    const pay = payment({ id: "p1", invoiceId: "i1", paidAt: ASOF - DAY });
    expect(paymentLag([inv], [pay]).ok).toBe(false);
  });

  it("uses nearest-rank percentiles, deterministically", () => {
    const pairs = [2, 4, 6, 8].map((d, i) => settled(`i${i}`, 60, 60 - d));
    const r = unwrap(
      paymentLag(
        pairs.map(([i]) => i),
        pairs.map(([, p]) => p),
      ),
    );
    expect(mustKnow(r.settledCount)).toBe(4);
    // nearest-rank over [2,4,6,8]: p50 -> index 1, p90 -> index 3.
    expect(mustKnow(r.medianDays)).toBe(4);
    expect(mustKnow(r.p90Days)).toBe(8);

    const ten = Array.from({ length: 10 }, (_, i) => settled(`j${i}`, 60, 59 - i));
    const r10 = unwrap(
      paymentLag(
        ten.map(([i]) => i),
        ten.map(([, p]) => p),
      ),
    );
    expect(mustKnow(r10.medianDays)).toBe(5); // sorted [1..10], index 4
    expect(mustKnow(r10.p90Days)).toBe(9); // index 8
  });

  it("settles on the LAST payment when an invoice was paid in instalments", () => {
    const inv = invoice({ id: "i1", issuedAt: ASOF - 40 * DAY });
    const first = payment({ id: "p1", invoiceId: "i1", paidAt: ASOF - 35 * DAY });
    const last = payment({ id: "p2", invoiceId: "i1", paidAt: ASOF - 10 * DAY });
    expect(mustKnow(unwrap(paymentLag([inv], [last, first])).medianDays)).toBe(30);
  });

  it("makes a median of nothing not-computable, never zero", () => {
    const r = unwrap(paymentLag([invoice({ id: "i1" })], []));
    expect(mustKnow(r.settledCount)).toBe(0);
    expect(r.medianDays.state).toBe("not-computable");
    expect(r.p90Days.state).toBe("not-computable");
  });

  it("ignores payments with no invoice link or an unknown link", () => {
    const inv = invoice({ id: "i1", issuedAt: ASOF - 40 * DAY });
    const linked = payment({ id: "p1", invoiceId: "i1", paidAt: ASOF - 10 * DAY });
    const loose = payment({ id: "p2", invoiceId: null, paidAt: ASOF - 1 * DAY });
    const stranger = payment({ id: "p3", invoiceId: "i9", paidAt: ASOF - 1 * DAY });
    const r = unwrap(paymentLag([inv], [linked, loose, stranger]));
    expect(mustKnow(r.settledCount)).toBe(1);
  });
});

// ── Cash timeline ─────────────────────────────────────────────────────────────────────────

describe("cashTimeline", () => {
  const base = {
    openingCash: usd(100_000),
    asOfMs: ASOF,
    horizonDays: 30,
    inflows: [],
    outflows: [],
  };

  it("keeps a missing opening balance UNKNOWN rather than starting from zero", () => {
    const f = unwrap(cashTimeline({ ...base, openingCash: null }));
    expect(f.state).toBe("unknown");
    if (f.state === "unknown") expect(f.needs).toMatch(/opening cash/i);
  });

  it("runs a balance across event days and closes at the horizon", () => {
    const f = unwrap(
      cashTimeline({
        ...base,
        inflows: [{ atMs: ASOF + 3 * DAY, amount: usd(50_000) }],
        outflows: [{ atMs: ASOF + 10 * DAY, amount: usd(20_000) }],
      }),
    );
    const t = mustKnow(f);
    expect(t.points.map((p) => p.balance.minor)).toEqual([150_000, 130_000]);
    expect(t.closing.minor).toBe(130_000);
    expect(t.currency).toBe("USD");
  });

  it("settles same-day outflows BEFORE same-day inflows, and records the trough", () => {
    const f = unwrap(
      cashTimeline({
        ...base,
        openingCash: usd(90_000),
        inflows: [{ atMs: ASOF + 5 * DAY, amount: usd(50_000) }],
        outflows: [{ atMs: ASOF + 5 * DAY + 3_600_000, amount: usd(100_000) }],
      }),
    );
    const t = mustKnow(f);
    expect(t.points).toHaveLength(1);
    expect(t.points[0]?.low.minor).toBe(-10_000);
    expect(t.points[0]?.balance.minor).toBe(40_000);
  });

  it("drops events outside the horizon and keeps the one on the last day", () => {
    const f = unwrap(
      cashTimeline({
        ...base,
        inflows: [
          { atMs: ASOF - DAY, amount: usd(1) },
          { atMs: ASOF + 30 * DAY, amount: usd(2) },
          { atMs: ASOF + 31 * DAY, amount: usd(4) },
        ],
      }),
    );
    expect(mustKnow(f).closing.minor).toBe(100_002);
  });

  it("refuses a second currency, a negative event and an out-of-range horizon", () => {
    expect(cashTimeline({ ...base, inflows: [{ atMs: ASOF, amount: eur(1) }] }).ok).toBe(false);
    expect(cashTimeline({ ...base, outflows: [{ atMs: ASOF, amount: usd(-1) }] }).ok).toBe(false);
    expect(cashTimeline({ ...base, horizonDays: 0 }).ok).toBe(false);
    expect(cashTimeline({ ...base, horizonDays: 401 }).ok).toBe(false);
    expect(cashTimeline({ ...base, horizonDays: 400 }).ok).toBe(true);
    expect(cashTimeline({ ...base, horizonDays: 1.5 }).ok).toBe(false);
    expect(cashTimeline({ ...base, asOfMs: Number.NaN }).ok).toBe(false);
  });
});

// ── Payroll gap ───────────────────────────────────────────────────────────────────────────

describe("payrollGap", () => {
  const base = {
    openingCash: usd(100_000),
    asOfMs: ASOF,
    horizonDays: 30,
    expectedInflows: [],
  };

  it("stays UNKNOWN when no payroll run is recorded — silence is not safety", () => {
    const f = unwrap(payrollGap({ ...base, obligations: [obligation({ id: "o1" })] }));
    expect(f.state).toBe("unknown");
    if (f.state === "unknown") expect(f.needs).toMatch(/payroll/i);
  });

  it("stays UNKNOWN when opening cash is missing", () => {
    const f = unwrap(
      payrollGap({
        ...base,
        openingCash: null,
        obligations: [obligation({ id: "o1", kind: "payroll" })],
      }),
    );
    expect(f.state).toBe("unknown");
  });

  it("reports coverage when every payroll run clears", () => {
    const g = mustKnow(
      unwrap(
        payrollGap({
          ...base,
          obligations: [obligation({ id: "o1", kind: "payroll", amount: usd(40_000) })],
        }),
      ),
    );
    expect(g).toEqual({ covered: true, firstShortfallAt: null, shortfall: null });
  });

  it("calls a shortfall on the first payroll that cannot clear, at the trough", () => {
    const g = mustKnow(
      unwrap(
        payrollGap({
          ...base,
          openingCash: usd(90_000),
          // The receipt lands the same day, but payroll settles first — so it does NOT rescue it.
          expectedInflows: [{ atMs: ASOF + 5 * DAY, amount: usd(50_000) }],
          obligations: [
            obligation({ id: "o1", kind: "payroll", amount: usd(100_000), dueAt: ASOF + 5 * DAY }),
          ],
        }),
      ),
    );
    expect(g.covered).toBe(false);
    expect(g.firstShortfallAt).toBe(ASOF + 5 * DAY);
    expect(g.shortfall?.minor).toBe(10_000);
  });

  it("clears a payroll run that lands the balance on EXACTLY zero", () => {
    // Mutation-found gap: `low.minor >= 0` vs `> 0` decides whether being exactly broke on payday
    // is a shortfall. It is not — payroll cleared, and reporting a $0.00 shortfall is a false alarm.
    const g = mustKnow(
      unwrap(
        payrollGap({
          ...base,
          openingCash: usd(50_000),
          obligations: [obligation({ id: "o1", kind: "payroll", amount: usd(50_000) })],
        }),
      ),
    );
    expect(g).toEqual({ covered: true, firstShortfallAt: null, shortfall: null });
  });

  it("names the FIRST failing run when several would fail", () => {
    const g = mustKnow(
      unwrap(
        payrollGap({
          ...base,
          openingCash: usd(10_000),
          obligations: [
            obligation({ id: "o2", kind: "payroll", amount: usd(50_000), dueAt: ASOF + 20 * DAY }),
            obligation({ id: "o1", kind: "payroll", amount: usd(50_000), dueAt: ASOF + 10 * DAY }),
          ],
        }),
      ),
    );
    expect(g.firstShortfallAt).toBe(ASOF + 10 * DAY);
    expect(g.shortfall?.minor).toBe(40_000);
  });

  it("ignores a payroll run past the horizon rather than pretending to see it", () => {
    const f = unwrap(
      payrollGap({
        ...base,
        obligations: [obligation({ id: "o1", kind: "payroll", dueAt: ASOF + 60 * DAY })],
      }),
    );
    expect(f.state).toBe("unknown");
  });
});

// ── Source authority / double-count refusal ───────────────────────────────────────────────

describe("reconcilePayments", () => {
  const win = { startMs: ASOF - 90 * DAY, endMs: ASOF };
  const books = (payments: readonly Payment[]) => ({
    authority: "accounting_authority" as const,
    window: win,
    payments,
  });
  const rail = (payments: readonly Payment[]) => ({
    authority: "payment_rail" as const,
    window: win,
    payments,
  });

  it("believes the books and drops the rail's copy of the same invoice", () => {
    const booked = payment({ id: "qb1", invoiceId: "inv1", paidAt: ASOF - 200 * DAY });
    const railCopy = payment({
      id: "st1",
      invoiceId: "inv1",
      paidAt: ASOF - 200 * DAY,
      authority: "payment_rail",
      ref: ref("st1", "stripe", "charge"),
    });
    const r = reconcilePayments([books([booked]), rail([railCopy])]);
    expect(r.included.map((p) => p.ref.id)).toEqual(["qb1"]);
    expect(r.excluded[0]?.because).toMatch(/already booked/i);
  });

  it("drops an unlinked rail charge that falls inside the books' coverage window", () => {
    const railInWindow = payment({
      id: "st2",
      invoiceId: null,
      paidAt: ASOF - 10 * DAY,
      authority: "payment_rail",
      ref: ref("st2", "stripe", "charge"),
    });
    const r = reconcilePayments([books([]), rail([railInWindow])]);
    expect(r.included).toHaveLength(0);
    expect(r.excluded[0]?.because).toMatch(/coverage window/i);
  });

  it("keeps a rail charge the books never covered", () => {
    const outside = payment({
      id: "st3",
      invoiceId: null,
      paidAt: ASOF + 5 * DAY,
      authority: "payment_rail",
      ref: ref("st3", "stripe", "charge"),
    });
    const r = reconcilePayments([books([]), rail([outside])]);
    expect(r.included.map((p) => p.ref.id)).toEqual(["st3"]);
  });

  it("keeps every rail charge when no accounting authority is connected", () => {
    const a = payment({
      id: "st4",
      authority: "payment_rail",
      ref: ref("st4", "stripe", "charge"),
    });
    const r = reconcilePayments([rail([a])]);
    expect(r.included.map((p) => p.ref.id)).toEqual(["st4"]);
  });

  it("never counts a supplemental or user-confirmed source as a receipt", () => {
    for (const authority of ["supplemental", "user_confirmed_obligation"] as const) {
      const p = payment({ id: `x_${authority}`, authority });
      const r = reconcilePayments([{ authority, window: win, payments: [p] }]);
      expect(r.included).toHaveLength(0);
    }
  });

  it("totals only what survived reconciliation, and refuses a mixed-currency total", () => {
    const a = payment({ id: "qb1", amount: usd(1_000) });
    const b = payment({ id: "qb2", amount: usd(2_500) });
    const r = reconcilePayments([books([a, b])]);
    expect(unwrap(receiptsTotal(r, "USD")).minor).toBe(3_500);
    const mixed = reconcilePayments([books([a, payment({ id: "qb3", amount: eur(1) })])]);
    expect(receiptsTotal(mixed, "USD").ok).toBe(false);
  });
});

// ── Coverage and confidence ───────────────────────────────────────────────────────────────

describe("coverageOf / confidenceFor", () => {
  const meta = (provider: Provider, authority: SourceAuthority, capped = false) => ({
    provider,
    authority,
    retrievedAt: ASOF,
    window: { startMs: ASOF - 30 * DAY, endMs: ASOF },
    capped,
    sources: [],
  });

  it("reports nothing seen as `unavailable`, never as a zero-confidence total", () => {
    expect(confidenceFor(coverageOf([]))).toBe("unavailable");
    const down: Projection<never>[] = [
      { state: "unavailable", provider: "stripe", because: "token revoked" },
    ];
    const c = coverageOf(down);
    expect(c.providers).toEqual(["stripe"]);
    expect(c.authorities).toEqual([]);
    expect(c.missing).toEqual(["stripe"]);
    expect(confidenceFor(c)).toBe("unavailable");
  });

  it("gives a clean set of books high confidence and a capped one medium", () => {
    const clean: Projection<number>[] = [
      { state: "ready", meta: meta("quickbooks", "accounting_authority"), items: [] },
    ];
    expect(confidenceFor(coverageOf(clean))).toBe("high");
    const capped: Projection<number>[] = [
      {
        state: "partial",
        meta: meta("quickbooks", "accounting_authority", true),
        items: [],
        missing: "invoices beyond page cap",
      },
    ];
    const c = coverageOf(capped);
    expect(c.capped).toBe(true);
    expect(c.partial).toBe(true);
    expect(confidenceFor(c)).toBe("medium");
  });

  it("caps a rails-only read at medium, and a degraded rails-only read at low", () => {
    const rails: Projection<number>[] = [
      { state: "ready", meta: meta("stripe", "payment_rail"), items: [] },
    ];
    expect(confidenceFor(coverageOf(rails))).toBe("medium");
    const degraded: Projection<number>[] = [
      ...rails,
      { state: "unavailable", provider: "quickbooks", because: "not connected" },
    ];
    expect(confidenceFor(coverageOf(degraded))).toBe("low");
  });

  it("never lets a supplemental source exceed low", () => {
    const hs: Projection<number>[] = [
      { state: "ready", meta: meta("hubspot", "supplemental"), items: [] },
    ];
    expect(confidenceFor(coverageOf(hs))).toBe("low");
  });

  it("never IMPROVES confidence when data degrades — every permutation", () => {
    const subsets: SourceAuthority[][] = [];
    for (let mask = 1; mask < 1 << SOURCE_AUTHORITIES.length; mask++) {
      subsets.push(SOURCE_AUTHORITIES.filter((_, i) => (mask >> i) & 1));
    }
    const base = (authorities: SourceAuthority[]): Coverage => ({
      providers: ["quickbooks"],
      authorities,
      capped: false,
      partial: false,
      missing: [],
    });
    const rank = (c: Coverage): number => CONFIDENCE_RANK[confidenceFor(c)];
    for (const authorities of subsets) {
      const clean = base(authorities);
      for (const capped of [false, true]) {
        for (const partial of [false, true]) {
          for (const missing of [[], ["stripe"]]) {
            const degraded: Coverage = { ...clean, capped, partial, missing };
            expect(rank(degraded)).toBeLessThanOrEqual(rank(clean));
          }
        }
      }
    }
  });

  it("returns every legal confidence and nothing else", () => {
    const seen = new Set<FinanceConfidence>();
    for (const authorities of [
      [],
      ["accounting_authority"],
      ["payment_rail"],
      ["supplemental"],
    ] as SourceAuthority[][]) {
      for (const capped of [false, true]) {
        seen.add(
          confidenceFor({
            providers: [],
            authorities,
            capped,
            partial: false,
            missing: [],
          }),
        );
      }
    }
    expect([...seen].sort()).toEqual(["high", "low", "medium", "unavailable"]);
  });

  it("attaches the not-advice notice to every result it hands out", () => {
    const r = financeResult(42, coverageOf([]));
    expect(r.value).toBe(42);
    expect(r.confidence).toBe("unavailable");
    expect(r.notice).toMatch(/not financial, tax or accounting advice/);
  });
});
