import { useEffect, useState, type MouseEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowUpRight,
  Bot,
  CalendarClock,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  Clock3,
  Inbox,
  Lightbulb,
  ListTodo,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  Smartphone,
  X
} from "lucide-react";
import { Link } from "react-router-dom";
import { useForgeShell } from "@/components/shell/app-shell";
import { PageHero } from "@/components/shell/page-hero";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  FloatingActionMenu,
  type FloatingActionMenuItem
} from "@/components/ui/floating-action-menu";
import {
  EmptyState,
  ErrorState,
  LoadingState
} from "@/components/ui/page-state";
import {
  dismissAttentionInboxItem,
  getAttentionInbox,
  restoreAttentionInboxItem,
  snoozeAttentionInboxItem
} from "@/lib/api";
import type {
  AttentionInboxItem,
  AttentionInboxSource,
  AttentionInboxState
} from "@/lib/types";
import { cn, formatDate, formatDateTime } from "@/lib/utils";

const PAGE_SIZE = 25;

const SOURCE_LABELS: Record<AttentionInboxSource, string> = {
  approval: "Approval",
  insight: "Insight",
  task: "Work",
  companion_sync: "Companion",
  agent_session: "Agent runtime"
};

const STATE_TABS: Array<{ state: AttentionInboxState; label: string }> = [
  { state: "active", label: "Active" },
  { state: "snoozed", label: "Snoozed" },
  { state: "dismissed", label: "Dismissed" }
];

function sourceIcon(source: AttentionInboxSource) {
  if (source === "approval") {
    return ShieldCheck;
  }
  if (source === "insight") {
    return Lightbulb;
  }
  if (source === "task") {
    return ListTodo;
  }
  if (source === "companion_sync") {
    return Smartphone;
  }
  return Bot;
}

function severityLabel(item: AttentionInboxItem) {
  if (item.severity === "blocking") {
    return "Decision needed";
  }
  if (item.severity === "important") {
    return "Important";
  }
  return "Review";
}

function dueLabel(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? formatDate(value)
    : formatDateTime(value);
}

function stateCount(
  state: AttentionInboxState,
  summary:
    | {
        activeCount: number;
        snoozedCount: number;
        dismissedCount: number;
      }
    | undefined
) {
  if (!summary) {
    return 0;
  }
  if (state === "active") {
    return summary.activeCount;
  }
  if (state === "snoozed") {
    return summary.snoozedCount;
  }
  return summary.dismissedCount;
}

