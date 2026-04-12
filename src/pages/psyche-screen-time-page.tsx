import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";
import { PsycheSectionNav } from "@/components/psyche/psyche-section-nav";
import { SurfaceSkeleton } from "@/components/experience/surface-skeleton";
import { PageHero } from "@/components/shell/page-hero";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ErrorState } from "@/components/ui/page-state";
import {
  getScreenTimeAllTime,
  getScreenTimeDay,
  getScreenTimeMonth,
  getScreenTimeSettings
} from "@/lib/api";

type ScreenTimeView = "day" | "month" | "all_time";

function captureFreshnessClass(freshness: "empty" | "fresh" | "stale" | "unavailable") {
  switch (freshness) {
    case "fresh":
      return "bg-[rgba(110,231,183,0.12)] text-[var(--tertiary)]";
    case "stale":
      return "bg-[rgba(255,196,114,0.12)] text-[rgba(255,220,163,0.96)]";
    case "unavailable":
      return "bg-[rgba(255,115,115,0.12)] text-[rgba(255,171,171,0.96)]";
    default:
      return "bg-white/[0.06] text-white/72";
  }
}

function durationLabel(seconds: number) {
  if (seconds >= 3600) {
    return `${(seconds / 3600).toFixed(1)}h`;
  }
  return `${Math.round(seconds / 60)}m`;
}

function dayHourLabel(hourIndex: number) {
  return `${String(hourIndex).padStart(2, "0")}:00`;
}

function weekdayLabel(weekday: number) {
  return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][weekday] ?? "Day";
}

function captureRangeLabel(
  startedAt: string | null,
  endedAt: string | null,
  fallback: string
) {
  if (!startedAt || !endedAt) {
    return fallback;
  }
  return `${new Date(startedAt).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  })} → ${new Date(endedAt).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  })}`;
}

function tooltipMetricFormatter(value: unknown, name: string) {
  const numericValue =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value)
        : 0;
  return [
    name === "totalActivitySeconds" || name === "averageActivitySeconds"
      ? durationLabel(numericValue)
      : String(Math.round(numericValue)),
    name === "totalActivitySeconds"
      ? "Activity"
      : name === "averageActivitySeconds"
        ? "Avg activity"
        : name === "pickupCount" || name === "averagePickups"
          ? name === "averagePickups"
            ? "Avg pickups"
            : "Pickups"
          : name === "averageNotifications"
            ? "Avg notifications"
            : "Notifications"
  ] as const;
}

