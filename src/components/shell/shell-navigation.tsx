import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import { ArrowUpRight, GripVertical, Settings } from "lucide-react";
import { Link, NavLink, useLocation } from "react-router-dom";

import { SheetScaffold } from "@/components/experience/sheet-scaffold";
import {
  NAV_ROUTE_REGISTRY,
  SHELL_NAV_ROUTES,
  getRouteDetail,
  getRouteLabel,
  isPsycheRoute,
  isWikiRoute,
  requirePrimaryRoute,
  routeMatches,
  type ShellRouteDefinition
} from "@/components/shell/shell-routes";
import {
  shellInteractiveActiveClassName,
  shellInteractiveSubtleClassName,
  shellLabelMutedClassName
} from "@/components/shell/shell-style-tokens";
import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n";

export type DesktopSidebarMetricsPosition = "above" | "below";

const DESKTOP_NAV_STORAGE_KEY = "forge.desktop-nav-layout";
const MOBILE_NAV_STORAGE_KEY = "forge.mobile-nav-layout";
const NAV_MIGRATION_STORAGE_KEY = "forge.nav-layout-migrations";
const DESKTOP_SIDEBAR_METRICS_POSITION_STORAGE_KEY =
  "forge.desktop-sidebar-metrics-position";
const DESKTOP_KNOWLEDGE_GRAPH_MIGRATION = "desktop-knowledge-graph-default-v1";
const MOBILE_KNOWLEDGE_GRAPH_MIGRATION = "mobile-knowledge-graph-default-v1";

export function shouldCaptureRouteIntent(event: ReactMouseEvent) {
  return (
    !event.defaultPrevented &&
    event.button === 0 &&
    !event.metaKey &&
    !event.altKey &&
    !event.ctrlKey &&
    !event.shiftKey
  );
}

function readStoredNavIds(storageKey: string, defaults: string[]) {
  if (typeof window === "undefined") {
    return defaults;
  }
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) {
      return defaults;
    }
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return defaults;
    }
    const validIds = new Set(NAV_ROUTE_REGISTRY.map((route) => route.id));
    const filtered = parsed.filter(
      (entry): entry is string =>
        typeof entry === "string" && validIds.has(entry)
    );
    const resolved = filtered.length > 0 ? filtered : defaults;
    const readMigrationState = () => {
      try {
        const rawMigrations = window.localStorage.getItem(
          NAV_MIGRATION_STORAGE_KEY
        );
        if (!rawMigrations) {
          return {} as Record<string, boolean>;
        }
        const parsedMigrations = JSON.parse(rawMigrations) as unknown;
        return parsedMigrations &&
          typeof parsedMigrations === "object" &&
          !Array.isArray(parsedMigrations)
          ? (parsedMigrations as Record<string, boolean>)
          : ({} as Record<string, boolean>);
      } catch {
        return {} as Record<string, boolean>;
      }
    };
    const writeMigrationState = (nextState: Record<string, boolean>) => {
      try {
        window.localStorage.setItem(
          NAV_MIGRATION_STORAGE_KEY,
          JSON.stringify(nextState)
        );
      } catch {
        return;
      }
    };
    const applyKnowledgeGraphMigration = (
      ids: string[],
      migrationKey: string,
      insertAfterId: string
    ) => {
      const migrationState = readMigrationState();
      if (migrationState[migrationKey]) {
        return ids;
      }
      const nextIds = ids.includes("knowledge-graph")
        ? ids
        : (() => {
            const insertIndex = ids.indexOf(insertAfterId);
            if (insertIndex < 0) {
              return [...ids, "knowledge-graph"];
            }
            return [
              ...ids.slice(0, insertIndex + 1),
              "knowledge-graph",
              ...ids.slice(insertIndex + 1)
            ];
          })();
      writeMigrationState({
        ...migrationState,
        [migrationKey]: true
      });
      return nextIds;
    };

    if (storageKey === DESKTOP_NAV_STORAGE_KEY) {
      return applyKnowledgeGraphMigration(
        resolved,
        DESKTOP_KNOWLEDGE_GRAPH_MIGRATION,
        "calendar"
      );
    }
    if (storageKey === MOBILE_NAV_STORAGE_KEY) {
      return applyKnowledgeGraphMigration(
        resolved,
        MOBILE_KNOWLEDGE_GRAPH_MIGRATION,
        "notes"
      );
    }
    return resolved;
  } catch {
    return defaults;
  }
}

