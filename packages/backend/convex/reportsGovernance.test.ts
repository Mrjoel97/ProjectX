// RPRT-01 governance plane (plan 26-15).
//
// Three kinds of evidence, and they prove different things:
//   • BEHAVIOURAL — tenant isolation, owner gating, cursor stability, window bounds.
//   • LEAKAGE — needle scans over the SERIALIZED result. `audit.payload` is `v.any()` and the
//     table already holds a nested object (`piiCounts`), so "no content reached the browser" has
//     to be measured against the bytes, not argued from the type.
//   • A SOURCE SCAN — the allowlist in `@pikar/contracts/auditProjection` must not drift from the
//     event literals the 96 production write sites actually emit. A projection that silently
//     shells out a real event is the failure mode nobody notices, because it renders fine.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { AUDIT_VIEWER_EVENTS } from "@pikar/contracts/auditProjection";
import { convexTest } from "convex-test";
import { describe, expect, test, vi } from "vitest";
import aggregateSchema from "../node_modules/@convex-dev/aggregate/src/component/schema.js";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.*s");
const aggregateModules = import.meta.glob(
  "../node_modules/@convex-dev/aggregate/src/component/**/!(*.test).ts",
);

function harness() {
  const t = convexTest(schema, modules);
  t.registerComponent("auditCounts", aggregateSchema, aggregateModules);
  return t;
}

const NOW = 1_754_460_000_000;
const WINDOW = { sinceMs: NOW - 7 * 24 * 3_600_000, untilMs: NOW + 1, browserTimeZone: "UTC" };

type Seed = {
  tenantId: string;
  ts: number;
  eventType?: string;
  actor?: string;
  correlationId?: string;
  payload?: unknown;
};

const seedAudit = (t: ReturnType<typeof harness>, rows: Seed[]) =>
  t.run(async (ctx) => {
    for (const r of rows) {
      await ctx.db.insert("audit", {
        tenantId: r.tenantId,
        ts: r.ts,
        eventType: r.eventType ?? "plan.discarded",
        actor: r.actor ?? "user",
        correlationId: r.correlationId ?? "c_1",
        payload: r.payload ?? { planId: "k17abc", kind: "media" },
      });
    }
  });

async function ownerHarness() {
  const t = harness();
  const userId = await t.run((ctx) => ctx.db.insert("users", { owner: true }));
  return { t, tenantId: String(userId), as: t.withIdentity({ subject: `${userId}|s` }) };
}

async function tenantHarness() {
  const t = harness();
  const userId = await t.run((ctx) => ctx.db.insert("users", {}));
  return { t, tenantId: String(userId), as: t.withIdentity({ subject: `${userId}|s` }) };
}

