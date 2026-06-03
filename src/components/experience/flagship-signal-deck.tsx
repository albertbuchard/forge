import { motion } from "framer-motion";
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
  className
}: {
  eyebrow: string;
  title: string;
  description: string;
  items: ReadonlyArray<FlagshipSignalItem>;
  tone?: "core" | "psyche";
  className?: string;
}) {
  return (
    <section
      className={cn(
        "min-w-0 overflow-hidden rounded-[28px] border border-[var(--ui-border-subtle)] shadow-[var(--ui-shadow-soft)]",
        tone === "core"
          ? "bg-[var(--ui-surface-section)]"
          : "bg-[color-mix(in_srgb,var(--success)_6%,var(--ui-surface-section)_94%)]",
        className
      )}
    >
      <div
        className={cn(
          "grid min-w-0 gap-3 px-4 py-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,26rem)] lg:px-5",
          tone === "core"
            ? "bg-[radial-gradient(circle_at_top_right,color-mix(in_srgb,var(--primary)_12%,transparent),transparent_36%)]"
            : "bg-[radial-gradient(circle_at_top_right,color-mix(in_srgb,var(--success)_12%,transparent),transparent_36%)]"
        )}
      >
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
          <h2 className="mt-2 max-w-3xl font-display text-[clamp(1.35rem,2vw,1.9rem)] leading-none text-[var(--ui-ink-strong)]">
            {title}
          </h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--ui-ink-soft)]">
            {description}
          </p>
        </div>

        <div className="grid min-w-0 gap-2 sm:grid-cols-3">
          {items.slice(0, 3).map((item) =>
            item.href ? (
              <Link
                key={item.id}
                to={item.href}
                className={cn(
                  "min-w-0 rounded-[20px] border border-[var(--ui-border-subtle)] px-3 py-3 backdrop-blur-sm transition hover:border-[var(--ui-border-strong)] hover:bg-[var(--ui-surface-hover)]",
                  tone === "core"
                    ? "bg-[var(--ui-surface-1)]"
                    : "bg-[color-mix(in_srgb,var(--success)_6%,var(--ui-surface-1)_94%)]"
                )}
              >
                <div className="text-[11px] uppercase tracking-[0.16em] text-[var(--ui-ink-faint)]">
                  {item.label}
                </div>
                <div className="mt-1.5 min-w-0 font-medium text-[var(--ui-ink-strong)]">
                  {item.title}
                </div>
              </Link>
            ) : (
              <div
                key={item.id}
                className={cn(
                  "min-w-0 rounded-[20px] border border-[var(--ui-border-subtle)] px-3 py-3 backdrop-blur-sm",
                  tone === "core"
                    ? "bg-[var(--ui-surface-1)]"
                    : "bg-[color-mix(in_srgb,var(--success)_6%,var(--ui-surface-1)_94%)]"
                )}
              >
                <div className="text-[11px] uppercase tracking-[0.16em] text-[var(--ui-ink-faint)]">
                  {item.label}
                </div>
                <div className="mt-1.5 min-w-0 font-medium text-[var(--ui-ink-strong)]">
                  {item.title}
                </div>
              </div>
            )
          )}
        </div>
      </div>

      <div className="grid min-w-0 gap-3 px-4 py-4 lg:grid-cols-2 lg:px-5">
        {items.map((item, index) => {
          const cardClassName = cn(
            "group flex min-h-[13.5rem] min-w-0 flex-col overflow-hidden rounded-[24px] border border-[var(--ui-border-subtle)] p-0 transition hover:-translate-y-0.5 hover:border-[var(--ui-border-strong)] hover:shadow-[var(--ui-shadow-floating)] sm:min-h-[15.5rem]",
            tone === "core"
              ? "bg-[var(--ui-surface-1)] hover:bg-[var(--ui-surface-hover)]"
              : "bg-[color-mix(in_srgb,var(--success)_6%,var(--ui-surface-1)_94%)] hover:bg-[color-mix(in_srgb,var(--success)_10%,var(--ui-surface-hover)_90%)]"
          );
          const body = (
            <>
              <div
                className={cn(
                  "flex min-w-0 flex-1 flex-col p-4",
                  tone === "core"
                    ? "bg-[radial-gradient(circle_at_top_left,color-mix(in_srgb,var(--primary)_10%,transparent),transparent_28%)]"
                    : "bg-[radial-gradient(circle_at_top_left,color-mix(in_srgb,var(--success)_10%,transparent),transparent_28%)]"
                )}
              >
                <div className="flex min-w-0 items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="font-label text-[11px] uppercase tracking-[0.18em] text-[var(--ui-ink-faint)]">
                      {item.label}
                    </div>
                    <div className="mt-2.5 min-w-0 font-display text-[1.25rem] leading-tight text-[var(--ui-ink-strong)] sm:text-[1.4rem]">
                      {item.title}
                    </div>
                  </div>
                  {item.badge ? (
                    <Badge
                      wrap
                      className="max-w-[10rem] shrink-0 self-start bg-[var(--ui-surface-2)] text-[var(--ui-ink-medium)]"
                    >
                      {item.badge}
                    </Badge>
                  ) : null}
                </div>
                <div className="mt-2.5 text-sm leading-6 text-[var(--ui-ink-soft)]">
                  {item.detail}
                </div>
                <div className="flex-1" />
              </div>
              {item.href ? (
                <div className="border-t border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)] px-4 py-3">
                  <div className="inline-flex min-h-10 min-w-0 max-w-full items-center gap-2 rounded-full border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] px-4 text-sm text-[var(--ui-ink-medium)] transition group-hover:border-[var(--ui-border-strong)] group-hover:bg-[var(--ui-surface-hover)] group-hover:text-[var(--ui-ink-strong)]">
                    {item.actionLabel ?? "Open"}
                    <ArrowRight className="size-3.5" />
                  </div>
                </div>
              ) : null}
            </>
          );

          return (
            <motion.div
              key={item.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{
                duration: 0.22,
                delay: 0.04 * index,
                ease: "easeOut"
              }}
            >
              {item.href ? (
                <Link to={item.href} className={cardClassName}>
                  {body}
                </Link>
              ) : (
                <div className={cardClassName}>{body}</div>
              )}
            </motion.div>
          );
        })}
      </div>
    </section>
  );
}
