import * as Dialog from "@radix-ui/react-dialog";
import { RefreshCcw, Search, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EmptyState, LoadingState } from "@/components/ui/page-state";
import { cn } from "@/lib/utils";
import type {
  PreferenceCatalog,
  PreferenceDomain,
  PreferenceJudgmentOutcome,
  PreferenceSignalType,
  PreferenceWorkspacePayload
} from "@/lib/types";
import {
  ComparisonCard,
  DOMAIN_OPTIONS,
  getPreferenceContextScope,
  getPreferenceEffectiveSignal,
  getPreferenceSignalConflicts,
  getPreferenceSignalHistory,
  isPreferenceHistoryPartial,
  SIGNAL_MODEL_EFFECTS,
  SIGNAL_OPTIONS
} from "./preferences-workspace-model";

export type PreferenceGameState = {
  open: boolean;
  phase: "domain" | "catalog" | "play";
  domain: PreferenceDomain;
};

export function PreferenceGameDialog({
  state,
  onOpenChange,
  error,
  notice,
  loading,
  submitting,
  workspaceLoading,
  activeWorkspace,
  conceptSearchQuery,
  onConceptSearchQueryChange,
  filteredCatalogs,
  catalogsLoading,
  catalogsRefreshing,
  catalogsError,
  catalogOffset,
  catalogPreviousOffset,
  catalogNextOffset,
  onPreviousCatalogs,
  onNextCatalogs,
  onRetryCatalogs,
  onSelectDomain,
  onStartCatalogGame,
  onJudge,
  onSignal
}: {
  state: PreferenceGameState;
  onOpenChange: (open: boolean) => void;
  error: string | null;
  notice: string | null;
  loading: boolean;
  submitting: boolean;
  workspaceLoading: boolean;
  activeWorkspace: PreferenceWorkspacePayload | null;
  conceptSearchQuery: string;
  onConceptSearchQueryChange: (query: string) => void;
  filteredCatalogs: PreferenceCatalog[];
  catalogsLoading: boolean;
  catalogsRefreshing: boolean;
  catalogsError: string | null;
  catalogOffset: number;
  catalogPreviousOffset: number | null;
  catalogNextOffset: number | null;
  onPreviousCatalogs: () => void;
  onNextCatalogs: () => void;
  onRetryCatalogs: () => void;
  onSelectDomain: (domain: PreferenceDomain) => void;
  onStartCatalogGame: (domain: PreferenceDomain, catalogId: string) => void;
  onJudge: (
    outcome: PreferenceJudgmentOutcome,
    strength: number,
    idempotencyKey: string
  ) => void | Promise<void>;
  onSignal: (
    itemId: string,
    signalType: PreferenceSignalType,
    idempotencyKey: string
  ) => void | Promise<void>;
}) {
  return (
    <Dialog.Root open={state.open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-[var(--ui-overlay-backdrop)] backdrop-blur-xl" />
        <Dialog.Content className="fixed inset-x-4 bottom-4 top-4 z-50 overflow-y-auto rounded-[32px] border border-[var(--ui-border-subtle)] bg-[image:var(--ui-surface-modal)] shadow-[var(--ui-shadow-floating)] md:inset-x-10 lg:left-1/2 lg:right-auto lg:w-[min(72rem,calc(100vw-3rem))] lg:-translate-x-1/2">
          <Dialog.Title className="sr-only">Preference game</Dialog.Title>
          <Dialog.Description className="sr-only">
            Start comparison rounds from a Forge domain or concept list.
          </Dialog.Description>

          <div className="sticky top-0 z-10 flex items-center justify-between gap-4 border-b border-[var(--ui-border-subtle)] bg-[var(--canvas)] px-5 py-4">
            <div>
              <div className="text-[11px] uppercase tracking-[0.18em] text-[var(--ui-ink-faint)]">
                Preference game
              </div>
              <div className="mt-1 font-display text-2xl text-[var(--ui-ink-strong)]">
                {state.phase === "domain"
                  ? "Choose a domain"
                  : state.phase === "catalog"
                    ? "Choose a concept list"
                    : "Pick the better fit"}
              </div>
            </div>
            <Dialog.Close asChild>
              <button
                type="button"
                aria-label="Close preference game"
                className="rounded-full bg-[var(--ui-surface-2)] p-2 text-[var(--ui-ink-soft)] transition hover:bg-[var(--ui-surface-hover)] hover:text-[var(--ui-ink-strong)]"
              >
                <X className="size-4" />
              </button>
            </Dialog.Close>
          </div>

          <div className="grid gap-5 px-5 py-5">
            {error ? (
              <div
                role="alert"
                className="rounded-[18px] border border-[color-mix(in_srgb,var(--danger)_28%,transparent)] bg-[var(--ui-danger-soft)] px-4 py-3 text-sm text-[var(--danger)]"
              >
                {error}
              </div>
            ) : null}
            {notice ? (
              <div
                role="status"
                aria-live="polite"
                className="rounded-[18px] border border-[var(--ui-border-subtle)] bg-[var(--ui-success-soft)] px-4 py-3 text-sm text-[var(--ui-ink-medium)]"
              >
                {notice}
              </div>
            ) : null}

            {state.phase === "domain" ? (
              <PreferenceGameDomainStep onSelectDomain={onSelectDomain} />
            ) : null}

            {state.phase === "catalog" ? (
              <PreferenceGameCatalogStep
                domain={state.domain}
                query={conceptSearchQuery}
                onQueryChange={onConceptSearchQueryChange}
                catalogs={filteredCatalogs}
                loading={catalogsLoading}
                refreshing={catalogsRefreshing}
                error={catalogsError}
                offset={catalogOffset}
                previousOffset={catalogPreviousOffset}
                nextOffset={catalogNextOffset}
                onPrevious={onPreviousCatalogs}
                onNext={onNextCatalogs}
                onRetry={onRetryCatalogs}
                onStartCatalogGame={onStartCatalogGame}
              />
            ) : null}

            {state.phase === "play" ? (
              <PreferenceGamePlayStep
                domain={state.domain}
                loading={loading || workspaceLoading}
                submitting={submitting}
                activeWorkspace={activeWorkspace}
                error={error}
                onJudge={onJudge}
                onSignal={onSignal}
              />
            ) : null}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function PreferenceGameDomainStep({
  onSelectDomain
}: {
  onSelectDomain: (domain: PreferenceDomain) => void;
}) {
  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {DOMAIN_OPTIONS.map((option) => (
        <button
          key={option.value}
          type="button"
          className="rounded-[24px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] px-5 py-5 text-left transition hover:border-[color-mix(in_srgb,var(--primary)_30%,transparent)] hover:bg-[var(--ui-accent-soft)]"
          onClick={() => onSelectDomain(option.value)}
        >
          <div className="flex items-center justify-between gap-3">
            <div className="font-medium text-[var(--ui-ink-strong)]">
              {option.label}
            </div>
            <Badge className="bg-[var(--ui-surface-2)] text-[var(--ui-ink-medium)]">
              {option.mode === "forge" ? "Forge" : "Concept"}
            </Badge>
          </div>
          <div className="mt-2 text-sm leading-6 text-[var(--ui-ink-soft)]">
            {option.description}
          </div>
        </button>
      ))}
    </div>
  );
}

function PreferenceGameCatalogStep({
  domain,
  query,
  onQueryChange,
  catalogs,
  loading,
  refreshing,
  error,
  offset,
  previousOffset,
  nextOffset,
  onPrevious,
  onNext,
  onRetry,
  onStartCatalogGame
}: {
  domain: PreferenceDomain;
  query: string;
  onQueryChange: (query: string) => void;
  catalogs: PreferenceCatalog[];
  loading: boolean;
  refreshing: boolean;
  error: string | null;
  offset: number;
  previousOffset: number | null;
  nextOffset: number | null;
  onPrevious: () => void;
  onNext: () => void;
  onRetry: () => void;
  onStartCatalogGame: (domain: PreferenceDomain, catalogId: string) => void;
}) {
  return (
    <div className="grid gap-4" aria-busy={refreshing}>
      <div className="text-sm text-[var(--ui-ink-soft)]">
        Pick the concept list Forge should draw from. You do not need to
        assemble the items yourself.
      </div>
      <div className="flex items-center gap-3">
        <Search className="size-4 text-[var(--ui-ink-faint)]" />
        <Input
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder="Search concept lists"
        />
      </div>
      {loading && catalogs.length === 0 ? (
        <LoadingState
          eyebrow="Concept libraries"
          title="Loading concept lists"
          description="Forge is loading the selected domain and search results."
        />
      ) : null}
      {error ? (
        <div
          role="alert"
          className="grid gap-3 rounded-[18px] border border-[color-mix(in_srgb,var(--danger)_28%,transparent)] bg-[var(--ui-danger-soft)] px-4 py-3 text-sm text-[var(--danger)]"
        >
          <div>{error}</div>
          <div>
            <Button type="button" variant="secondary" onClick={onRetry}>
              <RefreshCcw className="mr-2 size-4" />
              Retry concept lists
            </Button>
          </div>
        </div>
      ) : null}
      <div className="grid gap-3 md:grid-cols-2">
        {catalogs.length > 0 ? (
          catalogs.map((catalog) => (
            <button
              key={catalog.id}
              type="button"
              className="rounded-[24px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] px-5 py-5 text-left transition hover:border-[color-mix(in_srgb,var(--primary)_30%,transparent)] hover:bg-[var(--ui-accent-soft)]"
              onClick={() => onStartCatalogGame(domain, catalog.id)}
            >
              <div className="flex items-center justify-between gap-3">
                <div className="font-medium text-[var(--ui-ink-strong)]">
                  {catalog.title}
                </div>
                <Badge className="bg-[var(--ui-surface-2)] text-[var(--ui-ink-medium)]">
                  {catalog.itemCount} items
                </Badge>
              </div>
              <div className="mt-2 text-sm leading-6 text-[var(--ui-ink-soft)]">
                {catalog.description || "No description yet."}
              </div>
            </button>
          ))
        ) : !loading && !error ? (
          <div className="rounded-[24px] bg-[var(--ui-surface-1)] px-5 py-6 text-sm text-[var(--ui-ink-soft)]">
            No concept list matches that search yet.
          </div>
        ) : null}
      </div>
      {previousOffset !== null || nextOffset !== null ? (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="text-xs text-[var(--ui-ink-faint)]">
            Showing {offset + 1}-{offset + catalogs.length} libraries
          </div>
          <div className="flex flex-wrap gap-2">
            {previousOffset !== null ? (
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={onPrevious}
              >
                Previous libraries
              </Button>
            ) : null}
            {nextOffset !== null ? (
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={onNext}
              >
                Next libraries
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function PreferenceGamePlayStep({
  domain,
  loading,
  submitting,
  activeWorkspace,
  error,
  onJudge,
  onSignal
}: {
  domain: PreferenceDomain;
  loading: boolean;
  submitting: boolean;
  activeWorkspace: PreferenceWorkspacePayload | null;
  error: string | null;
  onJudge: (
    outcome: PreferenceJudgmentOutcome,
    strength: number,
    idempotencyKey: string
  ) => void | Promise<void>;
  onSignal: (
    itemId: string,
    signalType: PreferenceSignalType,
    idempotencyKey: string
  ) => void | Promise<void>;
}) {
  const nextPair = activeWorkspace?.compare.nextPair ?? null;
  const pairKey = nextPair ? `${nextPair.left.id}:${nextPair.right.id}` : null;
  const lockedPairKeyRef = useRef<string | null>(null);
  const [judgmentLocked, setJudgmentLocked] = useState(false);
  const [lastJudgmentAttempt, setLastJudgmentAttempt] = useState<{
    pairKey: string;
    leftLabel: string;
    rightLabel: string;
    outcome: PreferenceJudgmentOutcome;
    strength: number;
    idempotencyKey: string;
  } | null>(null);
  const signalLockRef = useRef<string | null>(null);
  const sawSignalSubmittingRef = useRef(false);
  const [signalLocked, setSignalLocked] = useState(false);
  const [lastSignalAttempt, setLastSignalAttempt] = useState<{
    itemId: string;
    itemLabel: string;
    signalType: PreferenceSignalType;
    baselineSignalId: string | null;
    idempotencyKey: string;
  } | null>(null);
  const [recentSignalTarget, setRecentSignalTarget] = useState<{
    itemId: string;
    itemLabel: string;
  } | null>(null);

  const releaseJudgmentLock = useCallback((completedPairKey: string) => {
    if (lockedPairKeyRef.current !== completedPairKey) {
      return;
    }
    lockedPairKeyRef.current = null;
    setJudgmentLocked(false);
  }, []);

  const attemptJudgment = useCallback(
    (
      outcome: PreferenceJudgmentOutcome,
      strength = 1,
      retryIdempotencyKey?: string
    ) => {
      if (
        loading ||
        submitting ||
        !pairKey ||
        !nextPair ||
        lockedPairKeyRef.current === pairKey
      ) {
        return;
      }

      const idempotencyKey = retryIdempotencyKey ?? crypto.randomUUID();
      lockedPairKeyRef.current = pairKey;
      setJudgmentLocked(true);
      setLastJudgmentAttempt({
        pairKey,
        leftLabel: nextPair.left.label,
        rightLabel: nextPair.right.label,
        outcome,
        strength,
        idempotencyKey
      });
      try {
        void Promise.resolve(onJudge(outcome, strength, idempotencyKey)).then(
          () => {
            setLastJudgmentAttempt((current) =>
              current?.idempotencyKey === idempotencyKey ? null : current
            );
            releaseJudgmentLock(pairKey);
          },
          () => releaseJudgmentLock(pairKey)
        );
      } catch (error) {
        releaseJudgmentLock(pairKey);
        throw error;
      }
    },
    [loading, nextPair, onJudge, pairKey, releaseJudgmentLock, submitting]
  );

  const releaseSignalLock = useCallback(() => {
    signalLockRef.current = null;
    sawSignalSubmittingRef.current = false;
    setSignalLocked(false);
  }, []);

  const attemptSignal = useCallback(
    (
      itemId: string,
      itemLabel: string,
      signalType: PreferenceSignalType,
      retryIdempotencyKey?: string
    ) => {
      if (loading || submitting || signalLockRef.current) {
        return;
      }
      const currentSignal = activeWorkspace
        ? getPreferenceEffectiveSignal(activeWorkspace, itemId)
        : null;
      const idempotencyKey = retryIdempotencyKey ?? crypto.randomUUID();
      signalLockRef.current = `${itemId}:${signalType}`;
      setSignalLocked(true);
      setLastSignalAttempt({
        itemId,
        itemLabel,
        signalType,
        baselineSignalId: currentSignal?.id ?? null,
        idempotencyKey
      });
      setRecentSignalTarget({ itemId, itemLabel });
      try {
        const result = onSignal(itemId, signalType, idempotencyKey);
        if (result && typeof result.then === "function") {
          void result.then(releaseSignalLock, releaseSignalLock);
        }
      } catch (caughtError) {
        releaseSignalLock();
        throw caughtError;
      }
    },
    [activeWorkspace, loading, onSignal, releaseSignalLock, submitting]
  );

  useEffect(() => {
    if (lockedPairKeyRef.current === pairKey) {
      return;
    }
    lockedPairKeyRef.current = null;
    setJudgmentLocked(false);
    setLastJudgmentAttempt((current) =>
      current && current.pairKey !== pairKey ? null : current
    );
  }, [pairKey]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (submitting || event.defaultPrevented) {
        return;
      }
      const target = event.target as HTMLElement | null;
      if (
        target?.isContentEditable ||
        target?.tagName === "INPUT" ||
        target?.tagName === "TEXTAREA" ||
        target?.tagName === "SELECT"
      ) {
        return;
      }
      const key = event.key.toLocaleLowerCase();
      if (key === "1") {
        event.preventDefault();
        attemptJudgment("left", 1);
      } else if (key === "2") {
        event.preventDefault();
        attemptJudgment("right", 1);
      } else if (key === "t") {
        event.preventDefault();
        attemptJudgment("tie", 1);
      } else if (key === "s") {
        event.preventDefault();
        attemptJudgment("skip", 1);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [attemptJudgment, submitting]);

  useEffect(() => {
    if (!signalLockRef.current) {
      return;
    }
    if (submitting) {
      sawSignalSubmittingRef.current = true;
      return;
    }
    if (sawSignalSubmittingRef.current || error) {
      releaseSignalLock();
    }
  }, [error, releaseSignalLock, submitting]);

  useEffect(() => {
    if (!activeWorkspace || !lastSignalAttempt) {
      return;
    }
    const current = getPreferenceEffectiveSignal(
      activeWorkspace,
      lastSignalAttempt.itemId
    );
    if (
      current?.signalType === lastSignalAttempt.signalType &&
      (current.id !== lastSignalAttempt.baselineSignalId || !error)
    ) {
      setLastSignalAttempt(null);
    }
  }, [activeWorkspace, error, lastSignalAttempt]);

  if (loading) {
    return (
      <LoadingState
        eyebrow="Preference game"
        title="Preparing the next round"
        description="Forge is lining up comparison candidates."
      />
    );
  }

  if (!nextPair) {
    return (
      <EmptyState
        eyebrow="Preference game"
        title="No pair is ready yet"
        description="Forge needs more items in this domain before it can keep asking comparisons."
      />
    );
  }

  const judgmentDisabled = submitting || judgmentLocked || signalLocked;
  const currentPairItemIds = new Set([nextPair.left.id, nextPair.right.id]);
  const recentSignalHistory =
    activeWorkspace && recentSignalTarget
      ? getPreferenceSignalHistory(activeWorkspace, recentSignalTarget.itemId)
      : [];
  const recentSignal =
    activeWorkspace && recentSignalTarget
      ? getPreferenceEffectiveSignal(activeWorkspace, recentSignalTarget.itemId)
      : null;
  const recentPriorSignalCount = recentSignalHistory.filter(
    (signal) => signal.id !== recentSignal?.id
  ).length;
  const recentSignalConflicts =
    activeWorkspace && recentSignalTarget
      ? getPreferenceSignalConflicts(activeWorkspace, recentSignalTarget.itemId)
      : [];
  const recentSignalProvenance = recentSignal
    ? (recentSignal as typeof recentSignal & {
        actor?: string | null;
        ownerUserId?: string;
      })
    : null;
  const showRecentSignalEditor =
    recentSignalTarget &&
    recentSignal &&
    !currentPairItemIds.has(recentSignalTarget.itemId);
  const historyPartial = activeWorkspace
    ? isPreferenceHistoryPartial(activeWorkspace)
    : false;

  return (
    <div className="grid gap-5" aria-busy={judgmentDisabled}>
      <div className="flex flex-wrap items-center gap-2 text-sm text-[var(--ui-ink-soft)]">
        <Badge className="bg-[var(--ui-surface-2)] text-[var(--ui-ink-medium)]">
          {DOMAIN_OPTIONS.find((entry) => entry.value === domain)?.label ??
            domain}
        </Badge>
        <span>{activeWorkspace?.selectedContext.name}</span>
        <span>·</span>
        <span>
          {activeWorkspace?.compare.pendingCount ?? 0} queued comparisons
        </span>
      </div>

      <div className="grid gap-1 border-l-2 border-[var(--primary)] pl-3 text-sm leading-6 text-[var(--ui-ink-soft)]">
        <div className="font-medium text-[var(--ui-ink-strong)]">
          Signals apply to {activeWorkspace?.selectedContext.name}
        </div>
        <div>
          {activeWorkspace
            ? getPreferenceContextScope(activeWorkspace.selectedContext)
            : null}
        </div>
        <div>
          Raw evidence is summed, then scaled as tanh(raw / 4). Manual score or
          status controls still take precedence.
        </div>
      </div>

      <div className="rounded-[18px] bg-[var(--ui-surface-1)] px-4 py-3 text-sm leading-6 text-[var(--ui-ink-soft)]">
        <div className="text-[11px] uppercase tracking-[0.16em] text-[var(--ui-ink-faint)]">
          Why this pair
        </div>
        <div className="mt-1">
          {nextPair.rationale.length > 0
            ? nextPair.rationale.slice(0, 3).join(" · ")
            : "Both items need more evidence in the active context."}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <ComparisonCard
          title={nextPair.left.label}
          description={nextPair.left.description}
          sideLabel="Left"
          disabled={judgmentDisabled}
          onClick={() => attemptJudgment("left", 1)}
        />
        <ComparisonCard
          title={nextPair.right.label}
          description={nextPair.right.description}
          sideLabel="Right"
          disabled={judgmentDisabled}
          onClick={() => attemptJudgment("right", 1)}
        />
      </div>

      <div className="flex flex-wrap gap-2">
        <Button
          disabled={judgmentDisabled}
          aria-keyshortcuts="1"
          onClick={() => attemptJudgment("left", 1)}
        >
          Left · 1
        </Button>
        <Button
          disabled={judgmentDisabled}
          aria-keyshortcuts="2"
          onClick={() => attemptJudgment("right", 1)}
        >
          Right · 2
        </Button>
        <Button
          disabled={judgmentDisabled}
          variant="secondary"
          onClick={() => attemptJudgment("left", 1.75)}
        >
          Strong left
        </Button>
        <Button
          disabled={judgmentDisabled}
          variant="secondary"
          onClick={() => attemptJudgment("right", 1.75)}
        >
          Strong right
        </Button>
        <Button
          disabled={judgmentDisabled}
          aria-keyshortcuts="T"
          variant="secondary"
          onClick={() => attemptJudgment("tie", 1)}
        >
          Tie · T
        </Button>
        <Button
          disabled={judgmentDisabled}
          aria-keyshortcuts="S"
          variant="secondary"
          onClick={() => attemptJudgment("skip", 1)}
        >
          Skip · S
        </Button>
      </div>

      <div className="text-sm leading-6 text-[var(--ui-ink-soft)]">
        A left or right choice adds one context-specific win and loss. A tie
        adds tie evidence to both items. Skip advances without adding score
        evidence.
      </div>

      {error && lastJudgmentAttempt?.pairKey === pairKey ? (
        <div className="flex flex-wrap items-center justify-between gap-3 border-l-2 border-[var(--danger)] pl-3 text-sm text-[var(--ui-ink-soft)]">
          <span>
            The response may have been lost. Retry with the same receipt key so
            Forge records this comparison at most once.
          </span>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="min-h-11"
            aria-label={`Retry ${lastJudgmentAttempt.outcome} for ${lastJudgmentAttempt.leftLabel} versus ${lastJudgmentAttempt.rightLabel}`}
            disabled={submitting || judgmentLocked}
            onClick={() =>
              attemptJudgment(
                lastJudgmentAttempt.outcome,
                lastJudgmentAttempt.strength,
                lastJudgmentAttempt.idempotencyKey
              )
            }
          >
            <RefreshCcw className="mr-2 size-4" />
            Retry comparison
          </Button>
        </div>
      ) : null}

      {error && lastSignalAttempt ? (
        <div className="flex flex-wrap items-center justify-between gap-3 border-l-2 border-[var(--danger)] pl-3 text-sm text-[var(--ui-ink-soft)]">
          <span>
            The response may have been lost. Retrying is safe because the same
            current signal is idempotent.
          </span>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="min-h-11"
            aria-label={`Retry ${SIGNAL_OPTIONS.find((signal) => signal.signalType === lastSignalAttempt.signalType)?.label ?? lastSignalAttempt.signalType} for ${lastSignalAttempt.itemLabel}`}
            disabled={submitting || signalLocked}
            onClick={() =>
              attemptSignal(
                lastSignalAttempt.itemId,
                lastSignalAttempt.itemLabel,
                lastSignalAttempt.signalType,
                lastSignalAttempt.idempotencyKey
              )
            }
          >
            <RefreshCcw className="mr-2 size-4" />
            Retry direct signal
          </Button>
        </div>
      ) : null}

      {showRecentSignalEditor ? (
        <section
          aria-labelledby="recent-preference-signal-heading"
          className="grid gap-3 border-l-2 border-[var(--primary)] pl-3"
        >
          <div className="flex min-w-0 items-start justify-between gap-3">
            <div className="grid min-w-0 gap-1">
              <div
                id="recent-preference-signal-heading"
                className="text-xs font-medium uppercase text-[var(--ui-ink-faint)]"
              >
                Recently changed
              </div>
              <div className="flex min-w-0 flex-wrap items-center gap-2 font-medium text-[var(--ui-ink-strong)]">
                <span>{recentSignalTarget.itemLabel}</span>
                <Badge className="bg-[var(--ui-accent-soft)] text-[var(--primary)]">
                  {recentSignal.signalType.replaceAll("_", " ")} active
                </Badge>
              </div>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-label={`Dismiss recently changed signal for ${recentSignalTarget.itemLabel}`}
              title="Dismiss recently changed signal"
              className="size-10 p-0"
              onClick={() => setRecentSignalTarget(null)}
            >
              <X className="size-4" />
            </Button>
          </div>
          <div className="grid gap-1 text-sm leading-6 text-[var(--ui-ink-soft)]">
            <div>{SIGNAL_MODEL_EFFECTS[recentSignal.signalType]}</div>
            <div className="text-xs text-[var(--ui-ink-faint)]">
              Owner {recentSignalProvenance?.ownerUserId ?? recentSignal.userId}
              {" · "}source {recentSignal.source}
              {recentSignalProvenance?.actor
                ? ` · actor ${recentSignalProvenance.actor}`
                : ""}
              {recentPriorSignalCount > 0
                ? ` · ${recentPriorSignalCount} prior signal${recentPriorSignalCount === 1 ? "" : "s"} preserved`
                : ""}
              {!recentSignalHistory.some(
                (signal) => signal.id === recentSignal.id
              )
                ? " · active signal is outside the recent history window"
                : ""}
            </div>
          </div>
          {recentSignalConflicts.length > 0 ? (
            <div className="grid gap-1 bg-[var(--ui-warning-soft)] px-3 py-2 text-sm leading-5 text-[var(--ui-ink-medium)]">
              {recentSignalConflicts.map((conflict) => (
                <div key={conflict}>{conflict}</div>
              ))}
            </div>
          ) : null}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
            {SIGNAL_OPTIONS.map((signal) => {
              const Icon = signal.icon;
              const isActive = recentSignal.signalType === signal.signalType;
              return (
                <Button
                  key={`recent-${recentSignalTarget.itemId}-${signal.signalType}`}
                  type="button"
                  variant="secondary"
                  size="sm"
                  aria-label={`${signal.label} for ${recentSignalTarget.itemLabel}`}
                  aria-pressed={isActive}
                  title={SIGNAL_MODEL_EFFECTS[signal.signalType]}
                  disabled={submitting || signalLocked}
                  className={cn(
                    "min-h-11 min-w-0 justify-start",
                    isActive &&
                      "border border-[var(--primary)] bg-[var(--ui-accent-soft)] text-[var(--primary)]"
                  )}
                  onClick={() =>
                    attemptSignal(
                      recentSignalTarget.itemId,
                      recentSignalTarget.itemLabel,
                      signal.signalType
                    )
                  }
                >
                  <Icon className="mr-2 size-4 shrink-0" />
                  <span className="min-w-0 truncate">{signal.label}</span>
                </Button>
              );
            })}
          </div>
        </section>
      ) : null}

      {historyPartial ? (
        <div className="border-l-2 border-[var(--warning)] pl-3 text-sm leading-6 text-[var(--ui-ink-soft)]">
          Recent history is partial. Active signals and comparison totals use
          the authoritative score state, including evidence outside this bounded
          window.
        </div>
      ) : null}

      <div className="grid gap-0 overflow-hidden rounded-[24px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] lg:grid-cols-2 lg:divide-x lg:divide-[var(--ui-border-subtle)]">
        {[nextPair.left, nextPair.right].map((item, itemIndex) => {
          const history = activeWorkspace
            ? getPreferenceSignalHistory(activeWorkspace, item.id)
            : [];
          const currentSignal = activeWorkspace
            ? getPreferenceEffectiveSignal(activeWorkspace, item.id)
            : null;
          const priorSignalCount = history.filter(
            (signal) => signal.id !== currentSignal?.id
          ).length;
          const conflicts = activeWorkspace
            ? getPreferenceSignalConflicts(activeWorkspace, item.id)
            : [];
          const currentActor = currentSignal
            ? (currentSignal as typeof currentSignal & {
                actor?: string | null;
                ownerUserId?: string;
              })
            : null;
          return (
            <section
              key={item.id}
              aria-labelledby={`signal-item-${item.id}`}
              className={cn(
                "grid min-w-0 gap-3 px-4 py-4",
                itemIndex > 0 &&
                  "border-t border-[var(--ui-border-subtle)] lg:border-t-0"
              )}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div
                  id={`signal-item-${item.id}`}
                  className="min-w-0 font-medium text-[var(--ui-ink-strong)]"
                >
                  {item.label}
                </div>
                {currentSignal ? (
                  <Badge className="bg-[var(--ui-accent-soft)] text-[var(--primary)]">
                    {currentSignal.signalType.replaceAll("_", " ")} active
                  </Badge>
                ) : (
                  <Badge className="bg-[var(--ui-surface-2)] text-[var(--ui-ink-soft)]">
                    No direct signal
                  </Badge>
                )}
              </div>

              {currentSignal ? (
                <div className="grid gap-1 text-sm leading-6 text-[var(--ui-ink-soft)]">
                  <div>{SIGNAL_MODEL_EFFECTS[currentSignal.signalType]}</div>
                  <div className="text-xs text-[var(--ui-ink-faint)]">
                    Owner {currentActor?.ownerUserId ?? currentSignal.userId} ·
                    source {currentSignal.source}
                    {currentActor?.actor
                      ? ` · actor ${currentActor.actor}`
                      : ""}
                    {priorSignalCount > 0
                      ? ` · ${priorSignalCount} prior signal${priorSignalCount === 1 ? "" : "s"} preserved`
                      : ""}
                    {!history.some((signal) => signal.id === currentSignal.id)
                      ? " · active signal is outside the recent history window"
                      : ""}
                  </div>
                </div>
              ) : (
                <div className="text-sm leading-6 text-[var(--ui-ink-soft)]">
                  Choose one direct signal. A later choice replaces its model
                  effect while preserving the earlier record.
                </div>
              )}

              {conflicts.length > 0 ? (
                <div className="grid gap-1 bg-[var(--ui-warning-soft)] px-3 py-2 text-sm leading-5 text-[var(--ui-ink-medium)]">
                  {conflicts.map((conflict) => (
                    <div key={conflict}>{conflict}</div>
                  ))}
                </div>
              ) : null}

              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {SIGNAL_OPTIONS.map((signal) => {
                  const Icon = signal.icon;
                  const isActive =
                    currentSignal?.signalType === signal.signalType;
                  return (
                    <Button
                      key={`${item.id}-${signal.signalType}`}
                      type="button"
                      variant="secondary"
                      size="sm"
                      aria-label={`${signal.label} for ${item.label}`}
                      aria-pressed={isActive}
                      title={SIGNAL_MODEL_EFFECTS[signal.signalType]}
                      disabled={submitting || signalLocked}
                      className={cn(
                        "min-h-11 min-w-0 justify-start",
                        isActive &&
                          "border border-[var(--primary)] bg-[var(--ui-accent-soft)] text-[var(--primary)]"
                      )}
                      onClick={() =>
                        attemptSignal(item.id, item.label, signal.signalType)
                      }
                    >
                      <Icon className="mr-2 size-4 shrink-0" />
                      <span className="min-w-0 truncate">{signal.label}</span>
                    </Button>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
