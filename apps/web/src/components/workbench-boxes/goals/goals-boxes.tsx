import type { ReactNode } from "react";
import {
  buildSearchWorkbenchExecution,
  buildStaticWorkbenchExecution
} from "../../../lib/workbench/runtime.js";
import type {
  WorkbenchExecutionFunction,
  WorkbenchInputDefinition,
  WorkbenchNodeExecutionInput,
  WorkbenchOutputDefinition,
  WorkbenchParamDefinition,
  WorkbenchToolDefinition
} from "../../../lib/workbench/nodes.js";
import {
  createSearchEntitiesTool,
  createSearchInputs,
  createSearchOutputs,
  createSearchParams,
  createSummaryOutput
} from "../../../lib/workbench/contracts.js";
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
  output: WorkbenchOutputDefinition[],
  tools: WorkbenchToolDefinition[] = [],
  options?: {
    inputs?: WorkbenchInputDefinition[];
    params?: WorkbenchParamDefinition[];
  }
) {
  const inputs = options?.inputs ?? [];
  const params = options?.params ?? [];
  return defineWorkbenchBox(Slot, {
    id,
    surfaceId: "goals",
    routePath: "/goals",
    title,
    icon: "goal",
    description,
    category: "Goals",
    tags,
    inputs,
    params,
    output,
    tools,
    NodeView: createGenericWorkbenchNodeView({
      title,
      description,
      inputs,
      params,
      output,
      tools
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
    buildStaticWorkbenchExecution(input, null, "Goals page header."),
  [createSummaryOutput({ label: "Goals summary", description: "High-level goals page framing." })]
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
  createSearchOutputs({
    itemKind: "goal",
    itemLabel: "Goal"
  }),
  [createSearchEntitiesTool("Search goal entities by query and entity types.")],
  {
    inputs: createSearchInputs({
      itemKind: "goal",
      itemLabel: "Goal",
      defaultEntityTypes: ["goal"],
      defaultLimit: 20
    }),
    params: createSearchParams({
      itemKind: "goal",
      defaultEntityTypes: ["goal"],
      defaultLimit: 20
    })
  }
);

export const GoalsSummaryBox = defineGoalBox(
  "surface:goals:summary",
  "Goals summary",
  "Goal collection summary and state context.",
  ["goals", "summary"],
  (input: WorkbenchNodeExecutionInput) =>
    buildStaticWorkbenchExecution(input, null, "Goal collection summary."),
  [
    createSummaryOutput({
      label: "Goals summary",
      description: "Summary of the goal collection and its current state."
    })
  ]
);
