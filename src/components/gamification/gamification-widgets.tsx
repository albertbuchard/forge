import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import type { SyntheticEvent } from "react";
import { Download, Flame, Settings, Sparkles, Trophy, Zap } from "lucide-react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ProgressMeter } from "@/components/ui/progress-meter";
import { useGamificationTheme } from "@/components/gamification/use-gamification-theme";
import {
  getGamificationAssetStatus,
  installGamificationAssetStyle
} from "@/lib/api";
import {
  getGamificationSpriteUrl,
  getGamificationThemePreviewUrl
} from "@/lib/gamification-assets";
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

function hideMissingGamificationImage(event: SyntheticEvent<HTMLImageElement>) {
  event.currentTarget.hidden = true;
}

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
        "inline-flex min-h-10 max-w-full items-center gap-2 rounded-full border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] px-3 py-2 text-[12px] font-medium text-[var(--ui-ink-medium)] shadow-[var(--ui-shadow-soft)] transition hover:border-[var(--ui-border-strong)] hover:bg-[var(--ui-surface-2)] hover:text-[var(--ui-ink-strong)]",
        className
      )}
    >
      <span className="relative grid size-8 shrink-0 place-items-center rounded-full bg-[var(--ui-surface-2)]">
        <span
          className="absolute inset-0 rounded-full"
          style={{
            background: `conic-gradient(var(--tertiary) ${progress}%, var(--ui-border-subtle) 0)`
          }}
        />
        <span className="relative grid size-6 place-items-center rounded-full bg-[var(--ui-surface-section)] text-[10px] text-[var(--tertiary)]">
          L{profile.level}
        </span>
      </span>
      <span className="min-w-0">
        <span className="block truncate">
          {profile.currentLevelXp}/{profile.nextLevelXp} XP
        </span>
        <span className="block truncate text-[11px] text-[var(--ui-ink-faint)]">
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
  const queryClient = useQueryClient();
  const assetStatusQuery = useQuery({
    queryKey: ["forge-gamification-assets"],
    queryFn: getGamificationAssetStatus
  });
  const assetInstallMutation = useMutation({
    mutationFn: installGamificationAssetStyle,
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ["forge-gamification-assets"]
      });
    }
  });
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
  const selectedAssetStatus = assetStatusQuery.data?.assets.styles.find(
    (style) => style.id === gamificationTheme
  );
  const selectedStyleLabel =
    selectedAssetStatus?.label ??
    gamificationTheme
      .split("-")
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(" ");

  if (selectedAssetStatus && !selectedAssetStatus.installed) {
    const isDownloading =
      assetInstallMutation.isPending &&
      assetInstallMutation.variables === gamificationTheme;
    return (
      <section className="relative isolate min-w-0 overflow-hidden rounded-[24px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-section)] p-4 shadow-[var(--ui-shadow-soft)]">
        <div className="grid min-w-0 gap-4 sm:grid-cols-[4.5rem_minmax(0,1fr)] sm:items-center">
          <div className="grid size-18 place-items-center overflow-hidden rounded-[18px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)]">
            <img
              src={getGamificationThemePreviewUrl(gamificationTheme)}
              alt={`${selectedStyleLabel} preview`}
              className="size-16 object-contain"
            />
          </div>
          <div className="min-w-0">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <Badge className="bg-[var(--ui-surface-2)] text-[var(--tertiary)]">
                Level {profile.level}
              </Badge>
              <Badge className="bg-[var(--ui-surface-2)] text-[var(--ui-ink-soft)]">
                {profile.currentLevelXp}/{profile.nextLevelXp} XP
              </Badge>
              <Badge className="bg-[var(--ui-warning-soft)] text-[color-mix(in_srgb,var(--warning)_78%,var(--ui-ink-strong)_22%)]">
                Assets not downloaded
              </Badge>
            </div>
            <div className="mt-3 flex min-w-0 flex-wrap items-end justify-between gap-3">
              <div className="min-w-0">
                <div className="font-display text-xl text-[var(--ui-ink-strong)]">
                  Download {selectedStyleLabel} rewards
                </div>
                <p className="mt-1 max-w-2xl text-sm leading-6 text-[var(--ui-ink-soft)]">
                  This installs the optional mascot, trophy, and unlock art for
                  the selected reward style.
                </p>
              </div>
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <Button
                  size="sm"
                  pending={isDownloading}
                  pendingLabel="Downloading"
                  onClick={() => assetInstallMutation.mutate(gamificationTheme)}
                >
                  <Download className="size-3.5" />
                  Download
                </Button>
                <Link
                  to="/settings"
                  className="inline-flex min-h-[2.125rem] items-center gap-2 rounded-[var(--radius-control)] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] px-2.5 py-[0.4375rem] text-[13px] font-medium text-[var(--ui-ink-soft)] transition hover:border-[var(--ui-border-strong)] hover:bg-[var(--ui-surface-2)] hover:text-[var(--ui-ink-strong)]"
                >
                  <Settings className="size-3.5" />
                  Settings
                </Link>
              </div>
            </div>
            {assetInstallMutation.isError ? (
              <div className="mt-3 text-sm text-[color-mix(in_srgb,var(--danger)_76%,var(--ui-ink-strong)_24%)]">
                {assetInstallMutation.error instanceof Error
                  ? assetInstallMutation.error.message
                  : "Could not download reward assets."}
              </div>
            ) : (
              <div className="mt-3 text-[11px] uppercase tracking-[0.16em] text-[var(--ui-ink-faint)]">
                {selectedAssetStatus.spriteCount}/
                {selectedAssetStatus.expectedSpriteCount} sprites installed
              </div>
            )}
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="relative isolate min-w-0 overflow-hidden rounded-[28px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-section)] p-4 shadow-[var(--ui-shadow-soft)] md:p-5">
      <div className="absolute inset-0 -z-10 bg-[radial-gradient(circle_at_18%_20%,color-mix(in_srgb,var(--tertiary)_12%,transparent),transparent_34%),radial-gradient(circle_at_82%_10%,color-mix(in_srgb,var(--info)_10%,transparent),transparent_32%),radial-gradient(circle_at_76%_82%,color-mix(in_srgb,var(--primary)_10%,transparent),transparent_34%)]" />
      <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(18rem,0.84fr)_minmax(0,1.16fr)] lg:items-center">
        <div className="relative min-h-[17rem] overflow-hidden rounded-[24px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)]">
          <img
            src={getGamificationSpriteUrl(
              metrics.mascot.spriteKey,
              512,
              gamificationTheme
            )}
            alt="Forge Smith mascot"
            onError={hideMissingGamificationImage}
            className="absolute inset-x-0 bottom-3 mx-auto h-[15.5rem] max-w-none object-contain drop-shadow-[var(--ui-shadow-soft)]"
          />
          <div className="absolute inset-x-0 bottom-0 bg-[linear-gradient(to_top,color-mix(in_srgb,var(--ui-surface-section)_92%,transparent),transparent)] p-4">
            <div className="font-label text-[11px] uppercase tracking-[0.18em] text-[var(--ui-ink-faint)]">
              {metrics.scope.label} · {equippedSkin.replaceAll("-", " ")}
            </div>
            <div className="mt-1 font-display text-xl text-[var(--ui-ink-strong)]">
              {metrics.mascot.headline}
            </div>
          </div>
        </div>

        <div className="min-w-0">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <Badge className="bg-[var(--ui-surface-2)] text-[var(--tertiary)]">
              Level {profile.level}
            </Badge>
            <Badge className="bg-[var(--ui-surface-2)] text-[color-mix(in_srgb,var(--success)_74%,var(--ui-ink-strong)_26%)]">
              {profile.streakDays} days
            </Badge>
            <Badge className="bg-[var(--ui-surface-2)] text-[var(--ui-ink-medium)]">
              {formatCompactNumber(profile.totalXp)} XP
            </Badge>
          </div>
          <div className="mt-4 grid gap-3">
            <div className="flex min-w-0 items-end justify-between gap-3">
              <div className="min-w-0">
                <div className="font-display text-2xl text-[var(--ui-ink-strong)] md:text-3xl">
                  Forge level {profile.level}
                </div>
                <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--ui-ink-soft)]">
                  {metrics.mascot.line}
                </p>
              </div>
              <Link
                to="/rewards"
                className="inline-flex shrink-0 items-center gap-2 rounded-full bg-[var(--primary)] px-3 py-2 text-[12px] font-semibold text-[var(--ui-ink-on-accent)] transition hover:opacity-90"
              >
                <Trophy className="size-3.5" />
                Hall
              </Link>
            </div>
            <ProgressMeter value={progress} />
            <div className="flex flex-wrap justify-between gap-2 text-[11px] uppercase tracking-[0.16em] text-[var(--ui-ink-faint)]">
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
              <div className="rounded-[18px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] p-4">
                <div className="flex items-center gap-2 text-sm font-medium text-[var(--ui-ink-strong)]">
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
                          onError={hideMissingGamificationImage}
                          className="size-8 object-contain opacity-90"
                        />
                        <div className="min-w-0">
                          <div className="truncate text-sm text-[var(--ui-ink-medium)]">
                            {target.title}
                          </div>
                          <div className="truncate text-[11px] text-[var(--ui-ink-faint)]">
                            {target.requirementText}
                          </div>
                        </div>
                        <div className="text-right text-[11px] text-[var(--ui-ink-faint)]">
                          {target.progressPercent}%
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="text-sm text-[var(--ui-ink-soft)]">
                      All visible rewards unlocked
                    </div>
                  )}
                </div>
              </div>
              <div className="rounded-[18px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] p-4">
                <div className="flex items-center gap-2 text-sm font-medium text-[var(--ui-ink-strong)]">
                  <Trophy className="size-4 text-[color-mix(in_srgb,var(--warning)_76%,var(--ui-ink-strong)_24%)]" />
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
                        onError={hideMissingGamificationImage}
                        className="size-11 rounded-2xl bg-[var(--ui-surface-2)] object-contain p-1"
                      />
                    ))
                  ) : (
                    <div className="text-sm text-[var(--ui-ink-soft)]">
                      No trophy yet
                    </div>
                  )}
                </div>
                <div className="mt-3 text-[11px] uppercase tracking-[0.16em] text-[var(--ui-ink-faint)]">
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
              "relative min-w-0 overflow-hidden rounded-[26px] border border-[var(--ui-border-subtle)] bg-[var(--surface-glass)] shadow-[var(--ui-shadow-floating)] backdrop-blur-xl",
              isMajor ? "w-full max-w-[34rem] p-4" : "max-w-[24rem] p-3"
            )}
          >
            <div className="absolute inset-0 -z-10 bg-[radial-gradient(circle_at_22%_12%,color-mix(in_srgb,var(--tertiary)_16%,transparent),transparent_42%),radial-gradient(circle_at_82%_16%,color-mix(in_srgb,var(--primary)_14%,transparent),transparent_38%)]" />
            <div className="flex min-w-0 items-center gap-3">
              <img
                src={getGamificationSpriteUrl(
                  celebration.assetKey || "mascot-state-020",
                  256,
                  gamificationTheme
                )}
                alt=""
                onError={hideMissingGamificationImage}
                className={cn(
                  "shrink-0 object-contain",
                  isMajor ? "size-24" : "size-14"
                )}
              />
              <div className="min-w-0 flex-1">
                <div className="font-label text-[11px] uppercase tracking-[0.18em] text-[var(--tertiary)]">
                  {celebration.kind}
                </div>
                <div className="mt-1 truncate font-display text-xl text-[var(--ui-ink-strong)]">
                  {celebration.title}
                </div>
                <div className="mt-1 line-clamp-2 text-sm leading-6 text-[var(--ui-ink-soft)]">
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
              "inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-medium shadow-[var(--ui-shadow-floating)] backdrop-blur-xl",
              xpNotice.deltaXp > 0
                ? "border-[color-mix(in_srgb,var(--success)_34%,var(--ui-border-subtle)_66%)] bg-[var(--ui-success-soft)] text-[color-mix(in_srgb,var(--success)_74%,var(--ui-ink-strong)_26%)]"
                : "border-[color-mix(in_srgb,var(--danger)_34%,var(--ui-border-subtle)_66%)] bg-[var(--ui-danger-soft)] text-[color-mix(in_srgb,var(--danger)_76%,var(--ui-ink-strong)_24%)]"
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
