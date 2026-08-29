/**
 * The connector credential envelope and the connection-lifecycle vocabulary.
 *
 * Convex-free (CLAUDE.md §1): this module holds no `ctx`, reads no env var and knows no table.
 * `packages/backend/convex/connectorCredentials.ts` is the thin adapter that supplies the key from
 * Convex environment configuration and persists what comes back.
 *
 * NO CIPHER IS IMPLEMENTED HERE. This is Web Crypto AES-256-GCM with a fresh random 96-bit IV per
 * seal — the platform primitive (CLAUDE.md §8 rung 4). What this file adds is the part a primitive
 * cannot know: WHAT the ciphertext is bound to.
 *
 * The binding is the whole point. Additional authenticated data covers
 * `keyVersion | environment | tenantId | provider | connectionId`, so ciphertext lifted out of one
 * row and dropped into another fails authentication instead of decrypting. In a product that holds
 * four tenants' accounting and payment credentials, "the row said it was tenant B's" must not be a
 * sentence anything can act on.
 *
 * ONE sealed blob, not one field per token. `sealCredential` takes a string, and the adapter seals
 * a JSON object carrying access token, refresh token, granted scope and the provider account id
 * together. That is what makes QuickBooks' rolling refresh survivable: replacing both tokens is a
 * single-field patch inside one Convex transaction, so there is no window in which a row holds a
 * new access token beside a dead refresh token. It also keeps the scope string — a capability
 * inventory — and the external account id out of the clear, which `gmailAuth.gmailStatus` already
 * treats as a rule for the Google grant.
 */
import { isProvider, type Provider } from "./contracts";

// ── Environments and key versions ─────────────────────────────────────────────────────────

/** A provider sandbox is a DIFFERENT grant from production and must never open the other's row. */
export const CONNECTOR_ENVIRONMENTS = ["sandbox", "production"] as const;
export type ConnectorEnvironment = (typeof CONNECTOR_ENVIRONMENTS)[number];
export const isConnectorEnvironment = (v: unknown): v is ConnectorEnvironment =>
  typeof v === "string" && (CONNECTOR_ENVIRONMENTS as readonly string[]).includes(v);

/**
 * `v2` is DECLARED AHEAD OF USE, deliberately. Rotation is the one credential operation that must
 * work under pressure (a leaked key), and discovering mid-incident that the new version needs a
 * schema edit and a deploy is how a rotation becomes an outage. Nothing seals `v2` today.
 */
export const CREDENTIAL_KEY_VERSIONS = ["v1", "v2"] as const;
export type CredentialKeyVersion = (typeof CREDENTIAL_KEY_VERSIONS)[number];
export const isCredentialKeyVersion = (v: unknown): v is CredentialKeyVersion =>
  typeof v === "string" && (CREDENTIAL_KEY_VERSIONS as readonly string[]).includes(v);

// ── Connection lifecycle vocabulary ───────────────────────────────────────────────────────

/**
 * Where a connection stands. `revoked` says only that PIKAR stopped using the grant — what
 * happened upstream is a separate, honest question answered by `RevocationUpstream` below.
 */
export const CONNECTION_STATUSES = [
  "connecting",
  "connected",
  "reauth_required",
  "revoked",
  "failed",
] as const;
export type ConnectionStatus = (typeof CONNECTION_STATUSES)[number];

