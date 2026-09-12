// The BETA-05 isolation assertion for the person store, shipped WITH the module (VALIDATION rows
// 9, 10 and 20). Every test is $0 — no model call, no network, convex-test only.
//
// Subjects are built as `${userId}|session_x` over REAL `users` rows, exactly as `tenant.test.ts`
// does: `requireScope` derives `tenantId` from the segment before the `|`, so a hand-made subject
// that skips this shape silently tests nothing.
import {
  dashboardCursorFor,
  IMPORT_ATTESTATION,
  IMPORT_BATCH_ROWS,
  IMPORT_MATCH_CHUNK,
  parseDashboardCursor,
} from "@pikar/core";
import { convexTest } from "convex-test";
import { describe, expect, test, vi } from "vitest";
// `audit.log` maintains the auditCounts aggregate (audit.ts), so the component must be registered
// or `unsuppress` throws `Component "auditCounts" is not registered`. Relative import — the
// package blocks the deep specifier. Same idiom as audit.test.ts.
import aggregateSchema from "../node_modules/@convex-dev/aggregate/src/component/schema.js";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { upsertContactRow } from "./contacts";
import { hmacHex } from "./gmailAuth";
import schema from "./schema";

const modules = import.meta.glob("./**/*.*s");
const aggregateModules = import.meta.glob(
  "../node_modules/@convex-dev/aggregate/src/component/**/!(*.test).ts",
);

const SECRET = "unsubscribe-test-secret";
const SITE = "https://example.convex.site";
const WORDING = "They ticked the newsletter box at the trade show stand";

type Harness = Awaited<ReturnType<typeof harness>>;

/**
 * Two tenants over real `users` rows.
 *
 * `audit: true` registers the auditCounts component, which the ONE path that reaches
 * `internal.audit.log` (a successful `unsuppress`) needs or it throws `Component "auditCounts" is
 * not registered`. It is OFF by default deliberately: registering it loads the whole aggregate
 * component tree into each in-memory backend, and doing that 40 times pushed the shared vitest
 * fork over its memory budget — `vaultDigest.test.ts` died mid-file under full-suite parallel
 * load while passing in isolation. Four tests need it; the other thirty-six must not pay for it.
 */
async function harness(opts: { audit?: boolean } = {}) {
  const t = convexTest(schema, modules);
  if (opts.audit) t.registerComponent("auditCounts", aggregateSchema, aggregateModules);
  const userA = await t.run((ctx) => ctx.db.insert("users", {}));
  const userB = await t.run((ctx) => ctx.db.insert("users", {}));
  return {
    t,
    tenantA: String(userA),
    tenantB: String(userB),
    asA: t.withIdentity({ subject: `${userA}|session_a` }),
    asB: t.withIdentity({ subject: `${userB}|session_b` }),
  };
}

const contactRows = (h: Harness) => h.t.run((ctx) => ctx.db.query("contacts").collect());
const suppressionRows = (h: Harness) => h.t.run((ctx) => ctx.db.query("suppressions").collect());
const followUpRows = (h: Harness) => h.t.run((ctx) => ctx.db.query("followUps").collect());
const auditRows = (h: Harness) => h.t.run((ctx) => ctx.db.query("audit").collect());

describe("recordMarketingLead C1 single-store boundary", () => {
  test("requires authentication and validates before writing", async () => {
    const h = await harness();
    await expect(
      h.t.mutation(api.contacts.recordMarketingLead, { email: "a@example.com" }),
    ).rejects.toThrow("UNAUTHENTICATED");
    await expect(
      h.asA.mutation(api.contacts.recordMarketingLead, { email: "invalid" }),
    ).rejects.toThrow("MARKETING_EMAIL_INVALID");
    await expect(
      h.asA.mutation(api.contacts.recordMarketingLead, {
        email: "a@example.com",
        consent: { wording: " " },
      }),
    ).rejects.toThrow("CONSENT_WORDING_REQUIRED");
    expect(await contactRows(h)).toEqual([]);
  });
  test("normalizes once, preserves original evidence on duplicates, and isolates tenants", async () => {
    const h = await harness();
    const first = await h.asA.mutation(api.contacts.recordMarketingLead, {
      email: " Lead@Example.com ",
      name: "Lead",
      company: " Company ",
      consent: { wording: WORDING, context: " Trade show " },
    });
    expect(first).toMatchObject({
      created: true,
      consentRecorded: true,
      suppressed: false,
      outboundAllowed: true,
      reason: "approval_required",
    });
    const duplicate = await h.asA.mutation(api.contacts.recordMarketingLead, {
      email: "lead@example.com",
      name: "Updated",
      consent: { wording: "different" },
    });
    expect(duplicate.contactId).toBe(first.contactId);
    const other = await h.asB.mutation(api.contacts.recordMarketingLead, {
      email: "lead@example.com",
    });
    expect(other).toMatchObject({
      created: true,
      consentRecorded: false,
      outboundAllowed: false,
      reason: "consent_missing",
    });
    expect(other.contactId).not.toBe(first.contactId);
    const row = await h.t.run((ctx) => ctx.db.get(first.contactId));
    expect(row).toMatchObject({
      email: "lead@example.com",
      company: "Company",
      origin: "user-entered",
      consentSource: "asserted-by-user",
      consentWording: WORDING,
      consentContext: "Trade show",
      name: "Updated",
    });
    expect(await contactRows(h)).toHaveLength(2);
    expect(await auditRows(h)).toEqual([]);
    expect(await followUpRows(h)).toEqual([]);
  });
  test("existing inbound origin and suppression survive recording with consent", async () => {
    const h = await harness();
    const id = await h.asA.mutation(api.contacts.upsertContact, {
      email: "lead@example.com",
      origin: "inbound",
    });
    await h.asA.mutation(api.contacts.markSuppressed, { address: "lead@example.com" });
    const result = await h.asA.mutation(api.contacts.recordMarketingLead, {
      email: "LEAD@example.com",
      consent: { wording: WORDING },
    });
    expect(result).toMatchObject({
      contactId: id,
      created: false,
      suppressed: true,
      outboundAllowed: false,
      reason: "suppressed",
    });
    expect((await h.t.run((ctx) => ctx.db.get(id)))?.origin).toBe("inbound");
    expect(await suppressionRows(h)).toHaveLength(1);
  });
});

/** The token shape `footerFor` mints and the route splits: `<base64url(tenantId|recipient)>.<hmac>`. */
async function signed(tenantId: string, recipient: string, secret = SECRET) {
  const raw = btoa(`${tenantId}|${recipient}`)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  return { raw, digest: await hmacHex(raw, secret) };
}

// ── Isolation: a second tenant reads nothing and writes nothing (VALIDATION row 9) ────────────

