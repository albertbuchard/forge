import { motion } from "framer-motion";
import { Badge } from "@/components/ui/badge";
import { ProgressMeter } from "@/components/ui/progress-meter";
import { cn, formatDateTime } from "@/lib/utils";
import type { AchievementSignal, MilestoneReward, RewardLedgerEvent, XpMetricsPayload, XpMomentumPulse } from "@/lib/types";

type XpCommandDeckProps = {
  profile: XpMetricsPayload["profile"];
  achievements: AchievementSignal[];
  milestoneRewards: MilestoneReward[];
  momentumPulse: XpMomentumPulse;
  recentLedger?: RewardLedgerEvent[];
  className?: string;
  tone?: "core" | "psyche";
};

function achievementTone(tier: AchievementSignal["tier"]) {
  switch (tier) {
    case "platinum":
      return "text-cyan-200";
    case "gold":
      return "text-amber-200";
    case "silver":
      return "text-slate-200";
    default:
      return "text-orange-200";
  }
}

function statusTone(status: XpMomentumPulse["status"]) {
  switch (status) {
    case "surging":
      return "from-[rgba(192,193,255,0.3)] via-[rgba(78,222,163,0.22)] to-[rgba(255,185,95,0.22)]";
    case "steady":
      return "from-[rgba(192,193,255,0.24)] via-[rgba(192,193,255,0.14)] to-[rgba(78,222,163,0.18)]";
    default:
      return "from-[rgba(255,185,95,0.2)] via-[rgba(255,185,95,0.12)] to-[rgba(192,193,255,0.16)]";
  }
}

