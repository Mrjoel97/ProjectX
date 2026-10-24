// @vitest-environment jsdom

import { getFunctionName } from "convex/server";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ConnectSocialPage from "./page";
import SocialWorkspace from "./SocialWorkspace";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
const mocks = vi.hoisted(() => ({
  rows: undefined as unknown,
  complete: vi.fn(),
  disconnect: vi.fn(),
  action: vi.fn(),
  posts: [] as unknown[],
  select: vi.fn(),
  approve: vi.fn(),
  edit: vi.fn(),
  read: vi.fn(),
  creator: vi.fn(),
  verify: vi.fn(),
}));
vi.mock("convex/react", () => ({
  useQuery: (ref: unknown) =>
    getFunctionName(ref as never) === "socialPublishing:posts" ? mocks.posts : mocks.rows,
  useAction: (ref: unknown) =>
    ({
      "socialContentActions:readContent": mocks.read,
      "socialContentActions:creatorInfo": mocks.creator,
      "socialActions:verifyConnection": mocks.verify,
      "socialActions:disconnect": mocks.disconnect,
    })[getFunctionName(ref as never)] ?? mocks.action,
  useMutation: (ref: unknown) =>
    ({
      "social:completeConnect": mocks.complete,
      "socialPublishing:selectAccounts": mocks.select,
      "socialPublishing:approvePost": mocks.approve,
      "socialPublishing:editDraft": mocks.edit,
    })[getFunctionName(ref as never)] ?? mocks.disconnect,
}));
let host: HTMLDivElement, root: Root;
beforeEach(() => {
  vi.clearAllMocks();
  mocks.rows = undefined;
  mocks.posts = [];
  mocks.select.mockResolvedValue(undefined);
  mocks.approve.mockResolvedValue(undefined);
  mocks.edit.mockResolvedValue(undefined);
  mocks.creator.mockResolvedValue(undefined);
  mocks.verify.mockResolvedValue({ verified: true, accountName: "Customer identity" });
  mocks.complete.mockResolvedValue({ connected: true });
  mocks.disconnect.mockResolvedValue({
    disconnectedHere: true,
    upstreamRevoked: false,
    upstreamRevocation: "manual",
  });
  window.history.replaceState({}, "", "/connect-social");
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});
async function render() {
  await act(async () => root.render(<ConnectSocialPage />));
}
describe("direct social connection screen", () => {
  it("shows loading rather than disconnected before connection evidence arrives", async () => {
    await render();
    expect(host.textContent).toContain("Checking connections");
    expect(host.textContent).not.toContain("Not connected");
  });
  it("removes opaque receipts from browser history before authenticated activation", async () => {
    window.history.replaceState({}, "", "/connect-social?provider=x&complete=" + "a".repeat(43));
    await render();
    expect(window.location.search).toBe("");
    expect(mocks.complete).toHaveBeenCalledWith({ provider: "x", receipt: "a".repeat(43) });
    expect(host.textContent).toContain("X connected");
  });
  it("does not claim connection success when readiness was disabled during consent", async () => {
    window.history.replaceState(
      {},
      "",
      "/connect-social?provider=youtube&complete=" + "b".repeat(43),
    );
    mocks.complete.mockResolvedValueOnce({ connected: false, reason: "SOCIAL_NOT_CONFIGURED" });
    await render();
    expect(window.location.search).toBe("");
    expect(mocks.complete).toHaveBeenCalledWith({ provider: "youtube", receipt: "b".repeat(43) });
    expect(host.textContent).toContain("This connection is currently unavailable");
    expect(host.textContent).toContain("No new account connection was saved");
    expect(host.textContent).not.toContain("YouTube connected");
  });
  it("does not activate a receipt with an unsupported provider", async () => {
    window.history.replaceState({}, "", "/connect-social?provider=attacker&complete=opaque");
    await render();
    expect(mocks.complete).not.toHaveBeenCalled();
    expect(host.textContent).toContain("Connection failed");
  });
  it("requires a concrete disconnect confirmation and explains upstream access", async () => {
    mocks.rows = [
      {
        provider: "tiktok",
        configured: true,
        connected: true,
        status: "connected",
        accountName: "Own account",
        connectionId: "test",
        assets: [],
        selectedAssetIds: [],
        scopes: ["user.info.basic"],
        publishEnabled: false,
      },
    ];
    await render();
    const disconnect = Array.from(host.querySelectorAll("button")).find(
      (button) => button.textContent === "Disconnect",
    )!;
    await act(async () => disconnect.click());
    expect(mocks.disconnect).not.toHaveBeenCalled();
    expect(host.textContent).toContain("connected-app settings");
    await act(async () =>
      Array.from(host.querySelectorAll("button"))
        .find((button) => button.textContent === "Confirm disconnect")!
        .click(),
    );
    expect(mocks.disconnect).toHaveBeenCalledWith({ provider: "tiktok" });
  });
  it.each([
    true,
    false,
  ])("reports YouTube upstream revocation truthfully (%s)", async (upstreamRevoked) => {
    mocks.rows = [
      {
        provider: "youtube",
        configured: true,
        connected: true,
        status: "connected",
        accountName: "Customer channel",
        connectionId: "youtube-connection",
        assets: [],
        selectedAssetIds: [],
        scopes: ["youtube.readonly"],
        publishEnabled: false,
      },
    ];
    mocks.disconnect.mockResolvedValueOnce({
      disconnectedHere: true,
      upstreamRevoked,
      upstreamRevocation: upstreamRevoked ? "revoked" : "unconfirmed",
    });
    await render();
    await act(async () => button("Disconnect").click());
    expect(host.textContent).toContain("asks Google to revoke all access this Google project has");
    expect(host.textContent).toContain("including other integrations using the project");
    expect(mocks.disconnect).not.toHaveBeenCalled();
    await act(async () => button("Confirm disconnect and revoke Google access").click());
    expect(mocks.disconnect).toHaveBeenCalledWith({
      provider: "youtube",
      acknowledgedGoogleProjectRevocation: true,
    });
    expect(host.textContent).toContain("YouTube disconnected from Pikar");
    if (upstreamRevoked) {
      expect(host.textContent).toContain("Google confirmed revocation");
      expect(host.textContent).not.toContain("Google revocation could not be confirmed");
    } else {
      expect(host.textContent).toContain("Google revocation could not be confirmed");
      expect(host.textContent).toContain("Google Account connections");
      expect(host.textContent).not.toContain("Google confirmed revocation");
    }
  });
  it("keeps a saved YouTube connection readable and removable when new connections are gated", async () => {
    mocks.rows = [
      {
        provider: "youtube",
        configured: false,
        connected: true,
        status: "connected",
        accountName: "Customer channel",
        connectionId: "youtube-connection",
        assets: [{ id: "channel", name: "Customer channel", kind: "youtube" }],
        selectedAssetIds: ["channel"],
        scopes: ["https://www.googleapis.com/auth/youtube.readonly"],
        publishEnabled: false,
      },
    ];
    await render();
    expect(host.querySelector("fieldset")?.disabled).toBe(false);
    expect(
      Array.from(host.querySelectorAll("button")).some(
        (b) => b.textContent === "Reconnect YouTube",
      ),
    ).toBe(false);
    expect(
      Array.from(host.querySelectorAll("button")).some(
        (b) => b.textContent === "Enable content reading",
      ),
    ).toBe(false);
    await chooseAccount("channel");
    expect(button("Read recent posts").disabled).toBe(false);
    expect(button("Disconnect").disabled).toBe(false);
  });
  it("does not report a completed disconnect when the action fails", async () => {
    mocks.rows = [
      {
        provider: "youtube",
        configured: true,
        connected: true,
        status: "connected",
        accountName: "Customer channel",
        connectionId: "youtube-connection",
        assets: [],
        selectedAssetIds: [],
        scopes: ["youtube.readonly"],
        publishEnabled: false,
      },
    ];
    mocks.disconnect.mockRejectedValueOnce(new Error("Unavailable"));
    await render();
    await act(async () => button("Disconnect").click());
    await act(async () => button("Confirm disconnect and revoke Google access").click());
    expect(host.textContent).toContain("Disconnect could not be confirmed");
    expect(host.textContent).not.toContain("YouTube disconnected from Pikar");
  });
});