describe("contacts: tenant isolation across every public function (BETA-05 / SC#2)", () => {
  test("upsertContact — B's save of A's address is a SEPARATE row; A's is untouched", async () => {
    const h = await harness();
    const aId = await h.asA.mutation(api.contacts.upsertContact, {
      email: "shared@x.com",
      name: "A's Name",
      origin: "user-entered",
    });
    const bId = await h.asB.mutation(api.contacts.upsertContact, {
      email: "shared@x.com",
      name: "B's Name",
      origin: "user-entered",
    });

    expect(bId).not.toBe(aId);
    const rows = await contactRows(h);
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.tenantId === h.tenantA)?.name).toBe("A's Name");
    expect(rows.find((r) => r.tenantId === h.tenantB)?.name).toBe("B's Name");
  });

  test("assertConsent — B targeting A's contact id throws and writes nothing", async () => {
    const h = await harness();
    const aId = await h.asA.mutation(api.contacts.upsertContact, {
      email: "a@x.com",
      origin: "user-entered",
    });

    await expect(
      h.asB.mutation(api.contacts.assertConsent, { contactId: aId, wording: WORDING }),
    ).rejects.toThrow(/CONTACT_NOT_FOUND/);
    expect((await contactRows(h))[0]?.consentAt).toBeUndefined();
  });

  test("consentRecord — B cannot reproduce A's consent record", async () => {
    const h = await harness();
    const aId = await h.asA.mutation(api.contacts.upsertContact, {
      email: "a@x.com",
      origin: "user-entered",
    });
    await h.asA.mutation(api.contacts.assertConsent, {
      contactId: aId,
      wording: WORDING,
      context: "Trade show, March",
    });

    // A REAL id A created, so the arg validator cannot reject it and pass this for the wrong
    // reason; the refusal has to come from the tenant check inside the handler.
    await expect(h.asB.query(api.contacts.consentRecord, { contactId: aId })).rejects.toThrow(
      /CONTACT_NOT_FOUND/,
    );
    // Non-vacuity: A, over the SAME database, gets the wording back.
    expect((await h.asA.query(api.contacts.consentRecord, { contactId: aId }))?.wording).toBe(
      WORDING,
    );
  });

  test("markSuppressed — B suppressing the same address does NOT suppress it for A", async () => {
    const h = await harness();
    await h.asB.mutation(api.contacts.markSuppressed, { address: "shared@x.com" });

    expect(
      await h.t.query(internal.contacts.isSuppressed, {
        tenantId: h.tenantA,
        recipient: "shared@x.com",
      }),
    ).toBe(false);
    expect(
      await h.t.query(internal.contacts.isSuppressed, {
        tenantId: h.tenantB,
        recipient: "shared@x.com",
      }),
    ).toBe(true);
  });

  test("unsuppress — B cannot lift A's suppression", async () => {
    const h = await harness();
    await h.asA.mutation(api.contacts.markSuppressed, { address: "gone@x.com" });

    await expect(
      h.asB.mutation(api.contacts.unsuppress, { address: "gone@x.com", acknowledged: true }),
    ).rejects.toThrow(/SUPPRESSION_NOT_FOUND/);
    expect(await suppressionRows(h)).toHaveLength(1);
    expect(await auditRows(h)).toHaveLength(0);
  });

  test("createFollowUp — B cannot hang a follow-up off A's contact", async () => {
    const h = await harness();
    const aId = await h.asA.mutation(api.contacts.upsertContact, {
      email: "a@x.com",
      origin: "user-entered",
    });

    await expect(
      h.asB.mutation(api.contacts.createFollowUp, {
        contactId: aId,
        note: "poach",
        dueAt: Date.now(),
      }),
    ).rejects.toThrow(/CONTACT_NOT_FOUND/);
    expect(await followUpRows(h)).toHaveLength(0);
  });

  test("setFollowUpStatus — B cannot close A's follow-up", async () => {
    const h = await harness();
    const fId = await h.asA.mutation(api.contacts.createFollowUp, {
      note: "chase the quote",
      dueAt: Date.now(),
    });

    await expect(
      h.asB.mutation(api.contacts.setFollowUpStatus, { followUpId: fId, status: "done" }),
    ).rejects.toThrow(/FOLLOWUP_NOT_FOUND/);
    expect((await followUpRows(h))[0]?.status).toBe("open");
  });

  test("footerFor / suppressedAmong read ONLY the calling tenant's rows", async () => {
    const h = await harness();
    await h.asA.mutation(api.contacts.markSuppressed, { address: "stop@x.com" });

    expect(
      await h.t.query(internal.contacts.suppressedAmong, {
        tenantId: h.tenantA,
        addresses: ["stop@x.com", "ok@x.com"],
      }),
    ).toEqual(["stop@x.com"]);
    expect(
      await h.t.query(internal.contacts.suppressedAmong, {
        tenantId: h.tenantB,
        addresses: ["stop@x.com", "ok@x.com"],
      }),
    ).toEqual([]);
  });

  // The three Pipeline read models (19-07). Every new PUBLIC function belongs in this block, and
  // the export-set pin at the bottom of the file fails if one is added without landing here.
  test("pipelineTiles — B counts NOTHING of A's substrate", async () => {
    const h = await harness();
    const aId = await h.asA.mutation(api.contacts.upsertContact, {
      email: "a@x.com",
      origin: "user-entered",
    });
    await h.asA.mutation(api.contacts.createFollowUp, {
      contactId: aId,
      note: "chase",
      dueAt: Date.now() - 1000,
    });
    await h.asA.mutation(api.contacts.markSuppressed, { address: "stop@x.com" });

    expect(await h.asB.query(api.contacts.pipelineTiles, {})).toEqual({
      needingAttention: 0,
      followUpsDue: 0,
      consentOnRecord: 0,
      suppressed: 0,
      partial: null,
    });
    // Non-vacuity: A, over the SAME database, sees the rows.
    const forA = await h.asA.query(api.contacts.pipelineTiles, {});
    expect(forA.followUpsDue).toBe(1);
    expect(forA.suppressed).toBe(1);
  });

  test("listContacts — B's page contains no row of A's", async () => {
    const h = await harness();
    await h.asA.mutation(api.contacts.upsertContact, {
      email: "a-only@x.com",
      origin: "user-entered",
    });
    const forB = await h.asB.query(api.contacts.listContacts, {});
    expect(forB.contacts).toEqual([]);
    expect(forB.bound.returned).toBe(0);
    expect((await h.asA.query(api.contacts.listContacts, {})).contacts).toHaveLength(1);
  });

  test("listUnassignedFollowUps — B's page contains no follow-up of A's", async () => {
    const h = await harness();
    await h.asA.mutation(api.contacts.createFollowUp, {
      note: "supplier quote",
      dueAt: Date.now(),
    });
    expect((await h.asB.query(api.contacts.listUnassignedFollowUps, {})).followUps).toEqual([]);
    expect((await h.asA.query(api.contacts.listUnassignedFollowUps, {})).followUps).toHaveLength(1);
  });

  // The bulk import surface (19.1-04). Both are tenant-scoped like everything above them; these
  // are the two rows that keep the export-set pin honest for this phase.
  test("matchExisting — B is told A's address does not exist, and A is told it does", async () => {
    const h = await harness();
    await h.asA.mutation(api.contacts.upsertContact, {
      email: "a-only@x.com",
      name: "A's Name",
      origin: "user-entered",
    });
    expect(await h.asB.query(api.contacts.matchExisting, { emails: ["a-only@x.com"] })).toEqual([
      { email: "a-only@x.com", exists: false, empty: ["name", "company", "phone", "title"] },
    ]);
    // Non-vacuity: A, over the SAME database, is told the truth.
    const forA = await h.asA.query(api.contacts.matchExisting, { emails: ["a-only@x.com"] });
    expect(forA[0]?.exists).toBe(true);
    expect(forA[0]?.empty).toEqual(["company", "phone", "title"]);
  });

  test("importContacts — B's import creates B-SCOPED rows and does not touch A's", async () => {
    const h = await harness();
    await h.asA.mutation(api.contacts.upsertContact, {
      email: "shared@x.com",
      name: "A's Typed Name",
      origin: "user-entered",
    });
    const result = await h.asB.mutation(api.contacts.importContacts, {
      rows: [{ email: "shared@x.com", name: "B's Imported Name", company: "B Corp" }],
      attestation: { wording: IMPORT_ATTESTATION },
    });
    // B saw no existing row, so this is a CREATE for B even though the address exists for A.
    expect(result).toEqual({ created: 1, enriched: 0, unchanged: 0, rejected: [] });

    const rows = await contactRows(h);
    expect(rows).toHaveLength(2);
    const aRow = rows.find((r) => r.tenantId === h.tenantA);
    const bRow = rows.find((r) => r.tenantId === h.tenantB);
    expect(aRow?.name).toBe("A's Typed Name");
    expect(aRow?.origin).toBe("user-entered");
    expect(aRow?.company).toBeUndefined();
    expect(aRow?.consentAt).toBeUndefined();
    expect(bRow?.name).toBe("B's Imported Name");
    expect(bRow?.origin).toBe("imported");
  });
});

describe("contacts: an unauthenticated caller reaches no public function", () => {
  // Enumerated one call per public mutation — a shared loop would need one args shape for all
  // six. The ids are REAL rows A created: the arg validator runs BEFORE the wrapper, so a
  // made-up id would reject as a validator error and pass this test for the wrong reason.
  test("every public mutation throws UNAUTHENTICATED with no identity", async () => {
    const h = await harness();
    const contactId: Id<"contacts"> = await h.asA.mutation(api.contacts.upsertContact, {
      email: "a@x.com",
      origin: "user-entered",
    });
    const followUpId: Id<"followUps"> = await h.asA.mutation(api.contacts.createFollowUp, {
      note: "n",
      dueAt: Date.now(),
    });
    await h.asA.mutation(api.contacts.markSuppressed, { address: "stop@x.com" });

    await expect(
      h.t.mutation(api.contacts.upsertContact, { email: "a@x.com", origin: "user-entered" }),
    ).rejects.toThrow(/UNAUTHENTICATED/);
    await expect(
      h.t.mutation(api.contacts.assertConsent, { contactId, wording: WORDING }),
    ).rejects.toThrow(/UNAUTHENTICATED/);
    await expect(h.t.mutation(api.contacts.markSuppressed, { address: "a@x.com" })).rejects.toThrow(
      /UNAUTHENTICATED/,
    );
    await expect(
      h.t.mutation(api.contacts.unsuppress, { address: "stop@x.com", acknowledged: true }),
    ).rejects.toThrow(/UNAUTHENTICATED/);
    await expect(
      h.t.mutation(api.contacts.createFollowUp, { note: "n", dueAt: Date.now() }),
    ).rejects.toThrow(/UNAUTHENTICATED/);
    await expect(
      h.t.mutation(api.contacts.setFollowUpStatus, { followUpId, status: "done" }),
    ).rejects.toThrow(/UNAUTHENTICATED/);

    // The consent record is content plane, so the anonymous caller must not READ it either.
    await expect(h.t.query(api.contacts.consentRecord, { contactId })).rejects.toThrow(
      /UNAUTHENTICATED/,
    );

    // Nothing the anonymous caller attempted landed.
    expect(await suppressionRows(h)).toHaveLength(1);
    expect((await contactRows(h))[0]?.consentAt).toBeUndefined();
    expect((await followUpRows(h))[0]?.status).toBe("open");
  });
});

// ── Write-surface behaviour ───────────────────────────────────────────────────────────────────

