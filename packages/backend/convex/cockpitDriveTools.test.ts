// @vitest-environment node
//
// Phase 20.1 (VALT-15): the cockpit wrappers must cross the authenticated Drive boundary, not
// merely exist in the tool record or pass through the SMOKE-only short circuit.

import { convexTest } from "convex-test";
import { afterEach, expect, test, vi } from "vitest";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);
const TENANT = "drive_tool_tenant";
const FULL_SCOPE =
  "https://www.googleapis.com/auth/gmail.modify https://www.googleapis.com/auth/drive.readonly";
const PRE_WIDENING_SCOPE = "https://www.googleapis.com/auth/gmail.modify";

type T = ReturnType<typeof convexTest>;

afterEach(() => vi.unstubAllGlobals());

async function setup(): Promise<{ t: T; planId: Id<"plans"> }> {
  const t = convexTest(schema, modules);
  const planId = await t.mutation(internal.plans.insertPlan, {
    tenantId: TENANT,
    threadId: "drive-tool-thread",
  });
  return { t, planId };
}

async function seedGrant(t: T, scope: string, expiresAt = Date.now() + 3_600_000): Promise<void> {
  await t.run((ctx) =>
    ctx.db.insert("gmailTokens", {
      tenantId: TENANT,
      refreshToken: "refresh-token",
      accessToken: "access-token",
      expiresAt,
      scope,
      updatedAt: Date.now(),
    }),
  );
}

const callDriveTool = (
  t: T,
  planId: Id<"plans">,
  toolName: "listDriveFolders" | "findInDrive",
  input: unknown,
) =>
  t.withIdentity({ subject: TENANT }).action(internal.llm.__invokeCockpitTool, {
    tenantId: TENANT,
    planId,
    toolName,
    input,
  });

test("cockpit Drive reads traverse the authenticated boundary and return metadata only", async () => {
  const { t, planId } = await setup();
  await seedGrant(t, FULL_SCOPE);
  const fetchSpy = vi.fn(async (url: string) => {
    if (!String(url).includes("/drive/v3/"))
      return Response.json({ access_token: "fresh-access-token", expires_in: 3600 });
    const q = new URL(String(url)).searchParams.get("q") ?? "";
    if (q.includes("in parents")) {
      return Response.json({
        files: [
          { id: "subfolder-1", name: "Q3 Numbers", mimeType: "application/vnd.google-apps.folder" },
          {
            id: "file-1",
            name: "Forecast.txt",
            mimeType: "text/plain",
            size: "42",
            modifiedTime: "2026-08-16T00:00:00.000Z",
            capabilities: { canDownload: true },
          },
        ],
      });
    }
    return Response.json({
      files: [
        {
          id: "file-1",
          name: "Forecast.txt",
          mimeType: "text/plain",
          size: "42",
          modifiedTime: "2026-08-16T00:00:00.000Z",
          capabilities: { canDownload: true },
        },
      ],
    });
  });
  vi.stubGlobal("fetch", fetchSpy);

  const listed = await callDriveTool(t, planId, "listDriveFolders", { parentId: "folder_1" });
  expect(listed).toContain("Q3 Numbers [id: subfolder-1]");
  expect(listed).toContain("Forecast.txt [id: file-1; readable]");

  const found = await callDriveTool(t, planId, "findInDrive", { query: "forecast" });
  expect(found).toBe(
    "Drive search found 1 item(s): Forecast.txt (file, readable) [id: file-1].",
  );
  expect(fetchSpy).toHaveBeenCalledTimes(4);
  expect(await t.run((ctx) => ctx.db.query("vaultFolders").collect())).toEqual([]);
  expect(await t.run((ctx) => ctx.db.query("vaultDocuments").collect())).toEqual([]);
});

test("cockpit Drive reads translate connection and reference refusals honestly", async () => {
  {
    const { t, planId } = await setup();
    expect(await callDriveTool(t, planId, "listDriveFolders", {})).toMatch(
      /Google is not connected/i,
    );
    expect(await callDriveTool(t, planId, "findInDrive", { query: "forecast" })).toMatch(
      /Google is not connected/i,
    );
  }

  {
    const { t, planId } = await setup();
    await seedGrant(t, PRE_WIDENING_SCOPE);
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    expect(await callDriveTool(t, planId, "listDriveFolders", {})).toMatch(
      /connected without Drive access.*reconnect/i,
    );
    expect(await callDriveTool(t, planId, "findInDrive", { query: "forecast" })).toMatch(
      /connected without Drive access.*reconnect/i,
    );
    expect(fetchSpy).not.toHaveBeenCalled();
  }

  {
    const { t, planId } = await setup();
    expect(
      await callDriveTool(t, planId, "listDriveFolders", { parentId: "bad'id" }),
    ).toMatch(/folder reference is invalid/i);
  }

  {
    const { t, planId } = await setup();
    await seedGrant(t, FULL_SCOPE, 0);
    vi.stubGlobal("fetch", vi.fn(async () => new Response("refresh failed", { status: 500 })));
    expect(await callDriveTool(t, planId, "findInDrive", { query: "forecast" })).toMatch(
      /connection could not be refreshed.*reconnect/i,
    );
  }
});
