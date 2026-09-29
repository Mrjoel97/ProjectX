// @vitest-environment jsdom
import { getFunctionName } from "convex/server";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { VerticalArtifactReview } from "./VerticalArtifactReview";

const record = vi.fn();
const save = vi.fn();
let target:
  | { verticalId: string; decision: "approve" | "reject" | "edit" | null }
  | null
  | undefined;
let artifact: { text: string; status: string } | null | undefined;
vi.mock("convex/react", () => ({
  useQuery: (ref: never, args: { artifactId?: string; vaultDocId?: string }) => {
    const name = getFunctionName(ref);
    if (name === "verticalPacks:reviewTarget") {
      expect(args).toEqual({ artifactId: "doc-a" });
      return target;
    }
    expect(name).toBe("vault:vaultDocText");
    expect(args).toEqual({ vaultDocId: "doc-a" });
    return artifact;
  },
  useMutation: (ref: never) => {
    expect(getFunctionName(ref)).toBe("verticalPacks:recordReview");
    return record;
  },
  useAction: (ref: never) => {
    expect(getFunctionName(ref)).toBe("verticalArtifactEdit:save");
    return save;
  },
}));

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  target = { verticalId: "product", decision: null };
  artifact = { text: "Original draft", status: "ready" };
  record.mockReset();
  save.mockReset();
  save.mockResolvedValue({ saved: true });
  record.mockResolvedValue({ recorded: true, decision: "approve" });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});
const render = async () =>
  act(async () =>
    root.render(createElement(VerticalArtifactReview, { artifactId: "doc-a" as never })),
  );
const click = async (label: string) => {
  const button = [...host.querySelectorAll("button")].find((item) => item.textContent === label);
  expect(button).toBeDefined();
  await act(async () => button?.click());
};

test("no review control appears without a verified ordinary vertical artifact", async () => {
  target = undefined;
  await render();
  expect(host.textContent).toBe("");
  target = null;
  await render();
  expect(host.querySelector("button")).toBeNull();
  expect(record).not.toHaveBeenCalled();
});

test("authenticated decision buttons call only the exact artifact review mutation", async () => {
  await render();
  expect(host.textContent).toContain("does not publish");
  await click("Mark acceptable");
  expect(record).toHaveBeenCalledExactlyOnceWith({ artifactId: "doc-a", decision: "approve" });
  target = { verticalId: "product", decision: "approve" };
  await render();
  expect(host.querySelector('p[role="status"]')?.textContent).toContain("acceptable");
  expect(host.querySelector("button")).toBeNull();
});

test("a rejected or failed review stays explicit rather than looking accepted", async () => {
  record.mockRejectedValue(new Error("STALE_ARTIFACT"));
  await render();
  await click("Needs changes");
  expect(record).toHaveBeenCalledExactlyOnceWith({ artifactId: "doc-a", decision: "reject" });
  expect(host.querySelector('p[role="alert"]')?.textContent).toContain("could not be recorded");
  expect(host.querySelector('p[role="status"]')).toBeNull();
});

test("edit opens the persisted text, refuses no-op and calls only the authenticated edit action", async () => {
  await render();
  await click("Edit draft");
  const textarea = host.querySelector("textarea");
  expect(textarea?.value).toBe("Original draft");
  expect(
    [...host.querySelectorAll("button")].find((b) => b.textContent === "Save edited draft")
      ?.disabled,
  ).toBe(true);
  await act(async () => {
    if (textarea) {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
      setter?.call(textarea, "Human revision");
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    }
  });
  await click("Save edited draft");
  expect(save).toHaveBeenCalledExactlyOnceWith({ artifactId: "doc-a", markdown: "Human revision" });
  expect(record).not.toHaveBeenCalled();
  target = { verticalId: "product", decision: "edit" };
  artifact = { text: "Human revision", status: "ready" };
  await render();
  expect(host.querySelector('p[role="status"]')?.textContent).toContain("edited draft saved");
});

test("a table-free spreadsheet edit shows an actionable refusal without a review outcome", async () => {
  save.mockRejectedValue(new Error("ARTIFACT_EDIT_NO_TABLE"));
  await render();
  await click("Edit draft");
  const textarea = host.querySelector("textarea");
  await act(async () => {
    if (textarea) {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(
        textarea,
        "No table",
      );
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    }
  });
  await click("Save edited draft");
  expect(host.querySelector('p[role="alert"]')?.textContent).toContain("needs a Markdown table");
  expect(host.querySelector('p[role="status"]')).toBeNull();
  expect(record).not.toHaveBeenCalled();
});

test("an ambiguous save failure does not claim the original artifact survived", async () => {
  save.mockRejectedValue(new Error("NETWORK_RESPONSE_LOST"));
  await render();
  await click("Edit draft");
  const textarea = host.querySelector("textarea");
  await act(async () => {
    if (textarea) {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(
        textarea,
        "Human revision",
      );
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    }
  });
  await click("Save edited draft");
  expect(host.querySelector('p[role="alert"]')?.textContent).toContain(
    "Reopen the artifact to check whether your edit was saved",
  );
  expect(host.querySelector('p[role="alert"]')?.textContent).not.toContain("unchanged");
  expect(host.querySelector('p[role="status"]')).toBeNull();
});
