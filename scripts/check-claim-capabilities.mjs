// Repository-only proof that named product claims still point at their capability contracts.
// This is intentionally source-anchored, not an English-language truth engine: it cannot prove a
// deployment, provider, owner, legal, or Wave 8 acceptance state.
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { argv, env, exit, stdout } from "node:process";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const root = env.CLAIM_CHECK_ROOT ? resolve(env.CLAIM_CHECK_ROOT) : repositoryRoot;

const SOURCES = [
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

const CLAIM_IDS = [
  "invite-only-admission-positive",
  "human-approval-positive",
  "append-only-audit-positive",
  "gmail-delivery-positive",
  "outlook-delivery-blocked",
  "onboarding-completion-positive",
  "onboarding-server-contract-positive",
  "legal-readiness-blocked",
  "marketing-gmail-positive",
  "marketing-meta-instagram-blocked",
  "marketing-linkedin-blocked",
  "marketing-tiktok-blocked",
  "marketing-x-blocked",
  "marketing-youtube-blocked",
  "marketing-playbook-blocked",
];

function sourceReader(base = root) {
  return (path) => readFileSync(resolve(base, path), "utf8");
}

function validate(read) {
  const errors = [];
  const files = Object.fromEntries(SOURCES.map((path) => [path, read(path)]));
  const requireText = (path, text, reason) => {
    if (!files[path].includes(text)) errors.push(`${path}: missing ${reason}`);
  };
  const rejectText = (path, pattern, reason) => {
    if (pattern.test(files[path])) errors.push(`${path}: ${reason}`);
  };

  const claims = files["packages/core/src/capabilityClaims.ts"];
  if ((claims.match(/\bid:\s*"[^"]+"/g) ?? []).length !== CLAIM_IDS.length)
    errors.push("capabilityClaims.ts: capability inventory count changed");
  for (const id of CLAIM_IDS)
    requireText("packages/core/src/capabilityClaims.ts", `id: "${id}"`, id);
  for (const source of [
    "apps/web/app/page.tsx",
    "apps/web/app/privacy/page.tsx",
    "apps/web/app/terms/page.tsx",
    "apps/web/app/(app)/dashboard/onboarding/page.tsx",
    "apps/web/app/(app)/dashboard/marketing/MarketingView.tsx",
    "packages/backend/convex/onboarding.ts",
    "packages/core/src/marketing.ts",
    "docs/playbooks/marketing.md",
  ])
    requireText(
      "packages/core/src/capabilityClaims.ts",
      `source: "${source}"`,
      `source inventory ${source}`,
    );
  for (const predicate of [
    "marketingChannelState",
    "legalHasPlaceholders",
    "onboardingCanComplete",
  ])
    requireText(
      "packages/core/src/capabilityClaims.ts",
      predicate,
      `contract predicate ${predicate}`,
    );

  requireText(
    "apps/web/app/page.tsx",
    "Private beta · by invitation · human approval required",
    "invite-only admission claim",
  );
  requireText(
    "apps/web/app/page.tsx",
    "Nothing is sent, booked or filed until you say so.",
    "human-approval claim",
  );
  requireText(
    "apps/web/app/page.tsx",
    "The audit log is append-only. Records can be added, never edited or deleted.",
    "append-only audit claim",
  );
  requireText(
    "apps/web/app/privacy/page.tsx",
    "draft and send messages as you",
    "Gmail delivery claim",
  );
  requireText(
    "apps/web/app/privacy/page.tsx",
    "Outlook mail is not implemented yet",
    "Outlook blocked state",
  );
  requireText(
    "apps/web/app/(app)/dashboard/onboarding/page.tsx",
    "canComplete",
    "server-owned onboarding completion contract",
  );
  requireText(
    "packages/backend/convex/onboarding.ts",
    "canComplete",
    "server completion predicate",
  );
  requireText("packages/backend/convex/onboarding.ts", "firstSendOffer", "server first-send offer");
  requireText(
    "apps/web/app/(app)/dashboard/onboarding/page.tsx",
    "INCOMPLETE_ONBOARDING",
    "actionable incomplete onboarding refusal",
  );
  requireText("apps/web/app/legal.ts", "HAS_PLACEHOLDERS", "legal placeholder result");
  requireText("apps/web/app/legal.ts", "LEGAL_READINESS", "legal readiness result");
  requireText("apps/web/app/legal.ts", "LEGAL_REVIEW_DEFERRED", "legal deferred result");
  requireText("apps/web/app/terms/page.tsx", "Draft — not yet in force.", "legal blocked state");
  rejectText(
    "apps/web/app/terms/page.tsx",
    /legal review complete|legal readiness complete/i,
    "claims completed legal readiness while placeholders remain",
  );
  requireText(
    "apps/web/app/(app)/dashboard/marketing/MarketingView.tsx",
    "marketingChannelState(channel.id, { connected, configured })",
    "closed marketing state adapter",
  );
  requireText(
    "apps/web/app/(app)/dashboard/marketing/MarketingView.tsx",
    'state.status === "connected"',
    "Gmail connected predicate",
  );
  requireText(
    "apps/web/app/(app)/dashboard/marketing/MarketingView.tsx",
    "Social publishing is unavailable. Any outbound email requires your separate approval.",
    "social publishing refusal",
  );
  rejectText(
    "apps/web/app/(app)/dashboard/marketing/MarketingView.tsx",
    /social publishing is available/i,
    "claims unavailable social publishing is available",
  );
  requireText(
    "packages/core/src/marketing.ts",
    "The legal entity is not formed, and provider suitability and permissions review has not started.",
    "social channel prerequisite",
  );
  for (const id of ["meta-instagram", "linkedin", "tiktok", "x", "youtube"])
    requireText("packages/core/src/marketing.ts", `id: "${id}"`, `marketing channel ${id}`);
  requireText(
    "docs/playbooks/marketing.md",
    "Marketing cannot publish or automatically send",
    "marketing playbook ceiling",
  );
  requireText(
    "docs/playbooks/marketing.md",
    "publishing is unavailable",
    "marketing blocked copy policy",
  );
  return errors;
}

function selfTest() {
  const files = new Map(SOURCES.map((path) => [path, sourceReader()(path)]));
  let failures = 0;
  const check = (ok, reason) => {
    if (!ok) failures += 1;
    stdout.write(`  ${ok ? "OK  " : "FAIL"} ${reason}\n`);
  };
  check(validate((path) => files.get(path)).length === 0, "checked-in claim inventory passes");
  files.set(
    "apps/web/app/(app)/dashboard/marketing/MarketingView.tsx",
    files
      .get("apps/web/app/(app)/dashboard/marketing/MarketingView.tsx")
      .replace("Social publishing is unavailable.", "Social publishing is available."),
  );
  check(
    validate((path) => files.get(path)).some((error) => error.includes("social publishing")),
    "blocked social copy mutation fails",
  );
  return failures === 0 ? 0 : 1;
}

if (argv.includes("--self-test")) exit(selfTest());

let errors;
try {
  errors = validate(sourceReader());
} catch (error) {
  stdout.write(`CLAIM CHECK FAILED — cannot read source inventory: ${error.message}\n`);
  exit(1);
}
for (const error of errors) stdout.write(`CLAIM CHECK FAILED — ${error}\n`);
stdout.write(
  errors.length === 0
    ? `Claim capability check passed for ${CLAIM_IDS.length} claims across ${SOURCES.length} sources.\n`
    : `Claim capability check failed with ${errors.length} violation(s).\n`,
);
exit(errors.length === 0 ? 0 : 1);
