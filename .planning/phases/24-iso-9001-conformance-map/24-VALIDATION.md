---
phase: 24
slug: iso-9001-conformance-map
status: draft
nyquist_compliant: true
wave_0_complete: true
created: 2026-08-10
---

# Phase 24 — Validation Strategy

> Per-phase validation contract for an evidence map that must remain thin, truthful, and tied to
> the controls the repository actually operates.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Node assertions for the Markdown artifact; existing Vitest/convex-test suites for cited controls; existing eval self-check |
| **Config file** | Existing repository/package configs; no new framework or dependency |
| **Quick run command** | `node -e "const s=require('fs').readFileSync('docs/governance/iso-9001-conformance-map.md','utf8'); if(!s.includes('ISO 9001:2015')) throw new Error('missing baseline'); console.log('map readable')"` |
| **Full suite command** | `pnpm --filter @pikar/backend exec vitest run convex/auditImmutability.test.ts convex/worm.test.ts convex/skills.test.ts convex/deadLetters.test.ts convex/notifications.test.ts --maxWorkers=1` plus `node packages/backend/scripts/run-eval-golden.mjs --self-check` and `node scripts/check-playbooks.mjs check` |
| **Estimated runtime** | ~3–5 minutes offline; live WORM/certification review remain manual-only |

---

## Sampling Rate

- **After every task commit:** Run the task's Node/static assertion or targeted existing control
  suite.
- **After every plan wave:** Run the full offline suite above and the conformance-map integrity
  assertions.
- **Before `$gsd-verify-work`:** Full offline suite green, every local evidence pointer resolved,
  owner claim-boundary review complete, and live-only evidence labelled honestly.
- **Max feedback latency:** 5 minutes offline.

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 24-01-01 | 01 | 1 | GOVN-02 groundwork | static structure/claim boundary | `node -e "const fs=require('fs'); const p='docs/governance/iso-9001-conformance-map.md'; const s=fs.readFileSync(p,'utf8'); for(const x of ['ISO 9001:2015','Amendment 1:2024','defined scope','not a certificate']) if(!s.toLowerCase().includes(x.toLowerCase())) throw new Error('missing '+x); console.log('ok')"` | ❌ created in task |
| 24-01-02 | 01 | 1 | GOVN-02 groundwork | evidence-family control suites | `pnpm --filter @pikar/backend exec vitest run convex/auditImmutability.test.ts convex/worm.test.ts convex/skills.test.ts convex/deadLetters.test.ts convex/notifications.test.ts --maxWorkers=1` | ✅ existing |
| 24-01-03 | 01 | 1 | GOVN-02 groundwork | static clause/status coverage + eval self-check | `node packages/backend/scripts/run-eval-golden.mjs --self-check` plus the plan's Node map assertion | ✅ existing runner / assertion created in task |
| 24-02-01 | 02 | 2 | GOVN-02 | exact corrective-action header and evidence-chain review | Run the exact **Corrective-action index assertion** below, followed by opening every linked artifact | ❌ map section created in task |
| 24-02-02 | 02 | 2 | GOVN-02 | matrix/index structure, status vocabulary, pointer resolution and anti-overclaim | Run the exact **Map integrity assertion** below | ❌ map tables created during execution; one-off assertion is plan-owned and persists no checker |
| 24-02-03 | 02 | 2 | GOVN-02 | human semantic review | Manual-only owner review of scope, applicability, gap dispositions, and claim language | n/a | ⬜ pending |
| 24-02-04 | 02 | 2 | GOVN-02 | same map-integrity assertion, then full offline regression + doc-control check | Rerun the exact **Map integrity assertion** below, then the Full suite command and doc diff check | ✅ existing controls; map supplied by prior tasks |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Corrective-Action Index Assertion

Task 24-02-01 parses the exact six headers, including the spaces around each slash, then requires
exactly two complete rows and the four mandatory file pointers.

