import { useEffect, useRef, useState, type MouseEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowUpRight,
  Bot,
  CalendarClock,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  CircleCheck,
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
import {
  Link,
  useLocation,
  useNavigate,
  useSearchParams
} from "react-router-dom";
import { useForgeShell } from "@/components/shell/app-shell";
import { PageHero } from "@/components/shell/page-hero";
import { MutationReceiptBanner } from "@/components/mutation-receipt-banner";
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
  checkAttentionResolutions,
  createAttentionResolutionIdempotencyKey,
  dismissAttentionInboxItem,
  getAttentionInbox,
  getAttentionResolutions,
  restoreAttentionInboxItem,
  snoozeAttentionInboxItem,
  startAttentionResolutionAction
} from "@/lib/api";
import { ForgeApiError } from "@/lib/api-error";
import type {
  AttentionInboxItem,
  AttentionInboxSource,
  AttentionInboxState,
  AttentionResolutionCheckResult,
  AttentionResolutionReceipt
} from "@/lib/types";
import type { MutationReceipt } from "@/lib/mutation-receipts";
import { cn, formatDate, formatDateTime } from "@/lib/utils";

const PAGE_SIZE = 25;

type StartResolutionRequest = {
  item: AttentionInboxItem;
  logicalKey: string;
  idempotencyKey: string;
};

function startResolutionLogicalKey(
  item: AttentionInboxItem,
  selectedUserIds: string[]
) {
  return JSON.stringify([
    item.id,
    item.primaryAction.key,
    item.sourceUpdatedAt,
    [
      ...new Set(selectedUserIds.map((value) => value.trim()).filter(Boolean))
    ].sort()
  ]);
}

function isDefinitiveStartFailure(error: unknown) {
  return (
    error instanceof ForgeApiError &&
    error.status >= 400 &&
    error.status < 500 &&
    error.status !== 408 &&
    error.status !== 429
  );
}

function readAttentionState(value: string | null): AttentionInboxState {
  return value === "snoozed" || value === "dismissed" ? value : "active";
}

function readAttentionOffset(value: string | null) {
  const parsed = Number.parseInt(value ?? "", 10);
  if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > 10_000) {
    return 0;
  }
  return Math.floor(parsed / PAGE_SIZE) * PAGE_SIZE;
}

function buildSourceActionHref(
  href: string,
  sourceRef: string,
  returnHref: string
) {
  const target = new URL(href, window.location.origin);
  if (
    target.origin !== window.location.origin ||
    target.username ||
    target.password ||
    !target.pathname.startsWith("/")
  ) {
    throw new Error("Forge refused an unsafe Attention action link.");
  }
  target.searchParams.set("attentionSource", sourceRef);
  target.searchParams.set("attentionReturn", returnHref);
  return `${target.pathname}${target.search}${target.hash}`;
}

function buildStoredSourceHref(
  href: string,
  sourceRef: string,
  returnHref: string
) {
  try {
    return buildSourceActionHref(href, sourceRef, returnHref);
  } catch {
    return "/attention";
  }
}