describe("contacts: the write surface", () => {
  test("upsertContact is address-identity — 'Bob@X.com' and '  bob@x.com ' are ONE row", async () => {
    const h = await harness();
    const first = await h.asA.mutation(api.contacts.upsertContact, {
      email: "Bob@X.com",
      name: "Bob",
      origin: "user-entered",
    });
    const second = await h.asA.mutation(api.contacts.upsertContact, {
      email: "  bob@x.com ",
      origin: "mailbox-resolved",
    });

    expect(second).toBe(first);
    const rows = await contactRows(h);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.email).toBe("bob@x.com");
    expect(rows[0]?.name).toBe("Bob"); // a nameless re-save must not erase a name on record
    expect(rows[0]?.origin).toBe("user-entered"); // provenance is set once, on creation
  });

  test("upsertContact refuses a blank email — an empty key would collapse every save", async () => {
    const h = await harness();
    await expect(
      h.asA.mutation(api.contacts.upsertContact, { email: "   ", origin: "user-entered" }),
    ).rejects.toThrow(/CONTACT_EMAIL_REQUIRED/);
    expect(await contactRows(h)).toHaveLength(0);
  });

  // SILENT SITE 1 (19.1-02). `upsertContact`'s arg validator is DELIBERATELY NARROWER than the
  // schema union it writes into: the hand-add form must not be able to claim imported provenance,
  // because "this came out of a file the user uploaded" is a claim only the import path can make.
  // Nothing binds that hand-maintained `v.union` to the schema — widening the schema does NOT
  // widen it, and tsc says nothing either way. THIS TEST IS THE ONLY THING HOLDING THEM APART.
  test("upsertContact REFUSES origin 'imported' — the hand-add form cannot claim a file", async () => {
    const h = await harness();
    await expect(
      h.asA.mutation(api.contacts.upsertContact, {
        email: "a@b.co",
        // `as never` because the arg type already excludes this — the refusal under test is the
        // RUNTIME validator, which is what an untyped caller (the browser) actually meets.
        origin: "imported" as never,
      }),
    ).rejects.toThrow();
    expect(await contactRows(h)).toHaveLength(0);
  });

  test("consent is never defaulted — absent stays absent until asserted", async () => {
    const h = await harness();
    const id = await h.asA.mutation(api.contacts.upsertContact, {
      email: "c@x.com",
      origin: "user-entered",
    });
    expect((await contactRows(h))[0]?.consentAt).toBeUndefined();
    expect((await contactRows(h))[0]?.consentSource).toBeUndefined();

    await h.asA.mutation(api.contacts.assertConsent, {
      contactId: id,
      wording: WORDING,
      context: "Trade show, March",
    });
    const row = (await contactRows(h))[0];
    expect(row?.consentAt).toBeGreaterThan(0);
    expect(row?.consentSource).toBe("asserted-by-user");
    expect(row?.consentWording).toBe(WORDING);
    expect(row?.consentContext).toBe("Trade show, March");
  });

  test("assertConsent refuses blank wording — a timestamp alone is a defaulted consent", async () => {
    const h = await harness();
    const id = await h.asA.mutation(api.contacts.upsertContact, {
      email: "c@x.com",
      origin: "user-entered",
    });
    await expect(
      h.asA.mutation(api.contacts.assertConsent, { contactId: id, wording: "  " }),
    ).rejects.toThrow(/CONSENT_WORDING_REQUIRED/);
    expect((await contactRows(h))[0]?.consentAt).toBeUndefined();
  });

  test("consentRecord reproduces the EXACT wording, timestamp and capture context (SC#4)", async () => {
    const h = await harness();
    const contactId = await h.asA.mutation(api.contacts.upsertContact, {
      email: "c@x.com",
      origin: "user-entered",
    });
    // No consent yet ⇒ null, NOT a throw: "none on record" is the truth for most contacts.
    expect(await h.asA.query(api.contacts.consentRecord, { contactId })).toBeNull();

    await h.asA.mutation(api.contacts.assertConsent, {
      contactId,
      wording: WORDING,
      context: "Trade show, March",
    });
    const record = await h.asA.query(api.contacts.consentRecord, { contactId });
    // Byte-for-byte, not a substring: the point of storing the wording is handing back what was
    // shown. `listContacts` deliberately drops both text fields, so THIS is the only reader.
    expect(record?.wording).toBe(WORDING);
    expect(record?.context).toBe("Trade show, March");
    expect(record?.source).toBe("asserted-by-user");
    expect(record?.at).toBe((await contactRows(h))[0]?.consentAt);

    // A context that was never supplied is null, never "" — absent and empty are different facts.
    const bare = await h.asA.mutation(api.contacts.upsertContact, {
      email: "bare@x.com",
      origin: "user-entered",
    });
    await h.asA.mutation(api.contacts.assertConsent, {
      contactId: bare,
      wording: "Verbal, in person",
    });
    expect(await h.asA.query(api.contacts.consentRecord, { contactId: bare })).toEqual({
      at: expect.any(Number),
      source: "asserted-by-user",
      wording: "Verbal, in person",
      context: null,
    });
  });

  test("markSuppressed is idempotent — twice is ONE suppressions row, same timestamp", async () => {
    const h = await harness();
    await h.asA.mutation(api.contacts.markSuppressed, { address: "Stop@X.com" });
    const first = (await suppressionRows(h))[0];
    await h.asA.mutation(api.contacts.markSuppressed, { address: " stop@x.com " });

    const rows = await suppressionRows(h);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.address).toBe("stop@x.com");
    expect(rows[0]?.source).toBe("user-marked");
    // A replay must not rewrite WHEN they asked to stop.
    expect(rows[0]?.suppressedAt).toBe(first?.suppressedAt);
  });

  test("markSuppressed mirrors onto an existing contact and needs none to succeed", async () => {
    const h = await harness();
    await h.asA.mutation(api.contacts.upsertContact, {
      email: "stop@x.com",
      origin: "user-entered",
    });
    await h.asA.mutation(api.contacts.markSuppressed, { address: "stop@x.com" });
    expect((await contactRows(h))[0]?.unsubscribedAt).toBeGreaterThan(0);

    // No contact row for this one: the suppression still lands (suppression outlives the contact).
    await h.asA.mutation(api.contacts.markSuppressed, { address: "orphan@x.com" });
    expect(await suppressionRows(h)).toHaveLength(2);
    expect(await contactRows(h)).toHaveLength(1);
  });

  test("unsuppress WITHOUT acknowledged:true throws and leaves the suppression intact", async () => {
    const h = await harness();
    await h.asA.mutation(api.contacts.markSuppressed, { address: "stop@x.com" });

    await expect(
      h.asA.mutation(api.contacts.unsuppress, { address: "stop@x.com", acknowledged: false }),
    ).rejects.toThrow(/UNSUPPRESS_NOT_ACKNOWLEDGED/);
    expect(await suppressionRows(h)).toHaveLength(1);
    expect(await auditRows(h)).toHaveLength(0);
    expect(
      await h.t.query(internal.contacts.isSuppressed, {
        tenantId: h.tenantA,
        recipient: "stop@x.com",
      }),
    ).toBe(true);
  });

  test("unsuppress with the deliberate confirm deletes the row and clears the mirror", async () => {
    const h = await harness({ audit: true });
    await h.asA.mutation(api.contacts.upsertContact, {
      email: "stop@x.com",
      origin: "user-entered",
    });
    await h.asA.mutation(api.contacts.markSuppressed, { address: "stop@x.com" });
    await h.asA.mutation(api.contacts.unsuppress, { address: "stop@x.com", acknowledged: true });

    expect(await suppressionRows(h)).toHaveLength(0);
    expect((await contactRows(h))[0]?.unsubscribedAt).toBeUndefined();
  });

  test("createFollowUp with NO contactId succeeds — free-standing follow-ups are allowed", async () => {
    const h = await harness();
    await h.asA.mutation(api.contacts.createFollowUp, {
      note: "chase the supplier quote",
      dueAt: 1_800_000_000_000,
    });
    const rows = await followUpRows(h);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.contactId).toBeUndefined();
    expect(rows[0]?.status).toBe("open");
  });

  test("createFollowUp refuses a non-finite dueAt — it could never be due, or be found", async () => {
    const h = await harness();
    await expect(
      h.asA.mutation(api.contacts.createFollowUp, { note: "n", dueAt: Number.NaN }),
    ).rejects.toThrow(/FOLLOWUP_DUEAT_REQUIRED/);
    await expect(
      h.asA.mutation(api.contacts.createFollowUp, {
        note: "n",
        dueAt: Number.POSITIVE_INFINITY,
      }),
    ).rejects.toThrow(/FOLLOWUP_DUEAT_REQUIRED/);
    expect(await followUpRows(h)).toHaveLength(0);
  });

  test("setFollowUpStatus: done stamps completedAt, canceled does NOT, re-open clears it", async () => {
    const h = await harness();
    const id = await h.asA.mutation(api.contacts.createFollowUp, {
      note: "call back",
      dueAt: Date.now(),
    });

    await h.asA.mutation(api.contacts.setFollowUpStatus, { followUpId: id, status: "done" });
    expect((await followUpRows(h))[0]?.completedAt).toBeGreaterThan(0);

    await h.asA.mutation(api.contacts.setFollowUpStatus, { followUpId: id, status: "open" });
    expect((await followUpRows(h))[0]?.completedAt).toBeUndefined();

    await h.asA.mutation(api.contacts.setFollowUpStatus, { followUpId: id, status: "canceled" });
    const row = (await followUpRows(h))[0];
    expect(row?.status).toBe("canceled");
    expect(row?.completedAt).toBeUndefined();
  });
});

// ── The import write rule: fill-empty-only and the consent floor (19.1-03) ────────────────────
// `upsertContactRow` is not a Convex function, so it is exercised in-transaction through `t.run`,
// the same shape `contactRows` uses. EVERY assertion reads the rows back: a reply can agree with
// itself while the write is wrong, and "don't erase" passed for "fill empty only" for a whole phase
// precisely because only the reply-shaped half was tested.

describe("upsertContactRow: fill-empty-only and the consent floor (19.1)", () => {
  /** One seeded contact, then the helper run against it. Returns the helper's reply and the row. */
  const run = (h: Harness, args: Parameters<typeof upsertContactRow>[2]) =>
    h.t.run((ctx) => upsertContactRow(ctx, h.tenantA, args));

  const seed = async (h: Harness, args: Parameters<typeof upsertContactRow>[2]) =>
    (await run(h, args)).id;

  test("fillEmptyOnly: a NAME on record survives a different incoming name", async () => {
    const h = await harness();
    await seed(h, { email: "sarah@x.com", name: "Sarah Chen", origin: "user-entered" });

    const reply = await run(h, {
      email: "sarah@x.com",
      name: "S. CHEN (OLD CRM)",
      origin: "imported",
      fillEmptyOnly: true,
    });

    const rows = await contactRows(h);
    expect(rows).toHaveLength(1);
    // The STORED value is the oracle, never the reply.
    expect(rows[0]?.name).toBe("Sarah Chen");
    expect(reply.filled).toBe(0);
    expect(reply.created).toBe(false);
  });

  test("fillEmptyOnly: an EMPTY company is filled, and counted", async () => {
    const h = await harness();
    await seed(h, { email: "sarah@x.com", name: "Sarah Chen", origin: "user-entered" });

    const reply = await run(h, {
      email: "sarah@x.com",
      name: "Stale Name",
      company: "  Acme Ltd  ",
      phone: "+44 1234",
      origin: "imported",
      fillEmptyOnly: true,
    });

    const row = (await contactRows(h))[0];
    expect(row?.company).toBe("Acme Ltd"); // trimmed
    expect(row?.phone).toBe("+44 1234");
    expect(row?.name).toBe("Sarah Chen"); // still not overwritten
    expect(reply.filled).toBe(2); // company + phone, NOT the refused name
  });

  // NON-VACUITY. The other side of the flag: without it, the OLD rule stands. If this test ever goes
  // red, fill-empty-only has leaked into hand-add and the agent applier — the thing 19.1-03 exists to
  // prevent. Without this test, deleting the flag entirely would leave the block above green.
  test("hand-add (NO flag) still OVERWRITES a name on record — exactly as before this phase", async () => {
    const h = await harness();
    await h.asA.mutation(api.contacts.upsertContact, {
      email: "sarah@x.com",
      name: "Sarah Chen",
      origin: "user-entered",
    });
    await h.asA.mutation(api.contacts.upsertContact, {
      email: "sarah@x.com",
      name: "Sarah Chen-Okoro",
      origin: "user-entered",
    });

    const rows = await contactRows(h);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.name).toBe("Sarah Chen-Okoro");
  });

  test("origin is NOT rewritten — an imported touch cannot restate where a row came from", async () => {
    const h = await harness();
    await seed(h, { email: "sarah@x.com", name: "Sarah", origin: "user-entered" });

    await run(h, {
      email: "sarah@x.com",
      company: "Acme",
      origin: "imported",
      fillEmptyOnly: true,
    });

    expect((await contactRows(h))[0]?.origin).toBe("user-entered");
  });

  test("consent: a row with NONE gains the attestation, stored BYTE-FOR-BYTE", async () => {
    const h = await harness();
    await seed(h, { email: "sarah@x.com", origin: "user-entered" });

    await run(h, {
      email: "sarah@x.com",
      origin: "imported",
      fillEmptyOnly: true,
      consent: {
        source: "imported-attested",
        wording: IMPORT_ATTESTATION,
        context: "  Mailchimp export, March  ",
      },
    });

    const row = (await contactRows(h))[0];
    expect(row?.consentAt).toBeGreaterThan(0);
    expect(row?.consentSource).toBe("imported-attested");
    // Against the CONSTANT, not a re-typed copy — a copy would pass even if the sentence drifted.
    expect(row?.consentWording).toBe(IMPORT_ATTESTATION);
    expect(row?.consentContext).toBe("Mailchimp export, March");
  });

  test("consent NON-DOWNGRADE: asserted-by-user keeps its source, wording AND timestamp", async () => {
    const h = await harness();
    const contactId = await h.asA.mutation(api.contacts.upsertContact, {
      email: "sarah@x.com",
      origin: "user-entered",
    });
    await h.asA.mutation(api.contacts.assertConsent, {
      contactId,
      wording: WORDING,
      context: "Trade show, March",
    });
    // A sentinel rather than a clock read: two writes inside one millisecond would make an
    // "unchanged timestamp" assertion pass while the field was being rewritten.
    await h.t.run((ctx) => ctx.db.patch(contactId, { consentAt: 1_234 }));

    await run(h, {
      email: "sarah@x.com",
      origin: "imported",
      fillEmptyOnly: true,
      consent: { source: "imported-attested", wording: IMPORT_ATTESTATION, context: "CSV" },
    });

    const row = (await contactRows(h))[0];
    expect(row?.consentSource).toBe("asserted-by-user");
    expect(row?.consentWording).toBe(WORDING);
    expect(row?.consentContext).toBe("Trade show, March");
    expect(row?.consentAt).toBe(1_234);
  });

  test("a call that changes NOTHING does not move updatedAt — an unchanged row is untouched", async () => {
    const h = await harness();
    const contactId = await seed(h, {
      email: "sarah@x.com",
      name: "Sarah Chen",
      origin: "user-entered",
    });
    await h.t.run((ctx) => ctx.db.patch(contactId, { updatedAt: 1_234 }));

    const reply = await run(h, {
      email: "sarah@x.com",
      name: "Stale Name",
      origin: "imported",
      fillEmptyOnly: true,
    });

    expect(reply.filled).toBe(0);
    expect((await contactRows(h))[0]?.updatedAt).toBe(1_234);
  });

  test("filled counts the FOUR MAPPABLE FIELDS only — a consent-only write is not an enrichment", async () => {
    const h = await harness();
    await seed(h, { email: "sarah@x.com", name: "Sarah Chen", origin: "user-entered" });

    const reply = await run(h, {
      email: "sarah@x.com",
      origin: "imported",
      fillEmptyOnly: true,
      consent: { source: "imported-attested", wording: IMPORT_ATTESTATION },
    });

    // The consent DID land — this is not a no-op that trivially returns 0.
    expect((await contactRows(h))[0]?.consentSource).toBe("imported-attested");
    expect(reply.filled).toBe(0);
  });
});

