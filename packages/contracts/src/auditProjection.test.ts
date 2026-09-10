import { describe, expect, test } from "vitest";
import {
  AUDIT_VIEWER_CATEGORIES,
  AUDIT_VIEWER_EVENTS,
  MAX_REF_STRING_LENGTH,
  projectAuditRow,
} from "./auditProjection";

/**
 * The projection is the ONLY thing standing between `audit.payload` and a browser.
 *
 * The mockup (docs/design/mockups/pending-pages.html) claims this viewer is "safe by
 * construction, not by filtering" because the rows carry refs and counts only. That claim is
 * FALSE and this suite is where it dies: `audit.log` takes `payload: v.any()`, `AuditPayload` is
 * a compile-time interface assigned straight out of `any` with no check, and ~96 write sites feed
 * it. `piiCounts: Record<string, number>` is a nested object sitting in production rows RIGHT NOW
 * (intake.ts:253, pipeline.ts:196, vaultExtract.ts:497). Filtering is the boundary; the type never
 * was.
 */

type Row = Parameters<typeof projectAuditRow>[0];

const row = (over: Partial<Row> = {}): Row => ({
  ts: 1_754_460_000_000,
  eventType: "plan.discarded",
  actor: "user",
  correlationId: "c_7f3ad21",
  payload: { planId: "k17abc", kind: "media" },
  ...over,
});

