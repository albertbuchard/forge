import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FileText, Link2, SkipForward, UserRoundPlus } from "lucide-react";
import {
  FlowChoiceGrid,
  QuestionFlowDialog,
  type QuestionFlowStep
} from "@/components/flows/question-flow-dialog";
import { Badge } from "@/components/ui/badge";
import { usePeopleGateway } from "@/components/people/people-gateway";
import {
  InlineEmpty,
  PeopleStateBanner
} from "@/components/people/people-status";
import type {
  PersonContext,
  WikiAssociationInput
} from "@/components/people/people-types";

type WikiFlowDraft = {
  pageId: string;
  decision: WikiAssociationInput["decision"];
};

const EMPTY_WIKI_DRAFT: WikiFlowDraft = {
  pageId: "",
  decision: "associate"
};

export function WikiAssociationFlow({
  open,
  context,
  onOpenChange,
  onApplied
}: {
  open: boolean;
  context: PersonContext;
  onOpenChange: (open: boolean) => void;
  onApplied: (context: PersonContext) => void;
}) {
  const gateway = usePeopleGateway();
  const associationAvailable = gateway.capabilities.wikiAssociation;
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<WikiFlowDraft>(EMPTY_WIKI_DRAFT);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    setDraft(EMPTY_WIKI_DRAFT);
    setSubmitError(null);
  }, [open]);

  const candidatesQuery = useQuery({
    queryKey: ["people", "wiki-candidates", context.person.id],
    queryFn: () => gateway.scanWikiCandidates(context.person.id),
    enabled: open && associationAvailable,
    retry: false
  });
  const candidates = useMemo(
    () => candidatesQuery.data ?? [],
    [candidatesQuery.data]
  );
  const selectedCandidate = candidates.find(
    (candidate) => candidate.pageId === draft.pageId
  );

  const applyMutation = useMutation({
    mutationFn: (input: WikiAssociationInput) =>
      gateway.applyWikiAssociation(input),
    onSuccess: async (nextContext) => {
      queryClient.setQueryData(
        ["people", "context", nextContext.person.id],
        nextContext
      );
      await queryClient.invalidateQueries({
        queryKey: ["people", "collection"]
      });
      onApplied(nextContext);
      onOpenChange(false);
    }
  });

  const steps = useMemo<Array<QuestionFlowStep<WikiFlowDraft>>>(
    () => [
      {
        id: "candidate",
        title: "Choose an existing Wiki People page",
        description:
          "Candidate discovery is non-destructive. No page is rewritten, moved, or deleted by selecting it.",
        render: (value, setValue) => (
          <div className="grid gap-3">
            {!associationAvailable ? (
              <PeopleStateBanner
                state="info"
                title="Wiki association is not configured"
              >
                Forge has not exposed the People Wiki root to this web app.
                Existing Person and Wiki records remain unchanged.
              </PeopleStateBanner>
            ) : candidatesQuery.isLoading ? (
              <p role="status" className="text-sm text-[var(--ui-ink-muted)]">
                Scanning Wiki People pages...
              </p>
            ) : candidatesQuery.error ? (
              <p role="alert" className="text-sm text-[var(--danger)]">
                {candidatesQuery.error instanceof Error
                  ? candidatesQuery.error.message
                  : "Wiki candidates could not be loaded."}
              </p>
            ) : candidates.length === 0 ? (
              <InlineEmpty>No Wiki People candidates were found.</InlineEmpty>
            ) : (
              <div
                role="radiogroup"
                aria-label="Wiki People candidates"
                className="grid gap-2"
              >
                {candidates.map((candidate) => {
                  const associatedHere =
                    candidate.alreadyAssociatedPersonId === context.person.id;
                  const disabled = Boolean(
                    candidate.alreadyAssociatedPersonId && !associatedHere
                  );
                  const selected = value.pageId === candidate.pageId;
                  return (
                    <label
                      key={candidate.pageId}
                      className="grid min-h-11 cursor-pointer grid-cols-[auto_minmax(0,1fr)] gap-3 rounded-lg border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] p-3 has-[:checked]:border-[var(--primary)] has-[:checked]:bg-[var(--ui-accent-soft)] has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-60"
                    >
                      <input
                        type="radio"
                        name="wiki-candidate"
                        value={candidate.pageId}
                        checked={selected}
                        disabled={disabled}
                        onChange={() =>
                          setValue({
                            pageId: candidate.pageId,
                            ...(associatedHere &&
                            value.decision === "create_person"
                              ? { decision: "associate" as const }
                              : {})
                          })
                        }
                        className="mt-1 size-4"
                      />
                      <span className="min-w-0">
                        <span className="flex min-w-0 flex-wrap items-center gap-2">
                          <FileText
                            className="size-4 text-[var(--primary)]"
                            aria-hidden="true"
                          />
                          <span className="font-medium text-[var(--ui-ink-strong)]">
                            {candidate.title}
                          </span>
                          {disabled ? (
                            <Badge size="xs" tone="meta">
                              Associated elsewhere
                            </Badge>
                          ) : associatedHere ? (
                            <Badge size="xs" tone="signal">
                              Associated here
                            </Badge>
                          ) : null}
                        </span>
                        <span className="mt-1 block text-xs text-[var(--ui-ink-muted)]">
                          {candidate.pathLabel}
                        </span>
                        <span className="mt-2 block text-sm leading-5 text-[var(--ui-ink-medium)]">
                          {candidate.excerpt ?? "No page excerpt"}
                        </span>
                        <span className="mt-2 block text-xs text-[var(--ui-ink-faint)]">
                          {candidate.matchReason}
                        </span>
                      </span>
                    </label>
                  );
                })}
              </div>
            )}
          </div>
        )
      },
      {
        id: "decision",
        title: "Choose what Forge should do",
        description:
          "Association links the two records. Skip leaves both records unchanged.",
        render: (value, setValue) => (
          <FlowChoiceGrid
            value={value.decision}
            onChange={(decision) =>
              setValue({ decision: decision as WikiFlowDraft["decision"] })
            }
            options={[
              {
                value: "associate",
                label: "Associate this page",
                description: `Link the page to ${context.person.displayName} without rewriting it.`
              },
              ...(selectedCandidate?.alreadyAssociatedPersonId ===
              context.person.id
                ? []
                : [
                    {
                      value: "create_person",
                      label: "Create a separate Person",
                      description:
                        "Keep this page separate and use it to start another Person record."
                    }
                  ]),
              {
                value: "skip",
                label: "Skip this candidate",
                description: "Make no changes and leave the review resumable."
              }
            ]}
            columns={3}
          />
        )
      },
      {
        id: "preview",
        title: "Review the Wiki association decision",
        description:
          "This is the exact non-destructive action Forge will apply.",
        render: (value) => (
          <div className="grid gap-4 rounded-lg border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] p-4 text-sm">
            <div className="flex items-start gap-3">
              {value.decision === "associate" ? (
                <Link2
                  className="mt-0.5 size-4 text-[var(--primary)]"
                  aria-hidden="true"
                />
              ) : value.decision === "create_person" ? (
                <UserRoundPlus
                  className="mt-0.5 size-4 text-[var(--primary)]"
                  aria-hidden="true"
                />
              ) : (
                <SkipForward
                  className="mt-0.5 size-4 text-[var(--ui-ink-muted)]"
                  aria-hidden="true"
                />
              )}
              <div className="min-w-0">
                <div className="font-medium text-[var(--ui-ink-strong)]">
                  {selectedCandidate?.title ?? "No candidate selected"}
                </div>
                <p className="mt-2 leading-6 text-[var(--ui-ink-medium)]">
                  {value.decision === "associate"
                    ? `Link this Wiki page to ${context.person.displayName}. The Wiki page content and path remain unchanged.`
                    : value.decision === "create_person"
                      ? "Create a separate local Person draft from the page. The current Person and Wiki page remain unchanged until that draft is confirmed."
                      : "Record this candidate as skipped for the current review. No Person or Wiki content changes."}
                </p>
              </div>
            </div>
          </div>
        )
      }
    ],
    [
      associationAvailable,
      candidates,
      candidatesQuery.error,
      candidatesQuery.isLoading,
      context.person.displayName,
      context.person.id,
      selectedCandidate
    ]
  );

  return (
    <QuestionFlowDialog
      open={open}
      onOpenChange={onOpenChange}
      eyebrow="People and Wiki"
      title="Associate a Wiki People page"
      description="Review candidates explicitly and preserve every existing Wiki page."
      value={draft}
      onChange={setDraft}
      steps={steps}
      submitLabel={
        draft.decision === "skip" ? "Skip candidate" : "Apply decision"
      }
      pending={applyMutation.isPending}
      pendingLabel="Applying"
      error={
        submitError ??
        (applyMutation.error instanceof Error
          ? applyMutation.error.message
          : null)
      }
      resolveContinueBlocker={(stepId, value) =>
        stepId === "candidate" && !associationAvailable
          ? "Wiki association is unavailable until this Forge exposes its People Wiki root to the web app."
          : stepId === "candidate" && !value.pageId
            ? candidatesQuery.isLoading
              ? "Wait for Wiki candidate discovery to finish."
              : "Choose a Wiki candidate to continue."
            : null
      }
      onSubmit={async () => {
        if (!associationAvailable) {
          setSubmitError(
            "Wiki association is not configured for this web app."
          );
          return;
        }
        if (!draft.pageId) {
          setSubmitError("Choose a Wiki candidate before applying a decision.");
          return;
        }
        setSubmitError(null);
        try {
          await applyMutation.mutateAsync({
            personId: context.person.id,
            pageId: draft.pageId,
            decision: draft.decision
          });
        } catch {
          // The mutation error is rendered by the guided flow.
        }
      }}
    />
  );
}
