import type { HTMLAttributes } from "react";
import { Badge } from "@/components/ui/badge";
import { getEntityVisual, type EntityKind } from "@/lib/entity-visuals";
import { cn } from "@/lib/utils";

export type EntityBadgeProps = HTMLAttributes<HTMLSpanElement> & {
  kind: EntityKind;
  label?: string;
  compact?: boolean;
  showIcon?: boolean;
  iconOnly?: boolean;
  gradient?: boolean;
  wrap?: boolean;
};

export function EntityBadge({
  kind,
  label,
  compact = false,
  showIcon = true,
  iconOnly = false,
  gradient = true,
  wrap = false,
  className,
  ...props
}: EntityBadgeProps) {
  const visual = getEntityVisual(kind);
  const Icon = visual.icon;

  return (
    <Badge
      size={compact ? "sm" : "md"}
      wrap={wrap}
      className={cn(
        "max-w-full min-w-0 gap-1.5 border font-medium",
        gradient ? visual.badgeClassName : visual.subtleBadgeClassName,
        compact && !iconOnly && "px-2.5",
        iconOnly && "px-2.5",
        className
      )}
      {...props}
    >
      {showIcon ? <Icon className={cn("size-3.5 shrink-0", visual.iconClassName)} /> : null}
      {iconOnly ? null : <span className={cn("min-w-0 max-w-full", wrap ? "whitespace-normal break-words [overflow-wrap:anywhere]" : "truncate")}>{label ?? visual.label}</span>}
    </Badge>
  );
}
