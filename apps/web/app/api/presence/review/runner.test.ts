import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, test, vi } from "vitest";
import { handlePresenceReviewRequest, validatePresenceReviewInput, type PresenceReviewInput } from "./runner";
import { presenceBrowserWorkerScript } from "./worker";
const digest = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
const secret = "a".repeat(40), deploymentUrl = "https://third-gecko-977.convex.cloud";
const html = '<!doctype html><html><body><main data-page="home"><h1>A studio</h1></main></body></html>';
const input = (): PresenceReviewInput => ({ version: 1, contentHash: "b".repeat(64), providerReceiptHash: "c".repeat(64), routeSlug: "studio", artifacts: [{ pageSlug: "home", html, contentHash: digest(html) }], assets: [] });
function fixture() {
  const source = input();
  const bytes = Buffer.from([255, 216, 255, 217]);
  const modes = [{ width: 1440, reduced: false }, { width: 390, reduced: false }, { width: 390, reduced: true }];
  const output = { status: "captured", contentHash: source.contentHash, providerReceiptHash: source.providerReceiptHash, artifactHashes: source.artifacts.map(({ pageSlug, contentHash }) => ({ pageSlug, contentHash })),
    reports: modes.map((mode) => ({ version: "web-browser-quality-v1", pageSlug: "home", viewportWidth: mode.width, reducedMotion: mode.reduced })),
    screenshots: modes.map((mode) => ({ pageSlug: "home", viewportWidth: mode.width, width: mode.width, height: 1000, reducedMotion: mode.reduced, mimeType: "image/jpeg", base64: bytes.toString("base64"), sha256: digest(bytes) })), fidelity: "not_assessed", visualContrast: "not_assessed" };
  const sandbox = { mkDir: vi.fn(async () => {}), writeFiles: vi.fn(async () => {}), runCommand: vi.fn(async () => ({ exitCode: 0, stderr: async () => "" })), readFileToBuffer: vi.fn(async () => Uint8Array.from(Buffer.from(JSON.stringify(output)))), stop: vi.fn(async () => {}) };
  const deps = { secret, deploymentUrl, snapshotId: "snapshot-browser", createSandbox: vi.fn(async () => sandbox), fetch: vi.fn() };
  const request = (value: unknown = source, authorization = `Bearer ${secret}`) => new Request("https://staging.example/api/presence/review", { method: "POST", headers: { authorization }, body: JSON.stringify(value) });
  return { source, output, sandbox, deps, request };
}
describe("trusted presence browser runner", () => {
  test("exempts only the exact worker endpoint from session login and still requires its bearer before any VM", async () => {
    const proxy = readFileSync(new URL("../../../../proxy.ts", import.meta.url), "utf8");
    const publicList = proxy.match(/const isPublic = createRouteMatcher\(\[([\s\S]*?)\]\)/)?.[1];
    expect(publicList).toBeDefined();
    const routes = Array.from(publicList!.matchAll(/"([^"\n]+)"/g), (match) => match[1]!);
    expect(routes.filter((route) => route.startsWith("/api"))).toEqual(["/api/media/render", "/api/presence/review"]);
    expect(routes).not.toContain("/(.*)");
    expect(proxy).toContain("!isPublic(request)");
    expect(proxy).toContain("await convexAuth.isAuthenticated()");
    const f = fixture();
    const request = new Request("https://staging.example/api/presence/review", { method: "POST", body: JSON.stringify(f.source) });
    expect((await handlePresenceReviewRequest(request, f.deps)).status).toBe(401);
    expect(f.deps.createSandbox).not.toHaveBeenCalled();
    expect(f.deps.fetch).not.toHaveBeenCalled();
  });
  test("refuses missing credentials/configuration before allocating a VM", async () => {
    const f = fixture();
    expect((await handlePresenceReviewRequest(f.request(undefined, "Bearer wrong"), f.deps)).status).toBe(401);
    expect((await handlePresenceReviewRequest(f.request(), { ...f.deps, snapshotId: undefined })).status).toBe(503);
    expect(f.deps.createSandbox).not.toHaveBeenCalled();
  });
  test("binds exact HTML and rejects injected content, wrong deployments, traversal and duplicates", () => {
    expect(validatePresenceReviewInput(input(), deploymentUrl)).toBe(true);
    for (const badHtml of [html + "changed", '<!doctype html><html><script>bad()</script></html>', '<!doctype html><html><body onload="bad()"></body></html>']) {
      const value = input(); value.artifacts[0]!.html = badHtml;
      if (!badHtml.endsWith("changed")) value.artifacts[0]!.contentHash = digest(badHtml);
      expect(validatePresenceReviewInput(value, deploymentUrl)).toBe(false);
    }
    const value = input(); value.artifacts.push(value.artifacts[0]!);
    expect(validatePresenceReviewInput(value, deploymentUrl)).toBe(false);
    const asset = { path: `/p/studio/assets/photo/${"d".repeat(64)}`, url: deploymentUrl + "/api/storage/asset-id", sha256: "d".repeat(64), mimeType: "image/png" };
    expect(validatePresenceReviewInput({ ...input(), assets: [asset] }, deploymentUrl)).toBe(true);
    for (const url of ["https://evil.example/api/storage/asset-id", deploymentUrl + "/api/storage/asset-id?secret=x", "http://127.0.0.1/file"]) expect(validatePresenceReviewInput({ ...input(), assets: [{ ...asset, url }] }, deploymentUrl)).toBe(false);
    expect(validatePresenceReviewInput({ ...input(), assets: [{ ...asset, path: "/tmp/../../secret" }] }, deploymentUrl)).toBe(false);
  });
  test("uses bounded nonpersistent deny-all snapshot and returns captures without claiming visual qualification", async () => {
    const f = fixture(); const response = await handlePresenceReviewRequest(f.request(), f.deps);
    expect(response.status).toBe(200);
    expect(f.deps.createSandbox).toHaveBeenCalledWith(expect.objectContaining({ source: { type: "snapshot", snapshotId: "snapshot-browser" }, persistent: false, networkPolicy: "deny-all", timeout: 180000, resources: { vcpus: 2 } }));
    expect(f.sandbox.stop).toHaveBeenCalledOnce();
    const body = await response.json(); expect(body.fidelity).toBe("not_assessed"); expect(body.screenshots).toHaveLength(3);
  });
  test("asset integrity failure refuses before allocating and failed jobs always stop", async () => {
    const f = fixture(); f.source.assets = [{ path: `/p/studio/assets/photo/${"d".repeat(64)}`, url: deploymentUrl + "/api/storage/asset-id", sha256: "d".repeat(64), mimeType: "image/png" }];
    f.deps.fetch.mockResolvedValue(new Response("wrong bytes", { headers: { "content-type": "image/png" } }));
    expect((await handlePresenceReviewRequest(f.request(), f.deps)).status).toBe(502); expect(f.deps.createSandbox).not.toHaveBeenCalled();
    const g = fixture(); g.sandbox.runCommand.mockResolvedValue({ exitCode: 1, stderr: async () => "private details" });
    expect((await handlePresenceReviewRequest(g.request(), g.deps)).status).toBe(502); expect(g.sandbox.stop).toHaveBeenCalledOnce();
  });
  test("refuses incomplete captures, altered screenshots and false fidelity claims", async () => {
    for (const mutate of [(out: ReturnType<typeof fixture>["output"]) => out.screenshots.pop(), (out: ReturnType<typeof fixture>["output"]) => { out.screenshots[0]!.sha256 = "0".repeat(64); }, (out: ReturnType<typeof fixture>["output"]) => { out.fidelity = "passed"; }]) {
      const f = fixture(); mutate(f.output);
      expect((await handlePresenceReviewRequest(f.request(), f.deps)).status).toBe(502); expect(f.sandbox.stop).toHaveBeenCalledOnce();
    }
  });
  test("worker has no runtime installation, external navigation or injected executable payload", () => {
    const script = presenceBrowserWorkerScript();
    expect(script).toContain("playwright/package.json"); expect(script).toContain("1.61.1");
    expect(script).toContain("javaScriptEnabled:false"); expect(script).toContain("serviceWorkers:'block'");
    expect(script).toContain("https://presence-review.invalid"); expect(script).toContain("mimeType:'image/jpeg'");
    expect(script).not.toMatch(/npm install|npx|eval\(input|new Function/);
  });
});
