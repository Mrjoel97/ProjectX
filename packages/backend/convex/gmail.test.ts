// buildMime self-check (V3 multipart structurally correct + V4 zero-attachment byte-identical),
// plus the 03.7-02 inbox read plane: the fixture seam, the refs-only mailbox.listed audit, and
// the pure MIME text/plain picker.
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { BODY_TRUNCATE_CHARS } from "@pikar/core";
import { internal } from "./_generated/api";
import schema from "./schema";
import { buildMime, pickPlainText } from "./gmail";
// listInbox's refs-only mailbox.listed audit hits the auditCounts aggregate; register the
// component (relative import — the package blocks the deep specifier) so the REAL audit path runs
// under convex-test instead of throwing "component not registered" (cockpitTools.test.ts precedent).
import aggregateSchema from "../node_modules/@convex-dev/aggregate/src/component/schema.js";

// @ts-expect-error import.meta.glob is provided by Vite/vitest at runtime.
const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);
// @ts-expect-error import.meta.glob is provided by Vite/vitest at runtime.
const aggregateModules = import.meta.glob("../node_modules/@convex-dev/aggregate/src/component/**/!(*.test).ts");

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
    const mime = buildMime(TO, `Re: ${SUBJECT}`, BODY, [
      { filename: "a.pdf", mimeType: "application/pdf", base64: "QQ==" },
    ], threading);
    // The two threading lines sit between Subject and MIME-Version (the header block, before boundary).
    expect(mime).toContain(`Subject: Re: ${SUBJECT}\r\nIn-Reply-To: ${MSG_ID}\r\nReferences: ${MSG_ID}\r\nMIME-Version: 1.0`);
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
    expect(pickPlainText({ mimeType: "text/plain", body: { data: b64url("flat body") } })).toBe("flat body");
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
    expect(pickPlainText({ mimeType: "multipart/mixed", parts: [{ mimeType: "text/plain", body: {} }] })).toBeNull();
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
    expect(Object.keys(m).sort()).toEqual(["from", "id", "internalDate", "isUnread", "snippet", "subject"]);
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
    expect(rows.filter((r) => r.eventType === "mailbox.listed"), "a failed list must not audit").toHaveLength(0);
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
    const res = await t.action(internal.gmail.fetchInboxBodies, { tenantId: TENANT, ids: ["long-1"] });
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
    const res = await t.action(internal.gmail.getReplyTarget, { tenantId: TENANT, id: "fix-reply" });
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
    const res = await t.action(internal.gmail.getReplyTarget, { tenantId: TENANT, id: "no-such-id" });
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
      t.mutation(internal.smoke.seedInboxFixture, { tenantId: TENANT, offlineDigest: true, baseMs: BASE_MS });
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
    expect(messages.every((m) => m.internalDate <= BASE_MS), "no fixture message may post-date the clock").toBe(true);
    expect(messages.some((m) => m.isUnread === true)).toBe(true);
    // Deterministic: seeded at a fixed baseMs, the buckets are pinned.
    const dayBefore = BASE_MS - 24 * 3_600_000;
    expect(messages.filter((m) => m.internalDate > dayBefore).length, "today's messages").toBe(3);
    expect(messages.some((m) => m.internalDate < BASE_MS - 2 * 24 * 3_600_000), "an older-in-week message").toBe(true);
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
