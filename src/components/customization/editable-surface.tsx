import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode
} from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  Responsive as ResponsiveGridLayout,
  type Layout as GridLayout,
  type LayoutItem as GridLayoutItem,
  type ResponsiveLayouts as GridLayoutMap
} from "react-grid-layout/legacy";
import "react-grid-layout/css/styles.css";
import "react-resizable/css/styles.css";
import {
  Eye,
  EyeOff,
  LayoutGrid,
  RotateCcw,
  Settings2,
  Share2,
  Type,
  X
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { getSurfaceLayout, resetSurfaceLayout, saveSurfaceLayout } from "@/lib/api";
import {
  buildDefaultSurfaceLayoutPayload,
  mergeSurfaceLayoutPayload,
  readCachedSurfaceLayout,
  SURFACE_BREAKPOINTS,
  SURFACE_COLUMNS,
  SURFACE_GRID_MARGIN,
  SURFACE_ROW_HEIGHT,
  writeCachedSurfaceLayout,
  type SurfaceBreakpointKey,
  type SurfaceWidgetLayoutDefinition
} from "@/lib/surface-layout";
import type {
  SurfaceLayoutBreakpointItem,
  SurfaceLayoutBreakpoints,
  SurfaceLayoutPayload,
  SurfaceWidgetDensity,
  SurfaceWidgetPreferences
} from "@/lib/types";
import { cn } from "@/lib/utils";

const SAVE_DEBOUNCE_MS = 500;

export type SurfaceWidgetDefinition = SurfaceWidgetLayoutDefinition & {
  title: string;
  description?: string;
  isProcessor?: boolean;
  removable?: boolean;
  processorCapability?: {
    label: string;
    mode: "content" | "tool" | "mcp" | "processor";
    metadata?: Record<string, unknown>;
  };
  render: (context: {
    compact: boolean;
    width: number;
    height: number;
    editing: boolean;
    density: SurfaceWidgetDensity;
    preferences: SurfaceWidgetPreferences;
  }) => ReactNode;
};

function toLayouts(input: SurfaceLayoutBreakpoints): GridLayoutMap {
  return {
    lg: input.lg.map((item) => ({ ...item })),
    md: input.md.map((item) => ({ ...item })),
    sm: input.sm.map((item) => ({ ...item })),
    xs: input.xs.map((item) => ({ ...item })),
    xxs: input.xxs.map((item) => ({ ...item }))
  };
}

function fromLayouts(
  layouts: Partial<GridLayoutMap>,
  fallback: SurfaceLayoutBreakpoints
) {
  const normalize = (
    items: readonly GridLayoutItem[] | undefined,
    breakpoint: SurfaceBreakpointKey
  ): SurfaceLayoutBreakpointItem[] =>
    (items ?? fallback[breakpoint]).map((item) => ({
      i: item.i,
      x: item.x,
      y: item.y,
      w: item.w,
      h: item.h,
      minW: item.minW,
      maxW: item.maxW,
      minH: item.minH,
      maxH: item.maxH
    }));

  return {
    lg: normalize(layouts.lg, "lg"),
    md: normalize(layouts.md, "md"),
    sm: normalize(layouts.sm, "sm"),
    xs: normalize(layouts.xs, "xs"),
    xxs: normalize(layouts.xxs, "xxs")
  } satisfies SurfaceLayoutBreakpoints;
}

function summarizeHiddenWidgets(
  widgets: SurfaceWidgetDefinition[],
  preferences: Record<string, SurfaceWidgetPreferences>
) {
  return widgets.filter((widget) => preferences[widget.id]?.hidden);
}

function layoutPayloadEquals(
  left: SurfaceLayoutPayload,
  right: SurfaceLayoutPayload
) {
  return (
    left.surfaceId === right.surfaceId &&
    JSON.stringify(left.layouts) === JSON.stringify(right.layouts) &&
    JSON.stringify(left.widgets) === JSON.stringify(right.widgets)
  );
}

function layoutsEqual(
  left: SurfaceLayoutBreakpoints,
  right: SurfaceLayoutBreakpoints
) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function widgetSizeForBreakpoint(
  layouts: SurfaceLayoutBreakpoints,
  breakpoint: SurfaceBreakpointKey,
  widgetId: string
) {
  const item = layouts[breakpoint].find((entry) => entry.i === widgetId);
  return {
    width: item?.w ?? 4,
    height: item?.h ?? 3
  };
}

function isCompactWidget(
  size: { width: number; height: number },
  density: SurfaceWidgetDensity
) {
  if (density === "dense") {
    return true;
  }
  if (density === "comfortable") {
    return false;
  }
  return size.width <= 4 || size.height <= 2;
}

function sortLayoutItems(items: SurfaceLayoutBreakpointItem[]) {
  return [...items].sort((left, right) => {
    if (left.y !== right.y) {
      return left.y - right.y;
    }
    if (left.x !== right.x) {
      return left.x - right.x;
    }
    return left.i.localeCompare(right.i);
  });
}

function SurfaceWidgetCard({
  definition,
  preferences,
  size,
  editing,
  selected,
  menuOpen,
  linkedDescriptions,
  onToggleMenu,
  onToggleHandle,
  onHide,
  onShowTitle,
  onShowDescription,
  onChangeDensity,
  children
}: {
  definition: SurfaceWidgetDefinition;
  preferences: SurfaceWidgetPreferences;
  size: { width: number; height: number };
  editing: boolean;
  selected?: boolean;
  menuOpen: boolean;
  linkedDescriptions?: string[];
  onToggleMenu: () => void;
  onToggleHandle?: () => void;
  onHide: () => void;
  onShowTitle: () => void;
  onShowDescription: () => void;
  onChangeDensity: (density: SurfaceWidgetDensity) => void;
  children: ReactNode;
}) {
  const compact = isCompactWidget(size, preferences.density);
  const chromePadding =
    preferences.density === "dense"
      ? "p-2.5"
      : preferences.density === "comfortable"
        ? "p-5"
        : "p-4";

  return (
    <Card
      data-surface-card="true"
      className={cn(
        "surface-grid-card surface-grid-draggable flex h-full min-w-0 flex-col gap-3 overflow-hidden transition",
        chromePadding,
        editing && "cursor-move",
        selected && "ring-1 ring-[var(--primary)]/55"
      )}
    >
      <div className="flex min-w-0 items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          {preferences.titleVisible ? (
            <div className="truncate text-[0.72rem] font-semibold uppercase tracking-[0.16em] text-white/40">
              {definition.title}
            </div>
          ) : null}
          {preferences.descriptionVisible && definition.description && !compact ? (
            <div className="mt-1 text-[12px] leading-5 text-white/52">
              {definition.description}
            </div>
          ) : null}
        </div>
        {editing ? (
          <div className="surface-grid-toolbar flex shrink-0 items-center gap-1">
            {onToggleHandle ? (
              <button
                type="button"
                className={cn(
                  "surface-grid-action inline-flex size-8 items-center justify-center rounded-full bg-white/[0.05] text-white/58 transition hover:bg-white/[0.08] hover:text-white",
                  selected && "bg-[var(--primary)]/[0.14] text-[var(--primary)]"
                )}
                onClick={onToggleHandle}
                aria-label={`Connect ${definition.title}`}
              >
                <Share2 className="size-3.5" />
              </button>
            ) : null}
            <button
              type="button"
              className={cn(
                "surface-grid-action inline-flex size-8 items-center justify-center rounded-full bg-white/[0.05] text-white/58 transition hover:bg-white/[0.08] hover:text-white",
                menuOpen && "bg-white/[0.1] text-white"
              )}
              onClick={onToggleMenu}
              aria-label={`Open layout options for ${definition.title}`}
            >
              <Settings2 className="size-3.5" />
            </button>
          </div>
        ) : null}
      </div>
      {menuOpen && editing ? (
        <div className="surface-grid-toolbar grid gap-2 rounded-[18px] border border-white/8 bg-black/20 p-3 text-[12px] text-white/70">
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="surface-grid-action inline-flex items-center gap-2 rounded-full bg-white/[0.06] px-3 py-2 transition hover:bg-white/[0.1]"
              onClick={onShowTitle}
            >
              {preferences.titleVisible ? (
                <EyeOff className="size-3.5" />
              ) : (
                <Type className="size-3.5" />
              )}
              {preferences.titleVisible ? "Hide title" : "Show title"}
            </button>
            <button
              type="button"
              className="surface-grid-action inline-flex items-center gap-2 rounded-full bg-white/[0.06] px-3 py-2 transition hover:bg-white/[0.1]"
              onClick={onShowDescription}
            >
              {preferences.descriptionVisible ? (
                <EyeOff className="size-3.5" />
              ) : (
                <Eye className="size-3.5" />
              )}
              {preferences.descriptionVisible
                ? "Hide description"
                : "Show description"}
            </button>
            {definition.removable !== false ? (
              <button
                type="button"
                className="surface-grid-action inline-flex items-center gap-2 rounded-full bg-white/[0.06] px-3 py-2 transition hover:bg-white/[0.1]"
                onClick={onHide}
              >
                <X className="size-3.5" />
                Hide widget
              </button>
            ) : null}
          </div>
          <div className="flex flex-wrap gap-2">
            {(["dense", "compact", "comfortable"] as const).map((density) => (
              <button
                key={density}
                type="button"
                className={cn(
                  "surface-grid-action rounded-full px-3 py-2 capitalize transition",
                  preferences.density === density
                    ? "bg-[var(--primary)] text-slate-950"
                    : "bg-white/[0.06] text-white/72 hover:bg-white/[0.1]"
                )}
                onClick={() => onChangeDensity(density)}
              >
                {density}
              </button>
            ))}
          </div>
        </div>
      ) : null}
      {linkedDescriptions && linkedDescriptions.length > 0 ? (
        <div className="grid gap-2 rounded-[18px] bg-white/[0.03] p-3 text-[12px] leading-5 text-white/56">
          {linkedDescriptions.map((line) => (
            <div key={line}>{line}</div>
          ))}
        </div>
      ) : null}
      <div className="min-h-0 flex-1">{children}</div>
    </Card>
  );
}

