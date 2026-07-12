import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ArrowDown, ArrowUp, GripVertical, Trash2 } from "lucide-react";

import {
  FlowChoiceGrid,
  FlowField
} from "@/components/flows/question-flow-dialog";
import {
  toggleString,
  type StrategyDialogDraftNode,
  type StrategyNodeDependencyMode
} from "@/components/strategy-dialog-model";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EntityBadge } from "@/components/ui/entity-badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { UserBadge } from "@/components/ui/user-badge";
import type { ProjectSummary, Task, UserSummary } from "@/lib/types";
import { cn } from "@/lib/utils";

export function SortableSequenceCard({
  node,
  index,
  total,
  projectsById,
  tasksById,
  usersById,
  allNodes,
  onUpdate,
  onRemove,
  onMove
}: {
  node: StrategyDialogDraftNode;
  index: number;
  total: number;
  projectsById: Map<string, ProjectSummary>;
  tasksById: Map<string, Task>;
  usersById: Map<string, UserSummary>;
  allNodes: StrategyDialogDraftNode[];
  onUpdate: (nodeId: string, patch: Partial<StrategyDialogDraftNode>) => void;
  onRemove: (nodeId: string) => void;
  onMove: (nodeId: string, direction: -1 | 1) => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging
  } = useSortable({
    id: node.id
  });
  const entity =
    node.entityType === "project"
      ? projectsById.get(node.entityId)
      : tasksById.get(node.entityId);
  const owner =
    entity && "userId" in entity && entity.userId
      ? (usersById.get(entity.userId) ?? entity.user ?? null)
      : null;
  const dependencyCandidates = allNodes.filter(
    (candidate) => candidate.id !== node.id
  );

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition
      }}
      className={cn(
        "min-w-0 overflow-hidden rounded-[24px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] p-4 shadow-[var(--ui-shadow-soft)]",
        isDragging && "opacity-70"
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <button
            type="button"
            aria-label={`Reorder step ${index + 1}`}
            className="mt-1 rounded-full bg-[var(--ui-surface-2)] p-2 text-[var(--ui-ink-soft)] transition hover:bg-[var(--ui-surface-hover)] hover:text-[var(--ui-ink-strong)]"
            {...attributes}
            {...listeners}
          >
            <GripVertical className="size-4" />
          </button>
          <div className="min-w-0">
            <div className="flex flex-wrap gap-2">
              <Badge className="bg-[var(--ui-surface-2)] text-[var(--ui-ink-medium)]">
                Step {index + 1}
              </Badge>
              <Badge className="bg-[var(--ui-surface-2)] text-[var(--ui-ink-medium)]">
                {node.entityType}
              </Badge>
              {entity ? (
                <EntityBadge
                  kind={node.entityType}
                  label={entity.title}
                  compact
                  gradient={false}
                />
              ) : null}
            </div>
            <div className="mt-3 text-base font-medium text-[var(--ui-ink-strong)]">
              {entity?.title || "Select an entity for this step"}
            </div>
            <div className="mt-2 break-words text-sm leading-6 text-[var(--ui-ink-soft)]">
              {node.notes ||
                (entity && "description" in entity ? entity.description : "") ||
                "Add an optional note if this phase needs intent or setup context."}
            </div>
            {owner ? (
              <div className="mt-3">
                <UserBadge user={owner} compact />
              </div>
            ) : null}
          </div>
        </div>
        <div className="flex w-full items-center justify-end gap-2 sm:w-auto">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="size-9 px-0"
            aria-label={`Move step ${index + 1} up`}
            title="Move up"
            disabled={index === 0}
            onClick={() => onMove(node.id, -1)}
          >
            <ArrowUp className="size-4" />
          </Button>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="size-9 px-0"
            aria-label={`Move step ${index + 1} down`}
            title="Move down"
            disabled={index === total - 1}
            onClick={() => onMove(node.id, 1)}
          >
            <ArrowDown className="size-4" />
          </Button>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={total === 1}
            onClick={() => onRemove(node.id)}
          >
            <Trash2 className="size-4" />
            Remove
          </Button>
        </div>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <FlowField
          label="Relationship to the flow"
          labelHelp="Keep the sequence mostly linear in the form. Use parallel when this step should open beside the previous one, or custom only when the dependency is special."
        >
          <FlowChoiceGrid
            value={node.dependencyMode}
            columns={2}
            onChange={(value) =>
              onUpdate(node.id, {
                dependencyMode: value as StrategyNodeDependencyMode
              })
            }
            options={[
              {
                value: "start",
                label: "Start here",
                description: "This step opens immediately."
              },
              {
                value: "after_previous",
                label: "After previous",
                description: "Use the prior step as the gate."
              },
              {
                value: "parallel_with_previous",
                label: "Parallel with previous",
                description: "Open beside the prior branch."
              },
              {
                value: "custom",
                label: "Custom dependency",
                description: "Pick prerequisite steps manually."
              }
            ]}
          />
        </FlowField>

        <div className="grid gap-4">
          <FlowField label="Branch label">
            <Input
              value={node.branchLabel}
              onChange={(event) =>
                onUpdate(node.id, { branchLabel: event.target.value })
              }
              placeholder="Core path, fallback lane, support branch"
            />
          </FlowField>
          <FlowField label="Step note">
            <Textarea
              value={node.notes}
              onChange={(event) =>
                onUpdate(node.id, { notes: event.target.value })
              }
              placeholder="Explain what has to be true before or after this step."
            />
          </FlowField>
        </div>
      </div>

      {node.dependencyMode === "custom" ? (
        <div className="mt-4 rounded-[20px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] p-4">
          <div className="text-sm font-medium text-[var(--ui-ink-strong)]">
            Depends on
          </div>
          <div className="mt-3 grid gap-2">
            {dependencyCandidates.length === 0 ? (
              <div className="text-sm text-[var(--ui-ink-soft)]">
                No other steps available yet.
              </div>
            ) : (
              dependencyCandidates.map((candidate) => {
                const candidateEntity =
                  candidate.entityType === "project"
                    ? projectsById.get(candidate.entityId)
                    : tasksById.get(candidate.entityId);
                return (
                  <label
                    key={candidate.id}
                    className="flex items-start justify-between gap-3 rounded-[16px] bg-[var(--ui-surface-2)] px-4 py-3"
                  >
                    <div>
                      <div className="text-sm font-medium text-[var(--ui-ink-strong)]">
                        {candidateEntity?.title ||
                          `Step ${allNodes.indexOf(candidate) + 1}`}
                      </div>
                      <div className="mt-1 text-xs leading-5 text-[var(--ui-ink-soft)]">
                        {candidate.branchLabel || candidate.entityType}
                      </div>
                    </div>
                    <input
                      type="checkbox"
                      checked={node.customPredecessorIds.includes(candidate.id)}
                      onChange={() =>
                        onUpdate(node.id, {
                          customPredecessorIds: toggleString(
                            node.customPredecessorIds,
                            candidate.id
                          )
                        })
                      }
                    />
                  </label>
                );
              })
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
