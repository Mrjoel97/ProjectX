/// <reference path="./lib/ws.d.ts" />
"use node";

import {
  FOUNDATION_SECTIONS,
  type FoundationSection,
  SAVE_FOUNDATION_ANSWER_TOOL,
} from "@pikar/core/foundation";
import { DEFAULT_REALTIME_MODEL, SEARCH_DOCUMENT_TOOL, TURN_DETECTION_TYPE } from "@pikar/voice";
import { trustedResponseUsage } from "@pikar/voice/serverControl";
import { v } from "convex/values";
import WebSocket from "ws";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { internalAction } from "./lib/tenantLifecycle";

/** Five-minute server-owned sideband. No provider capability reaches the browser.
 * VAD commits input but cannot create responses; every response is separately admitted.
 * Failure, disconnect, missing usage or exhausted limits always terminate the provider.
 * Initial audio/transcription allowance remains held (there is no trusted final bill API). */
export const run = internalAction({
  args: { sessionId: v.id("voiceSessions") },
  handler: async (ctx, { sessionId }): Promise<void> => {
    const initial = await ctx.runQuery(internal.voice.getSession, { sessionId });
    if (!initial?.controlled || !initial.callId || initial.status !== "active") return;
    if (
      await ctx.runQuery(internal.authRevocations.erasureInProgress, { userId: initial.tenantId })
    ) {
      await ctx.runAction(internal.voice.terminateProvider, { sessionId, retryForErasure: true });
      return;
    }
    const socket = new WebSocket(
      `wss://api.openai.com/v1/realtime?call_id=${encodeURIComponent(initial.callId)}`,
      {
        headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY ?? ""}` },
        handshakeTimeout: 10_000,
        maxPayload: 256_000,
      },
    );
    let failed = false;
    let ready = false;
    let responses = 0;
    let pending: Id<"spendEvents"> | undefined;
    let responseId: string | undefined;
    let queue: Promise<void> = Promise.resolve();
    const send = (event: object) => {
      if (socket.readyState !== WebSocket.OPEN) throw new Error("VOICE_CONTROL_DISCONNECTED");
      socket.send(JSON.stringify(event));
    };
    const respond = async () => {
      if (failed || Date.now() >= initial.endsAt) throw new Error("VOICE_SESSION_INACTIVE");
      if (pending) return;
      if (++responses > 20) throw new Error("VOICE_RESPONSE_LIMIT");
      // 128k maximum input at the highest input rate ($32/M), plus1024 output
      // at the highest output rate ($64/M). Ceil to whole cents, never estimate chars.
      pending = await ctx.runMutation(internal.guardrails.reservePaidCall, {
        tenantId: initial.tenantId,
        model: DEFAULT_REALTIME_MODEL,
        callId: crypto.randomUUID(),
        ceilingCents: 417,
      });
      send({ type: "response.create", response: { max_output_tokens: 1024 } });
    };
    const handle = async (event: Record<string, unknown>) => {
      const type = event.type;
      if (type === "session.updated") {
        if (!ready) {
          const session = event.session as
            | {
                max_output_tokens?: unknown;
                audio?: { input?: { turn_detection?: { create_response?: unknown } } };
              }
            | undefined;
          if (
            session?.max_output_tokens !== 1024 ||
            session.audio?.input?.turn_detection?.create_response !== false
          )
            throw new Error("VOICE_CONTROL_UNCONFIRMED");
          ready = true;
          await ctx.runMutation(internal.voice.controlUpdate, { sessionId, ready: true });
          if (initial.onboarding) await respond();
        }
      } else if (type === "input_audio_buffer.committed") {
        await respond();
      } else if (type === "response.created") {
        const response = event.response as { id?: string } | undefined;
        if (!pending || !response?.id) throw new Error("VOICE_UNADMITTED_RESPONSE");
        responseId = response.id;
      } else if (type === "response.done") {
        const usage = trustedResponseUsage(event);
        if (!pending || usage.responseId !== responseId)
          throw new Error("VOICE_UNMATCHED_RESPONSE");
        await ctx.runMutation(internal.voice.recordTrustedUsage, {
          sessionId,
          reservationId: pending,
          ...usage,
        });
        pending = undefined;
        responseId = undefined;
        const response = event.response as {
          output?: { type?: string; name?: string; call_id?: string; arguments?: string }[];
        };
        const tools = response.output?.filter((item) => item.type === "function_call") ?? [];
        if (tools.length > 4) throw new Error("VOICE_TOOL_LIMIT");
        for (const tool of tools) {
          if (!tool.call_id || !tool.arguments || tool.arguments.length > 16_000)
            throw new Error("VOICE_TOOL_INVALID");
          const args = JSON.parse(tool.arguments) as Record<string, unknown>;
          let result: unknown = { error: "Tool unavailable" };
          try {
            if (
              tool.name === "save_foundation_answer" &&
              initial.onboarding &&
              typeof args.answer === "string" &&
              typeof args.section === "string" &&
              FOUNDATION_SECTIONS.includes(args.section as FoundationSection) &&
              (args.intent === "current" || args.intent === "planned")
            ) {
              result = await ctx.runAction(internal.foundation.answerFromVoice, {
                sessionId,
                eventId: tool.call_id,
                answer: args.answer,
                section: args.section as FoundationSection,
                intent: args.intent,
              });
            } else if (
              tool.name === "search_document" &&
              initial.docRef &&
              typeof args.query === "string"
            ) {
              result = await ctx.runAction(internal.voiceDoc.searchDocumentFromVoice, {
                sessionId,
                query: args.query,
              });
            }
          } catch {
            result = { error: "Could not save or retrieve this turn. Please retry." };
          }
          send({
            type: "conversation.item.create",
            item: {
              type: "function_call_output",
              call_id: tool.call_id,
              output: JSON.stringify(result),
            },
          });
        }
        if (tools.length) await respond();
      } else if (type === "error") {
        throw new Error("VOICE_PROVIDER_ERROR");
      }
      // Content plane only; bounded finals and UI speech state, never usage/tool/capability events.
      if (
        [
          "conversation.item.input_audio_transcription.completed",
          "response.output_audio_transcript.done",
          "input_audio_buffer.speech_started",
          "input_audio_buffer.speech_stopped",
          "output_audio_buffer.started",
          "output_audio_buffer.stopped",
        ].includes(String(type))
      ) {
        const clean = {
          type,
          transcript:
            typeof event.transcript === "string" ? event.transcript.slice(0, 12_000) : undefined,
          item_id: event.item_id,
          event_id: event.event_id,
        };
        await ctx.runMutation(internal.voice.controlUpdate, {
          sessionId,
          event: JSON.stringify(clean),
        });
      }
    };
    socket.on("open", () => {
      send({
        type: "session.update",
        session: {
          type: "realtime",
          max_output_tokens: 1024,
          audio: {
            input: {
              turn_detection: {
                type: TURN_DETECTION_TYPE,
                create_response: false,
                interrupt_response: true,
              },
            },
          },
          tools: initial.onboarding
            ? [SAVE_FOUNDATION_ANSWER_TOOL]
            : initial.docRef
              ? [SEARCH_DOCUMENT_TOOL]
              : [],
          tool_choice: "auto",
        },
      });
    });
    socket.on("message", (raw: { toString(): string }) => {
      queue = queue
        .then(async () => {
          await handle(JSON.parse(raw.toString()) as Record<string, unknown>);
        })
        .catch(() => {
          failed = true;
        });
    });
    socket.on("error", () => {
      failed = true;
    });
    socket.on("close", () => {
      failed = true;
    });
    const hardStop = setTimeout(
      () => {
        failed = true;
        socket.terminate();
      },
      Math.max(1, initial.endsAt - Date.now()),
    );
    try {
      while (!failed && Date.now() < initial.endsAt) {
        await new Promise((resolve) => setTimeout(resolve, 500));
        const state = await ctx.runQuery(internal.voice.getSession, { sessionId });
        if (!state || state.status !== "active") break;
        if (
          await ctx.runQuery(internal.authRevocations.erasureInProgress, {
            userId: initial.tenantId,
          })
        )
          break;
        if (!ready && Date.now() - initial.startedAt > 15_000) break;
        if (ready && state.controlCommands?.length) {
          const commands = state.controlCommands;
          queue = queue
            .then(async () => {
              for (const command of commands)
                send({
                  type: "conversation.item.create",
                  item: {
                    type: "message",
                    role: "user",
                    content: [{ type: "input_text", text: command.text }],
                  },
                });
              await ctx.runMutation(internal.voice.controlUpdate, {
                sessionId,
                consumedSeq: commands.at(-1)?.seq,
              });
              await respond();
            })
            .catch(() => {
              failed = true;
            });
          await queue;
        }
      }
    } finally {
      clearTimeout(hardStop);
      failed = true;
      socket.terminate();
      const existing = await ctx.runQuery(internal.voice.getSession, { sessionId });
      // Stop billing first, then drain already-received trusted receipts. Otherwise a close
      // racing response.done can discard known usage and leave an avoidable unresolved hold.
      if (existing) await ctx.runAction(internal.voice.terminateProvider, { sessionId });
      else await ctx.runAction(internal.voiceToken.hangupCall, { callId: initial.callId });
      await queue;
      if (
        existing &&
        (await ctx.runQuery(internal.authRevocations.erasureInProgress, {
          userId: initial.tenantId,
        }))
      )
        await ctx.runAction(internal.voice.terminateProvider, { sessionId, retryForErasure: true });
      else if (existing) await ctx.runAction(internal.voice.forceEndSession, { sessionId });
    }
  },
});
