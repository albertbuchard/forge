import { useQuery } from "@tanstack/react-query";
import { SurfaceSkeleton } from "@/components/experience/surface-skeleton";
import { PsycheMetricsWorkspace } from "@/components/psyche/psyche-metrics-workspace";
import { PsycheSectionNav } from "@/components/psyche/psyche-section-nav";
import { useForgeShell } from "@/components/shell/app-shell";
import { PageHero } from "@/components/shell/page-hero";
import { ErrorState } from "@/components/ui/page-state";
import { getPsycheMetricsView } from "@/lib/api";

export function PsycheMetricsPage() {
  const shell = useForgeShell();
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  const metricsQuery = useQuery({
    queryKey: ["forge-psyche-metrics-view", timeZone, ...shell.selectedUserIds],
    queryFn: async () =>
      (
        await getPsycheMetricsView({
          userIds: shell.selectedUserIds,
          timeZone
        })
      ).metrics
  });

  return (
    <div className="mx-auto grid w-full max-w-[1380px] gap-5">
      <PageHero
        title="Psyche Metrics"
        titleText="Psyche Metrics"
        description="Review Psyche signals with explicit measurement scope, missingness, freshness, and provenance."
        badge={
          metricsQuery.data
            ? metricsQuery.data.context.freshness.status === "partial"
              ? "Scanner freshness partial"
              : metricsQuery.data.summary.hasData
                ? `${metricsQuery.data.summary.metricCount} descriptive metrics`
                : "No metrics yet"
            : metricsQuery.isError
              ? "Metrics unavailable"
              : "Loading metrics"
        }
      />
      <PsycheSectionNav />

      {metricsQuery.isLoading ? (
        <div role="status" aria-live="polite" aria-busy="true">
          <span className="sr-only">
            Loading stored Psyche metrics and provenance.
          </span>
          <SurfaceSkeleton
            header={false}
            sideRail={false}
            columns={2}
            blocks={4}
          />
        </div>
      ) : metricsQuery.isError || !metricsQuery.data ? (
        <ErrorState
          eyebrow="Psyche metrics"
          error={metricsQuery.error ?? new Error("Psyche metrics unavailable")}
          onRetry={() => void metricsQuery.refetch()}
        />
      ) : (
        <PsycheMetricsWorkspace metrics={metricsQuery.data} />
      )}
    </div>
  );
}
