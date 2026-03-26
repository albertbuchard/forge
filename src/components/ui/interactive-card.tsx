import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export function InteractiveCard({
  to,
  children,
  className
}: {
  to: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Link
      to={to}
      className="group block transition-transform duration-[var(--motion-medium)] ease-[var(--ease-standard)] hover:-translate-y-0.5 focus-visible:outline-none"
    >
      <Card
        className={cn(
          "transition-[transform,box-shadow,background] duration-[var(--motion-medium)] ease-[var(--ease-standard)] group-hover:bg-white/[0.06] group-hover:shadow-[var(--card-shadow-hover)] group-focus-visible:shadow-[var(--card-shadow-hover)]",
          className
        )}
      >
        {children}
      </Card>
    </Link>
  );
}