// ── The bulk import surface (19.1-04) ─────────────────────────────────────────────────────────
// `matchExisting` is what lets the preview state `N new · M enriched · K unchanged` BEFORE any
// write; `importContacts` is the write. Every assertion about what LANDED reads `contactRows(h)`
// back rather than trusting the reply — a reply agrees with itself, which is how "don't erase"
// passed as "fill empty only" for a whole phase.

describe("contacts: matchExisting states what is already on record, before any write (19.1)", () => {
  test("one entry per REQUESTED address, in request order, naming the empty fields", async () => {
    const h = await harness();
    await h.t.run((ctx) =>
      upsertContactRow(ctx, h.tenantA, {
        email: "known@x.com",
        name: "Known Person",
        company: "Acme",
        origin: "user-entered",
      }),
    );

    const out = await h.asA.query(api.contacts.matchExisting, {
      emails: ["unknown@x.com", "  Known@X.com  "],
    });
    expect(out).toHaveLength(2);
    // An unknown address is `exists: false` with all FOUR fields listed — the preview needs the
    // same shape for both cases or a new row has nothing to count.
    expect(out[0]).toEqual({
      email: "unknown@x.com",
      exists: false,
      empty: ["name", "company", "phone", "title"],
    });
    // Normalized SERVER-side: the padded, mixed-case form found the stored `known@x.com`.
    expect(out[1]?.email).toBe("known@x.com");
    expect(out[1]?.exists).toBe(true);
    expect(out[1]?.empty).toEqual(["phone", "title"]);
  });

  test("an array longer than IMPORT_MATCH_CHUNK is REFUSED, never silently sliced", async () => {
    const h = await harness();
    const emails = Array.from({ length: IMPORT_MATCH_CHUNK + 1 }, (_, i) => `p${i}@x.com`);
    await expect(h.asA.query(api.contacts.matchExisting, { emails })).rejects.toThrow(
      "IMPORT_MATCH_TOO_MANY",
    );
    // Non-vacuity: exactly AT the chunk size it answers, so the refusal is the length rule and not
    // a broken function. A silent slice would under-report and the preview would promise a write
    // it never makes.
    expect(
      await h.asA.query(api.contacts.matchExisting, {
        emails: emails.slice(0, IMPORT_MATCH_CHUNK),
      }),
    ).toHaveLength(IMPORT_MATCH_CHUNK);
  });
});

describe("contacts: importContacts is the write boundary (19.1)", () => {
  const ATTEST = { wording: IMPORT_ATTESTATION, context: "HubSpot export, August 2026" };

  test("a batch of new addresses is CREATED, with origin `imported` on every row", async () => {
    const h = await harness();
    const result = await h.asA.mutation(api.contacts.importContacts, {
      rows: [
        { email: "one@x.com", name: "One", company: "Acme" },
        { email: "TWO@X.com", title: "Head of Two" },
      ],
      attestation: ATTEST,
    });
    expect(result).toEqual({ created: 2, enriched: 0, unchanged: 0, rejected: [] });

    const rows = await contactRows(h);
    expect(rows.map((r) => r.email).sort()).toEqual(["one@x.com", "two@x.com"]);
    for (const row of rows) expect(row.origin).toBe("imported");
    expect(rows.find((r) => r.email === "one@x.com")?.company).toBe("Acme");
    expect(rows.find((r) => r.email === "two@x.com")?.title).toBe("Head of Two");
  });

  test("an existing contact's EMPTY company is filled and counts as enriched — the typed name is not", async () => {
    const h = await harness();
    await h.asA.mutation(api.contacts.upsertContact, {
      email: "sarah@x.com",
      name: "Sarah Chen",
      origin: "user-entered",
    });
    const result = await h.asA.mutation(api.contacts.importContacts, {
      rows: [{ email: "sarah@x.com", name: "S. CHEN (OLD CRM)", company: "Acme", phone: "555" }],
      attestation: ATTEST,
    });
    expect(result).toEqual({ created: 0, enriched: 1, unchanged: 0, rejected: [] });

    const [row] = await contactRows(h);
    // Read BACK: fill-empty-only means the file filled two blanks and left the typed name alone.
    expect(row?.name).toBe("Sarah Chen");
    expect(row?.company).toBe("Acme");
    expect(row?.phone).toBe("555");
    // Provenance is set once, on creation — a file does not restate where a hand-typed row came from.
    expect(row?.origin).toBe("user-entered");
  });

  test("a contact whose four fields are ALL set counts as unchanged — even though it gained consent", async () => {
    const h = await harness();
    await h.t.run((ctx) =>
      upsertContactRow(ctx, h.tenantA, {
        email: "full@x.com",
        name: "Full Row",
        company: "Acme",
        phone: "555",
        title: "CEO",
        origin: "user-entered",
      }),
    );
    const result = await h.asA.mutation(api.contacts.importContacts, {
      rows: [{ email: "full@x.com", name: "Stale", company: "Stale Co", phone: "1", title: "X" }],
      attestation: ATTEST,
    });
    // The counts are over the FOUR MAPPABLE FIELDS ONLY. Counting the consent write as an
    // enrichment would make `unchanged` structurally always 0 and the preview a lie.
    expect(result).toEqual({ created: 0, enriched: 0, unchanged: 1, rejected: [] });

    const [row] = await contactRows(h);
    expect(row?.name).toBe("Full Row");
    // …and the consent record DID land on the row this call reported as unchanged.
    expect(row?.consentSource).toBe("imported-attested");
    expect(row?.consentWording).toBe(IMPORT_ATTESTATION);
  });

  test("a hand-crafted BAD address is refused SERVER-side, and the good rows in the same call still land", async () => {
    const h = await harness();
    const result = await h.asA.mutation(api.contacts.importContacts, {
      rows: [
        { email: "good@x.com", name: "Good" },
        // The browser would never send these — this is a client that skipped the browser.
        { email: "not-an-address", name: "Bad" },
        { email: "   ", name: "Blank" },
        { email: "also-good@x.com" },
      ],
      attestation: ATTEST,
    });
    // One bad row must not discard the good ones in the same transaction: a rejection is data,
    // not a throw.
    expect(result.created).toBe(2);
    expect(result.rejected).toEqual([
      { email: "not-an-address", reason: "not a usable email address" },
      { email: "   ", reason: "not a usable email address" },
    ]);
    expect((await contactRows(h)).map((r) => r.email).sort()).toEqual([
      "also-good@x.com",
      "good@x.com",
    ]);
  });

  test("a batch longer than IMPORT_BATCH_ROWS is refused, and writes NOTHING", async () => {
    const h = await harness();
    const rows = Array.from({ length: IMPORT_BATCH_ROWS + 1 }, (_, i) => ({
      email: `p${i}@x.com`,
    }));
    await expect(
      h.asA.mutation(api.contacts.importContacts, { rows, attestation: ATTEST }),
    ).rejects.toThrow("IMPORT_BATCH_TOO_LARGE");
    expect(await contactRows(h)).toHaveLength(0);
    // Non-vacuity: exactly AT the batch size it writes, so the refusal is the length rule.
    await h.asA.mutation(api.contacts.importContacts, {
      rows: rows.slice(0, IMPORT_BATCH_ROWS),
      attestation: ATTEST,
    });
    expect(await contactRows(h)).toHaveLength(IMPORT_BATCH_ROWS);
  });

  test("a blank-after-trim attestation is refused, and writes NOTHING", async () => {
    const h = await harness();
    await expect(
      h.asA.mutation(api.contacts.importContacts, {
        rows: [{ email: "one@x.com" }],
        attestation: { wording: "   " },
      }),
    ).rejects.toThrow("CONSENT_WORDING_REQUIRED");
    // Refused BEFORE the loop: a consent record with no wording is a defaulted consent wearing a
    // timestamp, and a half-written batch of them is worse.
    expect(await contactRows(h)).toHaveLength(0);
  });

  test("every written contact carries `imported-attested` and the wording BYTE-FOR-BYTE", async () => {
    const h = await harness();
    await h.asA.mutation(api.contacts.importContacts, {
      rows: [{ email: "one@x.com" }, { email: "two@x.com" }],
      attestation: ATTEST,
    });
    for (const row of await contactRows(h)) {
      expect(row.consentSource).toBe("imported-attested");
      // Compared against the constant from @pikar/core, never a re-typed copy: a paraphrase would
      // pass a hand-written literal even after the attestation drifted. It is the evidence.
      expect(row.consentWording).toBe(IMPORT_ATTESTATION);
      expect(row.consentContext).toBe("HubSpot export, August 2026");
      expect(row.consentAt).toBeGreaterThan(0);
    }
  });

  test("an import does NOT downgrade a per-person `asserted-by-user` consent record", async () => {
    const h = await harness();
    const contactId = await h.asA.mutation(api.contacts.upsertContact, {
      email: "spoken-to@x.com",
      origin: "user-entered",
    });
    await h.asA.mutation(api.contacts.assertConsent, { contactId, wording: WORDING });
    await h.asA.mutation(api.contacts.importContacts, {
      rows: [{ email: "spoken-to@x.com", company: "Acme" }],
      attestation: ATTEST,
    });

    const [row] = await contactRows(h);
    // Bulk evidence may never replace evidence recorded for ONE person the user spoke to.
    expect(row?.consentSource).toBe("asserted-by-user");
    expect(row?.consentWording).toBe(WORDING);
    // …while the empty field was still filled by the same call.
    expect(row?.company).toBe("Acme");
  });
});

