import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent
} from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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

const SVG_WIDTH = 100;
const SVG_HEIGHT = 56;
const MIN_POINT_GAP_MINUTES = 20;

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

function curveToPath(points: Array<{ x: number; y: number }>) {
  return points
    .map((point, index) =>
      `${index === 0 ? "M" : "L"} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`
    )
    .join(" ");
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
  points,
  baselineDailyAp,
  isDirty,
  isSaving,
  onChange,
  onReset,
  onSave
}: {
  lifeForce: LifeForcePayload;
  points: LifeForceCurvePoint[];
  baselineDailyAp: number;
  isDirty: boolean;
  isSaving: boolean;
  onChange: (points: LifeForceCurvePoint[]) => void;
  onReset: () => void;
  onSave: () => void;
}) {
  const containerRef = useRef<SVGSVGElement | null>(null);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [menuState, setMenuState] = useState<{
    index: number;
    position: { x: number; y: number };
  } | null>(null);
  const minuteOfDayNow = useMemo(() => {
    const now = new Date();
    return now.getHours() * 60 + now.getMinutes();
  }, []);
  const orderedPoints = useMemo(
    () => [...points].sort((left, right) => left.minuteOfDay - right.minuteOfDay),
    [points]
  );
  const yMax = useMemo(() => {
    const biggest = Math.max(
      lifeForce.instantCapacityApPerHour,
      ...orderedPoints.map((point) => point.rateApPerHour),
      8
    );
    return Math.max(12, Math.ceil(biggest * 1.25));
  }, [lifeForce.instantCapacityApPerHour, orderedPoints]);
  const renderedPoints = useMemo(
    () =>
      orderedPoints.map((point) => ({
        ...point,
        x: (point.minuteOfDay / 1440) * SVG_WIDTH,
        y: SVG_HEIGHT - (point.rateApPerHour / yMax) * SVG_HEIGHT
      })),
    [orderedPoints, yMax]
  );
  const curvePath = useMemo(() => curveToPath(renderedPoints), [renderedPoints]);
  const usedRatio = clamp(
    lifeForce.spentTodayAp / Math.max(1, lifeForce.dailyBudgetAp),
    0,
    1.15
  );
  const usedWidth = SVG_WIDTH * clamp(usedRatio, 0, 1);
  const nowX = (minuteOfDayNow / 1440) * SVG_WIDTH;

  useEffect(() => {
    if (dragIndex === null || !containerRef.current) {
      return;
    }
    const svg = containerRef.current;
    const onPointerMove = (event: PointerEvent) => {
      const rect = svg.getBoundingClientRect();
      const x = clamp(event.clientX - rect.left, 0, rect.width);
      const y = clamp(event.clientY - rect.top, 0, rect.height);
      onChange(
        orderedPoints.map((point, index) => {
          if (index !== dragIndex) {
            return point;
          }
          if (index === 0 || index === orderedPoints.length - 1) {
            return point;
          }
          const leftBound =
            orderedPoints[index - 1]!.minuteOfDay + MIN_POINT_GAP_MINUTES;
          const rightBound =
            orderedPoints[index + 1]!.minuteOfDay - MIN_POINT_GAP_MINUTES;
          const minuteOfDay = Math.round(
            clamp((x / rect.width) * 1440, leftBound, rightBound)
          );
          const draft = orderedPoints.map((entry) => ({ ...entry }));
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
            ((rect.height - y) / rect.height) * yMax,
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
    };
    const stopDragging = () => setDragIndex(null);
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", stopDragging, { once: true });
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", stopDragging);
    };
  }, [baselineDailyAp, dragIndex, onChange, orderedPoints, yMax]);

  const activeMenuItems = useMemo<FloatingActionMenuItem[]>(() => {
    if (!menuState) {
      return [];
    }
    const point = orderedPoints[menuState.index] ?? null;
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
          menuState.index === orderedPoints.length - 1,
        onSelect: () => {
          onChange(orderedPoints.filter((_, index) => index !== menuState.index));
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
          menuState.index === orderedPoints.length - 1,
        onSelect: () => {
          const previous = orderedPoints[menuState.index - 1]!;
          const next = orderedPoints[menuState.index + 1]!;
          const rateApPerHour = interpolateRate(
            [previous, next],
            point!.minuteOfDay
          );
          onChange(
            orderedPoints.map((entry, index) =>
              index === menuState.index
                ? { ...entry, rateApPerHour: Number(rateApPerHour.toFixed(3)) }
                : entry
            )
          );
        }
      }
    ];
  }, [menuState, onChange, orderedPoints]);

  return (
    <Card className="overflow-hidden p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[11px] uppercase tracking-[0.18em] text-white/40">
            Today&apos;s curve
          </div>
          <div className="mt-2 text-xl font-semibold text-white">
            Instant Life Force editor
          </div>
          <div className="mt-2 max-w-3xl text-sm leading-6 text-white/56">
            One click adds a turn point. Drag future handles. Right click a
            handle to remove or flatten it. The curve stays normalized to the
            baseline daily AP budget while you edit.
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
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
        <svg
          ref={containerRef}
          viewBox={`0 0 ${SVG_WIDTH} ${SVG_HEIGHT}`}
          className="h-64 w-full cursor-crosshair overflow-visible"
          role="img"
          aria-label="Life Force capacity curve editor"
          onClick={(event) => {
            if (dragIndex !== null || !containerRef.current) {
              return;
            }
            const rect = containerRef.current.getBoundingClientRect();
            const x = clamp(event.clientX - rect.left, 0, rect.width);
            const minuteOfDay = Math.round((x / rect.width) * 1440);
            const insertAt = orderedPoints.findIndex(
              (point) => point.minuteOfDay > minuteOfDay
            );
            if (insertAt <= 0) {
              return;
            }
            const previous = orderedPoints[insertAt - 1]!;
            const next = orderedPoints[insertAt]!;
            if (
              minuteOfDay - previous.minuteOfDay < MIN_POINT_GAP_MINUTES ||
              next.minuteOfDay - minuteOfDay < MIN_POINT_GAP_MINUTES
            ) {
              return;
            }
            const rateApPerHour = interpolateRate(orderedPoints, minuteOfDay);
            const nextPoints = [...orderedPoints];
            nextPoints.splice(insertAt, 0, {
              minuteOfDay,
              rateApPerHour: Number(rateApPerHour.toFixed(3)),
              locked: minuteOfDay <= minuteOfDayNow
            });
            onChange(nextPoints);
          }}
        >
          <defs>
            <linearGradient id="life-force-curve-fill" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor="rgba(192,193,255,0.34)" />
              <stop offset="100%" stopColor="rgba(192,193,255,0.02)" />
            </linearGradient>
          </defs>
          <rect width={SVG_WIDTH} height={SVG_HEIGHT} rx="7" fill="rgba(255,255,255,0.02)" />
          {[0.25, 0.5, 0.75].map((ratio) => (
            <line
              key={ratio}
              x1="0"
              x2={String(SVG_WIDTH)}
              y1={String(SVG_HEIGHT * ratio)}
              y2={String(SVG_HEIGHT * ratio)}
              stroke="rgba(255,255,255,0.08)"
              strokeDasharray="1.6 2.2"
            />
          ))}
          <rect
            x="0"
            y={String(SVG_HEIGHT - 2.8)}
            width={String(usedWidth)}
            height="2.8"
            fill="rgba(78,222,163,0.24)"
          />
          <line
            x1={String(nowX)}
            x2={String(nowX)}
            y1="0"
            y2={String(SVG_HEIGHT)}
            stroke="rgba(255,255,255,0.22)"
            strokeDasharray="2 2"
          />
          <path
            d={`${curvePath} L ${SVG_WIDTH} ${SVG_HEIGHT} L 0 ${SVG_HEIGHT} Z`}
            fill="url(#life-force-curve-fill)"
          />
          <path
            d={curvePath}
            fill="none"
            stroke="rgba(192,193,255,0.96)"
            strokeWidth="1.8"
            strokeLinejoin="round"
            strokeLinecap="round"
          />
          {renderedPoints.map((point, index) => {
            const isLocked = point.minuteOfDay <= minuteOfDayNow;
            return (
              <g key={`${point.minuteOfDay}-${index}`}>
                <circle
                  cx={point.x}
                  cy={point.y}
                  r={index === 0 || index === renderedPoints.length - 1 ? 2.4 : 2.1}
                  fill={isLocked ? "rgba(255,255,255,0.45)" : "rgba(255,255,255,0.95)"}
                  stroke="rgba(10,15,27,0.9)"
                  strokeWidth="0.9"
                  onPointerDown={(event: ReactPointerEvent<SVGCircleElement>) => {
                    event.preventDefault();
                    event.stopPropagation();
                    if (isLocked || index === 0 || index === renderedPoints.length - 1) {
                      return;
                    }
                    setDragIndex(index);
                  }}
                  onContextMenu={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    setMenuState({
                      index,
                      position: { x: event.clientX + 6, y: event.clientY + 6 }
                    });
                  }}
                  className={cn(
                    "transition",
                    isLocked ? "cursor-not-allowed" : "cursor-grab active:cursor-grabbing"
                  )}
                />
                {index > 0 && index < renderedPoints.length - 1 ? (
                  <text
                    x={point.x}
                    y={Math.max(8, point.y - 3.2)}
                    textAnchor="middle"
                    fontSize="3.4"
                    fill="rgba(255,255,255,0.52)"
                  >
                    {formatMinuteOfDay(point.minuteOfDay)}
                  </text>
                ) : null}
              </g>
            );
          })}
        </svg>
      </div>
    </Card>
  );
}

