import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bar, BarChart, ResponsiveContainer, XAxis, YAxis } from "recharts";
import { FlagshipSignalDeck } from "@/components/experience/flagship-signal-deck";
import { SurfaceSkeleton } from "@/components/experience/surface-skeleton";
import { PageHero } from "@/components/shell/page-hero";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ErrorState } from "@/components/ui/page-state";
import { finalizeWeeklyReview, getWeeklyReview } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { invalidateForgeSnapshot } from "@/store/api/invalidate-forge-snapshot";

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
    return <ErrorState eyebrow={t("common.weeklyReview.heroEyebrow")} error={reviewQuery.error} onRetry={() => void reviewQuery.refetch()} />;
  }

  if (!review) {
    return <ErrorState eyebrow={t("common.weeklyReview.heroEyebrow")} error={new Error("Forge returned an empty weekly review payload.")} onRetry={() => void reviewQuery.refetch()} />;
  }

  const strongestWin = review.wins[0] ?? null;
  const recoveryCalibration = review.calibration.find((entry) => entry.mode === "recover") ?? review.calibration[0] ?? null;
  const accelerationCalibration = review.calibration.find((entry) => entry.mode === "accelerate") ?? review.calibration[0] ?? null;
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
      badge: strongestWin ? `+${strongestWin.rewardXp} xp` : `${review.wins.length} wins`
    },
    {
      id: "recovery",
      label: "Recovery",
      title: recoveryCalibration?.title ?? t("common.weeklyReview.noRecovery"),
      detail: recoveryCalibration?.note ?? t("common.weeklyReview.noRecoveryDetail"),
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
            <div className="font-label text-[11px] uppercase tracking-[0.18em] text-white/45">{t("common.weeklyReview.sectionMomentum")}</div>
            <div className="mt-4 h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={review.chart}>
                  <XAxis dataKey="label" tick={{ fill: "rgba(255,255,255,0.42)", fontSize: 11 }} />
                  <YAxis hide />
                  <Bar dataKey="xp" fill="#c0c1ff" radius={[8, 8, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div className="mt-4 grid gap-3 md:grid-cols-3">
              <div className="rounded-[18px] bg-white/[0.04] p-4">
                <div className="font-label text-[11px] uppercase tracking-[0.18em] text-white/40">XP</div>
                <div className="mt-2 text-2xl text-white">{review.momentumSummary.totalXp}</div>
              </div>
              <div className="rounded-[18px] bg-white/[0.04] p-4">
                <div className="font-label text-[11px] uppercase tracking-[0.18em] text-white/40">Focus hours</div>
                <div className="mt-2 text-2xl text-white">{review.momentumSummary.focusHours}</div>
              </div>
              <div className="rounded-[18px] bg-white/[0.04] p-4">
                <div className="font-label text-[11px] uppercase tracking-[0.18em] text-white/40">Peak window</div>
                <div className="mt-2 text-2xl text-white">{review.momentumSummary.peakWindow}</div>
              </div>
            </div>
          </Card>

          <Card>
            <div className="font-label text-[11px] uppercase tracking-[0.18em] text-white/45">{t("common.weeklyReview.sectionGoals")}</div>
            <div className="mt-4 grid gap-3">
              {review.calibration.map((entry) => (
                <div key={entry.id} className="overflow-hidden rounded-[20px] bg-white/[0.04] p-4">
                  <div className="flex min-w-0 items-start justify-between gap-3">
                    <div className="min-w-0 flex-1 font-medium text-white">{entry.title}</div>
                    <Badge className="max-w-[9rem] shrink-0 self-start">{entry.mode}</Badge>
                  </div>
                  <div className="mt-3 text-sm text-white/58">{entry.note}</div>
                </div>
              ))}
            </div>
          </Card>
        </div>

        <div className="grid gap-5">
          <Card>
            <div className="font-label text-[11px] uppercase tracking-[0.18em] text-white/45">{t("common.weeklyReview.sectionWins")}</div>
            <div className="mt-4 grid gap-3">
              {review.wins.map((win) => (
                <div key={win.id} className="overflow-hidden rounded-[20px] bg-white/[0.04] p-4">
                  <div className="flex min-w-0 items-start justify-between gap-3">
                    <div className="min-w-0 flex-1 font-medium text-white">{win.title}</div>
                    <Badge className="max-w-[8rem] shrink-0 self-start text-emerald-300">+{win.rewardXp} xp</Badge>
                  </div>
                  <div className="mt-2 text-sm text-white/58">{win.summary}</div>
                </div>
              ))}
            </div>
          </Card>

          <Card>
            <h2 className="font-display text-3xl text-white">{review.reward.title}</h2>
            <p className="mt-3 text-sm leading-7 text-white/60">{review.reward.summary}</p>
            <div className="mt-4 rounded-[20px] bg-white/[0.04] p-4">
              <div className="font-label text-[11px] uppercase tracking-[0.18em] text-white/40">{t("common.weeklyReview.completionBonus")}</div>
              <div className="mt-2 text-3xl text-[var(--primary)]">+{review.reward.rewardXp} XP</div>
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
              {review.completion.finalized ? t("common.weeklyReview.finalized") : t("common.weeklyReview.finalize")}
            </Button>
            <div className="mt-3 text-sm leading-6 text-white/58">
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
