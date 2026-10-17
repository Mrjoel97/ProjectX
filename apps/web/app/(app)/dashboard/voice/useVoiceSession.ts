"use client";

import { api } from "@pikar/backend/api";
import type { FoundationSection } from "@pikar/core/foundation";
import { CAP_MS, graceExpired, REALTIME_EVENTS } from "@pikar/voice";
import { useAction, useMutation, useQuery } from "convex/react";
import type { FunctionArgs } from "convex/server";
import { useCallback, useEffect, useRef, useState } from "react";

// The voiceSessions row id, derived from the mutation's own args (the IntakeControls precedent) so
// this client file never needs the Convex-only `dataModel` types (@pikar/backend exports only ./api).
type SessionId = FunctionArgs<typeof api.voice.recordUsage>["sessionId"];
// Same derivation for the vaultDocuments id: `?doc=` arrives as a plain string from the route, and
// startSession's own arg type is the only place the branded id shape is available to this client.
type DocRef = NonNullable<FunctionArgs<typeof api.voiceToken.connect>["docId"]>;

// Browser audio transport with server-owned signaling, controls, tools and usage.
// No provider credential or data channel is available to this client.
const WRAP_UP_MS = 2 * 60_000;
// Grace/silence windows — Claude's Discretion (CONTEXT). ponytail: 30s mic re-acquire, 90s dead-air
// (well past the persona's "still there?" check-in). BOTH consume cap time — the watchdog is never
// re-armed or extended (RESEARCH Open Question 1, cap stays wall-clock). Tune after live-verify.
const MIC_GRACE_MS = 30_000;
const SILENCE_MS = 90_000;

export type VoiceStatus = "idle" | "connecting" | "live" | "paused" | "ended" | "error";
export type Speaker = "user" | "agent";
export type Turn = { id: string; speaker: Speaker; text: string; final: boolean };

export type VoiceSession = {
  status: VoiceStatus;
  transcript: Turn[];
  speaking: Speaker | null;
  /** Wall-clock ms left against the server cap; null before start. Counts during a pause. */
  remainingMs: number | null;
  /** True once the countdown crosses T-2min (drives countdown emphasis only). */
  nearingCap: boolean;
  error: string | null;
  sessionId: SessionId | null;
  start: () => Promise<void>;
  /** Clean end (the caller shows the confirm) → voice.endSessionClean. */
  end: () => Promise<void>;
  /** Retry getUserMedia after a mic loss (Task 4). */
  reconnect: () => Promise<void>;
  /** Accessibility: type a turn; the agent still replies by voice + transcript. */
  sendText: (text: string) => Promise<boolean>;
};

type ServerEvent = {
  item_id?: string;
  event_id?: string;
  type?: string;
  transcript?: string;
  delta?: string;
};

/**
 * @param docId Optional `vaultDocuments` id (from `?doc=`). When present the session is DOC-SCOPED:
 *   the mint carries the document-analyst persona + digest + the retrieval tool (14-04), and the
 *   model's `search_document` calls are relayed to Convex (Task 2). Absent ⇒ the Phase-6 general
 *   voice session, byte-identical behaviour: no new branch, no new event, no extra send.
 */
