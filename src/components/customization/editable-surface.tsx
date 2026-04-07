import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  closestCenter,
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  rectSortingStrategy,
  useSortable
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  GripVertical,
  LayoutGrid,
  Minus,
  Plus,
  RotateCcw,
  Share2,
  Settings2,
  X
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  mergeSurfaceLayout,
  readSurfaceLayout,
  writeSurfaceLayout,
  type SurfaceLayoutItem
} from "@/lib/surface-layout";
import { cn } from "@/lib/utils";

export type SurfaceWidgetDefinition = {
  id: string;
  title: string;
  description?: string;
  isProcessor?: boolean;
  processorCapability?: {
    label: string;
    mode: "content" | "tool" | "mcp" | "processor";
    metadata?: Record<string, unknown>;
  };
  defaultWidth: number;
  defaultHeight: number;
  defaultHidden?: boolean;
  minWidth?: number;
  maxWidth?: number;
  minHeight?: number;
  maxHeight?: number;
  removable?: boolean;
  render: (context: {
    compact: boolean;
    width: number;
    height: number;
    editing: boolean;
  }) => ReactNode;
};

function useResponsiveColumns() {
  const [columns, setColumns] = useState(() => {
    if (typeof window === "undefined") {
      return 12;
    }
    if (window.innerWidth < 640) {
      return 2;
    }
    if (window.innerWidth < 1024) {
      return 6;
    }
    return 12;
  });

  useEffect(() => {
    const update = () => {
      if (window.innerWidth < 640) {
        setColumns(2);
        return;
      }
      if (window.innerWidth < 1024) {
        setColumns(6);
        return;
      }
      setColumns(12);
    };

    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  return columns;
}

function SortableWidget({
  definition,
  item,
  editing,
  columns,
  onResize,
  onHide,
  onHandleClick,
  selected,
  linkedDescriptions,
  children
}: {
  definition: SurfaceWidgetDefinition;
  item: SurfaceLayoutItem;
  editing: boolean;
  columns: number;
  onResize: (
    id: string,
    patch: Partial<Pick<SurfaceLayoutItem, "width" | "height">>
  ) => void;
  onHide: (id: string) => void;
  onHandleClick?: (definition: SurfaceWidgetDefinition) => void;
  selected?: boolean;
  linkedDescriptions?: string[];
  children: ReactNode;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging
  } = useSortable({
    id: item.id,
    disabled: !editing
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    gridColumn: `span ${Math.min(item.width, columns)} / span ${Math.min(item.width, columns)}`,
    minHeight: `${Math.max(10, item.height * 8)}rem`
  };

  const compact = item.width <= Math.min(4, columns) || item.height <= 1;
  const canHide = definition.removable !== false;

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn("min-w-0", isDragging && "z-20 opacity-90")}
    >
      <Card
        className={cn(
          "flex h-full min-w-0 flex-col gap-3 overflow-hidden p-4",
          selected && "ring-1 ring-[var(--primary)]/50"
        )}
      >
        <div className="flex min-w-0 items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="truncate text-[0.72rem] font-semibold uppercase tracking-[0.16em] text-white/38">
              {definition.title}
            </div>
            {definition.description && !compact ? (
              <div className="mt-1 text-[12px] leading-5 text-white/50">
                {definition.description}
              </div>
            ) : null}
          </div>
          {editing ? (
            <div className="flex shrink-0 items-center gap-1">
              {onHandleClick ? (
                <button
                  type="button"
                  className={cn(
                    "inline-flex size-8 items-center justify-center rounded-full bg-white/[0.05] text-white/58 transition hover:bg-white/[0.08] hover:text-white",
                    selected && "bg-[var(--primary)]/[0.16] text-[var(--primary)]"
                  )}
                  onClick={() => onHandleClick(definition)}
                  aria-label={`Connect ${definition.title}`}
                >
                  <Share2 className="size-3.5" />
                </button>
              ) : null}
              <button
                type="button"
                className="inline-flex size-8 items-center justify-center rounded-full bg-white/[0.05] text-white/58 transition hover:bg-white/[0.08] hover:text-white"
                onClick={() =>
                  onResize(item.id, {
                    width: Math.max(definition.minWidth ?? 2, item.width - 1)
                  })
                }
                aria-label={`Shrink ${definition.title}`}
              >
                <Minus className="size-3.5" />
              </button>
              <button
                type="button"
                className="inline-flex size-8 items-center justify-center rounded-full bg-white/[0.05] text-white/58 transition hover:bg-white/[0.08] hover:text-white"
                onClick={() =>
                  onResize(item.id, {
                    width: Math.min(definition.maxWidth ?? 12, item.width + 1)
                  })
                }
                aria-label={`Grow ${definition.title}`}
              >
                <Plus className="size-3.5" />
              </button>
              <button
                type="button"
                className="inline-flex size-8 items-center justify-center rounded-full bg-white/[0.05] text-white/58 transition hover:bg-white/[0.08] hover:text-white"
                onClick={() =>
                  onResize(item.id, {
                    height: Math.max(definition.minHeight ?? 1, item.height - 1)
                  })
                }
                aria-label={`Reduce height for ${definition.title}`}
              >
                <Minus className="size-3.5 rotate-90" />
              </button>
              <button
                type="button"
                className="inline-flex size-8 items-center justify-center rounded-full bg-white/[0.05] text-white/58 transition hover:bg-white/[0.08] hover:text-white"
                onClick={() =>
                  onResize(item.id, {
                    height: Math.min(definition.maxHeight ?? 6, item.height + 1)
                  })
                }
                aria-label={`Increase height for ${definition.title}`}
              >
                <Plus className="size-3.5 rotate-90" />
              </button>
              {canHide ? (
                <button
                  type="button"
                  className="inline-flex size-8 items-center justify-center rounded-full bg-white/[0.05] text-white/58 transition hover:bg-white/[0.08] hover:text-white"
                  onClick={() => onHide(item.id)}
                  aria-label={`Hide ${definition.title}`}
                >
                  <X className="size-3.5" />
                </button>
              ) : null}
              <button
                type="button"
                className="inline-flex size-8 cursor-grab items-center justify-center rounded-full bg-white/[0.05] text-white/58 transition hover:bg-white/[0.08] hover:text-white active:cursor-grabbing"
                aria-label={`Move ${definition.title}`}
                {...attributes}
                {...listeners}
              >
                <GripVertical className="size-3.5" />
              </button>
            </div>
          ) : null}
        </div>
        {linkedDescriptions && linkedDescriptions.length > 0 ? (
          <div className="grid gap-2 rounded-[18px] bg-white/[0.03] p-3 text-[12px] leading-5 text-white/56">
            {linkedDescriptions.map((line) => (
              <div key={line}>{line}</div>
            ))}
          </div>
        ) : null}
        <div className="min-h-0 flex-1">{children}</div>
      </Card>
    </div>
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
  const columns = useResponsiveColumns();
  const defaults = useMemo<SurfaceLayoutItem[]>(
    () =>
      widgets.map((widget) => ({
        id: widget.id,
        width: widget.defaultWidth,
        height: widget.defaultHeight,
        hidden: widget.defaultHidden ?? false
      })),
    [widgets]
  );
  const [editing, setEditing] = useState(defaultEditing);
  const [layout, setLayout] = useState<SurfaceLayoutItem[]>(() =>
    readSurfaceLayout(surfaceId, defaults)
  );
  const hydratedRef = useRef(false);

  useEffect(() => {
    setLayout((current) => mergeSurfaceLayout(current, defaults));
  }, [defaults]);

  useEffect(() => {
    if (!hydratedRef.current) {
      hydratedRef.current = true;
      return;
    }
    writeSurfaceLayout(surfaceId, layout);
  }, [layout, surfaceId]);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 8 }
    })
  );

  const visibleLayout = layout.filter((item) => !item.hidden);
  const hiddenLayout = layout.filter((item) => item.hidden);
  const widgetMap = new Map(widgets.map((widget) => [widget.id, widget]));

  function updateItem(
    id: string,
    patch: Partial<Pick<SurfaceLayoutItem, "width" | "height" | "hidden">>
  ) {
    setLayout((current) =>
      current.map((item) =>
        item.id === id
          ? {
              ...item,
              ...patch
            }
          : item
      )
    );
  }

  function resetLayout() {
    setLayout(defaults);
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) {
      return;
    }

    setLayout((current) => {
      const visible = current.filter((item) => !item.hidden);
      const hidden = current.filter((item) => item.hidden);
      const oldIndex = visible.findIndex((item) => item.id === active.id);
      const newIndex = visible.findIndex((item) => item.id === over.id);
      if (oldIndex === -1 || newIndex === -1) {
        return current;
      }
      return [...arrayMove(visible, oldIndex, newIndex), ...hidden];
    });
  }

  return (
    <section className="grid min-w-0 gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant={editing ? "primary" : "secondary"}
            size="sm"
            onClick={() => setEditing((current) => !current)}
          >
            <Settings2 className="size-4" />
            {editing ? "Done editing" : "Edit layout"}
          </Button>
          {editing ? (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={resetLayout}
            >
              <RotateCcw className="size-4" />
              Reset
            </Button>
          ) : null}
        </div>
        {actions}
      </div>

      {editing ? (
        <div className="rounded-[22px] border border-dashed border-white/10 bg-white/[0.03] p-3 text-[12px] leading-5 text-white/52">
          Drag cards to reorder them. Use the width and height controls to make
          a card denser or more spacious. Hidden widgets stay available below as
          empty slots you can add back later.
        </div>
      ) : null}

      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleDragEnd}
      >
        <SortableContext
          items={visibleLayout.map((item) => item.id)}
          strategy={rectSortingStrategy}
        >
          <div
            className="grid min-w-0 gap-4"
            style={{
              gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`
            }}
          >
            {visibleLayout.map((item) => {
              const definition = widgetMap.get(item.id);
              if (!definition) {
                return null;
              }
              return (
                <SortableWidget
                  key={item.id}
                  definition={definition}
                  item={item}
                  editing={editing}
                  columns={columns}
                  onResize={updateItem}
                  onHide={(id) => updateItem(id, { hidden: true })}
                  onHandleClick={onWidgetHandleClick}
                  selected={selectedWidgetId === item.id}
                  linkedDescriptions={linkedDescriptionsByWidgetId?.[item.id]}
                >
                  {definition.render({
                    compact:
                      item.width <= Math.min(4, columns) || item.height <= 1,
                    width: item.width,
                    height: item.height,
                    editing
                  })}
                </SortableWidget>
              );
            })}
          </div>
        </SortableContext>
      </DndContext>

      {editing && hiddenLayout.length > 0 ? (
        <div className="grid gap-3 rounded-[24px] border border-white/8 bg-white/[0.03] p-4">
          <div className="flex items-center gap-2 text-[0.72rem] font-semibold uppercase tracking-[0.16em] text-white/38">
            <LayoutGrid className="size-4" />
            Empty slots
          </div>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {hiddenLayout.map((item) => {
              const definition = widgetMap.get(item.id);
              if (!definition) {
                return null;
              }
              return (
                <button
                  key={item.id}
                  type="button"
                  className="flex min-w-0 items-start justify-between gap-3 rounded-[22px] border border-dashed border-white/12 bg-[rgba(12,18,31,0.7)] px-4 py-4 text-left transition hover:border-[rgba(192,193,255,0.3)] hover:bg-white/[0.05]"
                  onClick={() => updateItem(item.id, { hidden: false })}
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold text-white">
                      {definition.title}
                    </span>
                    {definition.description ? (
                      <span className="mt-1 block text-[12px] leading-5 text-white/52">
                        {definition.description}
                      </span>
                    ) : null}
                  </span>
                  <Plus className="mt-0.5 size-4 shrink-0 text-[var(--primary)]" />
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
    </section>
  );
}
