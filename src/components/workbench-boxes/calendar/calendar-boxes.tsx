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

function defineCalendarBox(
  id: string,
  title: string,
  description: string,
  tags: string[],
  execute: WorkbenchExecutionFunction,
  searchEntityTypes: string[] = []
) {
  const tools =
    searchEntityTypes.length > 0
      ? [
          {
            key: "forge.search_entities",
            label: "Search Forge entities",
            description: "Search calendar-backed Forge entities and planning records.",
            accessMode: "read" as const
          }
        ]
      : [];
  return defineWorkbenchBox(Slot, {
    id,
    surfaceId: "calendar",
    routePath: "/calendar",
    title,
    icon: "calendar",
    description,
    category: "Calendar",
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
    )
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
  ["calendar_event"]
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
  ["task_timebox", "work_block_template"]
);
