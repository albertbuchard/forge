import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { FlowField, QuestionFlowDialog, type QuestionFlowStep } from "@/components/flows/question-flow-dialog";
import { AtlasPanel } from "@/components/psyche/atlas-panel";
import { OrbitMap } from "@/components/psyche/orbit-map";
import { PsycheSectionNav } from "@/components/psyche/psyche-section-nav";
import { psycheFocusClass, usePsycheFocusTarget } from "@/components/psyche/use-psyche-focus-target";
import { useForgeShell } from "@/components/shell/app-shell";
import { PageHero } from "@/components/shell/page-hero";
import { Button } from "@/components/ui/button";
import { EntityBadge } from "@/components/ui/entity-badge";
import { EntityName } from "@/components/ui/entity-name";
import { ErrorState, LoadingState } from "@/components/ui/page-state";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { createPsycheValue, listPsycheValues, patchPsycheValue } from "@/lib/api";
import { getEntityButtonClassName } from "@/lib/entity-visuals";
import { psycheValueSchema, type PsycheValueInput } from "@/lib/psyche-schemas";
import type { PsycheValue } from "@/lib/psyche-types";

const DEFAULT_VALUE_INPUT: PsycheValueInput = {
  title: "",
  description: "",
  valuedDirection: "",
  whyItMatters: "",
  linkedGoalIds: [],
  linkedProjectIds: [],
  linkedTaskIds: [],
  committedActions: []
};

function toggleId(current: string[], id: string) {
  return current.includes(id) ? current.filter((entry) => entry !== id) : [...current, id];
}

function valueToInput(value: PsycheValue): PsycheValueInput {
  return {
    title: value.title,
    description: value.description,
    valuedDirection: value.valuedDirection,
    whyItMatters: value.whyItMatters,
    linkedGoalIds: value.linkedGoalIds,
    linkedProjectIds: value.linkedProjectIds,
    linkedTaskIds: value.linkedTaskIds,
    committedActions: value.committedActions
  };
}

