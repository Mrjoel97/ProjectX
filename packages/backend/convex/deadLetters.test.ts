import { readFileSync } from "node:fs";
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

// convex-test discovers Convex modules via Vite's import.meta.glob.
const modules = import.meta.glob("./**/*.*s");

/** Seed a deadLetters row for a tenant at a given status (bypasses the insert-only handler). */
async function seedDeadLetter(
  t: ReturnType<typeof convexTest>,
  tenantId: string,
  status: "new" | "replayed" | "resolved",
  fields: { createdAt?: number; workflowId?: string; error?: string } = {},
) {
  return await t.run(async (ctx) =>
    ctx.db.insert("deadLetters", {
      tenantId,
      correlationId: `cid-${crypto.randomUUID()}`,
      workflowId: fields.workflowId ?? `wf-${crypto.randomUUID()}`,
      payload: { requestId: "ref-only" },
      error: fields.error ?? "route_not_implemented",
      status,
      createdAt: fields.createdAt ?? Date.now(),
    }),
  );
}

/** An owner identity. `requireOwner` reads the caller's exact `users` row, so the row must exist. */
async function asOwner(t: ReturnType<typeof convexTest>) {
  const ownerId = await t.run((ctx) => ctx.db.insert("users", { owner: true }));
  return t.withIdentity({ subject: `${ownerId}|s` });
}

describe("operator dead-letter surface (OPSG-07)", () => {
  test("newCount / listNew return only this tenant's status=new rows", async () => {
    const t = convexTest(schema, modules);
    const asA = t.withIdentity({ subject: "user_a" });

    await seedDeadLetter(t, "user_a", "new");
    await seedDeadLetter(t, "user_a", "new");
    await seedDeadLetter(t, "user_a", "resolved"); // resolved is excluded
    await seedDeadLetter(t, "user_b", "new"); // other tenant is invisible

    expect(await asA.query(api.deadLetters.newCount, {})).toBe(2);
    const list = await asA.query(api.deadLetters.listNew, {});
    expect(list).toHaveLength(2);
    expect(list.every((r) => r.tenantId === "user_a" && r.status === "new")).toBe(true);
  });

  test("markResolved flips new -> resolved and clears it from the new-count (badge)", async () => {
    const t = convexTest(schema, modules);
    const asA = t.withIdentity({ subject: "user_a" });

    const id = await seedDeadLetter(t, "user_a", "new");
    expect(await asA.query(api.deadLetters.newCount, {})).toBe(1);

    await asA.mutation(api.deadLetters.markResolved, { id });

    expect(await asA.query(api.deadLetters.newCount, {})).toBe(0);
    expect(await asA.query(api.deadLetters.listNew, {})).toHaveLength(0);
  });

  test("markResolved cannot cross tenants", async () => {
    const t = convexTest(schema, modules);
    const asB = t.withIdentity({ subject: "user_b" });
    const id = await seedDeadLetter(t, "user_a", "new");

    await expect(asB.mutation(api.deadLetters.markResolved, { id })).rejects.toThrow();
    // A's row is untouched.
    expect(await t.withIdentity({ subject: "user_a" }).query(api.deadLetters.newCount, {})).toBe(1);
  });

  test("an unauthenticated read fails closed", async () => {
    const t = convexTest(schema, modules);
    await expect(t.query(api.deadLetters.newCount, {})).rejects.toThrow(/UNAUTHENTICATED/);
  });
});

