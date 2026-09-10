// CI bridge: the implementation and its offline assertions live beside the phase's evidence.
// No deployment reads, auth, model calls or generated evidence.
if (process.argv.slice(2).length !== 1 || process.argv[2] !== "--self-check") {
  process.stderr.write("Use --self-check for offline artifact-validator assertions.\n");
  process.exitCode = 1;
} else {
  await import("../.planning/phases/23-agent-authored-skills/validate-live-artifact.test.mjs");
}
