import { motion, useReducedMotion } from "framer-motion";
import { Badge } from "@/components/ui/badge";
import { ProgressMeter } from "@/components/ui/progress-meter";
import { cn, formatDateTime } from "@/lib/utils";
import type {
  AchievementSignal,
  MilestoneReward,
  RewardLedgerEvent,
  XpMetricsPayload,
  XpMomentumPulse
} from "@/lib/types";

type XpCommandDeckProps = {
  profile: XpMetricsPayload["profile"];
  achievements: AchievementSignal[];
  milestoneRewards: MilestoneReward[];
  momentumPulse: XpMomentumPulse;
  recentLedger?: RewardLedgerEvent[];
  scopeLabel?: string;
  className?: string;
  tone?: "core" | "psyche";
};

function achievementTone(tier: AchievementSignal["tier"]) {
  switch (tier) {
    case "platinum":
      return "bg-[var(--ui-accent-soft)] text-[var(--primary)]";
    case "gold":
      return "bg-[var(--ui-warning-soft)] text-[color-mix(in_srgb,var(--warning)_78%,var(--ui-ink-strong)_22%)]";
    case "silver":
      return "bg-[var(--ui-surface-3)] text-[var(--ui-ink-medium)]";
    default:
      return "bg-[var(--ui-warning-soft)] text-[var(--warning)]";
  }
}

function statusTone(status: XpMomentumPulse["status"]) {
  switch (status) {
    case "surging":
      return "bg-[color-mix(in_srgb,var(--ui-accent-soft)_62%,var(--ui-success-soft)_38%)]";
    case "steady":
      return "bg-[var(--ui-accent-soft)]";
    default:
      return "bg-[color-mix(in_srgb,var(--ui-warning-soft)_54%,var(--ui-accent-soft)_46%)]";
  }
}

const deckPanelClass =
  "min-w-0 overflow-hidden rounded-[24px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)] p-4";
const deckRowClass =
  "min-w-0 overflow-hidden rounded-[18px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] p-4";
const deckEyebrowClass =
  "font-label text-[11px] uppercase tracking-[0.18em] text-[var(--ui-ink-faint)]";
const deckTitleClass = "text-[var(--ui-ink-strong)]";
const deckBodyClass = "text-[var(--ui-ink-soft)]";
const deckFaintClass = "text-[var(--ui-ink-faint)]";
const deckMetricBadgeClass =
  "bg-[var(--ui-surface-3)] text-[var(--ui-ink-medium)]";

export function getXpDeckEntranceMotion(reduceMotion: boolean | null) {
  return reduceMotion
    ? {
        initial: false as const,
        animate: { opacity: 1, y: 0 },
        transition: { duration: 0 }
      }
    : {
        initial: { opacity: 0, y: 8 },
        animate: { opacity: 1, y: 0 },
        transition: { duration: 0.24, ease: "easeOut" as const }
      };
}

