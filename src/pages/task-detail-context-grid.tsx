import { Link } from "react-router-dom";
import { Bot } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { EntityBadge } from "@/components/ui/entity-badge";
import { UserBadge } from "@/components/ui/user-badge";
import type { Tag, Task, TaskContext } from "@/lib/types";
import {
  WORK_ITEM_LEVEL_META,
  getEntityHref,
  getWorkItemVisualKind
} from "@/pages/task-detail-page-model";
import {
  DetailLabel,
  SectionCard,
  StatTile
} from "@/pages/task-detail-page-ui";

type WorkItemMeta =
  (typeof WORK_ITEM_LEVEL_META)[keyof typeof WORK_ITEM_LEVEL_META];

export function TaskDetailContextGrid({
  payload,
  relatedWorkItems,
  availableTags,
  workItemMeta,
  taskLevel,
  hasAiBrief,
  botOwner,
  formatDate,
  formatDateTime
}: {
  payload: TaskContext;
  relatedWorkItems: Task[];
  availableTags: Tag[];
  workItemMeta: WorkItemMeta;
  taskLevel: "issue" | "task" | "subtask";
  hasAiBrief: boolean;
  botOwner: boolean;
  formatDate: (value: string | null) => string;
  formatDateTime: (value: string) => string;
}) {
  const parentWorkItem = payload.task.parentWorkItemId
    ? (relatedWorkItems.find(
        (item) => item.id === payload.task.parentWorkItemId
      ) ?? null)
    : null;
  const childWorkItems = relatedWorkItems
    .filter((item) => item.parentWorkItemId === payload.task.id)
    .sort((left, right) => left.sortOrder - right.sortOrder);
  const mappedTags = (payload.task.tagIds ?? [])
    .map((tagId) => availableTags.find((tag) => tag.id === tagId) ?? null)
    .filter((tag): tag is Tag => Boolean(tag));
  const blockerLinks = payload.task.blockerLinks ?? [];

  return (
    <div className="mt-5 grid gap-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)_minmax(0,1fr)]">
      <SectionCard
        eyebrow="Hierarchy"
        title="Context map"
        description={`See where this ${workItemMeta.noun} sits in the larger planning ladder without opening the board.`}
      >
        <div className="grid gap-4">
          <div>
            <DetailLabel
              label="Project"
              help={`The project is the main work stream this ${workItemMeta.noun} belongs to.`}
            />
            <div className="mt-2">
              {payload.project ? (
                <Link
                  to={`/projects/${payload.project.id}`}
                  className="inline-flex max-w-full"
                >
                  <EntityBadge
                    kind="project"
                    label={payload.project.title}
                    compact
                    gradient={false}
                    wrap
                    className="max-w-full"
                  />
                </Link>
              ) : (
                <Badge className="bg-white/[0.08] text-white/65">
                  No project linked
                </Badge>
              )}
            </div>
          </div>
          <div>
            <DetailLabel
              label="Goal"
              help="The goal shows the longer-term result this work supports."
            />
            <div className="mt-2">
              {payload.goal ? (
                <Link
                  to={`/goals/${payload.goal.id}`}
                  className="inline-flex max-w-full"
                >
                  <EntityBadge
                    kind="goal"
                    label={payload.goal.title}
                    compact
                    gradient={false}
                    wrap
                    className="max-w-full"
                  />
                </Link>
              ) : (
                <Badge className="bg-white/[0.08] text-white/65">
                  No goal linked
                </Badge>
              )}
            </div>
          </div>
          <div>
            <DetailLabel
              label="Parent item"
              help="Issues parent tasks, tasks parent subtasks, and split child items stay legible here."
            />
            <div className="mt-2">
              {parentWorkItem ? (
                <Link
                  to={`/tasks/${parentWorkItem.id}`}
                  className="inline-flex max-w-full"
                >
                  <EntityBadge
                    kind={getWorkItemVisualKind(parentWorkItem.level)}
                    label={parentWorkItem.title}
                    compact
                    gradient={false}
                    wrap
                    className="max-w-full"
                  />
                </Link>
              ) : (
                <Badge className="bg-white/[0.08] text-white/65">
                  No parent work item
                </Badge>
              )}
            </div>
          </div>
          <div>
            <DetailLabel
              label="Child items"
              help="Child work items let you scan the next layer down without leaving the detail view."
            />
            <div className="mt-2 flex flex-wrap gap-2">
              {childWorkItems.length > 0 ? (
                childWorkItems.map((item) => (
                  <Link
                    key={item.id}
                    to={`/tasks/${item.id}`}
                    className="inline-flex max-w-full"
                  >
                    <EntityBadge
                      kind={getWorkItemVisualKind(item.level)}
                      label={item.title}
                      compact
                      gradient={false}
                      wrap
                      className="max-w-full"
                    />
                  </Link>
                ))
              ) : (
                <Badge className="bg-white/[0.08] text-white/65">
                  No child work items
                </Badge>
              )}
            </div>
          </div>
        </div>
      </SectionCard>

      <SectionCard
        eyebrow="Execution"
        title="Execution profile"
        description="Surface the operating mode, AI posture, tags, and blockers as a single readable brief."
      >
        <div className="grid gap-3">
          <StatTile
            label="Work-item type"
            value={workItemMeta.descriptor}
            hint={
              taskLevel === "task"
                ? "Tasks are meant to fit one focused AI session."
                : taskLevel === "issue"
                  ? "Issues hold the vertical slice and its delivery contract."
                  : "Subtasks stay intentionally small and concrete."
            }
          />
          <div className="grid gap-3 sm:grid-cols-2">
            <StatTile
              label="Execution mode"
              value={
                payload.task.executionMode
                  ? payload.task.executionMode.toUpperCase()
                  : "Not set"
              }
            />
            <StatTile
              label="AI posture"
              value={
                hasAiBrief
                  ? "AI brief ready"
                  : taskLevel === "issue"
                    ? "Issue narrative only"
                    : "Needs AI brief"
              }
            />
          </div>
          <div>
            <DetailLabel
              label="Tags"
              help="Tags shape filtering and fast scanning across the board and hierarchy views."
            />
            <div className="mt-2 flex flex-wrap gap-2">
              {mappedTags.length > 0 ? (
                mappedTags.map((tag) => (
                  <Badge key={tag.id} className="bg-white/[0.08] text-white/72">
                    {tag.name}
                  </Badge>
                ))
              ) : (
                <Badge className="bg-white/[0.08] text-white/65">No tags</Badge>
              )}
            </div>
          </div>
          <div>
            <DetailLabel
              label="Blockers"
              help="Blockers tie this work item to the entities that currently constrain it."
            />
            <div className="mt-2 flex flex-wrap gap-2">
              {blockerLinks.length > 0 ? (
                blockerLinks.map((blocker) => {
                  const href = getEntityHref(
                    blocker.entityType,
                    blocker.entityId
                  );
                  const content = (
                    <Badge
                      key={`${blocker.entityType}:${blocker.entityId}`}
                      wrap
                      className="bg-amber-500/12 text-amber-100"
                    >
                      {blocker.label ??
                        `${blocker.entityType} · ${blocker.entityId}`}
                    </Badge>
                  );
                  if (!href) {
                    return content;
                  }
                  return (
                    <Link
                      key={`${blocker.entityType}:${blocker.entityId}`}
                      to={href}
                      className="inline-flex max-w-full"
                    >
                      {content}
                    </Link>
                  );
                })
              ) : (
                <Badge className="bg-white/[0.08] text-white/65">
                  No blockers linked
                </Badge>
              )}
            </div>
          </div>
        </div>
      </SectionCard>

      <SectionCard
        eyebrow="People and timing"
        title="Accountability surface"
        description="Show who owns the work, who is helping, and when the record moved."
      >
        <div className="grid gap-3">
          <StatTile
            label="Owner"
            value={
              <div className="flex flex-wrap items-center gap-2">
                {payload.task.user ? (
                  <UserBadge user={payload.task.user} compact />
                ) : null}
                <span>{payload.task.owner}</span>
                {botOwner ? (
                  <Badge className="bg-fuchsia-500/12 text-fuchsia-100">
                    <Bot className="mr-1 size-3.5" />
                    Bot owner
                  </Badge>
                ) : null}
              </div>
            }
          />
          <div>
            <DetailLabel label="Assignees" />
            <div className="mt-2 flex flex-wrap gap-2">
              {payload.task.assignees && payload.task.assignees.length > 0 ? (
                payload.task.assignees.map((user) => (
                  <div
                    key={user.id}
                    className="inline-flex items-center gap-2 rounded-full border border-white/8 bg-white/[0.05] px-3 py-1.5 text-sm text-white/72"
                  >
                    <UserBadge user={user} compact />
                    <span>{user.displayName}</span>
                    {user.kind === "bot" ? (
                      <Bot className="size-3.5 text-fuchsia-200" />
                    ) : null}
                  </div>
                ))
              ) : (
                <Badge className="bg-white/[0.08] text-white/65">
                  No assignees
                </Badge>
              )}
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <StatTile
              label="Due date"
              value={formatDate(payload.task.dueDate)}
              hint={`Use due dates only when timing materially matters for this ${workItemMeta.noun}.`}
            />
            <StatTile
              label="Completed"
              value={
                payload.task.completedAt
                  ? formatDateTime(payload.task.completedAt)
                  : "Not completed"
              }
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <StatTile
              label="Created"
              value={formatDateTime(payload.task.createdAt)}
            />
            <StatTile
              label="Updated"
              value={formatDateTime(payload.task.updatedAt)}
            />
          </div>
        </div>
      </SectionCard>
    </div>
  );
}
