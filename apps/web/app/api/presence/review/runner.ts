import { createHash, timingSafeEqual } from "node:crypto";
import { buildSandboxOptions, type SandboxLike, type SandboxOptions } from "@pikar/core/render";
import { presenceBrowserWorkerScript } from "./worker";

const HASH = /^[a-f0-9]{64}$/;
const SLUG = /^[a-z0-9][a-z0-9-]{0,63}$/;
const MAX_REQUEST = 4_000_000;
export type PresenceReviewInput = {
  version: 1;
  contentHash: string;
  providerReceiptHash: string;
  routeSlug: string;
  artifacts: { pageSlug: string; html: string; contentHash: string }[];
  assets: { path: string; url: string; sha256: string; mimeType: string }[];
};
const hash = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex");
const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export function validatePresenceReviewInput(
  value: unknown,
  deploymentUrl: string,
): value is PresenceReviewInput {
  if (
    !record(value) ||
    value.version !== 1 ||
    typeof value.contentHash !== "string" ||
    !HASH.test(value.contentHash) ||
    typeof value.providerReceiptHash !== "string" ||
    !HASH.test(value.providerReceiptHash) ||
    typeof value.routeSlug !== "string" ||
    !SLUG.test(value.routeSlug) ||
    !Array.isArray(value.artifacts) ||
    value.artifacts.length < 1 ||
    value.artifacts.length > 8 ||
    !Array.isArray(value.assets) ||
    value.assets.length > 64
  )
    return false;
  let origin: URL;
  try {
    origin = new URL(deploymentUrl);
  } catch {
    return false;
  }
  if (origin.protocol !== "https:" || !/^[a-z0-9-]+\.convex\.cloud$/.test(origin.hostname))
    return false;
  const pages = new Set<string>(),
    assets = new Set<string>();
  for (const artifact of value.artifacts) {
    if (
      !record(artifact) ||
      typeof artifact.pageSlug !== "string" ||
      !SLUG.test(artifact.pageSlug) ||
      pages.has(artifact.pageSlug) ||
      typeof artifact.html !== "string" ||
      Buffer.byteLength(artifact.html) > 262144 ||
      hash(artifact.html) !== artifact.contentHash ||
      !/^<!doctype html>/i.test(artifact.html.trim()) ||
      !/<\/html>\s*$/i.test(artifact.html) ||
      /<(?:script|iframe|object|embed|base)\b|\son[a-z]+\s*=|http-equiv\s*=/i.test(artifact.html)
    )
      return false;
    pages.add(artifact.pageSlug);
  }
  for (const asset of value.assets) {
    if (
      !record(asset) ||
      typeof asset.path !== "string" ||
      assets.has(asset.path) ||
      !asset.path.startsWith(`/p/${value.routeSlug}/assets/`) ||
      !/^\/p\/[a-z0-9-]+\/assets\/[a-zA-Z0-9_-]+\/[a-f0-9]{64}$/.test(asset.path) ||
      typeof asset.sha256 !== "string" ||
      !HASH.test(asset.sha256) ||
      asset.path.split("/").at(-1) !== asset.sha256 ||
      !["image/png", "image/jpeg", "image/webp"].includes(String(asset.mimeType)) ||
      typeof asset.url !== "string"
    )
      return false;
    try {
      const url = new URL(asset.url);
      if (
        url.origin !== origin.origin ||
        url.username ||
        url.password ||
        url.search ||
        url.hash ||
        !/^\/api\/storage\/[a-zA-Z0-9_-]+$/.test(url.pathname)
      )
        return false;
    } catch {
      return false;
    }
    assets.add(asset.path);
  }
  return true;
}

async function boundedBytes(body: ReadableStream<Uint8Array> | null, max: number): Promise<Buffer> {
  if (!body) throw Error("EMPTY_BODY");
  const reader = body.getReader(),
    chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > max) {
        await reader.cancel();
        throw Error("BODY_LIMIT");
      }
      chunks.push(next.value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks);
}

