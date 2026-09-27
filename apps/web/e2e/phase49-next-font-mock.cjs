// Local production-build fixture. next/font asks for CSS by exact Google URL; this avoids
// network access in the isolated Phase 49 E2E build. Browser fallback handles invalid mock bytes.
module.exports = new Proxy(
  {},
  {
    get(_target, request) {
      const url = String(request);
      const family = url.includes("Bricolage")
        ? "Bricolage Grotesque"
        : url.includes("JetBrains")
          ? "JetBrains Mono"
          : "Public Sans";
      return `/* latin */\n@font-face {\n  font-family: '${family}';\n  font-style: normal;\n  font-weight: 100 900;\n  src: url(phase49-offline-font-bytes.woff2) format('woff2');\n}\n`;
    },
  },
);
