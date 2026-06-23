import { useMemo, useState, type SyntheticEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Check,
  Flame,
  Lock,
  Search,
  Shield,
  Sparkles,
  Trophy
} from "lucide-react";
import { GamificationMiniHud } from "@/components/gamification/gamification-widgets";
import { useGamificationTheme } from "@/components/gamification/use-gamification-theme";
import { PageHero } from "@/components/shell/page-hero";
import { useForgeShell } from "@/components/shell/app-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ProgressMeter } from "@/components/ui/progress-meter";
import { ErrorState } from "@/components/ui/page-state";
import { getGamificationCatalog, updateGamificationEquipment } from "@/lib/api";
import { forgeApi, useGetXpMetricsQuery } from "@/store/api/forge-api";
import { useAppDispatch } from "@/store/typed-hooks";
import { getGamificationSpriteUrl } from "@/lib/gamification-assets";
import type { GamificationThemePreference } from "@/lib/gamification-assets";
import {
  GAMIFICATION_CATEGORIES,
  GAMIFICATION_STREAK_AWAY_DAY_KEYS,
  GAMIFICATION_STREAK_POWER_DAY_KEYS
} from "@/lib/gamification-catalog";
import type {
  GamificationCatalogCategory,
  GamificationCatalogEntry,
  GamificationCatalogTier,
  GamificationEquipment,
  GamificationUnlockType
} from "@/lib/types";
import { cn } from "@/lib/utils";

function hideMissingGamificationImage(event: SyntheticEvent<HTMLImageElement>) {
  event.currentTarget.hidden = true;
}

type RewardsTab = "trophies" | "unlocks" | "armory" | "streak";

const tiers: Array<"all" | GamificationCatalogTier> = [
  "all",
  "bronze",
  "silver",
  "gold",
  "platinum"
];

const tabs: Array<{ id: RewardsTab; label: string }> = [
  { id: "trophies", label: "Trophies" },
  { id: "unlocks", label: "Unlocks" },
  { id: "armory", label: "Mascot Armory" },
  { id: "streak", label: "Streak Forge" }
];

const equipConfig: Partial<
  Record<
    GamificationUnlockType,
    {
      field: keyof Omit<GamificationEquipment, "updatedAt">;
      payloadKey: string;
      label: string;
    }
  >
> = {
  mascot_skin: {
    field: "selectedMascotSkin",
    payloadKey: "mascotSkin",
    label: "Mascot skin"
  },
  hud_treatment: {
    field: "selectedHudTreatment",
    payloadKey: "hudTreatment",
    label: "HUD treatment"
  },
  streak_effect: {
    field: "selectedStreakEffect",
    payloadKey: "streakEffect",
    label: "Streak flame"
  },
  trophy_shelf: {
    field: "selectedTrophyShelf",
    payloadKey: "trophyShelf",
    label: "Trophy shelf"
  },
  celebration_variant: {
    field: "selectedCelebrationVariant",
    payloadKey: "celebrationVariant",
    label: "Celebration"
  }
};

function tierTone(tier: GamificationCatalogTier) {
  switch (tier) {
    case "platinum":
      return "border-[color-mix(in_srgb,var(--primary)_30%,var(--ui-border-subtle)_70%)] bg-[var(--ui-accent-soft)] text-[var(--primary)]";
    case "gold":
      return "border-[color-mix(in_srgb,var(--warning)_32%,var(--ui-border-subtle)_68%)] bg-[var(--ui-warning-soft)] text-[color-mix(in_srgb,var(--warning)_78%,var(--ui-ink-strong)_22%)]";
    case "silver":
      return "border-[var(--ui-border-subtle)] bg-[var(--ui-surface-3)] text-[var(--ui-ink-medium)]";
    default:
      return "border-[color-mix(in_srgb,var(--warning)_26%,var(--ui-border-subtle)_74%)] bg-[var(--ui-warning-soft)] text-[var(--warning)]";
  }
}

const rewardCardClass =
  "min-w-0 overflow-hidden rounded-[22px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)] p-4";
const rewardInsetClass =
  "min-w-0 overflow-hidden rounded-[18px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] p-4";
const rewardTitleClass = "text-[var(--ui-ink-strong)]";
const rewardBodyClass = "text-[var(--ui-ink-soft)]";
const rewardFaintClass = "text-[var(--ui-ink-faint)]";
const rewardBadgeClass = "bg-[var(--ui-surface-3)] text-[var(--ui-ink-medium)]";

