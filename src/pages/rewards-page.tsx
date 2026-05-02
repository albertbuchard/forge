import { useMemo, useState } from "react";
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
import {
  getGamificationCatalog,
  getXpMetrics,
  updateGamificationEquipment
} from "@/lib/api";
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
      return "border-cyan-200/35 text-cyan-100";
    case "gold":
      return "border-amber-200/35 text-amber-100";
    case "silver":
      return "border-slate-200/35 text-slate-100";
    default:
      return "border-orange-300/35 text-orange-100";
  }
}

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
        "group relative min-h-[19rem] overflow-hidden rounded-[18px] border border-white/8 bg-white/[0.045] p-4 text-left transition hover:-translate-y-0.5 hover:border-white/16 hover:bg-white/[0.07]",
        !item.unlocked && "opacity-78"
      )}
    >
      <div className="absolute inset-0 -z-10 bg-[radial-gradient(circle_at_50%_0%,rgba(249,115,22,0.16),transparent_38%)]" />
      <div className="flex min-w-0 items-start justify-between gap-3">
        <Badge className={cn("border bg-black/18", tierTone(item.tier))}>
          {item.tier}
        </Badge>
        <Badge className="bg-white/[0.06] text-white/58">
          {item.unlocked ? "earned" : "locked"}
        </Badge>
      </div>
      <div className="mt-3 grid place-items-center">
        <img
          src={getGamificationSpriteUrl(item.assetKey, 512, gamificationTheme)}
          alt=""
          className={cn(
            "size-36 object-contain drop-shadow-[0_22px_34px_rgba(0,0,0,0.44)] transition group-hover:scale-[1.03]",
            !item.unlocked && "grayscale"
          )}
        />
      </div>
      <div className="mt-3 min-w-0">
        <div className="font-display text-lg text-white">{item.title}</div>
        <p className="mt-2 line-clamp-2 text-sm leading-6 text-white/58">
          {item.unlocked ? item.summary : item.requirementText}
        </p>
      </div>
      <div className="mt-4">
        <ProgressMeter value={item.progressPercent} />
        <div className="mt-2 flex justify-between gap-3 text-[11px] uppercase tracking-[0.16em] text-white/38">
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
  const selectedUserIds = Array.isArray(shell.selectedUserIds)
    ? shell.selectedUserIds
    : [];
  const [tab, setTab] = useState<RewardsTab>("trophies");
  const [category, setCategory] = useState<"all" | GamificationCatalogCategory>("all");
  const [tier, setTier] = useState<"all" | GamificationCatalogTier>("all");
  const [state, setState] = useState<"all" | "unlocked" | "locked">("all");
  const [query, setQuery] = useState("");
  const [selectedItem, setSelectedItem] = useState<GamificationCatalogEntry | null>(null);
  const catalogQuery = useQuery({
    queryKey: ["forge-gamification-catalog", ...selectedUserIds],
    queryFn: () => getGamificationCatalog(selectedUserIds)
  });
  const xpQuery = useQuery({
    queryKey: ["forge-xp-metrics", ...selectedUserIds],
    queryFn: () => getXpMetrics(selectedUserIds)
  });
  const equipMutation = useMutation({
    mutationFn: (input: Partial<Omit<GamificationEquipment, "updatedAt">>) =>
      updateGamificationEquipment(input, selectedUserIds),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["forge-gamification-catalog"] }),
        queryClient.invalidateQueries({ queryKey: ["forge-xp-metrics"] })
      ]);
    }
  });
  const catalog = catalogQuery.data?.catalog;
  const items = catalog?.items ?? [];
  const filteredItems = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return items.filter((item) => {
      if (tab === "trophies" && item.kind !== "trophy") return false;
      if (tab === "unlocks" && item.kind !== "unlock") return false;
      if ((tab === "armory" || tab === "streak") && item.kind !== "unlock") return false;
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

  const equipment = catalog?.equipment ?? xpQuery.data?.metrics.equipment ?? null;
  const armoryItems = items.filter((item) => item.kind === "unlock" && item.unlockType && equipConfig[item.unlockType]);

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
        <div className="rounded-[22px] border border-white/8 bg-white/[0.045] p-4">
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
                {entry.id === "unlocks" ? <Sparkles className="size-4" /> : null}
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
            <label className="ml-auto flex min-h-10 min-w-[16rem] max-w-full items-center gap-2 rounded-full border border-white/8 bg-black/18 px-3 text-sm text-white/70">
              <Search className="size-4 shrink-0 text-white/38" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search rewards"
                className="min-w-0 flex-1 bg-transparent text-white outline-none placeholder:text-white/34"
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

        <div className="grid gap-3 rounded-[22px] border border-white/8 bg-black/18 p-4">
          <div className="flex items-center gap-2 text-sm font-semibold text-white">
            <Sparkles className="size-4 text-[var(--tertiary)]" />
            Near completion
          </div>
          {(catalog?.nextTargets ?? []).map((target) => (
            <button
              key={target.id}
              type="button"
              onClick={() => setSelectedItem(target)}
              className="grid grid-cols-[2.75rem_minmax(0,1fr)_3rem] items-center gap-3 rounded-2xl bg-white/[0.045] p-2 text-left"
            >
              <img src={getGamificationSpriteUrl(target.assetKey, 256, gamificationTheme)} alt="" className="size-11 object-contain" />
              <span className="min-w-0">
                <span className="block truncate text-sm text-white/82">{target.title}</span>
                <span className="block truncate text-[11px] text-white/42">{target.requirementText}</span>
              </span>
              <span className="text-right text-xs text-white/50">{target.progressPercent}%</span>
            </button>
          ))}
        </div>
      </section>

      {tab === "armory" ? (
        <section className="grid gap-3 lg:grid-cols-[minmax(18rem,0.42fr)_minmax(0,1fr)]">
          <div className="relative min-h-[24rem] overflow-hidden rounded-[24px] border border-white/8 bg-[linear-gradient(145deg,rgba(15,23,42,0.92),rgba(24,24,36,0.88))] p-4">
            <img
              src={getGamificationSpriteUrl(
                xpQuery.data?.metrics.mascot.spriteKey ?? "mascot-state-014",
                512,
                gamificationTheme
              )}
              alt="Forge Smith mascot"
              className="absolute inset-x-0 bottom-0 mx-auto h-[23rem] object-contain"
            />
            <div className="relative z-10">
              <Badge className="bg-black/30 text-[var(--tertiary)]">Equipped</Badge>
              <div className="mt-3 grid gap-1 text-sm text-white/68">
                <span>Skin: {equipment?.selectedMascotSkin ?? "default"}</span>
                <span>HUD: {equipment?.selectedHudTreatment ?? "default"}</span>
                <span>Flame: {equipment?.selectedStreakEffect ?? "default"}</span>
                <span>Shelf: {equipment?.selectedTrophyShelf ?? "default"}</span>
              </div>
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {armoryItems.map((item) => {
              const config = item.unlockType ? equipConfig[item.unlockType] : null;
              const value = getUnlockValue(item);
              const equipped = Boolean(config && value && equipment?.[config.field] === value);
              return (
                <Card key={item.id} className={cn("p-4", !item.unlocked && "opacity-70")}>
                  <div className="flex items-start justify-between gap-3">
                    <Badge className="bg-white/[0.06] text-white/58">
                      {config?.label ?? "Cosmetic"}
                    </Badge>
                    {equipped ? <Check className="size-4 text-emerald-200" /> : null}
                  </div>
                  <img
                    src={getGamificationSpriteUrl(item.assetKey, 256, gamificationTheme)}
                    alt=""
                    className={cn("mx-auto mt-3 size-28 object-contain", !item.unlocked && "grayscale")}
                  />
                  <div className="mt-3 font-display text-lg text-white">{item.title}</div>
                  <p className="mt-2 line-clamp-2 text-sm leading-6 text-white/56">
                    {item.unlocked ? item.summary : item.requirementText}
                  </p>
                  <Button
                    type="button"
                    variant={equipped ? "secondary" : "primary"}
                    size="sm"
                    disabled={!item.unlocked || !config || !value || equipMutation.isPending}
                    className="mt-4 w-full"
                    onClick={() => {
                      if (!config || !value) return;
                      equipMutation.mutate({ [config.field]: equipped ? null : value });
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
            <div className="flex items-center gap-2 font-display text-xl text-white">
              <Flame className="size-5 text-[var(--tertiary)]" />
              Streak power states
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-2 md:grid-cols-4 xl:grid-cols-5">
              {GAMIFICATION_STREAK_POWER_DAY_KEYS.map(([days, key]) => (
                <div key={key} className="rounded-[18px] border border-white/8 bg-white/[0.04] p-3">
                  <img src={getGamificationSpriteUrl(key, 256, gamificationTheme)} alt="" className="mx-auto size-28 object-contain" />
                  <div className="mt-2 text-center text-sm text-white/74">{days} day power</div>
                </div>
              ))}
            </div>
          </Card>
          <Card className="p-4">
            <div className="flex items-center gap-2 font-display text-xl text-white">
              <Lock className="size-5 text-slate-300" />
              Absence pressure states
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-2 md:grid-cols-4 xl:grid-cols-5">
              {GAMIFICATION_STREAK_AWAY_DAY_KEYS.map(([days, key]) => (
                <div key={key} className="rounded-[18px] border border-white/8 bg-white/[0.04] p-3">
                  <img src={getGamificationSpriteUrl(key, 256, gamificationTheme)} alt="" className="mx-auto size-28 object-contain" />
                  <div className="mt-2 text-center text-sm text-white/74">{days} days away</div>
                </div>
              ))}
            </div>
          </Card>
        </section>
      ) : (
        <section className="grid gap-5">
          {GAMIFICATION_CATEGORIES.map((group) => {
            const groupItems = filteredItems.filter((item) => item.category === group.id);
            if (groupItems.length === 0) return null;
            return (
              <section key={group.id} className="grid gap-3">
                <div className="flex items-end justify-between gap-3">
                  <div>
                    <div className="font-display text-xl text-white">{group.label}</div>
                    <div className="text-sm text-white/44">{groupItems.length} visible rewards</div>
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
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/72 p-4 backdrop-blur-sm" onClick={() => setSelectedItem(null)}>
          <div
            className="w-full max-w-[34rem] rounded-[26px] border border-white/10 bg-[rgb(12,17,30)] p-5 shadow-[0_32px_90px_rgba(0,0,0,0.6)]"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-start gap-4">
              <img src={getGamificationSpriteUrl(selectedItem.assetKey, 512, gamificationTheme)} alt="" className="size-32 object-contain" />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap gap-2">
                  <Badge className={cn("border bg-black/18", tierTone(selectedItem.tier))}>{selectedItem.tier}</Badge>
                  <Badge className="bg-white/[0.06] text-white/58">{selectedItem.kind}</Badge>
                </div>
                <div className="mt-3 font-display text-2xl text-white">{selectedItem.title}</div>
                <p className="mt-2 text-sm leading-6 text-white/62">{selectedItem.summary}</p>
              </div>
            </div>
            <div className="mt-5 rounded-[18px] border border-white/8 bg-white/[0.04] p-4">
              <div className="text-sm font-semibold text-white">Requirement</div>
              <p className="mt-2 text-sm leading-6 text-white/58">{selectedItem.requirementText}</p>
              <div className="mt-4">
                <ProgressMeter value={selectedItem.progressPercent} />
                <div className="mt-2 flex justify-between text-[11px] uppercase tracking-[0.16em] text-white/40">
                  <span>{selectedItem.progressCurrent}/{selectedItem.progressTarget}</span>
                  <span>{selectedItem.unlocked ? "earned" : "locked"}</span>
                </div>
              </div>
            </div>
            <div className="mt-4 flex justify-end">
              <Button type="button" variant="secondary" onClick={() => setSelectedItem(null)}>
                Close
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