// ── The audit key-set pin (VALIDATION row 10) ─────────────────────────────────────────────────

describe("contacts: the ONE audit row this module writes carries an id and a hash only", () => {
  test("unsuppress emits exactly {contactId, addressHash} — key-set EQUALITY, not a substring", async () => {
    const h = await harness({ audit: true });
    const contactId = await h.asA.mutation(api.contacts.upsertContact, {
      email: "stop@x.com",
      origin: "user-entered",
    });
    await h.asA.mutation(api.contacts.assertConsent, { contactId, wording: WORDING });
    await h.asA.mutation(api.contacts.markSuppressed, { address: "stop@x.com" });
    await h.asA.mutation(api.contacts.unsuppress, { address: "stop@x.com", acknowledged: true });

    const rows = await auditRows(h);
    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row?.eventType).toBe("contact.unsuppressed");
    const payload = row?.payload as Record<string, unknown>;
    // Adding ANY key here fails on purpose — a substring check would pass on a new leaky key.
    expect(Object.keys(payload).sort()).toEqual(["addressHash", "contactId"]);
    expect(payload.contactId).toBe(String(contactId));
    expect(String(payload.addressHash)).toMatch(/^[0-9a-f]{64}$/);
  });

  test("no audit row from this module carries the address or the consent wording, anywhere", async () => {
    const h = await harness({ audit: true });
    const contactId = await h.asA.mutation(api.contacts.upsertContact, {
      email: "stop@x.com",
      name: "Stoppy McStopface",
      origin: "user-entered",
    });
    await h.asA.mutation(api.contacts.assertConsent, {
      contactId,
      wording: WORDING,
      context: "Trade show, March",
    });
    await h.asA.mutation(api.contacts.markSuppressed, { address: "stop@x.com" });
    // READING the record back must not audit it either (CLAUDE.md §4). `consentRecord` returns the
    // wording to the caller, so this is the assertion that the return value never becomes a payload.
    expect((await h.asA.query(api.contacts.consentRecord, { contactId }))?.wording).toBe(WORDING);
    await h.asA.mutation(api.contacts.unsuppress, { address: "stop@x.com", acknowledged: true });

    // A REAL import run inside the same scan (19.1-04). The strongest guarantee that an imported
    // address or the attestation wording never becomes a payload is that the path emits no payload
    // at all — so this asserts a ROW COUNT first, and only then falls back to the substring scan.
    const before = (await auditRows(h)).length;
    await h.asA.mutation(api.contacts.importContacts, {
      rows: [{ email: "imported-person@x.com", name: "Importa McRowface", company: "Acme" }],
      attestation: { wording: IMPORT_ATTESTATION, context: "HubSpot export, August 2026" },
    });
    expect((await auditRows(h)).length).toBe(before);

    const serialized = JSON.stringify(await auditRows(h));
    expect(serialized).not.toContain("stop@x.com");
    expect(serialized).not.toContain(WORDING);
    expect(serialized).not.toContain("Trade show");
    expect(serialized).not.toContain("Stoppy");
    expect(serialized).not.toContain("imported-person@x.com");
    expect(serialized).not.toContain("Importa");
    expect(serialized).not.toContain(IMPORT_ATTESTATION);
    expect(serialized).not.toContain("HubSpot export, August 2026");
  });

  test("the unsuppress payload key set does NOT depend on whether a contact row exists", async () => {
    const h = await harness({ audit: true });
    await h.asA.mutation(api.contacts.markSuppressed, { address: "orphan@x.com" });
    await h.asA.mutation(api.contacts.unsuppress, { address: "orphan@x.com", acknowledged: true });

    const payload = (await auditRows(h))[0]?.payload as Record<string, unknown>;
    expect(Object.keys(payload).sort()).toEqual(["addressHash", "contactId"]);
    expect(payload.contactId).toBeNull();
  });
});

// ── The send-path internals ───────────────────────────────────────────────────────────────────

describe("contacts: the send-path suppression backstop", () => {
  test("isSuppressed is true for a comma-joined group when ANY member is suppressed", async () => {
    const h = await harness();
    await h.asA.mutation(api.contacts.markSuppressed, { address: "b@x.com" });

    const q = (recipient: string) =>
      h.t.query(internal.contacts.isSuppressed, { tenantId: h.tenantA, recipient });

    expect(await q("a@x.com, b@x.com")).toBe(true);
    expect(await q("A@X.com, C@x.com")).toBe(false);
    expect(await q("B@X.com")).toBe(true); // normalizes, like the write side
    expect(await q("a@x.com,,")).toBe(false); // a trailing comma is not an empty-key lookup
    expect(await q("")).toBe(false);
  });

  test("suppressedAmong returns the normalized suppressed subset, each named once", async () => {
    const h = await harness();
    await h.asA.mutation(api.contacts.markSuppressed, { address: "b@x.com" });

    expect(
      await h.t.query(internal.contacts.suppressedAmong, {
        tenantId: h.tenantA,
        addresses: ["A@x.com", " B@X.com ", "b@x.com", "", "c@x.com"],
      }),
    ).toEqual(["b@x.com"]);
  });
});

describe("contacts: footerFor fails CLOSED on every missing piece of configuration", () => {
  async function withProfile(h: Harness, postalAddress?: string) {
    await h.t.run((ctx) =>
      ctx.db.insert("tenantProfiles", {
        tenantId: h.tenantA,
        tier: "solopreneur",
        tierSource: "derived",
        derivedAt: Date.now(),
        ...(postalAddress ? { postalAddress } : {}),
      }),
    );
  }
  const footer = (h: Harness) =>
    h.t.query(internal.contacts.footerFor, { tenantId: h.tenantA, recipient: "a@x.com" });

  test("a runtime with no process cannot bypass the fail-closed environment boundary", () => {
    const src = stripComments(rawSources["./contacts.ts"] ?? "");
    expect(src.match(/typeof process === "undefined"/g)).toHaveLength(2);
    expect(src.match(/process\.env\.UNSUBSCRIBE_SECRET/g)).toHaveLength(1);
    expect(src.match(/process\.env\.CONVEX_SITE_URL/g)).toHaveLength(1);
  });

  test("no tenantProfiles row at all ⇒ null", async () => {
    vi.stubEnv("UNSUBSCRIBE_SECRET", SECRET);
    vi.stubEnv("CONVEX_SITE_URL", SITE);
    expect(await footer(await harness())).toBeNull();
  });

  test("a profile with no postalAddress ⇒ null (the caller refuses the send)", async () => {
    vi.stubEnv("UNSUBSCRIBE_SECRET", SECRET);
    vi.stubEnv("CONVEX_SITE_URL", SITE);
    const h = await harness();
    await withProfile(h);
    expect(await footer(h)).toBeNull();
  });

  test("an unset UNSUBSCRIBE_SECRET ⇒ null — a dead link is worse than no footer", async () => {
    vi.stubEnv("CONVEX_SITE_URL", SITE);
    vi.stubEnv("UNSUBSCRIBE_SECRET", "");
    const h = await harness();
    await withProfile(h, "1 High Street, Springfield");
    expect(await footer(h)).toBeNull();
  });

  test("an unset CONVEX_SITE_URL ⇒ null", async () => {
    vi.stubEnv("UNSUBSCRIBE_SECRET", SECRET);
    vi.stubEnv("CONVEX_SITE_URL", "");
    const h = await harness();
    await withProfile(h, "1 High Street, Springfield");
    expect(await footer(h)).toBeNull();
  });

  test("fully configured ⇒ the postal address and a token that round-trips", async () => {
    vi.stubEnv("UNSUBSCRIBE_SECRET", SECRET);
    vi.stubEnv("CONVEX_SITE_URL", SITE);
    const h = await harness();
    await withProfile(h, "1 High Street, Springfield");

    const built = await footer(h);
    expect(built?.text).toContain("1 High Street, Springfield");
    // The URL points at the CONVEX SITE origin (which serves the route), never the Next app.
    const url = built?.text.match(/Unsubscribe: (\S+)/)?.[1] ?? "";
    expect(url.startsWith(`${SITE}/unsubscribe/`)).toBe(true);

    const segment = url.slice(`${SITE}/unsubscribe/`.length);
    const dot = segment.lastIndexOf(".");
    expect(dot).toBeGreaterThan(0);
    expect(
      await h.t.query(internal.contacts.resolveUnsubToken, {
        raw: segment.slice(0, dot),
        digest: segment.slice(dot + 1),
      }),
    ).toEqual({ tenantId: h.tenantA, addresses: ["a@x.com"] });
  });
});

// ── The unsubscribe token ─────────────────────────────────────────────────────────────────────

