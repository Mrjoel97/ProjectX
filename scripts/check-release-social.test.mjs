import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  runSocialReleasePreflight,
  SOCIAL_RELEASE_FLAGS,
  verifySocialRelease,
} from "./check-release-social.mjs";

const anchors = ["AUTH_RESEND_KEY", "AUTH_EMAIL_FROM"];
function fakeCli({ names = anchors, values = {}, inventoryError = false, getError = false } = {}) {
  const calls = [];
  return {
    calls,
    read(args) {
      calls.push(args);
      if (args[0] === "list") {
        assert.deepEqual(args, ["list", "--names-only"]);
        if (inventoryError) throw new Error("private transport details");
        return typeof names === "string" ? names : `${names.join("\n")}\n`;
      }
      assert.equal(args[0], "get");
      assert.ok(SOCIAL_RELEASE_FLAGS.includes(args[1]));
      assert.equal(args.length, 2);
      if (getError) throw new Error("private configured value");
      return values[args[1]];
    },
  };
}
function run(cli) {
  const logs = [],
    errors = [];
  const code = runSocialReleasePreflight({
    readCli: cli.read,
    log: (text) => logs.push(text),
    error: (text) => errors.push(text),
  });
  return { code, logs, errors };
}

test("missing flags are off only after a valid names-only inventory; unrelated variables are never read", () => {
  const cli = fakeCli({ names: [...anchors, "UNRELATED_PRIVATE_KEY"] });
  assert.equal(run(cli).code, 0);
  assert.deepEqual(cli.calls, [["list", "--names-only"]]);
});

test("all four explicitly false flags pass with only allowlisted gets, including CRLF output", () => {
  const cli = fakeCli({
    names: [...anchors, ...SOCIAL_RELEASE_FLAGS].join("\r\n") + "\r\n",
    values: Object.fromEntries(SOCIAL_RELEASE_FLAGS.map((name) => [name, "false\r\n"])),
  });
  assert.equal(run(cli).code, 0);
  assert.deepEqual(cli.calls, [
    ["list", "--names-only"],
    ...SOCIAL_RELEASE_FLAGS.map((name) => ["get", name]),
  ]);
});

test("each enabled flag blocks initial production release", () => {
  for (const name of SOCIAL_RELEASE_FLAGS) {
    const cli = fakeCli({ names: [...anchors, name], values: { [name]: "true\n" } });
    const result = run(cli);
    assert.equal(result.code, 1, name);
    assert.deepEqual(result.logs, []);
    assert.equal(result.errors.length, 1);
  }
});

test("configured empty, unknown, whitespace, multiline and non-string values fail closed", () => {
  for (const value of [
    "",
    "undefined\n",
    "null\n",
    "False\n",
    " false\n",
    "false \n",
    '"false"\n',
    "false\nprivate-value",
    undefined,
    false,
  ]) {
    const cli = fakeCli({
      names: [...anchors, SOCIAL_RELEASE_FLAGS[0]],
      values: { [SOCIAL_RELEASE_FLAGS[0]]: value },
    });
    assert.equal(run(cli).code, 1);
  }
});

test("empty, notice, full-value, duplicate and anchorless inventories block before any flag reads", () => {
  for (const names of [
    "",
    "No environment variables set\n",
    "AUTH_RESEND_KEY=private-value\nAUTH_EMAIL_FROM=private-value\n",
    `${anchors.join("\n")}\nAUTH_RESEND_KEY\n`,
    "UNRELATED_VARIABLE\n",
    `${anchors.join("\n")}\n\n`,
  ]) {
    const cli = fakeCli({ names });
    assert.equal(run(cli).code, 1);
    assert.deepEqual(cli.calls, [["list", "--names-only"]]);
  }
});

test("inventory transport errors cannot be mistaken for absent flags or leak details", () => {
  const cli = fakeCli({ inventoryError: true });
  const result = run(cli);
  assert.equal(result.code, 1);
  assert.doesNotMatch(JSON.stringify(result), /private transport details/);
  assert.deepEqual(cli.calls, [["list", "--names-only"]]);
  assert.throws(() => verifySocialRelease(cli.read), { message: result.errors[0] });
});

test("get transport errors block without raw output or protected values", () => {
  const cli = fakeCli({ names: [...anchors, SOCIAL_RELEASE_FLAGS[0]], getError: true });
  const result = run(cli);
  assert.equal(result.code, 1);
  assert.doesNotMatch(JSON.stringify(result), /private configured value/);
});

test("production guard follows auth preflight before build and is covered by secret-free CI tests", () => {
  const workflow = readFileSync(
    new URL("../.github/workflows/deploy-production.yml", import.meta.url),
    "utf8",
  );
  const auth = workflow.indexOf("run: node ../../scripts/check-release-auth.mjs");
  const social = workflow.indexOf("run: node ../../scripts/check-release-social.mjs");
  const build = workflow.indexOf("- name: Install pinned Vercel CLI");
  assert.ok(auth >= 0 && social > auth && build > social);
  const ci = readFileSync(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8");
  const regressions = ci
    .split("\n")
    .find((line) =>
      line.includes("run: node --test ") &&
      line.includes("packages/backend/scripts/goldenPaidAttempt.test.mjs"),
    );
  assert.ok(regressions?.includes("scripts/check-release-social.test.mjs"));
  assert.ok(!ci.includes("run: node ../../scripts/check-release-social.mjs"));
});
