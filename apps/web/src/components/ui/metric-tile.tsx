import type { ReactNode } from "react";
import { Card } from "@/components/ui/card";
import { InfoTooltip } from "@/components/ui/info-tooltip";
import { cn } from "@/lib/utils";

export function MetricTile({
  label,
  value,
  tone = "default",
  detail,
  help,
  className
}: {
  label: string;
  value: ReactNode;
  tone?: "default" | "core" | "psyche";
  detail?: ReactNode;
  help?: ReactNode;
  className?: string;
}) {
  return (
    <Card
      className={cn(
        "rounded-[22px] p-4",
        tone === "core" &&
          "bg-[linear-gradient(180deg,color-mix(in_srgb,var(--primary)_12%,var(--surface-panel)),color-mix(in_srgb,var(--surface-low)_92%,var(--primary)_8%))]",
        tone === "psyche" &&
          "bg-[linear-gradient(180deg,color-mix(in_srgb,var(--secondary)_12%,var(--surface-panel)),color-mix(in_srgb,var(--surface-low)_92%,var(--secondary)_8%))]",
        className
      )}
    >
      <div className="flex items-center gap-1.5 font-label text-[11px] uppercase tracking-[0.18em] text-[var(--ui-ink-faint)]">
        <span>{label}</span>
        {help ? (
          <InfoTooltip
            label={`Explain ${label}`}
            title={label}
            content={help}
            panelClassName="normal-case tracking-normal"
          />
        ) : null}
      </div>
      <div className="mt-3 font-display text-3xl text-[var(--ui-ink-strong)]">{value}</div>
      {detail ? (
        <div className="mt-2 text-sm text-[var(--ui-ink-soft)]">{detail}</div>
      ) : null}
    </Card>
  );
}