describe("contacts: the unsubscribe token verifies before it resolves", () => {
  test("a well-formed token round-trips to the tenant and every group member", async () => {
    vi.stubEnv("UNSUBSCRIBE_SECRET", SECRET);
    const h = await harness();
    const { raw, digest } = await signed(h.tenantA, "A@x.com, b@x.com");

    expect(await h.t.query(internal.contacts.resolveUnsubToken, { raw, digest })).toEqual({
      tenantId: h.tenantA,
      addresses: ["a@x.com", "b@x.com"],
    });
  });

  test("a tampered digest, an absent digest and a forged raw each return null", async () => {
    vi.stubEnv("UNSUBSCRIBE_SECRET", SECRET);
    const h = await harness();
    const { raw, digest } = await signed(h.tenantA, "a@x.com");
    const resolve = (r: string, d: string) =>
      h.t.query(internal.contacts.resolveUnsubToken, { raw: r, digest: d });

    expect(await resolve(raw, `${digest.slice(0, -1)}0`)).toBeNull();
    expect(await resolve(raw, "")).toBeNull();
    expect(await resolve("", digest)).toBeNull();
    // Signed with the WRONG key — the shape is right and it still refuses.
    const forged = await signed(h.tenantA, "a@x.com", "not-the-secret");
    expect(await resolve(forged.raw, forged.digest)).toBeNull();
    // A payload with no `|` separator cannot name a tenant.
    const bare = btoa("no-separator").replace(/=+$/, "");
    expect(await resolve(bare, await hmacHex(bare, SECRET))).toBeNull();
  });

  test("an UNSET UNSUBSCRIBE_SECRET returns null — the fail-closed env guard", async () => {
    const h = await harness();
    // Signed with the REAL secret...
    vi.stubEnv("UNSUBSCRIBE_SECRET", SECRET);
    const { raw, digest } = await signed(h.tenantA, "a@x.com");
    // ...which the deployment then does not have. Mutation check: delete `if (!secret) return
    // null` and this goes GREEN — `hmacHex(raw, "")` yields a digest anyone can compute.
    vi.stubEnv("UNSUBSCRIBE_SECRET", "");

    expect(await h.t.query(internal.contacts.resolveUnsubToken, { raw, digest })).toBeNull();
    expect(await h.t.mutation(internal.contacts.suppressFromUnsubscribe, { raw, digest })).toEqual({
      ok: false,
      suppressed: 0,
    });
    expect(await suppressionRows(h)).toHaveLength(0);
  });

  test("resolveUnsubToken writes NOTHING — a link prefetcher must not unsubscribe anyone", async () => {
    vi.stubEnv("UNSUBSCRIBE_SECRET", SECRET);
    const h = await harness();
    const { raw, digest } = await signed(h.tenantA, "a@x.com");

    await h.t.query(internal.contacts.resolveUnsubToken, { raw, digest });
    expect(await suppressionRows(h)).toHaveLength(0);
  });

  test("suppressFromUnsubscribe suppresses EVERY group member, and a replay is a no-op", async () => {
    vi.stubEnv("UNSUBSCRIBE_SECRET", SECRET);
    const h = await harness();
    const { raw, digest } = await signed(h.tenantA, "A@x.com, b@x.com");

    expect(await h.t.mutation(internal.contacts.suppressFromUnsubscribe, { raw, digest })).toEqual({
      ok: true,
      suppressed: 2,
    });
    const rows = await suppressionRows(h);
    expect(rows.map((r) => r.address).sort()).toEqual(["a@x.com", "b@x.com"]);
    expect(rows.every((r) => r.source === "unsubscribe-link")).toBe(true);
    expect(rows.every((r) => r.tenantId === h.tenantA)).toBe(true);

    // Idempotency is the whole abuse mitigation for a replayed link: `ok` stays true (the
    // recipient's request WAS honoured) and no second row appears.
    expect(await h.t.mutation(internal.contacts.suppressFromUnsubscribe, { raw, digest })).toEqual({
      ok: true,
      suppressed: 0,
    });
    expect(await suppressionRows(h)).toHaveLength(2);
    // No audit row: there is no authenticated actor on this route.
    expect(await auditRows(h)).toHaveLength(0);
  });
});

// ── The Pipeline read models (19-07, VALIDATION rows 19-backend and 21) ───────────────────────

/** The CLOSED `DashboardPartialReason` vocabulary, restated so a hand-rolled reason fails here. */
const PARTIAL_REASONS = [
  "row-cap",
  "time-cap",
  "legacy-window",
  "coverage-gap",
  "source-unavailable",
];

/** A DELIVERED send, inserted directly: `requests` is written by the delivery spine, not by this
 *  module, so seeding the terminal row is the only way to give a contact a "last touch". */
async function seedSend(h: Harness, tenantId: string, recipient: string, createdAt: number) {
  await h.t.run((ctx) =>
    ctx.db.insert("requests", {
      tenantId,
      correlationId: `seed-${createdAt}-${recipient}`,
      goal: "seeded",
      recipient,
      status: "sent",
      attachmentRefs: [],
      createdAt,
    }),
  );
}

describe("contacts: pipelineTiles are ALWAYS-KNOWN counts (invariant 3)", () => {
  /** The four TILE keys. `partial` is a bound signal, not a count, and must never be treated as
   *  one — on either side of the wire (`TILES` in `PipelineView.tsx` excludes it too). */
  const COUNT_KEYS = ["needingAttention", "followUpsDue", "consentOnRecord", "suppressed"] as const;

  test("an EMPTY tenant reads four real zeroes — never null, never undefined", async () => {
    const h = await harness();
    const tiles = await h.asA.query(api.contacts.pipelineTiles, {});
    // `toEqual({...0})` alone would pass on `undefined` for a key that is simply absent, so each
    // one is also pinned by TYPE. Contacts and follow-ups have no coverage-start concept, so
    // "we weren't watching" cannot apply and Unknown is never the truth here.
    expect(tiles).toEqual({
      needingAttention: 0,
      followUpsDue: 0,
      consentOnRecord: 0,
      suppressed: 0,
      // Under the scan bound the four counts are EXACT totals, not floors (19.1-05).
      partial: null,
    });
    for (const key of COUNT_KEYS) expect(typeof tiles[key]).toBe("number");
  });

  test("needingAttention counts contacts with NO OPEN follow-up — done/canceled still needs you", async () => {
    const h = await harness();
    const owed = await h.asA.mutation(api.contacts.upsertContact, {
      email: "owed@x.com",
      origin: "user-entered",
    });
    const settled = await h.asA.mutation(api.contacts.upsertContact, {
      email: "settled@x.com",
      origin: "user-entered",
    });
    const bare = await h.asA.mutation(api.contacts.upsertContact, {
      email: "bare@x.com",
      origin: "user-entered",
    });
    // `settled` keeps an OPEN follow-up; `owed`'s only one is DONE; `bare` has none at all.
    await h.asA.mutation(api.contacts.createFollowUp, {
      contactId: settled,
      note: "open one",
      dueAt: Date.now() + 60_000,
    });
    const finished = await h.asA.mutation(api.contacts.createFollowUp, {
      contactId: owed,
      note: "finished one",
      dueAt: Date.now() - 60_000,
    });
    await h.asA.mutation(api.contacts.setFollowUpStatus, { followUpId: finished, status: "done" });

    expect(bare).toBeDefined();
    const tiles = await h.asA.query(api.contacts.pipelineTiles, {});
    // owed + bare, NOT settled. Complementary to followUpsDue, never a restatement of it.
    expect(tiles.needingAttention).toBe(2);
  });

  test("followUpsDue counts CONTACTLESS follow-ups too — one honest total, no asterisk", async () => {
    const h = await harness();
    const contactId = await h.asA.mutation(api.contacts.upsertContact, {
      email: "person@x.com",
      origin: "user-entered",
    });
    await h.asA.mutation(api.contacts.createFollowUp, {
      contactId,
      note: "call them",
      dueAt: Date.now() - 60_000,
    });
    await h.asA.mutation(api.contacts.createFollowUp, {
      note: "chase the supplier quote",
      dueAt: Date.now() - 60_000,
    });
    // Not yet due, so it must NOT be counted — otherwise the tile is "open follow-ups" wearing
    // the word "due".
    await h.asA.mutation(api.contacts.createFollowUp, {
      note: "next month",
      dueAt: Date.now() + 86_400_000,
    });

    expect((await h.asA.query(api.contacts.pipelineTiles, {})).followUpsDue).toBe(2);
  });

  test("consentOnRecord counts only a real consent event — nothing is defaulted to consented", async () => {
    const h = await harness();
    const consented = await h.asA.mutation(api.contacts.upsertContact, {
      email: "yes@x.com",
      origin: "user-entered",
    });
    await h.asA.mutation(api.contacts.upsertContact, {
      email: "silent@x.com",
      origin: "user-entered",
    });
    expect((await h.asA.query(api.contacts.pipelineTiles, {})).consentOnRecord).toBe(0);

    await h.asA.mutation(api.contacts.assertConsent, { contactId: consented, wording: WORDING });
    expect((await h.asA.query(api.contacts.pipelineTiles, {})).consentOnRecord).toBe(1);
  });

  test("UNDER the scan bound the counts are EXACT totals — partial is null, never a floor", async () => {
    const h = await harness();
    for (const email of ["one@x.com", "two@x.com", "three@x.com"]) {
      await h.asA.mutation(api.contacts.upsertContact, { email, origin: "user-entered" });
    }
    // The ordinary case, and the non-vacuity floor for the row-cap test below: `partial` is only
    // meaningful if it is `null` when the scan did NOT hit its bound.
    expect(await h.asA.query(api.contacts.pipelineTiles, {})).toEqual({
      needingAttention: 3,
      followUpsDue: 0,
      consentOnRecord: 0,
      suppressed: 0,
      partial: null,
    });
  });

  test("PAST the scan bound the tiles report `row-cap` — a floor, never a confidently wrong total", async () => {
    const h = await harness();
    // SCAN_LIMIT + 1 rows: exactly what ONE max-size import into a book that already held a single
    // contact produces. `IMPORT_ROW_MAX` is 1 000 PER IMPORT and nothing caps a tenant's contact
    // count, so this is a reachable state, not a synthetic one. Inserted directly and split across
    // four `t.run` calls to stay inside the 20s testTimeout — the THRESHOLD is deliberately not
    // lowered, because the point of this test is that it fails on the code that shipped before
    // 19.1-05, where `pipelineTiles` took exactly SCAN_LIMIT and reported no bound at all.
    const TOTAL = 1_001;
    const PER_RUN = 260;
    for (let start = 0; start < TOTAL; start += PER_RUN) {
      await h.t.run(async (ctx) => {
        for (let i = start; i < Math.min(start + PER_RUN, TOTAL); i++) {
          await ctx.db.insert("contacts", {
            tenantId: h.tenantA,
            email: `c${i}@x.com`,
            origin: "imported",
            createdAt: Date.now(),
            updatedAt: Date.now(),
          });
        }
      });
    }
    expect(await contactRows(h)).toHaveLength(TOTAL);

    const tiles = await h.asA.query(api.contacts.pipelineTiles, {});
    expect(tiles.partial).toBe("row-cap");
    // The counts stay BOUNDED by the scan — 1 000, not 1 001 — which is precisely why they must be
    // read as a floor. `1000+` is honest; a bare `1000` is a wrong total stated confidently.
    expect(tiles.needingAttention).toBe(1_000);
    for (const key of COUNT_KEYS) expect(tiles[key]).toBeLessThanOrEqual(1_000);
  });
});

