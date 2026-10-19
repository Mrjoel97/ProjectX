// @vitest-environment jsdom
import { type FunctionReference, getFunctionName } from "convex/server";
import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  prepare: vi.fn(),
  submit: vi.fn(),
  transcribe: vi.fn(),
  send: vi.fn(),
  upload: vi.fn(),
  generate: vi.fn(),
  trackStop: vi.fn(),
  getMedia: vi.fn(),
}));
vi.mock("convex/react", () => ({
  useQuery: () => null,
  useMutation: () => mocks.generate,
  useAction: (ref: FunctionReference<"action">) =>
    ({
      "cockpit:prepareIntakeThread": mocks.prepare,
      "intake:submitInputs": mocks.submit,
      "intake:transcribeDraft": mocks.transcribe,
      "cockpit:sendCockpitMessage": mocks.send,
    })[getFunctionName(ref)],
}));
vi.mock("@convex-dev/agent/react", () => ({
  useThreadMessages: () => ({ results: [], status: "Exhausted" }),
}));
vi.mock("../../../lib/normalizeAudio", () => ({
  normalizeAudio: async () => new Blob(["PCM audio"], { type: "audio/wav" }),
}));

import { ChatPane } from "./ChatPane";

class Recorder {
  stream: MediaStream;
  state = "inactive";
  mimeType = "audio/webm";
  ondataavailable?: (event: { data: Blob }) => void;
  onstop?: () => void;
  constructor(stream: MediaStream) {
    this.stream = stream;
  }
  start() {
    this.state = "recording";
  }
  stop() {
    this.state = "inactive";
    this.ondataavailable?.({ data: new Blob(["voice"]) });
    this.onstop?.();
  }
}
let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
function Composer({ existing }: { existing?: string }) {
  const [threadId, setThreadId] = useState(existing);
  const [sending, setSending] = useState(false);
  return (
    <ChatPane
      threadId={threadId}
      onThread={(id) => setThreadId(id)}
      sending={sending}
      onSending={setSending}
    />
  );
}
beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset();
  mocks.prepare.mockResolvedValue({ threadId: "fresh" });
  mocks.submit.mockResolvedValue({ threadId: "fresh" });
  mocks.transcribe.mockResolvedValue({ text: "Review the new offer before Friday." });
  mocks.send.mockResolvedValue({ threadId: "fresh" });
  mocks.generate.mockResolvedValue("https://upload.invalid/test");
  mocks.upload.mockImplementation(async () => ({
    ok: true,
    json: async () => ({ storageId: `storage-${mocks.upload.mock.calls.length}` }),
  }));
  mocks.getMedia.mockResolvedValue({ getTracks: () => [{ stop: mocks.trackStop }] });
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("fetch", mocks.upload);
  vi.stubGlobal("MediaRecorder", Recorder);
  vi.stubGlobal("navigator", { mediaDevices: { getUserMedia: mocks.getMedia } });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});