export type OnboardingVoiceOptions = {
  onboarding: true;
  onAnswer: (args: {
    answer: string;
    section: FoundationSection;
    intent: "current" | "planned";
    eventId: string;
  }) => Promise<unknown>;
};
export function useVoiceSession(docId?: string, options?: OnboardingVoiceOptions): VoiceSession {
  const onboarding = options?.onboarding === true;
  const connectProvider = useAction(api.voiceToken.connect);
  const postText = useMutation(api.voice.sendText);
  const endSessionClean = useMutation(api.voice.endSessionClean);
  const abortSession = useMutation(api.voice.abortSession);

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
  const micStreamRef = useRef<MediaStream | null>(null);
  const senderRef = useRef<RTCRtpSender | null>(null);
  const audioElRef = useRef<HTMLAudioElement | null>(null);
  const sessionIdRef = useRef<SessionId | null>(null);
  const startedAtRef = useRef<number | null>(null);
  const endsAtRef = useRef<number | null>(null);
  const eventCursorRef = useRef(0);
  const trustedState = useQuery(api.voice.controlState, sessionId ? { sessionId } : "skip");
  const agentTurnRef = useRef<string | null>(null);
  const pausedSinceRef = useRef<number | null>(null);
  const lastActivityRef = useRef<number>(0);
  const endedRef = useRef(false);
  const generationRef = useRef(0);
  const reconnectingRef = useRef(false);

  // Tear down every media/timer handle exactly once. Safe to call from end(), an error, unmount, or
  // the abnormal fall-through — endedRef guards a double teardown.
  const teardown = useCallback(() => {
    generationRef.current += 1;
    endedRef.current = true;
    for (const t of micStreamRef.current?.getTracks() ?? []) t.stop();
    micStreamRef.current = null;
    try {
      pcRef.current?.close();
    } catch {
      /* already closed */
    }
    pcRef.current = null;
    senderRef.current = null;
    if (audioElRef.current) {
      audioElRef.current.srcObject = null;
      audioElRef.current = null;
    }
  }, []);

  // Trusted server subscription events update the transcript and speaking indicator.
  const onEvent = useCallback((raw: MessageEvent) => {
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
          setTranscript((t) => {
            const id = ev.item_id ?? ev.event_id ?? `u-${Date.now()}-${t.length}`;
            return t.some((turn) => turn.id === id)
              ? t
              : [...t, { id, speaker: "user", text, final: true }];
          });
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
        // The done event carries the AUTHORITATIVE full transcript for the response. Finalize the
        // streamed turn if one exists — but if no `.delta` ever created a turn (a response can emit
        // `.done` with no delta stream, or the deltas were missed), DON'T drop the agent's words:
        // create the final turn from the full transcript. Dropping it here is what holed the brief.
        const full = (ev.transcript ?? "").trim();
        setTranscript((t) => {
          const prev = id ? t.find((x) => x.id === id) : undefined;
          if (prev)
            return t.map((x) =>
              x.id === prev.id ? { ...x, final: true, text: full || x.text } : x,
            );
          if (!full) return t;
          return [
            ...t,
            { id: `a-${Date.now()}-${t.length}`, speaker: "agent", text: full, final: true },
          ];
        });
        break;
      }
      default:
        // UAT diagnostic (ponytail: remove/quiet at phase close): if the agent speaks but no text
        // appears, the real event name OpenAI sent shows up here — the pinned output_audio_transcript
        // names are the MEDIUM-confidence risk realtime.ts flags. Filter the console by "[voice]".
        // `function_call` is included for Open Question 4's live verify: if a tool call never
        // reaches the relay above, the name OpenAI actually sent surfaces here.
        if (
          ev.type?.includes("transcript") ||
          ev.type?.includes("audio") ||
          ev.type?.includes("function_call")
        )
          console.debug("[voice] unhandled audio/transcript/function_call event:", ev.type);
        break;
    }
  }, []);

  // Mic loss mid-call (hardware unplug / OS revoke → track "ended", or a failed re-acquire): drop the
  // dead track but keep the audio peer connection alive so reconnect() can replace it cleanly.
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
  const connect = useCallback(
    async (generation: number) => {
      const current = () => generationRef.current === generation && !endedRef.current;
      // `?doc=` is an unbranded route string; both server calls below re-validate it (ownership +
      // `status: "ready"`), so the cast asserts shape for TypeScript, never trust.
      const micStream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      if (!current()) {
        for (const track of micStream.getTracks()) track.stop();
        return;
      }
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

      const track = micStream.getAudioTracks()[0];
      if (!track) throw new Error("no microphone track");
      senderRef.current = pc.addTrack(track, micStream);
      const opus =
        RTCRtpSender.getCapabilities("audio")?.codecs.filter(
          (codec) => codec.mimeType.toLowerCase() === "audio/opus",
        ) ?? [];
      if (opus.length !== 1) throw new Error("Audio codec unavailable");
      pc.getTransceivers()[0]?.setCodecPreferences(opus);
      // Mic hardware yanked mid-call (unplug / OS revoke) fires "ended" — the Task-4 pause hook.
      track.addEventListener("ended", () => {
        if (current()) onMicLost();
      });

      const offer = await pc.createOffer();
      if (!current()) return;
      await pc.setLocalDescription(offer);
      if (!current()) return;

      const connected = await connectProvider({
        offerSdp: offer.sdp ?? "",
        ...(docId ? { docId: docId as DocRef } : {}),
        ...(onboarding ? { onboarding: true } : {}),
      });
      if (!current()) {
        void abortSession({ sessionId: connected.sessionId }).catch(() => {});
        return;
      }
      sessionIdRef.current = connected.sessionId;
      setSessionId(connected.sessionId);
      endsAtRef.current = connected.endsAt;
      eventCursorRef.current = 0;
      await pc.setRemoteDescription({ type: "answer", sdp: connected.answerSdp });
      if (!current()) return;
      startedAtRef.current = Date.now();
      lastActivityRef.current = Date.now();
    },
    [connectProvider, onMicLost, docId, onboarding, abortSession],
  );

  useEffect(() => {
    if (!trustedState) return;
    trustedState.events.forEach((event, index) => {
      const cursor = trustedState.offset + index;
      if (cursor >= eventCursorRef.current) {
        onEvent(new MessageEvent("message", { data: event }));
        eventCursorRef.current = cursor + 1;
      }
    });
    if (trustedState.status !== "active" && !endedRef.current) {
      teardown();
      setStatus("ended");
      setSpeaking(null);
    }
  }, [trustedState, onEvent, teardown]);

  const start = useCallback(async () => {
    if (status === "connecting" || status === "live" || status === "paused") return;
    const generation = ++generationRef.current;
    setStatus("connecting");
    setError(null);
    endedRef.current = false;
    sessionIdRef.current = null;
    setSessionId(null);
    pausedSinceRef.current = null;
    reconnectingRef.current = false;
    agentTurnRef.current = null;
    startedAtRef.current = null;
    endsAtRef.current = null;
    setRemainingMs(null);
    setNearingCap(false);
    setSpeaking(null);
    setTranscript([]);
    try {
      await connect(generation);
      if (generationRef.current !== generation || endedRef.current) return;
      setStatus("live");
    } catch (e) {
      if (generationRef.current !== generation || endedRef.current) return;
      if (sessionIdRef.current)
        void abortSession({ sessionId: sessionIdRef.current }).catch(() => {});
      teardown();
      setStatus("error");
      setError(
        e instanceof Error && /denied|Permission|NotAllowed/i.test(e.message)
          ? "Microphone access is required to start a voice session."
          : "Voice is unavailable right now. You can continue by typing.",
      );
    }
  }, [status, connect, teardown, abortSession]);

  const end = useCallback(async () => {
    if (endedRef.current) return;
    const id = sessionIdRef.current;
    teardown();
    setStatus("ended");
    setSpeaking(null);
    if (id) await endSessionClean({ sessionId: id }).catch(() => {});
  }, [teardown, endSessionClean]);

  // Mic-loss / silence fall-through → the EXISTING abnormal-end path (hangup + auto-store brief).
  // abortSession is the thin client gateway to internal.voice.forceEndSession. The watchdog is NOT
  // re-armed — the grace window simply consumed cap time (remainingMs kept counting through the pause).
  const fallThroughAbnormal = useCallback(() => {
    if (endedRef.current) return;
    const id = sessionIdRef.current;
    teardown();
    setStatus("ended");
    setSpeaking(null);
    if (id) void abortSession({ sessionId: id }).catch(() => {});
  }, [teardown, abortSession]);

  // Retry getUserMedia after a mic loss and swap the live track back into the existing sender — no
  // re-handshake, the cap is untouched (the pause consumed wall-clock time).
  const reconnect = useCallback(async () => {
    if (endedRef.current || pausedSinceRef.current === null || reconnectingRef.current) return;
    const generation = generationRef.current;
    reconnectingRef.current = true;
    let micStream: MediaStream | undefined;
    try {
      micStream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      if (endedRef.current || generationRef.current !== generation) {
        for (const track of micStream.getTracks()) track.stop();
        return;
      }
      micStreamRef.current = micStream;
      const track = micStream.getAudioTracks()[0];
      if (!track) throw new Error("no microphone track");
      // Swap the live track back into the existing sender — no re-handshake, cap untouched.
      const sender = senderRef.current;
      if (!sender) throw new Error("voice session ended");
      await sender.replaceTrack(track);
      if (endedRef.current || generationRef.current !== generation) {
        for (const track of micStream.getTracks()) track.stop();
        return;
      }
      track.addEventListener("ended", () => {
        if (generationRef.current === generation && !endedRef.current) onMicLost();
      });
      pausedSinceRef.current = null;
      lastActivityRef.current = Date.now();
      setStatus("live");
    } catch {
      for (const track of micStream?.getTracks() ?? []) track.stop();
      // Still no mic — stay paused; the grace-window timer decides when to fall through.
    } finally {
      if (generationRef.current === generation) reconnectingRef.current = false;
    }
  }, [onMicLost]);

  const sendText = useCallback(
    async (text: string): Promise<boolean> => {
      const t = text.trim();
      const id = sessionIdRef.current;
      if (!t || endedRef.current || !id || (status !== "live" && status !== "paused")) return false;
      const generation = generationRef.current;
      try {
        await postText({ sessionId: id, text: t });
      } catch {
        if (generationRef.current === generation) setError("Could not send text. Please retry.");
        return false;
      }
      if (generationRef.current !== generation) return true;
      lastActivityRef.current = Date.now();
      setError(null);
      // Only acknowledged commands enter the transcript; responses remain server-admitted.
      setTranscript((prev) => [
        ...prev,
        { id: `u-${Date.now()}-${prev.length}`, speaker: "user", text: t, final: true },
      ]);
      return true;
    },
    [postText, status],
  );

  // ── Countdown + grace/silence watchdogs (client-side, 1s tick) ───────────────
  useEffect(() => {
    if (status !== "live" && status !== "paused") return;
    const tick = () => {
      const startedAt = startedAtRef.current;
      if (startedAt === null) return;
      const now = Date.now();
      const left = Math.max(0, (endsAtRef.current ?? startedAt + CAP_MS) - now);
      setRemainingMs(left);
      setNearingCap(left <= WRAP_UP_MS);

      // Countdown is presentation only. Provider response creation stays server-owned.

      // Silence fall-through: dead air past SILENCE_MS ends the session (protects capped time from a
      // conversation that has gone quiet). graceExpired fail-safes on a bad clock read (never ends).
      if (status === "live" && graceExpired(lastActivityRef.current, now, SILENCE_MS)) {
        fallThroughAbnormal();
        return;
      }
      // Mic-loss grace: a mic that has not recovered within MIC_GRACE_MS falls through to the abnormal
      // path (brief still generated). The pause consumed cap time; the watchdog was never re-armed.
      if (
        status === "paused" &&
        pausedSinceRef.current !== null &&
        graceExpired(pausedSinceRef.current, now, MIC_GRACE_MS)
      ) {
        fallThroughAbnormal();
        return;
      }
      // Cap reached — the server watchdog force-ends; mirror it client-side so the surface settles.
      if (left <= 0) end();
    };
    tick();
    const iv = setInterval(tick, 1000);
    return () => clearInterval(iv);
  }, [status, end, fallThroughAbnormal]);

  // Best-effort cleanup on unmount / tab close (the server watchdog is the authoritative backstop).
  useEffect(
    () => () => {
      const id = endedRef.current ? null : sessionIdRef.current;
      teardown();
      if (id) void abortSession({ sessionId: id }).catch(() => {});
    },
    [teardown, abortSession],
  );

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
