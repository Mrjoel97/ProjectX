// Starts one fresh loopback-only Phase 49 stack, pushes local functions, builds the production
// web app, runs the exact browser spec, and removes only its own temporary database and key.
import { spawn, spawnSync } from "node:child_process";
import { generateKeyPairSync, randomBytes } from "node:crypto";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  assertOwnedRoot,
  concludeRun,
  OWNERSHIP_MARKER,
  Phase49LifecycleError,
  removeOwnedRoot,
  safeFailureMetadata,
  stepFailure,
  stopOwnedChild,
  trackOwnedChild,
} from "./phase49-stack-lifecycle.mjs";
import { startWindowsJob, stopWindowsJob } from "./phase49-windows-job.mjs";

const repo = resolve(import.meta.dirname, "../../../");
const backendDir = join(repo, "packages/backend");
const webDir = join(repo, "apps/web");
const binary =
  "C:/Users/expert/AppData/Local/convex/binaries/precompiled-2026-09-18-cf8398b/convex-local-backend.exe";
const cli = join(backendDir, "node_modules/convex/bin/main.js");
const next = join(webDir, "node_modules/next/dist/bin/next");
const playwright = join(webDir, "node_modules/@playwright/test/cli.js");
const specs = new Set([
  "e2e/phase48-web-runtime.spec.ts",
  "e2e/phase49-recipe-qualification.spec.ts",
  "e2e/phase49-web-recipes.spec.ts",
  "e2e/calendar-management.spec.ts",
]);
const spec = process.argv[2] ?? "e2e/phase49-recipe-qualification.spec.ts";
const calendarSpec = spec === "e2e/calendar-management.spec.ts";
if (!specs.has(spec) || process.argv.length > 3)
  throw new Error("Phase 49 disposable runner requires one allowlisted exact browser spec");
const cloud = 3410;
const site = 3411;
const app = 3112;
const backendUrl = `http://127.0.0.1:${cloud}`;
const siteUrl = `http://127.0.0.1:${site}`;
const appUrl = `http://127.0.0.1:${app}`;
let root;
let config;
let secret;
let instance;
let backend;
let web;
let backendState;
let backendJob;
let webState;
let adminKey = "";
let ownershipToken;

