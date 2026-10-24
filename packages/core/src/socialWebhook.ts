/** Provider signatures always cover the original bytes, before parsing JSON. */
export async function socialHmac(
  secret: string,
  body: string,
  algorithm: "SHA-256" | "SHA-1" = "SHA-256",
  base64 = false,
): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: algorithm },
    false,
    ["sign"],
  );
  const bytes = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body)),
  );
  return base64
    ? btoa(String.fromCharCode(...bytes))
    : Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}
export function equalSignature(actual: string, expected: string): boolean {
  if (actual.length !== expected.length) return false;
  let difference = 0;
  for (let i = 0; i < actual.length; i++)
    difference |= actual.charCodeAt(i) ^ expected.charCodeAt(i);
  return difference === 0;
}
export async function verifySocialWebhook(
  provider: "x" | "meta" | "tiktok" | "youtube",
  secret: string,
  body: string,
  header: string,
  now = Date.now(),
): Promise<boolean> {
  if (!secret || header.length > 512) return false;
  if (provider === "tiktok") {
    const match = /^t=(\d{1,12}),s=([a-f0-9]{64})$/.exec(header);
    if (!match || Math.abs(now / 1000 - Number(match[1])) > 300) return false;
    return equalSignature(match[2]!, await socialHmac(secret, match[1] + "." + body));
  }
  const algorithm = provider === "youtube" && header.startsWith("sha1=") ? "SHA-1" : "SHA-256";
  const prefix = algorithm === "SHA-1" ? "sha1=" : "sha256=";
  return equalSignature(
    header,
    prefix + (await socialHmac(secret, body, algorithm, provider === "x")),
  );
}
export async function boundedSocialBody(request: Request): Promise<string> {
  if (!request.body) throw new Error("INVALID_WEBHOOK");
  const reader = request.body.getReader(),
    decoder = new TextDecoder("utf-8", { fatal: true });
  let bytes = 0,
    body = "";
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      bytes += part.value.byteLength;
      if (bytes > 262144) {
        await reader.cancel();
        throw new Error("WEBHOOK_TOO_LARGE");
      }
      body += decoder.decode(part.value, { stream: true });
    }
    body += decoder.decode();
  } finally {
    reader.releaseLock();
  }
  return body;
}
