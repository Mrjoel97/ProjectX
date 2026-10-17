// @vitest-environment jsdom
import { getFunctionName } from "convex/server";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { useVoiceSession, type VoiceSession } from "./useVoiceSession";

const mocks = vi.hoisted(() => ({ connect: vi.fn(), post: vi.fn(), end: vi.fn(), abort: vi.fn() }));
vi.mock("convex/react", () => ({
  useAction: () => mocks.connect,
  useQuery: () => undefined,
  useMutation: (fn: unknown) =>
    ({
      "voice:sendText": mocks.post,
      "voice:endSessionClean": mocks.end,
      "voice:abortSession": mocks.abort,
    })[getFunctionName(fn as Parameters<typeof getFunctionName>[0])],
}));
function deferred<T>() {
  let resolve!: (x: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
function stream() {
  const track = { stop: vi.fn(), addEventListener: vi.fn() };
  return {
    track,
    value: { getTracks: () => [track], getAudioTracks: () => [track] } as unknown as MediaStream,
  };
}
let voice: VoiceSession;
let root: ReturnType<typeof createRoot>;
let getUserMedia: ReturnType<typeof vi.fn>;
let replaceTrack: ReturnType<typeof vi.fn>;
let setRemoteDescription: ReturnType<typeof vi.fn>;
function Probe() {
  voice = useVoiceSession();
  return null;
}
beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  getUserMedia = vi.fn();
  replaceTrack = vi.fn().mockResolvedValue(undefined);
  setRemoteDescription = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal("navigator", { mediaDevices: { getUserMedia } });
  vi.stubGlobal("RTCRtpSender", {
    getCapabilities: () => ({ codecs: [{ mimeType: "audio/opus" }] }),
  });
  vi.stubGlobal(
    "RTCPeerConnection",
    class {
      addTrack() {
        return { replaceTrack };
      }
      getTransceivers() {
        return [{ setCodecPreferences: vi.fn() }];
      }
      createOffer() {
        return Promise.resolve({ sdp: "offer" });
      }
      setLocalDescription() {
        return Promise.resolve();
      }
      setRemoteDescription() {
        return setRemoteDescription();
      }
      close() {}
    },
  );
  mocks.connect.mockResolvedValue({
    sessionId: "session",
    endsAt: Date.now() + 300000,
    answerSdp: "answer",
  });
  mocks.post.mockResolvedValue(null);
  mocks.end.mockResolvedValue(null);
  mocks.abort.mockResolvedValue(null);
  root = createRoot(document.createElement("div"));
  await act(async () => root.render(<Probe />));
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});
test("connecting input is refused without a fake transcript or command", async () => {
  const mic = deferred<MediaStream>();
  getUserMedia.mockReturnValue(mic.promise);
  let pending!: Promise<void>;
  await act(async () => {
    pending = voice.start();
  });
  expect(voice.status).toBe("connecting");
  expect(await voice.sendText("retain me")).toBe(false);
  expect(mocks.post).not.toHaveBeenCalled();
  expect(voice.transcript).toEqual([]);
  await act(async () => voice.end());
  const late = stream();
  await act(async () => {
    mic.resolve(late.value);
    await pending;
  });
  expect(late.track.stop).toHaveBeenCalled();
  expect(mocks.connect).not.toHaveBeenCalled();
  expect(voice.status).toBe("ended");
});
test("unmount stops a late microphone and never starts a provider call", async () => {
  const mic = deferred<MediaStream>();
  getUserMedia.mockReturnValue(mic.promise);
  let pending!: Promise<void>;
  await act(async () => {
    pending = voice.start();
  });
  await act(async () => root.unmount());
  const late = stream();
  await act(async () => {
    mic.resolve(late.value);
    await pending;
  });
  expect(late.track.stop).toHaveBeenCalled();
  expect(mocks.connect).not.toHaveBeenCalled();
});
test("ending during provider connection aborts the late returned session", async () => {
  getUserMedia.mockResolvedValue(stream().value);
  const connection = deferred<unknown>();
  mocks.connect.mockReturnValue(connection.promise);
  let pending!: Promise<void>;
  await act(async () => {
    pending = voice.start();
  });
  await act(async () => voice.end());
  await act(async () => {
    connection.resolve({ sessionId: "late", endsAt: Date.now() + 300000, answerSdp: "answer" });
    await pending;
  });
  expect(mocks.abort).toHaveBeenCalledWith({ sessionId: "late" });
  expect(voice.status).toBe("ended");
});
test("late microphone reconnect cannot resurrect an ended session", async () => {
  const initial = stream();
  getUserMedia.mockResolvedValueOnce(initial.value);
  await act(async () => voice.start());
  const lost = initial.track.addEventListener.mock.calls.find(([event]) => event === "ended")?.[1];
  await act(async () => lost());
  expect(voice.status).toBe("paused");
  const mic = deferred<MediaStream>();
  getUserMedia.mockReturnValue(mic.promise);
  let pending!: Promise<void>;
  await act(async () => {
    pending = voice.reconnect();
  });
  await act(async () => voice.end());
  const late = stream();
  await act(async () => {
    mic.resolve(late.value);
    await pending;
  });
  expect(late.track.stop).toHaveBeenCalled();
  expect(replaceTrack).not.toHaveBeenCalled();
  expect(voice.status).toBe("ended");
});
test("failed text is not displayed as delivered; successful text is acknowledged", async () => {
  getUserMedia.mockResolvedValue(stream().value);
  await act(async () => voice.start());
  mocks.post.mockRejectedValueOnce(new Error("offline"));
  await act(async () => expect(await voice.sendText("retry me")).toBe(false));
  expect(voice.transcript).toEqual([]);
  await act(async () => expect(await voice.sendText("retry me")).toBe(true));
  expect(voice.transcript.map((t) => t.text)).toEqual(["retry me"]);
});
test("countdown indicates approaching cap without sending a browser wrap-up command", async () => {
  vi.useFakeTimers();
  mocks.connect.mockResolvedValue({
    sessionId: "session",
    endsAt: Date.now() + 121000,
    answerSdp: "answer",
  });
  getUserMedia.mockResolvedValue(stream().value);
  await act(async () => voice.start());
  await act(async () => vi.advanceTimersByTime(2000));
  expect(voice.nearingCap).toBe(true);
  expect(mocks.post).not.toHaveBeenCalled();
  expect(voice.status).toBe("live");
});

