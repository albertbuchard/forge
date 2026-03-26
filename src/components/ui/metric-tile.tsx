import type { ReactNode } from "react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export function MetricTile({
  label,
  value,
  tone = "default",
  detail,
  className
}: {
  label: string;
  value: ReactNode;
  tone?: "default" | "core" | "psyche";
  detail?: ReactNode;
  className?: string;
}) {
  return (
    <Card
      className={cn(
        "rounded-[22px] p-4",
        tone === "core" && "bg-[linear-gradient(180deg,rgba(29,24,48,0.95),rgba(17,17,31,0.92))]",
        tone === "psyche" && "bg-[linear-gradient(180deg,rgba(18,31,34,0.96),rgba(13,24,27,0.94))]",
        className
      )}
    >
      <div className="font-label text-[11px] uppercase tracking-[0.18em] text-white/42">{label}</div>
      <div className="mt-3 font-display text-3xl text-white">{value}</div>
      {detail ? <div className="mt-2 text-sm text-white/56">{detail}</div> : null}
    </Card>
  );
}
