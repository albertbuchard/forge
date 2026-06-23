import { useMemo, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { Bot, Check, UserRound, Users } from "lucide-react";
import { ModalCloseButton } from "@/components/ui/modal-close-button";
import type { UserSummary } from "@/lib/types";
import { cn } from "@/lib/utils";
import {
  shellDialogContentClassName,
  shellDialogDescriptionClassName,
  shellDialogOverlayClassName,
  shellDialogTitleClassName
} from "./shell-style-tokens";

export function sameUserScope(left: string[], right: string[]) {
  if (left.length !== right.length) {
    return false;
  }
  const leftKey = [...left].sort().join("|");
  const rightKey = [...right].sort().join("|");
  return leftKey === rightKey;
}

function getInitials(label: string) {
  const parts = label
    .split(/\s+/)
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length === 0) {
    return "??";
  }
  if (parts.length === 1) {
    return parts[0].slice(0, 2).toUpperCase();
  }
  return `${parts[0][0] ?? ""}${parts[1][0] ?? ""}`.toUpperCase();
}

function buildUserScopeOptions(users: UserSummary[]) {
  const humans = users.filter((user) => user.kind === "human");
  const bots = users.filter((user) => user.kind === "bot");
  return [
    {
      id: "all",
      label: "All",
      shortLabel: "All",
      description: "Show every human and bot together.",
      userIds: [] as string[],
      token: "ALL",
      icon: Users
    },
    {
      id: "humans",
      label: "Humans",
      shortLabel: "Humans",
      description: "Focus only on human-owned work.",
      userIds: humans.map((user) => user.id),
      token: "HU",
      icon: UserRound
    },
    {
      id: "bots",
      label: "Bots",
      shortLabel: "Bots",
      description: "Focus only on bot-owned work.",
      userIds: bots.map((user) => user.id),
      token: "AI",
      icon: Bot
    },
    ...users.map((user) => ({
      id: user.id,
      label: user.displayName,
      shortLabel: user.displayName,
      description: `${user.kind === "human" ? "Human" : "Bot"} · ${user.handle}`,
      userIds: [user.id],
      token: getInitials(user.displayName),
      icon: user.kind === "human" ? UserRound : Bot
    }))
  ];
}

function resolveUserScopeOption(
  users: UserSummary[],
  selectedUserIds: string[]
) {
  return (
    buildUserScopeOptions(users).find((option) =>
      sameUserScope(selectedUserIds, option.userIds)
    ) ?? {
      id: "custom",
      label:
        selectedUserIds.length > 1
          ? `${selectedUserIds.length} selected`
          : "Custom",
      shortLabel:
        selectedUserIds.length > 1
          ? `${selectedUserIds.length} selected`
          : "Custom",
      description: "Using a custom combination of users.",
      userIds: selectedUserIds,
      token: selectedUserIds.length > 1 ? String(selectedUserIds.length) : "C",
      icon: Users
    }
  );
}

export function UserScopeSelector({
  users,
  selectedUserIds,
  onChange,
  compact = false
}: {
  users: UserSummary[];
  selectedUserIds: string[];
  onChange: (userIds: string[]) => void;
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const options = useMemo(() => buildUserScopeOptions(users), [users]);
  const activeOption = useMemo(
    () => resolveUserScopeOption(users, selectedUserIds),
    [selectedUserIds, users]
  );
  const ActiveScopeIcon = activeOption.icon;

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>
        <button
          type="button"
          className={cn(
            "shell-scope-trigger inline-flex items-center gap-2",
            compact ? "px-2.5 text-[12px]" : "px-3.5 text-[13px]"
          )}
        >
          <span className="shell-scope-avatar">
            {activeOption.id === "all" ? (
              <ActiveScopeIcon className="size-3.5" />
            ) : (
              activeOption.token
            )}
          </span>
          <span
            className={cn(
              "truncate text-left",
              compact ? "max-w-[7.5rem]" : "max-w-[11rem]"
            )}
          >
            {activeOption.shortLabel}
          </span>
        </button>
      </Dialog.Trigger>

      <Dialog.Portal>
        <Dialog.Overlay className={shellDialogOverlayClassName} />
        <Dialog.Content
          className={cn(
            shellDialogContentClassName,
            "top-[12vh] w-[min(40rem,calc(100vw-1.5rem))]"
          )}
        >
          <div className="flex items-start justify-between gap-4">
            <div>
              <Dialog.Title className={shellDialogTitleClassName}>
                Choose user scope
              </Dialog.Title>
              <Dialog.Description className={shellDialogDescriptionClassName}>
                Change which humans and bots shape the current Forge view.
              </Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <ModalCloseButton aria-label="Close user scope dialog" />
            </Dialog.Close>
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {options.map((option) => {
              const selected = sameUserScope(selectedUserIds, option.userIds);
              const Icon = option.icon;
              return (
                <button
                  key={option.id}
                  type="button"
                  className={cn(
                    "flex items-center justify-between gap-3 rounded-[24px] border px-4 py-4 text-left transition",
                    selected
                      ? "border-[color-mix(in_srgb,var(--primary)_26%,transparent)] bg-[var(--ui-surface-active)] text-[var(--ui-ink-strong)]"
                      : "border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] text-[var(--ui-ink-medium)] hover:bg-[var(--ui-surface-hover)] hover:text-[var(--ui-ink-strong)]"
                  )}
                  onClick={() => {
                    onChange(option.userIds);
                    setOpen(false);
                  }}
                >
                  <span className="flex min-w-0 items-center gap-3">
                    <span className="shell-scope-avatar">
                      <Icon className="size-3.5" />
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-[14px] font-semibold">
                        {option.label}
                      </span>
                      <span className="mt-1 block text-[12px] leading-5 text-[var(--ui-ink-soft)]">
                        {option.description}
                      </span>
                    </span>
                  </span>
                  {selected ? (
                    <Check className="size-4 shrink-0 text-[var(--primary)]" />
                  ) : null}
                </button>
              );
            })}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