function AttentionRow({
  item,
  pending,
  onSnooze,
  onDismiss,
  onRestore
}: {
  item: AttentionInboxItem;
  pending: boolean;
  onSnooze: (
    item: AttentionInboxItem,
    event: MouseEvent<HTMLButtonElement>
  ) => void;
  onDismiss: (itemId: string) => void;
  onRestore: (itemId: string) => void;
}) {
  const SourceIcon = sourceIcon(item.source);
  return (
    <article
      className="grid min-w-0 gap-4 border-b border-[var(--ui-border-subtle)] px-4 py-5 last:border-b-0 sm:grid-cols-[auto_minmax(0,1fr)] sm:px-5"
      data-testid={`attention-item-${item.id}`}
    >
      <div
        className={cn(
          "flex size-10 shrink-0 items-center justify-center rounded-[var(--radius-control)] border",
          item.severity === "blocking"
            ? "border-[color-mix(in_srgb,var(--danger)_28%,var(--ui-border-subtle)_72%)] bg-[var(--ui-danger-soft)] text-[var(--danger)]"
            : item.severity === "important"
              ? "border-[color-mix(in_srgb,var(--warning)_34%,var(--ui-border-subtle)_66%)] bg-[color-mix(in_srgb,var(--warning)_12%,var(--ui-surface-2)_88%)] text-[var(--warning)]"
              : "border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)] text-[var(--primary)]"
        )}
        aria-hidden="true"
      >
        <SourceIcon className="size-4" />
      </div>

      <div className="min-w-0">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <Badge size="xs" tone="meta">
            {SOURCE_LABELS[item.source]}
          </Badge>
          <span
            className={cn(
              "text-[11px] font-medium uppercase tracking-[0.14em]",
              item.severity === "blocking"
                ? "text-[var(--danger)]"
                : item.severity === "important"
                  ? "text-[var(--warning)]"
                  : "text-[var(--ui-ink-faint)]"
            )}
          >
            {severityLabel(item)}
          </span>
        </div>
        <h2 className="mt-2 text-base font-medium leading-6 text-[var(--ui-ink-strong)]">
          {item.title}
        </h2>
        <p className="mt-1 text-sm leading-6 text-[var(--ui-ink-medium)]">
          {item.reason}
        </p>
        {item.detail ? (
          <p className="mt-1 text-sm leading-6 text-[var(--ui-ink-soft)]">
            {item.detail}
          </p>
        ) : null}

        <div className="mt-3 flex min-w-0 flex-wrap gap-x-4 gap-y-1 text-xs text-[var(--ui-ink-faint)]">
          <span>Updated {formatDateTime(item.updatedAt)}</span>
          {item.dueAt ? <span>Due {dueLabel(item.dueAt)}</span> : null}
          {item.snoozedUntil ? (
            <span>Snoozed until {formatDateTime(item.snoozedUntil)}</span>
          ) : null}
        </div>

        <div className="mt-4 flex min-w-0 flex-wrap items-center gap-2">
          {item.allowedActions.includes("open") ? (
            <Link
              to={item.target.href}
              className="inline-flex min-h-[2.125rem] min-w-0 max-w-full items-center justify-center gap-2 rounded-[var(--radius-control)] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)] px-2.5 py-[0.4375rem] text-[13px] font-medium leading-none text-[var(--ui-ink-strong)] transition hover:border-[var(--ui-border-strong)] hover:bg-[var(--ui-surface-hover)]"
            >
              <ArrowUpRight className="size-3.5 shrink-0" />
              <span className="truncate">
                {item.source === "approval" ? "Review request" : "Open"}
              </span>
            </Link>
          ) : null}
          {item.allowedActions.includes("snooze") ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={pending}
              onClick={(event) => onSnooze(item, event)}
            >
              <Clock3 className="size-3.5" />
              Snooze
            </Button>
          ) : null}
          {item.allowedActions.includes("dismiss") ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={pending}
              onClick={() => onDismiss(item.id)}
            >
              <X className="size-3.5" />
              Dismiss
            </Button>
          ) : null}
          {item.allowedActions.includes("restore") ? (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={pending}
              onClick={() => onRestore(item.id)}
            >
              <RotateCcw className="size-3.5" />
              Restore
            </Button>
          ) : null}
        </div>
      </div>
    </article>
  );
}

