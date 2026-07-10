import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { InfoTooltip } from "@/components/ui/info-tooltip";
import { getEntityVisual, type EntityKind } from "@/lib/entity-visuals";
import { cn } from "@/lib/utils";

export type HeroCopyMode = "title_only" | "title_plus_orientation";

function normalizeCopyValue(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ");
}

function resolveHeroMeta({
  eyebrow,
  titleText,
  entityKind,
  copyMode
}: {
  eyebrow?: ReactNode;
  titleText?: string;
  entityKind?: EntityKind;
  copyMode: HeroCopyMode;
}) {
  if (!eyebrow || copyMode === "title_only" || typeof eyebrow !== "string") {
    return null;
  }

  const eyebrowValue = normalizeCopyValue(eyebrow);
  const titleValue = titleText ? normalizeCopyValue(titleText) : null;
  const entityLabelValue = entityKind
    ? normalizeCopyValue(getEntityVisual(entityKind).label)
    : null;

  if (!eyebrowValue) {
    return null;
  }

  if (
    titleValue &&
    (eyebrowValue === titleValue ||
      titleValue.includes(eyebrowValue) ||
      eyebrowValue.includes(titleValue))
  ) {
    return null;
  }

  if (entityLabelValue && eyebrowValue === entityLabelValue) {
    return null;
  }

  return eyebrow;
}

export function PageHero({
  eyebrow,
  entityKind,
  title,
  titleText,
  description,
  helpTitle,
  helpContent,
  helpLabel,
  badge,
  actions,
  copyMode = "title_only"
}: {
  eyebrow?: ReactNode;
  entityKind?: EntityKind;
  title: ReactNode;
  titleText?: string;
  description: ReactNode;
  helpTitle?: string;
  helpContent?: ReactNode;
  helpLabel?: string;
  badge?: ReactNode;
  actions?: ReactNode;
  copyMode?: HeroCopyMode;
}) {
  const entityVisual = entityKind ? getEntityVisual(entityKind) : null;
  const Icon = entityVisual?.icon;
  const resolvedEyebrow = resolveHeroMeta({
    eyebrow,
    titleText,
    entityKind,
    copyMode
  });
  const resolvedTitleText =
    titleText ?? (typeof title === "string" ? title : "this page");
  const resolvedHelpContent =
    helpContent ?? (typeof description === "string" ? description : null);
  const hasHeaderMeta = Boolean(entityVisual || resolvedEyebrow || badge);
  return (
    <header
      className="relative min-w-0 w-full max-w-full overflow-visible border-b border-[var(--ui-border-subtle)] px-5 py-5 sm:px-6 lg:grid lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end lg:px-7 lg:py-6"
      style={{
        background: "var(--hero-gradient)",
        paddingTop: "var(--forge-shell-hero-padding-top)",
        paddingBottom: "var(--forge-shell-hero-padding-bottom)"
      }}
    >
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(circle at top right, color-mix(in srgb, var(--forge-body-ambient-primary) 94%, transparent), transparent 34%)"
        }}
      />
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-[var(--ui-border-strong)]" />
      <div className="relative min-w-0 w-full max-w-full">
        {hasHeaderMeta ? (
          <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2 text-[11px] font-medium uppercase tracking-[0.2em] text-[var(--ui-ink-faint)]">
            {entityVisual && Icon ? (
              <span
                className="inline-flex items-center gap-2 text-[var(--ui-ink-soft)]"
                aria-label={entityVisual.label}
                title={entityVisual.label}
              >
                <Icon className={cn("size-3.5", entityVisual.iconClassName)} />
                <span>{entityVisual.label}</span>
              </span>
            ) : null}
            {resolvedEyebrow ? (
              <span className="text-[var(--secondary)]/80">
                {resolvedEyebrow}
              </span>
            ) : null}
            {badge ? (
              <Badge
                tone="signal"
                className="h-8 overflow-visible rounded-full border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] px-3 text-[11px] font-medium tracking-[0.14em] text-[var(--ui-ink-medium)] uppercase"
              >
                {badge}
              </Badge>
            ) : null}
          </div>
        ) : null}
        <div
          className={cn(
            "flex min-w-0 max-w-4xl items-start gap-2",
            hasHeaderMeta ? "mt-3" : ""
          )}
        >
          <div
            className="min-w-0 text-[clamp(1.85rem,3.5vw,4rem)] font-medium leading-[0.92] text-[var(--ui-ink-strong)]"
            style={{
              transform:
                "translateY(var(--forge-shell-hero-title-translate-y)) scale(var(--forge-shell-hero-title-scale))",
              transformOrigin: "top left"
            }}
          >
            {title}
          </div>
          {resolvedHelpContent ? (
            <InfoTooltip
              className="mt-2 shrink-0"
              label={
                helpLabel ??
                `Explain what the ${resolvedTitleText} page shows and how to interpret it`
              }
              title={helpTitle ?? `${resolvedTitleText} explained`}
              content={resolvedHelpContent}
            />
          ) : null}
        </div>
        <div
          className="mt-2 min-w-0 max-w-3xl text-[14px] leading-6 text-[var(--ui-ink-soft)] sm:text-[15px]"
          style={{
            opacity: "var(--forge-shell-hero-description-opacity)",
            transform:
              "translateY(var(--forge-shell-hero-description-translate-y))"
          }}
        >
          {description}
        </div>
      </div>
      {actions ? (
        <div className="relative mt-4 flex min-w-0 w-full max-w-full flex-wrap items-center gap-2 lg:mt-0 lg:max-w-[26rem] lg:justify-end">
          {actions}
        </div>
      ) : null}
    </header>
  );
}
