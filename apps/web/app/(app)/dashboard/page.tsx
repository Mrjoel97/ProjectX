// Authenticated landing. The shell (nav + live dead-letter badge) is in (app)/layout.tsx;
// this is the plain dashboard body. Real widgets (recent requests, review queue) arrive
// with the pages in 02-08/09 — YAGNI until those queries exist.
export default function Dashboard() {
  return (
    <section className="prose">
      <h1>Dashboard</h1>
      <p>
        Welcome to Pikar. Submit a goal and it is planned, held for your approval, then
        executed under guardrails — every step written to a log it cannot edit.
      </p>
    </section>
  );
}
