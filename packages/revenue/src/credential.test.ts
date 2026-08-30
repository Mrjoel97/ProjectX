// The credential envelope is the only thing standing between a Convex row and four tenants'
// financial accounts. Every test here is $0: Web Crypto, no network, no Convex, no model.
//
// What these tests are FOR: copy-resistance. A sealed row is worthless outside the exact
// tenant/provider/connection/environment/key-version it was sealed for, so lifting ciphertext from
// one row into another — the realistic multi-tenant attack and the realistic *bug* — cannot be made
// to decrypt. That is asserted per AAD component, not once in aggregate, because one forgotten
// component is invisible in a combined check.
import { describe, expect, test } from "vitest";
import {
  type CredentialKey,
  type CredentialScope,
  importCredentialKey,
  openCredential,
  sealCredential,
} from "./credential";

/** A deterministic 32-byte key. Test material only — a real key comes from Convex env config. */
function keyB64(fill: number): string {
  const bytes = new Uint8Array(32).fill(fill);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

const SCOPE: CredentialScope = {
  tenantId: "j57tenantaaa",
  provider: "quickbooks",
  connectionId: "conn_0001",
  environment: "production",
};

/** The realistic payload: ONE sealed blob carrying both tokens, so a refresh replaces both. */
const PLAINTEXT = JSON.stringify({
  access: "eyJhbGciOi.accessTOKEN",
  refresh: "AB11712345678.refreshTOKEN",
  scope: "com.intuit.quickbooks.accounting",
  externalAccountId: "9130350000000000",
});

let v1: CredentialKey | undefined;
let v1Other: CredentialKey | undefined;
let v2: CredentialKey | undefined;

/** Lazy one-time key import — importing three keys per test would dominate the runtime. */
async function keys() {
  v1 ??= await importCredentialKey(keyB64(0x11), "v1");
  v1Other ??= await importCredentialKey(keyB64(0x22), "v1");
  v2 ??= await importCredentialKey(keyB64(0x33), "v2");
  return { v1, v1Other, v2 };
}

describe("importCredentialKey — fail closed on anything that is not a 32-byte key", () => {
  test("accepts exactly 32 bytes and reports its version", async () => {
    const k = await importCredentialKey(keyB64(0x11), "v1");
    expect(k.version).toBe("v1");
  });

  test("rejects a 16-byte key — AES-256 is not negotiable down to AES-128", async () => {
    let short = "";
    for (const b of new Uint8Array(16).fill(7)) short += String.fromCharCode(b);
    await expect(importCredentialKey(btoa(short), "v1")).rejects.toThrow(/32 bytes/i);
  });

  test("rejects a non-base64 string rather than silently decoding garbage", async () => {
    await expect(importCredentialKey("not base64!!", "v1")).rejects.toThrow(/base64/i);
  });

  test("rejects an empty key", async () => {
    await expect(importCredentialKey("", "v1")).rejects.toThrow();
  });

  test("rejects an unknown key version", async () => {
    // @ts-expect-error — the union is the point; this proves the RUNTIME also refuses.
    await expect(importCredentialKey(keyB64(0x11), "v9")).rejects.toThrow(/key version/i);
  });
});

describe("seal/open round-trip", () => {
  test("returns the exact plaintext, byte for byte", async () => {
    const { v1: k } = await keys();
    const env = await sealCredential(k, SCOPE, PLAINTEXT);
    expect(await openCredential(k, SCOPE, env)).toBe(PLAINTEXT);
  });

  test("survives non-ASCII plaintext (a provider display name in a sealed blob)", async () => {
    const { v1: k } = await keys();
    const utf8 = JSON.stringify({ access: "tok", note: "Societe Generale - cafe ☕ éè" });
    const env = await sealCredential(k, SCOPE, utf8);
    expect(await openCredential(k, SCOPE, env)).toBe(utf8);
  });

  test("the envelope names its algorithm and key version, and a 96-bit IV", async () => {
    const { v1: k } = await keys();
    const env = await sealCredential(k, SCOPE, PLAINTEXT);
    expect(env.algorithm).toBe("AES-256-GCM");
    expect(env.keyVersion).toBe("v1");
    expect(atob(env.ivB64).length).toBe(12);
  });

  test("the envelope carries NO plaintext and no scope in the clear", async () => {
    const { v1: k } = await keys();
    const env = await sealCredential(k, SCOPE, PLAINTEXT);
    const serialized = JSON.stringify(env);
    expect(serialized).not.toContain("accessTOKEN");
    expect(serialized).not.toContain("refreshTOKEN");
    expect(serialized).not.toContain(SCOPE.tenantId);
    expect(serialized).not.toContain(SCOPE.connectionId);
  });

  test("sealing the SAME plaintext twice yields a different IV and different ciphertext", async () => {
    const { v1: k } = await keys();
    const a = await sealCredential(k, SCOPE, PLAINTEXT);
    const b = await sealCredential(k, SCOPE, PLAINTEXT);
    expect(a.ivB64).not.toBe(b.ivB64);
    expect(a.ciphertextB64).not.toBe(b.ciphertextB64);
    // Both still open — a fresh IV is not a lost credential.
    expect(await openCredential(k, SCOPE, a)).toBe(PLAINTEXT);
    expect(await openCredential(k, SCOPE, b)).toBe(PLAINTEXT);
  });

  test("rejects an empty plaintext rather than sealing nothing", async () => {
    const { v1: k } = await keys();
    await expect(sealCredential(k, SCOPE, "")).rejects.toThrow();
  });

  test("rejects a scope with an unknown provider or a blank field", async () => {
    const { v1: k } = await keys();
    await expect(
      // @ts-expect-error — closed union; the RUNTIME must refuse too.
      sealCredential(k, { ...SCOPE, provider: "xero" }, PLAINTEXT),
    ).rejects.toThrow(/provider/i);
    await expect(sealCredential(k, { ...SCOPE, tenantId: "  " }, PLAINTEXT)).rejects.toThrow(
      /tenantId/i,
    );
    await expect(sealCredential(k, { ...SCOPE, connectionId: "" }, PLAINTEXT)).rejects.toThrow(
      /connectionId/i,
    );
    await expect(
      // @ts-expect-error — closed union; the RUNTIME must refuse too.
      sealCredential(k, { ...SCOPE, environment: "staging" }, PLAINTEXT),
    ).rejects.toThrow(/environment/i);
  });
});

describe("copy-resistance — ciphertext is worthless outside the exact tuple it was sealed for", () => {
  // ONE case per AAD component. A combined "wrong scope" test would stay green with a component
  // silently dropped from the AAD, which is exactly the bug worth catching.
  const swaps: ReadonlyArray<readonly [string, CredentialScope]> = [
    ["another tenant", { ...SCOPE, tenantId: "j57tenantbbb" }],
    ["another provider", { ...SCOPE, provider: "stripe" }],
    ["another connection on the same tenant", { ...SCOPE, connectionId: "conn_0002" }],
    ["the sandbox environment", { ...SCOPE, environment: "sandbox" }],
  ];

  for (const [name, wrong] of swaps) {
    test(`refuses to open under ${name}`, async () => {
      const { v1: k } = await keys();
      const env = await sealCredential(k, SCOPE, PLAINTEXT);
      await expect(openCredential(k, wrong, env)).rejects.toThrow(/authentication/i);
    });
  }

  test("refuses a different key of the same version", async () => {
    const { v1: k, v1Other: other } = await keys();
    const env = await sealCredential(k, SCOPE, PLAINTEXT);
    await expect(openCredential(other, SCOPE, env)).rejects.toThrow(/authentication/i);
  });

  test("refuses a tampered ciphertext (GCM authenticates, it does not just decrypt)", async () => {
    const { v1: k } = await keys();
    const env = await sealCredential(k, SCOPE, PLAINTEXT);
    const flipped = env.ciphertextB64.startsWith("A") ? "B" : "A";
    const tampered = { ...env, ciphertextB64: flipped + env.ciphertextB64.slice(1) };
    await expect(openCredential(k, SCOPE, tampered)).rejects.toThrow(/authentication/i);
  });

  test("refuses a tampered IV", async () => {
    const { v1: k } = await keys();
    const env = await sealCredential(k, SCOPE, PLAINTEXT);
    const other = await sealCredential(k, SCOPE, PLAINTEXT);
    await expect(openCredential(k, SCOPE, { ...env, ivB64: other.ivB64 })).rejects.toThrow(
      /authentication/i,
    );
  });

  test("refuses a relabelled algorithm rather than trusting the label", async () => {
    const { v1: k } = await keys();
    const env = await sealCredential(k, SCOPE, PLAINTEXT);
    await expect(
      // @ts-expect-error — the field is a literal; a stored row could still carry junk.
      openCredential(k, SCOPE, { ...env, algorithm: "AES-128-GCM" }),
    ).rejects.toThrow(/algorithm/i);
  });

  test("refuses malformed base64 in either field, with no plaintext in the message", async () => {
    const { v1: k } = await keys();
    const env = await sealCredential(k, SCOPE, PLAINTEXT);
    for (const bad of [
      { ...env, ciphertextB64: "!!!not base64!!!" },
      { ...env, ivB64: "%%%%" },
      { ...env, ciphertextB64: "abc" }, // length not a multiple of 4
    ]) {
      const failure = await openCredential(k, SCOPE, bad).then(
        () => new Error("opened a malformed envelope"),
        (e: unknown) => e as Error,
      );
      expect(failure.message).toMatch(/malformed|base64/i);
      expect(failure.message).not.toContain("accessTOKEN");
    }
  });

  test("refuses an IV that is not 96 bits", async () => {
    const { v1: k } = await keys();
    const env = await sealCredential(k, SCOPE, PLAINTEXT);
    await expect(openCredential(k, SCOPE, { ...env, ivB64: btoa("shortIV!") })).rejects.toThrow(
      /malformed|iv/i,
    );
  });
});

describe("rotation — open with the old version, reseal with the new", () => {
  test("a v1 envelope opens with v1, reseals to v2, and v1 can no longer open it", async () => {
    const { v1: oldKey, v2: newKey } = await keys();
    const sealedV1 = await sealCredential(oldKey, SCOPE, PLAINTEXT);
    expect(sealedV1.keyVersion).toBe("v1");

    // The whole migration, in the two lines an operator's script runs.
    const plaintext = await openCredential(oldKey, SCOPE, sealedV1);
    const sealedV2 = await sealCredential(newKey, SCOPE, plaintext);

    expect(sealedV2.keyVersion).toBe("v2");
    expect(await openCredential(newKey, SCOPE, sealedV2)).toBe(PLAINTEXT);
    await expect(openCredential(oldKey, SCOPE, sealedV2)).rejects.toThrow(/key version/i);
  });

  test("the key version is BOUND, so a stored row cannot be relabelled to reach another key", async () => {
    const { v1: oldKey, v2: newKey } = await keys();
    const sealedV1 = await sealCredential(oldKey, SCOPE, PLAINTEXT);
    // Relabel the row v2 and hand it the v2 key: the version is inside the AAD, so this fails
    // authentication rather than quietly decrypting under a key it was never sealed with.
    await expect(openCredential(newKey, SCOPE, { ...sealedV1, keyVersion: "v2" })).rejects.toThrow(
      /authentication/i,
    );
  });

  test("mid-rotation, a v1 row is still readable while new rows are sealed v2", async () => {
    const { v1: oldKey, v2: newKey } = await keys();
    const legacy = await sealCredential(oldKey, SCOPE, PLAINTEXT);
    const fresh = await sealCredential(newKey, { ...SCOPE, connectionId: "conn_0003" }, PLAINTEXT);
    expect(await openCredential(oldKey, SCOPE, legacy)).toBe(PLAINTEXT);
    expect(await openCredential(newKey, { ...SCOPE, connectionId: "conn_0003" }, fresh)).toBe(
      PLAINTEXT,
    );
  });
});
