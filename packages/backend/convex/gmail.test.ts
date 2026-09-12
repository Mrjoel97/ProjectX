// buildMime self-check (V3 multipart structurally correct + V4 zero-attachment byte-identical),
// plus the 03.7-02 inbox read plane: the fixture seam, the refs-only mailbox.listed audit, and
// the pure MIME text/plain picker.

import { BODY_TRUNCATE_CHARS, SEARCH_CAPS } from "@pikar/core";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
// listInbox's refs-only mailbox.listed audit hits the auditCounts aggregate; register the
// component (relative import — the package blocks the deep specifier) so the REAL audit path runs
// under convex-test instead of throwing "component not registered" (cockpitTools.test.ts precedent).
import aggregateSchema from "../node_modules/@convex-dev/aggregate/src/component/schema.js";
import { api, internal } from "./_generated/api";
import { buildMime, escapeGmailQuery, pickPlainText, SEND_ENDPOINT } from "./gmail";
import schema from "./schema";

const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);
const aggregateModules = import.meta.glob(
  "../node_modules/@convex-dev/aggregate/src/component/**/!(*.test).ts",
);

/** convex-test instance with the audit aggregate registered (every listInbox test audits). */
function harness() {
  const t = convexTest(schema, modules);
  t.registerComponent("auditCounts", aggregateSchema, aggregateModules);
  return t;
}

const TENANT = "tenant_inbox";
// The deterministic smoke clock (llm.ts SMOKE_NOW_MS — 2020-01-01T12:00Z); seeding at a fixed
// baseMs is what makes the fixture messages land in known buckets offline.
const BASE_MS = 1_577_880_000_000;
const b64url = (s: string) => Buffer.from(s, "utf8").toString("base64url");

const TO = "dest@example.com";
const SUBJECT = "Quarterly update";
const BODY = "Here is the Q3 update.\r\nRegards.";

// The EXACT legacy single-part string (frozen here so a byte drift fails loudly — V4).
const LEGACY = [
  `To: ${TO}`,
  `Subject: ${SUBJECT}`,
  "MIME-Version: 1.0",
  'Content-Type: text/plain; charset="UTF-8"',
  "",
  BODY,
].join("\r\n");

describe("buildMime — zero-attachment byte-identity (V4)", () => {
  test("no attachments arg → byte-identical to the legacy plain-text message", () => {
    expect(buildMime(TO, SUBJECT, BODY)).toBe(LEGACY);
  });

  test("empty attachments array → byte-identical to the legacy plain-text message", () => {
    expect(buildMime(TO, SUBJECT, BODY, [])).toBe(LEGACY);
  });
});

describe("buildMime — multipart/mixed with attachments (V3)", () => {
  const PDF_B64 = Buffer.from("%PDF-1.4 fake pdf bytes").toString("base64");
  const mime = buildMime(TO, SUBJECT, BODY, [
    { filename: "report.pdf", mimeType: "application/pdf", base64: PDF_B64 },
  ]);

  test("CRLF line endings throughout (no bare LF)", () => {
    expect(mime.includes("\n")).toBe(true);
    expect(/[^\r]\n/.test(mime)).toBe(false); // every \n is preceded by \r
  });

  test("exactly one top-level MIME-Version:1.0", () => {
    expect(mime.match(/MIME-Version: 1\.0/g)?.length).toBe(1);
  });

  test("top-level Content-Type is multipart/mixed with a =_pikar_ boundary", () => {
    const m = mime.match(/Content-Type: multipart\/mixed; boundary="(=_pikar_[0-9a-f]+)"/);
    expect(m).not.toBeNull();
  });

  test("a text/plain body part carried as base64 (Content-Transfer-Encoding: base64)", () => {
    expect(mime).toContain('Content-Type: text/plain; charset="UTF-8"');
    // body is base64-encoded inside the part, not left as cleartext
    expect(mime).toContain(Buffer.from(BODY, "utf-8").toString("base64"));
    expect(mime).not.toContain(BODY); // the raw body does NOT appear verbatim
  });

  test("one application/pdf attachment part with Content-Disposition: attachment; filename", () => {
    expect(mime).toContain('Content-Type: application/pdf; name="report.pdf"');
    expect(mime).toContain('Content-Disposition: attachment; filename="report.pdf"');
    expect(mime).toContain(PDF_B64); // standard base64, carried verbatim
  });

  test("N+1 part delimiters and a MANDATORY closing --boundary--", () => {
    const boundary = mime.match(/boundary="(=_pikar_[0-9a-f]+)"/)?.[1];
    expect(boundary).toBeTruthy();
    // opening delimiters: one before the text part + one per attachment = 2
    const opens = mime.match(new RegExp(`\r\n--${boundary}\r\n`, "g"))?.length;
    expect(opens).toBe(2);
    // closing delimiter is mandatory
    expect(mime.endsWith(`\r\n--${boundary}--`)).toBe(true);
  });

  test("two attachments → two application/pdf parts", () => {
    const two = buildMime(TO, SUBJECT, BODY, [
      { filename: "a.pdf", mimeType: "application/pdf", base64: "QQ==" },
      { filename: "b.pdf", mimeType: "application/pdf", base64: "Qg==" },
    ]);
    expect(two.match(/Content-Type: application\/pdf/g)?.length).toBe(2);
  });
});

// ── 03.11 RPLY-01: buildMime reply-threading headers (In-Reply-To / References) ───────────────
// buildMime is pure/exported — assert the header BYTES directly. The threading param carries the
// RFC 5322 Message-ID header value (angle-bracketed), NEVER the Gmail id (Pitfall 2).

