"use client";

import { api } from "@pikar/backend/api";
import {
  CALLS_URL,
  CAP_MS,
  readUsage,
  REALTIME_CLIENT_EVENTS,
  REALTIME_EVENTS,
} from "@pikar/voice";
import type { FunctionArgs } from "convex/server";
import { useAction, useMutation } from "convex/react";
import { useCallback, useEffect, useRef, useState } from "react";

// The voiceSessions row id, derived from the mutation's own args (the IntakeControls precedent) so
// this client file never needs the Convex-only `dataModel` types (@pikar/backend exports only ./api).
type SessionId = FunctionArgs<typeof api.voice.recordUsage>["sessionId"];

// VOIC-01/02 — the browser half of the live voice session (RESEARCH Pattern 1). This hook owns the
// WebRTC lifecycle end-to-end: mint an ephemeral secret (never the key), capture the mic with echo
// cancellation, do the SDP handshake with OpenAI's `/v1/realtime/calls`, relay the Location-header
// `call_id` to voice.startSession (Pitfall 1 — the watchdog has nothing to target otherwise), then
// assemble the two-sided transcript, forward throttled `response.done` usage to voice.recordUsage,
// and drive the speaking orb + countdown. Mic-loss pause/recover + silence fall-through (Task 4)
// arm on top of this via the pure `graceExpired` predicate.
//
// ponytail: raw RTCPeerConnection + one "oai-events" data channel — no @openai/agents-realtime SDK
// (the escape hatch named in the plan, taken ONLY if live-verify shows event handling is heavy). No
// new npm dep. All Realtime literals (endpoints, model, event `type` names) import from @pikar/voice
// so nothing here re-hardcodes a post-cutoff shape.

// Usage flush cadence — response.done is per-agent-turn (already low frequency), but batch anyway so
// a fast back-and-forth doesn't spray mutations. ponytail: 5s + a final flush on end.
const USAGE_FLUSH_MS = 5_000;
// Emphasize + nudge the agent to wrap up at T-2min (RESEARCH Pattern 3). Sent once over the channel.
const WRAP_UP_MS = 2 * 60_000;

export type VoiceStatus = "idle" | "connecting" | "live" | "paused" | "ended" | "error";
export type Speaker = "user" | "agent";
export type Turn = { id: string; speaker: Speaker; text: string; final: boolean };

export type VoiceSession = {
  status: VoiceStatus;
  transcript: Turn[];
  speaking: Speaker | null;
  /** Wall-clock ms left against the 15-min cap; null before start. Keeps counting during a pause. */
  remainingMs: number | null;
  /** True once the countdown crosses T-2min (drives the countdown emphasis + wrap-up). */
  nearingCap: boolean;
  error: string | null;
  sessionId: SessionId | null;
  start: () => Promise<void>;
  /** Clean end (the caller shows the confirm) → voice.endSessionClean. */
  end: () => Promise<void>;
  /** Retry getUserMedia after a mic loss (Task 4). */
  reconnect: () => Promise<void>;
  /** Accessibility: type a turn; the agent still replies by voice + transcript. */
  sendText: (text: string) => void;
};

type ServerEvent = {
  type?: string;
  transcript?: string;
  delta?: string;
  response?: { usage?: Parameters<typeof readUsage>[0] };
};

