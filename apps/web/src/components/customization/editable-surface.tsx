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
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  ArrowDown,
  ArrowUp,
  EyeOff,
  GripVertical,
  LayoutGrid,
  Maximize2,
  Minimize2,
  RotateCcw
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode
} from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { WorkbenchBox } from "@/components/workbench/workbench-box";
import {
  getSurfaceLayout,
  resetSurfaceLayout,
  saveSurfaceLayout
} from "@/lib/api";
import {
  SURFACE_COLUMNS,
  breakpointFromWidth,
  buildDefaultSurfaceLayoutPayload,
  buildSurfaceWidgetLayoutDefaults,
  mergeSurfaceLayoutPayload,
  moveItemInOrder,
  readCachedSurfaceLayout,
  scaleWidgetSpan,
  sortWidgetsByLayoutOrder,
  writeCachedSurfaceLayout,
  type SurfaceBreakpointKey,
  type SurfaceWidgetLayoutDefinition
} from "@/lib/surface-layout";
import type {
  SurfaceLayoutPayload,
  SurfaceWidgetPreferences
} from "@/lib/types";
import { cn } from "@/lib/utils";

const SAVE_DEBOUNCE_MS = 500;

export type SurfaceWidgetDefinition = SurfaceWidgetLayoutDefinition & {
  title: string;
  description?: string;
  removable?: boolean;
  surfaceChrome?: "default" | "none";
  workbenchBoxId?: string;
  processorCapability?: {
    label: string;
    mode: "content" | "tool" | "mcp" | "processor";
    metadata?: Record<string, unknown>;
  };
  render: (context: {
    compact: boolean;
    width: number;
    editing: boolean;
    preferences: SurfaceWidgetPreferences;
  }) => ReactNode;
};

function layoutPayloadEquals(
  left: SurfaceLayoutPayload,
  right: SurfaceLayoutPayload
) {
  return (
    left.surfaceId === right.surfaceId &&
    JSON.stringify(left.order) === JSON.stringify(right.order) &&
    JSON.stringify(left.widgets) === JSON.stringify(right.widgets)
  );
}

function SurfaceWidgetCard({
  definition,
  preferences,
  editing,
  width,
  children
}: {
  definition: SurfaceWidgetDefinition;
  preferences: SurfaceWidgetPreferences;
  editing: boolean;
  width: number;
  children: ReactNode;
}) {
  const compact = width <= 4;

  if (definition.surfaceChrome === "none") {
    return (
      <div
        data-surface-card="true"
        className={cn(
          "min-w-0",
          editing && "rounded-[28px] ring-1 ring-[var(--ui-border-subtle)] ring-inset"
        )}
      >
        {children}
      </div>
    );
  }

  return (
    <Card
      data-surface-card="true"
      className={cn(
        "surface-grid-card flex min-w-0 flex-col gap-3 overflow-visible p-4 md:p-5",
        editing && "ring-1 ring-[var(--ui-border-subtle)]"
      )}
    >
      {preferences.titleVisible ||
      (preferences.descriptionVisible && definition.description) ? (
        <div className="min-w-0">
          {preferences.titleVisible ? (
            <div className="truncate text-[0.72rem] font-semibold uppercase tracking-[0.16em] text-[var(--ui-ink-faint)]">
              {definition.title}
            </div>
          ) : null}
          {preferences.descriptionVisible &&
          definition.description &&
          !compact ? (
            <div className="mt-1 text-[12px] leading-5 text-[var(--ui-ink-soft)]">
              {definition.description}
            </div>
          ) : null}
        </div>
      ) : null}
      <div className="min-h-0 flex-1">{children}</div>
    </Card>
  );
}

