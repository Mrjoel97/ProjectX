# Sidecars

Python workloads that cannot run on Convex (no Python runtime) run as **containers**.

- **Host target:** Fly.io (Railway is the fallback).
- **Invocation:** Convex **actions** call each sidecar over HTTPS via `fetch`, wrapped in the
  Action Retrier (exponential backoff + jitter) with an `AbortController` timeout.
- **Config:** each sidecar's base URL is a **Convex environment variable** (set with
  `npx convex env set`), never a Vercel var and never committed.

## Planned sidecars

| Sidecar            | Introduced | Purpose                                             | Env var        |
| ------------------ | ---------- | --------------------------------------------------- | -------------- |
| Presidio           | Phase 3    | PII detection / anonymization (redact-then-write)   | `PRESIDIO_URL` |
| graphify-service   | Phase 5    | Ingestion-time node/edge extraction for GraphRAG    | `GRAPHIFY_URL` |
| SkillOpt           | Phase 8    | Prompt/skill optimization loop (eval-gated)         | `SKILLOPT_URL` |

Each sidecar gets its own subdirectory here (Dockerfile + service code) when its phase lands.
