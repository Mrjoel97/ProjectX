// Inline stroke icons for the Knowledge Vault — no icon library (ponytail; mirrors
// app/(auth)/icons.tsx). Pure SVG, `currentColor` stroke so a parent's `color` (or a
// white-on-badge fill) drives them. Upgrade path: adopt a shared icon set only if the
// authed app grows one (later phase).
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

// ── Stat-tile badges ──────────────────────────────────────────────────────────
export function FileTextIcon({ size = 20 }: IconProps) {
  return (
    <svg {...base(size)} aria-hidden="true">
      <path d="M14 3H7a2 2 0 00-2 2v14a2 2 0 002 2h10a2 2 0 002-2V8z" />
      <path d="M14 3v5h5" />
      <path d="M9 13h6M9 17h6" />
    </svg>
  );
}

export function LayersIcon({ size = 20 }: IconProps) {
  return (
    <svg {...base(size)} aria-hidden="true">
      <path d="M12 3l9 5-9 5-9-5z" />
      <path d="M3 13l9 5 9-5" />
    </svg>
  );
}

export function HardDriveIcon({ size = 20 }: IconProps) {
  return (
    <svg {...base(size)} aria-hidden="true">
      <rect x="3" y="6" width="18" height="12" rx="2.5" />
      <path d="M7 14h10" />
      <circle cx="8" cy="14" r="0.6" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function FolderIcon({ size = 20 }: IconProps) {
  return (
    <svg {...base(size)} aria-hidden="true">
      <path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z" />
    </svg>
  );
}

// ── Category tabs ───────────────────────────────────────────────────────────────
export function UploadCloudIcon({ size = 20 }: IconProps) {
  return (
    <svg {...base(size)} aria-hidden="true">
      <path d="M7 18a4 4 0 01-.5-8A5.5 5.5 0 0117.5 9.5 3.5 3.5 0 0117 18" />
      <path d="M12 12v6M9.5 14.5L12 12l2.5 2.5" />
    </svg>
  );
}

export function ImageIcon({ size = 20 }: IconProps) {
  return (
    <svg {...base(size)} aria-hidden="true">
      <rect x="3" y="4" width="18" height="16" rx="2.5" />
      <circle cx="8.5" cy="9.5" r="1.5" />
      <path d="M21 16l-5-5-9 9" />
    </svg>
  );
}

export function VideoIcon({ size = 20 }: IconProps) {
  return (
    <svg {...base(size)} aria-hidden="true">
      <rect x="3" y="6" width="12" height="12" rx="2.5" />
      <path d="M15 10l6-3v10l-6-3z" />
    </svg>
  );
}

export function FileDocIcon({ size = 20 }: IconProps) {
  return (
    <svg {...base(size)} aria-hidden="true">
      <path d="M14 3H7a2 2 0 00-2 2v14a2 2 0 002 2h10a2 2 0 002-2V8z" />
      <path d="M14 3v5h5" />
      <path d="M8.5 12h7M8.5 15.5h7" />
    </svg>
  );
}

export function PuzzleIcon({ size = 20 }: IconProps) {
  return (
    <svg {...base(size)} aria-hidden="true">
      <path d="M9 4.5a1.5 1.5 0 013 0V6h2a1 1 0 011 1v2h1.5a1.5 1.5 0 010 3H16v3a1 1 0 01-1 1h-3v-1.5a1.5 1.5 0 00-3 0V16H6a1 1 0 01-1-1v-3H3.5a1.5 1.5 0 010-3H5V7a1 1 0 011-1h3z" />
    </svg>
  );
}

// ── Controls ─────────────────────────────────────────────────────────────────
export function RefreshIcon({ size = 18 }: IconProps) {
  return (
    <svg {...base(size)} aria-hidden="true">
      <path d="M20 11a8 8 0 10-.9 3.7" />
      <path d="M20 5v6h-6" />
    </svg>
  );
}

export function SearchIcon({ size = 18 }: IconProps) {
  return (
    <svg {...base(size)} aria-hidden="true">
      <circle cx="11" cy="11" r="7" />
      <path d="M21 21l-4.3-4.3" />
    </svg>
  );
}

export function GridIcon({ size = 18 }: IconProps) {
  return (
    <svg {...base(size)} aria-hidden="true">
      <rect x="4" y="4" width="7" height="7" rx="1.5" />
      <rect x="13" y="4" width="7" height="7" rx="1.5" />
      <rect x="4" y="13" width="7" height="7" rx="1.5" />
      <rect x="13" y="13" width="7" height="7" rx="1.5" />
    </svg>
  );
}

export function ListIcon({ size = 18 }: IconProps) {
  return (
    <svg {...base(size)} aria-hidden="true">
      <path d="M8 6h12M8 12h12M8 18h12" />
      <circle cx="4" cy="6" r="1" fill="currentColor" stroke="none" />
      <circle cx="4" cy="12" r="1" fill="currentColor" stroke="none" />
      <circle cx="4" cy="18" r="1" fill="currentColor" stroke="none" />
    </svg>
  );
}
