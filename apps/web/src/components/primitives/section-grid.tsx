import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function SectionGrid({
  children,
  columns = "single",
  className
}: {
  children: ReactNode;
  columns?: "single" | "two" | "sidebar";
  className?: string;
}) {
  return (
    <section
      className={cn(
        "grid gap-4",
        columns === "two" && "lg:grid-cols-2",
        columns === "sidebar" && "xl:grid-cols-[minmax(0,25rem)_minmax(0,1fr)]",
        className
      )}
    >
      {children}
    </section>
  );
}
