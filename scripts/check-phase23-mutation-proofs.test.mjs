import assert from "node:assert/strict";
import { test } from "node:test";
import { patched, plan, verifySourceHashes } from "./check-phase23-mutation-proofs.mjs";

test("duplicate or absent mutation anchors cannot silently pass", () => {
  assert.throws(() => patched("x x", { path: "fixture", from: "x", to: "y" }));
  assert.throws(() => patched("z", { path: "fixture", from: "x", to: "y" }));
  assert.throws(() => patched("x", { path: "fixture", from: "x", to: "y", after: "absent" }));
});

test("bounded export patch preserves neighbouring exports and CRLF bytes", () => {
  const before =
    "export const a = {\r\n  x: true\r\n};\r\nexport const b = {\r\n  x: true\r\n};\r\n";
  assert.equal(
    patched(before, { path: "fixture", from: "x: true", to: "x: false", after: "export const a" }),
    before.replace("x: true", "x: false"),
  );
});

test("all 17 exact current targets are patchable without running tests or models", () => {
  const targets = plan();
  assert.equal(targets.length, 17);
  assert.equal(targets.filter((target) => target.command.kind === "compile").length, 1);
  assert.ok(
    targets
      .find((target) => target.id === "23-01-lineage-substitute")
      .qualification.includes("optional"),
  );
  assert.ok(
    targets
      .find((target) => target.id === "23-01-subset-composite")
      .qualification.includes("composite"),
  );
});

test("source drift after snapshot or after control cannot acquire a passing receipt", () => {
  const original = [{ path: "source.ts", sha256: "a".repeat(64) }];
  const changed = [{ path: "source.ts", sha256: "b".repeat(64) }];
  assert.doesNotThrow(() => verifySourceHashes(original, original, original));
  assert.throws(() => verifySourceHashes(original, changed, changed), /differs from snapshot/);
  assert.throws(() => verifySourceHashes(original, original, changed), /changed after control/);
  assert.throws(() => verifySourceHashes([], original, original), /differs from snapshot/);
  assert.throws(() => verifySourceHashes(original, [], []), /cannot be empty/);
});
