import { useEffect, useMemo, useState, type ReactNode } from "react";

import {
  FlowChoiceGrid,
  FlowField,
  QuestionFlowDialog,
  type QuestionFlowStep
} from "@/components/flows/question-flow-dialog";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { UserBadge } from "@/components/ui/user-badge";
import { describeApiError } from "@/lib/api-error";
import type {
  PreferenceCatalog,
  PreferenceContext,
  PreferenceContextShareMode,
  PreferenceDomain,
  PreferenceWorkspacePayload,
  UserSummary
} from "@/lib/types";
import type { CandidateEntity } from "./preferences-workspace-model";

export type PreferenceGuidedFlow =
  | { kind: "catalog" }
  | { kind: "catalog-item"; catalog: PreferenceCatalog }
  | { kind: "item" }
  | { kind: "context"; context?: PreferenceContext }
  | { kind: "merge" }
  | {
      kind: "entity";
      candidate: CandidateEntity;
      existingItemId?: string;
    };

export type PreferenceGuidedSubmit =
  | {
      kind: "catalog";
      title: string;
      description: string;
    }
  | {
      kind: "catalog-item";
      catalogId: string;
      label: string;
      description: string;
      tags: string[];
    }
  | {
      kind: "item";
      label: string;
      description: string;
      tags: string[];
      queueForCompare: boolean;
    }
  | {
      kind: "context";
      contextId?: string;
      name: string;
      description: string;
      shareMode: PreferenceContextShareMode;
      decayDays: number;
    }
  | {
      kind: "merge";
      sourceContextId: string;
      targetContextId: string;
    }
  | {
      kind: "entity";
      candidate: CandidateEntity;
    };

type PreferenceFlowDraft = {
  title: string;
  label: string;
  description: string;
  tags: string;
  queueForCompare: boolean;
  name: string;
  shareMode: PreferenceContextShareMode;
  decayDays: string;
  sourceContextId: string;
  targetContextId: string;
};

const CONTEXT_EFFECTS: Record<PreferenceContextShareMode, string> = {
  shared:
    "Evidence from every active context contributes at full weight to this context.",
  blended:
    "Evidence from this context contributes at full weight; other active contexts contribute at 45%.",
  isolated:
    "Only judgments and signals recorded in this context affect its inferred scores."
};

function normalizeLabel(value: string) {
  return value.trim().toLocaleLowerCase();
}

function parseTags(value: string) {
  return [
    ...new Set(
      value
        .split(",")
        .map((tag) => tag.trim())
        .filter(Boolean)
    )
  ];
}

function buildDraft(flow: PreferenceGuidedFlow | null): PreferenceFlowDraft {
  const context = flow?.kind === "context" ? flow.context : undefined;
  return {
    title: "",
    label: "",
    description: context?.description ?? "",
    tags: "",
    queueForCompare: true,
    name: context?.name ?? "",
    shareMode: context?.shareMode ?? "blended",
    decayDays: String(context?.decayDays ?? 90),
    sourceContextId: "",
    targetContextId: ""
  };
}

function ModelEffect({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-[18px] border border-[var(--ui-border-subtle)] bg-[var(--ui-accent-soft)] px-4 py-3 text-sm leading-6 text-[var(--ui-ink-medium)]">
      <div className="text-[11px] uppercase tracking-[0.16em] text-[var(--primary)]">
        Model effect
      </div>
      <div className="mt-1">{children}</div>
    </div>
  );
}

function ProvenanceSummary({
  user,
  domain,
  source
}: {
  user: UserSummary | null;
  domain: PreferenceDomain;
  source: string;
}) {
  return (
    <div className="grid gap-3 rounded-[18px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] px-4 py-4">
      <div className="text-[11px] uppercase tracking-[0.16em] text-[var(--ui-ink-faint)]">
        Provenance
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <UserBadge user={user} compact />
        <Badge className="bg-[var(--ui-surface-2)] text-[var(--ui-ink-medium)]">
          {domain}
        </Badge>
        <Badge className="bg-[var(--ui-surface-2)] text-[var(--ui-ink-medium)]">
          {source}
        </Badge>
      </div>
    </div>
  );
}

