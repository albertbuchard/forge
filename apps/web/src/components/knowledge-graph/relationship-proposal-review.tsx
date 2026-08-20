import * as Dialog from "@radix-ui/react-dialog";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  ArrowRight,
  Check,
  ExternalLink,
  Link2,
  RefreshCw,
  Sparkles,
  X
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { ModalCloseButton } from "@/components/ui/modal-close-button";
import {
  decideRelationshipProposal,
  generateRelationshipProposals,
  getRelationshipProposals
} from "@/lib/api";
import type {
  RelationshipProposal,
  RelationshipProposalList
} from "@/lib/types";

const relationLabels = {
  supports: "supports",
  informs: "informs",
  related: "is related to"
} as const;

function formatExpiry(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "Expiry unavailable"
    : `Expires ${new Intl.DateTimeFormat(undefined, {
        dateStyle: "medium",
        timeStyle: "short"
      }).format(date)}`;
}

function errorMessage(error: unknown) {
  if (typeof navigator !== "undefined" && !navigator.onLine) {
    return "Forge is offline. No relationship changed. Reconnect and try again.";
  }
  if (error instanceof Error && error.message.trim()) return error.message;
  return "Forge could not update this suggestion. No relationship changed.";
}

function ProposalCard({
  proposal,
  busy,
  onDecide
}: {
  proposal: RelationshipProposal;
  busy: boolean;
  onDecide: (proposal: RelationshipProposal, action: "accept" | "reject") => void;
}) {
  const evidence = proposal.evidence.flatMap((item) => item.matchedTerms);
  return (
    <article className="grid min-w-0 gap-4 rounded-[24px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)] p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="inline-flex items-center gap-2 rounded-full border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] px-3 py-1 text-xs font-medium text-[var(--ui-ink-strong)]">
          <Link2 className="size-3.5" aria-hidden="true" />
          Suggested {relationLabels[proposal.relationship]} link
        </div>
        <div className="text-xs text-[var(--ui-ink-faint)]">
          {Math.round(proposal.confidence * 100)}% confidence · {formatExpiry(proposal.expiresAt)}
        </div>
      </div>

      <div className="grid min-w-0 gap-3 md:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] md:items-center">
        {[proposal.source, proposal.target].map((endpoint, index) => (
          <div key={`${endpoint.entityType}:${endpoint.entityId}`} className="min-w-0 rounded-[18px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] p-3">
            <div className="text-[10px] uppercase tracking-[0.16em] text-[var(--ui-ink-faint)]">
              {index === 0 ? "From" : "To"} · {endpoint.entityType.replaceAll("_", " ")}
            </div>
            <div className="mt-1 break-words text-sm font-medium text-[var(--ui-ink-strong)]">
              {endpoint.title}
            </div>
            <p className="mt-1 line-clamp-2 text-xs leading-5 text-[var(--ui-ink-soft)]">
              {endpoint.detail}
            </p>
            <a
              href={endpoint.sourceHref}
              className="mt-2 inline-flex min-h-11 items-center gap-1 text-xs font-medium text-[var(--primary)] underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]/55"
            >
              Open source <ExternalLink className="size-3" aria-hidden="true" />
            </a>
          </div>
        )).flatMap((card, index) =>
          index === 0
            ? [
                card,
                <div key="direction" className="hidden text-[var(--ui-ink-faint)] md:block" aria-hidden="true">
                  <ArrowRight className="size-5" />
                </div>
              ]
            : [card]
        )}
      </div>

      <div className="grid gap-2">
        <p className="text-sm leading-6 text-[var(--ui-ink-soft)]">{proposal.explanation}</p>
        <div className="flex flex-wrap gap-1.5" aria-label="Matched evidence terms">
          {[...new Set(evidence)].map((term) => (
            <span key={term} className="rounded-full bg-[var(--ui-accent-soft)] px-2.5 py-1 text-xs text-[var(--ui-ink-soft)]">
              {term}
            </span>
          ))}
        </div>
        <div className="text-[11px] text-[var(--ui-ink-faint)]">
          Generator {proposal.generator.id} {proposal.generator.version}. Confidence is signal strength, not certainty.
        </div>
      </div>

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button
          type="button"
          variant="secondary"
          className="min-h-11"
          disabled={busy}
          onClick={() => onDecide(proposal, "reject")}
        >
          <X className="size-4" aria-hidden="true" /> Reject
        </Button>
        <Button
          type="button"
          className="min-h-11"
          disabled={busy}
          onClick={() => onDecide(proposal, "accept")}
        >
          <Check className="size-4" aria-hidden="true" /> Accept link
        </Button>
      </div>
    </article>
  );
}