function run(label, executable, args, options = {}) {
  const result = spawnSync(executable, args, {
    cwd: options.cwd ?? repo,
    env: options.env ?? process.env,
    encoding: "utf8",
    timeout: options.timeout ?? 300_000,
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.status !== 0 || result.error) {
    if (label === "Calendar browser process") {
      try {
        const report = JSON.parse(result.stdout ?? "");
        const found = [];
        const visit = (suite) => {
          found.push(...(suite.specs ?? []));
          for (const child of suite.suites ?? []) visit(child);
        };
        for (const suite of report.suites ?? []) visit(suite);
        const failed = found
          .flatMap((item) => item.tests ?? [])
          .filter((item) => item.status !== "expected");
        const message = String(failed[0]?.results?.[0]?.errors?.[0]?.message ?? "");
        const line = message.match(/calendar-management\.spec\.ts:(\d+):\d+/)?.[1] ?? "unknown";
        const fixture =
          message.match(
            /Calendar fixture call (?:failed|returned invalid JSON): ([A-Za-z:]+)(?: \((empty|nonjson)\))?/,
          ) ?? [];
        const category = /Timeout|timed out/i.test(message)
          ? "timeout"
          : /Calendar fixture call failed/.test(message)
            ? "fixture_call"
            : /Calendar disposable|Calendar fixture|Calendar browser subject/.test(message)
              ? "binding"
              : /expect\(|AssertionError/.test(message)
                ? "assertion"
                : "other";
        process.stderr.write(
          `Calendar browser failed: specs=${found.length} failed=${failed.length} category=${category} line=${line} fixture=${fixture[1] ?? "none"} shape=${fixture[2] ?? "none"}\n`,
        );
      } catch {
        process.stderr.write("Calendar browser failed: JSON report unavailable\n");
      }
    }
    if (label === "authenticated Phase 49 browser E2E") {
      const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
      const locations = [
        ...output.matchAll(
          /phase(?:48-web-runtime|49-(?:web-recipes|recipe-qualification))\.spec\.ts:(\d+):(\d+)/g,
        ),
      ];
      const location = locations.at(-1);
      if (location) process.stderr.write(`Phase 49 browser assertion location: ${location[0]}\n`);
      const frames = [...new Set(locations.map((item) => item[0]))].slice(0, 6);
      if (frames.length) process.stderr.write(`Phase 49 browser frames: ${frames.join(", ")}\n`);
      const category = output
        .match(/^\s*Error: (expect\([^\r\n]*|locator\.[^\r\n]*|[^\r\n]*)/m)?.[1]
        ?.replace(/`[^`]*`|"[^"]*"|'[^']*'/g, "[value]")
        .replace(/[a-f0-9]{32,}/gi, "[hash]")
        .slice(0, 180);
      if (category) process.stderr.write(`Phase 49 browser failure category: ${category}\n`);
    }
    throw stepFailure(label, result);
  }
  process.stdout.write(`${label}: exit 0\n`);
  return result.stdout ?? "";
}
async function freePort(port) {
  await new Promise((resolvePromise, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => server.close(resolvePromise));
  });
}
async function waitHttp(url, predicate, label) {
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1500) });
      if (await predicate(response)) return;
    } catch {
      /* bounded startup wait */
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 500));
  }
  throw new Error(`${label} did not become ready`);
}
function env(extra = {}) {
  // Empty values block .env.local from replacing them, while Convex treats empty as absent.
  const copy = { ...process.env, CONVEX_DEPLOYMENT: "", CONVEX_DEPLOY_KEY: "", CI: "1", ...extra };
  return copy;
}

let primaryFailure = null;
const cleanupFailures = [];
try {
  root = mkdtempSync(join(tmpdir(), "pikar-phase49-"));
  ownershipToken = randomBytes(32).toString("hex");
  writeFileSync(join(root, OWNERSHIP_MARKER), ownershipToken, { flag: "wx", mode: 0o600 });
  config = join(root, "config.json");
  secret = randomBytes(32).toString("hex");
  instance = `phase49-${randomBytes(6).toString("hex")}`;
  for (const path of [binary, cli, next, playwright])
    if (!existsSync(path)) throw new Error("required cached local executable missing");
  await Promise.all([freePort(cloud), freePort(site), freePort(app)]);
  const key = spawnSync(
    binary,
    ["keygen", "admin-key", "--instance-name", instance, "--instance-secret", secret],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  );
  if (key.status !== 0 || !key.stdout?.trim())
    throw new Error("fresh backend key generation failed");
  adminKey = key.stdout.trim();
  writeFileSync(
    config,
    JSON.stringify({ adminKey, ports: { cloud, site }, deploymentName: instance }),
    { flag: "wx", mode: 0o600 },
  );
  const backendArgs = [
    "--interface",
    "127.0.0.1",
    "--port",
    String(cloud),
    "--site-proxy-port",
    String(site),
    "--convex-origin",
    backendUrl,
    "--convex-site",
    siteUrl,
    "--instance-name",
    instance,
    "--instance-secret",
    secret,
    "--local-storage",
    join(root, "storage"),
    "--disable-beacon",
    join(root, "backend.sqlite3"),
  ];
  if (process.platform === "win32") {
    backendJob = await startWindowsJob({
      binary,
      args: backendArgs,
      cwd: root,
      env: env({ DISABLE_BEACON: "1" }),
    });
  } else {
    // Non-Windows retains the direct-child route; it does not claim tree ownership.
    backend = spawn(binary, backendArgs, {
      cwd: root,
      env: env({ DISABLE_BEACON: "1" }),
      stdio: "ignore",
      windowsHide: true,
    });
    backendState = trackOwnedChild(backend, "backend");
  }
  await waitHttp(
    `${backendUrl}/instance_name`,
    async (response) => response.ok && (await response.text()) === instance,
    "fresh backend",
  );
  const convexEnv = env({
    CONVEX_SELF_HOSTED_URL: backendUrl,
    CONVEX_SELF_HOSTED_ADMIN_KEY: adminKey,
    CONVEX_SITE_URL: siteUrl,
    DISABLE_BEACON: "1",
    DO_NOT_TRACK: "1",
  });
  run(
    "push local Convex functions",
    process.execPath,
    [cli, "dev", "--once", "--typecheck", "disable", "--codegen", "disable"],
    { cwd: backendDir, env: convexEnv, timeout: 300_000 },
  );
  // Convex Auth requires deployment-scoped signing material even for this disposable owner.
  // It is generated fresh, set only on this validated local instance, and never printed.
  const jwt = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const jwtPrivateKey = jwt.privateKey
    .export({ type: "pkcs8", format: "pem" })
    .trimEnd()
    .replaceAll("\n", " ");
  const jwks = JSON.stringify({
    keys: [{ use: "sig", ...jwt.publicKey.export({ format: "jwk" }) }],
  });
  const privatePath = join(root, "jwt-private.txt");
  const jwksPath = join(root, "jwks.txt");
  writeFileSync(privatePath, jwtPrivateKey, { flag: "wx", mode: 0o600 });
  writeFileSync(jwksPath, jwks, { flag: "wx", mode: 0o600 });
  run(
    "set disposable JWT private key",
    process.execPath,
    [cli, "env", "set", "JWT_PRIVATE_KEY", "--from-file", privatePath],
    { cwd: backendDir, env: convexEnv },
  );
  run(
    "set disposable JWKS",
    process.execPath,
    [cli, "env", "set", "JWKS", "--from-file", jwksPath],
    { cwd: backendDir, env: convexEnv },
  );
  run(
    "enable disposable offline fixture seam",
    process.execPath,
    [cli, "env", "set", "PIKAR_OFFLINE_FIXTURES", "1"],
    { cwd: backendDir, env: convexEnv },
  );
  const webEnv = env({
    NEXT_PUBLIC_CONVEX_URL: backendUrl,
    CONVEX_URL: backendUrl,
    CONVEX_SITE_URL: siteUrl,
    NEXT_PUBLIC_CONVEX_SITE_URL: siteUrl,
    PIKAR_E2E_BASE_URL: appUrl,
    DISABLE_BEACON: "1",
    DO_NOT_TRACK: "1",
    NEXT_FONT_GOOGLE_MOCKED_RESPONSES: join(webDir, "e2e/phase49-next-font-mock.cjs"),
  });
  run("production web build", process.execPath, [next, "build", "--webpack"], {
    cwd: webDir,
    env: webEnv,
    timeout: 900_000,
  });
  web = spawn(process.execPath, [next, "start", "-p", String(app), "-H", "127.0.0.1"], {
    cwd: webDir,
    env: webEnv,
    stdio: "ignore",
    windowsHide: true,
  });
  webState = trackOwnedChild(web, "web");
  await waitHttp(`${appUrl}/signin`, async (response) => response.ok, "production web app");
  const browserOutput = run(
    calendarSpec ? "Calendar browser process" : "authenticated Phase 49 browser E2E",
    process.execPath,
    [
      playwright,
      "test",
      spec,
      "--project=chromium",
      "--output",
      join(root, "playwright-results"),
      ...(calendarSpec ? ["--reporter=json"] : []),
    ],
    {
      cwd: webDir,
      timeout: 1_800_000,
      env: env({
        ...webEnv,
        PIKAR_PHASE49_QUALIFICATION: "1",
        PIKAR_PHASE49_DISPOSABLE: "1",
        PIKAR_PHASE49_FIXTURE_CONFIG: config,
        PIKAR_PHASE49_DISPOSABLE_ROOT: root,
        PIKAR_PHASE49_BACKEND_URL: backendUrl,
        ...(calendarSpec
          ? {
              PIKAR_PHASE17_DISPOSABLE: "1",
              CONVEX_SELF_HOSTED_URL: backendUrl,
              CONVEX_SELF_HOSTED_ADMIN_KEY: adminKey,
            }
          : {}),
        ...(spec === "e2e/phase48-web-runtime.spec.ts"
          ? {
              PIKAR_PHASE48_DISPOSABLE: "1",
              PIKAR_PHASE48_FIXTURE_CONFIG: config,
              PIKAR_PHASE48_DISPOSABLE_ROOT: root,
              PIKAR_PHASE48_PUBLIC_ORIGIN: siteUrl,
            }
          : {}),
      }),
    },
  );
  if (calendarSpec) {
    let report;
    try {
      report = JSON.parse(browserOutput);
    } catch {
      throw new Phase49LifecycleError("CALENDAR_REPORT_INVALID", "browser");
    }
    const specs = [];
    const visit = (suite) => {
      specs.push(...(suite.specs ?? []));
      for (const child of suite.suites ?? []) visit(child);
    };
    for (const suite of report.suites ?? []) visit(suite);
    const only = specs[0]?.tests?.[0];
    if (
      specs.length !== 1 ||
      specs[0].tests?.length !== 1 ||
      only.projectName !== "chromium" ||
      only.status !== "expected" ||
      only.results?.length !== 1 ||
      only.results[0].status !== "passed" ||
      report.stats?.expected !== 1 ||
      report.stats?.skipped !== 0 ||
      report.stats?.unexpected !== 0 ||
      !Number.isFinite(report.stats?.duration) ||
      report.stats.duration < 0
    )
      throw new Phase49LifecycleError("CALENDAR_TEST_COUNT_INVALID", "browser");
    process.stdout.write(
      `Calendar isolated browser matrix: 1/1 passed, 0 skipped, durationMs=${report.stats.duration}\n`,
    );
  }
  for (const line of browserOutput.split(/\r?\n/)) {
    if (
      /^Phase 49 isolated browser qualification: six exact candidate runs, three immutable v2 artifacts, three v1 post-rollback artifacts; refs [a-z0-9]+(?:,[a-z0-9]+){2}$/.test(
        line,
      ) ||
      /^Phase 49 exact fixture rows cleaned: 6$/.test(line) ||
      /^Phase 49 integrated browser matrix: /.test(line)
    )
      process.stdout.write(`${line}\n`);
  }
  run(
    "Phase 49 isolated audit actual",
    process.execPath,
    [join(repo, "scripts/check-audit-payloads.mjs")],
    { cwd: repo, env: convexEnv, timeout: 300_000 },
  );
} catch (error) {
  primaryFailure = error;
} finally {
  async function stopDirectChild(pid) {
    const state = [webState, backendState].find((owned) => owned?.pid === pid);
    if (!state || state.exitObserved || state.startError) return false;
    // The child handle was captured and observed at spawn. This does not claim descendants
    // stopped; listener and owned-root checks below are independent cleanup gates.
    return state.child.kill("SIGTERM");
  }
  for (const state of [webState, backendState]) {
    try {
      await stopOwnedChild(state, stopDirectChild);
    } catch (error) {
      cleanupFailures.push(error);
    }
  }
  if (backendJob) {
    try {
      await stopWindowsJob(backendJob);
    } catch (error) {
      cleanupFailures.push(error);
    }
  }
  for (const port of [app, cloud, site]) {
    try {
      await freePort(port);
    } catch {
      cleanupFailures.push(new Phase49LifecycleError("LISTENER_STILL_BOUND", "cleanup", { port }));
    }
  }
  if (root && ownershipToken) {
    const scrubStandalone = (actual) => {
      try {
        for (const name of ["config.json", "jwt-private.txt", "jwks.txt"])
          rmSync(join(actual, name), { force: true });
      } catch {
        throw new Phase49LifecycleError("STANDALONE_SECRET_SCRUB_FAILED", "cleanup");
      }
    };
    if (cleanupFailures.length) {
      try {
        scrubStandalone(assertOwnedRoot(root, tmpdir(), ownershipToken));
      } catch {
        cleanupFailures.push(
          new Phase49LifecycleError("STANDALONE_SECRET_SCRUB_FAILED", "cleanup"),
        );
      }
      cleanupFailures.push(new Phase49LifecycleError("ROOT_CLEANUP_SKIPPED_PROCESS", "cleanup"));
    } else {
      try {
        const result = await removeOwnedRoot(root, tmpdir(), ownershipToken, {
          beforeRemove: scrubStandalone,
        });
        process.stdout.write(`Phase 49 exact owned temporary root removed: ${result.removed}\n`);
      } catch (error) {
        cleanupFailures.push(error);
      }
    }
  }
}
try {
  concludeRun(primaryFailure, cleanupFailures);
} catch (error) {
  process.stderr.write(
    `Phase 49 disposable stack failed: ${JSON.stringify(safeFailureMetadata(error))}\n`,
  );
  process.exitCode = 1;
}
