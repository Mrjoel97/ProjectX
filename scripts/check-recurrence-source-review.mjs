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
const reviewPath = ".planning/phases/47-the-schedule-row-that-re-arms/47-22-TECHNICAL-REVIEW.md";
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

function checkIdentity(actual, audit, review) {
  const errors = [];
  if (!/^\*\*Current-source review:\*\* pending$/m.test(audit))
    errors.push(
      "current-source review must be explicitly pending until a fresh review is recorded",
    );
  for (const name of files) {
    const recorded = recordedHash(audit, name);
    if (!recorded) errors.push(`missing or ambiguous audit hash: ${name}`);
    else if (recorded !== actual[name]) errors.push(`stale audit hash: ${name}`);
  }
  for (const name of files.slice(0, 3)) {
    const old = recordedHash(review, name);
    if (!old) errors.push(`missing or ambiguous historical review hash: ${name}`);
    else if (old === actual[name])
      errors.push(`pending correction contradicts matching review hash: ${name}`);
  }
  if (!review.includes("not an\n> independent GO for the current candidate"))
    errors.push("historical review lacks its current-source correction");
  return errors;
}

function selfTest() {
  const h = (char) => char.repeat(64);
  const actual = Object.fromEntries(files.map((name) => [name, h("a")]));
  const audit = `**Current-source review:** pending\n${files.map((name) => `| \`${name}\` | \`${h("a")}\` |`).join("\n")}`;
  const review = `${files
    .slice(0, 3)
    .map((name) => `| \`${name}\` | \`${h("b")}\` |`)
    .join("\n")}\n> not an\n> independent GO for the current candidate`;
  const cases = [
    ["valid pending identity", checkIdentity(actual, audit, review).length === 0],
    [
      "changed candidate",
      checkIdentity({ ...actual, "model.ts": h("c") }, audit, review).some((e) =>
        e.includes("stale audit hash: model.ts"),
      ),
    ],
    [
      "missing audit row",
      checkIdentity(actual, audit.replace(`| \`README.md\` | \`${h("a")}\` |`, ""), review).some(
        (e) => e.includes("missing or ambiguous audit hash: README.md"),
      ),
    ],
    [
      "missing pending status",
      checkIdentity(actual, audit.replace("pending", "accepted"), review).some((e) =>
        e.includes("explicitly pending"),
      ),
    ],
    [
      "historical hash silently matches",
      checkIdentity(
        actual,
        audit,
        review.replace(`| \`schema.ts\` | \`${h("b")}\` |`, `| \`schema.ts\` | \`${h("a")}\` |`),
      ).some((e) => e.includes("contradicts matching review hash: schema.ts")),
    ],
    [
      "missing correction",
      checkIdentity(
        actual,
        audit,
        review.replace("not an\n> independent GO for the current candidate", "independent GO"),
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
);
for (const error of errors) stdout.write(`REFUSED ${error}\n`);
stdout.write(
  errors.length
    ? `REFUSED ${errors.length} source-review identity error(s)\n`
    : "PASS disabled candidate identity is pinned as pending fresh review\n",
);
exit(errors.length ? 1 : 0);
