// Inline stroke icons — no icon library (ponytail). Pure SVG, no client hooks, so both
// the server layout and the client pages can use them. `size` defaults suit inputs/badges.
type IconProps = { size?: number };

const base = (size: number) => ({
  width: size,
  height: size,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
});

export function StarIcon({ size = 18 }: IconProps) {
  return (
    <svg {...base(size)} fill="currentColor" stroke="none" aria-hidden="true">
      <path d="M12 2.5l2.6 5.7 6.2.6-4.7 4.1 1.4 6.1L12 15.9l-5.5 3.2 1.4-6.1L3.2 8.8l6.2-.6z" />
    </svg>
  );
}

export function UserIcon({ size = 18 }: IconProps) {
  return (
    <svg {...base(size)} aria-hidden="true">
      <circle cx="12" cy="8" r="3.5" />
      <path d="M5 20c0-3.5 3-6 7-6s7 2.5 7 6" />
    </svg>
  );
}

export function MailIcon({ size = 18 }: IconProps) {
  return (
    <svg {...base(size)} aria-hidden="true">
      <rect x="3" y="5" width="18" height="14" rx="2.5" />
      <path d="M4 7l8 6 8-6" />
    </svg>
  );
}

export function LockIcon({ size = 18 }: IconProps) {
  return (
    <svg {...base(size)} aria-hidden="true">
      <rect x="4.5" y="10.5" width="15" height="9.5" rx="2" />
      <path d="M8 10.5V8a4 4 0 018 0v2.5" />
    </svg>
  );
}

export function CheckCircleIcon({ size = 18 }: IconProps) {
  return (
    <svg {...base(size)} aria-hidden="true">
      <circle cx="12" cy="12" r="8.5" />
      <path d="M8.5 12.2l2.3 2.3 4.7-4.9" />
    </svg>
  );
}

