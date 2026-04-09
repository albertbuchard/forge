import type { ReactNode } from "react";
import {
  buildSearchWorkbenchExecution,
  buildStaticWorkbenchExecution
} from "../../../lib/workbench/runtime.js";
import type {
  WorkbenchExecutionFunction,
  WorkbenchNodeExecutionInput
} from "../../../lib/workbench/nodes.js";
import { createGenericWorkbenchNodeView } from "../shared/generic-node-view.js";
import { defineWorkbenchBox } from "../shared/define-workbench-box.js";

type SlotProps = { children: ReactNode };
function Slot({ children }: SlotProps) {
  return <>{children}</>;
}

function defineHabitBox(
  id: string,
  title: string,
  description: string,
  tags: string[],
  execute: WorkbenchExecutionFunction,
  withSearchTool = false
) {
  return defineWorkbenchBox(Slot, {
    id,
    surfaceId: "habits",
    routePath: "/habits",
    title,
    icon: "habit",
    description,
    category: "Habits",
    tags,
    inputs: [],
    params: [],
    output: [{ key: "primary", label: title, kind: "content" }],
    tools: withSearchTool
      ? [
          {
            key: "forge.search_entities",
            label: "Search Forge entities",
            description: "Search Forge entities by query and entity types.",
            accessMode: "read"
          }
        ]
      : [],
    NodeView: createGenericWorkbenchNodeView({
      title,
      description,
      inputs: [],
      params: [],
      output: [{ key: "primary", label: title, kind: "content" }],
      tools: withSearchTool
        ? [
            {
              key: "forge.search_entities",
              label: "Search Forge entities",
              description: "Search Forge entities by query and entity types.",
              accessMode: "read"
            }
          ]
        : []
    }),
    execute
  });
}

export const HabitsHeroBox = defineHabitBox(
  "surface:habits:hero",
  "Habits hero",
  "Habits page header and recurring execution context.",
  ["habits", "hero"],
  (input: WorkbenchNodeExecutionInput) =>
    buildStaticWorkbenchExecution(input, null, "Habits page header.")
);

export const HabitsSearchResultsBox = defineHabitBox(
  "surface:habits:search-results",
  "Habits list and results",
  "Habit browser, due habits, and recurring check-in context.",
  ["habits", "search", "check-ins"],
  (input: WorkbenchNodeExecutionInput) =>
    buildSearchWorkbenchExecution(input, {
      query: "",
      entityTypes: ["habit"],
      limit: 20
    }),
  true
);

export const HabitsSummaryBox = defineHabitBox(
  "surface:habits:summary",
  "Habits summary",
  "Habit streaks, due state, and collection-level rhythm context.",
  ["habits", "summary", "streaks"],
  (input: WorkbenchNodeExecutionInput) =>
    buildStaticWorkbenchExecution(input, null, "Habit collection summary.")
);