/**
 * WHAT PIKAR ACTUALLY KNOWS ABOUT THE GRANT UPSTREAM — and the reason this is not a boolean.
 *
 * As of the 2026-08-27 admission decisions, three of the four providers cannot be revoked
 * server-side with any confidence: Stripe Apps has no documented platform-initiated revoke (an
 * explicit owner override, condition still open), PayPal documents no revoke endpoint at all, and
 * HubSpot's revoke is unproven against already-issued ACCESS tokens (its legacy endpoint
 * explicitly did not cascade). Only QuickBooks has a confirmed revocation endpoint.
 *
 * A `revoked: true` flag would collapse "we deleted our copy" into "the grant is dead" and the
 * product would then tell a user their PayPal access is revoked when nothing upstream changed.
 * These four values keep the two facts apart, and `connectorConnections.revocation` stores the one
 * that actually happened:
 *
 *   • `confirmed`        — the provider's revoke endpoint accepted it. The grant is gone.
 *   • `attempted_failed` — Pikar called it and got a network error / 5xx. END STATE UNKNOWN; retry.
 *   • `unsupported`      — the provider documents no revocation call Pikar can make. Local deletion
 *                          is the ONLY thing that happened. Say so in the UI.
 *   • `not_attempted`    — nothing was called (an internal cleanup, an erasure sweep).
 */
export const REVOCATION_UPSTREAM_STATES = [
  "confirmed",
  "attempted_failed",
  "unsupported",
  "not_attempted",
] as const;
export type RevocationUpstream = (typeof REVOCATION_UPSTREAM_STATES)[number];

/**
 * Why the last provider read failed, as a CLOSED set. A provider error message is vendor text and
 * may embed identifiers, so it never reaches a stored row (CLAUDE.md §4) — this class does.
 * Mirrors the `unavailableReason` vocabulary in 28-RESEARCH's normalized read models.
 */
export const CONNECTION_FAILURE_CLASSES = [
  "reauth",
  "forbidden",
  "rate_limited",
  "provider_error",
  "unsupported_account",
  "network",
  "timeout",
] as const;
export type ConnectionFailureClass = (typeof CONNECTION_FAILURE_CLASSES)[number];

// ── The envelope ──────────────────────────────────────────────────────────────────────────

/** The stable tuple ciphertext is bound to. Every field is server-owned; none is user input. */
export type CredentialScope = {
  tenantId: string;
  provider: Provider;
  /** Server-minted, opaque, stable for the life of the row. Not the provider's account id. */
  connectionId: string;
  environment: ConnectorEnvironment;
};

/** What is persisted. Nothing here is readable without the deployment key AND the exact scope. */
export type CredentialEnvelope = {
  ciphertextB64: string;
  /** A FRESH 96-bit IV per seal. Reusing one under the same key breaks GCM outright. */
  ivB64: string;
  keyVersion: CredentialKeyVersion;
  algorithm: "AES-256-GCM";
};

/** An imported deployment key, carrying the version it IS so a caller cannot mismatch the two. */
export type CredentialKey = { readonly key: CryptoKey; readonly version: CredentialKeyVersion };

const IV_BYTES = 12; // 96 bits — the GCM nominal, and the only length WebCrypto is fast on.
const KEY_BYTES = 32; // AES-256.
const STRICT_B64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

/**
 * `atob` accepts sloppy input in some runtimes and throws in others, so the shape is checked BEFORE
 * decoding. A stored row that is not strict base64 is corrupt, and corrupt must be loud.
 */
function decodeB64(value: string, field: string): Uint8Array<ArrayBuffer> {
  if (typeof value !== "string" || value === "" || !STRICT_B64.test(value)) {
    throw new Error(`Credential envelope is malformed: ${field} is not base64.`);
  }
  let binary: string;
  try {
    binary = atob(value);
  } catch {
    throw new Error(`Credential envelope is malformed: ${field} is not base64.`);
  }
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function encodeB64(bytes: Uint8Array<ArrayBuffer>): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

/**
 * The additional authenticated data.
 *
 * A JSON array, not a delimiter-joined string: `tenant|a` + `b` and `tenant` + `a|b` join to the
 * same bytes, and an ambiguous AAD is an AAD that can be forged. JSON escapes its own separators,
 * so the encoding is injective. Order is fixed and must never be reordered — that would silently
 * invalidate every row at rest.
 */
function aad(scope: CredentialScope, keyVersion: CredentialKeyVersion): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(
    JSON.stringify([
      keyVersion,
      scope.environment,
      scope.tenantId,
      scope.provider,
      scope.connectionId,
    ]),
  );
}

