import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FileText, Sparkles, UserRoundPlus } from "lucide-react";
import {
  FlowField,
  QuestionFlowDialog,
  type QuestionFlowStep
} from "@/components/flows/question-flow-dialog";
import { usePeopleGateway } from "@/components/people/people-gateway";
import {
  InlineEmpty,
  PeopleStateBanner
} from "@/components/people/people-status";
import type {
  PersonContext,
  PersonRelationshipCategory,
  WikiPersonImportDraft
} from "@/components/people/people-types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

type ImportDraft = {
  selectedPageIds: string[];
  suggestions: WikiPersonImportDraft[];
  enrichmentLabel: string | null;
};

const EMPTY_IMPORT_DRAFT: ImportDraft = {
  selectedPageIds: [],
  suggestions: [],
  enrichmentLabel: null
};

const RELATIONSHIP_OPTIONS: Array<{
  value: PersonRelationshipCategory;
  label: string;
}> = [
  { value: "family", label: "Family" },
  { value: "friend", label: "Friend" },
  { value: "partner", label: "Partner" },
  { value: "colleague", label: "Colleague" },
  { value: "community", label: "Community" },
  { value: "professional", label: "Professional" },
  { value: "other", label: "Other" }
];

export function WikiPeopleImportFlow({
  open,
  onOpenChange,
  onImported
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImported: (contexts: PersonContext[]) => void;
}) {
  const gateway = usePeopleGateway();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<ImportDraft>(EMPTY_IMPORT_DRAFT);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setDraft(EMPTY_IMPORT_DRAFT);
      setSubmitError(null);
    }
  }, [open]);

  const candidatesQuery = useQuery({
    queryKey: ["people", "wiki-import-candidates"],
    queryFn: () => gateway.scanWikiCandidates(),
    enabled: open,
    retry: false
  });
  const candidates = candidatesQuery.data ?? [];
  const importableCandidates = candidates.filter(
    (candidate) => !candidate.alreadyAssociatedPersonId
  );

  const enrichmentMutation = useMutation({
    mutationFn: (pageIds: string[]) => gateway.enrichWikiCandidates(pageIds),
    onSuccess: (result) => {
      setDraft((current) => ({
        ...current,
        suggestions: result.suggestions,
        enrichmentLabel: result.enriched
          ? `Prepared with ${result.profile?.label ?? "the configured Wiki LLM"}${result.profile?.model ? ` (${result.profile.model})` : ""}.`
          : "No Wiki LLM is configured. Forge used the existing page titles, summaries, and aliases."
      }));
    }
  });

  const importMutation = useMutation({
    mutationFn: (suggestions: WikiPersonImportDraft[]) =>
      gateway.importWikiPeople(suggestions),
    onSuccess: async (contexts) => {
      await queryClient.invalidateQueries({ queryKey: ["people"] });
      onImported(contexts);
      onOpenChange(false);
    }
  });

  const updateSuggestion = (
    pageId: string,
    patch: Partial<WikiPersonImportDraft>
  ) => {
    setDraft((current) => ({
      ...current,
      suggestions: current.suggestions.map((suggestion) =>
        suggestion.pageId === pageId ? { ...suggestion, ...patch } : suggestion
      )
    }));
  };

  const steps = useMemo<Array<QuestionFlowStep<ImportDraft>>>(
    () => [
      {
        id: "candidates",
        title: "Choose Wiki People pages",
        description:
          "Forge scans only the People section of your Wiki. Nothing is created or changed until you review and confirm the import.",
        render: (value, setValue) => (
          <div className="grid gap-3">
            {candidatesQuery.isLoading ? (
              <p role="status" className="text-sm text-[var(--ui-ink-muted)]">
                Scanning Wiki People pages...
              </p>
            ) : candidatesQuery.error ? (
              <PeopleStateBanner state="danger" title="Wiki scan failed">
                {candidatesQuery.error instanceof Error
                  ? candidatesQuery.error.message
                  : "Wiki People pages could not be scanned."}
              </PeopleStateBanner>
            ) : importableCandidates.length === 0 ? (
              <InlineEmpty>
                No unlinked Wiki People pages are available to import.
              </InlineEmpty>
            ) : (
              <div className="grid gap-2">
                {importableCandidates.map((candidate) => {
                  const checked = value.selectedPageIds.includes(
                    candidate.pageId
                  );
                  return (
                    <label
                      key={candidate.pageId}
                      className="grid min-h-11 cursor-pointer grid-cols-[auto_minmax(0,1fr)] gap-3 rounded-lg border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] p-3 has-[:checked]:border-[var(--primary)] has-[:checked]:bg-[var(--ui-accent-soft)]"
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() =>
                          setValue({
                            selectedPageIds: checked
                              ? value.selectedPageIds.filter(
                                  (pageId) => pageId !== candidate.pageId
                                )
                              : [...value.selectedPageIds, candidate.pageId],
                            suggestions: [],
                            enrichmentLabel: null
                          })
                        }
                        className="mt-1 size-4"
                      />
                      <span className="min-w-0">
                        <span className="flex items-center gap-2 font-medium text-[var(--ui-ink-strong)]">
                          <FileText className="size-4 text-[var(--primary)]" />
                          {candidate.title}
                        </span>
                        <span className="mt-1 block text-xs text-[var(--ui-ink-muted)]">
                          {candidate.pathLabel}
                        </span>
                        {candidate.excerpt ? (
                          <span className="mt-2 block text-sm leading-5 text-[var(--ui-ink-medium)]">
                            {candidate.excerpt}
                          </span>
                        ) : null}
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
        id: "details",
        title: "Prepare and review Person details",
        description:
          "If a Wiki LLM is configured, Forge uses it to propose only supported Person details. You remain responsible for every field below.",
        render: (value) => (
          <div className="grid gap-4">
            {value.suggestions.length === 0 ? (
              <div className="grid justify-items-start gap-3 rounded-lg border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] p-4">
                <p className="text-sm leading-6 text-[var(--ui-ink-medium)]">
                  Prepare {value.selectedPageIds.length} selected
                  {value.selectedPageIds.length === 1 ? " page" : " pages"}.
                  Forge will use your configured Wiki LLM when available and
                  fall back to existing Wiki metadata otherwise.
                </p>
                <Button
                  type="button"
                  pending={enrichmentMutation.isPending}
                  onClick={() =>
                    enrichmentMutation.mutate(value.selectedPageIds)
                  }
                >
                  <Sparkles className="size-4" />
                  Prepare details
                </Button>
                {enrichmentMutation.error instanceof Error ? (
                  <p role="alert" className="text-sm text-[var(--danger)]">
                    {enrichmentMutation.error.message}
                  </p>
                ) : null}
              </div>
            ) : (
              <>
                <PeopleStateBanner state="info" title="Suggestions prepared">
                  {value.enrichmentLabel}
                </PeopleStateBanner>
                {value.suggestions.map((suggestion) => (
                  <div
                    key={suggestion.pageId}
                    className="grid gap-3 rounded-lg border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] p-4"
                  >
                    <FlowField label="Name">
                      <Input
                        value={suggestion.displayName}
                        onChange={(event) =>
                          updateSuggestion(suggestion.pageId, {
                            displayName: event.target.value
                          })
                        }
                      />
                    </FlowField>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <FlowField label="Preferred name" hint="Optional">
                        <Input
                          value={suggestion.preferredName}
                          onChange={(event) =>
                            updateSuggestion(suggestion.pageId, {
                              preferredName: event.target.value
                            })
                          }
                        />
                      </FlowField>
                      <FlowField label="Relationship">
                        <select
                          value={suggestion.relationshipCategory}
                          onChange={(event) =>
                            updateSuggestion(suggestion.pageId, {
                              relationshipCategory: event.target
                                .value as PersonRelationshipCategory
                            })
                          }
                          className="interactive-tap min-h-11 w-full rounded-lg border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)] px-3 text-[var(--ui-ink-strong)]"
                        >
                          {RELATIONSHIP_OPTIONS.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                      </FlowField>
                    </div>
                    <FlowField label="Relationship label" hint="Optional">
                      <Input
                        value={suggestion.relationshipLabel}
                        onChange={(event) =>
                          updateSuggestion(suggestion.pageId, {
                            relationshipLabel: event.target.value
                          })
                        }
                      />
                    </FlowField>
                    <FlowField label="Short description" hint="Optional">
                      <Textarea
                        value={suggestion.shortDescription}
                        onChange={(event) =>
                          updateSuggestion(suggestion.pageId, {
                            shortDescription: event.target.value
                          })
                        }
                      />
                    </FlowField>
                    <FlowField
                      label="Aliases"
                      description="One alias per line"
                      hint="Optional"
                    >
                      <Textarea
                        value={suggestion.aliases.join("\n")}
                        onChange={(event) =>
                          updateSuggestion(suggestion.pageId, {
                            aliases: event.target.value
                              .split("\n")
                              .map((alias) => alias.trim())
                              .filter(Boolean)
                              .slice(0, 32)
                          })
                        }
                      />
                    </FlowField>
                  </div>
                ))}
              </>
            )}
          </div>
        )
      },
      {
        id: "review",
        title: "Confirm the Wiki import",
        description:
          "Forge will create these Person records and link each one to its existing Wiki page. Wiki content remains unchanged.",
        render: (value) => (
          <div className="grid gap-2">
            {value.suggestions.map((suggestion) => (
              <div
                key={suggestion.pageId}
                className="flex min-h-11 items-start gap-3 rounded-lg border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] p-3"
              >
                <UserRoundPlus className="mt-0.5 size-4 text-[var(--primary)]" />
                <div>
                  <div className="font-medium text-[var(--ui-ink-strong)]">
                    {suggestion.displayName}
                  </div>
                  <div className="mt-1 text-sm text-[var(--ui-ink-muted)]">
                    {suggestion.relationshipLabel ||
                      RELATIONSHIP_OPTIONS.find(
                        (option) =>
                          option.value === suggestion.relationshipCategory
                      )?.label}
                    {suggestion.shortDescription
                      ? ` · ${suggestion.shortDescription}`
                      : ""}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )
      }
    ],
    [
      candidatesQuery.error,
      candidatesQuery.isLoading,
      enrichmentMutation,
      importableCandidates
    ]
  );

  return (
    <QuestionFlowDialog
      open={open}
      onOpenChange={onOpenChange}
      eyebrow="People and Wiki"
      title="Import People from Wiki"
      description="Turn reviewed Wiki People pages into linked Person records without changing the Wiki."
      value={draft}
      onChange={setDraft}
      steps={steps}
      submitLabel={`Import ${draft.suggestions.length || "People"}`}
      pending={importMutation.isPending}
      pendingLabel="Importing"
      error={
        submitError ??
        (importMutation.error instanceof Error
          ? importMutation.error.message
          : null)
      }
      resolveContinueBlocker={(stepId, value) => {
        if (stepId === "candidates" && value.selectedPageIds.length === 0) {
          return "Choose at least one Wiki People page to continue.";
        }
        if (stepId === "candidates" && value.selectedPageIds.length > 20) {
          return "Import at most 20 People at once.";
        }
        if (stepId === "details" && value.suggestions.length === 0) {
          return "Prepare and review the Person details before continuing.";
        }
        if (
          stepId === "details" &&
          value.suggestions.some((suggestion) => !suggestion.displayName.trim())
        ) {
          return "Every imported Person needs a name.";
        }
        return null;
      }}
      onSubmit={async () => {
        if (
          draft.suggestions.length === 0 ||
          draft.suggestions.some((suggestion) => !suggestion.displayName.trim())
        ) {
          setSubmitError("Review every imported Person before continuing.");
          return;
        }
        setSubmitError(null);
        try {
          await importMutation.mutateAsync(draft.suggestions);
        } catch {
          // The mutation error stays visible in the guided flow.
        }
      }}
    />
  );
}