const pageAsset = { id: "page1", name: "Customer business", kind: "facebook_page" as const };
const baseRow = {
  provider: "meta" as const,
  connectionId: "connection1",
  assets: [pageAsset],
  selectedAssetIds: ["page1"],
  selectionRevision: 0,
  publishEnabled: false,
  scopes: ["pages_read_engagement"],
};
async function workspace(row = baseRow) {
  await act(async () => root.render(<SocialWorkspace row={row} />));
}
function button(label: string) {
  return Array.from(host.querySelectorAll("button")).find((b) => b.textContent === label)!;
}
async function chooseAccount(id: string) {
  const el = host.querySelector("select")!;
  await act(async () => {
    el.value = id;
    el.dispatchEvent(new Event("change", { bubbles: true }));
  });
}
describe("customer social workspace", () => {
  it("saves only the customer's explicit account selection", async () => {
    mocks.posts = [
      {
        _id: "selectiondraft",
        connectionId: "connection1",
        assetId: "page1",
        provider: "meta",
        assetName: "Customer business",
        kind: "facebook_page",
        text: "Review",
        status: "draft",
        revision: 1,
      },
    ];
    await workspace({ ...baseRow, publishEnabled: true, scopes: ["pages_manage_posts"] });
    expect(button("Approve and publish this post").disabled).toBe(false);
    const input = host.querySelector('input[type="checkbox"]') as HTMLInputElement;
    await act(async () => input.click());
    expect(button("Approve and publish this post").disabled).toBe(true);
    expect(host.textContent).toContain("Save your account selection before");
    await act(async () => button("Save account selection").click());
    expect(mocks.select).toHaveBeenCalledWith({
      provider: "meta",
      connectionId: "connection1",
      assetIds: [],
    });
  });
  it("renders recent content only for the chosen account", async () => {
    mocks.read.mockResolvedValue({
      account: pageAsset,
      checkedAt: 1,
      limit: 10,
      posts: [
        {
          id: "post1",
          title: "Customer update",
          text: "A recent business post",
          publishedAt: "2026-10-20",
          url: "https://www.facebook.com/post1",
        },
      ],
    });
    await workspace();
    expect(button("Read recent posts").disabled).toBe(true);
    await chooseAccount("page1");
    await act(async () => button("Read recent posts").click());
    expect(mocks.read).toHaveBeenCalledWith({ provider: "meta", assetId: "page1" });
    expect(host.textContent).toContain("A recent business post");
    expect(host.textContent).toContain("not complete history or analytics");
  });
  it("keeps the saved post review immutable and publishing unavailable before qualification", async () => {
    mocks.posts = [
      {
        _id: "draft1",
        connectionId: "connection1",
        assetId: "page1",
        provider: "meta",
        assetName: "Customer business",
        kind: "facebook_page",
        text: "Approved text snapshot",
        status: "draft",
        revision: 3,
      },
    ];
    await workspace();
    await chooseAccount("page1");
    expect(host.textContent).toContain("Approved text snapshot");
    expect(host.textContent).toContain("Editing the composer does not change it");
    expect(button("Approve and publish this post").disabled).toBe(true);
    await act(async () => button("Approve and publish this post").click());
    expect(mocks.approve).not.toHaveBeenCalled();
  });
  it("keeps publishing disabled when the grant lacks required scopes", async () => {
    mocks.posts = [
      {
        _id: "draft1",
        connectionId: "connection1",
        assetId: "page1",
        provider: "meta",
        assetName: "Customer business",
        kind: "facebook_page",
        text: "Exact post",
        status: "draft",
        revision: 3,
      },
    ];
    await workspace({ ...baseRow, publishEnabled: true });
    expect(button("Approve and publish this post").disabled).toBe(true);
    expect(mocks.approve).not.toHaveBeenCalled();
    await workspace({
      ...baseRow,
      publishEnabled: true,
      scopes: ["pages_manage_posts"],
      selectionRevision: 1,
    });
    expect(button("Approve and publish this post").disabled).toBe(true);
    expect(host.textContent).toContain("Account access or selection changed");
  });
  it("shows complete saved TikTok media and choices at the final review", async () => {
    mocks.posts = [
      {
        _id: "drafttk",
        connectionId: "tk1",
        assetId: "tk",
        provider: "tiktok",
        assetName: "Customer creator",
        kind: "tiktok",
        text: "The saved caption",
        status: "draft",
        revision: 1,
        mediaUrl: "https://example.com/original.mp4",
        privacy: "PUBLIC_TO_EVERYONE",
        aiGenerated: false,
        ownBrand: true,
        paidPartnership: true,
        allowComments: false,
        allowDuet: false,
        allowStitch: false,
      },
    ];
    await act(async () =>
      root.render(
        <SocialWorkspace
          row={{
            provider: "tiktok",
            connectionId: "tk1",
            assets: [{ id: "tk", name: "Customer creator", kind: "tiktok" }],
            selectedAssetIds: ["tk"],
            publishEnabled: false,
            scopes: ["video.publish"],
          }}
        />,
      ),
    );
    expect(host.querySelector("video")?.getAttribute("src")).toBe(
      "https://example.com/original.mp4",
    );
    expect(host.textContent).toContain("The saved caption");
    expect(host.textContent).toContain("Visibility: PUBLIC_TO_EVERYONE");
    expect(host.textContent).toContain("Paid partnership: Yes");
    expect(host.textContent).toContain("Comments: Off");
    expect(host.textContent).toContain("Music Usage Confirmation");
    expect(host.textContent).toContain("Branded Content Policy");
  });
  it("submits the exact saved revision when qualified", async () => {
    mocks.posts = [
      {
        _id: "draft1",
        connectionId: "connection1",
        assetId: "page1",
        provider: "meta",
        assetName: "Customer business",
        kind: "facebook_page",
        text: "Exact post",
        status: "draft",
        revision: 3,
      },
    ];
    await workspace({ ...baseRow, publishEnabled: true, scopes: ["pages_manage_posts"] });
    await act(async () => button("Approve and publish this post").click());
    expect(mocks.approve).toHaveBeenCalledWith({ postId: "draft1", revision: 3 });
  });
  it("lets customers edit a saved caption before a separate approval", async () => {
    mocks.posts = [
      {
        _id: "draft1",
        connectionId: "connection1",
        assetId: "page1",
        provider: "meta",
        assetName: "Customer business",
        kind: "facebook_page",
        text: "Original caption",
        status: "draft",
        revision: 3,
      },
    ];
    await workspace({ ...baseRow, publishEnabled: true, scopes: ["pages_manage_posts"] });
    await act(async () => button("Edit saved post").click());
    expect(button("Approve and publish this post").disabled).toBe(true);
    const caption = host.querySelector("textarea")!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(
        caption,
        "Customer edited caption",
      );
      caption.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => button("Save post changes").click());
    expect(mocks.edit).toHaveBeenCalledWith({
      postId: "draft1",
      revision: 3,
      text: "Customer edited caption",
    });
    expect(mocks.approve).not.toHaveBeenCalled();
    expect(host.textContent).toContain("Review the updated post before approving");
  });
  it("requires explicit TikTok visibility and disclosure while respecting creator restrictions", async () => {
    mocks.creator.mockResolvedValue({
      name: "Customer creator",
      maxDurationSeconds: 60,
      privacyOptions: ["PUBLIC_TO_EVERYONE", "SELF_ONLY"],
      commentsDisabled: true,
      duetDisabled: true,
      stitchDisabled: true,
    });
    await act(async () =>
      root.render(
        <SocialWorkspace
          row={{
            provider: "tiktok",
            connectionId: "tk1",
            assets: [{ id: "tk", name: "Customer creator", kind: "tiktok" }],
            selectedAssetIds: ["tk"],
            publishEnabled: false,
            scopes: ["video.publish"],
          }}
        />,
      ),
    );
    await chooseAccount("tk");
    const visibility = Array.from(host.querySelectorAll("select")).find((el) =>
      el.textContent?.includes("Choose visibility"),
    )!;
    expect(visibility.value).toBe("");
    const toggles = Array.from(
      host.querySelectorAll('input[type="checkbox"]'),
    ) as HTMLInputElement[];
    expect(
      toggles.find((el) => el.parentElement?.textContent?.includes("Disclose commercial"))?.checked,
    ).toBe(false);
    expect(
      toggles.find((el) => el.parentElement?.textContent?.includes("Allow comments"))?.disabled,
    ).toBe(true);
    expect(host.textContent).not.toContain("Your Brand");
    await act(async () =>
      toggles.find((el) => el.parentElement?.textContent?.includes("Disclose commercial"))!.click(),
    );
    expect(host.textContent).toContain("Your Brand");
    expect(host.textContent).toContain("Branded Content");
    await act(async () => {
      visibility.value = "SELF_ONLY";
      visibility.dispatchEvent(new Event("change", { bubbles: true }));
    });
    const paid = Array.from(host.querySelectorAll('input[type="checkbox"]')).find((el) =>
      el.parentElement?.textContent?.includes("Branded Content"),
    ) as HTMLInputElement;
    expect(paid.disabled).toBe(true);
    expect(host.textContent).toContain("Branded content visibility cannot be set to private");
    await act(async () => {
      visibility.value = "PUBLIC_TO_EVERYONE";
      visibility.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await act(async () => paid.click());
    expect(visibility.value).toBe("PUBLIC_TO_EVERYONE");
    expect(Array.from(visibility.options).find((o) => o.value === "SELF_ONLY")?.disabled).toBe(
      true,
    );
    expect(button("Save draft for review").disabled).toBe(true);
  });
});

const tkRow = {
  provider: "tiktok" as const,
  connectionId: "tk1",
  assets: [{ id: "tk", name: "Customer creator", kind: "tiktok" as const }],
  selectedAssetIds: ["tk"],
  publishEnabled: true,
  scopes: ["video.publish"],
};
const creatorOptions = {
  name: "Fresh creator",
  maxDurationSeconds: 60,
  privacyOptions: ["PUBLIC_TO_EVERYONE", "SELF_ONLY"],
  commentsDisabled: false,
  duetDisabled: false,
  stitchDisabled: false,
};
function reviewedTikTok(customerChoicesConfirmed?: boolean) {
  return {
    _id: "reviewtk",
    connectionId: "tk1",
    assetId: "tk",
    provider: "tiktok",
    assetName: "Saved creator name",
    kind: "tiktok",
    text: "Customer caption",
    status: "draft",
    revision: 1,
    mediaUrl: "https://example.com/original.mp4",
    privacy: "PUBLIC_TO_EVERYONE",
    aiGenerated: false,
    ownBrand: false,
    paidPartnership: false,
    allowComments: false,
    allowDuet: false,
    allowStitch: false,
    customerChoicesConfirmed,
  };
}
describe("TikTok customer review boundary", () => {
  it("requires fresh creator info for a human draft without selecting the composer account", async () => {
    let resolveCreator: (info: typeof creatorOptions) => void = () => {};
    mocks.creator.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveCreator = resolve;
      }),
    );
    mocks.posts = [reviewedTikTok(true)];
    await act(async () => root.render(<SocialWorkspace row={tkRow} />));
    expect(mocks.creator).toHaveBeenCalledWith({});
    expect(button("Approve and publish this post").disabled).toBe(true);
    await act(async () => resolveCreator(creatorOptions));
    expect(host.textContent).toContain("Posting as Fresh creator");
    expect(button("Approve and publish this post").disabled).toBe(false);
    expect(mocks.approve).not.toHaveBeenCalled();
    mocks.creator.mockResolvedValue({ ...creatorOptions, privacyOptions: ["SELF_ONLY"] });
    mocks.posts = [{ ...reviewedTikTok(true), revision: 2 }];
    await act(async () => root.render(<SocialWorkspace row={tkRow} />));
    expect(button("Approve and publish this post").disabled).toBe(true);
    expect(host.textContent).toContain("Your TikTok posting options changed");
  });
  it("keeps agent and legacy TikTok choices unpublished and guides a fresh customer draft", async () => {
    mocks.creator.mockResolvedValue(creatorOptions);
    mocks.posts = [reviewedTikTok(false)];
    await act(async () => root.render(<SocialWorkspace row={tkRow} />));
    expect(button("Approve and publish this post").disabled).toBe(true);
    await act(async () => button("Prepare a customer-reviewed TikTok draft").click());
    expect(host.querySelector("textarea")?.value).toBe("Customer caption");
    const privacy = Array.from(host.querySelectorAll("select")).find((el) =>
      el.textContent?.includes("Choose visibility"),
    );
    expect(privacy?.value).toBe("");
    expect((host.querySelector('input[type="file"]') as HTMLInputElement).value).toBe("");
    expect(button("Save draft for review").disabled).toBe(true);
    expect(mocks.approve).not.toHaveBeenCalled();
    mocks.posts = [reviewedTikTok()];
    await act(async () => root.render(<SocialWorkspace row={tkRow} />));
    expect(button("Approve and publish this post").disabled).toBe(true);
  });
  it("stops review approval and asks to try later when creator info is unavailable", async () => {
    mocks.creator.mockRejectedValue(new Error("Provider posting cap reached"));
    mocks.posts = [reviewedTikTok(true)];
    await act(async () => root.render(<SocialWorkspace row={tkRow} />));
    expect(host.textContent).toContain("TikTok posting options are unavailable. Try again later.");
    expect(button("Approve and publish this post").disabled).toBe(true);
    expect(mocks.approve).not.toHaveBeenCalled();
  });
});

