// @vitest-environment node
// Free FFmpeg sources only; a paid provider output is never required by CI.
import { execFile, spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { parseAssemblySidecar } from "@pikar/core/assembly";
import { concatWavTakes, isNativeCaptionWav } from "@pikar/core/captions";
import { expect, test } from "vitest";

const bash = process.platform === "win32" ? "C:/Program Files/Git/bin/bash.exe" : "/bin/bash";
const available =
  existsSync(bash) &&
  ["ffmpeg", "ffprobe"].every(
    (command) => spawnSync(command, ["-version"], { windowsHide: true }).status === 0,
  );
if ((process.env.CI === "true" || process.env.CI === "1") && !available)
  throw new Error("CI native audio fixture requires Bash, FFmpeg and FFprobe.");
const execute = promisify(execFile);

test.skipIf(!available)(
  "native audio stays at scene-start with a real caption WAV and refuses missing source audio",
  async () => {
    const base = fileURLToPath(new URL("../../../../.tmp", import.meta.url));
    mkdirSync(base, { recursive: true });
    const work = mkdtempSync(join(base, "native-audio-quality-"));
    if (
      dirname(resolve(work)) !== resolve(base) ||
      !basename(work).startsWith("native-audio-quality-")
    )
      throw new Error("Unsafe fixture cleanup path");
    mkdirSync(join(work, "in"));
    const run = (command: string, args: string[]) =>
      execute(command, args, {
        cwd: work,
        windowsHide: true,
        timeout: 100_000,
        maxBuffer: 2 * 1024 * 1024,
      });
    const ffmpeg = (args: string[]) =>
      run("ffmpeg", ["-cpucount", "2", "-hide_banner", "-loglevel", "error", "-y", ...args]);
    try {
      for (const [index, frequency] of [440, 880].entries())
        await ffmpeg([
          "-f",
          "lavfi",
          "-i",
          "testsrc2=size=360x640:rate=24:duration=2",
          "-f",
          "lavfi",
          "-i",
          `sine=frequency=${frequency}:sample_rate=48000:duration=2`,
          "-t",
          "2",
          "-c:v",
          "libx264",
          "-preset",
          "ultrafast",
          "-pix_fmt",
          "yuv420p",
          "-c:a",
          "aac",
          `in/block0${index + 1}.mp4`,
        ]);
      await ffmpeg(["-i", "in/block02.mp4", "-an", "-c:v", "copy", "in/no-audio.mp4"]);
      writeFileSync(
        join(work, "assemble.sh"),
        readFileSync(
          fileURLToPath(new URL("./assemble_final.sh", import.meta.url)),
          "utf8",
        ).replace(/\r\n/gu, "\n"),
      );
      // Bound local fixture threads without changing production media handling.
      const which = (
        await run(bash, ["--noprofile", "--norc", "-c", "command -v ffmpeg"])
      ).stdout.trim();
      mkdirSync(join(work, "fixture-bin"));
      writeFileSync(
        join(work, "fixture-bin/ffmpeg"),
        `#!/usr/bin/env bash\nexec '${which.replace(/'/gu, `'\\''`)}' -cpucount 2 "$@"\n`,
        { mode: 0o755 },
      );
      const assemble = () =>
        run(bash, [
          "--noprofile",
          "--norc",
          "-c",
          'export PATH="$PWD/fixture-bin:$PATH"; bash assemble.sh --scene video:2 --scene video:2 --target-seconds 4 --native-audio',
        ]);
      await assemble();
      const originalFinal = readFileSync(join(work, "out/final.mp4"));
      const sidecar = JSON.parse(readFileSync(join(work, "out/final.mp4.assembly.json"), "utf8"));
      expect(parseAssemblySidecar(JSON.stringify(sidecar)).ok).toBe(true);
      expect(sidecar.native_audio).toBe(true);
      expect(sidecar.sfx_vol).toBe(1);
      expect(sidecar.music).toBe("none");
      expect(sidecar.gates).toContain("native_audio_at_scene_start");
      expect(sidecar.gates).not.toContain("speech_centred");
      const wav = readFileSync(join(work, "out/final.mp4.native.wav"));
      expect(isNativeCaptionWav(wav, 4)).toBe(true);
      const parsed = concatWavTakes([wav]);
      expect(parsed.ok).toBe(true);
      if (!parsed.ok) throw new Error("Missing native caption source");
      const samples = new DataView(parsed.value.wav.buffer, parsed.value.wav.byteOffset + 44);
      const frequencyAt = (start: number) => {
        const first = Math.floor(start * 24000),
          count = Math.floor(0.8 * 24000);
        let crossings = 0;
        for (let index = first + 1; index < first + count; index++)
          if (samples.getInt16((index - 1) * 2, true) <= 0 && samples.getInt16(index * 2, true) > 0)
            crossings++;
        return crossings / 0.8;
      };
      expect(Math.abs(frequencyAt(0.1) - 440)).toBeLessThan(10);
      expect(Math.abs(frequencyAt(2.1) - 880)).toBeLessThan(10);
      // A valid video without native audio must refuse, rather than manufacture a silent track.
      copyFileSync(join(work, "in/no-audio.mp4"), join(work, "in/block02.mp4"));
      await expect(assemble()).rejects.toMatchObject({
        stderr: expect.stringContaining("native video has no audio stream"),
      });
      expect(readFileSync(join(work, "out/final.mp4"))).toEqual(originalFinal);
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
  },
  120_000,
);
