import type {
  ActionCostBand,
  ActionProfile,
  LifeForceCurvePoint,
  TaskActionPointSummary,
  TaskSplitSuggestion
} from "../types.js";

export const LIFE_FORCE_BASELINE_DAILY_AP = 200;
export const DEFAULT_TASK_TOTAL_AP = 100;
export const DEFAULT_TASK_EXPECTED_DURATION_SECONDS = 24 * 60 * 60;
export const TASK_SPLIT_THRESHOLD_SECONDS = 2 * DEFAULT_TASK_EXPECTED_DURATION_SECONDS;
export const MIN_LIFE_FORCE_POINT_GAP_MINUTES = 20;

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function resolveTaskExpectedDurationSeconds(
  plannedDurationSeconds: number | null | undefined
): number {
  return Math.max(
    60,
    plannedDurationSeconds ?? DEFAULT_TASK_EXPECTED_DURATION_SECONDS
  );
}

export function resolveActionCostBand(totalCostAp: number): ActionCostBand {
  if (totalCostAp <= 10) {
    return "tiny";
  }
  if (totalCostAp <= 35) {
    return "light";
  }
  if (totalCostAp <= 120) {
    return "standard";
  }
  if (totalCostAp <= 220) {
    return "heavy";
  }
  return "brutal";
}

export function resolveBandTotalCostAp(
  costBand: ActionCostBand | null | undefined
): number {
  switch (costBand) {
    case "tiny":
      return 12;
    case "light":
      return 40;
    case "heavy":
      return 180;
    case "brutal":
      return 280;
    case "standard":
    default:
      return DEFAULT_TASK_TOTAL_AP;
  }
}

export function buildDefaultTaskActionProfile(input: {
  id?: string;
  title?: string;
  expectedDurationSeconds?: number | null;
  totalCostAp?: number | null;
  costBand?: ActionCostBand | null;
  sourceMethod?: ActionProfile["sourceMethod"];
  profileKey?: string;
}): ActionProfile {
  const expectedDurationSeconds = resolveTaskExpectedDurationSeconds(
    input.expectedDurationSeconds
  );
  const totalCostAp = Math.max(
    1,
    input.totalCostAp ??
      resolveBandTotalCostAp(input.costBand) ??
      DEFAULT_TASK_TOTAL_AP
  );
  const sustainRateApPerHour =
    (totalCostAp / expectedDurationSeconds) * 3600;
  const now = new Date().toISOString();
  const costBand = input.costBand ?? resolveActionCostBand(totalCostAp);
  return {
    id: input.id ?? "profile_task_default",
    profileKey: input.profileKey ?? "task_default",
    title: input.title ?? "Default task",
    entityType: "task",
    mode: "rate",
    startupAp: 0,
    totalCostAp,
    expectedDurationSeconds,
    sustainRateApPerHour,
    demandWeights: {
      activation: 0.2,
      focus: 0.45,
      vigor: 0.05,
      composure: 0.05,
      flow: 0.25
    },
    doubleCountPolicy: "primary_only",
    sourceMethod: input.sourceMethod ?? "seeded",
    costBand,
    recoveryEffect: 0,
    metadata: {},
    createdAt: now,
    updatedAt: now
  };
}

export function buildTaskActionPointSummary(input: {
  plannedDurationSeconds?: number | null;
  totalCostAp?: number;
  spentTodayAp?: number;
  spentTotalAp?: number;
}): TaskActionPointSummary {
  const expectedDurationSeconds = resolveTaskExpectedDurationSeconds(
    input.plannedDurationSeconds
  );
  const totalCostAp = Math.max(0, input.totalCostAp ?? DEFAULT_TASK_TOTAL_AP);
  const sustainRateApPerHour =
    (totalCostAp / expectedDurationSeconds) * 3600;
  const spentTodayAp = Math.max(0, input.spentTodayAp ?? 0);
  const spentTotalAp = Math.max(0, input.spentTotalAp ?? 0);
  return {
    costBand: resolveActionCostBand(totalCostAp),
    totalCostAp,
    expectedDurationSeconds,
    sustainRateApPerHour,
    spentTodayAp,
    spentTotalAp,
    remainingAp: Math.max(0, totalCostAp - spentTotalAp)
  };
}

