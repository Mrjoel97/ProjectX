import { inspectWebAssetBytes } from "@pikar/core/webAssets";
import { sha256Bytes } from "@pikar/core/webRuntime";

/** Server-only comparison adapter. This is not an agent tool or a renderer/import path.
 * Protocol/shape references: google-labs-code/stitch-sdk packages/sdk/{src/client.ts,
 * generated/src/project.ts,generated/src/responses.generated.ts}; MCP 2025-06-18 transports.
 * ponytail: only the three required tools, no SDK/catalogue dependency or automatic retry. */
export const STITCH_MCP_ENDPOINT = "https://stitch.googleapis.com/mcp";
export const STITCH_DESIGN_CLIENT_VERSION = "stitch-design-evidence-v1";
const PROTOCOL = "2025-06-18";
const TOOLS = ["create_project", "generate_screen_from_text", "get_screen"] as const;
const MAX_RPC_BYTES = 2 * 1024 * 1024;
const MAX_HTML_BYTES = 2 * 1024 * 1024;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const ARTIFACT_HOSTS = new Set([
  "lh3.googleusercontent.com",
  "contribution.usercontent.google.com",
  "storage.googleapis.com",
]);
export type StitchOperation =
  | "initialize"
  | "initialized"
  | "tools_list"
  | (typeof TOOLS)[number]
  | "download_html"
  | "download_screenshot";
export type StitchDesignRequest = {
  /** Supplied by the owned server context, never forwarded as provider project IDs. */
  scope: { tenantId: string; planId: string; briefHash: string; runRef: string };
  /** Frozen synthetic/public facts only in the pilot; authorize must verify this exact prompt. */
  prompt: string;
  deviceType: "DESKTOP" | "MOBILE" | "TABLET";
};
export type StitchAttempt = {
  provider: "stitch";
  operation: StitchOperation;
  scopeHash: string;
  requestHash: string;
  potentiallyGenerative: boolean;
};
export type StitchDesignServices = {
  /** Must validate actual owned scope, frozen prompt and a fresh durable one-use attempt. */
  authorize(request: Readonly<StitchDesignRequest>, promptHash: string): Promise<void>;
  beforeAttempt(attempt: StitchAttempt): Promise<{ reservationRef: string }>;
  /** No billing amount is invented: the documented Stitch responses report no actual cost. */
  afterAttempt(
    attempt: StitchAttempt & {
      reservationRef: string;
      outcome: "complete" | "refused" | "unknown";
      costStatus: "not_reported";
    },
  ): Promise<void>;
  /** Persist returned identity before a subsequent generation/download. Must be tenant scoped. */
  checkpoint(value: { scopeHash: string; projectName: string; screenName?: string }): Promise<void>;
  fetcher?: typeof fetch;
  /** Server/test configuration only, cannot increase the fixed maximum. */
  requestTimeoutMs?: number;
};
export type StitchDesignEvidence = {
  provider: "stitch";
  clientVersion: typeof STITCH_DESIGN_CLIENT_VERSION;
  scopeHash: string;
  promptHash: string;
  projectName?: string;
  screenName?: string;
  providerGeneration: "not_started" | "attempted" | "completed";
  costStatus: "not_reported";
  requestHashes: string[];
  designEvidenceOnly: true;
  rendererImportPerformed: false;
};
export type StitchDesignResult =
  | {
      status: "complete";
      evidence: StitchDesignEvidence;
      html: { text: string; byteLength: number; contentHash: string; trustedExecutable: false };
      screenshot: {
        bytes: Uint8Array;
        mimeType: "image/png" | "image/jpeg" | "image/webp";
        width: number;
        height: number;
        byteLength: number;
        contentHash: string;
      };
    }
  | {
      status: "failed" | "unknown";
      reason: string;
      evidence: StitchDesignEvidence;
      reconciliationRequired: boolean;
    };

const record = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
const digest = (value: string) => `sha256:${sha256Bytes(new TextEncoder().encode(value))}`;
const opaque = (value: unknown, max = 128): value is string =>
  typeof value === "string" && /^[A-Za-z0-9_-]+$/.test(value) && value.length <= max;
class BoundaryError extends Error {
  constructor(
    readonly code: string,
    readonly uncertain = false,
  ) {
    super(code);
  }
}
// Convex/edge server isolates can expose window without a DOM. A DOM browser is refused.
const serverRuntime = () =>
  typeof document === "undefined" &&
  typeof process !== "undefined" &&
  typeof process.env === "object";
