import { useId, type ReactNode } from "react";
import {
  AlertTriangle,
  Ban,
  CheckCircle2,
  CloudOff,
  Database,
  Radio,
  RefreshCw,
  TriangleAlert
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type {
  PeopleAvailability,
  PeopleConnectionSummary,
  PeopleFreshnessState
} from "@/components/people/people-types";

export function formatPeopleDateTime(value: string | null | undefined) {
  if (!value) {
    return "Not available";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(date);
}

function freshnessIcon(state: PeopleFreshnessState) {
  switch (state) {
    case "live":
      return Radio;
    case "cached":
      return Database;
    case "stale":
      return AlertTriangle;
    case "offline":
      return CloudOff;
    case "revoked":
      return Ban;
    case "unavailable":
      return TriangleAlert;
  }
}

function freshnessClass(state: PeopleFreshnessState) {
  switch (state) {
    case "live":
      return "border-[var(--ui-success-border)] bg-[var(--ui-success-soft)] text-[var(--success)]";
    case "cached":
      return "border-[color-mix(in_srgb,var(--info)_28%,var(--ui-border-subtle)_72%)] bg-[var(--ui-info-soft)] text-[var(--info)]";
    case "stale":
    case "offline":
      return "border-[color-mix(in_srgb,var(--warning)_30%,var(--ui-border-subtle)_70%)] bg-[var(--ui-warning-soft)] text-[var(--warning)]";
    case "revoked":
      return "border-[color-mix(in_srgb,var(--danger)_30%,var(--ui-border-subtle)_70%)] bg-[var(--ui-danger-soft)] text-[var(--danger)]";
    case "unavailable":
      return "border-[var(--ui-border-strong)] bg-[var(--ui-surface-2)] text-[var(--ui-ink-muted)]";
  }
}

export function FreshnessBadge({
  state,
  label,
  className
}: {
  state: PeopleFreshnessState;
  label?: string;
  className?: string;
}) {
  const Icon = freshnessIcon(state);
  return (
    <Badge
      size="xs"
      className={cn(freshnessClass(state), className)}
      data-freshness={state}
    >
      <Icon className="size-3" aria-hidden="true" />
      {label ?? state.replaceAll("_", " ")}
    </Badge>
  );
}

function availabilityPresentation(availability: PeopleAvailability) {
  if (availability === "online") {
    return {
      Icon: CheckCircle2,
      className:
        "border-[var(--ui-success-border)] bg-[var(--ui-success-soft)] text-[var(--ui-ink-medium)]"
    };
  }
  if (availability === "degraded") {
    return {
      Icon: AlertTriangle,
      className:
        "border-[color-mix(in_srgb,var(--warning)_30%,var(--ui-border-subtle)_70%)] bg-[var(--ui-warning-soft)] text-[var(--ui-ink-medium)]"
    };
  }
  return {
    Icon: CloudOff,
    className:
      "border-[color-mix(in_srgb,var(--warning)_30%,var(--ui-border-subtle)_70%)] bg-[var(--ui-warning-soft)] text-[var(--ui-ink-medium)]"
  };
}

export function ConnectionBanner({
  connection,
  partial = false,
  onRetry
}: {
  connection: PeopleConnectionSummary;
  partial?: boolean;
  onRetry?: () => void;
}) {
  if (connection.availability === "online" && !partial) {
    return null;
  }
  const { Icon, className } = availabilityPresentation(connection.availability);
  return (
    <div
      role={connection.availability === "offline" ? "alert" : "status"}
      aria-live="polite"
      className={cn(
        "grid min-w-0 grid-cols-[auto_minmax(0,1fr)] items-start gap-x-2.5 gap-y-1 rounded-lg border px-3 py-2 text-left text-sm sm:flex sm:flex-wrap sm:items-center sm:gap-3",
        className
      )}
    >
      <Icon className="mt-0.5 size-4 shrink-0 sm:mt-0" aria-hidden="true" />
      <span className="min-w-0 flex-1">{connection.label}</span>
      {onRetry ? (
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="col-start-2 min-h-9 justify-self-start px-2 sm:min-h-11 sm:justify-self-auto sm:px-3"
          onClick={onRetry}
        >
          <RefreshCw className="size-3.5" aria-hidden="true" />
          Refresh
        </Button>
      ) : null}
    </div>
  );
}

export function PeopleStateBanner({
  state,
  title,
  children
}: {
  state: "warning" | "danger" | "info";
  title: string;
  children: ReactNode;
}) {
  const Icon =
    state === "danger" ? Ban : state === "warning" ? AlertTriangle : Database;
  return (
    <div
      role={state === "danger" ? "alert" : "status"}
      className={cn(
        "grid min-w-0 grid-cols-[auto_minmax(0,1fr)] gap-3 rounded-lg border px-3 py-3",
        state === "danger"
          ? "border-[color-mix(in_srgb,var(--danger)_32%,var(--ui-border-subtle)_68%)] bg-[var(--ui-danger-soft)]"
          : state === "warning"
            ? "border-[color-mix(in_srgb,var(--warning)_32%,var(--ui-border-subtle)_68%)] bg-[var(--ui-warning-soft)]"
            : "border-[color-mix(in_srgb,var(--info)_28%,var(--ui-border-subtle)_72%)] bg-[var(--ui-info-soft)]"
      )}
    >
      <Icon
        className={cn(
          "mt-0.5 size-4",
          state === "danger"
            ? "text-[var(--danger)]"
            : state === "warning"
              ? "text-[var(--warning)]"
              : "text-[var(--info)]"
        )}
        aria-hidden="true"
      />
      <div className="min-w-0">
        <div className="text-sm font-semibold text-[var(--ui-ink-strong)]">
          {title}
        </div>
        <div className="mt-1 text-sm leading-6 text-[var(--ui-ink-medium)]">
          {children}
        </div>
      </div>
    </div>
  );
}

export function PeopleSection({
  title,
  description,
  actions,
  children,
  className,
  headingLevel = 2
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  headingLevel?: 2 | 3;
}) {
  const generatedId = useId();
  const headingId = `people-section-${generatedId.replaceAll(":", "")}`;
  const Heading = headingLevel === 3 ? "h3" : "h2";

  return (
    <section
      className={cn(
        "min-w-0 border-t border-[var(--ui-border-subtle)] py-5 first:border-t-0 first:pt-0",
        className
      )}
      aria-labelledby={headingId}
    >
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <Heading
            id={headingId}
            className="text-base font-semibold text-[var(--ui-ink-strong)]"
          >
            {title}
          </Heading>
          {description ? (
            <p className="mt-1 max-w-3xl text-sm leading-6 text-[var(--ui-ink-muted)]">
              {description}
            </p>
          ) : null}
        </div>
        {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
      </div>
      <div className="mt-4 min-w-0">{children}</div>
    </section>
  );
}

export function InlineEmpty({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-lg border border-dashed border-[var(--ui-border-strong)] px-4 py-6 text-center text-sm text-[var(--ui-ink-muted)]">
      {children}
    </p>
  );
}