export function buildTaskSplitSuggestion(input: {
  plannedDurationSeconds?: number | null;
  totalTrackedSeconds?: number;
  projectedTotalSeconds?: number;
}): TaskSplitSuggestion {
  const expectedDurationSeconds = resolveTaskExpectedDurationSeconds(
    input.plannedDurationSeconds
  );
  const thresholdSeconds = expectedDurationSeconds * 2;
  const totalTrackedSeconds = Math.max(0, input.totalTrackedSeconds ?? 0);
  const projectedTotalSeconds = Math.max(
    totalTrackedSeconds,
    input.projectedTotalSeconds ?? totalTrackedSeconds
  );
  if (totalTrackedSeconds >= thresholdSeconds) {
    return {
      shouldSplit: true,
      reason: "This task has already absorbed more than two expected days of work.",
      thresholdSeconds
    };
  }
  if (projectedTotalSeconds >= thresholdSeconds) {
    return {
      shouldSplit: true,
      reason:
        "The current live plan would push this task beyond twice its expected duration.",
      thresholdSeconds
    };
  }
  return {
    shouldSplit: false,
    reason: null,
    thresholdSeconds
  };
}

export function computeCurveArea(points: LifeForceCurvePoint[]): number {
  if (points.length < 2) {
    return 0;
  }
  let total = 0;
  for (let index = 0; index < points.length - 1; index += 1) {
    const left = points[index]!;
    const right = points[index + 1]!;
    const hours = (right.minuteOfDay - left.minuteOfDay) / 60;
    total += ((left.rateApPerHour + right.rateApPerHour) / 2) * hours;
  }
  return total;
}

export function normalizeCurveToBudget(
  points: LifeForceCurvePoint[],
  budgetAp: number
): LifeForceCurvePoint[] {
  const area = computeCurveArea(points);
  if (area <= 0 || budgetAp <= 0) {
    return points.map((point) => ({ ...point, rateApPerHour: 0 }));
  }
  const scale = budgetAp / area;
  return points.map((point) => ({
    ...point,
    rateApPerHour: Math.max(0, Number((point.rateApPerHour * scale).toFixed(4)))
  }));
}

export function computeCurveHandleMaxRate(
  points: LifeForceCurvePoint[],
  index: number,
  budgetAp: number,
  minPointGapMinutes = MIN_LIFE_FORCE_POINT_GAP_MINUTES
) {
  if (index <= 0 || index >= points.length - 1) {
    return points[index]?.rateApPerHour ?? 0;
  }
  const previous = points[index - 1]!;
  const current = points[index]!;
  const next = points[index + 1]!;
  let fixedArea = 0;
  for (let cursor = 0; cursor < points.length - 1; cursor += 1) {
    if (cursor === index - 1 || cursor === index) {
      continue;
    }
    const left = points[cursor]!;
    const right = points[cursor + 1]!;
    fixedArea +=
      ((left.rateApPerHour + right.rateApPerHour) / 2) *
      ((right.minuteOfDay - left.minuteOfDay) / 60);
  }
  const leftHours = Math.max(
    minPointGapMinutes / 60,
    (current.minuteOfDay - previous.minuteOfDay) / 60
  );
  const rightHours = Math.max(
    minPointGapMinutes / 60,
    (next.minuteOfDay - current.minuteOfDay) / 60
  );
  return Math.max(
    0,
    (2 * (budgetAp - fixedArea) -
      previous.rateApPerHour * leftHours -
      next.rateApPerHour * rightHours) /
      (leftHours + rightHours)
  );
}

export function buildDefaultSplitTitles(title: string) {
  const cleaned = title.trim();
  if (cleaned.length === 0) {
    return {
      firstTitle: "Split task part 1",
      secondTitle: "Split task part 2"
    };
  }
  return {
    firstTitle: `${cleaned} - part 1`,
    secondTitle: `${cleaned} - part 2`
  };
}

export function interpolateCurveRate(
  points: LifeForceCurvePoint[],
  minuteOfDay: number
): number {
  if (points.length === 0) {
    return 0;
  }
  if (minuteOfDay <= points[0]!.minuteOfDay) {
    return points[0]!.rateApPerHour;
  }
  for (let index = 0; index < points.length - 1; index += 1) {
    const left = points[index]!;
    const right = points[index + 1]!;
    if (minuteOfDay <= right.minuteOfDay) {
      const span = Math.max(1, right.minuteOfDay - left.minuteOfDay);
      const progress = (minuteOfDay - left.minuteOfDay) / span;
      return (
        left.rateApPerHour +
        (right.rateApPerHour - left.rateApPerHour) * progress
      );
    }
  }
  return points[points.length - 1]!.rateApPerHour;
}
