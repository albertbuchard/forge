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
            <div className="font-label text-[11px] uppercase tracking-[0.18em] text-white/45">
              Goal arcs
            </div>
            <h3 className="mt-2 font-display text-3xl text-white">
              Strategic arcs before tickets
            </h3>
            <p className="mt-3 max-w-3xl text-sm leading-7 text-white/60">
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
            <div className="rounded-[24px] bg-white/[0.04] p-5 text-sm leading-7 text-white/60 xl:col-span-2">
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
                className="rounded-[24px] border border-white/6 bg-[linear-gradient(180deg,rgba(255,255,255,0.06),rgba(255,255,255,0.03))] p-4 transition hover:bg-[linear-gradient(180deg,rgba(255,255,255,0.09),rgba(255,255,255,0.04))]"
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
                    <p className="mt-2 text-sm leading-6 text-white/58">
                      {goal.description || "No strategic note attached yet."}
                    </p>
                  </div>
                  <button
                    className="rounded-full bg-white/6 p-2 text-white/60 transition hover:bg-white/10 hover:text-white"
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
                  <Badge className="bg-white/[0.08] text-white/70">
                    {goal.horizon}
                  </Badge>
                  <Badge
                    className={
                      goal.status === "active"
                        ? "text-emerald-300"
                        : goal.status === "paused"
                          ? "text-amber-300"
                          : "text-[var(--tertiary)]"
                    }
                  >
                    {goal.status}
                  </Badge>
                  <Badge className="bg-white/[0.08] text-white/70">
                    {goal.earnedPoints} / {goal.targetPoints} xp
                  </Badge>
                  <Badge className="bg-white/[0.08] text-white/70">
                    {goal.totalTasks} tasks
                  </Badge>
                </div>

                <div className="mt-4 h-1.5 rounded-full bg-white/[0.08]">
                  <div
                    className="h-full rounded-full bg-[linear-gradient(90deg,var(--primary)_0%,var(--secondary)_100%)]"
                    style={{ width: progressWidth }}
                  />
                </div>

                <div className="mt-3 flex flex-wrap gap-2">
                  {goal.tags.map((tag) => (
                    <Badge
                      key={tag.id}
                      className="bg-white/[0.06] text-white/58"
                    >
                      {tag.name}
                    </Badge>
                  ))}
                </div>

                <div className="mt-3 flex items-center justify-between gap-3 text-[11px] uppercase tracking-[0.16em] text-white/42">
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
