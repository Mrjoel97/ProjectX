// @vitest-environment jsdom
import { getFunctionName } from "convex/server";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { VerticalArtifactReview } from "./VerticalArtifactReview";

const record = vi.fn();
let target: { verticalId: string; decision: "approve" | "reject" | null } | null | undefined;
vi.mock("convex/react", () => ({
  useQuery: (ref: never, args: { artifactId: string }) => {
    expect(getFunctionName(ref)).toBe("verticalPacks:reviewTarget");
    expect(args).toEqual({ artifactId: "doc-a" });
    return target;
  },
  useMutation: (ref: never) => {
    expect(getFunctionName(ref)).toBe("verticalPacks:recordReview");
    return record;
  },
}));

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  target = { verticalId: "product", decision: null };
  record.mockReset();
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
