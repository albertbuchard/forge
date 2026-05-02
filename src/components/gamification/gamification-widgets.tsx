import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Flame, Sparkles, Trophy, Zap } from "lucide-react";
import { Link } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { ProgressMeter } from "@/components/ui/progress-meter";
import { useGamificationTheme } from "@/components/gamification/use-gamification-theme";
import { getGamificationSpriteUrl } from "@/lib/gamification-assets";
import type { GamificationCelebration, XpMetricsPayload } from "@/lib/types";
import { cn } from "@/lib/utils";

type XpNotice = {
  deltaXp: number;
  totalXp: number;
};

type GamificationProfile = XpMetricsPayload["profile"];
type PartialGamificationProfile =
  | Partial<GamificationProfile>
  | null
  | undefined;

const DEFAULT_PROFILE: GamificationProfile = {
  totalXp: 0,
  level: 1,
  currentLevelXp: 0,
  nextLevelXp: 100,
  xpIntoLevel: 0,
  xpToNextLevel: 100,
  currentLevelStartXp: 0,
  nextLevelTotalXp: 100,
  levelCurveVersion: "smith-forge",
  weeklyXp: 0,
  streakDays: 0,
  comboMultiplier: 1,
  momentumScore: 0,
  topGoalId: null,
  topGoalTitle: null
};

function normalizeProfile(
  profile: PartialGamificationProfile
): GamificationProfile {
  const totalXp = profile?.totalXp ?? DEFAULT_PROFILE.totalXp;
  const level = Math.max(1, profile?.level ?? DEFAULT_PROFILE.level);
  const currentLevelXp =
    profile?.xpIntoLevel ??
    profile?.currentLevelXp ??
    DEFAULT_PROFILE.currentLevelXp;
  const nextLevelXp = Math.max(
    1,
    profile?.nextLevelXp ?? DEFAULT_PROFILE.nextLevelXp
  );
  const xpToNextLevel = Math.max(
    0,
    profile?.xpToNextLevel ?? nextLevelXp - currentLevelXp
  );
  const currentLevelStartXp =
    profile?.currentLevelStartXp ?? Math.max(0, totalXp - currentLevelXp);
  return {
    totalXp,
    level,
    currentLevelXp,
    nextLevelXp,
    xpIntoLevel: currentLevelXp,
    xpToNextLevel,
    currentLevelStartXp,
    nextLevelTotalXp:
      profile?.nextLevelTotalXp ?? currentLevelStartXp + nextLevelXp,
    levelCurveVersion:
      profile?.levelCurveVersion ?? DEFAULT_PROFILE.levelCurveVersion,
    weeklyXp: profile?.weeklyXp ?? DEFAULT_PROFILE.weeklyXp,
    streakDays: profile?.streakDays ?? DEFAULT_PROFILE.streakDays,
    comboMultiplier:
      profile?.comboMultiplier ?? DEFAULT_PROFILE.comboMultiplier,
    momentumScore: profile?.momentumScore ?? DEFAULT_PROFILE.momentumScore,
    topGoalId: profile?.topGoalId ?? DEFAULT_PROFILE.topGoalId,
    topGoalTitle: profile?.topGoalTitle ?? DEFAULT_PROFILE.topGoalTitle
  };
}

function formatCompactNumber(value: number) {
  return Intl.NumberFormat(undefined, {
    notation: value >= 10_000 ? "compact" : "standard",
    maximumFractionDigits: 1
  }).format(value);
}

