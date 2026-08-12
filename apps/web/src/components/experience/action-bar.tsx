import * as Dialog from "@radix-ui/react-dialog";
import {
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  type RefObject
} from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { LucideIcon } from "lucide-react";
import {
  ArrowRight,
  BookmarkPlus,
  BookCopy,
  BrainCircuit,
  BriefcaseBusiness,
  CalendarDays,
  Clock3,
  Filter,
  GitBranch,
  Inbox,
  LayoutDashboard,
  LoaderCircle,
  Network,
  NotebookPen,
  Pin,
  PinOff,
  Plus,
  Radar,
  Repeat,
  Search,
  Settings,
  SlidersHorizontal,
  Target,
  Trash2,
  X,
  Zap
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { CaptureDialog } from "@/components/experience/capture-dialog";
import {
  EntityLinkMultiSelect,
  type EntityLinkOption
} from "@/components/psyche/entity-link-multiselect";
import type { ForgeCreateAction } from "@/components/create-menu";
import {
  PRIMARY_ROUTES,
  getRouteDetail,
  getRouteLabel
} from "@/components/shell/shell-routes";
import { EntityBadge } from "@/components/ui/entity-badge";
import { EntityName } from "@/components/ui/entity-name";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  createSavedView,
  deleteSavedView,
  getEntityNavigation,
  getSavedViews,
  pinEntityNavigation,
  searchLocalRecords,
  touchEntityNavigation,
  unpinEntityNavigation
} from "@/lib/api";
import {
  ACTION_BAR_FILTER_TOKENS,
  actionBarEntityTypeToKind,
  buildActionBarCreateActionMatches,
  createActionMatchesActionBarFilters,
  getActionBarEntityTypesForFilters,
  normalizeActionBarQuery,
  resolveEntityNavigationTargetFromLocation,
  scoreActionBarMatch
} from "@/lib/action-bar";
import {
  getEntityVisual,
  isEntityKind,
  type EntityKind
} from "@/lib/entity-visuals";
import { useI18n } from "@/lib/i18n";
import type {
  CrudEntityType,
  ForgeSnapshot,
  LocalSearchEvidence,
  LocalSearchEntityKind,
  LocalSearchResult,
  SavedView
} from "@/lib/types";
import { cn } from "@/lib/utils";

type ActionBarProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  snapshot: ForgeSnapshot;
  selectedUserIds: string[];
  onSelectedUserIdsChange?: (userIds: string[]) => void;
  createActions: ForgeCreateAction[];
  returnFocusRef?: RefObject<HTMLElement | null>;
};

type ActionBarSection =
  | "routes"
  | "pinned"
  | "recent"
  | "quick-actions"
  | "results";

type ActionBarItem = {
  id: string;
  title: string;
  detail: string;
  category: string;
  section: ActionBarSection;
  searchText: string;
  score: number;
  href?: string;
  onSelect?: () => void;
  kind?: EntityKind;
  icon?: LucideIcon;
  tileClassName?: string;
  badgeClassName?: string;
  entityType?: CrudEntityType;
  entityId?: string;
  pinId?: string | null;
  availability?: "available" | "deleted" | "missing";
  graphHref?: string | null;
  evidence?: LocalSearchEvidence[];
};

