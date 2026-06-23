import type { ReactNode } from "react";
import { InfoTooltip } from "@/components/ui/info-tooltip";
import { cn } from "@/lib/utils";

export function AtlasPanel({
  eyebrow,
  title,
  description,
  titleHelp,
  tone = "default",
  children,
  className
}: {
  eyebrow: string;
  title: string;
  description?: string;
  titleHelp?: string;
  tone?: "default" | "mint" | "sky" | "violet" | "rose" | "amber";
  children: ReactNode;
  className?: string;
}) {
  const toneClasses = {
    default: "bg-[var(--ui-surface-section)]",
    mint: "bg-[radial-gradient(circle_at_top_left,color-mix(in_srgb,var(--success)_12%,transparent),transparent_42%),var(--ui-surface-section)]",
    sky: "bg-[radial-gradient(circle_at_top_left,color-mix(in_srgb,var(--info)_12%,transparent),transparent_42%),var(--ui-surface-section)]",
    violet: "bg-[radial-gradient(circle_at_top_left,color-mix(in_srgb,var(--primary)_12%,transparent),transparent_42%),var(--ui-surface-section)]",
    rose: "bg-[radial-gradient(circle_at_top_left,color-mix(in_srgb,var(--danger)_12%,transparent),transparent_42%),var(--ui-surface-section)]",
    amber: "bg-[radial-gradient(circle_at_top_left,color-mix(in_srgb,var(--warning)_12%,transparent),transparent_42%),var(--ui-surface-section)]"
  };

  return (
    <section className={cn("min-w-0 overflow-hidden rounded-[30px] border border-[var(--ui-border-subtle)] px-4 py-5 shadow-[var(--card-shadow)] sm:px-5 lg:px-6", toneClasses[tone], className)}>
      <div className="font-label text-[11px] uppercase tracking-[0.18em] text-[var(--ui-ink-faint)]">{eyebrow}</div>
      <div className="mt-3 flex min-w-0 items-start gap-2">
        <h2 className="min-w-0 break-words font-display text-[clamp(1.8rem,3.2vw,3rem)] leading-none text-[var(--ui-ink-strong)]">{title}</h2>
        {titleHelp ? <InfoTooltip content={titleHelp} label={`Explain ${title.toLowerCase()}`} className="mt-1 shrink-0" /> : null}
      </div>
      {description ? <p className="mt-3 max-w-3xl break-words text-sm leading-7 text-[var(--ui-ink-soft)]">{description}</p> : null}
      <div className="mt-5 min-w-0">{children}</div>
    </section>
  );
}
