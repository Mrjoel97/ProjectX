// An exact-source checkpoint for Wave 6's disabled six-file candidate. This is an identity gate,
// not a substitute for an independent technical review or a recurrence-eligibility verdict.
// Usage: node scripts/check-recurrence-source-review.mjs [--self-test]
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { argv, exit, stdout } from "node:process";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const base = "packages/backend/candidate/recurrence";
const auditPath =
  ".planning/phases/47-the-schedule-row-that-re-arms/47-23-CURRENT-SOURCE-AND-REAL-RAIL-AUDIT.md";
const historicalReviewPath =
  ".planning/phases/47-the-schedule-row-that-re-arms/47-22-TECHNICAL-REVIEW.md";
const reviewPath =
  ".planning/phases/47-the-schedule-row-that-re-arms/47-24-CURRENT-SOURCE-INDEPENDENT-REVIEW.md";
const files = [
  "schema.ts",
  "model.ts",
  "model.test.ts",
  "README.md",
  "tsconfig.json",
  "vitest.config.mts",
];
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

function recordedHash(markdown, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const matches = [
    ...markdown.matchAll(
      new RegExp(`^\\| \\x60${escaped}\\x60 \\| \\x60([a-f0-9]{64})\\x60 \\|$`, "gm"),
    ),
  ];
  return matches.length === 1 ? matches[0][1] : null;
}

function checkIdentity(actual, audit, review, historicalReview) {
  const errors = [];
  if (
    !/^\*\*Current-source review:\*\* limited candidate design review at `47-24-CURRENT-SOURCE-INDEPENDENT-REVIEW\.md`; real rails and activation unreviewed$/m.test(
      audit,
    )
  )
    errors.push("current-source review status is not the limited exact-source verdict");
  if (
    !review.includes(
      "**Verdict:** limited candidate design review accepted; operational recurrence remains `defer`.",
    )
  )
    errors.push("current review lacks the limited defer verdict");
  for (const name of files) {
    for (const [label, text] of [
      ["audit", audit],
      ["current review", review],
    ]) {
      const recorded = recordedHash(text, name);
      if (!recorded) errors.push(`missing or ambiguous ${label} hash: ${name}`);
      else if (recorded !== actual[name]) errors.push(`stale ${label} hash: ${name}`);
    }
  }
  for (const name of files.slice(0, 3)) {
    const old = recordedHash(historicalReview, name);
    if (!old) errors.push(`missing or ambiguous historical review hash: ${name}`);
    else if (old === actual[name])
      errors.push(`pending correction contradicts matching review hash: ${name}`);
  }
  if (!historicalReview.includes("not an\n> independent GO for the current candidate"))
    errors.push("historical review lacks its current-source correction");
  return errors;
}

function selfTest() {
  const h = (char) => char.repeat(64);
  const actual = Object.fromEntries(files.map((name) => [name, h("a")]));
  const audit = `**Current-source review:** limited candidate design review at \`47-24-CURRENT-SOURCE-INDEPENDENT-REVIEW.md\`; real rails and activation unreviewed\n${files.map((name) => `| \`${name}\` | \`${h("a")}\` |`).join("\n")}`;
  const review = `**Verdict:** limited candidate design review accepted; operational recurrence remains \`defer\`.\n${files.map((name) => `| \`${name}\` | \`${h("a")}\` |`).join("\n")}`;
  const historicalReview = `${files
    .slice(0, 3)
    .map((name) => `| \`${name}\` | \`${h("b")}\` |`)
    .join("\n")}\n> not an\n> independent GO for the current candidate`;
  const cases = [
    ["valid limited identity", checkIdentity(actual, audit, review, historicalReview).length === 0],
    [
      "changed candidate",
      checkIdentity({ ...actual, "model.ts": h("c") }, audit, review, historicalReview).some((e) =>
        e.includes("stale audit hash: model.ts"),
      ),
    ],
    [
      "missing audit row",
      checkIdentity(
        actual,
        audit.replace(`| \`README.md\` | \`${h("a")}\` |`, ""),
        review,
        historicalReview,
      ).some((e) => e.includes("missing or ambiguous audit hash: README.md")),
    ],
    [
      "stale current review",
      checkIdentity(actual, audit, review.replace(h("a"), h("c")), historicalReview).some((e) =>
        e.includes("stale current review hash: schema.ts"),
      ),
    ],
    [
      "missing current review row",
      checkIdentity(
        actual,
        audit,
        review.replace(`| \`model.ts\` | \`${h("a")}\` |`, ""),
        historicalReview,
      ).some((e) => e.includes("missing or ambiguous current review hash: model.ts")),
    ],
    [
      "missing limited review verdict",
      checkIdentity(
        actual,
        audit,
        review.replace("limited candidate design review accepted", "enable-safe"),
        historicalReview,
      ).some((e) => e.includes("lacks the limited defer verdict")),
    ],
    [
      "missing limited status",
      checkIdentity(
        actual,
        audit.replace("limited candidate design review", "accepted"),
        review,
        historicalReview,
      ).some((e) => e.includes("limited exact-source verdict")),
    ],
    [
      "historical hash silently matches",
      checkIdentity(
        actual,
        audit,
        review,
        historicalReview.replace(
          `| \`schema.ts\` | \`${h("b")}\` |`,
          `| \`schema.ts\` | \`${h("a")}\` |`,
        ),
      ).some((e) => e.includes("contradicts matching review hash: schema.ts")),
    ],
    [
      "missing correction",
      checkIdentity(
        actual,
        audit,
        review,
        historicalReview.replace(
          "not an\n> independent GO for the current candidate",
          "independent GO",
        ),
      ).some((e) => e.includes("lacks its current-source correction")),
    ],
  ];
  for (const [name, ok] of cases) stdout.write(`${ok ? "OK" : "FAIL"} ${name}\n`);
  return cases.every(([, ok]) => ok) ? 0 : 1;
}

// The registered free mode must also inspect the real tree; a synthetic-only green run would
// leave review drift invisible to CI.
if (argv.includes("--self-test") && selfTest() !== 0) exit(1);
const actual = Object.fromEntries(
  files.map((name) => [name, sha256(readFileSync(join(root, base, name)))]),
);
const errors = checkIdentity(
  actual,
  readFileSync(join(root, auditPath), "utf8"),
  readFileSync(join(root, reviewPath), "utf8"),
  readFileSync(join(root, historicalReviewPath), "utf8"),
);
for (const error of errors) stdout.write(`REFUSED ${error}\n`);
stdout.write(
  errors.length
    ? `REFUSED ${errors.length} source-review identity error(s)\n`
    : "PASS disabled candidate identity is pinned to limited current-source review\n",
);
exit(errors.length ? 1 : 0);