describe("buildMime — reply threading headers (RPLY-01)", () => {
  const MSG_ID = "<CAF-reply-1@mail.gmail.com>";
  const GMAIL_ID = "fix-reply"; // the Gmail id — must NEVER appear as In-Reply-To
  const threading = { inReplyTo: MSG_ID, references: MSG_ID };

  test("zero-attachment: emits In-Reply-To + References after Subject, before MIME-Version", () => {
    const mime = buildMime(TO, `Re: ${SUBJECT}`, BODY, [], threading);
    expect(mime).toBe(
      [
        `To: ${TO}`,
        `Subject: Re: ${SUBJECT}`,
        `In-Reply-To: ${MSG_ID}`,
        `References: ${MSG_ID}`,
        "MIME-Version: 1.0",
        'Content-Type: text/plain; charset="UTF-8"',
        "",
        BODY,
      ].join("\r\n"),
    );
  });

  test("multipart: emits In-Reply-To + References after Subject in the attachment branch too", () => {
    const mime = buildMime(
      TO,
      `Re: ${SUBJECT}`,
      BODY,
      [{ filename: "a.pdf", mimeType: "application/pdf", base64: "QQ==" }],
      threading,
    );
    // The two threading lines sit between Subject and MIME-Version (the header block, before boundary).
    expect(mime).toContain(
      `Subject: Re: ${SUBJECT}\r\nIn-Reply-To: ${MSG_ID}\r\nReferences: ${MSG_ID}\r\nMIME-Version: 1.0`,
    );
  });

  test("no threading arg: NEITHER header appears (a normal compose is unaffected)", () => {
    const mime = buildMime(TO, SUBJECT, BODY);
    expect(mime).not.toContain("In-Reply-To:");
    expect(mime).not.toContain("References:");
  });

  test("In-Reply-To carries the Message-ID header (angle brackets), NEVER the Gmail id (Pitfall 2)", () => {
    const mime = buildMime(TO, `Re: ${SUBJECT}`, BODY, [], threading);
    expect(mime).toContain(`In-Reply-To: ${MSG_ID}`);
    expect(mime).toMatch(/In-Reply-To: <[^>]+>/); // angle-bracketed
    expect(mime).not.toContain(`In-Reply-To: ${GMAIL_ID}`); // never the API id
  });

  // 03.11 SECURITY: subject + threading anchor come from INBOUND (attacker-controlled) mail headers.
  // A crafted CR/LF must NOT smuggle an extra header into the reply the user sends. buildMime strips
  // CR/LF at the header sink, so the injected "Bcc:" line lands nowhere in the emitted message.
  test("CRLF in an inbound-derived subject/threading value cannot inject a new header", () => {
    const evil = "<id@x>\r\nBcc: victim@evil.example";
    const mime = buildMime(TO, "Re: hi\r\nBcc: victim@evil.example", BODY, [], {
      inReplyTo: evil,
      references: evil,
    });
    // The security property: "Bcc:" must never BEGIN a header line (no CR/LF in front of it).
    expect(mime).not.toMatch(/[\r\n]Bcc:/i);
    // The newline was stripped (not folded), so the attacker's text is inert mid-line, not a header.
    expect(mime).toContain("Subject: Re: hiBcc: victim@evil.example");
    expect(mime).toContain("In-Reply-To: <id@x>Bcc: victim@evil.example");
  });
});

// ── 03.7-02: pickPlainText — the ONE new parsing seam (recursive MIME tree, base64url) ────────
// Pure + exported precisely so it is unit-testable without a mailbox (research Pitfall 4).

describe("pickPlainText (MIME text/plain extraction)", () => {
  test("nested parts tree → the first text/plain leaf, base64url-decoded", () => {
    const tree = {
      mimeType: "multipart/mixed",
      parts: [
        { mimeType: "application/pdf", body: { data: b64url("not text") } },
        {
          mimeType: "multipart/alternative",
          parts: [
            { mimeType: "text/html", body: { data: b64url("<p>ignored</p>") } },
            { mimeType: "text/plain", body: { data: b64url("the real body") } },
          ],
        },
      ],
    };
    expect(pickPlainText(tree)).toBe("the real body");
  });

  test("a top-level text/plain body (no parts) decodes", () => {
    expect(pickPlainText({ mimeType: "text/plain", body: { data: b64url("flat body") } })).toBe(
      "flat body",
    );
  });

  test("base64url alphabet (- and _) decodes — NOT standard base64", () => {
    // "??>>" base64-encodes to "Pz8+Pg==" → base64url "Pz8-Pg". Decoding it as standard base64
    // would mangle the bytes; this pins the url-safe alphabet (research Pitfall 4).
    expect(pickPlainText({ mimeType: "text/plain", body: { data: "Pz8-Pg" } })).toBe("??>>");
  });

  test("HTML-only tree → null (the caller falls back to the snippet; we NEVER parse HTML)", () => {
    const tree = {
      mimeType: "multipart/alternative",
      parts: [{ mimeType: "text/html", body: { data: b64url("<p>newsletter</p>") } }],
    };
    expect(pickPlainText(tree)).toBeNull();
  });

  test("a text/plain leaf with no data → null (never crashes)", () => {
    expect(
      pickPlainText({ mimeType: "multipart/mixed", parts: [{ mimeType: "text/plain", body: {} }] }),
    ).toBeNull();
  });
});

// ── 03.7-02: the inbox read plane over the fixture seam (SC-3) ─────────────────────────────────
// The fixture check runs BEFORE freshAccessToken, so these exercise listInbox/fetchInboxBodies
// end-to-end with NO Gmail token and no network — the same seam the offline E2E and the eval
// injection probe ride.

