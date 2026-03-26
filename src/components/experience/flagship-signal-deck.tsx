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
        "min-w-0 overflow-hidden rounded-[28px] border border-white/6 shadow-[0_20px_54px_rgba(4,8,18,0.24)]",
        tone === "core"
          ? "bg-[linear-gradient(180deg,rgba(22,28,46,0.98),rgba(12,17,30,0.95))]"
          : "bg-[linear-gradient(180deg,rgba(16,29,33,0.98),rgba(12,22,27,0.95))]",
        className
      )}
    >
      <div
        className={cn(
          "grid min-w-0 gap-3 px-4 py-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,26rem)] lg:px-5",
          tone === "core"
            ? "bg-[radial-gradient(circle_at_top_right,rgba(192,193,255,0.12),transparent_36%),linear-gradient(180deg,rgba(255,255,255,0.03),rgba(255,255,255,0))]"
            : "bg-[radial-gradient(circle_at_top_right,rgba(110,231,183,0.1),transparent_36%),linear-gradient(180deg,rgba(255,255,255,0.03),rgba(255,255,255,0))]"
        )}
      >
        <div className="min-w-0">
          <div className={cn("font-label text-[11px] uppercase tracking-[0.2em]", tone === "core" ? "text-[var(--secondary)]" : "text-[rgba(110,231,183,0.82)]")}>
            {eyebrow}
          </div>
          <h2 className="mt-2 max-w-3xl font-display text-[clamp(1.35rem,2vw,1.9rem)] leading-none text-white">{title}</h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-white/60">{description}</p>
        </div>

        <div className="grid min-w-0 gap-2 sm:grid-cols-3">
          {items.slice(0, 3).map((item) => (
            item.href ? (
              <Link
                key={item.id}
                to={item.href}
                className={cn(
                  "min-w-0 rounded-[20px] border border-white/6 px-3 py-3 backdrop-blur-sm transition hover:bg-white/[0.08]",
                  tone === "core"
                    ? "bg-[linear-gradient(180deg,rgba(255,255,255,0.05),rgba(255,255,255,0.025))]"
                    : "bg-[linear-gradient(180deg,rgba(110,231,183,0.08),rgba(255,255,255,0.02))]"
                )}
              >
                <div className="text-[11px] uppercase tracking-[0.16em] text-white/42">{item.label}</div>
                <div className="mt-1.5 min-w-0 font-medium text-white">{item.title}</div>
              </Link>
            ) : (
              <div
                key={item.id}
                className={cn(
                  "min-w-0 rounded-[20px] border border-white/6 px-3 py-3 backdrop-blur-sm",
                  tone === "core"
                    ? "bg-[linear-gradient(180deg,rgba(255,255,255,0.05),rgba(255,255,255,0.025))]"
                    : "bg-[linear-gradient(180deg,rgba(110,231,183,0.08),rgba(255,255,255,0.02))]"
                )}
              >
                <div className="text-[11px] uppercase tracking-[0.16em] text-white/42">{item.label}</div>
                <div className="mt-1.5 min-w-0 font-medium text-white">{item.title}</div>
              </div>
            )
          ))}
        </div>
      </div>

      <div className="grid min-w-0 gap-3 px-4 py-4 lg:grid-cols-2 lg:px-5">
        {items.map((item, index) => {
          const cardClassName =
            cn(
              "group flex min-h-[13.5rem] min-w-0 flex-col overflow-hidden rounded-[24px] border border-white/7 p-0 transition hover:-translate-y-0.5 hover:shadow-[0_22px_46px_rgba(3,8,18,0.28)] sm:min-h-[15.5rem]",
              tone === "core"
                ? "bg-[linear-gradient(180deg,rgba(19,26,42,0.98),rgba(11,16,28,0.96))] hover:border-white/12 hover:bg-[linear-gradient(180deg,rgba(24,31,50,0.98),rgba(13,19,33,0.97))]"
                : "bg-[linear-gradient(180deg,rgba(17,29,32,0.98),rgba(9,18,22,0.97))] hover:border-white/12 hover:bg-[linear-gradient(180deg,rgba(21,36,40,0.98),rgba(11,22,27,0.97))]"
            );
          const body = (
            <>
              <div
                className={cn(
                  "flex min-w-0 flex-1 flex-col p-4",
                  tone === "core"
                    ? "bg-[radial-gradient(circle_at_top_left,rgba(192,193,255,0.1),transparent_28%),linear-gradient(180deg,rgba(255,255,255,0.025),rgba(255,255,255,0))]"
                    : "bg-[radial-gradient(circle_at_top_left,rgba(110,231,183,0.08),transparent_28%),linear-gradient(180deg,rgba(255,255,255,0.025),rgba(255,255,255,0))]"
                )}
              >
                <div className="flex min-w-0 items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="font-label text-[11px] uppercase tracking-[0.18em] text-white/42">{item.label}</div>
                    <div className="mt-2.5 min-w-0 font-display text-[1.25rem] leading-tight text-white sm:text-[1.4rem]">{item.title}</div>
                  </div>
                  {item.badge ? <Badge wrap className="max-w-[10rem] shrink-0 self-start bg-white/[0.08] text-white/72">{item.badge}</Badge> : null}
                </div>
                <div className="mt-2.5 text-sm leading-6 text-white/60">{item.detail}</div>
                <div className="flex-1" />
              </div>
              {item.href ? (
                <div className="border-t border-white/6 bg-[linear-gradient(180deg,rgba(255,255,255,0.02),rgba(255,255,255,0.01))] px-4 py-3">
                  <div className="inline-flex min-h-10 min-w-0 max-w-full items-center gap-2 rounded-full border border-white/8 bg-white/[0.05] px-4 text-sm text-white/68 transition group-hover:border-white/14 group-hover:bg-white/[0.08] group-hover:text-white">
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
              transition={{ duration: 0.22, delay: 0.04 * index, ease: "easeOut" }}
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
