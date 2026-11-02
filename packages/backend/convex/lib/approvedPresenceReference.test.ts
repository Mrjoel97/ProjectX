import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  APPROVED_FIELDWORK_MANIFEST_HASH,
  APPROVED_FIELDWORK_REFERENCE,
  getApprovedPresenceReferenceIdentity,
  validateApprovedPresenceReferenceIdentity,
} from "@pikar/contracts/approvedPresenceReference";
import { expect, test, vi } from "vitest";
import { loadApprovedPresenceReference } from "./approvedPresenceReference";

const manifest = APPROVED_FIELDWORK_REFERENCE;
const all = [manifest.html, manifest.desktop, manifest.mobile, ...manifest.assets];
const publicRoot = new URL("../../../../apps/web/public/", import.meta.url);
function fixtureFetch(alter?: (bytes: Uint8Array, path: string) => Uint8Array) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    const pin = all.find((item) => item.path === url.pathname);
    if (!pin) throw Error("UNEXPECTED_PATH");
    let bytes = new Uint8Array(readFileSync(new URL("." + pin.path, publicRoot)));
    if (alter) bytes = new Uint8Array(alter(bytes, pin.path));
    return new Response(bytes, { status: 200 });
  });
}
test("manifest identity pins approved HTML, both captured viewports and every referenced asset", async () => {
  expect(createHash("sha256").update(JSON.stringify(manifest)).digest("hex")).toBe(
    APPROVED_FIELDWORK_MANIFEST_HASH,
  );
  const fetch = fixtureFetch();
  const loaded = await loadApprovedPresenceReference({
    referenceId: "fieldwork-v1",
    siteUrl: "https://www.pikar-ai.com",
    fetch: fetch as typeof globalThis.fetch,
  });
  expect(loaded.identity).toEqual(getApprovedPresenceReferenceIdentity("fieldwork-v1"));
  expect(loaded.html).toContain("Fieldwork");
  expect(loaded.desktopImage.bytes.length).toBe(manifest.desktop.byteLength);
  expect(loaded.mobileImage.bytes.length).toBe(manifest.mobile.byteLength);
  expect(fetch).toHaveBeenCalledTimes(all.length);
  for (const call of fetch.mock.calls)
    expect(new URL(String(call[0])).origin).toBe("https://www.pikar-ai.com");
});
test("unknown selection and arbitrary origins refuse before fetch, without default reference", async () => {
  const fetch = fixtureFetch();
  for (const referenceId of [undefined, null, "https://evil.example", "other"]) {
    await expect(
      loadApprovedPresenceReference({
        referenceId,
        siteUrl: "https://www.pikar-ai.com",
        fetch: fetch as typeof globalThis.fetch,
      }),
    ).rejects.toThrow("APPROVED_REFERENCE_UNKNOWN");
  }
  for (const siteUrl of [
    "http://www.pikar-ai.com",
    "https://user:password@example.com",
    "https://example.com/path",
    "https://example.com/?redirect=evil",
  ]) {
    await expect(
      loadApprovedPresenceReference({
        referenceId: "fieldwork-v1",
        siteUrl,
        fetch: fetch as typeof globalThis.fetch,
      }),
    ).rejects.toThrow("APPROVED_REFERENCE_ORIGIN_INVALID");
  }
  expect(fetch).not.toHaveBeenCalled();
  expect(
    validateApprovedPresenceReferenceIdentity({
      ...getApprovedPresenceReferenceIdentity("fieldwork-v1"),
      url: "https://evil.example",
    }),
  ).toBe(false);
});
test("changed same-length HTML, oversized response and missing asset fail closed", async () => {
  for (const alter of [
    (bytes: Uint8Array) => {
      bytes[0] = (bytes[0] ?? 0) ^ 1;
      return bytes;
    },
    (bytes: Uint8Array) => new Uint8Array(bytes.length + 1),
  ]) {
    await expect(
      loadApprovedPresenceReference({
        referenceId: "fieldwork-v1",
        siteUrl: "https://www.pikar-ai.com",
        fetch: fixtureFetch(alter) as typeof globalThis.fetch,
      }),
    ).rejects.toThrow(/APPROVED_REFERENCE_(HASH|SIZE)_MISMATCH/);
  }
  const fetch = fixtureFetch();
  fetch.mockImplementationOnce(async () => new Response("missing", { status: 404 }));
  await expect(
    loadApprovedPresenceReference({
      referenceId: "fieldwork-v1",
      siteUrl: "https://www.pikar-ai.com",
      fetch: fetch as typeof globalThis.fetch,
    }),
  ).rejects.toThrow("APPROVED_REFERENCE_UNAVAILABLE");
});
