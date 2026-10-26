import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

// Preparation only: no credentials, network client, paid generation or model mutation.
const body = readFileSync(
  new URL("../../contracts/skills/media-director.md", import.meta.url),
  "utf8",
).replace(/\r\n/g, "\n");
const cases = [
  {
    id: "forma-15",
    seconds: 15,
    brief:
      "Fictional FORMA black bottle. No functional claims. Reveal, purposeful overhead detail, closing brand invitation. Use the identical approved reference fixture for both models.",
  },
  {
    id: "forma-30",
    seconds: 30,
    brief:
      "Same fictional FORMA bottle and approved kit. Wide camera rise, overhead cap detail, quarter orbit and held hero. Motivate the lighting change; no invented features.",
  },
  {
    id: "batch-isolation",
    seconds: 15,
    brief:
      "Two distinct fictional product variants with separate approved reference fixtures. Produce each independently; never exchange their names, colours or references.",
  },
];
process.stdout.write(
  `${JSON.stringify(
    {
      status: "prepared_not_executed",
      paidCalls: 0,
      skillSha256: createHash("sha256").update(body).digest("hex"),
      candidates: ["openai/gpt-4.1-mini", "moonshotai/kimi-k3.1-pro"],
      candidateSource: "https://platform.kimi.ai/docs/guide/kimi-k3-1-pro-quickstart",
      productionDefaultChanged: false,
      cases,
      executionRequirements: [
        "Separate bounded cost approval before any director call. No media generation in this comparison.",
        "Run the actual production tool/schema path with the same brief, approved brand revision, reference hashes, vault fixtures and director body for both candidates.",
        "Record requested AND executed model, fallback, timeout, token usage and provider cost; reject fallback results as candidate evidence.",
        "Use the production 90-second primary timeout; record time-to-valid-deck. Do not silently increase a candidate timeout.",
        "Require two parseable variations, exact durations, legal renderer fields, grounded claims and tenant/product isolation before blind creative scoring.",
        "Run three paired repetitions per case only after budget approval; this small set is qualification evidence, not statistical proof.",
      ],
      rubric: [
        "message and closing action",
        "camera start/end specificity",
        "transition continuity",
        "approved brand and product fidelity",
        "feasible typography",
        "audio continuity intent",
        "distinct creative alternatives",
      ],
      scoring:
        "Blind 0-4 per dimension by the same reviewer. Publish both outputs and structural failures. A creative win cannot compensate for invalid decks or unsupported claims.",
      promotion:
        "No automatic promotion. Compare valid-deck rate, blind creative score, latency and measured cost; owner reviews evidence before any routing change.",
    },
    null,
    2,
  )}\n`,
);
