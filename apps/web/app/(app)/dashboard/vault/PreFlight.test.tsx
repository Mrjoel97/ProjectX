// @vitest-environment jsdom

import { getFunctionName } from "convex/server";
import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, test, vi } from "vitest";
import { PreFlight, type StartPhase } from "./PreFlight";

const state = vi.hoisted(() => ({
  create: vi.fn().mockResolvedValue({ folderId: "folder" }),
  cancel: vi.fn().mockResolvedValue(null),
  reserve: vi.fn(),
  ticket: vi.fn().mockResolvedValue("https://upload.test"),
  attach: vi.fn(),
  normalize: vi.fn(),
}));
vi.mock("convex/react", () => ({
  useAction: () => state.attach,
  useMutation: (fn: Parameters<typeof getFunctionName>[0]) => {
    switch (getFunctionName(fn)) {
      case "vaultFolders:createFolder":
        return state.create;
      case "vaultFolders:cancelFolder":
        return state.cancel;
      case "vaultFolders:reserveFolder":
        return state.reserve;
      default:
        return state.ticket;
    }
  },
  useQuery: () => ({
    perFile: [{ cents: 1 }, { cents: 1 }],
    estimateCents: 2,
    remainingCents: 100,
  }),
}));
vi.mock("../../../lib/normalizeAudio", () => ({ normalizeAudio: state.normalize }));
vi.mock("./DocGrid", () => ({ fmtSize: (size: number) => String(size) }));
vi.mock("./Dropzone", () => ({ pillPrimary: () => ({}), pillSecondary: () => ({}) }));

const roots: ReturnType<typeof createRoot>[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await act(async () => root.unmount());
  document.body.replaceChildren();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

test.each([
  "text/plain",
  "audio/wav",
])("Cancel aborts the active %s transfer without attaching or starting another file", async (mimeType) => {
  const cleared = vi.fn();
  state.normalize.mockResolvedValue(new Blob(["pcm"], { type: "audio/wav" }));
  let signal: AbortSignal | undefined;
  const transport = vi.fn(
    (_url: string, options: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        signal = options.signal as AbortSignal;
        signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), {
          once: true,
        });
      }),
  );
  vi.stubGlobal("fetch", transport);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const files = [
    new File(["one"], "one", { type: mimeType }),
    new File(["two"], "two", { type: mimeType }),
  ];
  function Harness() {
    const [phase, setPhase] = useState<StartPhase>({ kind: "idle" });
    return (
      <PreFlight
        picked={{
          name: "Test",
          files,
          manifest: files.map((f) => ({ size: f.size, mimeType })),
          totalBytes: 6,
        }}
        phase={phase}
        onPhase={setPhase}
        onClear={cleared}
      />
    );
  }
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  roots.push(root);
  await act(async () => root.render(<Harness />));
  const button = (name: string) =>
    Array.from(host.querySelectorAll("button")).find((b) => b.textContent === name);
  await act(async () => button("Start")?.click());
  expect(transport).toHaveBeenCalledTimes(1);
  expect(signal?.aborted).toBe(false);
  await act(async () => button("Cancel")?.click());
  expect(signal?.aborted).toBe(true);
  expect(state.ticket).toHaveBeenCalledTimes(1);
  expect(state.attach).not.toHaveBeenCalled();
  expect(state.reserve).not.toHaveBeenCalled();
  expect(state.cancel).toHaveBeenCalledWith({ folderId: "folder" });
  expect(cleared).toHaveBeenCalledOnce();
});
