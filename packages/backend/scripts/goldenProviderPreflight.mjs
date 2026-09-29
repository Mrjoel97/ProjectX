import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const PREFLIGHT_PASSED_LINE =
  "[eval:golden] provider preflight PASSED (secret-safe; no budget opened)";
export const PREFLIGHT_REFUSAL_REASONS = Object.freeze([
  "openrouter_key_missing_or_invalid",
  "tavily_key_missing_or_invalid",
  "openrouter_billing_attestation_invalid",
  "tavily_billing_attestation_invalid",
  "tavily_credit_attestation_invalid",
  "backend_unavailable",
  "production_target_forbidden",
  "named_nonproduction_target_required",
  "transport_error",
  "readiness_response_invalid",
  "local_provider_egress_unavailable",
]);
const PREFLIGHT_REFUSAL_REASON_SET = new Set(PREFLIGHT_REFUSAL_REASONS);

export function preflightRefusedLine(reason) {
  if (!PREFLIGHT_REFUSAL_REASON_SET.has(reason))
    throw new Error("PREFLIGHT_REFUSAL_REASON_INVALID");
  return `[eval:golden] provider preflight REFUSED reason=${reason} (secret-safe; no budget opened)`;
}

export class ProviderPreflightRefusal extends Error {
  constructor(reason) {
    if (!PREFLIGHT_REFUSAL_REASON_SET.has(reason))
      throw new Error("PREFLIGHT_REFUSAL_REASON_INVALID");
    super("GOLDEN_PROVIDER_PREFLIGHT_REFUSED");
    this.name = "ProviderPreflightRefusal";
    this.reason = reason;
  }
}

const backendEnvPath = resolve(dirname(fileURLToPath(import.meta.url)), "..", ".env.local");

const localProviderHosts = Object.freeze(["openrouter.ai", "api.tavily.com"]);
const tcpProbeSource =
  "const s=require('node:net').connect({host:process.argv[1],port:443,timeout:3000});" +
  "s.once('connect',()=>{s.destroy();process.exit(0)});" +
  "s.once('error',()=>process.exit(2));" +
  "s.once('timeout',()=>{s.destroy();process.exit(2)});";

function probeLocalProviderHost(host) {
  const result = spawnSync(process.execPath, ["-e", tcpProbeSource, host], {
    timeout: 5000,
    windowsHide: true,
    stdio: "ignore",
  });
  return !result.error && result.status === 0;
}

/** No request bytes, credentials, or paid call: a local runner must be able to open both
 * provider TCP routes before it opens an evaluation budget. A cloud target's egress is not
 * inferred from this CLI machine and is deliberately outside this local-only check. */
