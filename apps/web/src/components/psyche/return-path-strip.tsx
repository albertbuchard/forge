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
    away: "border-[color-mix(in_srgb,var(--danger)_24%,var(--ui-border-subtle)_76%)] bg-[var(--ui-danger-soft)]",
    committed:
      "border-[color-mix(in_srgb,var(--success)_24%,var(--ui-border-subtle)_76%)] bg-[var(--ui-success-soft)]",
    recovery:
      "border-[color-mix(in_srgb,var(--warning)_24%,var(--ui-border-subtle)_76%)] bg-[var(--ui-warning-soft)]"
  };

  return (
    <div className="grid gap-3 lg:grid-cols-3">
      {entries.map((entry) => (
        <Link
          key={entry.id}
          to={entry.href}
          className={`rounded-[22px] border px-4 py-4 transition hover:-translate-y-0.5 ${toneClasses[entry.tone]}`}
        >
          <div className="text-[11px] uppercase tracking-[0.16em] text-[var(--ui-ink-faint)]">
            {entry.tone}
          </div>
          <div className="mt-2 font-medium text-[var(--ui-ink-strong)]">
            {entry.title}
          </div>
          <div className="mt-2 text-sm leading-6 text-[var(--ui-ink-soft)]">
            {entry.summary}
          </div>
          <div className="mt-4 inline-flex items-center gap-2 text-sm text-[var(--ui-ink-soft)]">
            Open
            <ArrowRight className="size-3.5" />
          </div>
        </Link>
      ))}
    </div>
  );
}
