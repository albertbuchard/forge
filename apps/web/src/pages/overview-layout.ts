import type { SurfaceLayoutPayload } from "@/lib/types";

const REQUIRED_OVERVIEW_WIDGET_IDS = [
  "hero",
  "gamification",
  "what-matters",
  "forge-map"
] as const;

const OVERVIEW_SEMANTIC_CORE_ORDER = [
  "hero",
  "gamification",
  "what-matters",
  "signals",
  "forge-map",
  "body-signals"
] as const;

function ordersEqual(left: string[], right: string[]) {
  return (
    left.length === right.length &&
    left.every((widgetId, index) => widgetId === right[index])
  );
}

/**
 * Keeps the reader-facing hierarchy stable across persisted layouts. Optional
 * widgets retain their relative order, and every saved widget preference is
 * preserved. The four front-door widgets remain visible.
 */
export function normalizeOverviewLayout(
  layout: SurfaceLayoutPayload
): SurfaceLayoutPayload {
  const coreIds = new Set<string>(OVERVIEW_SEMANTIC_CORE_ORDER);
  const nextOrder = [
    ...OVERVIEW_SEMANTIC_CORE_ORDER,
    ...layout.order.filter((id) => !coreIds.has(id))
  ];
  let nextWidgets = layout.widgets;

  for (const widgetId of REQUIRED_OVERVIEW_WIDGET_IDS) {
    const widget = nextWidgets[widgetId];
    if (!widget?.hidden) continue;
    if (nextWidgets === layout.widgets) {
      nextWidgets = { ...layout.widgets };
    }
    nextWidgets[widgetId] = { ...widget, hidden: false };
  }

  return ordersEqual(layout.order, nextOrder) && nextWidgets === layout.widgets
    ? layout
    : { ...layout, order: nextOrder, widgets: nextWidgets };
}