export function assertGoldenLocalProviderEgress(
  env = process.env,
  envFile = existsSync(backendEnvPath) ? readFileSync(backendEnvPath, "utf8") : "",
  probe = probeLocalProviderHost,
) {
  const local =
    Boolean(env.PIKAR_GOLDEN_LOCAL_INSTANCE?.trim()) ||
    env.CONVEX_DEPLOYMENT?.trim().startsWith("local:") ||
    /^CONVEX_DEPLOYMENT\s*=\s*["']?local:/m.test(envFile);
  if (!local) return true;
  for (const host of localProviderHosts)
    if (!probe(host)) throw new ProviderPreflightRefusal("local_provider_egress_unavailable");
  return true;
}

/** The shared Convex runner permits a production override for other smoke gates. A golden run
 * also needs an explicit named dev/local selection: a live anonymous listener is not a qualified
 * target. Self-hosted Convex CLI calls cannot combine CONVEX_DEPLOYMENT with the self-hosted URL
 * and admin key, so that route uses a separate process-scoped instance declaration. This is
 * necessary but not sufficient; operators still verify /instance_name and source. */
export function assertGoldenNonProductionTarget(
  env = process.env,
  envFile = existsSync(backendEnvPath) ? readFileSync(backendEnvPath, "utf8") : "",
) {
  if (env.PIKAR_CONVEX_TARGET === "prod")
    throw new ProviderPreflightRefusal("production_target_forbidden");
  const declarations = (key) =>
    [...envFile.matchAll(new RegExp(`^${key}\\s*=\\s*([^\\r\\n#]*)`, "gm"))].map((row) =>
      row[1]
        .trim()
        .replace(/^(?:"([^"]*)"|'([^']*)')$/, (_match, double, single) => double ?? single),
    );
  const fileDeployment = declarations("CONVEX_DEPLOYMENT");
  const ambientDeployment = env.CONVEX_DEPLOYMENT?.trim();
  const localInstance = env.PIKAR_GOLDEN_LOCAL_INSTANCE?.trim();
  if (localInstance) {
    const selfHostedUrls = declarations("CONVEX_SELF_HOSTED_URL");
    const ambientSelfHostedUrl = env.CONVEX_SELF_HOSTED_URL?.trim();
    const fileUrls = declarations("CONVEX_URL");
    const ambientUrl = env.CONVEX_URL?.trim();
    if (
      !/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(localInstance) ||
      fileDeployment.length !== 0 ||
      ambientDeployment ||
      !env.CONVEX_SELF_HOSTED_ADMIN_KEY?.trim() ||
      selfHostedUrls.length > 1 ||
      (ambientSelfHostedUrl &&
        selfHostedUrls.length === 1 &&
        ambientSelfHostedUrl !== selfHostedUrls[0]) ||
      fileUrls.length > 1 ||
      (ambientUrl && fileUrls.length === 1 && ambientUrl !== fileUrls[0])
    )
      throw new ProviderPreflightRefusal("named_nonproduction_target_required");
    const target = ambientSelfHostedUrl || selfHostedUrls[0];
    try {
      const url = new URL(target);
      const declaredUrl = ambientUrl || fileUrls[0];
      const comparable = declaredUrl ? new URL(declaredUrl) : null;
      if (
        !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) ||
        !["http:", "https:"].includes(url.protocol) ||
        url.username ||
        url.password ||
        url.search ||
        url.hash ||
        url.pathname !== "/" ||
        (comparable &&
          (comparable.origin !== url.origin ||
            comparable.pathname !== "/" ||
            comparable.search ||
            comparable.hash ||
            comparable.username ||
            comparable.password))
      )
        throw new Error("local target mismatch");
    } catch {
      throw new ProviderPreflightRefusal("named_nonproduction_target_required");
    }
    return true;
  }
  if (
    fileDeployment.length > 1 ||
    (ambientDeployment && fileDeployment.length === 1 && ambientDeployment !== fileDeployment[0])
  )
    throw new ProviderPreflightRefusal("named_nonproduction_target_required");
  const deployment = ambientDeployment || fileDeployment[0] || null;
  const match = /^(dev|local):([A-Za-z0-9][A-Za-z0-9_-]*)$/.exec(deployment ?? "");
  if (!match) throw new ProviderPreflightRefusal("named_nonproduction_target_required");
  // The Convex CLI refuses this combination even if the two declarations describe the same
  // instance. Do not let an empty CLI result masquerade as a malformed readiness response.
  if (env.CONVEX_SELF_HOSTED_URL?.trim() || declarations("CONVEX_SELF_HOSTED_URL").length)
    throw new ProviderPreflightRefusal("named_nonproduction_target_required");
  const explicitUrls = [];
  for (const key of ["CONVEX_URL", "CONVEX_SELF_HOSTED_URL"]) {
    const fileUrls = declarations(key);
    const ambientUrl = env[key]?.trim();
    if (fileUrls.length > 1 || (ambientUrl && fileUrls.length === 1 && ambientUrl !== fileUrls[0]))
      throw new ProviderPreflightRefusal("named_nonproduction_target_required");
    const value = ambientUrl || fileUrls[0];
    if (value) explicitUrls.push({ key, value });
  }
  for (const { key, value } of explicitUrls) {
    let url;
    try {
      url = new URL(value);
    } catch {
      throw new ProviderPreflightRefusal("named_nonproduction_target_required");
    }
    if (
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      (match[1] === "local"
        ? !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) ||
          !["http:", "https:"].includes(url.protocol)
        : key === "CONVEX_SELF_HOSTED_URL" ||
          url.protocol !== "https:" ||
          url.hostname !== `${match[2]}.convex.cloud`)
    )
      throw new ProviderPreflightRefusal("named_nonproduction_target_required");
  }
  return true;
}

/**
 * Standalone preflight owns its terminal line and exit code. Backend/CLI errors are deliberately
 * not interpolated: deployment stderr can contain configuration details, while callers need only
 * the fail-closed verdict before deciding whether a paid run is allowed.
 */
export function runStandaloneProviderPreflight({
  check,
  // Synchronous writes are intentional: the caller immediately uses `process.exit(code)`, whose
  // forced termination may truncate asynchronous console output when stdout/stderr are pipes.
  stdout = (line) => writeSync(1, `${line}\n`),
  stderr = (line) => writeSync(2, `${line}\n`),
}) {
  try {
    check();
    stdout(PREFLIGHT_PASSED_LINE);
    return 0;
  } catch (error) {
    // Unknown errors are a transport failure, never printable diagnostic material. In particular,
    // do not echo Error.message: Convex/CLI failures may contain deployment URLs or config values.
    const reason = error instanceof ProviderPreflightRefusal ? error.reason : "transport_error";
    stderr(preflightRefusedLine(reason));
    return 2;
  }
}
