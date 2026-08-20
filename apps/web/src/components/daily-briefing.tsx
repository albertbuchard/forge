import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  CalendarDays,
  ChevronRight,
  Database,
  Gauge,
  RefreshCcw,
  Sparkles
} from "lucide-react";
import { Link } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { getDailyBriefing } from "@/lib/api";
import type {
  DailyBriefing,
  DailyBriefingSection,
  DailyBriefingSectionKey
} from "@/lib/types";
import { cn } from "@/lib/utils";

const sectionIcons: Record<DailyBriefingSectionKey, typeof Database> = {
  work: Sparkles,
  schedule: CalendarDays,
  capacity: Gauge,
  recent_activity: Database
};

function statusLabel(status: DailyBriefingSection["status"]) {
  return status.replace("_", " ");
}

function formatObservedAt(value: string | null, timeZone: string) {
  if (!value) return "Observation time unavailable";
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) return "Observation time unavailable";
  return new Intl.DateTimeFormat(undefined, {
    timeZone,
    dateStyle: "medium",
    timeStyle: "short"
  }).format(parsed);
}

function BriefingSection({
  section,
  timeZone
}: {
  section: DailyBriefingSection;
  timeZone: string;
}) {
  const Icon = sectionIcons[section.key];
  const needsAttention = [
    "partial",
    "stale",
    "future",
    "conflict",
    "omitted"
  ].includes(section.status);

  return (
    <section
      aria-labelledby={`daily-briefing-${section.key}`}
      className="min-w-0 rounded-[18px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] p-4"
    >
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="grid size-9 shrink-0 place-items-center rounded-full bg-[var(--ui-surface-2)] text-[var(--ui-ink-medium)]">
            <Icon aria-hidden="true" className="size-4" />
          </span>
          <div className="min-w-0">
            <h3
              id={`daily-briefing-${section.key}`}
              className="text-sm font-semibold text-[var(--ui-ink-strong)]"
            >
              {section.label}
            </h3>
            <p className="text-xs text-[var(--ui-ink-faint)]">
              {section.availableCount} available · {section.inspectedCount}{" "}
              inspected
            </p>
          </div>
        </div>
        <Badge
          tone={needsAttention ? "meta" : "signal"}
          className={cn(
            "capitalize",
            needsAttention && "text-[var(--warning)]"
          )}
        >
          {statusLabel(section.status)}
        </Badge>
      </div>

      {section.statements.length > 0 ? (
        <div className="mt-3 grid min-w-0 gap-3">
          {section.statements.map((statement) => (
            <div key={statement.id} className="min-w-0">
              {statement.href ? (
                <Link
                  to={statement.href}
                  className="group inline-flex min-h-11 max-w-full items-center gap-2 rounded-xl px-1 text-sm font-medium leading-6 text-[var(--ui-ink-strong)] hover:text-[var(--primary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary)]"
                >
                  <span className="min-w-0 break-words">{statement.text}</span>
                  <ChevronRight
                    aria-hidden="true"
                    className="size-4 shrink-0 transition group-hover:translate-x-0.5"
                  />
                </Link>
              ) : (
                <p className="text-sm font-medium leading-6 text-[var(--ui-ink-strong)]">
                  {statement.text}
                </p>
              )}
              <details className="mt-1 min-w-0 text-xs text-[var(--ui-ink-soft)]">
                <summary className="inline-flex min-h-11 cursor-pointer items-center rounded-lg px-1 font-medium text-[var(--ui-ink-medium)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary)]">
                  Source and freshness
                </summary>
                <div className="min-w-0 space-y-2 border-l border-[var(--ui-border-subtle)] pl-3 leading-5">
                  <p>
                    {statement.freshness} ·{" "}
                    {formatObservedAt(statement.observedAt, timeZone)}
                  </p>
                  <p>{statement.provenance.statusDetail}</p>
                  <ul className="space-y-1">
                    {statement.provenance.sources.map((source) => (
                      <li key={source.id} className="break-words">
                        {source.label}
                      </li>
                    ))}
                  </ul>
                  <ul className="space-y-1 font-mono text-[11px]">
                    {statement.provenance.evidence.map((evidence) => (
                      <li key={evidence.reference} className="break-all">
                        {evidence.reference}
                      </li>
                    ))}
                  </ul>
                </div>
              </details>
            </div>
          ))}
        </div>
      ) : null}

      {section.omissionReason ? (
        <p className="mt-3 text-sm leading-6 text-[var(--ui-ink-soft)]">
          {section.omissionReason}
        </p>
      ) : null}
    </section>
  );
}

