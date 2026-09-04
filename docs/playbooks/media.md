# Playbook: Media Canvas (finished reels and standalone images)

> Last verified: 2026-09-04 (33.1-06 - **THE MUSIC BED IS FETCHED FROM OPENVERSE AND CREDITED
> IN THE CAPTION (ADR-031). The "no `mediaJobs` row" section below is SUPERSEDED for the bed.**
>
> **What changed.** The baked library was empty (`LICENSES.md` + README, no track), so every reel
> was bedless. The bed is now a $0 STOCK row -- `provider: "stock"`, `kind: "audio"`,
> `model: "openverse/v1"`, at `MUSIC_BLOCK_INDEX` (-2, beside captions) -- written by
> `reserveSceneJobInner` FIRST in the batch, fetched by `fetchStockMusic` (`<mood> instrumental`,
> `license_type=commercial`, no key; anonymous 20/min, 200/day read off the headers), picked by
> `pickStockAudio` (long enough for the reel, downloadable, CREDITED -- or skipped), landed like a
> Pexels still. The $0 `music` invoice line is unchanged; the row is the mechanism.
>
> **Optional by construction.** `batchToRender` ships `music.mp3` + `musicFile` only when the row
> has landed; failed/missing/landing = bedless reel via the assembler's WARN path. A reel never
> waits on its music. `assemble_final.sh --music-file in/music.mp3` takes the fetched track over
> the library; the flag's path is charset-guarded to that one name.
>
> **The licence duty.** What survives Openverse's commercial filter is CC BY -- free of charge, not
> free of duty. The library's own `attribution` string lands on `plans.musicCredit` (BEFORE the
> bytes, so a crash leaves the duty visible), is written into the reel's vault document as a
> `Music:` line, and is shown beside the finished reel as a copy-ready caption credit
> (`data-testid="media-music-credit"`). Owner's choice: caption, not an end card.
>
> **Invariants that moved:** `mediaJobs.kind` gained `audio` (widen-only); `RENDER_INPUT_NAME`
> accepts `music.(mp3|m4a|ogg|wav|flac)`; `parseBody` refuses a `musicFile` not present in
> `inputs` before a VM exists. The renderReel bed tests carry the "never waited on" property.
>
> Proven on the first rendered reel's own assets with a real Openverse track: `music bed: upbeat
> -> 15s at I=-33`, `mix 3 take(s) + 0 diegetic bed(s) + music:upbeat`, decode-validated. core
> render +4, backend media +7 (one rewritten: it asserted "no row" and would have gone green
> vacuously over the new row), renderReel +3, cost 94/94, typecheck + biome clean.)


> Last verified: 2026-09-04 (33.1-06 / audit Step 2 - **THE RETRY LOOP IS CLOSED, AND THE
> FAILURES THAT ACTUALLY HAPPEN HAVE WORDS.**
>
> **Retry feedback.** "Try again" is a chat message on the same thread (33-07), and the thread's
> plan row is unique (`by_thread`), so the refusal the canvas just showed is sitting on that row
> as `proposalRefusal` -- and until now went to the owner, never to the model. The specialist got
> the same brief blind and failed the same way: 9 of 17 outright refusals and 8 of 10 lost
> variations in the audit log were one code. `plans.refusalForThread` reads the row;
> `buildSpecialistPrompt` appends ONE driver-plane line for the media route (`mediaRetryLine`):
> *"Your previous storyboard for this brief was refused -- variation A: <clause>. Fix exactly
> that in this attempt and keep the rest of the direction."* The clause is `deckRefusalClause`'s
> -- the same table the canvas reads -- so owner and model are told the same thing in the same
> words, and the skill body is re-taught nothing (§5: driver-plane, short pieces). Tenant-scoped
> by the index; asserted. Mutation-proven: silencing the line fails exactly the positive case.
> **Scene numbers are NOT fed back** -- `parseVariations` does not carry them and widening three
> layers for one number was not worth it; the code names the failure and the skill already teaches
> the arithmetic.
>
> **Failure words.** `reasonCodeFor` matches the assembler's own `ERROR:` wording, and two lines
> the first live reel printed had no pattern: *"needs a TrueType font"* -> `card_font_missing`,
> *"is still speaking at ... but the reel ends at"* -> `narration_overruns_reel` (the ONE overrun
> the assembler still refuses). Both had collapsed into `render_failed` -> "no plainer word". The
> canvas now words those two plus the codes the audit log actually contains -- `http_402`,
> `credit_balance_exhausted` (11 of 58 jobs), `media_not_configured`, `submit_threw`,
> `tts_no_audio`, `tts_not_verbatim` -- and `failureClause` falls back to *"refused the request
> with HTTP NNN"* for any other real status instead of the generic clause. `speech_out_of_window`'s
> canvas sentence is deleted: the assembler delays a colliding take and never emits it. Its core
> pattern stays (render.test.ts pins it; harmless).
>
> core render 145/145 (+2 rows), backend dispatch 116/116 (+3), web canvas 127/127 (+1), typecheck
> clean on core/backend/web, biome clean.)


> Last verified: 2026-09-04 (33.1-06 - **THE FIRST REEL RENDERED. WHAT THE OWNER SAW IN IT, AND
> THE THREE FIXES -- TWO OF THEM PRODUCT DEFECTS THAT WOULD HAVE SHIPPED.**
>
> Plan `mh74cdsv…` rendered end to end (`media.rendered`, 10 gates, `media.reel_saved`). Frames
> were pulled from the published mp4 and READ rather than described; the findings and their fixes:
>
> **1. Two voices.** The 7s Grok clip was a presenter speaking to camera, with a stereo AAC track
> peaking at 0 dBFS -- louder than the narration take (-19.4 dB). `assemble_final.sh` mixed it as
> the *diegetic bed* at `SFXVOL=0.12`, exactly as designed for Sora's ambient SFX. **ADR-027's "no
> native audio" was false** (superseded on that claim by ADR-030). Fix: the bed is taken ONLY from a
> scene with no voice take -- `[[ "$KIND" == "video" && ! -f "$voice" ]]`. The narration stays;
> the clip's improvised speech goes. The owner's alternative (detect a voice, skip the take) is
> declined in ADR-030: it would keep the words nobody approved and drop the ones the owner did.
>
> **2. The text card ran off both edges.** "AUTOMATE THE REPETITIVE" was drawn as ONE line at
> `H/22` px -- drawtext does not wrap -- and shipped as "UTOMATE THE REPETITIV". Fix: the words are
> folded first (`fold -s`, width derived from the same `W`/`H`/fontsize the filter uses), then
> drawn **one `drawtext` per line**, each centred on its own width. Per-line rather than one
> multi-line file because this ffmpeg lineage (BtbN master, gyan 8.x) shapes a LF as a .notdef
> BOX glyph -- seen in two fonts -- and left-aligns a multi-line block inside its centred box.
> The per-line files are written RELATIVELY beside the input: `textfile=` sits inside the filter
> string where no path conversion reaches it, so a `$TMP` (POSIX) path is unopenable by a native
> ffmpeg on a developer's machine. The `textfile=`/`expansion=none` trust boundary is unchanged and
> the tripwire now pins the per-line `${lf}`.
>
> **3. Captions never burned, and would have overflowed when they did.** `captionStatus: failed`,
> `captionReason: render_failed`: MSYS argument conversion rewrote `fontsdir=/usr/share/fonts`
> INSIDE `burn_caps.sh`'s `-vf` string into `C:/Program Files/Git/...`, and the drive colon broke
> the filtergraph -- the same conversion that SAVES the assembler's `mktemp` paths. The local runner
> now sets `MSYS2_ARG_CONV_EXCL=subtitles=`, the narrowest exclusion; verified the burn exits 0 AND
> the assembler still renders. Then the real defect: the shipped style is 64px DejaVu Sans,
> margins 80/80 on a 1080-wide script, **`WrapStyle: 2` (no wrapping)**, cues up to 32 chars --
> a 31-char cue touched BOTH frame edges even in the narrower fallback face. `WrapStyle: 0`
> (smart wrap inside the margins) makes overflow impossible for any cue; asserted in
> `captions.test.ts`.
>
> **Also confirmed, not fixed here:** the music library is EMPTY in the repo (`LICENSES.md` and a
> README, no track), so every reel ever rendered has been bedless -- the assembler's WARN path,
> correct behaviour. And a caption burn that fails writes `captionReason` on the plan but emits
> NO audit row, which is why the audit log showed no caption event at all.
>
> All three fixes were proven on the SAME five landed assets: `3 take(s) + 0 diegetic bed(s)`,
> the card wrapped and centred (frame read), 15.100000s decode-validated. core captions 35/35,
> backend media+render 308/308 + script tripwires 29/29, web 688/688, biome clean.)


> Last verified: 2026-09-04 (33.1-06 - **THE FIRST REEL TO REACH THE ASSEMBLER DIED FOR WANT OF A
> FONT, AND THE CARD COULD ONLY SAY `render_failed`.**
>
> **The furthest any reel has ever got.** Plan `mh74cdsv…`: a 7-second Grok clip, a Pexels still,
> a `text_card`, three voice takes and a landed transcript -- every purchase succeeded, the render
> ran (twice: the automatic retry fired), and both attempts exited 1. The canvas said "the render
> failed without a more specific cause". The route never logs stderr (§4), so the cause was
> recovered by fetching the five blobs and running `assemble_final.sh` by hand with the plan's own
> scene list: `ERROR: a 'card' scene needs a TrueType font and none was found`. The snapshot bakes
> DejaVu Sans at `/usr/share/fonts/...`; this machine has nothing at any probed path.
>
> **Why the fix is a RELATIVE path and not `ASSEMBLE_FONT=C:\Windows\Fontsrial.ttf`.** Two
> trials settled it rather than reasoning: an MSYS `/c/Windows/Fonts/arial.ttf` passes the
> script's `-f` probe and then SIGSEGVs ffmpeg -- it is not a path a native binary can open, and
> fontconfig has no config to fall back to. A Windows path with a drive colon cannot go into the
> drawtext filtergraph at all, where `:` is the option separator. `createLocalSandbox` therefore
> COPIES a font into the render root as `font.ttf` and sets `ASSEMBLE_FONT=font.ttf`: no drive
> letter, resolved from the cwd drawtext already uses. With it the same five assets render:
> exit 0, `out/final.mp4`, 15.100000s, decode-validated, card drawn.
>
> **The music bed is empty everywhere, not just locally.** `apps/web/scripts/music/` holds
> `LICENSES.md` and `README.md` and no track, so every reel ever baked has rendered with
> `music: none` -- the assembler's WARN path, which is correct behaviour and now identical locally
> (`ASSEMBLE_MUSIC_DIR` points at that directory). A mood in the art direction is a request the
> library cannot yet honour; nothing about the reel fails because of it.
>
> **The observability lesson is the bigger one.** `reasonCodeFor` now yields only
> `ok | render_failed | sandbox_timeout | bad_invocation`, so EVERY assembler refusal -- the script
> writes a dozen distinct, plain-English `ERROR:` lines -- collapses to the same unnamed code, and
> the canvas still carries words for 19 codes nothing emits. A clear message existed and was
> discarded one hop before the person who needed it. The fix belongs in the mapper (a closed set
> of assembler codes the script prints as a token, §4-safe because they are codes, not prose), and
> is Step 2 of the 2026-09-04 audit plan.
>
> Test carries the probe script the assembler would run and is mutation-proven (the font copy
> deleted → fails). web render suite 10/10, biome clean, `next build` green.)


> Last verified: 2026-09-04 (33.1-06 - **A RENDERABLE DECK WAS BEING REFUSED FOR FREE. THE DONOR
> SEARCH IGNORED WHETHER THE DONOR STILL FIT ITS OWN LINE.**
>
> **The live deck** (owner, 2026-09-04, 15s): `text_card 4s/52ch`, `generated_video 7s/40ch`,
> `stock_image 2s/43ch`, `text_card 2s/33ch`. Scene 3 needs ~3.1s in a 2s window, so
> `repairNarrationWindows` looks for a donor. `bestDonor` scored candidates on
> `duration - MIN_DONOR_SECONDS` ALONE, so it took 2s from scene 1 -- which was already at its own
> limit (52 chars needs all 4s). Scene 1 became the next offender, the next pass took the seconds
> straight back, and the repair ping-ponged until its pass budget ran out and the deck refused
> `narration_too_long`. **The 7-second clip carrying 40 characters -- four spare seconds -- was
> never asked**, because limit 2b prefers a still and scene 1 merely LOOKED slack.
>
> **The fix is one bound**: a donor's slack is now
> `min(duration - MIN_DONOR_SECONDS, itsWindow - ceil(itsChars / MAX_CHARS_PER_SECOND))`. The
> WINDOW, not the duration -- shrinking a scene shortens the window it speaks into by exactly what
> it gives away. A silent scene owes its seconds to nobody and is unbounded. The deck above now
> parses to `[4, 4, 4, 3]`, the clip paying twice (7->5->4), total still exactly 15s, and
> `narrationOverrunsReel` returns null. **Shrinking a clip only ever LOWERS the generated total, so
> this can never raise a price the user already approved.**
>
> **THE SENTENCE MOVED WITH THE CHECK.** `SCENE_REFUSAL_WHY.narration_too_long` still read "a spoken
> line is too long to finish before the next line starts" -- a condition 33.1-06 had already
> DELETED (the assembler delays a colliding take now). The card was describing an impossible failure
> while the real one -- the lines summing past the reel -- went unnamed. It now reads "the spoken
> lines add up to more than the reel is long". Grepped repo-wide: no second copy of the old
> sentence survived in `apps/web`, which is the only reason one reason could not say two things.
>
> **`MAX_CHARS_PER_SECOND = 14` was re-derived against the NEW voice model, not assumed.** The
> provider moved to `openai/gpt-audio-mini` this same phase, so the constant was measured rather
> than trusted: a real take transcribed back at 37 chars / 2.70s = **13.7 chars/s**, 133 wpm. The
> constant is right and the refusals it produces are arithmetic, not policy -- which is why the fix
> had to be in the donor search and could NOT be "remove the constraint".
>
> The regression test carries the owner's deck verbatim and is mutation-proven: reverting the bound
> to `floor` alone fails it. core 1247/1247, backend media+dispatch 399/399, web 687/687, typecheck
> and biome clean.)


> Last verified: 2026-09-04 (33.1-06 - **THE LOCAL RUNNER HAD NEVER RUN THE ASSEMBLER. IT
> SHIPPED GREEN AND DIED `spawn sh ENOENT` ON THE FIRST REAL REQUEST.**
>
> **How a 9-test file missed the only command that matters.** `renderReel` issues exactly one
> command: `sh assemble_final.sh ...`. Every test in `localSandbox.test.ts` spawned **`node`** --
> present on PATH on every platform -- so the suite was fully green while the runner could not
> execute the assembler at all on Windows. Coverage of the mechanism (spawn, cwd, argv, exit code)
> is not coverage of the behaviour. The new case spawns `sh`.
>
> **Why `sh` is absent and why the substitute must be BASH.** The spawn is `shell: false`, so
> there is no interpreter to fall back on; Windows has no `sh`. `assemble_final.sh` is
> `#!/usr/bin/env bash` and leans on arrays (`TAKE_ABS`/`TAKE_PAD`), so a strict POSIX `sh` would
> parse-fail. `resolveShell` substitutes Git for Windows' `bash.exe` -- `git` on PATH is already a
> precondition for this repo -- with `MEDIA_RENDER_SH` as the override. **Only the literal `sh` is
> substituted**, never a real binary; asserted for `ffmpeg`.
>
> **THE TEST THAT COULD NOT FAIL, AND HOW IT WAS CAUGHT.** The first version of the new case only
> ran `sh` through the sandbox -- and it PASSED with `resolveShell` mutated to a no-op, because
> vitest inherits the developer's Git Bash PATH where `/usr/bin/sh` exists, while the server that
> serves the route is launched from `cmd.exe` and does not. The test was measuring the shell it was
> started from, not the fix. The falsifiable assertion is on `resolveShell` ITSELF (`!== "sh"`, and
> the path exists). Re-mutated afterwards: the no-op is now KILLED. A green run proves nothing
> until a mutant has failed it.
>
> **MSYS PATH CONVERSION MUST STAY ON -- switching it off broke the render.** `MSYS_NO_PATHCONV=1`
> + `MSYS2_ARG_CONV_EXCL=*` were added defensively, to stop a scene spec (`video:7`) being rewritten
> as `video;7`. That mangling **does not happen** (the test now establishes it), and disabling the
> conversion caused a real failure instead: `assemble_final.sh` builds scratch paths from
> `mktemp -d`, which returns POSIX (`/tmp/tmp.XXXXXX`), while ffmpeg is a NATIVE Windows binary --
> `Error opening output /tmp/tmp.VyOaHKI2hh/p_000.mp4: No such file or directory`. The conversion is
> the bridge. **A guard added against a hypothesised failure broke the working path**; the env
> override is gone and the spawn is plain again.
>
> **How this was found for $0.** Three assets from a part-paid batch were still in storage (a $0.49
> 7s Grok clip, a Pexels still, one voice take), and `handleRenderRequest` touches NO plan row -- it
> fetches blobs, renders, uploads to pre-minted URLs, returns JSON. So the route was exercised
> directly with real bytes and deliberately-invalid upload URLs. Both defects surfaced before a
> single new cent was spent. **Do this before paying for a fresh deck: the render step is the one
> plane no offline test reaches.**
>
> web render suite 9/9 (was 8), typecheck and biome clean, `next build` green. Verified end to end
> through the real spawn: exit 0, `out/final.mp4`, 15.100000s, decode-validated.)


> Last verified: 2026-09-03 (33.1-06 — **THE RENDER STEP CAN NOW RUN ON A DEVELOPER'S MACHINE.
> A SECOND `SandboxLike`, DEV-ONLY, BEHIND TWO GUARDS.**
>
> **The wall this removes.** `renderReel` hands the assembler to a Vercel Sandbox, whose
> credentials come from OIDC — automatic on Vercel, unavailable anywhere else. So locally the reel
> died at the LAST step with `Media env not configured: MEDIA_RENDER_SECRET`, having successfully
> bought every picture and every voice take. Every other plane could be exercised locally; the one
> criterion no offline test can reach could not. The alternative was a Vercel account whose
> Active-CPU quota, per this file's own warning, PAUSES sandbox creation for 30 days when exhausted
> on Hobby — an outage, not a bill — to verify one reel.
>
> **`SandboxLike` was already an interface with a swappable implementation**, five methods wide, so
> this is a second implementation of an existing seam rather than a new seam. `apps/web/app/api/
> media/render/localSandbox.ts` backs it with `node:child_process` and a temp dir.
>
> **IT IS NOT A SANDBOX, AND THE MODULE SAYS SO IN ITS OWN HEADER.** The real one is isolation:
> `networkPolicy: "deny-all"`, `persistent: false`, a fresh VM, tenant bytes that never outlive it.
> None of that holds here — it runs ffmpeg as the developer, on the developer's disk, on the
> developer's network. It is acceptable ONLY because operator and tenant are the same person on a
> local deployment.
>
> **TWO GUARDS, AND THE SECOND IS THE ONE THAT MATTERS.** `MEDIA_RENDER_LOCAL=1` is the opt-in —
> but an env var is precisely the thing that gets copied between environments by accident, so an
> opt-in alone is not a safety property. The route ALSO refuses when `VERCEL` is set, which the
> platform sets on every deployment and nobody can forget. A stray `MEDIA_RENDER_LOCAL` in a
> production project therefore downgrades nothing; it is ignored and logged.
>
> **What it still holds, because dropping these would make it a bad template to copy:**
> - **Path containment.** Every path resolves under one temp root or throws — checked with
>   `relative()`, not a `startsWith` on the joined string, which mis-answers for a sibling
>   directory whose name merely begins with the root's. Core already guards filenames from a
>   request body; this is the second enforcement, at the boundary where a traversal would reach a
>   real disk.
> - **NO SHELL.** `spawn` with an argv array. Tenant scene text reaches these scripts as file
>   CONTENT and a card's words are drawn by ffmpeg, so a shell here would make a semicolon a
>   command. A test hands `"; touch pwned.txt"` as an argument and asserts it comes back as one
>   literal string with no file created.
> - **Missing is `null`, never a throw** — the real sandbox's contract. A throw would surface as an
>   unhandled route error with NO reason code on the plan row instead of the governed
>   `mp4_missing` / `sidecar_missing`.
> - **`stop()` deletes the root**, so tenant media does not accumulate in temp after the reel is
>   stored.
>
> **CONFIGURATION on the local deployment** (none of it existed before, which is why this step had
> never been reached): `MEDIA_RENDER_SECRET` — minted here, 32 random bytes, and it must MATCH on
> both sides, Convex env and `apps/web/.env.local`; `MEDIA_RENDER_URL` =
> `http://127.0.0.1:3111/api/media/render`; `MEDIA_RENDER_LOCAL=1` in the web env only.
> **`next build` + a RESTART is required** — the route reads `process.env` at request time but the
> web app bundles at build time, and a stale `next start` is the silent version of the clock-plane
> defect. Verified after restart: the route answers **401** to an unauthenticated POST, so the
> shared secret is genuinely enforced and not merely configured.
>
> web 686/686 including 8 new tests for the runner, typecheck and biome clean.)


> Last verified: 2026-09-03 (33.1-06 — **"RUNS INTO THE NEXT LINE" IS NO LONGER A REFUSAL. THE
> ASSEMBLER MOVES THE TAKE. The owner asked for this constraint removed twice; it was removed by
> making the renderer stop needing it, not by deleting the guard in front of it.**
>
> **Why the obvious version was refused first, and why that was right.** `assemble_final.sh` had
> TWO hard errors — speech past the end of the reel, and speech running into the next line — and
> both `exit 1`. Deleting the parse-time check alone would have converted a FREE refusal into a
> PAID one: every picture and voice take bought, then an ffmpeg abort. So the renderer changed
> first.
>
> **THE ASSEMBLER NOW PUSHES.** A colliding take is delayed to `previousEnd + TAKE_GAP_S` (0.12s)
> and the run continues. The property that mattered — never two narrators over each other — is
> unchanged; only the remedy moved, from refusing a reel to moving a take. `TAKE_PAD` and
> `TAKE_ABS` are both rewritten so the captions sidecar keeps agreeing with the mix: `speech_abs_s`
> is what `rebaseWords` shifts by, and a mix that moved without it would caption the reel against
> timings that no longer exist. **No atempo, no trim, no pad — the push is an OFFSET change and
> nothing else**, which is why the no-time-stretch tripwire still passes untouched.
>
> **ONE hard error survives, and the distinction is the whole design: speech still running when
> the reel ENDS.** There is nowhere to delay it to — the picture track is a fixed length. Only a
> shorter line or a longer reel cures it, both upstream.
>
> **So the parse gate was NARROWED, not deleted, and it now SIMULATES the renderer.**
> `narrationOverrunsReel` walks the deck with a cursor, reproducing all three placement rules:
> a take that fits its scene is CENTRED (ending later than a left-aligned one, which a naive model
> under-predicts), a take longer than its scene ANCHORS at the scene start, and a take that would
> begin before the previous finished starts at `previousEnd + gap` **and that displacement
> CASCADES**. The cascade is the only route to the surviving fatal case, which is exactly why a
> per-line window test cannot decide it and a running cursor can.
>
> **IT WAS VALIDATED AGAINST REAL FFMPEG, NOT A SOURCE SCAN** — the standing lesson on this
> subsystem, and it paid: the harness rendered a genuinely colliding deck, printed
> `note: voice 4 pushed 18.200s -> 20.520s`, and then failed with *"still speaking at 32.120s but
> the reel ends at 30s"*. `narrationOverrunsReel` predicts **32.12s** for that same deck. The model
> agrees with the renderer to the millisecond. A second run with a shorter final take rendered end
> to end: 30.016s, decode-validated, sidecar written, `no_overlapping_lines` still a declared gate
> and still true.
>
> **THE SECOND GATE HAD TO MOVE TOO, and finding it is the "fixing one gate reveals the next"
> pattern.** `reserveSceneJobInner` re-checked the identical rule per scene on the money path.
> Narrowing only the parser would have left a deck accepted by one gate and refused by the other.
> It now calls the SAME function, once, over the whole deck — a per-scene call could not see the
> cascade anyway. A third site (`media.ts:~2600`) is the canvas character counter: display-only,
> left alone, and now slightly conservative — it may show a line as over-long that will render.
>
> **THE TESTS THAT WENT RED DESERVED TO, AND TWO OF THEM TAUGHT SOMETHING.** Three storyboard
> tests asserted the old refusal. One of them — "the only slack is INSIDE the window" — STILL
> refuses, and the reason moved: 14.4s of speech plus a 2.3s line cannot fit a 15-second reel, so
> it is the surviving end-of-reel case reached through the cascade, not a collision. The first
> rewrite of that test asserted acceptance and was wrong; the renderer's own arithmetic settled it.
> A new test pins the cascade specifically — three lines that each fit their own scene and only
> overrun in aggregate — which is the case a per-line check passes and the renderer eats.
>
> The assembler tripwire was REPLACED, not deleted: it now asserts the push happens, that the gap
> is non-zero, that the displacement is an offset change, and that the old abort sentence is GONE —
> so a well-meaning revert cannot restore an abort the parse gate no longer backstops.
>
> core 1246/1246, backend media+render 337/337, dispatch+plans 141/141, cockpit 77/77, web 678/678,
> typecheck and biome clean.)


> Last verified: 2026-09-03 (33.1-06 — **A MISSING CREDENTIAL USED TO STRAND THE REEL SILENTLY.
> IT NOW FAILS THE LINE. Found by a live reel that hung, not by a test.**
>
> **The symptom the owner reported was "the reel is taking too long".** There was no error on the
> canvas, none in the ledger, and none on the job row. The backend log had it:
>
> ```
> [CONVEX A(media:submitBatch)] Uncaught Error: Media env not configured: PEXELS_API_KEY
> ```
>
> **The mechanism, and it is general — it was never about Pexels.** Both arms of `submitBatch`
> claim the row and THEN call an adapter: stock claims at `claimLine` and calls `fetchStock`; the
> paid path claims and calls `submitLine` / `generateOpenRouterVoice`. Every one of those adapters
> opens with `requireEnvMedia`, which THROWS. So an unset variable killed the whole action after
> the row had already left `queued` — no `recordSubmission` ran, and **`claimLine` will not
> re-claim a claimed row, so no retry could ever reach it again.** The reel waits forever. The same
> hole was one unset variable away on the image, video, voice and caption planes.
>
> **The fix is ONE try around the line body, not a repair per adapter.** Every adapter has the
> identical shape, and a fix applied adapter-by-adapter is the repair that reaches two sites of
> three — this playbook has that scar already. `requireEnvMedia` still throws, and the tests that
> assert it still pass: throwing is how a paid plane fails CLOSED before a cent moves. What changed
> is that the throw no longer strands the row it claimed. A missing variable is recorded as
> `media_not_configured` with `blocked: true` (retrying an unset deployment variable cannot help);
> anything else is `submit_threw`.
>
> **§4 on a thrown message.** The CODE is recorded, never the error text. A throw can carry a url,
> a request body, or a fragment of the narration the line was submitting, and `failureReason` is
> rendered on the canvas.
>
> **WHY THE WHOLE SUITE PASSED OVER THIS.** Every existing stock test sets `MEDIA_PROVIDER_FIXTURE`,
> which short-circuits `fetchStock` **before the env read**. The one line that would have caught it
> was unreachable in every test that touched it. The new test deliberately does NOT set the fixture
> flag, and is mutation-proven: restoring the rethrow kills it and nothing else.
>
> **Operationally: `PEXELS_API_KEY` is not set on the local deployment**, so any deck containing a
> `stock_video` or `stock_image` scene blocks until it is. It is a free key. The media planes now
> need: `OPENROUTER_API_KEY` (images, video, voice, captions) and `PEXELS_API_KEY` (stock).
>
> backend media 286/286, typecheck and biome clean.)


> Last verified: 2026-09-03 (33.1-06 — **CAPTIONS MOVED TOO. EVERY PAID MEDIA PLANE IS NOW ON ONE
> CREDENTIAL, AND THE ENTRY BELOW THIS ONE IS WRONG ABOUT THAT. ADR-029 supersedes ADR-028's STT
> half.**
>
> **The correction, first, because the stale claim is one entry down and a reader will hit it.**
> The 2026-09-03 voice-plane record below says captions cannot leave OpenAI. They can:
>
> ```
> POST openrouter.ai/api/v1/audio/transcriptions
>   model=openai/whisper-1  response_format=verbose_json  timestamp_granularities[]=word
> -> 200  {"duration":3.5,"usage":{"seconds":4,"cost":0.0004},
>          "words":[{"word":"Founders","start":0,"end":0.6}, … 9 words, 0 malformed]}
> ```
>
> Complete per-word `start`/`end`, in exactly the shape `submitCaptions` already parses, at
> **$0.0060/minute** — computed as `usage.cost / usage.seconds x 60` and identical to OpenAI's
> rate, so `MEDIA_STT_PRICING` does not move. That equality was CHECKED, not assumed: a migration
> that changes a price quietly is what the media price table exists to prevent.
>
> **THE MISTAKE, NAMED, BECAUSE IT WILL BE MADE AGAIN: a `/models` catalogue is not an API
> surface.** The "captions cannot move" claim came from filtering OpenRouter's 424-entry `/models`
> list for anything audio-shaped and finding no Whisper. That list describes what the CHAT endpoint
> routes to. The audio routes keep their own registries, and they are **uncorrelated** with it in
> BOTH directions:
>
> - `openai/gpt-audio` **is** in the catalogue and is **refused** by `/audio/speech`.
> - `openai/whisper-1` is **absent** from the catalogue and is **served** by `/audio/transcriptions`.
>
> So any claim of the form "OpenRouter cannot do X, X is not in `/models`" is unsound. **Probe the
> endpoint.** A route answering `400` with a model-validation error EXISTS; one answering `404`
> does not. The aggravating detail is that the same error had already been caught once that day —
> `/audio/speech` was found by probing after the catalogue implied it was unusable — and the
> catalogue was then consulted and believed a second time, an hour later, for a sibling route.
>
> **What changed in code, and it is small:** the STT fetch host, the credential
> (`OPENROUTER_API_KEY`), and the model id is sent **UNSTRIPPED** — `openai/whisper-1`, not
> `whisper-1`. That is the THIRD arm to learn the same prefix rule after image and tts; OpenRouter
> routes on the vendor prefix and OpenAI's own API rejects it. Everything else — the multipart
> form, `verbose_json`, the word granularity, the `transcript_words_missing` fail-closed — is
> untouched.
>
> **`api.openai.com` now survives in `media.ts` for the RETAINED SORA POLLER ALONE**, which no
> submit path reaches and which may be deleted after 2026-09-24. `requireEnvMedia("OPENAI_API_KEY")`
> has exactly one caller. The adapter header used to say "tts/stt -> still OpenAI"; that sentence
> was true when written and false twice over inside a day, and it has been replaced with the
> catalogue warning above.
>
> **THE CAPTION ROUTING TEST NEVER ASSERTED WHERE THE REQUEST WENT.** It checked the multipart
> fields and the stored transcript and nothing else, so it would have passed unchanged had the host
> stayed on OpenAI — on a file whose OWN header warns that `api.openai.com` legitimately appears
> here and that a source scan therefore proves spelling, not routing. It now asserts the resolved
> hostname, the pathname and the Authorization header, the same discipline the image and video arms
> already had. Renamed off "OpenAI caption submission" too.
>
> Suites after the move: backend media 285/285, typecheck and biome clean on both changed files.)


> Last verified: 2026-09-03 (33.1-06 — **THE VOICE PLANE IS ON OPENROUTER TOO, AND IT IS A CHAT
> MODEL THAT IS CHECKED RATHER THAN TRUSTED. ADR-028.**
>
> **Why this happened at all, because it was not a deprecation.** A3 landed on OpenRouter, the reel
> then reached the voice step, and three attempts failed identically with
> `credit_balance_exhausted` on `openai/tts-1` — an unfunded OpenAI account, on the one plane
> ADR-027 deliberately left behind. The owner's instruction was to move it.
>
> **THERE IS NO LIKE-FOR-LIKE SWAP, and a reader who assumes one will waste an afternoon.**
> `POST openrouter.ai/api/v1/audio/speech` is a REAL route — it answers 400 with a model-validation
> error, not 404 — and it accepts **no model at all**. `openai/tts-1`, `openai/tts-1-hd`,
> `openai/gpt-4o-mini-tts` and `openai/gpt-audio` were each probed on 2026-09-03 and each came back
> `"Model … does not exist"`, the last of them **despite being in OpenRouter's own `/models`
> catalogue**. The voice plane therefore rides `/chat/completions` with an audio modality.
>
> **Three wire facts, all measured:**
> - **`stream: true` is MANDATORY** — without it the API answers `400 "Audio output requires
>   stream: true"`. Audio arrives as base64 across SSE `data:` frames and is reassembled in
>   `generateOpenRouterVoice`. That reader is not defensive coding; drop it and there is no voice.
> - **The samples are headerless `pcm16`** (`wav` is not offered). `pcm16ToWav` in
>   `packages/core/src/captions.ts` adds the 44-byte RIFF header at the arrival edge, using the
>   byte layout `concatWavTakes` already writes. **Two RIFF writers in one file that disagree by a
>   field produce silence nobody finds** — change one, change both.
> - **24 kHz mono**, exactly `MEDIA_DEFAULT_VOICE.sampleRateHertz`, so nothing resamples. `nova`
>   survives the move, probed 3/3.
>
> **THE DEFECT THIS PREVENTS, AND IT WAS OBSERVED, NOT FEARED.** Under a SHORTER system line,
> `openai/gpt-audio-mini` was given the narration line "Nothing sends until you approve it." and
> **answered it** — *"Understood. Just let me know what you are trying to send…"* — twice out of
> two, in a synthetic voice, in a take that would have been mixed into the owner's reel as the
> owner's own script and then transcribed back out by captions as if they had written it. That is
> the **provenance** failure class, arriving through audio. The stronger system line took the same
> input verbatim 3/3.
>
> So the prompt is load-bearing AND insufficient, and the code does not rely on it: the stream
> returns what was actually SPOKEN, `generateOpenRouterVoice` compares it word-normalised against
> what was SUBMITTED, and a mismatch fails the take as `tts_not_verbatim` with `blocked: true` —
> no retry, no stored bytes. **A guarantee we cannot get from the model is taken from outside it.**
> The comparison drops case and punctuation on purpose: a speech engine legitimately says "ninety
> percent" for `90%`, and refusing that would refuse every good take.
>
> **CAPTIONS DID NOT MOVE AND CANNOT TODAY — the honest cost of this decision.** `whisper-1` is
> asked for `verbose_json` + `timestamp_granularities[]=word` and the pipeline hard-fails
> `transcript_words_missing` without per-word times. OpenRouter has no Whisper and nothing that
> returns word timestamps (`gpt-audio` takes audio IN, it cannot emit timings). **With the OpenAI
> account unfunded a reel now renders WITH ITS VOICE and fails at the caption burn**, which
> degrades rather than blocks — a failed burn leaves the uncaptioned reel published.
>
> **Price, and it moved DOWN.** `gpt-audio-mini` bills per audio output TOKEN, but a reservation
> exists before any token does, so the row is still priced per submitted character. Two probes:
> 47 chars → $0.0002496 ($0.0053/1k), 104 chars → $0.0004344 ($0.0042/1k). The table carries
> **$0.006/1k**, above both with ~13% headroom — the direction a reservation must err, since an
> over-estimate refunds at landing and an under-estimate overspends the tenant's cap. 2.5x under
> `tts-1`'s $0.015. The §4.1 reference reel is now **$1.7404** (was $1.762 after 33.1-04, $2.482 on
> sora-2). **Do not re-attribute that whole drop to grok** — two rates moved.
>
> **`speed` is gone and that is a STRENGTHENING.** The old arm sent `speed: 1` to hold D8's
> no-time-stretch rule. This route has no such field, so the rule is enforced by ABSENCE and the
> test asserts no key matches `/tempo|setpts|stretch|pace|speed/`.
>
> **THREE TESTS WERE FIXED BY MAKING THEM READ THE PRICE TABLE, and that is the durable lesson.**
> `media.test.ts`'s reference-job arithmetic called itself "derived from the price table" while
> typing `0.015` as a literal; `media.test.ts` (cost) asserted `$0.018` and `$0.000015` for rules
> that are about ROUNDING and about the CENTS FLOOR, not about any price. A rate move turned three
> statements-of-principle into arithmetic failures that said nothing about their principle. They
> now read `MEDIA_TTS_PRICING[MEDIA_DEFAULT_VOICE.model]` and assert the PROPERTY — 1,200 chars
> bills 1.2 rates and never 2. **A rate a test reads cannot rot; a rate it types always can.**
> A duplicate `describe("OpenAI audio request bodies")` was DELETED rather than updated: it
> asserted the submit body a second time, more weakly, and two copies of one assertion is how a
> repair reaches one site and not the other.
>
> Suites: backend media 285/285, cost 94/94, core 1244/1244, contracts 113/113, typecheck and
> biome clean on every changed file.)


> Last verified: 2026-09-03 (33.1-06 — **A3 IS OBSERVED IN A BROWSER AND IN THE LEDGER. A6 IS NOT,
> AND ONE LIVE DEFECT WAS FOUND AND FIXED ON THE WAY TO IT: A GENERATED CLIP MAY NOW DONATE
> SECONDS TO AN OVERLONG NARRATION LINE.**
>
> **The seeded body: `media-director` version 5, read back rather than guessed** (the phase-10
> lesson — a plan-authored version pin is not evidence). `skillId
> kh7bg9chdc60njw0afj6pt0zs98defj9`, body byte-identical to `packages/contracts/skills/`'s source
> at 26,881 bytes, carrying the 12-second generated cap and the `1..15` grid, with the old
> "three or four generated scenes" rule absent and exactly ONE `N times` ratio figure. Note the
> body's own heading reads `v6` while the row is `5` — two different counters, and the ROW is the
> one that selects at runtime.
>
> **A3 — OBSERVED.** The owner asked for a standalone image and it appeared on the canvas. The
> ledger is the stronger record and it is unambiguous about which vendor served it:
>
> - `media.landed` — `model: "openai/gpt-image-2"` (the OpenRouter-qualified id, NOT lane 29's bare
>   `gpt-image-2` pin), `providerRequestId: "openrouter-4b2ff192-…"`, `estCents 1 / actualCents 1`,
>   `reconciled: "repriced"`, `verdict: "none_reported"`.
> - `media.image_saved` — docId + jobId + planId.
>
> An `openrouter-` request id cannot come from `api.openai.com`. **The four surviving
> `api.openai.com` references in `media.ts` are TTS (`:1348`), STT (`:2206`) and the retained Sora
> poller (`:1708`, `:1765`) — never the image or video submit path.**
>
> **THE A/B THE PLAN ASKED FOR IS UNFALSIFIABLE FOR THIS SKILL, AND WAS SKIPPED FOR THAT REASON
> RATHER THAN FOR COST.** 33.1-06 step 2 wanted one fixture run against the previous body and the
> new one, "comparing the tool arguments", guarding the repo memory where a body edit made a model
> start passing an optional enum it had never passed. `media-director` is granted exactly ONE tool
> and its schema is `{ query: string }`, `required: ["query"]`, `additionalProperties: false`
> (`llm.ts:3862`). There is no optional field to newly populate and an invented one is rejected
> before it reaches the loop, so that comparison could not have come out red. A green result there
> would have been this repo's own "a check that cannot fail". The behavioural test of the new body
> is A6 itself.
>
> **THE DEFECT, AND IT COST THE OWNER TWO LIVE DEAD-ENDS: `widenNarrationWindow` REFUSED TO RESIZE
> A GENERATED CLIP BECAUSE OF THE 4/8/12 GRID THAT 33.1 HAD ALREADY DELETED.** A `narration_too_long`
> refusal is repaired by trading seconds — lengthen a scene inside the offending line's window,
> shrink one outside it. Both ends excluded `generated_video`, and the stated reason was that
> resizing one puts it off the provider's 4/8/12 grid. 33.1-04 widened `GENERATED_CLIP_SECONDS` to
> every integer `1..15`, which retired that reason — but only `repairGeneratedGrid` was updated.
> **The sibling function kept the assumption in code**, which is this playbook's recurring shape:
> the migration reached one gate and not the next.
>
> The cost was not theoretical. A 15-second reel whose clip takes 7 seconds leaves four scenes to
> share 8 — every one of them ON `MIN_DONOR_SECONDS = 2`, so `slack` is 0 across the entire donor
> pool while **five spare seconds sit in the clip, unreachable**. The deck refused whole. The owner
> hit it twice and asked for the constraint to be removed; removing it would have been strictly
> worse, because the check is what stops the pictures being BOUGHT and the render then hard-erroring
> in `assemble_final.sh` — a free pre-spend refusal traded for a paid post-spend failure.
>
> **The fix is an asymmetry, and each half is forced:**
> - **A clip may DONATE.** Safe on both counts that matter: `MIN_DONOR_SECONDS = 2` is itself inside
>   `1..15`, so a shrunk clip always lands on a length the provider can make, and donating only ever
>   LOWERS the deck's generated total and its price. That is why this needs no sight of
>   `MEDIA_GENERATED_SECONDS_CAP`, which lives in `@pikar/cost` and is invisible from `@pikar/core`.
> - **A clip may never RECEIVE.** Growing one spends money the owner has not approved yet and could
>   breach that cap. Unchanged.
> - **A still is asked BEFORE a clip**, which is why the donor search runs twice instead of taking
>   the longest scene outright. Shrinking a still costs the reel nothing; shrinking a clip takes
>   motion out of it. A single "most to give" pass would have preferred the clip in almost every
>   deck, since the clip is usually the longest scene — the opposite of the intent.
>
> **Two existing tests went red, and both deserved to** — each parked untouchable clips outside the
> window to manufacture "no slack". They were passing for the wrong reason: the slack was there all
> along and only the ban hid it. Both were rewritten to say "no slack" honestly, with the outside
> scenes on the floor. **Both new tests are mutation-proven:** restoring the clip ban kills
> `takes the seconds from a generated CLIP …`; inverting the still-first preference kills
> `leaves the clip alone when a still can cover the deficit` plus two older ones. `packages/core`
> 1241/1241, `dispatch.test.ts` + `media.test.ts` green, `tsc --noEmit` clean.
>
> **A6 IS STILL OPEN and one thing about it is already proven:** the owner's deck carried a
> **7-second** `generated_video`, which the pre-33.1 code could not have produced — it would have
> been snapped to 4. What has NOT been seen is that reel rendering end to end, the clip surviving at
> 7 seconds, and a `media.deck_persisted` audit row existing (`dispatch.ts:916` / `:1103`). The
> 2026-08-30 signature to look for is the ABSENCE of any `media.deck_*` terminal, not an error.
>
> **AN OPEN FINDING, NOT FIXED HERE: every media job is still stamped `provider: "openai"`, and
> that value becomes the AUDIT ACTOR of an insert-only table.** `mediaComplete.ts:425` writes
> `actor: row.provider`; `schema.ts:2207` closes the union at `"fal" | "wan" | "openai" | "stock"`;
> `media.ts` pins `"openai"` at seven submit sites. So A3's own row says the actor was `openai`
> three fields away from an `openrouter-` request id that contradicts it. **No behavioural risk —
> all four readers (`media.ts:1169`, `:1239`, `:1935`, `mediaComplete.ts:425`) only ever test
> `=== "stock"`, and the field never reaches `MediaCanvas.tsx`.** But §3 makes the log
> uncorrectable, so every landing from here records the wrong counterparty. Adding `"openrouter"`
> to a closed union over existing rows is widen-migrate-narrow and was left for the owner to
> schedule rather than smuggled into a verification task.)

> Last verified: 2026-08-30 (33.1-05 — **THE VIDEO SUBMIT IS ON OPENROUTER AND
> `succession.replacementWiredUp` IS FINALLY `true`.** The migration ADR-026 decided on 2026-08-27
> and ADR-027 re-decided on 2026-08-30 is now WIRED, 25 days before OpenAI withdraws `/v1/videos`
> on 2026-09-24 and 11 days before the runway tripwire would have reddened the cost suite.
>
> **The contract, as MEASURED and not as read from a docs page.** One live submit, nine polls and
> one content fetch on 2026-08-30 (`33.1-PRICE-EVIDENCE.md` carries the transcript):
> `POST openrouter.ai/api/v1/videos` with `{model, prompt, duration, resolution, aspect_ratio}` →
> `202 {id, polling_url, status}` → `GET /videos/{id}` → `GET /videos/{id}/content?index=0`. JSON,
> not the multipart FormData OpenAI's Videos API required. **`duration` is a NUMBER and
> `resolution` is the tier** — Sora's `seconds: "4"` and `size: "720x1280"` are both gone.
>
> **`duration: 7` SUCCEEDED, and that is the whole reason a new counterparty was accepted.** Until
> that call, the `1..15` grid was an unverified reading of a table. It now has a finished 7-second
> MP4 behind it.
>
> **`usage.cost` came back `$0.49` against `7 × $0.07 = $0.49` predicted — exact to the cent.** The
> price row plan 33.1-04 landed is confirmed against an invoice rather than a docs page, so the
> reservation does not sit below the charge on a no-refunds rail. That is the condition the plan set
> for flipping the flag, and it is why the flag moved.
>
> **THREE POLLERS NOW LIVE IN `media.ts`, AND ONLY ONE IS LIVE.** Read this before touching any of
> them: `pollOpenRouterVideoTask` is the live one — `submitBatch` schedules it and nothing else.
> `pollOpenAiVideoTask` and `pollWanTask` are RETAINED, not fallbacks, each kept so a job submitted
> before its cutover can still land on a scheduled continuation that already names it. The Sora one
> has an expiry: after **2026-09-24** the endpoint it polls does not exist, no in-flight job can
> need it, and it may simply be deleted.
>
> **The new poller is NOT a branch-for-branch copy, and copying it would have shipped a dead
> pipeline.** Sora emits `queued | in_progress | completed | failed`; OpenRouter emitted only
> `pending` then `completed` across nine measured polls — and `pending` is on NEITHER of Sora's
> in-progress names. A faithful copy would therefore have landed `provider_failed` on the *first*
> poll of *every* job, with a fully green suite over a pipeline that never delivers a video. So the
> live poller inverts the test: `completed` and `failed` are the only terminal states and
> **anything else reschedules**, including an unparseable body and any status this vendor adds
> later. Fail-open toward retrying is safe only because the 180-attempt ceiling bounds it — an
> unrecognised state costs a delay and then `poll_timeout`, never an unbounded loop.
>
> **TRUST BOUNDARY: no provider-supplied URL is ever fetched.** Both the poll URL and the content
> URL are built from the id we already hold. This is stronger than the host check the plan
> anticipated, and the measurement is why it was available: the response's `unsigned_urls[0]` is,
> despite its name, an ordinary authenticated endpoint — fetching it **without** our bearer returns
> **401** — so following it would have meant sending our credential to whatever host a provider
> response named. `polling_url` is deliberately absent from the poller's scheduler args. A test
> feeds a response naming `evil.example.com` in both fields and asserts every resolved fetch host is
> `openrouter.ai`, so the decision is falsifiable rather than merely commented.
>
> **THE FLAG AND THE ROUTING ARE ASSERTED IN ONE TEST BODY, ON PURPOSE — and here is the number
> that proves why.** With `replacementWiredUp: true` and `submitLine`'s video arm reverted to
> `api.openai.com`, **`packages/cost` reports 92/92 GREEN** while four backend tests go red. The
> runway tripwire cannot see routing and never could; it stands down on a flag alone. Splitting the
> A7 assertion into two tests would let the flag half pass over a dead endpoint — which is exactly
> the failure `7012068` re-keyed that tripwire to close, reappearing one level up. That mutation was
> run and restored before the flag was committed.
>
> **A8 is asserted on RESOLVED urls, never by grepping the source.** `api.openai.com` still appears
> five times in `media.ts` and every one is legitimate: TTS (`/v1/audio/speech`), STT
> (`/v1/audio/transcriptions`), and two in the retained Sora poller. A source scan proves spelling,
> not routing. The runtime assertion loops over BOTH visual kinds so a third kind added without a
> routing assertion is visibly missing.
>
> **The credential collapsed to one, and that is a deletion rather than a change.** 33.1-03 keyed
> `submitLine`'s env read on `spec.kind` because the two visual kinds then had two vendors. Both are
> now OpenRouter, so a ternary would select the same value on both arms — a branch that cannot
> differ hides the fact that it cannot. `OPENROUTER_API_KEY` is read once, still ABOVE the fixture
> short-circuit so offline runs keep catching a missing credential.
>
> **STILL UNVERIFIED, and stated plainly: A3 and A6.** Nothing here ran against a live stack. No
> storyboard has become a rendered reel through this path, because that needs the seeded local
> Convex DB in the main tree — plan 33.1-06, after an owner-timed merge. What is proven is the wire
> contract against the real provider and the adapter against the measured shapes. What is not proven
> is the end-to-end run.)

> Last verified: 2026-08-30 (33.1-04 — **THE DURATION GRID IS `1..15, ANY INTEGER`, AND
> `illegal_generated_duration` IS RETIRED FOR EVERY LENGTH BELOW 16.** Constants and arithmetic
> only; the submit path is still 33.1-05's, and `succession.replacementWiredUp` is still `false`.
>
> **What a generated scene may now be.** `MEDIA_VIDEO_SECONDS["x-ai/grok-imagine-video"]` and
> `@pikar/core`'s `GENERATED_CLIP_SECONDS` are both the fifteen integers `1..15`. A 5-second and a
> 7-second scene parse, persist and price at their OWN lengths with **no** `deckAdjustments` — that
> was the owner's second live defect on 2026-08-30. `repairGeneratedGrid` still exists and now fires
> only ABOVE 15, snapping to 15 and giving the freed seconds to the last non-generated scene.
>
> **TWO COPIES OF ONE GRID, and they drifted at the last cutover.** `@pikar/core` deliberately does
> not depend on `@pikar/cost`, so the list is written out in both. `media.test.ts` now asserts
> `GENERATED_CLIP_SECONDS` equals `MEDIA_VIDEO_SECONDS[MEDIA_DEFAULT_VIDEO.model]`. **Move both or
> neither**, and the assertion is the only thing that makes that enforceable.
>
> **The price row is grok's published rate, corroborated by a paid call**: 480p $0.05/s, 720p
> $0.07/s, and a live `{duration: 5, resolution: "480p"}` billed `usage.cost` 0.25 = exactly
> 5 x $0.05, which also proves a NON-multiple-of-4 duration is accepted. **No 1080p key** — xAI
> publishes none, so 1080p is `unknown_model`, never a downgrade (rule 2). Pin stays 720p / 4 s:
> six clips are $1.68 against the unchanged $3.50 cap, where sora-2 cost $2.40.
>
> **The trap this plan walked into, and the fix.** Repinning `MEDIA_DEFAULT_VIDEO` DROPS `sora-2`
> out of `PINNED_MODELS`, and all three shutdown tripwires `continue` past it — measured: with the
> repin landed and the shutdown moved to five days out, the file was GREEN. They now key on
> `inScope` = pinned OR carrying a succession OR `deprecated`. **The third arm was found by
> mutation, not design**: under the plan's two-arm predicate, DELETING the succession block silenced
> the alarm that asks for one. `RUNWAY_DAYS` is still 14 and a repin is not a migration.
>
> **NOTHING A HUMAN OR A MODEL READS MAY RESTATE A COMPUTED NUMBER.** The clip-vs-still lever has
> now been wrong on screen three times (a tenth, then a fortieth, then 66.7x for one day) because
> three sentences in `mediaCanvasView.ts` typed the ratio out and three tests pinned the stale word.
> It is DERIVED now — `CLIP_VS_STILL_RATIO` = `round(sceneVisualSpec("generated_video", 4).usd /
> sceneVisualSpec("animated_image", 4).usd)`, today **47** — and the tests compute the same
> quotient. That is why `apps/web` gained a `@pikar/cost` dependency (pure TS, `@pikar/core` only;
> also added to `next.config.ts`'s `transpilePackages`). The e2e spec IMPORTS the sentence rather
> than retyping it. `mediaDirector.ts`'s four "forty times cheaper" sites are **still stale** and
> belong to plan 33.1-06.
>
> **Two rendered sentences became RANGES**, from `GENERATED_LENGTH_RANGE` (derived from the same
> constant the repair snaps to): the adjustment note and `refusalText`'s `illegal_duration` arm.
> A `join(", ")` over the new grid would have printed fifteen comma-separated numbers at a user.
>
> ---
>
> **`MEDIA_GENERATED_SECONDS_CAP = 12` — THE GUARANTEE, RESTORED IN CODE.** The wider grid made an
> all-generated reel composable AND affordable ($1.05 at 15 s, $2.10 at 30 s, both under the
> unchanged $3.50 job cap), which destroyed the arithmetic that used to make kind-mixing
> structural. The ceiling is a total on GENERATED VIDEO SECONDS per reservation, checked in
> `chooseMediaBatch` — the one gate `reserveJobInner`, `reserveSceneJobInner`, `jobEstimate` and
> `imageEstimate` all pass through, so the number on screen and the number that spends agree by
> construction. The refusal is a governed code, `over_generated_seconds`, with its own sentence on
> the canvas naming its own lever (swap a generated scene for a still or stock — never "cut a
> scene", which is `over_job_cap`'s lever). **There is no silent trim.**
>
> **12 is derived, not chosen:** it is `4 + 8`, what `media-director.md`'s VARIATION A already
> spends; it is `3 x 4`, what `media.fixtures.json`'s `reel30s.mixed` already spends; and it is
> below `min(TARGET_DURATIONS) = 15`, which is what refuses an all-generated reel at EVERY target
> rather than only at 60. At $0.07/s it ceilings generated spend at $0.84 (24% of the job cap).
> **Both of those decks sit EXACTLY on the boundary with zero slack** — the boundary is inclusive,
> and `media.test.ts` now parses the shipped skill body and prices the fixture's own deck through
> `chooseMediaBatch`, so a one-second nudge to either goes red instead of going live.
>
> **THE CAP IS UNIFORM, INCLUDING THE BLOCK PATH.** `reserveJobInner` builds one video spec per
> paid block, so a block deck is generated-video by construction and a 6-block reel at 4 s is 24
> seconds — refused. Passing `Infinity` on the block path was REJECTED: a model emitting a block
> deck would evade the ceiling entirely, and a money guard with a documented bypass reads as
> protection while providing none. **§4.1's canonical six-block reel is therefore no longer a legal
> reservation**, and `media.test.ts`'s reference job is three blocks with a named test asserting
> the six-block one refuses.
>
> **A PARTIAL BUY IS MEASURED DECK-WIDE, and this was a REAL hole, not a theoretical one.**
> `reserveSceneJobInner` narrows `lines` to one scene on a partial buy and builds the batch specs
> FROM `lines`, so with only the `chooseMediaBatch` check in place a 12+12+6 deck — refused as a
> whole reel — reserved successfully one scene at a time through `regenerateBlock`, which needs no
> prior batch. Measured on the landed cap, then closed by summing the WHOLE deck's generated
> scenes, which is the rule this function already states for every other refusal. The check sits
> AFTER the scene loop so an unmakeable length still reports `illegal_duration`.
>
> **If you change the cap:** it is a POLICY, not an impossibility — read ADR-027 §"What the
> mitigation is not". Raising it above 15 silently re-permits an all-generated reel at every
> target. `MEDIA_JOB_CAP_USD` stays 3.50 and `RUNWAY_DAYS` stays 14.)

> Last verified: 2026-08-30 (33.1-03 — **THE STILL PLANE IS ON OPENROUTER AND ITS PRICE ROW IS
> MEASURED RATHER THAN GUESSED.** The block below decided both planes would move; this is the image
> half, landed. Video has NOT moved yet — 33.1-05 owns it, and until then
> `submitLine`/`pollOpenAiVideoTask` still post to `api.openai.com`.
>
> **What changed.** `submitLine`'s image arm posts to `https://openrouter.ai/api/v1/images` on
> `OPENROUTER_API_KEY`. The video, TTS and STT arms still read `OPENAI_API_KEY` — the credential is
> chosen from `spec.kind` on one line, so **grepping `media.ts` for `api.openai.com` tells you
> nothing about where an image goes**; three legitimate other users of that host remain in the file.
> The test asserts the RESOLVED url handed to `fetch`, and so must any future one.
>
> **The price row is a MEASUREMENT.** `MEDIA_IMAGE_PRICING["openai/gpt-image-2"] = 0.006`, from one
> real call on 2026-08-30 that billed **$0.004875** for `(1024x1536, quality: low, n: 1)` —
> $0.004740 fixed (`image_tokens: 158`, constant for that geometry) plus $0.000135 of prompt. The
> row rounds UP by $0.001125 because it is a pre-request RESERVATION on a no-refunds rail; that
> headroom is ~225 further prompt tokens. It replaces a self-described "conservative" $0.01 that was
> **2x the real cost**. Raw response and the re-runnable command:
> `.planning/phases/33.1-*/33.1-PRICE-EVIDENCE.md`. Deriving from a table again, rather than from a
> call, is a regression.
>
> **`size`, NEVER `aspect_ratio`, and NEVER BOTH.** The same probe sent each. They are **not
> interchangeable**: `aspect_ratio: "9:16"` returns **864x1536** at $0.003735 (120 image tokens),
> `size: "1024x1536"` returns **1024x1536** at $0.004875 (158). `size` reproduces
> `MEDIA_DEFAULT_IMAGE`'s exact geometry, so the migration changed the transport and not the
> picture. **The deferred finding, with its evidence already in hand:** stills are 2:3 while the reel
> is 1080x1920 (9:16), so every generated still is reshaped by the assembler to fit a frame it was
> never composed for — and the correctly-composed option is also **23% cheaper**. That is its own
> phase, because it changes what every still LOOKS like.
>
> **THREE COPIES OF ONE STRING.** `MEDIA_DEFAULT_IMAGE.model`, `MEDIA_IMAGE_PRICING`'s live key and
> `media.fixtures.json`'s image `id` are all `openai/gpt-image-2` and **must move together** — the
> fixture-parity test is what enforces it. Route-qualified deliberately: `buildSubmitBody`'s image
> arm sends `spec.model` UNSTRIPPED, and OpenRouter does not know a bare `gpt-image-2`. (The `tts`
> arm's `.replace(/^openai\//, "")` is correct for `tts` and would be a bug here.)
>
> **THE HISTORICAL ROWS STAY.** `"gpt-image-2": 0.01` and `"wan2.5-t2i-preview": 0.03` remain in
> `MEDIA_IMAGE_PRICING` with no submit path, for the same reason the `wan2.5-*` video rows do:
> `mediaJobs` rows written before a cutover carry the old id, and an unpriceable historical row is a
> **refused read**, not a cheaper one. They are not fallbacks — rule 2 forbids falling back to
> another row, and no code can select them.
>
> **DERIVED NUMBERS MOVED WITH IT** (`media.fixtures.json`'s `sceneKinds` is `_derived` and the test
> recomputes it): `animated_image` $0.01 -> $0.006, the §2.3 mixed 30 s reel $1.24 -> $1.224, and
> ADR-019's cost lever **40x -> 66.7x** — measuring the still made the lever bigger, not smaller.
> `stockLeaning` did not move; it buys no still. Also fixed here, one plan early: the fixture-parity
> helper used `entries.find`, so a SECOND entry of a kind was never checked at all. It now iterates
> every entry and refuses an empty filter — 33.1-04 adds a second `video` entry and inherits a guard
> that works. Mutation-verified both ways.
>
> **`succession.replacementWiredUp` IS STILL `false` AND MUST STAY SO.** Images do not earn it: the
> flag stands the runway tripwire down for the VIDEO row, and no video submit path has landed.)

> Last verified: 2026-08-30 (**THE SUCCESSOR CHANGED, AND SO DID THE TRANSPORT — `x-ai/grok-imagine-video`
> ON OPENROUTER, [ADR-027](../decisions/027-grok-imagine-video-succeeds-sora-2-on-openrouter.md).**
>
> ADR-027 supersedes ADR-026's video half. The owner chose Grok over `veo-3.1-lite` for one
> property: durations **1–15, any integer**, which retires the `illegal_generated_duration` failure
> class outright where Veo's `4/6/8` only narrows it. It was bought with two costs the ADR states in
> sections of their own — **xAI becomes a new data-transfer counterparty** (reversing ADR-026's
> decisive argument, knowingly), and **the "no reel from generated video alone" guarantee stops being
> structural**: at $0.07/s on a 1–15 grid, a 15 s all-generated reel is $1.05 and a 30 s is $2.10,
> both under the $3.50 cap, both previously impossible. Mitigated by `MEDIA_GENERATED_SECONDS_CAP`
> (12 s, enforced in `chooseMediaBatch`, governed refusal `over_generated_seconds`) — **which is a
> ceiling somebody can raise, not an arithmetic impossibility. Read ADR-027 §"What the mitigation is
> not" before touching it.**
>
> **BOTH MEDIA PLANES NOW GO THROUGH OPENROUTER**, images included (`openai/gpt-image-2`, same model,
> new door). The trigger was not only the 2026-09-24 withdrawal: the OpenAI account read
> `credit_balance_exhausted` on 2026-08-30 and **no media had generated since ~2026-08-17.**
>
> **A TRAP FOR ANYONE REPINNING A MEDIA MODEL:** `PINNED_MODELS` is derived from
> `MEDIA_DEFAULT_VIDEO.model`, so repinning drops `sora-2` out of the set and all three shutdown
> tripwires `continue` past it — green, with nothing wired. Re-keyed onto "carries an unretired
> succession" in 33.1-04. Check this before you move a pin.
>
> ---
>
> **SUPERSEDED — kept because its lesson outlived its decision.** Recorded 2026-08-27 (**THE
> SUCCESSOR IS CHOSEN — `veo-3.1-lite`, ADR-026 — AND RECORDING

> **Formatting-only pass, 2026-08-29.** `biome format` + `organizeImports` ran across this
> subsystem's files to clear a CI `Lint` red that had been blocking the `Test` and `Build`
> steps behind it since 2026-08-27. Whitespace, line wrapping and import order ONLY — no
> behaviour change, and **this is not a re-verification of anything below.** The
> `Last verified` line still means what it said.

> Last verified: 2026-08-27 (**THE SUCCESSOR IS CHOSEN — `veo-3.1-lite`, ADR-026 — AND RECORDING
> THAT DECISION ALMOST DISARMED THE ALARM THAT FOUND IT.**
>
> The runway tripwire keyed on `succession.status !== "decision_pending"`. Writing the ADR flips
> the status to `decided`, so the very act of deciding turned the test green **while `media.ts`
> still submits to the endpoint being withdrawn**. The only surviving alarm would have been "the
> shutdown must not have passed", which fires the day AFTER production breaks. It now keys on
> `succession.replacementWiredUp === true` instead: **a decision is not a migration.** Mutation-
> verified — 5 days of runway while unwired fails with a message naming the submit path and the
> price row.
>
> **WHY VEO, given ADR-016 forbade it.** ADR-016's objection was ECONOMIC — it priced Veo 3 at
> ~$0.40/s against the $3.50 cap and called one 15 s clip *structurally unreachable* at 1.7× the
> whole cap. Veo 3.1 Lite is **$0.05/s**, an eighth of that, and cheaper than the `sora-2` it
> replaces, so `MEDIA_JOB_CAP_USD` stays 3.50 and ADR-016's never-landed raise to 7.50 stays
> unlanded. The decisive reason is not price though: **it adds no new data-transfer counterparty.**
> The owner already holds the GCP credential and ADR-016 already admitted Google as a media
> counterparty, so the one question that genuinely belonged to the owner was already answered.
> `kling-3.0` is yuan-denominated (FX drift inside a USD table) and `minimax-h3` costs more than
> today; `seedance-2.0` was refused on rule 3 (per-million-tokens is not pre-computable per output
> second) and `sora-2-pro` shares the shutdown date.
>
> **NOTHING IS WIRED YET, AND THE FIXTURE SAYS SO** (`replacementWiredUp: false`). Still to build:
> submit/poll/download against Google's endpoint replacing the three `api.openai.com/v1/videos`
> call sites, a `veo-3.1-lite` row in `MEDIA_VIDEO_PRICING` with its `MEDIA_VIDEO_SECONDS`
> durations, repinning `MEDIA_DEFAULT_VIDEO`, and the credential in **Convex env** (never Vercel).
> 28 days of runway; the tripwire goes red at 14. `wan2.5-*` rows stay priceable but have no submit
> path and are NOT a fallback.)
>
> PREVIOUS: 2026-08-26 (**THE PINNED VIDEO MODEL SHUTS DOWN IN 29 DAYS, AND EVERY TEST WAS
> GREEN ABOUT IT.** `sora-2` is deprecated and OpenAI is retiring the VIDEOS API ITSELF on
> 2026-09-24 with no replacement named; `sora-2-pro` shares the date. Verified against
> developers.openai.com pricing + deprecations and corroborated against independent coverage; the
> live pricing page also confirmed our $0.10/s 720p row is still exactly right. THE DEFECT WAS THE
> SILENCE: the fixture already recorded `deprecated: true` AND the date, and the only assertion
> touching it checked that a deprecated entry HAS a date — not that the date is in the future, nor
> that anyone had decided what replaces it. First signal would have been reels failing in
> production. Three tripwires now sit on the PINNED models — a written succession decision must
> exist, the shutdown must not have passed, and a `decision_pending` status must have >14 days of
> runway. Deliberately TIME-DEPENDENT, because a build that can only break when the vendor breaks
> it has no warning value; both arms mutation-verified. NO VENDOR WAS CHOSEN: the successor cannot
> be an OpenAI model, so it amends ADR-024 and carries a data-transfer decision that belongs to the
> owner. The rule-3-filtered shortlist is recorded in `media.fixtures.json` under `succession`, with
> `seedance-2.0` rejected for per-token billing and `sora-2-pro` for sharing the shutdown date.)

> Last verified: 2026-08-26 (**THE GROUNDING PASS — a reel's facts now come from outside before the
> deck is written.** `media-director`'s only tool is `searchVault`, so a proposal was grounded ONLY
> in the tenant's own material — nearly empty for an idea-stage tenant, which is the deck the body
> itself calls "a failed reel". `groundMediaBrief` runs a research turn on the brief first and files
> the findings as a vault doc, so the deck cites them through the `[doc:...]` slot the scene
> contract already validates. THE CONSTRAINT THAT SHAPED IT: `plans` is `.unique()` by
> (tenantId, threadId) and `stageResearchPlan` RECYCLES that row, so a research card staged beside a
> media card would overwrite the card the reel is proposed on — the pass therefore runs the turn
> inline and writes only what has no plan row of its own. IT CAN NEVER FAIL THE REEL: every failure
> arm returns quietly and the media turn proceeds on the vault alone, which is safe BECAUSE the
> citation gate flags an uncited figure regardless — the gate is the guarantee, this is the raw
> material. The media-specific asks live in the QUESTION, not in the GATED `research-specialist`
> body. The turn runner is injected (the `dispatchAndLand` idiom) so all three branches — persist,
> zero-search skip, degrade-on-throw — are covered at $0 rather than by a source tripwire.)

> Last verified: 2026-08-26 (**SILENCE NOW MEANS UNVERIFIED — the citation default, inverted.** The
> parser read a scene with no `Source:` line as claiming nothing (`media.ts` said it outright:
> `// claims nothing`), so the confirm gate only ever fired when the model VOLUNTEERED
> `Source: unverified`. A scene asserting "Founders lose ninety minutes a day", omitting the line,
> passed reservation, render and publish with the figure burned into a frame and nothing going red.
> `media-director.md` mandates the line in prose, and `dispatch.ts` already records what a prose
> mandate on this skill family is worth — "violated twice in six attempts, which is why this is code
> and not another sentence in the body." THE RULE THAT KEEPS IT USABLE: a number is not a claim
> until it measures something, so "you read one screen" is copy and "ninety minutes a day" is an
> assertion. MEASURED, NOT GUESSED, against the two worked examples: 3 of 3 sourced scenes flagged,
> 0 missed, 1 flag on `ONE WEEK A MONTH` — an uncited restatement of the previous scene's sourced
> figure, which is the example being loose rather than the predicate being wrong. All 2517 backend
> tests unaffected. Nothing new downstream: same `needsConfirmation`, same `unconfirmed_claims`
> refusal, same `confirmClaim` lever — only which scenes reach them. Ceiling stated in the section:
> it catches quantities and appeals to evidence, NOT unsourced qualitative claims.)

> Last verified: 2026-08-26 (**THE CARD PALETTE — the deck's own colours finally reach the frame.**
> Text cards were drawn black-on-white while the plan row already carried a `palette` the specialist
> chose, the parser validated and the owner approved on screen. Nothing was missing from ffmpeg; the
> wire stopped three-quarters of the way. THE THING THAT NEEDED THOUGHT, twice: (1) **the ink is
> COMPUTED for contrast, never taken from the palette** — a mid-tone on a mid-tone passes every gate
> this pipeline has (the file decodes, the duration is right, the sidecar is well-formed) and only
> the words are invisible, so it is pinned by a 216-colour WCAG sweep rather than by examples;
> (2) **a colour is the first model-derived value ever interpolated into the filtergraph** — the
> card's WORDS are kept out of it by `textfile=` + `expansion=none`, and that protection does not
> extend to a colour, so the shape is asserted at all three layers and a malformed pair is a REFUSED
> render. Verified end to end against real ffmpeg, not just by source tripwire: card pixels sampled
> at 26,75,67 for a requested 0x1B4B43, an unflagged run still 0,0,0, and `"black;rm -rf /"` exiting
> 2. Typography is deliberately NOT wired — only DejaVu is baked, and accepting a field we cannot
> honour is a promise the renderer breaks silently.)

> Last verified: 2026-08-26 (**FREE STOCK FOOTAGE — two new `VisualKind`s, one $0 provider, and
> the assembler untouched.** `stock_video` and `stock_image` are fetched from a free library at job
> time and land on ordinary `mediaJobs` rows. THE THING THAT NEEDED THOUGHT: this is a $0 line that
> is the OPPOSITE shape to the music bed. Music buys no provider call and gets NO row (a `queued`
> row would deadlock `batchToRender` forever); stock buys BYTES, so it must have a row for them to
> land on. "Costs nothing" and "buys nothing" came apart here. TWO COMPILE-SILENT HOLES were found
> and closed on the way — `deckStillNeedsJob` and the canvas's `buysPicture` both enumerate visual
> kinds by string comparison, so neither went red when the closed set widened; the first would have
> fired the render before the fetch landed, the second would have hidden the button that performs
> it. `deckStillNeedsJob` now carries a test that iterates `VISUAL_KINDS`. NOT VERIFIED AGAINST THE
> LIVE API — see "what is still unproven" in the stock section.)

> Last verified: 2026-08-26 (**THE MUSIC BED — a $0 PRICED LINE, one baked library, one amix.**
> `assemble_final.sh` gained `--music <slug>`, which was on its own DELIBERATELY-NOT-HARVESTED list;
> taking it off that list is the scope decision the list demands, and `assembleScript.test.ts`'s
> deferred-flag tripwire was edited in the same change rather than worked around. THE ONE THING
> THAT NEEDED THOUGHT: the narration assert proves a take reached the mix by finding no span
> quieter than -18dB, so a loud bed under a MISSING take would hold that span above the threshold
> and the gate would pass on a reel with no narration in it. The bed is therefore loudnorm'd to a
> pinned -24 dBTP — a GATE, not a mixing preference, pinned by a tripwire. No duration behaviour
> changed: the bed is built to exactly TOT and takes no part in speech placement.)
>
> Last verified: 2026-08-22 (26-11 -- **both rendered-media write sites now stamp `sourceThreadId`
> beside the `sourcePlanId` they already wrote** (`mediaComplete.ts` for a landed image,
> `render/renderReel.ts` for a finished reel). Both already held the tenant-checked `plans` row, so
> the thread id was one property away. WHY THE PAIR IS WRITTEN TOGETHER: rendered media sits on the
> Phase-26 artifact shelf, and `sourcePlanId` alone cannot answer "which conversation produced
> this" -- a half-written provenance pair reads downstream as LEGACY ABSENCE rather than as a
> missed write site, which is precisely the bug the shelf's known/unknown-provenance tests would
> then bake in. No behaviour else changed; no backfill.)
>
> Last verified: 2026-08-21 (**THIS PLAYBOOK NOW WATCHES `media.test.ts`, AND THE SCHEDULED-TAIL
> DRAIN ACTUALLY DRAINS.** No product behaviour changed — a test-harness defect and a coverage gap.)
>
> - **The gap.** `watch.json`'s entry here listed `media.ts`, `mediaComplete.ts` and `render/` but
>   NOT `media.test.ts`, so the largest test file in the backend was watched by no playbook at all.
>   Sibling playbooks watch their test files (`authorization.md` → `owner.test.ts`,
>   `dashboard-pages.md` → `finance.test.ts`), so this was an omission rather than a decision. It
>   mattered twice in one day: `44c9c3a` and the fix below both changed that file and the §9 Stop
>   hook could not see either, because it only flags CREATED files as uncovered — **a modified file
>   that no playbook watches is invisible to it.** Now added.
> - **The drain was usually a no-op, and it read as correct.** `44c9c3a` tracked every harness and
>   called `finishInProgressScheduledFunctions` in `afterEach`; the symptom went from "got 2" to
>   "got 1" and stopped there. convex-test schedules with
>   `setTimeout(() => { …; scheduler.add(promise) }, delay)` — a job registers as IN PROGRESS inside
>   its timer callback, not when scheduled. That function is a `while (_inFlight.size > 0)` loop, so
>   a test ending right after scheduling leaves the set EMPTY and the drain does nothing whatsoever.
>   One macrotask yield before each pass is when due timers fire and register, so there is something
>   to await. Three passes for chains; bounded; a zero-delay yield never reaches the pollers' 10s
>   self-reschedule, which is why `finishAllScheduledFunctions` is still unusable here.
> - **Verify it with the defect STATE, not with repetition.** The failure does not reproduce
>   locally (4/4 baseline runs green), so "N clean runs after the fix" proves nothing. Counting
>   `processTimers` stack frames looks like a leak metric and is NOT — ~90 per run, unmoved by the
>   fix, because those are scheduled functions running normally inside their own test. The real
>   metric is jobs still `pending`/`inProgress` when a test ends, read with
>   `ctx.db.system.query("_scheduled_functions")` (which convex-test supports): **17 live jobs
>   across 17 tests before, 0 across 0 after.** Use that probe if this ever regresses.

> Last verified: 2026-08-21 (25.1-06, D12/D14 — **THE PROVIDER TRUTH, AND THE DELETION OF THE fal
> WEBHOOK.** Read this before the plan-by-plan narrative below, which is HISTORY and still describes
> fal in the present tense in a hundred places. media.test.ts 227 passed; ADR-024 is the record.)
>
> - **OpenAI is the provider for every media kind.** Video `sora-2` 720p 4 s via
>   `POST /v1/videos` (polled, then `/content`); image `gpt-image-2` 1024x1536 via
>   `/v1/images/generations` returning `b64_json` inline; voice `tts-1` via `/v1/audio/speech`;
>   transcript `whisper-1` via `/v1/audio/transcriptions`. Pins live in `packages/cost/src/media.ts`.
> - **`POST /fal/callback/*` NO LONGER EXISTS.** The route, its HMAC path segment, its ±300 s replay
>   window, its `fal.media`/`fal.ai`/`fal.run` SSRF allow-list, `mediaComplete.resolveJob` and
>   `FAL_WEBHOOK_SECRET` were all deleted at 25.1-06. **Everything below about the webhook —
>   sections on the 401 ladder, the JWKS upgrade path, the callback URL shape — is a record of code
>   that is gone.** It was verified dead before removal, not assumed: `submitLine`'s webhook
>   parameter had been unused since the ADR-017 cutover, so nothing had minted a callback URL for
>   any provider to call; `resolveJob` had one caller (the route) and `FAL_WEBHOOK_SECRET` had one
>   reader (`resolveJob`).
> - **`FAL_FIXTURE` survives and is still live.** The name is a fossil; the seam still
>   short-circuits `media.ts`'s submit and is what keeps the offline suites at $0.
> - **The legacy Wan poller is retained but is provably vestigial.** `pollWanTask` is scheduled only
>   by its own retry — no submit path enqueues it. Not removed here (different lane); see ADR-024 §3
>   and deferred item 5. Its two env names are now in `ENV_MANIFEST` so their absence is visible.
> - **`MEDIA_RENDER_URL` is now in `ENV_MANIFEST`** (D12). It is read via `requireEnvMedia`, which
>   the drift scan could not see, and it is read INSIDE the scheduled `renderReel` action — so unset
>   it threw where no user was waiting and left the plan at `rendering` while readiness read green.
> Last verified: 2026-08-21 (25.1-03, D6/D7/D8 — **NOTHING A USER GENERATED CAN BE SILENTLY
> DESTROYED OR STRANDED BY GENERATING AGAIN.** media + plans + renderReel suites 293 passed,
> four guards mutation-verified.)
>
> - **D6 — the reel saves at the RENDER terminal, unconditionally.** The `!captionsComing` gate is
>   gone. Captions are pinned on for every reel, so that gate was TRUE at every render terminal
>   that has ever run: the only save site in practice was the caption burn, and a caption pass that
>   stalls, loses its transcript or is swept by the 25.1-02 watchdog never reaches it. The burn's own
>   save still runs — the upsert converges, patching the same doc onto the captioned cut.
> - **CONSEQUENCE, recorded because a test changed subject to say it:** the vault doc now tracks the
>   plan's CURRENT final at every terminal, so on a RE-RENDER the previously captioned cut is
>   released one terminal earlier than before. Vault and plan can no longer disagree. The ordering
>   contract is unchanged — repoint plan, repoint doc, then delete what nothing references.
> - **D7 — `plans.resetPlan` clears `reelVaultDocId`.** `saveReelToVault` upserts on that pointer, so
>   a surviving one made the next reel in the thread PATCH the previous reel's doc, and
>   `deleteOrphanedFinals` then deleted the previous mp4 because nothing referenced it any more. A
>   second reel destroyed the first. `deleteOrphanedFinals` itself needed no change: it reads the
>   live set fresh, so once reel #2 has its own doc, reel #1's blob is never a candidate.
> - **D8 — the second-image refusal is scoped to `queued|submitted`.** `succeeded` was in that set
>   and nothing ever deletes a `mediaJobs` row, so the first image a plan produced locked the button
>   for ever behind an "already started" message about work that had finished. The double-click
>   guard lives entirely in the two non-terminal states; a finished image is history, and D5 means
>   it is durably in the vault before another one is bought.
>
> Last verified: 2026-08-21 (25.1-03, D5 — **A GENERATED IMAGE NOW REACHES THE VAULT.**
> media.test.ts D5 block 5/5, four guards mutation-verified.)
>
> **The invariant this entry adds: every image landing that is a DELIVERABLE files exactly one
> vault doc, and every image landing that is an INTERMEDIATE files none.** Before this a standalone
> image existed only as `mediaJobs.assetStorageId`, read through the plan row — so recycling the
> thread's plan (`plans.resetPlan`) made the user's finished, paid-for image unreachable from every
> surface at once.
>
> - The save lives in `mediaComplete.saveImageToVault`, called from `landResult`'s success arm —
>   NOT beside the storage write in `media.ts`. `landResult` is the one terminal every image
>   landing routes through (the fal webhook, the OpenAI inline `storeAndLand`, and 25.1-02's
>   watchdog sweep); a save on any single caller would miss the others.
> - It is SCOPED to the standalone image (`plans.mediaMode === "image"`, the discriminator
>   `batchToSubmit`/`imageEstimate` already read). A reel's scene still is the same `kind: "image"`
>   row, but its bytes are an intermediate `deleteIntermediates` deletes at the render terminal —
>   vaulting one would file a doc pointing at a blob that is about to vanish.
> - Idempotency is `mediaJobs.vaultDocId`, PER JOB and never per plan: after D8 one plan can hold
>   several successful images, and a per-plan pointer would make the second one unsaveable.
> - `audit` gains `media.image_saved` (planId + jobId + docId — three refs). The prompt is the vault
>   doc's TEXT and never enters the log plane; `llmRedaction.test.ts`'s payload-literal count moved
>   12 -> 13 and the media audit-site pin 7 -> 8 (mediaComplete 1 -> 2).

> Last verified: 2026-08-21 (25.1-02, D3 — **A SEVERED SCHEDULER CHAIN NOW HAS A WATCHDOG.**
> reliabilitySweep.test.ts 23/23, eleven guards mutation-verified.)
>
> **The invariant this entry adds: no non-terminal media state may outlive one sweep interval.**
> 25.1-01 closed the paths that CRASH; this closes the paths where nothing crashed and nothing ran —
> a poll chain that stopped, a render trigger that was never re-evaluated, a transcript nobody came
> back for. Those states write no terminal and throw nothing, so nothing but a clock can notice
> them. `packages/backend/convex/reliabilitySweep.ts`, two `@convex-dev/migrations` migrations
> (the `vaultSweep.ts` shape) behind ONE cron: `crons.interval("reliability-sweep", {minutes: 30})`
> to `internal.reliabilitySweep.runSweep`, which re-runs both with `{reset: true}` (a completed
> migration no-ops on a bare invocation — the stranded-.xlsm lesson, vault.md).
>
> **Thresholds, exported so tests pin them, each a stated multiple of what it backstops:**
> `SUBMITTED_STALL_MS` 45 min (the poll cap is 180 x 10s = 30 min), `RENDER_STALL_MS` 60 min,
> `CAPTION_STALL_MS` 30 min. Strictly PAST, never at — a row exactly at its threshold is left alone.
>
> **The job sweep writes NO terminal of its own.** A stale `submitted` row is landed through
> `mediaComplete.landResult` with `watchdog_submit_timeout`, so it reconciles its spend, emits its
> one `media.landed` audit line, and re-fires the render + caption triggers — the plan then
> terminalizes as `incomplete_batch` through the ordinary path. That is also why the
> "only media.ts and mediaComplete.ts write a terminal `mediaJobs` status" pin still holds.
>
> **The plan sweep's four exclusions are the load-bearing half** (each proven by a mutation that
> reddens): an UN-ARMED `pending` plan (no batch) is never swept; a batch with a line still in
> flight belongs to the job sweep; a `pending` deck whose scene names no asset source is the
> fix-menu HOLD (33-04), an interactive state and not a stall; and a `transcribing` plan whose reel
> is still `pending`/`rendering` is legitimately WAITING for the render terminal. The render clock
> is the max of the landings, `renderRetriedAt`, AND the `media.render_retry_manual` audit row —
> `media.retryRender` stamps no field on the plan, so that row is the only trace a human retry
> leaves. Reason codes are per state class (`watchdog_render_timeout`, `watchdog_caption_timeout`)
> so transposing two of them reddens a test. A swept caption never touches `renderStatus`.
>
> **User-visible half:** one `watchdog.stalled` notification per batch (job sweep) and per plan per
> pass (plan sweep), static copy, no refs. The kind is deliberately NOT in `NOTIFICATION_KINDS` —
> that list arms `notifyExternal.dispatch`, i.e. the mailbox, and a stall notice does not need a
> Gmail token.

> Last verified: 2026-08-21 (25.1-01 Task 2, D2 — **renderReel RUNS UNDER THE ActionRetrier NOW,
> AND A CRASH AFTER `markRendering` TERMINALIZES.** renderReel.test.ts 22/22, media.test.ts
> 237/237, llmRedaction 61/61, cockpit 73/73, backend tsc clean.)
>
> **All three schedule sites** — the landing trigger (`evaluateRenderTrigger`), the manual
> `retryRender`, and the 33-04 auto-retry inside `recordRender` — now go through
> `retrier.run(internal.render.renderReel.renderReel, …, { onComplete:
> internal.mediaComplete.onRenderComplete })`, the `submitBatch` idiom. Each writes the run id to
> `plans.renderRunId` in the SAME mutation (new column + `by_render_run` index — the
> `mediaRunId`/`by_media_run` pattern a third time), because the retrier's onComplete receives only
> `{runId, result}`.
>
> **`onRenderComplete` (mediaComplete.ts, beside `onSubmitComplete`)** acts ONLY on a failed or
> canceled run whose plan still says `"rendering"`: it writes `renderStatus: "failed"` +
> `renderReason: "render_crashed"` (or `"render_canceled"`) + one refs-only dead letter. A plan the
> action already terminalized is left alone, and a STALE run cannot fire at all — every new
> schedule overwrites `renderRunId`, so the old run's lookup misses. The retrier's error string is
> NEVER persisted (it can carry a URL or an env name — §4).
>
> **The non-JSON 200 at the route response is also closed:** `response.json()` is guarded, and a
> body that is not a JSON object terminalizes inline as `route_bad_response` (a new
> `RenderRefusal` member) rather than throwing — inline, deliberately, because the sandbox already
> ran and a retrier retry would buy a second one to learn the same thing. HANDLED failures still
> return normally (the retrier sees success), so the no-retry-past-the-terminal money rule holds;
> only genuine crashes retry (maxFailures 4, the component default).
>
> **Log-plane pins moved deliberately (llmRedaction.test.ts):** media payload-literal count 11 →
> 12, and the per-module dead-letter ban became a per-module COUNT (renderReel.ts 2,
> mediaComplete.ts 1, media.ts 0). Tests observe scheduling as `plans.renderRunId` now — the
> retrier schedules inside its component, so the parent's `_scheduled_functions` no longer names
> renderReel.

> Last verified: 2026-08-21 (25.1-01 Task 1, D1 — **A `batchToRender` REFUSAL IS A TERMINAL NOW,
> NEVER A SILENT RETURN.** renderReel.test.ts 14/14, media.test.ts 237/237.)
>
> **The invariant this entry adds: no `renderReel` exit path may leave `renderStatus` non-terminal
> without something able to terminalize it later.** Before this, `renderReel`'s `!batch.ok` early
> return exited BEFORE `markRendering` with no status write at all — the schedule sites had already
> written `renderStatus: "rendering"`, so the canvas said "assembling" forever and `retryRender`
> refused with `not_failed`. This was the primary silent stall of the media pipeline
> (25.1-RESEARCH D1).
>
> **The fix reuses `recordRender`'s failure arm** (failed + `renderReason` + ONE dead letter,
> refs/codes only) rather than minting a second terminal writer. Refusal codes are outside
> `TRANSIENT_RENDER_CODES`, so no refusal buys the 33-04 auto-retry — they fail straight to the
> dead letter, and the manual Retry button becomes reachable. `renderReel` now takes `planId` as an
> argument (every schedule site knows it), because `empty_batch` — a batch with no renderable rows
> at all — cannot name its plan from the rows.
>
> **Table-driven proof, one row per refusal class:** non-contiguous indices, bad seconds, unknown
> visual kind, `stale_inputs`, vault doc missing/foreign/non-video, unrenderable card text,
> out-of-deck blockIndex, sum ≠ target, batch in flight, empty batch. Each asserts the EXACT reason
> string (transposing two classes reddens), the dead-letter shape, and §4 redaction (no prompt, no
> narration, no card text in the payload).

> Last verified: 2026-08-21 (watch-gate acknowledgment only — plan 25.1-01 execution is IN FLIGHT
> in this working tree: its test-first pass created `render/renderReel.test.ts` before the paired
> source + playbook commit landed. The executing plan updates this playbook substantively in its
> own commits; this entry exists only to keep the Stop gate honest mid-plan and records no
> behaviour change of its own.)
>
> Last verified: 2026-08-18 (**a long line now BUYS seconds instead of losing the deck.**
> storyboard 132/132, @pikar/core 1049/1049, mediaCanvas 124/124, media+dispatch+cockpit 405/405,
> core + backend typechecks clean. All four limits mutation-proven.)
>
> **The report.** A two-variation proposal came back with only variation A: B refused
> `narration_too_long` and the salvage note (33-11/33-13) said so. The owner asked to see both.
> There was nothing to see — a refused variation is never persisted, so the fix had to be upstream
> of the canvas: stop losing the deck at all.
>
> **THE GEOMETRY, which is not the one the refusal makes it look like.** `narration_too_long` names
> a `sceneIndex`, so the fix reads as local, and it never is.
> `narrationCeilingSeconds(scenes, i)` is `start(next narrated) - start(i)` — which is exactly **the
> sum of the durations of scenes `i … nextNarrated-1`**. Call that span the WINDOW. Three
> consequences, and each is a way the obvious repair does nothing at all:
>
> * Shrinking a scene BEFORE `i` moves both endpoints by the same amount.
> * Shrinking a silent scene INSIDE the window is zero-sum — it is already counted.
> * Lengthening the offending scene and paying for it from inside the window is both at once.
>
> So the ONLY move that widens a window is **lengthen a scene inside the span, shrink one outside
> it**, and that rule is uniform across both shapes of the window: when `i` speaks last the span
> runs to the end of the reel, "outside" can only mean before `i`, and the sum grows identically.
> `repairNarrationWindows` + `widenNarrationWindow` in `@pikar/core/storyboard` do exactly that,
> bounded to one pass per scene so two lines cannot ping-pong forever.
>
> **The three limits, each forced rather than chosen:**
>
> 1. **Seconds, never words.** No narration cell is read except for its LENGTH. Rewriting a line to
>    fit would put words in the user's mouth — the provenance rule, and the whole reason this moves
>    time instead of text.
> 2. **Never a `generated_video`, at either end.** Resizing one puts it off the provider's 4/8/12
>    grid — the exact defect `repairGeneratedGrid` exists to prevent.
> 3. **The total never moves.** Donor and receiver trade the same whole number of seconds, so the
>    exact-length rule holds and the generated clips are still priced at what the user approved.
>
> Plus a floor: `MIN_DONOR_SECONDS = 2`. Nothing else in the contract sets one (`repairGeneratedGrid`
> only rejects `<= 0`), and a one-second flash is a glitch, not a scene. A repair that would produce
> one refuses instead.
>
> **Disclosed, like every other moved second.** `SceneAdjustment.why` gains `"narration"` and the
> pair is emitted RECEIVER-FIRST, so `adjustmentNotes` reads the direction off the numbers and the
> donor's sentence can point at the scene above it. The Convex validator is `why: v.string()` — the
> closed set lives in `@pikar/core` — so no schema change was needed.
>
> **Mutation results, because a repair that silently does nothing is the failure mode here.** Donor
> may be a generated clip → CAUGHT. No donor floor → CAUGHT. Receiver may be a generated clip →
> CAUGHT. Donor may come from inside the window → SURVIVED the first fixture, and the test that
> kills it ("takes from OUTSIDE the window even when a longer scene sits inside it") was added for
> exactly that reason. **Do not delete it**: without the guard the repair burns every pass on trades
> that buy nothing, and a deck that should land refuses.
>
> **NOT changed, deliberately.** The variation compare region is still a switcher — the alternate
> gets a summary card and you switch to see it in full. Left alone because "which deck is picked" is
> the same state as "which deck gets bought" (`jobEstimate` prices whatever is in `shots`), and an
> expand-both UI splits that into two states the money path would have to track.

> Last verified: 2026-08-18 (the THIRD gate, found by shipping the second and watching production
> — **`no_deck` MEANS THE HEADING IS ABSENT, AND NOTHING ELSE.** storyboard 127/127, @pikar/core
> 1044/1044, dispatch 98/98, backend 2034/2034, three typechecks clean, mutation-proven.)
>
> **THE DEFECT — a reason code that lied, and a branch that read it.** `parseSceneDeck` returned
> `no_deck` from THREE places: the heading (`headingAt`), the table's header row, and a missing
> required column. `parseBlockDeck` did the same. Only the FIRST means "this body has no deck".
> `persistStoryboard` falls back to `parseBlockDeck` on `no_deck` ALONE and its comment says that
> guard means *"this body has no SCENE DECK heading at all"* — **true of the intent, false of the
> code.** So a scene deck with one renamed column (`Shot`/`Length`/`Scene`/`Script` instead of
> `Visual`/`Seconds`/`Description`/`Narration`) fell through to the block contract, found no BLOCK
> DECK heading either, and the owner was told **"it never wrote a block deck"** about a deck sitting
> fully written in the response.
>
> The four table-shaped returns are **`unreadable_deck`** now, in both contracts, and both refusal
> tables name the COLUMNS — the only thing the code can mean and the only thing anyone can act on.
> The fallback guard is unchanged in form and now true in fact.
>
> **THIS WAS THE THIRD GATE IN A ROW.** heading (`no_deck`) → target duration
> (`bad_target_duration`) → columns (`no_deck` again). Each fix was green, mutation-proven, and
> changed nothing the owner could see, because the next gate below it refused the same body.
> **Before calling a parser fix done, walk EVERY gate below the one you fixed with a
> realistically-decorated body** — a ten-line vitest printing reason-per-fixture finds in seconds
> what a production round-trip finds in twenty minutes and real money.
>
> **A REASON CODE READ BY A BRANCH IS A CONTRACT.** If you add an early return to either parser,
> ask which of the two it is. `grep` every `return fail("<code>")` before trusting what the name
> says — that is what nobody did for `no_deck`, through three separate sessions of fixing it.
>
> **STILL NOT PROVEN: what production's columns actually are.** `unreadable_deck` is inferred from
> a local walk that reproduces the symptom exactly, not from the specialist's body, which is still
> never persisted. The next live refusal will say it in words. If it IS renamed columns, the choice
> is synonyms in `col(...)` vs. tightening `media-director.md` — a decision, not a bug fix.

> **The "UNVERIFIED WORK IN THE TREE" note that stood here is RESOLVED, by the lane that owned it.**
> It named `storyboard.ts`, `storyboard.test.ts`, `dispatch.ts` and `dispatch.test.ts` and asked
> their owner to run the suite and bump the line themselves. Done — see the 2026-08-18 entry at the
> top of this file, and its predecessor below. The note was right to exist and right not to bump.
>
> Its two operational observations are kept, because they outlive the work that prompted them:
> **(1)** A warning left in a playbook is not a durable channel between concurrent lanes — an
> earlier copy of that note was overwritten when this file was rewritten. **That was this lane, and
> it was avoidable**: entries are INSERTED at the top, never written over a region someone else may
> hold. **(2)** `packages/backend/convex/_generated/api.d.ts` moves whenever anyone's `convex dev`
> pushes. It is codegen output — do not read it as authored work, and never `git add -A` here.
>
> Last verified: 2026-08-17 (the SECOND gate on the same body — **A DECORATED LABEL IS THE SAME
> LABEL.** Source + live production repro + `storyboard.test.ts` 122/122, @pikar/core 1039/1039,
> backend 2031/2031, both typechecks clean. No live media run — nothing was generated or charged.)
>
> **THE DEFECT.** The entry below fixed six HEADING matchers and stopped there. FIVE label matchers
> carried THREE different tolerances, and not one of them accepted `**Target duration:** 30` — the
> colon INSIDE the bold, which is the most ordinary way markdown writes a labelled field. A model
> that decorates its headings decorates its labels in the same body, so the owner's reel cleared the
> widened heading gate and refused at the very next one: `no_deck` became `bad_target_duration`,
> **twice, with the heading fix already live in production.** The two matchers carrying the
> NARROWEST tolerance — `Clip seconds` and `Target duration` — are the two that gate an entire deck.
>
> **`fieldOf` failed SILENTLY, which is worse than refusing.** It MATCHED `**Mood:** warm` and
> captured `"** warm"`, feeding markdown decoration into an art direction that goes on to buy video.
> A refusal is loud and someone reports it; a corrupted capture just renders.
>
> Fixed at the root, following the `headingAt` precedent one family down: ONE `LEAD` constant, ONE
> `MARK` constant and one `labelAt` helper, shared by `fieldOf`, `parsePrompts`, `sceneSourcesOf`,
> `parseBlockDeck` and `parseSceneDeck`. **Add a `LABEL: value` read and you use `labelAt`** — five
> copies of one pattern is what let the tolerance drift, exactly as six copies did for headings, and
> neither class can match a letter so neither can eat the label it hugs. `labelValue` strips
> trailing decoration so a captured value can never carry `**` into a prompt.
>
> **The refusals must STILL refuse.** A deck that declares no target at all, and a target off the
> 15/30/60 grid, are both still `bad_target_duration` — pinned by test, the same discipline the
> heading fix used for `no_deck`.
>
> **`bad_target_duration` HAD TWO CAUSES TOO, and the first fix missed it.** `deckTokenCounts` now
> carries a FIFTH number, `targetDurationTokens`: non-zero beside `reason:"bad_target_duration"`
> means the target WAS declared and the value or its decoration is what failed; zero means the
> specialist never declared one. §4-reviewed in `llmRedaction.test.ts`'s own comment block per that
> guard's protocol, and proved by test rather than trusted by name.
>
> **STILL OPEN, not fixed here:** nothing injects a target duration into the specialist prompt — the
> model picks it, steered only by the skill body. An off-grid number remains a live failure mode,
> and `targetDurationTokens` is what will tell it apart from this defect next time.

> Last verified: 2026-08-17 (owner-reported `no_deck` on production — **A DECORATED HEADING IS THE
> SAME HEADING.** Source + repro + `storyboard.test.ts` 115/115 + @pikar/core 1032/1032; no live
> media run.)
>
> **THE DEFECT.** All SIX heading matchers in `@pikar/core/storyboard` were `[ 	]*#*[ 	]*` —
> they accepted `SCENE DECK` and `## SCENE DECK` and rejected `**SCENE DECK**`. A model that
> decorated its headings (routine markdown, and the body asks for a BARE line) had `parseVariations`
> return `kind:"one"`, `parseSceneDeck` return `no_deck`, `persistStoryboard` fall through to
> `parseBlockDeck`, and the owner told **"it never wrote a block deck"** — the BLOCK contract's
> sentence — while a complete scene deck sat in the response. Fixed at the root: ONE `HEAD`
> constant + one `headingAt` helper, shared by `sectionOf`, both deck contracts, both prompt
> sections and the variation splitter. **Add a heading matcher and you use `headingAt`** — six
> copies of one pattern is what let the tolerance drift, and the class cannot match a letter so it
> can never eat the token it precedes.
>
> **The refusal must STILL refuse.** A body with genuinely no deck is the OTHER cause of the same
> code; widening the heading must not swallow it. Pinned by test.
>
> **`no_deck` HAS TWO CAUSES AND THEY WERE INDISTINGUISHABLE.** The raw specialist body is never
> persisted on the refusal path — `landStoryboardRefusal` stores the COMPOSED refusal, not the
> prose — so after the run nothing said which cause it was. `media.deck_refused` now also carries
> `deckTokenCounts`: `{bodyChars, sceneDeckTokens, blockDeckTokens, variationTokens}`, four
> numbers. **A non-zero token count beside `reason:"no_deck"` means the deck WAS written and the
> heading is what failed.** §4-reviewed in `llmRedaction.test.ts`'s own comment block, per that
> guard's protocol, and proved by test rather than trusted by name.
>
> **Unchanged:** the price table, `VISUAL_KINDS`, the 15/30/60 targets, the 4/8/12 generated grid,
> the job cap, and the rule that a scene deck failing for any reason OTHER than `no_deck` is
> refused as a scene deck rather than re-read under the block contract.

> Touched 2026-08-17 to clear the §9 Stop hook — **ACKNOWLEDGEMENT ONLY, NOT A VERIFICATION**, and
> deliberately NOT a `Last verified` bump. The Phase-25 session that touched this file wrote none
> of the code that triggered the check and has not reviewed it.
>
> What triggered it: `MediaCanvas.tsx` and `packages/core/src/storyboard.ts` moved under the
> concurrent phase-33 media lane while the Phase-25 lane was mid-session — commits `7b17640`,
> `e54ae63` (33-13 fixes), then `2f12d0d` and `44dd83a` (biome formatting and import ordering).
> The hook compares against session-start HEAD, so it flags them for whoever finishes a turn next,
> regardless of who wrote them.
>
> **Nothing in Phase 25 touches the media plane.** Its commits are the admission boundary
> (`invites.ts`, `auth.ts`), the isolation gate, the two-provider mail send (`graph.ts`,
> `delivery.ts`), the onboarding first-send projection and the env manifest. If a media-plane
> statement in this playbook is now stale, **it is the phase-33 lane's to verify and bump** — that
> lane's own live-browser confirmation is the entry immediately below.

> Last verified: 2026-08-16 (**LIVE, by the owner, in a browser** — the first live confirmation for
> 33-11/33-12/33-13). The owner re-ran the request that had dead-ended twice and reported: *"it
> works, the brief had all the information."*
>
> **What that confirms, exactly:** the request now reaches a real canvas with a populated guided
> BRIEF, instead of the memo-with-Approve/Save that the `illegal_generated_duration` refusal used to
> produce. The dead end is closed on the path that produced it.
>
> **What it does NOT yet confirm, and must not be read as confirming:** the two storyboards
> rendering side by side as distinct concepts, the citation chips and the confirm gate, the salvage
> and adjustment disclosures actually appearing (they only render when the parser HAS to intervene —
> a clean proposal shows neither, so a good run is not evidence they work), the proposal failure
> card and its retry, or anything on the paid rail. Those remain test-verified only.
>
> The rebuild is part of the fix's history and worth keeping: the app at `:3111` was serving a
> production bundle compiled BEFORE these commits, so the backend being correct was not enough and
> the owner would have seen the old behaviour either way. **A media fix is not live until `next
> build` + restart has run** — the code landing in git is half of it.

> Last verified: 2026-08-16 (33-13 task 3 — **a repaired deck shows every second the parser
> moved.** 33-12's `plans.deckAdjustments` finally has a reader, and phase 33's three-part live fix
> is complete.)
>
> `adjustmentNotes(plan.deckAdjustments, plan.targetDurationSeconds)` renders one line per moved
> scene in `ParserNotes`, beside the salvage note and outside every disclosure widget:
> *"Scene 1 shortened from 10s to 8s — the generator only makes 4, 8 or 12 second clips"*,
> *"Scene 2 lengthened from 20s to 22s — the seconds freed above went back into it, so the reel is
> still 30 seconds."* This is REQUIRED, not polish: 33-12 lets the parser rewrite the user's reel,
> and a silent rewrite is the same defect class as an invented provenance.
>
> **Three things to keep.** (1) The DIRECTION lives in the VERB (`shortened`/`lengthened` derived
> from the two numbers), because a from/to pair under swapped labels reads perfectly and says the
> opposite thing — that is the mutation this suite is written against. (2) The legal lengths come
> from `GENERATED_CLIP_SECONDS` itself, so the sentence cannot name a set the repair does not snap
> to. (3) With no `targetDurationSeconds` (a block deck) the rebalance line quotes NO number rather
> than inventing a reel length.
>
> Verified: apps/web 24 files / 399 tests (canvas 116 -> 123), `tsc --noEmit` clean.
> **Mutation check:** transposing `fromSeconds` and `toSeconds` in the rendered sentence (both
> numbers still present, each under the other's label — the transposition this repo's
> vacuous-test lesson demands over a deletion) reddened the direction test; reverted.

> Last verified: 2026-08-16 (33-13 task 2 — **a salvaged proposal says so, unprompted and
> unexpanded.** 33-11's `plans.lostVariation` finally has a reader.)
>
> `salvageNote(plan.lostVariation)` renders in `ParserNotes`, directly under the brief and above
> everything else — **not** inside a `<details>`, because a disclosure a person has to open is one
> most people never read, and this one changes what the storyboard below IS. The sentence names
> BOTH letters: the survivor ("variation A is the one below") and the sibling that fell through,
> with the reason in words from the SAME `SCENE_REFUSAL_WHY` table the refusal card and the memo
> body read. The surviving letter is DERIVED (`a` <-> `b`) rather than stored — the variation plane
> is exactly two decks by construction (`parseVariations` has no third letter).
>
> **Why both letters.** A user promised a choice of two and silently handed one has been told
> something untrue by omission and would never know to ask for the other; a note that names only
> the loss leaves them guessing which deck is on their screen.
>
> Verified: apps/web 116 canvas tests (110 -> 116), `tsc --noEmit` clean. **Mutation check:**
> transposing the kept and lost letters in the sentence (both letters still present, each under the
> other's role) reddened 2 tests; reverted.

> Last verified: 2026-08-16 (33-13 task 1 — **a proposal refusal is a FAILURE CARD now, not a memo
> with Approve/Save.** The third and last of the three fixes for the dead end the owner hit twice.)
>
> A media run that produces prose but no usable deck lands on a `kind: "memo"` row, and until now
> that row rendered as an ordinary memo: **Approve** and **Save** over a reel that does not exist,
> with the only way forward buried in prose. The render stage has had a proper failure card since
> 33-04/33-08 — stage named, cause in words, price on every arm, code underneath, a retry. The
> PROPOSAL stage now uses THE SAME card (`FailureCardBlock`) and the same fold shape
> (`proposalFailureCard` -> `FailureCard`), with one arm: **Try again**, free, which sends
> `RETRY_PROPOSAL_MESSAGE` through `useSendCockpitMessage` — the cockpit's ONE send path, never a
> second dispatch door (33-07's rule; the canvas has two mount points and a threaded callback is
> two places to forget it).
>
> **Three invariants to keep.**
> 1. `plans.proposalRefusal = { reason, contract, variation? }` is what makes the card possible —
>    a refusal is a STATE, not a paragraph. Codes only (§4). `persistDeck` and `resetPlan` both
>    CLEAR it: a card apologising for the deck that was replaced, or a media failure card on the
>    next EMAIL draft in that thread, are the two ways this field goes wrong.
> 2. **The contract picks the sentence.** `no_deck` means "no scene deck" under one parser and "no
>    block deck" under the other. The refusal vocabulary moved out of `convex/dispatch.ts` into
>    `@pikar/core/storyboard` (`SCENE_REFUSAL_WHY`, `BLOCK_REFUSAL_WHY`, `deckRefusalClause`) so the
>    memo body and the canvas read ONE table — but they stay TWO tables keyed by contract, because
>    merging the unions is how a reason renders the wrong deck's sentence.
> 3. **BOTH mount points branch on the refusal before the kind.** `cards.tsx` (ahead of the memo
>    card) and `CanvasPane` (ahead of "no reel in this thread yet"). Miss the second and the canvas
>    tab tells a user whose run just failed that they never asked for anything.
>
> Verified: core storyboard 109/109, apps/web 24 files / 386 tests, backend dispatch 93/93 and
> media+plans+llmRedaction+skills+importGuard 498 passed / 24 skipped, `tsc --noEmit` clean in
> `apps/web`, `packages/backend` and `packages/core`. No audit or log-plane site was added, so
> `llmRedaction.test.ts`'s pins (12 dispatch payloads, 7 media audit sites) are untouched and green.
> **Mutation check:** transposing the two contract tables inside `deckRefusalClause` (every sentence
> still present, each under the wrong contract) reddened 2 core tests and 2 canvas tests; reverted.

> Last verified: 2026-08-16 (33-11 + 33-12 — **the two reasons a reel request dead-ended, found by
> the owner's own live runs and fixed**, `8eb0dd7` and this commit). The owner asked for a reel
> twice and got a memo card with Approve/Save both times. The trace showed the whole new path
> working — `route-dispatchMedia` → `dispatchMedia` (23s) → `searchVault` — and then BOTH
> proposals dying on `illegal_generated_duration`.
>
> **33-11 — one bad variation no longer kills its good sibling.** 33-03 made a refusing variation
> refuse the WHOLE proposal ("never a silent one-deck fallback"). That doubled the chance of a dead
> end, and both of the owner's runs lost a perfectly good storyboard to its sibling — one on
> variation A, one on B. `parseVariations` now returns `salvaged` when exactly one deck parses; the
> survivor is proposed alone. **The rule that mattered is intact:** the kept deck is the model's
> own, whole and unedited, so no deck nobody wrote is ever proposed. The salvage is NOT silent —
> `plans.lostVariation` carries which sibling was lost and why, and the canvas must say so. Both
> decks refusing still refuses everything.
>
> **33-12 — the generated-clip grid is repaired, not just refused.** The generator makes 4, 8 or 12
> second clips; v2 and v3 of the body both teach this and the model still gets it wrong, which is a
> model-reflex problem no further instruction fixes. `parseSceneDeck` now snaps an off-grid clip
> DOWN to the nearest legal length and gives the freed seconds to the last non-generated scene, so
> the reel is still exactly as long as the user asked. **THREE DELIBERATE LIMITS:** (1) grid, never
> arithmetic — if the model's rows never summed to the declared length, it still refuses, because
> rebalancing a deck that never added up is inventing a reel; (2) down, never up — lengthening a
> scene cannot break the one narration rule (a line must not run into the next), shortening can;
> (3) into a non-generated scene or not at all — lengthening a clip would put it back off the grid,
> so an all-generated deck still refuses. Every moved second is reported in `plans.deckAdjustments`
> (`why: "grid" | "rebalance"`) **and the canvas must show it: a parser that quietly rewrites the
> user's reel is the same defect class as an invented provenance.**
>
> Verified: core 1019/1019, backend dispatch+media+plans+llmRedaction 414 passed, both `tsc
> --noEmit` clean. The dispatch test asserts the repair FROM THE STORED ROW, not from the parser —
> a repair that never reaches the database is one the user never gets. `llmRedaction.test.ts`'s
> dispatch payload count moved 11 → 12 for the new `media.variation_salvaged` event (refs + two
> closed-union letters + a reason code; §4-clean).
>
> STILL OPEN after these two: a proposal refusal that survives both fixes still lands as a MEMO
> with Approve/Save and no retry affordance — the render stage got failure cards in 33-04/33-08 and
> the PROPOSAL stage never did. That is the next fix, and it is what makes a failure look like a
> hang.

> Touched 2026-08-16 (refusal-code lane) to clear the §9 Stop hook — **NOT a verification**, and
> deliberately not a `Last verified` line. This session touched no media code: it widened the §4
> basis guard in `@pikar/core`'s `financeClaim.ts` and added the `agentSteps.refusal` code. The hook
> fired on `packages/core/src/storyboard.ts`, carrying **uncommitted in-flight changes** from the
> concurrent phase-33 lane (which also has `dispatch.ts`, `dispatch.test.ts` and `plans.ts` dirty).
> That work is unread, unrun and unattested by this session, and **the lane that owns it still owes
> this playbook a real entry and a real `Last verified` bump.** Nothing below covers it.)

> Last verified: 2026-08-16 (33-10 — **MEDIA-DIRECTOR v3 IS LIVE. THE ACTIVE ROW IS VERSION 3**,
> read back rather than inferred from a seed log line.)
>
> ```
> $ npx convex run skills:seedSkills '{}'            # from packages/backend
> $ npx convex run skills:getActiveSkill '{"name":"media-director"}'
>   version 3 · skillId kh70r0v9284ds55tgdprmqx4x18cj95w · 20041 body bytes
>   HAS "VARIATION A"  HAS "VARIATION B"  HAS "Source: unverified"
>   HAS "(defaulted)"  HAS "## 1. BRIEF"  HAS "The id does the work"
>   byte-identical to packages/contracts/skills/media-director.md: true
> ```
>
> Deployment: the LOCAL (anonymous) backend `local:local-joel_feruzi-pikar_ai_50c69-1`. **The cloud
> dev deployment has NOT been seeded** — the seed is per-deployment and this read-back speaks only
> for the one it ran against. v2 was the version this replaced, so the collision gotcha did not
> bite here (no optimizer candidate had taken 3); it is still not predictable in general, which is
> why the read-back and not the seed line is the evidence.
>
> **THE SEED IS NOT THE WHOLE STEP — THE PUSH IS.** `seedSkills` compares the body compiled into
> the DEPLOYED functions against the newest registry row, so a seed against a STALE deployment is a
> silent no-op: it ran clean, said nothing, and left v2 active because the running `convex dev` had
> stopped pushing (it had also missed a schema change — the restart's push added ~15 `by_tenant`
> indexes). Neither `touch`ing a `convex/` file nor appending a byte to one woke that watcher, and
> `convex dev --once` refuses while a local backend holds port 3210. What worked: stop the wedged
> `convex dev` AND its `convex-local-backend.exe`, then start one clean
> `CONVEX_LOCAL_BACKEND_STARTUP_TIMEOUT_SECS=300 npx convex dev` (the default 30 s startup timeout
> is too short for this local database — it fails with "Local backend did not start on port 3210"),
> wait for `Convex functions ready!`, and seed after that. **Always read the version back; the seed
> exiting 0 proves nothing.**
>
> No model has yet been shown this body on this deployment — the read-back proves what is stored,
> not what the specialist does with it. The A/B fixture that would prove behaviour was NOT run
> (see 33-10's summary).

> Last verified: 2026-08-16 (33-10 — **THE PHASE-33 CANVAS HAS NOW BEEN SEEN IN A REAL BROWSER, FOR
> $0.** `apps/web/e2e/media-canvas.spec.ts` gained a second test against a PROD BUILD on `:3111` and
> the local backend: brief chips (two required, three optional, `from your profile` on a
> model-filled value, the three length presets with `aria-pressed`), the hero slot holding the
> tracker BEFORE any reel exists, two storyboards side by side with different kind mixes, a
> VERIFIED citation rendering the vault row's own title, the confirm gate, the itemised estimate,
> a deck switch that re-prices the reel, and a chip edit that raises the stale badge and fires
> NOTHING. Generate is asserted ENABLED and never clicked — the only control here that spends is
> the owner's at the gate. Both tests green, run twice.
>
> **The mutation proof, in a browser.** Reverting `sceneCitations` to `title: s.source?.title`
> (the pre-`d69fc29` line) turns the citation chip into `our internal numbers` — the model's own
> label on a real document — and the spec fails on exactly that assertion. Reverted; green again.
> This is the provenance-laundering defect class caught at the surface rather than at the fold.
>
> **A pre-existing assertion was FALSIFIED by 33-06 and had never been run.** The old test asserted
> the estimate region contains `A 30-second reel of 4 scenes, priced per scene` over a REFUSED
> deck. 33-06 moved that sentence inside the `<details>` breakdown, which renders only when there
> are lines to itemise — and a refusal has none. A refused deck now shows a `$0.00` headline, the
> Generate button and the refusal sentence, and nothing else. The spec pins that state as what it
> IS; whether a refused deck should still say what it WOULD be pricing is an open copy question
> raised at 33-10's owner gate, not a thing the spec decided by asserting either way.
>
> Staging note for anyone extending this spec: `vault:insertCreatedDoc` is the cheap way to give a
> citation a real document to resolve against — a `ready` row with no ingest, no rag entry and no
> credits, which is all `sceneCitations`' `db.get` + tenant match needs.

> Last verified: 2026-08-16 (33-09 — **MEDIA-DIRECTOR v3 IS AUTHORED AND PINNED, AND IS NOT LIVE.**
> The body on disk now teaches the three phase-33 output contracts the parsers have been reading
> since 33-01: a `BRIEF` echo at the top (topic and duration REQUIRED, the rest optional, and
> `(defaulted)` on any value taken from the business profile rather than from what the user said —
> the Phase-11 thin-profile rule, so nothing is invented for a sparse account); `VARIATION A` and
> `VARIATION B`, each a WHOLE proposal with its own script, art direction, deck and prompts, both
> running the brief's duration, and A the deck the owner sees picked; and a `Source:` line on every
> scene that states a checkable fact — `<title> [doc:<id>]` from a document `searchVault` actually
> returned, or `Source: unverified`, with creative copy carrying none.
>
> **The body deliberately teaches that the title it writes is a label, not THE label**: when the id
> names a real document the owner is shown that vault row's own title (the fix landed between waves
> 8 and 9, `d69fc29`). Teaching otherwise would invite a model to compose a source line for a UI
> that was never going to render it.
>
> The two partial examples (a deck fragment in §3, a prompts fragment in §4) were replaced by ONE
> worked answer at the end of the file, and that answer is what `storyboard.test.ts` parses — with
> `parseVariations` first, exactly as `persistStoryboard` does, then every per-deck rule against
> BOTH decks. Variation B going unchecked would have been the same hole one level up.
>
> **`media-director` is UNGATED** (`skillBodies.test.ts` pins that, and gating it would deadlock:
> the golden runner drives `runCockpitAgent` over TEXT fixtures and cannot exercise a storyboard
> turn). A seed publishes at `maxVersion + 1` straight to active — there is NO eval between this
> body and what the specialist proposes — so the round trip is the only pre-live gate, and it was
> mutation-checked three ways: the v2 body redded 17 of 99, dropping the one `Source: unverified`
> line redded 1, and giving variation B a different `Target duration` redded 15.
>
> `packages/contracts/src/skills/mediaDirector.ts` was regenerated in the same commit. The Convex
> runtime cannot `fs.read` repo files, so the derived `.ts` is what SHIPS and the `.md` is only what
> a human edits; `skillBodies.test.ts` holds them byte-identical.
>
> **THE LIVE DEPLOYMENT STILL RUNS THE OLD BODY.** Nothing in this entry changes a single live
> proposal. 33-10 owns seeding it and READING BACK the active version — optimizer dry-run
> candidates occupy version numbers, so the version this body lands at is not predictable from the
> plan (the skill-version-collision gotcha). Verified here: `@pikar/core` 1010 passed (39 files,
> `storyboard.test.ts` 92 → 99), `packages/backend` `media.test.ts` + `dispatch.test.ts` 324 passed
> | 24 skipped, `@pikar/contracts` `skillBodies.test.ts` 22 passed, `tsc --noEmit` clean in both
> packages. No audit or log-plane site was added, so `llmRedaction.test.ts`'s media count pins are
> untouched.)

> Last verified: 2026-08-16 (phase 33, between waves 8 and 9 — **a VERIFIED citation's title now
> comes off the vault row, never off the model**, `d69fc29`). `sceneCitations` returned
> `title: s.source?.title` — the string the MODEL wrote into the shot element — beside `verified`,
> which only ever answered "is this `docId` a document of this tenant's?". The two are
> INDEPENDENT, so a model could cite a real, owned document under a fabricated name: `verified:
> true`, genuine `docId`, invented label, and the canvas rendered the invented label as the source
> of the figure. This is the provenance-laundering class one door past the figure gate — the FIGURE
> is gated by `confirmClaim`, the SOURCE LABEL beside it was not.
>
> **The rule: a label the owner is asked to trust must come from the store, not from the text the
> model emitted.** An UNVERIFIED row deliberately keeps the model's string — there is no owned row
> to take a title from, and blanking it would hide WHAT was claimed from the owner being asked to
> vouch for it. Renaming the vault document renames the citation.
>
> Found by plan 33-08 and written up as deferred; closed by the phase orchestrator instead, because
> neither remaining plan owns `media.ts` and "whoever next touches `sceneCitations`" resolved to
> nobody. **The pre-existing test asserted the model's string and so ENSHRINED the hole** — a
> reminder that a green assertion can be the bug's best defence. Verified: `media.test.ts` 237
> passed (2 new, RED observed first), `llmRedaction.test.ts` 60 passed (no log-plane site added),
> `tsc --noEmit` clean.

> Touched 2026-08-16 (eval-gate session) to clear the §9 Stop hook — **NOT a verification**, and
> deliberately not a `Last verified` line. This session ran the golden eval gate and fixed
> `evaluations.ts`; it touched NO media-watched path.
> `packages/backend/convex/render/assemble_final.sh` carries uncommitted in-flight changes from the
> concurrent media/render lane, which is what tripped the hook. That work is unread and unattested
> here; **the lane that owns it still owes this playbook a real entry.** Nothing below covers it.
>
> (One media-relevant FACT from this session, recorded because it is evidence rather than a
> verification: fixtures `38-media-dispatch` and `38b-media-not-a-document` both PASSED in the
> all-green gate run `d59099cd` against `cockpit-agent@26` — the first confirmation that 20-12's
> `dispatch:` prefix fix really closed `420c852b`'s two-actor miscount. That says nothing about the
> render pipeline this playbook documents.)

> Touched 2026-08-16 (eval close-out lane) to clear the §9 Stop hook — **NOT a verification**, and
> deliberately not a `Last verified` line. This session touched no media code: it closed the
> production eval/activation investigation (bisect run `030449d7`, 8/8, $0.1581) and corrected the
> deployment-scope claims in `skill-registry.md` and `agent-runtime.md`. The hook fired on
> `MediaCanvas.tsx`, `workspace/cards.tsx` and `convex/media.ts`, all carrying **uncommitted
> in-flight changes** from the concurrent **33-08** lane, which committed its derivations at
> `3b58092` and has not yet reached its docs step — 33-06 and 33-07 each closed with their own
> `docs(33-0N)` commit against this file, and 33-08's is still owed. That work is unread, unrun and
> unattested by this session, and **the lane that owns it still owes this playbook a real entry and
> a real `Last verified` bump.** Nothing below covers it.
>
> (One media-adjacent FACT from this session, recorded as evidence rather than verification: the
> production bisect confirmed `35-create-document`, `36-crm-follow-up` and the three research
> fixtures all PASS on production against `cockpit-agent@8`. That says nothing about the render
> pipeline this playbook documents, and the media/Drive sections of that body remain **dev-only** —
> production was never activated. See `.planning/debug/finance-update-fails-only-in-full-sequence.md`.)

> Last verified: 2026-08-16 (33-08 - **THE CITATIONS AND THE FAILURE CARDS - the canvas is now
> complete.** Every cited scene shows its vault doc title, opening `PreviewModal` through
> `cards.tsx`'s existing `VaultDocButton`; a `verified:false` source is plain text with NO link and
> NO confirm button, because `confirmClaim` answers `not_a_claim` for a scene the parser never
> flagged and the Generate gate keys on `needsConfirmation` alone - so "unverified" is a FOURTH
> state rather than a rounding of "needs your confirmation". `citationView` computes the link ONCE
> above every branch, so no arm can mint one from a foreign id. A flagged claim carries the badge
> and the confirm click - the provenance front door - and `blockLine` counts them beside the
> disabled button. `failureCards` renders four families through one card: per-scene, render (free
> "Retry render"), HELD (no arm of its own; it points at the failed scene's card, because a retry
> over a hole buys a second sandbox) and CAPTION (degraded deliverable, no re-burn mutation
> exists). **The money is the point:** sunk = `actualCents` when a face landed and its `estUsd`
> reservation when it failed (media unlanded is PERMANENT - the line says spent, never pending);
> the retry price adds the estimate's OWN render line because `regenerateBlock` reserves one, and
> with no estimate loaded it says so rather than understating. The two numbers are pinned to
> DIFFERENT values and SWAP-TESTED BY TRANSPOSITION (`estUsd` <-> `actualCents`, which reddens 4
> tests) rather than by deletion. A code is never prose: `failureClause` gives an unknown code a
> generic sentence and every card prints the code once, in `.trace-line`, underneath.
> `media.byPlan`'s `JobFace` gained `failureReason` so the code travels on the same face whose
> status the card describes. Web `mediaCanvas.test.ts` 78 -> 101, apps/web 376 green,
> `media.test.ts` + `llmRedaction.test.ts` + `importGuard.test.ts` 382 green, `tsc --noEmit` clean
> in apps/web and packages/backend. NOT seen in a browser - 33-10 owns that gate.)

> Last verified: 2026-08-16 (33-07 - **THE GUIDED-INTAKE CHIPS AND THE TWO-DECK SWITCHER, on the
> canvas.** The brief now reads FIRST, above the hero: `briefChips(brief, deckLocked)` renders the
> parsed ask as five editable chips, and it is the only place a mis-parse is visible before money
> moves. **Only topic and length are required** - audience/tone/brandVoice are exactly the fields an
> idea-stage tenant cannot fill (Phase 11's sparse start), so they render as empty-but-never-blocking
> chips, and a `brief.defaulted` field carries a "from your profile" MARKER in words rather than
> passing as the user's own. **Length is a native `<fieldset>` of `TARGET_DURATIONS` presets built
> FROM the same constant `editBrief` validates against**, so `illegal_duration` is unreachable from
> the control; 60 s carries its cost note on the option before it is chosen and on the chip once it
> is, never both. **Nothing auto-fires:** a chip edit calls `editBrief` and stops, `deckStale`
> (`briefChangedAt > deckProposedAt`, false whenever either stamp is absent) raises the badge, and
> the free "Re-propose" button sends ONE canned message through `useSendCockpitMessage` into THIS
> thread - the existing chat path, never a second UI->dispatch door. `variationView` puts the two
> proposals side by side over ONE `deckSummary` fold (concept, scene count, `KIND_LABEL` mix,
> summed duration), with `switchDeck` behind the switch; after Generate `deckLockedAt` makes every
> chip read-only and removes the compare region entirely - absent, not greyed, because a greyed
> switch can only ever answer `deck_locked`. Still NO logic in `MediaCanvas.tsx`. Web
> `mediaCanvas.test.ts` 59 -> 78, `tsc --noEmit` clean in apps/web and packages/backend. NOT seen in
> a browser - 33-10 owns that gate.)

> Last verified: 2026-08-16 (33-06 — **THE REEL-FIRST CANVAS: hero on top, strip below, one layout
> for the whole lifecycle.** The hero slot exists from the moment a deck is picked and never moves:
> `trackerView` folds the four-stage spine (generate → voice → assemble → captions) out of reads
> that were ALREADY reactive — `byPlan`'s two independent job faces plus the plan row's
> `renderStatus`/`captionStatus`/`renderRetriedAt` — with `skipped` a first-class state (a deck of
> cards and uploads buys no picture; a silent deck is never transcribed) and failure winning every
> roll-up. `heroState` decides the slot: `video` whenever a url exists (ANY status — 33-05 holds the
> validated triple, so a url with a non-`rendered` status is the PREVIOUS reel and says so),
> `tracker` otherwise, `held` for the three deck-hole codes whose cure is a per-scene fix, `failed`
> for everything else INCLUDING `rendered`-with-no-url (D8's governed refusal to publish). Both
> 20-10 traps survive verbatim. The player is four native attributes —
> `<video autoPlay muted loop playsInline controls>` — no player lib, no component lib. `estimateView`
> reformats `jobEstimate` into ONE `$X.XX` headline over a native `<details>` breakdown; the headline
> is `totalCents` and is NEVER re-added from the lines (a test feeds it inconsistent input to hold
> that), the clips line keeps the 40× lever in words, and four rail codes gained sentences
> (`unconfirmed_claims` → the confirmation badge, `deck_locked`, `no_alternate`,
> `nothing_to_render`). NO logic entered `MediaCanvas.tsx` and no `setInterval` entered anything.
> Fixed on the way through: `KIND_COST_NOTE.animated_image` said a still was "about a tenth of a
> clip" — measured, it is a FORTIETH ($0.01 vs $0.40 at 4 s), understating the user's only cost lever
> by 4× in three places. Web suite 332 green (59 in `mediaCanvas.test.ts`), `tsc --noEmit` clean in
> apps/web AND packages/backend. NOT yet seen in a browser — 33-10 owns that gate.)

> Last verified: 2026-08-16 (33-05 — **THE FINISHED REEL BECOMES A VAULT ASSET, and the old final
> is HELD through a regenerate.** (1) VAULT AUTO-SAVE: `render/renderReel.saveReelToVault` — the
> persistFindings idiom — upserts ONE `vaultDocuments` row per plan, keyed by
> `plans.reelVaultDocId`: `kind "reel"`, `mimeType "text/markdown"` (the narration transcript in
> scene order as `text`, riding the NORMAL embed rail — no paid ingest, no extra STT),
> `storedMimeType "video/mp4"` with `storageId` = the final mp4, and refs-only `reelMeta`
> citations (sceneIndex / docId / claimHash / confirmedAt; every docId tenant-verified at the
> write, a foreign or malformed id is SKIPPED — §4). Exactly ONE save per pipeline completion:
> the caption terminal (BOTH arms — a failed burn saves the degraded uncaptioned cut) or the
> render terminal when no captions will ever come (no `stt` line in the batch — the
> maybeStartCaptions gate — or captionStatus already failed). A fully SILENT deck saves at
> `pending_extraction` (no transcript to embed, nothing rides the rail). Audit:
> `media.reel_saved` {planId, docId, citations:n}. KNOWN GAP (accepted): an stt job that fails
> AFTER render success reaches no save terminal — the save then happens at the next completion.
> (2) OLD-FINAL ORDERING: `clearRender` now RESETS the pipeline (status, failure fields,
> `renderRetriedAt` — the new reservation re-buys the doubled render line — and the CAPTION
> plane, which also fixes regenerate-after-captioned never re-captioning) but HOLDS
> renderStorageId / sidecarStorageId / sidecarHash / renderSummary; `media.reel` serves the url
> whenever that validated triple is present, WHATEVER the status (the sidecar guarantee lives in
> the triple, written together at the success terminal). Deletion contract: repoint plan →
> repoint vault doc → `deleteOrphanedFinals` (fresh live-set over plan + vault doc, deduped
> candidates) — no blob is deleted while either still points at it, and replaced finals no
> longer leak (pre-33-05 clearRender orphaned every one; old SIDECAR blobs still leak — small,
> deferred). (3) PICKABLE REEL: `isPickableVideo`, `media.setSceneAsset`, `batchToRender` and
> `resolveRenderAsset` all judge `storedMimeType ?? mimeType` — what the BYTES are — so a saved
> reel is immediately reusable as `uploaded_video` footage; the widen admits exactly the reel
> shape, video bytes only. Backend media suites 246 green, web mediaCanvas 25 green, tsc clean
> in both packages.)

> Last verified: 2026-08-16 (33-04 — **FAILURE/RETRY BACKEND: one auto-retry, manual retry, and
> the fix-menu re-arm.** `TRANSIENT_RENDER_CODES` is a closed 6-member set in `@pikar/core/render`;
> `recordRender`'s failure arm retries ONCE per plan via the `renderRetriedAt` CAS (same batch, no
> dead letter, refs-only `media.render_retried` audit) — a narrow, dated supersession of 20-16's
> no-retry rule, argued in the retry section below. `media.retryRender` is the FAILED-only manual
> button. The render line is reserved DOUBLED (`MEDIA_SANDBOX_USD_PER_RENDER = $0.04`, labeled
> `render (incl. one retry)`). The trigger's evaluation is extracted as
> `evaluateRenderTrigger` (callable without a landing row); `setSceneAsset` and the new
> `setSceneVisual` re-call it after a fix, and both the trigger and `batchToRender` now judge a
> terminal job row by `deckStillNeedsJob` — a failed clip whose scene became a card/upload is
> history, not a hold, while landed siblings stay fresh (the fixes are CONTENT-class, no
> `shotsChangedAt`). Retry-twice observed RED on the mutation; core 1003/1003, media suites green.)

> Last verified: 2026-08-16 (Ken Burns `pzoom` fix MIRRORED — motion NOT re-observed. The still
> path used `zoompan=z='min(zoom+0.0012,1.20)'`, but `zoom` resets to 1.0 on every INPUT frame,
> and `-loop 1` feeds identical frames — so the expression re-evaluated `min(1.0012,1.20)`
> forever and the push never advanced. Now `pzoom` (the previous input frame's final zoom) with
> zoompan's own `fps=${FPS}` pinned so the state advance is deterministic rather than inheriting
> the filter's 25fps default. The `.sh` edit had been sitting UNCOMMITTED against a stale
> `assembleScript.ts`, which made it both red and INERT: the Sandbox runner writes the mirror to
> disk and executes it, never the `.sh`. Mirror regenerated; `assembleScript.test.ts` 13/13
> green. The frame-hash smoke in the entry below was NOT re-run — whether 48 decoded frames now
> yield more than 1 unique hash is still unobserved, so the 20.2 escalation stays OPEN.)

> Last verified: 2026-08-16 (Phase 20.2 Nyquist audit — the local mixed-scene smoke now samples
> decoded video-frame hashes inside the `animated_image` window. The current assembler is RED:
> 48 decoded frames produced 1 unique hash, so the still path is frozen rather than animated.
> This is an implementation escalation; the smoke invariant is intentionally retained red until
> the zoompan branch produces motion. No external deployment or provider was contacted.)

> Last verified: 2026-08-15 (render_failed postmortem, FIXED AND RE-RENDERED IN THE PROD SANDBOX —
> **the first card-scene render died on a `grep -q` + pipefail SIGPIPE race, not a missing
> library.** `assemble_final.sh`'s drawtext probe (`ffmpeg -filters | grep -q ' drawtext '`) under
> `set -o pipefail`: `-q` exits at the first match (line 244 of 571), ffmpeg takes SIGPIPE (141)
> writing the rest, pipefail fails the pipeline, and the script reported "libfreetype is missing"
> on an image that HAS drawtext — an unmatched stderr, so Convex recorded the catch-all
> `render_failed`. Windows never races (no SIGPIPE), which is why local runs passed the probe.
> `burn_caps.sh`'s subtitles probe carried the identical landmine. Fix: plain `grep ... >/dev/null`
> (reads to EOF, no SIGPIPE) in both scripts + regenerated .ts mirrors, and `libfreetype is
> missing` now maps to `missing_binary` in `STDERR_CODES`. Verified by re-running the failed batch
> (plan `p573x3...`, real inputs via the blob route) in a sandbox from the LIVE snapshot
> `snap_shetn1hAzlXxJMSA3lQmE5keSIIh`: EXIT 0, 4 scenes, 15.000000 s, decode-validated. Rule:
> **never `grep -q` the left side of a pipeline under pipefail** — probe with plain grep to
> /dev/null, or capture first. The mirror tests now reject any future
> `ffmpeg -filters | grep -q` probe, and `render.test.ts` pins the libfreetype diagnostic to
> `missing_binary`.)

> Last verified: 2026-08-15 (canvas-crush fix, VERIFIED IN THE LIVE BROWSER — **the canvas view was
> an unscrollable 413 px clip of a 3,466 px storyboard.** Both canvas sheets spread `briefingSheet`,
> whose `overflow: hidden` (there for the rounded corners) flips a flex item's implicit
> `min-height: auto` to `0`; as direct flex children of the fixed-height `.pane-canvas` section they
> were crushed to the leftover viewport and clipped everything below — cards cut mid-body, wheel
> scroll dead (`split-right` had nothing to scroll: sh == ch). The work view never showed it because
> `CardList` is a grid child that overflows naturally. Fix: `flexShrink: 0` on both sheet roots, so
> the sheet keeps its natural height and the pane scrolls exactly like the work view. Rule for the
> future: **anything spreading `briefingSheet` that mounts as a flex item of a fixed-height pane
> needs `flexShrink: 0`**, or it will silently become a clipped box.)

> Provider cutover verified 2026-08-14: new images use OpenAI GPT Image 2 and new videos use
> OpenAI Sora 2 through `OPENAI_API_KEY`. Images land synchronously; videos follow
> `submitLine` → `pollOpenAiVideoTask` → `mediaComplete.landResult`. OpenAI has announced that
> the Sora 2 Videos API shuts down on 2026-09-24. Voiceover and word-timed captions use the
> same OpenAI account. Narration text is sent to OpenAI for speech,
> and the generated clean voice audio is sent back to OpenAI for transcription with the owner's
> explicit approval. The Wan poller and fal callback fields/routes remain legacy-compatible only
> for already-submitted historical jobs. Older provider-specific sections below describe the
> superseded implementation unless explicitly marked current. See ADR-017.

> Last verified: 2026-08-15 (route_unreachable postmortem — **THE PROD RENDER SPINE HAD NEVER
> CARRIED A REQUEST, and three independent blockers said so with one reason code.** The 2026-08-14
> dead-letter (plan `p57ce…`) traced to: (1) prod `MEDIA_RENDER_URL` was a stale generated
> `*.vercel.app` deployment URL — Vercel Deployment Protection 401s "Protected deployment" before
> the route runs, the same `ei931zp0e` URL that broke `SITE_URL` on 2026-08-12; (2) the auth
> middleware matcher covers `/api/*` and `/api/media/render` was not on `isPublic`, so even the
> durable domain 307'd the cookie-less server-to-server POST to `/signin`; (3) prod
> `MEDIA_RENDER_SECRET` carried a trailing `\r` from a Windows `env set`, which makes fetch throw
> on the Authorization header. Fixes: middleware exemption (the route's own bearer check is the
> auth), `deploy-production.yml` now pins `MEDIA_RENDER_URL` to `$PRODUCTION_URL/api/media/render`
> with read-back exactly like `SITE_URL`, and both prod env values re-set clean. Lesson recorded
> in "The two secrets" below: **the URL must be the durable custom domain, never a generated
> deployment URL** — those are protection-walled and go stale on every deploy. Note `renderReel`
> collapses thrown fetches AND every non-2xx into `route_unreachable`; when it fires, probe the
> URL by hand first.)

> Last verified: 2026-08-15 (33-03 — **THE MONEY GATES AND THE VARIATIONS TERMINAL.**
> `persistStoryboard` runs `parseVariations` FIRST: a two-variation body lands deck A as `shots`
> and deck B as `altShots` in ONE `persistDeck` call, plus the brief and per-scene citations; a
> refusing variation refuses the WHOLE proposal (never a silent one-deck fallback). The internal
> `persistDeck` validator has NO `confirmedAt` member — the second door after the parser type.
> `unconfirmed_claims` refuses at `jobEstimate` AND `reserveSceneJobInner` in the same pre-flight
> position; the reserve-side check reads the plan ROW, mutation-proven (deleting it moves money and
> goes red). `generateReel` locks the pick (`deckLockedAt`) and DELETES the alternate in the same
> mutation as a successful reservation; `sceneCitations` verifies model-authored docIds where
> consumed — foreign/malformed ids are `verified: false`, never a clickable citation.)

> Last verified: 2026-08-15 (33-02 — **THE PLAN-ROW PLANES LAND: brief, two-deck variation,
> per-scene citations, retry marker, vault-ref — all optional, widen-only** — plus the three
> governed tenant mutations that write them. `editBrief` patches ONLY the brief plane (chip
> merge, `defaulted` strip, `briefChangedAt` stamp) and NEVER moves `targetDurationSeconds` or
> `shots` — a brief/deck divergence is the stale badge, not a refusal. `switchDeck` swaps
> `shots`↔`altShots` and the two targets atomically, stamps `shotsChangedAt` (landed assets
> belong to the deck that bought them, so invalidation on a switch is CORRECT) and clears the
> render; both `deck_locked` guards were mutation-proven red-able by deleting them.
> `confirmClaim(planId, sceneIndex)` is the provenance front door: actor and timestamp are
> ctx-derived, the arg validator structurally cannot carry either, one insert-only refs-only
> audit row (`media.claim_confirmed`, ids only), and a REAL narration edit of a confirmed scene
> clears `confirmedAt` while reorder/delete leave siblings' confirmations riding their own shot
> element. The money path (`sceneDeckOf`, `jobEstimate`, the reserves) is textually untouched
> and prices whichever deck is picked. media.test.ts 204/204 green, backend tsc clean.)

> Last verified: 2026-08-15 (33-01 — **THE PHASE-33 PARSE SURFACES: brief, citations, variations.**
> `storyboard.ts` gains three free-at-parse contracts, all refusing before a cent moves — the
> `parseSceneDeck` posture, three surfaces wider. `parseBrief` reads a `BRIEF` section (Topic /
> Duration / Audience / Tone / Brand voice) into `BriefFields`, null-when-incomplete like
> `parseArtDirection` — durations are the 15/30/60 presets ONLY, and a `(defaulted)` suffix is
> STRIPPED from the value and recorded by field name in `defaulted[]`, so the marker can never
> render as copy. A scene's SCENE PROMPTS block may carry ONE `Source:` line: `<title> [doc:<id>]`
> becomes `scene.source`, `unverified` becomes `scene.needsConfirmation`, absence means creative
> copy, and ANY other shape refuses the deck (`malformed_source`) — a citation is never silently
> dropped. Parser output has NO confirmation field: `confirmedAt` is an authenticated tenant
> mutation's word later, and the model has no path to writing one. `parseVariations` splits at
> `VARIATION A`/`VARIATION B` headings and runs the UNCHANGED `parseSceneDeck` on each slice; any
> inner refusal — including `no_deck` inside a declared variation, or one heading without its
> sibling — refuses the WHOLE proposal, never a silent one-deck fallback. Bodies without the
> headings return `kind: "one"` and v2 single-deck parsing is byte-for-byte unaffected —
> 974/974 @pikar/core tests green.)

> Last verified: 2026-08-14 (20.2 wave 8 — **THE SPECIALIST BECOMES A SCENE AUTHOR, and the approve
> arm opens.** `media-director.md` is v2: `SCENE DECK` with `Target duration`, a `Seconds` column
> that must sum to it EXACTLY, the four visual kinds, optional narration, and the per-window
> character ceiling instead of the impossible 31–56 band. The mirror was regenerated and the
> round-trip test now reads the body's own example with `parseSceneDeck` — including that the
> example MIXES kinds (an all-generated deck cannot hit a target at all), that `startMs` is a
> running sum over unequal durations, and that both a speaking and a silent scene are demonstrated.
> `cockpit.executePlan` reserves scene decks through `reserveSceneJobInner`, so the agent's approve
> arm and the canvas are ONE gate with ONE number (pinned: the ledger movement equals
> `jobEstimate.totalCents`); `scene_render_not_ready` is deleted rather than left unreachable.
> **A silent-degradation bug was found and fixed on the way:** `parsePrompts` matched `Block N`
> only, so every `Scene N` prompt would have fallen back to the row's DESCRIPTION — not a parse
> failure, and invisible until the pictures came back generic. Observed RED before the fix.
> **THE GATE, corrected: there is none to pay.** The plan budgeted a candidate seed, a ~$0.35 eval
> gate and a blocking owner activation for this body. `media-director` is DELIBERATELY UNGATED by a
> decision recorded in `skill.ts`, asserted in `skillBodies.test.ts` and derived non-vacuously by
> `run-eval-golden.mjs --self-check` — the golden runner drives `runCockpitAgent` over TEXT fixtures
> and structurally cannot exercise a storyboard turn, so gating it would strand it at v1 forever.
> `seedSkills` therefore publishes this edit straight to `active`. The residual risk is the one
> already named at that site — a `media-director` body edit activates with no eval evidence — and it
> is unchanged by this wave. **SEEDING IS REQUIRED:** until `pnpm dev` runs against a deployment
> (`npx convex dev` alone does NOT seed), the live row is still v1 and the specialist still writes
> block decks. 936 core + 31 contracts + 1714 backend green; $0.)

> Last verified: 2026-08-14 (20.2 wave 7 — **THE SCENE-KIND PRICE TABLE, and what it turned out to
> prove.** Scene pricing was two hand-copied branches at two money sites (`reserveSceneJobInner` and
> `jobEstimate`); it is now ONE table in the pure package — `SCENE_VISUAL_LINE` / `sceneVisualSpec`
> in `packages/cost/src/media.ts` — read by both, so the number on screen and the number the rail
> consumes cannot drift by editing one branch. `CLIP_SECONDS` is gone from the cost surface: the
> duration grid is asked of the pinned model's own row, never of the block era's wider DISPLAY set,
> which said the same thing twice. **The measured finding: not one of the three target durations is
> reachable with `generated_video` alone.** Every length Sora 2 supports is a multiple of 4, so no
> sum of them is 15 or 30; 60 composes and costs $6.00, over the $3.50 job cap. The cheap kinds are
> a FEASIBILITY requirement, not a cost optimisation — computed from the live tables in
> `media.test.ts`, observed RED first by adding a 5 s grid entry. The canvas estimate now prints one
> line per PAID kind (`clips`, `stills`) instead of wave 5's blended `pictures`, which hid a 40x
> price difference behind one row. ADR-019 records the contract and supersedes D8's fixed-length
> blocks. 917 core + 61 cost + 1712 backend green; $0.)

> Last verified: 2026-08-14 (20.2 wave 6, VERIFIED IN A BROWSER — `apps/web/e2e/media-canvas.spec.ts`
> passes against a live local stack: a four-kind 8/6/4/12 scene deck staged through the
> specialist's own two internal mutations, then the canvas asserted where it actually renders. The
> load-bearing line is the ribbon's MEASURED widths (`boundingBox()` per segment, ordered AND
> 12s/4s > 2x) — `ribbonShares` being right and the strip being proportional on screen are
> different claims, and only the second is what the wave promised. Also asserted live: the four
> windows off their own offsets (a uniform grid would have read 0:00–0:12 … 0:36–0:48 for a
> 30-second reel), the card's "drawn when the reel is assembled" instead of a clip it will never
> have, the silent scene offering NO paid control, the vault picker with its honest empty state,
> and the estimate refusing by name (`doesn't say what its picture is made from`) with Generate
> disabled. $0 — nothing is ever generated. **Two harness traps found and written into
> `e2e/README.md`:** every `convex run` against the LOCAL backend ends the browser session (so a
> fixture-staging spec must stage first and authenticate after), and an un-onboarded tenant cannot
> reach the workspace at all (`onboarding:__seedOnboardedTenant`). The run also needed a PROD
> build — the long-lived `next dev` on :3111 had stopped hydrating, which is the documented
> workspace-OOM failure and makes every click a native form submit.)

> Last verified: 2026-08-14 (20.2 wave 6 — **THE CANVAS LEARNS THE SCENE CONTRACT.** A timeline
> ribbon whose segments are as wide as their scenes are long (`ribbonShares`, with a minimum width
> so a 2 s card in a 60 s reel is still readable — read-only, see the D7 note below); per-scene
> windows off the row's OWN `startMs`/`durationMs` rather than `index x clipSeconds`; the four kinds
> badged and, more importantly, STATUSED per kind — a card said "Clip: not requested yet" forever
> about a picture nobody will ever request. The vault picker (`media.setSceneAsset`) makes an
> `uploaded_video` scene renderable: video-only, tenant-checked and bytes-checked where the refusal
> is FREE, because an upload buys nothing and would otherwise clear the money gate and die in the
> sandbox. The stale refusal copy is gone (`only VIDEO and IMAGE blocks` named a `ShotType` that
> never existed), and every refusal now speaks the deck's own noun. `renderSummary.blockCount` →
> `sceneCount`, widened not migrated, with `media.reel` reading `sceneCount ?? blockCount` so reels
> rendered before this wave still report their length; the `media.rendered` audit key follows, and
> the redaction allow-list carries BOTH names because the log is insert-only. `byPlan` also gained
> the per-scene narration ceiling (the TAKE's window, not the deck's longest scene — the loose
> number let the canvas accept a line the money gate then refused) and `clipStale`/`voiceStale`,
> which is the surface obligation wave 6 part 1 left behind. **The canvas's derivations and every
> sentence it prints now live in `mediaCanvasView.ts`** and are tested by CALLING them: `apps/web`'s
> runner is `.ts`-only and DOM-less, so anything left in the `.tsx` can only be asserted as source
> text — the `green-tests-over-broken-capability` shape. 24 web + 1672 backend green.)

> Last verified: 2026-08-14 (20.2 wave 6, part 1 — **a partial buy can finally render, and the
> scene arm of `regenerateBlock` opens.** A defect older than this phase: `regenerateBlock` buys ONE
> scene into a NEW batch, and `batchToRender` read its inputs off that batch alone, so every index
> the regenerate did not re-buy had no job and the whole reel came back `incomplete_blocks` — the
> user paid for a clip AND lost the published reel, because the reservation clears the render in the
> same transaction. Observed RED first (`a REGENERATE batch renders`). The batch is now the TRIGGER
> and the INPUTS come off the PLAN: newest succeeded job per (index, kind). `plans.shotsChangedAt`
> is what keeps that honest — stamped by STRUCTURAL writes only (reorder, delete, a re-proposed
> deck), never by an edited prompt or line, because invalidating the neighbours on a content edit
> would make edit-then-regenerate pay for a take and then be refused. A reused asset older than that
> stamp refuses as `stale_inputs`. `reserveSceneJobInner` gained `only`: the WHOLE deck is validated
> (sum, asset source, narration ceilings) and only the LINES are narrowed, with captions still
> priced over the whole reel. `scene_regenerate_not_ready` is deleted; `nothing_to_regenerate`
> replaces it for a scene that buys nothing at all. 1669 backend green.)

> Last verified: 2026-08-14 (20.2 wave 5 COMPLETE — **the scene gate opens: a scene deck is
> buyable, renderable and publishable.** `reserveSceneJobInner` prices per kind (a clip at its own
> length, a still at ~a tenth, nothing for a card or an upload, a take only where there is a line);
> `unrenderable_block` is narrowed to `hasAssetSource`; the vault bridge resolves an
> `uploaded_video` to its own tenant s vault doc, with the tenant check on the row because
> `asset.docId` is model-authored. `jobEstimate` opened in the same commit as `generateReel` and a
> test asserts the two numbers agree. Still refused BY NAME: `cockpit.executePlan`
> (`scene_render_not_ready`, wave 8) and `regenerateBlock` (`scene_regenerate_not_ready`, wave 6).
> 901 core + 1654 backend green.)

> Last verified: 2026-08-14 (20.2 wave 5, part 1 — **the SCENE sidecar, and the v1 shape refused
> by name.** `scene_count`/`target_duration_s`/`scenes[]` replace `block_count`/`clip_seconds`/
> `blocks[]`; the validator re-derives the running sums and both timeline guarantees from the bytes.
> `renderInputName` gained `blockNN.png` and `cardNN.txt`, the route body carries
> `targetSeconds`+`scenes[]`+`cards[]`, and `batchToRender` reads the deck so a card needs no job and
> a silent scene needs no take. Verified by a REAL render whose sidecar was fed back through the
> shipped validator and accepted; 897 core + 1645 backend green. **NOT yet done in this wave:**
> `reserveJobInner`'s scene line items and the `hasAssetSource` narrowing — see the note at the end
> of the assemble-contract section.)

> Last verified: 2026-08-14 (20.2 wave 4 follow-up — **the captions module was corrected for the
> scene timeline BEFORE wave 5 removes the refusals hiding the defect.** Take offsets are now keyed
> by narrated ordinal (a silent scene is a hole, not an index), and the clamp bound is the next
> take's `speechAbsS` rather than `windowStartS + clip_seconds`. Both were observed RED first — the
> misassignment put a caption 10.5s from where it belonged. Risk 5 is CLOSED by measurement:
> production holds 257 `plans` rows, fully scanned, and **zero** carry a `sidecarStorageId`, so
> wave 5 may hard-reject the v1 sidecar shape with no migration and no re-render decision.)

> Last verified: 2026-08-14 (20.2 wave 4 — **narration moved to a MASTER AUDIO TIMELINE and the
> per-scene speech band is deleted.** Every scene is built as a silent picture, the pictures are
> concatenated once, and every voice take plus every clip's diegetic bed is placed at its ABSOLUTE
> offset and mixed in a SINGLE `amix`. A line may now run past its own scene. Verified by a REAL
> render: `smoke_assemble.sh` put 7.2s of speech in a 6s scene — a wave-3 hard error — and the
> reel came out at 30.016s. The narration assert was **observed RED**: the same deck through a
> sabotaged copy with the takes muted into the mix exits 1 with the narration error, which is the
> phase's named vacuity risk closed by observation rather than by claim. New: `--target-seconds`,
> asserted before any work and on the output at ±0.5s.)

> Last verified: 2026-08-14 (20.2 wave 3 — the assembler builds THREE kinds of scene at
> per-scene lengths, and a voice take is now optional. Verified by a REAL render:
> `smoke_assemble.sh` produced a 30s reel from clip+still+card+clip with one silent scene,
> decode-validated, sidecar asserted. The uniform BLOCK path renders unchanged and its sidecar
> is still ACCEPTED by the live publish gate; a mixed sidecar is REFUSED by it, which is
> correct and is why waves 4-5 must land before a scene deck is buyable.)

> Last verified: 2026-08-14 (`media.byPlan` now projects `shot.type ?? shot.visual` for the tile
> caption — the ONE place the block and scene closed sets are allowed to meet, because it is a
> display projection. `deckOf` keeps them apart on the money path, where reading a scene as a
> block would price it at the wrong duration. This closed an `apps/web` typecheck break left by
> 20.2 wave 2, which verified `packages/backend` tsc but not `apps/web` tsc.)

> Last verified: 2026-08-14 (20.2 wave 2 — the scene contract reaches the Convex adapters. Schema
> WIDENED (`shots.visual`, `shots.asset`, `shots.type` now optional, `plans.targetDurationSeconds`);
> `persistStoryboard` reads either contract; the editor offsets are a RUNNING SUM; and a scene deck
> is REFUSED at both money gates with `scene_render_not_ready` rather than mispriced. Two
> pre-existing defects were fixed on the way in — see the section below. backend 1631/1655,
> core 868/868, cost 55/55, tsc clean.)

> Last verified: 2026-08-14 (20.2 wave 1 — **the SCENE TIMELINE contract lands in `storyboard.ts`,
> alongside the uniform BLOCK contract rather than replacing it.** `parseSceneDeck` is exported and
> has no callers yet; wave 2 moves them and a later wave deletes `parseBlockDeck`. Nothing about the
> live reel path changed. `packages/core` 868/868, and BOTH new guards — the exact-length assert and
> the narration ceiling — were OBSERVED RED under mutation before being trusted.)

> Last verified: 2026-08-12 (production snapshot bake prerequisite — Vercel's current AL2023
> sandbox image has `tar` but omits the `xz` helper required by the pinned ffmpeg `.tar.xz` asset.
> The owner bake now installs `xz` explicitly before download/extraction; render sandboxes remain
> deny-all and the one-time bake sandbox is still stopped on every failure path. The corrected bake
> completed on 2026-08-12 and produced `snap_shetn1hAzlXxJMSA3lQmE5keSIIh`, installed on the new
> isolated Vercel project's preview and production environments.)

> Last verified: 2026-08-09 (26-08 — **the media rail is now double-entered, and it is the ONE rail
> whose two planes deliberately do NOT agree cent for cent.** See "The spend ledger (26-08)" below.)
>
> Previously verified: 2026-08-04 (ADR-014 — **standalone images are now reachable without creating a
> second media stack.** `proposeImage` stages a free `mediaMode:"image"` plan; the canvas shows the
> pinned Flux Schnell 1080×1920 estimate and shared remaining budget before enabling **Generate
> image**; `generateImage` reserves one image row through the same serializable money helper as the
> reel and schedules the existing fal submit. The existing authenticated webhook, owned storage,
> validation, reconciliation and moderation path lands the result. The reactive output card renders
> the tenant-guarded URL through `<img>` and says `none_reported` is **not checked**, never safe.
> Targeted backend media/routing/trace tests: 232 passed; no paid provider call was made.)

> Registration note, 2026-08-02: `check-fal-catalog.mjs` was first registered here by a foreign
> session (profile-tabs) that hit the §9 creation gap on it while it was still untracked, and
> classified it without reading or running it. **The media lane has since authored, run and
> verified it — see `## Reconciliation` bullet (b) and plan 20-19.** The registration it made was
> the correct one and is kept.

> Also 2026-08-02 (20-08 — **`storyboard.ts` gained `parseScript` and `parseArtDirection`**, the
> two remaining §-parsers, plus a section-terminator fix. Pure `@pikar/core`, zero new deps. See
> `## The §-parsers` below. The dispatch route itself is documented in `cockpit.md`.)
>
> Last verified: 2026-08-03 (15.3-03 - **a COMMENT-ONLY amendment at `media.ts:279-282`.** No
> media behaviour, no pricing, no rail, no test changed. The folder-ingest rail (15.3) refunds
> its reservation, which is the OPPOSITE of the no-refunds position recorded at that site; the
> appended note explains why both are right - media over-reserves by CENTS under
> `MEDIA_JOB_CAP_USD`, ingest over-reserves by DOLLARS because its estimator cannot see page
> counts before the bytes land. Stated from the ingest side in `docs/playbooks/guardrails.md`
> §15.3-03. Do not harmonise the two rails without reading both reasons.)
>
> Prior: 2026-08-03 (20-11 tasks 1-3 — **the two ADRs, and every document that still stated a premise this phase refuted.** `docs/decisions/012-media-route-and-the-reel.md` (the dispatchable route whose product costs money and which cannot spend it, the reel scope, the whole-job reserve, the once-only cents floor, the two budget rails, delete-on-success retention, and the corrected + now vendor-direct ADR-011 arithmetic) and `docs/decisions/013-the-render-worker.md` (Vercel Sandbox chosen, Fly/Cloud Run and ffmpeg.wasm rejected, the token-free route handler, `persistent:false` and `deny-all` as DECISIONS, the trust boundary in both directions, and the script-is-code-not-a-registry-row rule). **`docs/decisions/011-media-provider-fal-wan25.md` is byte-unchanged** — ADR-012 amends it from outside, because only its `<=15 s` scope line is superseded while its provider choice and four consequences all still stand. `REQUIREMENTS.md` MEDIA-01, `PROJECT.md` S3 and the koda todo's reversed `/assemble` deferral are corrected. **The live gate has NOT been run** — the last subsection of `## Reconciliation` is its evidence table, and every row of it is still blank.)
>
> Prior: 2026-08-03 (20-10 + the canvas tab — **the canvas is SEEN.** The 20-09 read plane finally has a consumer: MediaCanvas.tsx in the workspace right pane, mounted through the same one-line plan.kind switch as the memo and calendar cards, plus an "Open canvas" toggle beside "Clear workspace" that gives it the whole pane. See `## The canvas, SEEN (20-10)` below. NO POLLING anywhere; five reel states including the out-of-date trap; two status rows per block; `none_reported` renders as "not checked", never a pass. **NO HUMAN HAS SEEN IT** — it typechecks and builds and has never been rendered against a real media plan.)
>
> Prior: 2026-08-03 (20-17 — **BURNED CAPTIONS, the phase's designated cut line, SHIPPED**.
> The reel now works on an autoplay-muted feed, and it cost no Python, no Whisper weights, no font
> fetcher and NOTHING added to the sandbox image. See `## Burned captions (20-17)` below for the
> whole stage. Three things a reader must not miss: (a) **the audio goes to fal as a `data:` URI,
> a deliberate DEVIATION from the plan's file-upload instruction** — the binding rule was "no
> Convex signed URL reaches a third party" and a data URI satisfies it absolutely, while the
> upload's multi-step protocol could not be confirmed vendor-direct; (b) **20-16's retention rule
> is NARROWED** — the clean takes are the transcript's source, so they now survive until the FINAL
> artifact exists, mutation-checked in both directions; (c) **narration now crosses into the VM**,
> as the escaped `.ass` track, which is what burning captions means. Backend 1107/1107, core
> 572/572, web build green. **$0 — no sandbox and no STT minute has ever been bought.**)
>
> Prior: 2026-08-02 (20-09 + 20-16 + the unrenderable-deck guard - **the canvas plane, the
> render trigger and D12(b) retention.** ONE bump covering waves 9 and 10; this lane executed both.
> Five tenant-guarded reads and six writes with the BETA-05 isolation assertion shipped alongside;
> the last landing starts the render with NO chain and NO poller (the pending->rendering transition
> is the once-only guard); delete-on-success / KEEP-on-failure retention pinned to a single
> `storage.delete` site. **And a money leak closed: a deck with a TEXT or SCREEN REC block used to
> pass the money gate and could never assemble.** See `## The canvas plane`, `## The render trigger
> and D12(b) retention` and `## The unrenderable-deck guard` below.)
>
> PREVIOUSLY: 2026-08-02 (20-15 - **the renderer.** A Next.js route handler starts an
> ephemeral Vercel Sandbox and runs `assemble_final.sh` over the landed clips and voice takes,
> with **no Vercel access token existing anywhere in the system** (D11) - a property now asserted
> repo-wide rather than described. `persistent: false` and `networkPolicy: "deny-all"` are the two
> cross-tenant leak vectors and both were OBSERVED to fail a test when deleted. Plan tier **Pro**,
> route `maxDuration` **300 s**, sandbox `timeout` **240 s**. See `## The renderer` below.)
>
> PREVIOUSLY: 2026-08-02 (20-14 - **the voiceover stage.** One TTS take per block through the
> SAME adapter, secret, webhook and landing code: two switch arms, one narration read, and no
> second integration anywhere. The endpoint was chosen because it has NO rate knob, so D8's
> no-time-stretch rule is enforced by the provider rather than by our discipline. See
> `## The voiceover stage` below.)
>
> PREVIOUSLY: 2026-08-02 (20-06 — **the authenticated callback and the landing plane.**
> `POST /fal/callback/*` with an HMAC path segment and a ±300 s window, the asset downloaded and
> stored INSIDE the webhook so no fal URL can live anywhere, the honest four-value verdict, and
> kind-aware reconciliation. See `## The landing plane` below.)
>
> PREVIOUSLY: 2026-08-02 (20-05 — **the fal submit adapter.** `buildSubmitBody` is an
> EXHAUSTIVE switch over the priced spec, `submitBatch` claims each line before it POSTs, and
> `FAL_FIXTURE` drives the whole path at $0. See `## The submit adapter` below.)
>
> PREVIOUSLY: 2026-08-02 (20-19 — **D5(b) is automated.** `pnpm check:fal-catalog` +
> a weekly `fal-catalog.yml`: verbatim vendor-string diffing, endpoint-health flags, and THREE
> outcomes so "could not check" can never report green. All three observed before it was trusted.)
>
> PREVIOUSLY: 2026-08-02 (20-18 — **the D5 reconciliation readers.** `media.spendForPeriod` +
> `media.listJobs`, so `mediaJobs.actualCents` stops being a write-only field and the procedure in
> `## Reconciliation` names commands that exist. The three caveats that would otherwise make the
> number lie are in the payload, not just on this page.)
>
> PREVIOUSLY: 2026-08-02 (20-04 — **the second budget rail and the transactional job
> reservation.** `mediaSpendCents` + `deploymentMediaSpendCents` at the D10 numbers, the media kill
> switch, and `media.reserveJob` — the ONE money gate. See `## The budget rail` below.)
>
> PREVIOUSLY: 2026-08-02 (20-13 — **the assemble contract landed before its machinery.**
> `assemble_final.sh` harvested from the Higgsfield workflow v2.0, its bundler-safe mirror, the
> `assembly.json` validator in `packages/core/src/assembly.ts`, and the RCE scan that keeps the
> script out of the `skills` registry. See `## The assemble contract` below.)
>
> PREVIOUSLY: 2026-08-02 (20-01 tasks 2+3 — `storyboard.ts` and `media.ts` shipped; the price
> figures were re-read VENDOR-DIRECT from fal's catalog API the same day and are unchanged; the
> `## Reconciliation` procedure below is now runnable, not a stub.)

## What this subsystem is

The **finished-reel spine** (D8): script → art-direction → storyboard → generate → voiceover →
assemble → captions. The deliverable is **ONE mp4**, not a bag of clips.

The media subsystem also has one deliberately shorter deliverable under
[ADR-014](../decisions/014-standalone-image-deliverable.md): prompt proposal → human Generate click →
one fal image job → authenticated callback → owned image. It reuses the rail and landing plane below
but does not enter the reel's voice, captions or sandbox stages.

## Standalone image path (ADR-014)

1. The executive's local `proposeImage({prompt})` tool calls `plans.stageImagePlan`. It writes
   `kind:"media"`, `mediaMode:"image"`, the content-plane prompt and `status:"proposed"`. It writes
   no job and consumes no media budget.
2. `media.imageEstimate` constructs the pinned `MEDIA_DEFAULT_IMAGE` spec and calls
   `chooseMediaBatch`. It is a tenant query and cannot consume a window. The canvas button is truly
   disabled until this result resolves.
3. The human clicks **Generate image**. `media.generateImage` checks ownership and the absence of an
   existing image row in the same serializable mutation, then `reserveImageInner` passes its one
   priced row through `reserveProviderLinesInner` — the same cap/check/consume/insert transaction
   `reserveJobInner` uses for reels.
4. The existing `submitBatch` claims the row before POST and reads text from `plan.imagePrompt`.
   `buildSubmitBody` pins `{image_size:{width:1080,height:1920},num_images:1}` from the priced spec.
5. `/fal/callback/*` follows the existing image arm: authenticate the HMAC+timestamp, download the
   provider URL immediately, validate/store owned bytes, reconcile cost and persist the moderation
   verdict. The provider URL is never stored.
6. `assetUrls` mints the signed owned URL only after tenant ownership. `ImageCanvas` reacts without
   polling and renders the result plus the honest verdict copy.

Operationally, image failures use the same `mediaJobs` readers, spend reconciliation, kill switches
and provider-drift procedure documented below. A second image attempt uses a new conversation; this
keeps the unique plan row and its callback/history ownership unambiguous.

The storyboard is a **BLOCK DECK**: N blocks, every block the same length, each carrying exactly one
narration line. `packages/core/src/storyboard.ts` parses it; `packages/cost/src/media.ts` prices the
whole job before a request exists.

**The decisions of record are [ADR-012](../decisions/012-media-route-and-the-reel.md) (the route,
the reel scope and the money shape) and [ADR-013](../decisions/013-the-render-worker.md) (the
renderer), on top of [ADR-011](../decisions/011-media-provider-fal-wan25.md) (the provider).** This
playbook is the operational surface — how to run it, how to change it safely, what breaks. The ADRs
are *why*, and they are immutable: a change that contradicts one of them supersedes it with a new
ADR rather than editing this page.

## Invariants — what must never break

- **The price table is keyed by the billing unit the vendor actually charges on.** A media line item
  MUST be priced per **submitted input** — characters, megapixels, video-seconds, input audio-minutes.
  **A model billed per GENERATED output duration, or per COMPUTE second, cannot be reserved and is
  therefore REFUSED by construction.** The whole job is reserved before any request exists, so a
  guess-vs-submit gap there is the money bug in a new costume. This is why
  `fal-ai/elevenlabs/…/scribe-v2` (input audio minute) is in and `fal-ai/whisper` (compute second) is
  out — not because whisper is expensive, but because it is unreservable. *"Cheap in practice"* is
  exactly the reasoning ADR-011 exists to forbid.
- **A resolution missing from a model's row is `unknown_model`** — never a fallback to another tier.
  A fallback would price a 1080p submit at the 480p row and under-report by 3×.
- **The adapter pins `model`, `resolution`, `duration`, the audio flag and the TTS sample rate
  EXPLICITLY on every submit.** Never rely on a fal default. **Wan 2.5's default is 1080p**, so an
  estimate computed at 480p against a submit that omits `resolution` under-reports by **3×**.
- **Wan 2.5 accepts `duration` of 5 or 10 seconds ONLY.** There is no 15 s.
- **Blocks are fixed-length and uniform** (D8). A clip shorter than its window is a HARD ERROR, never
  a held still frame. **No time-stretch, ever** — no `atempo`, no `setpts`, no TTS `speed`. A test in
  `media.test.ts` greps for those tokens.
- **The parser may move SECONDS between scenes; it may never move WORDS.** Two repairs do this —
  `repairGeneratedGrid` (off-grid clip → provider grid) and `repairNarrationWindows` (a line that
  would run into the next one). Both keep the reel's declared total EXACT, both refuse to resize a
  `generated_video` at either end, and both report every moved second as a `SceneAdjustment` that
  the canvas renders. **A repair that cannot obey all three refuses instead** — returning `null`
  leaves the deck exactly as the model wrote it and the original refusal stands. Rewriting a
  narration line to fit is the one fix that is permanently out of bounds: it puts words in the
  user's mouth.
- **A narration window is a SPAN, not a scene.** `narrationCeilingSeconds(scenes, i)` sums the
  durations of scenes `i … nextNarrated-1`, so seconds taken from inside that span buy zero
  characters. Any repair must lengthen INSIDE the span and shrink OUTSIDE it. The test
  `"takes from OUTSIDE the window even when a longer scene sits inside it"` is the only thing
  standing between that rule and a repair that quietly does nothing.
- **The JOB is the priced and reserved unit** — not the shot, not the clip.
- **The cents floor is applied ONCE, on the batch total** (D12a). Never per line item: a 6-block
  reel's true $0.012 voice cost becomes $0.06 that way — a 5× over-reservation that compounds on
  longer decks.
- **A narration line has a BAND, not a ceiling, and the band travels with the block length:**
  `minCharsFor(clipSeconds)`–`maxCharsFor(clipSeconds)` — **103–140 at 10 s, 43–70 at 5 s.**
  `MAX_CHARS_PER_BLOCK = 140` is only the 10-second ceiling and the number the skill body teaches.
  `assemble_final.sh` hard-errors on a take whose speech falls OUTSIDE
  `[clipSeconds - 1.4, clipSeconds]` seconds — **too short is as fatal as too long**, and both land
  after the clips are paid for. Two holes lived here: a flat 140 passed a 120-character line in a
  5-second deck, and no floor at all passed a pithy 46-character line in a 10-second one. The floor
  is computed at the SLOWEST plausible delivery (12 chars/s) on purpose, so it only refuses a line
  that cannot fill its window at any pace — measured pace wanders 1.9–3.4 words/second between
  generations of the same line.
- A narration line outside the band is refused at storyboard parse,
  **before a cent is spent**. The provider returns no duration (delta §1.5), so the overrun is
  otherwise only measurable by `ffprobe` in the sandbox — after ~$3.00 of clips have been paid for.
- **No fal URL is ever written to any row or any audit payload** (§4).

## Rate observation (dated, vendor-direct)

Read from fal's own catalog API on **2026-08-02** —
`GET https://fal.ai/api/models?keywords=…`, unauthenticated and machine-readable. Verbatim vendor
strings are pinned in `packages/cost/src/media.fixtures.json` and a test asserts the table agrees
with them.

| Model | Rate | Billing unit | Confidence |
|---|---|---|---|
| `fal-ai/wan-25-preview/text-to-video` | 480p $0.05/s · 720p $0.10/s · **1080p $0.15/s** | video-second. **1080p is fal's DEFAULT.** `duration` ∈ {5,10} only | **HIGH** — vendor `pricingInfoOverride` |
| `fal-ai/flux/schnell` | $0.003 per WHOLE megapixel | megapixel, rounded UP | **MEDIUM** — see below |
| `fal-ai/inworld-tts` | $0.01 per 1000 characters | **submitted** characters — fractional, NOT rounded up | **HIGH** — vendor `pricingInfoOverride` |
| `fal-ai/elevenlabs/speech-to-text/scribe-v2` | $0.008 per input audio minute | input audio minute | **HIGH** — vendor `pricingInfoOverride` |
| Vercel Sandbox render | flat `$0.04` reserved — `$0.02` per sandbox, doubled for the one auto retry (33-04) | per job — a named constant, not metered | estimate (delta §2.5) |

Three things the 2026-08-02 read established that the plan's table did not say:

1. **`fal-ai/wan-25-preview/text-to-video` is live**: `deprecated: false`, `removed: false`,
   `status: "public"`. The `-preview` rename risk has NOT fired. Its `image-to-video` sibling carries
   an identical rate string.
2. **scribe-v2 has a surcharge**: *"If keyterm is used, you request will cost %30 more."* We do not
   send keyterms, and must not start without re-pricing — $0.008 → $0.0104/min.
3. **FLUX schnell's per-megapixel RATE is not vendor-confirmed.** Its catalog entry exposes only
   `billingMessage: "Images are billed by rounding up to the nearest megapixel"` and **no
   `pricingInfoOverride`**. The rounding RULE is vendor-direct; the **$0.003 figure is secondary-
   sourced** and stays MEDIUM until an invoice reconciles it. Both `fal-ai/flux/schnell` and
   `fal-ai/flux-1/schnell` exist and both carry the same billing message.

## The §4.1 job economics

The **worst legal case**: 6 paid blocks at 480p × 10 s, every narration at the band ceiling
(`maxCharsFor(10)` = 140 chars), with captions.

| Line | Cost |
|---|---|
| 6 × 480p × 10 s clips | $3.0000 |
| voice — 6 × 140 chars, reserved at **2×** (840 chars → 1,680 submitted) | $0.0168 |
| captions STT (1 min) | $0.0080 |
| render (incl. one retry) | $0.0400 |
| **Total** | **$3.0648 → 307 cents** |

Against `MEDIA_JOB_CAP_USD = $3.50` — **12% headroom**.

> **Corrected 2026-08-16 (33-04).** The render line is now reserved at **$0.04 — the $0.02 sandbox
> constant DOUBLED at its one source (`MEDIA_SANDBOX_USD_PER_RENDER`)** so the one automatic retry
> (`TRANSIENT_RENDER_CODES`, see the retry section) is covered by the reservation instead of
> leaking as silent cents drift on the no-refunds rail. The estimate line is labeled
> `render (incl. one retry)` so the coverage is visible on screen. A rare THIRD sandbox (a manual
> "Retry render" after the auto retry already fired) is accepted, documented drift — never silent.
> The previous total here was $3.0448 → 305 cents; `media.test.ts` pins the new arithmetic.

> **Corrected 2026-08-02 (20-04).** This table previously read `voice (~1,200 chars) $0.012` +
> `voice retry allowance $0.012`, total **$3.052 → 306 cents**. That 1,200 is **not reachable**: it
> is 200 characters per block, and 20-13's narration BAND caps a 10-second block at **140**. Six
> blocks hold at most 840 characters, so the largest legal 6-block job is **$3.0448 → 305 cents**,
> and `media.test.ts` pins that number. The old figure was an estimate written before the band
> existed; nothing regressed, the ceiling simply got tighter. The retry allowance is unchanged in
> substance — it is the `× 2` on the voice line, not a separate row.

**The cap is bounded by the CLIPS.** TTS is 0.55% of the job and is not a threat to it. That is why
D10's arithmetic refuses 6 blocks at 720p ($6.00+) and 12 blocks at 480p ($6.00+), and why **the
budget rail is also the render-duration rail**: the sandbox never sees a resolution whose encode time
would change delta §2.4's numbers. Both refusals are pinned in `media.test.ts`.

## The specialist writes scenes (20.2 wave 8)

`packages/contracts/skills/media-director.md` is v2 and teaches the SCENE contract. The `.md` is
canonical; `packages/contracts/src/skills/mediaDirector.ts` is its LF-normalised mirror and
`skillBodies.test.ts` fails on drift — regenerate the mirror, never hand-edit it.

**What pins the body to the parser:** `storyboard.test.ts`'s round trip reads the body's own worked
example with `parseSceneDeck`. A drifted table is not an error — it produces an EMPTY deck, which
reads to the user as "the specialist proposed nothing". The round trip asserts the example obeys
every rule the body teaches, including two that are easy to lose:

- **The example MIXES kinds.** Not a style note — every `GENERATED_CLIP_SECONDS` value is a multiple
  of 4, so an all-generated deck cannot sum to 15 or 30, and a 60 is over the job cap (ADR-019). An
  example that reached for a clip every time would teach the one deck shape that cannot render.
- **The example demonstrates a SILENT scene** as well as a speaking one. Optional narration is the
  wave-4 contract; an example where every scene speaks teaches the deleted rule by omission.

**`SCENE PROMPTS` entries say `Scene N`,** and `parsePrompts` accepts `Block N` or `Scene N` — the
prompts section is shared by both deck contracts. Wave 8 found it matching `Block` only, which
would have silently degraded every prompt to its row's description.

**THE GATE: `media-director` is DELIBERATELY UNGATED.** Recorded in `packages/contracts/src/skill.ts`,
asserted in `skillBodies.test.ts`, and derived non-vacuously by `run-eval-golden.mjs --self-check`.
The golden runner drives `runCockpitAgent` over TEXT fixtures and structurally cannot exercise a
script/art-direction/storyboard turn, so gating this row would strand it at v1 on its first body
edit with no runner able to clear the gate. Consequences, both of which are the deal:

- A body edit costs **nothing** and needs no owner activation. `seedSkills` sees a changed body on an
  ungated name and inserts `maxVersion + 1` as `active`.
- A body edit therefore **activates with no eval evidence.** That residual risk is named at the
  self-check site and is not new. What protects the money is CODE, not prose: `searchVault` is the
  specialist's only grant, the parser refuses every deck shape the assembler cannot build, and the
  model comes from a price table the body cannot name into.

**SEEDING IS REQUIRED.** `npx convex dev` alone does not seed — run `pnpm dev`. Until then the live
row is v1 and the specialist still proposes block decks, which still parse and still render.

### The Phase-33 parse surfaces (33-01)

Three additional contracts live beside `parseSceneDeck`, all pure parse, all free:

- **`parseBrief(body)`** — the guided-intake echo. `BRIEF` is a registered section token, so a
  brief above a script terminates where the script starts. Null (not a refusal) when absent,
  topic-less, or off the 15/30/60 preset grid; `(defaulted)` markers become field names in
  `defaulted[]`, never copy.
- **Per-scene `Source:` lines** — document-level citations (the Phase-14 idiom: one doc, no chunk
  refs), read from the `Scene N` blocks of SCENE PROMPTS by `sceneSourcesOf` (the shared
  `parsePrompts` is untouched — the block contract has no citations). Three legal shapes:
  `<title> [doc:<id>]` → `scene.source`; `unverified` → `scene.needsConfirmation`; absent →
  creative copy. Anything else is `malformed_source` and refuses the whole deck. **The Scene type
  must never grow a confirmation timestamp** — a `@ts-expect-error` in `storyboard.test.ts`
  guards that door; confirmation is a tenant mutation's write, later, with auth.
- **`parseVariations(body)`** — a thin, order-agnostic splitter at `VARIATION A`/`B` headings over
  the unchanged `parseSceneDeck`. `kind: "two" | "one" | "refused"`; each `VariationSlice`
  carries its own body slice so SCRIPT/ART DIRECTION parse per-variation. A refusing variation
  refuses the WHOLE proposal — the `persistStoryboard` rule: a deck nobody wrote must never be
  proposed.

### The Phase-33 plan-row planes (33-02)

The parse surfaces above persist into new OPTIONAL `plans` fields — widen-only, no migration
(the `renderSummary` precedent). The provenance question ("who does the STORED row say wrote
this, and can the model influence it?") asked of every field:

- **Brief plane** — `brief {topic, durationSeconds, audience?, tone?, brandVoice?, defaulted[]}`,
  `briefChangedAt`, `deckProposedAt`. `brief.durationSeconds` is the USER'S ask (a
  `TARGET_DURATIONS` preset); the deck's own `targetDurationSeconds` stays the money contract —
  divergence renders as the stale badge (`briefChangedAt > deckProposedAt`), never as an
  estimate refusal and never a silent re-deck. Model-parsed brief content arrives marked in
  `defaulted[]`; a chip the user edits through `editBrief` leaves `defaulted` — from then on the
  row says the USER wrote it, and only a user mutation can make that true.
- **Variation plane** — `altShots` (the SAME shared `shotElement` validator as `shots`: one
  const in `schema.ts`, so the two arrays cannot drift), `altTargetDurationSeconds`,
  `deckLockedAt`. The refused anti-pattern: NO `decks[]` array with a picked index the money
  path reads. `plans.shots` IS the picked deck — `sceneDeckOf`, `jobEstimate` and the reserves
  never learn variations exist. `switchDeck` is the only swap, and it refuses once Generate has
  locked the choice (`deck_locked`); post-Generate change is canvas-only, on the paid rail.
- **Citation fields, ON the shot element** (so reorder/delete/switch carry them for free) —
  `source {docId, title}` is MODEL-AUTHORED text whose ownership is checked where consumed (the
  `asset.docId` precedent); `needsConfirmation` is the parser's flag. **`confirmedAt` is written
  ONLY by `confirmClaim`, and the model can never write it**: no model-reachable mutation sets
  it, and `confirmClaim`'s validator takes `planId` + `sceneIndex` and nothing else — an actor
  or timestamp in the args is a validator error, not a runtime branch. A changed claim is
  unconfirmed: a real narration edit of a confirmed scene clears `confirmedAt` (keeping
  `needsConfirmation` and `source` — the new words still state a figure). Confirmation is NOT a
  structural deck edit: no `shotsChangedAt`, no render clear.
- **`renderRetriedAt`** — code-stamped retry marker (the clear-failure card's "assembled again"
  time); **`reelVaultDocId`** — code-written vault doc REF, never a URL and never bytes. Neither
  has any model write path.
### The Phase-33 money gates and the variations terminal (33-03)

The planes above go LIVE at three choke points — the terminal that writes them, and the two money
sites that read them:

- **The variations terminal** — `dispatch.persistStoryboard` runs `parseVariations` FIRST, above
  both deck contracts. `kind:"two"` lands deck A picked (`shots` + `targetDurationSeconds`) and
  deck B parked (`altShots` + `altTargetDurationSeconds`) in ONE `persistDeck` call, with script /
  art direction parsed off A's OWN slice, the brief off the full body, and the per-scene
  `source`/`needsConfirmation` fields riding each shot element. `kind:"refused"` lands a refusal
  card naming WHICH variation and why (`variationRefusalBody`, same `SCENE_WHY` vocabulary) —
  refusal-over-fallback one level up: a body that declared a choice never quietly lands "the"
  deck. `kind:"one"` is the untouched v2 flow, extended to land brief + citations and to CLEAR
  the parked alternate (whole-deck-write semantics: a post-pick chat revision replaces the picked
  deck, so the alternate — and any previous `deckLockedAt` — is stale by definition). The
  `persistDeck` arg validator (`parsedShot` in plans.ts) accepts `source`/`needsConfirmation` and
  has structurally NO `confirmedAt` — the second provenance door after the parser type; a test
  pins the rejection. `deck_persisted` audit gains `variations`/`citedScenes`/`unverifiedScenes`
  COUNTS — never a title, never a claim (§4).
- **The confirm gate (`unconfirmed_claims`)** — a picked-deck shot with `needsConfirmation` and no
  `confirmedAt` refuses BOTH `jobEstimate` and `reserveSceneJobInner`, in the SAME position of the
  same pre-flight order (the wave-5 co-location rule: the number on screen and the button open
  together or not at all). ONE shared predicate (`firstUnconfirmedClaim`) so the two sites cannot
  drift. The reserve-side check reads the plan ROW inside `reserveSceneJobInner` — no caller can
  hand it a deck that skips the gate, and it is deck-wide (a `regenerateBlock` partial buy refuses
  too). The estimate names the FIRST offending scene (`blockIndex`) so the canvas can point at the
  chip. `confirmClaim` on every flagged scene clears it reactively. Mutation-proven: deleting the
  reserve-side check makes a reservation SUCCEED with an unconfirmed claim — money moved is red.
- **Generate is the point of no return** — on a SUCCESSFUL scene reservation, `generateReel`
  stamps `deckLockedAt` and DELETES `altShots`/`altTargetDurationSeconds` in the same mutation
  (the locked discard decision). A refusal locks and discards nothing. `switchDeck` answers
  `deck_locked` BEFORE `no_alternate` — post-Generate the truthful refusal is "the choice is
  bought", not "there is no second deck" (there isn't, because it locked). Picked-deck-only
  invariant, pinned by test: a parked alternate moves NEITHER the estimate lines nor the
  reservation's `estCents`; the money number tracks `plans.shots` alone.
- **`sceneCitations`** — the citation read plane: one entry per scene that claims anything
  (`{sceneIndex, docId, title, verified, needsConfirmation, confirmedAt}`). `verified` = the doc
  exists AND belongs to `ctx.tenantId`, checked where the model-authored id is CONSUMED (the
  `asset.docId` precedent); a foreign, malformed or deleted id is `verified: false` — inert,
  never a clickable citation — and `normalizeId` failing closed makes garbage indistinguishable
  from a foreign id. Titles and ids only; no URL is minted (PreviewModal does its own access).

### The Phase-33 citation and failure SURFACES (33-08)

The canvas half of the two gates above. Everything here is derived in `mediaCanvasView.ts` and
called by `mediaCanvas.test.ts`; `MediaCanvas.tsx` holds markup and event wiring only.

- **`citationView(citations)` — a citation is a LINK only when `verified`.** Four states, and the
  fourth is the one worth knowing: `cited` (verified doc → `link`), `confirmed`,
  `needs_confirmation`, and **`unverified`** — a scene carrying a source the server could not
  match to one of this tenant's documents. `unverified` is NOT rendered as "needs your
  confirmation", because `confirmClaim` answers `not_a_claim` for a scene the parser never
  flagged: a confirm button there could only ever refuse, and the Generate gate keys on
  `needsConfirmation` alone, so calling it a block would also be false. The `link` is computed
  ONCE, above every branch, so no arm can mint one from an unverified row. Click-through reuses
  `cards.tsx`'s `VaultDocButton` (exported for this) → `api.vault.vaultDoc`, which answers `null`
  for another tenant's id. `blockLine` ("Confirm N claims to enable Generate.") is the COUNT beside
  the disabled button; `jobEstimate`'s `unconfirmed_claims` sentence remains the authoritative
  refusal, since it names the first offending scene and this cannot.
- **`failureCards(plan, scenes, estimate)` — four families, one card shape.** A per-scene card for
  every failed/blocked face; a RENDER card (free "Retry render"); a HELD card for the
  `HELD_REASONS` set, which carries **no arm of its own** and points at the failed scene's card
  (a retry there buys a second sandbox over the same hole); and a CAPTION card, which is a
  degraded-deliverable report with no arm because no re-burn mutation exists (20-17: a caption
  failure never unpublishes the reel).
- **THE MONEY RULES, and they are the reason this is a tested fold rather than JSX.**
  - *Sunk* = `actualCents` when a face LANDED, its `estUsd` reservation when it FAILED —
    `media.ts` says `actualCents` "stays absent if it failed", and `UNLANDED_RESOLVES.media` is
    `false`, so that reservation is spent permanently. The line says **spent**, never "pending".
  - *Retry adds* = this scene's own reserved lines PLUS the estimate's own `render (incl. one
    retry)` line, because `regenerateBlock` reserves a render alongside the scene. With no
    estimate loaded the label says `"…adds, plus the re-assembly"` rather than silently omitting
    it — understating money is the one direction a price label may not err in.
  - The two numbers are pinned to DIFFERENT values in the tests and **swap-tested by
    transposition** (`estUsd` ↔ `actualCents`), not by deletion: a deleted value is absent and
    almost any assertion notices, while a transposition keeps every number present under the wrong
    label. The mutation reddens 4 tests.
  - A kind switch is FREE and buys nothing; the cheaper picture is bought by the regenerate that
    follows. `text_card` is the arm that can end a hold with no spend at all.
- **A code is NEVER prose.** `failureClause` maps every code in the four closed vocabularies
  (`STDERR_CODES`/`RenderRunnerCode`, `RenderRefusal` + trigger-side `incomplete_batch`,
  `submit_canceled`/`submit_failed`, and the caption codes) to a sentence, and an unrecognised code
  falls back to a GENERIC sentence — never to itself, which is what `failureText` still does for
  the detail line. Every card renders its code once, in `.trace-line` (mono, dimmed), underneath.
  No card model can contain a provider string: `mediaJobs.failureReason` and `plans.renderReason`
  are CODE fields by schema contract (§4), and `failureReason` was added to `media.byPlan`'s
  `JobFace` so the code travels on the SAME face whose `status` the card describes — `assetUrls`
  carries it too, but returns every attempt, so on a regenerated scene the two can name different
  rows.

## The scene-kind price table (20.2 wave 7) — ADR-019

The §4.1 table above is the BLOCK era's economics: one clip length, every block paid. A scene deck
is priced per kind, by one table in the pure package that both money sites read.

`packages/cost/src/media.ts`:

- **`SCENE_VISUAL_LINE`** — what one scene of each `VisualKind` buys. `null` means it buys NOTHING,
  which is different from costing zero: there is no provider line to reserve, no row to insert and
  nothing to poll.
- **`sceneVisualSpec(visual, seconds)`** — the priced spec, or `ok(null)` for a free kind. Err
  propagates unchanged; an off-grid `generated_video` is `illegal_duration` here, at the free gate,
  rather than inside a sandbox that has already been bought.

| Kind | Buys | USD at 4 s | Duration freedom |
|---|---|---|---|
| `generated_video` | one `sora-2` clip | $0.40 | 4 / 8 / 12 s only |
| `animated_image` | one `gpt-image-2` still, panned by ffmpeg | $0.006 | any |
| `uploaded_video` | nothing — a tenant vault asset | $0 | any |
| `text_card` | nothing — `drawtext` in the sandbox | $0 | any |

**NOT ONE TARGET DURATION IS REACHABLE WITH `generated_video` ALONE.** Every clip length the pinned
model supports is a multiple of 4, so no sum of them is 15 or 30; 60 composes and costs $6.00 —
over `MEDIA_JOB_CAP_USD`. The cheap kinds are what make the contract legal at all. A 30-second reel
of 3 clips + 4 stills + 1 card costs **$1.224** in pictures; the nearest composable all-generated
reel is **28 seconds** and costs $2.80.

**THIS SECTION ROTTED, AND THE SENTENCE THAT USED TO SIT HERE IS WHY IT WENT UNNOTICED.** It read
"this is asserted, not written down — a price row moving turns the table red rather than making this
section quietly wrong". That was FALSE for the prose: `media.test.ts` recomputes `media.fixtures.json`,
not this markdown, so when 33.1-03 measured the still at $0.006 the fixture moved, the test stayed
green, and every figure in this section stayed stale. Found by the 33.1 audit, not by a gate.

The figures above are HAND-MAINTAINED against `packages/cost/src/media.ts`. `media.test.ts` recomputes every figure from the live
tables against `media.fixtures.json`'s `sceneKinds` block, so a price row moving turns the table
red rather than making this section quietly wrong. The test was observed RED (a 5-second entry
added to the Sora grid makes 15 s and 30 s composable under the cap).

**The grid is asked of the PROVIDER, never of `CLIP_SECONDS`.** That constant is the block era's
DISPLAY set ([4,5,8,10,12]) — wider than any real provider row. `estimateMediaUsd` checked both and
the second check did all the work; the first only tied the money path to a constant the scene
contract deprecates. Removed in wave 7. `isBuyableClipLength` in `media.ts` keeps the same rule for
the BLOCK path, and reads the same provider table.

**The canvas prints one line per paid kind.** Wave 5 printed a blended `pictures` row because this
table did not exist yet; a generated clip is 40x a still, so the blend hid the only lever the user
has. `jobEstimate` now emits `clips` and `stills` separately, and omits a kind the deck does not use
rather than printing it at zero. `uploaded_video` and `text_card` get no line at all — they buy
nothing, and the timeline ribbon above already shows them.

## The music bed (the $0 line)

A reel may carry ONE instrumental bed under the whole timeline. It is the cheapest capability in
this rail and the only one that is priced at zero — which is exactly why it needed the most care
about *how* it is zero.

### It is a LINE, not a freebie

`artDirection.music` holds a slug from `MUSIC_MOODS` (`packages/core/src/storyboard.ts`):
`calm`, `warm`, `upbeat`, `cinematic`. `musicSpecOf` in `media.ts` reads it, and BOTH money sites
call that one reader — `reserveSceneJobInner` and `jobEstimate` — so the number on the canvas and
the number the rail consumes cannot drift.

| Kind | Buys | USD | Billing unit |
|---|---|---|---|
| `music` | one track from the baked library | $0.00 | per track, flat |

`MEDIA_MUSIC_PRICING` is keyed per TRACK because that is what the "vendor" charges on, which is the
same rule every other table in that file follows. **A generative music API could not live here**:
every one bills per generated second or per compute second, neither of which is knowable before the
request exists, so it is refused by construction rather than by preference. That is rule 3 doing
its job, not an oversight to fix later.

It is printed on the estimate at 0c, deliberately breaking `jobEstimate`'s "omit a kind the deck
does not use" rule — because that is a different rule. A kind the deck does not use has no line; a
bed the deck DOES declare has a line that happens to cost nothing, and hiding it would make the
reel look like it was built from fewer inputs than it was.

### It gets NO `mediaJobs` row, and that is load-bearing

`renderReel.batchToRender` refuses a batch unless every row reached `succeeded` with landed bytes.
A music row buys no provider call, so it would sit `queued` forever and the reel would never render
at all. The `render` line has exactly this shape for exactly this reason: priced, capped and
reserved with the job, with no row, no provider request and no webhook.

**This is the opposite of what a stock-footage line would need** — stock DOES fetch bytes, so it
would want a row to hold its `assetStorageId`. Do not reason from one to the other.

### The level is a GATE, not a mixing preference

`assemble_final.sh` proves narration reached the mix by running `silencedetect=noise=-18dB` across
each take's speech span: a span quiet through its centre means the voice never arrived. **A bed
louder than that threshold would hold a silent span above it, and the assert would pass on a reel
with no narration in it** — the "silent second half" failure the gate exists to catch, reopened by
a decoration.

So the bed is built at `MUSIC_I=-33` with its peak HARD-LIMITED to `MUSIC_TP=-24` dBFS, ~6dB below
the threshold and ~14 LU under the voice. Both numbers are pinned by a tripwire in
`assembleScript.test.ts`, which asserts the margin numerically — so "make the music louder" has to
come past that assertion.

**The ceiling is `alimiter`'s, NOT `loudnorm`'s, and this cost a real defect.** `loudnorm`'s own
`TP` parameter accepts only **[-9, 0]**. The first version of this asked it for `TP=-24`, which is
not a silent no-op: ffmpeg exits with `Value -24.000000 for parameter 'TP' out of range`, the bed
fails to build, and the reel renders **silently bedless** — while every source tripwire stays
green, because the string looked right. It was found by running ffmpeg, not by reading. So
`loudnorm` sets the loudness with its `TP` at the floor of its own range (-9), and
`alimiter=limit=${MUSIC_PEAK}:level=disabled` puts the peak where the gate needs it.
`level=disabled` is load-bearing: alimiter's auto-level default normalises the output back to 0 dB,
which would undo the limit it was just asked to apply. `MUSIC_PEAK` is DERIVED from `MUSIC_TP`
(`10^(d/20)`) so the dB constant and the linear one cannot drift apart.

**Verified by running the assembler, 2026-08-26** (ffmpeg is available on the dev box; these are
measured, not reasoned):

| Case | Result |
|---|---|
| `--music calm`, narrated take | exit 0, `"music":"calm"`, 15.100s against a declared 15 |
| `--music calm`, **silent** take | **exit 1** — the narration assert still fires. The gate is NOT vacuous. |
| `--music upbeat`, no such track | exit 0, `WARN: no 'upbeat' track`, sidecar `"music":"none"` |
| `--music ../../etc/passwd` | **exit 2**, refused on the charset before touching a path |

Levels in the delivered file: the bed's own region reads mean -23.3 dB / max -19.7 dB (against
-91 dB — digital silence — with no bed), and the narration region peaks at -2.4 dB. The bed is
audible and the voice sits ~17 dB over it. (Those figures are POST the final linear loudnorm, which
adds a constant gain; the -24 ceiling applies pre-mix, which is where the assert reads it.)

For the same reason the bed is STATIC rather than `sidechaincompress`-ducked. A compressor's output
level is a function of the voice over time, and no source tripwire can pin a release curve; ducking
would trade a provable property for an audible one. If it is ever wanted, the assert is reworked
FIRST.

### What it cannot do

- **Change the length.** Built to exactly `TOT` — `-stream_loop -1` then `-t "$TOT"` — so it covers
  the reel whether the track is 20s or four minutes, and ends with it either way.
- **Move a take.** It enters the SAME single `amix` at offset 0 with no `adelay`, after every
  timeline check has already run. There is no placement to compute wrong.
- **Become a second mix.** Still exactly one `amix`, asserted twice in the drift test.

### The library, and the licence gate

Tracks live in `apps/web/scripts/music/` as committed files, one per slug, and are baked into the
sandbox snapshot beside ffmpeg and the DejaVu font — the render sandbox is `networkPolicy:
"deny-all"` and cannot fetch anything at render time.

**`bake-sandbox-snapshot.mjs` refuses to bake a track whose filename does not appear in
`LICENSES.md`.** It is a filename check, not a licence check: it cannot tell you an attestation is
true, only that a human wrote one down. What it removes is the accident — a track dropped in to try
something and never thought about again.

An EMPTY library is a valid state and the state this shipped in. `--music` then degrades: WARN, no
bed, and the sidecar records `"music":"none"`. That is not the same as `"music":"calm"`, which is
the whole reason the degrade path writes to the proof plane instead of just logging.

**A missing track WARNS; a malformed slug REFUSES.** They are different failures on purpose. A slug
with no track behind it is a deployment state (a snapshot baked before that mood existed) and must
not kill a paid render over a $0 decoration. A slug that is not a slug is a caller bug, and it is
about to be interpolated into a path.

### Order of operations when adding a track

1. Add the file and its `LICENSES.md` line.
2. `pnpm --filter @pikar/web bake:sandbox`, then set `MEDIA_SANDBOX_SNAPSHOT_ID`.
3. Only then re-seed `media-director` (`pnpm --filter @pikar/backend seed`).

**Re-bake BEFORE re-seeding.** The specialist only writes a `Music:` line once the body is seeded;
if the deployed snapshot has no library yet, every deck that asks for a bed renders without one.
Nothing breaks and nothing is charged, but the reels are quietly bedless until the snapshot catches
up.

### Ceiling and upgrade path

A fixed local library, chosen by mood from a closed set, at one pinned level. Every tenant draws
from the same few beds, so two reels in the same niche can sound alike. The upgrade path is a
licensed catalogue API **if and only if it bills a flat rate per track** — at which point
`MEDIA_MUSIC_PRICING` gains a row per tier and nothing else in the rail moves. A per-second or
per-compute-second music vendor is not an upgrade path; it is a different rail.

## The provider sunset tripwire (and the sora-2 finding)

**`sora-2` — the pinned video model — is deprecated, and OpenAI is retiring the Videos API itself on
2026-09-24 with no replacement named.** `sora-2-pro` carries the same shutdown date.

Verified 2026-08-26 against `developers.openai.com/api/docs/pricing` (which confirmed our $0.10/s
720p row is still exactly right) and `.../deprecations`, and corroborated against independent trade
coverage. Announced 2026-03-24.

### Why this needed a tripwire and not just a note

The fixture already recorded `deprecated: true` and the shutdown date, and **every test was green**.
The only assertion touching it checked that a deprecated entry *has* a date — not that the date is
in the future, not that anyone had decided what replaces it. So the first signal would have been
`generated_video` scenes failing in production on the day the API was withdrawn.

Three assertions now sit on the *pinned* models (`MEDIA_DEFAULT_VIDEO`, `MEDIA_DEFAULT_IMAGE`):

| Assertion | Fires when |
|---|---|
| carries a written succession decision | a pinned model is deprecated with no `succession` block in the fixture |
| is not already past its shutdown | the product is shipping requests to a withdrawn endpoint |
| a pending decision has runway left | shutdown is inside 14 days and `status` is still `decision_pending` |

They are **deliberately time-dependent**. A build that can only break on the day the vendor breaks
it has no warning value. Each failure message names the decision it wants, so a red build here is
actionable rather than merely alarming. Both were mutation-verified: moving the date inside the
runway and removing the `succession` block each turn the suite red with the intended message.

**Do not silence the runway test by moving `RUNWAY_DAYS`.** Choosing a video vendor means an ADR, a
data-transfer decision, a price-table row and a submit path. Fourteen days is the least that is
honest.

### Why the successor cannot be an OpenAI model

The Videos API itself is being retired, and `sora-2-pro` shuts down on the same date. So the
replacement is necessarily a different vendor — which means it **amends ADR-024** (*"OpenAI is the
provider for every media kind"*) and carries a data-transfer decision about where customer prompts
are sent. That is an owner decision recorded in an ADR, not a code change.

### The shortlist, filtered by rule 3

Rule 3 is the filter: a provider whose cost cannot be pre-computed before the request exists is
refused by construction. Rates are published per second of OUTPUT video, read 2026-08-26.

| Model | USD/s | Note |
|---|---|---|
| `veo-3.1-lite` | **0.05** | Half the sora-2 rate. Owner already holds a GCP credential (ADR-016). |
| `kling-3.0` | 0.112 | Per-second on the API side, but yuan-denominated — FX drift inside a USD table. |
| `minimax-h3` | 0.13 | 2K output at ~⅓ of Veo 3.1's full 1080p rate. |

**Rejected, and why it matters that they were rejected on the rule rather than on taste:**

* `seedance-2.0` — bills per **million tokens**, configuration-dependent. Not pre-computable per
  output second. This is exactly the shape rule 3 exists to refuse, and it is the one that would
  have been easiest to rationalise in.
* `sora-2-pro` — same 2026-09-24 shutdown. A fallback that dies on the same day as the primary is
  not a fallback.

### The ADR-016 complication, stated rather than stepped around

ADR-016 says Veo is *"never a fallback target"*. Its reasoning is explicitly economic — it priced
Veo 3 at ~$0.40/s against a $3.50 job cap and found one 15 s clip was 1.7× the whole cap. **Veo 3.1
Lite at $0.05/s is a different economic animal**: a 4 s clip is $0.20, half what sora-2 costs today.

The ADR's *rationale* no longer applies to this variant; its *decision text* still names Veo. That
gap is resolved by a superseding ADR, not by reading the old one loosely. Note also that ADR-016's
proposed cap raise (3.50 → 7.50) was **never landed** — `MEDIA_JOB_CAP_USD` is still 3.50.


## The grounding pass (a reel's facts come from outside, before the deck is written)

`media-director`'s only tool is `searchVault`, so a proposal was grounded **only** in the tenant's
own material. For an idea-stage tenant that material is nearly empty, and the skill body's own
words for the outcome are exact: *"a reel that could have been about this business and is instead
about businesses in general is a failed reel."*

`groundMediaBrief` (`dispatch.ts`) now runs a research turn on the brief before the media turn and
files the findings as a vault document. The deck cites it through the `[doc:...]` slot the scene
contract already validates.

### Why it runs INSIDE `runMedia` and not as its own dispatch

**`plans` is `.unique()` by `(tenantId, threadId)` — one plan row per thread — and
`stageResearchPlan` RECYCLES it.** Staging a research card beside a media card would have research
overwrite the card the reel is proposed on. So the pass runs the specialist turn directly and
writes only the thing that has no plan row of its own: a vault document, through the same
`research.persistFindings` the research route uses.

That choice is what makes everything downstream free. The findings land where `searchVault`
already looks, as an ordinary vault doc with a real id, so nothing learns a new word — no new
source kind, no second citation path, and `renderReel`'s existing ownership check on `source.docId`
covers it unchanged.

### It can never fail the reel

Every outcome — a refusal, a throw, a run that searched nothing — returns quietly and the media
turn proceeds on the vault alone. A reel grounded only in the tenant's own material is worse than
a researched one and far better than none.

This is safe **because of the citation gate, not instead of it**: `statesCheckableClaim` flags an
uncited figure whatever this pass managed to find, so a thin grounding pass cannot let an unsourced
claim through. **The gate is the guarantee; this is the raw material.** If you ever find yourself
relaxing the gate because grounding "usually works", that is the mistake this note exists to stop.

A failure writes one `media.grounding_failed` audit row — refs and a reason code, never the error
text. It is deliberately viewer-visible: the reel ships either way, so without that row a silently
ungrounded proposal looks identical to a researched one.

### The zero-search floor, and why it is sharper here

A run that made no web searches writes **nothing**, the same floor `persistResearchFindings`
applies on the research route. The reasoning is stronger in this position: this document is written
to be cited by the *very next model turn*, so storing a model-memory answer would launder it into a
"grounded" citation inside the same reel.

### The media-specific asks live in the QUESTION, not in the skill body

`research-specialist` is **gated** — changing its body needs a recorded passing eval run — and its
job is general-purpose fact-finding for the whole cockpit. What a *video* needs from research
(citable figures with dates; the objections real customers voice) is a property of this route, so
it is asked in `MEDIA_GROUNDING_QUESTION` here. That keeps a video concern out of a cockpit-wide
skill and costs no eval cycle. `dispatch.test.ts` asserts the question carries both halves, so a
later migration into the body goes red here first.

### Testability

The turn runner is **injected** — the `dispatchAndLand` idiom in the same file. A `LanguageModel`
is not Convex-serializable, so without that injection none of the persist / skip / degrade branches
would be reachable by a test at all and the feature would rest on a source tripwire. All three
branches are covered at $0.

### Cost

One research turn per media proposal. Search fees draw the existing daily LLM allowance
(`searchFeeUsd`, a quota proxy at $0.01/call — see `cost.ts`), **not** the media reservation. That
is not a second spending rail: a dispatched media run already spent tokens on that same allowance,
and no `mediaJobs` row, no media window and no `renderStatus` is touched by this pass.

### Ceiling and upgrade path

ponytail: one research turn per proposal, on the brief as written. The ceiling is that a brief
naming several claims gets one pass over all of them rather than one per claim. The upgrade path is
decomposing the brief first — which the research body already does internally, so the cheap version
is to let it, and only revisit if findings come back thin.


## Silence means unverified (the citation default, inverted)

A reel's factual claims are gated by `needsConfirmation` → `firstUnconfirmedClaim` →
`unconfirmed_claims` at both money sites → `confirmClaim`. That machinery was already here and is
unchanged. What changed is **which scenes reach it**.

### What was wrong

The parser read a scene with no `Source:` line as claiming nothing:

```ts
const src = sources.get(index + 1);
if (src === undefined) return {};        // ← no flag at all
```

and `media.ts` said so out loud: `if (s.source === undefined && s.needsConfirmation !== true)
continue; // claims nothing`.

So the flag was only ever set when the model **volunteered** `Source: unverified`. A scene that
asserted "Founders lose ninety minutes a day to the inbox", omitted the `Source:` line, and moved
on passed every gate in the pipeline — reservation, render, publish — with the figure burned into a
frame and nothing going red.

`media-director.md` mandates the line in prose. **A prose mandate on this skill family is not a
guarantee, and we have the measurement**: `dispatch.ts`'s `persistResearchFindings` records that
the analogous research mandate ("every run searches the web, without exception") was *"violated
twice in six attempts, which is why this is code and not another sentence in the body."*

### What it is now

Silence means unverified. `statesCheckableClaim` (`@pikar/core/storyboard`) runs over the scene's
narration **and its overlay**, and an uncited assertion gets `needsConfirmation: true` — the same
flag, the same gate, the same owner-facing lever. Nothing new downstream.

The overlay is checked because it is the loudest text in the reel and nobody speaks it: a card
reading `90% FASTER` is the strongest claim the video makes.

### The rule that keeps it meaningful: a number is not a claim until it measures something

`"You read one screen and decide"` contains a numeral and asserts nothing. `"ninety minutes a day"`
asserts something checkable. The difference is whether the number quantifies a **measurable unit**,
and that single rule is what keeps this off ordinary marketing copy.

**A gate that cries wolf gets confirmed blind and then guards nothing.** So it was measured, not
guessed, against the only real ground truth available — the two worked examples in
`media-director.md`, which declare per scene whether a `Source:` line was needed:

| | result |
|---|---|
| scenes carrying a `Source:` line, flagged when uncited | **3 of 3** |
| sourced scenes missed | **0** |
| flagged with no `Source:` line in the example | **1** — `ONE WEEK A MONTH` |

That last one is not a false positive. It is a text card restating the *sourced* figure from the
scene before it with no citation of its own — the example being loose, not the predicate being
wrong. The full backend suite (2517 tests) was unaffected, so no realistic fixture deck trips it.

### The ceiling, stated plainly

It catches **quantities** and **appeals to evidence** ("studies show", "according to"). It will
**not** catch an unsourced qualitative assertion — "the fastest way to X" has no number and no
appeal, and sails through. This is a floor that cannot be argued with, not a proof of groundedness.

The upgrade path is a model-side check at proposal time. The thing **not** to do is widen the
keyword lists until ordinary copy trips them; see the cry-wolf note above.

### Where to look when it misfires

* **Flagging good copy** → `CLAIM_UNIT` in `storyboard.ts`. A unit that is too generic is almost
  always the cause. Add a test to the boundary block in `storyboard.test.ts` first.
* **Missing a real claim** → it is probably qualitative, which is the documented ceiling, not a bug.
* **A deck that used to reserve and now refuses** → that is the feature. The lever is `confirmClaim`
  on the flagged scene, not a rewrite of the deck.


## The card palette (the wire that stopped three-quarters of the way)

A text card was drawn black-on-white until phase 3, while the deck it belonged to already carried
a `palette` the specialist chose, `parseArtDirection` validated, the canvas showed, and the owner
approved. Nothing was missing from ffmpeg. The value simply never reached it.

`cardColorsOf` (`@pikar/core/render`) turns that palette into two colours; `batchToRender` reads it
off the approved plan row and sends the pair; `assemble_final.sh` draws with it.

### Why the ink is COMPUTED and never taken from the palette

The background is the palette's — that is the brand signal a viewer actually reads. The ink is
whichever of black or white has more contrast against it, by WCAG relative luminance.

Picking the ink from the palette too would look more designed and would eventually put a mid-tone
on a mid-tone. **That card passes every gate this pipeline has**: the file decodes, the duration is
right, the sidecar is well-formed, the render succeeds. Only the words are invisible. There is no
downstream check that would catch it, which is exactly why the choice is made upstream and pinned
by a 216-colour contrast sweep in `render.test.ts` rather than by four hand-picked examples.

Relative luminance rather than a channel average is load-bearing: brand greens are common and read
far lighter than the same-valued blue, so the cheap version gets a real case wrong.

### The trust boundary this change moved

**A colour is the first model-derived value ever interpolated into the filtergraph.**

The card's WORDS are safe by construction and always were: `textfile=` keeps them out of the filter
string entirely, and `expansion=none` stops drawtext EVALUATING `%{...}` inside the file. A colour
cannot be passed that way — it has to be written into the filter string — so the protection that
covers the words does not extend to it.

Three checks, none of which makes the others redundant:

1. `cardColorsOf` can only emit `0x` + six hex digits, or the default. It is the only producer.
2. `parseBody` re-asserts `CARD_COLOR` at the route, because this runner validates what it was
   SENT, never what it assumes the sender computed.
3. `assemble_final.sh` bounds the charset again before either value is used.

A malformed pair is a **refused render**, not a card quietly drawn in the defaults — same posture
as the music slug, sharper consequence. Verified: `--card-bg "black;rm -rf /"` exits 2.

If a future change adds another palette-derived value to the filtergraph, it needs all three.

### What it does NOT do

* **It cannot change the length.** A card is still built to exactly `SEC`. The fade-in is a filter
  on the picture, capped at a third of the scene, and never becomes a duration term.
* **It adds no `gates` entry to the sidecar.** The script runs no contrast gate, and claiming a
  gate it does not run is the one thing a proof plane must never do. The sidecar reports
  `card_bg` — what was drawn — beside `music`, what was mixed.
* **Typography is deliberately NOT wired.** The deck carries a `Typography` line and only DejaVu is
  baked into the snapshot, so honouring "a grotesque with tabular figures" is impossible here.
  Accepting the field and ignoring it would be a promise the renderer breaks with nothing going
  red. The absence is documented in the script and pinned by a test.

### Verified end to end, not just by tripwire

A source tripwire over a filtergraph proves SPELLING, not validity, so `assemble_final.sh` was run
against real ffmpeg for all four cases:

| Case | Result |
|---|---|
| `--card-bg 0x1B4B43 --card-ink 0xFFFFFF` | exit 0; **card pixels sampled at 26,75,67** against a requested 27,75,67 (yuv420p round-trip); reel 10.005s of a declared 10 |
| the same reel's video scene | unchanged at 51,51,51 — the palette touches cards only |
| no flags at all | exit 0; card pixels 0,0,0 — byte-identical behaviour to before |
| `--card-bg "black;rm -rf /"` | **exit 2**, refused on charset |

### Ceiling and upgrade path

ponytail: two colours and a computed ink, not a themed layout engine. The ceiling is that every
card in a reel looks the same and the palette's remaining entries are unused. The upgrade path is a
per-scene accent from `palette[1]`, at which point `cardColorsOf` grows a third return value and
nothing else in the chain moves. Typography's upgrade path is baking a second family and mapping
the field onto a CLOSED set of faces — never an arbitrary font name, which is a path.


## Free stock footage (the other $0 line, and the opposite shape)

`stock_video` and `stock_image` put a real clip or photograph from a free library into a scene at
no cost. They are the biggest cost lever in the rail: a 4-second generated clip is $0.40 and a
60-second all-generated reel is over the whole-job cap before a word is voiced, while the same 60
seconds of stock is $0.

### The one thing to understand before changing anything here

**A $0 line is not one pattern.** This rail now has two, and they are opposites:

| | music bed | stock |
|---|---|---|
| price | $0 | $0 |
| `mediaJobs` row | **none** | **one, per scene** |
| why | buys no provider call; a `queued` row would deadlock `batchToRender`, which refuses a batch unless every row reached `succeeded` | buys BYTES; the render cannot read them unless they landed on a row |
| where the bytes are | baked into the sandbox snapshot | fetched at job time into `_storage` |
| fails how | degrades — a missing track WARNs and the reel renders bedless | refuses the scene — the fix menu swaps it |

If you add a third free capability, decide which of these two it is FIRST. Getting it wrong is not
a pricing bug, it is a reel that either never renders or silently renders wrong.

### Where the two vocabularies meet, and why the row stayed four members

`mediaJobs.kind` says **what the bytes are**. `MediaSpec.kind` says **what the money is**. They
agree for every bought kind and deliberately diverge for stock:

* the SPEC is `{ kind: "stock", model: "pexels/v1", media, seconds }`, priced from its own
  `MEDIA_STOCK_PRICING` table;
* the ROW is `kind: "video"` or `kind: "image"`, with `provider: "stock"`.

That is the whole reason `renderReel` needed no stock case at all: its `renderable` filter, its
`byIndex` slot map and `deckStillNeedsJob` all read `kind`, and to every one of them a stock clip
is simply a clip. `assemblerKindOf` gained two `case` labels and nothing else.

**Do not fold the two price tables together.** A `$0` row inside `MEDIA_VIDEO_PRICING` would mean
one mistyped model string prices a real generated clip at nothing — undetectable, because the job
would reserve cheap and succeed. Two tables cost one extra `case`; one table costs a silent hole.

### Two constants that are the ASSEMBLER's, not the fetcher's taste

Both live on `MEDIA_DEFAULT_STOCK` beside the price, because both are things `assemble_final.sh`
hard-fails or silently mis-renders on:

1. **`orientation: "portrait"`.** The assembler probes `W`/`H`/`FPS` off the FIRST video scene
   ("GEOMETRY comes from the first VIDEO scene"). Stock libraries are landscape by default, so a
   deck whose opening video scene is stock would silently retune the WHOLE reel to 1920x1080 and
   letterbox every still and card after it. Nothing errors. `pickStockVideo` also re-sorts portrait
   renditions first, because a portrait-filtered search can still return a landscape file.
2. **`minDurationSlackSeconds: 0.5`.** The assembler ERRORs when a clip is shorter than its scene
   by more than 0.5s ("a held still frame is not a scene"). A generated clip is always exactly its
   grid length and a vault upload is the tenant's own pick, so nothing had ever reached that gate.
   `pickStockVideo` filters on it at SEARCH time, so a too-short match is a refused scene the fix
   menu can swap — not a hard render failure after every other input has already landed.

### The routing rule

`submitBatch` branches on **`provider === "stock"` BEFORE `toSubmittable`**, and `toSubmittable`
independently refuses any line whose provider is stock. Both halves are load-bearing, in opposite
directions: without the branch a stock row is skipped and sits `queued` forever (proven by
mutation — the test goes red with `expected 'queued' to be 'succeeded'`); without the guard a row
whose model is `pexels/v1` could be POSTed to OpenAI as a paid generation.

### How a scene becomes stock, and the two-click flow

* the specialist proposes it (the deck's `Visual` cell), or
* the fix menu's **"Swap it for free stock footage"** arm — which is `setSceneVisual` then
  `regenerateBlock`, the identical two-step the "animated still" arm already used. No new mutation
  and no new write path.

`buysPicture` in `MediaCanvas.tsx` **must** include both stock kinds or the second click has no
button. It is a string-comparison list, so widening `VISUAL_KINDS` does not make it red.

### The prompt IS the search

A stock scene's `prompt` is handed to the library as a query, not to a generator as a description.
`hasAssetSource` therefore refuses a stock scene with a blank prompt at the money gate — and that
check is real rather than defensive: `parseSceneDeck` falls `prompt` back to the `Description`
cell, which is only ever trimmed and never required to be non-empty. A blank one would ask the
library for `""` and land whatever its default ranking returns.

### Money

* Every stock scene is a reserved line at $0 inside the existing whole-job reservation. No second
  rail, no bypass, no post-hoc recording.
* **A wholly-free batch still reserves 1 cent.** `chooseMediaBatch` floors with `Math.max(1, ...)`.
  That is existing fail-closed behaviour and it was not weakened to make stock look free.
* The estimate prints a `stock` line **at zero** when the deck uses it — the same deliberate
  exception the music line takes. A kind the deck does not use has no line; a kind it DOES use that
  happens to cost nothing still belongs on the invoice.

### Licensing

The Pexels licence permits commercial use inside a composed work with no attribution required, and
forbids redistributing assets UNALTERED as a standalone product. A reel is a composed work, and
this pipeline never delivers a stock asset on its own. The provider id is kept on the row as
`providerRequestId` (`pexels:<id>`) so any frame in any finished reel can be traced back to what it
was cut from.

### Secrets

`PEXELS_API_KEY` is a **Convex deployment env var** — `npx convex env set PEXELS_API_KEY <key>`
from `packages/backend`. Never Vercel, never `.env.local`, never a client-visible variable. Free
tier, no card. Read through `requireEnvMedia`.

### What is still unproven

**Nothing here has been run against the live API.** The environment this was built in has no
outbound network, so `pickStockVideo` / `pickStockPhoto` are pinned against the response shape the
adapter *encodes*, not one that was ever observed. The unit suite passing is not evidence that the
integration works.

Before trusting it, once, by hand:

1. `npx convex env set PEXELS_API_KEY <key>` from `packages/backend`.
2. Propose a deck with one `stock_video` and one `stock_image`, press Generate, and confirm both
   rows reach `succeeded` with bytes.
3. Confirm the finished reel is **720x1280**. If it came out landscape, the orientation parameter
   is not doing what this playbook claims and `MEDIA_DEFAULT_STOCK` is where to look.
4. Check the sidecar's scene count and asserted duration are unchanged.

If the response shape has moved, the symptom is `stock_bad_response` on the row (a changed API),
which is deliberately a different code from `stock_no_match` (a search that found nothing) — the
two send you to completely different levers.

### Ceiling and upgrade path

ponytail: ONE provider, priced flat at its free tier, chosen for covering both photo and video
behind a single key. The ceiling is that a rate-limited or unreachable library fails the scene — no
cent is at risk, because none was reserved, and the fix menu swaps it for a card or a still. The
upgrade path is a second row in `MEDIA_STOCK_PRICING` plus a second fetcher branch. It is **not** a
scoring router or a provider-selection abstraction; that is scope this has not earned. A paid tier
is an upgrade path only if it bills per ASSET at a published rate — per-compute-second or
per-bandwidth billing is not pre-computable and does not belong in this table.


## The budget rail (20-04)

Media draws its **own** named daily windows. They are appended to the ONE `RateLimiter` in
`packages/backend/convex/guardrails.ts` — a second limiter instance would be a second component
mount for zero gain.

| Window | Rate | Keyed by |
|---|---|---|
| `mediaSpendCents` | `MEDIA_DAILY_BUDGET_CENTS` = **1,000** ($10/day) | `tenantId` |
| `deploymentMediaSpendCents` | `DEPLOYMENT_MEDIA_BUDGET_CENTS` = **10,000** ($100/day) | **KEYLESS** |

`DEPLOYMENT_MEDIA_BUDGET_CENTS` resolves research Open Question 2. D10 names only the per-tenant
number; the ceiling is a planning decision, and 22.1-02's argument applies unchanged — per-tenant
keying alone makes exposure `N × $10`, unbounded in N, with the manual kill switch as the only
global stop. **10,000 keeps the same 10× ratio `DEPLOYMENT_BUDGET_CENTS` holds over
`DAILY_BUDGET_CENTS`** — one ratio to remember across both rails. Worst-case daily exposure is
therefore **$100 media + $50 LLM, across four windows that never share.**

### Invariants

- **Media spend NEVER moves the token budget, in either direction.** ADR-011 and D10 both say the
  rails do not share a window, and `dispatch.ts`'s `ENVELOPE_FRACTION` takes its 25% out of the LLM
  rail specifically — folding media in would silently shrink every sub-agent envelope. Asserted both
  ways in `media.test.ts`.
- **The whole JOB is reserved BEFORE the first POST.** `media.reserveJob` estimates every line
  (clips + voice + captions STT + render), refuses over `MEDIA_JOB_CAP_USD`, `check`s both windows
  and consumes them with `reserve: true` — **all inside one mutation, which is one serializable
  transaction.** This is the ONE place media diverges from the LLM rail: `prepare`/`recordSpend` can
  safely check-then-record-later because LLM calls in a turn are serial and an overshoot is cents.
  Here 13+ jobs are submitted back-to-back and land minutes apart, so post-hoc recording would let
  all of them fire against a window that had room for one. *An LLM overshoot is cents, a media
  overshoot is dollars* (20-PROVIDER-EVAL.md §4).
- **A refused job inserts ZERO `mediaJobs` rows.** All-or-nothing by construction, not by cleanup —
  every refusal returns before the first `ctx.db.insert`.
- **The cents floor is applied ONCE, on the job total**, by `chooseMediaBatch`. Per-line `estUsd`
  goes onto the rows unfloored.
- **The voice line is reserved at 2× its character estimate** so one rewrite round is already paid
  for. The provider returns no duration, so an overrunning line is only provable in the sandbox, and
  the cure is a rewrite plus a re-voice — a job that cannot afford its own cure would strand a paid
  deck.
- **The render is a reserved cost line with NO `mediaJobs` row.** It has no `falRequestId` and no
  webhook; it is a plan-row concern. It is reserved so a job that cannot afford its own render is
  refused before its clips are bought.
- **No refunds.** If 3 of 6 blocks come back `provider_blocked`, the reserved cents stay consumed.
  Over-reservation is the fail-closed bias. Refunding turns a rate-limiter window into a ledger; the
  upgrade path, if drift ever proves material, is a real spend table — not a credit call.
- **Regenerate-one-block is a job of ONE block through the identical path** (one video line, one tts
  line, one render line — regenerating a block invalidates the reel and forces a re-render). No
  second rail, no second cap, no bypass.

### The two kill switches — INDEPENDENT levers

```bash
# from packages/backend — the convex CLI only resolves the deployment from there
npx convex run guardrails:setKillSwitch      '{"on":true}'   # stops EVERYTHING incl. media
npx convex run guardrails:setMediaKillSwitch '{"on":true}'   # stops paid generation ONLY
```

Flipping the LLM kill switch must not be the only way to pause media, and pausing media must not
pause the email cockpit — that is the point of a separate rail. But `reserveJob` checks **both**: an
all-stop is an all-stop. `mediaKillSwitch` is `v.optional` in the schema, so a row written before
Phase 20 reads OFF by the same default-on-read the main switch uses. Zero seed, zero migration.

Read remaining budget without consuming it: `guardrails:mediaRemainingCents` (the tighter of the two
rails, each clamped `>= 0` first — `reserve: true` can drive a window negative).

### The refusal codes

`kill_switch` · `unknown_model` · `over_job_cap` · `illegal_duration` · `narration_too_long` ·
`narration_too_short` · `media_daily_exhausted` · `deployment_media_exhausted`

They are distinct because they send the user to distinct levers: rewrite a line, cut blocks, wait
for tomorrow, or call the operator. `unknown_model` is the one that fires on the `-preview` rename
risk below — loud, free, and fail-closed.

### Mutation checks — observed RED on demand, 2026-08-02

The guarantees below were each **seen to fail**, not merely asserted. Restored byte-identical after
every one.

| Mutation applied | What actually fired |
|---|---|
| `rateLimiter.limit(...)` removed from `reserveJobInner` (consumption outside the transaction) | **7 of 22 tests RED**, incl. the concurrency test — no window moved at all |
| the tenant `check` sized `count: 1` instead of `count: estCents` (the `preCall` shape) | concurrency test RED on the target line: **`expected [ {…}, {…} ] to have a length of 1 but got 2`** — both jobs won |
| the cents floor moved from the batch total to per-line | **6 RED**: the 13-line sub-cent job `expected 15 to be 4`; the §4.1 job `expected 309 to be 305` |
| the narration band pre-flight guard deleted | **3 RED**, and each returned a 5-key `ok: true` object — i.e. **the over-length job reached a reservation. Money moved.** That second half is the point of the guard |

### Known gap — `guardrails.ts` is in NO playbook's watch prefix

Research §11.3 recorded it and it is still true: `packages/backend/convex/guardrails.ts` appears in
no `watch.json` entry, so `check-playbooks` cannot demand a playbook bump when the spend rails
change. **20-04 deliberately did not fix it** — `guardrails.ts` is shared by the LLM rail and the
media rail, so assigning it to `media.md` alone would be wrong, and assigning it needs an owner
decision about which playbook holds the guard subsystem.

## The spend ledger (26-08)

The limiter stays **enforcement** truth; `spendEvents` is **reporting/reconciliation** truth. Both
media movements now write a row in the SAME transaction as the limiter movement, via
`spendLedger.recordMovement` (a plain function call — a separate `ctx.runMutation` would be a second
transaction and could leave the window moved with no record).

| where | phase | amount | correlation |
|---|---|---|---|
| `reserveProviderLinesInner`, after both `limit()` calls | `reserved` | `estCents` — the WHOLE job | `mediabatch:<batchId>` |
| `mediaComplete.landResult`, success path | `actual` | that line's `actualCents` | `mediabatch:<batchId>:<jobId>` |

**ONE reserved row per batch, not per line.** `chooseMediaBatch` floors the TOTAL exactly once
(D12a), so per-line reserved rows would not sum back to the reserved figure.

**THE PLANES DIVERGE HERE ON PURPOSE, AND THIS IS THE ONLY RAIL WHERE THEY DO.** At a landing the
limiter consumes only the positive `delta`, because it already took the whole estimate up front and
this rail never refunds. The ledger records `actualCents` — the full cost of the line — because it
answers a different question. Recording the delta instead would report an ordinary $0.50 clip that
came in at or under estimate as costing **nothing**, which is every normal landing.

The remainder is not lost. `reserved − actual` is exactly the never-returned over-reservation, and
`aggregateSpend` reports it as **`unlanded`**. That is the honest shape of a rail with no refund
path, and it is why a failed line writes NO movement at all: it never landed, so its share stays
unlanded rather than being recorded as zero spend. **A `refunded` movement must never appear on this
rail** — a test asserts that, and if one ever does, either the rail grew a credit path (a real
design change to be argued, not slipped in) or something is minting money the limiter never returned.

**Both sites DERIVE their correlation; neither mints a nonce.** The reasoning rail mints because an
action re-entry re-spends — that rule is wrong here. A reservation happens inside the plan's
`proposed → approved` CAS, so approve-once is reserve-once; a re-delivered fal webhook is a replay,
not a second charge. **The `<jobId>` segment on the landing is load-bearing:** every line of a batch
shares one `batchId`, so a batch-scoped correlation would let the first landing suppress all twelve
siblings of a 13-line reel. The `TERMINAL` guard protects the money; the correlation protects the
record.

**Both writes are guarded on `> 0`, and the zero case is REAL here rather than defensive padding.**
A voice take can price under half a cent, so `Math.round` yields 0 — and a zero-cent movement is
rejected outright, which inside `landResult` would abort the whole landing transaction and fail a
sub-cent take's own webhook. Rounding up to 1¢ would be worse: it invents money the limiter never
took. Skipping is the honest option and the line's share simply stays inside `unlanded`. **This is
the sub-cent fidelity limit already recorded in `guardrails.md` "Known gaps", and media hits it
hardest** because tts lines are routinely fractions of a cent while clips are not. Five tests
caught this the moment the ledger went in; do not "fix" it by padding.

**`unlanded` MEANS SOMETHING DIFFERENT ON THIS RAIL, and `UNLANDED_RESOLVES.media === false` says
so in code rather than in prose.** On reasoning and ingest, unlanded money is in flight — work not
finished, or a refund still owed. Here it is PERMANENT: the whole job estimate is consumed up front
and never returned, so the gap between the reservation and what the lines actually cost is the
tenant's cost of the over-reservation, not a pending balance. `aggregateSpend` derives `unlanded`
per rail and returns `byRail`; a Finance surface that renders the blended figure as "pending" is
describing this rail wrongly. Never present media's unlanded as recoverable.

**Coverage opens at the GATE.** `reserveJobInner` calls `ensureCoverage` ABOVE the kill-switch
check — so a tenant paused by the media kill switch reports a confident zero rather than `unknown`
for the whole pause. That placement is load-bearing and a test caught it being wrong once: the
kill-switch refusal returns above `reserveProviderLinesInner`, so a gate placed in the inner
function missed exactly the refusal it most needed to cover.

**Rollback:** the Finance UI may be disabled; these two writers may not be. An append-only history
has no backfill, so a dark window is a permanent hole. Same rule as `dashboard-pages.md` and
`guardrails.md` state from their own sides.

**Verify:** `pnpm --filter @pikar/backend test -- media spendLedger`. Mutation checks that were
actually run: record the limiter's `delta` instead of `actualCents`; drop `<jobId>` from the landing
correlation; record one line's estimate instead of the batch total. Each turns a different test red —
and the second one initially survived, which is how the sibling-lines test came to exist.

## The submit adapter (20-05)

`packages/backend/convex/media.ts`, below the D5 readers. It turns a reserved `mediaJobs` row into
a fal queue ticket and returns. **No code path in this module polls fal or waits for a terminal
status** — `media.test.ts` scans the comment-stripped source for `status_url` / `response_url` /
`cancel_url` / `setTimeout` / `setInterval` / `while (` and fails if any appears. A 10 s Wan 2.5
clip is **1–3 minutes** of wall clock; plan 20-06's webhook is what lands it.

| | |
|---|---|
| Submit | `POST https://queue.fal.run/{model_id}?fal_webhook=<url-encoded callback>` |
| Auth | header `Authorization: Key ${FAL_KEY}` |
| Accept | `{ request_id, response_url, status_url, cancel_url, status, queue_position }` — only `request_id` is read |
| Input refused | HTTP **422**, `type: "content_policy_violation"`, **non-retryable** |

### THE PINNED-SPEC RULE

**Every dimension the price table keys on is set explicitly on the submit, from the SAME `spec`
object `chooseMediaBatch` consumed.** Never let fal default one.

> Omit `resolution` and a 10 s clip costs **$1.50 instead of $0.50** — Wan 2.5 defaults to 1080p.
> That is 3× the reserved rate and **a third of the whole $3.50 job cap**, eaten silently, with no
> test going red. The estimate would keep reporting $0.50 and only the invoice would disagree.

The containment is a test that asserts the submitted JSON **field for field** against
`buildSubmitBody` of the priced spec. Mutation check, observed RED 2026-08-02: delete
`resolution: spec.resolution` from the video arm → 2 assertions fail.

The field names are the ones read vendor-direct from
`fal.ai/api/openapi/queue/openapi.json` (plan 20-01's preflight), **not** from memory:

- **video** — `prompt`, `resolution`, `duration`, `enable_prompt_expansion: false`.
  `duration` is a **STRING enum `["5","10"]`**; submitting the number `10` fails schema validation
  *after* the reservation is taken, so `String(seconds)` at the boundary is load-bearing.
  `enable_prompt_expansion` defaults **true** — a model-side rewrite of our prompt — so it is
  pinned off, or the prompt we priced is not the prompt that ran.
- **image** — `prompt`, `image_size: {width, height}`, `num_images: 1`. There is **no `width`/
  `height`** on this endpoint, and `num_images` is a **straight price multiplier**.

**Audio: Open Question 5 is CLOSED, and it closes at the assembler, not here.** The endpoint has
**no audio toggle at all** — the only audio field is `audio_url` (optional), which we never send.
Wan 2.5 generates native audio and we cannot ask it not to. That is not a conflict with the D8
voiceover bed: `render/assemble_final.sh`'s LEVEL LAW already ducks a clip's own diegetic track to
`SFXVOL 0.20` under the voice, and the narration is always 1.0. A test asserts **no key matching
`/audio/i` appears in any video body** — re-adding one is a visible decision.

### THE EXHAUSTIVENESS RULE

`buildSubmitBody` takes `SubmittableSpec = Extract<MediaSpec, {kind:"video"|"image"}>` and its
switch ends in `const _never: never = spec`. **A new priced `kind` MUST get its own arm — and that
is a compile error, not a code review.** Plan 20-14 adds `"tts"` to that alias and plan 20-17 adds
`"stt"`; the moment either widens it, `tsc` goes red until the matching `case` is written.

Mutation check, observed 2026-08-02: widening the alias with `"tts"` gives
`media.ts(516,13): error TS2322: Type '{ kind: "tts"; … }' is not assignable to type 'never'`.
Replacing the arm with `default: return {}` makes that error **disappear** — which is exactly the
failure mode the guard exists to prevent: a `tts` spec inheriting another arm's body, priced as one
thing and submitted as another. **The money bug in a new costume.**

`SubmittableSpec` deliberately excludes `"render"` and `"free"` — neither has a provider request at
all, so an arm for them would be a lie rather than a gap.

### THE IDEMPOTENT CLAIM

`submitBatch` calls `internal.media.claimLine` — a serializable mutation flipping `queued →
submitted` and returning `false` if the row has already moved — **before** each POST.

**This matters more now that a batch is ~2N+1 lines rather than N.** The action-retrier re-runs a
failed action, so a `submitBatch` that dies on line 7 of 13 would re-POST lines 1–6 on retry: a real
double spend against a window that has already been consumed, with no refund path (the rate-limiter
is a window, not a ledger). The claim makes the retry free.

The batch reader is deliberately **UNFILTERED by status** — `claimLine` is the sole gate, so
removing it is provable. Mutation check, observed RED 2026-08-02: delete the claim from the loop and
two consecutive `submitBatch` runs issue **4 fetches instead of 2**.

Rows this plan does not wire (`tts`, `stt`) are recognised **before** the claim and left at
`queued`, untouched, for 20-14/20-17.

### Failure → a CODE, never provider prose

The `calendar.ts:84` `reasonCode` idiom (CLAUDE.md §4). Only a **422** body is parsed at all, and
only its `type` discriminator (top-level or `detail[0].type`, validated against
`/^[A-Za-z][A-Za-z0-9_.-]{0,79}$/`). A 5xx body is a stack trace as often as not, so it is never
read — its status alone becomes `http_503`. A transport throw becomes `transport_error`, and the
exception is dropped on the floor because **its message can carry the URL, and therefore the
webhook's HMAC segment**.

| outcome | row |
|---|---|
| accepted | `status: submitted`, `falRequestId` recorded |
| 422 | `status: blocked`, `verdict: provider_blocked`, `failureReason: <code>` — siblings untouched |
| 5xx / transport / no `request_id` | `status: failed`, `failureReason: <code>` |
| plan has no matching shot | `status: failed`, `failureReason: missing_shot`, **zero fetches** |

### The webhook URL

```
${CONVEX_SITE_URL}/fal/callback/${jobId}.${hmacHex(jobId, FAL_WEBHOOK_SECRET)}
```

The `gmailAuth.buildAuthorizeUrl:59` construction **verbatim**, per **JOB ROW** rather than per
tenant — `hmacHex` was exported from `gmailAuth.ts` for this (one word; there is exactly one
HMAC-path-segment pattern in this repo and it has been in production on the OAuth `state` since
Phase 2). The segment binds to ONE `mediaJobs` row, so a leaked URL buys an attacker one
already-finished job. **No `callbackHash` is stored** (20-02's recorded deviation) — plan 20-06
re-derives this string, so it must match character for character. A test re-derives it from the
jobId and asserts two lines get two different segments.

### The `FAL_FIXTURE` seam and the two secrets

```bash
# from packages/backend — the convex CLI only resolves the deployment from there
npx convex env set FAL_KEY <key>
npx convex env set FAL_WEBHOOK_SECRET <random-32-bytes>
```

Both are **deployment env vars, not `.env.local`**. `submitBatch` reads `CONVEX_SITE_URL` and
`FAL_WEBHOOK_SECRET` **above** the loop, so a missing secret refuses the batch before line 1 claims
itself.

`FAL_FIXTURE=1` short-circuits `submitLine` with a synthetic `fixture-<uuid>` request id and
**zero** fetches — the whole submit → webhook → land path is exercisable at $0. It sits **after**
the `FAL_KEY` check on purpose, so "no key" is the same refusal in fixture mode as in production
(`submitLine`'s first statement is the key read, and the test asserts a fetch-call count of **0**,
not merely the error message). Remove the seam only when a hermetic fal mock exists.

## The landing plane (20-06)

`POST /fal/callback/*` in `packages/backend/convex/http.ts`, terminating in
`packages/backend/convex/mediaComplete.ts`. An unguarded callback here would be a write endpoint
that flips job status, stores attacker-supplied bytes as a tenant's asset, and drives spend
reconciliation — so every step below is fail-closed.

### The auth, and its ceiling

The last path segment is `${jobId}.${hmacHex(jobId, FAL_WEBHOOK_SECRET)}` — the SAME construction
`gmailAuth.buildAuthorizeUrl:59` has used for the OAuth `state` in production since Phase 2, and
verified with `verifyState`'s shape (`lastIndexOf(".")`, split, re-derive, compare). **Nothing is
stored**: `resolveJob` re-derives the digest, so there is no `callbackHash` field to leak or drift.

Refusals, every one a bare `401` with no detail and a **byte-unchanged row**:

| | |
|---|---|
| `FAL_WEBHOOK_SECRET` unset | the fail-closed env guard, and it lives in `resolveJob` — **the one place the comparison happens.** A second copy at the route would make its mutation check vacuous |
| segment has no `.` | malformed |
| digest mismatch | forged or tampered |
| `normalizeId("mediaJobs", raw)` is null | garbage, or a well-formed id from a FOREIGN table. `ctx.db.get` is never reached |
| `x-fal-webhook-timestamp` outside ±300 s, **or absent** | replay of a captured URL + body |

> ⚠️ **The absent-timestamp refusal rests on an unverified assumption.** Research §1.2 is
> MEDIUM-HIGH that fal sends `x-fal-webhook-timestamp` on every delivery. If it does not, EVERY
> callback 401s — loudly, not silently, and **plan 20-11's owner-run live gate is where that is
> confirmed.** It is the first thing to check if live clips submit fine and never land.

**ponytail: HMAC path segment, not Ed25519/JWKS.** The segment proves the caller knows a secret we
minted for THIS job; it does **not** prove fal sent it. Upgrade path when that matters: verify
`X-Fal-Webhook-Signature` (Ed25519 over `request_id\nuser_id\ntimestamp\nsha256(body)`) against
fal's JWKS at `https://rest.fal.ai/.well-known/jwks.json`, cached ≤24 h. **First** confirm the
Convex default runtime's `crypto.subtle` supports Ed25519 — UNVERIFIED, research Open Question 3,
deliberately deferred — and note that a file holding an `http.route` cannot be `"use node"`, so
`node:crypto` is only reachable via an extra `runAction` hop.

### Nothing security-relevant comes from the body

`tenantId`, `planId`, `batchId`, `kind` and `model` are read from the ROW. This is the
`/skillopt/writeback` rule verbatim (`http.ts:123-129`): a body-supplied tenant is
attacker-controllable and is a cross-tenant write. **The only two things taken from the body are
the asset URL and the moderation field, and both are validated.**

The asset URL is extracted through `ASSET_PATH`, **keyed on the ROW's kind, never on the payload's
shape** — `video → payload.video.url`, `image → payload.images[0].url`. An unhandled kind fails with
`unhandled_kind`, because *"find whatever url is in this body"* is a third party choosing what we
download. Plans 20-14 (`tts`) and 20-17 (`stt`) each add ONE arm and touch no part of the security
half.

Then the URL itself is gated before any fetch:

- **https only**, and the host must be `fal.media` / `fal.ai` / `fal.run` or a subdomain (suffix
  match on `.${host}`, so `fal.media.evil.com` is refused). Without this the route is an SSRF into
  whatever the caller names, and the caller only had to know one job's digest.
- **32 MiB ceiling** on the download. An abuse ceiling, not a budget — a 10 s 480p clip is ~4 MB.

### The URL dies in the webhook

The bytes are fetched, `ctx.storage.store`d, and the URL is **discarded**: not passed to
`landResult`, not logged, not stored. **This is what makes CLAUDE.md §4 structural rather than a
promise** — a signed fal URL is both a content leak and a live credential, and after this there is
nowhere in the schema for one to live. The row carries `assetStorageId`, `assetHash`
(`contentHash` over the bytes — the shared hash, widened to accept them), `mimeType` and `bytes`.

### The verdict is the honest four — `none_reported` is NOT "clean"

| value | set when |
|---|---|
| `provider_blocked` | 422 `content_policy_violation` at SUBMIT; no asset exists |
| `checker_flagged` | the response carried `has_nsfw_concepts` and it was true |
| `checker_clear` | the response carried `has_nsfw_concepts` and it was false |
| `none_reported` | an asset came back and the response carried **no** moderation field |

**Every Wan 2.5 video and every `inworld-tts` take lands as `none_reported`** — neither publishes a
per-output moderation field. Rendering it as passed/clear/safe would be a compliance claim fal never
made. **Do not add a fifth value meaning "probably fine."**

### Reconciliation is SKIPPED when there is nothing to reconcile — never faked

```ts
const EXACT_SPEND_KINDS = new Set(["tts", "stt"]);
```

`inworld-tts` bills per **submitted character** and its response carries no duration and no
character count; `scribe-v2` bills per **input audio minute**, of audio we generated and already
measured. A member records `actualCents = estCents` and moves **neither window by one cent**.

**This is not an optimisation and not a trust decision.** Re-pricing a tts row would mean INVENTING
an actual from a value the provider never returns — the guess this whole phase forbids. The
difference is visible in the audit's `reconciled` ref: `exact_by_construction` (skipped),
`repriced`, or `reprice_failed` (the table could not price what fal claimed — recorded, with the
drifting `resolution` in the payload, never silently trusted).

Every other kind is re-priced from the SAME `@pikar/cost/media` table using what fal actually
produced. **Only a POSITIVE delta is consumed**, on both windows, with the same `reserve: true` the
reservation used. `actual <= est` consumes nothing and **refunds nothing** — plan 20-04's no-refunds
rule. The 2× voice over-reservation is therefore never returned, which is intended: it is the
rewrite budget, and it is $0.012.

### Idempotency

fal's retry policy is undocumented, so delivery is assumed **at-least-once**. A row already at
`succeeded`/`failed`/`blocked` short-circuits to `200` at the route AND is re-checked inside
`landResult`. A re-delivered webhook produces no second download, no second store, no second window
consumption and no second audit row.

### `onSubmitComplete` — the retrier terminal, added by 20-07

`mediaComplete.onSubmitComplete` is the `EXTERNAL_TARGETS.media` completion mutation. **It does NOT
land assets — the webhook does — and it does NOT render.** A SUCCESS is a deliberate no-op:
`submitBatch` already recorded every line's outcome, and rows left at `submitted` are waiting on the
webhook, not on this.

Its only job is the failure case. When the retrier finally gives up, a batch that never reached fal
would otherwise sit at `queued` forever while `plans.renderStatus` said `pending` — the canvas
promising a reel that will never arrive. So it fails the still-`queued` rows with
`submit_failed`/`submit_canceled` and sets `renderStatus: "failed"` with the same code. **Rows
already at `submitted` are left alone** — they reached fal and their webhook may still land.

It resolves the plan through `plans.by_media_run` because the retrier's `onComplete` receives only
`{runId, result}` (no context bag), the same constraint `calendarComplete` lives under.

### Who may write a terminal status

**`media.ts` and `mediaComplete.ts` — exactly those two — and `succeeded` is `mediaComplete.ts`'s
alone.** This CORRECTS research's SC2 line (*"the webhook is the ONLY writer of
succeeded/failed/blocked"*), which is not achievable: a 422 `content_policy_violation` is
**synchronous at submit** and produces no webhook at all, so `media.ts` must be able to write
`blocked`/`failed`. Both halves are pinned by a scan.

Plan 20-16's render terminal writes `plans.renderStatus`, **not** `mediaJobs.status`, so it does not
widen this set. If it ever needs to, that is a deliberate edit to the scan.

### The audit allow-list, and the scans that hold it

ONE audit row per landing: `eventType: "media.landed"`, `actor: "fal"`, `correlationId: batchId`.
The payload is **exactly**:

```
jobId, batchId, planId, falRequestId, kind, model, resolution, promptHash,
assetHash, verdict, estCents, actualCents, reconciled, failureReason
```

Ids, hashes, counts and two enums. **No URL. No prompt text. No narration text. No filename.**
`packages/contracts/src/audit.ts` permits any string in its flat map, so the TYPE is not the guard —
six scans in `llmRedaction.test.ts` are:

1. every media audit payload key is on the allow-list;
2. no `url` / `href` / `http` substring reaches one;
3. no `prompt`/`narration` identifier does either (`promptHash` is the only representation);
4. the audit-site count is **PINNED at 1** — **plans 20-09, 20-14, 20-16 and 20-17 each add sites
   and must each bump it deliberately**, having checked the new payload against the allow-list;
5. the terminal-writer set above;
6. **`storage.getUrl` is only ever called inside a `tenantQuery`.** A storage URL is a bearer
   capability. **This is the scan plan 20-17 must not break:** handing fal a `ctx.storage.getUrl()`
   result as the STT `audio_url` would give a third party a bearer capability to a tenant's asset.
   If 20-17 needs the bytes at a provider, it uploads them — it does not hand over a URL.

All six strip comments before matching, so the modules can spell out what they forbid.

## The voiceover stage (20-14)

The reel gets a voice, and it cost **two switch arms, one narration read and zero new integration
surface**. Same provider, same `FAL_KEY`, same queue submit, same HMAC webhook segment, same
`mediaJobs` row, same landing, same audit. If you are here to add a "TTS adapter", stop — there
isn't one, and that is the design.

### The endpoint and its three PINNED fields

`fal-ai/inworld-tts`, **$0.01 per 1000 SUBMITTED characters** (`MEDIA_TTS_PRICING`). The request
body is exactly:

```ts
{ text, voice: spec.voice, sample_rate_hertz: spec.sampleRateHertz }   // and NOTHING else
```

- `text` — the block's **narration**, verbatim. Never truncated, never re-wrapped. A silent
  truncation ships a voiceover missing its last words with no error anywhere and a clip that still
  renders.
- `voice` — `MEDIA_DEFAULT_VOICE.voice` (`"Evelyn (en)"`), read off the **ROW**, not off the
  constant. A row reserved under one voice must not submit under another after a constant bump; the
  row is the record of what was priced.
- `sample_rate_hertz` — **24000**, pinned. The vendor default is **48000**, which doubles the bytes
  that have to reach the render sandbox and makes the ffmpeg resample step non-deterministic.

### THE NO-RATE-KNOB RULE — why this model, and not a better-sounding one

**`fal-ai/inworld-tts` has no `speed` / `rate` parameter at all.** D8's *no time-stretch, ever* is
therefore enforced by the **provider's own schema**, not by our discipline. The `fal-ai/kokoro`
family exposes `speed: 0.1-5.0` and is a live foot-gun: a future contributor "fixing" an overrunning
line by nudging `speed` to 1.15 would violate D8 silently and no test would catch it (delta pitfall
15). **That outranks any difference in voice character.** If the model is ever swapped, this
paragraph is the thing to read first.

The tripwire is an **exact key-set equality** on the built body, not a substring absence — mutation
check M2 (adding `speed: 1.0`) was observed RED.

### The character arithmetic, and what the 2x reservation buys

~15 characters per second of speech, so a 10 s block's narration band is **103-140 characters**
(`minCharsFor`/`maxCharsFor`, 20-01) and a 5 s block's is 43-70. A 6-block 60 s voiceover is
~1,200 characters and **$0.012 — 0.4% of a $3.05 job.** The cap is bounded by the clips, and the
clips were already the locked constraint.

`reserveJob` (20-04) reserves each voice line at **2x** its character estimate. That is the rewrite
budget: a re-voiced line does not need a second reservation. It is never refunded (20-04's
no-refunds rule) and at $0.012 it does not need to be.

**The 140-character pre-flight ceiling is the real defence against an overrun** — it is the only
check that runs BEFORE money moves.

### Landing: `none_reported`, exact spend, and a window that does not move

`ASSET_PATH.tts` reads `payload.audio.url`; everything after that is the video path, unchanged.

- **`verdict` is `none_reported`.** inworld-tts publishes no moderation field. *"Audio is obviously
  fine"* is exactly the reasoning that would put a compliance claim fal never made onto a row.
- **`actualCents === estCents`, and both media windows move by exactly 0.** `tts` is in
  `EXACT_SPEND_KINDS`: the response carries **no duration and no character count**, so there is
  nothing to reconcile and re-pricing would mean INVENTING an actual. The audit records
  `reconciled: "exact_by_construction"` — that field, not the window delta, is where the
  distinction is observable (the delta is 0 either way, which is why the plan's stated
  window-based mutation check could not fire).

### The `file_size` heuristic and its honest ceiling

`landResult` fails a `tts` line with `failureReason: "take_too_long"` when
`bytes / 48000 > plan.clipSeconds + 2`. It is a **byte-count heuristic, not a measurement** — 24 kHz
mono 16-bit PCM is ~48 KB/s, so the division is a duration ESTIMATE. Three things it is not:

1. **Not a pre-flight guard.** By the time it runs the take is already paid for. The 140-character
   ceiling is the only check before money moves.
2. **Not reliable on a compressed container.** A compressed take reads far smaller per second and
   will simply not trip it — a false negative, which is the safe direction for a heuristic.
3. **Not a blanket refusal.** A plan with no `clipSeconds` has no window to measure against, so the
   net is **skipped** — never *"zero seconds, therefore too long"*, which would fail every take on
   a plan shape this phase did not write.

A take that trips it leaves the reel **un-renderable** rather than rendering with a word cut off —
D8's hard-error direction. Upgrade path: read the WAV header's byte rate instead of assuming it.

### Two things that bit, recorded so they do not bite twice

- **`SUBMIT_TEXT` is a table, not an `if`-chain.** `video`/`image` submit `prompt`, `tts` submits
  `narration`, and 20-17's `stt` reads NEITHER (it is keyed to the whole deck at `blockIndex: -1`),
  so a missing key stays a governed `missing_shot` rather than falling through to `prompt`. A `tts`
  line submitting `prompt` would voice the **shot description** over the clip — fluent, plausible,
  completely wrong, and nothing else goes red. The fixture behind it has a prompt and a narration
  that differ, per block.
- **Never write a literal slash-star inside a LINE comment in `media.ts`.** `media.test.ts` builds a
  comment-stripped copy of the module for its static scans, and the stripper closes the block at the
  next star-slash — silently eating the code between, including the `never` guard. Caught here
  because the scan failed loudly; the same trick would make a security scan pass **vacuously**.

## The §-parsers (20-08)

`parseBlockDeck` is joined by two siblings in `@pikar/core/storyboard`, both pure, both feeding the
plan row's DISPLAY fields rather than the money:

- **`parseScript(body)`** — the SCRIPT section verbatim, or `""`. Deliberately not re-wrapped or
  length-checked: the per-block narration is what gets submitted, and `parseBlockDeck` already
  enforces the 103-140 band on it. This string is the reel's script of record at the Approve gate.
- **`parseArtDirection(body)`** — koda's fixed nine fields, or **`null`**. Never a partial object
  with empty strings: the schema field is a 9-key object and a half-filled one renders as an art
  direction the specialist never wrote. `typography` is the one optional key, matching the schema.
  A missing art direction still gets its DECK — a worse-looking reel, not an unusable one.

**The parser does NOT enforce the hex-palette rule.** The skill body teaches *"hex, never a vague
colour word"*; a parser that refused `warm tones` would turn a soft quality problem into a hard
refusal at the Approve gate, where a human is already reading the proposal and is the better judge.

**Two shapes of heading exist in real output and both must parse.** `media-director.md` uses
`## 2. ART DIRECTION` for its own instruction headings but shows the model a **bare `BLOCK DECK`
token** in its example (`media-director.md:76`). `sectionOf` therefore matches with or without `#`s
and with or without an `N.` prefix — and, more importantly, a section ends at the next `#` heading
**or at the next known section token**. With a `#`-only terminator a model emitting bare tokens
would have ART DIRECTION run to EOF and swallow the whole deck, so `avoid` would come back carrying
table rows onto a row the user reads. Found by a fixture that used the wrong heading shape.

## The assemble contract (20-13)

`packages/backend/convex/render/assemble_final.sh` is the governed assembler, **harvested** from
the Higgsfield `faceless-channel-video` workflow v2.0 on 2026-08-02. Harvested, not cloned: the
contract and the ffmpeg invocations were taken; the workflow is not a dependency, and its MCP is
client-side only — structurally unreachable from a Convex action and from a Vercel Sandbox, which
is the finding ADR-011 exists to record.

### §5 DOES NOT APPLY TO THIS FILE

**CLAUDE.md §5 makes PROMPTS versioned `skills` rows. The obvious generalisation — "the assemble
script should be a registry row too" — is REMOTE CODE EXECUTION.** A registry row is mutable by a
database write, and this string is executed as a shell script inside a VM that holds tenant media.
The script is a repo file mirrored to a bundler-safe constant (`assembleScript.ts`) with a
byte-identity drift test, and `llmRedaction.test.ts` scans `skills.ts` to prove no `assemble` seed
entry and no `render/`-sourced body ever appears. Do not "fix" the mirror into a registry row.

### The five inherited properties, and the failure each one encodes

| Property | The failure it prevents |
|---|---|
| **Fixed length**, asserted on the OUTPUT to ±0.5s against `--target-seconds` (wave 4; was `N × clip-seconds` to ±1s) | a video silently shortened to fit its audio |
| **No time-stretch, ever** — no `atempo`, no `setpts`, no speech trimming | an overrunning line rate-shifted into the window; audible, and no downstream test would catch it. An overrun is a HARD ERROR to be rewritten upstream |
| **A clip shorter than its window by >0.5s is a HARD ERROR** | a held still frame passed off as a scene |
| **Speech-centred, not file-centred** (lead/trail silence measured by `silencedetect` and ignored) | a padded TTS take shifting the words off their scene |
| **Narration over every NARRATED SPAN**, asserted on the mixed track before finalisation (wave 4; was "every window") | the "silent second half" failure of every hand-rolled assembly |

Also inherited: per-input voice loudnorm (a fresh TTS take lands near −31 dB while dialogue lifted
out of a generated clip lands near −21 dB — mixing both at 1.0 is the "narrator quiet, character
loud" complaint), two-pass **linear** loudnorm at −16 LUFS on the final, and full-decode validation.

### The master audio timeline (20.2 wave 4) — and what replaced the per-cell band

Audio used to be mixed **inside each scene**, and the finished scenes concatenated. That made the
scene the mixing unit, and everything else followed from it: a voice line had to fit
`[SEC − 1.4, SEC]` seconds, so narration was written for a 56-character cell rather than for a reel.

The shape now:

1. Each scene is built as a **silent** picture, exactly its own length. Nothing is muxed per scene.
2. The pictures are concatenated **once** (`-an`) into one silent track.
3. Each take is level-matched individually (`loudnorm=I=−19:TP=−1.5:LRA=11` — **unchanged**, it is
   what removes the "narrator quiet, character loud" spread) and each `video` scene's diegetic audio
   is lifted off the ORIGINAL clip to a wav.
4. Everything is placed on ONE timeline at its **absolute** offset via `adelay` and mixed in a
   **single `amix`** with `normalize=0` (the default would divide a reel down for having more lines
   in it). Input 1 is a full-length silence bed, so the mix always spans the reel.
5. Two-pass **linear** loudnorm at −16 LUFS on the result — **unchanged**.

**Placement:** speech is centred in its own scene, compensating for the take's own lead silence. A
take LONGER than its scene cannot be centred without starting before the scene does, so it
**anchors at that scene's start** and carries over the cut. `speech_abs_s` is recomputed FROM the
applied delay, never from the intent, so a clamp can't make the sidecar disagree with the mix.

**What replaced the band — two errors about the TIMELINE, not the cell.** Both are still HARD
ERRORS whose fix is to rewrite the line upstream; the "no time-stretch, ever" property is unchanged:

- a line whose speech runs **past the end of the reel** (it would be cut mid-word), and
- a line whose speech runs **into the start of the next line** (two narrators at once).

0.05s of slack on each absorbs `silencedetect`'s own resolution.

**Why the narration assert is not vacuous.** With optional narration, "narration in every window"
becomes trivially passable if it is *relaxed*; this repo has a named defect class for exactly that.
It was **re-expressed**, not relaxed: the span checked is the TAKE's own speech span on the master
timeline, keyed off the takes that actually existed. A scene with no take declares no span and is
never checked; a scene that HAS a take is always checked. So a deck cannot dilute the gate by adding
silent scenes, and a take that was measured, level-matched, delayed and then lost on the way into
the mix still fails. `smoke_assemble.sh` ends by re-rendering the same deck through a sabotaged copy
(one `sed`, muting the takes into the mix) and **requires that run to fail** — the sabotage lives in
the smoke and never in the shipped script, because a production assembler with a "skip the gate"
switch is the same hole.

**`--target-seconds`**, off the deck header: the scenes must sum to exactly it (refused before any
work, while the failure is still free) and the finished file must land within 0.5s of it. Omitted,
it defaults to the sum, which is what the uniform `--blocks` path passes.

> **Known seam, wave 4 → wave 5.** `assembly.ts` still refuses a sidecar whose `speech_dur_s`
> exceeds `clip_seconds` (the longest scene on a mixed deck). On the scene timeline a line is
> ALLOWED to be longer than that, so such a render is correct and would still be refused at
> publish. It goes away with `clip_seconds` itself in wave 5; until then the assembler emits a
> `WARN` naming the refusal, rather than letting a paid render be rejected with no explanation
> anywhere.

### The SCENE sidecar (20.2 wave 5) — and the v1 shape refused by name

`block_count` and `clip_seconds` are **gone**, not renamed-and-kept: a reel is scenes with their
own lengths, so "the clip length" was a fact about a contract that no longer exists.

```
block_count      -> scene_count
clip_seconds     -> (removed; per-scene duration_s)
                 +  target_duration_s
blocks[]         -> scenes[] { index, start_s, duration_s, visual,
                               lead_silence_s, speech_abs_s, speech_dur_s,
                               overrun, internal_pauses, freeze_head, freeze_tail }
```

**`parseAssemblySidecar` refuses the v1 shape OUTRIGHT**, with its own `legacy_sidecar` code, on the
mere presence of `block_count`, `clip_seconds` or `blocks`. Falling through to `missing_field` would
send an operator looking for a corrupted write; naming the old shape says the runner is stale. A
validator that accepts two shapes proves neither. **This was safe to ship because it was measured,
not assumed:** production held 257 `plans` rows on 2026-08-14, fully scanned, and zero carried a
`sidecarStorageId` — so there is no published reel to orphan and no re-render decision to make.

The validator now re-derives, from the bytes, the same guarantees the script enforces: the scenes
SUM to the declared target, `start_s` is genuinely the running sum, no line runs past the end of
the reel, and no line runs into the next one. A sidecar that did not come from the script has to
lie about all of them, not just about the `overrun` flag.

**The two sides are tied by a test.** The script writes the sidecar with a shell `printf` and
`assembly.ts` reads it with a TS parser, in different packages — nothing else connects them, and
each suite is self-consistent under a rename. `assembleScript.test.ts` pins the exact field names
the validator requires, and asserts the retired ones are absent from the script.

### Inputs, and the ONE that is not a job (20.2 wave 5)

`renderInputName` gained two kinds and `RENDER_INPUT_NAME` — the path-traversal allow-list the
runner checks before writing a byte — widened with them:

| Scene kind | File | Where the bytes come from |
|---|---|---|
| `video` (`generated_video`, `uploaded_video`) | `blockNN.mp4` | a `video` job, fetched by id |
| `image` (`animated_image`) | `blockNN.png` | an `image` job, fetched by id |
| `card` (`text_card`) | `cardNN.txt` | **the request body** |
| narration | `voiceNN.wav` | a `tts` job, fetched by id — and now OPTIONAL |

A still shares its clip's STEM on purpose: the assembler picks its branch from the scene kind it was
given, never from what it found in the directory, so `block02.png` and `block02.mp4` are one slot
rather than two.

> **A card's WORDS cross into the VM, and that is a deliberate exception to "no narration, no
> prompts".** A card is drawn, so there is no job, no asset and no storage id to hand over instead —
> the alternative was minting a storage object per card to carry forty characters. It is bounded on
> both sides: `isRenderableCardText` (non-empty, ≤512 chars, printable — newline is the one control
> character allowed) at the route AND at `batchToRender`, and `expansion=none` + `textfile=` in the
> script is what stops those words being evaluated as an ffmpeg expression. It is never logged,
> audited or echoed in a failure. **A second exception is a decision, not a patch.**
>
> `cardNN.txt` is refused in the `inputs` list for a related reason: an input name is FETCHED from
> the blob route, which resolves job ids, so the two lists must not overlap.

### `batchToRender` reads the DECK now, not just the jobs

On the block contract the jobs were a complete description of the reel — one clip per index, every
clip the same length. On a scene timeline they are not: a `text_card` has no job at all and a silent
scene has no take. So the shape comes off `plans.shots` and the jobs are checked against it, index
by index. Two unconditional demands became conditional:

- **the picture** is still required per scene, but WHICH one depends on the kind — and a card needs
  none;
- **a voice take** is required only where the deck declares a line. Demanding one at every index is
  what made a deck containing a silent card unrenderable, and it was NOT in the wave-5 plan row —
  wave 4 made narration optional at the assembler and left this side unchanged.

The route call carries `targetSeconds` + `scenes[]` + `cards[]` instead of `blockCount` +
`clipSeconds`, and the script is invoked as `--scene KIND:SECONDS … --target-seconds N`. The
scenes-sum-to-target check runs in three places (`batchToRender`, `parseBody`, the script) because
each is a cheaper failure than the one after it — the first costs nothing, the last costs a sandbox.

> **Wave-4 defect found and fixed here:** `reasonCodeFor`'s stderr patterns still matched the
> pre-wave-4 wording (`of speech; required`, `have NO narration in their windows`, `!= expected`).
> Wave 4 rewrote all three messages, so a line running past the reel came back as the catch-all
> `render_failed` instead of `speech_out_of_window`. The patterns now match the script's current
> wording, and `render.test.ts` drives them from strings copied out of it.

> **Still named `blockCount`:** `plans.renderSummary.blockCount` and the `media.rendered` audit
> payload key. Both are display/record fields owned by the canvas, which wave 6 touches — they are
> fed `report.sceneCount` and rename with the UI rather than ahead of it.

### The SCENE money gate, and the narrowing that finally rode with it (20.2 wave 5)

`reserveSceneJobInner` is `reserveJobInner`'s twin, not a widened signature — a plan carries one
contract or the other (the `visual`/`type` discriminator), so a function taking either would spend
its length asking which. They **share the part that moves money**: `reserveProviderLinesInner`
floors the batch total, checks and consumes both windows, and inserts only after every refusal has
passed. One transaction, not two to keep in step.

| Scene kind | Buys | Why |
|---|---|---|
| `generated_video` | one clip **at its own length** | the provider's duration grid still applies |
| `animated_image` | one **still** | ~a SIXTY-SEVENTH of a clip ($0.006 vs $0.40 at 4 s — "a tenth" until 33-06, "a fortieth" until 33.1-03 MEASURED it), frame-exact at any duration |
| `uploaded_video` | nothing | the tenant already owns the bytes |
| `text_card` | nothing | `drawtext` in the sandbox |
| any narrated scene | one voice take | silence is legal, so an empty line buys nothing |

**`unrenderable_block` is NARROWED to `hasAssetSource`.** The old check refused every *unpaid* row,
because unpaid meant no clip and the assembler hard-errors on a missing input. That equivalence is
gone: a card is drawn, a still is panned, an upload is fetched. What is still refused is a row that
does not name **what its picture is built from** — an `uploaded_video` with no vault doc, or a
`text_card` with no words. A card with nothing to draw is a black rectangle that passes every
downstream gate: the file decodes, the duration is right, the sidecar is well-formed, and only the
picture is missing.

**The narration ceiling is the TAKE's window, not the scene's.** `narrationCeilingSeconds` runs to
the next NARRATED scene, so a silent scene lends its duration to the line before it. There is no
floor any more — a short line is a pause, not a fault.

> **The estimate and the buy opened in the SAME commit, and must always.** `jobEstimate` mirrors
> every refusal above in the same order. A working Generate button behind a refusing estimate would
> spend money the canvas never showed, which is the exact inversion of this query's purpose ("name
> the lever BEFORE the button is pressed"). A test asserts `res.estCents === estimate.totalCents`.
> The estimate's paid line is labelled **`pictures`**, not `clips` — the paid visuals are a mix of
> generated clips and stills at ~a tenth the price, and one label saying "clips" would misdescribe
> what was bought. A per-kind breakdown is wave 7's price table.

**One gate deliberately still refuses, by name rather than by mispricing:**

- `cockpit.executePlan` → `scene_render_not_ready`. The AGENT's approve arm builds its own
  reservation from a block deck; opening it is the media-director certification (wave 8).

`regenerateBlock`'s scene arm OPENED in wave 6. It hands `reserveSceneJobInner` the whole deck and
an `only` index: every refusal a full buy would raise is raised (the deck must still sum to its
target, every scene must still name its source, every line must still fit its take's window), and
only the provider LINES are narrowed to the one scene. Captions are still priced over the whole
reel, because re-buying one scene re-renders and re-captions all of it. A scene with nothing to buy
— a silent card, a silent upload — refuses as `nothing_to_regenerate` rather than opening a
transaction for air.

### THE INPUTS COME OFF THE PLAN, AND THE BATCH IS ONLY THE TRIGGER (wave 6)

`regenerateBlock` buys ONE scene into a NEW batch — `media.test.ts` has pinned exactly that since
20-09 ("1 video + 1 tts + 1 stt; NOT the whole four-block deck"). Nothing pinned what happened
NEXT, and what happened next was that the render refused: `batchToRender` read its inputs off the
batch, so every index the regenerate did not re-buy had no job and the reel came back
`incomplete_blocks`. **The user paid for the clip and lost the published reel**, because
`reserveAndSchedule` clears the render in the same transaction as the reservation. This was live on
the BLOCK contract too, for any deck longer than one scene.

So the batch is now the TRIGGER (it is what just landed, and `maybeStartRender` still fires on its
last landing) and the INPUTS are the plan's newest SUCCEEDED job per `(index, kind)`. A re-bought
scene wins over the take it replaced; its untouched neighbours stay exactly as they were.

**`plans.shotsChangedAt` is what stops that becoming a silent wrongness.** A reorder moves a scene
out from under the index its clip was bought at, and a delete renumbers everything after it, so an
asset older than the deck it is being rendered into is refused by name: `stale_inputs`. The stamp
is written by STRUCTURAL writes only — `media.patchShots` detects them as "the incoming indices
are not already `0..n-1`", and `plans.persistDeck` stamps because a whole new deck is the largest
structural change there is. **A content edit deliberately does NOT stamp.** Editing a prompt or a
line leaves every index meaning what it meant, and invalidating the neighbours would make the
commonest flow in the canvas — rewrite one line, regenerate that scene — buy a take and then be
refused the render, which is the same leak with an extra step.

> ponytail: the residual is narrow and deliberate. Edit scene 2's line, then regenerate scene 3, and
> scene 2 still speaks its OLD take — the only take that exists. Refusing the render instead would
> refuse work the user can legitimately want, so the obligation lands on the SURFACE: the canvas
> owes that scene a per-tile "bought before your last edit" line (`byPlan` can see it by comparing
> the job's `promptHash` with the shot's current text). Until the canvas carries it, this is the one
> thing on this page a user cannot see from the app.

### THE VAULT BRIDGE — an `uploaded_video`'s bytes, and whose they are

An upload buys nothing, so it has **no `mediaJobs` row and no job id**. Its bytes sit on a
`vaultDocuments` row, and `batchToRender` resolves them into the scene's input slot.

> **`asset.docId` IS MODEL-AUTHORED TEXT.** It reaches `batchToRender` off `plans.shots`, which the
> specialist wrote — a caller-supplied id in every sense that matters. **The tenant check is on the
> row, in `batchToRender`, and it is the whole containment:** `normalizeId` fails closed for a
> malformed or foreign-table id, and a doc belonging to another tenant is refused before its id is
> ever handed to the runner. Without that line a deck could name any vault document in the
> deployment and have the render fetch it through the bearer-guarded blob route.

`resolveRenderAsset` gained a `vaultDocuments` branch **narrowed to `video/*`**. It deliberately has
no tenant check — it takes a raw id with no tenant to check against, exactly as the `mediaJobs`
branch does. The narrowing is what bounds it instead: the vault is where a tenant's briefs,
contracts and business documents live, and serving *any* vault document by id would be a far larger
capability than a render needs. Both halves are tested, including the cross-tenant refusal.

**Direct upload was NOT added.** `Scene.asset` is `{ source: "vault"; docId }` and there is no other
variant — the contract answered §7's open question 1 in wave 1. A direct upload would be a new
`source` member plus its own ingest, which is additive and a decision, not a patch.

### The sidecar field set AS HARVESTED

**`packages/core/src/assembly.ts` is the SOURCE OF TRUTH for these names from here on.** The
validator maps snake_case in → camelCase out in one place, so a field-name correction is a one-file
change.

Top level: `script` · `out` · `block_count` · `clip_seconds` · `target_duration_s` · `total_duration_s` ·
`actual_duration_s` · `width` · `height` · `fps` · `sfx_vol` · `gates[]` · `blocks[]` · `ts`
Per block: `block_index` (0-based) · `window_start_s` · `lead_silence_s` · `speech_abs_s` ·
`speech_dur_s` · `clip_dur_s` · `overrun` · `internal_pauses` · `freeze_head` · `freeze_tail`

The captions rebase is why the two anchors exist, and it is one line:
`absolute_t = speech_abs_s + (word_t_in_clean_take - lead_silence_s)`

### An invalid sidecar means the reel is NOT published

This is an invariant, not a preference. D8: *"a final video without one was hand-assembled."* An
invalid sidecar is not "render with a warning" — the job fails with a code and nothing is published
(plan 20-16 enforces it). A sidecar reporting `overrun: true` on any block is INVALID: it is
reporting a failed render, not a rendered failure.

### Deferred, and re-adding either is a scope decision

`--music` (ducked bed) and `--song` (music-video mode) are stripped, along with `--stepped`, the
poster frame, and the `--manifest`/`--allow-mismatch` pair plumbing that index discovery replaces.
`assembleScript.test.ts` scans for all three flags, so re-adding one is a visible decision rather
than a quiet drift.

## The renderer (20-15)

Where the reel is actually assembled: an ephemeral Vercel Sandbox microVM, started by a Next.js
route handler, running `assemble_final.sh` over the landed clips and voice takes.

**The architecture, in three sentences.** Convex cannot encode video (D9), so `renderReel` (a Convex
`internalAction`) POSTs to `apps/web/app/api/media/render` with a shared bearer; that route starts
an OIDC-authed sandbox, fetches the tenant bytes itself from a bearer-guarded Convex blob route,
runs ffmpeg, and validates everything that comes back; the finished `final.mp4` and its sidecar go
up through two Convex-minted single-use upload URLs, and only small JSON travels in the response.

### THE PROPERTY THIS DESIGN EXISTS FOR: no Vercel access token anywhere

The re-scope delta wanted the runner in Convex with a `VERCEL_TOKEN`. **D11 overrode that.** A Vercel
personal access token is scoped to a **team, not a capability**: it can deploy, delete projects and
read every project environment variable. That is strictly more powerful than anything else this
codebase holds, and it would falsify ADR-011's cleanest property — *"an API key in a deployment
secret is the whole auth story"* — which is true of `FAL_KEY` precisely because `FAL_KEY` can only
generate media.

Putting the runner where OIDC is automatic deletes three secrets, the crown-jewel-token liability,
the `convex.json` Node-22 pin, the `@vercel/sandbox`-under-Convex-bundler question and the
connectivity spike. It costs one HTTP hop.

`llmRedaction.test.ts` scans every Convex source plus the route, the bake script and
`packages/core/src/render.ts` for `VERCEL_TOKEN` / `VERCEL_TEAM_ID` / `VERCEL_PROJECT_ID` and
requires **zero occurrences in code** (comments may name them while explaining the absence). This is
a headline property, so it is an assertion rather than a paragraph.

### The plan tier and the duration ceiling — the number D11 moved

**Vercel plan tier: Pro. Route `maxDuration`: 300 s. Sandbox `timeout`: 240 s.** Settled at plan
20-15's blocking Task 1 checkpoint, 2026-08-02. Record both numbers here whenever the tier changes.

Under the delta's Convex-hosted runner the ceiling was Convex's 10-minute action limit. **Under D11
the binding ceiling is the Vercel function's max duration** — and on Hobby that defaults to 60 s,
which does *not* fit a 60–150 s render. Pro's 300 s gives ~2× headroom over the modelled render.

The sandbox timeout is **strictly below** the route's, with 60 s of teardown margin, so the VM is
stopped by our own `finally` rather than orphaned by the function being killed mid-cleanup.
`buildSandboxOptions` CLAMPS to `RENDER_SANDBOX_TIMEOUT_MS` rather than trusting its caller, and a
scan pins the route's `maxDuration` literal to `RENDER_MAX_DURATION_S` (Next.js reads route segment
config by static analysis, so the route cannot import the constant — the scan is the drift guard the
import would have been).

⚠ **On Hobby, exhausting the 5 free Active-CPU hours PAUSES sandbox creation for 30 days rather
than charging** (delta pitfall 18). The render stage silently stops working mid-month with no
invoice to notice. D10 permits 2 jobs/day ≈ 60/month against ≈150 renders/month of allotment — but
a retry storm or a test suite that accidentally creates real sandboxes eats that headroom fast,
which is why `MEDIA_SANDBOX_FIXTURE` is mandatory in tests.

### Two INVARIANTS, not implementation details

Both are cross-tenant leak vectors, both are closed by an infrastructure option, and a test has been
**observed to fail without each one**:

| Option | Why it is mandatory |
|---|---|
| `persistent: false` | **The SDK default is TRUE** (vendor README: *"Sandboxes are persistent by default"*). Left unset, the SDK snapshots the filesystem on stop and restores it on the next resume — so tenant A's clips, voice takes and `final.mp4` survive into the VM that renders tenant B's reel. A cross-tenant data leak created by an *unset option*, not by a bug. |
| `networkPolicy: "deny-all"` | The VM holds tenant media and must not be able to send it anywhere. This is why the route — never the sandbox — does every fetch, and why ffmpeg is baked into a snapshot instead of downloaded per invocation. |

`name` is **never** passed either: a named sandbox is resumable BY NAME, which is the whole
persistence mechanism. The test asserts `"name" in opts === false`, not `opts.name === undefined` —
an explicit `name: undefined` would pass the weaker check and still hand the SDK the key.

These are assertable at $0 **because `buildSandboxOptions` is a pure function rather than an inline
literal** inside `Sandbox.create({...})`. A literal could only be tested by booting a real VM. This
is the same move plan 20-05 makes with `buildSubmitBody`, and a scan pins the route to calling
`Sandbox.create(options)` and never `Sandbox.create({`.

### The snapshot, and the bake

ffmpeg is **not** present in a stock sandbox and is **not** in Amazon Linux 2023's `dnf` repos.
`deny-all` and a per-invocation download are mutually exclusive; the snapshot is that tension's
resolution.

```bash
cd apps/web && npx vercel link && npx vercel env pull   # writes VERCEL_OIDC_TOKEN into .env.local
pnpm --filter @pikar/web bake:sandbox
```

- **The exact asset:** BtbN `ffmpeg-master-latest-linux64-gpl.tar.xz` (~125 MB) — ffmpeg AND
  ffprobe, statically linked, **`libass` ENABLED**. Plan 20-17's caption burn needs `libass`, so an
  LGPL build is not a substitute, and the bake **fails** if `ffmpeg -buildconf` does not show it.
- `dejavu-sans-fonts` is baked now, so 20-17 adds nothing to the image and a cut of 20-17 costs
  nothing.
- **`snapshotExpiration: 0`.** Snapshots otherwise expire 30 days after last use, and a media rail
  that goes 31 days unused would wake up with a dead id and fail for everyone at once.
- **The `awk` question is settled by a command, not an assumption:** the bake runs
  `command -v awk ffmpeg ffprobe` and fails if any is missing. AL2023 is *expected* to ship `gawk`;
  expected is not verified. In-repo fallback if it ever fails: add `dnf install -y gawk`.
- **The script lives in `apps/web/scripts/`, not `packages/backend/scripts/`** (a recorded deviation
  from plan 20-15). `@vercel/sandbox` is a dependency of `apps/web` ALONE — that is what keeps the
  SDK out of the Convex bundle — and under pnpm's default isolated linker it is materialised at
  `apps/web/node_modules/@vercel/sandbox` and nowhere else, so the import cannot resolve from
  `packages/backend/`. `vercel link` also points at `apps/web`, which is where the OIDC token lands.
  The script belongs where its dependency and its credential already are.
- **Local auth is an OIDC token, not a PAT.** The SDK resolves credentials from `VERCEL_OIDC_TOKEN`
  (`@vercel/oidc`); `vercel env pull` writes it into `.env.local` and it is short-lived and
  project-scoped. If it expires, pull again. D11's no-access-token property holds for the bake too.

### What NEVER crosses into the VM

No `FAL_KEY`, no `OPENAI_API_KEY`, no Vercel credential, no `tenantId`, no fal URL, no signed
storage read-URL, no prompt and no narration. The runner passes `env` to neither `Sandbox.create`
nor `runCommand`, and the only bytes written in are the media itself and `assemble_final.sh`.

The request body Convex sends is the complete list: `{ renderId, blockCount, clipSeconds, inputs:
[{name, jobId}], uploadUrls }`. **The job ids are opaque refs — the runner is handed no URL to fetch
at all** and builds every blob URL itself from `convexSiteOrigin(NEXT_PUBLIC_CONVEX_URL)`. That is
the read-direction SSRF guard; the write direction is guarded by requiring both `uploadUrls` to sit
on the derived deployment origin. A scan asserts the body literal carries none of the banned names.

Filenames are validated against `RENDER_INPUT_NAME` before a byte is written: a name from a request
body reaching `writeFiles` unchecked is a path traversal into the VM — including over
`assemble_final.sh` itself, which would make the endpoint arbitrary code execution.

### What comes BACK is not trusted either

`validateRenderReturn` (pure, `packages/core/src/render.ts`) runs before anything is published:

| Condition | Code |
|---|---|
| `readFileToBuffer` returned `null` | `missing_output` |
| zero bytes | `empty_output` |
| bytes 4..8 are not `ftyp` | `not_an_mp4` |
| outside 200 KB – 200 MB | `implausible_size` |
| sidecar absent | `invalid_sidecar` (detail `missing`) |
| sidecar fails `parseAssemblySidecar` | `invalid_sidecar` (detail = the validator's own code) |
| **valid JSON reporting `overrun: true`** | **`invalid_sidecar` — D8's HARD ERROR arriving from the renderer, and NOTHING is published** |

**The MIME type is OURS**: the stored blob's type is the literal `"video/mp4"` we assert, never a
value read from the VM.

**And Convex re-validates the sidecar a second time**, with the same `parseAssemblySidecar`, from
the bytes that actually landed in our storage. That is defence in depth, not duplication: it costs
one function call and a ~2 KB read, and it means a compromised or buggy route cannot publish an
ungoverned reel. `gatesPassed` in the audit comes from *that* re-validation, never from what the
route claimed.

### ffmpeg's stderr never reaches a row, a log or a dead letter

`reasonCodeFor(exitCode, stderr)` maps to a CLOSED union and **returns a code only** — the input
cannot appear in the output by construction. ffmpeg's stderr carries file paths and, on a caption
burn, narration text; it is CLAUDE.md §4 content. A scan asserts `.stderr()` is read **exactly
once** in `render.ts` and on the same line it becomes a code, and never at all in the route or in
`renderReel.ts`. The bake script is the one exemption, recorded at the scan: it runs by hand against
a sandbox with zero tenant bytes in it.

### The blob route, and where the tenant boundary actually is

`GET /media/blob/{jobId}` on `http.ts`, bearer-guarded by `MEDIA_RENDER_SECRET` with the same
fail-closed shape as `/skillopt/export`. It takes ONE opaque job id and nothing else — no tenant, no
path, no storage id (`http.ts:123-129`'s rule) — resolves it with `normalizeId`, and refuses a row
that is not `succeeded`.

**The tenant boundary is NOT on this route.** It is upstream, in `renderReel.batchToRender`, which
reads job ids through the tenant-prefixed `by_batch` index. Saying the route "checks the tenant"
would be a phrase with no mechanism: it is handed an id it did not choose, and the only honest
guarantee it makes is that it invents nothing.

**No HMAC path segment, unlike `/fal/callback/*`**, and the difference is the caller: fal is a third
party holding no secret of ours, so the segment is the only thing that can authenticate it. Here the
caller already proves knowledge of `MEDIA_RENDER_SECRET` in the header, and an HMAC keyed on that
same secret is derivable by anyone who has it. It would be ceremony, not defence.

### A reel is ALL-OR-NOTHING

`batchToRender` refuses `not_all_succeeded` (a line without bytes), `incomplete_blocks` (an index
missing its clip or its voice take) and `empty_batch` — all **before** a sandbox exists, so the
failure is free rather than a $0.02 VM that hard-errors on a missing input. The assembler asserts
`--blocks N` before any work for the same reason: a dropped block must FAIL, not ship a hole.

⚠ **A deck containing a TEXT or SCREEN REC block cannot currently render.** `reserveJobInner`
creates a video line only `if (isPaidBlock(block))`, so those indices have a voice take and no clip,
and `assemble_final.sh` requires both. It is refused as `incomplete_blocks` rather than discovered
inside the VM. Making those blocks renderable (a generated title card, say) is a **scope decision
for the canvas**, not a patch in the render path.

### The `MEDIA_SANDBOX_FIXTURE` seam — and the rule that it is the DEFAULT in tests

`renderReel` short-circuits on `MEDIA_SANDBOX_FIXTURE` (the `FAL_FIXTURE` / `llm.ts:922` precedent)
and never issues a fetch. It sits **after** the two `requireEnvMedia` reads on purpose, so "no
secret" is the same refusal in fixture mode as in production.

**No test suite may reach `Sandbox.create`.** On Hobby an accidental real create burns a shared
monthly allotment whose exhaustion is a 30-day outage. The route body is asserted in
`packages/core/src/render.test.ts` with the SDK *injected* — which is also the only way "a bad
bearer creates NO sandbox" is assertable at all, since `apps/web` has no unit-test runner.

### The two secrets

```bash
# from packages/backend
npx convex env set MEDIA_RENDER_SECRET <fresh random>
npx convex env set MEDIA_RENDER_URL https://www.pikar-ai.com/api/media/render
# DURABLE CUSTOM DOMAIN ONLY — a generated *.vercel.app deployment URL sits behind Vercel
# Deployment Protection (401 before the route runs) and goes stale on every deploy. In prod the
# release pipeline pins this to $PRODUCTION_URL/api/media/render with read-back; set it by hand
# only on dev. Beware the Windows quoting quirk: a trailing \r in either value breaks the fetch.
# and on Vercel (Project -> Settings -> Environment Variables)
MEDIA_RENDER_SECRET=<the same value>
MEDIA_SANDBOX_SNAPSHOT_ID=<from the bake script>
```

`MEDIA_RENDER_SECRET` is the shared bearer in **both** directions (Convex→route and route→Convex)
and is set on BOTH sides. The route additionally reads `NEXT_PUBLIC_CONVEX_URL`, which apps/web
already has — no third secret. Both Convex-side values are **deployment** env vars
(`npx convex env set`), never `.env.local`.


## The canvas plane (20-09)

Five tenant-guarded reads and six tenant-guarded writes, in `media.ts`. **Reads return `[]`/null for
a foreign tenant; writes THROW** (`cockpit.ts:531`'s rule). One `ownedPlan` guard behind all of them,
so a new canvas function cannot ship without it.

| Read | What it is for |
|---|---|
| `byPlan` | one entry per BLOCK, carrying **two independent states** — `clip` and `voice`. They arrive minutes apart through two different webhooks, and a merged status cannot express "voice landed, clip did not". Carries `narrationChars` / `maxChars` / `overCharLimit`. **No URL.** |
| `assetUrls` | the per-asset signed URLs. **The only bearer-minting surface** — a query that mints a capability should be the smallest one possible, which is why this is not merged into `byPlan`. A line with no asset yields a NULL url, not an omitted row. |
| `reel` | the finished mp4 + the sidecar's gate summary. |
| `jobEstimate` | the ITEMISED estimate. |

### D7's rule is a BACKEND requirement before it is a UI one

*"The editor must not offer a control that can spend money without showing the estimate first."*
`jobEstimate` returns **four labelled lines** — clips, voice, captions, `render (incl. one retry)`
— plus `totalCents`, `capCents` and `remainingCents`, so the UI can print *"6 clips $3.00 · voice
$0.02 · captions $0.01 · render (incl. one retry) $0.04 = $3.07"*. A single total is not enough:
**the user must be able to see WHICH line is the expensive one before deciding to cut a block.**

It builds the SAME spec list `reserveJobInner` builds, from the same price table, including the 2×
voice multiplier and the flat render constant. **`media.test.ts` asserts `jobEstimate.totalCents ===
reserveJobInner`'s `estCents` for the same deck** — a UI that computes its own total and a rail that
computes another is the drift this phase exists to prevent. It also returns the pre-flight `refusal`
(with block index and character count) so the canvas can name the lever *before* the button is
pressed.

`jobEstimate` **consumes nothing.** It is a query and cannot.

### The url guarantee, and where it actually lives

`reel` returns a non-null `url` ONLY when `renderStatus === "rendered"` AND both storage ids AND
`renderSummary` are present. `recordRender` writes all four in ONE patch, and only after
`parseAssemblySidecar` accepted the bytes — **so the check is at the WRITE**, which is the only place
it can be: `ctx.storage` in a query is a `StorageReader` with `getUrl` and no way to read a blob.
A row hand-patched to `rendered` therefore surfaces no reel.

`renderSummary` (`{ durationS, blockCount, gates }`) exists for that reason and one more: it means
the sidecar is parsed once per RENDER instead of once per canvas subscription tick.

### The free editor: six affordances, floor AND ceiling

`editBlockPrompt` · `editBlockNarration` · `regenerateBlock` · `reorderBlocks` · `deleteBlock` ·
`setSceneAsset` (20.2 wave 6). **Nothing else.** No transitions, filters, layers, masking, music,
or client-side rendering. If a reviewer asks for one, it is a deferred idea and not a small
addition.

`setSceneAsset` is the sixth, and it is the same argument `editBlockNarration` won: an
`uploaded_video` scene with no document named is refused by `hasAssetSource`, and **nothing else in
the product can name one**. It is an editor control, not a second ingest surface — the file arrives
through the vault's existing upload path and this only points at it, which is what §7's open
question 1 was answered with. It re-checks everything the render will demand (the doc exists, is
this tenant's, has bytes, is `video/*`) because an upload BUYS NOTHING: no money gate would refuse
a PDF, so without this check the deck clears payment and dies in the sandbox.

**On "no timeline".** D7 banned a timeline EDITOR — drag handles, trims, ripple. The read-only
ribbon wave 6 draws is a picture of lengths the deck already declares, and it exists because the
scene contract made those lengths differ: under D8 every window was the same size, so there was
nothing to see. Nothing on it is draggable.

`editBlockNarration` is **the UI half of the pre-payment guard, not scope creep**: without it,
`narration_too_long` from the rail is a dead end — a user told *"block 4's line is 186 characters"*
with no way to shorten it is stuck. It refuses with the same reason and the same count the rail
would return.

### EVERY structural edit clears the render, through ONE helper

`clearRender` unsets `renderStatus` → `pending`, `renderStorageId`, `sidecarStorageId`,
`sidecarHash`, `renderReason`, `renderedAt` and `renderSummary`. **Six callers, one helper**, and
that is the point: six copies of the unset is exactly how one of them ends up missing a field. It
already happened — `renderSummary` was added to the schema and to `recordRender` but not to
`clearRender`, and the regenerate test caught it.

A canvas showing a stale `final.mp4` beside a freshly regenerated block is lying to the user, and it
is a lie they would only discover by watching the whole reel.

### The reorder ceiling, stated

`mediaJobs.blockIndex` is a SNAPSHOT taken at reserve time, and `byPlan` renders a job under the
block it was reserved for. A reorder after submit therefore leaves in-flight jobs pointing at their
original index. That is deliberate — the alternative is re-pointing a landed asset at a different
block's tile, which is worse. Upgrade path if it ever confuses anyone: a stable per-block id instead
of an array index, which is a schema change and not a UI one.

`reorderBlocks` refuses anything that is not a PERMUTATION of the existing indices: a dropped or
duplicated block becomes a deck with a hole, which hard-errors at the assembler.

### BETA-05 isolation, shipped WITH the surface

`media.test.ts` § *BETA-05 ISOLATION*: tenant B gets `[]`/null from every read (including no signed
URL) and a thrown `plan not found` from all six writes, with zero rows and zero budget movement.
An unauthenticated caller gets `UNAUTHENTICATED`. **Mutation-checked**: dropping
`plan.tenantId !== ctx.tenantId` from `ownedPlan` turns it red.

## The render trigger and D12(b) retention (20-16)

### There is NO chain, and that is a decision, not an omission

Delta §6.7 N4 described *"reserve → submit → wait-for-all-landed → render"*, and 20-07 left a
hand-off to re-point `EXTERNAL_TARGETS.media` at a chain entry action. **20-16 evaluated that and
declined it**, and `cockpit.ts` now says so at the site instead of carrying a promise nobody kept.

`mediaComplete.landResult` already runs on every arrival, already holds the batch id, and already
runs inside a serializable mutation. So "wait for all" is `maybeStartRender` — one indexed read of
the batch — and **the `pending → rendering` transition IS the once-only guard**: two concurrent
last-landings cannot both observe `pending`, so they cannot both schedule. A double render is a
double sandbox.

- An earlier landing schedules nothing.
- A re-delivered webhook for a terminal row schedules nothing.
- **A failed or blocked sibling means `renderStatus: "failed"`, `renderReason: "incomplete_batch"`,
  and NO render.** D8's fixed-window contract makes a missing clip a hard error, so that render is
  already known to fail — and finding that out in the sandbox costs a sandbox.
- **A pending `stt` line does NOT hold the reel hostage.** Captions are a POST-assembly step (D8),
  submitted after `final.mp4` exists. The trigger fires on the video+tts set alone.

`ponytail:` an O(batch) read on every landing — 13 rows, indexed. The ceiling is a reel with hundreds
of blocks, which D10's cap refuses long before it matters; the upgrade path is a landed-count on the
plan row.

### Retention: delete on SUCCESS, KEEP on FAILURE

The arithmetic that forces it: ~55 MB/job × 2 jobs/day = **~3.3 GB/month against a Convex
Free/Starter allowance of 1 GB TOTAL**.

On a successful render, every `video`/`image`/`tts` row in the batch has its blob deleted and its
`assetStorageId` unset. **`final.mp4` and the sidecar are KEPT** — deleting them would delete the
deliverable. On a FAILED render **everything is kept**: the intermediates are the only debugging
evidence a failed render leaves, and failures are rare.

**ORDER MATTERS, and the code says why:** the plan row is patched FIRST, so the reel is published and
readable, and only then are the intermediates deleted. A crash between the two leaves orphaned blobs
— 35 MB of waste. A crash in the other order leaves a published reel whose tiles point at deleted
blobs — a broken canvas. **Fail toward waste, not toward a lie.**

The loop dedupes storage ids before deleting: `storage.delete` THROWS on an id that is already gone,
so a blob referenced by two rows would abort the loop AFTER the reel was published and leave the rest
of the batch undeleted forever.

**`llmRedaction.test.ts` pins `storage.delete` to EXACTLY ONE site in the media subsystem**
(`render/renderReel.ts`) and asserts the failure arm does not contain it. A second deletion site is
how a delete-on-failure bug gets introduced later, and the failure half is the one that is easy to
get backwards and impossible to notice.

`ponytail:` no TTL, no cron, no sweep job. Upgrade path if failed-render debris ever accumulates: a
scheduled sweep of `mediaJobs` older than N days — which is a cron, and this deliberately is not one.

### A failed render dead-letters — after at most ONE automatic retry (33-04)

> **Superseded 2026-08-16 (Phase 33, plan 33-04) — narrowly.** 20-16's rule was *"a failed render
> does NOT retry: at 480p a structural failure repeats, and the action-retrier would buy N
> sandboxes to learn the same thing N times."* That reasoning STANDS for every structural failure,
> and the action-retrier is still never used here. What 33-04 grants is exactly ONE automatic
> retry, only for codes in the CLOSED transient set `TRANSIENT_RENDER_CODES`
> (`@pikar/core/render`): `missing_binary`, `route_unreachable`, `input_fetch_failed`,
> `upload_failed`, `submit_failed`, `render_failed` — plausibly-environmental codes plus the
> catch-all, which is not provably structural. Deterministic codes (`duration_mismatch`,
> `clip_too_short`, `speech_out_of_window`, `missing_narration`, `bad_invocation`, `input_missing`,
> `decode_failed`, `no_audio_stream`, `caption_track_empty`, `sandbox_timeout`, and every
> route/runner decision) never retry. Adding a member is a money decision — see the doubled render
> line in §4.1.

The guard is STRUCTURAL, not counted: `recordRender`'s failure arm checks AND sets
`plans.renderRetriedAt` in the same serializable mutation (the `pending → rendering` CAS idiom),
leaves `renderStatus: "rendering"` standing, reschedules `renderReel` with the SAME batchId, and
writes one refs-only `media.render_retried` audit row. The retried attempt writes NO dead letter —
the SECOND failure takes the 20-16 path byte-for-byte: ONE `deadLetters` row, payload
`{ batchId, planId, reasonCode }` and nothing else — no ffmpeg output, no filename, no narration,
no URL. `media.test.ts` observes the cap on the MUTATION: a version that retries twice goes red.

From `failed`, the canvas may offer a manual **Retry render** (`media.retryRender`): FAILED-only,
derives the latest batchId from the plan's own `mediaJobs` rows (refuses `nothing_to_render` when
there are none), CASes failed → rendering, schedules `renderReel`, and audits
`media.render_retry_manual` refs-only. It deliberately does NOT clear `renderRetriedAt` — the
automatic retry stays once-per-plan even across manual attempts. Free to the user: compute is
covered by the doubled render line; a rare THIRD sandbox (manual retry after the auto retry) is
accepted, documented drift, never silent.

### The fix-menu re-arm: which fixes resume a held reel, and how (33-04)

A failed paid scene HOLDS the reel (`renderStatus: "failed"`, `renderReason: "incomplete_batch"` —
the trigger refuses to buy a sandbox for a reel with a known hole). The hold ends per fix arm:

| Fix arm | What re-arms the render |
|---|---|
| `regenerateBlock` (paid) | Nothing extra — the re-bought scene LANDS, and the landing re-fires `maybeStartRender` naturally. |
| `setSceneVisual` (free kind switch) | The mutation itself: `patchShots` clears the render to `pending`, then `rearmAfterFix` calls `evaluateRenderTrigger` with the plan's latest batchId in the SAME mutation. |
| `setSceneAsset` (free vault pick) | Same as `setSceneVisual` — the pick is what makes an `uploaded_video` scene renderable, so it re-arms too. |

Three rules keep this honest:

- **The fixes are CONTENT-class.** They map the deck in place, so `patchShots` does not stamp
  `shotsChangedAt` — landed sibling assets stay fresh and `batchToRender` reuses them. A stamp
  here would refuse `stale_inputs` and waste every sibling's paid work, violating the locked
  "landed sibling work waits — nothing is wasted" decision.
- **`deckStillNeedsJob` (`@pikar/core/render`) is the ONE predicate** both `evaluateRenderTrigger`
  and `batchToRender` use to judge a terminal job row: a failed clip whose scene no longer wants a
  clip (card, upload) is history, not a hold. Two predicates here would let the trigger schedule a
  render the builder refuses, stranding the plan at `rendering`.
- **A half-finished fix stays held, in words.** Switching to `uploaded_video` with no asset picked
  yet re-evaluates to `incomplete_batch` again (the trigger's `hasAssetSource` check), so the
  failure card and its fix menu stay up until `setSceneAsset` names the footage — never a
  scheduled render that is known to refuse.


## The canvas, SEEN (20-10) — and the tab that opens it

The backend read plane shipped at 20-09 and had **no consumer for four plans**. 20-10 is the
consumer: `apps/web/app/(app)/dashboard/workspace/MediaCanvas.tsx`, mounted through the same
one-line `plan.kind` switch in `cards.tsx` that the memo and calendar cards mount through.

**Not a new route, not a NAV entry, not a parallel rendering system.** The workspace's "Open canvas"
tab gives the same component the whole right pane instead of a card slot — a viewport, not a second
implementation. Two renderings of a reel that could drift apart is exactly what that objective rules
out.

### It self-queries, and it never polls

Four subscriptions taken by the component itself (the `SourceCard` idiom), not threaded through
props: `byPlan`, `assetUrls`, `reel`, `jobEstimate`.

**There is no ticker anywhere in this surface and there must never be one.** A 10 s clip is 1–3
MINUTES of wall clock and the render adds 1–3 more, so the canvas has to stay meaningful through
several minutes of nothing arriving — but the mechanism is Convex reactivity, which delivers the
webhook's mutation and the render terminal's patch to an open canvas for free. If a `setInterval`
looks necessary, the bug is elsewhere.

### The reel region has FIVE states, and one of them is a trap

> **Superseded 2026-08-16 (33-06) — the states are unchanged, their HOME is not.** The region is now
> the HERO SLOT and the branch is `heroState` in `mediaCanvasView.ts`. Both traps below survive
> verbatim; what changed is that a landed reel PLAYS in the same slot the tracker occupied, and that
> a url can now arrive with any `renderStatus` (33-05 holds the artifact triple). See
> "The reel-first canvas (33-06)".

| State | What it says |
|---|---|
| no `renderStatus` | "No reel has been requested for this plan yet." |
| `pending`, nothing landed | "Not assembled yet. The reel is built after every block's clip and voice have landed." |
| `pending`, **assets landed** | **"The reel is out of date — the blocks have changed since it was assembled."** |
| `rendering` | "Assembling the reel… (usually 1–3 minutes)" |
| `rendered` + url | the `<video>`, plus `N blocks · N seconds · every block's narration fits its window` |
| `rendered`, **no url** | "The render finished but did not produce a valid assembly record, so it was not published." |
| `failed` | the reasonCode **in words** (`failureText`), never a bare code |

**The out-of-date state is the trap.** `regenerateBlock` and every structural edit clear the render
fields (20-09), so a stale reel and a never-built one are BOTH `renderStatus: "pending"` and are
indistinguishable from that field alone. The landed-asset count is what separates them, and saying
"not assembled yet" over a deck the user already paid to render would be a lie they can watch.

**`rendered` with no url is not a bug.** `media.reel` returns a url only when the sidecar validated
(D8: *"a final video without an assembly.json was hand-assembled"*), so that combination is a
governed refusal to publish and gets its own sentence.

### Two status rows per block, never one

A block is a PIPELINE of two jobs from two providers whose webhooks land minutes apart. A block
whose voice is ready and whose clip is not MUST look different from the reverse, and a single merged
status cannot express that. Both rows use `.trace-line` and sit inside an `aria-live="polite"`
region — a silent progress surface reproduces the "is it stuck?" complaint for non-sighted users
through exactly the minutes where it matters most (BRAND §6).

The wording differs per pipeline on purpose: "Generating…" is wrong for audio and "Recording the
narration…" is wrong for video.

### The verdict copy is a COMPLIANCE statement, not a style choice

| Verdict | Copy |
|---|---|
| `checker_clear` | "Provider safety check: passed" |
| `checker_flagged` | "Provider safety check: flagged" |
| `provider_blocked` | "Refused by the provider's content check" |
| `none_reported` | **"Not checked — this model reports no safety verdict"** |

**Never a green tick for `none_reported`.** Every Wan 2.5 video and every voice take lands there,
and rendering it as a pass makes a claim fal never made. Never colour alone, for any of the four.

### The estimate gate: four lines, not one total

> **Superseded 2026-08-16 (33-06).** The four lines are still printed and still itemised — they just
> live inside a native `<details>` under a `$X.XX` headline now. The binding rule and the genuinely
> disabled button are unchanged. See "The reel-first canvas (33-06)".

D7's binding rule is *"the editor must not offer a control that can spend money without showing the
estimate first."* The button is `disabled` until `jobEstimate` resolves — genuinely disabled, not
merely styled that way, because a disabled *look* on a live button is a click that spends money the
user was told it could not.

**One number is not enough.** The panel prints every itemised line (clips, voice, captions, render)
plus the total, the model and resolution they were priced at, and today's remaining media budget —
so the user can see WHICH line is expensive before deciding to cut a block.

Every refusal NAMES THE LEVER rather than reporting a code: `over_job_cap` says remove blocks or
drop to 480p; `narration_too_long` names the block, its character count and the limit — **and the
Edit-narration control is on that same tile**, because a refusal whose cure is three clicks away is
a dead end.

## The guided-intake chips and the two-deck switcher (33-07)

Two surfaces, ONE brief. The chat captured it (33-01's parse, 33-02's `plans.brief` plane); the
canvas is where it can be read back and corrected. The chips render **above the hero**, because
everything below them is an answer to them - a mis-parsed ask is worth catching before a person
spends attention judging the storyboard it produced, and long before a cent moves.

Render order in `ReelCanvas` is now: `BriefRow` -> `VariationCompare` -> `ReelHero` -> `GenerateBar`
-> `TimelineRibbon` -> art direction -> scene tiles. The ask, then the two candidate answers, then
the chosen one.

### The chip contract

| Chip | Required | Control | Note |
|---|---|---|---|
| Topic | **yes** | free text | the one thing the reel cannot be proposed without |
| Length | **yes** | preset, `TARGET_DURATIONS` only | 60 s carries its cost note |
| Audience | no | free text | empty is a legal resting state |
| Tone | no | free text | empty is a legal resting state |
| Brand voice | no | free text | empty is a legal resting state |

**Only two chips may block, and that is a Phase-11 obligation rather than a preference.** Phase 11
deliberately admits idea-stage tenants whose profile carries nothing but a one-line description; a
chip row that demanded an audience would re-gate exactly the users that phase let in. The three
optional chips render empty with `BRIEF_OPTIONAL_HINT` and never stop anything.

**A defaulted field is not the user's word and must say so.** `brief.defaulted` names the fields the
model filled in; those chips carry `BRIEF_DEFAULTED_MARKER` ("from your profile") as TEXT - a word,
not a colour (BRAND section 6). Editing such a chip is what clears the mark: `editBrief` drops every
field named in the patch from `defaulted`, whatever value the user typed. Rendering a model-authored
value identically to a stated one is the provenance-laundering shape this repo already has a defect
class for.

**Length is a preset, and free entry is structurally impossible.** The options are built FROM
`TARGET_DURATIONS` - the same closed set `media.editBrief` validates against - so the control cannot
produce the `illegal_duration` refusal at all. `briefRefusalText("illegal_duration")` still exists as
the fail-closed backstop; it should never be seen. The control is a native `<fieldset>` of
`aria-pressed` buttons (biome refuses a `role="group"` div where the platform has an element), and
the pressed option is a `--teal-600` FILL with white text, never small teal text.

**The 60 s cost note has ONE carrier.** It sits on the OPTION while 60 is not the current ask (read
before it is chosen) and moves to the CHIP once it is (read without opening the control). The
component renders both slots unconditionally, so a sentence living in both at once would print
twice; `briefChips` is where that is prevented, and a test pins it. The note's multiple is of the
FOOTAGE (60/15), which is arithmetic on the presets themselves - not a price claim - and it names the
same stills-and-cards lever `KIND_COST_NOTE` and the clips line name.

### Nothing on this surface auto-fires

A chip edit calls `editBrief` and **stops**. It never triggers a proposal, because a proposal is a
model turn and a model turn is money - D7's rule is that a spend follows a click, and there is no
exception for a cheap one.

What a divergence produces instead is the **stale badge**: `deckStale(briefChangedAt,
deckProposedAt)` is true iff BOTH stamps exist and the brief moved last. Either stamp absent reads
false, and both absences are real states - an unedited brief, and a brief with no deck proposed yet.
Equal stamps are the propose-then-stamp case, not an edit.

Beside the badge is **"Re-propose (free)"**, and it is the whole affordance. It sends ONE canned
message (`REPROPOSE_MESSAGE`) through **`useSendCockpitMessage`** with THIS thread's id.

> **A second UI->dispatch entry point is the named anti-pattern here.** It would be a second door
> into the agent loop with its own guardrail, spend, audit and clock behaviour to keep in step with
> the first. `useSendCockpitMessage` exists precisely because a caller once forgot the trusted clock
> and made every dated tool unreachable from the product while the eval gate certified them green
> (phase 19-12); six surfaces now go through that one hook and a new caller cannot be born
> clockless. The canned text lands in the transcript like any typed message, which is also why it
> reads like one a person could have written.

`threadId` is required, not optional-with-a-fallback: sending without one MINTS A NEW THREAD, which
would move the conversation out from under the canvas the user is looking at. No thread, no button.

### The two decks, side by side

`variationView(plan)` -> `{ hasAlternate, locked, canSwitch, picked, alternate }`. The picked deck is
summarised here and drawn in full by the strip below; the alternate has only its card, because a
second full storyboard would double the page for a deck the user is still deciding whether to read.

**Both halves fold through ONE `deckSummary`** - opening concept, scene count, `KIND_LABEL` kind mix,
and the SUMMED scene durations. Two folds is how a compare region ends up counting scenes on one
side and shots on the other, or totalling real lengths against a declared target. The duration is
deliberately the sum rather than `targetDurationSeconds`: a deck that does not add up to its declared
length is exactly what someone comparing two proposals needs to see.

Switching calls `media.switchDeck` and needs no estimate wiring - it swaps `plans.shots`, and
`jobEstimate` prices whatever is in `shots`, so the `$X.XX` headline follows on its own
subscription. Its two refusals reuse the rail's own sentences (`no_alternate`, `deck_locked`, added
to `refusalText` at 33-06): one vocabulary for a refusal, wherever it is read.

### After Generate, the switcher is ABSENT - not disabled

`generateReel` clears `altShots` in the same patch that stamps `deckLockedAt`. `variationView`
returns a null alternate for ANY locked plan regardless, and `briefChips` marks every chip
`editable: false` off the same flag, so the chips and the switcher die at the same instant the deck
is bought. **A greyed switch would be a control that can only ever answer `deck_locked`** - the
canvas already knows that answer, so it does not offer the click. The locked row says so once, in
`BRIEF_LOCKED_NOTE`.

**No cross-deck scene mixing.** Deferred by decision: the per-scene editor already covers it by
hand, and a merge UI would be a second deck model to keep consistent with the money path - which is
the exact `decks[]`-with-a-`pickedIndex` shape 33-02 refused on the schema.

## The reel-first canvas (33-06) — one layout, the whole lifecycle

The canvas is now **HERO then STRIP**, in that order, and the hero slot exists from the moment a
deck is picked. Before the reel exists it holds the pipeline tracker; afterwards it holds the reel;
during a regenerate it holds BOTH. Nothing below it moves when a render lands, which is the whole
point — the old layout swapped a paragraph for a `<video>` and shoved the storyboard down the page
at the least convenient moment.

Render order in `ReelCanvas`: `ReelHero` → `GenerateBar` → `TimelineRibbon` → art direction →
scene tiles. Every tile affordance is untouched: they moved, they did not change.

### Every sentence and every state is a CALLED function, not read source

`MediaCanvas.tsx` gained no derivation. `mediaCanvasView.ts` gained `trackerView`, `heroState`,
`estimateView`, `pricedAsLine` and `usd`; the component gained JSX and event wiring. This is the
module's founding rule (`apps/web`'s runner is `.ts`-only and DOM-less, so anything left in the
`.tsx` can only be asserted as source text — the repo's named `green-tests-over-broken-capability`
defect class). 59 tests in `mediaCanvas.test.ts`, all by calling.

### The tracker: four stages, folded from reads that were already reactive

`trackerView(scenes, renderStatus, captionStatus, renderRetriedAt)` → `generate → voice → assemble
→ captions`, each `{ label, state, detail }`, plus one landing row per scene.

- **`skipped` is a first-class state, not a rounding of `pending`.** A deck of cards and uploads
  buys no picture; a silent deck records no take and is never transcribed. A stage that says
  "waiting" about a job that will never be requested is the same defect as a spinner that never
  resolves — the exact bug `pictureLine` was written to kill at the tile level.
- **The two job faces stay independent** all the way up: the picture column and the voice column
  roll up separately, because two providers' webhooks land minutes apart.
- **Failure wins a roll-up.** One refused scene makes the stage `failed`, not "still working" —
  that is what sends the user to the fix menu instead of to a wait with no end.
- **`renderRetriedAt` is an honesty requirement.** 33-04's one automatic retry leaves
  `renderStatus: "rendering"` standing, so without reading the stamp the second sandbox is
  indistinguishable from the first taking a long time. The detail line says "the first attempt
  failed".
- **A caption failure never unpublishes the reel** (20-17) — the captions stage says `failed` and
  says the reel is published without them.
- **Still NO POLLING.** Every input is an existing `tenantQuery` subscription. There is no clock in
  the view module for the same reason there is none in the component.

### The hero: five modes, and the two traps both survive

| Mode | When | What the user sees |
|---|---|---|
| `video` | a url exists (ANY `renderStatus` — 33-05 holds the triple) | the final, muted-autoplay looping; `regenerating` puts the tracker under it |
| `tracker` | no url, `pending`/`rendering`/nothing | the four stages; `out_of_date` when assets have landed |
| `held` | `failed` + `incomplete_batch` / `not_all_succeeded` / `incomplete_blocks` | "the reel is held" — the cure is a per-scene fix (33-04), never a retry |
| `failed` | any other `failed` reason | `failureText` in words |
| `failed` | `rendered` with NO url | the governed refusal to publish (D8) |

**A url with a non-`rendered` status is the PREVIOUS reel, and it says so.** `clearRender` holds the
validated triple through a regenerate, so "there is a url" no longer means "this is current". The
note names which and why; letting the old final pass as the new one would be a lie the user can
watch play.

**The player is four native attributes.** `<video autoPlay muted loop playsInline controls>` is
exactly the locked "muted autoplay loop, tap for sound" decision — `controls` IS the tap, keyboard
operable, and `muted` is also what takes the element out of biome's `useMediaCaption` scope (the old
`biome-ignore` there is now inert). No player library, no component library (BRAND §8.3).

### The cost control: ONE headline, and it is never re-added

`estimateView(est, { noun, maxChars })` REFORMATS `jobEstimate`'s output and does no arithmetic
beyond cents→USD. **`headline` is `totalCents`, never a sum of `lines`** — the render line is priced
as a constant no line-sum reproduces, and a second sum here would be a second estimate drifting from
the one the rail consumes. A test feeds it deliberately inconsistent input to hold that.

The itemisation moved into a native `<details>`, and the clip line carries the 40× lever in words:
knowing which line is expensive is only useful beside knowing what the cheap kind costs.
`generateDisabled` folds the three no-spend reasons (unresolved, refused, nothing to buy) so the
component asks one question.

**Four refusal codes gained sentences** that existed on the rail with none: `unconfirmed_claims`
(→ the confirmation badge, NOT a rewrite — the model proposes, only the owner vouches),
`deck_locked` (→ post-Generate edits are canvas-only and paid), `no_alternate`, `nothing_to_render`.
Every code is a distinct lever; that is the rule this map exists to keep.

### Corrected on the way through: the still was never "a tenth"

`KIND_COST_NOTE.animated_image` read *"about a tenth of a clip"* in shipped UI copy (and in this
playbook's scene-kind table, and in a `MediaCanvas.tsx` comment). Measured at 20.2 wave 7 / ADR-019:
a 4 s generated clip is $0.40 and a still is $0.01 at ANY length — **a fortieth**. The one cost lever
a user has was understated by 4×. All three sites now say fortieth.

### Exactly six editor affordances, labelled by what they cost

Free: **edit prompt**, **edit narration**, **move up / move down** (one `reorderBlocks` call with
the whole new order), **delete scene**, and **choose your footage** (20.2 wave 6, `uploaded_video`
scenes only). Paid: **regenerate this scene**, which states in words WHAT it buys — a clip, a
still, a voice take, or a pair — and that the other scenes are kept.

**A control that cannot spend must not look like one.** Three of the four kinds buy nothing on
their own, so a silent card or a silent upload shows no paid row at all: the tile says "nothing to
buy for this scene — edit it above and generate the reel" rather than sending a click to a mutation
that would answer `nothing_to_regenerate`. The refusal still exists for the callers the tile does
not cover; the tile simply knows the answer already.

The narration editor carries a **live character count against the block's own `maxChars`**, turning
`--held-text` amber past the limit — `--held-text`, never `--held`, which is a fill token and fails
contrast as text (BRAND §6). **The count itself is the signal**, so the state is never carried by
colour alone. This control is the UI half of the pre-payment guard: `jobEstimate` refuses an
over-length deck before a cent moves, and this is where the user fixes it.

**Nothing beyond those six exists** — no transitions, no filters, no layers, no masking, no music
controls, no client-side rendering, and no timeline EDITOR (wave 6's ribbon is read-only; see the
free-editor section above). That is D7's ceiling and the canvas is deliberately at it.

### The 18-07 Output-card collision, resolved

18-07's `OutputCard` landed first, but it is a THREAD-scoped self-querying component for created
vault docs — not a reusable card primitive, so there was nothing to import. The block tile and the
reel region reuse its VISUAL vocabulary exactly (`briefingSheet`, `typeBadge`, `capsTeal`,
`snippetSheet`, all newly `export`ed from `cards.tsx`) so the two read as one system. In particular
they inherit its badge decision: **the teal lives in the FILL and the label stays `--ink`**, because
`--teal-600` as small text is ~2.9:1 and BRAND §6 bans it. Do not "restore" teal text there.

### The palette swatches are the ONE legitimate hardcoded colour

CLAUDE.md §10 bans hardcoding a hex a token covers — that rule is about product CHROME. The art
direction's palette hexes are the CONTENT being displayed, so they are inline styles by necessity,
and each swatch prints its hex **as text beside it** so a colour is never named only by a colour.

### What has NEVER run

**No human has seen this surface.** It typechecks and builds; it has not been rendered against a
real media plan, and there is no media plan to render it against until the agent can produce one —
which is 20-12, still parked on the Phase-16 gate. The empty state ("No reel in this thread yet")
is therefore the state this canvas will be in for every existing thread.


## Burned captions (20-17) — the phase's designated cut line, and it SHIPPED

20-17 was written as the cut line: *"cut it the moment the phase is running long, and the phase
still ships D8's headline deliverable."* It was not cut. The reel now works on an autoplay-muted
feed, which for social and marketing assets is the difference between an asset and a file.

**What it did NOT add, which was the whole design goal:** no Python runtime, no Whisper weights
(~1.5-3 GB), no font fetcher, and **nothing at all to the sandbox image**. The transcription is a
fal line like every other media call; the timing math is pure TS; the burn is one ffmpeg pass over
the image 20-15 already baked.

### The STT model, and why a cheaper one is REFUSED

| | |
|---|---|
| Model | `fal-ai/elevenlabs/speech-to-text/scribe-v2` (`MEDIA_DEFAULT_STT`) |
| Billing unit | **$0.008 per INPUT audio minute** — reservable before the job runs |
| Reserved by | 20-04, as ONE `stt` line at `blockIndex: -1`, priced `blocks × clipSeconds / 60` |
| `keyterms` | **Never sent.** +30% on the per-minute rate, and a priced dimension the table does not model |

**`fal-ai/whisper` is REFUSED and this is not a cost decision.** It bills per COMPUTE SECOND, which
cannot be reserved before it runs — the same structural defect as a per-generated-second TTS model.
It happens to be cheaper in practice, and *"cheap in practice"* is exactly the reasoning ADR-011
exists to forbid. `fal-ai/speech-to-text` (NVIDIA Canary) returns plain text with **no timings** and
is useless for captions.

### Captions are timed on the CLEAN takes — never the mixed bed

The upstream in-assembler Whisper path was removed on **2026-07-29** for transcribing MIXED audio
(music and SFX under the speech) and swallowing words. D8 forbids re-merging assembly and captions,
and `assemble_final.sh` refuses `--subs` in as many words. So the transcript is taken from the
`tts` assets, and the burn is a second pass over the finished file.

**THE REBASE, and it is the whole correctness story:**

```
absolute_t = speech_abs_s + (word_t_in_clean_take - lead_silence_s)
```

`windowStartS + t` is the wrong answer that looks right for block 1 and drifts for every block
after it. `packages/core/src/captions.ts` owns this, consumes the VALIDATED `AssemblyReport` (never
a raw sidecar), and its first test asserts the identity directly: a word at the take's very first
speech instant lands EXACTLY at `speechAbsS`.

A rebased time outside `[windowStartS, boundS]` is **CLAMPED and flagged**, never allowed through —
a bleeding word is a caption rendered over the next take's line, which reads as a caption for the
wrong shot rather than as a timing bug.

#### The two keys, both corrected for the scene timeline (20.2, before wave 5)

Neither of these was reachable in production — `unrenderable_block`, the minimum-narration check and
`assembly.ts`'s `speech_exceeds_window` refusal each held one shut. **Wave 5 removes all three**, so
they were fixed first. That is the same ordering rule the plan already applies to the money leak.

**1. The take offsets are keyed by NARRATED ORDINAL, never by `blockIndex`.** `concatWavTakes`
emits one offset per take it was handed, positionally, and `media.ts:1375-1378` hands it the
succeeded `tts` rows **sorted by `blockIndex`**. Those agree with `blockIndex` only while every
scene owns a take. Since wave 3 a scene may be deliberately silent — the sidecar says so with
`speech_dur_s: 0` — and a silent scene is a **hole**: reading `offsetsS[blockIndex]` past one hands
every later scene the wrong take and drops the last one off the end of the array. On a 3-scene reel
with a silent card the final line landed **10.5s early, against the card's anchor**. The invariant
wave 5 must preserve: *a scene has a `tts` row if and only if its sidecar entry has
`speech_dur_s > 0`.*

**2. The clamp bound is the NEXT take's `speechAbsS` (or `total_duration_s` for the last), not
`windowStartS + clip_seconds`.** Since wave 4 a line may legitimately run past its own scene, so a
scene-width bound is wrong in *both* directions: it cuts a correct line off at the boundary (the
live uniform path — a 10.4s take in a 10s block loses its last 0.4s and gets flagged `clamped`),
and on a mixed deck `clip_seconds` is the LONGEST scene, which is loose enough to let a drifting
word sail over the next take. The next take's start is the bound `assemble_final.sh` itself
enforces on the audio, so the captions and the mix cannot disagree about where a line ends.

### ONE request, which forced a real wav concat

The reservation creates ONE `stt` line for the whole reel, so the N takes are concatenated into one
wav before submission. **This is NOT a byte concat**, and the delta's wording ("a byte-level concat
of same-format WAVs") is wrong in a way that fails silently: gluing two wav files together leaves a
header claiming the FIRST file's length, a decoder stops there, and you get a plausible-looking
transcript of take 1 only. `concatWavTakes` rewrites the header canonically and returns
`offsetsS` — the key the rebase partitions words by — which is persisted as `plans.captionOffsetsS`
because it cannot be recomputed later without re-fetching every take.

Mismatched formats are REFUSED (`format_mismatch`) rather than concatenated: a 24 kHz take glued
onto a 48 kHz one plays at the wrong speed and produces plausible words at wrong times.

### ⚠ DEVIATION: the audio goes as a `data:` URI, not through fal's file-upload endpoint

The plan specified uploading the bytes to fal's storage and submitting the returned fal-hosted URL.
**The binding requirement behind that instruction is *"a Convex signed storage URL is NEVER handed
to a third party"*** — `plans.attachmentUrls`' header calls such a URL a bearer capability — and a
data URI satisfies it completely, because no URL of ours exists to hand over.

Why the deviation: fal's upload endpoint is a multi-step protocol (initiate → PUT → derive) whose
exact shape **could not be confirmed vendor-direct** in the authoring session; the delta records
only that it "returns a fal-hosted URL". Guessing a protocol at a money boundary fails at the first
live call and buys nothing over the documented data-URI form, which is ONE request on a path
already built. It also **removes a ceiling the plan expected to have to record**: with no upload
there is no copy of tenant audio sitting in fal's storage under a retention policy we do not
control. The bytes still reach fal — that is what transcription is — but only for the request.

- Bounded by `MAX_STT_AUDIO_BYTES` (6 MB pre-base64; a 6×10s reel at the pinned 24 kHz mono 16-bit
  is ~2.9 MB). Over that is a governed stop with a code, never a 413 discovered after the
  reservation was spent.
- **`llmRedaction.test.ts` scans `submitCaptions` for `storage.getUrl` and pins every `audio_url`
  construction site.** This is a one-line "fix" away from being false and the symptom would be
  invisible — the transcript comes back correct either way.
- Upgrade path if a reel ever outgrows the cap: fal's file-upload endpoint, confirmed against its
  OpenAPI spec FIRST. The seam is `audioDataUri`.

### The transcript lands INLINE — there is no URL to fetch

`scribe-v2` returns `{ words: [...] }` in the callback payload itself. `http.ts` gained
`INLINE_ASSET` beside `ASSET_PATH`: the whole fetch-and-host-check path is skipped, and the words
are **re-serialised** before storage rather than the provider's body being echoed onto disk. A
payload with no `words` array is `no_asset_payload` — and `media.test.ts` proves the plausible fal
URL sitting in that same body is NOT followed.

`stt` is an `EXACT_SPEND_KIND`: we generated the audio and therefore already measured it, so the
landing moves no window.

### Two triggers, two once-only guards

| | Fires when | Guard |
|---|---|---|
| `maybeStartCaptions` | the LAST voice take lands | `captionStatus` unset → `"transcribing"` |
| `maybeBurnCaptions` | the transcript lands **or** the render terminal runs | `"transcribing"` → `"burning"` |

The transcript submit runs **in PARALLEL with the render** — it needs the takes and the sidecar's
anchors, never `final.mp4`. The burn needs both, so it is called from both terminals and whichever
arrives second wins the transition. A deck with no `stt` line never gains a `captionStatus` at all.

A failed voice take records `captionReason: "incomplete_takes"` rather than leaving the `stt` row
queued forever behind audio that will never exist.

### The burn: one pass, on a libass build that must not silently disappear

`render/burn_caps.sh` (mirrored to `render/burnCapsScript.ts`, byte-identity drift test, **no
`skills.ts` seed entry** — delta pitfall 17 applies identically to the assembler's mirror).

**IT CONSTRAINS THE IMAGE.** `subtitles=` needs an ffmpeg built `--enable-libass`. 20-15's bake
script installs the BtbN **`ffmpeg-master-latest-linux64-gpl.tar.xz`** tarball plus
`dejavu-sans-fonts`; both are load-bearing for this stage. The script CHECKS for the filter up
front and refuses, because `subtitles=` on a build without libass is an unknown-filter error on
some builds and a silent no-op on others.

- `-c:a copy` — the level law (linear loudnorm at −16 LUFS) was settled two passes ago and is not
  re-opened here.
- The output duration is asserted to ±1s of the input. A burn that re-times the video has
  desynchronised the voice from the picture — the one failure a still frame would not show.
- **No font is fetched.** `deny-all` egress makes it impossible, which is the point. A font named
  in the `.ass` and absent from the image does NOT fail — libass substitutes silently — so the
  writer and the bake script name the same family (DejaVu Sans) and a test pins it.
- The `.ass` writer ESCAPES `{`, `}` and `\`. `.ass` treats `{...}` as an inline style override and
  the caption text is model-authored narration: an unescaped brace is markup injection into a
  renderer. A hostile fixture pins it.

### The route's second MODE, and the sandbox it shares

`handleRenderRequest` gained `mode: "caption"`, guarded by the same bearer and creating its sandbox
with **`buildSandboxOptions` reused unchanged**. `render.test.ts` asserts the two modes produce an
IDENTICAL options object — a second sandbox-creation path is a second place for `persistent: false`
to go missing, which is a cross-tenant leak created by an unset option rather than by a bug.

The captioned cut passes the **same** `validateMp4Bytes` checks as the assemble pass (magic bytes,
size band, our MIME type). A burn that returns something implausible publishes nothing and leaves
the uncaptioned reel exactly where it was.

**⚠ ONE THING NOW CROSSES INTO THE VM THAT NEVER DID BEFORE: NARRATION.** The `.ass` track is
model-authored words, and burning captions means putting them on screen — there is no version of
this stage that keeps them out. Everything else on the forbidden list still holds: no `FAL_KEY`, no
`OPENAI_API_KEY`, no Vercel credential, no `tenantId`, no fal URL, no signed storage read-URL. The
`.ass` is the only content this endpoint accepts and it is capped at `CAPTION_MAX_ASS_BYTES`.

`resolveRenderAsset` now resolves a **plans** id as well as a `mediaJobs` id, so the published
`final.mp4` reaches the runner through the same bearer-guarded blob route with the same rule —
an opaque id in, everything else read off the row. A plan whose sidecar never validated has no
`renderStorageId` and is therefore unreachable, which is the governance rule holding by
construction.

### THE RETENTION RULE IS NARROWED (20-17 over 20-16)

20-16's rule was *"delete once `final.mp4` is published"*. **The clean voice takes are the
transcript's source**, so with captions in the pipeline they must survive past the assemble step.
The deletion moved from "the reel exists" to "the FINAL artifact exists":

- `deleteIntermediates` is now a function with TWO callers.
- The render terminal calls it only when `captionsStillOwed` is false. **Cut captions and this
  reverts to 20-16's simpler rule automatically** — a deck with no `stt` line has nothing to wait
  for.
- The caption terminal calls it after repointing `renderStorageId` at the captioned cut.
- **A FAILED burn keeps everything**, exactly as a failed render does. 20-16's "keep on failure" is
  not narrowed; only "delete on success" is.

`media.test.ts` asserts this in **BOTH directions** (takes survive with captions owed; takes are
deleted for a deck without captions), and the narrowing has been **mutation-checked**: replacing
the condition with `if (true)` turns the survival assertion RED. Observed red, then restored.

### A caption failure NEVER unpublishes the reel

`renderStatus` stays `"rendered"`, `renderStorageId` still points at the uncaptioned cut, and
`captionStatus: "failed"` + a `captionReason` code record why the track is missing. One dead letter
(`workflowId: "media.captions"`, payload `{ batchId, planId, reasonCode }`). **A missing caption
track is a degraded deliverable; an unpublished reel is no deliverable.**

`storage.delete` is now pinned at **2** sites in the media subsystem, both in `render/renderReel.ts`
— the retention loop and the uncaptioned-cut delete — and BOTH failure arms are asserted not to
contain it.

### What has NEVER run

**No sandbox has ever been created and no STT minute has ever been bought.** Every test in this
stage runs offline at $0 through `FAL_FIXTURE` and `MEDIA_SANDBOX_FIXTURE`. The first real
transcript (~$0.008) and the first real burn are 20-11's owner-run live gate. In particular
UNPROVEN until then: scribe-v2's exact response field names, whether `data:` URIs are accepted on
that endpoint at the sizes involved, and whether the baked ffmpeg really carries libass.


## The unrenderable-deck guard (20-15 follow-up)

⚠ **`storyboard.ts`'s PAID table promised something the assembler cannot do.** Its comments called
TEXT *"rendered by the assembler"* and SCREEN REC *"an instruction to the human"* — but the assembler
harvested in 20-13 has **no title-card path and no upload path**, and it discovers inputs BY INDEX
and hard-errors on the first missing clip. An unpaid block gets no video line, so nothing ever writes
its `blockNN.mp4`.

**That was a money leak, not a cosmetic gap:** a deck containing a TEXT block passed the money gate,
spent real money on its AI blocks, and could then never assemble anything.

`reserveJobInner` now refuses any deck containing an unpaid block with **`unrenderable_block`, BEFORE
a cent moves** — the same placement rule the narration band follows: *a condition that makes a render
impossible must be caught UPSTREAM of the reservation, never downstream of it.* `renderReel.
batchToRender` still refuses it too (`incomplete_blocks`), but by then the clips are bought.

`jobEstimate` surfaces the same refusal with its block index, so the canvas names the block.

`ponytail:` refuse, rather than build a title card. The ceiling is that a deck mixing an AI block
with a TEXT card cannot be made at all. The upgrade path is a `drawtext` branch in
`assemble_final.sh` for a clipless index — **the DejaVu font is already baked into the sandbox
snapshot** for 20-17 — plus a regenerated mirror and its byte-identity drift test, at which point the
guard narrows to "unpaid AND no overlay text" rather than disappearing.

**A test that displaced coverage was re-homed, not dropped:** the old *"D12a AT THE RAIL: 13 sub-cent
lines"* test used a 13×TEXT deck and passed — which was the defect. The flooring-once property is now
asserted on a RENDERABLE deck, and the pure 13-line arithmetic remains in
`packages/cost/src/media.test.ts`.


## The scene timeline (20.2) — the contract that makes the reel reachable again

⚠ **The guard above is correct, and the deck it refuses is the deck the specialist is TAUGHT to
write.** `media-director.md:82` emits a `SCREEN REC` row in its own worked example, and
`media-director.md:87-89` teaches all four shot types as legal. So the canonical proposal passes
every free stage, reaches the money gate, and is refused with `unrenderable_block`. **The reel has
been unreachable in the PRODUCT, not broken in the render chain** — `renderReel` → the route → the
sandbox → `assemble_final.sh` is intact and its tests are green.

Phase 20.2 repairs this by making all four visual sources renderable, rather than by narrowing what
the specialist is allowed to write. Wave 1 lands the CONTRACT only, in
`packages/core/src/storyboard.ts`, **beside** the block contract:

| Block contract (live) | Scene contract (20.2) |
|---|---|
| `Block`, `parseBlockDeck` | `Scene`, `parseSceneDeck` |
| `SHOT_TYPES` — AI / SCREEN REC / TEXT / VIDEO, two of them unrenderable | `VISUAL_KINDS` — `generated_video` / `animated_image` / `uploaded_video` / `text_card`, **all four renderable** |
| `clipSeconds`, uniform; `mixed_durations` refuses rows that disagree | per-scene `durationMs`; `duration_mismatch` refuses rows that disagree with the DECLARED TOTAL |
| length is an accident of `blocks × clipSeconds` | `TARGET_DURATIONS` = 15 / 30 / 60, summed EXACTLY |
| `windowStartMs = index * clipSeconds * 1000` | `startMs` = running sum of prior durations |
| narration band `[minCharsFor, maxCharsFor]` per window | ceiling only — `narrationCeilingSeconds` |

**The narration FLOOR is deleted, and that is a consequence rather than a preference.** Under the
block contract a take is `adelay`-padded and `amix`ed INSIDE its own window, so speech had to FILL
`[clip - 1.4, clip]` seconds — a 31–56 character band at 4 s, which is not a band a person can write
in. Wave 4 places every take at an absolute offset on ONE master track, so silence around a line is
free and the only physical limit is that a line must not run into the NEXT line. That limit is
`narrationCeilingSeconds(scenes, i)`: from a scene start to the start of the next NARRATED scene.
**A silent scene lends its whole duration to the line before it**, which is what lets a deck cut
visually without cutting the sentence.

**The provider grid is real, and is named rather than hidden.** Sora returns 4, 8 or 12 second
clips, so a `generated_video` scene must land on `GENERATED_CLIP_SECONDS`. The other three kinds are
frame-exact at any whole second — which is what makes an exact 15/30/60 possible at all, and is also
a ~10x cost lever: a 4 s generated clip is ~40 cents, a 4 s animated still ~4 cents.

**`LEGACY_VISUAL` migrates a TYPE, never a DURATION.** The block contract used 5- and 10-second
clips and neither is on Sora's grid, so an old Wan deck maps its types cleanly and still refuses
with `illegal_generated_duration`. Pinned by a test; pretending otherwise would move the failure out
of this parser and into a paid submit.

**`unrenderable_block` narrows rather than disappears.** Its replacement is `hasAssetSource`: an
`uploaded_video` scene with no vault ref has nothing to render. `isPaidScene` is now a separate
question from renderability, where `isPaidBlock` conflated the two.

`SECTION_TOKENS` gained `SCENE DECK` and `SCENE PROMPTS`, so `ART DIRECTION` terminates at a scene
deck instead of swallowing it — the same failure the block tokens were added for.

**How to verify:** from `packages/core`, `npx vitest run src/storyboard.test.ts`. The two guards
that can go vacuous are the exact-length assert and the narration ceiling; both were
mutation-checked (neuter the condition, observe exactly one test go red) rather than trusted. Do the
same to anything added here — this subsystem has a documented history of mechanism coverage passing
while the behaviour was broken.

**NOT yet done (waves 2-8):** no caller reads `parseSceneDeck`; the schema, price table, assembler,
sidecar, captions, canvas and the `media-director` body are all still on the block contract. The
reel stays unreachable until wave 3 gives the assembler its card / still / upload branches.


## The scene timeline reaches the adapters (20.2 wave 2)

Wave 1 was one pure file with no callers. Wave 2 is where the contract meets the database, the
dispatch terminal and the two money gates.

### The schema is WIDENED, and `type` going optional is the load-bearing part

```
shots[].type      v.string()  ->  v.optional(v.string())   // block rows only
shots[].visual                    v.optional(v.string())   // NEW - scene rows only
shots[].asset                     v.optional({source,docId}) // NEW - uploaded_video only
plans.targetDurationSeconds       v.optional(v.number())   // NEW - scene decks only
```

**There is no `durationMs` and no `startMs`, deliberately.** `shots[].seconds` and
`shots[].windowStartMs` already carried a variable timeline — the block contract merely happened
to write them uniformly. A scene row writes its real duration and its running-sum offset into the
SAME two columns, so there is no second pair of fields that can disagree with them.

**`type` was widened to optional rather than overloaded with a `VisualKind`, and that choice is a
money-path guard.** `media.deckOf` gates on `SHOT_TYPES.includes(s.type)`. An absent `type` makes
it return null, so a scene deck cannot be read as a block deck. Writing a legacy-equivalent token
there instead would have let four scenes of 8/6/4/12 seconds be priced at the deck-wide
`clipSeconds` of 12 — fail-open, silently overcharging, on a paid path. `visual` present is the
per-row discriminator; `targetDurationSeconds` present is the per-plan one. There is no third
`deckKind` column to keep in sync with either.

### Two contracts, one terminal — and the ORDER is the design

`media-director.md` still teaches the BLOCK deck and does not become a scene author until its body
is recertified through the eval gate (wave 8), so both shapes arrive at `persistStoryboard` for
several waves. A scene deck wins when the body contains one. **The fallback to `parseBlockDeck` is
guarded on `no_deck` ALONE** — "this body has no SCENE DECK heading at all". A scene deck whose
durations do not sum, or whose visual kind is unknown, is REFUSED as a scene deck; falling through
there would read its rows under the uniform contract and propose a reel nobody wrote.

### The editor offsets are a RUNNING SUM

`patchShots` computed `windowStartMs: i * clipSeconds * 1000`. On a scene deck a reorder or a
delete would have rewritten every offset onto a uniform grid the shots were never cut to —
desynchronising the whole timeline from the narration anchors, and on a 30-second reel writing a
36-second offset. It now sums each shot's own `seconds`. **Identical output for a uniform deck by
construction**, which the block-contract tests pin, so this is a generalisation rather than a
behaviour change.

### A scene deck is REFUSED at the money gates, not mispriced

`scene_render_not_ready` is a new `ReserveRefusal`, returned by `generateReel`, by the approve arm
in `cockpit.executePlan`, and by `jobEstimate` so the canvas states it instead of rendering a
silent $0. It sits at the MONEY gate rather than earlier on purpose: a scene deck is a perfectly
good proposal to read, edit and reorder — it just cannot be bought until waves 3 and 4 give the
assembler its card / still / upload branches and its master audio track.

⚠ **The plan had wave 2 narrowing `unrenderable_block` to `hasAssetSource`. It does NOT, and must
not.** Narrowing it here would let a `text_card` scene through the money gate while the assembler
still has no `drawtext` branch — the paid scenes land, then the render hard-errors on the missing
`blockNN.mp4`. That is exactly the money leak the guard exists to close, re-opened for one wave.
The narrowing belongs in wave 3, the moment the assembler can actually draw a card.

### Two pre-existing defects fixed on the way in

**1. The display set and the purchasable set had drifted, and the money gate asked the wrong one.**
`CLIP_SECONDS` is `[4,5,8,10,12]` — deliberately wide, so a deck proposed under an older provider
still DISPLAYS. `MEDIA_VIDEO_SECONDS["sora-2"]` is `[4,8,12]`. After the OpenAI cutover a
10-second deck therefore parsed free, cleared `reserveJobInner`'s own duration check, and was
refused three checks later inside `estimateMediaUsd` with the same `illegal_duration` code — same
outcome, wrong place, and it read like a pricing bug. `cockpit.test.ts` had been RED for this
since the cutover. There is now ONE predicate, `isBuyableClipLength`, asked of the provider table
rather than of a constant, used by both `reserveJobInner` and `jobEstimate`.

**A 10-second block deck is no longer buyable.** That is a real product consequence of the Sora
cutover, not a test detail: the block contract is now 4, 8 or 12 seconds.

**2. The approve path carried a hand-rolled copy of `deckOf`.** `cockpit.executePlan` re-derived
the same three checks inline. Making `shots.type` optional broke the copy and not the original,
so the approve path and the canvas path could have disagreed about whether a deck was readable —
on the money path. It calls the shipped reader now. A money gate still does not assume its writer
was correct; it just stops re-deciding what "correct" means.

### How to verify

`packages/backend`, `npx vitest run convex/media.test.ts convex/cockpit.test.ts
convex/dispatch.test.ts convex/llmRedaction.test.ts`. The guards that can go vacuous are the
running sum and the scene gate; both were mutation-checked — revert the sum to
`i * clipSeconds * 1000` and two tests go red, delete the scene gate and one does.

`llmRedaction.test.ts` pins the dispatch audit-payload COUNT (now 10) and demands a written §4
review of each new payload before the number may move. `persistSceneDeck` takes a parameter
literally named `body` — the specialist's output — which reaches `parseArtDirection`,
`parseScript` and `landStoryboardRefusal` (the CONTENT plane) and NO audit payload. That is what
the scan checks, and it is why the parameter name is safe rather than merely unnoticed.

### Known red, and NOT this phase's

`apps/web` `cockpitAccess.test.ts` fails on `ChatPane.tsx` copy ("Run the business with Pikar.").
It is a source scan over a file 20.2 does not touch, and it was red before this phase started —
in-flight work from the business-first cockpit language change. Left alone deliberately: fixing it
means writing product copy nobody asked for.


## The assembler learns three kinds of scene (20.2 wave 3)

`assemble_final.sh` took N clips of one length. It now takes a list of SCENES, each with its
own length and its own kind of picture:

| kind | input, by index | built by |
|---|---|---|
| `video` | `in/blockNN.mp4` | scale/pad/fps normalise, as before |
| `image` | `in/blockNN.png` | `zoompan` slow push, x4 upscale first |
| `card` | `in/cardNN.txt` | `drawtext` over black |

`--blocks N --clip-seconds C` still works and is **exactly N scenes of `video:C`** — it FILLS
the same two arrays rather than taking a second path, which is what lets the live block contract
keep rendering byte-identically while the scene contract is built around it. Passing both shapes
is refused; a caller that says both does not know which contract it is on.

**A voice take is now OPTIONAL.** The scene contract allows an empty narration cell, and a
silent scene lends its window to the line before it (wave 1). A missing `voiceNN.wav` is
silence, never an error. The narration-per-window assert therefore checks only the windows that
HAD a take — and it builds that list from the takes that actually existed, so a scene that was
supposed to have one and lost it still fails. Checking every scene and then excusing the silent
ones is how that gate goes vacuous.

### Three details that are load-bearing rather than incidental

**`textfile=` + `expansion=none`.** A card's words are model-authored. `text=` would need shell
AND filtergraph escaping of `:` `'` `\` `%` — quoting that works until someone writes a colon.
Worse, drawtext's DEFAULT expansion EVALUATES `%{...}` as an ffmpeg expression, inside the VM
that holds tenant media. Both are pinned by tests; deleting either is a silent capability grant.

**The x4 upscale before `zoompan`.** zoompan steps its crop window in whole SOURCE pixels, so a
slow push at native size visibly stutters. Upscaling first makes each step a quarter-pixel at
output scale. This is the difference between a Ken Burns move and a stutter, and it is invisible
in any test that does not actually watch the frames.

**The concat list is RELATIVE.** The demuxer resolves entries against the list file's own
directory. Absolute paths broke the first smoke run outright and would break any run where the
list is read from a different mount than it was written on.

### Verified by a real render, not by reading

`smoke_assemble.sh` synthesises every input with ffmpeg — no committed binaries, no network —
and renders clip+still+card+clip at 8/6/4/12s with the card silent. It asserts the 30s total,
the per-scene `duration_s`/`visual`, the RUNNING-SUM offsets `0,8,14,18`, that the silent scene
records zero speech while the narrated ones record real speech, and that the card frame is not
black. That last one matters: drawtext failing silently passes every downstream gate — the file
decodes, the duration is right, the sidecar is well-formed, and only the picture is missing.

⚠ **A machine whose ffmpeg has no usable fontconfig SEGFAULTS on every drawtext call**,
including one with no `fontfile` at all (observed on the Windows gyan.dev build under msys).
Point `FONTCONFIG_FILE` at a minimal `fonts.conf` naming a font directory. Environment fault,
not script fault — written down because it reads exactly like a broken filtergraph.

### What wave 3 does NOT do

**The reel is still not reachable.** A scene deck cannot be bought (`scene_render_not_ready`),
and a MIXED sidecar is REFUSED by `parseAssemblySidecar` — it still asserts
`blockCount × clipSeconds === totalDurationS`. Both were verified rather than assumed: the
uniform sidecar is accepted by the live validator, the mixed one comes back
`{code: "duration_mismatch"}`. That is the fail-closed system working. Waves 4 and 5 are what
make a scene deck purchasable and publishable, and the `hasAssetSource` narrowing rides with
wave 5's plumbing — see the correction note in the phase plan for why it moved twice.


## Storage retention (D12b)

~55 MB/job × 2 jobs/day = **3.3 GB/month** against a Convex Free/Starter allowance of **1 GB**. On a
successful render with a valid sidecar, the intermediate clips and voice takes are
`ctx.storage.delete()`d; **on FAILURE they are KEPT as debugging evidence**. Plan 20-16 implements it.

## Dependencies & blast radius

`fal-ai/wan-25-preview/…` is a **`-preview` endpoint**. Preview paths get renamed and retired, and a
rename turns every generation into `unknown_model` — which is the *correct* failure (loud, free) but
reads to a user as a broken feature.

**Detection is free:** one unauthenticated `GET https://fal.ai/api/models?keywords=…` returns
`deprecated` / `removed` / `status` per model. Replicate is ADR-011's recorded fallback.

**That check now runs weekly, unattended** — `.github/workflows/fal-catalog.yml` (plan 20-19), or
`pnpm check:fal-catalog` on demand. It is a **detector, not a merge gate**: it runs on a schedule,
never on `pull_request`, because a vendor price change is a task for a human rather than a reason to
block someone's unrelated PR. The shipped fixture test cannot do this job — it compares our table to
our OWN committed fixture, so both sides are ours. See `## Reconciliation` (b) for the three exit
codes and the dated proof that each one fires.

## Reconciliation

The D5 procedure. Two bullets, both runnable, both $0. Cadence: **at each phase close, and any time
a price row is edited.** **Plan 20-11's owner-run live gate IS this procedure's first run.**

**(a) Did the provider charge what we ESTIMATED?** (Not *what we reserved* — see caveat 1.) Sum
`mediaJobs.actualCents` for a period and compare against fal's own dashboard balance delta:

```bash
# from packages/backend — the convex CLI only resolves the deployment from there
npx convex run media:spendForPeriod \
  '{"tenantId":"<tenant>","sinceMs":1754006400000,"untilMs":1754611200000}'
```

`tenantId` is REQUIRED and is the tenant boundary — this reader is per-tenant by construction, so a
deployment-wide figure is the sum of per-tenant runs, never one unscoped query. The window is
**half-open** `[sinceMs, untilMs)`, so consecutive periods partition rows exactly once.

Compare the returned `actualCents` total against the PROVIDER's billing page for the same window.
A gap means the table is wrong, not that the meter is wrong — the meter records what the provider
reported.

**WHICH billing page is now a per-kind question, and the text above is stale where it says "fal".**
fal has not billed this product since the 20-series cutover. As of 33.1-05: **images AND video**
reconcile against **openrouter.ai -> Activity** (each row carries the same `usage.cost` the price
row was measured from, so this comparison is exact rather than approximate — the 7-second probe
billed `$0.49` against `7 × $0.07` predicted); **voiceover and captions** reconcile against the
**OpenAI** usage page, and those endpoints are not being withdrawn. Stock lines reserve $0 and
appear on no bill at all.

**A period spanning the 2026-08-30 cutover is split across TWO bills**, and no single page shows the
whole of it: video jobs submitted before it were charged by OpenAI, after it by OpenRouter. Compare
such a window against both, or pick window boundaries that do not straddle the cutover.

**THREE CAVEATS TRAVEL WITH THAT NUMBER, and `spendForPeriod` puts each one in its own payload
rather than relying on you to remember this page:**

1. **`estCents` is NOT what was reserved** (`notes.reservedTotalNotDerivable: true`). The
   reservation priced the whole batch **including the `render` line** and floored it to cents
   **once**; the render line has no row. Reserved is therefore always a little more than `Σ rows`.
   Do not "fix" the gap by adding a render row.
2. **A `tts` row's `estUsd` is DOUBLE by design** (`notes.ttsReservedAt2x: true` whenever any voice
   line is in range). 20-04 reserves voice at 2× so one rewrite round is pre-paid, so est/actual ≈ 2
   on voice is **healthy**. Without the flag it reads as a 100% overcharge.
3. **`unlanded > 0` means the period is NOT FINAL.** `actualCents` is absent until a row lands and
   stays absent if it failed, so the total covers only what reported. Re-run after the batch
   settles. A reader that summed silently would report an in-flight period as *cheaper*, which is
   the one failure mode a reconciliation tool must not have.

`byKind` subtotals are each rounded once, so they can differ from `estCents` by a cent or two — the
total is authoritative, and the breakdown exists because a drift in ONE table row is invisible in a
single number.

For per-plan detail: `npx convex run media:listJobs '{"tenantId":"…","planId":"<id>"}'` — a
projection, deliberately without `assetStorageId` / `assetHash` / `mimeType` / `bytes`. An operator
reconciling money has no use for storage handles, and a reader that returned them would be the
easiest accidental route to a URL (§4).

**(b) Is the price table still the vendor's price?** **Automated since 2026-08-02 (plan 20-19)** —
one command, and a weekly `fal-catalog.yml` run that does it unattended:

```bash
cd packages/backend && pnpm check:fal-catalog
```

It reads fal's catalog for all four keywords and diffs the **verbatim** `pricingInfoOverride` /
`billingMessage` strings against `packages/cost/src/media.fixtures.json`, plus
`status`/`deprecated`/`removed`. **THREE outcomes, and the third is the point:**

| Exit | Meaning | Do |
|---|---|---|
| `0` | AGREE | nothing |
| `1` | DRIFT — a string changed, a flag flipped, or a pinned id is GONE | the printed diff IS the patch: edit `media.ts` **and** the fixture together, re-run |
| `2` | UNREACHABLE | **not a price verdict.** Re-run later. Never read as green |

It diffs the STRING, never a parsed number, on purpose: a regex that extracts `$0.05` silently
passes a vendor edit that changes the *unit* — "per second" → "per generated second" is exactly the
class of change ADR-011 exists to refuse, and it moves no number at all.

FLUX schnell needs no special case. The general rule is *an entry with no pinned price string is
checked for flags and presence only* — and if the vendor ever **starts** publishing one, that is a
drift, because the MEDIUM confidence then becomes resolvable.

**Anti-vacuous proof — all three outcomes OBSERVED 2026-08-02, before the workflow was trusted:**

| Seeded | Observed |
|---|---|
| nothing (live catalog) | **exit 0**, four `OK` lines; FLUX schnell still publishes no price string, so it is still MEDIUM |
| one character changed in `inworld-tts`'s pinned string (`per 1000 character` → `characters`) | **exit 1**, `DRIFT fal-ai/inworld-tts`, printing fixture and vendor strings on adjacent lines. Fixture restored byte-identical |
| `FAL_CATALOG_BASE` pointed at an unroutable host | **exit 2**, *"UNREACHABLE — could not read fal's catalog. This is NOT a price verdict"*. Not 0, and not 1 |

That third row is why the check exists in this shape: `skillopt.yml` has been reporting green for a
year because a `|| true` swallows its failing step, and a monitor nobody has seen fail is
indistinguishable from no monitor. The old manual recipe is kept below for a machine without the
repo checked out:

```bash
curl -s "https://fal.ai/api/models?keywords=wan-25&page=1" \
  | node -e "const j=JSON.parse(require('fs').readFileSync(0));for(const m of j.items)console.log(m.id,'|',m.status,'| deprecated:',m.deprecated,'| removed:',m.removed,'|',m.pricingInfoOverride)"
# repeat for keywords=inworld, keywords=scribe, keywords=schnell
```

This is unauthenticated and free, and it is **also the endpoint-health check**: the same response
carries `deprecated` / `removed` / `status`, which is the detection mechanism for the `-preview`
rename risk below. Any change is a one-line table edit plus a fixture update — and
`media.test.ts` fails until the two agree, so the edit cannot land half-done.

**Known open item from the 2026-08-02 read:** FLUX schnell's **$0.003/megapixel is MEDIUM
confidence** — the vendor publishes the rounding rule but no price string. The first invoice that
includes an image generation resolves it.

### The live gate — **NOT YET RUN as of 2026-08-03**

Plan 20-11 Task 4, owner-run. **This is the first execution of both bullets above**, and it is the
only place in this playbook that may carry an invoice-confirmed number.

Everything upstream of this section is proven at $0. **Five things offline testing structurally
cannot prove**, and they are exactly the ones that fail in production:

1. that fal's live queue ACCEPTS our clip, voice and transcript submit bodies — the STT one is a
   `data:` URI at ~3 MB, a deliberate deviation from a file upload (plan 20-17);
2. that our webhook URL is reachable from fal's egress;
3. that a real Vercel Sandbox boots from our snapshot, finds ffmpeg **with libass**, and finishes
   inside the route's 300 s;
4. that the harvested `assemble_final.sh` writes a sidecar `parseAssemblySidecar` accepts;
5. that the amount actually billed matches the price table.

Budget **≈$0.75** across three runs: **A** the Wan spine at 480p (≈$0.29); **B** the same storyboard
on `fal-ai/longcat-video/distilled/text-to-video/720p` for the D13 resolution-for-price A/B
(≈$0.12); **C** one 30 s block (≈$0.33) that settles TTS-window consistency, visual coherence past
15 s, and — the real prize — **fal's billed-seconds fps divisor, backed out of the arithmetic**
(`billed_usd / rate = billed_seconds`, then `num_frames / billed_seconds = the tier fps`). The 720p
page implies 30 fps and the 480p page 15 fps; **fal returned HTTP 429 to every automated fetch, so
this has never been read first-hand.** A wrong divisor puts every LongCat reservation off by 2x.

**Record the divisor here whether or not LongCat is adopted** — it is a fact about fal's billing,
not about our model choice, and nothing else in the phase can obtain it.

| Observation | Value |
|---|---|
| Date run | — |
| fal balance before / after / delta | — |
| `sum(mediaJobs.actualCents)` for the run | — |
| Difference (fal delta vs recorded), **recorded even when zero** | — |
| Reserved cents vs the sum of floored line items (D12a, observed in production) | — |
| Observed render wall-clock vs the modelled 60–150 s | — |
| Observed sandbox cold start | — |
| **fal's billed-seconds fps divisor (720p / 480p)** | — |
| LongCat vs Wan verdict (D13) | — |
| 30 s TTS take: three speech durations vs the [28.6, 30.0] s window | — |
| Snapshot id + bake date | — |

*"We compared and it matched"* **is** the finding — record the number even when the difference is
zero. A blank row above means the gate has not run; it never means it passed.

## How to change this safely

- A rate edit is a one-line table change **plus** a `media.fixtures.json` update from a fresh catalog
  read, so the diff shows the vendor string that justified it.
- Adding a model means answering ONE question first: *what does the vendor bill on?* If the answer is
  generated-output duration or compute seconds, the answer is no.

## Playbook ownership for Phase 20

Exactly **ONE plan per wave** may bump this file, so concurrent waves never contend for it:

20-01 (W1) · 20-13 (W2) · 20-04 (W3) · 20-05 (W4) · 20-06 (W5) · **20-18 (W6)** · 20-14 (W7) ·
20-15 (W8) · 20-09 (W9) · 20-16 (W10) · 20-10 (W11) · 20-17 (W12) · 20-11 (W13) · **20-19 (W14)**.

This is why the wave graph is longer than the dependency graph alone requires.

W6 and W14 were the only waves with no owner (20-07 owns `cockpit.md`, 20-12 owns
`skill-registry.md`), which is why the two plans added on 2026-08-02 took them. **20-19 depends only
on 20-01 and is technically runnable from W2** — it sits at W14 solely because every wave in between
was already claimed. If the wave graph is ever re-cut, pull it earlier: it protects every paid plan
downstream of it.

<!-- ponytail: watch.json registers PRODUCTION paths only, deliberately NOT the `.test.ts` siblings.
     Test files are exempt from check-playbooks' creation gap, and registering them would force every
     plan in this phase that touches a media test to bump this playbook — serialising waves that share
     nothing else. If check-playbooks ever blocks on a `.test.ts` creation anyway, the fix is to add
     that ONE path, not to abandon the split.
     `apps/web/app/(app)/dashboard/workspace/MediaCanvas.tsx` is registered as a single FILE, not via
     its directory: `cockpit.md` already claims that directory, and a change to MediaCanvas.tsx should
     demand BOTH playbooks — it is a cockpit surface and a media surface at once. -->
