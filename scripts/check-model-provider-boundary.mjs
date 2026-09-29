// Prevent a production Convex feature from quietly creating a private SDK model route.
// This is an AST module-boundary check, not a claim to recognize arbitrary raw HTTP routing.
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
// TypeScript 7's top-level package exports only version metadata. Pin the stable
// TypeScript 5 compiler API explicitly for this syntax-tree gate.
import ts from "typescript-ast";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const convexRoot = join(root, "packages", "backend", "convex");
const owners = new Set(["lib/models.ts", "llm.ts"]);
const providerPackages = [
  "@ai-sdk/openai",
  "@openrouter/ai-sdk-provider",
  "@ai-sdk/google",
  "@ai-sdk/google-vertex",
];
const isProvider = (specifier) =>
  providerPackages.some((name) => specifier === name || specifier.startsWith(`${name}/`));

function moduleText(node) {
  if (ts.isStringLiteralLike(node)) return node.text;
  if (ts.isParenthesizedExpression(node)) return moduleText(node.expression);
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    const left = moduleText(node.left);
    const right = moduleText(node.right);
    return left === null || right === null ? null : left + right;
  }
  return null;
}

export function scanSource(source, path) {
  if (owners.has(path)) return [];
  const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const findings = [];
  const check = (node, expression) => {
    const value = moduleText(expression);
    // A computed dynamic import/require cannot be proven not to be a provider package.
    if (value === null || isProvider(value)) {
      const line = file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1;
      findings.push(`${path}:${line}: ${value === null ? "computed module specifier" : value}`);
    }
  };
  const visit = (node) => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier) {
      check(node, node.moduleSpecifier);
    } else if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference)
    ) {
      if (node.moduleReference.expression) check(node, node.moduleReference.expression);
    } else if (
      ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) && node.expression.text === "require"))
    ) {
      if (node.arguments.length !== 1) {
        findings.push(
          `${path}:${file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1}: computed module specifier`,
        );
      } else {
        check(node, node.arguments[0]);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return findings;
}

function productionFiles(dir = convexRoot) {
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "_generated" || entry.name === "node_modules") continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...productionFiles(path));
    else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) files.push(path);
  }
  return files;
}

function scanTree() {
  return productionFiles().flatMap((path) =>
    scanSource(readFileSync(path, "utf8"), relative(convexRoot, path).replaceAll("\\", "/")),
  );
}

function selfTest() {
  const bad = [
    'import { openai as P } from "@ai-sdk/openai"; const pickModel = (id) => P(id);',
    'import { OpenAIChatLanguageModel } from "@ai-sdk/openai/internal";',
    'import P from "@ai-sdk/openai"; export default P;',
    '  export { openai } from "@ai-sdk/openai";',
    'const P = require("@ai-sdk/openai"); P("gpt-4o-mini");',
    'const P = await import("@ai-sdk/" + "openai");',
    "const P = await import(providerPackage);",
    'import P = require("@openrouter/ai-sdk-provider");',
  ];
  for (const source of bad) {
    if (scanSource(source, "feature.ts").length !== 1) return false;
  }
  const safe = [
    'import { resolveModel } from "./lib/models"; export const model = resolveModel("or/openai/gpt-4o-mini");',
    '// import { openai } from "@ai-sdk/openai";',
    'const x = await import("unpdf");',
  ];
  return safe.every((source) => scanSource(source, "feature.ts").length === 0);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.includes("--self-test")) {
    if (!selfTest()) {
      console.error("model-provider boundary self-test failed");
      process.exitCode = 1;
    } else {
      const findings = scanTree();
      if (findings.length) {
        console.error(findings.join("\n"));
        process.exitCode = 1;
      } else console.log("model-provider boundary: 11 controls and production tree passed");
    }
  } else {
    const findings = scanTree();
    if (findings.length) {
      console.error(findings.join("\n"));
      process.exitCode = 1;
    } else console.log("model-provider boundary: production Convex SDK imports remain owned");
  }
}
