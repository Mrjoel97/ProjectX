# ADR-056: Keep live voice provider control on the server

Status: Accepted — 2026-10-15 (implementation decision; live transport qualification pending)

This extends ADR-054's voice interview architecture. Browser-held provider credentials and a
provider data channel allowed response creation and session changes outside server admission.
Browser-reported usage could not establish a trustworthy cost boundary.

The browser retains the microphone/audio WebRTC connection. Convex exchanges a validated,
audio-only SDP offer using an internal credential, registers the provider call and starts a
server sideband worker before returning the answer. Provider credentials, session registration,
tools and response creation are unavailable to the browser. Typed commands and transient
display events use tenant-scoped application state.

The worker disables automatic VAD responses, reserves a conservative allowance before each
response, and settles only matched provider usage. It limits session duration, response count
and output tokens. Missing usage retains its hold. Initial audio/transcription admission stays
reserved because a complete final provider bill is not available through this transport.

End-of-session handling attempts provider hangup and retains durable retry state. Account
erasure preserves the call handle until hangup is acknowledged. Provider outages can delay
termination: a local watchdog is not evidence of a guaranteed provider billing cutoff.
Transient control transcripts/commands expire separately from seven-day foundation checkpoints.

`VOICE_SERVER_CONTROL_VERIFIED` remains off for production until audio-only WebRTC, sideband
readiness, interruption, reconnect, tool execution, trusted usage and termination are qualified
against the real provider in a controlled environment. Unit tests establish protocol behavior,
not provider acceptance. Typed onboarding remains available during qualification.
