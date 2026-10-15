// Run from packages/backend with the existing deployment key. Never emit secret values
// or raw CLI errors: the release must not replace password auth with an unconfigured sender.
import { execFileSync } from "node:child_process";

const missing = [];
for (const name of ["AUTH_RESEND_KEY", "AUTH_EMAIL_FROM"]) {
  try {
    const value = execFileSync(
      process.execPath,
      ["node_modules/convex/bin/main.js", "env", "get", name],
      {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        timeout: 30_000,
      },
    ).trim();
    if (!value || value === "undefined" || value === "null" || /[\r\n]/.test(value))
      missing.push(name);
  } catch {
    missing.push(name);
  }
}
if (missing.length) {
  console.error(
    `Release blocked: verify production authentication configuration for ${missing.join(", ")}.`,
  );
  process.exitCode = 1;
} else {
  console.log(
    "Authentication configuration present. Controlled delivery verification remains a release requirement.",
  );
}
