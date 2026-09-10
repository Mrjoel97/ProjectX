// @vitest-environment jsdom
import { getFunctionName } from "convex/server";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { VerticalPackRecommendations } from "./VerticalPackRecommendations";

const configure = vi.fn();
const start = vi.fn();
const disable = vi.fn();
const sourceQueries = vi.fn();
let profile: unknown;
let pages: Record<
  string,
  { docs: Array<{ docId: string; title: string }>; nextCursor: string | null } | undefined
>;
let sourceFailure = false;
vi.mock("convex/react", () => ({
  useQuery: (ref: never, args: { cursor?: string }) => {
    switch (getFunctionName(ref)) {
      case "verticalPacks:discover":
        return { recommendations: [], controls: [], partialHistory: false };
      case "tenantProfile:get":
        return profile;
      case "verticalPacks:workloadSources":
        sourceQueries(args);
        if (sourceFailure) throw new Error("private backend detail");
        return pages[args.cursor ?? "first"];
      default:
        throw new Error(`Unexpected query ${getFunctionName(ref)}`);
    }
  },
  useAction: (ref: never) => {
    expect(getFunctionName(ref)).toBe("cockpit:startVerticalPack");
    return start;
  },
  useMutation: (ref: never) => {
    if (getFunctionName(ref) === "verticalPacks:configure") return configure;
    expect(getFunctionName(ref)).toBe("verticalPacks:setDisabled");
    return disable;
  },
}));

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  configure.mockReset();
  start.mockReset();
  disable.mockReset();
  sourceQueries.mockReset();
  profile = {
    verticalPreferences: {
      needs: ["legal"],
      reviewReady: ["legal"],
      legalPlaybookDocId: "playbook-a",
    },
  };
  pages = {
    first: {
      docs: [
        { docId: "doc-a", title: "Existing launch brief" },
        { docId: "doc-b", title: "Last quarter review" },
        { docId: "doc-c", title: "Another example" },
      ],
      nextCursor: null,
    },
  };
  sourceFailure = false;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.restoreAllMocks();
});
const render = async () => act(async () => root.render(createElement(VerticalPackRecommendations)));
const button = (text: string) =>
  [...host.querySelectorAll("button")].find((item) => item.textContent?.includes(text));
const click = async (text: string) => {
  const target = button(text);
  expect(target).toBeDefined();
  await act(async () => target?.click());
};
const open = async () => {
  await render();
  const details = host.querySelector("details");
  expect(details).not.toBeNull();
  await act(async () => {
    if (details) {
      details.open = true;
      details.dispatchEvent(new Event("toggle"));
    }
  });
};
const chooseWork = async (value = "product") => {
  const select = host.querySelector("select");
  expect(select).not.toBeNull();
  await act(async () => {
    if (select) {
      select.value = value;
      select.dispatchEvent(new Event("change", { bubbles: true }));
    }
  });
};
const checkbox = (label: string) =>
  [...host.querySelectorAll("label")]
    .find((item) => item.textContent?.includes(label))
    ?.querySelector<HTMLInputElement>('input[type="checkbox"]');
const check = async (label: string) => {
  const target = checkbox(label);
  expect(target).toBeDefined();
  await act(async () => target?.click());
};
const selectTwo = async () => {
  await check("Existing launch brief");
  await check("Last quarter review");
};

test("an empty recommendation set still offers a collapsed preference form without loading documents", async () => {
  await render();
  expect(host.textContent).toContain("Show work you do repeatedly");
  expect(host.querySelector("select")).toBeNull();
  expect(host.textContent).not.toContain("Start workflow");
  expect(sourceQueries).not.toHaveBeenCalled();
  expect(configure).not.toHaveBeenCalled();
});

test("loading and empty pages stay honest and an empty page can still advance", async () => {
  profile = undefined;
  await open();
  expect(host.textContent).toContain("Loading your saved preferences");
  expect(host.querySelector("select")).toBeNull();
  profile = { verticalPreferences: { needs: [], reviewReady: [] } };
  pages.first = undefined;
  await render();
  await chooseWork();
  expect(host.textContent).toContain("Loading your Vault documents");
  expect(button("Save examples")?.disabled).toBe(true);
  pages.first = { docs: [], nextCursor: "page-two" };
  pages["page-two"] = { docs: [{ docId: "doc-d", title: "Older plan" }], nextCursor: null };
  await render();
  expect(host.textContent).toContain("No available documents on this page");
  await click("More documents");
  expect(sourceQueries).toHaveBeenLastCalledWith({ cursor: "page-two" });
  expect(host.textContent).toContain("Older plan");
  await click("Previous documents");
  expect(sourceQueries).toHaveBeenLastCalledWith({});
});

