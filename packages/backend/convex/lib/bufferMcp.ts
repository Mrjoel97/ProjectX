import { BUFFER_API_URL, BUFFER_MCP_URL, bufferRecord, unpackBufferTool } from "@pikar/core/buffer";

/** Fixed-origin MCP transport. No model-supplied URLs, generic operations or credential logging. */
export class BufferFailure extends Error {
  constructor(
    readonly reason: "reauth" | "rate_limited" | "rejected" | "unavailable" | "invalid_response",
  ) {
    super(`BUFFER_${reason.toUpperCase()}`);
  }
}

export async function bufferJson(url: string, init: RequestInit): Promise<Record<string, unknown>> {
  let response: Response;
  try {
    response = await fetch(url, {
      ...init,
      redirect: "error",
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    throw new BufferFailure("unavailable");
  }
  if (!response.ok)
    throw new BufferFailure(
      response.status === 401
        ? "reauth"
        : response.status === 429
          ? "rate_limited"
          : response.status >= 500
            ? "unavailable"
            : "rejected",
    );
  try {
    return bufferRecord(await response.json());
  } catch {
    throw new BufferFailure("invalid_response");
  }
}

/** Only code-owned queries reach this server helper; provider error prose never leaves it. */
export async function bufferGraphql(
  accessToken: string,
  query: string,
  variables: Record<string, unknown> = {},
): Promise<Record<string, unknown>> {
  const result = await bufferJson(BUFFER_API_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables }),
  });
  // A partial mutation response is uncertain, so it must never become an automatic retry.
  if (result.errors) throw new BufferFailure("invalid_response");
  try {
    return bufferRecord(result.data);
  } catch {
    throw new BufferFailure("invalid_response");
  }
}

export async function callBufferTool(
  accessToken: string,
  name: string,
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const allowed = [
    "get_account",
    "execute_query",
    "get_aggregated_post_metrics",
    "create_post",
    "get_post",
  ];
  if (!allowed.includes(name)) throw new BufferFailure("rejected");
  let id = 0;
  let session: string | null = null;
  const rpc = async (
    method: string,
    params: Record<string, unknown>,
    notification = false,
  ): Promise<Record<string, unknown>> => {
    const requestId = ++id;
    let response: Response;
    try {
      response = await fetch(BUFFER_MCP_URL, {
        method: "POST",
        redirect: "error",
        signal: AbortSignal.timeout(30_000),
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
          Accept: "application/json, text/event-stream",
          "MCP-Protocol-Version": "2025-03-26",
          ...(session ? { "Mcp-Session-Id": session } : {}),
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          ...(notification ? {} : { id: requestId }),
          method,
          params,
        }),
      });
    } catch {
      throw new BufferFailure("unavailable");
    }
    session = response.headers.get("mcp-session-id") ?? session;
    if (!response.ok)
      throw new BufferFailure(
        response.status === 401
          ? "reauth"
          : response.status === 429
            ? "rate_limited"
            : response.status >= 500
              ? "unavailable"
              : "rejected",
      );
    if (notification || response.status === 202) return {};
    let raw: string;
    try {
      raw = await response.text();
    } catch {
      throw new BufferFailure("unavailable");
    }
    if (raw.length > 2_000_000) throw new BufferFailure("invalid_response");
    try {
      const events = response.headers.get("content-type")?.includes("text/event-stream")
        ? raw
            .split(/\r?\n\r?\n/)
            .map((event) =>
              event
                .split(/\r?\n/)
                .filter((line) => line.startsWith("data:"))
                .map((line) => line.slice(5).trim())
                .join("\n"),
            )
            .filter(Boolean)
            .map((text) => bufferRecord(JSON.parse(text)))
        : [bufferRecord(JSON.parse(raw))];
      const message = events.find((event) => event.id === requestId);
      if (!message || message.error) throw new BufferFailure("rejected");
      return bufferRecord(message.result);
    } catch (error) {
      if (error instanceof BufferFailure) throw error;
      throw new BufferFailure("invalid_response");
    }
  };
  await rpc("initialize", {
    protocolVersion: "2025-03-26",
    capabilities: {},
    clientInfo: { name: "Pikar AI", version: "1.0.0" },
  });
  await rpc("notifications/initialized", {}, true);
  const result = await rpc("tools/call", { name, arguments: args });
  try {
    return unpackBufferTool(result);
  } catch {
    throw new BufferFailure(result.isError ? "rejected" : "invalid_response");
  }
}