// ── 25.1-06 (D13): the OPERATOR read, across every tenant ──────────────────────────────────────
//
// The tenant read above has existed since 02-06 and is already wired to `/ops` — the research
// premise that "the DLQ is write-only, no consumer, no listing surface" was WRONG about this repo
// and is corrected in the 25.1-06 summary. What was genuinely missing is the OPERATOR's read: a
// dead letter belonging to any other tenant was invisible to the person who runs the deployment,
// which for a pipeline that writes per-tenant terminals means most failures were unseeable. That is
// what `listAll` is, and it is the only thing it is: no mutation, no re-drive.
describe("D13: the owner can enumerate dead letters ACROSS tenants", () => {
  test("rows from OTHER tenants are visible to the owner, newest first", async () => {
    const t = convexTest(schema, modules);
    const owner = await asOwner(t);

    // Seeded in chronological order, so index order (insertion) and `createdAt` agree — which is
    // true of every real writer: all six insert sites stamp `createdAt: Date.now()` at insert.
    await seedDeadLetter(t, "tenant_a", "new", { createdAt: 1_000, error: "oldest" });
    await seedDeadLetter(t, "tenant_b", "new", { createdAt: 2_000, error: "middle" });
    await seedDeadLetter(t, "tenant_c", "new", { createdAt: 3_000, error: "newest" });

    const result = await owner.query(api.deadLetters.listAll, {});

    expect(result.rows.map((r) => r.error)).toEqual(["newest", "middle", "oldest"]);
    // The whole point: none of these tenants is the owner's own.
    expect(result.rows.map((r) => r.tenantId).sort()).toEqual(["tenant_a", "tenant_b", "tenant_c"]);
    expect(result.truncated).toBe(false);
  });

  test("resolved and replayed rows are NOT in the incident list", async () => {
    const t = convexTest(schema, modules);
    const owner = await asOwner(t);
    await seedDeadLetter(t, "tenant_a", "new", { error: "unresolved" });
    await seedDeadLetter(t, "tenant_a", "resolved", { error: "handled" });
    await seedDeadLetter(t, "tenant_a", "replayed", { error: "replayed_already" });

    const result = await owner.query(api.deadLetters.listAll, {});
    expect(result.rows.map((r) => r.error)).toEqual(["unresolved"]);
  });

  test("the RESPONSE is capped from the newest end, and says when there is more", async () => {
    const t = convexTest(schema, modules);
    const owner = await asOwner(t);
    for (let i = 0; i < 6; i++) {
      await seedDeadLetter(t, "tenant_a", "new", { createdAt: 1_000 + i, error: `e${i}` });
    }

    const result = await owner.query(api.deadLetters.listAll, { limit: 4 });
    expect(result.rows).toHaveLength(4);
    expect(result.truncated).toBe(true);
    // Capped from the NEWEST end — a cap that returned the oldest four would hide the incident
    // that is happening right now.
    expect(result.rows.map((r) => r.error)).toEqual(["e5", "e4", "e3", "e2"]);

    // The cap is the server's, not the caller's: a caller asking for the moon gets the ceiling.
    const greedy = await owner.query(api.deadLetters.listAll, { limit: 100_000 });
    expect(greedy.cap).toBe(200);
    expect(greedy.rows).toHaveLength(6);
  });

  test("the READ is bounded too — which no response assertion above can see", () => {
    // FOUND BY MUTATION, and the reason this test exists as a separate, structural one. Swapping
    // `.take(cap + 1)` for `.collect()` leaves EVERY assertion in the test above GREEN: the slice
    // still caps the payload, `truncated` is still computed correctly, the order is still right.
    // The response is identical. What changes is the READ — and on the deployment where this
    // listing matters most (fifty thousand dead letters) an unbounded scan is a second outage on
    // the screen you are diagnosing the first one from.
    //
    // A behaviour that is invisible in the response has to be pinned where it IS visible. This is a
    // mechanism test and is labelled as one rather than dressed up as a behaviour test.
    const src = readFileSync(new URL("./deadLetters.ts", import.meta.url), "utf8");
    const body = src.slice(
      src.indexOf("export const listAll"),
      src.indexOf("export const markResolved"),
    );
    expect(body, "the listAll body was not found — this scan is vacuous").toContain("ownerQuery");
    expect(body).toMatch(/\.take\(cap \+ 1\)/);
    expect(body).not.toMatch(/\.collect\(\)/);
  });

  test("a non-owner is refused with OWNER_REQUIRED, exactly like every other ops query", async () => {
    const t = convexTest(schema, modules);
    const userId = await t.run((ctx) => ctx.db.insert("users", {}));
    await seedDeadLetter(t, "tenant_a", "new");

    await expect(
      t.withIdentity({ subject: `${userId}|s` }).query(api.deadLetters.listAll, {}),
    ).rejects.toThrow(/OWNER_REQUIRED/);
    // And an unauthenticated caller never reaches the owner check at all.
    await expect(t.query(api.deadLetters.listAll, {})).rejects.toThrow(/UNAUTHENTICATED/);
  });

  test("the projection carries the STORED row and nothing else — no enrichment, no new field", async () => {
    // A key-set pin, not an eyeball (the `media.landed` allow-list idiom). The `deadLetters.payload`
    // column is redaction-safe by contract (CLAUDE.md §4); the risk this pins is the OTHER direction
    // — a future "helpful" join that puts a tenant's name, a user's email or a request's subject on
    // an operator screen that today shows only refs.
    const t = convexTest(schema, modules);
    const owner = await asOwner(t);
    await seedDeadLetter(t, "tenant_a", "new");

    const [row] = (await owner.query(api.deadLetters.listAll, {})).rows;
    expect(Object.keys(row ?? {}).sort()).toEqual(
      [
        "id",
        "tenantId",
        "workflowId",
        // 28.1-05 added `source` DELIBERATELY, which is the whole point of pinning the key set:
        // it is a code-owned enum literal, not a join, and bumping this list is how a reviewer
        // sees that. A field that arrived without this edit would still be red.
        "source",
        "correlationId",
        "error",
        "status",
        "createdAt",
        "payload",
      ].sort(),
    );
    // The payload is passed through byte-identical — never re-shaped, never widened.
    expect(row?.payload).toEqual({ requestId: "ref-only" });
  });

  test("this surface can only READ — no OWNER-scoped mutation exists on this module", () => {
    // D13 shipped the listing and DEFERRED the re-drive (25.1-CONTEXT). Asserted against source
    // rather than trusted to the UI: an owner-scoped mutation here would let one click act on
    // another tenant's row, which is a different decision from being able to SEE it.
    // (`api.deadLetters` is a generated proxy — `Object.keys` on it is empty, so it cannot be the
    // oracle. This scan reads the module.)
    const src = readFileSync(new URL("./deadLetters.ts", import.meta.url), "utf8");
    expect(src.match(/export const (\w+) = ownerQuery/g)).toEqual([
      "export const listAll = ownerQuery",
    ]);
    expect(src).not.toMatch(/ownerMutation|internalMutation/);
    // `markResolved` stays TENANT-scoped: the caller can only ever resolve their own row.
    expect(src).toMatch(/export const markResolved = tenantMutation/);
    expect(src.match(/tenantMutation\(/g)).toHaveLength(1);
  });
});

/**
 * 28.1-05 relaxed `deadLetters.workflowId` to optional and added a `source` discriminator, because
 * a Stripe webhook has no workflow. Synthesizing a fake `workflowId` like `billing:evt_…` would
 * lie to every reader here and on the compliance surface — the field is optional because the FACT
 * is optional.
 *
 * Widen-only: nothing narrows, so no backfill and no migration. These tests pin BOTH directions —
 * a workflow-less row must read, and a row with no `source` (i.e. every row written before this
 * plan) must be reported as `"workflow"` rather than as a missing value.
 */
describe("a dead letter with no workflow still reads (28.1-05)", () => {
  test("a workflow-less billing row inserts and reaches newCount / listNew / markResolved", async () => {
    const t = convexTest(schema, modules);
    const id = await t.run((ctx) =>
      ctx.db.insert("deadLetters", {
        tenantId: "tenant_billing",
        correlationId: "evt_ref",
        source: "billing" as const,
        payload: { stripeCustomerId: "cus_ref" },
        error: "billing_unknown_tenant",
        status: "new" as const,
        createdAt: Date.now(),
      }),
    );
    const asTenant = t.withIdentity({ subject: "tenant_billing" });
    expect(await asTenant.query(api.deadLetters.newCount, {})).toBe(1);

    const listed = await asTenant.query(api.deadLetters.listNew, {});
    expect(listed).toHaveLength(1);
    expect(listed[0]?.workflowId).toBeUndefined();
    expect(listed[0]?.source).toBe("billing");

    await asTenant.mutation(api.deadLetters.markResolved, { id });
    expect(await asTenant.query(api.deadLetters.newCount, {})).toBe(0);
  });

  test("the owner listing renders a workflow-less row and defaults an absent source to `workflow`", async () => {
    const t = convexTest(schema, modules);
    const owner = await asOwner(t);
    // No `source` at all — the shape of every row written before this plan.
    await t.run((ctx) =>
      ctx.db.insert("deadLetters", {
        tenantId: "tenant_legacy",
        correlationId: "cid-legacy",
        workflowId: "wf-legacy",
        payload: { requestId: "ref-only" },
        error: "route_not_implemented",
        status: "new" as const,
        createdAt: Date.now(),
      }),
    );
    await t.run((ctx) =>
      ctx.db.insert("deadLetters", {
        tenantId: "billing:unattributed",
        correlationId: "evt_x",
        source: "billing" as const,
        payload: { stripeCustomerId: "cus_x" },
        error: "billing_unknown_tenant",
        status: "new" as const,
        createdAt: Date.now() + 1,
      }),
    );

    const { rows } = await owner.query(api.deadLetters.listAll, {});
    const bySource = Object.fromEntries(rows.map((r) => [r.correlationId, r]));
    // ABSENT is reported as "workflow", not as undefined: a reader that passed the field straight
    // through would leave the operator screen blank for every historical row.
    expect(bySource["cid-legacy"]?.source).toBe("workflow");
    expect(bySource["cid-legacy"]?.workflowId).toBe("wf-legacy");
    expect(bySource.evt_x?.source).toBe("billing");
    expect(bySource.evt_x?.workflowId).toBeUndefined();
  });

  test("the pipeline writer stamps `workflow` at the write site rather than leaving it inferred", () => {
    // Set at the WRITE site, not derived from "has a workflowId": the two are different claims and
    // only one of them survives a future writer that has both a workflow and another source.
    const src = readFileSync(new URL("./deadLetter.ts", import.meta.url), "utf8");
    expect(src.match(/source: "workflow"/g)).toHaveLength(2);
    // CLAUDE.md §3 / `audit_immutable`: insert-only. No mutating dead-letter or audit function.
    expect(src).not.toMatch(/\.patch\(\s*["']deadLetters["']|db\.(replace|delete)\(/);
  });
});
