import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function ActionCluster({
  children,
  className
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-center justify-end gap-2",
        className
      )}
    >
      {children}
    </div>
  );
}
