import { cn } from "@/lib/utils";

export function ProgressMeter({
  value,
  className,
  tone = "primary"
}: {
  value: number;
  className?: string;
  tone?: "primary" | "secondary" | "tertiary";
}) {
  const width = `${Math.max(4, Math.min(100, value))}%`;
  const fillClass =
    tone === "secondary"
      ? "from-[var(--secondary)] to-[color-mix(in_srgb,var(--secondary)_38%,transparent)]"
      : tone === "tertiary"
        ? "from-[var(--tertiary)] to-[color-mix(in_srgb,var(--tertiary)_38%,transparent)]"
        : "from-[var(--primary)] to-[color-mix(in_srgb,var(--primary)_38%,transparent)]";

  return (
    <div
      className={cn("h-1.5 rounded-full bg-[var(--ui-surface-2)]", className)}
    >
      <div
        className={cn("h-full rounded-full bg-gradient-to-r", fillClass)}
        style={{ width }}
      />
    </div>
  );
}
