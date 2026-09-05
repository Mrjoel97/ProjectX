/**
 * The render runner (MEDIA-01, D11) — a THIN adapter. All of the logic is
 * `handleRenderRequest` in `@pikar/core/render` (CLAUDE.md §1); this file exists to supply the
 * three things only a Vercel deployment has: the SDK, the environment, and OIDC.
 *
 * **Why the runner lives here and not in Convex.** Convex cannot encode video (D9), and a
 * Convex-hosted runner would need `VERCEL_TOKEN` + `VERCEL_TEAM_ID` + `VERCEL_PROJECT_ID`. A
 * Vercel personal access token is scoped to a **team, not a capability**: it can deploy, delete
 * projects and read every project environment variable. That is strictly more powerful than
 * anything else this codebase holds. Media-provider keys are capability-scoped generation keys;
 * a Vercel team token is not.
 *
 * **D11's answer: put the runner where OIDC is automatic.** Note what is NOT in the `Sandbox.create`
 * call below: no `token`, no `teamId`, no `projectId`. Inside a Vercel deployment the SDK resolves
 * credentials from the OIDC context on its own. One extra HTTP hop, one shared secret, and zero
 * team-scoped credentials anywhere in the system — a property `llmRedaction.test.ts` asserts
 * repo-wide rather than leaving to this comment.
 */

import { assembleScriptBody } from "@pikar/backend/render/assembleScript";
import { burnCapsScriptBody } from "@pikar/backend/render/burnCapsScript";
import { handleRenderRequest, type SandboxLike } from "@pikar/core/render";
import { Sandbox } from "@vercel/sandbox";
import { createLocalSandbox } from "./localSandbox";

export const runtime = "nodejs";

/**
 * THE BINDING CEILING UNDER D11 — settled at plan 20-15's Task 1 checkpoint (2026-08-02): this
 * project is on **Vercel Pro**, where 300 s is permitted. The sandbox's own timeout is
 * `RENDER_SANDBOX_TIMEOUT_MS` (240 s), strictly below, so the VM is torn down by our `finally`
 * rather than orphaned by the function being killed.
 *
 * A LITERAL, not `RENDER_MAX_DURATION_S`: Next.js reads this segment config by STATIC ANALYSIS at
 * build time and an imported binding does not resolve. `llmRedaction.test.ts` scans this file and
 * asserts the literal still equals the exported constant, which is the drift guard the import
 * would otherwise have been.
 */
export const maxDuration = 300;

export async function POST(req: Request): Promise<Response> {
  // ── THE LOCAL RUNNER, AND THE TWO GUARDS THAT KEEP IT LOCAL ────────────────────────────────
  //
  // On a developer's machine there is no OIDC, so `Sandbox.create` cannot authenticate and the
  // render step is unreachable — every other plane can be exercised locally and the reel dies at
  // the last one. `MEDIA_RENDER_LOCAL=1` swaps in a `SandboxLike` backed by this machine's own
  // ffmpeg (see `localSandbox.ts`, which is explicit that it is NOT a sandbox).
  //
  // TWO conditions, and the second is the one that matters: an env var is a thing that gets copied
  // between environments by accident, so the opt-in alone is not enough. `VERCEL` is set by the
  // platform on every deployment and cannot be forgotten, so a stray `MEDIA_RENDER_LOCAL` in a
  // production project downgrades nothing — it is ignored, and loudly.
  const wantsLocal = process.env.MEDIA_RENDER_LOCAL === "1";
  const onVercel = process.env.VERCEL !== undefined;
  if (wantsLocal && onVercel) {
    console.error("MEDIA_RENDER_LOCAL is set on a Vercel deployment and is being IGNORED.");
  }
  const useLocal = wantsLocal && !onVercel;

  return await handleRenderRequest(req, {
    secret: process.env.MEDIA_RENDER_SECRET,
    // `snapshotId` is only ever read to build `source: {type:"snapshot"}` for the real SDK, and
    // the local runner ignores its options entirely. A sentinel keeps `not_configured` — which is
    // a real governed stop for the Vercel path — from refusing a local render that needs no image.
    snapshotId: useLocal
      ? (process.env.MEDIA_SANDBOX_SNAPSHOT_ID ?? "local")
      : process.env.MEDIA_SANDBOX_SNAPSHOT_ID,
    deploymentUrl: process.env.NEXT_PUBLIC_CONVEX_URL,
    assembleScript: assembleScriptBody,
    // The second mode's script (plan 20-17). Passed the same way and for the same reason: core
    // must not reach into `packages/backend`, and a test can prove which bytes reached the VM.
    burnScript: burnCapsScriptBody,
    fetch: globalThis.fetch,
    createSandbox: async (options): Promise<SandboxLike> => {
      if (useLocal) return await createLocalSandbox();
      // NO token/teamId/projectId argument, and there must never be one. `options` is
      // `buildSandboxOptions(...)`, never an inline literal — that is what keeps
      // `persistent: false` and `networkPolicy: "deny-all"` assertable without a real VM.
      const sandbox = await Sandbox.create(options);
      return {
        mkDir: (path) => sandbox.mkDir(path),
        // The SDK wants Node `Buffer`s; core is deliberately Node-free and speaks `Uint8Array`.
        // The conversion is the adapter's job, and it is the only reason this wrapper is not a
        // straight `return sandbox`.
        writeFiles: (files) =>
          sandbox.writeFiles(files.map((f) => ({ path: f.path, content: Buffer.from(f.content) }))),
        runCommand: (cmd, args) => sandbox.runCommand(cmd, args),
        readFileToBuffer: async (file) => {
          const bytes = await sandbox.readFileToBuffer(file);
          return bytes ? Uint8Array.from(bytes) : null;
        },
        stop: () => sandbox.stop(),
      };
    },
  });
}
