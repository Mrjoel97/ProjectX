# ADR-069: Approved brand identity and deterministic media finishing

Status: Accepted for implementation; deployment qualification pending.
Date: 2026-10-26

## Context

The owner requested stronger brand storytelling, smooth transitions, precise lettering and better
image quality. Customers without a brand need a proposed identity they can approve before agents
reuse it. The current image provider contract explicitly selected low quality.

## Decision

1. Keep brand drafts outside Knowledge Vault. Exact human revision/hash approval publishes an
   immutable tenant-owned snapshot. Only the active approved revision supplies standing context;
   plans pin their approved revision, while later revisions require fresh approval.
2. New standalone and batch image proposals explicitly select high-quality GPT Image 2 with a
   USD0.20 reservation policy. Historical absent quality remains low. Bind quality, prompt, brand
   revision and price to review; refuse changed input before provider submission. This is a policy
   reservation, not a guaranteed invoice ceiling.
3. Keep Seedance 2.0 native audio. Finish supported films with timed text and bounded fade-through-
   background transitions without overlapping scenes, altering duration or shifting native audio.
   Do not ask the generator to render the same brand lettering separately.
4. Adapt creative direction from the credited Koda roles into the existing registry. Only expose
   fields the renderer supports. Kimi K3.1 Pro remains an evaluation candidate; the prepared
   comparison makes no calls and does not promote a new model.

## Consequences and acceptance

Brand approval, stale reviews, tenant isolation, image reservation and actual FFmpeg output require
free regression checks. Hosted acceptance and a separately budgeted creative sample remain distinct
from local correctness. This change provides no accurate product mesh, arbitrary animated logo
assets, or guaranteed geometric consistency; genuine product 3D requires a subsequent controlled
asset/rendering lane. No additional paid benchmark is authorized by implementation alone.
