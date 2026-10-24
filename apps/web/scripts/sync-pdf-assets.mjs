// Keep parsing/render support assets on our own origin, pinned to the installed PDF.js release.
import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const packageRoot = dirname(require.resolve("pdfjs-dist/package.json"));
const { version } = JSON.parse(await readFile(join(packageRoot, "package.json"), "utf8"));
if (!/^\d+\.\d+\.\d+$/u.test(version)) throw new Error("Unexpected PDF.js version");
const publicRoot = resolve(fileURLToPath(new URL("../public/pdfjs/", import.meta.url)));
const destination = join(publicRoot, version);
await mkdir(destination, { recursive: true });
await cp(join(packageRoot, "build/pdf.worker.min.mjs"), join(destination, "pdf.worker.min.mjs"));
for (const directory of ["cmaps", "standard_fonts", "wasm"]) {
  await cp(join(packageRoot, directory), join(destination, directory), { recursive: true });
}
await writeFile(join(destination, "version.json"), JSON.stringify({ version }));
console.info(`Local PDF viewer assets ready (${version})`);