export function stitchConfigurationSummary() {
  return {
    provider: "stitch" as const,
    configured: serverRuntime() && !!process.env.STITCH_API_KEY?.trim(),
    requiredKeyNames: ["STITCH_API_KEY"] as const,
    tools: TOOLS,
    requiresBudgetAdmission: true,
    clientVersion: STITCH_DESIGN_CLIENT_VERSION,
  };
}
function validRequest(value: StitchDesignRequest): boolean {
  const row = record(value),
    scope = record(row?.scope);
  return (
    !!row &&
    !!scope &&
    Object.keys(row).every((key) => ["scope", "prompt", "deviceType"].includes(key)) &&
    Object.keys(scope).sort().join() === "briefHash,planId,runRef,tenantId" &&
    [scope.tenantId, scope.planId, scope.runRef].every((ref) => opaque(ref)) &&
    typeof scope.briefHash === "string" &&
    /^(?:sha256:)?[a-f0-9]{64}$/.test(scope.briefHash) &&
    typeof row.prompt === "string" &&
    row.prompt.trim().length > 0 &&
    new TextEncoder().encode(row.prompt).byteLength <= 24000 &&
    !/[\u0000\u000b\u000c]/.test(row.prompt) &&
    ["DESKTOP", "MOBILE", "TABLET"].includes(String(row.deviceType))
  );
}
function artifactUrl(value: unknown): string {
  if (typeof value !== "string" || value.length > 8192 || /[\u0000-\u0020\u007f\\]/.test(value))
    throw new BoundaryError("STITCH_ARTIFACT_URL_REFUSED");
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new BoundaryError("STITCH_ARTIFACT_URL_REFUSED");
  }
  if (
    url.protocol !== "https:" ||
    !ARTIFACT_HOSTS.has(url.hostname) ||
    url.port ||
    url.username ||
    url.password ||
    url.hash
  )
    throw new BoundaryError("STITCH_ARTIFACT_URL_REFUSED");
  return url.href;
}
function resource(value: unknown, project?: string): string {
  if (
    typeof value !== "string" ||
    !(
      project
        ? new RegExp(`^projects/${project}/screens/[A-Za-z0-9_-]{1,96}$`)
        : /^projects\/[A-Za-z0-9_-]{1,96}$/
    ).test(value)
  )
    throw new BoundaryError("STITCH_RESOURCE_IDENTITY_INVALID", true);
  return value;
}
async function bytes(response: Response, limit: number, signal: AbortSignal): Promise<Uint8Array> {
  const length = response.headers.get("Content-Length");
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > limit))
    throw new BoundaryError("STITCH_RESPONSE_TOO_LARGE");
  const reader = response.body?.getReader();
  if (!reader) throw new BoundaryError("STITCH_RESPONSE_INVALID");
  const cancel = () => {
    void reader.cancel().catch(() => {});
  };
  signal.addEventListener("abort", cancel, { once: true });
  const chunks: Uint8Array[] = [];
  let count = 0;
  try {
    for (;;) {
      if (signal.aborted) throw new BoundaryError("STITCH_TIMEOUT", true);
      const next = await reader.read();
      if (next.done) break;
      count += next.value.byteLength;
      if (count > limit) throw new BoundaryError("STITCH_RESPONSE_TOO_LARGE");
      chunks.push(next.value);
    }
  } finally {
    signal.removeEventListener("abort", cancel);
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  const output = new Uint8Array(count);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}
const parse = (text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    throw new BoundaryError("STITCH_RESPONSE_INVALID", true);
  }
};
const decode = (value: Uint8Array) => {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(value);
  } catch {
    throw new BoundaryError("STITCH_RESPONSE_INVALID", true);
  }
};
function rpcResult(value: unknown, id: number): unknown {
  const row = record(value);
  if (
    !row ||
    row.jsonrpc !== "2.0" ||
    row.id !== id ||
    Object.hasOwn(row, "result") === Object.hasOwn(row, "error")
  )
    throw new BoundaryError("STITCH_RPC_IDENTITY_INVALID", true);
  if (row.error !== undefined) throw new BoundaryError("STITCH_RPC_REFUSED");
  return row.result;
}
async function rpcBody(response: Response, id: number, signal: AbortSignal): Promise<unknown> {
  const mime = response.headers.get("Content-Type")?.split(";")[0]?.trim().toLowerCase();
  if (mime === "application/json")
    return rpcResult(parse(decode(await bytes(response, MAX_RPC_BYTES, signal))), id);
  if (mime !== "text/event-stream")
    throw new BoundaryError("STITCH_RPC_CONTENT_TYPE_INVALID", true);
  const reader = response.body?.getReader();
  if (!reader) throw new BoundaryError("STITCH_RESPONSE_INVALID", true);
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let pending = "",
    length = 0,
    events = 0;
  const cancel = () => {
    void reader.cancel().catch(() => {});
  };
  signal.addEventListener("abort", cancel, { once: true });
  try {
    for (;;) {
      const next = await reader.read();
      if (signal.aborted) throw new BoundaryError("STITCH_TIMEOUT", true);
      if (next.done) throw new BoundaryError("STITCH_RPC_STREAM_INCOMPLETE", true);
      length += next.value.byteLength;
      if (length > MAX_RPC_BYTES) throw new BoundaryError("STITCH_RESPONSE_TOO_LARGE", true);
      pending += decoder.decode(next.value, { stream: true });
      for (;;) {
        const separator = /\r?\n\r?\n/.exec(pending);
        if (!separator) break;
        const frame = pending.slice(0, separator.index);
        pending = pending.slice(separator.index + separator[0].length);
        const data = frame
          .split(/\r?\n/)
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).replace(/^ /, ""))
          .join("\n");
        if (!data) continue;
        if (++events > 128) throw new BoundaryError("STITCH_RPC_EVENT_BOUND_EXCEEDED", true);
        const message = record(parse(data));
        if (!message || message.jsonrpc !== "2.0")
          throw new BoundaryError("STITCH_RESPONSE_INVALID", true);
        if (Object.hasOwn(message, "id")) return rpcResult(message, id);
        if (typeof message.method !== "string" || !message.method.startsWith("notifications/"))
          throw new BoundaryError("STITCH_RPC_SERVER_REQUEST_UNSUPPORTED", true);
      }
    }
  } finally {
    signal.removeEventListener("abort", cancel);
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
function toolPayload(value: unknown): Record<string, unknown> {
  const result = record(value);
  if (!result) throw new BoundaryError("STITCH_TOOL_RESPONSE_INVALID", true);
  if (result.isError === true) throw new BoundaryError("STITCH_TOOL_REFUSED");
  if (record(result.structuredContent)) return result.structuredContent as Record<string, unknown>;
  const text = Array.isArray(result.content)
    ? result.content
        .map(record)
        .find((item) => item?.type === "text" && typeof item.text === "string")?.text
    : undefined;
  const payload = typeof text === "string" ? record(parse(text)) : null;
  if (!payload) throw new BoundaryError("STITCH_TOOL_RESPONSE_INVALID", true);
  return payload;
}

export type StitchPreflightResult =
  | {
      status: "complete";
      evidence: StitchDesignEvidence;
      compatible: true;
      tools: { name: (typeof TOOLS)[number]; schemaHash: string }[];
      discoveryTruncated: boolean;
      generationPerformed: false;
    }
  | Extract<StitchDesignResult, { status: "failed" | "unknown" }>;
export function generateStitchDesignEvidence(
  request: StitchDesignRequest,
  services: StitchDesignServices,
): Promise<StitchDesignResult> {
  return runStitch(request, services, "generate");
}
/** Read-only protocol/tool discovery. No create_project or generation operation is reachable. */
export function preflightStitchDesign(
  request: StitchDesignRequest,
  services: StitchDesignServices,
): Promise<StitchPreflightResult> {
  return runStitch(request, services, "preflight");
}
async function runStitch(
  request: StitchDesignRequest,
  services: StitchDesignServices,
  mode: "generate",
): Promise<StitchDesignResult>;
async function runStitch(
  request: StitchDesignRequest,
  services: StitchDesignServices,
  mode: "preflight",
): Promise<StitchPreflightResult>;
async function runStitch(
  request: StitchDesignRequest,
  services: StitchDesignServices,
  mode: "generate" | "preflight",
): Promise<StitchDesignResult | StitchPreflightResult> {
  const evidence: StitchDesignEvidence = {
    provider: "stitch",
    clientVersion: STITCH_DESIGN_CLIENT_VERSION,
    scopeHash: "",
    promptHash: "",
    providerGeneration: "not_started",
    costStatus: "not_reported",
    requestHashes: [],
    designEvidenceOnly: true,
    rendererImportPerformed: false,
  };
  try {
    if (
      !serverRuntime() ||
      !validRequest(request) ||
      !services ||
      [services.authorize, services.beforeAttempt, services.afterAttempt, services.checkpoint].some(
        (fn) => typeof fn !== "function",
      )
    )
      throw new BoundaryError("STITCH_ADMISSION_REQUIRED");
    request = Object.freeze({
      scope: Object.freeze({ ...request.scope }),
      prompt: request.prompt,
      deviceType: request.deviceType,
    });
    evidence.scopeHash = digest(JSON.stringify(request.scope));
    evidence.promptHash = digest(request.prompt);
    try {
      await services.authorize(request, evidence.promptHash);
    } catch {
      throw new BoundaryError("STITCH_SCOPE_REFUSED");
    }
    const key = process.env.STITCH_API_KEY;
    if (!key || key.length > 1024 || /[\s\u0000-\u001f]/.test(key))
      throw new BoundaryError("STITCH_CONFIGURATION_REQUIRED");
    const timeout = services.requestTimeoutMs ?? 180000;
    if (!Number.isSafeInteger(timeout) || timeout < 1 || timeout > 180000)
      throw new BoundaryError("STITCH_TIMEOUT_CONFIG_INVALID");
    const fetcher = services.fetcher ?? fetch;
    let session: string | undefined,
      version = PROTOCOL,
      rpcId = 0;
    const deadline = Date.now() + Math.min(240000, timeout * 4);
    async function attempt<T>(
      operation: StitchOperation,
      url: string,
      init: RequestInit,
      read: (response: Response, signal: AbortSignal) => Promise<T>,
    ): Promise<T> {
      const attemptInfo: StitchAttempt = {
        provider: "stitch",
        operation,
        scopeHash: evidence.scopeHash,
        requestHash: digest(JSON.stringify([operation, url, init.body ?? null])),
        potentiallyGenerative:
          operation === "create_project" || operation === "generate_screen_from_text",
      };
      let reservationRef: string;
      try {
        const admitted = await services.beforeAttempt(attemptInfo);
        if (!opaque(admitted.reservationRef, 256)) throw Error();
        reservationRef = admitted.reservationRef;
      } catch {
        throw new BoundaryError("STITCH_BUDGET_ADMISSION_REFUSED");
      }
      evidence.requestHashes.push(attemptInfo.requestHash);
      const controller = new AbortController();
      let timer: ReturnType<typeof setTimeout> | undefined;
      let outcome: "complete" | "refused" | "unknown" = "unknown";
      try {
        const remaining = Math.min(timeout, deadline - Date.now());
        if (remaining <= 0)
          throw new BoundaryError("STITCH_TIMEOUT", attemptInfo.potentiallyGenerative);
        const work = (async () => {
          if (operation === "generate_screen_from_text") evidence.providerGeneration = "attempted";
          const response = await fetcher(url, {
            ...init,
            redirect: "error",
            credentials: "omit",
            referrerPolicy: "no-referrer",
            signal: controller.signal,
          });
          if (response.status === 401 || response.status === 403 || response.status === 429)
            throw new BoundaryError(`STITCH_HTTP_${response.status}`);
          if (!response.ok)
            throw new BoundaryError("STITCH_HTTP_FAILURE", attemptInfo.potentiallyGenerative);
          const value = await read(response, controller.signal);
          outcome = "complete";
          return value;
        })();
        const expires = new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            controller.abort();
            reject(new BoundaryError("STITCH_TIMEOUT", true));
          }, remaining);
        });
        return await Promise.race([work, expires]);
      } catch (error) {
        const failure =
          error instanceof BoundaryError
            ? error
            : new BoundaryError("STITCH_NETWORK_OR_PROTOCOL_FAILURE", true);
        const uncertain =
          failure.uncertain ||
          (attemptInfo.potentiallyGenerative &&
            !/^STITCH_HTTP_(401|403|429)$/.test(failure.code) &&
            failure.code !== "STITCH_RPC_REFUSED");
        outcome = uncertain ? "unknown" : "refused";
        throw new BoundaryError(failure.code, uncertain);
      } finally {
        if (timer !== undefined) clearTimeout(timer);
        try {
          await services.afterAttempt({
            ...attemptInfo,
            reservationRef,
            outcome,
            costStatus: "not_reported",
          });
        } catch {
          throw new BoundaryError("STITCH_BUDGET_RECONCILIATION_REQUIRED", true);
        }
      }
    }
    async function rpc(
      operation: StitchOperation,
      method: string,
      params: Record<string, unknown>,
      notification = false,
    ): Promise<unknown> {
      const id = ++rpcId;
      return attempt(
        operation,
        STITCH_MCP_ENDPOINT,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json, text/event-stream",
            "X-Goog-Api-Key": key!,
            ...(session ? { "Mcp-Session-Id": session } : {}),
            ...(operation !== "initialize" ? { "MCP-Protocol-Version": version } : {}),
          },
          body: JSON.stringify({ jsonrpc: "2.0", ...(notification ? {} : { id }), method, params }),
        },
        async (response, signal) => {
          if (notification) {
            if (response.status !== 202) throw new BoundaryError("STITCH_INITIALIZATION_INVALID");
            await response.body?.cancel();
            return null;
          }
          if (operation === "initialize") {
            const returned = response.headers.get("Mcp-Session-Id");
            if (returned !== null) {
              if (!/^[\x21-\x7e]{1,1024}$/.test(returned))
                throw new BoundaryError("STITCH_SESSION_INVALID");
              session = returned;
            }
          }
          return rpcBody(response, id, signal);
        },
      );
    }
    const initialized = record(
      await rpc("initialize", "initialize", {
        protocolVersion: PROTOCOL,
        capabilities: {},
        clientInfo: { name: "pikar-design-comparison", version: "1.0" },
      }),
    );
    if (
      !initialized ||
      ![PROTOCOL, "2025-03-26", "2025-11-25"].includes(String(initialized.protocolVersion)) ||
      !record(initialized.capabilities)
    )
      throw new BoundaryError("STITCH_PROTOCOL_UNSUPPORTED");
    version = String(initialized.protocolVersion);
    await rpc("initialized", "notifications/initialized", {}, true);
    if (mode === "preflight") {
      const listed = record(await rpc("tools_list", "tools/list", {}));
      if (!listed || !Array.isArray(listed.tools) || listed.tools.length > 64)
        throw new BoundaryError("STITCH_DISCOVERY_INVALID");
      const expectedArgs: Record<(typeof TOOLS)[number], string[]> = {
        create_project: ["title"],
        generate_screen_from_text: ["projectId", "prompt", "deviceType"],
        get_screen: ["name"],
      };
      const catalogue = listed.tools as unknown[];
      const tools = TOOLS.map((name) => {
        const matches = catalogue.filter((item: unknown) => record(item)?.name === name);
        if (matches.length !== 1) throw new BoundaryError("STITCH_REQUIRED_TOOL_UNAVAILABLE");
        const schema = record(record(matches[0])?.inputSchema),
          properties = record(schema?.properties);
        if (
          !schema ||
          schema.type !== "object" ||
          !properties ||
          expectedArgs[name].some((arg) => !record(properties[arg])) ||
          (schema.required !== undefined &&
            (!Array.isArray(schema.required) ||
              schema.required.some(
                (arg: unknown) => typeof arg !== "string" || !expectedArgs[name].includes(arg),
              )))
        )
          throw new BoundaryError("STITCH_TOOL_SCHEMA_INCOMPATIBLE");
        return { name, schemaHash: digest(JSON.stringify(schema)) };
      });
      return {
        status: "complete",
        evidence,
        compatible: true,
        tools,
        discoveryTruncated: typeof listed.nextCursor === "string",
        generationPerformed: false,
      };
    }
    const title = `pikar-compare-${evidence.scopeHash.slice(7, 31)}`;
    const created = toolPayload(
      await rpc("create_project", "tools/call", { name: "create_project", arguments: { title } }),
    );
    evidence.projectName = resource(created.name);
    if (created.title !== title || created.visibility !== "PRIVATE")
      throw new BoundaryError("STITCH_PROJECT_IDENTITY_INVALID", true);
    try {
      await services.checkpoint({
        scopeHash: evidence.scopeHash,
        projectName: evidence.projectName,
      });
    } catch {
      throw new BoundaryError("STITCH_CHECKPOINT_REQUIRED", true);
    }
    const projectId = evidence.projectName.split("/")[1]!;
    const generated = toolPayload(
      await rpc("generate_screen_from_text", "tools/call", {
        name: "generate_screen_from_text",
        arguments: { projectId, prompt: request.prompt, deviceType: request.deviceType },
      }),
    );
    if (generated.projectId !== undefined && generated.projectId !== projectId)
      throw new BoundaryError("STITCH_PROJECT_IDENTITY_INVALID", true);
    const screens = Array.isArray(generated.outputComponents)
      ? generated.outputComponents.flatMap((component) => {
          const design = record(record(component)?.design);
          return Array.isArray(design?.screens) ? design.screens : [];
        })
      : [];
    if (screens.length !== 1) throw new BoundaryError("STITCH_SINGLE_DESIGN_REQUIRED", true);
    const first = record(screens[0]);
    if (!first) throw new BoundaryError("STITCH_TOOL_RESPONSE_INVALID", true);
    if (first.id !== undefined && !opaque(first.id, 96))
      throw new BoundaryError("STITCH_RESOURCE_IDENTITY_INVALID", true);
    evidence.screenName = resource(
      first.name ?? (first.id ? `projects/${projectId}/screens/${first.id}` : undefined),
      projectId,
    );
    if (first.id !== undefined && evidence.screenName.split("/")[3] !== first.id)
      throw new BoundaryError("STITCH_RESOURCE_IDENTITY_INVALID", true);
    evidence.providerGeneration = "completed";
    try {
      await services.checkpoint({
        scopeHash: evidence.scopeHash,
        projectName: evidence.projectName,
        screenName: evidence.screenName,
      });
    } catch {
      throw new BoundaryError("STITCH_CHECKPOINT_REQUIRED", true);
    }
    const screen = toolPayload(
      await rpc("get_screen", "tools/call", {
        name: "get_screen",
        arguments: { name: evidence.screenName },
      }),
    );
    if (
      screen.name !== evidence.screenName ||
      (screen.deviceType !== undefined && screen.deviceType !== request.deviceType)
    )
      throw new BoundaryError("STITCH_SCREEN_IDENTITY_INVALID", true);
    const htmlUrl = artifactUrl(record(screen.htmlCode)?.downloadUrl),
      screenshotUrl = artifactUrl(record(screen.screenshot)?.downloadUrl);
    const htmlBytes = await attempt(
      "download_html",
      htmlUrl,
      { method: "GET", headers: { Accept: "text/html" } },
      async (response, signal) => {
        if (response.headers.get("Content-Type")?.split(";")[0]?.trim() !== "text/html")
          throw new BoundaryError("STITCH_HTML_CONTENT_TYPE_INVALID");
        return bytes(response, MAX_HTML_BYTES, signal);
      },
    );
    const htmlText = decode(htmlBytes);
    if (!htmlText.trim() || htmlText.includes("\u0000"))
      throw new BoundaryError("STITCH_HTML_INVALID");
    const image = await attempt(
      "download_screenshot",
      screenshotUrl,
      { method: "GET", headers: { Accept: "image/png,image/jpeg,image/webp" } },
      async (response, signal) => {
        const data = await bytes(response, MAX_IMAGE_BYTES, signal);
        let raster;
        try {
          raster = inspectWebAssetBytes(
            data,
            response.headers.get("Content-Type")?.split(";")[0]?.trim() ?? "",
          );
        } catch {
          throw new BoundaryError("STITCH_SCREENSHOT_INVALID");
        }
        return { bytes: data, ...raster };
      },
    );
    return {
      status: "complete",
      evidence,
      html: {
        text: htmlText,
        byteLength: htmlBytes.byteLength,
        contentHash: `sha256:${sha256Bytes(htmlBytes)}`,
        trustedExecutable: false,
      },
      screenshot: image,
    };
  } catch (error) {
    const failure =
      error instanceof BoundaryError
        ? error
        : new BoundaryError("STITCH_PROVIDER_RESULT_INVALID", true);
    return {
      status: failure.uncertain ? "unknown" : "failed",
      reason: failure.code,
      evidence,
      reconciliationRequired: failure.uncertain,
    };
  }
}
