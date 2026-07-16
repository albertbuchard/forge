import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { UserBadge } from "@/components/ui/user-badge";
import type {
  PreferenceDomain,
  PreferenceWorkspacePayload,
  UserSummary
} from "@/lib/types";
import { formatUserSummaryLine } from "@/lib/user-ownership";
import { cn } from "@/lib/utils";
import {
  DOMAIN_OPTIONS,
  TABS,
  type PreferencesTab
} from "./preferences-workspace-model";

export function PreferenceWorkspaceControls({
  users,
  user,
  selectedUserId,
  selectedDomain,
  workspace,
  onPatchSearch
}: {
  users: UserSummary[];
  user: UserSummary | null;
  selectedUserId: string;
  selectedDomain: PreferenceDomain;
  workspace: PreferenceWorkspacePayload;
  onPatchSearch: (patch: Record<string, string | null>) => void;
}) {
  return (
    <Card className="grid gap-4">
      <div className="grid gap-3 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
        <div className="grid gap-2">
          <div className="text-[11px] uppercase tracking-[0.16em] text-[var(--ui-ink-faint)]">
            Active user
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <select
              aria-label="Active preference user"
              value={selectedUserId}
              onChange={(event) =>
                onPatchSearch({
                  userId: event.target.value,
                  contextId: null,
                  focusItem: null
                })
              }
              className="min-h-11 rounded-[18px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)] px-3 text-sm text-[var(--ui-ink-strong)] outline-none transition focus:border-[var(--primary)]"
            >
              {users.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.displayName} · {entry.kind}
                </option>
              ))}
            </select>
            <UserBadge user={user} />
            <div className="text-sm text-[var(--ui-ink-soft)]">
              {formatUserSummaryLine(user)}
            </div>
          </div>
        </div>
        <div className="grid gap-2">
          <div className="text-[11px] uppercase tracking-[0.16em] text-[var(--ui-ink-faint)]">
            Domain
          </div>
          <div
            className="flex flex-wrap gap-2"
            role="group"
            aria-label="Preference domain"
          >
            {DOMAIN_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                aria-pressed={option.value === selectedDomain}
                className={cn(
                  "min-h-11 rounded-full border px-3 py-2 text-sm transition",
                  option.value === selectedDomain
                    ? "border-[var(--primary)] bg-[var(--ui-accent-soft)] text-[var(--ui-ink-strong)]"
                    : "border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] text-[var(--ui-ink-soft)] hover:bg-[var(--ui-surface-hover)] hover:text-[var(--ui-ink-strong)]"
                )}
                onClick={() =>
                  onPatchSearch({
                    domain: option.value,
                    contextId: null,
                    focusItem: null
                  })
                }
              >
                {option.label}
              </button>
            ))}
          </div>
          <div className="text-sm text-[var(--ui-ink-soft)]">
            {
              DOMAIN_OPTIONS.find((entry) => entry.value === selectedDomain)
                ?.description
            }
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-sm text-[var(--ui-ink-soft)]">
        <Badge className="bg-[var(--ui-surface-2)] text-[var(--ui-ink-medium)]">
          {workspace.selectedContext.name}
        </Badge>
        <span>{workspace.selectedContext.shareMode}</span>
        <span>·</span>
        <span>{workspace.compare.pendingCount} queued comparisons</span>
        <span>·</span>
        <span>{workspace.libraries.totalCatalogItems} concept items ready</span>
      </div>
    </Card>
  );
}

export function PreferenceWorkspaceTabNav({
  selectedTab,
  onSelectTab
}: {
  selectedTab: PreferencesTab;
  onSelectTab: (tab: PreferencesTab) => void;
}) {
  return (
    <div
      className="flex flex-wrap gap-2"
      role="group"
      aria-label="Preference views"
    >
      {TABS.map((tab) => (
        <button
          key={tab.id}
          type="button"
          aria-pressed={tab.id === selectedTab}
          className={cn(
            "inline-flex min-h-11 items-center gap-2 rounded-full border px-3 py-2 text-sm transition",
            tab.id === selectedTab
              ? "border-[var(--primary)] bg-[var(--ui-accent-soft)] text-[var(--ui-ink-strong)]"
              : "border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] text-[var(--ui-ink-soft)] hover:bg-[var(--ui-surface-hover)] hover:text-[var(--ui-ink-strong)]"
          )}
          onClick={() => onSelectTab(tab.id)}
        >
          <tab.icon className="size-4" />
          {tab.label}
        </button>
      ))}
    </div>
  );
}
