import type {
  SurfaceLayoutBreakpointItem,
  SurfaceLayoutBreakpoints,
  SurfaceLayoutPayload,
  SurfaceWidgetDensity,
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

export const SURFACE_ROW_HEIGHT = 72;
export const SURFACE_GRID_MARGIN = [16, 16] as const;

export type SurfaceBreakpointKey = keyof typeof SURFACE_COLUMNS;

export type SurfaceWidgetLayoutDefinition = {
  id: string;
  defaultWidth: number;
  defaultHeight: number;
  defaultHidden?: boolean;
  defaultTitleVisible?: boolean;
  defaultDescriptionVisible?: boolean;
  defaultDensity?: SurfaceWidgetDensity;
  minWidth?: number;
  maxWidth?: number;
  minHeight?: number;
  maxHeight?: number;
  defaultPlacement?: "flow" | "top";
  autoSizeHeight?: boolean;
};

const STORAGE_PREFIX = "forge.surface-layout.v2";

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(Math.max(value, minimum), maximum);
}

function sanitizeItem(
  item: Partial<SurfaceLayoutBreakpointItem> | null | undefined,
  columns: number
): SurfaceLayoutBreakpointItem | null {
  if (!item || typeof item.i !== "string" || item.i.trim().length === 0) {
    return null;
  }

  return {
    i: item.i,
    x: clamp(Number(item.x) || 0, 0, Math.max(0, columns - 1)),
    y: Math.max(0, Number(item.y) || 0),
    w: clamp(Number(item.w) || 1, 1, columns),
    h: clamp(Number(item.h) || 2, 1, 24),
    minW:
      typeof item.minW === "number" ? clamp(item.minW, 1, columns) : undefined,
    maxW:
      typeof item.maxW === "number" ? clamp(item.maxW, 1, columns) : undefined,
    minH:
      typeof item.minH === "number" ? clamp(item.minH, 1, 24) : undefined,
    maxH:
      typeof item.maxH === "number" ? clamp(item.maxH, 1, 24) : undefined
  };
}

function sanitizeWidgets(
  widgets: Record<string, Partial<SurfaceWidgetPreferences>> | null | undefined
) {
  const output: Record<string, SurfaceWidgetPreferences> = {};
  if (!widgets) {
    return output;
  }
  for (const [widgetId, value] of Object.entries(widgets)) {
    output[widgetId] = {
      hidden: Boolean(value?.hidden),
      titleVisible: value?.titleVisible ?? true,
      descriptionVisible: value?.descriptionVisible ?? true,
      density: value?.density ?? "compact"
    };
  }
  return output;
}

function storageKey(surfaceId: string) {
  return `${STORAGE_PREFIX}.${surfaceId}`;
}

function scaleWidth(
  width: number,
  minWidth: number,
  maxWidth: number,
  breakpoint: SurfaceBreakpointKey
) {
  const columns = SURFACE_COLUMNS[breakpoint];
  if (breakpoint === "lg") {
    return clamp(width, minWidth, Math.min(maxWidth, columns));
  }
  const scaled = Math.round((width / SURFACE_COLUMNS.lg) * columns);
  return clamp(Math.max(minWidth, scaled || minWidth), minWidth, Math.min(maxWidth, columns));
}

function buildDefaultBreakpointLayout(
  widgets: SurfaceWidgetLayoutDefinition[],
  breakpoint: SurfaceBreakpointKey
) {
  const columns = SURFACE_COLUMNS[breakpoint];
  const orderedWidgets = [
    ...widgets.filter((widget) => widget.defaultPlacement === "top"),
    ...widgets.filter((widget) => widget.defaultPlacement !== "top")
  ];
  const layout: SurfaceLayoutBreakpointItem[] = [];
  let cursorX = 0;
  let cursorY = 0;
  let rowHeight = 0;

  for (const widget of orderedWidgets) {
    const minWidth = widget.minWidth ?? 1;
    const maxWidth = widget.maxWidth ?? columns;
    const minHeight = widget.minHeight ?? 1;
    const maxHeight = widget.maxHeight ?? 24;
    const width = scaleWidth(widget.defaultWidth, minWidth, maxWidth, breakpoint);
    const height = clamp(widget.defaultHeight, minHeight, maxHeight);

    if (cursorX + width > columns) {
      cursorX = 0;
      cursorY += rowHeight;
      rowHeight = 0;
    }

    layout.push({
      i: widget.id,
      x: cursorX,
      y: cursorY,
      w: width,
      h: height,
      minW: minWidth,
      maxW: Math.min(maxWidth, columns),
      minH: minHeight,
      maxH: maxHeight
    });

    cursorX += width;
    rowHeight = Math.max(rowHeight, height);
    if (cursorX >= columns) {
      cursorX = 0;
      cursorY += rowHeight;
      rowHeight = 0;
    }
  }

  return layout;
}