export function PsycheScreenTimePage() {
  const [view, setView] = useState<ScreenTimeView>("day");
  const settingsQuery = useQuery({
    queryKey: ["forge-screen-time-settings"],
    queryFn: () => getScreenTimeSettings().then((response) => response.settings)
  });
  const dayQuery = useQuery({
    queryKey: ["forge-screen-time-day"],
    queryFn: () => getScreenTimeDay().then((response) => response.screenTime)
  });
  const monthQuery = useQuery({
    queryKey: ["forge-screen-time-month"],
    queryFn: () => getScreenTimeMonth().then((response) => response.screenTime)
  });
  const allTimeQuery = useQuery({
    queryKey: ["forge-screen-time-all-time"],
    queryFn: () => getScreenTimeAllTime().then((response) => response.screenTime)
  });

  const isLoading =
    settingsQuery.isLoading ||
    dayQuery.isLoading ||
    monthQuery.isLoading ||
    allTimeQuery.isLoading;
  if (isLoading) {
    return <SurfaceSkeleton />;
  }

  const error =
    settingsQuery.error ?? dayQuery.error ?? monthQuery.error ?? allTimeQuery.error;
  if (
    error ||
    !settingsQuery.data ||
    !dayQuery.data ||
    !monthQuery.data ||
    !allTimeQuery.data
  ) {
    return (
      <ErrorState
        eyebrow="Psyche"
        error={error}
        onRetry={() => {
          void settingsQuery.refetch();
          void dayQuery.refetch();
          void monthQuery.refetch();
          void allTimeQuery.refetch();
        }}
      />
    );
  }

  const settings = settingsQuery.data;
  const day = dayQuery.data;
  const month = monthQuery.data;
  const allTime = allTimeQuery.data;
  const topFocus = day.topApps
    .slice(0, 3)
    .map((app) => app.displayName || app.bundleIdentifier);
  const captureSource =
    typeof settings.metadata.snapshot_source === "string"
      ? settings.metadata.snapshot_source.replaceAll("_", " ")
      : "device activity report";

  return (
    <div className="space-y-5">
      <PageHero
        title="Screen Time"
        titleText="Screen Time"
        description="Apple-compliant device activity, hourly usage, and reflective phone context woven into Psyche."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="default" className="bg-white/[0.06] text-white/78">
              {settings.authorizationStatus.replaceAll("_", " ")}
            </Badge>
            <Badge tone="default" className="bg-white/[0.06] text-white/78">
              {settings.captureState.replaceAll("_", " ")}
            </Badge>
            <Badge
              tone="default"
              className={captureFreshnessClass(settings.captureFreshness)}
            >
              {settings.captureFreshness}
            </Badge>
            <Badge tone="default" className="bg-white/[0.06] text-white/78">
              {settings.syncEnabled ? "Sync on" : "Sync paused"}
            </Badge>
          </div>
        }
      />

      <PsycheSectionNav />

      <Card className="rounded-[30px] border border-white/8 bg-[linear-gradient(180deg,rgba(12,18,34,0.96),rgba(8,13,24,0.92))] p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="font-label text-[11px] uppercase tracking-[0.2em] text-white/40">
              Reflective device activity
            </div>
            <div className="mt-2 max-w-3xl text-sm text-white/58">
              Forge treats Screen Time as reflective evidence, not as fake exact foreground traces. Movement overlap is estimated from hourly bins and stays truthful about that.
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {(["day", "month", "all_time"] as const).map((option) => (
              <Button
                key={option}
                variant="ghost"
                className={
                  view === option
                    ? "h-9 rounded-full border border-[rgba(110,231,183,0.2)] bg-[rgba(110,231,183,0.12)] px-4 text-[var(--tertiary)]"
                    : "h-9 rounded-full border border-white/10 bg-white/[0.04] px-4 text-white/70"
                }
                onClick={() => setView(option)}
              >
                {option === "all_time" ? "All time" : option}
              </Button>
            ))}
          </div>
        </div>

	        <div className="mt-5 grid gap-3 md:grid-cols-3">
	          <Card className="rounded-[24px] border border-white/8 bg-white/[0.04] p-4">
            <div className="font-label text-[10px] uppercase tracking-[0.18em] text-white/38">
              Today on screen
            </div>
            <div className="mt-3 font-display text-4xl text-white">
              {durationLabel(day.summary.totalActivitySeconds)}
            </div>
            <div className="mt-2 text-sm text-white/56">
              Across {day.summary.activeHourCount} active hours.
            </div>
          </Card>
          <Card className="rounded-[24px] border border-white/8 bg-white/[0.04] p-4">
            <div className="font-label text-[10px] uppercase tracking-[0.18em] text-white/38">
              Pickups today
            </div>
            <div className="mt-3 font-display text-4xl text-white">
              {day.summary.pickupCount}
            </div>
            <div className="mt-2 text-sm text-white/56">
              First pickup {day.summary.firstPickupAt ? new Date(day.summary.firstPickupAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "not captured"}.
            </div>
          </Card>
	          <Card className="rounded-[24px] border border-white/8 bg-white/[0.04] p-4">
	            <div className="font-label text-[10px] uppercase tracking-[0.18em] text-white/38">
	              Capture health
	            </div>
	            <div className="mt-3 text-lg text-white">
                {settings.captureFreshness === "fresh"
                  ? settings.captureAgeHours !== null
                    ? `Updated ${settings.captureAgeHours.toFixed(1)}h ago`
                    : "Fresh capture"
                  : settings.captureFreshness === "stale"
                    ? settings.captureAgeHours !== null
                      ? `Last refresh ${settings.captureAgeHours.toFixed(1)}h ago`
                      : "Capture is stale"
                    : settings.captureFreshness === "unavailable"
                      ? "Unavailable"
                      : "Waiting for capture"}
	            </div>
	            <div className="mt-2 text-sm text-white/56">
                {settings.capturedDayCount} days, {settings.capturedHourCount} hourly slices, {settings.captureWindowDays} day window.
	            </div>
	          </Card>
	        </div>

        <Card className="rounded-[28px] border border-white/8 bg-white/[0.03] p-4">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="default" className="bg-white/[0.06] text-white/74">
              {captureSource}
            </Badge>
            <Badge tone="default" className="bg-white/[0.06] text-white/74">
              Hourly model
            </Badge>
            <Badge tone="default" className="bg-white/[0.06] text-white/74">
              {captureRangeLabel(
                settings.lastCaptureStartedAt,
                settings.lastCaptureEndedAt,
                "No captured range yet"
              )}
            </Badge>
            {topFocus.map((label) => (
              <Badge key={label} tone="default" className="bg-[rgba(114,204,255,0.12)] text-white/78">
                {label}
              </Badge>
            ))}
          </div>
        </Card>
	      </Card>

      {view === "day" ? (
        <section className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(18rem,1fr)]">
          <Card className="rounded-[30px] border border-white/8 bg-[linear-gradient(180deg,rgba(13,20,36,0.96),rgba(8,13,24,0.9))] p-5">
            <div className="font-label text-[11px] uppercase tracking-[0.2em] text-white/40">
              Hourly rhythm
            </div>
            <div className="mt-2 text-sm text-white/58">
              Activity, pickups, and notification pressure across the day.
            </div>
            <div className="mt-5 h-72">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={day.hourlySegments}>
                  <CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false} />
                  <XAxis
                    dataKey="hourIndex"
                    tickFormatter={dayHourLabel}
                    stroke="rgba(255,255,255,0.34)"
                    tickLine={false}
                    axisLine={false}
                  />
                  <YAxis
                    stroke="rgba(255,255,255,0.34)"
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={(value) => durationLabel(Number(value))}
                  />
                  <Tooltip
                    contentStyle={{
                      background: "rgba(8,12,20,0.96)",
                      border: "1px solid rgba(255,255,255,0.08)",
                      borderRadius: "18px"
                    }}
                    formatter={(value, name) =>
                      tooltipMetricFormatter(value, String(name))
                    }
                    labelFormatter={(value) => dayHourLabel(Number(value))}
                  />
                  <Area
                    type="monotone"
                    dataKey="totalActivitySeconds"
                    stroke="rgba(110,231,183,0.96)"
                    fill="rgba(110,231,183,0.18)"
                    strokeWidth={2}
                  />
                  <Area
                    type="monotone"
                    dataKey="pickupCount"
                    stroke="rgba(114,204,255,0.9)"
                    fill="rgba(114,204,255,0.12)"
                    strokeWidth={1.6}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </Card>

          <div className="space-y-4">
            <Card className="rounded-[28px] border border-white/8 bg-white/[0.04] p-5">
              <div className="font-label text-[11px] uppercase tracking-[0.2em] text-white/40">
                Top apps
              </div>
              <div className="mt-4 space-y-3">
                {day.topApps.slice(0, 6).map((app) => (
                  <div key={app.id} className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium text-white">
                        {app.displayName || app.bundleIdentifier}
                      </div>
                      <div className="truncate text-xs text-white/48">
                        {app.categoryLabel || app.bundleIdentifier}
                      </div>
                    </div>
                    <div className="text-sm text-white/68">
                      {durationLabel(app.totalActivitySeconds)}
                    </div>
                  </div>
                ))}
              </div>
            </Card>

            <Card className="rounded-[28px] border border-white/8 bg-white/[0.04] p-5">
              <div className="font-label text-[11px] uppercase tracking-[0.2em] text-white/40">
                Top categories
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                {day.topCategories.slice(0, 8).map((category) => (
                  <Badge key={category.id} tone="default" className="bg-white/[0.06] text-white/74">
                    {category.categoryLabel} · {durationLabel(category.totalActivitySeconds)}
                  </Badge>
                ))}
              </div>
            </Card>
          </div>
        </section>
      ) : null}

      {view === "month" ? (
        <section className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(18rem,1fr)]">
          <Card className="rounded-[30px] border border-white/8 bg-[linear-gradient(180deg,rgba(13,20,36,0.96),rgba(8,13,24,0.9))] p-5">
            <div className="font-label text-[11px] uppercase tracking-[0.2em] text-white/40">
              Monthly drift
            </div>
            <div className="mt-5 h-72">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={month.days}>
                  <CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false} />
                  <XAxis dataKey="dateKey" stroke="rgba(255,255,255,0.34)" tickLine={false} axisLine={false} />
                  <YAxis stroke="rgba(255,255,255,0.34)" tickLine={false} axisLine={false} tickFormatter={(value) => durationLabel(Number(value))} />
                  <Tooltip
                    contentStyle={{
                      background: "rgba(8,12,20,0.96)",
                      border: "1px solid rgba(255,255,255,0.08)",
                      borderRadius: "18px"
                    }}
                    formatter={(value, name) =>
                      tooltipMetricFormatter(value, String(name))
                    }
                  />
                  <Area
                    type="monotone"
                    dataKey="totalActivitySeconds"
                    stroke="rgba(255,255,255,0.94)"
                    fill="rgba(255,255,255,0.12)"
                    strokeWidth={2}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </Card>

          <Card className="rounded-[28px] border border-white/8 bg-white/[0.04] p-5">
            <div className="font-label text-[11px] uppercase tracking-[0.2em] text-white/40">
              Month summary
            </div>
            <div className="mt-4 space-y-3 text-sm text-white/70">
              <div className="flex items-center justify-between gap-3">
                <span>Total activity</span>
                <span>{durationLabel(month.totals.totalActivitySeconds)}</span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span>Pickups</span>
                <span>{month.totals.pickupCount}</span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span>Notifications</span>
                <span>{month.totals.notificationCount}</span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span>Active days</span>
                <span>{month.totals.activeDays}</span>
              </div>
            </div>
          </Card>
        </section>
      ) : null}

      {view === "all_time" ? (
        <section className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(18rem,1fr)]">
          <Card className="rounded-[30px] border border-white/8 bg-[linear-gradient(180deg,rgba(13,20,36,0.96),rgba(8,13,24,0.9))] p-5">
            <div className="font-label text-[11px] uppercase tracking-[0.2em] text-white/40">
              Weekday pattern
            </div>
            <div className="mt-5 h-72">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={allTime.weekdayPattern}>
                  <CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false} />
                  <XAxis dataKey="weekday" tickFormatter={weekdayLabel} stroke="rgba(255,255,255,0.34)" tickLine={false} axisLine={false} />
                  <YAxis stroke="rgba(255,255,255,0.34)" tickLine={false} axisLine={false} tickFormatter={(value) => durationLabel(Number(value))} />
                  <Tooltip
                    contentStyle={{
                      background: "rgba(8,12,20,0.96)",
                      border: "1px solid rgba(255,255,255,0.08)",
                      borderRadius: "18px"
                    }}
                    formatter={(value, name) =>
                      tooltipMetricFormatter(value, String(name))
                    }
                    labelFormatter={(value) => weekdayLabel(Number(value))}
                  />
                  <Area
                    type="monotone"
                    dataKey="averageActivitySeconds"
                    stroke="rgba(114,204,255,0.96)"
                    fill="rgba(114,204,255,0.16)"
                    strokeWidth={2}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </Card>

          <div className="space-y-4">
            <Card className="rounded-[28px] border border-white/8 bg-white/[0.04] p-5">
              <div className="font-label text-[11px] uppercase tracking-[0.2em] text-white/40">
                Lifetime summary
              </div>
              <div className="mt-4 space-y-3 text-sm text-white/70">
                <div className="flex items-center justify-between gap-3">
                  <span>Days captured</span>
                  <span>{allTime.summary.dayCount}</span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span>Total activity</span>
                  <span>{durationLabel(allTime.summary.totalActivitySeconds)}</span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span>Average per day</span>
                  <span>{durationLabel(allTime.summary.averageDailyActivitySeconds)}</span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span>Total pickups</span>
                  <span>{allTime.summary.totalPickups}</span>
                </div>
              </div>
            </Card>
            <Card className="rounded-[28px] border border-white/8 bg-white/[0.04] p-5">
              <div className="font-label text-[11px] uppercase tracking-[0.2em] text-white/40">
                Dominant categories
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                {allTime.topCategories.slice(0, 10).map((category) => (
                  <Badge key={category.id} tone="default" className="bg-white/[0.06] text-white/74">
                    {category.categoryLabel} · {durationLabel(category.totalActivitySeconds)}
                  </Badge>
                ))}
              </div>
            </Card>
          </div>
        </section>
      ) : null}
    </div>
  );
}
