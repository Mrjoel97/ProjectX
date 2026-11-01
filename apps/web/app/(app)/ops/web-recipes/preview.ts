/** Presentation-only isolation. The server's artifact hash still identifies the original bytes. */
export function inertRecipePreview(html: string): string {
  const doc = new DOMParser().parseFromString(html, "text/html");
  for (const node of doc.querySelectorAll("script,base,meta,link,iframe,object,embed,svg,math"))
    node.remove();
  for (const node of doc.querySelectorAll("*")) {
    for (const attribute of [...node.attributes]) {
      if (
        /^on/i.test(attribute.name) ||
        [
          "src",
          "srcset",
          "href",
          "action",
          "formaction",
          "poster",
          "background",
          "target",
        ].includes(attribute.name.toLowerCase())
      ) {
        node.removeAttribute(attribute.name);
      }
    }
    if (node.matches("input,button,select,textarea")) node.setAttribute("disabled", "");
    if (node.matches("a")) node.setAttribute("aria-disabled", "true");
  }
  const policy = doc.createElement("meta");
  policy.httpEquiv = "Content-Security-Policy";
  policy.content =
    "default-src 'none'; style-src 'unsafe-inline'; img-src 'none'; base-uri 'none'; form-action 'none'; frame-src 'none'; connect-src 'none'";
  doc.head.prepend(policy);
  return `<!doctype html>${doc.documentElement.outerHTML}`;
}
