import type { SurfaceLayoutPayload } from "@/lib/types";

const LEGACY_TODAY_CORE_ORDER = [
  "hero",
  "metrics",
  "runway",
  "calendar",
  "focus"
] as const;

const GENERATED_TODAY_CORE_ORDER = [
  "hero",
  "life-force",
  "metrics",
  "runway",
  "calendar",
  "focus"
] as const;

const OPERATIONAL_TODAY_CORE_ORDER = [
  "hero",
  "runway",
  "life-force",
  "focus",
  "calendar",
  "metrics"
] as const;

function startsWithOrder(order: string[], expected: readonly string[]) {
  return expected.every((widgetId, index) => order[index] === widgetId);
}

function ordersEqual(left: string[], right: string[]) {
  return (
    left.length === right.length &&
    left.every((widgetId, index) => widgetId === right[index])
  );
}

export function normalizeTodayLayout(
  layout: SurfaceLayoutPayload
): SurfaceLayoutPayload {
  const isGeneratedDefault =
    layout.updatedAt === new Date(0).toISOString() &&
    startsWithOrder(layout.order, GENERATED_TODAY_CORE_ORDER);
  const usesLegacyCoreOrder = startsWithOrder(
    layout.order,
    LEGACY_TODAY_CORE_ORDER
  );

  if (!isGeneratedDefault && !usesLegacyCoreOrder) {
    return layout;
  }

  const availableIds = new Set(layout.order);
  const coreIds = new Set<string>(OPERATIONAL_TODAY_CORE_ORDER);
  const nextOrder = [
    ...OPERATIONAL_TODAY_CORE_ORDER.filter((widgetId) =>
      availableIds.has(widgetId)
    ),
    ...layout.order.filter((widgetId) => !coreIds.has(widgetId))
  ];

  return ordersEqual(layout.order, nextOrder)
    ? layout
    : { ...layout, order: nextOrder };
}