export function GamificationMiniHud({
  metrics,
  className
}: {
  metrics?: PartialGamificationProfile;
  className?: string;
}) {
  const profile = normalizeProfile(metrics);
  const progress = Math.min(
    100,
    Math.round(
      (profile.currentLevelXp / Math.max(1, profile.nextLevelXp)) * 100
    )
  );
  return (
    <Link
      to="/rewards"
      className={cn(
        "inline-flex min-h-10 max-w-full items-center gap-2 rounded-full border border-white/10 bg-white/[0.055] px-3 py-2 text-[12px] font-medium text-white/78 shadow-[0_12px_30px_rgba(3,8,18,0.18)] transition hover:border-white/16 hover:bg-white/[0.08] hover:text-white",
        className
      )}
    >
      <span className="relative grid size-8 shrink-0 place-items-center rounded-full bg-black/24">
        <span
          className="absolute inset-0 rounded-full"
          style={{
            background: `conic-gradient(var(--tertiary) ${progress}%, rgba(255,255,255,0.12) 0)`
          }}
        />
        <span className="relative grid size-6 place-items-center rounded-full bg-[rgba(9,13,24,0.92)] text-[10px] text-[var(--tertiary)]">
          L{profile.level}
        </span>
      </span>
      <span className="min-w-0">
        <span className="block truncate">
          {profile.currentLevelXp}/{profile.nextLevelXp} XP
        </span>
        <span className="block truncate text-[11px] text-white/48">
          {profile.streakDays} day streak
        </span>
      </span>
    </Link>
  );
}

