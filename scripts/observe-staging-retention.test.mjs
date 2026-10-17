import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { buildObservationQuery } from "./observe-staging-retention.mjs";

const created = Date.parse("2026-10-17T10:18:29.493Z");
const expires = Date.parse("2026-10-24T10:18:29.493Z");
const sweep = Date.parse("2026-10-24T11:15:00Z");
const checkpoint = { _creationTime: created, expiresAt: expires };
const fixture = {
  _id: "local-only",
  tenantId: "retention-qualification-local-only",
  _creationTime: created - 10,
};
const fingerprint = createHash("sha256")
  .update(JSON.stringify([fixture._id, fixture.tenantId, fixture._creationTime]))
  .digest("hex");
const observationQuery = buildObservationQuery(fingerprint);
const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;
function check(now, rows, interviews = [fixture]) {
  class Clock extends Date {
    static now() {
      return now;
    }
  }
  const ctx = {
    db: {
      query(table) {
        if (table === "foundationInterviews")
          return { take: async (bound) => interviews.slice(0, bound) };
        assert.equal(table, "foundationTranscripts");
        return {
          withIndex(name, fn) {
            assert.equal(name, "by_tenant");
            fn({
              eq(key, value) {
                assert.equal(key, "tenantId");
                assert.equal(value, fixture.tenantId);
              },
            });
            return { take: async (bound) => rows.slice(0, bound) };
          },
        };
      },
    },
  };
  return new AsyncFunction("ctx", "Date", observationQuery)(ctx, Clock);
}
test("presence before expiry cannot be reported as elapsed retention", async () => {
  const result = await check(expires - 1, [checkpoint]);
  assert.equal(result.beforeExpiryPresenceVerified, true);
  assert.equal(result.elapsedExpiryAbsenceObserved, false);
  assert.equal(result.cronAttributionVerified, false);
  assert.equal(result.nativeLifecycleVerified, false);
  assert.equal(JSON.stringify(result).includes(fixture.tenantId), false);
});
test("early disappearance, replacement and duplicate checkpoints fail closed", async () => {
  await assert.rejects(check(expires - 1, []), /EARLY_ABSENCE/);
  await assert.rejects(
    check(expires - 1, [{ ...checkpoint, expiresAt: expires + 1000 }]),
    /FIXTURE_CHANGED/,
  );
  await assert.rejects(check(expires - 1, [checkpoint, checkpoint]), /DUPLICATE_CHECKPOINT/);
});
test("incomplete and ambiguous inventories cannot qualify deletion", async () => {
  await assert.rejects(check(sweep, [], Array(201).fill(fixture)), /INCOMPLETE_INVENTORY/);
  await assert.rejects(check(sweep, [], []), /AMBIGUOUS_FIXTURE/);
  await assert.rejects(check(sweep, [], [fixture, fixture]), /AMBIGUOUS_FIXTURE/);
});
test("expiry alone does not qualify the sweep; overdue presence fails", async () => {
  assert.equal((await check(expires, [])).elapsedExpiryAbsenceObserved, false);
  assert.equal((await check(sweep - 1, [checkpoint])).elapsedExpiryAbsenceObserved, false);
  await assert.rejects(check(sweep, [checkpoint]), /PURGE_NOT_OBSERVED/);
  assert.equal((await check(sweep, [])).elapsedExpiryAbsenceObserved, true);
  assert.equal((await check(sweep, [])).cronAttributionVerified, false);
});
test("a replacement interview cannot qualify an absent original checkpoint", async () => {
  await assert.rejects(check(sweep, [], [{ ...fixture, _id: "replacement" }]), /FIXTURE_REPLACED/);
  assert.throws(() => buildObservationQuery(null), /MISSING_FIXTURE_PIN/);
});