describe("contacts: listContacts is bounded by the 26-01 contract (VALIDATION row 21)", () => {
  test("a page SHORTER than the limit is complete — no cursor, not partial", async () => {
    const h = await harness();
    await h.asA.mutation(api.contacts.upsertContact, {
      email: "only@x.com",
      origin: "user-entered",
    });
    const result = await h.asA.query(api.contacts.listContacts, { limit: 10 });
    expect(result.bound.nextCursor).toBeNull();
    expect(result.bound.partial).toBe(false);
    expect(result.bound.partialReason).toBeUndefined();
    expect(result.bound.returned).toBe(1);
  });

  test("MORE rows than the limit produce a cursor, and the cursor implies partial + a CLOSED reason", async () => {
    const h = await harness();
    for (const email of ["one@x.com", "two@x.com", "three@x.com"]) {
      await h.asA.mutation(api.contacts.upsertContact, { email, origin: "user-entered" });
    }
    const first = await h.asA.query(api.contacts.listContacts, { limit: 2 });
    expect(first.contacts).toHaveLength(2);
    expect(first.bound.returned).toBe(2);
    expect(first.bound.limit).toBe(2);
    expect(first.bound.nextCursor).not.toBeNull();
    expect(first.bound.partial).toBe(true);
    expect(PARTIAL_REASONS).toContain(first.bound.partialReason);
  });

  test("the cursor round-trips and page 2 shares NO row with page 1", async () => {
    const h = await harness();
    for (const email of ["one@x.com", "two@x.com", "three@x.com", "four@x.com"]) {
      await h.asA.mutation(api.contacts.upsertContact, { email, origin: "user-entered" });
    }
    const first = await h.asA.query(api.contacts.listContacts, { limit: 2 });
    const cursor = first.bound.nextCursor;
    if (cursor === null) throw new Error("expected a cursor with 4 rows and a limit of 2");
    // The cursor is the 26-01 "v1:" shape, not an opaque backend token.
    expect(dashboardCursorFor(parseDashboardCursor(cursor))).toBe(cursor);

    const second = await h.asA.query(api.contacts.listContacts, { limit: 2, cursor });
    const firstIds = first.contacts.map((c) => c.contactId);
    expect(second.contacts).toHaveLength(2);
    for (const row of second.contacts) expect(firstIds).not.toContain(row.contactId);
    // Every row is reached exactly once across the two pages.
    expect(new Set([...firstIds, ...second.contacts.map((c) => c.contactId)]).size).toBe(4);
    expect(second.bound.nextCursor).toBeNull();
    expect(second.bound.partial).toBe(false);
  });

  test("a many-way createdAt TIE pages EXACTLY — every row reached once, none twice (19.1)", async () => {
    const h = await harness();
    const COUNT = 30;
    await h.asA.mutation(api.contacts.importContacts, {
      rows: Array.from({ length: COUNT }, (_, i) => ({ email: `tie${i}@x.com` })),
      attestation: { wording: IMPORT_ATTESTATION },
    });
    // A bulk import is the first thing in this repo that can produce a many-way tie: on the real
    // backend 30 rows inserted in ONE transaction share one frozen `Date.now()`. convex-test's
    // clock ADVANCES mid-transaction (measured: 30 inserts produced 19 distinct values), so the
    // tie is set with a SENTINEL rather than hoped for — the same discipline 19.1-03 used for
    // `updatedAt`. Asserted, not assumed: without this the test silently stops covering its case.
    const inserted = await contactRows(h);
    expect(inserted).toHaveLength(COUNT);
    await h.t.run(async (ctx) => {
      for (const row of inserted) await ctx.db.patch(row._id, { createdAt: 1_234 });
    });
    expect(new Set((await contactRows(h)).map((r) => r.createdAt)).size).toBe(1);

    const seen: string[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < COUNT; page++) {
      const result = await h.asA.query(api.contacts.listContacts, { limit: 10, cursor });
      seen.push(...result.contacts.map((c) => String(c.contactId)));
      if (result.bound.nextCursor === null) break;
      cursor = result.bound.nextCursor;
    }
    // `compareDashboardOrder`'s id-descending tie-break is what makes this exact rather than
    // approximate: with a createdAt-only comparison a 30-way tie drops rows or repeats them.
    expect(seen).toHaveLength(COUNT);
    expect(new Set(seen).size).toBe(COUNT);
  });

  test("lastTouchAt is the NEWER of the newest delivered send and the newest completed follow-up", async () => {
    const h = await harness();
    const now = Date.now();
    const sendWins = await h.asA.mutation(api.contacts.upsertContact, {
      email: "send-wins@x.com",
      origin: "user-entered",
    });
    const doneWins = await h.asA.mutation(api.contacts.upsertContact, {
      email: "done-wins@x.com",
      origin: "user-entered",
    });
    await h.asA.mutation(api.contacts.upsertContact, {
      email: "never@x.com",
      origin: "user-entered",
    });

    // Mixed case on the wire proves the fold keys on `normalizeAddress`, not on the raw header.
    await seedSend(h, h.tenantA, "Send-Wins@X.com", now - 1_000);
    await seedSend(h, h.tenantA, "send-wins@x.com", now - 90_000);
    await seedSend(h, h.tenantA, "done-wins@x.com", now - 500_000);

    const oldTouch = await h.asA.mutation(api.contacts.createFollowUp, {
      contactId: sendWins,
      note: "old",
      dueAt: now - 900_000,
    });
    await h.asA.mutation(api.contacts.setFollowUpStatus, { followUpId: oldTouch, status: "done" });
    // `setFollowUpStatus` stamps `completedAt` at NOW, so an "old completion" has to be aged by
    // hand — otherwise every completion is newer than every seeded send and the max is untested.
    await h.t.run((ctx) => ctx.db.patch(oldTouch, { completedAt: now - 900_000 }));
    const newTouch = await h.asA.mutation(api.contacts.createFollowUp, {
      contactId: doneWins,
      note: "new",
      dueAt: now - 900_000,
    });
    await h.asA.mutation(api.contacts.setFollowUpStatus, { followUpId: newTouch, status: "done" });

    const rows = await h.asA.query(api.contacts.listContacts, {});
    const by = (email: string) => {
      const row = rows.contacts.find((c) => c.email === email);
      if (!row) throw new Error(`missing ${email}`);
      return row;
    };
    // The send is newer than the completion here…
    expect(by("send-wins@x.com").lastTouchAt).toBe(now - 1_000);
    // …and the completion (stamped just now by setFollowUpStatus) is newer than the send there.
    expect(by("done-wins@x.com").lastTouchAt).toBeGreaterThan(now - 500_000);
    // Neither: NULL, which the component renders as an explicit "no contact yet" — not 0.
    expect(by("never@x.com").lastTouchAt).toBeNull();
    expect(by("never@x.com").lastTouchAt).not.toBe(0);
  });

  test("a row carries the soonest OPEN follow-up as nextStep, and null consent stays null", async () => {
    const h = await harness();
    const now = Date.now();
    const contactId = await h.asA.mutation(api.contacts.upsertContact, {
      email: "busy@x.com",
      origin: "user-entered",
    });
    await h.asA.mutation(api.contacts.createFollowUp, {
      contactId,
      note: "later",
      dueAt: now + 200_000,
    });
    await h.asA.mutation(api.contacts.createFollowUp, {
      contactId,
      note: "sooner",
      dueAt: now + 10_000,
    });
    const canceled = await h.asA.mutation(api.contacts.createFollowUp, {
      contactId,
      note: "soonest but canceled",
      dueAt: now + 1_000,
    });
    await h.asA.mutation(api.contacts.setFollowUpStatus, {
      followUpId: canceled,
      status: "canceled",
    });

    const row = (await h.asA.query(api.contacts.listContacts, {})).contacts[0];
    expect(row?.nextStep?.note).toBe("sooner");
    expect(row?.consent).toBeNull();
    expect(row?.name).toBeNull();

    await h.asA.mutation(api.contacts.assertConsent, { contactId, wording: WORDING });
    const withConsent = (await h.asA.query(api.contacts.listContacts, {})).contacts[0];
    expect(withConsent?.consent?.source).toBe("asserted-by-user");
    expect(typeof withConsent?.consent?.at).toBe("number");
  });
});

describe("contacts: listUnassignedFollowUps is the contactless section's own read", () => {
  test("it returns ONLY open follow-ups with no contact, bounded", async () => {
    const h = await harness();
    const contactId = await h.asA.mutation(api.contacts.upsertContact, {
      email: "person@x.com",
      origin: "user-entered",
    });
    await h.asA.mutation(api.contacts.createFollowUp, {
      contactId,
      note: "assigned",
      dueAt: Date.now(),
    });
    await h.asA.mutation(api.contacts.createFollowUp, {
      note: "supplier quote",
      dueAt: Date.now(),
    });
    const closed = await h.asA.mutation(api.contacts.createFollowUp, {
      note: "already handled",
      dueAt: Date.now(),
    });
    await h.asA.mutation(api.contacts.setFollowUpStatus, { followUpId: closed, status: "done" });

    const result = await h.asA.query(api.contacts.listUnassignedFollowUps, {});
    expect(result.followUps.map((f) => f.note)).toEqual(["supplier quote"]);
    expect(result.bound.partial).toBe(false);
    expect(result.bound.nextCursor).toBeNull();
  });

  test("more contactless follow-ups than the limit page through their own cursor", async () => {
    const h = await harness();
    for (const note of ["a", "b", "c"]) {
      await h.asA.mutation(api.contacts.createFollowUp, { note, dueAt: Date.now() });
    }
    const first = await h.asA.query(api.contacts.listUnassignedFollowUps, { limit: 2 });
    expect(first.followUps).toHaveLength(2);
    const cursor = first.bound.nextCursor;
    if (cursor === null) throw new Error("expected a cursor with 3 rows and a limit of 2");
    const second = await h.asA.query(api.contacts.listUnassignedFollowUps, { limit: 2, cursor });
    expect(second.followUps).toHaveLength(1);
    const firstIds = first.followUps.map((f) => f.followUpId);
    expect(firstIds).not.toContain(second.followUps[0]?.followUpId);
  });
});

// ── Structural scan: no opportunity / stage / monetary concept (VALIDATION row 20) ────────────
// edge-runtime has no `node:fs`, so sources are inlined by Vite's raw loader (importGuard.test.ts's
// pattern) rather than read from disk.