function element<T extends Element>(selector: string): T {
  const found = host.querySelector<T>(selector);
  if (!found) throw new Error(`Missing ${selector}`);
  return found;
}
async function render(existing?: string) {
  await act(async () => root.render(<Composer existing={existing} />));
}
async function click(label: string) {
  await act(async () => element<HTMLButtonElement>(`button[aria-label="${label}"]`).click());
}
async function type(text: string) {
  await act(async () => {
    const input = element<HTMLTextAreaElement>("textarea");
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(input, text);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function pick(files: File[], folder = false) {
  await act(async () => {
    const input = element<HTMLInputElement>(
      `input[data-testid="attach-${folder ? "folder" : "file"}-input"]`,
    );
    Object.defineProperty(input, "files", { configurable: true, value: files });
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
}
test("file, folder and microphone are visible without Tools, and microphone stays next to Send", async () => {
  await render();
  expect(host.querySelector('summary[aria-label="Message tools"]')).toBeNull();
  for (const label of ["Attach a file", "Attach a folder", "Record dictation", "Send"])
    expect(element(`button[aria-label="${label}"]`)).toBeTruthy();
  const mic = element('button[aria-label="Record dictation"]');
  expect(mic.nextElementSibling).toBe(element('button[aria-label="Send"]'));
});
test("fresh voice becomes editable text and never sends or creates a thread until Send", async () => {
  await render();
  await click("Record dictation");
  expect(element<HTMLButtonElement>('button[aria-label="Send"]').disabled).toBe(true);
  await click("Stop recording");
  expect(mocks.transcribe).toHaveBeenCalledExactlyOnceWith({ storageId: expect.any(String) });
  expect(element<HTMLTextAreaElement>("textarea").value).toBe(
    "Review the new offer before Friday.",
  );
  expect(mocks.prepare).not.toHaveBeenCalled();
  expect(mocks.send).not.toHaveBeenCalled();
  expect(mocks.submit).not.toHaveBeenCalled();
  expect(mocks.trackStop).toHaveBeenCalled();
  await type("Review the new offer next Monday.");
  await click("Send");
  expect(mocks.send).toHaveBeenCalledExactlyOnceWith({
    threadId: undefined,
    text: "Review the new offer next Monday.",
    clientContext: { tz: expect.any(String), nowMs: expect.any(Number) },
  });
});
test("voice preserves existing written instructions and can recover from failed transcription without sending", async () => {
  mocks.transcribe.mockRejectedValueOnce(new Error("unavailable"));
  await render("existing");
  await type("Focus on our premium package.");
  await click("Record dictation");
  await click("Stop recording");
  expect(element<HTMLTextAreaElement>("textarea").value).toBe("Focus on our premium package.");
  expect(host.textContent).toContain("Nothing was sent to the agent");
  const retry = Array.from(host.querySelectorAll("button")).find(
    (button) => button.textContent === "Retry transcription",
  );
  expect(retry).toBeTruthy();
  await act(async () => retry?.click());
  expect(element<HTMLTextAreaElement>("textarea").value).toBe(
    "Focus on our premium package.\n\nReview the new offer before Friday.",
  );
  expect(mocks.send).not.toHaveBeenCalled();
  expect(mocks.submit).not.toHaveBeenCalled();
  expect(mocks.transcribe).toHaveBeenLastCalledWith({
    storageId: expect.any(String),
    threadId: "existing",
  });
});
test("a fresh folder sends once with optional instructions and no preliminary agent message", async () => {
  await render();
  const files = [
    new File(["one"], "one.txt", { type: "text/plain" }),
    new File(["two"], "two.txt", { type: "text/plain" }),
  ];
  for (const file of files) {
    Object.defineProperty(file, "webkitRelativePath", { value: `Reports/${file.name}` });
  }
  await pick(files, true);
  expect(mocks.upload).not.toHaveBeenCalled();
  expect(mocks.prepare).not.toHaveBeenCalled();
  expect(element<HTMLButtonElement>('button[aria-label="Send"]').disabled).toBe(false);
  await type("Compare the reports.");
  await click("Send");
  expect(mocks.prepare).toHaveBeenCalledExactlyOnceWith({});
  expect(mocks.submit).toHaveBeenCalledExactlyOnceWith({
    threadId: "fresh",
    instructions: "Compare the reports.",
    files: [
      { storageId: "storage-1", filename: "Reports/one.txt", mimeType: "text/plain" },
      { storageId: "storage-2", filename: "Reports/two.txt", mimeType: "text/plain" },
    ],
    clientContext: { tz: expect.any(String), nowMs: expect.any(Number) },
  });
  expect(mocks.send).not.toHaveBeenCalled();
  expect(host.querySelector('[data-testid="pending-intake"]')).toBeNull();
});
test("file-only sends need no text, and partial upload failures keep inputs and reuse uploaded files on retry", async () => {
  mocks.upload
    .mockResolvedValueOnce({ ok: true, json: async () => ({ storageId: "first" }) })
    .mockResolvedValueOnce({ ok: false });
  await render();
  await pick([
    new File(["one"], "one.txt", { type: "text/plain" }),
    new File(["two"], "two.txt", { type: "text/plain" }),
  ]);
  await click("Send");
  expect(mocks.submit).not.toHaveBeenCalled();
  expect(host.textContent).toContain("Your inputs are kept");
  expect(host.textContent).toContain("one.txt");
  expect(host.textContent).toContain("two.txt");
  await click("Send");
  expect(mocks.prepare).toHaveBeenCalledTimes(1);
  expect(mocks.upload).toHaveBeenCalledTimes(3);
  expect(mocks.submit).toHaveBeenCalledExactlyOnceWith({
    threadId: "fresh",
    instructions: undefined,
    files: [
      { storageId: "first", filename: "one.txt", mimeType: "text/plain" },
      { storageId: "storage-3", filename: "two.txt", mimeType: "text/plain" },
    ],
    clientContext: { tz: expect.any(String), nowMs: expect.any(Number) },
  });
  expect(mocks.send).not.toHaveBeenCalled();
});
