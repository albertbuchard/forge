import { Link } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { DerivedDataProvenance } from "@/lib/types";

const FRESHNESS_LABEL: Record<DerivedDataProvenance["freshness"], string> = {
  fresh: "Current",
  stale: "Stale",
  future: "Time mismatch",
  missing: "Time unknown"
};

const COMPLETENESS_LABEL: Record<
  DerivedDataProvenance["completeness"],
  string
> = {
  complete: "Complete",
  partial: "Partial",
  unknown: "Completeness unknown"
};

function formatTimestamp(value: string | null) {
  if (!value) {
    return "time unavailable";
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return "time unavailable";
  }
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(parsed);
}

function statusTone(provenance: DerivedDataProvenance) {
  if (
    provenance.freshness === "fresh" &&
    provenance.completeness === "complete"
  ) {
    return "signal" as const;
  }
  return "meta" as const;
}

export function ProvenanceSummary({
  provenance,
  className,
  href,
  actionLabel = "Open details"
}: {
  provenance: DerivedDataProvenance;
  className?: string;
  href?: string;
  actionLabel?: string;
}) {
  const firstSentence = `Latest evidence ${formatTimestamp(provenance.observedAt)} from ${provenance.sourceSummary}.`;

  return (
    <details
      className={cn(
        "group rounded-[20px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)]",
        className
      )}
    >
      <summary className="flex min-h-11 cursor-pointer list-none flex-wrap items-center gap-2 rounded-[20px] px-4 py-2.5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary)] [&::-webkit-details-marker]:hidden">
        <span className="min-w-0 flex-1 text-sm text-[var(--ui-ink-medium)]">
          {firstSentence}
        </span>
        <Badge tone={statusTone(provenance)}>
          {FRESHNESS_LABEL[provenance.freshness]}
        </Badge>
        <Badge tone={statusTone(provenance)}>
          {COMPLETENESS_LABEL[provenance.completeness]}
        </Badge>
        <span
          aria-hidden="true"
          className="text-base text-[var(--ui-ink-faint)] transition-transform group-open:rotate-45"
        >
          +
        </span>
      </summary>
      <div className="grid gap-3 border-t border-[var(--ui-border-subtle)] px-4 py-3 text-sm leading-6 text-[var(--ui-ink-soft)] sm:grid-cols-2">
        <div>
          <div className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--ui-ink-faint)]">
            Can I rely on it?
          </div>
          <p className="mt-1">{provenance.statusDetail}</p>
          <p className="mt-1">{provenance.confidence.reason}</p>
          <p className="mt-1 text-[var(--ui-ink-muted)]">
            Computed {formatTimestamp(provenance.generatedAt)}.
          </p>
        </div>
        <div>
          <div className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--ui-ink-faint)]">
            Sources
          </div>
          <ul className="mt-1 grid gap-1">
            {provenance.sources.map((source) => (
              <li key={source.id}>{source.label}</li>
            ))}
          </ul>
          {href ? (
            <Link
              className="mt-2 inline-flex min-h-11 items-center font-medium text-[var(--primary)] underline underline-offset-4"
              to={href}
            >
              {actionLabel}
            </Link>
          ) : null}
        </div>
      </div>
    </details>
  );
}
