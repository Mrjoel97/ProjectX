// @vitest-environment node
// Real, free ffmpeg fixture. No provider, customer file or external media is used.
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
import { expect, test } from "vitest";

const bash = process.platform === "win32" ? "C:/Program Files/Git/bin/bash.exe" : "/bin/bash";
const font = [
  "C:/Windows/Fonts/arial.ttf",
  "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
  "/usr/share/fonts/dejavu-sans-fonts/DejaVuSans.ttf",
].find(existsSync);
const available =
  existsSync(bash) &&
  font &&
  spawnSync("ffmpeg", ["-version"], { encoding: "utf8", windowsHide: true }).status === 0 &&
  spawnSync("ffprobe", ["-version"], { encoding: "utf8", windowsHide: true }).status === 0;
if ((process.env.CI === "true" || process.env.CI === "1") && !available) {
  throw new Error("CI render fixtures require Bash, FFmpeg, FFprobe and a supported font.");
}
const execFileAsync = promisify(execFile);

test.skipIf(!available)(
  "mixed actual sources export the priced 720x1280/30 profile with a valid audio timeline and sidecar",
  async () => {
    const base = fileURLToPath(new URL("../../../../.tmp", import.meta.url));
    mkdirSync(base, { recursive: true });
    const work = mkdtempSync(join(base, "render-quality-"));
    if (dirname(resolve(work)) !== resolve(base) || !basename(work).startsWith("render-quality-"))
      throw new Error("Unsafe fixture cleanup path");
    mkdirSync(join(work, "in"));
    const run = async (command: string, args: string[], env?: NodeJS.ProcessEnv) => {
      try {
        return (
          await execFileAsync(command, args, {
            cwd: work,
            env: env ?? process.env,
            encoding: "utf8",
            windowsHide: true,
            timeout: 100_000,
            maxBuffer: 2 * 1024 * 1024,
          })
        ).stdout;
      } catch (error) {
        throw new Error(
          `Offline render fixture failed (${basename(command)}): ${error instanceof Error ? error.message : "process error"}`,
        );
      }
    };
    // Limit the fixture's auto-threading on developer machines. This is not a hosted performance benchmark.
    const ffmpeg = (args: string[]) =>
      run("ffmpeg", ["-cpucount", "2", "-hide_banner", "-loglevel", "error", "-y", ...args]);
    try {
      await ffmpeg([
        "-f",
        "lavfi",
        "-i",
        "testsrc2=size=1440x810:rate=24:duration=2",
        "-f",
        "lavfi",
        "-i",
        "anullsrc=r=48000:cl=stereo",
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
        "in/block01.mp4",
      ]);
      await ffmpeg([
        "-f",
        "lavfi",
        "-i",
        "testsrc2=size=720x1280:rate=60:duration=2",
        "-an",
        "-c:v",
        "libx264",
        "-preset",
        "ultrafast",
        "-pix_fmt",
        "yuv420p",
        "in/block02.mp4",
      ]);
      await ffmpeg([
        "-f",
        "lavfi",
        "-i",
        "testsrc2=size=1200x900",
        "-frames:v",
        "1",
        "in/block03.png",
      ]);
      // A deterministic, speech-like crest factor survives the unchanged I=-19 leveling and
      // -18dB presence gate. A pure sine's very low crest factor does not represent narration.
      await ffmpeg([
        "-f",
        "lavfi",
        "-i",
        "anoisesrc=color=pink:sample_rate=48000:duration=1:amplitude=0.8:seed=42",
        "-ac",
        "2",
        "in/voice01.wav",
      ]);
      writeFileSync(join(work, "in/card04.txt"), "A consistent export\nClear next action\n");
      copyFileSync(font!, join(work, "in/font.ttf"));
      const canonical = readFileSync(
        fileURLToPath(new URL("./assemble_final.sh", import.meta.url)),
        "utf8",
      ).replace(/\r\n/gu, "\n");
      writeFileSync(join(work, "assemble.sh"), canonical);
      // Pin only fixture resource use. The reviewed production script itself is not altered.
      const which = (await run(bash, ["--noprofile", "--norc", "-c", "command -v ffmpeg"])).trim();
      const tools = join(work, "fixture-bin");
      mkdirSync(tools);
      const shellQuote = (value: string) => `'${value.replace(/'/gu, `'\\''`)}'`;
      writeFileSync(
        join(tools, "ffmpeg"),
        `#!/usr/bin/env bash\nexec ${shellQuote(which)} -cpucount 2 "$@"\n`,
        { mode: 0o755 },
      );
      const paths = Object.entries(process.env).filter(([key]) => key.toLowerCase() !== "path");
      const originalPath =
        Object.entries(process.env).find(([key]) => key.toLowerCase() === "path")?.[1] ?? "";
      const env = {
        ...Object.fromEntries(paths),
        [process.platform === "win32" ? "Path" : "PATH"]:
          `${tools}${process.platform === "win32" ? ";" : ":"}${originalPath}`,
        ASSEMBLE_FONT: "in/font.ttf",
      };
      await run(
        bash,
        [
          "--noprofile",
          "--norc",
          "assemble.sh",
          "--scene",
          "video:2",
          "--scene",
          "video:2",
          "--scene",
          "image:1",
          "--scene",
          "card:2",
          "--target-seconds",
          "7",
        ],
        env,
      );
      const probe = JSON.parse(
        await run("ffprobe", [
          "-v",
          "error",
          "-count_frames",
          "-show_streams",
          "-show_format",
          "-of",
          "json",
          "out/final.mp4",
        ]),
      ) as {
        streams: {
          codec_type: string;
          codec_name: string;
          width?: number;
          height?: number;
          pix_fmt?: string;
          sample_aspect_ratio?: string;
          r_frame_rate?: string;
          avg_frame_rate?: string;
          nb_read_frames?: string;
          duration?: string;
          sample_rate?: string;
        }[];
        format: { duration: string };
      };
      const video = probe.streams.find((stream) => stream.codec_type === "video")!;
      const audio = probe.streams.find((stream) => stream.codec_type === "audio")!;
      expect(video).toMatchObject({
        codec_name: "h264",
        width: 720,
        height: 1280,
        pix_fmt: "yuv420p",
        sample_aspect_ratio: "1:1",
        r_frame_rate: "30/1",
        avg_frame_rate: "30/1",
        nb_read_frames: "210",
      });
      expect(Math.abs(Number(probe.format.duration) - 7)).toBeLessThanOrEqual(0.5);
      expect(audio.codec_name).toBe("aac");
      expect(audio.sample_rate).toBe("48000");
      expect(Math.abs(Number(audio.duration) - 7)).toBeLessThanOrEqual(0.1);
      const timestamps = (
        await run("ffprobe", [
          "-v",
          "error",
          "-select_streams",
          "v:0",
          "-show_entries",
          "packet=dts_time",
          "-of",
          "csv=p=0",
          "out/final.mp4",
        ])
      )
        .trim()
        .split(/\r?\n/gu)
        .map(Number);
      expect(timestamps).toHaveLength(210);
      expect(
        timestamps.every(
          (value, index) =>
            Number.isFinite(value) && (index === 0 || value > timestamps[index - 1]!),
        ),
      ).toBe(true);
      const decode = await execFileAsync(
        "ffmpeg",
        [
          "-cpucount",
          "2",
          "-v",
          "error",
          "-xerror",
          "-i",
          join(work, "out/final.mp4"),
          "-f",
          "null",
          "-",
        ],
        { encoding: "utf8", windowsHide: true, timeout: 30_000 },
      );
      expect(decode.stderr).toBe("");
      const sidecarText = readFileSync(join(work, "out/final.mp4.assembly.json"), "utf8");
      const sidecar = JSON.parse(sidecarText);
      expect(sidecar).toMatchObject({
        width: 720,
        height: 1280,
        fps: "30",
        scene_count: 4,
        target_duration_s: 7,
        audio_sample_rate_hz: 48000,
      });
      expect(["linear", "dynamic"]).toContain(sidecar.normalization_mode);
      expect(sidecar.gates).toContain(`${sidecar.normalization_mode}_loudnorm_-16`);
      expect(sidecar.gates).not.toContain(
        `${sidecar.normalization_mode === "linear" ? "dynamic" : "linear"}_loudnorm_-16`,
      );
      expect(sidecar.scenes.map((scene: { visual: string }) => scene.visual)).toEqual([
        "video",
        "video",
        "image",
        "card",
      ]);
      expect(sidecar.scenes[0].speech_dur_s).toBeGreaterThan(0);
      expect(parseAssemblySidecar(sidecarText).ok).toBe(true);
      if (process.env.KEEP_RENDER_FIXTURES === "1")
        console.info(`Offline render fixture retained: ${work}`);
    } finally {
      if (process.env.KEEP_RENDER_FIXTURES !== "1") {
        rmSync(work, { recursive: true, force: true });
      }
    }
  },
  120_000,
);

