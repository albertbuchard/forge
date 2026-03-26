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
      ? "from-[var(--secondary)] to-[rgba(78,222,163,0.45)]"
      : tone === "tertiary"
        ? "from-[var(--tertiary)] to-[rgba(255,185,95,0.45)]"
        : "from-[var(--primary)] to-[rgba(192,193,255,0.45)]";

  return (
    <div className={cn("h-1.5 rounded-full bg-white/[0.08]", className)}>
      <div className={cn("h-full rounded-full bg-gradient-to-r", fillClass)} style={{ width }} />
    </div>
  );
}
