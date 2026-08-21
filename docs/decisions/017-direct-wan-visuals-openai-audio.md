# ADR-017: Direct Wan visuals and OpenAI audio supersede fal

Status: Accepted — 2026-08-13; **the VISUAL half and the callback-retention clause are superseded by
[ADR-024](024-openai-sora-is-the-media-provider.md)** (2026-08-21). The audio decision below still
stands. Status line only, per `docs/README.md`; the body is byte-unchanged and is deliberately NOT
corrected in place — including the "it does not receive prompts for visual jobs" line, which ADR-024
names as false as of the OpenAI cutover.

Supersedes the provider selection in ADR-011 while preserving its preflight pricing and spend-rail
requirements.

## Context

The product already has funded Alibaba Model Studio and OpenAI accounts. Keeping fal as a second
paid media broker duplicates cost and operational surface. The fal credential was also unusable in
the live preflight (`User is locked`, reason `TOP_UP`).

## Decision

- Generate images and videos directly through the Singapore Alibaba Model Studio workspace using
  `Video_and_image_API_Key` and `WAN_API_BASE_URL`.
- Submit Wan jobs asynchronously, poll by task id, immediately copy successful provider assets into
  owned Convex storage, and persist only a provider request id.
- Generate WAV voiceovers with OpenAI `tts-1` and transcribe the clean generated voice track with
  OpenAI `whisper-1` word timestamps. The owner explicitly approved both data transfers.
- Remove `FAL_KEY` from application code and deployment configuration. Retain the old callback and
  schema fields temporarily only so jobs submitted before the cutover can still be interpreted.
- Price all four media kinds against official Alibaba/OpenAI pricing and fail closed on unknown
  models or illegal dimensions.

## Consequences

There is no fal spend or active fal catalog monitor. Visual completion is now scheduler-driven
rather than webhook-driven. Alibaba output URLs are treated as short-lived capabilities and are
accepted only over HTTPS from `aliyuncs.com` hosts before being copied to owned storage. OpenAI sees
narration text and the generated clean voice audio; it does not receive prompts for visual jobs.
