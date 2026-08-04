import type { ReactNode } from "react";
import "./auth.css";
import { BoltIcon, BrainIcon, ShieldIcon, StarIcon } from "./icons";

// Shared chrome for /signin and /signup: left = marketing (static), right = the teal
// panel that holds the auth card (the page). The marketing panel hides on small screens
// so the card gets the full width.
const FEATURES = [
  { icon: <BoltIcon />, title: "Lightning Speed", desc: "Processing power that keeps up" },
  { icon: <BrainIcon />, title: "Deep Intelligence", desc: "Adaptive learning that evolves" },
  {
    icon: <ShieldIcon />,
    title: "Bank-Grade Security",
    desc: "Enterprise encryption & compliance",
  },
];

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="auth-split">
      <aside className="auth-aside">
        <div className="auth-brand">
          <span className="auth-brand-tile">
            <StarIcon size={20} />
          </span>
          Pikar AI
        </div>

        <div className="auth-aside-mid">
          <h1 className="auth-headline">
            Join the <em>AI Revolution</em>
          </h1>
          <p className="auth-sub">Next-gen AI interfaces. Fast, secure, beautiful.</p>

          <div className="auth-features">
            {FEATURES.map((f) => (
              <div className="auth-feature" key={f.title}>
                <span className="auth-feature-ic">{f.icon}</span>
                <span>
                  <b>{f.title}</b>
                  <span>{f.desc}</span>
                </span>
              </div>
            ))}
          </div>
        </div>

        <p className="auth-foot">© 2026 Pikar AI. All rights reserved.</p>
      </aside>

      <section className="auth-panel">{children}</section>
    </div>
  );
}