export function EyeIcon({ size = 18 }: IconProps) {
  return (
    <svg {...base(size)} aria-hidden="true">
      <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

export function EyeOffIcon({ size = 18 }: IconProps) {
  return (
    <svg {...base(size)} aria-hidden="true">
      <path d="M9.9 5.8A9.6 9.6 0 0112 5.5c6 0 9.5 6.5 9.5 6.5a15 15 0 01-3 3.6M6.4 7.4A15 15 0 002.5 12s3.5 6.5 9.5 6.5a9.4 9.4 0 004-.9" />
      <path d="M9.9 9.9a3 3 0 004.2 4.2" />
      <path d="M3 3l18 18" />
    </svg>
  );
}

export function ArrowIcon({ size = 18 }: IconProps) {
  return (
    <svg {...base(size)} aria-hidden="true">
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  );
}

export function BoltIcon({ size = 22 }: IconProps) {
  return (
    <svg {...base(size)} aria-hidden="true">
      <path d="M13 2L5 13h5l-1 9 8-11h-5z" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function BrainIcon({ size = 22 }: IconProps) {
  return (
    <svg {...base(size)} aria-hidden="true">
      <circle cx="12" cy="11" r="7.5" />
      <circle cx="9.3" cy="10" r="1.1" fill="currentColor" stroke="none" />
      <circle cx="14.7" cy="10" r="1.1" fill="currentColor" stroke="none" />
      <path d="M9 14c1 1 5 1 6 0" />
    </svg>
  );
}

export function ShieldIcon({ size = 22 }: IconProps) {
  return (
    <svg {...base(size)} aria-hidden="true">
      <path d="M12 3l7 3v5c0 4.5-3 7.7-7 9-4-1.3-7-4.5-7-9V6z" />
      <path d="M9 12l2 2 4-4" />
    </svg>
  );
}

// ---- app-shell rail icons (BRAND.md §4 nav) ----

export function GridIcon({ size = 18 }: IconProps) {
  return (
    <svg {...base(size)} aria-hidden="true">
      <rect x="3.5" y="3.5" width="7" height="7" rx="1.5" />
      <rect x="13.5" y="3.5" width="7" height="7" rx="1.5" />
      <rect x="3.5" y="13.5" width="7" height="7" rx="1.5" />
      <rect x="13.5" y="13.5" width="7" height="7" rx="1.5" />
    </svg>
  );
}

export function BellIcon({ size = 18 }: IconProps) {
  return (
    <svg {...base(size)} aria-hidden="true">
      <path d="M6 9.5a6 6 0 0112 0c0 4 1.5 5.5 1.5 5.5h-15S6 13.5 6 9.5z" />
      <path d="M10 18.5a2 2 0 004 0" />
    </svg>
  );
}

export function WalletIcon({ size = 18 }: IconProps) {
  return (
    <svg {...base(size)} aria-hidden="true">
      <rect x="3" y="6.5" width="18" height="13" rx="2.5" />
      <path d="M3 9.5h18M16.5 14.5h1.5" />
    </svg>
  );
}

export function FileIcon({ size = 18 }: IconProps) {
  return (
    <svg {...base(size)} aria-hidden="true">
      <path d="M6 3.5h8l4 4v13H6z" />
      <path d="M14 3.5v4h4M9 12h6M9 15.5h6" />
    </svg>
  );
}

export function TrendIcon({ size = 18 }: IconProps) {
  return (
    <svg {...base(size)} aria-hidden="true">
      <path d="M3.5 17.5l5.5-6 3.5 3.5 7.5-8" />
      <path d="M15 7h5v5" />
    </svg>
  );
}

export function PieIcon({ size = 18 }: IconProps) {
  return (
    <svg {...base(size)} aria-hidden="true">
      <path d="M12 3.5a8.5 8.5 0 108.5 8.5H12z" />
      <path d="M15 3.9a8.5 8.5 0 015.1 5.1H15z" />
    </svg>
  );
}

export function VaultIcon({ size = 18 }: IconProps) {
  return (
    <svg {...base(size)} aria-hidden="true">
      <ellipse cx="12" cy="6" rx="8" ry="3" />
      <path d="M4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6" />
      <path d="M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3" />
    </svg>
  );
}

export function GlobeIcon({ size = 18 }: IconProps) {
  return (
    <svg {...base(size)} aria-hidden="true">
      <circle cx="12" cy="12" r="8.5" />
      <path d="M3.5 12h17M12 3.5c2.5 2.3 3.8 5.2 3.8 8.5s-1.3 6.2-3.8 8.5c-2.5-2.3-3.8-5.2-3.8-8.5s1.3-6.2 3.8-8.5z" />
    </svg>
  );
}

export function ChevronLeftIcon({ size = 18 }: IconProps) {
  return (
    <svg {...base(size)} aria-hidden="true">
      <path d="M14.5 6l-6 6 6 6" />
    </svg>
  );
}

export function SignOutIcon({ size = 18 }: IconProps) {
  return (
    <svg {...base(size)} aria-hidden="true">
      <path d="M14 4.5H6.5v15H14" />
      <path d="M10.5 12h10M17 8.5l3.5 3.5-3.5 3.5" />
    </svg>
  );
}

// Google "G" — brand colors, so it keeps its own fills (not currentColor).
export function GoogleIcon({ size = 18 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <path fill="#4285F4" d="M22.5 12.2c0-.7-.1-1.4-.2-2H12v3.8h5.9a5 5 0 01-2.2 3.3v2.7h3.5c2-1.9 3.3-4.7 3.3-7.8z" />
      <path fill="#34A853" d="M12 23c3 0 5.5-1 7.3-2.7l-3.5-2.7c-1 .7-2.3 1.1-3.8 1.1-2.9 0-5.4-2-6.3-4.6H2v2.8A11 11 0 0012 23z" />
      <path fill="#FBBC05" d="M5.7 14.1a6.6 6.6 0 010-4.2V7.1H2a11 11 0 000 9.8z" />
      <path fill="#EA4335" d="M12 5.4c1.6 0 3 .6 4.2 1.6l3.1-3.1A11 11 0 002 7.1l3.7 2.8C6.6 7.3 9.1 5.4 12 5.4z" />
    </svg>
  );
}
