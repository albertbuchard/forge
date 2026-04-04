import { Bot, Users, UserRound, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { UserBadge } from "@/components/ui/user-badge";
import type { UserSummary } from "@/lib/types";
import { cn } from "@/lib/utils";

function toggleUser(selectedUserIds: string[], userId: string) {
  return selectedUserIds.includes(userId)
    ? selectedUserIds.filter((entry) => entry !== userId)
    : [...selectedUserIds, userId];
}

export function UserScopeSelector({
  users,
  selectedUserIds,
  onChange,
  className
}: {
  users: UserSummary[];
  selectedUserIds: string[];
  onChange: (userIds: string[]) => void;
  className?: string;
}) {
  const selectedUsers = users.filter((user) => selectedUserIds.includes(user.id));
  const humanIds = users.filter((user) => user.kind === "human").map((user) => user.id);
  const botIds = users.filter((user) => user.kind === "bot").map((user) => user.id);

  return (
    <div className={cn("grid gap-3", className)}>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className={cn(
            "inline-flex min-h-10 items-center gap-2 rounded-full border px-3 py-2 text-sm transition",
            selectedUserIds.length === 0
              ? "border-[rgba(192,193,255,0.28)] bg-[rgba(192,193,255,0.14)] text-white"
              : "border-white/8 bg-white/[0.04] text-white/62 hover:bg-white/[0.08] hover:text-white"
          )}
          onClick={() => onChange([])}
        >
          <Users className="size-4" />
          All visible users
        </button>
        <button
          type="button"
          className="inline-flex min-h-10 items-center gap-2 rounded-full border border-white/8 bg-white/[0.04] px-3 py-2 text-sm text-white/62 transition hover:bg-white/[0.08] hover:text-white"
          onClick={() => onChange(humanIds)}
        >
          <UserRound className="size-4" />
          Humans
        </button>
        <button
          type="button"
          className="inline-flex min-h-10 items-center gap-2 rounded-full border border-white/8 bg-white/[0.04] px-3 py-2 text-sm text-white/62 transition hover:bg-white/[0.08] hover:text-white"
          onClick={() => onChange(botIds)}
        >
          <Bot className="size-4" />
          Bots
        </button>
        {selectedUserIds.length > 0 ? (
          <Button variant="ghost" size="sm" onClick={() => onChange([])}>
            <X className="size-4" />
            Clear
          </Button>
        ) : null}
      </div>

      <div className="flex flex-wrap gap-2">
        {users.map((user) => {
          const selected = selectedUserIds.includes(user.id);
          return (
            <button
              key={user.id}
              type="button"
              className={cn(
                "rounded-full transition",
                selected ? "" : "opacity-80 hover:opacity-100"
              )}
              onClick={() => onChange(toggleUser(selectedUserIds, user.id))}
            >
              <UserBadge
                user={user}
                compact
                className={selected ? "ring-1 ring-white/18" : ""}
              />
            </button>
          );
        })}
      </div>

      {selectedUsers.length > 0 ? (
        <div className="text-sm text-white/52">
          Showing records for {selectedUsers.map((user) => user.displayName).join(", ")}.
        </div>
      ) : (
        <div className="text-sm text-white/52">
          Showing all visible human and bot records.
        </div>
      )}
    </div>
  );
}