export function RelationshipProposalReview({
  open,
  onOpenChange,
  ownerUserId,
  onAccepted
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  ownerUserId: string | null;
  onAccepted: () => void | Promise<void>;
}) {
  const query = useQuery({
    queryKey: ["relationship-proposals", ownerUserId],
    queryFn: () => getRelationshipProposals(ownerUserId!),
    enabled: open && Boolean(ownerUserId),
    staleTime: 0,
    refetchOnWindowFocus: false
  });
  const generate = useMutation({
    mutationFn: () => generateRelationshipProposals(ownerUserId!),
    onSuccess: (result) => query.refetch().then(() => result)
  });
  const decision = useMutation({
    mutationFn: (input: {
      proposal: RelationshipProposal;
      action: "accept" | "reject";
    }) =>
      decideRelationshipProposal({
        proposalId: input.proposal.id,
        ownerUserId: input.proposal.ownerUserId,
        expectedRevision: input.proposal.revision,
        action: input.action
      }).then((result) => ({ ...result, action: input.action })),
    onSuccess: async (result) => {
      await query.refetch();
      if (result.action === "accept") await onAccepted();
    }
  });
  const data = (generate.data ?? query.data) as RelationshipProposalList | undefined;
  const busy = generate.isPending || decision.isPending;
  const mutationError = decision.error ?? generate.error;
  const statusMessage = decision.isSuccess
    ? decision.data.action === "accept"
      ? "Relationship added. The graph will refresh now."
      : "Suggestion rejected. No relationship was written."
    : generate.isSuccess
      ? generate.data.generation?.created
        ? `${generate.data.generation.created} new suggestion${generate.data.generation.created === 1 ? "" : "s"} ready for review.`
        : "Forge found no new suggestions. Existing decisions were preserved."
      : "";

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-[color-mix(in_srgb,var(--ui-scrim)_72%,transparent)] backdrop-blur-xl" />
        <Dialog.Content className="fixed inset-x-3 top-[max(0.75rem,env(safe-area-inset-top))] z-50 grid max-h-[calc(100dvh-1.5rem)] min-w-0 gap-0 overflow-hidden rounded-[28px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] shadow-[var(--ui-shadow-floating)] md:left-1/2 md:right-auto md:w-[min(56rem,calc(100vw-3rem))] md:-translate-x-1/2">
          <div className="flex items-start justify-between gap-4 border-b border-[var(--ui-border-subtle)] px-5 py-4">
            <div className="min-w-0">
              <div className="text-[11px] uppercase tracking-[0.18em] text-[var(--ui-ink-faint)]">Knowledge Graph</div>
              <Dialog.Title className="font-display text-2xl text-[var(--ui-ink-strong)]">
                Review suggested links
              </Dialog.Title>
              <Dialog.Description className="mt-1 max-w-2xl text-sm leading-6 text-[var(--ui-ink-soft)]">
                Review suggested links before Forge writes them. Finding suggestions only saves a private review queue; Accept link is the only action that changes the graph.
              </Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <ModalCloseButton aria-label="Close suggested links review" />
            </Dialog.Close>
          </div>

          <div className="min-w-0 overflow-y-auto px-4 py-4 sm:px-5">
            {!ownerUserId ? (
              <div className="rounded-[22px] border border-[var(--ui-border-subtle)] bg-[var(--ui-info-soft)] p-4 text-sm leading-6 text-[var(--ui-ink-soft)]" role="status">
                Select exactly one person in the Forge header to review that person’s private suggestions.
              </div>
            ) : query.isPending && !data ? (
              <div className="rounded-[22px] border border-[var(--ui-border-subtle)] p-5 text-sm text-[var(--ui-ink-soft)]" role="status">
                Loading saved suggestions…
              </div>
            ) : query.isError && !data ? (
              <div className="grid gap-3 rounded-[22px] border border-[var(--danger)]/30 bg-[var(--ui-danger-soft)] p-4" role="alert">
                <p className="text-sm text-[var(--ui-ink-strong)]">{errorMessage(query.error)}</p>
                <Button type="button" variant="secondary" className="min-h-11 justify-self-start" onClick={() => query.refetch()}>
                  <RefreshCw className="size-4" aria-hidden="true" /> Try again
                </Button>
              </div>
            ) : (
              <div className="grid min-w-0 gap-4">
                <div className="flex flex-col gap-3 rounded-[22px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)] p-4 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <div className="text-sm font-medium text-[var(--ui-ink-strong)]">
                      {data?.total ?? 0} pending · {data?.shown ?? 0} shown
                    </div>
                    <p className="mt-1 text-xs leading-5 text-[var(--ui-ink-faint)]">
                      Suggestions expire after seven days. Rejected suggestions create no link and stay suppressed while Forge retains the 90-day decision history.
                    </p>
                  </div>
                  <Button type="button" className="min-h-11 shrink-0" disabled={busy} onClick={() => generate.mutate()}>
                    <Sparkles className="size-4" aria-hidden="true" />
                    {generate.isPending ? "Finding…" : "Find suggestions"}
                  </Button>
                </div>

                <div aria-live="polite" className="min-h-5 text-sm text-[var(--ui-ink-soft)]">
                  {mutationError ? errorMessage(mutationError) : statusMessage}
                </div>

                {(data?.proposals.length ?? 0) === 0 ? (
                  <div className="rounded-[22px] border border-dashed border-[var(--ui-border-subtle)] p-6 text-center">
                    <div className="text-sm font-medium text-[var(--ui-ink-strong)]">No pending suggestions</div>
                    <p className="mt-1 text-sm leading-6 text-[var(--ui-ink-soft)]">
                      Choose Find suggestions to compare this person’s authorized records. Nothing is linked until you accept a suggestion.
                    </p>
                  </div>
                ) : (
                  <div className="grid min-w-0 gap-4">
                    {data!.proposals.map((proposal) => (
                      <ProposalCard
                        key={proposal.id}
                        proposal={proposal}
                        busy={busy}
                        onDecide={(item, action) => decision.mutate({ proposal: item, action })}
                      />
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
