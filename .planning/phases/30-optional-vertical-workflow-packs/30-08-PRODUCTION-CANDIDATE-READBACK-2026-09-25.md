# Plan 30-08 production candidate read-back — 2026-09-25

**Observed:** 2026-09-25 04:29 UTC. This is a read-only, production-registry
checkpoint for the six optional vertical skill bodies. It is not model evaluation,
semantic review, candidate activation, pack exposure or VERT closure.

The deployment-name token in the production-scoped key already held in `.env`
matched the independently recorded SHA-256 fingerprint
`9067eabf7231a8e473de213cd304fa2fe52ec444e752e5ee9947cb0d29cbd055`
for `opulent-octopus-494`. The key was process-local and restored afterward.
Read-only `convex run --inline-query` calls used no push, codegen or typecheck.
They selected exact `skills` names/versions/statuses; candidate bodies were
hashed in memory and never printed. Each remote SHA-256 matches its current
`packages/contracts/packs/vertical/<lane>/skill.md` LF-normalized bytes.

| Skill | Candidate row ID | Version/status | Body SHA-256 |
| --- | --- | --- | --- |
| `vertical-data` | `ph7be076gtenkz82cv41xsjznh8e92x9` | 1 / candidate | `bf826e37a1acddc4bdb98b7dd3690a7e87c943ac7ef47952337e3d844d71018c` |
| `vertical-product` | `ph7ds1qx0xt5mqy0re3gtwn74h8e87a2` | 1 / candidate | `1c8fce876068f8fac41e61a6cfa98d72b15ee0067bc8c4154827428da51eef52` |
| `vertical-design` | `ph74m0gtz8m0yg3g4gtzm5wjb98e9mv3` | 1 / candidate | `94d93b40411027db99ebbe013668ce9cb65e0fe9a6f6282ebcd37f4ea1f54cd6` |
| `vertical-legal` | `ph713pd64r3wjpxtac5jmnh9kx8e8xt2` | 1 / candidate | `f1c8e4dc72f8bc3a51578c06d71b775fe9c6524ed247daffb097968864f36960` |
| `vertical-hr` | `ph73qg0t362gf27qmz2dee99tn8e9t31` | 1 / candidate | `a0de6fa9b4cd3761271b1040cd47fc49b99752eee0dd452d667850b5d84a19b8` |
| `vertical-engineering` | `ph769wc01qeqrh69qsc69dw9r58e9ybn` | 1 / candidate | `b794b08a07d521de28f57e15bef6210c0a33f18c405493190962d3b118966e71` |

For all six names the active-row read returned `null`, and the latest row was
the candidate v1 above. The same bounded query found no `vertical-bio` active
or latest row. This proves the named global skill rows' current status, not the
absence of every possible product route or pack exposure. It also does not
prove provenance columns, passing eval evidence, source retrieval quality,
high-stakes Legal/HR attestation, or a second evaluated version. Re-read exact
rows before any later paid run or activation; do not treat this timestamp as
future-state authority.