function verificationMessage(result: AttentionResolutionCheckResult) {
  if (result.status === "still_open") {
    return "Forge checked the source. It still needs attention.";
  }
  if (result.status === "stale") {
    return "The source changed after you started. Forge did not claim a resolution.";
  }
  if (result.status === "deleted") {
    return "The source is no longer available. Deletion is not recorded as a resolution.";
  }
  if (result.status === "denied") {
    return "Forge can no longer verify this source with your current access. No resolution was recorded.";
  }
  return result.explanation;
}

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
  onStartAction,
  onSnooze,
  onDismiss,
  onRestore
}: {
  item: AttentionInboxItem;
  pending: boolean;
  onStartAction: (item: AttentionInboxItem) => void;
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
      id={`attention-item-${encodeURIComponent(item.id)}`}
      tabIndex={-1}
      className="grid min-w-0 gap-4 border-b border-[var(--ui-border-subtle)] px-4 py-5 outline-none last:border-b-0 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--ui-ring)] sm:grid-cols-[auto_minmax(0,1fr)] sm:px-5"
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
          {item.state === "active" ? (
            <Button
              type="button"
              className="min-h-11"
              disabled={pending}
              pending={pending}
              pendingLabel="Opening source"
              onClick={() => onStartAction(item)}
            >
              <ArrowUpRight className="size-3.5 shrink-0" />
              {item.primaryAction.label}
            </Button>
          ) : item.allowedActions.includes("open") ? (
            <Link
              to={item.target.href}
              className="inline-flex min-h-11 min-w-0 max-w-full items-center justify-center gap-2 rounded-[var(--radius-control)] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)] px-3 py-2 text-[13px] font-medium leading-none text-[var(--ui-ink-strong)] transition hover:border-[var(--ui-border-strong)] hover:bg-[var(--ui-surface-hover)]"
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
              className="min-h-11"
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
              className="min-h-11"
              title="Hide this queue item. This does not resolve its source."
              disabled={pending}
              onClick={() => onDismiss(item.id)}
            >
              <X className="size-3.5" />
              Hide
            </Button>
          ) : null}
          {item.allowedActions.includes("restore") ? (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className="min-h-11"
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
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const state = readAttentionState(searchParams.get("state"));
  const offset = readAttentionOffset(searchParams.get("offset"));
  const focusedItemId = searchParams.get("focus");
  const returnedAttemptId = searchParams.get("attempt");
  const [actionError, setActionError] = useState<string | null>(null);
  const [verificationNotice, setVerificationNotice] = useState<string | null>(
    null
  );
  const [latestResolution, setLatestResolution] =
    useState<AttentionResolutionReceipt | null>(null);
  const [mutationReceipt, setMutationReceipt] =
    useState<MutationReceipt | null>(null);
  const checkedScopeRef = useRef<string | null>(null);
  const previousUserScopeRef = useRef(selectedUserScopeKey);
  const startRetryKeysRef = useRef(new Map<string, string>());
  const [snoozeMenu, setSnoozeMenu] = useState<{
    item: AttentionInboxItem;
    position: { x: number; y: number };
  } | null>(null);

  const updateLocationState = (
    nextState: AttentionInboxState,
    nextOffset = 0
  ) => {
    const next = new URLSearchParams(searchParams);
    next.set("state", nextState);
    if (nextOffset > 0) {
      next.set("offset", String(nextOffset));
    } else {
      next.delete("offset");
    }
    next.delete("focus");
    next.delete("attempt");
    setSearchParams(next);
  };

  useEffect(() => {
    if (previousUserScopeRef.current === selectedUserScopeKey) {
      return;
    }
    previousUserScopeRef.current = selectedUserScopeKey;
    if (offset === 0) {
      return;
    }
    const next = new URLSearchParams(searchParams);
    next.delete("offset");
    next.delete("focus");
    next.delete("attempt");
    setSearchParams(next, { replace: true });
    // The selected Forge user scope is external to this route. A scope change
    // must not leave the reader on an empty later page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedUserScopeKey]);

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
  const resolutionsQuery = useQuery({
    queryKey: ["forge-attention-resolutions", ...selectedUserIds],
    queryFn: () =>
      getAttentionResolutions({ userIds: selectedUserIds, limit: 5 })
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
    onSuccess: async (result) => {
      setMutationReceipt(result.mutationReceipt);
      await invalidateQueue();
    },
    onError: reportActionError
  });
  const dismissMutation = useMutation({
    mutationFn: (itemId: string) => dismissAttentionInboxItem(itemId),
    onSuccess: async (result) => {
      setMutationReceipt(result.mutationReceipt);
      await invalidateQueue();
    },
    onError: reportActionError
  });
  const restoreMutation = useMutation({
    mutationFn: (itemId: string) => restoreAttentionInboxItem(itemId),
    onSuccess: async (result) => {
      setMutationReceipt(result.mutationReceipt);
      await invalidateQueue();
    },
    onError: reportActionError
  });
  const checkResolutionMutation = useMutation({
    mutationFn: () => checkAttentionResolutions({ userIds: selectedUserIds }),
    onMutate: () => {
      setActionError(null);
      setVerificationNotice(null);
    },
    onSuccess: async (result) => {
      if (returnedAttemptId) {
        const returnedResult = result.results.find(
          (entry) => entry.attemptId === returnedAttemptId
        );
        const returnedReceipt =
          returnedResult?.receipt ??
          result.receipts.find(
            (receipt) => receipt.attemptId === returnedAttemptId
          ) ??
          null;
        setLatestResolution(returnedReceipt);
        if (returnedReceipt) {
          setVerificationNotice(
            `Resolved with source evidence: ${returnedReceipt.evidenceSummary}`
          );
        } else if (returnedResult) {
          setVerificationNotice(verificationMessage(returnedResult));
        } else {
          setVerificationNotice(
            "Forge found no pending check for this returned action. No new resolution was claimed."
          );
        }
      } else {
        setLatestResolution(null);
        if (result.receipts.length > 0) {
          setVerificationNotice(
            `Forge verified ${result.receipts.length} resolution${result.receipts.length === 1 ? "" : "s"}. Review the evidence receipts below.`
          );
        } else if (result.results.length > 0) {
          setVerificationNotice(
            `Forge checked ${result.results.length} pending source${result.results.length === 1 ? "" : "s"}. No new verified resolution was recorded.`
          );
        }
      }
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["forge-attention-inbox"] }),
        queryClient.invalidateQueries({
          queryKey: ["forge-attention-resolutions"]
        })
      ]);
    },
    onError: reportActionError
  });
  const startResolutionMutation = useMutation({
    mutationFn: (request: StartResolutionRequest) =>
      startAttentionResolutionAction(request.item.id, {
        actionKey: request.item.primaryAction.key,
        sourceUpdatedAt: request.item.sourceUpdatedAt,
        userIds: selectedUserIds,
        idempotencyKey: request.idempotencyKey
      }),
    onMutate: () => {
      setActionError(null);
      setVerificationNotice(null);
    },
    onSuccess: (result, request) => {
      const item = request.item;
      const returnParams = new URLSearchParams(searchParams);
      returnParams.set("state", state);
      if (offset > 0) {
        returnParams.set("offset", String(offset));
      } else {
        returnParams.delete("offset");
      }
      returnParams.set("focus", item.id);
      returnParams.set("attempt", result.attempt.id);
      const returnHref = `${location.pathname}?${returnParams.toString()}`;
      try {
        const targetHref = buildSourceActionHref(
          result.primaryAction.href,
          result.primaryAction.sourceRef,
          returnHref
        );
        startRetryKeysRef.current.delete(request.logicalKey);
        navigate(returnHref, { replace: true });
        navigate(targetHref);
      } catch (error) {
        reportActionError(error);
      }
    },
    onError: (error, request) => {
      if (isDefinitiveStartFailure(error)) {
        startRetryKeysRef.current.delete(request.logicalKey);
      }
      reportActionError(error);
    }
  });
  const pendingItemId =
    (startResolutionMutation.isPending
      ? startResolutionMutation.variables?.item.id
      : null) ??
    (snoozeMutation.isPending ? snoozeMutation.variables?.itemId : null) ??
    (dismissMutation.isPending ? dismissMutation.variables : null) ??
    (restoreMutation.isPending ? restoreMutation.variables : null) ??
    null;

  const startTrackedResolution = (selectedItem: AttentionInboxItem) => {
    const logicalKey = startResolutionLogicalKey(selectedItem, selectedUserIds);
    let idempotencyKey = startRetryKeysRef.current.get(logicalKey);
    if (!idempotencyKey) {
      idempotencyKey =
        createAttentionResolutionIdempotencyKey("attention_start");
      startRetryKeysRef.current.set(logicalKey, idempotencyKey);
    }
    startResolutionMutation.mutate({
      item: selectedItem,
      logicalKey,
      idempotencyKey
    });
  };

  useEffect(() => {
    const checkKey = selectedUserScopeKey || "operator";
    if (checkedScopeRef.current === checkKey) {
      return;
    }
    checkedScopeRef.current = checkKey;
    checkResolutionMutation.mutate();
    // This is an idempotent source re-read for action attempts that the user
    // explicitly started. It runs once for each selected-user scope.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedUserScopeKey]);

  useEffect(() => {
    if (!focusedItemId) {
      return;
    }
    const queueElement = document.getElementById(
      `attention-item-${encodeURIComponent(focusedItemId)}`
    );
    const receiptElement = returnedAttemptId
      ? document.getElementById(
          `attention-resolution-${encodeURIComponent(returnedAttemptId)}`
        )
      : null;
    const element = queueElement ?? receiptElement;
    element?.focus({ preventScroll: true });
    element?.scrollIntoView?.({ block: "center" });
  }, [
    focusedItemId,
    query.data?.items,
    resolutionsQuery.data?.receipts,
    returnedAttemptId
  ]);

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
        description="Take the next valid action, then Forge checks the source and records a resolution only when the problem is gone."
        badge={summary ? `${summary.activeCount} active` : undefined}
        actions={
          <Button
            type="button"
            variant="secondary"
            className="min-h-11"
            onClick={() =>
              void Promise.all([
                query.refetch(),
                resolutionsQuery.refetch(),
                checkResolutionMutation.mutateAsync()
              ])
            }
            pending={
              query.isFetching ||
              resolutionsQuery.isFetching ||
              checkResolutionMutation.isPending
            }
            pendingLabel="Checking sources"
          >
            <RefreshCw className="size-4" />
            Check sources
          </Button>
        }
      />

      <div className="border-y border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] px-4 py-3 text-sm leading-6 text-[var(--ui-ink-soft)]">
        Forge can verify the six current Attention kinds. Snoozing or hiding an
        item changes this queue only; missing data, deletion, or lost access is
        never called a resolution.
      </div>

      <MutationReceiptBanner
        receipt={mutationReceipt}
        onReceiptChange={setMutationReceipt}
        onUndone={invalidateQueue}
      />

      {verificationNotice ? (
        <div
          role="status"
          className={cn(
            "flex items-start gap-3 border-y px-4 py-3 text-sm text-[var(--ui-ink-medium)]",
            latestResolution
              ? "border-[var(--ui-success-border)] bg-[var(--ui-success-soft)]"
              : "border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)]"
          )}
        >
          <CircleCheck
            className={cn(
              "mt-0.5 size-4 shrink-0",
              latestResolution
                ? "text-[var(--success)]"
                : "text-[var(--primary)]"
            )}
            aria-hidden="true"
          />
          <span>{verificationNotice}</span>
        </div>
      ) : null}

      {resolutionsQuery.data?.receipts.length ? (
        <section
          aria-label="Verified resolutions"
          className="border-y border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)]"
        >
          <div className="flex min-w-0 flex-col gap-1 border-b border-[var(--ui-border-subtle)] px-4 py-3 sm:px-5">
            <h2 className="text-sm font-medium text-[var(--ui-ink-strong)]">
              Resolved with evidence
            </h2>
            <p className="text-xs leading-5 text-[var(--ui-ink-faint)]">
              These receipts were created only after Forge re-read the source.
              History keeps the newest{" "}
              {resolutionsQuery.data.retention.maxPerActor} receipts for{" "}
              {resolutionsQuery.data.retention.days} days.
            </p>
          </div>
          <div className="divide-y divide-[var(--ui-border-subtle)]">
            {resolutionsQuery.data.receipts.map((receipt) => (
              <article
                key={receipt.id}
                id={`attention-resolution-${encodeURIComponent(receipt.attemptId)}`}
                tabIndex={-1}
                className="grid min-w-0 gap-2 px-4 py-3 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--ui-ring)] sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:px-5"
              >
                <div className="min-w-0">
                  <div className="font-medium text-[var(--ui-ink-strong)]">
                    {receipt.title}
                  </div>
                  <div className="mt-1 text-sm leading-6 text-[var(--ui-ink-soft)]">
                    {receipt.evidenceSummary}
                  </div>
                  <div className="mt-1 text-xs text-[var(--ui-ink-faint)]">
                    Verified {formatDateTime(receipt.resolvedAt)}
                  </div>
                </div>
                <Link
                  to={buildStoredSourceHref(
                    receipt.targetHref,
                    receipt.sourceRef,
                    `${location.pathname}${location.search}`
                  )}
                  className="inline-flex min-h-11 items-center justify-center gap-2 rounded-[var(--radius-control)] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)] px-3 py-2 text-sm font-medium text-[var(--ui-ink-strong)] hover:bg-[var(--ui-surface-hover)]"
                >
                  <ArrowUpRight className="size-4" aria-hidden="true" />
                  Open source
                </Link>
              </article>
            ))}
          </div>
        </section>
      ) : null}

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
                "min-h-11 min-w-0 rounded-[calc(var(--radius-control)-0.25rem)] px-3 py-2 text-sm font-medium transition",
                state === tab.state
                  ? "bg-[var(--ui-surface-active)] text-[var(--ui-ink-strong)] shadow-[var(--ui-shadow-soft)]"
                  : "text-[var(--ui-ink-soft)] hover:bg-[var(--ui-surface-hover)] hover:text-[var(--ui-ink-strong)]"
              )}
              onClick={() => updateLocationState(tab.state)}
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

      {resolutionsQuery.isError ? (
        <div
          role="alert"
          className="flex items-start justify-between gap-3 border-y border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] px-4 py-3 text-sm text-[var(--ui-ink-medium)]"
        >
          <span>
            Resolution history could not be loaded. The current Attention queue
            is still available.
          </span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="min-h-11 shrink-0"
            onClick={() => void resolutionsQuery.refetch()}
          >
            Try history again
          </Button>
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
              onStartAction={startTrackedResolution}
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
                className="min-h-11"
                onClick={() => updateLocationState("active")}
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
            className="min-h-11 min-w-11"
            aria-label="Previous attention page"
            title="Previous page"
            disabled={offset === 0}
            onClick={() =>
              updateLocationState(state, Math.max(0, offset - PAGE_SIZE))
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
            className="min-h-11 min-w-11"
            aria-label="Next attention page"
            title="Next page"
            disabled={!payload.hasMore}
            onClick={() => updateLocationState(state, offset + PAGE_SIZE)}
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