function assertScope(scope: CredentialScope): void {
  if (!isProvider(scope.provider)) throw new Error("Credential scope has an unknown provider.");
  if (!isConnectorEnvironment(scope.environment)) {
    throw new Error("Credential scope has an unknown environment.");
  }
  for (const field of ["tenantId", "connectionId"] as const) {
    const value = scope[field];
    if (typeof value !== "string" || value.trim() === "") {
      throw new Error(`Credential scope needs a ${field}.`);
    }
  }
}

/**
 * Import the deployment key. FAILS CLOSED on anything that is not exactly 32 decoded bytes — a
 * short key would silently become AES-128 or throw deep inside `subtle.importKey` with a message
 * an operator cannot act on.
 *
 * The caller reads the base64 from Convex environment configuration
 * (`CONNECTOR_CREDENTIAL_KEY_V1`). It is never logged, never returned to a client, and never
 * placed in an error message — including the ones below.
 */
export async function importCredentialKey(
  base64Key: string,
  version: CredentialKeyVersion,
): Promise<CredentialKey> {
  if (!isCredentialKeyVersion(version)) {
    throw new Error("Unknown credential key version.");
  }
  const bytes = decodeB64(base64Key, "key");
  if (bytes.length !== KEY_BYTES) {
    throw new Error(`Credential key must be exactly 32 bytes, got ${bytes.length}.`);
  }
  const key = await crypto.subtle.importKey("raw", bytes, { name: "AES-GCM" }, false, [
    "encrypt",
    "decrypt",
  ]);
  return { key, version };
}

/** Seal a credential blob for exactly one tenant/provider/connection/environment. */
export async function sealCredential(
  credentialKey: CredentialKey,
  scope: CredentialScope,
  plaintext: string,
): Promise<CredentialEnvelope> {
  assertScope(scope);
  if (typeof plaintext !== "string" || plaintext === "") {
    throw new Error("Refusing to seal an empty credential.");
  }
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: aad(scope, credentialKey.version) },
    credentialKey.key,
    new TextEncoder().encode(plaintext),
  );
  return {
    ciphertextB64: encodeB64(new Uint8Array(ciphertext)),
    ivB64: encodeB64(iv),
    keyVersion: credentialKey.version,
    algorithm: "AES-256-GCM",
  };
}

/**
 * Open a sealed credential. Throws on ANY mismatch — wrong tenant, wrong provider, wrong
 * connection, wrong environment, wrong key, wrong key version, tampered bytes.
 *
 * No error here names the plaintext, the key, or which AAD component disagreed: a decryption
 * oracle that reports *why* it failed is a decryption oracle.
 */
export async function openCredential(
  credentialKey: CredentialKey,
  scope: CredentialScope,
  envelope: CredentialEnvelope,
): Promise<string> {
  assertScope(scope);
  if (envelope?.algorithm !== "AES-256-GCM") {
    throw new Error("Credential envelope has an unsupported algorithm.");
  }
  if (!isCredentialKeyVersion(envelope.keyVersion)) {
    throw new Error("Credential envelope has an unknown key version.");
  }
  if (envelope.keyVersion !== credentialKey.version) {
    throw new Error(
      `Credential envelope key version ${envelope.keyVersion} does not match the supplied key.`,
    );
  }
  const iv = decodeB64(envelope.ivB64, "iv");
  if (iv.length !== IV_BYTES) {
    throw new Error("Credential envelope is malformed: iv is not 96 bits.");
  }
  const ciphertext = decodeB64(envelope.ciphertextB64, "ciphertext");
  let plain: ArrayBuffer;
  try {
    plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv, additionalData: aad(scope, envelope.keyVersion) },
      credentialKey.key,
      ciphertext,
    );
  } catch {
    throw new Error("Credential envelope failed authentication.");
  }
  return new TextDecoder().decode(plain);
}
