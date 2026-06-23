import * as Dialog from "@radix-ui/react-dialog";
import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { LucideIcon } from "lucide-react";
import {
  ArrowRight,
  BookCopy,
  BrainCircuit,
  BriefcaseBusiness,
  CalendarDays,
  Clock3,
  GitBranch,
  LayoutDashboard,
  LoaderCircle,
  Network,
  NotebookPen,
  Radar,
  Repeat,
  Search,
  Settings,
  SlidersHorizontal,
  Target,
  Zap
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { EntityBadge } from "@/components/ui/entity-badge";
import { EntityName } from "@/components/ui/entity-name";
import { getEntityVisual, type EntityKind } from "@/lib/entity-visuals";
import { Input } from "@/components/ui/input";
import { searchEntities } from "@/lib/api";
import {
  buildPowerBarHref,
  buildPowerBarSearchText,
  inferPowerBarDetail,
  inferPowerBarTitle,
  normalizePowerBarQuery,
  POWER_BAR_SEARCH_ENTITY_TYPES,
  powerBarEntityTypeLabel,
  powerBarEntityTypeToKind,
  scorePowerBarMatch
} from "@/lib/power-bar";
import { formatUserSummaryLine } from "@/lib/user-ownership";
import { useI18n } from "@/lib/i18n";
import type { CrudEntityType, ForgeSnapshot } from "@/lib/types";
import { cn } from "@/lib/utils";

type CommandPaletteProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  snapshot: ForgeSnapshot;
  selectedUserIds: string[];
};

type PowerBarItem = {
  id: string;
  title: string;
  detail: string;
  href: string;
  category: string;
  section: "Routes" | "Recent" | "Results";
  searchText: string;
  score: number;
  kind?: EntityKind;
  icon?: LucideIcon;
  tileClassName?: string;
  badgeClassName?: string;
};

const SEARCHABLE_POWER_BAR_ENTITY_TYPES = new Set<CrudEntityType>(
  POWER_BAR_SEARCH_ENTITY_TYPES
);

function isSearchablePowerBarEntityType(
  value: unknown
): value is CrudEntityType {
  return (
    typeof value === "string" &&
    SEARCHABLE_POWER_BAR_ENTITY_TYPES.has(value as CrudEntityType)
  );
}

function getAuxiliaryVisual(
  category:
    | "route"
    | "note"
    | "wiki"
    | "insight"
    | "calendar"
    | "search",
  icon?: LucideIcon
) {
  const resolvedIcon = icon ?? Search;

  switch (category) {
    case "wiki":
      return {
        icon: BookCopy,
        tileClassName:
          "border-blue-300/18 bg-blue-300/12 text-blue-100 shadow-[0_18px_36px_rgba(96,165,250,0.12)]",
        badgeClassName:
          "border-blue-300/18 bg-blue-300/10 text-blue-100"
      };
    case "note":
      return {
        icon: NotebookPen,
        tileClassName:
          "border-amber-300/18 bg-amber-300/12 text-amber-100 shadow-[0_18px_36px_rgba(251,191,36,0.12)]",
        badgeClassName:
          "border-amber-300/18 bg-amber-300/10 text-amber-100"
      };
    case "insight":
      return {
        icon: Radar,
        tileClassName:
          "border-emerald-300/18 bg-emerald-300/12 text-emerald-100 shadow-[0_18px_36px_rgba(52,211,153,0.12)]",
        badgeClassName:
          "border-emerald-300/18 bg-emerald-300/10 text-emerald-100"
      };
    case "calendar":
      return {
        icon: CalendarDays,
        tileClassName:
          "border-cyan-300/18 bg-cyan-300/12 text-cyan-100 shadow-[0_18px_36px_rgba(34,211,238,0.12)]",
        badgeClassName:
          "border-cyan-300/18 bg-cyan-300/10 text-cyan-100"
      };
    case "route":
      return {
        icon: resolvedIcon,
        tileClassName:
          "border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] text-[var(--ui-ink-medium)] shadow-[var(--ui-shadow-soft)]",
        badgeClassName:
          "border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] text-[var(--ui-ink-soft)]"
      };
    default:
      return {
        icon: resolvedIcon,
        tileClassName:
          "border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] text-[var(--ui-ink-medium)] shadow-[var(--ui-shadow-soft)]",
        badgeClassName:
          "border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] text-[var(--ui-ink-soft)]"
      };
  }
}

