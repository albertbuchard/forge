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

function defineGoalBox(
  id: string,
  title: string,
  description: string,
  tags: string[],
  execute: WorkbenchExecutionFunction,
  withSearchTool = false
) {
  return defineWorkbenchBox(Slot, {
    id,
    surfaceId: "goals",
    routePath: "/goals",
    title,
    icon: "goal",
    description,
    category: "Goals",
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

export const GoalsHeroBox = defineGoalBox(
  "surface:goals:hero",
  "Goals hero",
  "Goals page header and long-horizon direction context.",
  ["goals", "hero"],
  (input: WorkbenchNodeExecutionInput) =>
    buildStaticWorkbenchExecution(input, null, "Goals page header.")
);

export const GoalsSearchResultsBox = defineGoalBox(
  "surface:goals:search-results",
  "Goals list and results",
  "Goal browser, linked context, and search results.",
  ["goals", "search"],
  (input: WorkbenchNodeExecutionInput) =>
    buildSearchWorkbenchExecution(input, {
      query: "",
      entityTypes: ["goal"],
      limit: 20
    }),
  true
);

export const GoalsSummaryBox = defineGoalBox(
  "surface:goals:summary",
  "Goals summary",
  "Goal collection summary and state context.",
  ["goals", "summary"],
  (input: WorkbenchNodeExecutionInput) =>
    buildStaticWorkbenchExecution(input, null, "Goal collection summary.")
);
