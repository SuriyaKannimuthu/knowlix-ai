import Link from "next/link";

export function LogoMark({ className = "h-5 w-6" }: { className?: string }) {
  // Four "lines of text" and a cursor dot: a document being read.
  return (
    <svg viewBox="0 0 24 20" fill="currentColor" aria-hidden="true" className={className}>
      <rect x="0" y="0" width="22" height="3" rx="1.5" />
      <rect x="0" y="5.5" width="14" height="3" rx="1.5" />
      <rect x="0" y="11" width="18" height="3" rx="1.5" />
      <rect x="0" y="16.5" width="8" height="3" rx="1.5" />
      <circle cx="20.5" cy="18" r="2" />
    </svg>
  );
}

export function Logo({ className = "" }: { className?: string }) {
  return (
    <Link
      href="/"
      className={`inline-flex items-center gap-2.5 text-ink ${className}`}
      aria-label="Knowlix AI home"
    >
      <LogoMark />
      <span className="text-[1.35rem] font-medium tracking-[-0.03em]">
        Knowlix<span className="text-muted"> AI</span>
      </span>
    </Link>
  );
}
