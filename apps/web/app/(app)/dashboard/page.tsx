"use client";

import { api } from "@pikar/backend/api";
import { useQuery } from "convex/react";
import Link from "next/link";
import { ArrowIcon, BoltIcon, MailIcon, ShieldIcon } from "../../(auth)/icons";

// Command Center home (BRAND.md §3–§5, brand-024016): one display headline, a
// recommended-next-move card, and honest-zero stat tiles wired to the real
// tenant-scoped queries. No fake numbers — empty states show true zeros.
// ponytail: counts come from list() lengths — swap to aggregate counters when
// request volume makes the reads matter.

function StatTile({
  label,
  value,
  icon,
  text,
}: {
  label: string;
  value: string;
  icon: React.ReactNode;
  text?: boolean;
}) {
  return (
    <div className="stat-tile">
      <div className="stat-head">
        <span className="stat-badge">{icon}</span>
        <p className="caps-label">{label}</p>
      </div>
      <div className={`stat-value${text ? " is-text" : ""}`}>{value}</div>
    </div>
  );
}

export default function Dashboard() {
  const sent = useQuery(api.requests.list, { status: "sent" });
  const requests = useQuery(api.requests.list, {});
  const dlqCount = useQuery(api.deadLetters.newCount);
  const gmail = useQuery(api.gmailAuth.gmailStatus);

  const dateLabel = new Date().toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });

  // The operating workspace is always the next-move surface. Gmail remains visible below as the
  // status of one optional execution channel, but never outranks the business work or blocks it.
  const nextMove = {
    title: "Open your operating workspace",
    body: "Set the business outcome. Pikar reasons across your knowledge, shapes the work, and brings consequential actions back for approval.",
    href: "/dashboard/workspace",
    cta: "Open workspace",
  };

  const count = (rows: unknown[] | undefined) => (rows === undefined ? "—" : String(rows.length));

  return (
    <div className="cc">
      <section className="cc-hero">
        <div>
          <p className="caps-label">Solopreneur • {dateLabel}</p>
          <h1>Run the next revenue move</h1>
          <p className="cc-lede">
            Your home is tuned for quick execution, cash awareness, and fewer loose ends.
          </p>
        </div>
        <div className="next-move">
          <p className="caps-label">Recommended next move</p>
          <h2>{nextMove.title}</h2>
          <p>{nextMove.body}</p>
          <Link className="cta-dark" href={nextMove.href}>
            {nextMove.cta} <ArrowIcon size={16} />
          </Link>
        </div>
      </section>

      <section className="stat-grid" aria-label="Key numbers">
        <StatTile label="Emails delivered" value={count(sent)} icon={<MailIcon size={16} />} />
        <StatTile label="Requests" value={count(requests)} icon={<BoltIcon size={16} />} />
        <StatTile
          label="Dead letters"
          value={dlqCount === undefined ? "—" : String(dlqCount)}
          icon={<ShieldIcon size={16} />}
        />
        <StatTile
          label="Email channel"
          value={gmail === undefined ? "—" : gmail.connected ? "Connected" : "Not connected"}
          icon={<MailIcon size={16} />}
          text
        />
      </section>
    </div>
  );
}
