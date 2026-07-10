import { cn } from "@/lib/utils";
import type { ModeProfile } from "@/lib/psyche-types";

const toneMap: Record<ModeProfile["family"], string> = {
  coping: "bg-[var(--ui-danger-soft)] text-[var(--danger)]",
  child: "bg-[var(--ui-info-soft)] text-[var(--info)]",
  critic_parent: "bg-[var(--ui-accent-soft)] text-[var(--primary)]",
  healthy_adult: "bg-[var(--ui-success-soft)] text-[var(--success)]",
  happy_child: "bg-[var(--ui-warning-soft)] text-[var(--warning)]"
};

export function ModeChip({
  family,
  label,
  className
}: {
  family: ModeProfile["family"];
  label: string;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-3 py-1.5 text-xs",
        toneMap[family],
        className
      )}
    >
      {label}
    </span>
  );
}
