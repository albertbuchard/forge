import { ArrowRight } from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export type FlagshipSignalItem = {
  id: string;
  label: string;
  title: ReactNode;
  detail: string;
  badge?: string;
  href?: string;
  actionLabel?: string;
};

export function FlagshipSignalDeck({
  eyebrow,
  title,
  description,
  items,
  tone = "core",
  className,
  compact = false
}: {
  eyebrow: string;
  title: string;
  description: string;
  items: ReadonlyArray<FlagshipSignalItem>;
  tone?: "core" | "psyche";
  className?: string;
  compact?: boolean;
}) {
  return (
    <section className={cn("min-w-0", className)}>
      <div className="min-w-0">
        <div
          className={cn(
            "font-label text-[11px] uppercase tracking-[0.2em]",
            tone === "core"
              ? "text-[var(--secondary)]"
              : "text-[color-mix(in_srgb,var(--success)_74%,var(--ui-ink-strong)_26%)]"
          )}
        >
          {eyebrow}
        </div>
        <h2 className="mt-2 max-w-3xl text-xl font-semibold text-[var(--ui-ink-strong)]">
          {title}
        </h2>
        {!compact ? (
          <p className="mt-1 max-w-3xl text-sm leading-6 text-[var(--ui-ink-soft)]">
            {description}
          </p>
        ) : null}
      </div>

      <div className="mt-4 flex min-w-0 flex-col divide-y divide-[var(--ui-border-subtle)] border-y border-[var(--ui-border-subtle)] lg:flex-row lg:divide-x lg:divide-y-0">
        {items.map((item) => {
          const cardClassName = cn(
            "group flex min-w-0 flex-1 flex-col px-3 transition",
            compact ? "py-3" : "py-4",
            tone === "core"
              ? "hover:bg-[var(--ui-surface-hover)]"
              : "hover:bg-[color-mix(in_srgb,var(--success)_8%,var(--ui-surface-hover)_92%)]"
          );
          const body = (
            <>
              <div className="flex min-w-0 items-start justify-between gap-3">
                <div className="font-label text-[11px] uppercase tracking-[0.18em] text-[var(--ui-ink-faint)]">
                  {item.label}
                </div>
                {item.badge ? (
                  <Badge
                    wrap
                    className="max-w-[9rem] shrink-0 bg-[var(--ui-surface-2)] text-[var(--ui-ink-medium)]"
                  >
                    {item.badge}
                  </Badge>
                ) : null}
              </div>
              <div className="mt-2 min-w-0 line-clamp-2 text-base font-semibold leading-6 text-[var(--ui-ink-strong)]">
                {item.title}
              </div>
              <div
                className={cn(
                  "mt-1 text-sm leading-6 text-[var(--ui-ink-soft)]",
                  compact ? "line-clamp-2" : "line-clamp-3"
                )}
              >
                {item.detail}
              </div>
              {item.href ? (
                <div
                  className={cn(
                    "inline-flex items-center gap-2 self-start text-sm font-medium text-[var(--ui-ink-medium)] transition group-hover:text-[var(--ui-ink-strong)]",
                    compact ? "mt-1.5" : "mt-3 min-h-10"
                  )}
                >
                  {item.actionLabel ?? "Open"}
                  <ArrowRight className="size-3.5" />
                </div>
              ) : null}
            </>
          );

          return item.href ? (
            <Link key={item.id} to={item.href} className={cardClassName}>
              {body}
            </Link>
          ) : (
            <div key={item.id} className={cardClassName}>
              {body}
            </div>
          );
        })}
      </div>
    </section>
  );
}
