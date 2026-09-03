import { readdir } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { createLocalSandbox } from "./localSandbox";

/**
 * This implementation runs commands and writes files on a REAL filesystem, which is exactly why it
 * gets a test rather than a comment. Three properties are load-bearing and each fails differently:
 * containment (a traversal reaching a real disk), no-shell (tenant scene text reaching these
 * scripts as content), and `null`-on-missing (a throw here becomes an unhandled route error with
 * no reason code on the plan row, instead of the governed `mp4_missing`).
 */
describe("createLocalSandbox — the dev-only SandboxLike", () => {
  it("round-trips a file through write and read", async () => {
    const box = await createLocalSandbox();
    await box.mkDir("in");
    await box.writeFiles([{ path: "in/a.txt", content: new TextEncoder().encode("hello") }]);
    const back = await box.readFileToBuffer({ path: "in/a.txt" });
    expect(back && new TextDecoder().decode(back)).toBe("hello");
    await box.stop();
  });

  it("creates parent directories the caller did not make", async () => {
    // Core does not always `mkDir` before writing, and the real sandbox tolerates it. A local
    // runner that did not would fail on a path the Vercel one accepts — a difference that would
    // only ever show up as a render failure nobody could reproduce in CI.
    const box = await createLocalSandbox();
    await box.writeFiles([{ path: "deep/er/still/x.bin", content: new Uint8Array([1, 2, 3]) }]);
    expect(await box.readFileToBuffer({ path: "deep/er/still/x.bin" })).toEqual(
      new Uint8Array([1, 2, 3]),
    );
    await box.stop();
  });

  it("REFUSES a path that escapes the render root, on every method that takes one", async () => {
    const box = await createLocalSandbox();
    const escapes = "../../escaped.txt";
    await expect(box.mkDir(escapes)).rejects.toThrow(/escapes the render root/);
    await expect(box.writeFiles([{ path: escapes, content: new Uint8Array([0]) }])).rejects.toThrow(
      /escapes the render root/,
    );
    // An absolute path is the other half of the same hole and must be refused identically.
    await expect(
      box.writeFiles([{ path: "/etc/passwd", content: new Uint8Array([0]) }]),
    ).rejects.toThrow(/escapes the render root/);
    await box.stop();
  });

  it("a MISSING file is null, never a throw — it is a governed reason code upstream", async () => {
    const box = await createLocalSandbox();
    expect(await box.readFileToBuffer({ path: "out/final.mp4" })).toBeNull();
    await box.stop();
  });

  it("runs a command in the root and reports its exit code and stderr", async () => {
    const box = await createLocalSandbox();
    await box.writeFiles([{ path: "hi.txt", content: new TextEncoder().encode("ok") }]);
    const good = await box.runCommand("node", ["-e", "process.stderr.write('noise')"]);
    expect(good.exitCode).toBe(0);
    expect(await good.stderr()).toContain("noise");
    const bad = await box.runCommand("node", ["-e", "process.exit(3)"]);
    expect(bad.exitCode).toBe(3);
    await box.stop();
  });

  it("cwd IS the render root, so the scripts' relative paths resolve", async () => {
    // `sh assemble_final.sh --in in --out out/final.mp4` is entirely relative. A runner that
    // spawned in the repo root would read and write the wrong files while exiting 0.
    const box = await createLocalSandbox();
    await box.writeFiles([{ path: "marker.txt", content: new TextEncoder().encode("x") }]);
    const run = await box.runCommand("node", [
      "-e",
      "require('node:fs').accessSync('marker.txt'); process.exit(0)",
    ]);
    expect(run.exitCode).toBe(0);
    await box.stop();
  });

  it("does NOT interpret shell metacharacters — argv only", async () => {
    // The scene text a tenant wrote reaches these scripts as file content, and a card's words are
    // drawn by ffmpeg. If this spawned through a shell, a semicolon in an argument would be a
    // command. Asserted by handing a would-be injection to a program that echoes its argv: it must
    // come back as ONE literal argument, not run as a second command.
    const box = await createLocalSandbox();
    const nasty = "; touch pwned.txt";
    const run = await box.runCommand("node", [
      "-e",
      "process.stderr.write(process.argv[1])",
      nasty,
    ]);
    expect(run.exitCode).toBe(0);
    expect(await run.stderr()).toBe(nasty);
    expect(await box.readFileToBuffer({ path: "pwned.txt" })).toBeNull();
    await box.stop();
  });

  it("stop() removes the root, so tenant media does not linger in temp", async () => {
    const box = await createLocalSandbox();
    await box.writeFiles([{ path: "secret.bin", content: new Uint8Array([9]) }]);
    // Locate the root through the runner itself rather than by guessing the temp path.
    const run = await box.runCommand("node", ["-e", "process.stderr.write(process.cwd())"]);
    const root = await run.stderr();
    expect((await readdir(root)).length).toBeGreaterThan(0);
    await box.stop();
    await expect(readdir(root)).rejects.toThrow();
  });
});
