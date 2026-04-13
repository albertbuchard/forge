import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent
} from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Label,
  Line,
  ReferenceLine,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";
import {
  Activity,
  BatteryCharging,
  Coffee,
  Moon,
  RefreshCcw,
  Save,
  Scissors,
  Trash2,
  Zap
} from "lucide-react";
import { Link } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  FloatingActionMenu,
  type FloatingActionMenuItem
} from "@/components/ui/floating-action-menu";
import {
  createFatigueSignal,
  getLifeForce,
  updateLifeForceTemplate
} from "@/lib/api";
import type {
  LifeForceCurvePoint,
  LifeForceDrainEntry,
  LifeForcePayload,
  LifeForceWarning
} from "@/lib/types";
import { cn } from "@/lib/utils";

const MIN_POINT_GAP_MINUTES = 20;
const CURVE_CHART_HEIGHT = 288;
const CURVE_CHART_MARGIN = {
  top: 16,
  right: 18,
  bottom: 28,
  left: 42
} as const;
const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

function buildFallbackTemplates(
  lifeForce: LifeForcePayload,
  todayWeekday: number
) {
  return WEEKDAY_LABELS.map((_, weekday) => ({
    weekday,
    baselineDailyAp: lifeForce.baselineDailyAp,
    points: lifeForce.currentCurve.map((point) => ({
      ...point,
      locked: weekday === todayWeekday ? point.locked : false
    }))
  }));
}

function formatAp(value: number) {
  return `${Number(value.toFixed(1))} AP`;
}

function formatRate(value: number) {
  return `${Number(value.toFixed(1))} AP/h`;
}

function formatMinuteOfDay(minuteOfDay: number) {
  const date = new Date(2026, 0, 1, 0, minuteOfDay, 0, 0);
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit"
  }).format(date);
}

function formatMinuteTick(minuteOfDay: number) {
  const date = new Date(2026, 0, 1, 0, minuteOfDay, 0, 0);
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric"
  }).format(date);
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function computeArea(points: LifeForceCurvePoint[]) {
  if (points.length < 2) {
    return 0;
  }
  let total = 0;
  for (let index = 0; index < points.length - 1; index += 1) {
    const left = points[index]!;
    const right = points[index + 1]!;
    total +=
      ((left.rateApPerHour + right.rateApPerHour) / 2) *
      ((right.minuteOfDay - left.minuteOfDay) / 60);
  }
  return total;
}

function interpolateRate(points: LifeForceCurvePoint[], minuteOfDay: number) {
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

function normalizeCurveToBudget(
  points: LifeForceCurvePoint[],
  baselineDailyAp: number
) {
  const area = computeArea(points);
  if (area <= 0 || baselineDailyAp <= 0) {
    return points.map((point) => ({ ...point, rateApPerHour: 0 }));
  }
  const scale = baselineDailyAp / area;
  return points.map((point) => ({
    ...point,
    rateApPerHour: Number((point.rateApPerHour * scale).toFixed(4))
  }));
}

function computeHandleMaxRate(
  points: LifeForceCurvePoint[],
  index: number,
  baselineDailyAp: number
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
    MIN_POINT_GAP_MINUTES / 60,
    (current.minuteOfDay - previous.minuteOfDay) / 60
  );
  const rightHours = Math.max(
    MIN_POINT_GAP_MINUTES / 60,
    (next.minuteOfDay - current.minuteOfDay) / 60
  );
  return Math.max(
    0,
    (2 * (baselineDailyAp - fixedArea) -
      previous.rateApPerHour * leftHours -
      next.rateApPerHour * rightHours) /
      (leftHours + rightHours)
  );
}

function toneClass(tone: LifeForceWarning["tone"]) {
  switch (tone) {
    case "danger":
      return "bg-rose-400/12 text-rose-100";
    case "warning":
      return "bg-amber-400/12 text-amber-100";
    case "success":
      return "bg-emerald-400/12 text-emerald-100";
    case "info":
    default:
      return "bg-sky-400/12 text-sky-100";
  }
}

function summarizeDrainRole(role: LifeForceDrainEntry["role"]) {
  switch (role) {
    case "primary":
      return "Primary";
    case "secondary":
      return "Secondary";
    case "recovery":
      return "Recovery";
    case "background":
    default:
      return "Ambient";
  }
}

function getLifeForceUsageLabel(lifeForce: LifeForcePayload) {
  if (lifeForce.spentTodayAp > lifeForce.dailyBudgetAp) {
    return "Over budget";
  }
  if (lifeForce.spentTodayAp < lifeForce.targetBandMinAp) {
    return "Below target band";
  }
  return "Inside target band";
}

function getLifeForceMode(lifeForce: LifeForcePayload) {
  if (lifeForce.overloadApPerHour > 0 || lifeForce.instantFreeApPerHour <= 0) {
    return "Recovery";
  }
  if (lifeForce.instantCapacityApPerHour >= lifeForce.currentDrainApPerHour + 4) {
    return "Deep work";
  }
  return "Low-friction admin";
}

