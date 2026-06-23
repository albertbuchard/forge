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
  createSummaryOutput,
  createTaskStatusTool
} from "../../../lib/workbench/contracts.js";
import { createGenericWorkbenchNodeView } from "../shared/generic-node-view.js";
import { defineWorkbenchBox } from "../shared/define-workbench-box.js";

type SlotProps = { children: ReactNode };
function Slot({ children }: SlotProps) {
  return <>{children}</>;
}

function defineTasksBox(
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
    surfaceId: "tasks",
    routePath: "/today",
    title,
    icon: "task",
    description,
    category: "Tasks",
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

export const TasksInboxBox = defineTasksBox(
  "surface:tasks:inbox",
  "Task queue",
  "Searchable task queue spanning backlog, focus, and in-progress work.",
  ["tasks", "queue", "search"],
  (input: WorkbenchNodeExecutionInput) =>
    buildSearchWorkbenchExecution(input, {
      query: "",
      entityTypes: ["task"],
      limit: 20
    }),
  createSearchOutputs({
    itemKind: "task",
    itemLabel: "Task"
  }),
  [
    createSearchEntitiesTool("Search task entities by title, status, or linked context."),
    createTaskStatusTool("Move a task between backlog, focus, in progress, blocked, and done.")
  ],
  {
    inputs: createSearchInputs({
      itemKind: "task",
      itemLabel: "Task",
      defaultEntityTypes: ["task"],
      defaultLimit: 20
    }),
    params: createSearchParams({
      itemKind: "task",
      defaultEntityTypes: ["task"],
      defaultLimit: 20
    })
  }
);

export const TasksFocusBox = defineTasksBox(
  "surface:tasks:focus-lane",
  "Focus lane",
  "Focused task lane for what should happen next right now.",
  ["tasks", "focus", "execution"],
  (input: WorkbenchNodeExecutionInput) =>
    buildStaticWorkbenchExecution(
      input,
      {
        hint: "Use this surface to represent active or next-up work."
      },
      "Focus lane context for the current execution board."
    ),
  [
    createSummaryOutput({
      label: "Focus summary",
      description: "Human-readable explanation of what the focus lane represents."
    })
  ],
  [
    createTaskStatusTool("Change task state as the flow decides what should happen next.")
  ]
);

export const TasksSummaryBox = defineTasksBox(
  "surface:tasks:summary",
  "Task summary",
  "High-level summary of the current task system and work state.",
  ["tasks", "summary"],
  (input: WorkbenchNodeExecutionInput) =>
    buildStaticWorkbenchExecution(
      input,
      {
        states: ["backlog", "focus", "in_progress", "blocked", "done"]
      },
      "Task system summary with the key task states Forge tracks."
    ),
  [
    createSummaryOutput({
      label: "Task summary",
      description: "High-level summary of the current task system and work state."
    })
  ]
);