~~~bash
node -e "const fs=require('fs'),s=fs.readFileSync('docs/governance/iso-9001-conformance-map.md','utf8'),lines=s.split(/\r?\n/),split=l=>l.trim().replace(/^\||\|$/g,'').split('|').map(x=>x.trim()),h=['nonconformity / observed effect','containment / immediate correction','cause evidence','corrective action / recurrence prevention','effectiveness evidence','closure / disposition and owner / date'],at=lines.findIndex(l=>{const c=split(l);return c.length===h.length&&h.every((v,i)=>c[i].toLowerCase()===v)});if(!s.includes('## Corrective-action evidence index'))throw Error('missing index heading');if(at===-1)throw Error('missing exact corrective-action header');const rows=[];for(let i=at+2;i<lines.length&&/^\s*\|/.test(lines[i]);i++)rows.push(split(lines[i]));if(rows.length!==2)throw Error('expected exactly two evidence chains');rows.forEach((r,i)=>{if(r.length!==6||r.some(x=>!x))throw Error('incomplete index row '+(i+1))});const body=rows.flat().join(' ');for(const x of ['repo:.planning/phases/19-contacts-crm-follow-ups/19-10-SUMMARY.md','repo:.planning/phases/19-contacts-crm-follow-ups/19-13-SUMMARY.md','repo:.planning/phases/07-resilience-operations-hardening/07-06-SUMMARY.md','repo:.planning/phases/07-resilience-operations-hardening/07-VERIFICATION.md','splice'])if(!body.toLowerCase().includes(x.toLowerCase()))throw Error('missing chain evidence '+x);console.log('ok: exact header and two complete evidence chains')"
~~~

---

## Map Integrity Assertion

Tasks 24-02-02 and 24-02-04 run this exact same one-off command. It parses the two closed table
contracts, requires every row field, and rejects any status outside the five-value vocabulary.
Every local pointer is a typed `repo:` reference: the command accepts any safe repo-relative root,
strips symbol/anchor suffixes, rejects untyped path-like code spans, and fails if any path does not
exist. URLs, commands, commits, runs, and symbols are explicitly non-path reference classes.

~~~bash
node -e "const fs=require('fs'),p='docs/governance/iso-9001-conformance-map.md',s=fs.readFileSync(p,'utf8'),lines=s.split(/\r?\n/),split=l=>l.trim().replace(/^\||\|$/g,'').split('|').map(x=>x.trim()),table=h=>{const at=lines.findIndex(l=>{const c=split(l);return c.length===h.length&&h.every((v,i)=>c[i].toLowerCase()===v)});if(at===-1)throw Error('missing table: '+h.join(', '));const out=[];for(let i=at+2;i<lines.length&&/^\s*\|/.test(lines[i]);i++)out.push(split(lines[i]));if(out.length===0)throw Error('empty table: '+h[0]);return out},mh=['clause','intent','status','evidence','control','limitation / gap','verification'],ih=['nonconformity / observed effect','containment / immediate correction','cause evidence','corrective action / recurrence prevention','effectiveness evidence','closure / disposition and owner / date'],main=table(mh),idx=table(ih),allowed=new Set(['Direct — defined scope','Supporting','Partial — gap named','Not assessed — organization-wide','Not applicable — justified']);main.forEach((r,i)=>{if(r.length!==7||r.some(x=>!x))throw Error('incomplete matrix row '+(i+1));if(!allowed.has(r[2]))throw Error('invalid status '+r[2])});idx.forEach((r,i)=>{if(r.length!==6||r.some(x=>!x))throw Error('incomplete index row '+(i+1))});for(const c of ['4.1','4.2','4.3','7.5','8.3','8.5.1','8.5.6','8.6','9.1','9.2','9.3','10.2','10.3'])if(!main.some(r=>r[0].includes(c)))throw Error('missing clause '+c);const texts=main.map(r=>r[3]).concat(idx.flat()),paths=[],prose=s.replace(/```[\s\S]*?```/g,''),command=/^(?:node|pnpm|npm|npx|git|rg|vitest|pwsh|powershell)(?:\s|$)/,pathlike=/^(?:\.{0,2}[\/\\]|[^:\s]+[\/\\]|[^:\s]+\.[A-Za-z][A-Za-z0-9]{0,11}(?:#.*)?$)/;for(const m of prose.matchAll(/`([^`\n]+)`/g)){const x=m[1].trim();if(x.startsWith('repo:')){const raw=x.slice(5);if(!raw||/[\s?]/.test(raw)||/^[/\\]/.test(raw)||/^[A-Za-z]:/.test(raw)||raw.includes('\\')||raw.split('/').includes('..'))throw Error('invalid repo reference '+x);if(/:\d+(?::\d+)?(?:#.*)?$/.test(raw))throw Error('line-number pointer '+x);const q=raw.split('#')[0];if(!fs.existsSync(q))throw Error('missing evidence path '+q);paths.push(q)}else if(/^(?:commit|run|symbol):/.test(x)||/^https?:\/\//.test(x)||command.test(x))continue;else if(pathlike.test(x))throw Error('untyped local path; use repo: '+x)}for(const text of texts){if(/`repo:[^`\n]+`/.test(text))continue;const status=main.find(r=>r[3]===text)?.[2];if(status&&!status.startsWith('Not '))throw Error('mapped evidence lacks repo reference: '+text)}if(paths.length===0)throw Error('no repo evidence paths extracted');for(const bad of ['Pikar is ISO certified','customers are ISO certified','fully compliant','100% conformant'])if(s.toLowerCase().includes(bad.toLowerCase()))throw Error('forbidden claim '+bad);console.log('ok: '+main.length+' matrix rows, '+idx.length+' index rows, '+new Set(paths).size+' local paths')"
~~~

