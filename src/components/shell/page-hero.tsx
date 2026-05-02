import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
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
  badge,
  actions,
  copyMode = "title_only"
}: {
  eyebrow?: ReactNode;
  entityKind?: EntityKind;
  title: ReactNode;
  titleText?: string;
  description: ReactNode;
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
  const hasHeaderMeta = Boolean(entityVisual || resolvedEyebrow || badge);
  return (
    <header
      className="relative min-w-0 w-full max-w-full overflow-visible border-b border-white/6 px-5 py-5 sm:px-6 lg:grid lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end lg:px-7 lg:py-6"
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
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-white/10" />
      <div className="relative min-w-0 w-full max-w-full">
        {hasHeaderMeta ? (
          <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2 text-[11px] font-medium uppercase tracking-[0.2em] text-white/40">
            {entityVisual && Icon ? (
              <span
                className="inline-flex items-center gap-2 text-white/56"
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
                className="h-8 overflow-visible rounded-full border border-white/8 bg-white/[0.04] px-3 text-[11px] font-medium tracking-[0.14em] text-white/80 uppercase"
              >
                {badge}
              </Badge>
            ) : null}
          </div>
        ) : null}
        <div
          className={cn(
            "min-w-0 max-w-4xl text-[clamp(1.85rem,3.5vw,4rem)] font-medium leading-[0.92] text-white",
            hasHeaderMeta ? "mt-3" : ""
          )}
          style={{
            transform:
              "translateY(var(--forge-shell-hero-title-translate-y)) scale(var(--forge-shell-hero-title-scale))",
            transformOrigin: "top left",
            willChange: "transform"
          }}
        >
          {title}
        </div>
        <div
          className="mt-2 min-w-0 max-w-3xl text-[14px] leading-6 text-white/58 sm:text-[15px]"
          style={{
            opacity: "var(--forge-shell-hero-description-opacity)",
            transform:
              "translateY(var(--forge-shell-hero-description-translate-y))",
            willChange: "opacity, transform"
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