function LifeForceHeaderCards({ lifeForce }: { lifeForce: LifeForcePayload }) {
  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
      <Card className="p-4">
        <div className="text-[11px] uppercase tracking-[0.18em] text-white/40">
          Daily AP
        </div>
        <div className="mt-2 font-display text-4xl text-[var(--primary)]">
          {Math.round(lifeForce.spentTodayAp)}
          <span className="ml-2 text-lg text-white/44">
            / {Math.round(lifeForce.dailyBudgetAp)}
          </span>
        </div>
        <div className="mt-2 text-sm text-white/58">
          Target band {Math.round(lifeForce.targetBandMinAp)}-
          {Math.round(lifeForce.targetBandMaxAp)} AP
        </div>
        <div className="mt-2 text-xs uppercase tracking-[0.14em] text-white/38">
          {getLifeForceUsageLabel(lifeForce)}
        </div>
      </Card>
      <Card className="p-4">
        <div className="text-[11px] uppercase tracking-[0.18em] text-white/40">
          Instant headroom
        </div>
        <div className="mt-2 font-display text-4xl text-white">
          {lifeForce.instantFreeApPerHour.toFixed(1)}
        </div>
        <div className="mt-2 text-sm text-white/58">
          {formatRate(lifeForce.instantCapacityApPerHour)} capacity minus{" "}
          {formatRate(lifeForce.currentDrainApPerHour)} load
        </div>
        <div className="mt-2 text-xs uppercase tracking-[0.14em] text-white/38">
          {lifeForce.overloadApPerHour > 0
            ? `${formatRate(lifeForce.overloadApPerHour)} overloaded`
            : "No overload right now"}
        </div>
      </Card>
      <Card className="p-4">
        <div className="text-[11px] uppercase tracking-[0.18em] text-white/40">
          Fatigue buffer
        </div>
        <div className="mt-2 font-display text-4xl text-white">
          {lifeForce.fatigueBufferApPerHour.toFixed(1)}
        </div>
        <div className="mt-2 text-sm text-white/58">
          Short-term strain rises with overlap and falls with recovery.
        </div>
      </Card>
      <Card className="p-4">
        <div className="text-[11px] uppercase tracking-[0.18em] text-white/40">
          Forecast
        </div>
        <div className="mt-2 font-display text-4xl text-white">
          {Math.round(lifeForce.forecastAp)}
        </div>
        <div className="mt-2 text-sm text-white/58">
          Planned remaining {formatAp(lifeForce.plannedRemainingAp)}
        </div>
        <div className="mt-2 text-xs uppercase tracking-[0.14em] text-white/38">
          Remaining {formatAp(lifeForce.remainingAp)}
        </div>
      </Card>
    </div>
  );
}

function LifeForceStatsStrip({ lifeForce }: { lifeForce: LifeForcePayload }) {
  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-6">
      {lifeForce.stats.map((stat) => (
        <Card key={stat.key} className="p-4">
          <div className="flex items-center justify-between gap-3">
            <div className="text-[11px] uppercase tracking-[0.16em] text-white/38">
              {stat.label}
            </div>
            <Badge className="bg-white/[0.08] text-white/70">
              L{stat.level}
            </Badge>
          </div>
          <div className="mt-3 text-2xl font-semibold text-white">
            {Math.round(stat.xp)} XP
          </div>
          <div className="mt-1 text-sm text-white/54">
            {stat.key === "life_force"
              ? `+${Math.round((stat.costModifier - 1) * 100)}% daily resilience`
              : `${Math.round((1 - stat.costModifier) * 100)}% cost relief`}
          </div>
        </Card>
      ))}
    </div>
  );
}