function sameStringIds(left: string[], right: string[]) {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function getAuxiliaryVisual(
  category:
    | "action"
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
    case "action":
      return {
        icon: Plus,
        tileClassName:
          "border-[color-mix(in_srgb,var(--success)_22%,var(--ui-border-subtle)_78%)] bg-[var(--ui-success-soft)] text-[color-mix(in_srgb,var(--success)_76%,var(--ui-ink-strong)_24%)] shadow-[var(--ui-shadow-soft)]",
        badgeClassName:
          "border-[color-mix(in_srgb,var(--success)_22%,var(--ui-border-subtle)_78%)] bg-[var(--ui-success-soft)] text-[color-mix(in_srgb,var(--success)_76%,var(--ui-ink-strong)_24%)]"
      };
    case "wiki":
      return {
        icon: BookCopy,
        tileClassName:
          "border-[color-mix(in_srgb,var(--info)_22%,var(--ui-border-subtle)_78%)] bg-[var(--ui-info-soft)] text-[color-mix(in_srgb,var(--info)_76%,var(--ui-ink-strong)_24%)] shadow-[var(--ui-shadow-soft)]",
        badgeClassName:
          "border-[color-mix(in_srgb,var(--info)_22%,var(--ui-border-subtle)_78%)] bg-[var(--ui-info-soft)] text-[color-mix(in_srgb,var(--info)_76%,var(--ui-ink-strong)_24%)]"
      };
    case "note":
      return {
        icon: NotebookPen,
        tileClassName:
          "border-[color-mix(in_srgb,var(--warning)_22%,var(--ui-border-subtle)_78%)] bg-[var(--ui-warning-soft)] text-[color-mix(in_srgb,var(--warning)_76%,var(--ui-ink-strong)_24%)] shadow-[var(--ui-shadow-soft)]",
        badgeClassName:
          "border-[color-mix(in_srgb,var(--warning)_22%,var(--ui-border-subtle)_78%)] bg-[var(--ui-warning-soft)] text-[color-mix(in_srgb,var(--warning)_76%,var(--ui-ink-strong)_24%)]"
      };
    case "insight":
      return {
        icon: Radar,
        tileClassName:
          "border-[color-mix(in_srgb,var(--success)_22%,var(--ui-border-subtle)_78%)] bg-[var(--ui-success-soft)] text-[color-mix(in_srgb,var(--success)_76%,var(--ui-ink-strong)_24%)] shadow-[var(--ui-shadow-soft)]",
        badgeClassName:
          "border-[color-mix(in_srgb,var(--success)_22%,var(--ui-border-subtle)_78%)] bg-[var(--ui-success-soft)] text-[color-mix(in_srgb,var(--success)_76%,var(--ui-ink-strong)_24%)]"
      };
    case "calendar":
      return {
        icon: CalendarDays,
        tileClassName:
          "border-[color-mix(in_srgb,var(--primary)_22%,var(--ui-border-subtle)_78%)] bg-[var(--ui-accent-soft)] text-[var(--primary)] shadow-[var(--ui-shadow-soft)]",
        badgeClassName:
          "border-[color-mix(in_srgb,var(--primary)_22%,var(--ui-border-subtle)_78%)] bg-[var(--ui-accent-soft)] text-[var(--primary)]"
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

export function mapLocalSearchResultsToActionBarItems(
  results: LocalSearchResult[],
  pinned: Array<{
    entityType: CrudEntityType;
    entityId: string;
    pinId: string | null;
  }> = []
) {
  return results.map((result): ActionBarItem => {
    const kind =
      result.entityKind && isEntityKind(result.entityKind)
        ? result.entityKind
        : undefined;
    let auxiliaryVisual = getAuxiliaryVisual("search");
    if (result.entityKind === "wiki_page") {
      auxiliaryVisual = getAuxiliaryVisual("wiki");
    } else if (result.entityType === "note") {
      auxiliaryVisual = getAuxiliaryVisual("note");
    } else if (result.entityType === "insight") {
      auxiliaryVisual = getAuxiliaryVisual("insight");
    } else if (
      result.entityType === "calendar_event" ||
      result.entityType === "task_timebox" ||
      result.entityType === "work_block_template"
    ) {
      auxiliaryVisual = getAuxiliaryVisual("calendar");
    }

    return {
      id: `${result.entityType}-${result.entityId}`,
      title: result.title,
      detail: result.detail,
      href: result.sourceHref,
      graphHref: result.graphHref,
      category: result.category,
      section: "results",
      searchText:
        `${result.title} ${result.detail} ${result.category}`.toLowerCase(),
      score: result.score,
      kind,
      icon: auxiliaryVisual.icon,
      tileClassName: auxiliaryVisual.tileClassName,
      badgeClassName: auxiliaryVisual.badgeClassName,
      entityType: result.entityType,
      entityId: result.entityId,
      pinId:
        pinned.find(
          (pin) =>
            pin.entityType === result.entityType &&
            pin.entityId === result.entityId
        )?.pinId ?? null,
      availability: "available",
      evidence: result.evidence
    };
  });
}

function ActionBarLeadingTile({ item }: { item: ActionBarItem }) {
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

function ActionBarCategoryBadge({ item }: { item: ActionBarItem }) {
  if (item.kind && item.section === "results") {
    return (
      <EntityBadge
        kind={item.kind}
        label={item.category}
        compact
        gradient={false}
      />
    );
  }

  const visual = getAuxiliaryVisual(
    item.section === "quick-actions" ? "action" : "search",
    item.icon
  );
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

function buildRouteItemSearchText(
  title: string,
  detail: string,
  category: string
) {
  return `${title} ${detail} ${category}`.trim().toLowerCase();
}

export function ActionBar({
  open,
  onOpenChange,
  snapshot,
  selectedUserIds,
  onSelectedUserIdsChange,
  createActions,
  returnFocusRef
}: ActionBarProps) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { t } = useI18n();
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [selectedFilterIds, setSelectedFilterIds] = useState<string[]>([]);
  const [savedViewName, setSavedViewName] = useState("");
  const [savedViewNotice, setSavedViewNotice] = useState<string | null>(null);
  const [savedViewError, setSavedViewError] = useState<string | null>(null);
  const [captureOpen, setCaptureOpen] = useState(false);
  const deferredQuery = useDeferredValue(query);
  const normalizedQuery = normalizeActionBarQuery(deferredQuery);
  const selectedFilterKey = selectedFilterIds.join("|");

  const selectedFilters = useMemo(
    () =>
      ACTION_BAR_FILTER_TOKENS.filter((filter) =>
        selectedFilterIds.includes(filter.id)
      ),
    [selectedFilterIds]
  );

  useEffect(() => {
    if (!open) {
      setQuery("");
      setActiveIndex(0);
      setSelectedFilterIds([]);
      setSavedViewName("");
      setSavedViewNotice(null);
      setSavedViewError(null);
    }
  }, [open]);

  const filterOptions = useMemo<EntityLinkOption[]>(
    () =>
      ACTION_BAR_FILTER_TOKENS.map((filter) => ({
        value: filter.id,
        label: filter.label,
        description:
          filter.id === "wiki_page"
            ? "Search only KarpaWiki pages."
            : filter.id === "note"
              ? "Search notes and evidence that are not wiki pages."
              : `Search ${filter.label.toLowerCase()} records.`,
        searchText: filter.searchText,
        kind: filter.kind
      })),
    []
  );

  const savedViewOwner =
    snapshot.users.find((user) => user.id === "user_operator") ??
    snapshot.users.find((user) => user.kind === "human") ??
    null;
  const captureOwnerUserId =
    selectedUserIds.length === 1
      ? selectedUserIds[0]
      : (savedViewOwner?.id ?? null);
  const savedViewsQuery = useQuery({
    queryKey: ["forge-saved-views", savedViewOwner?.id ?? ""],
    enabled: open && savedViewOwner !== null,
    queryFn: () => getSavedViews(savedViewOwner!.id)
  });
  const createSavedViewMutation = useMutation({
    mutationFn: () =>
      createSavedView({
        ownerUserId: savedViewOwner!.id,
        name: savedViewName.trim(),
        query: query.trim(),
        filterIds: selectedFilterIds,
        scopeMode: selectedUserIds.length > 0 ? "selected" : "all",
        scopeUserIds: selectedUserIds
      }),
    onMutate: () => {
      setSavedViewNotice(null);
      setSavedViewError(null);
    },
    onSuccess: async (result) => {
      setSavedViewName("");
      setSavedViewNotice(`Saved ${result.savedView.name}.`);
      await queryClient.invalidateQueries({
        queryKey: ["forge-saved-views", savedViewOwner?.id ?? ""]
      });
    },
    onError: (error) => {
      setSavedViewError(
        error instanceof Error
          ? error.message
          : "Forge could not save this view."
      );
    }
  });
  const deleteSavedViewMutation = useMutation({
    mutationFn: (savedViewId: string) =>
      deleteSavedView(savedViewId, savedViewOwner!.id),
    onMutate: () => {
      setSavedViewNotice(null);
      setSavedViewError(null);
    },
    onSuccess: async () => {
      setSavedViewNotice("Saved view deleted.");
      await queryClient.invalidateQueries({
        queryKey: ["forge-saved-views", savedViewOwner?.id ?? ""]
      });
    },
    onError: (error) => {
      setSavedViewError(
        error instanceof Error
          ? error.message
          : "Forge could not delete this saved view."
      );
    }
  });

  const applySavedView = (savedView: SavedView) => {
    setSavedViewError(null);
    if (savedView.compatibility === "unsupported") {
      setSavedViewNotice(null);
      setSavedViewError(
        `${savedView.name} was saved by a newer Forge version and cannot be opened safely.`
      );
      return;
    }
    if (
      savedView.scopeMode === "selected" &&
      savedView.scopeUserIds.length === 0
    ) {
      setSavedViewNotice(null);
      setSavedViewError(
        `${savedView.name} cannot be opened because every saved person is unavailable.`
      );
      return;
    }
    const currentFilterIds = new Set<string>(
      ACTION_BAR_FILTER_TOKENS.map((filter) => filter.id)
    );
    const currentUserIds = new Set(snapshot.users.map((user) => user.id));
    setQuery(savedView.query);
    const nextFilterIds = savedView.filterIds.filter((filterId) =>
      currentFilterIds.has(filterId)
    );
    setSelectedFilterIds((current) =>
      sameStringIds(current, nextFilterIds) ? current : nextFilterIds
    );
    const nextScopeUserIds = savedView.scopeUserIds.filter((userId) =>
      currentUserIds.has(userId)
    );
    if (!sameStringIds(selectedUserIds, nextScopeUserIds)) {
      onSelectedUserIdsChange?.(nextScopeUserIds);
    }
    setActiveIndex(0);
    const skipped =
      savedView.unavailableFilterIds.length +
      savedView.unavailableScopeUserIds.length;
    setSavedViewNotice(
      skipped > 0
        ? `Opened ${savedView.name}. ${skipped} unavailable ${skipped === 1 ? "item was" : "items were"} skipped.`
        : `Opened ${savedView.name}.`
    );
  };

  const sectionLabels = useMemo<Record<ActionBarSection, string>>(
    () => ({
      routes: t("common.actionBar.sections.routes"),
      pinned: t("common.actionBar.sections.pinned"),
      recent: t("common.actionBar.sections.recent"),
      "quick-actions": t("common.actionBar.sections.quickActions"),
      results: t("common.actionBar.sections.results")
    }),
    [t]
  );

  const routeItems = useMemo<ActionBarItem[]>(
    () => [
      {
        id: "route-overview",
        title: t("common.routeLabels.overview"),
        detail: t("common.commandPalette.routeOverview"),
        href: "/overview",
        category: t("common.commandPalette.categoryRoute"),
        section: "routes",
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
        section: "routes",
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
        section: "routes",
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
        section: "routes",
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
        section: "routes",
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
        section: "routes",
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
        section: "routes",
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
        section: "routes",
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
        section: "routes",
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
        section: "routes",
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
        section: "routes",
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
        section: "routes",
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
        section: "routes",
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
        section: "routes",
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

  const searchableRouteItems = useMemo<ActionBarItem[]>(() => {
    const existingHrefs = new Set(routeItems.map((item) => item.href));
    const routeCategory = t("common.commandPalette.categoryRoute");
    return [
      ...routeItems,
      ...PRIMARY_ROUTES.filter((route) => !existingHrefs.has(route.to)).map(
        (route) => {
          const title = getRouteLabel(route, t);
          const detail = getRouteDetail(route, t);
          return {
            id: `route-${route.id}`,
            title,
            detail,
            href: route.to,
            category: routeCategory,
            section: "routes" as const,
            searchText: buildRouteItemSearchText(title, detail, routeCategory),
            score: 0,
            ...getAuxiliaryVisual("route", route.icon)
          };
        }
      )
    ];
  }, [routeItems, t]);

  const entityNavigationQuery = useQuery({
    queryKey: [
      "forge-entity-navigation",
      [...selectedUserIds].sort().join("|")
    ],
    enabled: open,
    queryFn: () =>
      getEntityNavigation({
        pinnedLimit: 6,
        recentLimit: 6,
        userIds: selectedUserIds
      })
  });

  const navigationItems = useMemo<ActionBarItem[]>(
    () => [
      ...(entityNavigationQuery.data?.pinned ?? []).map((item) => ({
        id: `pin-${item.pinId ?? `${item.entityType}-${item.entityId}`}`,
        title: item.title,
        detail: item.detail,
        href: item.targetPath ?? undefined,
        category: item.category,
        section: "pinned" as const,
        searchText:
          `${item.title} ${item.detail} ${item.category}`.toLowerCase(),
        score: 0,
        kind: actionBarEntityTypeToKind(item.entityType) ?? undefined,
        entityType: item.entityType,
        entityId: item.entityId,
        pinId: item.pinId,
        availability: item.availability
      })),
      ...(entityNavigationQuery.data?.recent ?? []).map((item) => ({
        id: `recent-${item.entityType}-${item.entityId}`,
        title: item.title,
        detail: item.detail,
        href: item.targetPath ?? undefined,
        category: item.category,
        section: "recent" as const,
        searchText:
          `${item.title} ${item.detail} ${item.category}`.toLowerCase(),
        score: 0,
        kind: actionBarEntityTypeToKind(item.entityType) ?? undefined,
        entityType: item.entityType,
        entityId: item.entityId,
        pinId: null,
        availability: item.availability
      }))
    ],
    [entityNavigationQuery.data]
  );

  const captureActionItem = useMemo<ActionBarItem>(
    () => ({
      id: "quick-global-capture",
      title: "Capture anything",
      detail:
        "Review text, a link, one file, or browser dictation before Forge creates a Note or Artifact.",
      category: "Quick action",
      section: "quick-actions",
      searchText:
        "capture anything quick inbox text link url file upload dictate dictation voice note artifact",
      score: normalizedQuery
        ? scoreActionBarMatch(
            deferredQuery,
            "Capture anything",
            "capture anything quick inbox text link url file upload dictate dictation voice note artifact"
          )
        : 0,
      onSelect: () => setCaptureOpen(true),
      ...getAuxiliaryVisual("action", Inbox)
    }),
    [deferredQuery, normalizedQuery]
  );

  const defaultItems = useMemo<ActionBarItem[]>(
    () =>
      [
        captureActionItem,
        ...navigationItems.filter((item) => item.section === "pinned"),
        ...navigationItems.filter((item) => item.section === "recent"),
        ...routeItems.slice(0, 5)
      ].slice(0, 16),
    [captureActionItem, navigationItems, routeItems]
  );

  const entitySearchQuery = useQuery({
    queryKey: [
      "forge-action-bar-search",
      normalizedQuery,
      [...selectedFilterIds].sort().join("|"),
      [...selectedUserIds].sort().join("|"),
      entityNavigationQuery.data?.generatedAt ?? ""
    ],
    enabled: open && (normalizedQuery.length > 0 || selectedFilters.length > 0),
    queryFn: async () => {
      const response = await searchLocalRecords({
        query: deferredQuery,
        entityTypes:
          selectedFilters.length > 0
            ? getActionBarEntityTypesForFilters(selectedFilters)
            : undefined,
        entityKinds:
          selectedFilters.length > 0
            ? selectedFilters.map(
                (filter) => filter.kind as LocalSearchEntityKind
              )
            : undefined,
        userIds: selectedUserIds.length > 0 ? selectedUserIds : undefined,
        limit: 12
      });
      return mapLocalSearchResultsToActionBarItems(
        response.results,
        entityNavigationQuery.data?.pinned
      );
    }
  });

  const pinMutation = useMutation({
    mutationFn: async (item: ActionBarItem) => {
      if (item.pinId) {
        return unpinEntityNavigation(item.pinId);
      }
      if (!item.entityType || !item.entityId) {
        return null;
      }
      return pinEntityNavigation({
        entityType: item.entityType,
        entityId: item.entityId,
        ownerUserId: selectedUserIds.length === 1 ? selectedUserIds[0] : null
      });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ["forge-entity-navigation"]
      });
    }
  });

  const routeMatches = useMemo(() => {
    if (!normalizedQuery) {
      return [];
    }

    return searchableRouteItems
      .map((item) => ({
        ...item,
        score: scoreActionBarMatch(deferredQuery, item.title, item.searchText)
      }))
      .filter((item) => item.score > 0)
      .sort(
        (left, right) =>
          right.score - left.score || left.title.localeCompare(right.title)
      )
      .slice(0, 4);
  }, [deferredQuery, normalizedQuery, searchableRouteItems]);

  const quickActionItems = useMemo<ActionBarItem[]>(() => {
    const captureMatches =
      selectedFilters.length === 0 && captureActionItem.score > 0
        ? [captureActionItem]
        : [];
    return [
      ...captureMatches,
      ...buildActionBarCreateActionMatches(deferredQuery, createActions)
        .filter((action) =>
          createActionMatchesActionBarFilters(action, selectedFilters)
        )
        .slice(0, 6)
        .map((action) => ({
          id: `quick-${action.id}`,
          title: action.quickActionTitle,
          detail: action.description,
          category: "Quick action",
          section: "quick-actions" as const,
          searchText:
            `${action.quickActionTitle} ${action.description} ${action.aliases.join(" ")}`.toLowerCase(),
          score: action.score,
          onSelect: action.onSelect,
          ...getAuxiliaryVisual("action", Plus)
        }))
    ].slice(0, 6);
  }, [captureActionItem, createActions, deferredQuery, selectedFilters]);

  const visibleItems = useMemo(() => {
    if (!normalizedQuery && selectedFilters.length === 0) {
      return defaultItems;
    }

    const items = [...quickActionItems, ...routeMatches];
    const seenIds = new Set(items.map((item) => item.id));

    for (const item of entitySearchQuery.data ?? []) {
      if (!seenIds.has(item.id)) {
        seenIds.add(item.id);
        items.push(item);
      }
    }

    return items.slice(0, 16);
  }, [
    defaultItems,
    entitySearchQuery.data,
    normalizedQuery,
    quickActionItems,
    routeMatches,
    selectedFilters.length
  ]);

  useEffect(() => {
    setActiveIndex(0);
  }, [normalizedQuery, open, selectedFilterKey]);

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
        ? (selectedUsers[0]?.displayName ?? "1 selected owner")
        : `${selectedUsers.length || selectedUserIds.length} selected owners`;
  const isSearching =
    (normalizedQuery.length > 0 || selectedFilters.length > 0) &&
    entitySearchQuery.isFetching;

  const handleSelect = (item: ActionBarItem) => {
    if (!item.onSelect && !item.href) {
      return;
    }
    onOpenChange(false);
    if (item.onSelect) {
      item.onSelect();
      return;
    }
    if (item.href) {
      const hrefUrl = new URL(item.href, "http://forge.local");
      const routeTrackedTarget = resolveEntityNavigationTargetFromLocation(
        hrefUrl.pathname,
        hrefUrl.search
      );
      const routeWillTrackThisItem =
        routeTrackedTarget !== null &&
        routeTrackedTarget.entityType === item.entityType &&
        routeTrackedTarget.entityId === item.entityId;
      if (
        item.entityType &&
        item.entityId &&
        item.availability === "available" &&
        !routeWillTrackThisItem
      ) {
        void touchEntityNavigation({
          entityType: item.entityType,
          entityId: item.entityId
        })
          .then(() =>
            queryClient.invalidateQueries({
              queryKey: ["forge-entity-navigation"]
            })
          )
          .catch(() => undefined);
      }
      navigate(item.href);
    }
  };

  return (
    <>
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="surface-overlay fixed inset-0 z-40 backdrop-blur-xl" />
        <Dialog.Content
          className="surface-modal-panel fixed inset-x-3 bottom-3 top-3 z-50 flex flex-col overflow-hidden rounded-[30px] border sm:inset-x-6 sm:bottom-6 sm:top-6 md:left-1/2 md:right-auto md:top-[9vh] md:h-[min(82vh,48rem)] md:w-[min(64rem,calc(100vw-2rem))] md:-translate-x-1/2 md:bottom-auto"
          onCloseAutoFocus={(event) => {
            const returnTarget = returnFocusRef?.current;
            if (returnTarget?.isConnected) {
              event.preventDefault();
              returnTarget.focus();
            }
          }}
        >
          <Dialog.Title className="sr-only">
            {t("common.actionBar.title")}
          </Dialog.Title>
          <Dialog.Description className="sr-only">
            {t("common.actionBar.description")}
          </Dialog.Description>

          <div className="border-b border-[var(--ui-border-subtle)] px-3 py-3 sm:px-5 sm:py-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-2">
                <div className="inline-flex items-center gap-2 rounded-full border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] px-3 py-1.5 text-[12px] text-[var(--ui-ink-medium)]">
                  <span className="rounded-full bg-[var(--ui-surface-2)] px-2 py-0.5 text-[11px] uppercase tracking-[0.16em] text-[var(--ui-ink-faint)]">
                    Scope
                  </span>
                  <span>{scopeLabel}</span>
                </div>
                {selectedFilters.length > 0 ? (
                  <div className="inline-flex items-center gap-2 rounded-full border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] px-3 py-1.5 text-[12px] text-[var(--ui-ink-medium)]">
                    <Filter className="size-3.5 text-[var(--ui-ink-faint)]" />
                    <span>
                      {selectedFilters.length} filter
                      {selectedFilters.length === 1 ? "" : "s"}
                    </span>
                  </div>
                ) : null}
              </div>
              <div className="flex items-center gap-2">
                <div className="hidden flex-wrap items-center gap-2 text-[11px] uppercase tracking-[0.16em] text-[var(--ui-ink-faint)] sm:flex">
                  <span className="rounded-full border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] px-2.5 py-1">
                    Shift Shift
                  </span>
                  <span className="rounded-full border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] px-2.5 py-1">
                    Cmd/Ctrl K
                  </span>
                </div>
                <Dialog.Close asChild>
                  <button
                    type="button"
                    aria-label={`${t("common.actions.close")} ${t("common.actionBar.title")}`}
                    title={t("common.actions.close")}
                    className="inline-flex size-11 shrink-0 items-center justify-center rounded-full border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] text-[var(--ui-ink-soft)] transition hover:border-[var(--ui-border-strong)] hover:bg-[var(--ui-surface-hover)] hover:text-[var(--ui-ink-strong)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color-mix(in_srgb,var(--primary)_45%,transparent)]"
                  >
                    <X className="size-4" />
                  </button>
                </Dialog.Close>
              </div>
            </div>

            <div className="mt-3 rounded-[22px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)] px-3 py-3 shadow-[inset_0_1px_0_var(--ui-border-subtle)] sm:mt-4 sm:rounded-[24px] sm:px-4 sm:py-4">
              <div className="flex items-center gap-3">
                <Search className="size-5 text-[var(--ui-ink-faint)]" />
                <Input
                  autoFocus
                  value={query}
                  maxLength={200}
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
                  placeholder={t("common.actionBar.searchPlaceholder")}
                  className="min-w-0 border-0 bg-transparent px-0 py-0 text-[0.9rem] focus:border-0 sm:text-[1rem]"
                />
                {isSearching ? (
                  <LoaderCircle className="size-4 shrink-0 animate-spin text-[var(--ui-ink-faint)]" />
                ) : null}
              </div>
              <div className="mt-2 pl-8 text-[13px] leading-5 text-[var(--ui-ink-soft)] sm:leading-6">
                <p>
                  Search your Forge records and see the exact words and
                  relationships behind every result.
                </p>
                <p className="hidden text-[var(--ui-ink-faint)] sm:block">
                  Search uses local words and released Forge relationships. It
                  does not use embeddings or infer a hidden meaning.
                </p>
              </div>

              <div className="mt-3 border-t border-[var(--ui-border-subtle)] pt-3 sm:mt-4 sm:pt-4">
                <div className="mb-2 pl-1 text-[11px] uppercase tracking-[0.18em] text-[var(--ui-ink-faint)]">
                  {t("common.actionBar.filtersLabel")}
                </div>
                <EntityLinkMultiSelect
                  options={filterOptions}
                  selectedValues={selectedFilterIds}
                  onChange={setSelectedFilterIds}
                  placeholder={t("common.actionBar.filtersPlaceholder")}
                  emptyMessage={t("common.actionBar.filtersEmpty")}
                  variant="action-bar"
                />
              </div>

              <div className="mt-3 border-t border-[var(--ui-border-subtle)] pt-3 sm:mt-4 sm:pt-4">
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2 pl-1">
                  <span className="text-[11px] uppercase tracking-[0.18em] text-[var(--ui-ink-faint)]">
                    Saved views
                  </span>
                  <span className="text-xs text-[var(--ui-ink-soft)]">
                    {savedViewOwner
                      ? `Saved for ${savedViewOwner.displayName}. Search, filters, and people. Up to 20 views.`
                      : "Search, filters, and people scope."}
                  </span>
                </div>
                <form
                  className="flex min-w-0 flex-col gap-2 sm:flex-row"
                  onSubmit={(event) => {
                    event.preventDefault();
                    if (
                      savedViewOwner &&
                      savedViewName.trim() &&
                      (normalizedQuery ||
                        selectedFilterIds.length > 0 ||
                        selectedUserIds.length > 0)
                    ) {
                      createSavedViewMutation.mutate();
                    }
                  }}
                >
                  <Input
                    value={savedViewName}
                    maxLength={80}
                    onChange={(event) => setSavedViewName(event.target.value)}
                    placeholder="Name this view"
                    aria-label="Saved view name"
                    className="min-w-0 flex-1"
                  />
                  <Button
                    type="submit"
                    size="lg"
                    variant="secondary"
                    pending={createSavedViewMutation.isPending}
                    pendingLabel="Saving…"
                    disabled={
                      !savedViewOwner ||
                      !savedViewName.trim() ||
                      (!normalizedQuery &&
                        selectedFilterIds.length === 0 &&
                        selectedUserIds.length === 0)
                    }
                  >
                    <BookmarkPlus className="size-4" aria-hidden="true" />
                    Save this view
                  </Button>
                </form>
                {savedViewError ? (
                  <p
                    className="mt-2 text-sm text-[var(--ui-danger)]"
                    role="alert"
                  >
                    {savedViewError}
                  </p>
                ) : null}
                {savedViewsQuery.isLoading ? (
                  <p className="mt-3 text-sm text-[var(--ui-ink-soft)]">
                    Loading saved views…
                  </p>
                ) : savedViewsQuery.isError ? (
                  <p
                    className="mt-3 text-sm text-[var(--ui-danger)]"
                    role="alert"
                  >
                    Forge could not load saved views.
                  </p>
                ) : (savedViewsQuery.data?.savedViews.length ?? 0) === 0 ? (
                  <p className="mt-3 text-sm text-[var(--ui-ink-soft)]">
                    No saved views yet.
                  </p>
                ) : (
                  <div
                    className="mt-3 grid max-h-56 gap-2 overflow-y-auto overscroll-contain pr-1 sm:max-h-64 sm:grid-cols-2"
                    role="region"
                    aria-label="Saved views"
                  >
                    {savedViewsQuery.data?.savedViews.map((savedView) => (
                      <div
                        key={savedView.id}
                        className="flex min-w-0 items-stretch rounded-[var(--radius-control)] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)]"
                      >
                        <button
                          type="button"
                          className="min-h-11 min-w-0 flex-1 px-3 py-2 text-left transition hover:bg-[var(--ui-surface-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color-mix(in_srgb,var(--primary)_45%,transparent)]"
                          onClick={() => applySavedView(savedView)}
                        >
                          <span className="block truncate text-sm font-medium text-[var(--ui-ink-strong)]">
                            {savedView.name}
                          </span>
                          <span className="block truncate text-xs text-[var(--ui-ink-soft)]">
                            {savedView.compatibility === "unsupported"
                              ? "Needs a newer Forge version"
                              : savedView.scopeMode === "selected" &&
                                  savedView.scopeUserIds.length === 0
                                ? "All saved people are unavailable"
                                : savedView.query ||
                                  `${savedView.filterIds.length} filters · ${savedView.scopeMode === "all" ? "all" : savedView.scopeUserIds.length} people`}
                          </span>
                        </button>
                        <button
                          type="button"
                          className="m-1 inline-flex size-11 shrink-0 items-center justify-center rounded-[var(--radius-control)] text-[var(--ui-ink-faint)] transition hover:bg-[var(--ui-surface-hover)] hover:text-[var(--ui-danger)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color-mix(in_srgb,var(--primary)_45%,transparent)]"
                          aria-label={`Delete saved view ${savedView.name}`}
                          disabled={deleteSavedViewMutation.isPending}
                          onClick={() =>
                            deleteSavedViewMutation.mutate(savedView.id)
                          }
                        >
                          <Trash2 className="size-4" aria-hidden="true" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                {savedViewNotice ? (
                  <p
                    className="mt-2 text-sm text-[var(--ui-ink-medium)]"
                    role="status"
                    aria-live="polite"
                  >
                    {savedViewNotice}
                  </p>
                ) : null}
              </div>
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3 sm:px-4">
            {entitySearchQuery.isError ? (
              <p
                className="mb-3 rounded-[18px] border border-[color-mix(in_srgb,var(--danger)_24%,var(--ui-border-subtle)_76%)] bg-[var(--ui-danger-soft)] px-4 py-3 text-sm text-[var(--danger)]"
                role="alert"
              >
                Forge could not search your local records. Try again.
              </p>
            ) : null}
            {visibleItems.length === 0 ? (
              <div className="rounded-[24px] border border-dashed border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] px-4 py-8 text-center text-sm text-[var(--ui-ink-soft)]">
                {entitySearchQuery.isFetching
                  ? t("common.actionBar.searching")
                  : entitySearchQuery.isError
                    ? "No search results are available until Forge can retry."
                    : selectedFilters.length > 0
                      ? t("common.actionBar.noResultsWithFilters")
                      : t("common.actionBar.noResults")}
              </div>
            ) : (
              <div className="grid gap-2">
                {visibleItems.map((item, index) => {
                  const previousSection =
                    visibleItems[index - 1]?.section ?? null;
                  const showSectionLabel = previousSection !== item.section;
                  const primaryEvidence = item.evidence?.[0] ?? null;

                  return (
                    <div key={item.id}>
                      {showSectionLabel ? (
                        <div className="px-2 pb-1 pt-2 text-[11px] uppercase tracking-[0.18em] text-[var(--ui-ink-faint)] first:pt-0">
                          {sectionLabels[item.section]}
                        </div>
                      ) : null}

                      <div
                        className={cn(
                          "group flex w-full items-stretch rounded-[24px] border text-left transition",
                          index === activeIndex
                            ? "border-[var(--ui-border-strong)] bg-[var(--ui-surface-3)] shadow-[var(--ui-shadow-soft)]"
                            : "border-transparent bg-[var(--ui-surface-1)] hover:border-[var(--ui-border-subtle)] hover:bg-[var(--ui-surface-hover)]"
                        )}
                        onMouseEnter={() => setActiveIndex(index)}
                      >
                        <button
                          ref={(node) => {
                            itemRefs.current[index] = node;
                          }}
                          type="button"
                          aria-label={
                            item.availability === "missing"
                              ? `${item.title} is unavailable`
                              : undefined
                          }
                          disabled={item.availability === "missing"}
                          className="flex min-w-0 flex-1 items-start gap-2 rounded-[24px] px-3 py-3 text-left disabled:cursor-not-allowed sm:gap-3 sm:px-4 sm:py-3.5"
                          onClick={() => handleSelect(item)}
                        >
                          <ActionBarLeadingTile item={item} />
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <ActionBarCategoryBadge item={item} />
                            </div>
                            <div className="mt-2 line-clamp-2 text-[15px] font-medium text-[var(--ui-ink-strong)]">
                              {item.kind && item.section === "results" ? (
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
                            <div className="mt-1 line-clamp-3 text-sm leading-6 text-[var(--ui-ink-soft)]">
                              {item.detail}
                            </div>
                            {primaryEvidence ? (
                              <div className="mt-1.5 line-clamp-2 text-xs leading-5 text-[var(--ui-ink-medium)]">
                                <span className="font-medium">
                                  {primaryEvidence.kind === "text"
                                    ? `Matched ${primaryEvidence.label}`
                                    : `Related by ${primaryEvidence.label}`}
                                  :
                                </span>{" "}
                                “{primaryEvidence.excerpt}”
                              </div>
                            ) : null}
                          </div>
                          {item.availability !== "missing" ? (
                            <ArrowRight
                              className={cn(
                                "mt-1 size-4 shrink-0 transition",
                                index === activeIndex
                                  ? "text-[var(--ui-ink-medium)]"
                                  : "text-[var(--ui-ink-faint)] group-hover:text-[var(--ui-ink-soft)]"
                              )}
                            />
                          ) : null}
                        </button>
                        {item.graphHref ||
                        (item.entityType && item.entityId) ? (
                          <div className="m-2 flex shrink-0 flex-col gap-1 self-start">
                            {item.graphHref ? (
                              <button
                                type="button"
                                className="inline-flex size-11 items-center justify-center rounded-full text-[var(--ui-ink-faint)] transition hover:bg-[var(--ui-surface-hover)] hover:text-[var(--ui-ink-strong)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color-mix(in_srgb,var(--primary)_45%,transparent)]"
                                aria-label={`Open ${item.title} in Knowledge Graph`}
                                title="Open in Knowledge Graph"
                                onClick={() => {
                                  onOpenChange(false);
                                  navigate(item.graphHref!);
                                }}
                              >
                                <Network
                                  className="size-4"
                                  aria-hidden="true"
                                />
                              </button>
                            ) : null}
                            {item.entityType && item.entityId ? (
                              <button
                                type="button"
                                className="inline-flex size-11 items-center justify-center rounded-full text-[var(--ui-ink-faint)] transition hover:bg-[var(--ui-surface-hover)] hover:text-[var(--ui-ink-strong)] disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color-mix(in_srgb,var(--primary)_45%,transparent)]"
                                aria-label={
                                  item.pinId
                                    ? `Unpin ${item.title}`
                                    : `Pin ${item.title}`
                                }
                                title={item.pinId ? "Unpin" : "Pin"}
                                disabled={pinMutation.isPending}
                                onClick={() => pinMutation.mutate(item)}
                              >
                                {item.pinId ? (
                                  <PinOff className="size-4" />
                                ) : (
                                  <Pin className="size-4" />
                                )}
                              </button>
                            ) : null}
                          </div>
                        ) : null}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div
            className={cn(
              "border-t border-[var(--ui-border-subtle)] sm:px-5 sm:py-3",
              pinMutation.isError ? "px-4 py-3" : "px-0 py-0"
            )}
          >
            {pinMutation.isError ? (
              <div
                className="mb-2 text-[12px] text-[var(--danger)]"
                role="status"
                aria-live="polite"
              >
                Forge could not update that pin. Try again.
              </div>
            ) : null}
            <div className="hidden flex-wrap items-center gap-2 text-[12px] text-[var(--ui-ink-faint)] sm:flex">
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
    <CaptureDialog
      open={captureOpen}
      onOpenChange={setCaptureOpen}
      ownerUserId={captureOwnerUserId}
    />
    </>
  );
}