describe("audit viewer projection — the payload boundary", () => {
  test("vertical controls and outcomes expose bounded refs without document or dataset values", () => {
    const control = projectAuditRow(
      row({
        eventType: "vertical_pack.control",
        payload: {
          verticalId: "engineering",
          disabled: true,
          filename: "private-runbook.md",
        },
      }),
    );
    expect(control.known).toBe(true);
    expect(control.refs).toEqual({ verticalId: "engineering", disabled: true });
    const outcome = projectAuditRow(
      row({
        eventType: "vertical_pack.outcome",
        payload: {
          verticalId: "data",
          candidateId: "candidate_1",
          event: "artifact_created",
          artifactId: "doc_1",
          claimCount: 3,
          citedClaimCount: 2,
          unsupportedClaimCount: 1,
          outcome: "partial",
          costBucket: "under_one_dollar",
          filename: "private-payroll.csv",
          values: ["Alice", 12345],
        },
      }),
    );
    expect(outcome.known).toBe(true);
    expect(outcome.refs).toMatchObject({ artifactId: "doc_1", claimCount: 3, outcome: "partial" });
    expect(outcome.refs).not.toHaveProperty("filename");
    expect(outcome.refs).not.toHaveProperty("values");
    expect(
      projectAuditRow(
        row({
          eventType: "vertical_pack.outcome",
          payload: {
            reason: { nested: "private" },
            artifactId: "A document containing prose",
          },
        }),
      ).unsafeDrops,
    ).toBe(2);
  });
  test("a known event keeps only its allowlisted keys", () => {
    const p = projectAuditRow(row({ payload: { planId: "k17abc", kind: "media", secret: "x" } }));
    expect(p.known).toBe(true);
    expect(p.refs).toEqual({ planId: "k17abc", kind: "media" });
    expect("secret" in p.refs).toBe(false);
  });

  test("an unknown event is a shell — timestamp, actor, correlation, ZERO payload detail", () => {
    const p = projectAuditRow(row({ eventType: "not.an.event", payload: { planId: "k17abc" } }));
    expect(p.known).toBe(false);
    expect(p.refs).toEqual({});
    expect(p.ts).toBe(1_754_460_000_000);
    expect(p.correlationRef).toBe("c_7f3ad21");
  });

  test("a nested object in an ALLOWLISTED key is dropped, never stringified", () => {
    // The gate under test is the SHAPE gate, and it needs an allowlisted key to be reached at all.
    // `piiCounts` (the sibling test below) is refused by the KEY gate and proves nothing about
    // what happens to an object we did look at — a stringify fallback survived every other test
    // in this file until this one existed.
    const p = projectAuditRow(
      row({ payload: { planId: { toString: "ceo@acme.com" }, kind: "media" } }),
    );
    expect(p.refs).toEqual({ kind: "media" });
    expect(p.unsafeDrops).toBe(1);
    expect(JSON.stringify(p)).not.toContain("acme");
  });

  test("a nested object is dropped — this is the shape production already writes", () => {
    // request.redacted, exactly as pipeline.ts:196 writes it.
    const p = projectAuditRow(
      row({
        eventType: "request.redacted",
        payload: {
          requestId: "req_1",
          safeTextHash: "sha256:abc",
          piiCounts: { email: 2, phone: 1 },
        },
      }),
    );
    expect(p.refs).toEqual({ requestId: "req_1", safeTextHash: "sha256:abc" });
    expect(JSON.stringify(p)).not.toContain("email");
  });

  test("an array of objects is dropped, never flattened or stringified", () => {
    const p = projectAuditRow(
      row({ payload: { planId: "k17abc", kind: [{ to: "ceo@acme.com" }] } }),
    );
    expect(p.refs).toEqual({ planId: "k17abc" });
    expect(JSON.stringify(p)).not.toContain("acme");
  });

  test("an email address is refused even in an allowlisted key", () => {
    const p = projectAuditRow(row({ payload: { planId: "ceo@acme.com", kind: "media" } }));
    expect(p.refs).toEqual({ kind: "media" });
    expect(p.unsafeDrops).toBe(1);
  });

  test("prose is refused: a ref never carries whitespace", () => {
    const p = projectAuditRow(row({ payload: { kind: "Re: your Q3 numbers look wrong" } }));
    expect(p.refs).toEqual({});
    expect(p.unsafeDrops).toBe(1);
  });

  test("an oversized string is DROPPED, never truncated — half a body is still a body", () => {
    const long = "a".repeat(MAX_REF_STRING_LENGTH + 1);
    const p = projectAuditRow(row({ payload: { planId: long, kind: "media" } }));
    expect(p.refs).toEqual({ kind: "media" });
    expect(p.unsafeDrops).toBe(1);
  });

  test("message/body/prompt-like keys are not allowlisted anywhere in the table", () => {
    const banned = ["body", "message", "prompt", "text", "subject", "email", "address", "content"];
    for (const [event, keys] of Object.entries(AUDIT_VIEWER_EVENTS)) {
      for (const key of keys) {
        expect(banned, `${event}.${key}`).not.toContain(key.toLowerCase());
      }
    }
  });

  test("a raw user id in the payload is not allowlisted (owner.granted keeps the flag, not the id)", () => {
    const p = projectAuditRow(
      row({
        eventType: "owner.granted",
        actor: "owner",
        payload: { owner: true, userId: "k9zid" },
      }),
    );
    expect(p.refs).toEqual({ owner: true });
    expect(JSON.stringify(p)).not.toContain("k9zid");
  });

  test("a raw actor id never crosses the boundary — it normalizes to `you`", () => {
    const p = projectAuditRow(row({ actor: "kd7f2n3xq9v0abcdefghijklmn" }));
    expect(p.actor).toBe("you");
    expect(JSON.stringify(p)).not.toContain("kd7f2n3xq9v0");
  });

  test("actors normalize to a closed set", () => {
    expect(projectAuditRow(row({ actor: "user" })).actor).toBe("you");
    expect(projectAuditRow(row({ actor: "system" })).actor).toBe("system");
    expect(projectAuditRow(row({ actor: "render" })).actor).toBe("system");
    expect(projectAuditRow(row({ actor: "agent" })).actor).toBe("agent");
    expect(projectAuditRow(row({ actor: "owner" })).actor).toBe("owner");
    expect(projectAuditRow(row({ actor: "operator" })).actor).toBe("owner");
  });

  test("string arrays survive; a long or dirty member kills the whole array", () => {
    const ok = projectAuditRow(
      row({ eventType: "finance.claims_applied", payload: { count: 3, fields: ["mrr", "burn"] } }),
    );
    expect(ok.refs.fields).toEqual(["mrr", "burn"]);
    const bad = projectAuditRow(
      row({ eventType: "finance.claims_applied", payload: { count: 3, fields: ["mrr", "a b c"] } }),
    );
    expect("fields" in bad.refs).toBe(false);
    expect(bad.unsafeDrops).toBe(1);
  });

  test("a non-finite number is not a count", () => {
    const p = projectAuditRow(
      row({ eventType: "media.rendered", payload: { renderMs: Number.NaN, planId: "k1" } }),
    );
    expect("renderMs" in p.refs).toBe(false);
  });

  test("null and undefined are absent, not `null` on the screen, and are not unsafe", () => {
    const p = projectAuditRow(
      row({ eventType: "vault.promoted", payload: { vaultDocId: "d1", sourcePlanId: null } }),
    );
    expect(p.refs).toEqual({ vaultDocId: "d1" });
    expect(p.unsafeDrops).toBe(0);
  });

  test("a payload that is not an object at all yields a shell, never a stringified blob", () => {
    for (const payload of ["a whole email body", 42, null, undefined, ["x"]]) {
      const p = projectAuditRow(row({ payload }));
      expect(p.refs).toEqual({});
      expect(JSON.stringify(p)).not.toContain("a whole email body");
    }
  });

  test("an event name that is not a safe token is not echoed back", () => {
    const p = projectAuditRow(row({ eventType: "plan.<img src=x onerror=alert(1)>" }));
    expect(p.eventType).toBe("unknown");
    expect(p.known).toBe(false);
    expect(JSON.stringify(p)).not.toContain("onerror");
  });

  test("a correlation id that is not a safe token is emptied, not echoed", () => {
    const p = projectAuditRow(row({ correlationId: "hello world <script>" }));
    expect(p.correlationRef).toBe("");
    expect(JSON.stringify(p)).not.toContain("script");
  });

  test("a prototype key is not an event — `constructor` is unknown, not a Function", () => {
    for (const eventType of ["constructor", "toString", "__proto__", "hasOwnProperty"]) {
      const p = projectAuditRow(row({ eventType, payload: { planId: "k1" } }));
      expect(p.known, eventType).toBe(false);
      expect(p.refs).toEqual({});
    }
  });

  test("category is the event namespace and comes from a closed derived set", () => {
    expect(projectAuditRow(row()).category).toBe("plan");
    expect(projectAuditRow(row({ eventType: "not.an.event" })).category).toBe("other");
    expect(AUDIT_VIEWER_CATEGORIES).toContain("plan");
    expect(AUDIT_VIEWER_CATEGORIES).not.toContain("other");
  });

  test("INJECTION SWEEP: no hostile value reaches the projected JSON, whatever key carries it", () => {
    // WHAT THIS DOES NOT CLAIM, said plainly rather than implied by omission: the guarantee is
    // SHAPE — no prose, no addresses, no nesting, no markup, bounded length. A credential-shaped
    // token ("sk-live-0000") is character-for-character indistinguishable from a document id, so a
    // write site that puts one in an allowlisted key defeats this and no projection can see it.
    // Asserting otherwise would be the mockup's "safe by construction" lie in a new costume.
    const needles = [
      "ceo@acme.com",
      "Dear Sarah, here are the Q3 numbers",
      "+1 415 555 0100",
      "<script>alert(1)</script>",
    ];
    // Each needle is fed to every allowlisted key of every event THREE ways — bare, wrapped in an
    // object and wrapped in an array — because the key gate and the shape gate refuse for
    // different reasons and only the bare form exercises the first.
    const wrappings = [
      (n: string): unknown => n,
      (n: string): unknown => ({ deep: n }),
      (n: string): unknown => [{ deep: n }],
    ];
    for (const [event, keys] of Object.entries(AUDIT_VIEWER_EVENTS)) {
      for (const needle of needles) {
        for (const wrap of wrappings) {
          const payload: Record<string, unknown> = { hostile: needle, nested: { deep: needle } };
          for (const key of keys) payload[key] = wrap(needle);
          const json = JSON.stringify(projectAuditRow(row({ eventType: event, payload })));
          expect(json, `${event} leaked ${needle}`).not.toContain(needle);
        }
      }
    }
  });
});
