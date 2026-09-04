import { existsSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { createLocalSandbox, resolveShell } from "./localSandbox";

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

  // THE TEST THIS FILE SHIPPED WITHOUT. Every other case here spawns `node`, which is on PATH on
  // every platform — so the suite was green while the ONE command `renderReel` actually issues,
  // `sh`, died `spawn sh ENOENT` on Windows after fetching every input and paying for every asset.
  // Coverage of the mechanism is not coverage of the behaviour.
  it("runs `sh` — the command renderReel actually issues — and it is a bash that has arrays", async () => {
    const box = await createLocalSandbox();
    // Arrays are the bashism `assemble_final.sh` leans on hardest (TAKE_ABS/TAKE_PAD); a strict
    // POSIX `sh` substitute would parse this and fail, which is the wrong kind of pass.
    await box.writeFiles([
      {
        path: "probe.sh",
        content: new TextEncoder().encode(
          'a=(x y z); [ "${#a[@]}" = 3 ] || { echo "no-arrays" >&2; exit 9; }\n' +
            '[ "$1" = "video:7" ] || { echo "mangled:$1" >&2; exit 8; }\n',
        ),
      },
    ]);
    // `video:7` is the scene spec, and the worry was that MSYS argument conversion would rewrite a
    // `a:b` pair into `a;b` on the way to bash. IT DOES NOT — this case is what established that,
    // and it matters because the conversion cannot simply be switched off: `assemble_final.sh`
    // hands ffmpeg POSIX paths from `mktemp -d`, and a NATIVE Windows ffmpeg needs exactly that
    // conversion to resolve them. The script reports what it RECEIVED on stderr, so if a future
    // Git build ever does mangle this, it fails here rather than rendering the wrong reel.
    const run = await box.runCommand("sh", ["probe.sh", "video:7"]);
    expect(await run.stderr()).toBe("");
    expect(run.exitCode).toBe(0);

    // AND THE RESOLVER ITSELF, because the run above is NOT the guard it looks like. Vitest is
    // started from a Git Bash shell, whose PATH already carries `/usr/bin/sh` — so on this machine
    // the spawn succeeds with the resolver deleted, and the case passes while the bug it exists to
    // catch is fully present. (Verified: the no-op mutant survived it.) The server that actually
    // serves this route is launched from `cmd.exe` and has no such PATH. The falsifiable claim is
    // therefore about `resolveShell`, not about whether a spawn happened to find something.
    if (process.platform === "win32") {
      expect(resolveShell("sh")).not.toBe("sh");
      expect(existsSync(resolveShell("sh"))).toBe(true);
    }
    expect(resolveShell("ffmpeg")).toBe("ffmpeg"); // only `sh` is substituted, never a real binary
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