describe("saved connection expiry", () => {
  it("preserves the composer while access is renewed and distinguishes expiry from disconnection", async () => {
    const saved = {
      ...baseRow,
      configured: true,
      connected: true,
      status: "connected",
      accountName: "Customer identity",
    };
    mocks.rows = [saved];
    await render();
    await chooseAccount("page1");
    const caption = host.querySelector("textarea")!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(
        caption,
        "Preserve this business draft",
      );
      caption.dispatchEvent(new Event("input", { bubbles: true }));
    });
    mocks.rows = [{ ...saved, connected: false }];
    await render();
    expect(host.textContent).toContain(
      "Connection saved: Customer identity. Verify account access to renew.",
    );
    expect(host.textContent).not.toContain("Not connected");
    expect(host.querySelector("textarea")).toBe(caption);
    expect(caption.value).toBe("Preserve this business draft");
    expect(host.querySelector("fieldset")?.disabled).toBe(true);
    await act(async () => button("Verify account access").click());
    expect(mocks.verify).toHaveBeenCalledWith({ provider: "meta" });
    mocks.rows = [saved];
    await render();
    expect(host.querySelector("fieldset")?.disabled).toBe(false);
    expect(host.querySelector("textarea")).toBe(caption);
    expect(caption.value).toBe("Preserve this business draft");
    mocks.rows = [{ ...saved, connected: false, status: "reconnect_required" }];
    await render();
    expect(host.textContent).toContain("Reconnect required");
    expect(host.querySelector("textarea")).toBe(caption);
  });
  it("does not approve a post when access preflight fails or silently retry it", async () => {
    mocks.posts = [
      {
        _id: "draft1",
        connectionId: "connection1",
        assetId: "page1",
        provider: "meta",
        assetName: "Customer business",
        kind: "facebook_page",
        text: "Exact post",
        status: "draft",
        revision: 3,
      },
    ];
    mocks.verify.mockRejectedValueOnce(new Error("Needs reconnect"));
    await workspace({ ...baseRow, publishEnabled: true, scopes: ["pages_manage_posts"] });
    await act(async () => button("Approve and publish this post").click());
    expect(mocks.verify).toHaveBeenCalledTimes(1);
    expect(mocks.approve).not.toHaveBeenCalled();
    expect(host.textContent).toContain("Approval could not be confirmed");
  });
});