describe("reportsGovernance.auditPage — the tenant's own record, sanitized", () => {
  test("projects the tenant's rows and never a foreign tenant's", async () => {
    const { t, tenantId, as } = await tenantHarness();
    await seedAudit(t, [
      { tenantId, ts: NOW - 1_000 },
      { tenantId: "tenant_other", ts: NOW - 500, correlationId: "c_foreign" },
    ]);

    const page = await as.query(api.reportsGovernance.auditPage, WINDOW);

    expect(page.rows).toHaveLength(1);
    expect(page.rows[0]).toMatchObject({ eventType: "plan.discarded", actor: "you", known: true });
    expect(JSON.stringify(page)).not.toContain("c_foreign");
  });

  test("an unauthenticated caller is refused before a row is read", async () => {
    const { t, tenantId } = await tenantHarness();
    await seedAudit(t, [{ tenantId, ts: NOW - 1_000 }]);

    await expect(t.query(api.reportsGovernance.auditPage, WINDOW)).rejects.toThrow();
  });

  test("LEAKAGE: neither raw payload nor the raw actor id survives serialization", async () => {
    const { t, tenantId, as } = await tenantHarness();
    await seedAudit(t, [
      {
        tenantId,
        ts: NOW - 1_000,
        // `actor: ctx.tenantId` is what 8 production write sites pass.
        actor: tenantId,
        eventType: "request.redacted",
        payload: {
          requestId: "req_1",
          safeTextHash: "sha256:abc",
          piiCounts: { email: 2 },
          draft: "Dear Sarah, the Q3 numbers are attached",
          to: "ceo@acme.com",
        },
      },
    ]);

    const page = await as.query(api.reportsGovernance.auditPage, WINDOW);
    const json = JSON.stringify(page);

    expect(page.rows[0]?.refs).toEqual({ requestId: "req_1", safeTextHash: "sha256:abc" });
    expect(page.rows[0]?.actor).toBe("you");
    for (const needle of ["Dear Sarah", "ceo@acme.com", "piiCounts", tenantId]) {
      expect(json, `leaked ${needle}`).not.toContain(needle);
    }
  });

  test("an unknown event renders as a shell, not as a hole in the record", async () => {
    const { t, tenantId, as } = await tenantHarness();
    await seedAudit(t, [
      { tenantId, ts: NOW - 1_000, eventType: "brand.new_event", payload: { secret: "x" } },
    ]);

    const page = await as.query(api.reportsGovernance.auditPage, WINDOW);

    // Present (a governance record with holes is worse than one with shells) and empty.
    expect(page.rows).toHaveLength(1);
    expect(page.rows[0]).toMatchObject({ known: false, refs: {}, category: "other" });
  });

  test("the cursor walks the whole window exactly once, then stops", async () => {
    const { t, tenantId, as } = await tenantHarness();
    await seedAudit(
      t,
      Array.from({ length: 7 }, (_, i) => ({
        tenantId,
        ts: NOW - (i + 1) * 1_000,
        correlationId: `c_${i}`,
      })),
    );

    const seen: string[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < 5; page++) {
      const args: typeof WINDOW & { limit: number; cursor?: string } = { ...WINDOW, limit: 3 };
      if (cursor !== null) args.cursor = cursor;
      const result = await as.query(api.reportsGovernance.auditPage, args);
      seen.push(...result.rows.map((r) => r.correlationRef));
      cursor = result.nextCursor;
      if (cursor === null) break;
    }

    expect(seen).toEqual(["c_0", "c_1", "c_2", "c_3", "c_4", "c_5", "c_6"]);
    expect(new Set(seen).size).toBe(7);
    expect(cursor).toBeNull();
  });

  test("a forged cursor throws — it is a trust boundary, not a fallback to page one", async () => {
    const { t, tenantId, as } = await tenantHarness();
    await seedAudit(t, [{ tenantId, ts: NOW - 1_000 }]);

    // Each of these fails a DIFFERENT clause of `parseDashboardCursor`: no prefix, a non-numeric
    // timestamp, an empty id. A cursor that merely points past the window is NOT malformed and
    // must still be honoured — it is how a stale tab resumes — so it is not in this list.
    for (const cursor of ["garbage", "v1:abc:x", "v1:1754460000000:"]) {
      await expect(
        as.query(api.reportsGovernance.auditPage, { ...WINDOW, cursor }),
      ).rejects.toThrow();
    }

    const stale = await as.query(api.reportsGovernance.auditPage, {
      ...WINDOW,
      cursor: "v1:9999999999999:zzz",
    });
    expect(stale.rows).toHaveLength(1);
  });

  test("the window is half-open and the server owns its ceiling", async () => {
    const { t, tenantId, as } = await tenantHarness();
    await seedAudit(t, [
      { tenantId, ts: WINDOW.sinceMs - 1, correlationId: "c_before" },
      { tenantId, ts: WINDOW.sinceMs, correlationId: "c_start" },
      { tenantId, ts: WINDOW.untilMs, correlationId: "c_end" },
    ]);

    const page = await as.query(api.reportsGovernance.auditPage, WINDOW);
    expect(page.rows.map((r) => r.correlationRef)).toEqual(["c_start"]);

    await expect(
      as.query(api.reportsGovernance.auditPage, {
        ...WINDOW,
        sinceMs: WINDOW.untilMs - 400 * 24 * 3_600_000,
      }),
    ).rejects.toThrow();
  });

  test("a refused ref raises a code-owned signal carrying no payload", async () => {
    const { t, tenantId, as } = await tenantHarness();
    await seedAudit(t, [
      {
        tenantId,
        ts: NOW - 1_000,
        eventType: "plan.discarded",
        // An ALLOWLISTED key holding something that is not a ref: the promise this signal is about.
        payload: { planId: "k1", kind: "a whole sentence of prose" },
      },
    ]);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const page = await as.query(api.reportsGovernance.auditPage, WINDOW);

    expect(page.rows[0]?.refs).toEqual({ planId: "k1" });
    expect(warn).toHaveBeenCalledTimes(1);
    const logged = (warn.mock.calls[0] ?? []).join(" ");
    expect(logged).toContain("plan.discarded");
    expect(logged).not.toContain("prose");
    warn.mockRestore();
  });

  test("a clean page raises no signal — the warning has to stay rare to mean anything", async () => {
    const { t, tenantId, as } = await tenantHarness();
    await seedAudit(t, [{ tenantId, ts: NOW - 1_000 }]);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    await as.query(api.reportsGovernance.auditPage, WINDOW);

    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe("reportsGovernance.wormExport — a cursor position, NOT a health verdict", () => {
  test("a non-owner is refused", async () => {
    const { as } = await tenantHarness();
    await expect(as.query(api.reportsGovernance.wormExport, {})).rejects.toThrow("OWNER_REQUIRED");
  });

  test("never advanced reads as null, never as zero-lag health", async () => {
    const { as } = await ownerHarness();

    const worm = await as.query(api.reportsGovernance.wormExport, {});

    expect(worm.lastCursorAdvanceMs).toBeNull();
    // THE CORRECTION THIS PLAN OWES THE MOCKUP: nothing here may be read as durability.
    // `exportCursors` records that the exporter said it was done, not that S3 kept the object.
    expect(Object.keys(worm)).not.toContain("healthy");
    expect(Object.keys(worm)).not.toContain("status");
  });

  test("reports the cursor and the oldest row behind it, with a capped floor", async () => {
    const { t, tenantId, as } = await ownerHarness();
    await t.run((ctx) =>
      ctx.db.insert("exportCursors", { name: "worm-audit", lastExportedTs: NOW - 5_000 }),
    );
    await seedAudit(t, [
      { tenantId, ts: NOW - 6_000 },
      { tenantId, ts: NOW - 4_000 },
      { tenantId: "tenant_other", ts: NOW - 3_000 },
    ]);

    const worm = await as.query(api.reportsGovernance.wormExport, {});

    expect(worm.lastCursorAdvanceMs).toBe(NOW - 5_000);
    // Deployment-global on purpose — the export is not per tenant.
    expect(worm.rowsAwaitingExport).toBe(2);
    expect(worm.oldestAwaitingMs).toBe(NOW - 4_000);
    expect(worm.awaitingPartial).toBe(false);
  });
});

describe("reportsGovernance.activeSkills — versions, never bodies", () => {
  test("a non-owner is refused before a registry row is read", async () => {
    const { as } = await tenantHarness();
    await expect(as.query(api.reportsGovernance.activeSkills, {})).rejects.toThrow(
      "OWNER_REQUIRED",
    );
  });

  test("returns name/version/status/gated and no body under any key", async () => {
    const { t, as } = await ownerHarness();
    const body = "SECRET-PROMPT-BODY do not disclose";
    await t.run(async (ctx) => {
      await ctx.db.insert("skills", {
        name: "cockpit-agent",
        version: 14,
        body,
        status: "active",
        createdAt: NOW,
      });
      await ctx.db.insert("skills", {
        name: "cockpit-agent",
        version: 15,
        body,
        status: "candidate",
        createdAt: NOW,
      });
      await ctx.db.insert("skills", {
        name: "folder-digest",
        version: 1,
        body,
        status: "active",
        createdAt: NOW,
      });
    });

    const skills = await as.query(api.reportsGovernance.activeSkills, {});

    expect(skills).toContainEqual({
      name: "cockpit-agent",
      version: 14,
      status: "active",
      gated: true,
    });
    expect(skills).toContainEqual({
      name: "folder-digest",
      version: 1,
      status: "active",
      gated: false,
    });
    expect(JSON.stringify(skills)).not.toContain("SECRET-PROMPT-BODY");
  });

  test("a seeded name with no row is absent, not invented at v0", async () => {
    const { as } = await ownerHarness();
    expect(await as.query(api.reportsGovernance.activeSkills, {})).toEqual([]);
  });
});

describe("the allowlist against the write sites it claims to cover", () => {
  const convexDir = dirname(fileURLToPath(import.meta.url));

  function sourceFiles(dir: string): string[] {
    const out: string[] = [];
    for (const entry of readdirSync(dir)) {
      const p = join(dir, entry);
      if (statSync(p).isDirectory()) {
        if (entry !== "_generated" && entry !== "node_modules") out.push(...sourceFiles(p));
      } else if (p.endsWith(".ts") && !p.includes(".test.")) out.push(p);
    }
    return out;
  }

  /**
   * Event names written only by fixtures/probes. They are NOT in the viewer allowlist on purpose —
   * inventing a row for an event production never writes is how 26-14's `DECISION_KEYS` shipped a
   * permanent `edit: 0`.
   */
  const NOT_PRODUCTION = new Set(["test.control", "test.event", "test.before_delete", "x"]);

  /**
   * WHAT THIS PAIR DOES AND DOES NOT CATCH, because a drift guard that is read as total is worse
   * than none. The forward scan sees the DIRECT form (`eventType: "literal"`), which is ~90% of the
   * write sites but NOT the indirect ones — `pipeline.ts` and `calendarComplete.ts` pass the name
   * into a local `audit(...)` helper and `skills.ts` types it as a union, so an event added that
   * way renders as a shell with nothing failing. The reverse scan below is complete: it looks for
   * every allowlisted name anywhere in `convex/` source, so an INVENTED row cannot survive.
   * Invention is the failure that lies to the owner; omission only under-shows. Guard the liar.
   */
  test("every production eventType literal is either allowlisted or explicitly not production", () => {
    const literals = new Set<string>();
    for (const file of sourceFiles(convexDir)) {
      const src = readFileSync(file, "utf8");
      for (const m of src.matchAll(/eventType:\s*"([^"]+)"/g)) if (m[1]) literals.add(m[1]);
    }

    expect(literals.size).toBeGreaterThan(60); // anti-vacuity: the scan really found the write sites
    const unaccounted = [...literals].filter(
      (e) => !NOT_PRODUCTION.has(e) && !Object.hasOwn(AUDIT_VIEWER_EVENTS, e),
    );
    expect(unaccounted, "add these to AUDIT_VIEWER_EVENTS or to NOT_PRODUCTION").toEqual([]);
  });

  test("the allowlist invents no event — every row is a name production writes", () => {
    const literals = new Set<string>();
    for (const file of sourceFiles(convexDir)) {
      const src = readFileSync(file, "utf8");
      for (const m of src.matchAll(/"([a-z][a-z0-9_]*(?:\.[a-z0-9_]+){1,3})"/g))
        if (m[1]) literals.add(m[1]);
    }
    const invented = Object.keys(AUDIT_VIEWER_EVENTS).filter((e) => !literals.has(e));
    expect(invented, "these events appear nowhere in convex/ source").toEqual([]);
  });
});