export function XpCommandDeck({
  profile,
  achievements,
  milestoneRewards,
  momentumPulse,
  recentLedger = [],
  className,
  tone = "core"
}: XpCommandDeckProps) {
  const unlocked = achievements.filter((achievement) => achievement.unlocked);
  const visibleAchievements = (unlocked.length > 0 ? unlocked : achievements).slice(0, 3);
  const visibleMilestones = milestoneRewards.slice(0, 3);
  const visibleLedger = recentLedger.slice(0, 3);
  const nextLevelProgress = Math.min(100, Math.round((profile.currentLevelXp / profile.nextLevelXp) * 100));

  return (
    <section
      className={cn(
        "min-w-0 overflow-hidden rounded-[30px] border border-white/6 bg-[linear-gradient(180deg,rgba(18,24,40,0.96),rgba(11,16,28,0.94))] shadow-[0_24px_70px_rgba(4,8,18,0.3)]",
        tone === "psyche" && "bg-[linear-gradient(180deg,rgba(18,27,35,0.96),rgba(12,20,26,0.94))]",
        className
      )}
    >
      <div className={cn("bg-gradient-to-r px-5 py-5", statusTone(momentumPulse.status))}>
        <div className="flex min-w-0 flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="font-label text-[11px] uppercase tracking-[0.2em] text-white/55">Weekly progress</div>
            <h2 className="mt-3 font-display text-3xl leading-none text-white lg:text-4xl">{momentumPulse.headline}</h2>
            <p className="mt-3 max-w-3xl text-sm leading-7 text-white/68">{momentumPulse.detail}</p>
          </div>
          <div className="flex min-w-0 flex-wrap gap-2">
            <Badge wrap className="bg-black/20 text-white/84">Level {profile.level}</Badge>
            <Badge wrap className="bg-black/20 text-white/84">{profile.streakDays} day streak</Badge>
            <Badge wrap className="bg-black/20 text-white/84">{profile.weeklyXp} weekly XP</Badge>
          </div>
        </div>
      </div>

      <div className="grid gap-5 px-5 py-5 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)]">
        <div className="grid gap-5">
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.24, ease: "easeOut" }}
            className="overflow-hidden rounded-[24px] bg-white/[0.04] p-4"
          >
            <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="font-medium text-white">Next reward</div>
                <div className="mt-2 text-sm text-white/60">{momentumPulse.nextMilestoneLabel}</div>
              </div>
              <Badge wrap className="max-w-[12rem] shrink-0 self-start text-[var(--tertiary)]">{momentumPulse.celebrationLabel}</Badge>
            </div>
            <div className="mt-5">
              <ProgressMeter value={nextLevelProgress} />
            </div>
            <div className="mt-3 flex items-center justify-between gap-3 text-xs uppercase tracking-[0.16em] text-white/38">
              <span>{profile.currentLevelXp}/{profile.nextLevelXp} XP</span>
              <span>{profile.comboMultiplier.toFixed(2)}x combo</span>
            </div>
          </motion.div>

          <div className="grid gap-3 md:grid-cols-3">
            {visibleAchievements.map((achievement, index) => (
              <motion.div
                key={achievement.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.24, delay: 0.04 * index, ease: "easeOut" }}
                className="overflow-hidden rounded-[22px] bg-white/[0.04] p-4"
              >
                <div className="flex min-w-0 items-start justify-between gap-3">
                  <div className="min-w-0 flex-1 font-medium text-white">{achievement.title}</div>
                  <Badge wrap className={cn("max-w-[8rem] shrink-0 self-start", achievementTone(achievement.tier))}>{achievement.tier}</Badge>
                </div>
                <div className="mt-2 text-sm leading-6 text-white/58">{achievement.summary}</div>
                <div className="mt-4 text-xs uppercase tracking-[0.16em] text-white/40">{achievement.progressLabel}</div>
              </motion.div>
            ))}
          </div>
        </div>

        <div className="grid gap-4">
          <div className="overflow-hidden rounded-[24px] bg-white/[0.04] p-4">
            <div className="font-label text-[11px] uppercase tracking-[0.18em] text-white/45">Rewards in progress</div>
            <div className="mt-4 grid gap-3">
              {visibleMilestones.map((milestone) => {
                const progress = Math.min(100, Math.round((milestone.current / milestone.target) * 100));
                return (
                  <div key={milestone.id} className="overflow-hidden rounded-[18px] bg-[rgba(8,13,28,0.68)] p-4">
                    <div className="flex min-w-0 items-start justify-between gap-3">
                      <div className="min-w-0 flex-1 font-medium text-white">{milestone.title}</div>
                      <Badge wrap className={cn("max-w-[10.5rem] shrink-0 self-start", milestone.completed ? "text-emerald-300" : "text-white/68")}>{milestone.rewardLabel}</Badge>
                    </div>
                    <div className="mt-2 text-sm text-white/58">{milestone.summary}</div>
                    <div className="mt-4">
                      <ProgressMeter value={progress} />
                    </div>
                    <div className="mt-3 text-xs uppercase tracking-[0.16em] text-white/38">{milestone.progressLabel}</div>
                  </div>
                );
              })}
            </div>
          </div>

          {visibleLedger.length > 0 ? (
            <div className="overflow-hidden rounded-[24px] bg-white/[0.04] p-4">
              <div className="font-label text-[11px] uppercase tracking-[0.18em] text-white/45">Recent XP changes</div>
              <div className="mt-4 grid gap-3">
                {visibleLedger.map((event) => (
                  <div key={event.id} className="overflow-hidden rounded-[18px] bg-[rgba(8,13,28,0.68)] p-4">
                    <div className="flex min-w-0 items-start justify-between gap-3">
                      <div className="min-w-0 flex-1 font-medium text-white">{event.reasonTitle}</div>
                      <Badge wrap className={cn("max-w-[8rem] shrink-0 self-start", event.deltaXp >= 0 ? "text-emerald-300" : "text-amber-300")}>
                        {event.deltaXp > 0 ? "+" : ""}
                        {event.deltaXp} XP
                      </Badge>
                    </div>
                    <div className="mt-2 text-sm text-white/58">{event.reasonSummary}</div>
                    <div className="mt-3 text-xs uppercase tracking-[0.16em] text-white/38">{formatDateTime(event.createdAt)}</div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}
