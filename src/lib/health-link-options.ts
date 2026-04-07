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
  goals?: DashboardGoal[];
  projects?: ProjectSummary[];
  tasks?: Task[];
  habits?: Habit[];
  values?: PsycheValue[];
  patterns?: BehaviorPattern[];
  behaviors?: Behavior[];
  beliefs?: BeliefEntry[];
  reports?: TriggerReport[];
}): EntityLinkOption[] {
  const goals = input.goals ?? [];
  const projects = input.projects ?? [];
  const tasks = input.tasks ?? [];
  const habits = input.habits ?? [];
  const values = input.values ?? [];
  const patterns = input.patterns ?? [];
  const behaviors = input.behaviors ?? [];
  const beliefs = input.beliefs ?? [];
  const reports = input.reports ?? [];

  return [
    ...goals.map((goal) =>
      option(`goal:${goal.id}`, goal.title, "Goal", "goal")
    ),
    ...projects.map((project) =>
      option(`project:${project.id}`, project.title, "Project", "project")
    ),
    ...tasks.map((task) =>
      option(`task:${task.id}`, task.title, "Task", "task")
    ),
    ...habits.map((habit) =>
      option(`habit:${habit.id}`, habit.title, "Habit", "habit")
    ),
    ...values.map((value) =>
      option(`psyche_value:${value.id}`, value.title, "Value", "value")
    ),
    ...patterns.map((pattern) =>
      option(`behavior_pattern:${pattern.id}`, pattern.title, "Pattern", "pattern")
    ),
    ...behaviors.map((behavior) =>
      option(`behavior:${behavior.id}`, behavior.title, "Behavior", "behavior")
    ),
    ...beliefs.map((belief) =>
      option(`belief_entry:${belief.id}`, belief.statement, "Belief", "belief")
    ),
    ...reports.map((report) =>
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
