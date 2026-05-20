import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";
import "maplibre-gl/dist/maplibre-gl.css";
import { Activity, ArrowLeft, HeartPulse, MapPinned, Save } from "lucide-react";
import { PageHero } from "@/components/shell/page-hero";
import { SurfaceSkeleton } from "@/components/experience/surface-skeleton";
import { ErrorState } from "@/components/ui/page-state";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { getWorkoutDetail, patchWorkoutSession } from "@/lib/api";
import type {
  WorkoutRoutePointRecord,
  WorkoutSessionDetailPayload,
  WorkoutZoneDuration
} from "@/lib/types";

const ZONE_COLORS: Record<string, string> = {
  below_z1: "#94a3b8",
  zone_1: "#38bdf8",
  zone_2: "#22c55e",
  zone_3: "#eab308",
  zone_4: "#f97316",
  zone_5: "#ef4444"
};

function formatMinutes(seconds: number | null | undefined) {
  if (!seconds) {
    return "0m";
  }
  return `${Math.round(seconds / 60)}m`;
}

function formatWindow(startedAt: string, endedAt: string) {
  const date = new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short"
  });
  const time = new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit"
  });
  return `${date.format(new Date(startedAt))} · ${time.format(new Date(startedAt))} - ${time.format(new Date(endedAt))}`;
}

function formatMetricValue(value: unknown, unit: string) {
  if (typeof value === "number") {
    const formatted = Number.isInteger(value) ? String(value) : value.toFixed(1);
    return unit && unit !== "count" ? `${formatted} ${unit}` : formatted;
  }
  if (typeof value === "boolean") {
    return value ? "Yes" : "No";
  }
  return value == null ? "n/a" : String(value);
}

function routeBounds(points: WorkoutRoutePointRecord[]) {
  if (points.length === 0) {
    return null;
  }
  return {
    minLat: Math.min(...points.map((point) => point.latitude)),
    maxLat: Math.max(...points.map((point) => point.latitude)),
    minLon: Math.min(...points.map((point) => point.longitude)),
    maxLon: Math.max(...points.map((point) => point.longitude))
  };
}

