import { useState } from "react";
import { Link } from "react-router-dom";
import { Plus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/page-state";
import {
  WorkTrendChart,
  formatDate,
  readable
} from "@/components/work/work-components";
import { MetricDefinitionDialog } from "@/components/work/work-operational-dialogs";
import type {
  WorkEngagement,
  WorkRecord,
  WorkTrendSeries
} from "@/lib/work-api";
import { SectionHeading } from "./work-page-overview";

export type TrendWindowDays = 30 | 90 | 180 | 365 | 730;

function trendPointValue(point: WorkTrendSeries["points"][number] | undefined) {
  if (!point) return "No observation";
  if (typeof point.categoricalValue === "string" && point.categoricalValue)
    return point.categoricalValue;
  if (typeof point.numericValue === "number") return String(point.numericValue);
  return readable(point.missingState, "Missing");
}

function trendChangeLabel(series: WorkTrendSeries | undefined) {
  if (!series || series.points.length < 2)
    return series?.points.length ? "First observation" : "No observation";
  const current = series.points.at(-1)!;
  const previous = series.points.at(-2)!;
  if (
    typeof current.numericValue === "number" &&
    typeof previous.numericValue === "number"
  ) {
    const change = current.numericValue - previous.numericValue;
    return change === 0
      ? "No step change"
      : `${change > 0 ? "Up" : "Down"} ${Math.abs(change).toFixed(1)} since last check-in`;
  }
  if (current.categoricalValue && previous.categoricalValue) {
    return current.categoricalValue === previous.categoricalValue
      ? "Category unchanged"
      : `${previous.categoricalValue} → ${current.categoricalValue}`;
  }
  return "Value type changed";
}

export function CheckInsTab({
  engagements,
  trends,
  definitions,
  trendWindowDays,
  mutationEnabled,
  userIds,
  onRefresh,
  onCheckIn,
  onTrendWindowChange
}: {
  engagements: WorkEngagement[];
  trends: WorkTrendSeries[];
  definitions: WorkRecord[];
  trendWindowDays: TrendWindowDays;
  mutationEnabled: boolean;
  userIds: string[];
  onRefresh: () => Promise<void>;
  onCheckIn: (id?: string) => void;
  onTrendWindowChange: (days: TrendWindowDays) => void;
}) {
  const current = engagements.filter((engagement) =>
    ["current", "transitioning", "on_leave"].includes(engagement.status)
  );
  const engagementById = new Map(
    engagements.map((engagement) => [engagement.id, engagement])
  );
  const [metricOpen, setMetricOpen] = useState(false);
  const [selectedMetric, setSelectedMetric] = useState<
    WorkRecord | undefined
  >();
  const [selectedComparisonMetric, setSelectedComparisonMetric] = useState(
    "overall_satisfaction"
  );
  const comparisonMetricKey = definitions.some(
    (definition) => definition.canonicalKey === selectedComparisonMetric
  )
    ? selectedComparisonMetric
    : String(
        definitions[0]?.canonicalKey ??
          trends[0]?.metricKey ??
          "overall_satisfaction"
      );
  const comparisonMetricName = String(
    definitions.find(
      (definition) => definition.canonicalKey === comparisonMetricKey
    )?.displayName ?? readable(comparisonMetricKey)
  );
  return (
    <div className="grid gap-7">
      <SectionHeading
        eyebrow="Longitudinal experience"
        title="How is each role going over time?"
        description={`Each point is a confirmed observation. Showing the past ${trendWindowDays} days without treating one score as permanent truth.`}
        actions={
          <>
            <label className="grid gap-1 text-xs font-medium text-[var(--ui-ink-soft)]">
              Time window
              <select
                aria-label="Check-in trend time window"
                value={trendWindowDays}
                onChange={(event) =>
                  onTrendWindowChange(
                    Number(event.target.value) as TrendWindowDays
                  )
                }
                className="min-h-10 rounded-[14px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] px-3 text-sm text-[var(--ui-ink-strong)]"
              >
                {[30, 90, 180, 365, 730].map((days) => (
                  <option key={days} value={days}>
                    {days === 365
                      ? "1 year"
                      : days === 730
                        ? "2 years"
                        : `${days} days`}
                  </option>
                ))}
              </select>
            </label>
            <Button
              onClick={() => onCheckIn()}
              disabled={!mutationEnabled || current.length === 0}
            >
              <Plus className="size-4" />
              New check-in
            </Button>
          </>
        }
      />
      {current.length ? (
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {current.map((engagement) => {
            const latest = trends
              .filter((series) => series.engagementId === engagement.id)
              .flatMap((series) =>
                series.points.slice(-1).map((point) => ({
                  key: series.metricKey,
                  name: series.displayName ?? readable(series.metricKey),
                  value: trendPointValue(point)
                }))
              )
              .slice(0, 3);
            return (
              <Card key={engagement.id}>
                <div className="flex items-center justify-between gap-3">
                  <Link
                    to={`/work/engagements/${engagement.id}`}
                    className="font-semibold text-[var(--ui-ink-strong)] hover:text-[var(--primary)]"
                  >
                    {engagement.title}
                  </Link>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => onCheckIn(engagement.id)}
                  >
                    Check in
                  </Button>
                </div>
                <div className="mt-4 grid grid-cols-3 gap-2">
                  {latest.map((item) => (
                    <div
                      key={item.key}
                      className="min-w-0 rounded-[14px] bg-[var(--ui-surface-2)] px-2 py-3 text-center"
                    >
                      <div className="truncate text-lg font-semibold text-[var(--ui-ink-strong)]">
                        {item.value}
                      </div>
                      <div className="mt-1 truncate text-[9px] uppercase tracking-[0.1em] text-[var(--ui-ink-faint)]">
                        {item.name}
                      </div>
                    </div>
                  ))}
                  {latest.length === 0 ? (
                    <div className="col-span-3 rounded-[14px] bg-[var(--ui-surface-2)] px-3 py-4 text-center text-xs text-[var(--ui-ink-soft)]">
                      No observations in this window
                    </div>
                  ) : null}
                </div>
              </Card>
            );
          })}
        </div>
      ) : (
        <EmptyState
          title="No current work to check in on"
          description="Add a current work engagement first. Planned and past work remains visible without prompting an experiential check-in."
        />
      )}
      {current.length > 1 ? (
        <section className="grid gap-3">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h3 className="font-semibold text-[var(--ui-ink-strong)]">
                Compare concurrent roles
              </h3>
              <p className="mt-1 text-sm text-[var(--ui-ink-soft)]">
                The same metric is shown role by role. Forge does not combine
                distinct jobs into one synthetic score.
              </p>
            </div>
            <label className="grid gap-1 text-xs font-medium text-[var(--ui-ink-soft)]">
              Metric
              <select
                value={comparisonMetricKey}
                onChange={(event) =>
                  setSelectedComparisonMetric(event.target.value)
                }
                className="min-h-10 min-w-56 rounded-[14px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] px-3 text-sm text-[var(--ui-ink-strong)]"
              >
                {definitions
                  .filter((definition) => definition.enabled !== false)
                  .map((definition) => (
                    <option
                      key={definition.id}
                      value={String(definition.canonicalKey)}
                    >
                      {String(definition.displayName)}
                    </option>
                  ))}
              </select>
            </label>
          </div>
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
            {current.map((engagement) => {
              const series = trends.find(
                (candidate) =>
                  candidate.engagementId === engagement.id &&
                  candidate.metricKey === comparisonMetricKey
              );
              const latest = series?.points.at(-1);
              return (
                <Card key={engagement.id} className="p-4">
                  <Link
                    to={`/work/engagements/${engagement.id}`}
                    className="text-sm font-semibold text-[var(--ui-ink-strong)] hover:text-[var(--primary)]"
                  >
                    {engagement.title}
                  </Link>
                  <div className="mt-3 text-2xl font-semibold text-[var(--ui-ink-strong)]">
                    {trendPointValue(latest)}
                  </div>
                  <div className="mt-1 text-xs text-[var(--ui-ink-soft)]">
                    {comparisonMetricName}
                    {latest ? ` · ${formatDate(latest.observedAt)}` : ""}
                  </div>
                  <div className="mt-3 rounded-[13px] bg-[var(--ui-surface-2)] px-3 py-2 text-xs text-[var(--ui-ink-soft)]">
                    {trendChangeLabel(series)}
                  </div>
                </Card>
              );
            })}
          </div>
        </section>
      ) : null}
      <div className="grid gap-4 md:grid-cols-2">
        {trends.map((series) => (
          <WorkTrendChart
            key={`${series.engagementId}-${series.metricKey}`}
            series={series}
            title={`${engagementById.get(series.engagementId)?.title ?? "Work"} · ${definitions.find((definition) => definition.canonicalKey === series.metricKey)?.displayName ?? readable(series.metricKey)}`}
          />
        ))}
        {trends.length === 0 && current.length ? (
          <Card className="md:col-span-2">
            <h3 className="font-semibold text-[var(--ui-ink-strong)]">
              No trend yet
            </h3>
            <p className="mt-2 text-sm leading-6 text-[var(--ui-ink-soft)]">
              A trend begins with confirmed user observations. Agent suggestions
              remain suggestions until explicitly confirmed and are never
              relabeled as user reports.
            </p>
          </Card>
        ) : null}
      </div>
      <section className="grid gap-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h3 className="font-semibold text-[var(--ui-ink-strong)]">
              Check-in metrics
            </h3>
            <p className="mt-1 text-sm text-[var(--ui-ink-soft)]">
              Enable, rename, or supplement the canonical metrics. Every change
              creates a new version and preserves earlier observations.
            </p>
          </div>
          <Button
            variant="secondary"
            disabled={!mutationEnabled}
            onClick={() => {
              setSelectedMetric(undefined);
              setMetricOpen(true);
            }}
          >
            <Plus className="size-4" />
            Custom metric
          </Button>
        </div>
        <div className="grid gap-2 md:grid-cols-2 lg:grid-cols-3">
          {definitions.map((definition) => (
            <button
              type="button"
              key={definition.id}
              onClick={() => {
                setSelectedMetric(definition);
                setMetricOpen(true);
              }}
              className="rounded-[18px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] p-3 text-left transition hover:bg-[var(--ui-surface-hover)]"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium text-[var(--ui-ink-strong)]">
                    {String(definition.displayName)}
                  </div>
                  <div className="mt-1 truncate text-xs text-[var(--ui-ink-faint)]">
                    {String(definition.canonicalKey)} · version{" "}
                    {String(definition.version)}
                  </div>
                </div>
                <Badge tone={definition.enabled === false ? "meta" : "signal"}>
                  {definition.enabled === false ? "Disabled" : "Enabled"}
                </Badge>
              </div>
            </button>
          ))}
        </div>
      </section>
      <MetricDefinitionDialog
        open={metricOpen}
        onOpenChange={setMetricOpen}
        userIds={userIds}
        definition={selectedMetric}
        onSaved={onRefresh}
      />
    </div>
  );
}