export function GamificationOverviewWidget({
  metrics,
  compact = false
}: {
  metrics: XpMetricsPayload;
  compact?: boolean;
}) {
  const gamificationTheme = useGamificationTheme();
  const profile = normalizeProfile(metrics.profile);
  const progress = Math.min(
    100,
    Math.round(
      (profile.currentLevelXp / Math.max(1, profile.nextLevelXp)) * 100
    )
  );
  const catalogPreview = metrics.catalogPreview ?? [];
  const next =
    metrics.nextUnlock ?? catalogPreview.find((item) => !item.unlocked) ?? null;
  const newest =
    metrics.newestUnlock ??
    catalogPreview.find((item) => item.unlocked) ??
    null;
  const nextTargets = metrics.nextTargets?.length
    ? metrics.nextTargets
    : next
      ? [next]
      : [];
  const latestShelf = [
    ...(newest ? [newest] : []),
    ...catalogPreview.filter((item) => item.unlocked && item.id !== newest?.id)
  ].slice(0, 5);
  const equippedSkin = metrics.equipment?.selectedMascotSkin ?? "default smith";
  return (
    <section className="relative isolate min-w-0 overflow-hidden rounded-[28px] border border-white/8 bg-[linear-gradient(135deg,rgba(10,15,28,0.98),rgba(19,13,28,0.94)_48%,rgba(8,20,30,0.94))] p-4 shadow-[0_24px_70px_rgba(3,8,18,0.34)] md:p-5">
      <div className="absolute inset-0 -z-10 bg-[radial-gradient(circle_at_18%_20%,rgba(249,115,22,0.18),transparent_34%),radial-gradient(circle_at_82%_10%,rgba(56,189,248,0.14),transparent_32%),radial-gradient(circle_at_76%_82%,rgba(167,139,250,0.12),transparent_34%)]" />
      <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(18rem,0.84fr)_minmax(0,1.16fr)] lg:items-center">
        <div className="relative min-h-[17rem] overflow-hidden rounded-[24px] border border-white/8 bg-[linear-gradient(145deg,rgba(255,255,255,0.055),rgba(8,14,25,0.78))]">
          <img
            src={getGamificationSpriteUrl(
              metrics.mascot.spriteKey,
              512,
              gamificationTheme
            )}
            alt="Forge Smith mascot"
            className="absolute inset-x-0 bottom-3 mx-auto h-[15.5rem] max-w-none object-contain drop-shadow-[0_24px_40px_rgba(0,0,0,0.52)]"
          />
          <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/76 to-transparent p-4">
            <div className="font-label text-[11px] uppercase tracking-[0.18em] text-white/50">
              {metrics.scope.label} · {equippedSkin.replaceAll("-", " ")}
            </div>
            <div className="mt-1 font-display text-xl text-white">
              {metrics.mascot.headline}
            </div>
          </div>
        </div>

        <div className="min-w-0">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <Badge className="bg-black/24 text-[var(--tertiary)]">
              Level {profile.level}
            </Badge>
            <Badge className="bg-black/24 text-emerald-200">
              {profile.streakDays} days
            </Badge>
            <Badge className="bg-black/24 text-white/76">
              {formatCompactNumber(profile.totalXp)} XP
            </Badge>
          </div>
          <div className="mt-4 grid gap-3">
            <div className="flex min-w-0 items-end justify-between gap-3">
              <div className="min-w-0">
                <div className="font-display text-2xl text-white md:text-3xl">
                  Forge level {profile.level}
                </div>
                <p className="mt-2 max-w-2xl text-sm leading-6 text-white/60">
                  {metrics.mascot.line}
                </p>
              </div>
              <Link
                to="/rewards"
                className="inline-flex shrink-0 items-center gap-2 rounded-full bg-[var(--primary)] px-3 py-2 text-[12px] font-semibold text-slate-950 transition hover:opacity-90"
              >
                <Trophy className="size-3.5" />
                Hall
              </Link>
            </div>
            <ProgressMeter value={progress} />
            <div className="flex flex-wrap justify-between gap-2 text-[11px] uppercase tracking-[0.16em] text-white/42">
              <span>
                {profile.currentLevelXp}/{profile.nextLevelXp} XP
              </span>
              <span>
                {profile.xpToNextLevel ??
                  profile.nextLevelXp - profile.currentLevelXp}{" "}
                to next
              </span>
            </div>
          </div>

          {!compact ? (
            <div className="mt-4 grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(13rem,0.72fr)]">
              <div className="rounded-[18px] border border-white/8 bg-white/[0.045] p-4">
                <div className="flex items-center gap-2 text-sm font-medium text-white">
                  <Sparkles className="size-4 text-[var(--tertiary)]" />
                  Next targets
                </div>
                <div className="mt-3 grid gap-2">
                  {nextTargets.length > 0 ? (
                    nextTargets.map((target) => (
                      <div
                        key={target.id}
                        className="grid grid-cols-[2rem_minmax(0,1fr)_3.5rem] items-center gap-2"
                      >
                        <img
                          src={getGamificationSpriteUrl(
                            target.assetKey,
                            256,
                            gamificationTheme
                          )}
                          alt=""
                          className="size-8 object-contain opacity-90"
                        />
                        <div className="min-w-0">
                          <div className="truncate text-sm text-white/80">
                            {target.title}
                          </div>
                          <div className="truncate text-[11px] text-white/42">
                            {target.requirementText}
                          </div>
                        </div>
                        <div className="text-right text-[11px] text-white/46">
                          {target.progressPercent}%
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="text-sm text-white/60">
                      All visible rewards unlocked
                    </div>
                  )}
                </div>
              </div>
              <div className="rounded-[18px] border border-white/8 bg-white/[0.045] p-4">
                <div className="flex items-center gap-2 text-sm font-medium text-white">
                  <Trophy className="size-4 text-amber-200" />
                  Latest shelf
                </div>
                <div className="mt-3 flex min-w-0 gap-2">
                  {latestShelf.length > 0 ? (
                    latestShelf.map((item) => (
                      <img
                        key={item.id}
                        src={getGamificationSpriteUrl(
                          item.assetKey,
                          256,
                          gamificationTheme
                        )}
                        alt={item.title}
                        title={item.title}
                        className="size-11 rounded-2xl bg-black/22 object-contain p-1"
                      />
                    ))
                  ) : (
                    <div className="text-sm text-white/60">No trophy yet</div>
                  )}
                </div>
                <div className="mt-3 text-[11px] uppercase tracking-[0.16em] text-white/40">
                  {metrics.unlockedItemCount}/{metrics.totalItemCount} unlocked
                </div>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}

export function GamificationCelebrationLayer({
  xpNotice,
  celebrations,
  onSeen
}: {
  xpNotice: XpNotice | null;
  celebrations: GamificationCelebration[];
  onSeen: (celebrationId: string) => void;
}) {
  const reduceMotion = useReducedMotion();
  const gamificationTheme = useGamificationTheme();
  const celebration = celebrations[0] ?? null;
  const isMajor =
    celebration?.kind === "level" ||
    celebration?.kind === "trophy" ||
    celebration?.kind === "unlock";

  return (
    <AnimatePresence>
      {celebration ? (
        <motion.div
          key={celebration.id}
          initial={
            reduceMotion ? { opacity: 0 } : { opacity: 0, y: 20, scale: 0.96 }
          }
          animate={
            reduceMotion ? { opacity: 1 } : { opacity: 1, y: 0, scale: 1 }
          }
          exit={
            reduceMotion ? { opacity: 0 } : { opacity: 0, y: 16, scale: 0.98 }
          }
          transition={{ duration: 0.28, ease: "easeOut" }}
          className={cn(
            "pointer-events-auto fixed z-50 px-4",
            isMajor
              ? "inset-x-0 bottom-24 flex justify-center lg:bottom-8"
              : "right-0 bottom-24 lg:bottom-8"
          )}
          onAnimationComplete={() => {
            window.setTimeout(
              () => onSeen(celebration.id),
              isMajor ? 3000 : 1800
            );
          }}
        >
          <div
            className={cn(
              "relative min-w-0 overflow-hidden rounded-[26px] border border-white/10 bg-[rgba(10,15,28,0.92)] shadow-[0_32px_90px_rgba(3,8,18,0.48)] backdrop-blur-xl",
              isMajor ? "w-full max-w-[34rem] p-4" : "max-w-[24rem] p-3"
            )}
          >
            <div className="absolute inset-0 -z-10 bg-[radial-gradient(circle_at_22%_12%,rgba(249,115,22,0.22),transparent_42%),radial-gradient(circle_at_82%_16%,rgba(139,92,246,0.18),transparent_38%)]" />
            <div className="flex min-w-0 items-center gap-3">
              <img
                src={getGamificationSpriteUrl(
                  celebration.assetKey || "mascot-state-020",
                  256,
                  gamificationTheme
                )}
                alt=""
                className={cn(
                  "shrink-0 object-contain",
                  isMajor ? "size-24" : "size-14"
                )}
              />
              <div className="min-w-0 flex-1">
                <div className="font-label text-[11px] uppercase tracking-[0.18em] text-[var(--tertiary)]">
                  {celebration.kind}
                </div>
                <div className="mt-1 truncate font-display text-xl text-white">
                  {celebration.title}
                </div>
                <div className="mt-1 line-clamp-2 text-sm leading-6 text-white/62">
                  {celebration.summary}
                </div>
              </div>
            </div>
          </div>
        </motion.div>
      ) : xpNotice ? (
        <motion.div
          key={`xp-${xpNotice.totalXp}`}
          initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 14 }}
          animate={reduceMotion ? { opacity: 1 } : { opacity: 1, y: 0 }}
          exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 10 }}
          className="pointer-events-none fixed inset-x-0 bottom-24 z-50 flex justify-center px-4 lg:bottom-6"
        >
          <div
            className={cn(
              "inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-medium shadow-[0_18px_48px_rgba(3,8,18,0.38)] backdrop-blur-xl",
              xpNotice.deltaXp > 0
                ? "border-emerald-400/30 bg-emerald-500/14 text-emerald-100"
                : "border-rose-400/30 bg-rose-500/14 text-rose-100"
            )}
          >
            {xpNotice.deltaXp > 0 ? (
              <Zap className="size-4 shrink-0" />
            ) : (
              <Flame className="size-4 shrink-0" />
            )}
            <span>
              {xpNotice.deltaXp > 0
                ? `XP +${xpNotice.deltaXp}`
                : `XP ${xpNotice.deltaXp}`}{" "}
              · {formatCompactNumber(xpNotice.totalXp)} total
            </span>
          </div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
