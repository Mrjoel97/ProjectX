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
import { existsSync } from "node:fs";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import type { SandboxLike } from "@pikar/core/render";

/** `renderReel` asks for `sh`, which every Linux sandbox image has and Windows does not — the
 *  spawn is `shell: false`, so there is no interpreter to fall back on and the render died
 *  `spawn sh ENOENT` after fetching every input. `assemble_final.sh` is `#!/usr/bin/env bash` and
 *  uses arrays throughout, so the substitute must be BASH, not any POSIX `sh`: Git for Windows
 *  ships one, and `git` being on PATH is already a precondition for working in this repo.
 *
 *  ponytail: a fixed probe list, because this path only ever runs on a developer's own machine.
 *  `MEDIA_RENDER_SH` is the upgrade path for a box that keeps bash somewhere else. */
const WINDOWS_BASH = [
  // Forward slashes deliberately: `resolve()` normalises them to the platform separator, and a
  // literal Windows path in a TS string needs every backslash doubled — `"\b"` is a BACKSPACE, not
  // a `\` and a `b`, so the escaped spelling is one missed keystroke away from a silent wrong path.
  "C:/Program Files/Git/bin/bash.exe",
  "C:/Program Files (x86)/Git/bin/bash.exe",
].map((p) => resolve(p));

/** A TrueType font the assembler can draw a `text_card` with, copied into every render root as
 *  `LOCAL_FONT_NAME`. Any real TTF will do — this is a developer preview, not the shipped look; the
 *  snapshot's DejaVu Sans is what a customer sees. Forward slashes for the same reason as above. */
const LOCAL_FONTS = [
  "C:/Windows/Fonts/DejaVuSans.ttf",
  "C:/Windows/Fonts/arial.ttf",
  "C:/Windows/Fonts/segoeui.ttf",
  "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
].map((p) => resolve(p));
export const LOCAL_FONT_NAME = "font.ttf";

/** The music library the snapshot bakes to `/usr/local/share/pikar-music`, at its SOURCE. It is
 *  empty in the repo today, and that is fine: the assembler treats a missing track as a warning and
 *  renders with no bed, exactly as the snapshot does. Pointing here keeps the two behaviours equal
 *  rather than leaving the local runner to look in a Linux directory that cannot exist. */
const LOCAL_MUSIC_DIR = resolve(process.cwd(), "scripts", "music");

export function resolveShell(cmd: string): string {
  if (cmd !== "sh" || process.platform !== "win32") return cmd;
  const override = process.env.MEDIA_RENDER_SH;
  if (override) return override;
  return WINDOWS_BASH.find((p) => existsSync(p)) ?? cmd;
}

/** The same ceiling the real sandbox is clamped to, so a hung ffmpeg cannot outlive the request. */
const LOCAL_RENDER_TIMEOUT_MS = 240_000;

export async function createLocalSandbox(): Promise<SandboxLike> {
  const root = await mkdtemp(join(tmpdir(), "pikar-render-"));

  // THE FONT. The snapshot bakes DejaVu Sans at a Linux path the assembler probes; this machine has
  // neither. A `card` scene then refuses ("needs a TrueType font") and the reel dies `render_failed`
  // after every picture and take has landed — the first live reel did exactly that. The font is
  // COPIED INTO THE ROOT and named RELATIVELY: an absolute Windows path cannot go into ffmpeg's
  // drawtext filtergraph, where the drive colon is an option separator (observed: SIGSEGV), and
  // an MSYS `/c/...` path is not a path to a native binary at all. `font.ttf` beside `in/` avoids
  // both by never containing a drive letter.
  const font = LOCAL_FONTS.find((p) => existsSync(p));
  if (font) await copyFile(font, join(root, LOCAL_FONT_NAME));

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
        // MSYS argument conversion is deliberately LEFT ON here, and that is load-bearing rather
        // than incidental: `assemble_final.sh` builds its scratch paths from `mktemp -d`, which
        // returns POSIX (`/tmp/tmp.XXXXXX`), while ffmpeg is a NATIVE Windows binary that resolves
        // `/tmp/...` against the wrong root and dies "No such file or directory". The conversion is
        // what bridges the two. Setting `MSYS_NO_PATHCONV=1` to guard a scene spec (`video:7`) that
        // was never actually mangled broke the render — the test below is what settles which of
        // those two is real, instead of a comment claiming it.
        const child = spawn(resolveShell(cmd), args, {
          cwd: root,
          shell: false,
          env: {
            ...process.env,
            // Relative on purpose — see the font note in `createLocalSandbox`.
            ASSEMBLE_FONT: LOCAL_FONT_NAME,
            ASSEMBLE_MUSIC_DIR: LOCAL_MUSIC_DIR,
            // MSYS argument conversion cuts BOTH ways, and this is the narrowest cut. Left on, it
            // is what lets the assembler hand a native ffmpeg its `mktemp -d` POSIX paths. But it
            // also rewrites `fontsdir=/usr/share/fonts` INSIDE burn_caps.sh's `-vf` string into
            // `C:/Program Files/Git/...`, and the drive colon breaks the filtergraph — the first
            // reel's captions died `render_failed` on exactly that. Excluding the one argument
            // prefix leaves every other conversion in place. Observed, not reasoned: with it the
            // burn exits 0 and the assembler still renders.
            MSYS2_ARG_CONV_EXCL: "subtitles=",
          },
        });
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
