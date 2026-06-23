import type {
  SurfaceLayoutPayload,
  SurfaceWidgetPreferences
} from "@/lib/types";

export const SURFACE_BREAKPOINTS = {
  lg: 1280,
  md: 996,
  sm: 768,
  xs: 480,
  xxs: 0
} as const;

export const SURFACE_COLUMNS = {
  lg: 12,
  md: 10,
  sm: 6,
  xs: 4,
  xxs: 2
} as const;

export type SurfaceBreakpointKey = keyof typeof SURFACE_COLUMNS;

export type SurfaceWidgetLayoutDefinition = {
  id: string;
  defaultWidth: number;
  defaultHeight?: number;
  defaultHidden?: boolean;
  defaultTitleVisible?: boolean;
  defaultDescriptionVisible?: boolean;
  defaultDensity?: "dense" | "compact" | "comfortable";
  defaultFullWidth?: boolean;
  minWidth?: number;
  maxWidth?: number;
  minHeight?: number;
  maxHeight?: number;
  defaultPlacement?: "flow" | "top";
  autoSizeHeight?: boolean;
};

const STORAGE_PREFIX = "forge.surface-layout.v3";

function storageKey(surfaceId: string) {
  return `${STORAGE_PREFIX}.${surfaceId}`;
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(Math.max(value, minimum), maximum);
}

export function breakpointFromWidth(width: number): SurfaceBreakpointKey {
  if (width >= SURFACE_BREAKPOINTS.lg) {
    return "lg";
  }
  if (width >= SURFACE_BREAKPOINTS.md) {
    return "md";
  }
  if (width >= SURFACE_BREAKPOINTS.sm) {
    return "sm";
  }
  if (width >= SURFACE_BREAKPOINTS.xs) {
    return "xs";
  }
  return "xxs";
}

export function scaleWidgetSpan(
  widget: SurfaceWidgetLayoutDefinition,
  breakpoint: SurfaceBreakpointKey
) {
  const columns = SURFACE_COLUMNS[breakpoint];
  if (breakpoint === "lg") {
    return clamp(
      widget.defaultWidth,
      widget.minWidth ?? 1,
      Math.min(widget.maxWidth ?? columns, columns)
    );
  }
  const scaled = Math.round((widget.defaultWidth / SURFACE_COLUMNS.lg) * columns);
  return clamp(
    Math.max(widget.minWidth ?? 1, scaled || (widget.minWidth ?? 1)),
    widget.minWidth ?? 1,
    Math.min(widget.maxWidth ?? columns, columns)
  );
}

function buildDefaultWidgetPreferences(
  widget: SurfaceWidgetLayoutDefinition
): SurfaceWidgetPreferences {
  return {
    hidden: widget.defaultHidden ?? false,
    fullWidth: widget.defaultFullWidth ?? false,
    titleVisible: widget.defaultTitleVisible ?? true,
    descriptionVisible: widget.defaultDescriptionVisible ?? true
  };
}

export function buildDefaultSurfaceLayoutPayload(
  surfaceId: string,
  widgets: SurfaceWidgetLayoutDefinition[]
): SurfaceLayoutPayload {
  const orderedWidgets = [
    ...widgets.filter((widget) => widget.defaultPlacement === "top"),
    ...widgets.filter((widget) => widget.defaultPlacement !== "top")
  ];

  return {
    surfaceId,
    order: orderedWidgets.map((widget) => widget.id),
    widgets: Object.fromEntries(
      widgets.map((widget) => [widget.id, buildDefaultWidgetPreferences(widget)])
    ),
    updatedAt: new Date(0).toISOString()
  };
}

export function mergeSurfaceLayoutPayload(
  surfaceId: string,
  widgets: SurfaceWidgetLayoutDefinition[],
  payload: Partial<SurfaceLayoutPayload> | null | undefined
): SurfaceLayoutPayload {
  const defaults = buildDefaultSurfaceLayoutPayload(surfaceId, widgets);
  const widgetIds = new Set(widgets.map((widget) => widget.id));
  const savedOrder = (payload?.order ?? []).filter((id) => widgetIds.has(id));
  const defaultOrder = defaults.order.filter((id) => !savedOrder.includes(id));

  const mergedWidgets = Object.fromEntries(
    widgets.map((widget) => {
      const saved = payload?.widgets?.[widget.id];
      return [
        widget.id,
        {
          ...defaults.widgets[widget.id],
          hidden: saved?.hidden ?? defaults.widgets[widget.id]?.hidden ?? false,
          fullWidth:
            saved?.fullWidth ?? defaults.widgets[widget.id]?.fullWidth ?? false,
          titleVisible:
            saved?.titleVisible ??
            defaults.widgets[widget.id]?.titleVisible ??
            true,
          descriptionVisible:
            saved?.descriptionVisible ??
            defaults.widgets[widget.id]?.descriptionVisible ??
            true
        } satisfies SurfaceWidgetPreferences
      ];
    })
  ) as Record<string, SurfaceWidgetPreferences>;

  return {
    surfaceId,
    order: [...savedOrder, ...defaultOrder],
    widgets: mergedWidgets,
    updatedAt:
      typeof payload?.updatedAt === "string" ? payload.updatedAt : defaults.updatedAt
  };
}

export function sortWidgetsByLayoutOrder<T extends SurfaceWidgetLayoutDefinition>(
  widgets: T[],
  payload: SurfaceLayoutPayload
): T[] {
  const position = new Map(payload.order.map((id, index) => [id, index]));
  return [...widgets].sort((left, right) => {
    const leftIndex = position.get(left.id) ?? Number.MAX_SAFE_INTEGER;
    const rightIndex = position.get(right.id) ?? Number.MAX_SAFE_INTEGER;
    if (leftIndex !== rightIndex) {
      return leftIndex - rightIndex;
    }
    return left.id.localeCompare(right.id);
  });
}

export function moveItemInOrder(order: string[], itemId: string, nextIndex: number) {
  const currentIndex = order.indexOf(itemId);
  if (currentIndex === -1) {
    return order;
  }
  const boundedIndex = clamp(nextIndex, 0, order.length - 1);
  if (currentIndex === boundedIndex) {
    return order;
  }
  const next = [...order];
  next.splice(currentIndex, 1);
  next.splice(boundedIndex, 0, itemId);
  return next;
}

export function readCachedSurfaceLayout(surfaceId: string) {
  if (typeof window === "undefined") {
    return null;
  }
  try {
    const raw = window.localStorage.getItem(storageKey(surfaceId));
    return raw ? (JSON.parse(raw) as SurfaceLayoutPayload) : null;
  } catch {
    return null;
  }
}

export function writeCachedSurfaceLayout(payload: SurfaceLayoutPayload) {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.localStorage.setItem(storageKey(payload.surfaceId), JSON.stringify(payload));
  } catch {
    // Ignore local persistence failures in the browser shell.
  }
}
