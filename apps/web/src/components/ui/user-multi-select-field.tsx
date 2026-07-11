import { Search, X } from "lucide-react";
import { useId, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { UserBadge } from "@/components/ui/user-badge";
import type { UserSummary } from "@/lib/types";

export function UserMultiSelectField({
  value,
  users,
  onChange,
  label = "Assignees",
  help
}: {
  value: string[];
  users: UserSummary[];
  onChange: (userIds: string[]) => void;
  label?: string;
  help?: string;
}) {
  const fieldId = useId();
  const [query, setQuery] = useState("");
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const selectedIds = useMemo(() => new Set(value), [value]);
  const visibleUsers = useMemo(
    () =>
      users.filter((user) => {
        if (!normalizedQuery) {
          return true;
        }
        return `${user.displayName} ${user.kind}`
          .toLocaleLowerCase()
          .includes(normalizedQuery);
      }),
    [normalizedQuery, users]
  );

  const toggleUser = (userId: string) => {
    onChange(
      selectedIds.has(userId)
        ? value.filter((candidate) => candidate !== userId)
        : [...value, userId]
    );
  };

  return (
    <fieldset className="grid min-w-0 gap-2">
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
        <legend className="text-sm font-medium text-[var(--ui-ink-strong)]">
          {label}
        </legend>
        <span className="text-xs text-[var(--ui-ink-soft)]" aria-live="polite">
          {value.length} selected
        </span>
      </div>
      {help ? (
        <span className="text-xs leading-5 text-[var(--ui-ink-soft)]">
          {help}
        </span>
      ) : null}
      {users.length > 5 ? (
        <div className="relative">
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[var(--ui-ink-faint)]"
          />
          <Input
            id={`${fieldId}-search`}
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="pl-9"
            placeholder="Search people and agents"
            aria-label={`Search ${label.toLocaleLowerCase()}`}
          />
        </div>
      ) : null}
      <div className="max-h-64 overflow-y-auto overscroll-contain rounded-[var(--radius-control)] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] p-2">
        {visibleUsers.length > 0 ? (
          <div className="grid gap-1">
            {visibleUsers.map((user) => {
              const checked = selectedIds.has(user.id);
              return (
                <label
                  key={user.id}
                  className="flex min-w-0 cursor-pointer items-center gap-3 rounded-[var(--radius-control)] px-3 py-2.5 transition hover:bg-[var(--ui-surface-hover)]"
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleUser(user.id)}
                    className="size-4 shrink-0 accent-[var(--primary)]"
                  />
                  <span className="min-w-0 flex-1">
                    <UserBadge user={user} />
                  </span>
                </label>
              );
            })}
          </div>
        ) : (
          <div
            role="status"
            className="px-3 py-5 text-sm text-[var(--ui-ink-soft)]"
          >
            No people or agents match this search.
          </div>
        )}
      </div>
      {value.length > 0 ? (
        <div className="flex justify-end">
          <Button
            type="button"
            variant="ghost"
            className="px-2 text-xs"
            onClick={() => onChange([])}
          >
            <X className="size-4" />
            Clear assignees
          </Button>
        </div>
      ) : null}
    </fieldset>
  );
}
