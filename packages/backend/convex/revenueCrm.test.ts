// The CRM attention adapter (28-10 Task 2, REVN-04).
//
// The pure ranking is proven in `packages/revenue/src/crm.test.ts`. What this file proves is
// everything the ADAPTER is responsible for, and all of it is about not building a second CRM:
//
//  1. SUPPRESSION SURVIVES THE JOIN. Phase 19 keys do-not-contact by ADDRESS, so honouring it means
//     comparing addresses server-side. This proves that comparison happens, is case-insensitive,
//     and that the address never reaches the output.
//  2. THE PROVIDER JOIN CARRIES ONLY AN OPAQUE ID — and only for `kind: "contact"` rows.
//  3. NOTHING IS FABRICATED FROM ROW METADATA. `_creationTime` is not an activity date.
//  4. TWO TENANTS NEVER SEE EACH OTHER, asserted with rows that WOULD rank if they leaked.
//  5. THE MODULE WRITES NOTHING. A read surface that can write is the second CRM.
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.*s");
const rawSources = import.meta.glob("./**/*.ts", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

const DAY = 86_400_000;

async function harness() {
  const t = convexTest(schema, modules);
  const a = await t.run((ctx) => ctx.db.insert("users", {}));
  const b = await t.run((ctx) => ctx.db.insert("users", {}));
  return {
    t,
    tenantA: String(a),
    tenantB: String(b),
    asA: t.withIdentity({ subject: `${a}|s` }),
    asB: t.withIdentity({ subject: `${b}|s` }),
  };
}
type Harness = Awaited<ReturnType<typeof harness>>;

const addContact = (h: Harness, tenantId: string, over: Record<string, unknown> = {}) =>
  h.t.run((ctx) =>
    ctx.db.insert("contacts", {
      tenantId,
      origin: "user-entered",
      createdAt: 1,
      updatedAt: 1,
      email: "unset@example.test",
      ...over,
    }),
  );

const addFollowUp = (
  h: Harness,
  tenantId: string,
  contactId: unknown,
  dueAt: number,
  status: "open" | "done" | "canceled" = "open",
) =>
  h.t.run((ctx) =>
    ctx.db.insert("followUps", {
      tenantId,
      contactId: contactId as never,
      note: "call them",
      dueAt,
      status,
      createdAt: 1,
    }),
  );

const list = (h: Harness, who: "asA" | "asB" = "asA") =>
  h[who].query(api.revenueCrm.attentionList, {});

describe("suppression survives the address join", () => {
  test("a suppressed contact is absent even with an overdue follow-up", async () => {
    const h = await harness();
    const id = await addContact(h, h.tenantA, { email: "gone@example.test" });
    await addFollowUp(h, h.tenantA, id, Date.now() - DAY);
    await h.t.run((ctx) =>
      ctx.db.insert("suppressions", {
        tenantId: h.tenantA,
        address: "gone@example.test",
        suppressedAt: 1,
        source: "user-marked",
      }),
    );
    expect((await list(h)).rows).toEqual([]);
  });

  // Phase 19 stores what the user typed. A case-sensitive comparison would silently re-admit
  // someone who asked not to be contacted — the worst possible direction for this bug.
  test("the address match is case-insensitive in both directions", async () => {
    const h = await harness();
    const id = await addContact(h, h.tenantA, { email: "Mixed.Case@Example.test" });
    await addFollowUp(h, h.tenantA, id, Date.now() - DAY);
    await h.t.run((ctx) =>
      ctx.db.insert("suppressions", {
        tenantId: h.tenantA,
        address: "mixed.case@example.TEST",
        suppressedAt: 1,
        source: "user-marked",
      }),
    );
    expect((await list(h)).rows).toEqual([]);
  });

  // NON-VACUITY for both tests above: the identical row WITHOUT the suppression must rank, or
  // they would pass on a contact that was never going to appear.
  test("the same contact WITHOUT a suppression does rank", async () => {
    const h = await harness();
    const id = await addContact(h, h.tenantA, { email: "here@example.test" });
    await addFollowUp(h, h.tenantA, id, Date.now() - DAY);
    const rows = (await list(h)).rows;
    expect(rows).toHaveLength(1);
    expect(rows[0]?.reasons).toEqual(["follow_up_overdue"]);
  });

  // Suppression is per-tenant. Tenant B suppressing an address must not silence tenant A.
  test("another tenant's suppression does not silence this tenant", async () => {
    const h = await harness();
    const id = await addContact(h, h.tenantA, { email: "shared@example.test" });
    await addFollowUp(h, h.tenantA, id, Date.now() - DAY);
    await h.t.run((ctx) =>
      ctx.db.insert("suppressions", {
        tenantId: h.tenantB,
        address: "shared@example.test",
        suppressedAt: 1,
        source: "user-marked",
      }),
    );
    expect((await list(h)).rows).toHaveLength(1);
  });
});

describe("the output carries ids and closed enums, never a person", () => {
  test("no name, email or company reaches a ranked row", async () => {
    const h = await harness();
    const id = await addContact(h, h.tenantA, {
      email: "jane@acme.test",
      name: "Jane Doe",
      company: "Acme Industries",
    });
    await addFollowUp(h, h.tenantA, id, Date.now() - DAY);
    const serialized = JSON.stringify((await list(h)).rows);
    for (const leak of ["jane@acme.test", "Jane Doe", "Acme Industries"]) {
      expect(serialized).not.toContain(leak);
    }
  });

  test("the provider join carries an opaque id and only for contact-kind refs", async () => {
    const h = await harness();
    const id = await addContact(h, h.tenantA, { email: "linked@example.test" });
    await addFollowUp(h, h.tenantA, id, Date.now() - DAY);
    await h.t.run((ctx) =>
      ctx.db.insert("contactProviderRefs", {
        tenantId: h.tenantA,
        contactId: id,
        provider: "hubspot",
        kind: "deal",
        externalId: "deal_should_not_link",
        linkedAt: 1,
        updatedAt: 1,
      }),
    );
    // A DEAL ref is not a person ref. Treating it as one would attribute a deal's identity to a
    // contact and start the second CRM by accident.
    expect((await list(h)).rows[0]?.provenance).toEqual({ pikar: true, provider: false });

    await h.t.run((ctx) =>
      ctx.db.insert("contactProviderRefs", {
        tenantId: h.tenantA,
        contactId: id,
        provider: "hubspot",
        kind: "contact",
        externalId: "hs_contact_1",
        linkedAt: 1,
        updatedAt: 1,
      }),
    );
    expect((await list(h)).rows[0]?.provenance).toEqual({ pikar: true, provider: true });
  });
});

describe("nothing is fabricated from row metadata", () => {
  // A contact row always has `_creationTime`. Using it as "last activity" would make every
  // imported contact look freshly touched, and every old one look newly quiet.
  test("a contact with no follow-up and no activity does not appear at all", async () => {
    const h = await harness();
    await addContact(h, h.tenantA, { email: "quiet@example.test" });
    const view = await list(h);
    expect(view.rows).toEqual([]);
    // It WAS scanned — so the empty list is a judgment, not an empty read.
    expect(view.scanned).toBe(1);
  });

  test("a closed or cancelled follow-up is not a reason", async () => {
    const h = await harness();
    const id = await addContact(h, h.tenantA, { email: "done@example.test" });
    await addFollowUp(h, h.tenantA, id, Date.now() - DAY, "done");
    await addFollowUp(h, h.tenantA, id, Date.now() - DAY, "canceled");
    expect((await list(h)).rows).toEqual([]);
  });

  // The EARLIEST open follow-up decides. A later one does not make an earlier one less overdue.
  test("the earliest open follow-up wins, not the last one inserted", async () => {
    const h = await harness();
    const id = await addContact(h, h.tenantA, { email: "two@example.test" });
    await addFollowUp(h, h.tenantA, id, Date.now() + 10 * DAY);
    await addFollowUp(h, h.tenantA, id, Date.now() - DAY);
    expect((await list(h)).rows[0]?.reasons).toEqual(["follow_up_overdue"]);
  });

  test("coverage is `local` — an honest name for no provider, not a degraded state", async () => {
    const h = await harness();
    expect((await list(h)).coverage).toBe("local");
  });
});

describe("tenant isolation, asserted with rows that WOULD rank if they leaked", () => {
  test("tenant A never sees tenant B's contacts", async () => {
    const h = await harness();
    const bId = await addContact(h, h.tenantB, { email: "b@example.test" });
    await addFollowUp(h, h.tenantB, bId, Date.now() - DAY);
    const aId = await addContact(h, h.tenantA, { email: "a@example.test" });
    await addFollowUp(h, h.tenantA, aId, Date.now() - DAY);

    const a = await list(h, "asA");
    const b = await list(h, "asB");
    expect(a.rows).toHaveLength(1);
    expect(b.rows).toHaveLength(1);
    // Non-vacuity: both tenants have a ranking row, so a leak would have shown TWO.
    expect(a.rows[0]?.contactId).not.toBe(b.rows[0]?.contactId);
  });

  test("another tenant's follow-up cannot rank this tenant's contact", async () => {
    const h = await harness();
    const aId = await addContact(h, h.tenantA, { email: "a@example.test" });
    // A follow-up row owned by B, pointing at A's contact. The by_tenant index is the only thing
    // between this and a cross-tenant ranking.
    await addFollowUp(h, h.tenantB, aId, Date.now() - DAY);
    expect((await list(h, "asA")).rows).toEqual([]);
  });

  test("the internal read is tenant-scoped by ARGUMENT and returns the same answer", async () => {
    const h = await harness();
    const aId = await addContact(h, h.tenantA, { email: "a@example.test" });
    await addFollowUp(h, h.tenantA, aId, Date.now() - DAY);
    const internalView = await h.t.query(internal.revenueCrm.attentionForTenant, {
      tenantId: h.tenantA,
    });
    expect(internalView.rows).toEqual((await list(h, "asA")).rows);
    expect(
      (await h.t.query(internal.revenueCrm.attentionForTenant, { tenantId: h.tenantB })).rows,
    ).toEqual([]);
  });
});

describe("pulse refuses to be healthy on a read that did not happen", () => {
  test("an unavailable coverage is unknown", async () => {
    const h = await harness();
    const id = await addContact(h, h.tenantA, { email: "p@example.test" });
    expect(
      await h.asA.query(api.revenueCrm.contactPulse, { contactId: id, coverage: "unavailable" }),
    ).toBe("unknown");
  });

  test("an overdue follow-up is watch", async () => {
    const h = await harness();
    const id = await addContact(h, h.tenantA, { email: "p@example.test" });
    await addFollowUp(h, h.tenantA, id, Date.now() - DAY);
    expect(
      await h.asA.query(api.revenueCrm.contactPulse, { contactId: id, coverage: "ready" }),
    ).toBe("watch");
  });

  // `ctx.db.get` takes a caller-supplied id, so the row's tenant is checked here or not at all.
  test("a contact id belonging to ANOTHER tenant reports unknown, never that tenant's pulse", async () => {
    const h = await harness();
    const bId = await addContact(h, h.tenantB, { email: "b@example.test" });
    await addFollowUp(h, h.tenantB, bId, Date.now() - DAY);
    // For B this is `watch`; A must not be able to read that.
    expect(
      await h.asB.query(api.revenueCrm.contactPulse, { contactId: bId, coverage: "ready" }),
    ).toBe("watch");
    expect(
      await h.asA.query(api.revenueCrm.contactPulse, { contactId: bId, coverage: "ready" }),
    ).toBe("unknown");
  });
});

describe("the module cannot write — a read surface that writes is the second CRM", () => {
  test("revenueCrm.ts declares no mutation, action or db write", () => {
    const src = rawSources["./revenueCrm.ts"];
    if (src === undefined) throw new Error("no raw source for revenueCrm.ts — the scan is vacuous");
    expect(src.length).toBeGreaterThan(1000);
    for (const forbidden of [
      "tenantMutation(",
      "internalMutation(",
      "tenantAction(",
      "ctx.db.insert",
      "ctx.db.patch",
      "ctx.db.replace",
      "ctx.db.delete",
    ]) {
      expect(src, `revenueCrm.ts must not contain ${forbidden}`).not.toContain(forbidden);
    }
  });
});
