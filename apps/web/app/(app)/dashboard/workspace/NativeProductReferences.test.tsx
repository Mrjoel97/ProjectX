// @vitest-environment jsdom
import { getFunctionName } from "convex/server";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

const fixture = vi.hoisted(() => ({
  options: undefined as
    | undefined
    | null
    | {
        selectedDocIds: string[];
        images: {
          docId: string;
          title: string;
          url: string | null;
          mimeType: string;
          size: number;
        }[];
      },
  query: vi.fn(),
  save: vi.fn(),
}));
vi.mock("convex/react", () => ({
  useQuery: (ref: Parameters<typeof getFunctionName>[0], args: unknown) => {
    fixture.query(getFunctionName(ref), args);
    return fixture.options;
  },
  useMutation: (ref: Parameters<typeof getFunctionName>[0]) => {
    if (getFunctionName(ref) !== "media:setProductReferences") throw Error("Unexpected mutation");
    return fixture.save;
  },
}));

import { NativeProductReferences } from "./NativeProductReferences";

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
const planId = "exact_native_plan" as never;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  fixture.query.mockClear();
  fixture.save.mockReset().mockResolvedValue({ ok: true });
  fixture.options = {
    selectedDocIds: ["front"],
    images: ["front", "side", "detail", "other_product"].map((docId) => ({
      docId,
      title: `Photo ${docId}`,
      url: `https://owned.example.test/${docId}`,
      mimeType: "image/png",
      size: 100,
    })),
  };
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});
async function show(locked = false, onSavingChange = vi.fn()) {
  await act(async () =>
    root.render(
      <NativeProductReferences planId={planId} locked={locked} onSavingChange={onSavingChange} />,
    ),
  );
  return onSavingChange;
}
const boxes = () => [...host.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')];

test("only reads the exact plan and never assigns images or starts generation on opening", async () => {
  await show();
  expect(fixture.query).toHaveBeenCalledWith("media:productReferenceOptions", { planId });
  expect(fixture.save).not.toHaveBeenCalled();
  expect(boxes().map((box) => box.checked)).toEqual([true, false, false, false]);
  expect(host.textContent).toContain("Product images · 1 selected");
  expect(host.textContent).toContain("Choose separately for each product in a batch");
});

test("explicit selection saves only the chosen IDs for this plan and explains fresh review", async () => {
  const saving = await show();
  await act(async () => boxes()[1]?.click());
  expect(fixture.save).toHaveBeenCalledExactlyOnceWith({ planId, docIds: ["front", "side"] });
  expect(saving.mock.calls.map(([value]) => value)).toEqual([true, false]);
  expect(host.textContent).toContain("Review the updated request and estimate before generating");
});

test("three selections disable additional images but still allow explicit removal", async () => {
  if (!fixture.options) throw Error("missing options");
  fixture.options.selectedDocIds = ["front", "side", "detail"];
  await show();
  expect(boxes()[3]?.disabled).toBe(true);
  await act(async () => boxes()[3]?.click());
  expect(fixture.save).not.toHaveBeenCalled();
  await act(async () => boxes()[0]?.click());
  expect(fixture.save).toHaveBeenCalledExactlyOnceWith({ planId, docIds: ["side", "detail"] });
});

test("locked films cannot change references", async () => {
  await show(true);
  expect(host.querySelector("fieldset")?.disabled).toBe(true);
  await act(async () => boxes()[1]?.click());
  expect(fixture.save).not.toHaveBeenCalled();
  expect(host.textContent).toContain("Product references are fixed");
});

test("pending saves block changes and a busy refusal preserves the original selection", async () => {
  let finish: (result: { ok: false; reason: string }) => void = () => {};
  fixture.save.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const saving = await show();
  await act(async () => boxes()[1]?.click());
  expect(host.querySelector("fieldset")?.disabled).toBe(true);
  expect(host.textContent).toContain("Saving product references");
  await act(async () => finish({ ok: false, reason: "media_busy" }));
  expect(host.textContent).toContain("cannot change while this film is being generated");
  expect(boxes().map((box) => box.checked)).toEqual([true, false, false, false]);
  expect(saving.mock.calls.map(([value]) => value)).toEqual([true, false]);
});

test("unavailable images and transport errors remain visible and permit a fresh retry", async () => {
  fixture.save.mockResolvedValueOnce({ ok: false, reason: "reference_unavailable" });
  await show();
  await act(async () => boxes()[1]?.click());
  expect(host.textContent).toContain("That image is unavailable");
  fixture.save.mockRejectedValueOnce(new Error("private backend error"));
  await act(async () => boxes()[1]?.click());
  expect(host.textContent).toContain("The selection could not be saved");
  expect(host.textContent).not.toContain("private backend error");
  await act(async () => boxes()[1]?.click());
  expect(fixture.save).toHaveBeenCalledTimes(3);
  expect(host.textContent).toContain("Product references saved");
});
