// @vitest-environment node
//
// Static-scan enforcement of audit immutability. Convex has no append-only
// primitive, so insert-only is enforced by convention + this test:
//   (a) audit.ts contains NO db.patch / db.replace / db.delete
//   (b) audit.ts exports only internal (non client-callable) builders
//   (c) no PUBLIC query/mutation/action in convex/*.ts writes the `audit` table
//
// Runs in the `node` environment (overrides the edge-runtime default) because
// it reads source files off disk with node:fs.
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";

const convexDir = dirname(fileURLToPath(import.meta.url));

function readSource(file: string): string {
  return readFileSync(join(convexDir, file), "utf8");
}

// Public builder constructors: `= query(`, `= mutation(`, `= action(`.
// \b prevents matching `internalMutation(` / `internalQuery(` / `internalAction(`.
const PUBLIC_BUILDER = /=\s*\b(query|mutation|action)\b\s*\(/;

const AUDIT_INSERT = /\.insert\(\s*["']audit["']/;

test("audit.ts contains no db.patch / db.replace / db.delete", () => {
  const src = readSource("audit.ts");
  expect(src).not.toMatch(/\.patch\s*\(/);
  expect(src).not.toMatch(/\.replace\s*\(/);
  expect(src).not.toMatch(/\.delete\s*\(/);
});

test("audit.ts exports only internal (non client-callable) builders", () => {
  const src = readSource("audit.ts");
  expect(src).not.toMatch(PUBLIC_BUILDER);
  expect(src).toMatch(/internalMutation\s*\(/);
});

test("no PUBLIC function writes the audit table", () => {
  const files = readdirSync(convexDir).filter(
    (f) => f.endsWith(".ts") && !f.endsWith(".test.ts") && !f.endsWith(".d.ts"),
  );

  for (const file of files) {
    const src = readSource(file);
    if (AUDIT_INSERT.test(src)) {
      // Any module that writes `audit` must expose NO public builder — only
      // internalMutation may write the audit table.
      expect(src, `${file} writes audit but exposes a public builder`).not.toMatch(PUBLIC_BUILDER);
    }
  }
});