function ArrangementItem({
  widget,
  preferences,
  index,
  total,
  onMove,
  onToggleHidden,
  onToggleFullWidth
}: {
  widget: SurfaceWidgetDefinition;
  preferences: SurfaceWidgetPreferences;
  index: number;
  total: number;
  onMove: (nextIndex: number) => void;
  onToggleHidden: () => void;
  onToggleFullWidth: () => void;
}) {
  const sortable = useSortable({ id: widget.id });
  return (
    <div
      ref={sortable.setNodeRef}
      style={{
        transform: CSS.Transform.toString(sortable.transform),
        transition: sortable.transition
      }}
      className="flex min-w-0 items-center gap-2 rounded-[18px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] px-3 py-2.5"
    >
      <button
        type="button"
        className="inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-[var(--ui-surface-2)] text-[var(--ui-ink-soft)] transition hover:bg-[var(--ui-surface-hover)] hover:text-[var(--ui-ink-strong)]"
        aria-label={`Drag ${widget.title}`}
        {...sortable.attributes}
        {...sortable.listeners}
      >
        <GripVertical className="size-4" />
      </button>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium text-[var(--ui-ink-strong)]">
          {widget.title}
        </div>
        {widget.description ? (
          <div className="truncate text-[12px] text-[var(--ui-ink-faint)]">
            {widget.description}
          </div>
        ) : null}
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <button
          type="button"
          className="inline-flex size-8 items-center justify-center rounded-full bg-[var(--ui-surface-2)] text-[var(--ui-ink-soft)] transition hover:bg-[var(--ui-surface-hover)] hover:text-[var(--ui-ink-strong)] disabled:opacity-40"
          onClick={() => onMove(index - 1)}
          disabled={index === 0}
          aria-label={`Move ${widget.title} up`}
        >
          <ArrowUp className="size-3.5" />
        </button>
        <button
          type="button"
          className="inline-flex size-8 items-center justify-center rounded-full bg-[var(--ui-surface-2)] text-[var(--ui-ink-soft)] transition hover:bg-[var(--ui-surface-hover)] hover:text-[var(--ui-ink-strong)] disabled:opacity-40"
          onClick={() => onMove(index + 1)}
          disabled={index === total - 1}
          aria-label={`Move ${widget.title} down`}
        >
          <ArrowDown className="size-3.5" />
        </button>
        <button
          type="button"
          className={cn(
            "inline-flex h-8 items-center gap-2 rounded-full px-3 text-[12px] transition",
            preferences.fullWidth
              ? "bg-[var(--primary)] text-[var(--ui-ink-on-accent)]"
              : "bg-[var(--ui-surface-2)] text-[var(--ui-ink-medium)] hover:bg-[var(--ui-surface-hover)] hover:text-[var(--ui-ink-strong)]"
          )}
          onClick={onToggleFullWidth}
        >
          {preferences.fullWidth ? (
            <Minimize2 className="size-3.5" />
          ) : (
            <Maximize2 className="size-3.5" />
          )}
          {preferences.fullWidth ? "Normal width" : "Full width"}
        </button>
        {widget.removable !== false ? (
          <button
            type="button"
            className="inline-flex h-8 items-center gap-2 rounded-full bg-[var(--ui-surface-2)] px-3 text-[12px] text-[var(--ui-ink-medium)] transition hover:bg-[var(--ui-surface-hover)] hover:text-[var(--ui-ink-strong)]"
            onClick={onToggleHidden}
          >
            <EyeOff className="size-3.5" />
            Hide
          </button>
        ) : null}
      </div>
    </div>
  );
}

