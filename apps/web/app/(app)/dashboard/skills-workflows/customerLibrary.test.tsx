// @vitest-environment jsdom
import { type FunctionReference, getFunctionName } from "convex/server";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

const state = vi.hoisted(() => ({
  enabled: true,
  specialists: [] as Record<string, unknown>[],
  workflows: [] as Record<string, unknown>[],
  runs: [] as Record<string, unknown>[],
  mutate: vi.fn(),
  run: vi.fn(),
  open: vi.fn(),
  page: vi.fn(),
}));
vi.mock("convex/react", () => ({
  useQuery: (ref: FunctionReference<"query">) =>
    getFunctionName(ref) === "customerSpecialists:list"
      ? { enabled: state.enabled, specialists: state.specialists }
      : { enabled: state.enabled, workflows: state.workflows, runs: state.runs },
  useMutation: (ref: FunctionReference<"mutation">) => (args: unknown) =>
    state.mutate(getFunctionName(ref), args),
  useAction: () => state.run,
  usePaginatedQuery: (_ref: unknown, args: unknown) => {
    state.page(args);
    return {
      results: [{ _id: "doc-a", title: "Approved product facts" }],
      status: "Exhausted",
      loadMore: vi.fn(),
    };
  },
}));

import { CustomerSpecialistsPanel } from "./CustomerSpecialistsPanel";
import { CustomerWorkflowsPanel } from "./CustomerWorkflowsPanel";

const specialist = {
  _id: "specialist-a",
  name: "Retail buyer specialist",
  objective: "Prepare buyer-ready product stories",
  audience: "Independent retailers",
  instructions: "Use approved facts and concise language",
  knowledgeDocumentIds: ["doc-a"],
  revision: 1,
  archived: false,
};
const workflow = {
  _id: "workflow-a",
  name: "Buyer brief",
  specialistId: "specialist-a",
  specialistRevision: 1,
  revision: 2,
  steps: ["Identify the product's strengths", "Write the buyer brief"],
  archived: false,
};
let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  state.enabled = true;
  state.specialists = [specialist];
  state.workflows = [workflow];
  state.runs = [];
  state.mutate.mockReset().mockResolvedValue({});
  state.run
    .mockReset()
    .mockResolvedValue({ runId: "run-a", threadId: "thread-a", status: "completed" });
  state.open.mockReset();
  state.page.mockReset();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});
async function click(text: string) {
  const button = Array.from(host.querySelectorAll("button")).find(
    (item) => item.textContent === text,
  );
  expect(button, text).toBeTruthy();
  await act(async () => button?.click());
}
function value(name: string, text: string) {
  const field = host.querySelector<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(
    `[name="${name}"]`,
  );
  expect(field).toBeTruthy();
  if (field) field.value = text;
}
async function submit(label: string) {
  await act(async () =>
    host
      .querySelector(`form[aria-label="${label}"]`)
      ?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
  );
}

test("pilot off omits self-service controls and skips Vault choices", async () => {
  state.enabled = false;
  await act(async () =>
    root.render(
      <>
        <CustomerSpecialistsPanel />
        <CustomerWorkflowsPanel openThread={state.open} />
      </>,
    ),
  );
  expect(host.querySelector("form")).toBeNull();
  expect(host.querySelector("button")).toBeNull();
  expect(state.page).toHaveBeenCalledWith("skip");
});

test("a customer creates a named specialist with audience and selected private sources", async () => {
  await act(async () => root.render(<CustomerSpecialistsPanel />));
  await click("Create specialist");
  value("name", "Wholesale launch writer");
  value("objective", "Help launch to retail buyers");
  value("audience", "Boutique owners");
  value("instructions", "Write clear buyer benefits grounded in product facts");
  const checkbox = host.querySelector<HTMLInputElement>('[name="knowledge"]');
  if (checkbox) checkbox.checked = true;
  await submit("Create specialist");
  expect(state.mutate).toHaveBeenCalledWith("customerSpecialists:create", {
    name: "Wholesale launch writer",
    objective: "Help launch to retail buyers",
    audience: "Boutique owners",
    instructions: "Write clear buyer benefits grounded in product facts",
    knowledgeDocumentIds: ["doc-a"],
  });
  expect(host.querySelector("form")).toBeNull();
  expect(host.textContent).toContain("Choose this specialist");
});

