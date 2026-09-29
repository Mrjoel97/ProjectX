import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { argv, exit, stdout } from "node:process";

const forbidden = [
  /(?:custom domain|domain ownership) (?:is |has been )?(?:verified|complete|proven)/i,
  /(?:dns|tls) (?:is |has been )?(?:configured|active|verified|complete)/i,
  /(?:hosting|provider|form) (?:is |has been )?(?:approved|enabled|verified)/i,
  /legal entity (?:is |has been )?(?:registered|formed|verified)/i,
  /(?:paid|provider) (?:evaluation|diagnostic|probe) (?:passed|complete|approved)/i,
  /production (?:acceptance|traffic) (?:passed|complete|verified)/i,
  /wave 8 (?:is |has been )?(?:accepted|complete|qualified|approved)/i,
];

export function overclaims(source) {
  return source
    .split(/\r?\n/)
    .flatMap((line, index) =>
      forbidden.some((pattern) => pattern.test(line))
        ? [{ line: index + 1, text: line.trim() }]
        : [],
    );
}

function selfTest() {
  const green = [
    "Custom domains remain pending and unproven.",
    "DNS/TLS evidence is required in Wave 7.",
    "The legal entity registration number is pending.",
    "Wave 8 founder qualification remains separate.",
  ];
  const red = [
    "Custom domain ownership is verified.",
    "DNS is configured and TLS is active.",
    "The legal entity is registered.",
    "Production acceptance passed.",
    "Wave 8 is qualified.",
  ];
  let failures = 0;
  for (const fixture of green) if (overclaims(fixture).length) failures += 1;
  for (const fixture of red) if (!overclaims(fixture).length) failures += 1;
  stdout.write(
    failures
      ? `Phase 48 claim-guard self-test FAILED (${failures}).\n`
      : "Phase 48 claim-guard self-test PASSED.\n",
  );
  return failures ? 1 : 0;
}

if (argv.includes("--self-test")) exit(selfTest());

const files = [
  ".planning/phases/48-business-website-and-landing-page-runtime/48-01-SUMMARY.md",
  ".planning/phases/48-business-website-and-landing-page-runtime/48-02-SUMMARY.md",
  ".planning/phases/48-business-website-and-landing-page-runtime/48-03-SUMMARY.md",
  ".planning/phases/48-business-website-and-landing-page-runtime/48-04-SUMMARY.md",
  ".planning/phases/48-business-website-and-landing-page-runtime/48-05-SUMMARY.md",
  "docs/releases/phase-48-wave7-reentry.md",
  "docs/playbooks/public-web-runtime.md",
];
let failures = 0;
for (const file of files) {
  const hits = overclaims(readFileSync(resolve(file), "utf8"));
  for (const hit of hits) {
    failures += 1;
    stdout.write(`${file}:${hit.line}: Phase 48 external-acceptance overclaim: ${hit.text}\n`);
  }
}
stdout.write(
  failures
    ? `Phase 48 claim guard FAILED (${failures}).\n`
    : "Phase 48 claim guard green: Wave 7/8 remain explicit and unproven.\n",
);
exit(failures ? 1 : 0);
