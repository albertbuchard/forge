import {
  LockKeyhole,
  Pencil,
  Plus,
  RotateCcw,
  Search,
  Trash2
} from "lucide-react";
import {
  FlowChoiceGrid,
  FlowField,
  QuestionFlowDialog,
  type QuestionFlowStep
} from "@/components/flows/question-flow-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { UserSelectField } from "@/components/ui/user-select-field";
import type { EmotionDefinition, EventType } from "@/lib/psyche-types";
import type { UserSummary } from "@/lib/types";
import { cn } from "@/lib/utils";

const MAX_VISIBLE_VOCABULARY_ROWS = 50;

export type PsycheVocabularyKind = "event_type" | "emotion_definition";
export type PsycheVocabularyAction = "create" | "update" | "delete";

export type PsycheVocabularyDraft = {
  kind: PsycheVocabularyKind;
  action: PsycheVocabularyAction | null;
  selectedId: string | null;
  search: string;
  label: string;
  description: string;
  category: string;
  userId: string | null;
  confirmDelete: boolean;
};

export function createPsycheVocabularyDraft(
  userId: string | null
): PsycheVocabularyDraft {
  return {
    kind: "event_type",
    action: null,
    selectedId: null,
    search: "",
    label: "",
    description: "",
    category: "",
    userId,
    confirmDelete: false
  };
}

type VocabularyEntry = EventType | EmotionDefinition;

function isEmotionDefinition(
  entry: VocabularyEntry
): entry is EmotionDefinition {
  return "category" in entry;
}

function vocabularyLabel(kind: PsycheVocabularyKind) {
  return kind === "event_type" ? "event type" : "emotion definition";
}

function matchingEntries(
  kind: PsycheVocabularyKind,
  eventTypes: EventType[],
  emotions: EmotionDefinition[],
  search: string
) {
  const query = search.trim().toLocaleLowerCase();
  const entries: VocabularyEntry[] =
    kind === "event_type" ? eventTypes : emotions;
  return entries
    .filter((entry) => {
      if (!query) {
        return true;
      }
      return [
        entry.label,
        entry.description,
        isEmotionDefinition(entry) ? entry.category : ""
      ]
        .join(" ")
        .toLocaleLowerCase()
        .includes(query);
    })
    .sort(
      (left, right) =>
        Number(right.system) - Number(left.system) ||
        left.label.localeCompare(right.label)
    );
}

function selectedEntry(
  value: PsycheVocabularyDraft,
  eventTypes: EventType[],
  emotions: EmotionDefinition[]
) {
  if (!value.selectedId) {
    return null;
  }
  return (value.kind === "event_type" ? eventTypes : emotions).find(
    (entry) => entry.id === value.selectedId
  );
}