function PowerBarLeadingTile({ item }: { item: PowerBarItem }) {
  if (item.kind) {
    const visual = getEntityVisual(item.kind);
    const Icon = visual.icon;
    return (
      <span
        className={cn(
          "mt-0.5 inline-flex size-11 shrink-0 items-center justify-center rounded-[17px] border",
          visual.subtleBadgeClassName
        )}
      >
        <Icon className={cn("size-5", visual.iconClassName)} />
      </span>
    );
  }

  const visual = getAuxiliaryVisual("search", item.icon);
  const Icon = item.icon ?? visual.icon;
  return (
    <span
      className={cn(
        "mt-0.5 inline-flex size-11 shrink-0 items-center justify-center rounded-[17px] border",
        item.tileClassName ?? visual.tileClassName
      )}
    >
      <Icon className="size-5" />
    </span>
  );
}

function PowerBarCategoryBadge({ item }: { item: PowerBarItem }) {
  if (item.kind) {
    return (
      <EntityBadge
        kind={item.kind}
        label={item.category}
        compact
        gradient={false}
      />
    );
  }

  const visual = getAuxiliaryVisual("search", item.icon);
  const Icon = item.icon ?? visual.icon;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium",
        item.badgeClassName ?? visual.badgeClassName
      )}
    >
      <Icon className="size-3.5" />
      {item.category}
    </span>
  );
}

function buildRouteItemSearchText(title: string, detail: string, category: string) {
  return `${title} ${detail} ${category}`.trim().toLowerCase();
}