export function XpCommandDeck({
  profile,
  achievements,
  milestoneRewards,
  momentumPulse,
  recentLedger = [],
  scopeLabel = "Selected user",
  className,
  tone = "core"
}: XpCommandDeckProps) {
  const reduceMotion = useReducedMotion();
  const unlocked = achievements.filter((achievement) => achievement.unlocked);
  const visibleAchievements = (
    unlocked.length > 0 ? unlocked : achievements
  ).slice(0, 3);
  const visibleMilestones = milestoneRewards.slice(0, 3);
  const visibleLedger = recentLedger.slice(0, 3);
  const nextLevelProgress = Math.min(
    100,
    Math.round((profile.currentLevelXp / profile.nextLevelXp) * 100)
  );
  const entranceMotion = getXpDeckEntranceMotion(reduceMotion);

  return (
    <section
      className={cn(
        "min-w-0 overflow-hidden rounded-[30px] border border-[var(--ui-border-subtle)] bg-[var(--card-gradient)] shadow-[var(--card-shadow)]",
        tone === "psyche" &&
          "border-[color-mix(in_srgb,var(--success)_18%,var(--ui-border-subtle)_82%)]",
        className
      )}
    >
      <div className={cn("px-5 py-5", statusTone(momentumPulse.status))}>
        <div className="flex min-w-0 flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <div className={deckEyebrowClass}>{scopeLabel} progression</div>
            <h2
              className={`mt-3 font-display text-3xl leading-none lg:text-4xl ${deckTitleClass}`}
            >
              {momentumPulse.headline}
            </h2>
            <p className={`mt-3 max-w-3xl text-sm leading-7 ${deckBodyClass}`}>
              {momentumPulse.detail}
            </p>
          </div>
          <div className="flex min-w-0 flex-wrap gap-2">
            <Badge wrap className={deckMetricBadgeClass}>
              Level {profile.level}
            </Badge>
            <Badge wrap className={deckMetricBadgeClass}>
              {profile.streakDays} day streak
            </Badge>
            <Badge wrap className={deckMetricBadgeClass}>
              {profile.weeklyXp} XP since Monday
            </Badge>
          </div>
        </div>
      </div>

      <div className="grid gap-5 px-5 py-5 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)]">
        <div className="grid gap-5">
          <motion.div {...entranceMotion} className={deckPanelClass}>
            <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className={`font-medium ${deckTitleClass}`}>
                  Next progress target
                </div>
                <div className={`mt-2 text-sm ${deckBodyClass}`}>
                  {momentumPulse.nextMilestoneLabel}
                </div>
              </div>
              <Badge
                wrap
                className="max-w-[12rem] shrink-0 self-start text-[var(--tertiary)]"
              >
                {momentumPulse.celebrationLabel}
              </Badge>
            </div>
            <div className="mt-5">
              <ProgressMeter value={nextLevelProgress} />
            </div>
            <div
              className={`mt-3 flex flex-wrap items-center justify-between gap-3 text-xs uppercase tracking-[0.16em] ${deckFaintClass}`}
            >
              <span>
                {profile.currentLevelXp}/{profile.nextLevelXp} XP in level{" "}
                {profile.level}
              </span>
              <span>
                {profile.xpToNextLevel} XP to level {profile.level + 1}
              </span>
            </div>
            <p className={`mt-4 text-xs leading-5 ${deckFaintClass}`}>
              A streak day needs positive automatic XP that has not been
              reversed. Manual adjustments, corrections, and penalties do not
              extend the streak.
            </p>
          </motion.div>

          <div className="grid gap-3 md:grid-cols-3">
            {visibleAchievements.map((achievement, index) => (
              <motion.div
                key={achievement.id}
                initial={reduceMotion ? false : { opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={
                  reduceMotion
                    ? { duration: 0 }
                    : {
                        duration: 0.24,
                        delay: 0.04 * index,
                        ease: "easeOut"
                      }
                }
                className={deckPanelClass}
              >
                <div className="flex min-w-0 items-start justify-between gap-3">
                  <div
                    className={`min-w-0 flex-1 font-medium ${deckTitleClass}`}
                  >
                    {achievement.title}
                  </div>
                  <Badge
                    wrap
                    className={cn(
                      "max-w-[8rem] shrink-0 self-start",
                      achievementTone(achievement.tier)
                    )}
                  >
                    {achievement.tier}
                  </Badge>
                </div>
                <div className={`mt-2 text-sm leading-6 ${deckBodyClass}`}>
                  {achievement.summary}
                </div>
                <div
                  className={`mt-4 text-xs uppercase tracking-[0.16em] ${deckFaintClass}`}
                >
                  {achievement.progressLabel}
                </div>
              </motion.div>
            ))}
          </div>
        </div>

        <div className="grid gap-4">
          <div className={deckPanelClass}>
            <div className={deckEyebrowClass}>Progress targets</div>
            <div className="mt-4 grid gap-3">
              {visibleMilestones.map((milestone) => {
                const progress = Math.min(
                  100,
                  Math.round((milestone.current / milestone.target) * 100)
                );
                return (
                  <div key={milestone.id} className={deckRowClass}>
                    <div className="flex min-w-0 items-start justify-between gap-3">
                      <div
                        className={`min-w-0 flex-1 font-medium ${deckTitleClass}`}
                      >
                        {milestone.title}
                      </div>
                      <Badge
                        wrap
                        className={cn(
                          "max-w-[10.5rem] shrink-0 self-start",
                          milestone.completed
                            ? "bg-[var(--ui-success-soft)] text-[color-mix(in_srgb,var(--success)_76%,var(--ui-ink-strong)_24%)]"
                            : deckMetricBadgeClass
                        )}
                      >
                        {milestone.rewardLabel}
                      </Badge>
                    </div>
                    <div className={`mt-2 text-sm ${deckBodyClass}`}>
                      {milestone.summary}
                    </div>
                    <div className="mt-4">
                      <ProgressMeter value={progress} />
                    </div>
                    <div
                      className={`mt-3 text-xs uppercase tracking-[0.16em] ${deckFaintClass}`}
                    >
                      {milestone.progressLabel}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {visibleLedger.length > 0 ? (
            <div className={deckPanelClass}>
              <div className={deckEyebrowClass}>Recent XP changes</div>
              <div className="mt-4 grid gap-3">
                {visibleLedger.map((event) => (
                  <div key={event.id} className={deckRowClass}>
                    <div className="flex min-w-0 items-start justify-between gap-3">
                      <div
                        className={`min-w-0 flex-1 font-medium ${deckTitleClass}`}
                      >
                        {event.reasonTitle}
                      </div>
                      <Badge
                        wrap
                        className={cn(
                          "max-w-[8rem] shrink-0 self-start",
                          event.deltaXp >= 0
                            ? "bg-[var(--ui-success-soft)] text-[color-mix(in_srgb,var(--success)_76%,var(--ui-ink-strong)_24%)]"
                            : "bg-[var(--ui-warning-soft)] text-[color-mix(in_srgb,var(--warning)_78%,var(--ui-ink-strong)_22%)]"
                        )}
                      >
                        {event.deltaXp > 0 ? "+" : ""}
                        {event.deltaXp} XP
                      </Badge>
                    </div>
                    <div className={`mt-2 text-sm ${deckBodyClass}`}>
                      {event.reasonSummary}
                    </div>
                    <div
                      className={`mt-3 text-xs uppercase tracking-[0.16em] ${deckFaintClass}`}
                    >
                      {formatDateTime(event.createdAt)} · {event.source}
                      {event.actor ? ` · ${event.actor}` : ""} ·{" "}
                      {event.metadata.manual === true
                        ? "manual adjustment"
                        : "automatic rule"}
                    </div>
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