function getUnlockValue(item: GamificationCatalogEntry) {
  const config = item.unlockType ? equipConfig[item.unlockType] : null;
  const value = config ? item.rewardPayload[config.payloadKey] : null;
  return typeof value === "string" ? value : null;
}

function RewardTile({
  item,
  gamificationTheme,
  onSelect
}: {
  item: GamificationCatalogEntry;
  gamificationTheme: GamificationThemePreference;
  onSelect: (item: GamificationCatalogEntry) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onSelect(item)}
      className={cn(
        "group relative min-h-[19rem] overflow-hidden rounded-[18px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)] p-4 text-left shadow-[var(--ui-shadow-soft)] transition hover:-translate-y-0.5 hover:border-[color-mix(in_srgb,var(--primary)_30%,var(--ui-border-subtle)_70%)] hover:bg-[var(--ui-surface-hover)]",
        !item.unlocked && "opacity-78"
      )}
    >
      <div className="flex min-w-0 items-start justify-between gap-3">
        <Badge className={cn("border", tierTone(item.tier))}>{item.tier}</Badge>
        <Badge className={rewardBadgeClass}>
          {item.unlocked ? "earned" : "locked"}
        </Badge>
      </div>
      <div className="mt-3 grid place-items-center">
        <img
          src={getGamificationSpriteUrl(item.assetKey, 512, gamificationTheme)}
          alt=""
          onError={hideMissingGamificationImage}
          className={cn(
            "size-36 object-contain drop-shadow-[var(--ui-shadow-soft)] transition group-hover:scale-[1.03]",
            !item.unlocked && "grayscale"
          )}
        />
      </div>
      <div className="mt-3 min-w-0">
        <div className={`font-display text-lg ${rewardTitleClass}`}>
          {item.title}
        </div>
        <p className={`mt-2 line-clamp-2 text-sm leading-6 ${rewardBodyClass}`}>
          {item.unlocked ? item.summary : item.requirementText}
        </p>
      </div>
      <div className="mt-4">
        <ProgressMeter value={item.progressPercent} />
        <div
          className={`mt-2 flex justify-between gap-3 text-[11px] uppercase tracking-[0.16em] ${rewardFaintClass}`}
        >
          <span>
            {item.progressCurrent}/{item.progressTarget}
          </span>
          <span>{item.progressPercent}%</span>
        </div>
      </div>
    </button>
  );
}