const rawSources = import.meta.glob("./**/*.ts", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

const coreSources = import.meta.glob("../../core/src/*.ts", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

/** Comments are stripped before the scan: the schema and the module both carry a deliberate
 *  GRAVESTONE comment naming what is absent, and a scan that punished its own documentation
 *  would force the absence to go unexplained. */
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

const FORBIDDEN = /amountCents|opportunit|\bstage\b/i;

describe("PIPE-01: no second CRM data plane leaked an opportunity concept into the substrate", () => {
  const scanned: Array<[string, string]> = [
    ["convex/contacts.ts", rawSources["./contacts.ts"] ?? ""],
    ["core/src/contacts.ts", coreSources["../../core/src/contacts.ts"] ?? ""],
    // 19.1-01: the import parser/mapper is a CRM-shaped module and is covered by the same ban.
    ["core/src/contactImport.ts", coreSources["../../core/src/contactImport.ts"] ?? ""],
  ];

  // Non-vacuity floor: a bad glob key yields "" and every `not.toMatch` below would pass.
  test("every scanned source was actually loaded and is non-empty", () => {
    for (const [name, src] of scanned) {
      expect(src.length, `${name} was not loaded`).toBeGreaterThan(500);
    }
    expect(rawSources["./schema.ts"]?.length ?? 0).toBeGreaterThan(500);
    // The scan can see a violation when there is one.
    expect(FORBIDDEN.test("amountCents")).toBe(true);
    expect(FORBIDDEN.test("stage")).toBe(true);
  });

  for (const [name, src] of scanned) {
    test(`${name} contains no amountCents / opportunit / stage`, () => {
      expect(stripComments(src)).not.toMatch(FORBIDDEN);
    });
  }

  test("the contacts / followUps / suppressions schema blocks carry no monetary or stage field", () => {
    const schemaSrc = stripComments(rawSources["./schema.ts"] ?? "");
    for (const table of ["contacts", "followUps", "suppressions"]) {
      const start = schemaSrc.indexOf(`${table}: defineTable(`);
      expect(start, `${table} block not found`).toBeGreaterThan(-1);
      // Up to the next table definition — `defineTable(` is the only block delimiter that does
      // not depend on brace counting through the nested validators.
      const rest = schemaSrc.slice(start + table.length);
      const next = rest.indexOf(": defineTable(", 1);
      const block = next === -1 ? rest : rest.slice(0, next);
      expect(block.length).toBeGreaterThan(200);
      expect(block, `${table} carries a forbidden field`).not.toMatch(FORBIDDEN);
    }
  });
});

// Every public (tenant-scoped) function in the module must appear by name in the isolation block
// above. This is the mechanical form of that done-criterion: a seventh public write added without
// an isolation test fails HERE rather than shipping unasserted.
describe("PIPE-01/BETA-05: the public surface is exactly what the isolation block covers", () => {
  const COVERED = [
    "assertConsent",
    // 19-13: the consent record's request path (SC#4). Isolation-tested in the block above.
    "consentRecord",
    "createFollowUp",
    // 19.1-04: the CSV import's write. Isolation-tested in the block above.
    "importContacts",
    "listContacts",
    "listUnassignedFollowUps",
    "markSuppressed",
    // 19.1-04: the import preview's read. Isolation-tested in the block above.
    "matchExisting",
    "pipelineTiles",
    "recordMarketingLead",
    "setFollowUpStatus",
    "unsuppress",
    "upsertContact",
  ];

  test("no public function in contacts.ts is missing an isolation test", () => {
    const src = stripComments(rawSources["./contacts.ts"] ?? "");
    expect(src.length).toBeGreaterThan(500);
    const found = [...src.matchAll(/export const (\w+) = tenant(?:Query|Mutation|Action)\(/g)].map(
      (m) => m[1] as string,
    );
    expect(found.sort()).toEqual(COVERED);
  });

  test("every internal the rest of the phase consumes is exported", () => {
    const src = stripComments(rawSources["./contacts.ts"] ?? "");
    const found = [...src.matchAll(/export const (\w+) = internal(?:Query|Mutation)\(/g)].map(
      (m) => m[1] as string,
    );
    expect(found.sort()).toEqual([
      "footerFor",
      "isSuppressed",
      "resolveUnsubToken",
      // 19-08: the cockpit's saved-contact READ. Its zero-write property is pinned in
      // cockpitTools.test.ts by counting `contacts` rows across a resolution (SC#7).
      "savedForName",
      "suppressFromUnsubscribe",
      "suppressedAmong",
    ]);
  });
});

// ── The public /unsubscribe/ route (plan 19-04, VALIDATION row 18) ────────────────────────────
//
// Driven through `convex-test`'s HTTP surface — the SAME shape `media.test.ts` uses for the fal
// webhook, so these exercise the real router, the real path split and the real handlers.

const unsubPath = (raw: string, digest: string) => `/unsubscribe/${raw}.${digest}`;

describe("PIPE-01: the /unsubscribe/ route — the GET is inert, the POST is the only mutating verb", () => {
  test("GET with a VALID segment renders the address and writes NOTHING", async () => {
    vi.stubEnv("UNSUBSCRIBE_SECRET", SECRET);
    const h = await harness();
    const { raw, digest } = await signed(h.tenantA, "Bob@X.com");
    expect(await suppressionRows(h)).toHaveLength(0);

    const res = await h.t.fetch(unsubPath(raw, digest), { method: "GET" });
    expect(res.status).toBe(200);
    const body = await res.text();
    // The recipient must be able to see WHICH mailbox they are unsubscribing.
    expect(body).toContain("bob@x.com");
    // …and the confirm control that makes the write explicit.
    expect(body).toContain('method="POST"');

    // THE assertion of this whole file's row 18: count the rows, do not read the response. A
    // handler that suppressed and then returned the very same HTML passes a status-only check.
    // Mail scanners and link prefetchers fire GETs; this is what keeps them harmless.
    expect(await suppressionRows(h)).toHaveLength(0);
  });

  test("GET with a TAMPERED digest 404s", async () => {
    vi.stubEnv("UNSUBSCRIBE_SECRET", SECRET);
    const h = await harness();
    const { raw, digest } = await signed(h.tenantA, "a@x.com");

    const res = await h.t.fetch(unsubPath(raw, `${digest.slice(0, -1)}0`), { method: "GET" });
    expect(res.status).toBe(404);
    expect(await suppressionRows(h)).toHaveLength(0);
  });

  test("GET with NO dot in the segment 404s", async () => {
    vi.stubEnv("UNSUBSCRIBE_SECRET", SECRET);
    const h = await harness();

    expect((await h.t.fetch("/unsubscribe/nodothere", { method: "GET" })).status).toBe(404);
    // A leading dot is `dot <= 0`, not a zero-length raw that happens to verify.
    expect((await h.t.fetch("/unsubscribe/.abc", { method: "GET" })).status).toBe(404);
  });

  test("an UNSET UNSUBSCRIBE_SECRET 404s a previously-valid segment on BOTH verbs", async () => {
    const h = await harness();
    vi.stubEnv("UNSUBSCRIBE_SECRET", SECRET);
    const { raw, digest } = await signed(h.tenantA, "a@x.com");
    try {
      vi.stubEnv("UNSUBSCRIBE_SECRET", "");
      const path = unsubPath(raw, digest);
      expect((await h.t.fetch(path, { method: "GET" })).status).toBe(404);
      expect((await h.t.fetch(path, { method: "POST" })).status).toBe(404);
      expect(await suppressionRows(h)).toHaveLength(0);
    } finally {
      // Restore so an unset secret cannot leak into a neighbouring test and pass it vacuously.
      vi.stubEnv("UNSUBSCRIBE_SECRET", SECRET);
    }
  });

  test("POST with a valid segment suppresses exactly ONE address", async () => {
    vi.stubEnv("UNSUBSCRIBE_SECRET", SECRET);
    const h = await harness();
    const { raw, digest } = await signed(h.tenantA, "Bob@X.com");

    const res = await h.t.fetch(unsubPath(raw, digest), { method: "POST" });
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("bob@x.com");

    const rows = await suppressionRows(h);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.address).toBe("bob@x.com");
    expect(rows[0]?.tenantId).toBe(h.tenantA);
    expect(rows[0]?.source).toBe("unsubscribe-link");
  });

  test("POSTing the SAME segment twice is 200 twice and leaves exactly ONE row", async () => {
    vi.stubEnv("UNSUBSCRIBE_SECRET", SECRET);
    const h = await harness();
    const { raw, digest } = await signed(h.tenantA, "a@x.com");
    const path = unsubPath(raw, digest);

    expect((await h.t.fetch(path, { method: "POST" })).status).toBe(200);
    const first = (await suppressionRows(h))[0];
    // A replay is honoured, not refused — that idempotency IS the abuse mitigation, which is why
    // this route carries no rate limiter.
    expect((await h.t.fetch(path, { method: "POST" })).status).toBe(200);

    const rows = await suppressionRows(h);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.suppressedAt).toBe(first?.suppressedAt);
  });

  test("POST for a GROUP token suppresses every decoded member, normalized", async () => {
    vi.stubEnv("UNSUBSCRIBE_SECRET", SECRET);
    const h = await harness();
    const { raw, digest } = await signed(h.tenantA, "A@x.com, b@x.com");

    const res = await h.t.fetch(unsubPath(raw, digest), { method: "POST" });
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain("a@x.com");
    expect(body).toContain("b@x.com");

    const rows = await suppressionRows(h);
    expect(rows.map((r) => r.address).sort()).toEqual(["a@x.com", "b@x.com"]);
    expect(rows.every((r) => r.tenantId === h.tenantA)).toBe(true);
  });

  test("a token minted for tenant A cannot be aimed at tenant B", async () => {
    vi.stubEnv("UNSUBSCRIBE_SECRET", SECRET);
    const h = await harness();
    const a = await signed(h.tenantA, "a@x.com");
    const b = await signed(h.tenantB, "a@x.com");

    // The tenant is INSIDE the signed payload, so swapping it means re-signing. Keeping A's digest
    // over B's payload is a mismatch…
    expect((await h.t.fetch(unsubPath(b.raw, a.digest), { method: "POST" })).status).toBe(404);
    // …and re-signing without the deployment secret is a forgery.
    const forged = await signed(h.tenantB, "a@x.com", "not-the-secret");
    expect((await h.t.fetch(unsubPath(forged.raw, forged.digest), { method: "POST" })).status).toBe(
      404,
    );
    expect(await suppressionRows(h)).toHaveLength(0);

    // The complement, so the claim above is not vacuous: the write lands under the tenant the
    // signed payload names, and nowhere else.
    expect((await h.t.fetch(unsubPath(b.raw, b.digest), { method: "POST" })).status).toBe(200);
    const rows = await suppressionRows(h);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.tenantId).toBe(h.tenantB);
  });
});
