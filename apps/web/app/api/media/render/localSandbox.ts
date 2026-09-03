/**
 * A `SandboxLike` backed by THIS MACHINE, for local development only.
 *
 * WHY IT EXISTS. `renderReel` hands the assembler to a Vercel Sandbox, which gets its credentials
 * from OIDC — automatic when the route runs on Vercel and unavailable anywhere else. So on a
 * developer's machine the render step is not merely awkward, it is unreachable: every other plane
 * (images, video, voice, captions, stock) can be exercised locally and the reel dies at the last
 * step. That made the one criterion no offline test can reach — a reel rendering end to end —
 * impossible to verify without a Vercel account and its Active-CPU quota, which the repo's own
 * note warns can PAUSE sandbox creation for 30 days when exhausted on Hobby: an outage, not a bill.
 *
 * `SandboxLike` was already an interface with a swappable implementation, so this is a second
 * implementation of an existing seam rather than a new one — the whole reason that seam is five
 * methods wide.
 *
 * ── WHAT THIS IS NOT ──────────────────────────────────────────────────────────────────────────
 *
 * **It is NOT a sandbox.** The real one exists for isolation: `networkPolicy: "deny-all"`,
 * `persistent: false`, a fresh VM per render, and tenant bytes that never outlive it. None of that
 * is true here — this runs ffmpeg as the developer, on the developer's filesystem, with the
 * developer's network. It is acceptable ONLY because the operator and the tenant are the same
 * person on a local deployment, and it must never be otherwise. Hence the two guards in
 * `route.ts`: an explicit opt-in, and a hard refusal when `VERCEL` is set.
 *
 * What it still does hold, because these cost nothing and a local path that quietly dropped them
 * would be a worse template for the next person to copy:
 *
 *   * **Every path is confined to one temp root.** `in/block01.mp4` resolves under the root or the
 *     call throws. Core already guards filenames taken from a request body; this is the second
 *     enforcement, at the boundary where a traversal would actually reach a real filesystem.
 *   * **No shell.** `runCommand` spawns the binary directly with an argv array. There is no string
 *     to interpolate into and therefore no injection, which matters because the scene text a
 *     tenant wrote reaches these scripts as file CONTENT.
 *   * **`stop()` deletes the root**, so tenant media does not accumulate in a temp directory after
 *     the reel has been stored.
 */

import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import type { SandboxLike } from "@pikar/core/render";

/** The same ceiling the real sandbox is clamped to, so a hung ffmpeg cannot outlive the request. */
const LOCAL_RENDER_TIMEOUT_MS = 240_000;

export async function createLocalSandbox(): Promise<SandboxLike> {
  const root = await mkdtemp(join(tmpdir(), "pikar-render-"));

  /** Resolve a sandbox-relative path and REFUSE anything that escapes the root. `relative()` is
   *  the check rather than a `startsWith` on the joined string, which says the wrong thing for a
   *  sibling directory whose name merely begins with the root's. */
  const within = (p: string): string => {
    const abs = resolve(root, p);
    const rel = relative(root, abs);
    if (rel.startsWith("..") || resolve(root, rel) !== abs) {
      throw new Error("local sandbox: path escapes the render root");
    }
    return abs;
  };

  return {
    mkDir: async (path) => {
      await mkdir(within(path), { recursive: true });
    },

    writeFiles: async (files) => {
      for (const file of files) {
        const abs = within(file.path);
        // Core writes `in/voice01.wav` without creating `in/` first in every path, and the real
        // sandbox tolerates that. Mirroring the tolerance keeps this implementation a drop-in.
        await mkdir(dirname(abs), { recursive: true });
        await writeFile(abs, file.content);
      }
    },

    runCommand: async (cmd, args = []) => {
      // No shell, argv array, cwd pinned to the root. `stderr()` is a thunk in the interface
      // because the real SDK streams it; here it is already buffered and simply handed back.
      return await new Promise((resolvePromise, reject) => {
        const child = spawn(cmd, args, { cwd: root, shell: false });
        let stderr = "";
        let settled = false;
        const timer = setTimeout(() => {
          settled = true;
          child.kill("SIGKILL");
          resolvePromise({
            exitCode: 124, // the timeout convention, so `reasonCodeFor` sees a non-zero exit
            stderr: async () =>
              `${stderr}\nlocal sandbox: timed out after ${LOCAL_RENDER_TIMEOUT_MS}ms`,
          });
        }, LOCAL_RENDER_TIMEOUT_MS);

        child.stderr?.on("data", (chunk: Buffer) => {
          stderr += chunk.toString();
        });
        child.on("error", (err) => {
          clearTimeout(timer);
          if (!settled) reject(err);
        });
        child.on("close", (code) => {
          clearTimeout(timer);
          if (settled) return;
          resolvePromise({ exitCode: code ?? 1, stderr: async () => stderr });
        });
      });
    },

    readFileToBuffer: async (file) => {
      try {
        const bytes = await readFile(within(file.path));
        // A fresh copy: `readFile` returns a Buffer over a pooled ArrayBuffer, and the caller
        // hands these bytes to `Blob`/`BodyInit`, which reject the pooled supertype.
        return Uint8Array.from(bytes);
      } catch {
        // MISSING IS `null`, NEVER A THROW. The real sandbox says "no such file" the same way, and
        // core reads that as `sidecar_missing` / `mp4_missing` — a governed reason code. Throwing
        // here would surface as an unhandled route error with no reason on the plan row.
        return null;
      }
    },

    stop: async () => {
      await rm(root, { recursive: true, force: true });
    },
  };
}
