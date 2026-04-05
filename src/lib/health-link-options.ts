import type { EntityLinkOption } from "@/components/psyche/entity-link-multiselect";
import type {
  Behavior,
  BehaviorPattern,
  BeliefEntry,
  PsycheValue,
  TriggerReport
} from "@/lib/psyche-types";
import type { DashboardGoal, Habit, ProjectSummary, Task } from "@/lib/types";

function option(value: string, label: string, description: string, kind: EntityLinkOption["kind"]) {
  return {
    value,
    label,
    description,
    searchText: `${label} ${description}`,
    kind
  } satisfies EntityLinkOption;
}

export function buildHealthEntityLinkOptions(input: {
  goals: DashboardGoal[];
  projects: ProjectSummary[];
  tasks: Task[];
  habits: Habit[];
  values: PsycheValue[];
  patterns: BehaviorPattern[];
  behaviors: Behavior[];
  beliefs: BeliefEntry[];
  reports: TriggerReport[];
}): EntityLinkOption[] {
  return [
    ...input.goals.map((goal) =>
      option(`goal:${goal.id}`, goal.title, "Goal", "goal")
    ),
    ...input.projects.map((project) =>
      option(`project:${project.id}`, project.title, "Project", "project")
    ),
    ...input.tasks.map((task) =>
      option(`task:${task.id}`, task.title, "Task", "task")
    ),
    ...input.habits.map((habit) =>
      option(`habit:${habit.id}`, habit.title, "Habit", "habit")
    ),
    ...input.values.map((value) =>
      option(`psyche_value:${value.id}`, value.title, "Value", "value")
    ),
    ...input.patterns.map((pattern) =>
      option(`behavior_pattern:${pattern.id}`, pattern.title, "Pattern", "pattern")
    ),
    ...input.behaviors.map((behavior) =>
      option(`behavior:${behavior.id}`, behavior.title, "Behavior", "behavior")
    ),
    ...input.beliefs.map((belief) =>
      option(`belief_entry:${belief.id}`, belief.statement, "Belief", "belief")
    ),
    ...input.reports.map((report) =>
      option(`trigger_report:${report.id}`, report.title, "Report", "report")
    )
  ];
}

export function parseHealthLinkValues(values: string[]) {
  return values
    .map((value) => {
      const separator = value.indexOf(":");
      if (separator === -1) {
        return null;
      }
      const entityType = value.slice(0, separator);
      const entityId = value.slice(separator + 1);
      if (!entityType || !entityId) {
        return null;
      }
      return {
        entityType,
        entityId,
        relationshipType: "context"
      };
    })
    .filter(
      (
        entry
      ): entry is {
        entityType: string;
        entityId: string;
        relationshipType: string;
      } => entry !== null
    );
}