function BriefingBody({ briefing }: { briefing: DailyBriefing }) {
  return (
    <>
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] uppercase tracking-[0.16em] text-[var(--ui-ink-faint)]">
            Daily briefing
          </p>
          <h2
            id="daily-briefing-title"
            className="mt-1 text-xl font-semibold text-[var(--ui-ink-strong)]"
          >
            {briefing.headline}
          </h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--ui-ink-soft)]">
            See what matters now, with the source and freshness beside every
            statement.
          </p>
        </div>
        <Badge tone={briefing.status === "ready" ? "signal" : "meta"}>
          {briefing.status}
        </Badge>
      </div>
      <div className="mt-4 grid min-w-0 gap-3 lg:grid-cols-2">
        {briefing.sections.map((section) => (
          <BriefingSection
            key={section.key}
            section={section}
            timeZone={briefing.timeZone}
          />
        ))}
      </div>
    </>
  );
}

export function DailyBriefingPanel({
  ownerUserId
}: {
  ownerUserId: string | null;
}) {
  const timeZone = useMemo(
    () => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
    []
  );
  const query = useQuery({
    queryKey: ["forge-daily-briefing", ownerUserId, timeZone],
    queryFn: () => getDailyBriefing({ userId: ownerUserId!, timeZone }),
    enabled: Boolean(ownerUserId),
    retry: false,
    staleTime: 30_000
  });
  const offline =
    typeof navigator !== "undefined" && navigator.onLine === false;

  return (
    <section
      id="daily-briefing"
      aria-labelledby="daily-briefing-title"
      aria-busy={query.isLoading}
      className="min-w-0 scroll-mt-24 rounded-[22px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)] p-4 shadow-[var(--ui-shadow-soft)] sm:p-5"
    >
      {!ownerUserId ? (
        <div className="grid min-h-40 place-items-center text-center">
          <div className="max-w-xl">
            <h2
              id="daily-briefing-title"
              className="text-lg font-semibold text-[var(--ui-ink-strong)]"
            >
              Select one person for a daily briefing
            </h2>
            <p className="mt-2 text-sm leading-6 text-[var(--ui-ink-soft)]">
              Forge keeps work, schedule, capacity, and activity evidence
              separate by owner.
            </p>
          </div>
        </div>
      ) : query.isLoading ? (
        <div
          className="grid min-h-40 place-items-center text-center"
          role="status"
        >
          <div>
            <h2
              id="daily-briefing-title"
              className="text-lg font-semibold text-[var(--ui-ink-strong)]"
            >
              Reading today’s authorized evidence
            </h2>
            <p className="mt-2 text-sm text-[var(--ui-ink-soft)]">
              Forge is checking bounded work, schedule, capacity, and recent
              activity.
            </p>
          </div>
        </div>
      ) : query.isError || !query.data?.briefing ? (
        <div
          className="grid min-h-40 place-items-center text-center"
          role="alert"
        >
          <div className="max-w-xl">
            <AlertTriangle
              aria-hidden="true"
              className="mx-auto size-5 text-[var(--warning)]"
            />
            <h2
              id="daily-briefing-title"
              className="mt-2 text-lg font-semibold text-[var(--ui-ink-strong)]"
            >
              {offline
                ? "Daily briefing is offline"
                : "Daily briefing is unavailable"}
            </h2>
            <p className="mt-2 text-sm leading-6 text-[var(--ui-ink-soft)]">
              {offline
                ? "Reconnect to the local Forge runtime, then try this read again. No data was changed."
                : "Forge could not read the briefing. No data was changed."}
            </p>
            <Button
              type="button"
              variant="secondary"
              className="mt-4 min-h-11"
              onClick={() => void query.refetch()}
            >
              <RefreshCcw aria-hidden="true" className="mr-2 size-4" />
              Try again
            </Button>
          </div>
        </div>
      ) : (
        <>
          <span className="sr-only" aria-live="polite">
            Daily briefing {query.data.briefing.status}.
          </span>
          <div className="flex min-w-0 items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <BriefingBody briefing={query.data.briefing} />
            </div>
            <Button
              type="button"
              size="md"
              variant="ghost"
              className="min-h-11 min-w-11 shrink-0 px-0"
              aria-label="Refresh daily briefing"
              title="Refresh daily briefing"
              onClick={() => void query.refetch()}
              disabled={query.isFetching}
            >
              <RefreshCcw
                aria-hidden="true"
                className={cn("size-4", query.isFetching && "animate-spin")}
              />
            </Button>
          </div>
        </>
      )}
    </section>
  );
}
