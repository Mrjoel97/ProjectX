/** Direct provider contracts. Consent proves identity access, never publishing eligibility. */
export const SOCIAL_PROVIDERS = ["x", "meta", "tiktok", "youtube"] as const;
export type SocialProvider = (typeof SOCIAL_PROVIDERS)[number];
export const isSocialProvider = (value: string): value is SocialProvider =>
  (SOCIAL_PROVIDERS as readonly string[]).includes(value);
export const SOCIAL_LABELS: Record<SocialProvider, string> = {
  x: "X",
  meta: "Meta",
  tiktok: "TikTok",
  youtube: "YouTube",
};
export const SOCIAL_SCOPES: Record<SocialProvider, readonly string[]> = {
  x: ["tweet.read", "users.read", "offline.access"],
  meta: ["public_profile", "pages_show_list", "pages_read_engagement", "instagram_basic"],
  tiktok: ["user.info.basic"],
  youtube: ["https://www.googleapis.com/auth/youtube.readonly"],
};
export const SOCIAL_AUTH_ORIGINS = [
  "https://x.com",
  "https://www.facebook.com",
  "https://www.tiktok.com",
  "https://accounts.google.com",
];
export function socialAuthorizationUrl(
  provider: SocialProvider,
  input: {
    clientId: string;
    redirectUri: string;
    state: string;
    challenge: string;
    metaVersion?: string;
    metaConfigId?: string;
    scopes?: readonly string[];
  },
): string {
  const { clientId, redirectUri, state, challenge } = input;
  if (
    provider === "meta" &&
    input.metaConfigId !== undefined &&
    !/^\d{1,32}$/.test(input.metaConfigId)
  )
    throw new Error("SOCIAL_NOT_CONFIGURED");
  const url = new URL(
    provider === "x"
      ? "https://x.com/i/oauth2/authorize"
      : provider === "tiktok"
        ? "https://www.tiktok.com/v2/auth/authorize/"
        : provider === "youtube"
          ? "https://accounts.google.com/o/oauth2/v2/auth"
          : "https://www.facebook.com/" + validMetaVersion(input.metaVersion) + "/dialog/oauth",
  );
  url.search = new URLSearchParams({
    [provider === "tiktok" ? "client_key" : "client_id"]: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    state,
    ...(provider === "meta" && input.metaConfigId
      ? { config_id: input.metaConfigId, override_default_response_type: "true" }
      : {
          scope: (input.scopes ?? SOCIAL_SCOPES[provider]).join(
            provider === "meta" || provider === "tiktok" ? "," : " ",
          ),
        }),
    ...(provider === "x" || provider === "youtube"
      ? { code_challenge: challenge, code_challenge_method: "S256" }
      : {}),
    ...(provider === "youtube" ? { access_type: "offline", prompt: "consent" } : {}),
  }).toString();
  return url.toString();
}
export function validMetaVersion(version?: string): string {
  if (!version || !/^v[1-9][0-9]\.0$/.test(version)) throw new Error("SOCIAL_NOT_CONFIGURED");
  return version;
}
export function socialRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("SOCIAL_INVALID_RESPONSE");
  return value as Record<string, unknown>;
}
export function socialString(value: unknown, cap = 256): string {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.length > cap ||
    // biome-ignore lint/suspicious/noControlCharactersInRegex: Reject provider control characters at the trust boundary.
    /[\u0000-\u001f]/.test(value)
  )
    throw new Error("SOCIAL_INVALID_RESPONSE");
  return value;
}
export function socialExpiry(value: unknown, now = Date.now()): number {
  const seconds = typeof value === "string" && /^\d+$/.test(value) ? Number(value) : value;
  if (
    typeof seconds !== "number" ||
    !Number.isFinite(seconds) ||
    seconds <= 0 ||
    seconds > 366 * 86400
  )
    throw new Error("SOCIAL_INVALID_RESPONSE");
  return now + seconds * 1000;
}
export async function socialHash(value: string): Promise<string> {
  return Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode("social:" + value)),
    ),
    (b) => b.toString(16).padStart(2, "0"),
  ).join("");
}
export function socialNonce(): string {
  return btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}