export function EditableSurface({
  surfaceId,
  widgets,
  defaultEditing = false,
  actions,
  selectedWidgetId,
  linkedDescriptionsByWidgetId,
  onWidgetHandleClick
}: {
  surfaceId: string;
  widgets: SurfaceWidgetDefinition[];
  defaultEditing?: boolean;
  actions?: ReactNode;
  selectedWidgetId?: string | null;
  linkedDescriptionsByWidgetId?: Record<string, string[]>;
  onWidgetHandleClick?: (definition: SurfaceWidgetDefinition) => void;
}) {
  const widgetLayoutSignature = useMemo(
    () =>
      JSON.stringify(
        widgets.map((widget) => ({
          id: widget.id,
          defaultWidth: widget.defaultWidth,
          defaultHeight: widget.defaultHeight,
          minWidth: widget.minWidth,
          maxWidth: widget.maxWidth,
          minHeight: widget.minHeight,
          maxHeight: widget.maxHeight,
          defaultHidden: widget.defaultHidden,
          defaultTitleVisible: widget.defaultTitleVisible,
          defaultDescriptionVisible: widget.defaultDescriptionVisible,
          defaultDensity: widget.defaultDensity,
          defaultPlacement: widget.defaultPlacement
        }))
      ),
    [widgets]
  );
  const defaults = useMemo(
    () => buildDefaultSurfaceLayoutPayload(surfaceId, widgets),
    [surfaceId, widgetLayoutSignature]
  );
  const [editing, setEditing] = useState(defaultEditing);
  const [breakpoint, setBreakpoint] = useState<SurfaceBreakpointKey>("lg");
  const [layoutPayload, setLayoutPayload] = useState<SurfaceLayoutPayload>(() =>
    mergeSurfaceLayoutPayload(
      surfaceId,
      widgets,
      readCachedSurfaceLayout(surfaceId) ?? defaults
    )
  );
  const [menuWidgetId, setMenuWidgetId] = useState<string | null>(null);
  const [containerWidth, setContainerWidth] = useState(1280);
  const saveTimerRef = useRef<number | null>(null);
  const hydrationCompleteRef = useRef(false);
  const layoutInteractionRef = useRef(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const layoutQuery = useQuery({
    queryKey: ["forge-surface-layout", surfaceId],
    queryFn: () => getSurfaceLayout(surfaceId)
  });

  const saveMutation = useMutation({
    mutationFn: (payload: SurfaceLayoutPayload) =>
      saveSurfaceLayout(surfaceId, {
        layouts: payload.layouts,
        widgets: payload.widgets
      })
  });

  const resetMutation = useMutation({
    mutationFn: () => resetSurfaceLayout(surfaceId)
  });

  useEffect(() => {
    const merged = mergeSurfaceLayoutPayload(
      surfaceId,
      widgets,
      layoutQuery.data?.layout ?? readCachedSurfaceLayout(surfaceId) ?? defaults
    );
    setLayoutPayload((current) =>
      layoutPayloadEquals(current, merged) ? current : merged
    );
    writeCachedSurfaceLayout(merged);
    hydrationCompleteRef.current = true;
  }, [defaults, layoutQuery.data?.layout, surfaceId, widgetLayoutSignature]);

  useEffect(() => {
    const element = containerRef.current;
    if (!element || typeof ResizeObserver === "undefined") {
      return;
    }
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width ?? element.clientWidth;
      setContainerWidth(Math.max(320, Math.round(width)));
    });
    observer.observe(element);
    setContainerWidth(Math.max(320, Math.round(element.clientWidth || 1280)));
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!hydrationCompleteRef.current) {
      return;
    }
    writeCachedSurfaceLayout(layoutPayload);
    if (saveTimerRef.current !== null) {
      window.clearTimeout(saveTimerRef.current);
    }
    saveTimerRef.current = window.setTimeout(() => {
      void saveMutation.mutateAsync(layoutPayload);
    }, SAVE_DEBOUNCE_MS);

    return () => {
      if (saveTimerRef.current !== null) {
        window.clearTimeout(saveTimerRef.current);
      }
    };
  }, [layoutPayload]);

  const widgetById = useMemo(
    () => new Map(widgets.map((widget) => [widget.id, widget])),
    [widgets]
  );
  const hiddenWidgets = summarizeHiddenWidgets(widgets, layoutPayload.widgets);
  const visibleWidgetIds = useMemo(
    () =>
      new Set(
        widgets
          .filter((widget) => !layoutPayload.widgets[widget.id]?.hidden)
          .map((widget) => widget.id)
      ),
    [layoutPayload.widgets, widgets]
  );
  const visibleLayouts = useMemo(
    () =>
      ({
        lg: layoutPayload.layouts.lg.filter((item) => visibleWidgetIds.has(item.i)),
        md: layoutPayload.layouts.md.filter((item) => visibleWidgetIds.has(item.i)),
        sm: layoutPayload.layouts.sm.filter((item) => visibleWidgetIds.has(item.i)),
        xs: layoutPayload.layouts.xs.filter((item) => visibleWidgetIds.has(item.i)),
        xxs: layoutPayload.layouts.xxs.filter((item) => visibleWidgetIds.has(item.i))
      }) satisfies SurfaceLayoutBreakpoints,
    [layoutPayload.layouts, visibleWidgetIds]
  );
  const orderedVisibleItems = useMemo(
    () => sortLayoutItems(visibleLayouts[breakpoint]),
    [breakpoint, visibleLayouts]
  );

  function patchWidgetPreferences(
    widgetId: string,
    patch: Partial<SurfaceWidgetPreferences>
  ) {
    setLayoutPayload((current) => ({
      ...current,
      widgets: {
        ...current.widgets,
        [widgetId]: {
          ...current.widgets[widgetId],
          ...patch
        }
      }
    }));
  }

  function handleLayoutChange(
    _currentLayout: GridLayout,
    allLayouts: Partial<GridLayoutMap>
  ) {
    if (!layoutInteractionRef.current) {
      return;
    }
    setLayoutPayload((current) => {
      const nextLayouts = fromLayouts(allLayouts, current.layouts);
      if (layoutsEqual(current.layouts, nextLayouts)) {
        return current;
      }
      return {
        ...current,
        layouts: nextLayouts
      };
    });
  }

  function handleReset() {
    const next = buildDefaultSurfaceLayoutPayload(surfaceId, widgets);
    setLayoutPayload(next);
    writeCachedSurfaceLayout(next);
    void resetMutation.mutateAsync();
  }

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex items-center gap-2 rounded-full bg-white/[0.04] px-3 py-2 text-[12px] uppercase tracking-[0.16em] text-white/48">
          <LayoutGrid className="size-3.5" />
          Surface grid
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {actions}
          {editing ? (
            <div className="text-[12px] text-white/52">
              Drag any card. Resize from edges or corners. Widget chrome is optional per card.
            </div>
          ) : null}
          <Button
            type="button"
            size="sm"
            variant={editing ? "primary" : "secondary"}
            onClick={() => setEditing((current) => !current)}
          >
            <LayoutGrid className="size-4" />
            {editing ? "Done editing" : "Edit layout"}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            onClick={handleReset}
          >
            <RotateCcw className="size-4" />
            Reset layout
          </Button>
        </div>
      </div>

      <div ref={containerRef}>
        {editing ? (
          <ResponsiveGridLayout
            width={containerWidth}
            className={cn(
              "surface-grid-layout",
              editing && "surface-grid-layout--editing"
            )}
            breakpoints={SURFACE_BREAKPOINTS}
            cols={SURFACE_COLUMNS}
            rowHeight={SURFACE_ROW_HEIGHT}
            margin={SURFACE_GRID_MARGIN}
            containerPadding={[0, 0]}
            layouts={toLayouts(visibleLayouts)}
            compactType="vertical"
            isDraggable={editing}
            isResizable={editing}
            resizeHandles={["s", "w", "e", "n", "sw", "nw", "se", "ne"]}
            draggableCancel=".surface-grid-toolbar,button,a,input,textarea,select,label,[data-no-drag='true']"
            onDragStart={() => {
              layoutInteractionRef.current = true;
            }}
            onResizeStart={() => {
              layoutInteractionRef.current = true;
            }}
            onDragStop={() => {
              layoutInteractionRef.current = false;
            }}
            onResizeStop={() => {
              layoutInteractionRef.current = false;
            }}
            onLayoutChange={handleLayoutChange}
            onBreakpointChange={(nextBreakpoint: string) =>
              setBreakpoint(nextBreakpoint as SurfaceBreakpointKey)
            }
          >
            {widgets
              .filter((widget) => visibleWidgetIds.has(widget.id))
              .map((widget) => {
                const preferences = layoutPayload.widgets[widget.id] ?? {
                  hidden: false,
                  titleVisible: true,
                  descriptionVisible: true,
                  density: "compact" as const
                };
                const size = widgetSizeForBreakpoint(
                  visibleLayouts,
                  breakpoint,
                  widget.id
                );
                const compact = isCompactWidget(size, preferences.density);
                return (
                  <div key={widget.id}>
                    <SurfaceWidgetCard
                      definition={widget}
                      preferences={preferences}
                      size={size}
                      editing={editing}
                      selected={selectedWidgetId === widget.id}
                      menuOpen={menuWidgetId === widget.id}
                      linkedDescriptions={linkedDescriptionsByWidgetId?.[widget.id]}
                      onToggleMenu={() =>
                        setMenuWidgetId((current) =>
                          current === widget.id ? null : widget.id
                        )
                      }
                      onToggleHandle={
                        onWidgetHandleClick
                          ? () => onWidgetHandleClick(widget)
                          : undefined
                      }
                      onHide={() =>
                        patchWidgetPreferences(widget.id, { hidden: true })
                      }
                      onShowTitle={() =>
                        patchWidgetPreferences(widget.id, {
                          titleVisible: !preferences.titleVisible
                        })
                      }
                      onShowDescription={() =>
                        patchWidgetPreferences(widget.id, {
                          descriptionVisible: !preferences.descriptionVisible
                        })
                      }
                      onChangeDensity={(density) =>
                        patchWidgetPreferences(widget.id, { density })
                      }
                    >
                      {widget.render({
                        compact,
                        width: size.width,
                        height: size.height,
                        editing,
                        density: preferences.density,
                        preferences
                      })}
                    </SurfaceWidgetCard>
                  </div>
                );
              })}
          </ResponsiveGridLayout>
        ) : (
          <div
            className="surface-flow-grid"
            style={{
              display: "grid",
              gap: `${SURFACE_GRID_MARGIN[1]}px ${SURFACE_GRID_MARGIN[0]}px`,
              gridTemplateColumns: `repeat(${SURFACE_COLUMNS[breakpoint]}, minmax(0, 1fr))`,
              alignItems: "start"
            }}
          >
            {orderedVisibleItems.map((item) => {
              const widget = widgetById.get(item.i);
              if (!widget) {
                return null;
              }
              const preferences = layoutPayload.widgets[widget.id] ?? {
                hidden: false,
                titleVisible: true,
                descriptionVisible: true,
                density: "compact" as const
              };
              const size = {
                width: item.w,
                height: item.h
              };
              const compact = isCompactWidget(size, preferences.density);
              return (
                <div
                  key={widget.id}
                  style={{
                    gridColumn: `span ${Math.min(item.w, SURFACE_COLUMNS[breakpoint])} / span ${Math.min(item.w, SURFACE_COLUMNS[breakpoint])}`
                  }}
                >
                  <SurfaceWidgetCard
                    definition={widget}
                    preferences={preferences}
                    size={size}
                    editing={false}
                    selected={selectedWidgetId === widget.id}
                    menuOpen={false}
                    linkedDescriptions={linkedDescriptionsByWidgetId?.[widget.id]}
                    onToggleMenu={() => undefined}
                    onToggleHandle={
                      onWidgetHandleClick
                        ? () => onWidgetHandleClick(widget)
                        : undefined
                    }
                    onHide={() => undefined}
                    onShowTitle={() => undefined}
                    onShowDescription={() => undefined}
                    onChangeDensity={() => undefined}
                  >
                    {widget.render({
                      compact,
                      width: size.width,
                      height: size.height,
                      editing: false,
                      density: preferences.density,
                      preferences
                    })}
                  </SurfaceWidgetCard>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {hiddenWidgets.length > 0 ? (
        <div className="grid gap-3 rounded-[24px] border border-white/8 bg-white/[0.03] p-4">
          <div className="text-[12px] uppercase tracking-[0.16em] text-white/40">
            Hidden widgets
          </div>
          <div className="flex flex-wrap gap-2">
            {hiddenWidgets.map((widget) => (
              <button
                key={widget.id}
                type="button"
                className="rounded-full bg-white/[0.06] px-3 py-2 text-sm text-white/76 transition hover:bg-white/[0.1] hover:text-white"
                onClick={() => patchWidgetPreferences(widget.id, { hidden: false })}
              >
                {widget.title}
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
