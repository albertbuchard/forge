import { Link } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import type { Behavior } from "@/lib/psyche-types";

export function ReturnPathStrip({
  entries
}: {
  entries: Array<{
    id: string;
    title: string;
    summary: string;
    href: string;
    tone: Behavior["kind"];
  }>;
}) {
  const toneClasses: Record<Behavior["kind"], string> = {
    away: "border-rose-400/20 bg-[rgba(251,113,133,0.08)]",
    committed: "border-emerald-400/20 bg-[rgba(110,231,183,0.08)]",
    recovery: "border-amber-400/20 bg-[rgba(251,191,36,0.08)]"
  };

  return (
    <div className="grid gap-3 lg:grid-cols-3">
      {entries.map((entry) => (
        <Link key={entry.id} to={entry.href} className={`rounded-[22px] border px-4 py-4 transition hover:-translate-y-0.5 ${toneClasses[entry.tone]}`}>
          <div className="text-[11px] uppercase tracking-[0.16em] text-white/40">{entry.tone}</div>
          <div className="mt-2 font-medium text-white">{entry.title}</div>
          <div className="mt-2 text-sm leading-6 text-white/58">{entry.summary}</div>
          <div className="mt-4 inline-flex items-center gap-2 text-sm text-white/54">
            Open
            <ArrowRight className="size-3.5" />
          </div>
        </Link>
      ))}
    </div>
  );
}