export async function socialChallenge(verifier: string): Promise<string> {
  return btoa(
    String.fromCharCode(
      ...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))),
    ),
  )
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}
const TIKTOK_ERROR_CODES = [
  "invalid_param",
  "access_token_invalid",
  "scope_not_authorized",
  "rate_limit_exceeded",
  "url_ownership_unverified",
  "privacy_level_option_mismatch",
  "reached_active_user_cap",
  "spam_risk_too_many_posts",
  "spam_risk_user_banned_from_posting",
  "unaudited_client_can_only_post_to_private_accounts",
  "internal_error",
] as const;
const META_ERROR_CODES = [1, 2, 4, 10, 17, 24, 32, 100, 102, 190, 200, 368, 613, 3600, 9004, 9007];
const META_ERROR_SUBCODES = [
  33, 458, 459, 460, 463, 464, 467, 492, 2207001, 2207004, 2207008, 2207020, 2207023, 2207027,
  2207052, 2207053, 2207076, 2207082,
];
export type SocialFailureDiagnostic = {
  code:
    | "provider_error"
    | "transport_error"
    | "invalid_response"
    | "internal_failure"
    | (typeof TIKTOK_ERROR_CODES)[number];
  httpStatus?: number;
  providerCode?: number;
  providerSubcode?: number;
};
/** No provider prose, trace ids, URLs or arbitrary error properties may cross this boundary. */
export function socialProviderFailure(
  provider: SocialProvider,
  httpStatus: number,
  value: unknown,
): SocialFailureDiagnostic {
  const result: SocialFailureDiagnostic = { code: "provider_error" };
  if (Number.isInteger(httpStatus) && httpStatus >= 100 && httpStatus <= 599)
    result.httpStatus = httpStatus;
  if (!value || typeof value !== "object" || !("error" in value)) return result;
  const error = value.error;
  if (!error || typeof error !== "object") return result;
  const code = "code" in error ? error.code : undefined;
  if (provider === "tiktok" && TIKTOK_ERROR_CODES.some((known) => known === code))
    result.code = code as (typeof TIKTOK_ERROR_CODES)[number];
  if (provider === "meta") {
    if (typeof code === "number" && META_ERROR_CODES.includes(code)) result.providerCode = code;
    const subcode = "error_subcode" in error ? error.error_subcode : undefined;
    if (typeof subcode === "number" && META_ERROR_SUBCODES.includes(subcode))
      result.providerSubcode = subcode;
  }
  return result;
}
class SocialRequestError extends Error {
  constructor(
    message: "SOCIAL_PROVIDER_UNAVAILABLE" | "SOCIAL_INVALID_RESPONSE",
    readonly diagnostic: Readonly<SocialFailureDiagnostic>,
  ) {
    super(message);
    Object.freeze(diagnostic);
  }
}
export function socialFailureDiagnostic(error: unknown): Readonly<SocialFailureDiagnostic> {
  return error instanceof SocialRequestError ? error.diagnostic : { code: "internal_failure" };
}
/** Fixed-origin transport; no redirects or provider text in errors. */
export async function socialJson(
  url: string,
  init: RequestInit = {},
): Promise<Record<string, unknown>> {
  const target = new URL(url);
  if (
    ![
      "https://api.x.com",
      "https://graph.facebook.com",
      "https://open.tiktokapis.com",
      "https://oauth2.googleapis.com",
      "https://www.googleapis.com",
    ].includes(target.origin)
  )
    throw new Error("SOCIAL_INVALID_ENDPOINT");
  let response: Response;
  try {
    response = await fetch(target, {
      ...init,
      redirect: "error",
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    throw new SocialRequestError("SOCIAL_PROVIDER_UNAVAILABLE", { code: "transport_error" });
  }
  const provider =
    target.origin === "https://graph.facebook.com"
      ? "meta"
      : target.origin === "https://open.tiktokapis.com"
        ? "tiktok"
        : target.origin === "https://api.x.com"
          ? "x"
          : "youtube";
  const failure = (value?: unknown) =>
    new SocialRequestError(
      "SOCIAL_PROVIDER_UNAVAILABLE",
      socialProviderFailure(provider, response.status, value),
    );
  const invalid = () =>
    new SocialRequestError("SOCIAL_INVALID_RESPONSE", {
      code: "invalid_response",
      httpStatus: response.status,
    });
  if (!response.body) throw failure();
  const reader = response.body.getReader();
  const parts: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > 262144) {
        await reader.cancel();
        throw invalid();
      }
      parts.push(part.value);
    }
  } catch (error) {
    if (error instanceof SocialRequestError) throw error;
    throw new SocialRequestError("SOCIAL_PROVIDER_UNAVAILABLE", {
      code: "transport_error",
      httpStatus: response.status,
    });
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) {
    bytes.set(part, offset);
    offset += part.length;
  }
  let result: Record<string, unknown>;
  try {
    result = socialRecord(JSON.parse(new TextDecoder().decode(bytes)));
  } catch {
    if (!response.ok) throw failure();
    throw invalid();
  }
  if (!response.ok) throw failure(result);
  // TikTok can report a rejection in an HTTP 200 envelope; other successful shapes remain valid.
  const error = result.error;
  if (
    provider === "tiktok" &&
    error &&
    typeof error === "object" &&
    "code" in error &&
    typeof error.code === "string" &&
    error.code !== "ok"
  )
    throw failure(result);
  if (provider === "meta" && error && typeof error === "object" && "code" in error)
    throw failure(result);
  return result;
}

/** Strict USER debug_token metadata; never invent a lifetime for an unbounded token. */
export function socialMetaTokenExpiry(
  value: unknown,
  expectedAppId: string,
  expectedUserId: string,
  now = Date.now(),
): number {
  const data = socialRecord(value);
  const fail = () => new Error("SOCIAL_TOKEN_EXPIRY_UNAVAILABLE");
  if (
    !expectedAppId ||
    !expectedUserId ||
    data.is_valid !== true ||
    data.type !== "USER" ||
    data.app_id !== expectedAppId ||
    data.user_id !== expectedUserId ||
    !Number.isSafeInteger(now) ||
    now < 0
  )
    throw fail();
  function timestamp(value: unknown): number {
    if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) throw fail();
    return value;
  }
  const bounds = [
    timestamp(data.expires_at),
    timestamp(data.data_access_expires_at === undefined ? 0 : data.data_access_expires_at),
  ].filter((value) => value > 0);
  const expiresAt = Math.min(...bounds) * 1000;
  if (!Number.isSafeInteger(expiresAt) || expiresAt <= now || expiresAt - now > 366 * 86400000)
    throw fail();
  return expiresAt;
}
