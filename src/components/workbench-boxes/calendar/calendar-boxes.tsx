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

function defineCalendarBox(
  id: string,
  title: string,
  description: string,
  tags: string[],
  execute: WorkbenchExecutionFunction,
  output: WorkbenchOutputDefinition[],
  tools: WorkbenchToolDefinition[],
  options?: {
    inputs?: WorkbenchInputDefinition[];
    params?: WorkbenchParamDefinition[];
  }
) {
  const inputs = options?.inputs ?? [];
  const params = options?.params ?? [];
  return defineWorkbenchBox(Slot, {
    id,
    surfaceId: "calendar",
    routePath: "/calendar",
    title,
    icon: "calendar",
    description,
    category: "Calendar",
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

export const CalendarOverviewBox = defineCalendarBox(
  "surface:calendar:overview",
  "Calendar overview",
  "Main calendar surface for mirrored events, work blocks, and planned timeboxes.",
  ["calendar", "overview"],
  (input: WorkbenchNodeExecutionInput) =>
    buildStaticWorkbenchExecution(
      input,
      {
        surfaces: ["events", "work_blocks", "timeboxes"]
      },
      "Calendar overview spanning mirrored events, work blocks, and timeboxes."
    ),
  [createSummaryOutput({ label: "Calendar summary", description: "Summary of mirrored events, work blocks, and timeboxes." })],
  []
);

export const CalendarEventsBox = defineCalendarBox(
  "surface:calendar:events",
  "Calendar events",
  "Mirrored calendar events and Forge-managed calendar records.",
  ["calendar", "events", "mirrored"],
  (input: WorkbenchNodeExecutionInput) =>
    buildSearchWorkbenchExecution(input, {
      query: "",
      entityTypes: ["calendar_event"],
      limit: 20
    }),
  createSearchOutputs({
    itemKind: "calendar_event",
    itemLabel: "Calendar event"
  }),
  [createSearchEntitiesTool("Search calendar-backed Forge entities and planning records.")],
  {
    inputs: createSearchInputs({
      itemKind: "calendar_event",
      itemLabel: "Calendar event",
      defaultEntityTypes: ["calendar_event"],
      defaultLimit: 20
    }),
    params: createSearchParams({
      itemKind: "calendar_event",
      defaultEntityTypes: ["calendar_event"],
      defaultLimit: 20
    })
  }
);

export const CalendarPlanningBox = defineCalendarBox(
  "surface:calendar:planning",
  "Planning blocks",
  "Planned task timeboxes and reusable work block templates.",
  ["calendar", "planning", "timeboxes"],
  (input: WorkbenchNodeExecutionInput) =>
    buildSearchWorkbenchExecution(input, {
      query: "",
      entityTypes: ["task_timebox", "work_block_template"],
      limit: 20
    }),
  createSearchOutputs({
    itemKind: "calendar_plan",
    itemLabel: "Planning record"
  }),
  [createSearchEntitiesTool("Search calendar-backed Forge entities and planning records.")],
  {
    inputs: createSearchInputs({
      itemKind: "calendar_plan",
      itemLabel: "Planning record",
      defaultEntityTypes: ["task_timebox", "work_block_template"],
      defaultLimit: 20
    }),
    params: createSearchParams({
      itemKind: "calendar_plan",
      defaultEntityTypes: ["task_timebox", "work_block_template"],
      defaultLimit: 20
    })
  }
);