describe("listInbox (fixture seam + refs-only audit)", () => {
  test("a seeded fixture serves messages with fixture:true and NO token", async () => {
    const t = harness();
    await t.mutation(internal.smoke.seedInboxFixture, {
      tenantId: TENANT,
      offlineDigest: true,
      baseMs: BASE_MS,
    });
    const res = await t.action(internal.gmail.listInbox, {
      tenantId: TENANT,
      correlationId: "cid-1",
      range: "today",
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.fixture).toBe(true);
    expect(res.messages.length).toBeGreaterThan(0);
    // Mapped to the @pikar/core InboxMessageMeta shape — and the fixture's `body` must NOT ride along.
    const m = res.messages[0]!;
    expect(Object.keys(m).sort()).toEqual([
      "from",
      "id",
      "internalDate",
      "isUnread",
      "snippet",
      "subject",
    ]);
    expect(typeof m.internalDate).toBe("number");
  });

  test("exactly ONE mailbox.listed audit event, payload refs-only ({ range, resultCount })", async () => {
    const t = harness();
    await t.mutation(internal.smoke.seedInboxFixture, {
      tenantId: TENANT,
      offlineDigest: true,
      baseMs: BASE_MS,
    });
    const res = await t.action(internal.gmail.listInbox, {
      tenantId: TENANT,
      correlationId: "cid-2",
      range: "today",
    });
    const rows = await t.run((ctx) => ctx.db.query("audit").collect());
    const listed = rows.filter((r) => r.eventType === "mailbox.listed");
    expect(listed, "listInbox must write exactly one mailbox.listed event").toHaveLength(1);
    const payload = listed[0]!.payload as Record<string, unknown>;
    // The WHOLE payload — a sender/subject/snippet must be structurally absent (CLAUDE.md §4/SC-3).
    expect(Object.keys(payload).sort()).toEqual(["range", "resultCount"]);
    expect(payload.range).toBe("today");
    expect(payload.resultCount).toBe(res.ok ? res.messages.length : -1);
    expect(JSON.stringify(payload)).not.toMatch(/attacker@evil\.example|@example\.com/);
  });

  test("no fixture + no token → not_connected, and NO audit event is written", async () => {
    const t = harness();
    const res = await t.action(internal.gmail.listInbox, {
      tenantId: "tenant_with_no_mailbox",
      correlationId: "cid-3",
      range: "today",
    });
    expect(res).toEqual({ ok: false, reason: "not_connected" });
    const rows = await t.run((ctx) => ctx.db.query("audit").collect());
    expect(
      rows.filter((r) => r.eventType === "mailbox.listed"),
      "a failed list must not audit",
    ).toHaveLength(0);
  });
});

describe("fetchInboxBodies (fixture bodies, truncated)", () => {
  test("serves the fixture bodies for the requested ids only", async () => {
    const t = harness();
    await t.mutation(internal.smoke.seedInboxFixture, {
      tenantId: TENANT,
      offlineDigest: true,
      baseMs: BASE_MS,
    });
    const list = await t.action(internal.gmail.listInbox, {
      tenantId: TENANT,
      correlationId: "cid-4",
      range: "today",
    });
    if (!list.ok) throw new Error("fixture list failed");
    const ids = list.messages.slice(0, 2).map((m) => m.id);
    const res = await t.action(internal.gmail.fetchInboxBodies, { tenantId: TENANT, ids });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.bodies.map((b) => b.id)).toEqual(ids);
    expect(res.bodies.every((b) => b.body.length > 0)).toBe(true);
  });

  test("the canonical fixture carries the injection needle in a BODY (the eval probe's payload)", async () => {
    const t = harness();
    await t.mutation(internal.smoke.seedInboxFixture, {
      tenantId: TENANT,
      offlineDigest: false,
      baseMs: BASE_MS,
    });
    const list = await t.action(internal.gmail.listInbox, {
      tenantId: TENANT,
      correlationId: "cid-5",
      range: "week",
    });
    if (!list.ok) throw new Error("fixture list failed");
    const res = await t.action(internal.gmail.fetchInboxBodies, {
      tenantId: TENANT,
      ids: list.messages.map((m) => m.id),
    });
    if (!res.ok) throw new Error("fixture bodies failed");
    expect(res.bodies.some((b) => b.body.includes("attacker@evil.example"))).toBe(true);
    // …and the needle lives ONLY in a body — never in a header/snippet the list surfaces.
    expect(JSON.stringify(list.messages)).not.toMatch(/attacker@evil\.example/);
  });

  test("every body is truncated to BODY_TRUNCATE_CHARS", async () => {
    const t = harness();
    // A raw insert (audit.test.ts precedent) — the canonical fixture is deliberately short, so
    // the truncation edge needs its own oversized row.
    await t.run(async (ctx) => {
      await ctx.db.insert("inboxFixtures", {
        tenantId: TENANT,
        offlineDigest: true,
        messages: [
          {
            id: "long-1",
            from: "Verbose <v@example.com>",
            subject: "War and Peace",
            snippet: "long",
            internalDate: BASE_MS,
            body: "x".repeat(BODY_TRUNCATE_CHARS + 500),
          },
        ],
      });
    });
    const res = await t.action(internal.gmail.fetchInboxBodies, {
      tenantId: TENANT,
      ids: ["long-1"],
    });
    if (!res.ok) throw new Error("fixture bodies failed");
    expect(res.bodies[0]!.body).toHaveLength(BODY_TRUNCATE_CHARS);
  });

  test("no fixture + no token → not_connected (never throws out of the tool)", async () => {
    const t = harness();
    const res = await t.action(internal.gmail.fetchInboxBodies, {
      tenantId: "tenant_with_no_mailbox",
      ids: ["x"],
    });
    expect(res).toEqual({ ok: false, reason: "not_connected" });
  });
});

// ── 03.10-01: gmail.search over the SAME fixture seam (the resolveContacts eval seam) ─────────
// Mirrors listInbox's fixture-before-token branch so a plain-NL "email Sarah Chen…" turn can
// park candidates on the tokenless eval tenant. Live tenants (no fixture row) are proven
// untouched by the fall-through test.

