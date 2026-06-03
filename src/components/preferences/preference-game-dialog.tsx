import * as Dialog from "@radix-ui/react-dialog";
import { Search, X } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EmptyState, LoadingState } from "@/components/ui/page-state";
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
  loading,
  workspaceLoading,
  activeWorkspace,
  conceptSearchQuery,
  onConceptSearchQueryChange,
  filteredCatalogs,
  onSelectDomain,
  onStartCatalogGame,
  onJudge,
  onSignal
}: {
  state: PreferenceGameState;
  onOpenChange: (open: boolean) => void;
  error: string | null;
  loading: boolean;
  workspaceLoading: boolean;
  activeWorkspace: PreferenceWorkspacePayload | null;
  conceptSearchQuery: string;
  onConceptSearchQueryChange: (query: string) => void;
  filteredCatalogs: PreferenceCatalog[];
  onSelectDomain: (domain: PreferenceDomain) => void;
  onStartCatalogGame: (domain: PreferenceDomain, catalogId: string) => void;
  onJudge: (outcome: PreferenceJudgmentOutcome, strength?: number) => void;
  onSignal: (itemId: string, signalType: PreferenceSignalType) => void;
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

          <div className="sticky top-0 z-10 flex items-center justify-between gap-4 border-b border-[var(--ui-border-subtle)] bg-[color-mix(in_srgb,var(--surface-glass)_94%,transparent)] px-5 py-4 backdrop-blur-xl">
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
              <div className="rounded-[18px] border border-[color-mix(in_srgb,var(--danger)_28%,transparent)] bg-[var(--ui-danger-soft)] px-4 py-3 text-sm text-[var(--danger)]">
                {error}
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
                onStartCatalogGame={onStartCatalogGame}
              />
            ) : null}

            {state.phase === "play" ? (
              <PreferenceGamePlayStep
                domain={state.domain}
                loading={loading || workspaceLoading}
                activeWorkspace={activeWorkspace}
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
  onStartCatalogGame
}: {
  domain: PreferenceDomain;
  query: string;
  onQueryChange: (query: string) => void;
  catalogs: PreferenceCatalog[];
  onStartCatalogGame: (domain: PreferenceDomain, catalogId: string) => void;
}) {
  return (
    <div className="grid gap-4">
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
                  {catalog.items.length} items
                </Badge>
              </div>
              <div className="mt-2 text-sm leading-6 text-[var(--ui-ink-soft)]">
                {catalog.description || "No description yet."}
              </div>
            </button>
          ))
        ) : (
          <div className="rounded-[24px] bg-[var(--ui-surface-1)] px-5 py-6 text-sm text-[var(--ui-ink-soft)]">
            No concept list matches that search yet.
          </div>
        )}
      </div>
    </div>
  );
}

function PreferenceGamePlayStep({
  domain,
  loading,
  activeWorkspace,
  onJudge,
  onSignal
}: {
  domain: PreferenceDomain;
  loading: boolean;
  activeWorkspace: PreferenceWorkspacePayload | null;
  onJudge: (outcome: PreferenceJudgmentOutcome, strength?: number) => void;
  onSignal: (itemId: string, signalType: PreferenceSignalType) => void;
}) {
  const nextPair = activeWorkspace?.compare.nextPair ?? null;

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

  return (
    <div className="grid gap-5">
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

      <div className="grid gap-4 lg:grid-cols-2">
        <ComparisonCard
          title={nextPair.left.label}
          description={nextPair.left.description}
          sideLabel="Left"
          onClick={() => onJudge("left", 1)}
        />
        <ComparisonCard
          title={nextPair.right.label}
          description={nextPair.right.description}
          sideLabel="Right"
          onClick={() => onJudge("right", 1)}
        />
      </div>

      <div className="flex flex-wrap gap-2">
        <Button onClick={() => onJudge("left", 1)}>Left</Button>
        <Button onClick={() => onJudge("right", 1)}>Right</Button>
        <Button variant="secondary" onClick={() => onJudge("left", 1.75)}>
          Strong left
        </Button>
        <Button variant="secondary" onClick={() => onJudge("right", 1.75)}>
          Strong right
        </Button>
        <Button variant="secondary" onClick={() => onJudge("tie", 1)}>
          Tie
        </Button>
        <Button variant="secondary" onClick={() => onJudge("skip", 1)}>
          Skip
        </Button>
      </div>

      <div className="grid gap-4 rounded-[24px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] px-4 py-4 lg:grid-cols-2">
        {[nextPair.left, nextPair.right].map((item) => (
          <div key={item.id} className="grid gap-3">
            <div className="font-medium text-[var(--ui-ink-strong)]">
              {item.label}
            </div>
            <div className="text-sm text-[var(--ui-ink-soft)]">
              Quick signals
            </div>
            <div className="flex flex-wrap gap-2">
              {SIGNAL_OPTIONS.map((signal) => (
                <Button
                  key={`${item.id}-${signal.signalType}`}
                  variant="secondary"
                  size="sm"
                  onClick={() => onSignal(item.id, signal.signalType)}
                >
                  {signal.label}
                </Button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
