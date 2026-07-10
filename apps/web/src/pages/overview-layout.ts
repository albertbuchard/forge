import type { SurfaceLayoutPayload } from "@/lib/types";

const LEGACY_OVERVIEW_CORE_ORDER = [
  "hero",
  "signals",
  "summary",
  "goals",
  "pipeline"
] as const;

const GENERATED_OVERVIEW_CORE_ORDER = [
  "hero",
  "gamification",
  "summary",
  "life-force",
  "body-signals",
  "signals",
  "goals",
  "pipeline"
] as const;

const OPERATIONAL_OVERVIEW_CORE_ORDER = [
  "hero",
  "summary",
  "gamification",
  "signals",
  "pipeline",
  "body-signals",
  "goals",
  "life-force"
] as const;

const PREVIOUS_OPERATIONAL_OVERVIEW_CORE_ORDER = [
  "hero",
  "summary",
  "signals",
  "pipeline",
  "body-signals",
  "goals",
  "gamification",
  "life-force"
] as const;

const OPERATIONAL_PRESENTATION_DEFAULTS = {
  summary: { titleVisible: false, descriptionVisible: false },
  signals: { titleVisible: false, descriptionVisible: false },
  pipeline: { descriptionVisible: false },
  "body-signals": { descriptionVisible: false },
  goals: { descriptionVisible: false }
} as const;

function startsWithOrder(order: string[], expected: readonly string[]) {
  return expected.every((widgetId, index) => order[index] === widgetId);
}

function ordersEqual(left: string[], right: string[]) {
  return (
    left.length === right.length &&
    left.every((widgetId, index) => widgetId === right[index])
  );
}

export function normalizeOverviewLayout(
  layout: SurfaceLayoutPayload
): SurfaceLayoutPayload {
  const isGeneratedDefault =
    layout.updatedAt === new Date(0).toISOString() &&
    startsWithOrder(layout.order, GENERATED_OVERVIEW_CORE_ORDER);
  const usesLegacyCoreOrder = startsWithOrder(
    layout.order,
    LEGACY_OVERVIEW_CORE_ORDER
  );
  const usesPreviousOperationalCoreOrder = startsWithOrder(
    layout.order,
    PREVIOUS_OPERATIONAL_OVERVIEW_CORE_ORDER
  );

  const shouldMigrateOrder =
    isGeneratedDefault ||
    usesLegacyCoreOrder ||
    usesPreviousOperationalCoreOrder;
  const availableIds = new Set(layout.order);
  const coreIds = new Set<string>(OPERATIONAL_OVERVIEW_CORE_ORDER);
  const nextOrder = shouldMigrateOrder
    ? [
        ...OPERATIONAL_OVERVIEW_CORE_ORDER.filter((widgetId) =>
          availableIds.has(widgetId)
        ),
        ...layout.order.filter((widgetId) => !coreIds.has(widgetId))
      ]
    : layout.order;
  let nextWidgets = layout.widgets;

  if (shouldMigrateOrder) {
    for (const [widgetId, defaults] of Object.entries(
      OPERATIONAL_PRESENTATION_DEFAULTS
    )) {
      const current = nextWidgets[widgetId];
      if (!current) {
        continue;
      }
      const needsUpdate = Object.entries(defaults).some(
        ([key, value]) =>
          current[key as "titleVisible" | "descriptionVisible"] !== value
      );
      if (!needsUpdate) {
        continue;
      }
      if (nextWidgets === layout.widgets) {
        nextWidgets = { ...layout.widgets };
      }
      nextWidgets[widgetId] = { ...current, ...defaults };
    }
  }

  const gamification = nextWidgets.gamification;
  if (gamification?.hidden) {
    if (nextWidgets === layout.widgets) {
      nextWidgets = { ...layout.widgets };
    }
    nextWidgets.gamification = { ...gamification, hidden: false };
  }

  return ordersEqual(layout.order, nextOrder) && nextWidgets === layout.widgets
    ? layout
    : { ...layout, order: nextOrder, widgets: nextWidgets };
}
