import { Bot, UserRound } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { UserSummary } from "@/lib/types";
import { cn } from "@/lib/utils";

export function UserBadge({
  user,
  compact = false,
  size,
  className
}: {
  user: UserSummary | null | undefined;
  compact?: boolean;
  size?: "xs" | "sm" | "md";
  className?: string;
}) {
  if (!user) {
    return (
      <Badge
        size={size ?? (compact ? "sm" : "md")}
        className={cn(
          "border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] text-[var(--ui-ink-soft)]",
          className
        )}
      >
        Unassigned
      </Badge>
    );
  }

  const Icon = user.kind === "bot" ? Bot : UserRound;

  return (
    <Badge
      size={size ?? (compact ? "sm" : "md")}
      className={cn(
        "max-w-full gap-1.5 border",
        user.kind === "bot"
          ? "border-[color-mix(in_srgb,var(--info)_24%,transparent)] bg-[var(--ui-info-soft)] text-[color-mix(in_srgb,var(--info)_78%,var(--ui-ink-strong)_22%)]"
          : "border-[color-mix(in_srgb,var(--warning)_24%,transparent)] bg-[var(--ui-warning-soft)] text-[color-mix(in_srgb,var(--warning)_78%,var(--ui-ink-strong)_22%)]",
        size === "xs" && "gap-1",
        className
      )}
    >
      <Icon className={cn(size === "xs" ? "size-3" : "size-3.5", "shrink-0")} />
      <span className="truncate">{user.displayName}</span>
      <span className="text-[var(--ui-ink-faint)]">{user.kind}</span>
    </Badge>
  );
}