function RoutePreview({ points }: { points: WorkoutRoutePointRecord[] }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const tileUrl =
    typeof window !== "undefined"
      ? window.localStorage.getItem("forge.map.tile-url")?.trim() ?? ""
      : "";

  useEffect(() => {
    let cancelled = false;
    let map: import("maplibre-gl").Map | null = null;
    if (!tileUrl || !containerRef.current || points.length < 2) {
      setMapReady(false);
      return undefined;
    }
    void import("maplibre-gl").then((maplibre) => {
      if (cancelled || !containerRef.current) {
        return;
      }
      map = new maplibre.Map({
        container: containerRef.current,
        style: {
          version: 8,
          sources: {
            tiles: {
              type: "raster",
              tiles: [tileUrl],
              tileSize: 256
            }
          },
          layers: [{ id: "tiles", type: "raster", source: "tiles" }]
        },
        center: [points[0]!.longitude, points[0]!.latitude],
        zoom: 13,
        attributionControl: false
      });
      map.on("load", () => {
        if (!map) {
          return;
        }
        const coordinates = points.map((point) => [
          point.longitude,
          point.latitude
        ]);
        map.addSource("route", {
          type: "geojson",
          data: {
            type: "Feature",
            properties: {},
            geometry: {
              type: "LineString",
              coordinates
            }
          }
        });
        map.addLayer({
          id: "route",
          type: "line",
          source: "route",
          paint: {
            "line-color": "#f97316",
            "line-width": 4
          }
        });
        const bounds = coordinates.reduce(
          (current, coordinate) => current.extend(coordinate as [number, number]),
          new maplibre.LngLatBounds(
            coordinates[0] as [number, number],
            coordinates[0] as [number, number]
          )
        );
        map.fitBounds(bounds, { padding: 44, maxZoom: 15 });
        setMapReady(true);
      });
    });
    return () => {
      cancelled = true;
      map?.remove();
    };
  }, [points, tileUrl]);

  const bounds = routeBounds(points);
  const polyline = useMemo(() => {
    if (!bounds || points.length < 2) {
      return "";
    }
    const width = 720;
    const height = 280;
    const lonSpan = Math.max(0.000001, bounds.maxLon - bounds.minLon);
    const latSpan = Math.max(0.000001, bounds.maxLat - bounds.minLat);
    return points
      .map((point) => {
        const x = ((point.longitude - bounds.minLon) / lonSpan) * width;
        const y = height - ((point.latitude - bounds.minLat) / latSpan) * height;
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(" ");
  }, [bounds, points]);

  return (
    <div className="relative min-h-[280px] overflow-hidden rounded-[8px] border border-white/10 bg-white/[0.035]">
      <div ref={containerRef} className="absolute inset-0" />
      {!mapReady ? (
        <svg viewBox="0 0 720 280" className="absolute inset-0 h-full w-full">
          <rect width="720" height="280" fill="rgba(255,255,255,0.025)" />
          {polyline ? (
            <polyline
              points={polyline}
              fill="none"
              stroke="#f97316"
              strokeWidth="5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          ) : null}
        </svg>
      ) : null}
      <div className="absolute left-3 top-3 rounded-[8px] border border-white/10 bg-black/50 px-3 py-2 text-xs text-white/70 backdrop-blur">
        {tileUrl
          ? "Local-first map tiles configured"
          : "No tile source configured; showing private route shape only"}
      </div>
    </div>
  );
}

function ZoneBars({ zones }: { zones: WorkoutZoneDuration[] }) {
  return (
    <div className="grid gap-3">
      {zones.map((zone) => (
        <div key={zone.key} className="grid gap-2">
          <div className="flex items-center justify-between gap-3 text-sm">
            <span className="text-white/72">{zone.label}</span>
            <span className="text-white">
              {(zone.percentage * 100).toFixed(1)}% · {formatMinutes(zone.seconds)}
            </span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-white/[0.08]">
            <div
              className="h-full rounded-full"
              style={{
                width: `${Math.max(1, zone.percentage * 100)}%`,
                background: ZONE_COLORS[zone.key] ?? "#f8fafc"
              }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

export function WorkoutDetailPage() {
  const { workoutId = "" } = useParams();
  const queryClient = useQueryClient();
  const detailQuery = useQuery({
    queryKey: ["workout-detail", workoutId],
    queryFn: () => getWorkoutDetail(workoutId),
    enabled: workoutId.length > 0
  });
  const detail = detailQuery.data as WorkoutSessionDetailPayload | undefined;
  const [meaningText, setMeaningText] = useState("");
  const [tagsText, setTagsText] = useState("");

  useEffect(() => {
    if (!detail?.workout) {
      return;
    }
    setMeaningText(detail.workout.meaningText ?? "");
    setTagsText(detail.workout.tags.join(", "));
  }, [detail?.workout]);

  const saveMutation = useMutation({
    mutationFn: () =>
      patchWorkoutSession(workoutId, {
        meaningText,
        tags: tagsText
          .split(",")
          .map((tag) => tag.trim())
          .filter(Boolean)
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["workout-detail", workoutId] });
      await queryClient.invalidateQueries({ queryKey: ["forge-fitness"] });
    }
  });

  if (detailQuery.isLoading) {
    return <SurfaceSkeleton title="Loading workout" />;
  }
  if (detailQuery.isError || !detail) {
    return (
      <ErrorState
        eyebrow="Workout detail"
        error={detailQuery.error ?? new Error("Forge could not load this workout detail.")}
        onRetry={() => void detailQuery.refetch()}
      />
    );
  }

  const { workout, analytics, evidence } = detail;
  const heartRateSeries = evidence.timeSeries
    .filter((sample) => sample.metricKey === "heart_rate")
    .map((sample) => ({
      time: new Date(sample.startedAt).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit"
      }),
      bpm: sample.value
    }));
  const zoneChartData = analytics.zoneDurations.map((zone) => ({
    zone: zone.label,
    minutes: Math.round(zone.seconds / 60),
    fill: ZONE_COLORS[zone.key] ?? "#f8fafc"
  }));

  return (
    <div className="grid gap-6">
      <Link
        to="/sports"
        className="inline-flex w-fit items-center gap-2 text-sm text-white/62 transition hover:text-white"
      >
        <ArrowLeft className="size-4" />
        Back to sports
      </Link>

      <PageHero
        eyebrow="Workout evidence"
        title={workout.workoutTypeLabel ?? workout.workoutType}
        description={`${formatWindow(workout.startedAt, workout.endedAt)} · ${workout.sourceDevice || "Apple Health"}`}
        actions={
          <div className="flex flex-wrap gap-2">
            <Badge>{formatMinutes(workout.durationSeconds)}</Badge>
            <Badge tone="meta">{analytics.confidence} HR zones</Badge>
            {analytics.routeSummary?.hasRoute ? (
              <Badge tone="meta">{analytics.routeSummary.pointCount} route points</Badge>
            ) : null}
          </div>
        }
      />

      <section className="grid gap-4 lg:grid-cols-4">
        <Card>
          <div className="text-sm text-white/58">Avg HR</div>
          <div className="mt-3 font-display text-4xl text-white">
            {analytics.hrSummary.averageHr ?? workout.averageHeartRate ?? "n/a"}
          </div>
          <div className="mt-1 text-sm text-white/48">bpm</div>
        </Card>
        <Card>
          <div className="text-sm text-white/58">Max HR</div>
          <div className="mt-3 font-display text-4xl text-white">
            {analytics.hrSummary.maxHr ?? workout.maxHeartRate ?? "n/a"}
          </div>
          <div className="mt-1 text-sm text-white/48">bpm</div>
        </Card>
        <Card>
          <div className="text-sm text-white/58">Training load</div>
          <div className="mt-3 font-display text-4xl text-white">
            {analytics.load.trimp ?? "n/a"}
          </div>
          <div className="mt-1 text-sm text-white/48">Forge TRIMP</div>
        </Card>
        <Card>
          <div className="text-sm text-white/58">HR coverage</div>
          <div className="mt-3 font-display text-4xl text-white">
            {Math.round((analytics.dataQuality.sampleCoverage ?? 0) * 100)}%
          </div>
          <div className="mt-1 text-sm text-white/48">
            {analytics.dataQuality.heartRateSampleCount ?? 0} samples
          </div>
        </Card>
      </section>

      <section className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1.25fr)_minmax(280px,0.75fr)]">
        <Card className="min-h-[360px] min-w-0 overflow-hidden">
          <div className="flex items-center gap-2 text-white">
            <HeartPulse className="size-4 text-[var(--primary)]" />
            Heart-rate timeline
          </div>
          <div className="mt-4 h-[300px]">
            {heartRateSeries.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={heartRateSeries}>
                  <defs>
                    <linearGradient id="hrFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#ef4444" stopOpacity={0.38} />
                      <stop offset="100%" stopColor="#ef4444" stopOpacity={0.04} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke="rgba(255,255,255,0.08)" vertical={false} />
                  <XAxis dataKey="time" interval="preserveStartEnd" tick={{ fill: "rgba(255,255,255,0.55)", fontSize: 11 }} />
                  <YAxis tick={{ fill: "rgba(255,255,255,0.55)", fontSize: 11 }} width={42} />
                  <Tooltip
                    contentStyle={{
                      background: "rgba(8,12,22,0.94)",
                      border: "1px solid rgba(255,255,255,0.12)",
                      borderRadius: 8,
                      color: "white"
                    }}
                  />
                  <Area
                    type="monotone"
                    dataKey="bpm"
                    stroke="#ef4444"
                    fill="url(#hrFill)"
                    strokeWidth={2}
                    dot={false}
                  />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <div className="grid h-full place-items-center rounded-[8px] bg-white/[0.035] text-sm text-white/54">
                No raw HR timeline has been synced for this workout yet.
              </div>
            )}
          </div>
        </Card>

        <Card className="min-w-0 overflow-hidden">
          <div className="flex items-center gap-2 text-white">
            <Activity className="size-4 text-[var(--primary)]" />
            Zone mix
          </div>
          <div className="mt-4">
            <ZoneBars zones={analytics.zoneDurations} />
          </div>
          <div className="mt-5 h-[180px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={zoneChartData}>
                <XAxis dataKey="zone" tick={{ fill: "rgba(255,255,255,0.55)", fontSize: 10 }} />
                <YAxis tick={{ fill: "rgba(255,255,255,0.55)", fontSize: 10 }} width={34} />
                <Tooltip
                  contentStyle={{
                    background: "rgba(8,12,22,0.94)",
                    border: "1px solid rgba(255,255,255,0.12)",
                    borderRadius: 8,
                    color: "white"
                  }}
                />
                <Bar dataKey="minutes" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </section>

      <section className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <Card className="min-w-0 overflow-hidden">
          <div className="flex items-center gap-2 text-white">
            <MapPinned className="size-4 text-[var(--primary)]" />
            Route
          </div>
          <div className="mt-4">
            {evidence.routePoints.length > 1 ? (
              <RoutePreview points={evidence.routePoints} />
            ) : (
              <div className="grid min-h-[240px] place-items-center rounded-[8px] bg-white/[0.035] text-sm text-white/54">
                No route evidence is available for this workout.
              </div>
            )}
          </div>
        </Card>

        <Card className="min-w-0 overflow-hidden">
          <div className="text-white">Captured metrics</div>
          <div className="mt-4 grid gap-3">
            {(workout.details?.metrics ?? []).slice(0, 14).map((metric) => (
              <div
                key={`${metric.category}:${metric.key}:${metric.statistic}`}
                className="rounded-[8px] bg-white/[0.04] px-3 py-2"
              >
                <div className="text-sm text-white/58">{metric.label}</div>
                <div className="mt-1 text-white">
                  {formatMetricValue(metric.value, metric.unit)}
                </div>
              </div>
            ))}
          </div>
        </Card>
      </section>

      <section className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(280px,0.7fr)]">
        <Card className="min-w-0 overflow-hidden">
          <div className="text-white">Events and phases</div>
          <div className="mt-4 grid gap-3">
            {[...(workout.details?.events ?? []), ...(workout.details?.components ?? [])]
              .slice(0, 18)
              .map((entry) => (
                <div
                  key={`${"type" in entry ? entry.type : entry.externalUid}:${entry.startedAt}`}
                  className="rounded-[8px] bg-white/[0.04] px-4 py-3"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-white">
                      {"label" in entry ? entry.label : entry.activity.canonicalLabel}
                    </div>
                    <Badge tone="meta">{formatMinutes(entry.durationSeconds)}</Badge>
                  </div>
                  <div className="mt-1 text-sm text-white/52">
                    {formatWindow(entry.startedAt, entry.endedAt ?? entry.startedAt)}
                  </div>
                </div>
              ))}
            {(workout.details?.events?.length ?? 0) +
              (workout.details?.components?.length ?? 0) ===
            0 ? (
              <div className="rounded-[8px] bg-white/[0.035] p-4 text-sm text-white/52">
                No provider events or phases were captured.
              </div>
            ) : null}
          </div>
        </Card>

        <Card className="min-w-0 overflow-hidden">
          <div className="text-white">Reflection</div>
          <div className="mt-4 grid gap-4">
            <label className="grid gap-2">
              <span className="text-sm text-white/58">Meaning and impact</span>
              <Textarea
                className="min-h-[160px]"
                value={meaningText}
                onChange={(event) => setMeaningText(event.target.value)}
              />
            </label>
            <label className="grid gap-2">
              <span className="text-sm text-white/58">Tags</span>
              <Input
                value={tagsText}
                onChange={(event) => setTagsText(event.target.value)}
              />
            </label>
            <Button
              type="button"
              pending={saveMutation.isPending}
              pendingLabel="Saving"
              onClick={() => saveMutation.mutate()}
            >
              <Save className="size-4" />
              Save reflection
            </Button>
          </div>
        </Card>
      </section>
    </div>
  );
}
