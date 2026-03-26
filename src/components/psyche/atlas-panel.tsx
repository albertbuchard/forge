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
    default: "bg-[linear-gradient(180deg,rgba(17,24,35,0.96),rgba(11,16,24,0.94))]",
    mint: "bg-[radial-gradient(circle_at_top_left,rgba(110,231,183,0.14),transparent_42%),linear-gradient(180deg,rgba(14,28,31,0.96),rgba(10,20,24,0.94))]",
    sky: "bg-[radial-gradient(circle_at_top_left,rgba(125,211,252,0.14),transparent_42%),linear-gradient(180deg,rgba(16,25,34,0.96),rgba(10,17,24,0.94))]",
    violet: "bg-[radial-gradient(circle_at_top_left,rgba(196,181,253,0.14),transparent_42%),linear-gradient(180deg,rgba(20,19,35,0.96),rgba(12,13,24,0.94))]",
    rose: "bg-[radial-gradient(circle_at_top_left,rgba(251,113,133,0.14),transparent_42%),linear-gradient(180deg,rgba(31,18,24,0.96),rgba(18,11,16,0.94))]",
    amber: "bg-[radial-gradient(circle_at_top_left,rgba(251,191,36,0.14),transparent_42%),linear-gradient(180deg,rgba(32,24,16,0.96),rgba(20,15,10,0.94))]"
  };

  return (
    <section className={cn("min-w-0 overflow-hidden rounded-[30px] border border-white/8 px-4 py-5 shadow-[0_24px_70px_rgba(4,8,18,0.28)] sm:px-5 lg:px-6", toneClasses[tone], className)}>
      <div className="font-label text-[11px] uppercase tracking-[0.18em] text-white/42">{eyebrow}</div>
      <div className="mt-3 flex min-w-0 items-start gap-2">
        <h2 className="min-w-0 font-display text-[clamp(1.8rem,3.2vw,3rem)] leading-none text-white">{title}</h2>
        {titleHelp ? <InfoTooltip content={titleHelp} label={`Explain ${title.toLowerCase()}`} className="mt-1 shrink-0" /> : null}
      </div>
      {description ? <p className="mt-3 max-w-3xl text-sm leading-7 text-white/60">{description}</p> : null}
      <div className="mt-5 min-w-0">{children}</div>
    </section>
  );
}
