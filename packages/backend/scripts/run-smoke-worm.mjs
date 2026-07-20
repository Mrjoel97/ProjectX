// SC-4 (WORM half) smoke: run the export action against the live dev deployment.
// Reuses smokeRun.must, which judges pass/fail by the CLI's OUTPUT — the convex CLI
// returns a bogus non-zero exit code on Windows/Node24 (UV_HANDLE_CLOSING) even on
// success.
//
// TWO modes, chosen by the LOCAL `WORM_BUCKET` env of THIS node process:
//   - unset (default): assert the action takes the clean stub-skip path.
//   - set: the operator is exercising a real Object-Lock bucket. The deployment must
//     ALSO have WORM_BUCKET + AWS creds set (`npx convex env set`, NEVER Vercel).
//     Assert the action reports an export count (NOT the skip line). S3 durability
//     (ObjectLockMode / RetainUntilDate / checksum on the written object) is NOT
//     asserted from Node — that is the manual S3-console check (07-VALIDATION
//     Manual-Only); this smoke only proves the action runs against a live deployment.
import { must } from "./smokeRun.mjs";

const SKIP_LINE = /worm export skipped \(stub\)/;

if (!process.env.WORM_BUCKET) {
  console.log("[smoke:worm] running worm:exportAudit (expecting stub-skip)...");
  const out = must("worm:exportAudit", {});
  if (!SKIP_LINE.test(out)) {
    console.error(out);
    throw new Error("[smoke:worm] did not observe 'worm export skipped (stub)' in output");
  }
  console.log("[smoke:worm] PASSED — worm:exportAudit logged 'worm export skipped (stub)'");
} else {
  console.log("[smoke:worm] WORM_BUCKET set — running worm:exportAudit (expecting a real export)...");
  const out = must("worm:exportAudit", {});
  if (SKIP_LINE.test(out)) {
    console.error(out);
    throw new Error("[smoke:worm] took the stub-skip path but WORM_BUCKET is set (deployment env missing?)");
  }
  // The action returns { exported: N, ... }; `convex run` prints it to stdout.
  const m = out.match(/"exported":\s*(\d+)/);
  if (!m) {
    console.error(out);
    throw new Error("[smoke:worm] did not observe an export count in output");
  }
  console.log(
    `[smoke:worm] PASSED — worm:exportAudit exported ${m[1]} row(s). ` +
      "Now confirm ONE object in the S3 console carries ObjectLockMode + RetainUntilDate + checksum.",
  );
}
