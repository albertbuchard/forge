import { useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, PencilLine } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EntityBadge } from "@/components/ui/entity-badge";
import { EntityName } from "@/components/ui/entity-name";
import { GoalDialog } from "@/components/goal-dialog";
import type { GoalMutationInput } from "@/lib/schemas";
import type { DashboardGoal, Tag, UserSummary } from "@/lib/types";

export function GoalStudio({
  goals,
  tags,
  users,
  defaultUserId = null,
  pending = false,
  onCreate,
  onUpdate
}: {
  goals: DashboardGoal[];
  tags: Tag[];
  users: UserSummary[];
  defaultUserId?: string | null;
  pending?: boolean;
  onCreate: (input: GoalMutationInput) => Promise<void>;
  onUpdate: (goalId: string, input: GoalMutationInput) => Promise<void>;
}) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingGoalId, setEditingGoalId] = useState<string | null>(null);
  const editingGoal = goals.find((goal) => goal.id === editingGoalId) ?? null;

  return (
    <>
      <Card>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <div className="font-label text-[11px] uppercase tracking-[0.18em] text-[var(--ui-ink-faint)]">
              Goal arcs
            </div>
            <h3 className="mt-2 font-display text-3xl text-[var(--ui-ink-strong)]">
              Strategic arcs before tickets
            </h3>
            <p className="mt-3 max-w-3xl text-sm leading-7 text-[var(--ui-ink-soft)]">
              This is the long-horizon map. Each arc shows why it matters, how
              much ground has been covered, and which project should move next.
            </p>
          </div>
          <Button
            onClick={() => {
              setEditingGoalId(null);
              setDialogOpen(true);
            }}
          >
            Create goal
          </Button>
        </div>

        <div className="mt-5 grid gap-3 xl:grid-cols-2">
          {goals.length === 0 ? (
            <div className="rounded-[24px] bg-[var(--ui-surface-2)] p-5 text-sm leading-7 text-[var(--ui-ink-soft)] xl:col-span-2">
              Start with a life goal. Once the destination is clear, you can
              attach projects and then fill those projects with tasks.
            </div>
          ) : null}
          {goals.map((goal) => {
            const progressWidth = `${Math.max(6, Math.min(100, goal.progress))}%`;
            return (
              <Link
                to={`/goals/${goal.id}`}
                key={goal.id}
                className="rounded-[24px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] p-4 transition hover:bg-[var(--ui-surface-hover)]"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <EntityBadge kind="goal" compact gradient={false} />
                    <div className="mt-2">
                      <EntityName
                        kind="goal"
                        label={goal.title}
                        variant="heading"
                        size="lg"
                        showKind={false}
                        lines={2}
                      />
                    </div>
                    <p className="mt-2 text-sm leading-6 text-[var(--ui-ink-soft)]">
                      {goal.description || "No strategic note attached yet."}
                    </p>
                  </div>
                  <button
                    className="rounded-full bg-[var(--ui-surface-2)] p-2 text-[var(--ui-ink-soft)] transition hover:bg-[var(--ui-surface-hover)] hover:text-[var(--ui-ink-strong)]"
                    type="button"
                    onClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      setEditingGoalId(goal.id);
                      setDialogOpen(true);
                    }}
                  >
                    <PencilLine className="size-4" />
                  </button>
                </div>

                <div className="mt-4 flex flex-wrap gap-2">
                  <Badge className="bg-[var(--ui-surface-2)] text-[var(--ui-ink-soft)]">
                    {goal.horizon}
                  </Badge>
                  <Badge
                    className={
                      goal.status === "active"
                        ? "text-[var(--success)]"
                        : goal.status === "paused"
                          ? "text-[var(--warning)]"
                          : "text-[var(--tertiary)]"
                    }
                  >
                    {goal.status}
                  </Badge>
                  <Badge className="bg-[var(--ui-surface-2)] text-[var(--ui-ink-soft)]">
                    {goal.earnedPoints} / {goal.targetPoints} xp
                  </Badge>
                  <Badge className="bg-[var(--ui-surface-2)] text-[var(--ui-ink-soft)]">
                    {goal.totalTasks} tasks
                  </Badge>
                </div>

                <div className="mt-4 h-1.5 rounded-full bg-[var(--ui-surface-2)]">
                  <div
                    className="h-full rounded-full bg-[var(--primary)]"
                    style={{ width: progressWidth }}
                  />
                </div>

                <div className="mt-3 flex flex-wrap gap-2">
                  {goal.tags.map((tag) => (
                    <Badge
                      key={tag.id}
                      className="bg-[var(--ui-surface-2)] text-[var(--ui-ink-soft)]"
                    >
                      {tag.name}
                    </Badge>
                  ))}
                </div>

                <div className="mt-3 flex items-center justify-between gap-3 text-[11px] uppercase tracking-[0.16em] text-[var(--ui-ink-faint)]">
                  <span className="min-w-0 flex-1 truncate">
                    {goal.momentumLabel}
                  </span>
                  <span
                    className="inline-flex shrink-0 items-center gap-2"
                    style={{ color: goal.themeColor }}
                  >
                    Open arc
                    <ArrowRight className="size-3.5" />
                  </span>
                </div>
              </Link>
            );
          })}
        </div>
      </Card>

      <GoalDialog
        open={dialogOpen}
        pending={pending}
        editingGoal={editingGoal}
        tags={tags}
        users={users}
        defaultUserId={defaultUserId}
        onOpenChange={(open) => {
          setDialogOpen(open);
          if (!open) {
            setEditingGoalId(null);
          }
        }}
        onSubmit={async (input, goalId) => {
          if (goalId) {
            await onUpdate(goalId, input);
            return;
          }
          await onCreate(input);
        }}
      />
    </>
  );
}
