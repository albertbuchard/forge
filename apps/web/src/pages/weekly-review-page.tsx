import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FlagshipSignalDeck } from "@/components/experience/flagship-signal-deck";
import { SurfaceSkeleton } from "@/components/experience/surface-skeleton";
import { PageHero } from "@/components/shell/page-hero";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ErrorState } from "@/components/ui/page-state";
import { finalizeWeeklyReview, getWeeklyReview } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import type { WeeklyReviewPayload } from "@/lib/types";
import { invalidateForgeSnapshot } from "@/store/api/invalidate-forge-snapshot";

const reviewEyebrowClass =
  "font-label text-[11px] uppercase tracking-[0.18em] text-[var(--ui-ink-faint)]";
const reviewPanelClass =
  "overflow-hidden rounded-[20px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)]";
const reviewSoftTextClass = "text-sm leading-6 text-[var(--ui-ink-soft)]";

function WeeklyReviewBarChart({
  data
}: {
  data: WeeklyReviewPayload["chart"];
}) {
  const max = Math.max(1, ...data.map((entry) => entry.xp));
  const barWidth =
    data.length > 0 ? Math.max(4, Math.min(18, 280 / data.length - 4)) : 8;
  const gap =
    data.length > 1
      ? Math.max(1, (300 - data.length * barWidth) / (data.length - 1))
      : 0;

  return (
    <div className="mt-4 aspect-[16/9] min-h-56 w-full min-w-0 overflow-hidden rounded-[18px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)] p-3">
      <svg
        viewBox="0 0 340 200"
        role="img"
        aria-label="Weekly review XP chart"
        className="h-full w-full"
      >
        <g stroke="var(--ui-border-subtle)" strokeWidth="1">
          {[45, 85, 125, 165].map((y) => (
            <line key={y} x1="20" x2="320" y1={y} y2={y} />
          ))}
        </g>
        {data.map((entry, index) => {
          const x = 20 + index * (barWidth + gap);
          const height = Math.max(2, (entry.xp / max) * 128);
          return (
            <g key={`${entry.label}-${index}`}>
              <rect
                x={x}
                y={168 - height}
                width={barWidth}
                height={height}
                rx="5"
                fill="var(--primary)"
              />
              {index === 0 || index === data.length - 1 || index % 3 === 0 ? (
                <text
                  x={x + barWidth / 2}
                  y="192"
                  fill="var(--ui-ink-faint)"
                  fontSize="10"
                  textAnchor="middle"
                >
                  {entry.label}
                </text>
              ) : null}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

export function WeeklyReviewPage() {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const reviewQuery = useQuery({
    queryKey: ["forge-weekly-review"],
    queryFn: getWeeklyReview
  });
  const finalizeMutation = useMutation({
    mutationFn: finalizeWeeklyReview,
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["forge-weekly-review"] }),
        queryClient.invalidateQueries({ queryKey: ["forge-xp-metrics"] }),
        queryClient.invalidateQueries({ queryKey: ["forge-reward-ledger"] }),
        invalidateForgeSnapshot(queryClient),
        queryClient.invalidateQueries({ queryKey: ["activity-archive"] })
      ]);
    }
  });
  const review = reviewQuery.data?.review;

  if (reviewQuery.isLoading) {
    return <SurfaceSkeleton />;
  }

  if (reviewQuery.isError) {
    return (
      <ErrorState
        eyebrow={t("common.weeklyReview.heroEyebrow")}
        error={reviewQuery.error}
        onRetry={() => void reviewQuery.refetch()}
      />
    );
  }

  if (!review) {
    return (
      <ErrorState
        eyebrow={t("common.weeklyReview.heroEyebrow")}
        error={new Error("Forge returned an empty weekly review payload.")}
        onRetry={() => void reviewQuery.refetch()}
      />
    );
  }

  const strongestWin = review.wins[0] ?? null;
  const recoveryCalibration =
    review.calibration.find((entry) => entry.mode === "recover") ??
    review.calibration[0] ??
    null;
  const accelerationCalibration =
    review.calibration.find((entry) => entry.mode === "accelerate") ??
    review.calibration[0] ??
    null;
  const reviewSignals = [
    {
      id: "week",
      label: "This week",
      title: `${review.momentumSummary.totalXp} XP with ${review.momentumSummary.focusHours} focus hours`,
      detail: `Peak window: ${review.momentumSummary.peakWindow}. Efficiency score is holding at ${review.momentumSummary.efficiencyScore}.`,
      badge: review.windowLabel
    },
    {
      id: "wins",
      label: "Wins",
      title: strongestWin?.title ?? t("common.weeklyReview.noWin"),
      detail: strongestWin?.summary ?? t("common.weeklyReview.noWinDetail"),
      badge: strongestWin
        ? `+${strongestWin.rewardXp} xp`
        : `${review.wins.length} wins`
    },
    {
      id: "recovery",
      label: "Recovery",
      title: recoveryCalibration?.title ?? t("common.weeklyReview.noRecovery"),
      detail:
        recoveryCalibration?.note ?? t("common.weeklyReview.noRecoveryDetail"),
      badge: recoveryCalibration?.mode ?? "maintain"
    },
    {
      id: "next-intent",
      label: "Next intent",
      title: accelerationCalibration?.title ?? review.reward.title,
      detail: accelerationCalibration?.note ?? review.reward.summary,
      badge: `+${review.reward.rewardXp} xp`
    }
  ] as const;

  return (
    <div className="grid gap-5">
      <PageHero
        title="Weekly Review"
        description={`${review.windowLabel}. ${t("common.weeklyReview.heroDescription")}`}
        badge={`${review.momentumSummary.totalXp} xp`}
      />

      <section className="grid gap-5 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)]">
        <div className="grid gap-5">
          <Card>
            <div className={reviewEyebrowClass}>
              {t("common.weeklyReview.sectionMomentum")}
            </div>
            <WeeklyReviewBarChart data={review.chart} />
            <div className="mt-4 grid gap-3 md:grid-cols-3">
              <div className={`${reviewPanelClass} p-4`}>
                <div className={reviewEyebrowClass}>XP</div>
                <div className="mt-2 text-2xl text-[var(--ui-ink-strong)]">
                  {review.momentumSummary.totalXp}
                </div>
              </div>
              <div className={`${reviewPanelClass} p-4`}>
                <div className={reviewEyebrowClass}>Focus hours</div>
                <div className="mt-2 text-2xl text-[var(--ui-ink-strong)]">
                  {review.momentumSummary.focusHours}
                </div>
              </div>
              <div className={`${reviewPanelClass} p-4`}>
                <div className={reviewEyebrowClass}>Peak window</div>
                <div className="mt-2 break-words text-2xl text-[var(--ui-ink-strong)]">
                  {review.momentumSummary.peakWindow}
                </div>
              </div>
            </div>
          </Card>

          <Card>
            <div className={reviewEyebrowClass}>
              {t("common.weeklyReview.sectionGoals")}
            </div>
            <div className="mt-4 grid gap-3">
              {review.calibration.map((entry) => (
                <div key={entry.id} className={`${reviewPanelClass} p-4`}>
                  <div className="flex min-w-0 items-start justify-between gap-3">
                    <div className="min-w-0 flex-1 break-words font-medium text-[var(--ui-ink-strong)]">
                      {entry.title}
                    </div>
                    <Badge className="max-w-[9rem] shrink-0 self-start">
                      {entry.mode}
                    </Badge>
                  </div>
                  <div className={`mt-3 break-words ${reviewSoftTextClass}`}>
                    {entry.note}
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </div>

        <div className="grid gap-5">
          <Card>
            <div className={reviewEyebrowClass}>
              {t("common.weeklyReview.sectionWins")}
            </div>
            <div className="mt-4 grid gap-3">
              {review.wins.map((win) => (
                <div key={win.id} className={`${reviewPanelClass} p-4`}>
                  <div className="flex min-w-0 items-start justify-between gap-3">
                    <div className="min-w-0 flex-1 break-words font-medium text-[var(--ui-ink-strong)]">
                      {win.title}
                    </div>
                    <Badge
                      tone="signal"
                      className="max-w-[8rem] shrink-0 self-start"
                    >
                      +{win.rewardXp} xp
                    </Badge>
                  </div>
                  <div className={`mt-2 break-words ${reviewSoftTextClass}`}>
                    {win.summary}
                  </div>
                </div>
              ))}
            </div>
          </Card>

          <Card>
            <h2 className="break-words font-display text-3xl text-[var(--ui-ink-strong)]">
              {review.reward.title}
            </h2>
            <p className={`mt-3 leading-7 ${reviewSoftTextClass}`}>
              {review.reward.summary}
            </p>
            <div className={`mt-4 ${reviewPanelClass} p-4`}>
              <div className={reviewEyebrowClass}>
                {t("common.weeklyReview.completionBonus")}
              </div>
              <div className="mt-2 text-3xl text-[var(--primary)]">
                +{review.reward.rewardXp} XP
              </div>
            </div>
            <Button
              className="mt-4 w-full"
              disabled={review.completion.finalized}
              pending={finalizeMutation.isPending}
              pendingLabel={t("common.weeklyReview.finalizePending")}
              onClick={async () => {
                await finalizeMutation.mutateAsync();
              }}
            >
              {review.completion.finalized
                ? t("common.weeklyReview.finalized")
                : t("common.weeklyReview.finalize")}
            </Button>
            <div className={`mt-3 ${reviewSoftTextClass}`}>
              {review.completion.finalized
                ? `${t("common.weeklyReview.finalizedDetail")} ${review.completion.finalizedBy ? `By ${review.completion.finalizedBy}. ` : ""}${review.completion.finalizedAt ? new Date(review.completion.finalizedAt).toLocaleString() : ""}`.trim()
                : review.reward.summary}
            </div>
          </Card>
        </div>
      </section>

      <FlagshipSignalDeck
        eyebrow={t("common.weeklyReview.summaryEyebrow")}
        title={t("common.weeklyReview.summaryTitle")}
        description={t("common.weeklyReview.summaryDescription")}
        items={reviewSignals}
      />
    </div>
  );
}
