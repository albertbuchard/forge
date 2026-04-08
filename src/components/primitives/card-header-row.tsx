import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function CardHeaderRow({
  eyebrow,
  title,
  description,
  meta,
  actions,
  className
}: {
  eyebrow?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  meta?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-start justify-between gap-3",
        className
      )}
    >
      <div className="min-w-0 flex-1">
        {eyebrow ? (
          <div className="font-label text-[11px] uppercase tracking-[0.18em] text-white/45">
            {eyebrow}
          </div>
        ) : null}
        <div className={cn("min-w-0", eyebrow && "mt-2")}>
          <div className="min-w-0 text-lg text-white">{title}</div>
          {description ? (
            <div className="mt-2 text-sm leading-6 text-white/58">
              {description}
            </div>
          ) : null}
        </div>
      </div>
      {meta || actions ? (
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
          {meta}
          {actions}
        </div>
      ) : null}
    </div>
  );
}