function LifeForceCurveEditor({
  lifeForce,
  weekday,
  points,
  baselineDailyAp,
  isDirty,
  isSaving,
  onChange,
  onReset,
  onSave,
  onWeekdayChange
}: {
  lifeForce: LifeForcePayload;
  weekday: number;
  points: LifeForceCurvePoint[];
  baselineDailyAp: number;
  isDirty: boolean;
  isSaving: boolean;
  onChange: (points: LifeForceCurvePoint[]) => void;
  onReset: () => void;
  onSave: () => void;
  onWeekdayChange: (weekday: number) => void;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [dragState, setDragState] = useState<{
    index: number;
    pointerId: number;
    pointerX: number;
    pointerY: number;
  } | null>(null);
  const [containerWidth, setContainerWidth] = useState(720);
  const [menuState, setMenuState] = useState<{
    index: number;
    position: { x: number; y: number };
  } | null>(null);
  const todayWeekday = useMemo(() => new Date().getDay(), []);
  const minuteOfDayNow = useMemo(() => {
    const now = new Date();
    return now.getHours() * 60 + now.getMinutes();
  }, []);
  const orderedPoints = useMemo(
    () => [...points].sort((left, right) => left.minuteOfDay - right.minuteOfDay),
    [points]
  );
  const visiblePoints = useMemo(
    () =>
      orderedPoints.map((point) => ({
        ...point,
        locked:
          weekday === todayWeekday
            ? point.minuteOfDay <= minuteOfDayNow
            : false
      })),
    [minuteOfDayNow, orderedPoints, todayWeekday, weekday]
  );
  const yMax = useMemo(() => {
    const biggest = Math.max(
      lifeForce.instantCapacityApPerHour,
      ...visiblePoints.map((point) => point.rateApPerHour),
      8
    );
    return Math.max(12, Math.ceil(biggest * 1.25));
  }, [lifeForce.instantCapacityApPerHour, visiblePoints]);
  const chartData = useMemo(
    () =>
      visiblePoints.map((point) => ({
        ...point,
        label: formatMinuteOfDay(point.minuteOfDay)
      })),
    [visiblePoints]
  );
  const xTicks = useMemo(() => [0, 240, 480, 720, 960, 1200, 1440], []);
  const yTicks = useMemo(
    () =>
      Array.from(
        new Set([
          0,
          Math.max(2, Math.round(yMax / 3)),
          Math.max(4, Math.round((2 * yMax) / 3)),
          yMax
        ])
      ).sort((left, right) => left - right),
    [yMax]
  );
  const chartWidth = Math.max(containerWidth, 1);
  const plotWidth = Math.max(
    160,
    chartWidth - CURVE_CHART_MARGIN.left - CURVE_CHART_MARGIN.right
  );
  const plotHeight =
    CURVE_CHART_HEIGHT - CURVE_CHART_MARGIN.top - CURVE_CHART_MARGIN.bottom;

  useEffect(() => {
    const updateWidth = () => {
      const nextWidth = containerRef.current?.clientWidth ?? 0;
      setContainerWidth(nextWidth > 0 ? nextWidth : 720);
    };
    updateWidth();
    window.addEventListener("resize", updateWidth);
    return () => window.removeEventListener("resize", updateWidth);
  }, []);

  useEffect(() => {
    if (dragState === null || !containerRef.current) {
      return;
    }
    const chart = containerRef.current;
    const onPointerMove = (event: PointerEvent) => {
      if (event.pointerId !== dragState.pointerId) {
        return;
      }
      event.preventDefault();
      const rect = chart.getBoundingClientRect();
      const clientX = Number.isFinite(event.clientX)
        ? event.clientX
        : rect.left + dragState.pointerX;
      const clientY = Number.isFinite(event.clientY)
        ? event.clientY
        : rect.top + dragState.pointerY;
      const pointerX = clamp(clientX - rect.left, 0, rect.width);
      const pointerY = clamp(clientY - rect.top, 0, rect.height);
      const x = clamp(
        clientX - rect.left - CURVE_CHART_MARGIN.left,
        0,
        plotWidth
      );
      const y = clamp(
        clientY - rect.top - CURVE_CHART_MARGIN.top,
        0,
        plotHeight
      );
      onChange(
        visiblePoints.map((point, index) => {
          if (index !== dragState.index) {
            return {
              minuteOfDay: point.minuteOfDay,
              rateApPerHour: point.rateApPerHour,
              locked: point.locked
            };
          }
          if (
            point.locked ||
            index === 0 ||
            index === visiblePoints.length - 1
          ) {
            return {
              minuteOfDay: point.minuteOfDay,
              rateApPerHour: point.rateApPerHour,
              locked: point.locked
            };
          }
          const leftBound =
            visiblePoints[index - 1]!.minuteOfDay + MIN_POINT_GAP_MINUTES;
          const rightBound =
            visiblePoints[index + 1]!.minuteOfDay - MIN_POINT_GAP_MINUTES;
          const minuteOfDay = Math.round(
            clamp((x / plotWidth) * 1440, leftBound, rightBound)
          );
          const draft = visiblePoints.map((entry) => ({
            minuteOfDay: entry.minuteOfDay,
            rateApPerHour: entry.rateApPerHour,
            locked: entry.locked
          }));
          draft[index] = {
            ...draft[index]!,
            minuteOfDay
          };
          const provisionalMax = computeHandleMaxRate(
            draft,
            index,
            baselineDailyAp
          );
          const rateApPerHour = clamp(
            ((plotHeight - y) / plotHeight) * yMax,
            0,
            Math.max(0, provisionalMax)
          );
          draft[index] = {
            ...draft[index]!,
            rateApPerHour: Number(rateApPerHour.toFixed(3))
          };
          return draft[index]!;
        })
      );
      setDragState((current) =>
        current === null || current.pointerId !== event.pointerId
          ? current
          : {
              ...current,
              pointerX,
              pointerY
            }
      );
    };
    const stopDragging = (event?: PointerEvent) => {
      if (!event || event.pointerId === dragState.pointerId) {
        setDragState(null);
      }
    };
    window.addEventListener("pointermove", onPointerMove, { passive: false });
    window.addEventListener("pointerup", stopDragging);
    window.addEventListener("pointercancel", stopDragging);
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", stopDragging);
      window.removeEventListener("pointercancel", stopDragging);
    };
  }, [
    baselineDailyAp,
    dragState,
    onChange,
    plotHeight,
    plotWidth,
    visiblePoints,
    yMax
  ]);

  const activeMenuItems = useMemo<FloatingActionMenuItem[]>(() => {
    if (!menuState) {
      return [];
    }
    const point = visiblePoints[menuState.index] ?? null;
    return [
      {
        id: "remove-point",
        label: "Remove point",
        description:
          point === null
            ? "No turn point is selected."
            : `Delete the turn point at ${formatMinuteOfDay(point.minuteOfDay)}.`,
        icon: Trash2,
        tone: "danger",
        disabled:
          point === null ||
          menuState.index === 0 ||
          menuState.index === visiblePoints.length - 1,
        onSelect: () => {
          onChange(visiblePoints.filter((_, index) => index !== menuState.index));
        }
      },
      {
        id: "flatten-point",
        label: "Flatten point",
        description:
          point === null
            ? "No turn point is selected."
            : "Place the handle back on the interpolated segment between its neighbors.",
        icon: RefreshCcw,
        disabled:
          point === null ||
          menuState.index === 0 ||
          menuState.index === visiblePoints.length - 1,
        onSelect: () => {
          const previous = visiblePoints[menuState.index - 1]!;
          const next = visiblePoints[menuState.index + 1]!;
          const rateApPerHour = interpolateRate(
            [previous, next],
            point!.minuteOfDay
          );
          onChange(
            visiblePoints.map((entry, index) =>
              index === menuState.index
                ? { ...entry, rateApPerHour: Number(rateApPerHour.toFixed(3)) }
                : entry
            )
          );
        }
      }
    ];
  }, [menuState, onChange, visiblePoints]);

  const handlePositions = useMemo(
    () =>
      visiblePoints.map((point) => ({
        ...point,
        x:
          CURVE_CHART_MARGIN.left + (point.minuteOfDay / 1440) * plotWidth,
        y:
          CURVE_CHART_MARGIN.top +
          (1 - point.rateApPerHour / Math.max(1, yMax)) * plotHeight
      })),
    [plotHeight, plotWidth, visiblePoints, yMax]
  );
  const dragPreview =
    dragState === null
      ? null
      : {
          pointerX: dragState.pointerX,
          pointerY: dragState.pointerY,
          constrainedX: handlePositions[dragState.index]?.x ?? dragState.pointerX,
          constrainedY: handlePositions[dragState.index]?.y ?? dragState.pointerY
        };

  return (
    <>
      <Card className="overflow-hidden p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[11px] uppercase tracking-[0.18em] text-white/40">
              Life Force view
            </div>
            <div className="mt-2 text-xl font-semibold text-white">
              Instant Life Force editor
            </div>
            <div className="mt-2 max-w-3xl text-sm leading-6 text-white/56">
              One click adds a turn point. Drag future handles. Right click a
              handle to remove or flatten it. The ghost handle follows your
              finger or cursor while the real turn point stays constrained on
              the curve and normalized to the baseline daily AP budget.
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <div className="flex flex-wrap items-center gap-1 rounded-full bg-white/[0.04] p-1">
              {WEEKDAY_LABELS.map((label, index) => (
                <button
                  key={label}
                  type="button"
                  className={cn(
                    "rounded-full px-3 py-1.5 text-[11px] font-medium transition",
                    weekday === index
                      ? "bg-[var(--primary)] text-slate-950"
                      : "text-white/60 hover:bg-white/[0.05] hover:text-white"
                  )}
                  onClick={() => onWeekdayChange(index)}
                >
                  {label}
                </button>
              ))}
            </div>
            <Button variant="secondary" onClick={onReset}>
              Reset
            </Button>
            <Button onClick={onSave} pending={isSaving} disabled={!isDirty}>
              <Save className="mr-2 size-4" />
              Save curve
            </Button>
          </div>
        </div>

        <div className="mt-4 rounded-[24px] bg-[linear-gradient(180deg,rgba(192,193,255,0.08),rgba(192,193,255,0.02))] p-3">
          <div
            ref={containerRef}
            className={cn(
              "relative h-72 w-full overflow-hidden rounded-[20px] bg-[rgba(255,255,255,0.02)]",
              dragState !== null ? "select-none touch-none" : ""
            )}
            style={{ touchAction: dragState === null ? "pan-y" : "none" }}
            role="img"
            aria-label="Life Force capacity curve editor"
            onClick={(event) => {
              if (dragState !== null || !containerRef.current) {
                return;
              }
              if (event.target !== event.currentTarget) {
                return;
              }
              const rect = containerRef.current.getBoundingClientRect();
              const x = clamp(
                event.clientX - rect.left - CURVE_CHART_MARGIN.left,
                0,
                plotWidth
              );
              const minuteOfDay = Math.round((x / plotWidth) * 1440);
              const insertAt = visiblePoints.findIndex(
                (point) => point.minuteOfDay > minuteOfDay
              );
              if (insertAt <= 0) {
                return;
              }
              const previous = visiblePoints[insertAt - 1]!;
              const next = visiblePoints[insertAt]!;
              if (
                minuteOfDay - previous.minuteOfDay < MIN_POINT_GAP_MINUTES ||
                next.minuteOfDay - minuteOfDay < MIN_POINT_GAP_MINUTES
              ) {
                return;
              }
              const rateApPerHour = interpolateRate(visiblePoints, minuteOfDay);
              const nextPoints = [...visiblePoints];
              nextPoints.splice(insertAt, 0, {
                minuteOfDay,
                rateApPerHour: Number(rateApPerHour.toFixed(3)),
                locked: weekday === todayWeekday && minuteOfDay <= minuteOfDayNow
              });
              onChange(nextPoints);
            }}
          >
            <AreaChart
              width={chartWidth}
              height={CURVE_CHART_HEIGHT}
              data={chartData}
              margin={CURVE_CHART_MARGIN}
            >
              <defs>
                <linearGradient id="life-force-chart-fill" x1="0" x2="0" y1="0" y2="1">
                  <stop offset="0%" stopColor="rgba(192,193,255,0.24)" />
                  <stop offset="100%" stopColor="rgba(192,193,255,0.02)" />
                </linearGradient>
              </defs>
              <CartesianGrid
                vertical={false}
                stroke="rgba(255,255,255,0.08)"
                strokeDasharray="3 4"
              />
              <XAxis
                dataKey="minuteOfDay"
                type="number"
                domain={[0, 1440]}
                ticks={xTicks}
                tickFormatter={formatMinuteTick}
                tick={{ fill: "rgba(255,255,255,0.48)", fontSize: 10 }}
                tickLine={false}
                axisLine={{ stroke: "rgba(255,255,255,0.12)" }}
              >
                <Label
                  value="Time"
                  position="insideBottom"
                  offset={-10}
                  fill="rgba(255,255,255,0.38)"
                  fontSize={10}
                />
              </XAxis>
              <YAxis
                type="number"
                domain={[0, yMax]}
                ticks={yTicks}
                tick={{ fill: "rgba(255,255,255,0.48)", fontSize: 10 }}
                tickLine={false}
                axisLine={{ stroke: "rgba(255,255,255,0.12)" }}
                width={34}
              >
                <Label
                  value="AP/h"
                  angle={-90}
                  position="insideLeft"
                  fill="rgba(255,255,255,0.38)"
                  fontSize={10}
                  style={{ textAnchor: "middle" }}
                />
              </YAxis>
              <Tooltip
                cursor={{
                  stroke: "rgba(255,255,255,0.18)",
                  strokeDasharray: "3 4"
                }}
                content={({ active, payload }) => {
                  const point = active ? payload?.[0]?.payload : null;
                  if (!point) {
                    return null;
                  }
                  return (
                    <div className="rounded-[16px] border border-white/10 bg-[rgba(10,15,27,0.95)] px-3 py-2 text-xs text-white shadow-[0_18px_50px_rgba(4,8,18,0.3)] backdrop-blur-xl">
                      <div className="font-medium text-white">{point.label}</div>
                      <div className="mt-1 text-white/60">
                        {formatRate(point.rateApPerHour)}
                      </div>
                    </div>
                  );
                }}
              />
              {weekday === todayWeekday ? (
                <ReferenceLine
                  x={minuteOfDayNow}
                  stroke="rgba(255,255,255,0.22)"
                  strokeDasharray="3 4"
                />
              ) : null}
              <Area
                type="linear"
                dataKey="rateApPerHour"
                stroke="none"
                fill="url(#life-force-chart-fill)"
                isAnimationActive={false}
              />
              <Line
                type="linear"
                dataKey="rateApPerHour"
                stroke="rgba(214,215,255,0.95)"
                strokeWidth={1.5}
                dot={false}
                activeDot={false}
                isAnimationActive={false}
              />
            </AreaChart>
            {dragPreview ? (
              <svg
                className="pointer-events-none absolute inset-0 z-[15] h-full w-full"
                aria-hidden="true"
              >
                <line
                  x1={dragPreview.constrainedX}
                  y1={dragPreview.constrainedY}
                  x2={dragPreview.pointerX}
                  y2={dragPreview.pointerY}
                  stroke="rgba(214,215,255,0.38)"
                  strokeDasharray="4 5"
                  strokeWidth="1.5"
                />
                <circle
                  cx={dragPreview.pointerX}
                  cy={dragPreview.pointerY}
                  r="11"
                  fill="rgba(214,215,255,0.12)"
                  stroke="rgba(214,215,255,0.34)"
                  strokeWidth="1.5"
                  data-testid="life-force-ghost-handle"
                />
                <circle
                  cx={dragPreview.pointerX}
                  cy={dragPreview.pointerY}
                  r="3.5"
                  fill="rgba(255,255,255,0.44)"
                />
              </svg>
            ) : null}
            {handlePositions.map((point, index) => {
              const isEndpoint = index === 0 || index === handlePositions.length - 1;
              const isDragging = dragState?.index === index;
              const visibleSize = isEndpoint ? 14 : 16;
              const hitSize = isEndpoint ? 22 : 28;
              return (
                <button
                  key={`${point.minuteOfDay}-${index}`}
                  type="button"
                  aria-label={`Turn point at ${formatMinuteOfDay(point.minuteOfDay)}`}
                  className={cn(
                    "absolute z-20 flex items-center justify-center rounded-full transition-transform duration-75",
                    point.locked || isEndpoint
                      ? "cursor-not-allowed"
                      : "cursor-grab active:cursor-grabbing",
                    isDragging ? "scale-110" : ""
                  )}
                  style={{
                    left: point.x - hitSize / 2,
                    top: point.y - hitSize / 2,
                    width: hitSize,
                    height: hitSize,
                    touchAction: "none"
                  }}
                  onPointerDown={(event: ReactPointerEvent<HTMLButtonElement>) => {
                    event.preventDefault();
                    event.stopPropagation();
                    if (point.locked || isEndpoint || !containerRef.current) {
                      return;
                    }
                    if ("setPointerCapture" in event.currentTarget) {
                      event.currentTarget.setPointerCapture(event.pointerId);
                    }
                    const rect = containerRef.current.getBoundingClientRect();
                    const clientX = Number.isFinite(event.clientX)
                      ? event.clientX
                      : rect.left + point.x;
                    const clientY = Number.isFinite(event.clientY)
                      ? event.clientY
                      : rect.top + point.y;
                    setDragState({
                      index,
                      pointerId: event.pointerId,
                      pointerX: clamp(clientX - rect.left, 0, rect.width),
                      pointerY: clamp(clientY - rect.top, 0, rect.height)
                    });
                  }}
                  onContextMenu={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    setMenuState({
                      index,
                      position: { x: event.clientX + 6, y: event.clientY + 6 }
                    });
                  }}
                >
                  <span
                    className={cn(
                      "pointer-events-none inline-flex rounded-full border border-[rgba(10,15,27,0.92)] shadow-[0_0_0_1px_rgba(255,255,255,0.08),0_10px_24px_rgba(4,8,18,0.28)]",
                      point.locked || isEndpoint
                        ? "bg-white/55"
                        : "bg-white"
                    )}
                    style={{
                      width: visibleSize,
                      height: visibleSize,
                      opacity: isDragging ? 0.96 : 1
                    }}
                  />
                </button>
              );
            })}
          </div>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 px-1 text-[11px] text-white/42">
            <div>Editing {WEEKDAY_LABELS[weekday]} curve</div>
            <div>{Math.round(baselineDailyAp)} AP/day baseline</div>
          </div>
        </div>
      </Card>
      <FloatingActionMenu
        open={menuState !== null}
        title="Turn point actions"
        subtitle="Delete the turn point or flatten it back onto the surrounding segment."
        items={activeMenuItems}
        position={menuState?.position ?? null}
        onClose={() => setMenuState(null)}
      />
    </>
  );
}

