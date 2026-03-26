import type { HTMLAttributes, ReactNode } from "react";
import { EntityBadge } from "@/components/ui/entity-badge";
import { getEntityVisual, type EntityKind } from "@/lib/entity-visuals";
import { cn } from "@/lib/utils";

export type EntityNameProps = HTMLAttributes<HTMLSpanElement> & {
  kind: EntityKind;
  label: ReactNode;
  variant?: "inline" | "heading" | "pill";
  size?: "sm" | "md" | "lg" | "xl";
  showKind?: boolean;
  showIcon?: boolean;
  showBadge?: boolean;
  badgeLabel?: string;
  badgeCompact?: boolean;
  badgeGradient?: boolean;
  lines?: 1 | 2 | 3;
  labelClassName?: string;
};

const headingSizeClassName = {
  sm: "text-base",
  md: "text-lg",
  lg: "text-2xl",
  xl: "text-3xl"
} as const;

const lineClampClassName = {
  1: "truncate whitespace-nowrap",
  2: "overflow-hidden whitespace-normal [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:2]",
  3: "overflow-hidden whitespace-normal [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:3]"
} as const;

export function EntityName({
  kind,
  label,
  variant = "inline",
  size = "md",
  showKind = false,
  showIcon = true,
  showBadge = false,
  badgeLabel,
  badgeCompact = true,
  badgeGradient = false,
  lines = 1,
  labelClassName,
  className,
  ...props
}: EntityNameProps) {
  const visual = getEntityVisual(kind);
  const Icon = visual.icon;

  if (variant === "pill") {
    return (
      <span
        className={cn(
          "inline-flex max-w-full items-center gap-2 rounded-full border px-4 py-2 font-medium shadow-[0_10px_28px_rgba(3,8,18,0.18)]",
          visual.badgeClassName,
          className
        )}
        {...props}
      >
        {showIcon ? <Icon className={cn("size-4 shrink-0", visual.iconClassName)} /> : null}
        <span className={cn("min-w-0 max-w-full", lineClampClassName[lines], labelClassName)}>{label}</span>
      </span>
    );
  }

  if (variant === "heading") {
    return (
      <span className={cn("inline-flex max-w-full min-w-0 items-center gap-3", className)} {...props}>
        {showBadge ? <EntityBadge kind={kind} label={badgeLabel ?? visual.label} compact={badgeCompact} gradient={badgeGradient} className="shrink-0" /> : null}
        {showKind && !showBadge ? <EntityBadge kind={kind} label={badgeLabel ?? visual.label} compact gradient={false} className="shrink-0" /> : null}
        <span className={cn("min-w-0 max-w-full font-display leading-tight", headingSizeClassName[size], lineClampClassName[lines], visual.nameClassName, labelClassName)}>{label}</span>
      </span>
    );
  }

  return (
    <span className={cn("inline-flex max-w-full min-w-0 items-center gap-2", className)} {...props}>
      {showIcon ? <Icon className={cn("size-4 shrink-0", visual.iconClassName)} /> : null}
      {showBadge ? <EntityBadge kind={kind} label={badgeLabel ?? visual.label} compact={badgeCompact} gradient={badgeGradient} className="shrink-0" /> : null}
      {showKind ? <span className={cn("text-sm font-medium", visual.nameClassName)}>{visual.label}</span> : null}
      <span className={cn("min-w-0 max-w-full", lineClampClassName[lines], visual.nameClassName, labelClassName)}>{label}</span>
    </span>
  );
}
