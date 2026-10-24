import { convexTest } from "convex-test";
import { afterEach, expect, test, vi } from "vitest";
import schema from "./schema";

const modules = import.meta.glob("./**/*.*s");
const filename = "tiktokAb12CD34.txt";
const content = "tiktok-developers-site-verification=public-test-proof\n";
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
function setup() {
  vi.stubEnv("TIKTOK_URL_VERIFICATION_FILENAME", filename);
  vi.stubEnv("TIKTOK_URL_VERIFICATION_CONTENT", content);
  return convexTest(schema, modules);
}
test("serves the exact public proof bytes at only its configured path with no media access", async () => {
  const t = setup(),
    fetcher = vi.fn();
  vi.stubGlobal("fetch", fetcher);
  const r = await t.fetch("/social/media/" + filename);
  expect(r.status).toBe(200);
  expect(await r.text()).toBe(content);
  expect(r.headers.get("content-type")).toBe("text/plain; charset=utf-8");
  expect(r.headers.get("cache-control")).toBe("no-store");
  expect(r.headers.get("x-content-type-options")).toBe("nosniff");
  expect(fetcher).not.toHaveBeenCalled();
  expect(await t.run((ctx) => ctx.db.query("socialPosts").collect())).toEqual([]);
  expect((await t.fetch("/social/media?postId=bad&ticket=" + "a".repeat(43))).status).toBe(404);
});
test.each([
  "/social/media/tiktokDifferent.txt",
  "/social/media/",
  "/social/media/" + filename + "/extra",
  "/social/media/" + filename + "?ticket=ignored",
  "/social/media/%74iktokAb12CD34.txt",
  "/social/media/tiktokAb12CD34.txt%2Fsecret",
  "/social/media/tiktokAb12CD34.TXT",
])("rejects an unconfigured or encoded verification path: %s", async (path) => {
  const r = await setup().fetch(path);
  expect(r.status).toBe(404);
  expect(await r.text()).not.toContain(content);
});
test.each([
  undefined,
  "",
  "tiktok.txt",
  "../tiktokAb.txt",
  "tiktokAb.txt/extra",
  "tiktokAb_.txt",
  "tiktok" + "a".repeat(160) + ".txt",
])("fails closed for invalid configured filename %s", async (value) => {
  const t = setup();
  if (value === undefined) vi.stubEnv("TIKTOK_URL_VERIFICATION_FILENAME", undefined);
  else vi.stubEnv("TIKTOK_URL_VERIFICATION_FILENAME", value);
  expect((await t.fetch("/social/media/" + filename)).status).toBe(404);
});
test.each([
  undefined,
  "",
  " \r\n\t",
  "a".repeat(4097),
  "proof\u0001",
  "<script>\u0080</script>",
])("fails closed for missing, oversized or non-plain verification content", async (value) => {
  const t = setup();
  vi.stubEnv("TIKTOK_URL_VERIFICATION_CONTENT", value);
  const r = await t.fetch("/social/media/" + filename);
  expect(r.status).toBe(404);
  expect(await r.text()).toBe("");
});
test("HEAD and POST cannot return proof bytes", async () => {
  const t = setup();
  for (const method of ["HEAD", "POST"]) {
    const r = await t.fetch("/social/media/" + filename, { method });
    expect(r.status).not.toBe(200);
    expect(await r.text()).not.toContain(content);
  }
});