export function PsycheVocabularyFlowDialog({
  open,
  onOpenChange,
  value,
  onChange,
  eventTypes,
  emotions,
  users,
  loading,
  loadError,
  onRetry,
  pending,
  error,
  onSubmit
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  value: PsycheVocabularyDraft;
  onChange: (value: PsycheVocabularyDraft) => void;
  eventTypes: EventType[];
  emotions: EmotionDefinition[];
  users: UserSummary[];
  loading: boolean;
  loadError: boolean;
  onRetry: () => void;
  pending: boolean;
  error: string | null;
  onSubmit: () => Promise<void>;
}) {
  const entry = selectedEntry(value, eventTypes, emotions);
  const noun = vocabularyLabel(value.kind);

  const steps: Array<QuestionFlowStep<PsycheVocabularyDraft>> = [
    {
      id: "choose",
      eyebrow: "Reusable wording",
      title: "Which vocabulary do you want to maintain?",
      description:
        "Built-in labels stay available to everyone. Custom labels belong to the selected Forge user.",
      render: (draft, setValue) => {
        const matches = matchingEntries(
          draft.kind,
          eventTypes,
          emotions,
          draft.search
        );
        const visibleMatches = matches.slice(0, MAX_VISIBLE_VOCABULARY_ROWS);
        return (
          <>
            <FlowChoiceGrid
              value={draft.kind}
              onChange={(kind) =>
                setValue({
                  kind: kind as PsycheVocabularyKind,
                  action: null,
                  selectedId: null,
                  search: "",
                  label: "",
                  description: "",
                  category: "",
                  confirmDelete: false
                })
              }
              options={[
                {
                  value: "event_type",
                  label: "Event types",
                  description: "Recurring kinds of meaningful moments."
                },
                {
                  value: "emotion_definition",
                  label: "Emotion definitions",
                  description: "Reusable feeling labels and distinctions."
                }
              ]}
            />
            <div className="flex flex-wrap items-end gap-3">
              <FlowField label={`Find a ${vocabularyLabel(draft.kind)}`}>
                <div className="relative min-w-[min(100%,18rem)] flex-1">
                  <Search
                    aria-hidden="true"
                    className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[var(--ui-ink-faint)]"
                  />
                  <Input
                    value={draft.search}
                    onChange={(event) =>
                      setValue({ search: event.target.value })
                    }
                    placeholder="Search labels and descriptions"
                    className="pl-9"
                  />
                </div>
              </FlowField>
              <Button
                type="button"
                onClick={() =>
                  setValue({
                    action: "create",
                    selectedId: null,
                    label: "",
                    description: "",
                    category: "",
                    confirmDelete: false
                  })
                }
              >
                <Plus className="size-4" />
                Add {vocabularyLabel(draft.kind)}
              </Button>
            </div>

            {loading ? (
              <div
                role="status"
                className="py-8 text-center text-sm text-[var(--ui-ink-soft)]"
              >
                Loading reusable labels…
              </div>
            ) : loadError ? (
              <div
                role="alert"
                className="flex flex-wrap items-center justify-between gap-3 rounded-[20px] border border-[color-mix(in_srgb,var(--danger)_28%,var(--ui-border-subtle)_72%)] bg-[var(--ui-danger-soft)] px-4 py-3 text-sm text-[var(--danger)]"
              >
                <span>Reusable labels could not be loaded.</span>
                <Button type="button" variant="secondary" onClick={onRetry}>
                  <RotateCcw className="size-4" />
                  Retry
                </Button>
              </div>
            ) : matches.length === 0 ? (
              <div className="rounded-[20px] border border-dashed border-[var(--ui-border-subtle)] px-4 py-8 text-center text-sm text-[var(--ui-ink-soft)]">
                No matching{" "}
                {draft.kind === "event_type"
                  ? "event types"
                  : "emotion definitions"}
                .
              </div>
            ) : (
              <div
                className="grid gap-2"
                role="list"
                aria-label={`${draft.kind} vocabulary`}
              >
                {visibleMatches.map((candidate) => {
                  const selected =
                    draft.selectedId === candidate.id &&
                    draft.action === "update";
                  const detail =
                    (isEmotionDefinition(candidate) && candidate.category) ||
                    candidate.description;
                  return candidate.system ? (
                    <div
                      key={candidate.id}
                      role="listitem"
                      className="flex min-w-0 items-start gap-3 rounded-[20px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] px-4 py-3"
                    >
                      <LockKeyhole
                        aria-label="Built-in label"
                        className="mt-0.5 size-4 shrink-0 text-[var(--ui-ink-faint)]"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="break-words text-sm font-medium text-[var(--ui-ink-strong)]">
                          {candidate.label}
                        </div>
                        <div className="mt-1 break-words text-xs leading-5 text-[var(--ui-ink-soft)]">
                          {detail || "Built-in"}
                        </div>
                      </div>
                      <span className="shrink-0 text-xs text-[var(--ui-ink-faint)]">
                        Built-in
                      </span>
                    </div>
                  ) : (
                    <div key={candidate.id} role="listitem">
                      <button
                        type="button"
                        aria-pressed={selected}
                        className={cn(
                          "flex w-full min-w-0 items-start gap-3 rounded-[20px] border px-4 py-3 text-left transition",
                          selected
                            ? "border-[var(--primary)] bg-[var(--ui-accent-soft)]"
                            : "border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] hover:bg-[var(--ui-surface-hover)]"
                        )}
                        onClick={() =>
                          setValue({
                            action: "update",
                            selectedId: candidate.id,
                            label: candidate.label,
                            description: candidate.description,
                            category: isEmotionDefinition(candidate)
                              ? candidate.category
                              : "",
                            userId: candidate.userId ?? draft.userId,
                            confirmDelete: false
                          })
                        }
                      >
                        <Pencil
                          aria-hidden="true"
                          className="mt-0.5 size-4 shrink-0 text-[var(--ui-ink-faint)]"
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block break-words text-sm font-medium text-[var(--ui-ink-strong)]">
                            {candidate.label}
                          </span>
                          <span className="mt-1 block break-words text-xs leading-5 text-[var(--ui-ink-soft)]">
                            {detail || "Custom label"}
                          </span>
                        </span>
                        <span className="shrink-0 text-xs text-[var(--ui-ink-faint)]">
                          Custom
                        </span>
                      </button>
                    </div>
                  );
                })}
                {matches.length > visibleMatches.length ? (
                  <p
                    role="status"
                    className="px-1 text-xs leading-5 text-[var(--ui-ink-soft)]"
                  >
                    Showing {visibleMatches.length} of {matches.length} matches.
                    Refine the search to reach the rest.
                  </p>
                ) : null}
              </div>
            )}
          </>
        );
      }
    },
    {
      id: "define",
      eyebrow: "Definition",
      title:
        value.action === "delete"
          ? `Remove “${value.label}”?`
          : value.action === "update"
            ? `Refine “${value.label}”`
            : `Name the ${noun}`,
      description:
        value.action === "delete"
          ? "Reports keep the words that were recorded at the time."
          : "Keep the label concise and use the description for the distinction that should remain stable.",
      render: (draft, setValue) =>
        draft.action === "delete" ? (
          <button
            type="button"
            role="switch"
            aria-checked={draft.confirmDelete}
            className="flex min-w-0 items-start gap-3 rounded-[20px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] px-4 py-4 text-left"
            onClick={() => setValue({ confirmDelete: !draft.confirmDelete })}
          >
            <span
              aria-hidden="true"
              className={cn(
                "mt-0.5 inline-flex h-6 w-11 shrink-0 items-center rounded-full p-0.5 transition",
                draft.confirmDelete
                  ? "justify-end bg-[var(--danger)]"
                  : "justify-start bg-[var(--ui-surface-3)]"
              )}
            >
              <span className="size-5 rounded-full bg-[var(--ui-ink-strong)] shadow-sm" />
            </span>
            <span className="min-w-0">
              <span className="block font-medium text-[var(--ui-ink-strong)]">
                Remove this custom label
              </span>
              <span className="mt-1 block text-sm leading-6 text-[var(--ui-ink-soft)]">
                It moves to the bin and can be restored. Existing report wording
                is unchanged.
              </span>
            </span>
          </button>
        ) : (
          <>
            <FlowField label="Label">
              <Input
                autoFocus
                maxLength={160}
                value={draft.label}
                onChange={(event) => setValue({ label: event.target.value })}
                placeholder={
                  draft.kind === "event_type"
                    ? "Unexpected distance after vulnerability"
                    : "Exposed alarm"
                }
              />
            </FlowField>
            <FlowField
              label="Description"
              description={
                draft.kind === "event_type"
                  ? "What makes a future moment belong to this type?"
                  : "What makes this feeling recognizable and distinct?"
              }
            >
              <Textarea
                maxLength={2000}
                value={draft.description}
                onChange={(event) =>
                  setValue({ description: event.target.value })
                }
                placeholder={
                  draft.kind === "event_type"
                    ? "A moment when openness is followed by withdrawal or silence."
                    : "A hot social-threat feeling with a chest drop and an urge to disappear."
                }
              />
            </FlowField>
            {draft.kind === "emotion_definition" ? (
              <FlowField
                label="Category"
                description="Optional broad family, such as threat, grief, anger, or connection."
              >
                <Input
                  maxLength={160}
                  value={draft.category}
                  onChange={(event) =>
                    setValue({ category: event.target.value })
                  }
                  placeholder="Threat"
                />
              </FlowField>
            ) : null}
            <UserSelectField
              value={draft.userId}
              users={users}
              onChange={(userId) => setValue({ userId })}
              label="Vocabulary owner"
              defaultLabel="Default Forge owner"
              help="Custom labels are visible within this owner’s Psyche scope."
            />
            {draft.action === "update" && entry ? (
              <div className="flex justify-end">
                <Button
                  type="button"
                  variant="secondary"
                  className="text-[var(--danger)]"
                  onClick={() =>
                    setValue({ action: "delete", confirmDelete: false })
                  }
                >
                  <Trash2 className="size-4" />
                  Delete custom label
                </Button>
              </div>
            ) : null}
          </>
        )
    },
    {
      id: "review",
      eyebrow: "Review",
      title:
        value.action === "delete"
          ? `Remove “${value.label}”`
          : value.action === "update"
            ? `Update “${value.label}”`
            : `Add “${value.label}”`,
      description:
        "Reusable labels support consistent reports, while each report keeps the wording entered for that episode.",
      render: (draft) => (
        <dl className="grid gap-3 rounded-[20px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] p-4 text-sm">
          <div className="grid gap-1 sm:grid-cols-[9rem_minmax(0,1fr)]">
            <dt className="text-[var(--ui-ink-faint)]">Action</dt>
            <dd className="break-words text-[var(--ui-ink-strong)]">
              {draft.action}
            </dd>
          </div>
          <div className="grid gap-1 sm:grid-cols-[9rem_minmax(0,1fr)]">
            <dt className="text-[var(--ui-ink-faint)]">Label</dt>
            <dd className="break-words text-[var(--ui-ink-strong)]">
              {draft.label}
            </dd>
          </div>
          {draft.description ? (
            <div className="grid gap-1 sm:grid-cols-[9rem_minmax(0,1fr)]">
              <dt className="text-[var(--ui-ink-faint)]">Definition</dt>
              <dd className="break-words text-[var(--ui-ink-strong)]">
                {draft.description}
              </dd>
            </div>
          ) : null}
        </dl>
      )
    }
  ];

  return (
    <QuestionFlowDialog
      open={open}
      onOpenChange={onOpenChange}
      eyebrow="Psyche vocabulary"
      title="Maintain report vocabulary"
      description="Add, refine, or remove reusable event and emotion wording."
      value={value}
      onChange={onChange}
      steps={steps}
      submitLabel={
        value.action === "delete"
          ? "Delete label"
          : value.action === "update"
            ? "Save changes"
            : "Add label"
      }
      pending={pending}
      pendingLabel="Saving"
      error={error}
      resolveContinueBlocker={(stepId, draft) => {
        if (stepId === "choose" && loading) {
          return "Wait for reusable labels to finish loading.";
        }
        if (stepId === "choose" && loadError) {
          return "Retry loading reusable labels before continuing.";
        }
        if (stepId === "choose" && !draft.action) {
          return "Choose a custom label or add a new one before continuing.";
        }
        if (
          stepId === "define" &&
          draft.action !== "delete" &&
          !draft.label.trim()
        ) {
          return "Add the wording you want to reuse.";
        }
        if (
          stepId === "define" &&
          draft.action === "delete" &&
          !draft.confirmDelete
        ) {
          return "Confirm that this custom label should move to the bin.";
        }
        return null;
      }}
      resolveContinueBlockerTone={(stepId) =>
        stepId === "choose" ? "guidance" : "error"
      }
      onSubmit={onSubmit}
    />
  );
}