test("workflow authoring pins the chosen specialist revision and ordered steps", async () => {
  await act(async () => root.render(<CustomerWorkflowsPanel openThread={state.open} />));
  await click("Create workflow");
  value("name", "Retail launch brief");
  value("specialist", "specialist-a");
  value("steps", "Review product facts\n\nPrepare the retailer brief");
  await submit("Create workflow");
  expect(state.mutate).toHaveBeenCalledWith("customerWorkflows:save", {
    name: "Retail launch brief",
    specialistId: "specialist-a",
    specialistRevision: 1,
    steps: ["Review product facts", "Prepare the retailer brief"],
  });
});

test("a transport retry reuses the exact run request and opens its real thread", async () => {
  state.run.mockRejectedValueOnce(new Error("Connection interrupted"));
  await act(async () => root.render(<CustomerWorkflowsPanel openThread={state.open} />));
  await click("Run Buyer brief");
  value("brief", "FORMA bottle for retail buyers");
  await submit("Run Buyer brief");
  const first = state.run.mock.calls[0]?.[0];
  if (!first) throw new Error("First workflow request was not submitted");
  expect(first).toMatchObject({
    workflowId: "workflow-a",
    expectedRevision: 2,
    brief: "FORMA bottle for retail buyers",
  });
  expect(first.requestId).toBeTruthy();
  expect(host.querySelector<HTMLTextAreaElement>('[name="brief"]')?.disabled).toBe(true);
  await submit("Run Buyer brief");
  expect(state.run.mock.calls[1]?.[0]).toEqual(first);
  expect(state.open).toHaveBeenCalledWith("thread-a", "Buyer brief");
  await click("Run Buyer brief");
  value("brief", "Summer linen shirt for retail buyers");
  await submit("Run Buyer brief");
  const third = state.run.mock.calls[2]?.[0];
  if (!third) throw new Error("Second product request was not submitted");
  expect(third.requestId).not.toBe(first.requestId);
  expect(third.brief).toBe("Summer linen shirt for retail buyers");
});

test("changed specialist versions and unresolved runs prevent starting stale or duplicate work", async () => {
  state.specialists = [{ ...specialist, revision: 2 }];
  await act(async () => root.render(<CustomerWorkflowsPanel openThread={state.open} />));
  const button = Array.from(host.querySelectorAll("button")).find(
    (item) => item.textContent === "Run Buyer brief",
  );
  expect(button?.disabled).toBe(true);
  state.specialists = [specialist];
  state.runs = [
    {
      _id: "run-a",
      workflowId: "workflow-a",
      workflowRevision: 2,
      status: "needs_review",
      threadId: "thread-a",
    },
  ];
  await act(async () => root.render(<CustomerWorkflowsPanel openThread={state.open} />));
  expect(button?.disabled).toBe(true);
  expect(host.textContent).toContain("needs review before another can start");
  await click("Open run");
  expect(state.open).toHaveBeenCalledWith("thread-a", "Workflow run");
  expect(state.run).not.toHaveBeenCalled();
});

test("checking interrupted work asks for reconciliation without starting another paid run", async () => {
  state.runs = [
    {
      _id: "run-a",
      workflowId: "workflow-a",
      workflowRevision: 2,
      status: "needs_review",
      threadId: "thread-a",
    },
  ];
  state.mutate.mockResolvedValue({ ...state.runs[0], status: "completed" });
  await act(async () => root.render(<CustomerWorkflowsPanel openThread={state.open} />));
  await click("Check run status");
  expect(state.mutate).toHaveBeenCalledWith("customerWorkflows:reconcile", { runId: "run-a" });
  expect(state.run).not.toHaveBeenCalled();
  expect(host.textContent).toContain("Your report is ready");
});
