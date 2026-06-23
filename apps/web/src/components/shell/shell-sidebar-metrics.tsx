import type { ComponentType, SVGProps } from "react";
import { Activity, BatteryCharging, Clock3, Flame, Zap } from "lucide-react";

import { InfoTooltip } from "@/components/ui/info-tooltip";
import type { TranslationKey } from "@/lib/i18n";
import { formatLifeForceRate } from "@/lib/life-force-display";
import { SHELL_METRIC_HELP } from "@/lib/surface-help";
import type { ForgeSnapshot } from "@/lib/types";
import { cn } from "@/lib/utils";

type Translate = (
  key: TranslationKey,
  params?: Record<string, string | number | null | undefined>
) => string;

type SidebarMetric = {
  id: keyof typeof SHELL_METRIC_HELP | "ap" | "instant-ap";
  label: string;
  compactValue: string;
  expandedValue: string;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
};

export function buildSidebarMetrics(
  snapshot: ForgeSnapshot,
  t: Translate
): SidebarMetric[] {
  return [
    {
      id: "ap",
      label: "AP",
      compactValue: snapshot.lifeForce
        ? String(Math.round(snapshot.lifeForce.remainingAp))
        : "0",
      expandedValue: snapshot.lifeForce
        ? `${Math.round(snapshot.lifeForce.remainingAp)} AP left`
        : "AP unavailable",
      icon: BatteryCharging
    },
    {
      id: "instant-ap",
      label: "Instant AP/h",
      compactValue: snapshot.lifeForce
        ? String(Number(snapshot.lifeForce.instantFreeApPerHour.toFixed(1)))
        : "0",
      expandedValue: snapshot.lifeForce
        ? formatLifeForceRate(snapshot.lifeForce.instantFreeApPerHour)
        : "0 AP/h",
      icon: Clock3
    },
    {
      id: "streak",
      label: t("common.shell.momentum.streak"),
      compactValue: String(snapshot.metrics.streakDays),
      expandedValue: t(
        snapshot.metrics.streakDays === 1
          ? "common.shell.momentum.streakBadgeOne"
          : "common.shell.momentum.streakBadgeOther",
        {
          count: snapshot.metrics.streakDays
        }
      ),
      icon: Flame
    },
    {
      id: "xp",
      label: t("common.shell.momentum.xp"),
      compactValue: String(snapshot.metrics.totalXp),
      expandedValue: `${snapshot.metrics.totalXp} XP`,
      icon: Zap
    },
    {
      id: "momentum",
      label: t("common.shell.momentum.momentum"),
      compactValue: `${snapshot.metrics.momentumScore}%`,
      expandedValue: t("common.shell.momentum.liveMomentum", {
        count: snapshot.metrics.momentumScore
      }),
      icon: Activity
    }
  ];
}

export function SidebarMetricsPanel({
  metrics,
  collapsed
}: {
  metrics: SidebarMetric[];
  collapsed: boolean;
}) {
  return (
    <div className={cn(collapsed ? "mt-4" : "mt-6")}>
      <div
        className={cn(
          "rounded-[24px] bg-[var(--ui-surface-1)]",
          collapsed ? "px-2 py-2.5" : "p-4"
        )}
      >
        {!collapsed ? (
          <div className="type-label text-[var(--ui-ink-faint)]">
            Live metrics
          </div>
        ) : null}
        <div className={cn("grid", collapsed ? "gap-1.5" : "mt-3 gap-3")}>
          {metrics.map((metric) => (
            <SidebarMetricItem
              key={metric.id}
              metric={metric}
              collapsed={collapsed}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function SidebarMetricItem({
  metric,
  collapsed
}: {
  metric: SidebarMetric;
  collapsed: boolean;
}) {
  const Icon = metric.icon;

  if (collapsed) {
    return (
      <div
        title={`${metric.label}: ${metric.compactValue}`}
        className="flex min-w-0 flex-col items-center gap-1 rounded-[16px] bg-[var(--ui-surface-1)] px-1 py-2.5 text-center"
      >
        <Icon className="size-3.5 shrink-0 text-[var(--ui-ink-faint)]" />
        <div className="max-w-full text-[12px] font-semibold leading-none text-[var(--ui-ink-strong)]">
          {metric.compactValue}
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-[18px] bg-[var(--ui-surface-1)] px-3 py-3">
      <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-[0.14em] text-[var(--ui-ink-faint)]">
        <span>{metric.label}</span>
        <InfoTooltip
          label={`Explain ${metric.label}`}
          title={metric.label}
          content={
            SHELL_METRIC_HELP[metric.id] ??
            "This is a live Forge shell metric for the selected user scope."
          }
          panelClassName="normal-case tracking-normal"
        />
      </div>
      <div className="mt-1 text-lg font-semibold leading-tight text-[var(--ui-ink-strong)]">
        {metric.expandedValue}
      </div>
    </div>
  );
}
