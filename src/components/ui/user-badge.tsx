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
        className={cn("border-white/10 bg-white/[0.05] text-white/55", className)}
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
        "max-w-full gap-1.5 border text-white",
        user.kind === "bot"
          ? "border-cyan-300/18 bg-cyan-400/12 text-cyan-50"
          : "border-amber-300/18 bg-amber-400/12 text-amber-50",
        size === "xs" && "gap-1",
        className
      )}
    >
      <Icon className={cn(size === "xs" ? "size-3" : "size-3.5", "shrink-0")} />
      <span className="truncate">{user.displayName}</span>
      <span className="text-white/55">{user.kind}</span>
    </Badge>
  );
}