test.skipIf(!available)(
  "final audio pins 48 kHz and reports actual linear, dynamic and silent modes; missing stats refuse",
  async () => {
    const base = fileURLToPath(new URL("../../../../.tmp", import.meta.url));
    mkdirSync(base, { recursive: true });
    const work = mkdtempSync(join(base, "render-audio-"));
    if (dirname(resolve(work)) !== resolve(base) || !basename(work).startsWith("render-audio-"))
      throw new Error("Unsafe audio fixture cleanup path");
    const canonical = readFileSync(
      fileURLToPath(new URL("./assemble_final.sh", import.meta.url)),
      "utf8",
    ).replace(/\r\n/gu, "\n");
    const start = canonical.indexOf('echo "[4/4] finalize');
    const end = canonical.indexOf("# The fixed-length guarantee", start);
    expect(start).toBeGreaterThan(0);
    expect(end).toBeGreaterThan(start);
    const finalize = canonical.slice(start, end);
    const run = (command: string, args: string[], env = process.env) =>
      execFileAsync(command, args, {
        cwd: work,
        env,
        windowsHide: true,
        encoding: "utf8",
        timeout: 30_000,
        maxBuffer: 1024 * 1024,
      });
    try {
      const ffmpegPath = (
        await run(bash, ["--noprofile", "--norc", "-c", "command -v ffmpeg"])
      ).stdout.trim();
      const quote = (value: string) => `'${value.replace(/'/gu, `'\\''`)}'`;
      const tools = join(work, "fixture-bin");
      mkdirSync(tools);
      // Controlled first-pass measurements make both possible/impossible linear paths
      // deterministic. The second pass is REAL ffmpeg; its JSON verdict must be recorded.
      writeFileSync(
        join(tools, "ffmpeg"),
        `#!/usr/bin/env bash\nset -euo pipefail\nREAL=${quote(ffmpegPath)}\n` +
          `if [[ "\${AUDIO_CASE:-}" == linear && "$*" == *print_format=json* && "$*" != *"-c:a aac"* ]]; then\n` +
          `  printf '%s\\n' '{' '  "input_i" : "-16",' '  "input_tp" : "-20",' '  "input_lra" : "1",' '  "input_thresh" : "-26",' '  "target_offset" : "0"' '}' >&2; exit 0\nfi\n` +
          `if [[ "\${AUDIO_CASE:-}" == dynamic && "$*" == *print_format=json* && "$*" != *"-c:a aac"* ]]; then\n` +
          `  printf '%s\\n' '{' '  "input_i" : "-20",' '  "input_tp" : "-1",' '  "input_lra" : "20",' '  "input_thresh" : "-30",' '  "target_offset" : "0"' '}' >&2; exit 0\nfi\n` +
          `if [[ "\${AUDIO_CASE:-}" == missing && "$*" == *"-c:a aac"* ]]; then\n` +
          `  "$REAL" -cpucount 1 -threads 1 "$@" 2>actual-final.log\n` +
          `  printf '%s\\n' '  "normalization_type" : "linear"' >&2\n` +
          `  sed '/"normalization_type"/d' actual-final.log >&2; exit 0\nfi\n` +
          `exec "$REAL" -cpucount 1 -threads 1 "$@"\n`,
        { mode: 0o755 },
      );
      await run("ffmpeg", [
        "-cpucount",
        "1",
        "-v",
        "error",
        "-y",
        "-f",
        "lavfi",
        "-i",
        "anoisesrc=color=pink:sample_rate=48000:duration=3.016:amplitude=0.5:seed=42",
        "-ac",
        "2",
        "voice.wav",
      ]);
      await run("ffmpeg", [
        "-cpucount",
        "1",
        "-v",
        "error",
        "-y",
        "-f",
        "lavfi",
        "-i",
        "anullsrc=r=48000:cl=stereo",
        "-t",
        "3",
        "silence.wav",
      ]);
      const paths = Object.entries(process.env).filter(([key]) => key.toLowerCase() !== "path");
      const originalPath =
        Object.entries(process.env).find(([key]) => key.toLowerCase() === "path")?.[1] ?? "";
      for (const mode of ["linear", "dynamic", "none", "missing"] as const) {
        const prefix = `set -euo pipefail\nTMP=.; OUT=${mode}.m4a; VOTRACK=${mode === "none" ? "silence" : "voice"}.wav; NTAKE=${mode === "none" ? 0 : 1}; NDIEG=0; MUSICWAV=""\n`;
        writeFileSync(
          join(work, "finalize.sh"),
          prefix + finalize + '\nprintf "%s %s\\n" "$NORMALIZATION_MODE" "$AUDIO_RATE"\n',
        );
        const env = {
          ...Object.fromEntries(paths),
          [process.platform === "win32" ? "Path" : "PATH"]:
            `${tools}${process.platform === "win32" ? ";" : ":"}${originalPath}`,
          AUDIO_CASE: mode,
        };
        if (mode === "missing") {
          await expect(run(bash, ["--noprofile", "--norc", "finalize.sh"], env)).rejects.toThrow(
            "final loudness statistics missing or invalid",
          );
          continue;
        }
        const result = await run(bash, ["--noprofile", "--norc", "finalize.sh"], env);
        expect(result.stdout.trim()).toBe(`${mode} 48000`);
        const audio = JSON.parse(
          (
            await run("ffprobe", [
              "-v",
              "error",
              "-select_streams",
              "a:0",
              "-show_entries",
              "stream=sample_rate,duration:packet=pts_time,duration_time",
              "-show_packets",
              "-of",
              "json",
              `${mode}.m4a`,
            ])
          ).stdout,
        );
        expect(audio.streams[0].sample_rate).toBe("48000");
        expect(
          audio.packets.every(
            (packet: { duration_time: string }) =>
              Number(packet.duration_time) <= 1024 / 48000 + 0.00001,
          ),
        ).toBe(true);
        const decoded = JSON.parse(
          (
            await run("ffprobe", [
              "-v",
              "error",
              "-select_streams",
              "a:0",
              "-show_frames",
              "-show_entries",
              "frame=nb_samples",
              "-of",
              "json",
              `${mode}.m4a`,
            ])
          ).stdout,
        );
        const decodedSeconds =
          decoded.frames.reduce(
            (sum: number, frame: { nb_samples: number }) => sum + frame.nb_samples,
            0,
          ) / 48000;
        expect(Math.abs(decodedSeconds - Number(audio.streams[0].duration))).toBeLessThanOrEqual(
          1024 / 48000 + 0.001,
        );
      }
    } finally {
      if (process.env.KEEP_RENDER_FIXTURES !== "1") rmSync(work, { recursive: true, force: true });
    }
  },
  120_000,
);