test("two distinct selections and explicit need confirmation are required, while other preferences are preserved", async () => {
  await open();
  await chooseWork();
  await selectTwo();
  expect(host.textContent).toContain("2 of 2 examples selected");
  expect(checkbox("Another example")?.disabled).toBe(true);
  expect(button("Save examples")?.disabled).toBe(true);
  await check("This work repeats");
  expect(button("Save examples")?.disabled).toBe(false);
  configure.mockResolvedValue(undefined);
  await click("Save examples");
  expect(configure).toHaveBeenCalledExactlyOnceWith({
    needs: ["legal", "product"],
    reviewReady: ["legal"],
    legalPlaybookDocId: "playbook-a",
    confirmWorkload: { verticalId: "product", artifactIds: ["doc-a", "doc-b"] },
  });
  expect(host.textContent).toContain("Examples saved");
  expect(host.textContent).toContain("record of past work if a document is later removed");
  expect(start).not.toHaveBeenCalled();
  expect(disable).not.toHaveBeenCalled();
  expect(checkbox("This work repeats")?.checked).toBe(false);
});

test("saved confirmations follow profile updates and changing examples requires new confirmation", async () => {
  await open();
  await chooseWork();
  await selectTwo();
  await check("This work repeats");
  await act(async () => {
    host
      .querySelector<HTMLButtonElement>('button[aria-label="Remove Existing launch brief"]')
      ?.click();
  });
  expect(checkbox("This work repeats")?.checked).toBe(false);
  await check("Another example");
  expect(button("Save examples")?.disabled).toBe(true);
  await check("This work repeats");
  await click("Save examples");
  const confirmedAt = Date.UTC(2026, 8, 10, 12);
  profile = {
    verticalPreferences: {
      needs: ["legal", "product"],
      reviewReady: ["legal"],
      legalPlaybookDocId: "playbook-a",
      confirmedWorkloads: [{ verticalId: "product", artifactIds: ["doc-b", "doc-c"], confirmedAt }],
    },
  };
  await render();
  expect(host.textContent).toContain(
    `Past examples recorded on ${new Date(confirmedAt).toLocaleDateString()}`,
  );
  expect(host.textContent).toContain("Saving replaces those examples for this type of work");
  expect(checkbox("This work repeats")?.checked).toBe(false);
  expect(start).not.toHaveBeenCalled();
});

test("selections survive page navigation, cannot duplicate an id, and changing work clears consent", async () => {
  pages.first = { docs: [{ docId: "doc-a", title: "Existing launch brief" }], nextCursor: "next" };
  pages.next = {
    docs: [
      { docId: "doc-a", title: "Existing launch brief" },
      { docId: "doc-b", title: "Last quarter review" },
    ],
    nextCursor: null,
  };
  await open();
  await chooseWork();
  await check("Existing launch brief");
  await click("More documents");
  expect(checkbox("Existing launch brief")?.checked).toBe(true);
  await check("Existing launch brief");
  expect(host.textContent).toContain("0 of 2 examples selected");
  await selectTwo();
  await check("This work repeats");
  await chooseWork("engineering");
  expect(host.textContent).toContain("0 of 2 examples selected");
  expect(checkbox("This work repeats")?.checked).toBe(false);
  expect(button("Save examples")?.disabled).toBe(true);
  expect(sourceQueries).toHaveBeenLastCalledWith({});
});

test("pending saves prevent duplicate submissions and uncertain failures retain editable selections", async () => {
  let rejectSave: (reason: Error) => void = () => {};
  configure.mockReturnValue(
    new Promise((_, reject) => {
      rejectSave = reject;
    }),
  );
  await open();
  await chooseWork();
  await selectTwo();
  await check("This work repeats");
  await click("Save examples");
  expect(button("Saving examples")?.disabled).toBe(true);
  expect(host.querySelector("select")?.disabled).toBe(true);
  await act(async () =>
    host
      .querySelector("form")
      ?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
  );
  expect(configure).toHaveBeenCalledOnce();
  await act(async () => rejectSave(new Error("private document removed")));
  expect(host.querySelector('[role="alert"]')?.textContent).toContain("could not be confirmed");
  expect(host.textContent).not.toContain("private document removed");
  expect(host.textContent).toContain("2 of 2 examples selected");
  configure.mockResolvedValue(undefined);
  await click("Save examples");
  expect(configure).toHaveBeenCalledTimes(2);
  expect(host.textContent).toContain("Examples saved");
});

test("query failures degrade locally and offer a real retry", async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  await open();
  sourceFailure = true;
  await chooseWork();
  expect(host.querySelector('[role="alert"]')?.textContent).toContain("could not be loaded");
  expect(host.textContent).not.toContain("private backend detail");
  sourceFailure = false;
  await click("Try again");
  await chooseWork();
  expect(host.textContent).toContain("Existing launch brief");
  expect(configure).not.toHaveBeenCalled();
});
