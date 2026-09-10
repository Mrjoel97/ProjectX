# Phase 30-08 evaluation preparation — release incomplete

The local evaluation foundation now exists. No paid run, deployment, publication, activation or
owner approval was performed. Fixtures and scripted tests remain distinct from model evidence.

## Implemented locally

- All six exact candidate bodies and 40 cases are checked by the free preparation command. Sources
  compile into actual typed Data workbooks, meaningful Design PNGs, and synthetic Product, Legal,
  HR and Engineering text. Missing sources stay missing; metadata never becomes visual evidence.
- `verticalEvalSources` binds candidate/version/body, run/case/request hashes, owned plan/thread and
  actual storage/source IDs and hashes. Fresh synthetic tenants are mandatory; changed, foreign or
  sealed sources fail. Provisioning performs no embeddings, connector reads or paid calls.
- The native evaluator uses those exact fixed sources and actual image/profile inputs. This evaluates
  candidate method behavior; it does not prove retrieval quality. Mechanical qualification validates
  actual candidate, request, source, artifact, tool, model and cost facts. Blocked remains blocked;
  scripted remains scripted. Semantic correctness is still a separate gate.
- One aggregate budget in the existing accounting plane bounds reservations for every model/fallback call. Unknown
  charges retain reservations. The cap bounds OpenRouter credits, not external BYOK provider billing.
  The operator must verify credit-only billing before opting in; this assumption is not machine proof.
- Raw output markdown is archived separately from the refs/hashes/counts report. Checkpoints precede
  cleanup. Unknown remote outcomes, unknown/breached accounting, or failed output archival retain fixtures. Exact paged content
  cleanup preserves accounting and its authority receipt until the terminal empty transaction; WORM
  freezes refuse cleanup and prefix-sharing sibling tenants survive.
- Offline review preparation binds the collected output, exact fixture revision and observed source
  bytes. It recomputes Data reference facts with the existing bounded parser, presents unresolved
  semantic criteria, and validates reviewer-authored evidence spans against their exact UTF-8 bytes.
  Local records do not authenticate the observer or reviewer and cannot unlock release.

## Commands

Free, no backend calls:

```sh
node packages/backend/scripts/run-eval-vertical.mjs --fixtures-only
```

Paid observation collection for a future explicitly initiated run, requiring already published exact
candidates and verified non-BYOK credit billing:

```sh
node packages/backend/scripts/run-eval-vertical.mjs --collect-observations --all-candidates --no-activate --max-cost-cents 1000 --credit-billing-only
```

Reports and separately hashed markdown outputs are saved under `.tmp`. Provider errors are redacted.
This command never publishes, deploys, activates or records release evidence. Even a complete observation
collection exits **2**, because semantic review and release acceptance remain outstanding.

After collecting actual observations, prepare a content-plane review packet without backend calls:

```sh
node packages/backend/scripts/prepare-vertical-review.mjs --report .tmp/vertical-eval-observations-RUN_ID.json --case data-typed-xlsx-profile
```

The command requires the run's original, hash-identical fixture revision and exact output archive.
It writes an immutable review directory with output, observed source snapshots, an optional canonical
Data profile and a refs/hashes packet. Existing review directories are never overwritten. Evidence
offsets are UTF-8 byte offsets; `referenceProfileText` defines the exact Data-profile bytes.
`validateVerticalReviewRecord` validates explicit judgments and spans but leaves reviewer identity
unverified and release closed. This is review preparation, not automated semantic adjudication.

The original `--all-candidates --no-activate` release command remains closed and exits **2** before
any model call. `VERTICAL_EVAL_SUITE.executable` remains false; pilot evidence, fixtures, scripted tests
and observation JSON cannot unlock a vertical.

## Remaining gates

1. Run the exact native collection in an authorized environment and inspect real billing/model/output
   observations. All six candidates remain unpaid during this implementation task.
2. Complete measured semantic assertions: unsupported claims, cited reasoning, review/disclaimers,
   Legal jurisdiction/playbook rules, HR prohibited decisions, Data numeric consistency and visual
   review quality. Existing partial expectations cannot overwrite observed adapter-blocked results.
3. Pin evaluator/model/source/corpus revisions and record native versioned evidence only after the
   complete required corpus passes. Keep the release predicate closed until that producer is tested;
   filtered or scripted runs cannot satisfy it.
4. Obtain the plan's owner review and authenticated responsive UAT for exact versions. Do not create
   the phase completion summary or activate candidates before those gates are earned.