---

## Wave 0 Requirements

Existing infrastructure covers all phase requirements. This phase adds no product logic, table,
QMS runtime, parser, or test framework. The map's non-trivial claims are checked through bounded
Node assertions and the cited control suites rather than a new compliance engine.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Clause applicability and claim boundary are semantically honest | GOVN-02 | Applicability and certification language require judgment; syntax cannot establish conformity | Owner reads scope/status/gap rows and confirms the map does not claim certification or organization-wide conformity; obtain qualified ISO review before any external conformity statement |
| Real S3 Object Lock durability/delete refusal | GOVN-02 evidence boundary | Requires configured AWS Object-Lock infrastructure and credentials | Cite dated live evidence only if a real object shows COMPLIANCE mode, retention/checksum, and refused delete; otherwise retain `conditional/unverified in live infrastructure` |
| Clauses 5, 7.2–7.4, 9.2, and 9.3 remain organization-wide/not assessed | GOVN-02 anti-theater boundary | Repository tests cannot prove leadership policy, competence, internal-audit program, or management review | Confirm these rows are not relabelled from owner checkpoints, CI, GSD verification, or product authorization controls |
| ISO edition re-baseline | GOVN-02 maintenance | The next ISO 9001 edition is not yet this phase's published baseline | Confirm the map names 2015 + Amd 1:2024 and a future review trigger, without guessing new-edition requirements |

---

## Anti-Vacuity Rules

- A clause row with only a policy/playbook link and no operating control is `Supporting`, never
  `Direct`.
- A 10.2 row with only `deadLetters.status: resolved` fails validation; every seeded corrective
  action chain needs observation, cause, action, effectiveness, and closure evidence.
- An 8.6 row cannot claim a specific release from the runner's existence; it needs an exact
  version/run/evidence/activation record. The general map must state bootstrap and ungated-skill
  exceptions.
- A 7.5 preservation claim that cites `worm.ts` without real Object-Lock evidence remains
  conditional.
- `Not applicable` requires a written justification; unknown company-process evidence is `Not
  assessed`.
- The words `certified`, `compliant`, or `conformant` may appear only inside the explicit claim
  boundary/prohibition or clearly scoped artifact title—not as an unqualified project verdict.

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or explicit Manual-Only coverage
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references (none; existing infrastructure is reused)
- [x] No watch-mode flags
- [x] Feedback latency < 5 minutes offline
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** planned 2026-08-10; execution pending
