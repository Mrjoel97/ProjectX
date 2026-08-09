// The BETA-05 isolation assertion for the person store, shipped WITH the module (VALIDATION rows
// 9, 10 and 20). Every test is $0 — no model call, no network, convex-test only.
//
// Subjects are built as `${userId}|session_x` over REAL `users` rows, exactly as `tenant.test.ts`
// does: `requireScope` derives `tenantId` from the segment before the `|`, so a hand-made subject
// that skips this shape silently tests nothing.
import { convexTest } from "convex-test";
import { describe, expect, test, vi } from "vitest";
// `audit.log` maintains the auditCounts aggregate (audit.ts), so the component must be registered
// or `unsuppress` throws `Component "auditCounts" is not registered`. Relative import — the
// package blocks the deep specifier. Same idiom as audit.test.ts.
import aggregateSchema from "../node_modules/@convex-dev/aggregate/src/component/schema.js";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
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
    await h.asA.mutation(api.contacts.unsuppress, { address: "stop@x.com", acknowledged: true });

    const serialized = JSON.stringify(await auditRows(h));
    expect(serialized).not.toContain("stop@x.com");
    expect(serialized).not.toContain(WORDING);
    expect(serialized).not.toContain("Trade show");
    expect(serialized).not.toContain("Stoppy");
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
    "createFollowUp",
    "markSuppressed",
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
      "suppressFromUnsubscribe",
      "suppressedAmong",
    ]);
  });
});