export function useVoiceSession(): VoiceSession {
  const mint = useAction(api.voiceToken.mintClientSecret);
  const startSession = useMutation(api.voice.startSession);
  const recordUsage = useMutation(api.voice.recordUsage);
  const endSessionClean = useMutation(api.voice.endSessionClean);

  const [status, setStatus] = useState<VoiceStatus>("idle");
  const [transcript, setTranscript] = useState<Turn[]>([]);
  const [speaking, setSpeaking] = useState<Speaker | null>(null);
  const [remainingMs, setRemainingMs] = useState<number | null>(null);
  const [nearingCap, setNearingCap] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<SessionId | null>(null);

  // Imperative WebRTC + timing handles (refs so the event handlers read live values without
  // re-subscribing). None of these belong in React state — they never render.
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const dcRef = useRef<RTCDataChannel | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const senderRef = useRef<RTCRtpSender | null>(null);
  const audioElRef = useRef<HTMLAudioElement | null>(null);
  const sessionIdRef = useRef<SessionId | null>(null);
  const startedAtRef = useRef<number | null>(null);
  const agentTurnRef = useRef<string | null>(null);
  const usageAccumRef = useRef({ inAudioTok: 0, outAudioTok: 0, textInTok: 0, textOutTok: 0 });
  const wrapSentRef = useRef(false);
  const pausedSinceRef = useRef<number | null>(null);
  const lastActivityRef = useRef<number>(0);
  const endedRef = useRef(false);

  const send = useCallback((event: Record<string, unknown>) => {
    const dc = dcRef.current;
    if (dc && dc.readyState === "open") dc.send(JSON.stringify(event));
  }, []);

  const flushUsage = useCallback(() => {
    const u = usageAccumRef.current;
    const id = sessionIdRef.current;
    if (!id) return;
    if (u.inAudioTok || u.outAudioTok || u.textInTok || u.textOutTok) {
      usageAccumRef.current = { inAudioTok: 0, outAudioTok: 0, textInTok: 0, textOutTok: 0 };
      // Fire-and-forget: metering is best-effort telemetry, the 15-min cap is the real cost bound.
      // recordUsage fails CLOSED server-side on a bad delta, so a dropped flush is never a NaN charge.
      void recordUsage({ sessionId: id, ...u }).catch(() => {});
    }
  }, [recordUsage]);

  // Tear down every media/timer handle exactly once. Safe to call from end(), an error, unmount, or
  // the abnormal fall-through — endedRef guards a double teardown.
  const teardown = useCallback(() => {
    endedRef.current = true;
    flushUsage();
    for (const t of micStreamRef.current?.getTracks() ?? []) t.stop();
    micStreamRef.current = null;
    try {
      dcRef.current?.close();
    } catch {
      /* already closed */
    }
    try {
      pcRef.current?.close();
    } catch {
      /* already closed */
    }
    dcRef.current = null;
    pcRef.current = null;
    senderRef.current = null;
    if (audioElRef.current) {
      audioElRef.current.srcObject = null;
      audioElRef.current = null;
    }
  }, [flushUsage]);

  // ── Inbound data-channel events → transcript + orb + metering ────────────────
  const onEvent = useCallback(
    (raw: MessageEvent) => {
      let ev: ServerEvent;
      try {
        ev = JSON.parse(raw.data as string) as ServerEvent;
      } catch {
        return; // a non-JSON frame is not ours to read
      }
      switch (ev.type) {
        case REALTIME_EVENTS.userSpeechStarted:
          lastActivityRef.current = Date.now();
          setSpeaking("user");
          break;
        case REALTIME_EVENTS.userSpeechStopped:
          setSpeaking((s) => (s === "user" ? null : s));
          break;
        case REALTIME_EVENTS.assistantAudioStarted:
          lastActivityRef.current = Date.now();
          setSpeaking("agent");
          break;
        case REALTIME_EVENTS.assistantAudioStopped:
          setSpeaking((s) => (s === "agent" ? null : s));
          break;
        case REALTIME_EVENTS.inputTranscriptDone: {
          const text = (ev.transcript ?? "").trim();
          lastActivityRef.current = Date.now();
          if (text) {
            setTranscript((t) => [
              ...t,
              { id: `u-${Date.now()}-${t.length}`, speaker: "user", text, final: true },
            ]);
          }
          break;
        }
        case REALTIME_EVENTS.outputTranscriptDelta: {
          const delta = ev.delta ?? "";
          if (!delta) break;
          lastActivityRef.current = Date.now();
          setTranscript((t) => {
            const id = agentTurnRef.current;
            const prev = id ? t.find((x) => x.id === id) : undefined;
            if (!prev) {
              const newId = `a-${Date.now()}-${t.length}`;
              agentTurnRef.current = newId;
              return [...t, { id: newId, speaker: "agent", text: delta, final: false }];
            }
            return t.map((x) => (x.id === prev.id ? { ...x, text: x.text + delta } : x));
          });
          break;
        }
        case REALTIME_EVENTS.outputTranscriptDone: {
          const id = agentTurnRef.current;
          agentTurnRef.current = null;
          if (id) {
            setTranscript((t) =>
              t.map((x) =>
                x.id === id
                  ? { ...x, final: true, text: (ev.transcript ?? x.text).trim() || x.text }
                  : x,
              ),
            );
          }
          break;
        }
        case REALTIME_EVENTS.responseDone: {
          const usage = ev.response?.usage;
          if (usage) {
            const u = readUsage(usage);
            usageAccumRef.current.inAudioTok += u.inAudioTok;
            usageAccumRef.current.outAudioTok += u.outAudioTok;
            usageAccumRef.current.textInTok += u.textInTok;
            usageAccumRef.current.textOutTok += u.textOutTok;
          }
          break;
        }
      }
    },
    [],
  );

  // Mic loss mid-call (hardware unplug / OS revoke → track "ended", or a failed re-acquire): drop the
  // dead track but keep the peer connection + data channel alive so reconnect() can re-add cleanly.
  // The auto-expiry timer + silence fall-through arm on top of this in Task 4.
  const onMicLost = useCallback(() => {
    if (endedRef.current || pausedSinceRef.current !== null) return;
    for (const t of micStreamRef.current?.getTracks() ?? []) t.stop();
    micStreamRef.current = null;
    pausedSinceRef.current = Date.now();
    setSpeaking(null);
    setStatus("paused");
  }, []);

  // ── Connect: mint → mic → handshake → relay callId → startSession ────────────
  const connect = useCallback(async () => {
    const { clientSecret } = await mint({});

    const micStream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    micStreamRef.current = micStream;

    const pc = new RTCPeerConnection();
    pcRef.current = pc;
    // Remote agent audio → a detached <audio> element (autoplay). Discarded on teardown; never stored.
    const audioEl = new Audio();
    audioEl.autoplay = true;
    audioElRef.current = audioEl;
    pc.ontrack = (e) => {
      audioEl.srcObject = e.streams[0] ?? null;
      void audioEl.play().catch(() => {});
    };

    const dc = pc.createDataChannel("oai-events");
    dcRef.current = dc;
    dc.onmessage = onEvent;

    const track = micStream.getAudioTracks()[0];
    if (!track) throw new Error("no microphone track");
    senderRef.current = pc.addTrack(track, micStream);
    // Mic hardware yanked mid-call (unplug / OS revoke) fires "ended" — the Task-4 pause hook.
    track.addEventListener("ended", () => onMicLost());

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    // ponytail: POST the raw SDP offer with the ephemeral secret; the session config (model, persona,
    // VAD, transcription) is baked into the minted secret, so no query params here. RE-CONFIRM the
    // Location-header call_id shape (`…/v1/realtime/calls/{call_id}`) on the first live 200 — the
    // whole watchdog force-terminate hangs on it (Pitfall 1).
    const res = await fetch(CALLS_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${clientSecret}`, "Content-Type": "application/sdp" },
      body: offer.sdp ?? "",
    });
    if (!res.ok) throw new Error(`realtime handshake: ${res.status}`);
    const answerSdp = await res.text();
    await pc.setRemoteDescription({ type: "answer", sdp: answerSdp });

    const callId = res.headers.get("Location")?.split("/").pop() ?? "";
    if (!callId) throw new Error("realtime handshake: missing call_id");

    // Relay immediately — startSession arms the ONE server watchdog against this callId.
    const { sessionId: id } = await startSession({ callId });
    sessionIdRef.current = id;
    setSessionId(id);
    startedAtRef.current = Date.now();
    lastActivityRef.current = Date.now();
  }, [mint, onEvent, startSession, onMicLost]);

  const start = useCallback(async () => {
    if (status === "connecting" || status === "live") return;
    setStatus("connecting");
    setError(null);
    endedRef.current = false;
    try {
      await connect();
      setStatus("live");
    } catch (e) {
      teardown();
      setStatus("error");
      setError(
        e instanceof Error && /denied|Permission|NotAllowed/i.test(e.message)
          ? "Microphone access is required to start a voice session."
          : "Couldn't start the session. Please try again.",
      );
    }
  }, [status, connect, teardown]);

  const end = useCallback(async () => {
    if (endedRef.current) return;
    const id = sessionIdRef.current;
    teardown();
    setStatus("ended");
    setSpeaking(null);
    if (id) await endSessionClean({ sessionId: id }).catch(() => {});
  }, [teardown, endSessionClean]);

  // Retry getUserMedia after a mic loss and swap the live track back into the existing sender — no
  // re-handshake, the cap is untouched (the pause consumed wall-clock time).
  const reconnect = useCallback(async () => {
    if (endedRef.current || pausedSinceRef.current === null) return;
    try {
      const micStream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      micStreamRef.current = micStream;
      const track = micStream.getAudioTracks()[0];
      if (!track) throw new Error("no microphone track");
      // Swap the live track back into the existing sender — no re-handshake, cap untouched.
      await senderRef.current?.replaceTrack(track);
      track.addEventListener("ended", () => onMicLost());
      pausedSinceRef.current = null;
      lastActivityRef.current = Date.now();
      setStatus("live");
    } catch {
      // Still no mic — stay paused; the grace-window timer decides when to fall through.
    }
  }, [onMicLost]);

  const sendText = useCallback(
    (text: string) => {
      const t = text.trim();
      if (!t || endedRef.current) return;
      lastActivityRef.current = Date.now();
      // Show the typed turn immediately, then ask the agent to respond (voice + transcript).
      setTranscript((prev) => [
        ...prev,
        { id: `u-${Date.now()}-${prev.length}`, speaker: "user", text: t, final: true },
      ]);
      send({
        type: REALTIME_CLIENT_EVENTS.createItem,
        item: { type: "message", role: "user", content: [{ type: "input_text", text: t }] },
      });
      send({ type: REALTIME_CLIENT_EVENTS.createResponse });
    },
    [send],
  );

  // ── Countdown + wrap-up + grace/silence watchdogs (client-side, 1s tick) ─────
  useEffect(() => {
    if (status !== "live" && status !== "paused") return;
    const tick = () => {
      const startedAt = startedAtRef.current;
      if (startedAt === null) return;
      const now = Date.now();
      const left = Math.max(0, CAP_MS - (now - startedAt));
      setRemainingMs(left);
      setNearingCap(left <= WRAP_UP_MS);

      // T-2min: emphasize (state above) + nudge the agent to close, once. AGENT INSTRUCTION only —
      // the session stays "active"; the server watchdog keeps its wall-clock count (Pattern 3).
      if (left <= WRAP_UP_MS && !wrapSentRef.current && status === "live") {
        wrapSentRef.current = true;
        send({
          type: REALTIME_CLIENT_EVENTS.createResponse,
          response: {
            instructions:
              "We are nearing the end of our time. Briefly summarize the key decisions and " +
              "action items, then ask if there is anything final to add.",
          },
        });
      }

      // Cap reached — the server watchdog force-ends; mirror it client-side so the surface settles.
      if (left <= 0) end();
    };
    tick();
    const iv = setInterval(tick, 1000);
    return () => clearInterval(iv);
  }, [status, send, end]);

  // Best-effort cleanup on unmount / tab close (the server watchdog is the authoritative backstop).
  useEffect(() => teardown, [teardown]);
  useEffect(() => {
    const iv = setInterval(flushUsage, USAGE_FLUSH_MS);
    return () => clearInterval(iv);
  }, [flushUsage]);

  return {
    status,
    transcript,
    speaking,
    remainingMs,
    nearingCap,
    error,
    sessionId,
    start,
    end,
    reconnect,
    sendText,
  };
}
