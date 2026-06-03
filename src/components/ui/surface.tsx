import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/utils";

export function SurfacePanel({
  className,
  interactive = false,
  muted = false,
  ...props
}: HTMLAttributes<HTMLDivElement> & {
  interactive?: boolean;
  muted?: boolean;
}) {
  return (
    <div
      className={cn(
        "rounded-[22px] border border-[var(--ui-border-subtle)] p-4",
        muted ? "bg-[var(--ui-surface-2)]" : "bg-[var(--ui-surface-1)]",
        interactive &&
          "transition hover:border-[var(--ui-border-strong)] hover:bg-[var(--ui-surface-hover)]",
        className
      )}
      {...props}
    />
  );
}

export function SurfaceStat({
  label,
  value,
  className
}: {
  label: ReactNode;
  value: ReactNode;
  className?: string;
}) {
  return (
    <SurfacePanel className={cn("rounded-[18px] p-3", className)}>
      <div className="text-[10px] uppercase tracking-[0.16em] text-[var(--ui-ink-faint)]">
        {label}
      </div>
      <div className="mt-1 text-lg font-semibold text-[var(--ui-ink-strong)]">
        {value}
      </div>
    </SurfacePanel>
  );
}
