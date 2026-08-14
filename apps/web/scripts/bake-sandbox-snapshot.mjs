#!/usr/bin/env node
/**
 * Bake ffmpeg + ffprobe into a Vercel Sandbox snapshot, ONCE, by the owner (MEDIA-01, plan 20-15).
 *
 * ffmpeg is NOT present in a stock Vercel Sandbox and is NOT in Amazon Linux 2023's `dnf` repos.
 * The render sandbox runs on `networkPolicy: "deny-all"`, so it cannot fetch one at render time —
 * `deny-all` and a per-invocation download are mutually exclusive, and this script is the
 * resolution of that tension. It is the ONLY sandbox in this system created with egress open, and
 * it holds ZERO tenant bytes.
 *
 *   pnpm --filter @pikar/web bake:sandbox
 *
 * PREREQUISITE — and note that it is NOT a Vercel access token. The SDK resolves credentials from
 * `VERCEL_OIDC_TOKEN` (`@vercel/oidc`), which `vercel env pull` writes into `.env.local`:
 *
 *   cd apps/web && npx vercel link && npx vercel env pull
 *
 * The token is short-lived and project-scoped. If it has expired, `vercel env pull` again. D11's
 * headline property — no `VERCEL_TOKEN` / `VERCEL_TEAM_ID` / `VERCEL_PROJECT_ID` anywhere in this
 * system — holds for this script too, and `llmRedaction.test.ts` scans the whole repo for them.
 *
 * ponytail: one owner-run script instead of a container build and a registry push. The ceiling is
 * that the snapshot is a hand-managed artifact with a recorded id; the upgrade path, if the image
 * ever needs iterating more than twice, is a custom image pushed to the Vercel Container Registry
 * (the SDK's `image:` option) — which introduces a container build into a repo whose whole boot
 * story is `pnpm install` -> `npx convex dev`. Not yet.
 *
 * WHY THIS FILE LIVES IN `apps/web` AND NOT `packages/backend/scripts` (deviation from the plan,
 * recorded in 20-15-SUMMARY.md): `@vercel/sandbox` is a dependency of `apps/web` ALONE — that is
 * plan 20-15's own rule, and it is what keeps the SDK out of the Convex bundle. Under pnpm's
 * default isolated linker the package is materialised at `apps/web/node_modules/@vercel/sandbox`
 * and NOWHERE else (verified: no `packages/backend/node_modules/@vercel`, no root one either), so
 * this import cannot resolve from `packages/backend/`. `vercel link` also points at `apps/web`,
 * which is where the OIDC token lands. The script belongs where its dependency and its credential
 * already are.
 */

import { Sandbox } from "@vercel/sandbox";

/**
 * The EXACT asset, named rather than "a static build": `linux64-gpl` ships ffmpeg AND ffprobe,
 * statically linked, with **libass ENABLED**. Plan 20-17's caption burn needs libass, so an LGPL
 * build is not a substitute — and the check below turns that from a comment into a gate.
 */
const FFMPEG_TARBALL =
  "https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-linux64-gpl.tar.xz";

/** Generous: ~125 MB over the wire, then an xz extract. This sandbox is created once, ever. */
const BAKE_TIMEOUT_MS = 15 * 60 * 1000;

/** Run a command and FAIL THE BAKE on a non-zero exit. A half-baked snapshot whose id gets
 *  recorded is worse than no snapshot: it fails at render time, per tenant, after payment. */
async function step(sandbox, label, cmd, args, opts = {}) {
  process.stdout.write(`  ${label}… `);
  const run = await sandbox.runCommand({ cmd, args, ...opts });
  if (run.exitCode !== 0) {
    console.log("FAILED");
    console.error(await run.stderr());
    throw new Error(`bake step failed (${label}), exit ${run.exitCode}`);
  }
  console.log("ok");
  return run;
}