export function buildDefaultSurfaceLayoutPayload(
  surfaceId: string,
  widgets: SurfaceWidgetLayoutDefinition[]
): SurfaceLayoutPayload {
  return {
    surfaceId,
    layouts: {
      lg: buildDefaultBreakpointLayout(widgets, "lg"),
      md: buildDefaultBreakpointLayout(widgets, "md"),
      sm: buildDefaultBreakpointLayout(widgets, "sm"),
      xs: buildDefaultBreakpointLayout(widgets, "xs"),
      xxs: buildDefaultBreakpointLayout(widgets, "xxs")
    },
    widgets: Object.fromEntries(
      widgets.map((widget) => [
        widget.id,
        {
          hidden: widget.defaultHidden ?? false,
          titleVisible: widget.defaultTitleVisible ?? true,
          descriptionVisible: widget.defaultDescriptionVisible ?? true,
          density: widget.defaultDensity ?? "compact"
        }
      ])
    ),
    updatedAt: new Date(0).toISOString()
  };
}

function bottomOfLayout(layout: SurfaceLayoutBreakpointItem[]) {
  return layout.reduce((max, item) => Math.max(max, item.y + item.h), 0);
}

function appendLayoutItems(
  existing: SurfaceLayoutBreakpointItem[],
  appended: SurfaceLayoutBreakpointItem[],
  breakpoint: SurfaceBreakpointKey
) {
  if (appended.length === 0) {
    return existing;
  }
  const columns = SURFACE_COLUMNS[breakpoint];
  const next = [...existing];
  let cursorX = 0;
  let cursorY = bottomOfLayout(existing);
  let rowHeight = 0;

  for (const item of appended) {
    if (cursorX + item.w > columns) {
      cursorX = 0;
      cursorY += rowHeight;
      rowHeight = 0;
    }
    next.push({
      ...item,
      x: cursorX,
      y: cursorY
    });
    cursorX += item.w;
    rowHeight = Math.max(rowHeight, item.h);
    if (cursorX >= columns) {
      cursorX = 0;
      cursorY += rowHeight;
      rowHeight = 0;
    }
  }

  return next;
}

function mergeBreakpointLayout(
  saved: SurfaceLayoutBreakpointItem[] | undefined,
  defaults: SurfaceLayoutBreakpointItem[],
  breakpoint: SurfaceBreakpointKey,
  widgets: SurfaceWidgetLayoutDefinition[]
) {
  const columns = SURFACE_COLUMNS[breakpoint];
  const savedById = new Map(
    (saved ?? [])
      .map((item) => sanitizeItem(item, columns))
      .filter((item): item is SurfaceLayoutBreakpointItem => item !== null)
      .map((item) => [item.i, item])
  );
  const defaultsById = new Map(defaults.map((item) => [item.i, item]));
  const mergedExisting: SurfaceLayoutBreakpointItem[] = [];
  const prependedDefaults: SurfaceLayoutBreakpointItem[] = [];
  const appendedDefaults: SurfaceLayoutBreakpointItem[] = [];

  for (const widget of widgets) {
    const fallback = defaultsById.get(widget.id);
    if (!fallback) {
      continue;
    }
    const current = savedById.get(widget.id);
    if (current) {
      mergedExisting.push({
        ...fallback,
        ...current
      });
      continue;
    }
    if (widget.defaultPlacement === "top") {
      prependedDefaults.push(fallback);
      continue;
    }
    appendedDefaults.push(fallback);
  }

  if (prependedDefaults.length === 0) {
    return appendLayoutItems(mergedExisting, appendedDefaults, breakpoint);
  }

  const prependHeight = bottomOfLayout(prependedDefaults);
  const shiftedExisting = mergedExisting.map((item) => ({
    ...item,
    y: item.y + prependHeight
  }));
  return appendLayoutItems(
    [...prependedDefaults, ...shiftedExisting],
    appendedDefaults,
    breakpoint
  );
}

export function mergeSurfaceLayoutPayload(
  surfaceId: string,
  widgets: SurfaceWidgetLayoutDefinition[],
  payload: Partial<SurfaceLayoutPayload> | null | undefined
): SurfaceLayoutPayload {
  const defaults = buildDefaultSurfaceLayoutPayload(surfaceId, widgets);
  return {
    surfaceId,
    layouts: {
      lg: mergeBreakpointLayout(
        payload?.layouts?.lg,
        defaults.layouts.lg,
        "lg",
        widgets
      ),
      md: mergeBreakpointLayout(
        payload?.layouts?.md,
        defaults.layouts.md,
        "md",
        widgets
      ),
      sm: mergeBreakpointLayout(
        payload?.layouts?.sm,
        defaults.layouts.sm,
        "sm",
        widgets
      ),
      xs: mergeBreakpointLayout(
        payload?.layouts?.xs,
        defaults.layouts.xs,
        "xs",
        widgets
      ),
      xxs: mergeBreakpointLayout(
        payload?.layouts?.xxs,
        defaults.layouts.xxs,
        "xxs",
        widgets
      )
    },
    widgets: {
      ...defaults.widgets,
      ...sanitizeWidgets(payload?.widgets)
    },
    updatedAt:
      typeof payload?.updatedAt === "string"
        ? payload.updatedAt
        : defaults.updatedAt
  };
}

export function readCachedSurfaceLayout(surfaceId: string) {
  if (typeof window === "undefined") {
    return null;
  }
  try {
    const raw = window.localStorage.getItem(storageKey(surfaceId));
    if (!raw) {
      return null;
    }
    return JSON.parse(raw) as SurfaceLayoutPayload;
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
    return;
  }
}