export function PsycheValuesPage() {
  const shell = useForgeShell();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingValue, setEditingValue] = useState<PsycheValue | null>(null);
  const [draft, setDraft] = useState<PsycheValueInput>(DEFAULT_VALUE_INPUT);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const valuesQuery = useQuery({
    queryKey: ["forge-psyche-values"],
    queryFn: listPsycheValues
  });

  const values = valuesQuery.data?.values ?? [];
  const focusedValueId = searchParams.get("focus");

  usePsycheFocusTarget(focusedValueId);

  useEffect(() => {
    if (searchParams.get("create") === "1") {
      setDialogOpen(true);
      setEditingValue(null);
      setDraft(DEFAULT_VALUE_INPUT);
      const next = new URLSearchParams(searchParams);
      next.delete("create");
      setSearchParams(next, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  const saveMutation = useMutation({
    mutationFn: async (input: PsycheValueInput) => {
      const parsed = psycheValueSchema.parse(input);
      if (editingValue) {
        return patchPsycheValue(editingValue.id, parsed);
      }
      return createPsycheValue(parsed);
    },
    onSuccess: async () => {
      setDialogOpen(false);
      setEditingValue(null);
      setDraft(DEFAULT_VALUE_INPUT);
      setSubmitError(null);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["forge-psyche-values"] }),
        queryClient.invalidateQueries({ queryKey: ["forge-psyche-overview"] })
      ]);
    }
  });

  const orbitNodes = useMemo(
    () =>
      values.slice(0, 5).map((value, index) => ({
        id: value.id,
        label: `${value.linkedGoalIds.length} goals`,
        title: value.title,
        detail: value.valuedDirection,
        href: `/psyche/values?focus=${value.id}#values-atlas`,
        angle: -90 + index * 68,
        radius: 150 + (index % 2) * 20,
        tone: (["mint", "sky", "violet", "rose"] as const)[index % 4]
      })),
    [values]
  );

  const steps: Array<QuestionFlowStep<PsycheValueInput>> = [
    {
      id: "direction",
      eyebrow: "Compass",
      title: "Name the direction you want to protect",
      description: "Start with the value itself and the life-direction it points toward.",
      render: (value, setValue) => (
        <>
          <FlowField label="Value name">
            <Input value={value.title} onChange={(event) => setValue({ title: event.target.value })} placeholder="Repair with steadiness" />
          </FlowField>
          <FlowField label="Valued direction">
            <Input value={value.valuedDirection} onChange={(event) => setValue({ valuedDirection: event.target.value })} placeholder="Warm, brave, and honest connection" />
          </FlowField>
          <FlowField label="Why it matters">
            <Textarea value={value.whyItMatters} onChange={(event) => setValue({ whyItMatters: event.target.value })} placeholder="Why is this direction important enough to protect when pressure rises?" />
          </FlowField>
        </>
      )
    },
    {
      id: "shape",
      eyebrow: "Texture",
      title: "Describe how the value should feel in lived form",
      description: "Keep this concrete enough that later reports and behaviors can map back to it.",
      render: (value, setValue) => (
        <>
          <FlowField label="Description">
            <Textarea value={value.description} onChange={(event) => setValue({ description: event.target.value })} placeholder="Describe what this value looks like in daily behavior, not just in theory." />
          </FlowField>
          <FlowField label="Committed action ideas">
            <Textarea
              value={value.committedActions.join("\n")}
              onChange={(event) =>
                setValue({
                  committedActions: event.target.value
                    .split("\n")
                    .map((entry) => entry.trim())
                    .filter(Boolean)
                })
              }
              placeholder={"One line per action\nText your sister before Friday\nTake a ten-minute reset walk"}
            />
          </FlowField>
        </>
      )
    },
    {
      id: "links",
      eyebrow: "Placement",
      title: "Place the value into the real system of work",
      description: "This is where values become graphical anchors across goals, projects, and tasks instead of standalone notes.",
      render: (value, setValue) => (
        <>
          <FlowField label="Linked goals">
            <div className="flex flex-wrap gap-2">
              {shell.snapshot.goals.map((goal) => {
                const selected = value.linkedGoalIds.includes(goal.id);
                return (
                  <button
                    key={goal.id}
                    type="button"
                    className={`rounded-full px-2.5 py-2 text-sm transition ${getEntityButtonClassName("goal", selected)}`}
                    onClick={() => setValue({ linkedGoalIds: toggleId(value.linkedGoalIds, goal.id) })}
                  >
                    <EntityBadge kind="goal" label={goal.title} compact gradient={false} />
                  </button>
                );
              })}
            </div>
          </FlowField>
          <FlowField label="Linked projects">
            <div className="flex flex-wrap gap-2">
              {shell.snapshot.dashboard.projects.map((project) => {
                const selected = value.linkedProjectIds.includes(project.id);
                return (
                  <button
                    key={project.id}
                    type="button"
                    className={`rounded-full px-2.5 py-2 text-sm transition ${getEntityButtonClassName("project", selected)}`}
                    onClick={() => setValue({ linkedProjectIds: toggleId(value.linkedProjectIds, project.id) })}
                  >
                    <EntityBadge kind="project" label={project.title} compact gradient={false} />
                  </button>
                );
              })}
            </div>
          </FlowField>
          <FlowField label="Linked tasks">
            <div className="flex max-h-48 flex-wrap gap-2 overflow-y-auto">
              {shell.snapshot.tasks.slice(0, 24).map((task) => {
                const selected = value.linkedTaskIds.includes(task.id);
                return (
                  <button
                    key={task.id}
                    type="button"
                    className={`rounded-full px-2.5 py-2 text-sm transition ${getEntityButtonClassName("task", selected)}`}
                    onClick={() => setValue({ linkedTaskIds: toggleId(value.linkedTaskIds, task.id) })}
                  >
                    <EntityBadge kind="task" label={task.title} compact gradient={false} />
                  </button>
                );
              })}
            </div>
          </FlowField>
        </>
      )
    }
  ];

  if (valuesQuery.isLoading) {
    return <LoadingState eyebrow="Psyche values" title="Loading value constellation" description="Hydrating values, linked goals, projects, and tasks." />;
  }

  if (valuesQuery.isError) {
    return <ErrorState eyebrow="Psyche values" error={valuesQuery.error} onRetry={() => void valuesQuery.refetch()} />;
  }

  return (
    <div className="grid gap-5">
      <PageHero
        entityKind="value"
        title={<EntityName kind="value" label="Values" variant="heading" size="lg" />}
        description="Map values as living anchors. Each one should visibly relate to goals, projects, and tasks so reflection stops feeling separate from the rest of life."
        badge={`${values.length} values`}
        actions={
          <Button
            onClick={() => {
              setEditingValue(null);
              setDraft(DEFAULT_VALUE_INPUT);
              setDialogOpen(true);
            }}
          >
            Add value
          </Button>
        }
      />
      <PsycheSectionNav />

      <OrbitMap
        title="Place values inside the wider life system"
        description="Values are not just notes. This constellation shows which directions are already attached to real goals, projects, and concrete tasks."
        centerLabel="Value field"
        centerValue={`${values.length} mapped`}
        nodes={orbitNodes}
        action={<Button onClick={() => setDialogOpen(true)}>Add value</Button>}
      />

      <AtlasPanel
        eyebrow="Values in context"
        title="See why each value matters and where it lives"
        description="Each card combines the value narrative with its linked goals, projects, tasks, and committed actions so you can understand the shape immediately."
        tone="mint"
        className="scroll-mt-24"
      >
        <div id="values-atlas" className="grid gap-4">
          {values.length === 0 ? (
            <div className="flex justify-start">
              <Button onClick={() => setDialogOpen(true)}>Add value</Button>
            </div>
          ) : (
            values.map((value) => {
              const linkedGoals = shell.snapshot.goals.filter((goal) => value.linkedGoalIds.includes(goal.id));
              const linkedProjects = shell.snapshot.dashboard.projects.filter((project) => value.linkedProjectIds.includes(project.id));
              const linkedTasks = shell.snapshot.tasks.filter((task) => value.linkedTaskIds.includes(task.id));
              const isFocused = focusedValueId === value.id;
              return (
                <div key={value.id} data-psyche-focus-id={value.id} className={`rounded-[26px] border border-white/8 bg-white/[0.04] p-5 transition ${psycheFocusClass(isFocused)}`}>
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div>
                      <EntityName kind="value" label={value.title} variant="heading" size="xl" />
                      <div className="mt-2 text-sm text-[var(--tertiary)]">{value.valuedDirection}</div>
                    </div>
                    <Button
                      variant="secondary"
                      onClick={() => {
                        setEditingValue(value);
                        setDraft(valueToInput(value));
                        setDialogOpen(true);
                      }}
                    >
                      Edit
                    </Button>
                  </div>
                  <p className="mt-4 max-w-3xl text-sm leading-7 text-white/60">{value.description}</p>
                  <div className="mt-5 grid gap-4 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
                    <div className="rounded-[22px] bg-white/[0.04] p-4">
                      <div className="text-[11px] uppercase tracking-[0.16em] text-white/38">Why it matters</div>
                      <div className="mt-2 text-sm leading-6 text-white/64">{value.whyItMatters}</div>
                    </div>
                    <div className="grid gap-3 md:grid-cols-3">
                      <div className="rounded-[22px] bg-white/[0.04] p-4">
                        <div className="text-[11px] uppercase tracking-[0.16em] text-white/38">Goals</div>
                        <div className="mt-3 flex flex-wrap gap-2">
                          {linkedGoals.length === 0 ? <span className="text-sm text-white/44">None linked</span> : linkedGoals.map((goal) => <EntityBadge key={goal.id} kind="goal" label={goal.title} compact />)}
                        </div>
                      </div>
                      <div className="rounded-[22px] bg-white/[0.04] p-4">
                        <div className="text-[11px] uppercase tracking-[0.16em] text-white/38">Projects</div>
                        <div className="mt-3 flex flex-wrap gap-2">
                          {linkedProjects.length === 0 ? <span className="text-sm text-white/44">None linked</span> : linkedProjects.map((project) => <EntityBadge key={project.id} kind="project" label={project.title} compact />)}
                        </div>
                      </div>
                      <div className="rounded-[22px] bg-white/[0.04] p-4">
                        <div className="text-[11px] uppercase tracking-[0.16em] text-white/38">Tasks</div>
                        <div className="mt-3 flex flex-wrap gap-2">
                          {linkedTasks.length === 0 ? <span className="text-sm text-white/44">None linked</span> : linkedTasks.slice(0, 4).map((task) => <EntityBadge key={task.id} kind="task" label={task.title} compact />)}
                        </div>
                      </div>
                    </div>
                  </div>
                  <div className="mt-4 grid gap-2 md:grid-cols-2">
                    {value.committedActions.map((action) => (
                      <div key={action} className="rounded-[18px] bg-[rgba(110,231,183,0.08)] px-4 py-3 text-sm text-white/72">
                        {action}
                      </div>
                    ))}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </AtlasPanel>

      <QuestionFlowDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        eyebrow="Value"
        title={editingValue ? "Refine value placement" : "Create value"}
        description="Forge should capture values through guided placement, not a raw admin form."
        value={draft}
        onChange={setDraft}
        steps={steps}
        submitLabel={editingValue ? "Save value" : "Create value"}
        pending={saveMutation.isPending}
        error={submitError}
        onSubmit={async () => {
          setSubmitError(null);
          const parsed = psycheValueSchema.safeParse(draft);
          if (!parsed.success) {
            setSubmitError("This value still needs a title and valued direction before it can be saved.");
            return;
          }

          try {
            await saveMutation.mutateAsync(parsed.data);
          } catch (error) {
            setSubmitError(error instanceof Error ? error.message : "Unable to save this value right now.");
          }
        }}
      />
    </div>
  );
}
