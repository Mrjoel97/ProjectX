// @vitest-environment jsdom
import { getFunctionName } from "convex/server";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, test, vi } from "vitest";
import SocialWorkspace from "./SocialWorkspace";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
const calls = vi.hoisted(() => ({
  stage: vi.fn(async () => "draft"),
  upload: vi.fn(async () => "https://upload.example.test/owned"),
  verify: vi.fn(async () => ({ verified: true, accountName: "Customer Instagram" })),
}));
const posts: unknown[] = [];
const pickerRow = {
  provider: "meta" as const,
  connectionId: "ig-connection",
  assets: [{ id: "ig", name: "Customer Instagram", kind: "instagram" as const }],
  selectedAssetIds: ["ig"],
  publishEnabled: false,
  scopes: ["instagram_basic"],
};
vi.mock("convex/react", () => ({
  useQuery: () => posts,
  useAction: (ref: unknown) =>
    getFunctionName(ref as never) === "socialActions:verifyConnection" ? calls.verify : vi.fn(),
  useMutation: (ref: unknown) =>
    getFunctionName(ref as never) === "socialPublishing:stagePost" ? calls.stage : calls.upload,
}));
test("the same original image can be selected for consecutive customer drafts", async () => {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const fetcher = vi.fn(async () => ({
    ok: true,
    json: async () => ({ storageId: "owned-storage" }),
  }));
  vi.stubGlobal("fetch", fetcher);
  try {
    await act(async () => root.render(<SocialWorkspace row={pickerRow} />));
    const account = host.querySelector("select")!;
    await act(async () => {
      account.value = "ig";
      account.dispatchEvent(new Event("change", { bubbles: true }));
    });
    const picker = host.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File([new Uint8Array([1, 2, 3])], "original.jpg", { type: "image/jpeg" });
    let nativePath = "";
    // Browsers emit no change for the same filename until the native selection is cleared.
    Object.defineProperty(picker, "value", {
      configurable: true,
      get: () => nativePath,
      set: (value: string) => {
        nativePath = value;
      },
    });
    Object.defineProperty(picker, "files", {
      configurable: true,
      get: () => (nativePath ? [file] : []),
    });
    async function chooseOriginal() {
      if (nativePath === "original.jpg") return false;
      await act(async () => {
        nativePath = "original.jpg";
        picker.dispatchEvent(new Event("change", { bubbles: true }));
      });
      return true;
    }
    async function caption(text: string) {
      const input = host.querySelector("textarea")!;
      await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(
          input,
          text,
        );
        input.dispatchEvent(new Event("input", { bubbles: true }));
      });
    }
    const save = () =>
      Array.from(host.querySelectorAll("button")).find(
        (b) => b.textContent === "Save draft for review",
      )!;
    await caption("First customer draft");
    expect(await chooseOriginal()).toBe(true);
    calls.verify.mockRejectedValueOnce(new Error("Access needs verification"));
    await act(async () => save().click());
    expect(calls.stage).not.toHaveBeenCalled();
    expect(fetcher).not.toHaveBeenCalled();
    expect(picker.value).toBe("original.jpg");
    expect(host.querySelector("textarea")?.value).toBe("First customer draft");
    expect(host.textContent).toContain("Your content is still in the composer");
    await act(async () => root.render(<SocialWorkspace row={pickerRow} accessReady={false} />));
    expect(host.querySelector("fieldset")?.disabled).toBe(true);
    expect(host.querySelector('input[type="file"]')).toBe(picker);
    expect(picker.value).toBe("original.jpg");
    await act(async () => root.render(<SocialWorkspace row={pickerRow} accessReady />));
    let finishSave: (postId: string) => void = () => {};
    calls.stage.mockImplementationOnce(
      () =>
        new Promise<string>((resolve) => {
          finishSave = resolve;
        }),
    );
    await act(async () => save().click());
    expect(calls.stage).toHaveBeenCalledTimes(1);
    // Native fieldset disabling keeps the caption, account and upload immutable while saving.
    expect(host.querySelector("fieldset")?.disabled).toBe(true);
    expect(host.querySelector("fieldset")?.getAttribute("aria-busy")).toBe("true");
    expect(host.querySelector("textarea")?.matches(":disabled")).toBe(true);
    expect(account.matches(":disabled")).toBe(true);
    expect(picker.matches(":disabled")).toBe(true);
    expect(host.querySelector("textarea")?.value).toBe("First customer draft");
    expect(picker.value).toBe("original.jpg");
    await act(async () => finishSave("draft"));
    expect(host.querySelector("fieldset")?.disabled).toBe(false);
    expect(host.querySelector("fieldset")?.getAttribute("aria-busy")).toBe("false");
    expect(picker.value).toBe("");
    await caption("Second customer draft");
    expect(await chooseOriginal()).toBe(true);
    expect(save().disabled).toBe(false);
    await act(async () => save().click());
    expect(calls.stage).toHaveBeenCalledTimes(2);
    expect(calls.stage).toHaveBeenLastCalledWith({
      provider: "meta",
      assetId: "ig",
      text: "Second customer draft",
      storageId: "owned-storage",
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(calls.verify).toHaveBeenCalledTimes(3);
  } finally {
    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  }
});