async function main() {
  console.log("Creating the bake sandbox (egress OPEN, no tenant bytes)…");
  const sandbox = await Sandbox.create({
    // The ONE sandbox in this system with network access. The render sandbox is `deny-all` and
    // this is why it can afford to be.
    networkPolicy: "allow-all",
    resources: { vcpus: 2 },
    timeout: BAKE_TIMEOUT_MS,
    // Snapshots otherwise expire 30 days after last use. A media rail that goes 31 days unused
    // would wake up with a dead id and a render stage that fails for everyone at once.
    snapshotExpiration: 0,
  });

  try {
    // Vercel's current Amazon Linux 2023 sandbox image includes `tar` but not the `xz` helper
    // needed for the pinned .tar.xz asset. Install it before downloading so extraction is
    // deterministic instead of depending on an undocumented base-image package.
    await step(sandbox, "install xz decompressor", "dnf", ["install", "-y", "xz"], {
      sudo: true,
    });
    await step(sandbox, "download ffmpeg", "sh", [
      "-c",
      `curl -fsSL -o /tmp/ffmpeg.tar.xz "${FFMPEG_TARBALL}"`,
    ]);
    await step(sandbox, "extract", "sh", [
      "-c",
      "mkdir -p /tmp/ff && tar -xJf /tmp/ffmpeg.tar.xz -C /tmp/ff --strip-components=1",
    ]);
    await step(
      sandbox,
      "install binaries",
      "sh",
      [
        "-c",
        "mv /tmp/ff/bin/ffmpeg /tmp/ff/bin/ffprobe /usr/local/bin/ && chmod +x /usr/local/bin/ffmpeg /usr/local/bin/ffprobe",
      ],
      { sudo: true },
    );
    await step(sandbox, "clean up the tarball", "sh", ["-c", "rm -rf /tmp/ff /tmp/ffmpeg.tar.xz"]);

    // The caption font, baked NOW so plan 20-17 adds nothing to this image — and so that CUTTING
    // 20-17 costs nothing either. A font is ~1 MB.
    await step(
      sandbox,
      "install dejavu-sans-fonts",
      "dnf",
      ["install", "-y", "dejavu-sans-fonts"],
      {
        sudo: true,
      },
    );

    // THE ONE COMMAND THAT SETTLES THE `awk` ASSUMPTION. `assemble_final.sh` requires ffmpeg,
    // ffprobe AND awk, and AL2023 is *expected* to ship gawk — expected is not verified. If this
    // fails, the in-repo fallback is `dnf install -y gawk` added as a step above.
    await step(sandbox, "verify ffmpeg, ffprobe and awk are all on PATH", "command", [
      "-v",
      "awk",
      "ffmpeg",
      "ffprobe",
    ]);

    // libass is a BUILD-TIME flag, so a wrong tarball produces binaries that work perfectly until
    // 20-17 tries to burn a caption. Gate it here, where the fix is a one-line URL change.
    await step(sandbox, "verify libass is compiled in (plan 20-17 needs it)", "sh", [
      "-c",
      "ffmpeg -hide_banner -buildconf | grep -q -- --enable-libass",
    ]);

    console.log("\nSnapshotting (this stops the sandbox)…");
    const snapshot = await sandbox.snapshot({ expiration: 0 });

    console.log(`\n  snapshot id: ${snapshot.snapshotId}\n`);
    console.log("Record it as a Vercel Project Environment Variable:\n");
    console.log(`  cd apps/web && npx vercel env add MEDIA_SANDBOX_SNAPSHOT_ID`);
    console.log(`  # …then paste: ${snapshot.snapshotId}\n`);
    console.log("And record the id + the bake date in docs/playbooks/media.md.");
  } finally {
    // `snapshot()` stops the sandbox itself, so this is the failure path's cleanup. Stopping an
    // already-stopped sandbox is a no-op; leaking a running one bills against the Active-CPU
    // allotment, which on Hobby is an OUTAGE rather than a bill.
    await sandbox.stop().catch(() => {});
  }
}

main().catch((error) => {
  console.error(`\nBake failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