function LifeForceDrains({
  drains,
  warnings,
  recommendations
}: {
  drains: LifeForceDrainEntry[];
  warnings: LifeForceWarning[];
  recommendations: string[];
}) {
  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]">
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
  onRefresh
}: {
  selectedUserIds: string[];
  fallbackLifeForce: LifeForcePayload;
  onRefresh?: () => Promise<void>;
}) {
  const queryClient = useQueryClient();
  const weekday = new Date().getDay();
  const lifeForceQuery = useQuery({
    queryKey: ["forge-life-force", ...selectedUserIds],
    queryFn: () => getLifeForce(selectedUserIds),
    initialData:
      fallbackLifeForce === undefined
        ? undefined
        : {
            lifeForce: fallbackLifeForce,
            templates: [
              {
                weekday,
                baselineDailyAp: fallbackLifeForce.baselineDailyAp,
                points: fallbackLifeForce.currentCurve
              }
            ]
          }
  });
  const payload = lifeForceQuery.data?.lifeForce ?? fallbackLifeForce;
  const currentTemplate =
    lifeForceQuery.data?.templates.find((entry) => entry.weekday === weekday) ??
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
      <LifeForceCurveEditor
        lifeForce={payload}
        points={draftPoints}
        baselineDailyAp={currentTemplate.baselineDailyAp}
        isDirty={dirty}
        isSaving={updateTemplateMutation.isPending}
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
      <LifeForceDrains
        drains={payload.activeDrains}
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
  fallbackLifeForce: LifeForcePayload;
  onRefresh?: () => Promise<void>;
}) {
  const queryClient = useQueryClient();
  const lifeForceQuery = useQuery({
    queryKey: ["forge-life-force", ...selectedUserIds],
    queryFn: () => getLifeForce(selectedUserIds),
    initialData:
      fallbackLifeForce === undefined
        ? undefined
        : {
            lifeForce: fallbackLifeForce,
            templates: []
          }
  });
  const payload = lifeForceQuery.data?.lifeForce ?? fallbackLifeForce;
  const [feedback, setFeedback] = useState<string | null>(null);
  const tiredMutation = useMutation({
    mutationFn: () =>
      createFatigueSignal({ signalType: "tired" }, selectedUserIds),
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
      createFatigueSignal({ signalType: "okay_again" }, selectedUserIds),
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