function writeStoredNavIds(storageKey: string, ids: string[]) {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(ids));
  } catch {
    return;
  }
}

export function useShellNavigationState(routePathname: string) {
  const [navCollapsed, setNavCollapsed] = useState(false);
  const [desktopNavIds, setDesktopNavIds] = useState<string[]>(() =>
    readStoredNavIds(DESKTOP_NAV_STORAGE_KEY, [
      ...SHELL_NAV_ROUTES.map((route) => route.id)
    ])
  );
  const [mobileNavIds, setMobileNavIds] = useState<string[]>(() =>
    readStoredNavIds(MOBILE_NAV_STORAGE_KEY, [
      requirePrimaryRoute("overview").id,
      requirePrimaryRoute("today").id,
      requirePrimaryRoute("kanban").id,
      requirePrimaryRoute("notes").id,
      requirePrimaryRoute("knowledge-graph").id
    ])
  );
  const [navEditorOpen, setNavEditorOpen] = useState(false);
  const [desktopSidebarMetricsPosition, setDesktopSidebarMetricsPosition] =
    useState<DesktopSidebarMetricsPosition>(() => {
      if (typeof window === "undefined") {
        return "above";
      }
      try {
        const stored = window.localStorage.getItem(
          DESKTOP_SIDEBAR_METRICS_POSITION_STORAGE_KEY
        );
        return stored === "below" ? "below" : "above";
      } catch {
        return "above";
      }
    });
  const autoCollapseAppliedRef = useRef(false);
  const preAutoCollapseRef = useRef(false);
  const skipNavPersistenceRef = useRef(false);
  const autoCollapseSurface =
    isWikiRoute(routePathname) ||
    isPsycheRoute(routePathname) ||
    routePathname.startsWith("/workbench") ||
    routePathname.startsWith("/knowledge-graph");
  const desktopRoutes = desktopNavIds
    .map((id) => NAV_ROUTE_REGISTRY.find((route) => route.id === id) ?? null)
    .filter((route): route is ShellRouteDefinition => route !== null);
  const mobileRoutes = mobileNavIds
    .map((id) => NAV_ROUTE_REGISTRY.find((route) => route.id === id) ?? null)
    .filter((route): route is ShellRouteDefinition => route !== null);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem("forge.desktop-nav-collapsed");
      if (stored === "true") {
        setNavCollapsed(true);
      }
    } catch {
      return;
    }
  }, []);

  useEffect(() => {
    if (skipNavPersistenceRef.current) {
      skipNavPersistenceRef.current = false;
      return;
    }
    try {
      window.localStorage.setItem(
        "forge.desktop-nav-collapsed",
        String(navCollapsed)
      );
    } catch {
      return;
    }
  }, [navCollapsed]);

  useEffect(() => {
    try {
      window.localStorage.setItem(
        DESKTOP_SIDEBAR_METRICS_POSITION_STORAGE_KEY,
        desktopSidebarMetricsPosition
      );
    } catch {
      return;
    }
  }, [desktopSidebarMetricsPosition]);

  useEffect(() => {
    writeStoredNavIds(DESKTOP_NAV_STORAGE_KEY, desktopNavIds);
  }, [desktopNavIds]);

  useEffect(() => {
    writeStoredNavIds(MOBILE_NAV_STORAGE_KEY, mobileNavIds);
  }, [mobileNavIds]);

  useEffect(() => {
    if (autoCollapseSurface) {
      if (!autoCollapseAppliedRef.current) {
        preAutoCollapseRef.current = navCollapsed;
        autoCollapseAppliedRef.current = true;
        if (!navCollapsed) {
          skipNavPersistenceRef.current = true;
          setNavCollapsed(true);
        }
      }
      return;
    }

    if (!autoCollapseAppliedRef.current) {
      return;
    }
    autoCollapseAppliedRef.current = false;
    if (navCollapsed !== preAutoCollapseRef.current) {
      skipNavPersistenceRef.current = true;
      setNavCollapsed(preAutoCollapseRef.current);
    }
  }, [autoCollapseSurface, navCollapsed]);

  return {
    navCollapsed,
    setNavCollapsed,
    desktopNavIds,
    setDesktopNavIds,
    mobileNavIds,
    setMobileNavIds,
    desktopRoutes,
    mobileRoutes,
    navEditorOpen,
    setNavEditorOpen,
    desktopSidebarMetricsPosition,
    setDesktopSidebarMetricsPosition
  };
}

