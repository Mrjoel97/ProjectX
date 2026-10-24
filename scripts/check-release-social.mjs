// Run from packages/backend with the protected production deployment key.
// This initial release may land code, but may not enable unqualified social access.
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const SOCIAL_RELEASE_FLAGS = Object.freeze([
  "SOCIAL_META_PUBLISH_ENABLED",
  "SOCIAL_TIKTOK_PUBLISH_ENABLED",
  "SOCIAL_YOUTUBE_PUBLISH_ENABLED",
  "SOCIAL_YOUTUBE_CONNECT_ENABLED",
]);

const INVENTORY_ANCHORS = ["AUTH_RESEND_KEY", "AUTH_EMAIL_FROM"];
const BLOCKED =
  "Release blocked: production direct-social access must remain disabled; verify its protected configuration.";

function convexRead(args) {
  return execFileSync(process.execPath, ["node_modules/convex/bin/main.js", "env", ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 30_000,
    maxBuffer: 1024 * 1024,
  });
}

export function verifySocialRelease(readCli = convexRead) {
  // Do not emit raw stdout/stderr or transport errors: even an unexpected CLI
  // response must not expose protected values in the public release log.
  const read = (args) => {
    try {
      const output = readCli(args);
      if (typeof output !== "string" || output.length > 1024 * 1024) throw new Error();
      return output;
    } catch {
      throw new Error(BLOCKED);
    }
  };
  const output = read(["list", "--names-only"]);
  const lines = output.replace(/\r?\n$/, "").split(/\r?\n/);
  const names = new Set(lines);
  // The preceding password-email preflight requires both anchors. Their names
  // distinguish a valid inventory from an empty result or a successful notice.
  if (
    !lines.every((name) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) ||
    names.size !== lines.length ||
    !INVENTORY_ANCHORS.every((name) => names.has(name))
  )
    throw new Error(BLOCKED);
  for (const name of SOCIAL_RELEASE_FLAGS) {
    // Absence is disabled only after positively parsing a successful inventory.
    if (!names.has(name)) continue;
    if (!/^false(?:\r?\n)?$/.test(read(["get", name]))) throw new Error(BLOCKED);
  }
}

export function runSocialReleasePreflight({
  readCli = convexRead,
  log = console.log,
  error = console.error,
} = {}) {
  try {
    verifySocialRelease(readCli);
    log("Production direct-social publishing and new YouTube connections remain disabled.");
    return 0;
  } catch {
    error(BLOCKED);
    return 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = runSocialReleasePreflight();
}
