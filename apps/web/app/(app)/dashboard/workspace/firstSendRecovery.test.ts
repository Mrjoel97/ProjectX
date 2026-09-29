import { readFileSync } from "node:fs";
import { expect, test } from "vitest";

const source = readFileSync(new URL("./cards.tsx", import.meta.url), "utf8");

test("postal refusal recovers through tenantProfile.saveFacts and requires an explicit re-approve", () => {
  expect(source).toContain("api.tenantProfile.saveFacts");
  expect(source).toContain('data-testid="postal-recovery"');
  expect(source).toContain("await saveFacts({ postalAddress })");
  expect(source).toContain("approve again when ready");
  expect(source).not.toContain("await saveFacts({ postalAddress });\n              await execute(");
});

test("provider refusals link to the selected provider's existing recovery surface", () => {
  expect(source).toContain("microsoft_not_connected");
  expect(source).toContain("mail_scope_missing");
  expect(source).toContain('href: "/connect-microsoft"');
  expect(source).toContain('href: "/connect-gmail"');
});
