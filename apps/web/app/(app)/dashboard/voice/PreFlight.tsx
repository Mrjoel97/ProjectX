"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { MicIcon } from "../../../(auth)/icons";
import { DocPicker } from "./DocPicker";

// VOIC-01 pre-flight (RESEARCH / CONTEXT): before a single second of capped time is spent, confirm
// the mic actually works and show the one-time consent notice. A dead mic caught here saves the user
// a wasted 15-minute session. The consent notice sits BEFORE Start (no mid-call friction). BRAND
// tokens only, no component library (§10); fully keyboard-operable with screen-reader labels (§6).
//
// This owns its OWN preview stream purely to drive the level meter; on Start it releases the preview
// and hands off to the hook's connect(), which re-acquires the real session mic. ponytail: a brief
// double-acquire is cheaper than plumbing one MediaStream across the pre-flight → live boundary.

type MicState = "idle" | "requesting" | "ready" | "denied";

export function PreFlight({
  onStart,
  starting,
  error,
  docId,
  onPickDoc,
}: {
  onStart: () => void;
  starting: boolean;
  error: string | null;
  // DOCV-01 / 14-10: the optional document under discussion. page.tsx owns this state (it is also
  // where `?doc=` is read), so the picker below only reports a choice upward — it stores nothing.
  docId?: string;
  onPickDoc: (docId: string | undefined) => void;
}) {
  const [mic, setMic] = useState<MicState>("idle");
  const [level, setLevel] = useState(0); // 0..1 smoothed input level for the meter

  const streamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const rafRef = useRef<number | null>(null);

  const stopPreview = useCallback(() => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    for (const t of streamRef.current?.getTracks() ?? []) t.stop();
    streamRef.current = null;
    void audioCtxRef.current?.close().catch(() => {});
    audioCtxRef.current = null;
  }, []);

  const requestMic = useCallback(async () => {
    setMic("requesting");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      streamRef.current = stream;
      // Web Audio meter: RMS of the time-domain buffer → a smoothed 0..1 level. Confirms the mic is
      // live (bars move when you speak) without recording anything.
      const ctx = new AudioContext();
      audioCtxRef.current = ctx;
      const src = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      src.connect(analyser);
      const buf = new Uint8Array(analyser.fftSize);
      const loop = () => {
        analyser.getByteTimeDomainData(buf);
        let sum = 0;
        for (const v of buf) {
          const d = (v - 128) / 128;
          sum += d * d;
        }
        const rms = Math.sqrt(sum / buf.length);
        setLevel((prev) => prev * 0.7 + Math.min(1, rms * 3) * 0.3); // smooth
        rafRef.current = requestAnimationFrame(loop);
      };
      loop();
      setMic("ready");
    } catch {
      stopPreview();
      setMic("denied");
    }
  }, [stopPreview]);

  // Release the preview stream on unmount (and it is released explicitly on Start below).
  useEffect(() => stopPreview, [stopPreview]);

  const handleStart = () => {
    stopPreview();
    onStart();
  };

  const bars = 12;
  const lit = Math.round(level * bars);
  const meterBars = Array.from({ length: bars }, (_, index) => ({
    id: `meter-bar-${index + 1}`,
    index,
  }));

  return (
    <section
      aria-labelledby="voice-preflight-title"
      style={{
        width: "min(30rem, 100%)",
        background: "var(--card)",
        border: "1px solid var(--rule)",
        borderRadius: "1.25rem",
        boxShadow: "0 24px 60px -40px rgb(14 20 25 / 45%)",
        padding: "clamp(1.5rem, 1rem + 2vw, 2.5rem)",
        display: "grid",
        gap: "1.25rem",
        justifyItems: "center",
        textAlign: "center",
      }}
    >
      <span
        style={{
          textTransform: "uppercase",
          letterSpacing: "0.14em",
          fontSize: "0.72rem",
          fontWeight: 700,
          color: "var(--ink-soft)",
        }}
      >
        Live Voice
      </span>
      <h1
        id="voice-preflight-title"
        style={{
          margin: 0,
          fontFamily: "var(--font-display), system-ui, sans-serif",
          fontWeight: 800,
          fontSize: "clamp(1.5rem, 1.2rem + 1.2vw, 2rem)",
          letterSpacing: "-0.02em",
          color: "var(--ink)",
        }}
      >
        Talk through your next move
      </h1>

      {/* Mic check */}
      <div style={{ display: "grid", gap: "0.75rem", justifyItems: "center", width: "100%" }}>
        {mic === "idle" && (
          <button type="button" onClick={() => void requestMic()} style={primaryBtn}>
            <MicIcon size={16} /> Check microphone
          </button>
        )}
        {mic === "requesting" && (
          <p style={{ margin: 0, color: "var(--ink-soft)" }}>Waiting for microphone permission…</p>
        )}
        {mic === "denied" && (
          <div role="alert" style={{ display: "grid", gap: "0.6rem", justifyItems: "center" }}>
            <p style={{ margin: 0, color: "var(--held-text)", maxWidth: "24rem" }}>
              We couldn't access your microphone. Allow mic access in your browser, then try again.
            </p>
            <button type="button" onClick={() => void requestMic()} style={secondaryBtn}>
              Try again
            </button>
          </div>
        )}
        {mic === "ready" && (
          <>
            {/* Decorative meter — the real signal for a screen reader is the status line below. */}
            <div
              aria-hidden="true"
              style={{ display: "flex", gap: "3px", alignItems: "flex-end", height: "2rem" }}
            >
              {meterBars.map(({ id, index }) => (
                <span
                  key={id}
                  style={{
                    width: "6px",
                    height: `${20 + index * 6}%`,
                    borderRadius: "3px",
                    background: index < lit ? "var(--teal-600)" : "var(--rule)",
                    transition: "background 80ms linear",
                  }}
                />
              ))}
            </div>
            <p aria-live="polite" style={{ margin: 0, color: "var(--released)", fontWeight: 600 }}>
              Microphone is working — say something to see the meter move.
            </p>
          </>
        )}
      </div>

      {/* 14-10: attach a vault document before spending capped time. Sits after the mic check and
          before consent so the two pre-flight decisions read in order: can we hear you, and what
          are we talking about. Optional — with no document this stays a Phase-6 general session. */}
      <DocPicker selectedId={docId} onPick={onPickDoc} />

      {/* One-time consent notice — always visible before Start (no mid-call friction). */}
      <p
        style={{
          margin: 0,
          padding: "0.75rem 1rem",
          background: "var(--canvas)",
          border: "1px solid var(--rule)",
          borderRadius: "0.75rem",
          color: "var(--ink-soft)",
          fontSize: "0.85rem",
          maxWidth: "26rem",
        }}
      >
        This conversation is transcribed and saved to your vault. Your microphone audio streams to
        the assistant and is not stored — only the transcript and the brief are kept.
      </p>

      {error && (
        <p role="alert" style={{ margin: 0, color: "var(--held-text)" }}>
          {error}
        </p>
      )}

      <button
        type="button"
        onClick={handleStart}
        disabled={mic !== "ready" || starting}
        aria-disabled={mic !== "ready" || starting}
        title={mic !== "ready" ? "Check your microphone first" : "Start the session"}
        style={{
          ...primaryBtn,
          opacity: mic !== "ready" || starting ? 0.5 : 1,
          cursor: mic !== "ready" || starting ? "default" : "pointer",
        }}
      >
        {starting ? "Starting…" : "Start session"}
      </button>
    </section>
  );
}

const primaryBtn: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: "0.5rem",
  padding: "0.7rem 1.6rem",
  borderRadius: "999px",
  border: "none",
  cursor: "pointer",
  background: "var(--teal-600)",
  color: "#fff",
  fontWeight: 600,
  fontSize: "0.95rem",
};

const secondaryBtn: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: "0.5rem",
  padding: "0.55rem 1.2rem",
  borderRadius: "999px",
  border: "1px solid var(--rule)",
  cursor: "pointer",
  background: "var(--card)",
  color: "var(--ink)",
  fontWeight: 600,
  fontSize: "0.9rem",
};