export function NavItem({
  route,
  compact = false,
  onRouteIntent
}: {
  route: ShellRouteDefinition;
  compact?: boolean;
  onRouteIntent?: (to: string) => void;
}) {
  const { t } = useI18n();
  const location = useLocation();
  const label = getRouteLabel(route, t);
  const Icon = route.icon;
  const forceActive = routeMatches(location.pathname, route);

  return (
    <NavLink
      to={route.to}
      title={compact ? label : undefined}
      aria-label={label}
      onClick={(event) => {
        if (shouldCaptureRouteIntent(event)) {
          onRouteIntent?.(route.to);
        }
      }}
      className={({ isActive }) =>
        cn(
          "interactive-tap flex items-center rounded-[18px] text-sm transition",
          isActive || forceActive
            ? shellInteractiveActiveClassName
            : "text-[var(--ui-ink-soft)] hover:bg-[var(--ui-surface-hover)] hover:text-[var(--ui-ink-strong)]",
          compact ? "justify-center px-3 py-3.5" : "gap-3 px-4 py-3"
        )
      }
    >
      <Icon className="size-4 shrink-0" />
      {!compact ? <span>{label}</span> : null}
    </NavLink>
  );
}

export function MobileBottomNav({
  routes,
  onOpenEditor,
  onRouteIntent
}: {
  routes: ShellRouteDefinition[];
  onOpenEditor?: () => void;
  onRouteIntent?: (to: string) => void;
}) {
  const [moreOpen, setMoreOpen] = useState(false);
  const { t } = useI18n();
  const location = useLocation();
  const holdTimerRef = useRef<number | null>(null);
  const holdTriggeredRef = useRef(false);
  const visibleRoutes = routes.slice(0, 4);
  const moreRoutes = NAV_ROUTE_REGISTRY.filter(
    (route) => !visibleRoutes.some((entry) => entry.id === route.id)
  );

  function startHold() {
    holdTriggeredRef.current = false;
    if (holdTimerRef.current !== null) {
      window.clearTimeout(holdTimerRef.current);
    }
    holdTimerRef.current = window.setTimeout(() => {
      holdTriggeredRef.current = true;
      setMoreOpen(false);
      onOpenEditor?.();
    }, 520);
  }

  function endHold() {
    if (holdTimerRef.current !== null) {
      window.clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
    }
  }

  return (
    <>
      <nav
        data-testid="mobile-bottom-nav"
        className="fixed inset-x-0 bottom-0 z-40 border-t border-[var(--ui-border-subtle)] bg-[color-mix(in_srgb,var(--surface-glass)_96%,transparent)] backdrop-blur-xl lg:hidden"
        style={{
          paddingLeft:
            "max(0.75rem, calc(var(--forge-safe-area-left) + 0.75rem))",
          paddingRight:
            "max(0.75rem, calc(var(--forge-safe-area-right) + 0.75rem))",
          paddingTop: "0.75rem",
          paddingBottom: "calc(var(--forge-safe-area-bottom) + 0.75rem)"
        }}
      >
        <div className="grid grid-cols-5 gap-2">
          {visibleRoutes.map((route) => (
            <NavLink
              key={route.id}
              to={route.to}
              onPointerDown={startHold}
              onPointerUp={endHold}
              onPointerLeave={endHold}
              onClick={(event) => {
                if (holdTriggeredRef.current) {
                  event.preventDefault();
                  holdTriggeredRef.current = false;
                  return;
                }
                if (shouldCaptureRouteIntent(event)) {
                  onRouteIntent?.(route.to);
                }
              }}
              className={({ isActive }) =>
                cn(
                  "flex min-h-11 flex-col items-center justify-center gap-1 rounded-2xl px-2 py-2 text-[12px]",
                  isActive || routeMatches(location.pathname, route)
                    ? "bg-[var(--ui-surface-active)] text-[var(--primary)]"
                    : "text-[var(--ui-ink-soft)]"
                )
              }
            >
              <route.icon className="size-4" />
              <span>{getRouteLabel(route, t)}</span>
            </NavLink>
          ))}
          <button
            type="button"
            className="flex min-h-11 flex-col items-center justify-center gap-1 rounded-2xl px-2 py-2 text-[12px] text-[var(--ui-ink-soft)]"
            onClick={() => {
              if (holdTriggeredRef.current) {
                holdTriggeredRef.current = false;
                return;
              }
              setMoreOpen(true);
            }}
            onPointerDown={startHold}
            onPointerUp={endHold}
            onPointerLeave={endHold}
          >
            <Settings className="size-4" />
            <span>{t("common.shell.more")}</span>
          </button>
        </div>
      </nav>

      <SheetScaffold
        open={moreOpen}
        onOpenChange={setMoreOpen}
        eyebrow={t("common.shell.moreRoutesEyebrow")}
        title={t("common.shell.moreRoutesTitle")}
        description={t("common.shell.moreRoutesDescription")}
      >
        <div className="mb-3 flex items-center justify-between gap-3">
          <button
            type="button"
            className={cn(
              "inline-flex min-h-10 items-center gap-2 rounded-full px-3 py-2 text-sm",
              shellInteractiveSubtleClassName
            )}
            onClick={() => {
              setMoreOpen(false);
              onOpenEditor?.();
            }}
          >
            <GripVertical className="size-4" />
            Customize navigation
          </button>
        </div>
        <div className="grid gap-3">
          {moreRoutes.map((route) => (
            <NavLink
              key={route.id}
              to={route.to}
              onClick={(event) => {
                if (shouldCaptureRouteIntent(event)) {
                  onRouteIntent?.(route.to);
                }
                setMoreOpen(false);
              }}
              className={({ isActive }) =>
                cn(
                  "interactive-tap flex items-center justify-between rounded-[24px] px-4 py-4",
                  isActive || routeMatches(location.pathname, route)
                    ? shellInteractiveActiveClassName
                    : shellInteractiveSubtleClassName
                )
              }
            >
              <span className="flex items-center gap-3">
                <route.icon className="size-4 text-[var(--primary)]" />
                <span>
                  <span className="block text-base font-medium">
                    {getRouteLabel(route, t)}
                  </span>
                  <span className="mt-1 block text-sm text-[var(--ui-ink-soft)]">
                    {getRouteDetail(route, t)}
                  </span>
                </span>
              </span>
              <ArrowUpRight className="size-4 text-[var(--ui-ink-faint)]" />
            </NavLink>
          ))}
        </div>
      </SheetScaffold>
    </>
  );
}