function LifeForceStudioCard() {
  return (
    <Card className="overflow-hidden p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[11px] uppercase tracking-[0.18em] text-white/40">
            Life Force studio
          </div>
          <div className="mt-2 text-xl font-semibold text-white">
            Edit weekday curves in the dedicated view
          </div>
          <div className="mt-2 max-w-3xl text-sm leading-6 text-white/56">
            The full weekday editor, turn-point menu, and curve calibration now
            live in their own page so Overview can stay fast and readable.
          </div>
        </div>
        <Link
          to="/life-force"
          className="inline-flex min-h-10 min-w-0 max-w-full items-center justify-center gap-2 overflow-hidden whitespace-nowrap rounded-[var(--radius-control)] border border-[var(--primary)]/14 bg-[var(--ui-accent-soft)] px-3 py-2 text-[13px] font-medium text-[var(--ui-ink-on-accent)] shadow-[var(--ui-shadow-soft)] transition hover:bg-[var(--ui-accent-soft-hover)]"
        >
          <Zap className="size-4" />
          Open Life Force studio
        </Link>
      </div>
    </Card>
  );
}

function LifeForceDrains({
  drains,
  plannedDrains,
  warnings,
  recommendations
}: {
  drains: LifeForceDrainEntry[];
  plannedDrains: LifeForceDrainEntry[];
  warnings: LifeForceWarning[];
  recommendations: string[];
}) {
  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]">
      <div className="grid gap-4">
        <Card className="p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-[11px] uppercase tracking-[0.18em] text-white/40">
                Current drains
              </div>
              <div className="mt-2 text-xl font-semibold text-white">
                What is consuming Life Force now
              </div>
            </div>
            <Badge className="bg-white/[0.08] text-white/70">
              {drains.length} active
            </Badge>
          </div>
          <div className="mt-4 grid gap-3">
            {drains.length === 0 ? (
              <div className="rounded-[18px] bg-white/[0.04] px-4 py-4 text-sm text-white/58">
                No current drainers are active. This is a good moment to choose
                your next intentional action.
              </div>
            ) : (
              drains.map((drain) => (
                <div
                  key={drain.id}
                  className="rounded-[18px] bg-white/[0.04] px-4 py-4"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-base font-semibold text-white">
                        {drain.title}
                      </div>
                      <div className="mt-1 text-sm text-white/54">
                        {drain.why}
                      </div>
                    </div>
                    <div className="shrink-0 text-right">
                      <div className="text-base font-semibold text-[var(--primary)]">
                        {formatRate(drain.apPerHour)}
                      </div>
                      <div className="mt-1 text-xs uppercase tracking-[0.14em] text-white/38">
                        {summarizeDrainRole(drain.role)}
                      </div>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </Card>
        <Card className="p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-[11px] uppercase tracking-[0.18em] text-white/40">
                Planned drains
              </div>
              <div className="mt-2 text-xl font-semibold text-white">
                What the rest of today is already asking from you
              </div>
            </div>
            <Badge className="bg-white/[0.08] text-white/70">
              {plannedDrains.length} planned
            </Badge>
          </div>
          <div className="mt-4 grid gap-3">
            {plannedDrains.length === 0 ? (
              <div className="rounded-[18px] bg-white/[0.04] px-4 py-4 text-sm text-white/58">
                No future AP load has been forecast yet. The day is still open.
              </div>
            ) : (
              plannedDrains.slice(0, 6).map((drain) => (
                <div key={drain.id} className="rounded-[18px] bg-white/[0.04] px-4 py-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-base font-semibold text-white">
                        {drain.title}
                      </div>
                      <div className="mt-1 text-sm text-white/54">
                        {drain.why}
                      </div>
                    </div>
                    <div className="shrink-0 text-right">
                      <div className="text-base font-semibold text-[var(--primary)]">
                        {formatAp(drain.instantAp)}
                      </div>
                      <div className="mt-1 text-xs uppercase tracking-[0.14em] text-white/38">
                        {formatRate(drain.apPerHour)}
                      </div>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </Card>
      </div>

      <div className="grid gap-4">
        <Card className="p-4">
          <div className="text-[11px] uppercase tracking-[0.18em] text-white/40">
            Warnings
          </div>
          <div className="mt-4 grid gap-3">
            {warnings.map((warning) => (
              <div
                key={warning.id}
                className={cn("rounded-[18px] px-4 py-4", toneClass(warning.tone))}
              >
                <div className="text-sm font-semibold">{warning.title}</div>
                <div className="mt-1 text-sm leading-6 text-current/80">
                  {warning.detail}
                </div>
              </div>
            ))}
          </div>
        </Card>
        <Card className="p-4">
          <div className="text-[11px] uppercase tracking-[0.18em] text-white/40">
            Recommendations
          </div>
          <div className="mt-4 grid gap-2">
            {recommendations.map((entry, index) => (
              <div
                key={`${entry}-${index}`}
                className="rounded-[16px] bg-white/[0.04] px-4 py-3 text-sm leading-6 text-white/66"
              >
                {entry}
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}

function LifeForceCompact({
  lifeForce,
  onTired,
  onOkayAgain,
  tiredPending,
  okayPending,
  feedback
}: {
  lifeForce: LifeForcePayload;
  onTired: () => void;
  onOkayAgain: () => void;
  tiredPending: boolean;
  okayPending: boolean;
  feedback?: string | null;
}) {
  return (
    <Card className="overflow-hidden p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-[11px] uppercase tracking-[0.18em] text-white/40">
            Life Force now
          </div>
          <div className="mt-2 text-2xl font-semibold text-white">
            {lifeForce.instantFreeApPerHour.toFixed(1)} AP/h free
          </div>
          <div className="mt-2 text-sm text-white/58">
            {Math.round(lifeForce.spentTodayAp)} / {Math.round(lifeForce.dailyBudgetAp)} AP used today
          </div>
          <div className="mt-2 text-xs uppercase tracking-[0.14em] text-white/38">
            {getLifeForceUsageLabel(lifeForce)}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="secondary"
            onClick={onTired}
            pending={tiredPending}
          >
            <Moon className="mr-2 size-4" />
            I&apos;m getting tired
          </Button>
          <Button
            variant="secondary"
            onClick={onOkayAgain}
            pending={okayPending}
          >
            <BatteryCharging className="mr-2 size-4" />
            I&apos;m okay again
          </Button>
        </div>
      </div>

      {feedback ? (
        <div className="mt-4 rounded-[18px] bg-[var(--primary)]/10 px-4 py-3 text-sm text-white/74">
          {feedback}
        </div>
      ) : null}

      <div className="mt-4 grid gap-3 md:grid-cols-3">
        <div className="rounded-[18px] bg-white/[0.04] px-4 py-4">
          <div className="flex items-center gap-2 text-sm font-medium text-white">
            <Zap className="size-4 text-[var(--primary)]" />
            Instant capacity
          </div>
          <div className="mt-2 text-sm text-white/58">
            {formatRate(lifeForce.instantCapacityApPerHour)}
          </div>
        </div>
        <div className="rounded-[18px] bg-white/[0.04] px-4 py-4">
          <div className="flex items-center gap-2 text-sm font-medium text-white">
            <Activity className="size-4 text-[var(--primary)]" />
            Current load
          </div>
          <div className="mt-2 text-sm text-white/58">
            {formatRate(lifeForce.currentDrainApPerHour)}
          </div>
          <div className="mt-2 text-xs uppercase tracking-[0.14em] text-white/38">
            {lifeForce.overloadApPerHour > 0
              ? `${formatRate(lifeForce.overloadApPerHour)} overload`
              : "Inside instant limit"}
          </div>
        </div>
        <div className="rounded-[18px] bg-white/[0.04] px-4 py-4">
          <div className="flex items-center gap-2 text-sm font-medium text-white">
            <Coffee className="size-4 text-[var(--primary)]" />
            Next move
          </div>
          <div className="mt-2 text-sm text-white/58">
            {lifeForce.recommendations[0] ?? "Favor the next clean, manageable action."}
          </div>
          <div className="mt-2 text-xs uppercase tracking-[0.14em] text-white/38">
            {getLifeForceMode(lifeForce)}
          </div>
        </div>
      </div>
    </Card>
  );
}

export function LifeForceOverviewWorkspace({
  selectedUserIds,
  fallbackLifeForce,
  onRefresh,
  showEditor = true
}: {
  selectedUserIds: string[];
  fallbackLifeForce: LifeForcePayload;
  onRefresh?: () => Promise<void>;
  showEditor?: boolean;
}) {
  const queryClient = useQueryClient();
  const todayWeekday = new Date().getDay();
  const [weekday, setWeekday] = useState(todayWeekday);
  const lifeForceQuery = useQuery({
    queryKey: ["forge-life-force", ...selectedUserIds],
    queryFn: () => getLifeForce(selectedUserIds),
    initialData:
      fallbackLifeForce === undefined
        ? undefined
        : {
            lifeForce: fallbackLifeForce,
            templates: WEEKDAY_LABELS.map((_, templateWeekday) => ({
              weekday: templateWeekday,
              baselineDailyAp: fallbackLifeForce.baselineDailyAp,
              points: fallbackLifeForce.currentCurve.map((point) => ({
                ...point,
                locked: templateWeekday === todayWeekday ? point.locked : false
              }))
            }))
          }
  });
  const payload = lifeForceQuery.data?.lifeForce ?? fallbackLifeForce;
  const templates =
    lifeForceQuery.data?.templates ?? buildFallbackTemplates(payload, todayWeekday);
  const currentTemplate =
    templates.find((entry) => entry.weekday === weekday) ??
    {
      weekday,
      baselineDailyAp: payload.baselineDailyAp,
      points: payload.currentCurve
    };
  const [draftPoints, setDraftPoints] = useState<LifeForceCurvePoint[]>(
    currentTemplate.points
  );
  const [dirty, setDirty] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  useEffect(() => {
    setDraftPoints(currentTemplate.points);
    setDirty(false);
  }, [currentTemplate.points, currentTemplate.weekday]);

  const updateTemplateMutation = useMutation({
    mutationFn: (points: LifeForceCurvePoint[]) =>
      updateLifeForceTemplate(
        currentTemplate.weekday,
        { points: normalizeCurveToBudget(points, currentTemplate.baselineDailyAp) },
        selectedUserIds
      ),
    onSuccess: async (response) => {
      await queryClient.invalidateQueries({ queryKey: ["forge-life-force"] });
      await queryClient.invalidateQueries({ queryKey: ["forge-snapshot"] });
      if (onRefresh) {
        await onRefresh();
      }
      setDraftPoints(response.points);
      setDirty(false);
    }
  });
  const tiredMutation = useMutation({
    mutationFn: () =>
      createFatigueSignal({ signalType: "tired" }, selectedUserIds),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["forge-life-force"] });
      await queryClient.invalidateQueries({ queryKey: ["forge-snapshot"] });
      if (onRefresh) {
        await onRefresh();
      }
      setFeedback("Tiredness signal applied. Today’s Life Force now reflects the extra strain.");
    }
  });
  const okayAgainMutation = useMutation({
    mutationFn: () =>
      createFatigueSignal({ signalType: "okay_again" }, selectedUserIds),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["forge-life-force"] });
      await queryClient.invalidateQueries({ queryKey: ["forge-snapshot"] });
      if (onRefresh) {
        await onRefresh();
      }
      setFeedback("Recovery signal applied. Instant strain has been eased for the rest of today.");
    }
  });

  return (
    <div className="grid gap-4">
      <LifeForceHeaderCards lifeForce={payload} />
      <LifeForceStatsStrip lifeForce={payload} />
      <LifeForceCompact
        lifeForce={payload}
        onTired={() => {
          void tiredMutation.mutateAsync();
        }}
        onOkayAgain={() => {
          void okayAgainMutation.mutateAsync();
        }}
        tiredPending={tiredMutation.isPending}
        okayPending={okayAgainMutation.isPending}
        feedback={feedback}
      />
      {showEditor ? (
        <LifeForceCurveEditor
          lifeForce={payload}
          weekday={weekday}
          points={draftPoints}
          baselineDailyAp={currentTemplate.baselineDailyAp}
          isDirty={dirty}
          isSaving={updateTemplateMutation.isPending}
          onWeekdayChange={setWeekday}
          onChange={(points) => {
            setDraftPoints(points);
            setDirty(true);
          }}
          onReset={() => {
            setDraftPoints(currentTemplate.points);
            setDirty(false);
          }}
          onSave={() => {
            void updateTemplateMutation.mutateAsync(draftPoints);
          }}
        />
      ) : (
        <LifeForceStudioCard />
      )}
      <LifeForceDrains
        drains={payload.activeDrains}
        plannedDrains={payload.plannedDrains}
        warnings={payload.warnings}
        recommendations={payload.recommendations}
      />
      {payload.topTaskIdsNeedingSplit.length > 0 ? (
        <Card className="p-4">
          <div className="flex items-center gap-2 text-sm font-semibold text-white">
            <Scissors className="size-4 text-[var(--primary)]" />
            Tasks asking to be split
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {payload.topTaskIdsNeedingSplit.map((taskId) => (
              <Badge key={taskId} className="bg-white/[0.08] text-white/74">
                {taskId}
              </Badge>
            ))}
          </div>
        </Card>
      ) : null}
    </div>
  );
}

export function LifeForceTodayCard({
  selectedUserIds,
  fallbackLifeForce,
  onRefresh
}: {
  selectedUserIds: string[];
  fallbackLifeForce?: LifeForcePayload;
  onRefresh?: () => Promise<void>;
}) {
  const resolvedUserIds = Array.isArray(selectedUserIds) ? selectedUserIds : [];
  const queryClient = useQueryClient();
  const lifeForceQuery = useQuery({
    queryKey: ["forge-life-force", ...resolvedUserIds],
    queryFn: () => getLifeForce(resolvedUserIds),
    initialData:
      fallbackLifeForce === undefined
        ? undefined
        : {
            lifeForce: fallbackLifeForce,
            templates: []
          }
  });
  const payload = lifeForceQuery.data?.lifeForce ?? fallbackLifeForce;
  if (!payload) {
    return (
      <Card className="p-4">
        <div className="text-[11px] uppercase tracking-[0.18em] text-white/40">
          Life Force
        </div>
        <div className="mt-2 text-lg font-semibold text-white">
          Not calibrated yet
        </div>
        <div className="mt-2 text-sm leading-6 text-white/58">
          Today can still load without a Life Force snapshot, but the AP and
          instant headroom model is not available for this state yet.
        </div>
      </Card>
    );
  }
  const [feedback, setFeedback] = useState<string | null>(null);
  const tiredMutation = useMutation({
    mutationFn: () =>
      createFatigueSignal({ signalType: "tired" }, resolvedUserIds),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["forge-life-force"] });
      await queryClient.invalidateQueries({ queryKey: ["forge-snapshot"] });
      if (onRefresh) {
        await onRefresh();
      }
      setFeedback("Tiredness signal applied. Today’s headroom has been reduced.");
    }
  });
  const okayAgainMutation = useMutation({
    mutationFn: () =>
      createFatigueSignal({ signalType: "okay_again" }, resolvedUserIds),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["forge-life-force"] });
      await queryClient.invalidateQueries({ queryKey: ["forge-snapshot"] });
      if (onRefresh) {
        await onRefresh();
      }
      setFeedback("Recovery signal applied. Today’s headroom has been eased.");
    }
  });

  return (
    <LifeForceCompact
      lifeForce={payload}
      onTired={() => {
        void tiredMutation.mutateAsync();
      }}
      onOkayAgain={() => {
        void okayAgainMutation.mutateAsync();
      }}
      tiredPending={tiredMutation.isPending}
      okayPending={okayAgainMutation.isPending}
      feedback={feedback}
    />
  );
}
