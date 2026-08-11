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
import type { ScreenTimeSettingsPayload } from "@/lib/types";
import { cn } from "@/lib/utils";

type ScreenTimeView = "day" | "month" | "all_time";

const panelClass =
  "min-w-0 rounded-[8px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-section)] p-5 shadow-[var(--card-shadow)]";
const subCardClass =
  "min-w-0 rounded-[8px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] p-4";
const roomyCardClass =
  "min-w-0 rounded-[8px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] p-5";
const labelClass =
  "font-label text-[11px] uppercase tracking-[0.18em] text-[var(--ui-ink-faint)]";
const smallLabelClass =
  "font-label text-[10px] uppercase tracking-[0.18em] text-[var(--ui-ink-faint)]";
const mutedTextClass = "text-[var(--ui-ink-soft)]";
const badgeClass =
  "border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)] text-[var(--ui-ink-medium)]";
const infoBadgeClass =
  "border border-[color-mix(in_srgb,var(--info)_30%,var(--ui-border-subtle)_70%)] bg-[var(--ui-info-soft)] text-[color-mix(in_srgb,var(--info)_74%,var(--ui-ink-strong)_26%)]";
const chartGridStroke = "var(--ui-border-subtle)";
const chartAxisStroke = "var(--ui-ink-faint)";
const chartPrimaryStroke =
  "color-mix(in_srgb,var(--success)_82%,var(--primary)_18%)";
const chartPrimaryFill = "color-mix(in_srgb,var(--success)_18%,transparent)";
const chartInfoStroke = "color-mix(in_srgb,var(--info)_86%,var(--primary)_14%)";
const chartInfoFill = "color-mix(in_srgb,var(--info)_16%,transparent)";
const chartNeutralStroke = "var(--ui-ink-strong)";
const chartNeutralFill =
  "color-mix(in_srgb,var(--ui-ink-strong)_12%,transparent)";
const tooltipStyle = {
  background: "var(--ui-surface-modal)",
  border: "1px solid var(--ui-border-subtle)",
  borderRadius: "8px",
  color: "var(--ui-ink-strong)"
};

function captureFreshnessClass(
  freshness: "empty" | "fresh" | "stale" | "unavailable"
) {
  switch (freshness) {
    case "fresh":
      return "border border-[color-mix(in_srgb,var(--success)_30%,var(--ui-border-subtle)_70%)] bg-[var(--ui-success-soft)] text-[color-mix(in_srgb,var(--success)_74%,var(--ui-ink-strong)_26%)]";
    case "stale":
      return "border border-[color-mix(in_srgb,var(--warning)_30%,var(--ui-border-subtle)_70%)] bg-[var(--ui-warning-soft)] text-[color-mix(in_srgb,var(--warning)_74%,var(--ui-ink-strong)_26%)]";
    case "unavailable":
      return "border border-[color-mix(in_srgb,var(--danger)_30%,var(--ui-border-subtle)_70%)] bg-[var(--ui-danger-soft)] text-[color-mix(in_srgb,var(--danger)_74%,var(--ui-ink-strong)_26%)]";
    default:
      return badgeClass;
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

function localDateKey(date = new Date()) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0")
  ].join("-");
}

