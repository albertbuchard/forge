import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function PillCluster({
  children,
  className
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-wrap gap-2", className)}>{children}</div>
  );
}
