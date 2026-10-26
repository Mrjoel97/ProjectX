// @vitest-environment node
import { deflateSync } from "node:zlib";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  generateStitchDesignEvidence,
  preflightStitchDesign,
  stitchConfigurationSummary,
  STITCH_MCP_ENDPOINT,
  type StitchDesignRequest,
  type StitchDesignServices,
} from "./stitchDesignClient";

function png() {
  const chunk = (name: string, body: Uint8Array) => {
    const b = Buffer.alloc(body.length + 12);
    b.writeUInt32BE(body.length);
    b.write(name, 4);
    b.set(body, 8);
    let crc = 0xffffffff;
    for (const n of b.subarray(4, -4)) {
      crc ^= n;
      for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
    b.writeUInt32BE((crc ^ 0xffffffff) >>> 0, b.length - 4);
    return b;
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(2);
  header.writeUInt32BE(1, 4);
  header[8] = 8;
  header[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(Buffer.from([0, 255, 0, 0, 255, 0, 255, 0, 255]))),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
const request = (): StitchDesignRequest => ({
  scope: {
    tenantId: "tenant_fixture",
    planId: "plan_fixture",
    briefHash: "a".repeat(64),
    runRef: "comparison_fixture",
  },
  prompt: "Synthetic garden business; no private records.",
  deviceType: "DESKTOP",
});
type Wire = {
  id?: number;
  method: string;
  params?: { name?: string; arguments?: Record<string, unknown> };
};
type Options = {
  change?: (operation: string, result: Record<string, unknown>) => Record<string, unknown>;
  response?: (
    operation: string,
    wire: Wire,
    result: Record<string, unknown>,
  ) => Response | Promise<Response> | undefined;
  sse?: boolean;
};
function fixture(options: Options = {}) {
  const calls: { url: string; init: RequestInit; operation: string; wire?: Wire }[] = [];
  let title = "";
  const toolSchemas = [
    {
      name: "create_project",
      inputSchema: { type: "object", properties: { title: { type: "string" } }, required: [] },
    },
    {
      name: "generate_screen_from_text",
      inputSchema: {
        type: "object",
        properties: {
          projectId: { type: "string" },
          prompt: { type: "string" },
          deviceType: { type: "string" },
        },
        required: ["projectId", "prompt"],
      },
    },
    {
      name: "get_screen",
      inputSchema: {
        type: "object",
        properties: {
          name: { type: "string" },
        },
        required: ["name"],
      },
    },
    {
      name: "delete_everything",
      description: "Not an allowed tool",
      inputSchema: { type: "object" },
    },
  ];
  const fetcher: typeof fetch = vi.fn(async (input, init = {}) => {
    const url = String(input);
    if (url !== STITCH_MCP_ENDPOINT) {
      const operation = url.endsWith("screen.png") ? "download_screenshot" : "download_html";
      calls.push({ url, init, operation });
      const supplied = options.response?.(operation, { method: "GET" }, {});
      if (supplied) return supplied;
      return operation === "download_screenshot"
        ? new Response(new Uint8Array(png()), { headers: { "Content-Type": "image/png" } })
        : new Response(
            "<!doctype html><html><body><h1>Design reference</h1><script>untrusted()</script></body></html>",
            { headers: { "Content-Type": "text/html; charset=utf-8" } },
          );
    }
    const wire = JSON.parse(String(init.body)) as Wire,
      operation =
        wire.method === "tools/call"
          ? wire.params!.name!
          : wire.method === "tools/list"
            ? "tools_list"
            : wire.method === "notifications/initialized"
              ? "initialized"
              : "initialize";
    calls.push({ url, init, operation, wire });
    if (operation === "initialized") return new Response(null, { status: 202 });
    let result: Record<string, unknown>;
    if (operation === "initialize")
      result = {
        protocolVersion: "2025-06-18",
        capabilities: { tools: {} },
        serverInfo: { name: "offline-fixture", version: "1" },
      };
    else if (operation === "tools_list") result = { tools: toolSchemas };
    else if (operation === "create_project") {
      title = String(wire.params!.arguments!.title);
      result = {
        structuredContent: { name: "projects/project_owned", title, visibility: "PRIVATE" },
      };
    } else if (operation === "generate_screen_from_text")
      result = {
        structuredContent: {
          projectId: "project_owned",
          outputComponents: [
            {
              design: {
                screens: [
                  { name: "projects/project_owned/screens/screen_owned", id: "screen_owned" },
                ],
              },
            },
          ],
        },
      };
    else
      result = {
        structuredContent: {
          name: "projects/project_owned/screens/screen_owned",
          deviceType: "DESKTOP",
          htmlCode: { downloadUrl: "https://contribution.usercontent.google.com/design.html" },
          screenshot: { downloadUrl: "https://lh3.googleusercontent.com/screen.png" },
        },
      };
    result = options.change?.(operation, result) ?? result;
    const supplied = options.response?.(operation, wire, result);
    if (supplied) return supplied;
    const envelope = { jsonrpc: "2.0", id: wire.id, result };
    return options.sse && operation === "generate_screen_from_text"
      ? new Response(
          `event: message\ndata: ${JSON.stringify({ jsonrpc: "2.0", method: "notifications/progress", params: { progress: 1 } })}\n\ndata: ${JSON.stringify(envelope)}\n\n`,
          { headers: { "Content-Type": "text/event-stream" } },
        )
      : Response.json(envelope, {
          headers:
            operation === "initialize" ? { "Mcp-Session-Id": "opaque-session-fixture" } : undefined,
        });
  });
  const services: StitchDesignServices = {
    authorize: vi.fn(async () => {}),
    beforeAttempt: vi.fn(async () => ({ reservationRef: "reservation_fixture" })),
    afterAttempt: vi.fn(async () => {}),
    checkpoint: vi.fn(async () => {}),
    fetcher,
  };
  return { calls, services, fetcher, toolSchemas };
}
beforeEach(() => vi.stubEnv("STITCH_API_KEY", "synthetic_stitch_key"));
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("bounded Stitch comparison adapter", () => {
  test("read-only preflight discovers only the three required schemas and creates nothing", async () => {
    const f = fixture(),
      result = await preflightStitchDesign(request(), f.services);
    expect(result.status).toBe("complete");
    if (result.status !== "complete") throw Error("preflight failed");
    expect(result.tools.map((tool) => tool.name)).toEqual([
      "create_project",
      "generate_screen_from_text",
      "get_screen",
    ]);
    expect(result.generationPerformed).toBe(false);
    expect(result.evidence.providerGeneration).toBe("not_started");
    expect(f.calls.map((call) => call.operation)).toEqual([
      "initialize",
      "initialized",
      "tools_list",
    ]);
    expect(f.services.checkpoint).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain("delete_everything");
    expect(JSON.stringify(result)).not.toContain("synthetic_stitch_key");
  });
  test("missing configuration, missing admission, foreign scope and model-selected project fail before network", async () => {
    const f = fixture();
    vi.stubEnv("STITCH_API_KEY", "");
    expect((await generateStitchDesignEvidence(request(), f.services)).status).toBe("failed");
    expect(f.fetcher).not.toHaveBeenCalled();
    vi.stubEnv("STITCH_API_KEY", "synthetic_stitch_key");
    expect(
      (
        await generateStitchDesignEvidence(
          { ...request(), projectId: "foreign" } as StitchDesignRequest,
          f.services,
        )
      ).status,
    ).toBe("failed");
    expect(
      (
        await generateStitchDesignEvidence(request(), {
          ...f.services,
          beforeAttempt: undefined,
        } as unknown as StitchDesignServices)
      ).status,
    ).toBe("failed");
    const refused = await generateStitchDesignEvidence(request(), {
      ...f.services,
      authorize: async () => {
        throw Error("private unredacted error");
      },
    });
    expect(refused).toMatchObject({ status: "failed", reason: "STITCH_SCOPE_REFUSED" });
    expect(JSON.stringify(refused)).not.toContain("private unredacted");
    expect(f.fetcher).not.toHaveBeenCalled();
  });
  test("complete generation binds returned resources, checkpoints before generation and hashes quarantined artifacts", async () => {
    const f = fixture(),
      result = await generateStitchDesignEvidence(request(), f.services);
    expect(result.status).toBe("complete");
    if (result.status !== "complete") throw Error(JSON.stringify(result));
    expect(result.evidence).toMatchObject({
      projectName: "projects/project_owned",
      screenName: "projects/project_owned/screens/screen_owned",
      providerGeneration: "completed",
      costStatus: "not_reported",
      designEvidenceOnly: true,
      rendererImportPerformed: false,
    });
    expect(result.html.trustedExecutable).toBe(false);
    expect(result.html.text).toContain("<script>");
    expect(result.html.contentHash).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(result.screenshot).toMatchObject({ mimeType: "image/png", width: 2, height: 1 });
    expect(f.services.beforeAttempt).toHaveBeenCalledTimes(7);
    expect(f.services.afterAttempt).toHaveBeenCalledTimes(7);
    expect(f.services.checkpoint).toHaveBeenCalledTimes(2);
    for (const call of f.calls) {
      expect(call.init.redirect).toBe("error");
      expect(call.init.credentials).toBe("omit");
      const h = new Headers(call.init.headers);
      if (call.url === STITCH_MCP_ENDPOINT) {
        expect(h.get("X-Goog-Api-Key")).toBe("synthetic_stitch_key");
        if (call.operation !== "initialize") {
          expect(h.get("Mcp-Session-Id")).toBe("opaque-session-fixture");
          expect(h.get("MCP-Protocol-Version")).toBe("2025-06-18");
        }
      } else {
        expect(h.has("X-Goog-Api-Key")).toBe(false);
        expect(h.has("Mcp-Session-Id")).toBe(false);
        expect(h.has("Authorization")).toBe(false);
      }
    }
    expect(
      f.calls
        .filter((call) => call.wire?.method === "tools/call")
        .map((call) => call.wire?.params?.name),
    ).toEqual(["create_project", "generate_screen_from_text", "get_screen"]);
    expect(
      f.calls.find((call) => call.operation === "get_screen")?.wire?.params?.arguments,
    ).toEqual({
      name: "projects/project_owned/screens/screen_owned",
    });
  });
  test("JSON-in-text tool payloads and SSE progress frames follow the documented MCP envelopes", async () => {
    const f = fixture({
      sse: true,
      change: (_, result) =>
        result.structuredContent
          ? { content: [{ type: "text", text: JSON.stringify(result.structuredContent) }] }
          : result,
    });
    expect((await generateStitchDesignEvidence(request(), f.services)).status).toBe("complete");
  });
  test("SSE returns after the matching response even when the server keeps the stream open", async () => {
    const cancelled = vi.fn(),
      f = fixture({
        response: (operation, wire, result) =>
          operation === "generate_screen_from_text"
            ? new Response(
                new ReadableStream({
                  start(controller) {
                    const data = `data: ${JSON.stringify({ jsonrpc: "2.0", id: wire.id, result })}\n\n`;
                    const b = new TextEncoder().encode(data);
                    controller.enqueue(b.slice(0, 13));
                    controller.enqueue(b.slice(13));
                  },
                  cancel: cancelled,
                }),
                { headers: { "Content-Type": "text/event-stream" } },
              )
            : undefined,
      });
    expect((await generateStitchDesignEvidence(request(), f.services)).status).toBe("complete");
    expect(cancelled).toHaveBeenCalledOnce();
  });
  test("incompatible tool discovery refuses instead of guessing parameter aliases", async () => {
    const f = fixture({
      change: (operation, result) =>
        operation === "tools_list"
          ? {
              tools: [
                {
                  name: "generate_screen_from_text",
                  inputSchema: { type: "object", properties: { project_id: { type: "string" } } },
                },
              ],
            }
          : result,
    });
    const result = await preflightStitchDesign(request(), f.services);
    expect(result).toMatchObject({ status: "failed", reason: "STITCH_REQUIRED_TOOL_UNAVAILABLE" });
    expect(f.calls).toHaveLength(3);
  });
  test("get_screen discovery requires its owned resource name and refuses additional required inputs", async () => {
    for (const incompatible of [
      { type: "object", properties: { screenId: { type: "string" } }, required: ["screenId"] },
      {
        type: "object",
        properties: { name: { type: "string" }, foreignProject: { type: "string" } },
        required: ["name", "foreignProject"],
      },
    ]) {
      const f = fixture();
      Object.assign(f.toolSchemas[2]!, { inputSchema: incompatible });
      expect(await preflightStitchDesign(request(), f.services)).toMatchObject({
        status: "failed",
        reason: "STITCH_TOOL_SCHEMA_INCOMPATIBLE",
      });
      expect(f.calls.map((call) => call.operation)).toEqual([
        "initialize",
        "initialized",
        "tools_list",
      ]);
    }
  });
  test("no generation occurs after project checkpoint or budget admission fails", async () => {
    const first = fixture();
    expect(
      await generateStitchDesignEvidence(request(), {
        ...first.services,
        checkpoint: async () => {
          throw Error("db unavailable");
        },
      }),
    ).toMatchObject({ status: "unknown", reason: "STITCH_CHECKPOINT_REQUIRED" });
    expect(first.calls).toHaveLength(3);
    const second = fixture();
    const result = await generateStitchDesignEvidence(request(), {
      ...second.services,
      beforeAttempt: async (attempt) => {
        if (attempt.operation === "generate_screen_from_text") throw Error("budget closed");
        return { reservationRef: "allowed_fixture" };
      },
    });
    expect(result).toMatchObject({
      status: "failed",
      reason: "STITCH_BUDGET_ADMISSION_REFUSED",
      evidence: { providerGeneration: "not_started" },
    });
    expect(second.calls).toHaveLength(3);
  });
  test("a timed-out generation is unknown with no retry, fallback or subsequent read", async () => {
    const f = fixture({
      response: (operation) =>
        operation === "generate_screen_from_text" ? new Promise<Response>(() => {}) : undefined,
    });
    const result = await generateStitchDesignEvidence(request(), {
      ...f.services,
      requestTimeoutMs: 40,
    });
    expect(result).toMatchObject({
      status: "unknown",
      reason: "STITCH_TIMEOUT",
      reconciliationRequired: true,
      evidence: { providerGeneration: "attempted", projectName: "projects/project_owned" },
    });
    expect(f.calls).toHaveLength(4);
    expect(f.services.afterAttempt).toHaveBeenLastCalledWith(
      expect.objectContaining({
        operation: "generate_screen_from_text",
        outcome: "unknown",
        costStatus: "not_reported",
      }),
    );
  });
  test("unknown budget settlement stops before another provider request", async () => {
    const f = fixture();
    const result = await generateStitchDesignEvidence(request(), {
      ...f.services,
      afterAttempt: async (attempt) => {
        if (attempt.operation === "generate_screen_from_text") throw Error("unknown settlement");
      },
    });
    expect(result).toMatchObject({
      status: "unknown",
      reason: "STITCH_BUDGET_RECONCILIATION_REQUIRED",
    });
    expect(f.calls).toHaveLength(4);
  });
  test("foreign resource names, public projects and response-ID substitution refuse", async () => {
    for (const variant of ["foreign", "public", "wrong_rpc"]) {
      const f = fixture({
        change: (operation, result) =>
          variant === "foreign" && operation === "generate_screen_from_text"
            ? { structuredContent: { projectId: "foreign", outputComponents: [] } }
            : variant === "public" && operation === "create_project"
              ? {
                  structuredContent: {
                    ...(result.structuredContent as object),
                    visibility: "PUBLIC",
                  },
                }
              : result,
        response: (operation, wire, result) =>
          variant === "wrong_rpc" && operation === "generate_screen_from_text"
            ? Response.json({ jsonrpc: "2.0", id: (wire.id ?? 0) + 99, result })
            : undefined,
      });
      const result = await generateStitchDesignEvidence(request(), f.services);
      expect(result.status).toBe("unknown");
      expect(f.calls.some((call) => call.operation === "get_screen")).toBe(false);
    }
  });
  test("artifact SSRF/credential/redirect targets never receive a request", async () => {
    for (const target of [
      "http://127.0.0.1/private",
      "https://169.254.169.254/latest",
      "https://lh3.googleusercontent.com.attacker.test/file",
      "https://user:pass@lh3.googleusercontent.com/file",
      "https://lh3.googleusercontent.com:8443/file",
      "https://[::1]/file",
      "data:text/html,private",
    ]) {
      const f = fixture({
        change: (operation, result) =>
          operation === "get_screen"
            ? {
                structuredContent: {
                  ...(result.structuredContent as object),
                  htmlCode: { downloadUrl: target },
                },
              }
            : result,
      });
      expect(await generateStitchDesignEvidence(request(), f.services)).toMatchObject({
        status: "failed",
        reason: "STITCH_ARTIFACT_URL_REFUSED",
      });
      expect(f.calls).toHaveLength(5);
    }
  });
  test("actual streamed size limits reject oversized HTML without trusting Content-Length", async () => {
    const f = fixture({
      response: (operation) =>
        operation === "download_html"
          ? new Response(
              new ReadableStream({
                start(controller) {
                  controller.enqueue(new Uint8Array(1024 * 1024));
                  controller.enqueue(new Uint8Array(1024 * 1024 + 1));
                  controller.close();
                },
              }),
              { headers: { "Content-Type": "text/html", "Content-Length": "1" } },
            )
          : undefined,
    });
    expect(await generateStitchDesignEvidence(request(), f.services)).toMatchObject({
      status: "failed",
      reason: "STITCH_RESPONSE_TOO_LARGE",
    });
    expect(f.calls).toHaveLength(6);
  });
  test("invalid screenshot bytes and HTML MIME are refused, not imported or repaired silently", async () => {
    for (const bad of ["html", "image"]) {
      const f = fixture({
        response: (operation) =>
          bad === "html" && operation === "download_html"
            ? new Response("<html>", { headers: { "Content-Type": "text/plain" } })
            : bad === "image" && operation === "download_screenshot"
              ? new Response("<svg></svg>", { headers: { "Content-Type": "image/svg+xml" } })
              : undefined,
      });
      const result = await generateStitchDesignEvidence(request(), f.services);
      expect(result.status).toBe("failed");
      expect("html" in result).toBe(false);
    }
  });
  test("authorization pins an immutable request despite caller mutation while awaiting authority", async () => {
    const original = request(),
      f = fixture();
    const result = await generateStitchDesignEvidence(original, {
      ...f.services,
      authorize: async () => {
        original.prompt = "Injected after authorization";
        original.scope.tenantId = "foreign";
      },
    });
    expect(result.status).toBe("complete");
    expect(
      f.calls.find((call) => call.operation === "generate_screen_from_text")?.wire?.params
        ?.arguments?.prompt,
    ).toBe("Synthetic garden business; no private records.");
  });
  test("DOM browser runtimes are refused even when a process shim contains a key", async () => {
    vi.stubGlobal("document", {});
    const f = fixture();
    expect(stitchConfigurationSummary().configured).toBe(false);
    expect(await generateStitchDesignEvidence(request(), f.services)).toMatchObject({
      status: "failed",
      reason: "STITCH_ADMISSION_REQUIRED",
    });
    expect(f.fetcher).not.toHaveBeenCalled();
  });
  test("configuration summary never returns a key or implicit free-billing claim", () => {
    const summary = stitchConfigurationSummary();
    expect(summary.configured).toBe(true);
    expect(JSON.stringify(summary)).not.toContain("synthetic_stitch_key");
    expect(summary.requiresBudgetAdmission).toBe(true);
  });
});
