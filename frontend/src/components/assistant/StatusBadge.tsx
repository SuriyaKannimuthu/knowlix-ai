import type { HealthState } from "./types";

export function StatusBadge({ health, mode }: { health: HealthState; mode: "live" | "mock" }) {
  const label =
    mode === "mock"
      ? "Demo mode"
      : health === "online"
        ? "API online"
        : health === "offline"
          ? "API offline"
          : "Connecting…";
  const dot =
    health === "online"
      ? "bg-emerald-600"
      : health === "offline"
        ? "bg-red-600"
        : "bg-faint animate-pulse";

  return (
    <span className="inline-flex items-center gap-2 rounded-full border border-line bg-panel px-2.5 py-1 font-mono text-[0.68rem] text-ink-soft">
      <span className={`h-1.5 w-1.5 rounded-full ${dot}`} aria-hidden="true" />
      {label}
    </span>
  );
}
