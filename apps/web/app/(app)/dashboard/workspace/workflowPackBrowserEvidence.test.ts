import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { expect, test } from "vitest";

// Execute the actual evidence callback without Playwright, authentication or a backend. An old
// persisted/imported observation must not turn the incomplete browser protocol into qualification.
test.each([
  {
    filename: "workflow-pack-pilot.spec.ts",
    endMarker: 'test.describe("@drill rollback"',
    code: "PACK_BROWSER_PROTOCOL_MISSING",
    writeFunction: "skills:recordPackBrowserEvidence",
  },
  {
    filename: "workflow-packs.spec.ts",
    endMarker: null,
    code: "TENANT_PACK_BROWSER_PROTOCOL_MISSING",
    writeFunction: "skills:recordTenantPackBrowserEvidence",
  },
])("$filename refuses fabricated observations without reads or writes", ({
  filename,
  endMarker,
  code,
  writeFunction,
}) => {
  const source = readFileSync(new URL(`../../../../e2e/${filename}`, import.meta.url), "utf8");
  const start = source.indexOf('test.describe("@evidence ');
  const end = endMarker === null ? source.length : source.indexOf(endMarker, start);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);

  const callbacks: (() => void)[] = [];
  let artifactReads = 0;
  let evidenceWrites = 0;
  const forged = {
    "Business pulse": 2,
    pass: true,
    authenticated: true,
    viewports: 2,
    casesPassed: 8,
    casesTotal: 8,
  };
  const register = Object.assign((_name: string, body: () => void) => callbacks.push(body), {
    describe: (_name: string, body: () => void) => body(),
  });
  runInNewContext(source.slice(start, end), {
    test: register,
    expect,
    readSeen: () => {
      artifactReads++;
      return forged;
    },
    readFileSync: () => {
      artifactReads++;
      return JSON.stringify(forged);
    },
    convexRun: () => evidenceWrites++,
    VIEWPORTS_SEEN: new Set(["1280x1400", "390x844"]),
    process: {
      env: { PIKAR_E2E_RUN_ID: "forged-complete-run", E2E_USER_EMAIL: "forged@example.test" },
    },
  });

  expect(callbacks).toHaveLength(1);
  expect(callbacks[0]).toThrow(`${code}: no evidence was written`);
  expect(artifactReads).toBe(0);
  expect(evidenceWrites).toBe(0);
  expect(source).not.toContain(`"${writeFunction}"`);
  expect(source).not.toContain(".auth/pack-seen-");
});