export function PreferenceGuidedFlowDialog({
  flow,
  onOpenChange,
  pending,
  user,
  domain,
  workspace,
  onSubmit
}: {
  flow: PreferenceGuidedFlow | null;
  onOpenChange: (open: boolean) => void;
  pending: boolean;
  user: UserSummary | null;
  domain: PreferenceDomain;
  workspace: PreferenceWorkspacePayload;
  onSubmit: (input: PreferenceGuidedSubmit) => Promise<void>;
}) {
  const [draft, setDraft] = useState<PreferenceFlowDraft>(() =>
    buildDraft(flow)
  );
  const [submitError, setSubmitError] = useState<string | null>(null);
  const flowKey =
    flow?.kind === "catalog-item"
      ? `${flow.kind}:${flow.catalog.id}`
      : flow?.kind === "context"
        ? `${flow.kind}:${flow.context?.id ?? "new"}`
        : flow?.kind === "entity"
          ? `${flow.kind}:${flow.candidate.entityType}:${flow.candidate.entityId}`
          : (flow?.kind ?? "closed");

  useEffect(() => {
    if (!flow) {
      return;
    }
    setDraft(buildDraft(flow));
    setSubmitError(null);
  }, [flowKey, flow]);

  const duplicateError = useMemo(() => {
    if (!flow) {
      return null;
    }
    if (flow.kind === "catalog") {
      const title = normalizeLabel(draft.title);
      return title &&
        workspace.catalogs.some(
          (catalog) => normalizeLabel(catalog.title) === title
        )
        ? "A concept list with this title already exists in this owner and domain."
        : null;
    }
    if (flow.kind === "catalog-item") {
      const label = normalizeLabel(draft.label);
      return label &&
        flow.catalog.items.some((item) => normalizeLabel(item.label) === label)
        ? "This catalog already contains a concept with the same label."
        : null;
    }
    if (flow.kind === "context") {
      const name = normalizeLabel(draft.name);
      return name &&
        workspace.contexts.some(
          (context) =>
            context.id !== flow.context?.id &&
            normalizeLabel(context.name) === name
        )
        ? "A context with this name already exists in this preference profile."
        : null;
    }
    return null;
  }, [draft.label, draft.name, draft.title, flow, workspace]);
  const duplicateLabelWarning = useMemo(() => {
    if (flow?.kind !== "item") {
      return null;
    }
    const label = normalizeLabel(draft.label);
    return label &&
      workspace.scores.some(
        (score) => normalizeLabel(score.item?.label ?? "") === label
      )
      ? "Another item uses this label. It may still be a distinct preference record; check the description and provenance before saving."
      : null;
  }, [draft.label, flow, workspace.scores]);

  if (!flow) {
    return null;
  }

  const sourceContext = workspace.contexts.find(
    (context) => context.id === draft.sourceContextId
  );
  const targetContext = workspace.contexts.find(
    (context) => context.id === draft.targetContextId
  );

  const commonReview = (
    <ProvenanceSummary user={user} domain={domain} source="manual" />
  );

  let eyebrow = "Preferences";
  let title = "Update preference model";
  let description = "Review the model scope and provenance before saving.";
  let submitLabel = "Save";
  let pendingLabel = "Saving";
  let steps: Array<QuestionFlowStep<PreferenceFlowDraft>> = [];

  if (flow.kind === "catalog") {
    eyebrow = "Concept library";
    title = "Create a preference catalog";
    description =
      "Define one reusable comparison library for the selected owner and decision domain.";
    submitLabel = "Create catalog";
    pendingLabel = "Creating catalog";
    steps = [
      {
        id: "details",
        eyebrow: "Catalog purpose",
        title: "What decision should this catalog support?",
        description:
          "A catalog is a reusable library of concepts. It does not become evidence until you start a game from it.",
        render: (value, setValue) => (
          <>
            <FlowField label="Catalog title" error={duplicateError}>
              <Input
                autoFocus
                value={value.title}
                onChange={(event) => setValue({ title: event.target.value })}
                placeholder="Long-form writing styles"
              />
            </FlowField>
            <FlowField
              label="Decision purpose"
              description="Describe what the concepts should help compare."
            >
              <Textarea
                className="min-h-28"
                value={value.description}
                onChange={(event) =>
                  setValue({ description: event.target.value })
                }
                placeholder="Compare writing approaches for essays and research notes."
              />
            </FlowField>
          </>
        )
      },
      {
        id: "review",
        eyebrow: "Ownership and provenance",
        title: "Keep this library in the right model",
        description:
          "The catalog belongs to one user and one domain. Forge records it as a custom source and keeps its concepts separate from concrete scored items.",
        render: () => (
          <>
            {commonReview}
            <ModelEffect>
              Creating the catalog does not change any score. Starting a game
              from it creates or refreshes concrete items and queues
              comparisons.
            </ModelEffect>
          </>
        )
      }
    ];
  } else if (flow.kind === "catalog-item") {
    eyebrow = "Reusable concept";
    title = `Add a concept to ${flow.catalog.title}`;
    description =
      "Add one reusable catalog concept without creating direct model evidence.";
    submitLabel = "Add concept";
    pendingLabel = "Adding concept";
    steps = [
      {
        id: "details",
        eyebrow: "Concept details",
        title: "Name the reusable comparison concept",
        render: (value, setValue) => (
          <>
            <FlowField label="Concept label" error={duplicateError}>
              <Input
                autoFocus
                value={value.label}
                onChange={(event) => setValue({ label: event.target.value })}
                placeholder="Structured narrative"
              />
            </FlowField>
            <FlowField label="Description">
              <Textarea
                className="min-h-24"
                value={value.description}
                onChange={(event) =>
                  setValue({ description: event.target.value })
                }
                placeholder="A clear sequence with explicit transitions and evidence."
              />
            </FlowField>
            <FlowField label="Tags" hint="Separate tags with commas.">
              <Input
                value={value.tags}
                onChange={(event) => setValue({ tags: event.target.value })}
                placeholder="writing, structure"
              />
            </FlowField>
          </>
        )
      },
      {
        id: "review",
        eyebrow: "Catalog membership",
        title: "Confirm where this concept lives",
        render: () => (
          <>
            <div className="rounded-[18px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] px-4 py-4">
              <div className="font-medium text-[var(--ui-ink-strong)]">
                {flow.catalog.title}
              </div>
              <div className="mt-1 text-sm text-[var(--ui-ink-soft)]">
                {flow.catalog.source} catalog · {flow.catalog.items.length}{" "}
                existing concepts
              </div>
            </div>
            <ModelEffect>
              This remains a reusable catalog concept. It becomes a scored item
              only when the catalog is used to start a preference game.
            </ModelEffect>
          </>
        )
      }
    ];
  } else if (flow.kind === "item") {
    eyebrow = "Concrete item";
    title = "Add a direct preference item";
    description =
      "Create a concrete item in this model, separate from reusable catalog concepts.";
    submitLabel = "Create item";
    pendingLabel = "Creating item";
    steps = [
      {
        id: "details",
        eyebrow: "Item details",
        title: "What should Forge learn about?",
        render: (value, setValue) => (
          <>
            <FlowField label="Item label">
              <Input
                autoFocus
                value={value.label}
                onChange={(event) => setValue({ label: event.target.value })}
                placeholder="Narrative operating style"
              />
            </FlowField>
            {duplicateLabelWarning ? (
              <div
                role="status"
                className="rounded-[18px] border border-[color-mix(in_srgb,var(--warning)_28%,var(--ui-border-subtle)_72%)] bg-[var(--ui-warning-soft)] px-4 py-3 text-sm leading-6 text-[var(--ui-ink-medium)]"
              >
                {duplicateLabelWarning}
              </div>
            ) : null}
            <FlowField label="Description">
              <Textarea
                className="min-h-24"
                value={value.description}
                onChange={(event) =>
                  setValue({ description: event.target.value })
                }
                placeholder="A concrete option that can be compared and scored."
              />
            </FlowField>
            <FlowField label="Tags" hint="Separate tags with commas.">
              <Input
                value={value.tags}
                onChange={(event) => setValue({ tags: event.target.value })}
                placeholder="writing, focus"
              />
            </FlowField>
          </>
        )
      },
      {
        id: "review",
        eyebrow: "Initial model effect",
        title: "Choose whether to compare it next",
        render: (value, setValue) => (
          <>
            {commonReview}
            <FlowChoiceGrid
              value={value.queueForCompare ? "queue" : "hold"}
              onChange={(next) =>
                setValue({ queueForCompare: next === "queue" })
              }
              options={[
                {
                  value: "queue",
                  label: "Queue for comparison",
                  description:
                    "Bookmark it and make it eligible for upcoming pairwise rounds."
                },
                {
                  value: "hold",
                  label: "Create only",
                  description:
                    "Keep the item in the model without explicitly adding it to the comparison queue."
                }
              ]}
            />
          </>
        )
      }
    ];
  } else if (flow.kind === "context") {
    const editing = Boolean(flow.context);
    eyebrow = "Preference context";
    title = editing
      ? `Edit ${flow.context?.name}`
      : "Create a preference context";
    description =
      "Contexts keep situational preference evidence explicit and control how evidence is shared.";
    submitLabel = editing ? "Save context" : "Create context";
    pendingLabel = editing ? "Saving context" : "Creating context";
    steps = [
      {
        id: "details",
        eyebrow: "Situation",
        title: "When should this preference model apply?",
        render: (value, setValue) => (
          <>
            <FlowField label="Context name" error={duplicateError}>
              <Input
                autoFocus
                value={value.name}
                onChange={(event) => setValue({ name: event.target.value })}
                placeholder="Deep work"
              />
            </FlowField>
            <FlowField
              label="Context boundary"
              description="Describe what is different here so future evidence stays interpretable."
            >
              <Textarea
                className="min-h-28"
                value={value.description}
                onChange={(event) =>
                  setValue({ description: event.target.value })
                }
                placeholder="Use for deliberate project work that needs sustained focus."
              />
            </FlowField>
          </>
        )
      },
      {
        id: "model",
        eyebrow: "Evidence policy",
        title: "How should evidence cross context boundaries?",
        render: (value, setValue) => (
          <>
            <FlowChoiceGrid
              columns={3}
              value={value.shareMode}
              onChange={(next) =>
                setValue({ shareMode: next as PreferenceContextShareMode })
              }
              options={(
                [
                  "shared",
                  "blended",
                  "isolated"
                ] as PreferenceContextShareMode[]
              ).map((shareMode) => ({
                value: shareMode,
                label: shareMode[0]!.toUpperCase() + shareMode.slice(1),
                description: CONTEXT_EFFECTS[shareMode]
              }))}
            />
            <FlowField
              label="Evidence decay window"
              description="Older evidence loses influence gradually. Choose 7 to 365 days."
            >
              <Input
                type="number"
                min={7}
                max={365}
                inputMode="numeric"
                value={value.decayDays}
                onChange={(event) =>
                  setValue({ decayDays: event.target.value })
                }
              />
            </FlowField>
            <ModelEffect>{CONTEXT_EFFECTS[value.shareMode]}</ModelEffect>
          </>
        )
      }
    ];
  } else if (flow.kind === "merge") {
    eyebrow = "Context merge";
    title = "Merge preference contexts";
    description =
      "Move all evidence into one target context without deleting the source record.";
    submitLabel = "Merge contexts";
    pendingLabel = "Merging contexts";
    steps = [
      {
        id: "contexts",
        eyebrow: "Source and target",
        title: "Which context should remain active?",
        render: (value, setValue) => (
          <div className="grid gap-5 md:grid-cols-2">
            <FlowField
              label="Source context"
              description="Its judgments and signals move to the target, then it becomes inactive."
            >
              <select
                value={value.sourceContextId}
                onChange={(event) =>
                  setValue({ sourceContextId: event.target.value })
                }
                className="min-h-11 rounded-[14px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)] px-3 text-sm text-[var(--ui-ink-strong)]"
              >
                <option value="">Choose source</option>
                {workspace.contexts
                  .filter((context) => context.active && !context.isDefault)
                  .map((context) => (
                    <option key={context.id} value={context.id}>
                      {context.name}
                    </option>
                  ))}
              </select>
            </FlowField>
            <FlowField
              label="Target context"
              description="This context keeps its identity and receives the source evidence."
            >
              <select
                value={value.targetContextId}
                onChange={(event) =>
                  setValue({ targetContextId: event.target.value })
                }
                className="min-h-11 rounded-[14px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)] px-3 text-sm text-[var(--ui-ink-strong)]"
              >
                <option value="">Choose target</option>
                {workspace.contexts
                  .filter((context) => context.active)
                  .map((context) => (
                    <option key={context.id} value={context.id}>
                      {context.name}
                    </option>
                  ))}
              </select>
            </FlowField>
          </div>
        )
      },
      {
        id: "review",
        eyebrow: "Evidence preservation",
        title: "Review the irreversible model change",
        render: () => (
          <>
            <div className="grid gap-3 md:grid-cols-2">
              <div className="rounded-[18px] bg-[var(--ui-surface-1)] px-4 py-4">
                <div className="text-xs text-[var(--ui-ink-faint)]">Source</div>
                <div className="mt-1 font-medium text-[var(--ui-ink-strong)]">
                  {sourceContext?.name ?? "Choose a source"}
                </div>
              </div>
              <div className="rounded-[18px] bg-[var(--ui-surface-1)] px-4 py-4">
                <div className="text-xs text-[var(--ui-ink-faint)]">Target</div>
                <div className="mt-1 font-medium text-[var(--ui-ink-strong)]">
                  {targetContext?.name ?? "Choose a target"}
                </div>
              </div>
            </div>
            <ModelEffect>
              All source judgments and signals are reassigned to the target,
              source score caches are removed, the source is retained as
              inactive, and the target scores are recalculated from the merged
              evidence.
            </ModelEffect>
          </>
        )
      }
    ];
  } else {
    const { candidate, existingItemId } = flow;
    eyebrow = "Linked Forge record";
    title = existingItemId
      ? "Refresh linked preference item"
      : "Add linked preference item";
    description =
      "Keep the original Forge identity as provenance instead of copying the record into an unrelated item.";
    submitLabel = existingItemId
      ? "Keep in comparison queue"
      : "Add linked item";
    pendingLabel = existingItemId ? "Refreshing link" : "Adding linked item";
    steps = [
      {
        id: "identity",
        eyebrow: "Source identity",
        title: candidate.label,
        description:
          candidate.description || "This source has no description yet.",
        render: () => (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <Badge className="bg-[var(--ui-surface-2)] text-[var(--ui-ink-medium)]">
                {candidate.entityType}
              </Badge>
              <Badge className="bg-[var(--ui-surface-2)] text-[var(--ui-ink-medium)]">
                {candidate.entityId}
              </Badge>
              {candidate.user ? (
                <UserBadge user={candidate.user} compact />
              ) : null}
            </div>
            {existingItemId ? (
              <div className="rounded-[18px] bg-[var(--ui-warning-soft)] px-4 py-3 text-sm text-[var(--ui-ink-medium)]">
                This source is already linked as {existingItemId}. Forge will
                reuse it and will not duplicate the source identity.
              </div>
            ) : null}
          </>
        )
      },
      {
        id: "review",
        eyebrow: "Queue and provenance",
        title: "Confirm the model destination",
        render: () => (
          <>
            <ProvenanceSummary
              user={user}
              domain={domain}
              source="linked Forge entity"
            />
            <ModelEffect>
              Forge stores the source type and source id on the preference item,
              bookmarks it, and queues it for comparison in the default context.
              Repeating this action reuses the same linked item.
            </ModelEffect>
          </>
        )
      }
    ];
  }

  const submit = async () => {
    setSubmitError(null);
    if (duplicateError) {
      setSubmitError(duplicateError);
      return;
    }
    let input: PreferenceGuidedSubmit;
    if (flow.kind === "catalog") {
      if (!draft.title.trim()) {
        setSubmitError("Add a catalog title before creating the library.");
        return;
      }
      input = {
        kind: "catalog",
        title: draft.title.trim(),
        description: draft.description.trim()
      };
    } else if (flow.kind === "catalog-item") {
      if (!draft.label.trim()) {
        setSubmitError("Add a concept label before saving.");
        return;
      }
      input = {
        kind: "catalog-item",
        catalogId: flow.catalog.id,
        label: draft.label.trim(),
        description: draft.description.trim(),
        tags: parseTags(draft.tags)
      };
    } else if (flow.kind === "item") {
      if (!draft.label.trim()) {
        setSubmitError("Add an item label before saving.");
        return;
      }
      input = {
        kind: "item",
        label: draft.label.trim(),
        description: draft.description.trim(),
        tags: parseTags(draft.tags),
        queueForCompare: draft.queueForCompare
      };
    } else if (flow.kind === "context") {
      const decayDays = Number(draft.decayDays);
      if (!draft.name.trim()) {
        setSubmitError("Add a context name before saving.");
        return;
      }
      if (!Number.isInteger(decayDays) || decayDays < 7 || decayDays > 365) {
        setSubmitError(
          "Evidence decay must be a whole number from 7 to 365 days."
        );
        return;
      }
      input = {
        kind: "context",
        contextId: flow.context?.id,
        name: draft.name.trim(),
        description: draft.description.trim(),
        shareMode: draft.shareMode,
        decayDays
      };
    } else if (flow.kind === "merge") {
      if (!draft.sourceContextId || !draft.targetContextId) {
        setSubmitError("Choose both a source and target context.");
        return;
      }
      if (draft.sourceContextId === draft.targetContextId) {
        setSubmitError("Source and target must be different contexts.");
        return;
      }
      if (sourceContext?.isDefault) {
        setSubmitError(
          "The default context cannot be a merge source because it anchors the profile. Make another context default first."
        );
        return;
      }
      input = {
        kind: "merge",
        sourceContextId: draft.sourceContextId,
        targetContextId: draft.targetContextId
      };
    } else {
      input = { kind: "entity", candidate: flow.candidate };
    }

    try {
      await onSubmit(input);
      onOpenChange(false);
    } catch (error) {
      setSubmitError(describeApiError(error).description);
    }
  };

  return (
    <QuestionFlowDialog
      open
      onOpenChange={onOpenChange}
      eyebrow={eyebrow}
      title={title}
      description={description}
      value={draft}
      onChange={setDraft}
      steps={steps}
      submitLabel={submitLabel}
      pending={pending}
      pendingLabel={pendingLabel}
      error={submitError}
      onSubmit={submit}
    />
  );
}
