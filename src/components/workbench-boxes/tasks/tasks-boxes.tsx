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

function defineTasksBox(
  id: string,
  title: string,
  description: string,
  tags: string[],
  execute: WorkbenchExecutionFunction,
  tools: Array<{
    key: string;
    label: string;
    description: string;
    accessMode: "read" | "write" | "read_write" | "exec";
  }> = []
) {
  return defineWorkbenchBox(Slot, {
    id,
    surfaceId: "tasks",
    routePath: "/today",
    title,
    icon: "task",
    description,
    category: "Tasks",
    tags,
    inputs: [],
    params: [],
    output: [{ key: "primary", label: title, kind: "content" }],
    tools,
    NodeView: createGenericWorkbenchNodeView({
      title,
      description,
      inputs: [],
      params: [],
      output: [{ key: "primary", label: title, kind: "content" }],
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
  [
    {
      key: "forge.search_entities",
      label: "Search Forge entities",
      description: "Search task entities by title, status, or linked context.",
      accessMode: "read"
    },
    {
      key: "forge.update_task_status",
      label: "Update task status",
      description: "Move a task between backlog, focus, in progress, blocked, and done.",
      accessMode: "write"
    }
  ]
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
    {
      key: "forge.update_task_status",
      label: "Update task status",
      description: "Change task state as the flow decides what should happen next.",
      accessMode: "write"
    }
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
    )
);
