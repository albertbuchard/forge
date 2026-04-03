import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { getEntityVisual, type EntityKind } from "@/lib/entity-visuals";
import { cn } from "@/lib/utils";

export type HeroCopyMode = "title_only" | "title_plus_orientation";

function normalizeCopyValue(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, " ");
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
  const entityLabelValue = entityKind ? normalizeCopyValue(getEntityVisual(entityKind).label) : null;

  if (!eyebrowValue) {
    return null;
  }

  if (titleValue && (eyebrowValue === titleValue || titleValue.includes(eyebrowValue) || eyebrowValue.includes(titleValue))) {
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
  const resolvedEyebrow = resolveHeroMeta({ eyebrow, titleText, entityKind, copyMode });
  const hasHeaderMeta = Boolean(entityVisual || resolvedEyebrow || badge);

  return (
    <section className="grid w-full max-w-full min-w-0 gap-1.5 rounded-[24px] bg-[var(--hero-gradient)] px-4 py-2.5 shadow-[var(--card-shadow)] lg:grid-cols-[minmax(0,1fr)_auto] lg:px-5 lg:py-3">
      <div className="min-w-0">
        {hasHeaderMeta ? (
          <div className="flex flex-wrap items-center gap-3">
            {entityVisual && Icon ? (
              <div
                className={cn(
                  "inline-flex size-8 shrink-0 items-center justify-center rounded-full border bg-white/[0.04] shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]",
                  entityVisual.subtleBadgeClassName
                )}
                aria-label={entityVisual.label}
                title={entityVisual.label}
              >
                <Icon className={cn("size-4", entityVisual.iconClassName)} />
              </div>
            ) : null}
            {resolvedEyebrow ? <div className="type-label text-[var(--secondary)]">{resolvedEyebrow}</div> : null}
            {badge ? <Badge tone="signal" className="bg-white/[0.08] text-white/78">{badge}</Badge> : null}
          </div>
        ) : null}
        <div className={cn("max-w-4xl text-[clamp(1.2rem,1.85vw,1.7rem)] leading-[1] text-white", hasHeaderMeta ? "mt-1.5" : "")}>{title}</div>
        <div className="mt-1 hidden max-w-3xl text-[13px] leading-5 text-white/54 sm:block">{description}</div>
      </div>
      {actions ? <div className="flex min-w-0 flex-wrap items-start gap-2 lg:justify-end">{actions}</div> : null}
    </section>
  );
}