export async function handlePresenceReviewRequest(
  req: Request,
  deps: {
    secret?: string;
    snapshotId?: string;
    deploymentUrl?: string;
    createSandbox(options: SandboxOptions): Promise<SandboxLike>;
    fetch: typeof fetch;
  },
): Promise<Response> {
  const authorization = req.headers.get("authorization") ?? "",
    expected = `Bearer ${deps.secret ?? ""}`;
  if (
    !deps.secret ||
    deps.secret.length < 32 ||
    Buffer.byteLength(authorization) !== Buffer.byteLength(expected) ||
    !timingSafeEqual(Buffer.from(authorization), Buffer.from(expected))
  )
    return Response.json({ error: "unauthorized" }, { status: 401 });
  if (!deps.snapshotId || !deps.deploymentUrl)
    return Response.json({ error: "browser_not_configured" }, { status: 503 });
  let sandbox: SandboxLike | undefined;
  try {
    const input: unknown = JSON.parse((await boundedBytes(req.body, MAX_REQUEST)).toString("utf8"));
    if (!validatePresenceReviewInput(input, deps.deploymentUrl))
      return Response.json({ error: "invalid_review_input" }, { status: 400 });
    const files: { path: string; content: Uint8Array<ArrayBuffer> }[] = [];
    let total = 0;
    const downloadDeadline = AbortSignal.timeout(45000);
    for (const [index, asset] of input.assets.entries()) {
      const response = await deps.fetch(asset.url, {
        redirect: "error",
        signal: AbortSignal.any([downloadDeadline, AbortSignal.timeout(15000)]),
      });
      if (!response.ok || response.headers.get("content-type")?.split(";")[0] !== asset.mimeType)
        throw Error("ASSET_RESPONSE_INVALID");
      const bytes = await boundedBytes(response.body, 4_000_000);
      total += bytes.length;
      if (total > 16_000_000 || hash(bytes) !== asset.sha256) throw Error("ASSET_INTEGRITY_FAILED");
      files.push({ path: `/tmp/presence-review/asset-${index}`, content: Uint8Array.from(bytes) });
    }
    sandbox = await deps.createSandbox(
      buildSandboxOptions({ snapshotId: deps.snapshotId, timeoutMs: 180000 }),
    );
    await sandbox.mkDir("/tmp/presence-review");
    await sandbox.writeFiles([
      ...files,
      { path: "/tmp/presence-review/input.json", content: Buffer.from(JSON.stringify(input)) },
      {
        path: "/tmp/presence-review/worker.mjs",
        content: Buffer.from(presenceBrowserWorkerScript()),
      },
    ]);
    const command = await sandbox.runCommand("node", ["/tmp/presence-review/worker.mjs"]);
    if (command.exitCode !== 0) throw Error("BROWSER_JOB_FAILED");
    const result = await sandbox.readFileToBuffer({ path: "/tmp/presence-review/result.json" });
    if (!result || result.byteLength > 3_000_000) throw Error("BROWSER_RESULT_INVALID");
    const output = JSON.parse(Buffer.from(result).toString("utf8"));
    if (
      !record(output) ||
      output.status !== "captured" ||
      output.contentHash !== input.contentHash ||
      output.providerReceiptHash !== input.providerReceiptHash ||
      !Array.isArray(output.reports) ||
      output.reports.length !== input.artifacts.length * 3 ||
      !Array.isArray(output.screenshots) ||
      output.screenshots.length !== input.artifacts.length * 3 ||
      output.fidelity !== "not_assessed" ||
      output.visualContrast !== "not_assessed"
    )
      throw Error("BROWSER_RESULT_INVALID");
    if (
      JSON.stringify(output.artifactHashes) !==
      JSON.stringify(
        input.artifacts.map(({ pageSlug, contentHash }) => ({ pageSlug, contentHash })),
      )
    )
      throw Error("BROWSER_RESULT_BINDING");
    const seen = new Set<string>();
    for (const screenshot of output.screenshots) {
      if (
        !record(screenshot) ||
        !input.artifacts.some((artifact) => artifact.pageSlug === screenshot.pageSlug) ||
        !(
          (screenshot.viewportWidth === 1440 && screenshot.reducedMotion === false) ||
          (screenshot.viewportWidth === 390 && typeof screenshot.reducedMotion === "boolean")
        ) ||
        screenshot.width !== screenshot.viewportWidth ||
        typeof screenshot.height !== "number" ||
        !Number.isSafeInteger(screenshot.height) ||
        screenshot.height < 1 ||
        screenshot.height > 12000 ||
        screenshot.mimeType !== "image/jpeg" ||
        typeof screenshot.base64 !== "string" ||
        screenshot.base64.length > 350000 ||
        typeof screenshot.sha256 !== "string"
      )
        throw Error("SCREENSHOT_INVALID");
      const key = `${screenshot.pageSlug}:${screenshot.viewportWidth}:${screenshot.reducedMotion}`;
      const bytes = Buffer.from(screenshot.base64, "base64");
      if (
        seen.has(key) ||
        bytes.length > 262144 ||
        bytes[0] !== 255 ||
        bytes[1] !== 216 ||
        bytes[2] !== 255 ||
        bytes.toString("base64") !== screenshot.base64 ||
        hash(bytes) !== screenshot.sha256
      )
        throw Error("SCREENSHOT_INTEGRITY_FAILED");
      const reports = output.reports.filter(
        (report) =>
          record(report) &&
          report.pageSlug === screenshot.pageSlug &&
          report.viewportWidth === screenshot.viewportWidth &&
          report.reducedMotion === screenshot.reducedMotion &&
          report.version === "web-browser-quality-v1",
      );
      if (reports.length !== 1) throw Error("BROWSER_REPORT_MISSING");
      seen.add(key);
    }
    return new Response(result, {
      status: 200,
      headers: { "content-type": "application/json", "cache-control": "no-store" },
    });
  } catch {
    return Response.json({ error: "browser_review_unavailable" }, { status: 502 });
  } finally {
    if (sandbox) await sandbox.stop();
  }
}