describe("search (fixture seam + refs-only audit)", () => {
  test("a seeded fixture serves HeaderRecords with NO token (fixture-first)", async () => {
    const t = harness();
    await t.mutation(internal.smoke.seedInboxFixture, {
      tenantId: TENANT,
      offlineDigest: false,
      baseMs: BASE_MS,
    });
    const res = await t.action(internal.gmail.search, {
      tenantId: TENANT,
      name: "Sarah Chen",
      correlationId: "cid-s1",
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    // One HeaderRecord per fixture message, mapped from/subject/date — no snippet/body rides along.
    expect(res.records).toHaveLength(5);
    const r = res.records[0]!;
    expect(Object.keys(r).sort()).toEqual(["date", "from", "subject"]);
    expect(r.from).toBe("Sarah Chen <sarah.chen@example.com>");
    expect(r.subject).toBe("Re: Q3 numbers");
    // rankCandidates Date.parse-es rec.date — the toUTCString round-trips the fixture's epoch.
    expect(Date.parse(r.date!)).toBe(BASE_MS - 3_600_000);
  });

  test("the fixture branch writes exactly ONE refs-only mailbox.searched audit", async () => {
    const t = harness();
    await t.mutation(internal.smoke.seedInboxFixture, {
      tenantId: TENANT,
      offlineDigest: false,
      baseMs: BASE_MS,
    });
    await t.action(internal.gmail.search, {
      tenantId: TENANT,
      name: "Sarah Chen",
      correlationId: "cid-s2",
    });
    const rows = await t.run((ctx) => ctx.db.query("audit").collect());
    const searched = rows.filter((row) => row.eventType === "mailbox.searched");
    expect(searched, "search must write exactly one mailbox.searched event").toHaveLength(1);
    const payload = searched[0]!.payload as Record<string, unknown>;
    // The WHOLE payload — same shape as the token path: queryHash + count ONLY (CLAUDE.md §4).
    expect(Object.keys(payload).sort()).toEqual(["queryHash", "resultCount"]);
    expect(payload.resultCount).toBe(5);
    // No from/subject/address string may land in the payload (deliberate-leak mutation-checked).
    expect(JSON.stringify(payload)).not.toMatch(/Sarah|Chen|@example\.com|Q3/);
  });

  test("no fixture + no token → falls through to not_connected, NO audit (live path unchanged)", async () => {
    const t = harness();
    const res = await t.action(internal.gmail.search, {
      tenantId: "tenant_with_no_mailbox",
      name: "Sarah Chen",
      correlationId: "cid-s3",
    });
    expect(res).toEqual({ ok: false, reason: "not_connected" });
    const rows = await t.run((ctx) => ctx.db.query("audit").collect());
    expect(
      rows.filter((row) => row.eventType === "mailbox.searched"),
      "a failed search must not audit",
    ).toHaveLength(0);
  });

  test("SMOKE:: name-sentinel stays FIRST — routes through the sentinel even on a fixture tenant", async () => {
    const t = harness();
    await t.mutation(internal.smoke.seedInboxFixture, {
      tenantId: TENANT,
      offlineDigest: false,
      baseMs: BASE_MS,
    });
    const res = await t.action(internal.gmail.search, {
      tenantId: TENANT,
      name: "SMOKE::resolve",
      correlationId: "cid-s4",
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    // The sentinel's two fixed records — NOT the 5 fixture messages.
    expect(res.records).toHaveLength(2);
    expect(res.records[0]!.from).toContain("Sarah Smoke");
  });
});

// ── 03.11 RPLY-01: getReplyTarget — the target-header read (From/Message-ID/References/Subject/threadId)
// server-side over the SAME fixture-before-token seam. These headers/ids are returned to the
// SERVER-SIDE caller (Plan 04's replyToMessage tool) and NEVER logged — the reply anchor buildMime emits.

describe("getReplyTarget (target-header read over the fixture seam)", () => {
  test("resolves a fixture message to its From/Subject/threadId + the RFC Message-ID anchor", async () => {
    const t = harness();
    await t.mutation(internal.smoke.seedInboxFixture, {
      tenantId: TENANT,
      offlineDigest: false,
      baseMs: BASE_MS,
    });
    const res = await t.action(internal.gmail.getReplyTarget, {
      tenantId: TENANT,
      id: "fix-reply",
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.target.from).toBe("Sarah Chen <sarah.chen@example.com>");
    expect(res.target.subject).toBe("Re: Q3 numbers");
    expect(res.target.threadId).toBe("thread-reply-1");
    // In-Reply-To / References carry the RFC Message-ID header (angle brackets), NOT the Gmail id.
    expect(res.target.inReplyTo).toBe("<CAF-reply-1@mail.gmail.com>");
    expect(res.target.inReplyTo).not.toBe("fix-reply");
    // First message in the thread → References is just its own Message-ID.
    expect(res.target.references).toBe("<CAF-reply-1@mail.gmail.com>");
  });

  test("an unknown id → not_found (never a silent empty target)", async () => {
    const t = harness();
    await t.mutation(internal.smoke.seedInboxFixture, {
      tenantId: TENANT,
      offlineDigest: false,
      baseMs: BASE_MS,
    });
    const res = await t.action(internal.gmail.getReplyTarget, {
      tenantId: TENANT,
      id: "no-such-id",
    });
    expect(res).toEqual({ ok: false, reason: "not_found" });
  });

  test("no fixture + no token → not_connected (never throws out of the read)", async () => {
    const t = harness();
    const res = await t.action(internal.gmail.getReplyTarget, {
      tenantId: "tenant_with_no_mailbox",
      id: "fix-reply",
    });
    expect(res).toEqual({ ok: false, reason: "not_connected" });
  });
});

describe("seedInboxFixture (deterministic + idempotent)", () => {
  test("re-seeding replaces rather than appends (ONE row per tenant)", async () => {
    const t = harness();
    const seed = () =>
      t.mutation(internal.smoke.seedInboxFixture, {
        tenantId: TENANT,
        offlineDigest: true,
        baseMs: BASE_MS,
      });
    await seed();
    await seed();
    const rows = await t.run((ctx) => ctx.db.query("inboxFixtures").collect());
    expect(rows, "seedInboxFixture must be idempotent").toHaveLength(1);
  });

  test("the fixed message set spans today/yesterday/this week and marks one unread", async () => {
    const t = harness();
    await t.mutation(internal.smoke.seedInboxFixture, {
      tenantId: TENANT,
      offlineDigest: true,
      baseMs: BASE_MS,
    });
    const row = await t.run((ctx) => ctx.db.query("inboxFixtures").first());
    const messages = row!.messages;
    expect(messages).toHaveLength(5);
    expect(new Set(messages.map((m) => m.id)).size, "fixture ids must be unique").toBe(5);
    expect(
      messages.every((m) => m.internalDate <= BASE_MS),
      "no fixture message may post-date the clock",
    ).toBe(true);
    expect(messages.some((m) => m.isUnread === true)).toBe(true);
    // Deterministic: seeded at a fixed baseMs, the buckets are pinned.
    const dayBefore = BASE_MS - 24 * 3_600_000;
    expect(messages.filter((m) => m.internalDate > dayBefore).length, "today's messages").toBe(3);
    expect(
      messages.some((m) => m.internalDate < BASE_MS - 2 * 24 * 3_600_000),
      "an older-in-week message",
    ).toBe(true);
  });

  test("fixtures are tenant-scoped (another tenant's list stays token-gated)", async () => {
    const t = harness();
    await t.mutation(internal.smoke.seedInboxFixture, {
      tenantId: TENANT,
      offlineDigest: true,
      baseMs: BASE_MS,
    });
    const res = await t.action(internal.gmail.listInbox, {
      tenantId: "some_other_tenant",
      correlationId: "cid-6",
      range: "today",
    });
    expect(res).toEqual({ ok: false, reason: "not_connected" });
  });
});

// ── 19-05 PIPE-01: the send-path suppression backstop and the CAN-SPAM footer ─────────────────
//
// `gmail.send` is the ONE place every product send converges (`deliverApprovedPlan.ts` is its sole
// production caller). The `executePlan` filter is better UX; THIS is what makes it unbypassable —
// a suppression created after approve but before a scheduled fire is caught only here. The footer
// sits at the `buildMime` CALL SITE rather than inside `buildMime`, because `notifyExternal` is a
// second caller sending a service notice to the user's OWN mailbox and the V4 tests above pin
// `buildMime`'s bytes.

describe("gmail.send — the suppression backstop + the CAN-SPAM footer (19-05)", () => {
  const SEND_TENANT = "tenant_send";
  const SECRET = "0123456789abcdef0123456789abcdef";
  const SITE = "https://example.convex.site";
  const POSTAL = "Pikar AI, 12 Samora Ave, Dar es Salaam, TZ";
  const RECIPIENT = "dest@example.com";
  // notifyExternal reads the user's own address here first (a GET, never a write).
  const PROFILE_ENDPOINT = "https://gmail.googleapis.com/gmail/v1/users/me/profile";

  /** No audit row is written on any path below except the successful send, so these skip the
   *  aggregate component that `harness()` registers — 19-02's fork-crash lesson, re-applied. */
  const plain = () => convexTest(schema, modules);

  /** Every fetch the action makes, in order. The token refresh POSTs form-encoded bodies and the
   *  send POSTs JSON, so the raw body string is kept and parsed per assertion. */
  function mockGoogle() {
    const calls: { url: string; body: string }[] = [];
    const fetchMock = vi.fn(async (url: unknown, init?: RequestInit) => {
      calls.push({ url: String(url), body: init?.body ? String(init.body) : "" });
      if (String(url).startsWith("https://oauth2.googleapis.com/token")) {
        return new Response(JSON.stringify({ access_token: "at", expires_in: 3600 }), {
          status: 200,
        });
      }
      if (String(url) === PROFILE_ENDPOINT) {
        return new Response(JSON.stringify({ emailAddress: "owner@example.com" }), { status: 200 });
      }
      return new Response(JSON.stringify({ id: "gmail-msg-1" }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
    return {
      calls,
      posted: () => calls.filter((c) => c.url === SEND_ENDPOINT),
      /** The decoded RFC-2822 bytes actually handed to Gmail — never `req.body`. */
      mime: () => {
        const sent = calls.filter((c) => c.url === SEND_ENDPOINT);
        expect(sent).toHaveLength(1);
        const { raw } = JSON.parse(sent[0]!.body) as { raw: string };
        return Buffer.from(raw, "base64url").toString("utf8");
      },
    };
  }

  const seedTokens = (t: ReturnType<typeof convexTest>, tenantId = SEND_TENANT) =>
    t.run((ctx) =>
      ctx.db.insert("gmailTokens", { tenantId, refreshToken: "r", scope: "s", updatedAt: BASE_MS }),
    );

  const seedProfile = (t: ReturnType<typeof convexTest>, postalAddress: string | null = POSTAL) =>
    t.run((ctx) =>
      ctx.db.insert("tenantProfiles", {
        tenantId: SEND_TENANT,
        tier: "solopreneur",
        tierSource: "derived",
        derivedAt: BASE_MS,
        ...(postalAddress === null ? {} : { postalAddress }),
      }),
    );

  const seedRequest = (t: ReturnType<typeof convexTest>, recipient = RECIPIENT) =>
    t.run((ctx) =>
      ctx.db.insert("requests", {
        tenantId: SEND_TENANT,
        correlationId: `send_${crypto.randomUUID()}`,
        goal: SUBJECT,
        recipient,
        draft: BODY,
        status: "approved",
        attachmentRefs: [],
        createdAt: BASE_MS,
      }),
    );

  beforeEach(() => {
    vi.stubEnv("UNSUBSCRIBE_SECRET", SECRET);
    vi.stubEnv("CONVEX_SITE_URL", SITE);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  // Row 15. Asserted on the BYTES handed to the send endpoint, not on `req.body` — every stage
  // before this call site (plans.body → plans.recipientBodies → requests.draft → editedBody) is a
  // bypass, so a footer that only exists in a stored field proves nothing.
  test("a normal send carries the postal address AND an /unsubscribe/ URL in its MIME bytes", async () => {
    const t = harness();
    await seedTokens(t);
    await seedProfile(t);
    const requestId = await seedRequest(t);
    const g = mockGoogle();

    expect(await t.action(internal.gmail.send, { requestId })).toEqual({
      delivered: true,
      messageId: "gmail-msg-1",
    });

    const mime = g.mime();
    expect(mime).toContain(BODY); // the drafted body is intact...
    expect(mime).toContain(POSTAL); // ...and the footer rides in the same bytes
    expect(mime).toContain(`${SITE}/unsubscribe/`);
    // The footer is appended at the send boundary, never written back onto the stored draft.
    expect((await t.run((ctx) => ctx.db.get(requestId)))?.draft).toBe(BODY);
  });

  // Row 14 — THE test that proves the guard is in the SEND path. The approve-time filter ran while
  // this recipient was clean; the suppression is created afterwards, exactly as it would be during
  // a scheduled send's wait. Only the backstop can see it.
  test("a suppression created AFTER approve is refused at send, and nothing is POSTed", async () => {
    const t = plain();
    await seedTokens(t);
    await seedProfile(t);
    const requestId = await seedRequest(t); // frozen at approve time, recipient clean
    // ...then the recipient unsubscribes.
    await t.run((ctx) =>
      ctx.db.insert("suppressions", {
        tenantId: SEND_TENANT,
        address: RECIPIENT,
        suppressedAt: BASE_MS,
        source: "unsubscribe-link" as const,
      }),
    );
    const g = mockGoogle();

    expect(await t.action(internal.gmail.send, { requestId })).toEqual({
      delivered: false,
      reason: "suppressed",
    });
    // Not one call — the refusal lands before the token refresh, so no credential is even minted.
    expect(g.calls).toHaveLength(0);
  });

  test("Marketing-captured consent never overrides the suppression send backstop", async () => {
    const t = plain();
    await seedTokens(t);
    await seedProfile(t);
    await t.run((ctx) =>
      ctx.db.insert("suppressions", {
        tenantId: SEND_TENANT,
        address: RECIPIENT,
        suppressedAt: BASE_MS,
        source: "unsubscribe-link",
      }),
    );
    const lead = await t
      .withIdentity({ subject: SEND_TENANT })
      .mutation(api.contacts.recordMarketingLead, {
        email: RECIPIENT.toUpperCase(),
        consent: { wording: "Operator asserts per-person consent" },
      });
    expect(lead).toMatchObject({ consentRecorded: true, suppressed: true, outboundAllowed: false });
    const requestId = await seedRequest(t);
    const g = mockGoogle();
    expect(await t.action(internal.gmail.send, { requestId })).toEqual({
      delivered: false,
      reason: "suppressed",
    });
    // The caller owns the blocked terminal; send returns a permanent refusal without mutation.
    expect((await t.run((ctx) => ctx.db.get(requestId)))?.status).toBe("approved");
    expect(g.calls).toHaveLength(0);
    expect(g.posted()).toHaveLength(0);
  });

  test("a suppressed MEMBER of a group recipient string refuses the whole row (the join's ceiling)", async () => {
    const t = plain();
    await seedTokens(t);
    await seedProfile(t);
    const requestId = await seedRequest(t, "a@example.com, b@example.com");
    await t.run((ctx) =>
      ctx.db.insert("suppressions", {
        tenantId: SEND_TENANT,
        address: "b@example.com",
        suppressedAt: BASE_MS,
        source: "user-marked" as const,
      }),
    );
    const g = mockGoogle();

    // This is WHY the per-address drop lives in executePlan: by the time a joined string reaches
    // here the only honest answer is to refuse all of it.
    expect(await t.action(internal.gmail.send, { requestId })).toEqual({
      delivered: false,
      reason: "suppressed",
    });
    expect(g.posted()).toHaveLength(0);
  });

  // Row 16b. The postal address was present at approve and gone at fire. Fail CLOSED — the same
  // precedent as the missing attachment blob: never silently send without the promised part.
  test("a tenant whose postalAddress vanished between approve and fire makes the send THROW", async () => {
    const t = plain();
    await seedTokens(t);
    await seedProfile(t, null); // a profile row, but the field is gone
    const requestId = await seedRequest(t);
    const g = mockGoogle();

    await expect(t.action(internal.gmail.send, { requestId })).rejects.toThrow(
      /postal address|UNSUBSCRIBE_SECRET/,
    );
    expect(g.posted()).toHaveLength(0);
  });

  test("an unset UNSUBSCRIBE_SECRET also refuses the send, and the error says so", async () => {
    const t = plain();
    vi.stubEnv("UNSUBSCRIBE_SECRET", "");
    await seedTokens(t);
    await seedProfile(t);
    const requestId = await seedRequest(t);
    const g = mockGoogle();

    // The deployment, not the tenant, is misconfigured — the message must name both possibilities
    // or the operator hunts a postal address that is already set (19-02's "sending stopped
    // working" symptom).
    await expect(t.action(internal.gmail.send, { requestId })).rejects.toThrow(
      /UNSUBSCRIBE_SECRET/,
    );
    expect(g.posted()).toHaveLength(0);
  });

  // Row 17, second half. The service notice goes to the user's OWN mailbox: it is not commercial
  // mail, it has no recipient to unsubscribe, and a footer on it would be a lie.
  test("notifyExternal's service notice carries NO postal address and NO unsubscribe URL", async () => {
    const t = plain();
    await seedTokens(t);
    await seedProfile(t);
    const g = mockGoogle();

    await t.action(internal.notifyExternal.dispatch, {
      tenantId: SEND_TENANT,
      kind: "agent.timeout",
    });

    const mime = g.mime();
    expect(mime).toContain("owner@example.com"); // it really did send (non-vacuity)
    expect(mime).not.toContain(POSTAL);
    expect(mime).not.toContain("/unsubscribe/");
  });
});

// ── 29-03 (KNOW-01): the metadata-first knowledge query ──────────────────────────────────────
//
// A SEPARATE verb from `search`. `search` is the contact resolver: it asks `from:/to:` about a
// NAME and returns headers only. This asks a free-text business question, lists ids under a hard
// cap and hydrates a SMALLER selected set of bodies — the untrusted plane the toolless synthesis
// reads. The two must not be merged: their privacy shapes are opposites (one never fetches a body,
// the other exists to).

describe("escapeGmailQuery — the model can never write Gmail query language (29-03)", () => {
  test("operator punctuation is NEUTRALIZED to spaces, never passed through", () => {
    // `:` is what makes `from:`, `label:`, `has:`, `in:`, `is:` operators at all. Deleting the
    // whole token would silently change the question; turning the character into a space keeps
    // every word the planner wrote while removing every operator it could have built.
    expect(escapeGmailQuery("from:ceo@rival.example invoice")).toBe(
      "from ceo@rival.example invoice",
    );
    expect(escapeGmailQuery('subject:"board deck"')).toBe("subject board deck");
    expect(escapeGmailQuery("has:attachment in:anywhere pricing")).toBe(
      "has attachment in anywhere pricing",
    );
    expect(escapeGmailQuery("(renewal OR churn)")).toBe("renewal churn");
    expect(escapeGmailQuery("label:^smartlabel_personal")).toBe("label ^smartlabel_personal");
  });

  test("negation, must-have and the bare boolean operators cannot survive", () => {
    // `-term` excludes in Gmail and `+term` forces it: a planner phrase that happened to start
    // with a dash would silently invert the search.
    expect(escapeGmailQuery("-refund +urgent")).toBe("refund urgent");
    expect(escapeGmailQuery("acme OR northwind AND renewal")).toBe("acme northwind renewal");
    // Lower-case `or`/`and` are ordinary words to Gmail, and are kept as the user's own words.
    expect(escapeGmailQuery("cats or dogs")).toBe("cats or dogs");
  });

  test("no escaped query can contain a character that carries query-language meaning", () => {
    const hostile = [
      'from:x OR label:y "quoted" (grouped) {braced} [bracketed] back\\slash',
      "line\r\nbreak\ttab",
      "rfc822msgid:<abc@def>",
    ];
    for (const raw of hostile) {
      const q = escapeGmailQuery(raw);
      for (const ch of [":", '"', "'", "(", ")", "{", "}", "[", "]", "\\", "\n", "\r", "\t"]) {
        expect([raw, ch, q.includes(ch)]).toEqual([raw, ch, false]);
      }
    }
  });

  test("the escaped query is bounded in words and in characters", () => {
    const many = escapeGmailQuery(Array.from({ length: 40 }, (_, i) => `w${i}`).join(" "));
    // LITERALS, not the constants the implementation uses — a test whose oracle moves with the
    // subject can never fail (the 29-01 round-2 lesson).
    expect(many.split(" ")).toHaveLength(12);
    expect(escapeGmailQuery("x".repeat(500)).length).toBe(200);
    expect(SEARCH_CAPS.queryCharCap).toBe(200);
  });

  test("a phrase with no letter or digit escapes to nothing — the caller must refuse to list", () => {
    // Fail CLOSED: an empty `q` lists the whole mailbox, which would answer a question with
    // arbitrary recent mail. `clampSearchPlan` refuses these at the planner boundary; the action
    // treats one reaching it as an invariant violation, not as a search.
    expect(escapeGmailQuery("--- ::: ()")).toBe("");
    expect(escapeGmailQuery("   ")).toBe("");
  });
});

describe("gmail.knowledgeQuery — bounded, GET-only, never throwing on a governed state (29-03)", () => {
  const KQ_TENANT = "tenant_knowledge";
  const listUrl = "https://gmail.googleapis.com/gmail/v1/users/me/messages";

  type MailStub = { id: string; subject: string; body: string; internalDate: number };

  /**
   * Gmail's OWN error shape, and the choice is the whole point. A JSON envelope PARSES, so a
   * handler that never checks `res.ok` sails past it with `messages: undefined` and reports an
   * empty successful read — the defect. An HTML page throws on `.json()` and is caught, which is
   * why an HTML-only stub cannot tell the two implementations apart.
   */
  const errorResponse = (status: number, html = false) =>
    new Response(
      html ? "<html>502 Bad Gateway</html>" : JSON.stringify({ error: { code: status } }),
      {
        status,
      },
    );

  /**
   * A fake Gmail that serves one list page and a `format=full` get per id.
   *
   * `listStatus`, `bodyStatus` and `throwOn` are what the ORIGINAL 29-03 suite could not say, and
   * that is why a failed read reporting as an empty successful one shipped green: every stub
   * answered 200. An error body is deliberately HTML, because Gmail's 5xx pages are, and
   * `res.json()` on one throws rather than parsing to `{}`.
   */
  function mockMailbox(
    mails: MailStub[],
    opts: {
      nextPageToken?: string;
      listStatus?: number;
      /** Ids whose `format=full` GET fails, with the status it fails with. */
      bodyStatus?: Record<string, number>;
      /** "list" | a message id — the fetch REJECTS rather than answering (DNS, TLS, timeout). */
      throwOn?: string;
      /** Answer errors with an HTML page instead of Gmail's JSON error envelope. */
      htmlError?: boolean;
    } = {},
  ) {
    const calls: { url: string; method: string }[] = [];
    vi.stubGlobal("fetch", async (url: unknown, init?: RequestInit) => {
      const u = String(url);
      calls.push({ url: u, method: init?.method ?? "GET" });
      if (u.startsWith("https://oauth2.googleapis.com/token")) {
        return new Response(JSON.stringify({ access_token: "at", expires_in: 3600 }), {
          status: 200,
        });
      }
      if (u.startsWith(`${listUrl}?`)) {
        if (opts.throwOn === "list") throw new TypeError("fetch failed");
        if (opts.listStatus !== undefined && opts.listStatus !== 200)
          return errorResponse(opts.listStatus, opts.htmlError);
        return new Response(
          JSON.stringify({
            messages: mails.map((m) => ({ id: m.id })),
            ...(opts.nextPageToken === undefined ? {} : { nextPageToken: opts.nextPageToken }),
          }),
          { status: 200 },
        );
      }
      const id = u.slice(`${listUrl}/`.length).split("?")[0] ?? "";
      if (opts.throwOn === id) throw new TypeError("fetch failed");
      const bad = opts.bodyStatus?.[id];
      if (bad !== undefined) return errorResponse(bad, opts.htmlError);
      const found = mails.find((m) => m.id === id);
      return new Response(
        JSON.stringify({
          internalDate: String(found?.internalDate ?? 0),
          snippet: "snippet fallback",
          payload: {
            mimeType: "text/plain",
            headers: [{ name: "Subject", value: found?.subject ?? "" }],
            body: { data: Buffer.from(found?.body ?? "", "utf8").toString("base64url") },
          },
        }),
        { status: 200 },
      );
    });
    return { calls, gets: () => calls.filter((c) => c.method === "GET") };
  }

  const seedKqTokens = (t: ReturnType<typeof convexTest>, tenantId = KQ_TENANT) =>
    t.run((ctx) =>
      ctx.db.insert("gmailTokens", { tenantId, refreshToken: "r", scope: "s", updatedAt: BASE_MS }),
    );

  const mail = (n: number, over: Partial<MailStub> = {}): MailStub => ({
    id: `m${n}`,
    subject: `Subject ${n}`,
    body: `Body of message ${n}`,
    internalDate: BASE_MS - n * 3_600_000,
    ...over,
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test("the ESCAPED query reaches Gmail — the planner's raw text never does", async () => {
    const t = convexTest(schema, modules);
    await seedKqTokens(t);
    const g = mockMailbox([mail(1)]);

    await t.action(internal.gmail.knowledgeQuery, {
      tenantId: KQ_TENANT,
      query: 'from:ceo@rival.example subject:"board deck"',
    });

    const list = g.calls.find((c) => c.url.startsWith(`${listUrl}?`));
    expect(list, "no list call was made").toBeDefined();
    const q = new URL(String(list?.url)).searchParams.get("q");
    // The VALUE Gmail receives, decoded — URL encoding does not protect this boundary, because
    // Gmail decodes `q` before it parses operators.
    expect(q).toBe("from ceo@rival.example subject board deck");
    expect(q).not.toContain("from:");
    expect(q).not.toContain('"');
  });

  test("bodies are hydrated for a SMALLER selected cap than the list cap", async () => {
    const t = convexTest(schema, modules);
    await seedKqTokens(t);
    const mails = Array.from({ length: 12 }, (_, i) => mail(i));
    const g = mockMailbox(mails);

    const res = await t.action(internal.gmail.knowledgeQuery, {
      tenantId: KQ_TENANT,
      query: "renewal",
    });

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    // LITERALS: 12 listed, 5 hydrated. A test that read the caps from the module could not fail.
    expect(res.listed).toBe(12);
    expect(res.messages).toHaveLength(5);
    expect(res.messages.map((m) => m.id)).toEqual(["m0", "m1", "m2", "m3", "m4"]);
    // …and exactly five `format=full` gets happened. Hydrating all twelve would be the leak.
    expect(g.gets().filter((c) => c.url.includes("format=full"))).toHaveLength(5);
  });

  test("the list itself is capped, so a huge match set cannot drive an unbounded fan-out", async () => {
    const t = convexTest(schema, modules);
    await seedKqTokens(t);
    const g = mockMailbox([mail(1)]);
    await t.action(internal.gmail.knowledgeQuery, { tenantId: KQ_TENANT, query: "renewal" });
    const list = g.calls.find((c) => c.url.startsWith(`${listUrl}?`));
    expect(new URL(String(list?.url)).searchParams.get("maxResults")).toBe("25");
  });

  test("each hydrated body is truncated to the search plane's own character cap", async () => {
    const t = convexTest(schema, modules);
    await seedKqTokens(t);
    mockMailbox([mail(1, { body: "x".repeat(4000) })]);

    const res = await t.action(internal.gmail.knowledgeQuery, {
      tenantId: KQ_TENANT,
      query: "renewal",
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.messages[0]?.body).toHaveLength(1500);
    expect(SEARCH_CAPS.evidenceTextCharCap).toBe(1500);
    expect(res.messages[0]?.bodyTruncated).toBe(true);
  });

  test("THE SUBJECT LINE IS CAPPED TOO — and unlike the body there is no flag to notice it", async () => {
    // An attacker-controlled subject with no bound flows straight into `Evidence.label`, which
    // `synthesisPrompt` interpolates onto the fence line. The body cap has `bodyTruncated` to
    // report the loss; the label cap has nothing, so removing the truncation left the whole suite
    // green. The literal 200 is pinned beside the constant rather than read from it.
    const t = convexTest(schema, modules);
    await seedKqTokens(t);
    mockMailbox([mail(1, { subject: "S".repeat(4000) })]);

    const res = await t.action(internal.gmail.knowledgeQuery, {
      tenantId: KQ_TENANT,
      query: "renewal",
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.messages[0]?.subject).toHaveLength(200);
    expect(SEARCH_CAPS.labelCharCap).toBe(200);
    // A SHORT subject is untouched — the negative control, so the cap is not just "always 240".
    mockMailbox([mail(2, { subject: "Renewal terms" })]);
    const short = await t.action(internal.gmail.knowledgeQuery, {
      tenantId: KQ_TENANT,
      query: "renewal",
    });
    expect(short.ok).toBe(true);
    if (!short.ok) return;
    expect(short.messages[0]?.subject).toBe("Renewal terms");
  });

  test("a further page of results is REPORTED, never silently dropped", async () => {
    const t = convexTest(schema, modules);
    await seedKqTokens(t);
    mockMailbox([mail(1)], { nextPageToken: "page-2" });

    const res = await t.action(internal.gmail.knowledgeQuery, {
      tenantId: KQ_TENANT,
      query: "renewal",
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.more).toBe(true);
  });

  test("a tenant with no token gets not_connected — never a throw, never an empty success", async () => {
    const t = convexTest(schema, modules);
    expect(
      await t.action(internal.gmail.knowledgeQuery, { tenantId: KQ_TENANT, query: "renewal" }),
    ).toEqual({ ok: false, reason: "not_connected" });
  });

  test("a dead refresh token gets reauth — never a throw", async () => {
    const t = convexTest(schema, modules);
    await seedKqTokens(t);
    vi.stubGlobal("fetch", async () => new Response("invalid_grant", { status: 400 }));
    expect(
      await t.action(internal.gmail.knowledgeQuery, { tenantId: KQ_TENANT, query: "renewal" }),
    ).toEqual({ ok: false, reason: "reauth" });
  });

  // A phrase the planner boundary CANNOT refuse, because `clampSearchPlan` only requires one
  // letter or digit while `escapeGmailQuery` additionally drops the bare boolean operators. The
  // code comment here used to call this seam unreachable and justify a THROW with it; the claim was
  // about another module and it was false, so the throw was live in the product.
  test.each([
    ["--- :::"],
    ["OR"],
    ["AND"],
    ["OR AND"],
    ["+OR"],
    ['"OR"'],
  ])("a query that escapes to nothing (%j) is a governed `unplanned`, not a throw and not a listing", async (query) => {
    const t = convexTest(schema, modules);
    await seedKqTokens(t);
    const g = mockMailbox([mail(1)]);
    expect(await t.action(internal.gmail.knowledgeQuery, { tenantId: KQ_TENANT, query })).toEqual({
      ok: false,
      reason: "unplanned",
    });
    // And nothing was asked of Gmail at all. Listing on an empty `q` returns arbitrary recent
    // mail, which is an answer about messages nobody asked about.
    expect(g.calls).toHaveLength(0);
  });

  // ── A FAILED READ IS NOT AN EMPTY MAILBOX ──────────────────────────────────────────────────
  //
  // Every one of these returned `{ok: true, messages: [], listed: 0}` or an evidence row of two
  // empty strings before the fix, which the inbox adapter then published as
  // `{status: "available", source: "inbox", returned: 0}` — "we searched your mailbox and there is
  // nothing there" for a mailbox Gmail refused to show us.

  test.each([
    [500],
    [429],
    [403],
  ])("a %i on the LIST is provider_error — never an empty successful read", async (status) => {
    const t = convexTest(schema, modules);
    await seedKqTokens(t);
    mockMailbox([mail(1), mail(2)], { listStatus: status });
    expect(
      await t.action(internal.gmail.knowledgeQuery, { tenantId: KQ_TENANT, query: "renewal" }),
    ).toEqual({ ok: false, reason: "provider_error" });
  });

  test("a NON-JSON error page is provider_error too, not an escaped parse error", async () => {
    const t = convexTest(schema, modules);
    await seedKqTokens(t);
    mockMailbox([mail(1)], { listStatus: 502, htmlError: true });
    expect(
      await t.action(internal.gmail.knowledgeQuery, { tenantId: KQ_TENANT, query: "renewal" }),
    ).toEqual({ ok: false, reason: "provider_error" });
  });

  test("a rejected LIST fetch (DNS/TLS/timeout) is provider_error, not a rejection", async () => {
    const t = convexTest(schema, modules);
    await seedKqTokens(t);
    mockMailbox([mail(1)], { throwOn: "list" });
    expect(
      await t.action(internal.gmail.knowledgeQuery, { tenantId: KQ_TENANT, query: "renewal" }),
    ).toEqual({ ok: false, reason: "provider_error" });
  });

  test("a message Gmail refuses to hand over is DROPPED and the drop is reported", async () => {
    const t = convexTest(schema, modules);
    await seedKqTokens(t);
    mockMailbox([mail(1), mail(2)], { bodyStatus: { m2: 500 } });
    const res = await t.action(internal.gmail.knowledgeQuery, {
      tenantId: KQ_TENANT,
      query: "renewal",
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    // The good message survives; the refused one does NOT arrive as an evidence row whose subject
    // and body are "" and whose date is 1970 — which is what `res.json()` on an error body built.
    expect(res.messages.map((m) => m.id)).toEqual(["m1"]);
    expect(res.messages.map((m) => m.subject)).toEqual(["Subject 1"]);
    expect(res.hydrationFailed).toBe(true);
    expect(res.listed).toBe(2);
  });

  test("a rejected BODY fetch is reported the same way, not thrown", async () => {
    const t = convexTest(schema, modules);
    await seedKqTokens(t);
    mockMailbox([mail(1), mail(2)], { throwOn: "m1" });
    const res = await t.action(internal.gmail.knowledgeQuery, {
      tenantId: KQ_TENANT,
      query: "renewal",
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.messages.map((m) => m.id)).toEqual(["m2"]);
    expect(res.hydrationFailed).toBe(true);
  });

  test("a fully successful read reports NO hydration failure — the negative control", async () => {
    const t = convexTest(schema, modules);
    await seedKqTokens(t);
    mockMailbox([mail(1), mail(2)]);
    const res = await t.action(internal.gmail.knowledgeQuery, {
      tenantId: KQ_TENANT,
      query: "renewal",
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.hydrationFailed).toBe(false);
    expect(res.messages).toHaveLength(2);
  });

  test("the fixture seam is checked BEFORE the token, and it is tenant-scoped", async () => {
    const t = convexTest(schema, modules);
    await t.run((ctx) =>
      ctx.db.insert("inboxFixtures", {
        tenantId: KQ_TENANT,
        offlineDigest: false,
        messages: [
          {
            id: "fx-1",
            from: "Sarah <s@example.com>",
            subject: "Renewal terms",
            snippet: "s",
            internalDate: BASE_MS,
            body: "The renewal is due in March.",
          },
          {
            id: "fx-2",
            from: "Ben <b@example.com>",
            subject: "Lunch",
            snippet: "s",
            internalDate: BASE_MS - 1000,
            body: "Pizza?",
          },
        ],
      }),
    );

    // No token, no fetch stub: reaching either would fail the test.
    const res = await t.action(internal.gmail.knowledgeQuery, {
      tenantId: KQ_TENANT,
      query: "renewal",
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    // The fixture is FILTERED by the escaped terms — a seam that returned every fixture message
    // regardless of the question would make every offline assertion below it vacuous.
    expect(res.messages.map((m) => m.id)).toEqual(["fx-1"]);

    // Another tenant sees no fixture at all and falls through to the token gate.
    expect(
      await t.action(internal.gmail.knowledgeQuery, { tenantId: "other", query: "renewal" }),
    ).toEqual({ ok: false, reason: "not_connected" });
  });

  test("a knowledge query writes NO audit row — the coordinator owns the one search event", async () => {
    // `search` and `listInbox` each write their own refs-only event. This verb deliberately does
    // not: a unified search hits several sources and must produce ONE `knowledge.searched` event,
    // owned by the coordinator, or the log plane learns the shape of the question from the count
    // of per-source rows.
    const t = convexTest(schema, modules);
    await seedKqTokens(t);
    mockMailbox([mail(1)]);
    await t.action(internal.gmail.knowledgeQuery, { tenantId: KQ_TENANT, query: "renewal" });
    expect(await t.run((ctx) => ctx.db.query("audit").collect())).toEqual([]);
  });
});