export function RewardsPage() {
  const shell = useForgeShell();
  const gamificationTheme = useGamificationTheme();
  const queryClient = useQueryClient();
  const dispatch = useAppDispatch();
  const selectedUserIds = Array.isArray(shell.selectedUserIds)
    ? shell.selectedUserIds
    : [];
  const [tab, setTab] = useState<RewardsTab>("trophies");
  const [category, setCategory] = useState<"all" | GamificationCatalogCategory>(
    "all"
  );
  const [tier, setTier] = useState<"all" | GamificationCatalogTier>("all");
  const [state, setState] = useState<"all" | "unlocked" | "locked">("all");
  const [query, setQuery] = useState("");
  const [selectedItem, setSelectedItem] =
    useState<GamificationCatalogEntry | null>(null);
  const catalogQuery = useQuery({
    queryKey: ["forge-gamification-catalog", ...selectedUserIds],
    queryFn: () => getGamificationCatalog(selectedUserIds)
  });
  const xpQuery = useGetXpMetricsQuery(selectedUserIds);
  const equipMutation = useMutation({
    mutationFn: (input: Partial<Omit<GamificationEquipment, "updatedAt">>) =>
      updateGamificationEquipment(input, selectedUserIds),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: ["forge-gamification-catalog"]
        }),
        queryClient.invalidateQueries({ queryKey: ["forge-xp-metrics"] })
      ]);
      dispatch(forgeApi.util.invalidateTags(["Gamification"]));
    }
  });
  const catalog = catalogQuery.data?.catalog;
  const items = catalog?.items ?? [];
  const filteredItems = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return items.filter((item) => {
      if (tab === "trophies" && item.kind !== "trophy") return false;
      if (tab === "unlocks" && item.kind !== "unlock") return false;
      if ((tab === "armory" || tab === "streak") && item.kind !== "unlock")
        return false;
      if (tab === "armory" && !item.unlockType) return false;
      if (tab === "streak" && item.unlockType !== "streak_effect") return false;
      if (category !== "all" && item.category !== category) return false;
      if (tier !== "all" && item.tier !== tier) return false;
      if (state === "unlocked" && !item.unlocked) return false;
      if (state === "locked" && item.unlocked) return false;
      if (!normalizedQuery) return true;
      return `${item.title} ${item.summary} ${item.requirementText} ${item.reward}`
        .toLowerCase()
        .includes(normalizedQuery);
    });
  }, [category, items, query, state, tab, tier]);

  const equipment =
    catalog?.equipment ?? xpQuery.data?.metrics.equipment ?? null;
  const armoryItems = items.filter(
    (item) =>
      item.kind === "unlock" && item.unlockType && equipConfig[item.unlockType]
  );

  if (catalogQuery.isError) {
    return (
      <ErrorState
        eyebrow="Rewards"
        error={catalogQuery.error}
        onRetry={() => void catalogQuery.refetch()}
      />
    );
  }

  return (
    <div className="mx-auto grid w-full max-w-[1320px] gap-5">
      <PageHero
        title="Trophy Hall"
        description="Achievements are earned from real Forge behavior: tasks, runs, goals, wiki links, Psyche work, habits, Life Force, health, and collaboration."
        badge={
          catalog
            ? `${catalog.unlockedCount}/${catalog.totalCount} earned`
            : "Loading"
        }
        actions={
          xpQuery.data?.metrics ? (
            <GamificationMiniHud metrics={xpQuery.data.metrics.profile} />
          ) : null
        }
      />

      <section className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(20rem,0.42fr)]">
        <div className={rewardCardClass}>
          <div className="flex flex-wrap gap-2">
            {tabs.map((entry) => (
              <Button
                key={entry.id}
                type="button"
                variant={tab === entry.id ? "primary" : "secondary"}
                size="sm"
                onClick={() => setTab(entry.id)}
              >
                {entry.id === "trophies" ? <Trophy className="size-4" /> : null}
                {entry.id === "armory" ? <Shield className="size-4" /> : null}
                {entry.id === "streak" ? <Flame className="size-4" /> : null}
                {entry.id === "unlocks" ? (
                  <Sparkles className="size-4" />
                ) : null}
                {entry.label}
              </Button>
            ))}
          </div>
          <div className="mt-4 flex min-w-0 flex-wrap items-center gap-2">
            {(["all", "unlocked", "locked"] as const).map((entry) => (
              <Button
                key={entry}
                type="button"
                variant={state === entry ? "primary" : "secondary"}
                size="sm"
                onClick={() => setState(entry)}
              >
                {entry === "locked" ? <Lock className="size-4" /> : null}
                {entry}
              </Button>
            ))}
            <label
              className={`ml-auto flex min-h-10 min-w-0 max-w-full items-center gap-2 rounded-full border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] px-3 text-sm ${rewardBodyClass} sm:min-w-[16rem]`}
            >
              <Search className={`size-4 shrink-0 ${rewardFaintClass}`} />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search rewards"
                className="min-w-0 flex-1 bg-transparent text-[var(--ui-ink-strong)] outline-none placeholder:text-[var(--ui-ink-faint)]"
              />
            </label>
          </div>
          <div className="mt-4 flex min-w-0 flex-wrap gap-2">
            <Button
              type="button"
              variant={category === "all" ? "primary" : "secondary"}
              size="sm"
              onClick={() => setCategory("all")}
            >
              all categories
            </Button>
            {GAMIFICATION_CATEGORIES.map((entry) => (
              <Button
                key={entry.id}
                type="button"
                variant={category === entry.id ? "primary" : "secondary"}
                size="sm"
                onClick={() => setCategory(entry.id)}
              >
                {entry.label}
              </Button>
            ))}
          </div>
          <div className="mt-4 flex min-w-0 flex-wrap gap-2">
            {tiers.map((entry) => (
              <Button
                key={entry}
                type="button"
                variant={tier === entry ? "primary" : "secondary"}
                size="sm"
                onClick={() => setTier(entry)}
              >
                {entry}
              </Button>
            ))}
          </div>
        </div>

        <div className={rewardCardClass}>
          <div
            className={`flex items-center gap-2 text-sm font-semibold ${rewardTitleClass}`}
          >
            <Sparkles className="size-4 text-[var(--tertiary)]" />
            Near completion
          </div>
          {(catalog?.nextTargets ?? []).map((target) => (
            <button
              key={target.id}
              type="button"
              onClick={() => setSelectedItem(target)}
              className="grid min-w-0 grid-cols-[2.75rem_minmax(0,1fr)_3rem] items-center gap-3 rounded-2xl border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] p-2 text-left transition hover:bg-[var(--ui-surface-hover)]"
            >
              <img
                src={getGamificationSpriteUrl(
                  target.assetKey,
                  256,
                  gamificationTheme
                )}
                alt=""
                onError={hideMissingGamificationImage}
                className="size-11 object-contain"
              />
              <span className="min-w-0">
                <span className={`block truncate text-sm ${rewardTitleClass}`}>
                  {target.title}
                </span>
                <span
                  className={`block truncate text-[11px] ${rewardFaintClass}`}
                >
                  {target.requirementText}
                </span>
              </span>
              <span className={`text-right text-xs ${rewardBodyClass}`}>
                {target.progressPercent}%
              </span>
            </button>
          ))}
        </div>
      </section>

      {tab === "armory" ? (
        <section className="grid gap-3 lg:grid-cols-[minmax(18rem,0.42fr)_minmax(0,1fr)]">
          <div className="relative min-h-[24rem] overflow-hidden rounded-[24px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)] p-4 shadow-[var(--ui-shadow-soft)]">
            <img
              src={getGamificationSpriteUrl(
                xpQuery.data?.metrics.mascot.spriteKey ?? "mascot-state-014",
                512,
                gamificationTheme
              )}
              alt="Forge Smith mascot"
              onError={hideMissingGamificationImage}
              className="absolute inset-x-0 bottom-0 mx-auto h-[23rem] object-contain"
            />
            <div className="relative z-10">
              <Badge className="bg-[var(--ui-accent-soft)] text-[var(--tertiary)]">
                Equipped
              </Badge>
              <div className={`mt-3 grid gap-1 text-sm ${rewardBodyClass}`}>
                <span>Skin: {equipment?.selectedMascotSkin ?? "default"}</span>
                <span>HUD: {equipment?.selectedHudTreatment ?? "default"}</span>
                <span>
                  Flame: {equipment?.selectedStreakEffect ?? "default"}
                </span>
                <span>
                  Shelf: {equipment?.selectedTrophyShelf ?? "default"}
                </span>
              </div>
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {armoryItems.map((item) => {
              const config = item.unlockType
                ? equipConfig[item.unlockType]
                : null;
              const value = getUnlockValue(item);
              const equipped = Boolean(
                config && value && equipment?.[config.field] === value
              );
              return (
                <Card
                  key={item.id}
                  className={cn("p-4", !item.unlocked && "opacity-70")}
                >
                  <div className="flex items-start justify-between gap-3">
                    <Badge className={rewardBadgeClass}>
                      {config?.label ?? "Cosmetic"}
                    </Badge>
                    {equipped ? (
                      <Check className="size-4 text-[var(--success)]" />
                    ) : null}
                  </div>
                  <img
                    src={getGamificationSpriteUrl(
                      item.assetKey,
                      256,
                      gamificationTheme
                    )}
                    alt=""
                    onError={hideMissingGamificationImage}
                    className={cn(
                      "mx-auto mt-3 size-28 object-contain",
                      !item.unlocked && "grayscale"
                    )}
                  />
                  <div
                    className={`mt-3 font-display text-lg ${rewardTitleClass}`}
                  >
                    {item.title}
                  </div>
                  <p
                    className={`mt-2 line-clamp-2 text-sm leading-6 ${rewardBodyClass}`}
                  >
                    {item.unlocked ? item.summary : item.requirementText}
                  </p>
                  <Button
                    type="button"
                    variant={equipped ? "secondary" : "primary"}
                    size="sm"
                    disabled={
                      !item.unlocked ||
                      !config ||
                      !value ||
                      equipMutation.isPending
                    }
                    className="mt-4 w-full"
                    onClick={() => {
                      if (!config || !value) return;
                      equipMutation.mutate({
                        [config.field]: equipped ? null : value
                      });
                    }}
                  >
                    {equipped ? "Unequip" : item.unlocked ? "Equip" : "Locked"}
                  </Button>
                </Card>
              );
            })}
          </div>
        </section>
      ) : tab === "streak" ? (
        <section className="grid gap-4">
          <Card className="p-4">
            <div
              className={`flex items-center gap-2 font-display text-xl ${rewardTitleClass}`}
            >
              <Flame className="size-5 text-[var(--tertiary)]" />
              Streak power states
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-2 md:grid-cols-4 xl:grid-cols-5">
              {GAMIFICATION_STREAK_POWER_DAY_KEYS.map(([days, key]) => (
                <div key={key} className={rewardInsetClass}>
                  <img
                    src={getGamificationSpriteUrl(key, 256, gamificationTheme)}
                    alt=""
                    onError={hideMissingGamificationImage}
                    className="mx-auto size-28 object-contain"
                  />
                  <div
                    className={`mt-2 text-center text-sm ${rewardBodyClass}`}
                  >
                    {days} day power
                  </div>
                </div>
              ))}
            </div>
          </Card>
          <Card className="p-4">
            <div
              className={`flex items-center gap-2 font-display text-xl ${rewardTitleClass}`}
            >
              <Lock className={`size-5 ${rewardFaintClass}`} />
              Absence pressure states
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-2 md:grid-cols-4 xl:grid-cols-5">
              {GAMIFICATION_STREAK_AWAY_DAY_KEYS.map(([days, key]) => (
                <div key={key} className={rewardInsetClass}>
                  <img
                    src={getGamificationSpriteUrl(key, 256, gamificationTheme)}
                    alt=""
                    onError={hideMissingGamificationImage}
                    className="mx-auto size-28 object-contain"
                  />
                  <div
                    className={`mt-2 text-center text-sm ${rewardBodyClass}`}
                  >
                    {days} days away
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </section>
      ) : (
        <section className="grid gap-5">
          {GAMIFICATION_CATEGORIES.map((group) => {
            const groupItems = filteredItems.filter(
              (item) => item.category === group.id
            );
            if (groupItems.length === 0) return null;
            return (
              <section key={group.id} className="grid gap-3">
                <div className="flex items-end justify-between gap-3">
                  <div>
                    <div className={`font-display text-xl ${rewardTitleClass}`}>
                      {group.label}
                    </div>
                    <div className={`text-sm ${rewardFaintClass}`}>
                      {groupItems.length} visible rewards
                    </div>
                  </div>
                </div>
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  {groupItems.map((item) => (
                    <RewardTile
                      key={item.id}
                      item={item}
                      gamificationTheme={gamificationTheme}
                      onSelect={setSelectedItem}
                    />
                  ))}
                </div>
              </section>
            );
          })}
        </section>
      )}

      {selectedItem ? (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-[var(--ui-overlay)] p-4 backdrop-blur-sm"
          onClick={() => setSelectedItem(null)}
        >
          <div
            className="max-h-[calc(100vh-2rem)] w-full max-w-[34rem] overflow-y-auto rounded-[26px] border border-[var(--ui-border-subtle)] bg-[var(--card-gradient)] p-5 shadow-[var(--card-shadow)]"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex min-w-0 flex-col gap-4 sm:flex-row sm:items-start">
              <img
                src={getGamificationSpriteUrl(
                  selectedItem.assetKey,
                  512,
                  gamificationTheme
                )}
                alt=""
                onError={hideMissingGamificationImage}
                className="size-32 shrink-0 object-contain"
              />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap gap-2">
                  <Badge className={cn("border", tierTone(selectedItem.tier))}>
                    {selectedItem.tier}
                  </Badge>
                  <Badge className={rewardBadgeClass}>
                    {selectedItem.kind}
                  </Badge>
                </div>
                <div
                  className={`mt-3 font-display text-2xl ${rewardTitleClass}`}
                >
                  {selectedItem.title}
                </div>
                <p className={`mt-2 text-sm leading-6 ${rewardBodyClass}`}>
                  {selectedItem.summary}
                </p>
              </div>
            </div>
            <div className={`mt-5 ${rewardInsetClass}`}>
              <div className={`text-sm font-semibold ${rewardTitleClass}`}>
                Requirement
              </div>
              <p className={`mt-2 text-sm leading-6 ${rewardBodyClass}`}>
                {selectedItem.requirementText}
              </p>
              <div className="mt-4">
                <ProgressMeter value={selectedItem.progressPercent} />
                <div
                  className={`mt-2 flex justify-between gap-3 text-[11px] uppercase tracking-[0.16em] ${rewardFaintClass}`}
                >
                  <span>
                    {selectedItem.progressCurrent}/{selectedItem.progressTarget}
                  </span>
                  <span>{selectedItem.unlocked ? "earned" : "locked"}</span>
                </div>
              </div>
            </div>
            <div className="mt-4 flex justify-end">
              <Button
                type="button"
                variant="secondary"
                onClick={() => setSelectedItem(null)}
              >
                Close
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
