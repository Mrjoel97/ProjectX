import { expect, test, vi } from "vitest";
import { buildSocialTools } from "./socialTools";

type Executable = { execute: (args: Record<string, unknown>) => Promise<unknown> };

function harness() {
  const runAction = vi.fn(async (_ref: unknown, _args: unknown) => ({
    accounts: [{ id: "api-channel-id", name: "API channel name" }],
    posts: [{ id: "api-video-id", text: "API video description" }],
  }));
  const runMutation = vi.fn(async (_ref: unknown, _args: unknown) => "opaque-pikar-draft-id");
  const tools = buildSocialTools({ runAction, runMutation } as never, "trusted-tenant");
  return {
    runAction,
    runMutation,
    execute: (name: string, args: Record<string, unknown>) =>
      (tools[name] as unknown as Executable).execute(args),
  };
}

test("YouTube agent reads return no metadata and perform no backend reads", async () => {
  const h = harness();
  for (const name of ["readSocialAccounts", "readSocialContent"]) {
    const result = await h.execute(name, {
      provider: "youtube",
      assetId: "api-channel-id",
      tenantId: "foreign-tenant",
      accountName: "API channel name",
      fallbackProvider: "meta",
    });
    expect(result).toEqual({
      state: "unavailable",
      reason: "youtube_agent_reads_not_qualified",
      settingsPath: "/connect-social",
    });
    expect(JSON.stringify(result)).not.toMatch(/api-channel-id|API channel name|api-video-id/);
  }
  expect(h.runAction).not.toHaveBeenCalled();
  expect(h.runMutation).not.toHaveBeenCalled();
});

test("Meta and TikTok retain reads with the trusted tenant", async () => {
  const h = harness();
  for (const provider of ["meta", "tiktok"]) {
    await h.execute("readSocialAccounts", { provider, tenantId: "foreign-tenant" });
    await h.execute("readSocialContent", {
      provider,
      assetId: "selected-account",
      tenantId: "foreign-tenant",
    });
  }
  expect(h.runAction.mock.calls.map((call) => call[1])).toEqual([
    { provider: "meta", tenantId: "trusted-tenant" },
    { provider: "meta", assetId: "selected-account", tenantId: "trusted-tenant" },
    { provider: "tiktok", tenantId: "trusted-tenant" },
    { provider: "tiktok", assetId: "selected-account", tenantId: "trusted-tenant" },
  ]);
});

test("YouTube staging returns only an opaque draft reference, not API account data", async () => {
  const h = harness();
  const result = await h.execute("stageSocialPost", {
    provider: "youtube",
    assetId: "customer-supplied-destination",
    text: "Independently supplied customer description",
    title: "Customer title",
    storageId: "customer-upload",
    privacy: "private",
    madeForKids: false,
    aiGenerated: false,
    tenantId: "foreign-tenant",
  });
  expect(result).toEqual({
    state: "draft",
    postId: "opaque-pikar-draft-id",
    reviewPath: "/connect-social",
  });
  expect(h.runAction).not.toHaveBeenCalled();
  expect(h.runMutation.mock.calls.map((call) => call[1])).toEqual([
    {
      provider: "youtube",
      assetId: "customer-supplied-destination",
      text: "Independently supplied customer description",
      title: "Customer title",
      storageId: "customer-upload",
      privacy: "private",
      madeForKids: false,
      aiGenerated: false,
      tenantId: "trusted-tenant",
    },
  ]);
  expect(JSON.stringify(result)).not.toMatch(
    /customer-supplied-destination|API channel name|api-video-id/,
  );
});