export function CommandPalette({
  open,
  onOpenChange,
  snapshot,
  selectedUserIds
}: CommandPaletteProps) {
  const navigate = useNavigate();
  const { t } = useI18n();
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const deferredQuery = useDeferredValue(query);
  const normalizedQuery = normalizePowerBarQuery(deferredQuery);

  useEffect(() => {
    if (!open) {
      setQuery("");
      setActiveIndex(0);
    }
  }, [open]);

  const routeItems = useMemo<PowerBarItem[]>(
    () => [
      {
        id: "route-overview",
        title: t("common.routeLabels.overview"),
        detail: t("common.commandPalette.routeOverview"),
        href: "/overview",
        category: t("common.commandPalette.categoryRoute"),
        section: "Routes",
        searchText: buildRouteItemSearchText(
          t("common.routeLabels.overview"),
          t("common.commandPalette.routeOverview"),
          t("common.commandPalette.categoryRoute")
        ),
        score: 0,
        ...getAuxiliaryVisual("route", LayoutDashboard)
      },
      {
        id: "route-today",
        title: t("common.routeLabels.today"),
        detail: t("common.commandPalette.routeToday"),
        href: "/today",
        category: t("common.commandPalette.categoryRoute"),
        section: "Routes",
        searchText: buildRouteItemSearchText(
          t("common.routeLabels.today"),
          t("common.commandPalette.routeToday"),
          t("common.commandPalette.categoryRoute")
        ),
        score: 0,
        ...getAuxiliaryVisual("route", Clock3)
      },
      {
        id: "route-kanban",
        title: t("common.routeLabels.kanban"),
        detail: t("common.commandPalette.routeKanban"),
        href: "/kanban",
        category: t("common.commandPalette.categoryRoute"),
        section: "Routes",
        searchText: buildRouteItemSearchText(
          t("common.routeLabels.kanban"),
          t("common.commandPalette.routeKanban"),
          t("common.commandPalette.categoryRoute")
        ),
        score: 0,
        ...getAuxiliaryVisual("route", Zap)
      },
      {
        id: "route-psyche",
        title: t("common.routeLabels.psyche"),
        detail: t("common.commandPalette.routePsyche"),
        href: "/psyche",
        category: t("common.commandPalette.categoryRoute"),
        section: "Routes",
        searchText: buildRouteItemSearchText(
          t("common.routeLabels.psyche"),
          t("common.commandPalette.routePsyche"),
          t("common.commandPalette.categoryRoute")
        ),
        score: 0,
        ...getAuxiliaryVisual("route", BrainCircuit)
      },
      {
        id: "route-notes",
        title: t("common.routeLabels.notes"),
        detail: t("common.commandPalette.routeNotes"),
        href: "/notes",
        category: t("common.commandPalette.categoryRoute"),
        section: "Routes",
        searchText: buildRouteItemSearchText(
          t("common.routeLabels.notes"),
          t("common.commandPalette.routeNotes"),
          t("common.commandPalette.categoryRoute")
        ),
        score: 0,
        ...getAuxiliaryVisual("route", NotebookPen)
      },
      {
        id: "route-wiki",
        title: t("common.routeLabels.wiki"),
        detail: t("common.commandPalette.routeWiki"),
        href: "/wiki",
        category: t("common.commandPalette.categoryRoute"),
        section: "Routes",
        searchText: buildRouteItemSearchText(
          t("common.routeLabels.wiki"),
          t("common.commandPalette.routeWiki"),
          t("common.commandPalette.categoryRoute")
        ),
        score: 0,
        ...getAuxiliaryVisual("route", BookCopy)
      },
      {
        id: "route-goals",
        title: t("common.routeLabels.goals"),
        detail: t("common.commandPalette.routeGoals"),
        href: "/goals",
        category: t("common.commandPalette.categoryRoute"),
        section: "Routes",
        searchText: buildRouteItemSearchText(
          t("common.routeLabels.goals"),
          t("common.commandPalette.routeGoals"),
          t("common.commandPalette.categoryRoute")
        ),
        score: 0,
        ...getAuxiliaryVisual("route", Target)
      },
      {
        id: "route-habits",
        title: t("common.routeLabels.habits"),
        detail: t("common.commandPalette.routeHabits"),
        href: "/habits",
        category: t("common.commandPalette.categoryRoute"),
        section: "Routes",
        searchText: buildRouteItemSearchText(
          t("common.routeLabels.habits"),
          t("common.commandPalette.routeHabits"),
          t("common.commandPalette.categoryRoute")
        ),
        score: 0,
        ...getAuxiliaryVisual("route", Repeat)
      },
      {
        id: "route-projects",
        title: t("common.routeLabels.projects"),
        detail: t("common.commandPalette.routeProjects"),
        href: "/projects",
        category: t("common.commandPalette.categoryRoute"),
        section: "Routes",
        searchText: buildRouteItemSearchText(
          t("common.routeLabels.projects"),
          t("common.commandPalette.routeProjects"),
          t("common.commandPalette.categoryRoute")
        ),
        score: 0,
        ...getAuxiliaryVisual("route", BriefcaseBusiness)
      },
      {
        id: "route-strategies",
        title: t("common.routeLabels.strategies"),
        detail: t("common.commandPalette.routeStrategies"),
        href: "/strategies",
        category: t("common.commandPalette.categoryRoute"),
        section: "Routes",
        searchText: buildRouteItemSearchText(
          t("common.routeLabels.strategies"),
          t("common.commandPalette.routeStrategies"),
          t("common.commandPalette.categoryRoute")
        ),
        score: 0,
        ...getAuxiliaryVisual("route", GitBranch)
      },
      {
        id: "route-preferences",
        title: t("common.routeLabels.preferences"),
        detail: t("common.commandPalette.routePreferences"),
        href: "/preferences",
        category: t("common.commandPalette.categoryRoute"),
        section: "Routes",
        searchText: buildRouteItemSearchText(
          t("common.routeLabels.preferences"),
          t("common.commandPalette.routePreferences"),
          t("common.commandPalette.categoryRoute")
        ),
        score: 0,
        ...getAuxiliaryVisual("route", SlidersHorizontal)
      },
      {
        id: "route-calendar",
        title: t("common.routeLabels.calendar"),
        detail: t("common.commandPalette.routeCalendar"),
        href: "/calendar",
        category: t("common.commandPalette.categoryRoute"),
        section: "Routes",
        searchText: buildRouteItemSearchText(
          t("common.routeLabels.calendar"),
          t("common.commandPalette.routeCalendar"),
          t("common.commandPalette.categoryRoute")
        ),
        score: 0,
        ...getAuxiliaryVisual("route", CalendarDays)
      },
      {
        id: "route-knowledge-graph",
        title: "Knowledge Graph",
        detail: "Open the world model and graph views for Forge.",
        href: "/knowledge-graph",
        category: t("common.commandPalette.categoryRoute"),
        section: "Routes",
        searchText: buildRouteItemSearchText(
          "Knowledge Graph",
          "Open the world model and graph views for Forge.",
          t("common.commandPalette.categoryRoute")
        ),
        score: 0,
        ...getAuxiliaryVisual("route", Network)
      },
      {
        id: "route-settings",
        title: t("common.routeLabels.settings"),
        detail: t("common.commandPalette.routeSettings"),
        href: "/settings",
        category: t("common.commandPalette.categoryRoute"),
        section: "Routes",
        searchText: buildRouteItemSearchText(
          t("common.routeLabels.settings"),
          t("common.commandPalette.routeSettings"),
          t("common.commandPalette.categoryRoute")
        ),
        score: 0,
        ...getAuxiliaryVisual("route", Settings)
      }
    ],
    [t]
  );

  const defaultItems = useMemo<PowerBarItem[]>(() => {
    const recentItems: PowerBarItem[] = [
      ...snapshot.overview.topTasks.slice(0, 4).map((task) => ({
        id: `task-${task.id}`,
        title: task.title,
        detail:
          formatUserSummaryLine(task.user) ||
          t("common.commandPalette.openFocusTask"),
        href: `/tasks/${task.id}`,
        category: t("common.commandPalette.categoryTask"),
        section: "Recent" as const,
        searchText: `${task.title} ${formatUserSummaryLine(task.user)}`.toLowerCase(),
        score: 0,
        kind: "task" as const
      })),
      ...snapshot.dashboard.projects.slice(0, 3).map((project) => ({
        id: `project-${project.id}`,
        title: project.title,
        detail: [project.goalTitle, formatUserSummaryLine(project.user)]
          .filter(Boolean)
          .join(" · "),
        href: `/projects/${project.id}`,
        category: t("common.commandPalette.categoryProject"),
        section: "Recent" as const,
        searchText: `${project.title} ${project.goalTitle ?? ""} ${formatUserSummaryLine(project.user)}`.toLowerCase(),
        score: 0,
        kind: "project" as const
      })),
      ...snapshot.overview.activeGoals.slice(0, 2).map((goal) => ({
        id: `goal-${goal.id}`,
        title: goal.title,
        detail:
          formatUserSummaryLine(goal.user) ||
          t("common.commandPalette.openLifeGoal"),
        href: `/goals/${goal.id}`,
        category: t("common.commandPalette.categoryGoal"),
        section: "Recent" as const,
        searchText: `${goal.title} ${formatUserSummaryLine(goal.user)}`.toLowerCase(),
        score: 0,
        kind: "goal" as const
      })),
      ...snapshot.dashboard.habits.slice(0, 2).map((habit) => ({
        id: `habit-${habit.id}`,
        title: habit.title,
        detail: [
          habit.frequency === "daily" ? "Daily habit" : "Weekly habit",
          formatUserSummaryLine(habit.user)
        ]
          .filter(Boolean)
          .join(" · "),
        href: `/habits?focus=${habit.id}`,
        category: t("common.routeLabels.habits"),
        section: "Recent" as const,
        searchText: `${habit.title} ${habit.frequency} ${formatUserSummaryLine(habit.user)}`.toLowerCase(),
        score: 0,
        kind: "habit" as const
      }))
    ].slice(0, 8);

    return [...routeItems.slice(0, 6), ...recentItems];
  }, [routeItems, snapshot, t]);

  const entitySearchQuery = useQuery({
    queryKey: [
      "forge-action-bar-search-legacy",
      normalizedQuery,
      [...selectedUserIds].sort().join("|")
    ],
    enabled: open && normalizedQuery.length > 0,
    queryFn: async () => {
      const response = await searchEntities({
        searches: POWER_BAR_SEARCH_ENTITY_TYPES.map((entityType) => ({
          entityTypes: [entityType],
          query: deferredQuery.trim(),
          userIds: selectedUserIds.length > 0 ? selectedUserIds : undefined,
          limit: entityType === "note" ? 6 : 4,
          clientRef: entityType
        }))
      });

      const deduped = new Map<string, PowerBarItem>();

      for (const result of response.results) {
        const matches = Array.isArray(
          (result as { matches?: unknown[] }).matches
        )
          ? ((result as { matches: unknown[] }).matches ?? [])
          : [];

        for (const match of matches) {
          if (!match || typeof match !== "object") {
            continue;
          }

          const candidate = match as {
            entityType?: unknown;
            id?: unknown;
            entity?: unknown;
          };

          if (
            !isSearchablePowerBarEntityType(candidate.entityType) ||
            typeof candidate.id !== "string" ||
            !candidate.entity ||
            typeof candidate.entity !== "object"
          ) {
            continue;
          }

          const entity = candidate.entity as Record<string, unknown>;
          const href = buildPowerBarHref(candidate.entityType, candidate.id, entity);
          if (!href) {
            continue;
          }

          const title = inferPowerBarTitle(candidate.entityType, entity);
          const detail = inferPowerBarDetail(candidate.entityType, entity);
          const category = powerBarEntityTypeLabel(candidate.entityType, entity);
          const searchText = buildPowerBarSearchText(candidate.entityType, entity);
          const kind =
            powerBarEntityTypeToKind(candidate.entityType, entity) ?? undefined;
          const score = scorePowerBarMatch(deferredQuery, title, searchText);

          let auxiliaryVisual = getAuxiliaryVisual("search");
          if (candidate.entityType === "note") {
            auxiliaryVisual = getAuxiliaryVisual(
              entity.kind === "wiki" ? "wiki" : "note"
            );
          } else if (candidate.entityType === "insight") {
            auxiliaryVisual = getAuxiliaryVisual("insight");
          } else if (
            candidate.entityType === "calendar_event" ||
            candidate.entityType === "task_timebox" ||
            candidate.entityType === "work_block_template"
          ) {
            auxiliaryVisual = getAuxiliaryVisual("calendar");
          }

          const item: PowerBarItem = {
            id: `${candidate.entityType}-${candidate.id}`,
            title,
            detail,
            href,
            category,
            section: "Results",
            searchText,
            score,
            kind,
            icon: auxiliaryVisual.icon,
            tileClassName: auxiliaryVisual.tileClassName,
            badgeClassName: auxiliaryVisual.badgeClassName
          };

          const previous = deduped.get(item.id);
          if (!previous || item.score > previous.score) {
            deduped.set(item.id, item);
          }
        }
      }

      return Array.from(deduped.values())
        .sort(
          (left, right) =>
            right.score - left.score || left.title.localeCompare(right.title)
        )
        .slice(0, 12);
    }
  });

  const routeMatches = useMemo(() => {
    if (!normalizedQuery) {
      return [];
    }

    return routeItems
      .map((item) => ({
        ...item,
        score: scorePowerBarMatch(deferredQuery, item.title, item.searchText)
      }))
      .filter((item) => item.score > 0)
      .sort(
        (left, right) =>
          right.score - left.score || left.title.localeCompare(right.title)
      )
      .slice(0, 4);
  }, [deferredQuery, normalizedQuery, routeItems]);

  const visibleItems = useMemo(() => {
    if (!normalizedQuery) {
      return defaultItems;
    }

    const items = [...routeMatches];
    const seenIds = new Set(items.map((item) => item.id));

    for (const item of entitySearchQuery.data ?? []) {
      if (!seenIds.has(item.id)) {
        seenIds.add(item.id);
        items.push(item);
      }
    }

    return items.slice(0, 16);
  }, [defaultItems, entitySearchQuery.data, normalizedQuery, routeMatches]);

  useEffect(() => {
    setActiveIndex(0);
  }, [normalizedQuery, open]);

  useEffect(() => {
    if (visibleItems.length === 0) {
      return;
    }

    setActiveIndex((current) =>
      Math.min(Math.max(current, 0), visibleItems.length - 1)
    );
  }, [visibleItems]);

  useEffect(() => {
    const target = itemRefs.current[activeIndex];
    target?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  const activeItem = visibleItems[activeIndex] ?? null;
  const selectedUsers = snapshot.users.filter((user) =>
    selectedUserIds.includes(user.id)
  );
  const scopeLabel =
    selectedUserIds.length === 0
      ? "All humans and bots"
      : selectedUsers.length === 1
        ? selectedUsers[0]?.displayName ?? "1 selected owner"
        : `${selectedUsers.length || selectedUserIds.length} selected owners`;
  const isSearching = normalizedQuery.length > 0 && entitySearchQuery.isFetching;

  const handleSelect = (item: PowerBarItem) => {
    onOpenChange(false);
    navigate(item.href);
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="surface-overlay fixed inset-0 z-40 backdrop-blur-xl" />
        <Dialog.Content className="surface-modal-panel fixed inset-x-3 bottom-3 top-3 z-50 flex flex-col overflow-hidden rounded-[30px] border sm:inset-x-6 sm:bottom-6 sm:top-6 md:left-1/2 md:right-auto md:top-[9vh] md:h-[min(78vh,44rem)] md:w-[min(60rem,calc(100vw-2rem))] md:-translate-x-1/2 md:bottom-auto">
          <Dialog.Title className="sr-only">Forge Action bar</Dialog.Title>
          <Dialog.Description className="sr-only">
            Search routes and Forge records, then open the selected result.
          </Dialog.Description>

          <div className="border-b border-[var(--ui-border-subtle)] px-4 py-4 sm:px-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="inline-flex items-center gap-2 rounded-full border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] px-3 py-1.5 text-[12px] text-[var(--ui-ink-medium)]">
                <span className="rounded-full bg-[var(--ui-surface-2)] px-2 py-0.5 text-[11px] uppercase tracking-[0.16em] text-[var(--ui-ink-faint)]">
                  Scope
                </span>
                <span>{scopeLabel}</span>
              </div>
              <div className="flex flex-wrap items-center gap-2 text-[11px] uppercase tracking-[0.16em] text-[var(--ui-ink-faint)]">
                <span className="rounded-full border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] px-2.5 py-1">
                  Shift Shift
                </span>
                <span className="rounded-full border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] px-2.5 py-1">
                  Cmd/Ctrl K
                </span>
              </div>
            </div>

            <div className="mt-4 rounded-[24px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)] px-4 py-3 shadow-[inset_0_1px_0_var(--ui-border-subtle)]">
              <div className="flex items-center gap-3">
                <Search className="size-5 text-[var(--ui-ink-faint)]" />
                <Input
                  autoFocus
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "ArrowDown") {
                      event.preventDefault();
                      setActiveIndex((current) =>
                        visibleItems.length === 0
                          ? 0
                          : Math.min(current + 1, visibleItems.length - 1)
                      );
                      return;
                    }

                    if (event.key === "ArrowUp") {
                      event.preventDefault();
                      setActiveIndex((current) => Math.max(current - 1, 0));
                      return;
                    }

                    if (event.key === "Enter" && activeItem) {
                      event.preventDefault();
                      handleSelect(activeItem);
                      return;
                    }

                    if (event.key === "Escape") {
                      event.preventDefault();
                      onOpenChange(false);
                    }
                  }}
                  placeholder={t("common.commandPalette.searchPlaceholder")}
                  className="border-0 bg-transparent px-0 py-0 text-[1rem] focus:border-0"
                />
                {isSearching ? (
                  <LoaderCircle className="size-4 shrink-0 animate-spin text-[var(--ui-ink-faint)]" />
                ) : null}
              </div>
              <div className="mt-2 pl-8 text-[13px] leading-6 text-[var(--ui-ink-soft)]">
                {normalizedQuery
                  ? "Search spans routes plus Forge records in the current owner scope."
                  : "Jump between Forge surfaces or start typing to search records across the current scope."}
              </div>
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3 sm:px-4">
            {visibleItems.length === 0 ? (
              <div className="rounded-[24px] border border-dashed border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] px-4 py-8 text-center text-sm text-[var(--ui-ink-soft)]">
                {entitySearchQuery.isFetching
                  ? "Searching Forge..."
                  : t("common.commandPalette.noResults")}
              </div>
            ) : (
              <div className="grid gap-2">
                {visibleItems.map((item, index) => {
                  const previousSection = visibleItems[index - 1]?.section ?? null;
                  const showSectionLabel = previousSection !== item.section;

                  return (
                    <div key={item.id}>
                      {showSectionLabel ? (
                        <div className="px-2 pb-1 pt-2 text-[11px] uppercase tracking-[0.18em] text-[var(--ui-ink-faint)] first:pt-0">
                          {item.section}
                        </div>
                      ) : null}

                      <button
                        ref={(node) => {
                          itemRefs.current[index] = node;
                        }}
                        type="button"
                        className={cn(
                          "group flex w-full items-start gap-3 rounded-[24px] border px-4 py-3.5 text-left transition",
                          index === activeIndex
                            ? "border-[var(--ui-border-strong)] bg-[var(--ui-surface-3)] shadow-[var(--ui-shadow-soft)]"
                            : "border-transparent bg-[var(--ui-surface-1)] hover:border-[var(--ui-border-subtle)] hover:bg-[var(--ui-surface-hover)]"
                        )}
                        onMouseEnter={() => setActiveIndex(index)}
                        onClick={() => handleSelect(item)}
                      >
                        <PowerBarLeadingTile item={item} />
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <PowerBarCategoryBadge item={item} />
                          </div>
                          <div className="mt-2 text-[15px] font-medium text-[var(--ui-ink-strong)]">
                            {item.kind ? (
                              <EntityName
                                kind={item.kind}
                                label={item.title}
                                showIcon={false}
                                labelClassName="text-[var(--ui-ink-strong)]"
                              />
                            ) : (
                              item.title
                            )}
                          </div>
                          <div className="mt-1 text-sm leading-6 text-[var(--ui-ink-soft)]">
                            {item.detail}
                          </div>
                        </div>
                        <ArrowRight
                          className={cn(
                            "mt-1 size-4 shrink-0 transition",
                            index === activeIndex
                              ? "text-[var(--ui-ink-medium)]"
                              : "text-[var(--ui-ink-faint)] group-hover:text-[var(--ui-ink-soft)]"
                          )}
                        />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className="border-t border-[var(--ui-border-subtle)] px-4 py-3 sm:px-5">
            <div className="flex flex-wrap items-center gap-2 text-[12px] text-[var(--ui-ink-faint)]">
              <span className="rounded-full border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] px-2.5 py-1">
                Up/Down navigate
              </span>
              <span className="rounded-full border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] px-2.5 py-1">
                Enter open
              </span>
              <span className="rounded-full border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] px-2.5 py-1">
                Esc close
              </span>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
