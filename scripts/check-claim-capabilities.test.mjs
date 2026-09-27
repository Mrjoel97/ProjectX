import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const repo = process.cwd();
const fixture = mkdtempSync(join(tmpdir(), "pikar-claim-check-"));
const sources = [
  "packages/core/src/capabilityClaims.ts",
  "packages/core/src/marketing.ts",
  "apps/web/app/page.tsx",
  "apps/web/app/legal.ts",
  "apps/web/app/privacy/page.tsx",
  "apps/web/app/terms/page.tsx",
  "apps/web/app/(app)/dashboard/onboarding/page.tsx",
  "apps/web/app/(app)/dashboard/marketing/MarketingView.tsx",
  "packages/backend/convex/onboarding.ts",
  "docs/playbooks/marketing.md",
];

try {
  for (const source of sources)
    cpSync(join(repo, source), join(fixture, source), { recursive: false });

  const run = () =>
    spawnSync(process.execPath, [join(repo, "scripts/check-claim-capabilities.mjs")], {
      cwd: repo,
      env: { ...process.env, CLAIM_CHECK_ROOT: fixture },
      encoding: "utf8",
    });
  const mutate = (file, from, to) => {
    const path = join(fixture, file);
    const before = readFileSync(path, "utf8");
    assert.ok(before.includes(from), `fixture anchor exists: ${from}`);
    writeFileSync(path, before.replace(from, to));
  };

  assert.equal(run().status, 0, "checked-in source inventory passes");

  mutate("apps/web/app/page.tsx", "by invitation", "for everyone");
  assert.notEqual(run().status, 0, "removing invite-only language fails");
  mutate("apps/web/app/page.tsx", "for everyone", "by invitation");

  mutate(
    "apps/web/app/(app)/dashboard/marketing/MarketingView.tsx",
    "Social publishing is unavailable.",
    "Social publishing is available.",
  );
  assert.notEqual(run().status, 0, "positive social publishing claim fails while blocked");
  mutate(
    "apps/web/app/(app)/dashboard/marketing/MarketingView.tsx",
    "Social publishing is available.",
    "Social publishing is unavailable.",
  );

  mutate("apps/web/app/terms/page.tsx", "Draft — not yet in force.", "Legal review complete.");
  assert.notEqual(run().status, 0, "legal completion claim fails while placeholders remain");
  mutate("apps/web/app/terms/page.tsx", "Legal review complete.", "Draft — not yet in force.");

  mutate(
    "packages/core/src/capabilityClaims.ts",
    'id: "marketing-youtube-blocked",',
    'id: "deleted-inventory-entry",',
  );
  assert.notEqual(run().status, 0, "deleting a registered capability claim fails");

  console.log("claim-capability mutation tests PASSED");
} finally {
  rmSync(fixture, { recursive: true, force: true });
}