function captureNotice(settings: ScreenTimeSettingsPayload) {
  if (settings.authorizationStatus === "denied") {
    return {
      title: "Screen Time access is denied",
      detail:
        "Previously synced history remains visible, but Forge will not receive new captures until permission is granted on the companion device."
    };
  }
  if (
    settings.authorizationStatus === "unavailable" ||
    settings.captureState === "unavailable"
  ) {
    return {
      title: "Screen Time capture is unavailable",
      detail:
        "This companion cannot provide new Screen Time snapshots. Any previously synced history remains visible."
    };
  }
  if (
    settings.authorizationStatus === "not_determined" ||
    settings.captureState === "needs_authorization"
  ) {
    return {
      title: "Screen Time permission is needed",
      detail:
        "Grant Screen Time access on the companion device before Forge can receive a device-activity snapshot."
    };
  }
  if (!settings.syncEnabled || settings.captureState === "sync_paused") {
    return {
      title: "Screen Time sync is paused",
      detail:
        "Existing history remains visible, but this page will not receive new snapshots while sync is paused."
    };
  }
  if (settings.captureFreshness === "empty") {
    return {
      title: "Waiting for the first Screen Time snapshot",
      detail:
        settings.captureState === "capturing" ||
        settings.captureState === "waiting_for_snapshot"
          ? "Permission is available and the companion is preparing its first device-activity snapshot."
          : "Permission is available, but no device-activity snapshot has been synced yet."
    };
  }
  if (settings.captureFreshness === "stale") {
    return {
      title: "Screen Time capture is stale",
      detail:
        settings.captureAgeHours !== null
          ? `The latest snapshot is ${settings.captureAgeHours.toFixed(1)} hours old. Treat these patterns as historical until the companion syncs again.`
          : "The latest stored snapshot is no longer fresh. Treat these patterns as historical until the companion syncs again."
    };
  }
  return null;
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
  const selectedDateKey =
    settingsQuery.data?.lastCapturedDayKey ?? localDateKey();
  const selectedMonthKey = selectedDateKey.slice(0, 7);
  const dayQuery = useQuery({
    queryKey: ["forge-screen-time-day", selectedDateKey],
    queryFn: () =>
      getScreenTimeDay({ date: selectedDateKey }).then(
        (response) => response.screenTime
      ),
    enabled: settingsQuery.isSuccess
  });
  const monthQuery = useQuery({
    queryKey: ["forge-screen-time-month", selectedMonthKey],
    queryFn: () =>
      getScreenTimeMonth({ month: selectedMonthKey }).then(
        (response) => response.screenTime
      ),
    enabled: settingsQuery.isSuccess
  });
  const allTimeQuery = useQuery({
    queryKey: ["forge-screen-time-all-time"],
    queryFn: () =>
      getScreenTimeAllTime().then((response) => response.screenTime)
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
    settingsQuery.error ??
    dayQuery.error ??
    monthQuery.error ??
    allTimeQuery.error;
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
  const notice = captureNotice(settings);
  const hasDayData =
    day.hourlySegments.length > 0 ||
    day.summary.totalActivitySeconds > 0 ||
    day.summary.pickupCount > 0 ||
    day.summary.notificationCount > 0;
  const hasMonthData = month.days.length > 0 || month.totals.activeDays > 0;
  const hasAllTimeData = allTime.summary.dayCount > 0;

  return (
    <div className="space-y-5">
      <PageHero
        title="Screen Time"
        titleText="Screen Time"
        description="Apple-compliant device activity, hourly usage, and reflective phone context woven into Psyche."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="default" className={badgeClass}>
              {settings.authorizationStatus.replaceAll("_", " ")}
            </Badge>
            <Badge tone="default" className={badgeClass}>
              {settings.captureState.replaceAll("_", " ")}
            </Badge>
            <Badge
              tone="default"
              className={captureFreshnessClass(settings.captureFreshness)}
            >
              {settings.captureFreshness}
            </Badge>
            <Badge tone="default" className={badgeClass}>
              {settings.syncEnabled ? "Sync on" : "Sync paused"}
            </Badge>
          </div>
        }
      />

      <PsycheSectionNav />

      {notice ? (
        <Card className={panelClass} role="status">
          <div className="text-base font-medium text-[var(--ui-ink-strong)]">
            {notice.title}
          </div>
          <div className={cn("mt-2 max-w-3xl text-sm", mutedTextClass)}>
            {notice.detail}
          </div>
        </Card>
      ) : null}

      <Card className={panelClass}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className={labelClass}>Reflective device activity</div>
            <div className={cn("mt-2 max-w-3xl text-sm", mutedTextClass)}>
              Forge treats Screen Time as reflective evidence, not as fake exact
              foreground traces. Movement overlap is estimated from hourly bins
              and stays truthful about that.
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {(["day", "month", "all_time"] as const).map((option) => (
              <Button
                key={option}
                variant="ghost"
                className={
                  view === option
                    ? "h-9 rounded-full border border-[color-mix(in_srgb,var(--success)_35%,var(--ui-border-subtle)_65%)] bg-[var(--ui-success-soft)] px-4 text-[color-mix(in_srgb,var(--success)_76%,var(--ui-ink-strong)_24%)]"
                    : "h-9 rounded-full border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)] px-4 text-[var(--ui-ink-soft)]"
                }
                onClick={() => setView(option)}
              >
                {option === "all_time" ? "All time" : option}
              </Button>
            ))}
          </div>
        </div>

        <div className="mt-5 grid gap-3 md:grid-cols-3">
          {hasDayData ? (
            <>
              <Card className={subCardClass}>
                <div className={smallLabelClass}>Captured day on screen</div>
                <div className="mt-3 font-display text-4xl text-[var(--ui-ink-strong)]">
                  {durationLabel(day.summary.totalActivitySeconds)}
                </div>
                <div className={cn("mt-2 text-sm", mutedTextClass)}>
                  {day.date} · {day.summary.activeHourCount} active hours.
                </div>
              </Card>
              <Card className={subCardClass}>
                <div className={smallLabelClass}>Pickups on captured day</div>
                <div className="mt-3 font-display text-4xl text-[var(--ui-ink-strong)]">
                  {day.summary.pickupCount}
                </div>
                <div className={cn("mt-2 text-sm", mutedTextClass)}>
                  First pickup{" "}
                  {day.summary.firstPickupAt
                    ? new Date(day.summary.firstPickupAt).toLocaleTimeString(
                        [],
                        {
                          hour: "2-digit",
                          minute: "2-digit"
                        }
                      )
                    : "not captured"}
                  .
                </div>
              </Card>
            </>
          ) : null}
          <Card className={subCardClass}>
            <div className={smallLabelClass}>Capture health</div>
            <div className="mt-3 text-lg text-[var(--ui-ink-strong)]">
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
            <div className={cn("mt-2 text-sm", mutedTextClass)}>
              {settings.capturedDayCount} days, {settings.capturedHourCount}{" "}
              hourly slices, {settings.captureWindowDays} day window.
            </div>
          </Card>
        </div>

        <Card className={cn("mt-3", subCardClass)}>
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="default" className={badgeClass}>
              {captureSource}
            </Badge>
            <Badge tone="default" className={badgeClass}>
              Hourly model
            </Badge>
            <Badge tone="default" className={badgeClass}>
              {captureRangeLabel(
                settings.lastCaptureStartedAt,
                settings.lastCaptureEndedAt,
                "No captured range yet"
              )}
            </Badge>
            {topFocus.map((label) => (
              <Badge key={label} tone="default" className={infoBadgeClass}>
                {label}
              </Badge>
            ))}
          </div>
        </Card>
      </Card>

      {view === "day" && !hasDayData ? (
        <Card className={panelClass}>
          <div className="text-base font-medium text-[var(--ui-ink-strong)]">
            No Screen Time snapshot for {day.date}
          </div>
          <div className={cn("mt-2 max-w-3xl text-sm", mutedTextClass)}>
            No hourly Screen Time data was synced for this device calendar day.
            Zero activity is not assumed.
          </div>
        </Card>
      ) : null}

      {view === "day" && hasDayData ? (
        <section className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(18rem,1fr)]">
          <Card className={panelClass}>
            <div className={labelClass}>Hourly rhythm</div>
            <div className={cn("mt-2 text-sm", mutedTextClass)}>
              Activity, pickups, and notification pressure across the day.
            </div>
            <div className="mt-5 h-72">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={day.hourlySegments}>
                  <CartesianGrid stroke={chartGridStroke} vertical={false} />
                  <XAxis
                    dataKey="hourIndex"
                    tickFormatter={dayHourLabel}
                    stroke={chartAxisStroke}
                    tickLine={false}
                    axisLine={false}
                  />
                  <YAxis
                    stroke={chartAxisStroke}
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={(value) => durationLabel(Number(value))}
                  />
                  <Tooltip
                    contentStyle={tooltipStyle}
                    formatter={(value, name) =>
                      tooltipMetricFormatter(value, String(name))
                    }
                    labelFormatter={(value) => dayHourLabel(Number(value))}
                  />
                  <Area
                    type="monotone"
                    dataKey="totalActivitySeconds"
                    stroke={chartPrimaryStroke}
                    fill={chartPrimaryFill}
                    strokeWidth={2}
                  />
                  <Area
                    type="monotone"
                    dataKey="pickupCount"
                    stroke={chartInfoStroke}
                    fill={chartInfoFill}
                    strokeWidth={1.6}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </Card>

          <div className="space-y-4">
            <Card className={roomyCardClass}>
              <div className={labelClass}>Top apps</div>
              <div className="mt-4 space-y-3">
                {day.topApps.length > 0 ? (
                  day.topApps.slice(0, 6).map((app) => (
                    <div
                      key={app.id}
                      className="flex items-center justify-between gap-3"
                    >
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium text-[var(--ui-ink-strong)]">
                          {app.displayName || app.bundleIdentifier}
                        </div>
                        <div className="truncate text-xs text-[var(--ui-ink-faint)]">
                          {app.categoryLabel || app.bundleIdentifier}
                        </div>
                      </div>
                      <div className="text-sm text-[var(--ui-ink-soft)]">
                        {durationLabel(app.totalActivitySeconds)}
                      </div>
                    </div>
                  ))
                ) : (
                  <div className={cn("text-sm", mutedTextClass)}>
                    App-level detail was not included in this snapshot.
                  </div>
                )}
              </div>
            </Card>

            <Card className={roomyCardClass}>
              <div className={labelClass}>Top categories</div>
              <div className="mt-4 flex flex-wrap gap-2">
                {day.topCategories.length > 0 ? (
                  day.topCategories.slice(0, 8).map((category) => (
                    <Badge
                      key={category.id}
                      tone="default"
                      className={badgeClass}
                    >
                      {category.categoryLabel} ·{" "}
                      {durationLabel(category.totalActivitySeconds)}
                    </Badge>
                  ))
                ) : (
                  <div className={cn("text-sm", mutedTextClass)}>
                    Category detail was not included in this snapshot.
                  </div>
                )}
              </div>
            </Card>
          </div>
        </section>
      ) : null}

      {view === "month" && !hasMonthData ? (
        <Card className={panelClass}>
          <div className="text-base font-medium text-[var(--ui-ink-strong)]">
            No monthly Screen Time history for {month.month}
          </div>
          <div className={cn("mt-2 text-sm", mutedTextClass)}>
            No captured days were synced for this device calendar month.
          </div>
        </Card>
      ) : null}

      {view === "month" && hasMonthData ? (
        <section className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(18rem,1fr)]">
          <Card className={panelClass}>
            <div className={labelClass}>Monthly drift</div>
            <div className="mt-5 h-72">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={month.days}>
                  <CartesianGrid stroke={chartGridStroke} vertical={false} />
                  <XAxis
                    dataKey="dateKey"
                    stroke={chartAxisStroke}
                    tickLine={false}
                    axisLine={false}
                  />
                  <YAxis
                    stroke={chartAxisStroke}
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={(value) => durationLabel(Number(value))}
                  />
                  <Tooltip
                    contentStyle={tooltipStyle}
                    formatter={(value, name) =>
                      tooltipMetricFormatter(value, String(name))
                    }
                  />
                  <Area
                    type="monotone"
                    dataKey="totalActivitySeconds"
                    stroke={chartNeutralStroke}
                    fill={chartNeutralFill}
                    strokeWidth={2}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </Card>

          <Card className={roomyCardClass}>
            <div className={labelClass}>Month summary</div>
            <div className="mt-4 space-y-3 text-sm text-[var(--ui-ink-soft)]">
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

      {view === "all_time" && !hasAllTimeData ? (
        <Card className={panelClass}>
          <div className="text-base font-medium text-[var(--ui-ink-strong)]">
            No Screen Time history yet
          </div>
          <div className={cn("mt-2 text-sm", mutedTextClass)}>
            Forge will show longer-term patterns after the first companion
            snapshot is synced.
          </div>
        </Card>
      ) : null}

      {view === "all_time" && hasAllTimeData ? (
        <section className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(18rem,1fr)]">
          <Card className={panelClass}>
            <div className={labelClass}>Weekday pattern</div>
            <div className="mt-5 h-72">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={allTime.weekdayPattern}>
                  <CartesianGrid stroke={chartGridStroke} vertical={false} />
                  <XAxis
                    dataKey="weekday"
                    tickFormatter={weekdayLabel}
                    stroke={chartAxisStroke}
                    tickLine={false}
                    axisLine={false}
                  />
                  <YAxis
                    stroke={chartAxisStroke}
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={(value) => durationLabel(Number(value))}
                  />
                  <Tooltip
                    contentStyle={tooltipStyle}
                    formatter={(value, name) =>
                      tooltipMetricFormatter(value, String(name))
                    }
                    labelFormatter={(value) => weekdayLabel(Number(value))}
                  />
                  <Area
                    type="monotone"
                    dataKey="averageActivitySeconds"
                    stroke={chartInfoStroke}
                    fill={chartInfoFill}
                    strokeWidth={2}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </Card>

          <div className="space-y-4">
            <Card className={roomyCardClass}>
              <div className={labelClass}>Lifetime summary</div>
              <div className="mt-4 space-y-3 text-sm text-[var(--ui-ink-soft)]">
                <div className="flex items-center justify-between gap-3">
                  <span>Days captured</span>
                  <span>{allTime.summary.dayCount}</span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span>Total activity</span>
                  <span>
                    {durationLabel(allTime.summary.totalActivitySeconds)}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span>Average per day</span>
                  <span>
                    {durationLabel(allTime.summary.averageDailyActivitySeconds)}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span>Total pickups</span>
                  <span>{allTime.summary.totalPickups}</span>
                </div>
              </div>
            </Card>
            <Card className={roomyCardClass}>
              <div className={labelClass}>Dominant categories</div>
              <div className="mt-4 flex flex-wrap gap-2">
                {allTime.topCategories.slice(0, 10).map((category) => (
                  <Badge
                    key={category.id}
                    tone="default"
                    className={badgeClass}
                  >
                    {category.categoryLabel} ·{" "}
                    {durationLabel(category.totalActivitySeconds)}
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