export function AttentionInboxPage() {
  const shell = useForgeShell();
  const selectedUserIds = Array.isArray(shell.selectedUserIds)
    ? shell.selectedUserIds
    : [];
  const selectedUserScopeKey = selectedUserIds.join(",");
  const queryClient = useQueryClient();
  const [state, setState] = useState<AttentionInboxState>("active");
  const [offset, setOffset] = useState(0);
  const [actionError, setActionError] = useState<string | null>(null);
  const [snoozeMenu, setSnoozeMenu] = useState<{
    item: AttentionInboxItem;
    position: { x: number; y: number };
  } | null>(null);

  useEffect(() => {
    setOffset(0);
  }, [selectedUserScopeKey, state]);

  const query = useQuery({
    queryKey: ["forge-attention-inbox", state, offset, ...selectedUserIds],
    queryFn: () =>
      getAttentionInbox({
        state,
        limit: PAGE_SIZE,
        offset,
        userIds: selectedUserIds
      })
  });

  const invalidateQueue = async () => {
    setActionError(null);
    setSnoozeMenu(null);
    await queryClient.invalidateQueries({
      queryKey: ["forge-attention-inbox"]
    });
  };
  const reportActionError = (error: unknown) => {
    setActionError(
      error instanceof Error
        ? error.message
        : "The attention item could not be updated."
    );
  };
  const snoozeMutation = useMutation({
    mutationFn: ({ itemId, until }: { itemId: string; until: string }) =>
      snoozeAttentionInboxItem(itemId, { until }),
    onSuccess: invalidateQueue,
    onError: reportActionError
  });
  const dismissMutation = useMutation({
    mutationFn: (itemId: string) => dismissAttentionInboxItem(itemId),
    onSuccess: invalidateQueue,
    onError: reportActionError
  });
  const restoreMutation = useMutation({
    mutationFn: (itemId: string) => restoreAttentionInboxItem(itemId),
    onSuccess: invalidateQueue,
    onError: reportActionError
  });
  const pendingItemId =
    (snoozeMutation.isPending ? snoozeMutation.variables?.itemId : null) ??
    (dismissMutation.isPending ? dismissMutation.variables : null) ??
    (restoreMutation.isPending ? restoreMutation.variables : null) ??
    null;

  const snoozeItems: FloatingActionMenuItem[] = snoozeMenu
    ? [
        {
          id: "four-hours",
          label: "In 4 hours",
          description: "Bring it back after a short pause.",
          hours: 4,
          icon: Clock3
        },
        {
          id: "tomorrow",
          label: "Tomorrow",
          description: "Return it at this time tomorrow.",
          hours: 24,
          icon: CalendarClock
        },
        {
          id: "next-week",
          label: "Next week",
          description: "Return it in seven days.",
          hours: 24 * 7,
          icon: CalendarClock
        }
      ].map((choice) => ({
        id: choice.id,
        label: choice.label,
        description: choice.description,
        icon: choice.icon,
        onSelect: () =>
          snoozeMutation.mutate({
            itemId: snoozeMenu.item.id,
            until: new Date(
              Date.now() + choice.hours * 60 * 60 * 1000
            ).toISOString()
          })
      }))
    : [];

  const payload = query.data;
  const summary = payload?.summary;
  const metrics = [
    { label: "Active", value: summary?.activeCount ?? 0 },
    { label: "Decisions", value: summary?.blockingCount ?? 0 },
    { label: "Important", value: summary?.importantCount ?? 0 },
    { label: "Snoozed", value: summary?.snoozedCount ?? 0 }
  ];

  return (
    <div className="mx-auto grid w-full max-w-[1100px] gap-5">
      <PageHero
        title="Attention"
        description="Decisions, blocked work, and operational problems that need a next move."
        badge={summary ? `${summary.activeCount} active` : undefined}
        actions={
          <Button
            type="button"
            variant="secondary"
            onClick={() => void query.refetch()}
            pending={query.isFetching}
            pendingLabel="Refreshing"
          >
            <RefreshCw className="size-4" />
            Refresh
          </Button>
        }
      />

      <section
        aria-label="Attention summary"
        className="border-y border-[var(--ui-border-subtle)]"
      >
        <div className="grid grid-cols-4">
          {metrics.map((metric, index) => (
            <div
              key={metric.label}
              className={cn(
                "min-w-0 px-2 py-3 sm:px-4",
                index > 0 && "border-l border-[var(--ui-border-subtle)]"
              )}
            >
              <div className="truncate text-[10px] font-medium uppercase tracking-[0.12em] text-[var(--ui-ink-faint)] sm:text-[11px] sm:tracking-[0.14em]">
                {metric.label}
              </div>
              <div className="mt-1 text-xl font-medium tabular-nums text-[var(--ui-ink-strong)]">
                {metric.value}
              </div>
            </div>
          ))}
        </div>
      </section>

      <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div
          role="tablist"
          aria-label="Attention state"
          className="grid min-w-0 grid-cols-3 rounded-[var(--radius-control)] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] p-1"
        >
          {STATE_TABS.map((tab) => (
            <button
              key={tab.state}
              type="button"
              role="tab"
              aria-selected={state === tab.state}
              className={cn(
                "min-h-9 min-w-0 rounded-[calc(var(--radius-control)-0.25rem)] px-3 py-2 text-sm font-medium transition",
                state === tab.state
                  ? "bg-[var(--ui-surface-active)] text-[var(--ui-ink-strong)] shadow-[var(--ui-shadow-soft)]"
                  : "text-[var(--ui-ink-soft)] hover:bg-[var(--ui-surface-hover)] hover:text-[var(--ui-ink-strong)]"
              )}
              onClick={() => setState(tab.state)}
            >
              <span className="truncate">{tab.label}</span>{" "}
              <span className="tabular-nums text-[var(--ui-ink-faint)]">
                {stateCount(tab.state, summary)}
              </span>
            </button>
          ))}
        </div>
        {payload && payload.total > 0 ? (
          <div className="text-xs tabular-nums text-[var(--ui-ink-faint)]">
            {payload.offset + 1}–
            {Math.min(payload.offset + payload.items.length, payload.total)} of{" "}
            {payload.total}
          </div>
        ) : null}
      </div>

      {actionError ? (
        <div
          role="alert"
          className="flex items-start gap-3 border-y border-[color-mix(in_srgb,var(--danger)_30%,var(--ui-border-subtle)_70%)] bg-[var(--ui-danger-soft)] px-4 py-3 text-sm text-[var(--ui-ink-medium)]"
        >
          <CircleAlert className="mt-0.5 size-4 shrink-0 text-[var(--danger)]" />
          <span>{actionError}</span>
        </div>
      ) : null}

      {query.isLoading ? (
        <LoadingState
          eyebrow="Attention"
          title="Reading current signals"
          description="Forge is checking existing records for decisions and unresolved problems."
        />
      ) : query.isError ? (
        <ErrorState
          eyebrow="Attention"
          error={query.error}
          onRetry={() => void query.refetch()}
        />
      ) : payload && payload.items.length > 0 ? (
        <section
          aria-label={`${state} attention items`}
          className="overflow-hidden border-y border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)]"
        >
          {payload.items.map((item) => (
            <AttentionRow
              key={item.id}
              item={item}
              pending={pendingItemId === item.id}
              onSnooze={(selectedItem, event) => {
                setActionError(null);
                setSnoozeMenu({
                  item: selectedItem,
                  position: { x: event.clientX, y: event.clientY + 8 }
                });
              }}
              onDismiss={(itemId) => {
                setActionError(null);
                dismissMutation.mutate(itemId);
              }}
              onRestore={(itemId) => {
                setActionError(null);
                restoreMutation.mutate(itemId);
              }}
            />
          ))}
        </section>
      ) : (
        <EmptyState
          eyebrow="Attention"
          title={
            state === "active"
              ? "Nothing needs a decision"
              : `No ${state} items`
          }
          description={
            state === "active"
              ? "Forge found no unresolved decision, blocked work, or operational problem in the current scope."
              : `Items you ${state === "snoozed" ? "snooze" : "dismiss"} will remain available here while their source is still current.`
          }
          action={
            state === "active" ? undefined : (
              <Button
                type="button"
                variant="secondary"
                onClick={() => setState("active")}
              >
                <Inbox className="size-4" />
                View active
              </Button>
            )
          }
        />
      )}

      {payload && payload.total > payload.limit ? (
        <nav
          aria-label="Attention pagination"
          className="flex items-center justify-center gap-3"
        >
          <Button
            type="button"
            variant="secondary"
            size="sm"
            aria-label="Previous attention page"
            title="Previous page"
            disabled={offset === 0}
            onClick={() =>
              setOffset((current) => Math.max(0, current - PAGE_SIZE))
            }
          >
            <ChevronLeft className="size-4" />
          </Button>
          <span className="min-w-20 text-center text-xs tabular-nums text-[var(--ui-ink-faint)]">
            Page {Math.floor(offset / PAGE_SIZE) + 1}
          </span>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            aria-label="Next attention page"
            title="Next page"
            disabled={!payload.hasMore}
            onClick={() => setOffset((current) => current + PAGE_SIZE)}
          >
            <ChevronRight className="size-4" />
          </Button>
        </nav>
      ) : null}

      <FloatingActionMenu
        open={snoozeMenu !== null}
        title="Snooze until"
        subtitle={snoozeMenu?.item.title}
        items={snoozeItems}
        position={snoozeMenu?.position ?? null}
        onClose={() => setSnoozeMenu(null)}
      />
    </div>
  );
}
