import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function MobileTitleRow({
  title,
  leading,
  trailing,
  className
}: {
  title: ReactNode;
  leading?: ReactNode;
  trailing?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex min-w-0 items-center justify-between gap-2",
        className
      )}
    >
      <div className="flex min-w-0 flex-1 items-center gap-3">
        {leading}
        <div className="min-w-0 truncate">{title}</div>
      </div>
      {trailing ? (
        <div className="flex shrink-0 items-center gap-1.5">{trailing}</div>
      ) : null}
    </div>
  );
}