test("a fresh session resets mic-loss state and rejects callbacks from the old track", async () => {
  const first = stream();
  getUserMedia.mockResolvedValueOnce(first.value);
  await act(async () => voice.start());
  const oldLost = first.track.addEventListener.mock.calls.find(([event]) => event === "ended")?.[1];
  await act(async () => oldLost());
  await act(async () => voice.end());
  const second = stream();
  getUserMedia.mockResolvedValueOnce(second.value);
  await act(async () => voice.start());
  await act(async () => oldLost());
  expect(voice.status).toBe("live");
  const newLost = second.track.addEventListener.mock.calls.find(
    ([event]) => event === "ended",
  )?.[1];
  await act(async () => newLost());
  expect(voice.status).toBe("paused");
});

test("unmount aborts a known provider session while remote SDP is still pending", async () => {
  const remote = deferred<void>();
  setRemoteDescription.mockReturnValue(remote.promise);
  const mic = stream();
  getUserMedia.mockResolvedValue(mic.value);
  let pending!: Promise<void>;
  await act(async () => {
    pending = voice.start();
  });
  expect(setRemoteDescription).toHaveBeenCalled();
  await act(async () => root.unmount());
  expect(mocks.abort).toHaveBeenCalledExactlyOnceWith({ sessionId: "session" });
  expect(mic.track.stop).toHaveBeenCalled();
  await act(async () => {
    remote.resolve();
    await pending;
  });
  expect(mocks.abort).toHaveBeenCalledTimes(1);
});
test("unmount after clean end does not request a second provider termination", async () => {
  getUserMedia.mockResolvedValue(stream().value);
  await act(async () => voice.start());
  await act(async () => voice.end());
  await act(async () => root.unmount());
  expect(mocks.end).toHaveBeenCalledExactlyOnceWith({ sessionId: "session" });
  expect(mocks.abort).not.toHaveBeenCalled();
});