function moveNavEntry(values: string[], fromId: string, toId: string) {
  const fromIndex = values.indexOf(fromId);
  const toIndex = values.indexOf(toId);
  if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) {
    return values;
  }
  return arrayMove(values, fromIndex, toIndex);
}

function SortableNavEntry({
  route,
  prefix,
  label,
  onRemove
}: {
  route: ShellRouteDefinition;
  prefix: string;
  label: string;
  onRemove: () => void;
}) {
  const sortable = useSortable({ id: `${prefix}:${route.id}` });

  return (
    <div
      ref={sortable.setNodeRef}
      style={{
        transform: CSS.Transform.toString(sortable.transform),
        transition: sortable.transition
      }}
      className="flex min-h-16 items-center justify-between gap-3 rounded-[20px] bg-[var(--ui-surface-1)] px-4 py-3"
    >
      <span className="flex min-w-0 items-center gap-3">
        <button
          type="button"
          className="inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-[var(--ui-surface-2)] text-[var(--ui-ink-soft)] transition hover:bg-[var(--ui-surface-hover)] hover:text-[var(--ui-ink-strong)]"
          aria-label={`Reorder ${label}`}
          {...sortable.attributes}
          {...sortable.listeners}
        >
          <GripVertical className="size-4" />
        </button>
        <route.icon className="size-4 shrink-0 text-[var(--primary)]" />
        <span className="truncate text-sm text-[var(--ui-ink-strong)]">
          {label}
        </span>
      </span>
      <button
        type="button"
        className="rounded-full bg-[var(--ui-surface-2)] px-3 py-1.5 text-[12px] text-[var(--ui-ink-medium)]"
        onClick={onRemove}
      >
        Remove
      </button>
    </div>
  );
}