export function EditableSurface({
  surfaceId,
  widgets,
  defaultEditing = false,
  actions,
  normalizeLayout
}: {
  surfaceId: string;
  widgets: SurfaceWidgetDefinition[];
  defaultEditing?: boolean;
  actions?: ReactNode;
  normalizeLayout?: (layout: SurfaceLayoutPayload) => SurfaceLayoutPayload;
}) {
  const nextLayoutDefaultWidgets = buildSurfaceWidgetLayoutDefaults(widgets);
  const layoutDefaultsSignature = JSON.stringify(nextLayoutDefaultWidgets);
  const stableLayoutDefaultsRef = useRef({
    signature: layoutDefaultsSignature,
    widgets: nextLayoutDefaultWidgets
  });
  if (stableLayoutDefaultsRef.current.signature !== layoutDefaultsSignature) {
    stableLayoutDefaultsRef.current = {
      signature: layoutDefaultsSignature,
      widgets: nextLayoutDefaultWidgets
    };
  }
  const layoutDefaultWidgets = stableLayoutDefaultsRef.current.widgets;
  const defaults = useMemo(() => {
    const payload = buildDefaultSurfaceLayoutPayload(
      surfaceId,
      layoutDefaultWidgets
    );
    return normalizeLayout ? normalizeLayout(payload) : payload;
  }, [layoutDefaultWidgets, normalizeLayout, surfaceId]);
  const normalizePayload = useCallback(
    (payload: SurfaceLayoutPayload) =>
      normalizeLayout ? normalizeLayout(payload) : payload,
    [normalizeLayout]
  );
  const [editing, setEditing] = useState(defaultEditing);
  const [containerWidth, setContainerWidth] = useState(1280);
  const [layoutPayload, setLayoutPayload] = useState<SurfaceLayoutPayload>(() =>
    normalizePayload(
      mergeSurfaceLayoutPayload(
        surfaceId,
        layoutDefaultWidgets,
        readCachedSurfaceLayout(surfaceId) ?? defaults
      )
    )
  );
  const saveTimerRef = useRef<number | null>(null);
  const hydrationCompleteRef = useRef(false);
  const lastPersistedLayoutRef = useRef<SurfaceLayoutPayload>(
    normalizePayload(
      mergeSurfaceLayoutPayload(
        surfaceId,
        layoutDefaultWidgets,
        readCachedSurfaceLayout(surfaceId) ?? defaults
      )
    )
  );
  const containerRef = useRef<HTMLDivElement | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 6
      }
    })
  );

  const layoutQuery = useQuery({
    queryKey: ["forge-surface-layout", surfaceId],
    queryFn: () => getSurfaceLayout(surfaceId)
  });
  const remoteSurfaceLayout = layoutQuery?.data?.layout;

  const saveMutation = useMutation({
    mutationFn: (payload: SurfaceLayoutPayload) =>
      saveSurfaceLayout(surfaceId, {
        order: payload.order,
        widgets: payload.widgets
      })
  });

  const resetMutation = useMutation({
    mutationFn: () => resetSurfaceLayout(surfaceId)
  });

  useEffect(() => {
    const merged = normalizePayload(
      mergeSurfaceLayoutPayload(
        surfaceId,
        layoutDefaultWidgets,
        remoteSurfaceLayout ??
          readCachedSurfaceLayout(surfaceId) ??
          defaults
      )
    );
    setLayoutPayload((current) =>
      layoutPayloadEquals(current, merged) ? current : merged
    );
    writeCachedSurfaceLayout(merged);
    lastPersistedLayoutRef.current = merged;
    hydrationCompleteRef.current = true;
  }, [
    defaults,
    layoutDefaultWidgets,
    remoteSurfaceLayout,
    normalizePayload,
    surfaceId
  ]);

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
    if (layoutPayloadEquals(layoutPayload, lastPersistedLayoutRef.current)) {
      return;
    }
    writeCachedSurfaceLayout(layoutPayload);
    if (saveTimerRef.current !== null) {
      window.clearTimeout(saveTimerRef.current);
    }
    saveTimerRef.current = window.setTimeout(() => {
      const payloadToSave = layoutPayload;
      void saveMutation.mutateAsync(payloadToSave).then(() => {
        lastPersistedLayoutRef.current = payloadToSave;
      });
    }, SAVE_DEBOUNCE_MS);

    return () => {
      if (saveTimerRef.current !== null) {
        window.clearTimeout(saveTimerRef.current);
      }
    };
  }, [layoutPayload, saveMutation, surfaceId]);

  const breakpoint: SurfaceBreakpointKey = breakpointFromWidth(containerWidth);
  const columns = SURFACE_COLUMNS[breakpoint];
  const orderedWidgets = useMemo(
    () => sortWidgetsByLayoutOrder(widgets, layoutPayload),
    [layoutPayload, widgets]
  );
  const visibleWidgets = orderedWidgets.filter(
    (widget) => !layoutPayload.widgets[widget.id]?.hidden
  );
  const hiddenWidgets = orderedWidgets.filter(
    (widget) => layoutPayload.widgets[widget.id]?.hidden
  );

  function patchWidgetPreferences(
    widgetId: string,
    patch: Partial<SurfaceWidgetPreferences>
  ) {
    setLayoutPayload((current) =>
      normalizePayload({
        ...current,
        widgets: {
          ...current.widgets,
          [widgetId]: {
            ...current.widgets[widgetId],
            ...patch
          }
        }
      })
    );
  }

  function moveWidget(widgetId: string, nextIndex: number) {
    setLayoutPayload((current) =>
      normalizePayload({
        ...current,
        order: moveItemInOrder(current.order, widgetId, nextIndex)
      })
    );
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) {
      return;
    }
    setLayoutPayload((current) => {
      const oldIndex = current.order.indexOf(String(active.id));
      const newIndex = current.order.indexOf(String(over.id));
      if (oldIndex === -1 || newIndex === -1) {
        return current;
      }
      return normalizePayload({
        ...current,
        order: arrayMove(current.order, oldIndex, newIndex)
      });
    });
  }

  function handleReset() {
    const next = normalizePayload(
      buildDefaultSurfaceLayoutPayload(surfaceId, layoutDefaultWidgets)
    );
    setLayoutPayload(next);
    writeCachedSurfaceLayout(next);
    lastPersistedLayoutRef.current = next;
    void resetMutation.mutateAsync();
  }

  return (
    <div className="grid gap-4">
      {editing ? (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <div className="grid gap-3 rounded-[24px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] p-4">
            <div className="text-[12px] uppercase tracking-[0.16em] text-[var(--ui-ink-faint)]">
              Visible boxes
            </div>
            <SortableContext
              items={visibleWidgets.map((widget) => widget.id)}
              strategy={verticalListSortingStrategy}
            >
              <div className="grid gap-2">
                {visibleWidgets.map((widget, index) => {
                  const preferences = layoutPayload.widgets[widget.id] ?? {
                    hidden: false,
                    fullWidth: false,
                    titleVisible: true,
                    descriptionVisible: true
                  };
                  return (
                    <ArrangementItem
                      key={widget.id}
                      widget={widget}
                      preferences={preferences}
                      index={index}
                      total={visibleWidgets.length}
                      onMove={(nextIndex) => moveWidget(widget.id, nextIndex)}
                      onToggleHidden={() =>
                        patchWidgetPreferences(widget.id, { hidden: true })
                      }
                      onToggleFullWidth={() =>
                        patchWidgetPreferences(widget.id, {
                          fullWidth: !preferences.fullWidth
                        })
                      }
                    />
                  );
                })}
              </div>
            </SortableContext>
            {hiddenWidgets.length > 0 ? (
              <>
                <div className="pt-2 text-[12px] uppercase tracking-[0.16em] text-[var(--ui-ink-faint)]">
                  Hidden boxes
                </div>
                <div className="flex flex-wrap gap-2">
                  {hiddenWidgets.map((widget) => (
                    <button
                      key={widget.id}
                      type="button"
                      className="rounded-full bg-[var(--ui-surface-2)] px-3 py-2 text-sm text-[var(--ui-ink-medium)] transition hover:bg-[var(--ui-surface-hover)] hover:text-[var(--ui-ink-strong)]"
                      onClick={() =>
                        patchWidgetPreferences(widget.id, { hidden: false })
                      }
                    >
                      {widget.title}
                    </button>
                  ))}
                </div>
              </>
            ) : null}
          </div>
        </DndContext>
      ) : null}

      <div ref={containerRef} className="relative">
        <div className="pointer-events-none absolute top-3 right-3 z-20 flex max-w-[calc(100%-1.5rem)] flex-wrap items-center justify-end gap-1.5">
          <div className="pointer-events-auto flex flex-wrap items-center justify-end gap-1.5">
            {actions}
            {editing ? (
              <Button
                type="button"
                size="sm"
                variant="secondary"
                aria-label="Reset surface layout"
                title="Reset layout"
                className="h-8 rounded-full border-[var(--ui-border-subtle)] bg-[var(--surface-glass)] px-2.5 text-[12px] text-[var(--ui-ink-medium)] backdrop-blur-xl hover:bg-[var(--ui-surface-hover)] hover:text-[var(--ui-ink-strong)]"
                onClick={handleReset}
              >
                <RotateCcw className="size-3.5" />
                <span className="hidden sm:inline">Reset</span>
              </Button>
            ) : null}
            <Button
              type="button"
              size="sm"
              variant={editing ? "primary" : "secondary"}
              aria-label={
                editing ? "Finish editing surface layout" : "Edit surface layout"
              }
              title={editing ? "Done" : "Edit layout"}
              className={cn(
                "h-8 rounded-full px-2 text-[12px] backdrop-blur-xl [&>span]:gap-1.5",
                editing
                  ? "bg-[var(--primary)] text-[var(--ui-ink-on-accent)] hover:opacity-95"
                  : "border-[var(--ui-border-subtle)] bg-[var(--surface-glass)] text-[var(--ui-ink-medium)] hover:bg-[var(--ui-surface-hover)] hover:text-[var(--ui-ink-strong)]"
              )}
              onClick={() => setEditing((current) => !current)}
            >
              <LayoutGrid className="size-3.5" />
              <span className="hidden xl:inline">
                {editing ? "Done" : "Layout"}
              </span>
            </Button>
          </div>
        </div>
        <div
          className="surface-flow-grid"
          style={{
            display: "grid",
            gap: "16px",
            gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
            alignItems: "start"
          }}
        >
          {visibleWidgets.map((widget) => {
            const preferences = layoutPayload.widgets[widget.id] ?? {
              hidden: false,
              fullWidth: false,
              titleVisible: true,
              descriptionVisible: true
            };
            const width = preferences.fullWidth
              ? columns
              : Math.min(scaleWidgetSpan(widget, breakpoint), columns);
            return (
              <div
                key={widget.id}
                style={{
                  gridColumn: `span ${width} / span ${width}`
                }}
              >
                <SurfaceWidgetCard
                  definition={widget}
                  preferences={preferences}
                  editing={editing}
                  width={width}
                >
                  <WorkbenchBox
                    boxId={
                      widget.workbenchBoxId ??
                      `surface:${surfaceId}:${widget.id}`
                    }
                    surfaceId={surfaceId}
                  >
                    {widget.render({
                      compact: width <= 4,
                      width,
                      editing,
                      preferences
                    })}
                  </WorkbenchBox>
                </SurfaceWidgetCard>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
