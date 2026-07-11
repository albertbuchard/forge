import { useState } from "react";
import { FlaskConical, Plus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { SurfacePanel } from "@/components/ui/surface";
import type { WeightLossViewData } from "@/lib/weight-loss-types";
import { formatNumber, text } from "./weight-loss-format";
import { WeightLossEmptyState } from "./weight-loss-cards";

export function WeightLossHypothesesPanel({
  hypotheses
}: {
  hypotheses: Array<Record<string, unknown>>;
}) {
  return (
    <Card className="grid gap-4 border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] p-5">
      <div>
        <div className="text-[11px] uppercase tracking-[0.18em] text-[var(--ui-ink-faint)]">
          Hypotheses
        </div>
        <h2 className="mt-1 text-xl font-semibold text-[var(--ui-ink-strong)]">
          Food and body pattern candidates
        </h2>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        {hypotheses.length > 0 ? (
          hypotheses.slice(0, 6).map((hypothesis, index) => (
            <SurfacePanel key={String(hypothesis.key ?? index)}>
              <div className="flex items-center justify-between gap-3">
                <Badge tone="signal">
                  {text(hypothesis.metric) ?? "pattern"}
                </Badge>
                <span className="text-xs text-[var(--ui-ink-faint)]">
                  {formatNumber(hypothesis.confidence, 2)}
                </span>
              </div>
              <div className="mt-3 text-sm font-medium text-[var(--ui-ink-strong)]">
                {text(hypothesis.label) ?? "Candidate pattern"}
              </div>
              <p className="mt-2 text-sm leading-6 text-[var(--ui-ink-soft)]">
                {text(hypothesis.description) ??
                  "Forge needs more paired meals and check-ins to harden this signal."}
              </p>
            </SurfacePanel>
          ))
        ) : (
          <div className="md:col-span-2">
            <WeightLossEmptyState>
              Log meals plus energy, gut, and look check-ins for a few days to
              generate pattern candidates.
            </WeightLossEmptyState>
          </div>
        )}
      </div>
    </Card>
  );
}

export function WeightLossExperimentsPanel({
  experiments,
  onCreate,
  onReview
}: {
  experiments: WeightLossViewData["experiments"];
  onCreate: () => void;
  onReview: (experiment: WeightLossViewData["experiments"][number]) => void;
}) {
  const [visibleCount, setVisibleCount] = useState(4);
  const visibleExperiments = experiments.slice(0, visibleCount);
  return (
    <Card className="grid content-start gap-4 border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="rounded-2xl bg-[var(--ui-info-soft)] p-2.5 text-[color-mix(in_srgb,var(--info)_78%,var(--ui-ink-strong)_22%)]">
            <FlaskConical className="size-5" />
          </div>
          <div>
            <div className="text-[11px] uppercase tracking-[0.18em] text-[var(--ui-ink-faint)]">
              Experiments
            </div>
            <h2 className="text-xl font-semibold text-[var(--ui-ink-strong)]">
              N-of-1 lab
            </h2>
          </div>
        </div>
        <Button type="button" size="sm" onClick={onCreate}>
          <Plus className="size-4" />
          New experiment
        </Button>
      </div>
      <div className="grid gap-3">
        {visibleExperiments.map((experiment, index) => (
          <SurfacePanel key={String(experiment.id ?? index)}>
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="text-sm font-medium text-[var(--ui-ink-strong)]">
                {text(experiment.title) ?? "Nutrition experiment"}
              </div>
              <Badge tone="meta">{experiment.status}</Badge>
            </div>
            <p className="mt-2 text-sm leading-6 text-[var(--ui-ink-soft)]">
              {text(experiment.hypothesis) ??
                text(experiment.intervention) ??
                "No hypothesis recorded."}
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              {experiment.metricKey ? (
                <Badge tone="signal">{experiment.metricKey}</Badge>
              ) : null}
              {experiment.experimentStart || experiment.experimentEnd ? (
                <Badge tone="meta">
                  {experiment.experimentStart ?? "unscheduled"} to{" "}
                  {experiment.experimentEnd ?? "open"}
                </Badge>
              ) : null}
              <Button
                type="button"
                size="sm"
                variant="secondary"
                onClick={() => onReview(experiment)}
              >
                Review
              </Button>
            </div>
          </SurfacePanel>
        ))}
        {experiments.length === 0 ? (
          <WeightLossEmptyState>
            No experiment yet. Define one change and one primary outcome so the
            result stays interpretable.
          </WeightLossEmptyState>
        ) : null}
        {visibleCount < experiments.length ? (
          <Button
            type="button"
            variant="secondary"
            onClick={() =>
              setVisibleCount((current) =>
                Math.min(experiments.length, current + 4)
              )
            }
          >
            Show next experiments
          </Button>
        ) : null}
      </div>
    </Card>
  );
}

export function WeightLossDataQualityPanel({
  view
}: {
  view: WeightLossViewData;
}) {
  const dataQuality = view.dataQuality;
  const ledger = view.todayLedger;
  return (
    <Card className="grid gap-4 border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-[11px] uppercase tracking-[0.18em] text-[var(--ui-ink-faint)]">
            Data quality
          </div>
          <h2 className="mt-1 text-xl font-semibold text-[var(--ui-ink-strong)]">
            Confidence, coverage, and next evidence
          </h2>
        </div>
        <Badge tone="meta">
          {view.summary.dataQualityScore.toFixed(0)}% coverage
        </Badge>
      </div>
      <div className="grid gap-3 md:grid-cols-3">
        <QualityBlock
          label="Source confidence"
          value={dataQuality.sourceConfidence}
        >
          Food parsing stays candidate-based until accepted; wearable burn is
          treated as a trend input.
        </QualityBlock>
        <SurfacePanel>
          <div className="text-[11px] uppercase tracking-[0.16em] text-[var(--ui-ink-faint)]">
            Missing check-ins
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {dataQuality.missingHighValueCheckins.length > 0 ? (
              dataQuality.missingHighValueCheckins.map((entry) => (
                <Badge key={entry} tone="signal">
                  {entry}
                </Badge>
              ))
            ) : (
              <span className="text-sm text-[var(--ui-ink-soft)]">
                Core evidence loop is covered.
              </span>
            )}
          </div>
        </SurfacePanel>
        <SurfacePanel>
          <div className="text-[11px] uppercase tracking-[0.16em] text-[var(--ui-ink-faint)]">
            Next best cue
          </div>
          <p className="mt-2 text-sm leading-6 text-[var(--ui-ink-soft)]">
            {dataQuality.notes}
          </p>
          <div className="mt-3 text-xs text-[var(--ui-ink-faint)]">
            {ledger.unconfirmedCount} unconfirmed candidate
            {ledger.unconfirmedCount === 1 ? "" : "s"}
          </div>
        </SurfacePanel>
      </div>
    </Card>
  );
}

function QualityBlock({
  label,
  value,
  children
}: {
  label: string;
  value: string;
  children: string;
}) {
  return (
    <SurfacePanel>
      <div className="text-[11px] uppercase tracking-[0.16em] text-[var(--ui-ink-faint)]">
        {label}
      </div>
      <div className="mt-2 text-lg font-semibold text-[var(--ui-ink-strong)]">
        {value}
      </div>
      <p className="mt-2 text-sm leading-6 text-[var(--ui-ink-soft)]">
        {children}
      </p>
    </SurfacePanel>
  );
}