export function ShellNavEditor({
  open,
  onOpenChange,
  desktopNavIds,
  onDesktopNavIdsChange,
  desktopSidebarMetricsPosition,
  onDesktopSidebarMetricsPositionChange,
  mobileNavIds,
  onMobileNavIdsChange
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  desktopNavIds: string[];
  onDesktopNavIdsChange: (ids: string[]) => void;
  desktopSidebarMetricsPosition: DesktopSidebarMetricsPosition;
  onDesktopSidebarMetricsPositionChange: (
    position: DesktopSidebarMetricsPosition
  ) => void;
  mobileNavIds: string[];
  onMobileNavIdsChange: (ids: string[]) => void;
}) {
  const { t } = useI18n();
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 6 }
    })
  );
  const availableRoutes = NAV_ROUTE_REGISTRY.filter(
    (route) =>
      !desktopNavIds.includes(route.id) || !mobileNavIds.includes(route.id)
  );
  const desktopSlotCount = 10;
  const mobileSlotCount = 4;

  function renderSlots(
    ids: string[],
    slotCount: number,
    onChange: (ids: string[]) => void,
    minimum: number,
    prefix: string
  ) {
    const filledRoutes = ids
      .map((id) => NAV_ROUTE_REGISTRY.find((entry) => entry.id === id) ?? null)
      .filter((route): route is ShellRouteDefinition => route !== null);
    const emptySlotCount = Math.max(0, slotCount - filledRoutes.length);

    return (
      <div className="grid gap-2">
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={(event: DragEndEvent) => {
            const activeId = String(event.active.id);
            const overId = event.over ? String(event.over.id) : null;
            if (!overId) {
              return;
            }
            onChange(
              moveNavEntry(
                ids,
                activeId.replace(`${prefix}:`, ""),
                overId.replace(`${prefix}:`, "")
              )
            );
          }}
        >
          <SortableContext
            items={filledRoutes.map((route) => `${prefix}:${route.id}`)}
            strategy={verticalListSortingStrategy}
          >
            {filledRoutes.map((route) => (
              <SortableNavEntry
                key={`${prefix}-${route.id}`}
                route={route}
                prefix={prefix}
                label={getRouteLabel(route, t)}
                onRemove={() =>
                  removeFromList(ids, route.id, onChange, minimum)
                }
              />
            ))}
          </SortableContext>
        </DndContext>
        {Array.from({ length: emptySlotCount }, (_, index) => (
          <div
            key={`${prefix}-empty-${index}`}
            className="flex min-h-16 items-center justify-between gap-3 rounded-[20px] border border-dashed border-[var(--ui-border-strong)] bg-[var(--ui-surface-1)] px-4 py-3"
          >
            <div>
              <div className="text-sm text-[var(--ui-ink-faint)]">
                Empty slot
              </div>
              <div className="text-[12px] text-[var(--ui-ink-faint)]">
                Add a route below to fill this slot
              </div>
            </div>
            <div className="rounded-full bg-[var(--ui-surface-2)] px-2.5 py-1 text-[11px] text-[var(--ui-ink-faint)]">
              Slot {filledRoutes.length + index + 1}
            </div>
          </div>
        ))}
      </div>
    );
  }

  function addToList(
    current: string[],
    nextId: string,
    onChange: (ids: string[]) => void,
    maxItems?: number
  ) {
    if (current.includes(nextId)) {
      return;
    }
    const next = [...current, nextId];
    onChange(maxItems ? next.slice(0, maxItems) : next);
  }

  function removeFromList(
    current: string[],
    id: string,
    onChange: (ids: string[]) => void,
    minimum = 1
  ) {
    const next = current.filter((entry) => entry !== id);
    if (next.length < minimum) {
      return;
    }
    onChange(next);
  }

  return (
    <SheetScaffold
      open={open}
      onOpenChange={onOpenChange}
      eyebrow="Navigation"
      title="Customize navigation"
      description="Add or remove main routes, Psyche shortcuts, and the Workbench flow workspace."
    >
      <div className="grid gap-5">
        <div className="grid gap-3">
          <div
            className={cn(
              "text-[11px] uppercase tracking-[0.16em]",
              shellLabelMutedClassName
            )}
          >
            Desktop sidebar
          </div>
          <div className="rounded-[20px] bg-[var(--ui-surface-1)] p-3">
            <div
              className={cn(
                "text-[11px] uppercase tracking-[0.14em]",
                shellLabelMutedClassName
              )}
            >
              Metric strip position
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {(
                [
                  ["above", "Above navigation"],
                  ["below", "Below navigation"]
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  className={cn(
                    "rounded-full px-3 py-1.5 text-[12px] transition",
                    desktopSidebarMetricsPosition === value
                      ? "bg-[var(--primary)] text-[var(--ui-ink-on-accent)]"
                      : "bg-[var(--ui-surface-2)] text-[var(--ui-ink-medium)] hover:bg-[var(--ui-surface-hover)]"
                  )}
                  onClick={() => onDesktopSidebarMetricsPositionChange(value)}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div className="grid gap-2">
            {renderSlots(
              desktopNavIds,
              desktopSlotCount,
              onDesktopNavIdsChange,
              4,
              "desktop"
            )}
          </div>
        </div>
        <div className="grid gap-3">
          <div
            className={cn(
              "text-[11px] uppercase tracking-[0.16em]",
              shellLabelMutedClassName
            )}
          >
            Mobile bar
          </div>
          <div className="grid gap-2">
            {renderSlots(
              mobileNavIds,
              mobileSlotCount,
              onMobileNavIdsChange,
              2,
              "mobile"
            )}
          </div>
        </div>
        <div className="grid gap-3">
          <div
            className={cn(
              "text-[11px] uppercase tracking-[0.16em]",
              shellLabelMutedClassName
            )}
          >
            Available routes
          </div>
          <div className="grid gap-2">
            {availableRoutes.map((route) => (
              <div
                key={`available-${route.id}`}
                className="flex items-center justify-between gap-3 rounded-[20px] bg-[var(--ui-surface-1)] px-4 py-3"
              >
                <span className="flex items-center gap-3">
                  <route.icon className="size-4 text-[var(--primary)]" />
                  <span>
                    <span className="block text-sm text-[var(--ui-ink-strong)]">
                      {getRouteLabel(route, t)}
                    </span>
                    <span className="block text-[12px] text-[var(--ui-ink-soft)]">
                      {getRouteDetail(route, t)}
                    </span>
                  </span>
                </span>
                <div className="flex items-center gap-2">
                  {!desktopNavIds.includes(route.id) ? (
                    <button
                      type="button"
                      className="rounded-full bg-[var(--ui-surface-2)] px-2.5 py-1.5 text-[11px] text-[var(--ui-ink-medium)]"
                      onClick={() =>
                        addToList(
                          desktopNavIds,
                          route.id,
                          onDesktopNavIdsChange
                        )
                      }
                    >
                      + Sidebar
                    </button>
                  ) : null}
                  {!mobileNavIds.includes(route.id) ? (
                    <button
                      type="button"
                      className="rounded-full bg-[var(--ui-surface-2)] px-2.5 py-1.5 text-[11px] text-[var(--ui-ink-medium)]"
                      onClick={() =>
                        addToList(
                          mobileNavIds,
                          route.id,
                          onMobileNavIdsChange,
                          4
                        )
                      }
                    >
                      + Mobile
                    </button>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </SheetScaffold>
  );
}
