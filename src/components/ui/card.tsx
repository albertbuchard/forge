import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "w-full max-w-full min-w-0 rounded-[var(--radius-card)] bg-[var(--card-gradient)] p-5 shadow-[var(--card-shadow)] backdrop-blur-sm",
        className
      )}
      {...props}
    />
  );
}
